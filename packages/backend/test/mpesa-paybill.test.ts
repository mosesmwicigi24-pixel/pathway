// Paybill (C2B) payments — money that reaches the church's shortcode without
// a prompt from us (owner, 2026-10-11: "any transaction that goes through our
// M-Pesa or paybill number is reflected in the hub and in our reports"). The
// confirmation becomes a SUCCEEDED gift on the ledger; a prompt's own payment
// arriving through the other door is folded, so one payment is one record;
// the day-by-day report counts only money that arrived.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { agent, bearer, testEnv } from "./helpers/app.js";
import type { Env } from "../src/config/env.js";
import { FinancialService } from "../src/modules/financial/service.js";
import { PartnersService } from "../src/modules/financial/partners.js";
import { FinanceReportsService } from "../src/modules/financial/finance-reports.js";
import { FakeMobileMoneyProvider, parsePaybillPayment } from "../src/modules/financial/providers.js";
import type { PaymentGateway } from "../src/modules/financial/gateway.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

class FakeGateway implements PaymentGateway {
  async createIntent(): Promise<{ id: string; client_secret: string }> {
    return { id: `pi_${randomUUID()}`, client_secret: "secret" };
  }
  verifyWebhook(): never {
    throw new Error("not used");
  }
}

const q = (text: string, params: unknown[] = []) => testPool().query(text, params);
const SECRET = "c2b-test-secret-0123456789abcdef";
const SHORTCODE = "4043755";
const env = (): Partial<Env> => ({ MPESA_C2B_SECRET: SECRET, MPESA_SHORTCODE: SHORTCODE, MPESA_CALLBACK_SECRET: "test-mm-secret", MPESA_CALLBACK_URL: "https://pathway.example.org/v1/webhooks/mobilemoney/mpesa" });

/** A Daraja C2B confirmation body. */
const confirmation = (o: { transId: string; amount: string; msisdn?: string; bill?: string; name?: [string, string?, string?]; time?: string; shortcode?: string }) =>
  JSON.stringify({
    TransactionType: "Pay Bill",
    TransID: o.transId,
    TransTime: o.time ?? "20261011101500",
    TransAmount: o.amount,
    BusinessShortCode: o.shortcode ?? SHORTCODE,
    BillRefNumber: o.bill ?? "",
    InvoiceNumber: "",
    OrgAccountBalance: "49197.00",
    ThirdPartyTransID: "",
    MSISDN: o.msisdn ?? "e4f2c4b9d0a8f3c7e1b2a5d6c8f0e9b7a3c1d2e4f5a6b7c8d9e0f1a2b3c4d5e6",
    FirstName: o.name?.[0] ?? "JOHN",
    MiddleName: o.name?.[1] ?? "",
    LastName: o.name?.[2] ?? "DOE",
  });

let cong: string;
let amina: string;
let admin: string;
let adminTok: string;
let mpesa: FakeMobileMoneyProvider;
let financial: FinancialService;
let reports: FinanceReportsService;

beforeAll(async () => {
  await resetDb();
  cong = await createCongregation("Paybill Branch");
  amina = (await createUser({ congregationId: cong, fullName: "Amina Otieno", phone: "+254711222333" })).user_id;
  admin = (await createUser({ congregationId: cong, fullName: "The Treasurer", phone: "+254700000001", role: "Admin" })).user_id;
  adminTok = bearer({ sub: admin, role: "Admin", cong } as never);
  mpesa = new FakeMobileMoneyProvider("mpesa");
  financial = new FinancialService(testPool(), new FakeGateway(), { mpesa, airtel: new FakeMobileMoneyProvider("airtel") });
  const partners = new PartnersService(testPool(), financial);
  reports = new FinanceReportsService(testPool(), { financial, partners });
});

afterAll(async () => {
  await closeTestPool();
});

describe("parsePaybillPayment", () => {
  it("reads a confirmation into whole-shilling minor units, the EAT instant and a visible number", () => {
    const p = parsePaybillPayment(confirmation({ transId: "uG3j29u3ol", amount: "1000.00", msisdn: "254711222333", bill: "tithe", name: ["AMINA", "", "OTIENO"] }));
    expect(p.trans_id).toBe("UG3J29U3OL");
    expect(p.amount_minor).toBe(100_000);
    expect(p.paid_at?.toISOString()).toBe("2026-10-11T07:15:00.000Z");
    expect(p.payer_phone).toBe("+254711222333");
    expect(p.payer_name).toBe("AMINA OTIENO");
    expect(p.bill_reference).toBe("tithe");
  });
  it("keeps a masked number as msisdn but names no phone", () => {
    const p = parsePaybillPayment(confirmation({ transId: "A1", amount: "50" }));
    expect(p.payer_phone).toBeNull();
    expect(p.msisdn).toMatch(/^e4f2/);
  });
  it("refuses a body that is not a payment", () => {
    expect(() => parsePaybillPayment("{ nope")).toThrow();
    expect(() => parsePaybillPayment(JSON.stringify({ TransID: "X" }))).toThrow();
    expect(() => parsePaybillPayment(confirmation({ transId: "X", amount: "12.345" }))).toThrow();
  });
});

describe("the webhook", () => {
  it("answers 404 to a wrong or missing secret, and nothing is recorded", async () => {
    const app = agent(env());
    await app.post("/v1/webhooks/mpesa/c2b/not-the-secret/confirmation").set("content-type", "application/json").send(confirmation({ transId: "NOPE1", amount: "100" })).expect(404);
    await app.post("/v1/webhooks/mpesa/c2b/not-the-secret/validation").set("content-type", "application/json").send("{}").expect(404);
    const { rows } = await q(`SELECT 1 FROM mpesa_c2b_events WHERE trans_id = 'NOPE1'`);
    expect(rows.length).toBe(0);
  });

  it("validation accepts every payment in Safaricom's own shape", async () => {
    const res = await agent(env()).post(`/v1/webhooks/mpesa/c2b/${SECRET}/validation`).set("content-type", "application/json").send(confirmation({ transId: "V1", amount: "100" })).expect(200);
    expect(res.body).toEqual({ ResultCode: 0, ResultDesc: "Accepted" });
  });

  it("a confirmation from a stranger becomes a succeeded, memberless gift on the ledger, dated when it was paid", async () => {
    const app = agent(env());
    const res = await app.post(`/v1/webhooks/mpesa/c2b/${SECRET}/confirmation`).set("content-type", "application/json")
      .send(confirmation({ transId: "STRANGER1", amount: "500.00", bill: "Building Fund", time: "20261009183000" })).expect(200);
    expect(res.body).toEqual({ ResultCode: 0, ResultDesc: "Success" });
    const { rows } = await q(
      `SELECT t.status, t.source, t.provider, t.user_id, t.amount_minor::int AS amount_minor, t.currency, t.receipt_code, t.giver_name, t.giver_phone,
              t.bill_reference, t.account_name, t.created_at, t.settled_at, f.code AS fund
         FROM transactions t LEFT JOIN funds f ON f.fund_id = t.fund_id WHERE t.receipt_code = 'STRANGER1'`,
    );
    expect(rows.length).toBe(1);
    const t = rows[0];
    expect(t.status).toBe("succeeded");
    expect(t.source).toBe("paybill");
    expect(t.provider).toBe("mpesa");
    expect(t.user_id).toBeNull();
    expect(t.amount_minor).toBe(50_000);
    expect(t.currency).toBe("KES");
    expect(t.giver_name).toBe("JOHN DOE");
    expect(t.giver_phone).toBeNull(); // masked by Safaricom
    expect(t.bill_reference).toBe("Building Fund");
    expect(t.account_name).toBe("Building Fund");
    expect(new Date(t.created_at).toISOString()).toBe("2026-10-09T15:30:00.000Z");
    expect(t.settled_at).not.toBeNull();
    // No fund is called "Building Fund" here → the general fund.
    expect(t.fund).toBe("general");
    const legs = await q(`SELECT le.account, le.side, le.amount_minor::int AS amount_minor FROM ledger_entries le JOIN transactions t USING (transaction_id) WHERE t.receipt_code = 'STRANGER1' ORDER BY le.account`);
    expect(legs.rows).toEqual([
      { account: "cash:mpesa", side: "debit", amount_minor: 50_000 },
      { account: "fund:general", side: "credit", amount_minor: 50_000 },
    ]);
    const ev = await q(`SELECT outcome, transaction_id, amount_minor::int AS amount_minor FROM mpesa_c2b_events WHERE trans_id = 'STRANGER1'`);
    expect(ev.rows[0].outcome).toBe("recorded");
    expect(ev.rows[0].transaction_id).not.toBeNull();
    expect(ev.rows[0].amount_minor).toBe(50_000);
  });

  it("a replay of the same confirmation writes nothing twice", async () => {
    const app = agent(env());
    const body = confirmation({ transId: "REPLAY1", amount: "200" });
    await app.post(`/v1/webhooks/mpesa/c2b/${SECRET}/confirmation`).set("content-type", "application/json").send(body).expect(200);
    await app.post(`/v1/webhooks/mpesa/c2b/${SECRET}/confirmation`).set("content-type", "application/json").send(body).expect(200);
    const { rows } = await q(`SELECT count(*)::int AS n FROM transactions WHERE receipt_code = 'REPLAY1'`);
    expect(rows[0].n).toBe(1);
    const legs = await q(`SELECT count(*)::int AS n FROM ledger_entries le JOIN transactions t USING (transaction_id) WHERE t.receipt_code = 'REPLAY1'`);
    expect(legs.rows[0].n).toBe(2);
  });

  it("the member whose number paid gets the gift, the fund they named, and a receipt queued", async () => {
    const app = agent(env());
    await app.post(`/v1/webhooks/mpesa/c2b/${SECRET}/confirmation`).set("content-type", "application/json")
      .send(confirmation({ transId: "AMINA1", amount: "1500", msisdn: "254711222333", bill: "tithe 0711", name: ["AMINA", "", "OTIENO"] })).expect(200);
    const { rows } = await q(`SELECT t.user_id, t.giver_name, t.giver_phone, f.code AS fund FROM transactions t LEFT JOIN funds f ON f.fund_id = t.fund_id WHERE t.receipt_code = 'AMINA1'`);
    expect(rows[0].user_id).toBe(amina);
    expect(rows[0].fund).toBe("tithe");
    // A member's gift is the member's: no stray giver fields.
    expect(rows[0].giver_name).toBeNull();
    expect(rows[0].giver_phone).toBeNull();
    const outbox = await q(`SELECT count(*)::int AS n FROM outbox WHERE topic = 'giving.receipt' AND payload->>'user_id' = $1`, [amina]);
    expect(outbox.rows[0].n).toBeGreaterThanOrEqual(1);
    // The member's own statement now carries it.
    const partners = new PartnersService(testPool(), financial);
    const st = (await partners.statements(amina, 2026)) as any;
    expect(JSON.stringify(st)).toContain("AMINA1");
  });

  it("a payment to another shortcode is kept as rejected and never becomes money", async () => {
    await agent(env()).post(`/v1/webhooks/mpesa/c2b/${SECRET}/confirmation`).set("content-type", "application/json")
      .send(confirmation({ transId: "OTHERSC", amount: "100", shortcode: "999999" })).expect(200);
    const ev = await q(`SELECT outcome FROM mpesa_c2b_events WHERE trans_id = 'OTHERSC'`);
    expect(ev.rows[0].outcome).toBe("rejected");
    const t = await q(`SELECT 1 FROM transactions WHERE receipt_code = 'OTHERSC'`);
    expect(t.rows.length).toBe(0);
  });

  it("a confirmation that is not a payment is a 400, not a silent nothing", async () => {
    await agent(env()).post(`/v1/webhooks/mpesa/c2b/${SECRET}/confirmation`).set("content-type", "application/json").send("{\"hello\":1}").expect(400);
  });
});

describe("one payment, one record — the prompt and the paybill confirmation describe the same shillings", () => {
  const stkCallback = (ref: string, receipt: string) => JSON.stringify({ event_id: `${ref}-cb`, ref, status: "succeeded", receipt });

  it("confirmation first: a waiting prompt for the same amount and payer is confirmed through Safaricom, not recorded twice", async () => {
    const intent = (await financial.createGivingIntent(amina, {
      idempotency_key: `k-${randomUUID()}`, amount_minor: 70_000, currency: "KES", fund: "general", method: "mpesa",
    } as any)) as any;
    const ref: string = intent.provider_ref ?? intent.checkout_ref ?? (await q(`SELECT provider_ref FROM transactions WHERE transaction_id = $1`, [intent.transaction_id])).rows[0].provider_ref;
    mpesa.outcomes.set(ref, { state: "succeeded" });
    const out = await financial.recordPaybillPayment(
      parsePaybillPayment(confirmation({ transId: "PROMPT1", amount: "700", msisdn: "254711222333" })),
      { rawBody: confirmation({ transId: "PROMPT1", amount: "700", msisdn: "254711222333" }), expectedShortcode: SHORTCODE },
    );
    expect(out.outcome).toBe("matched_prompt");
    const t = await q(`SELECT status, receipt_code, source FROM transactions WHERE provider_ref = $1`, [ref]);
    expect(t.rows[0]).toEqual({ status: "succeeded", receipt_code: "PROMPT1", source: "app" });
    const n = await q(`SELECT count(*)::int AS n FROM transactions WHERE receipt_code = 'PROMPT1'`);
    expect(n.rows[0].n).toBe(1);
    // The prompt's own callback arriving later changes nothing.
    const cb = stkCallback(ref, "PROMPT1");
    await financial.handleMobileMoneyCallback("mpesa", cb, mpesa.sign(cb));
    expect((await q(`SELECT count(*)::int AS n FROM transactions WHERE receipt_code = 'PROMPT1'`)).rows[0].n).toBe(1);
  });

  it("confirmation first, Safaricom slow: the event is parked on the prompt and the sweeper's settlement finishes it", async () => {
    const intent = (await financial.createGivingIntent(amina, {
      idempotency_key: `k-${randomUUID()}`, amount_minor: 80_000, currency: "KES", fund: "general", method: "mpesa",
    } as any)) as any;
    const ref: string = (await q(`SELECT provider_ref FROM transactions WHERE transaction_id = $1`, [intent.transaction_id])).rows[0].provider_ref;
    // Safaricom cannot say yet.
    const out = await financial.recordPaybillPayment(
      parsePaybillPayment(confirmation({ transId: "SLOW1", amount: "800", msisdn: "254711222333" })),
      { rawBody: confirmation({ transId: "SLOW1", amount: "800", msisdn: "254711222333" }), expectedShortcode: SHORTCODE },
    );
    expect(out.outcome).toBe("matched_prompt");
    expect((await q(`SELECT count(*)::int AS n FROM transactions WHERE receipt_code = 'SLOW1'`)).rows[0].n).toBe(0);
    expect((await q(`SELECT status FROM transactions WHERE provider_ref = $1`, [ref])).rows[0].status).toBe("processing");
    // Then Safaricom answers (the callback or the sweeper): settled once, receipt captured.
    mpesa.outcomes.set(ref, { state: "succeeded" });
    const cb = stkCallback(ref, "SLOW1");
    await financial.handleMobileMoneyCallback("mpesa", cb, mpesa.sign(cb));
    const t = await q(`SELECT status, receipt_code FROM transactions WHERE provider_ref = $1`, [ref]);
    expect(t.rows[0]).toEqual({ status: "succeeded", receipt_code: "SLOW1" });
    expect((await q(`SELECT count(*)::int AS n FROM transactions WHERE receipt_code = 'SLOW1'`)).rows[0].n).toBe(1);
  });

  it("prompt first: the paybill confirmation of an already-settled prompt writes nothing", async () => {
    const intent = (await financial.createGivingIntent(amina, {
      idempotency_key: `k-${randomUUID()}`, amount_minor: 90_000, currency: "KES", fund: "general", method: "mpesa",
    } as any)) as any;
    const ref: string = (await q(`SELECT provider_ref FROM transactions WHERE transaction_id = $1`, [intent.transaction_id])).rows[0].provider_ref;
    mpesa.outcomes.set(ref, { state: "succeeded" });
    const cb = stkCallback(ref, "FIRST1");
    await financial.handleMobileMoneyCallback("mpesa", cb, mpesa.sign(cb));
    const out = await financial.recordPaybillPayment(
      parsePaybillPayment(confirmation({ transId: "FIRST1", amount: "900", msisdn: "254711222333" })),
      { rawBody: confirmation({ transId: "FIRST1", amount: "900", msisdn: "254711222333" }), expectedShortcode: SHORTCODE },
    );
    expect(out.outcome).toBe("matched_prompt");
    expect(out.transaction_id).toBe(intent.transaction_id);
    expect((await q(`SELECT count(*)::int AS n FROM transactions WHERE receipt_code = 'FIRST1'`)).rows[0].n).toBe(1);
  });

  it("recorded as paybill, then the prompt settles with the same receipt: the paybill row is reversed, the books stay balanced", async () => {
    // A masked number and a different amount than any waiting prompt → recorded on its own …
    const intent = (await financial.createGivingIntent(amina, {
      idempotency_key: `k-${randomUUID()}`, amount_minor: 123_400, currency: "KES", fund: "tithe", method: "mpesa",
    } as any)) as any;
    const ref: string = (await q(`SELECT provider_ref FROM transactions WHERE transaction_id = $1`, [intent.transaction_id])).rows[0].provider_ref;
    // … because two prompts of that amount are waiting (one each from two members), so neither can be the one.
    const baraka = (await createUser({ congregationId: cong, fullName: "Baraka Mwangi", phone: "+254722333444" })).user_id;
    await financial.createGivingIntent(baraka, { idempotency_key: `k-${randomUUID()}`, amount_minor: 123_400, currency: "KES", fund: "tithe", method: "mpesa" } as any);
    const body = confirmation({ transId: "FOLD1", amount: "1234" });
    const out = await financial.recordPaybillPayment(parsePaybillPayment(body), { rawBody: body, expectedShortcode: SHORTCODE });
    expect(out.outcome).toBe("recorded");
    const paybillId = out.transaction_id!;
    // Then the prompt settles with receipt FOLD1.
    mpesa.outcomes.set(ref, { state: "succeeded" });
    const cb = stkCallback(ref, "FOLD1");
    await financial.handleMobileMoneyCallback("mpesa", cb, mpesa.sign(cb));
    const prompt = await q(`SELECT status, receipt_code FROM transactions WHERE transaction_id = $1`, [intent.transaction_id]);
    expect(prompt.rows[0]).toEqual({ status: "succeeded", receipt_code: "FOLD1" });
    const folded = await q(`SELECT status, receipt_code, reversal_reason, reversed_at FROM transactions WHERE transaction_id = $1`, [paybillId]);
    expect(folded.rows[0].status).toBe("refunded");
    // The trace stays: the reversed row still names the receipt it was for.
    expect(folded.rows[0].receipt_code).toBe("FOLD1");
    expect(folded.rows[0].reversed_at).not.toBeNull();
    expect(folded.rows[0].reversal_reason).toContain("FOLD1");
    // Balanced: the paybill row's two legs plus its two reversing legs net to zero on cash:mpesa.
    const net = await q(
      `SELECT COALESCE(sum(CASE WHEN side = 'debit' THEN amount_minor ELSE -amount_minor END), 0)::int AS net
         FROM ledger_entries WHERE transaction_id = $1 AND account = 'cash:mpesa'`, [paybillId],
    );
    expect(net.rows[0].net).toBe(0);
    const ev = await q(`SELECT outcome, transaction_id FROM mpesa_c2b_events WHERE trans_id = 'FOLD1'`);
    expect(ev.rows[0]).toEqual({ outcome: "matched_prompt", transaction_id: intent.transaction_id });
    // Exactly one live record of KSh 1,234 with that receipt.
    expect((await q(`SELECT count(*)::int AS n FROM transactions WHERE receipt_code = 'FOLD1' AND status = 'succeeded'`)).rows[0].n).toBe(1);
  });
});

describe("the hub and the reports see paybill money, and only money that arrived", () => {
  const eat = (ymd: string, hm = "12:00"): string => new Date(`${ymd}T${hm}:00+03:00`).toISOString();
  const fundId = async (code: string): Promise<string> => (await q(`SELECT fund_id FROM funds WHERE code = $1`, [code])).rows[0].fund_id;
  const gift = async (o: { amount: number; status?: string; at: string; source?: string; provider?: string; officeChannel?: string | null; currency?: string; reversed?: boolean }) => {
    const status = o.status ?? "succeeded";
    const provider = o.officeChannel ? "manual" : (o.provider ?? "mpesa");
    const r = await q(
      `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, provider_ref, idempotency_key, created_at, settled_at, source, receipt_code, office_channel, reversed_at, reversal_reason)
       VALUES ($1, $2, $3, $4, $5::txn_status, $6, $7, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING transaction_id`,
      [amina, await fundId("general"), o.amount, o.currency ?? "KES", status, provider, `ref-${randomUUID()}`, o.at, status === "failed" || status === "processing" ? null : o.at,
       o.source ?? (o.officeChannel ? "admin" : "app"), status === "failed" ? null : `R${randomUUID().slice(0, 8)}`, o.officeChannel ?? null,
       o.reversed ? o.at : null, o.reversed ? "test" : null],
    );
    const id = r.rows[0].transaction_id;
    if (status === "succeeded" || status === "refunded") {
      const cash = o.officeChannel ? `cash:${o.officeChannel}` : `cash:${provider}`;
      await q(`INSERT INTO ledger_entries (transaction_id, account, side, amount_minor, currency, created_at) VALUES ($1, $2, 'debit', $3, $4, $5), ($1, 'fund:general', 'credit', $3, $4, $5)`, [id, cash, o.amount, o.currency ?? "KES", o.at]);
      if (o.reversed) await q(`INSERT INTO ledger_entries (transaction_id, account, side, amount_minor, currency, created_at) VALUES ($1, $2, 'credit', $3, $4, $5), ($1, 'fund:general', 'debit', $3, $4, $5)`, [id, cash, o.amount, o.currency ?? "KES", o.at]);
    }
    return id;
  };

  beforeAll(async () => {
    // A quiet week in June 2025, so nothing above leaks in.
    await gift({ amount: 100_000, at: eat("2025-06-02", "09:00") }); // prompt
    await gift({ amount: 50_000, at: eat("2025-06-02", "19:30"), source: "paybill" }); // paybill
    await gift({ amount: 999_900, at: eat("2025-06-02", "20:00"), status: "failed" }); // not money
    await gift({ amount: 777_700, at: eat("2025-06-02", "20:10"), status: "processing" }); // not yet money
    await gift({ amount: 30_000, at: eat("2025-06-03", "10:00"), officeChannel: "onhand" }); // office cash
    await gift({ amount: 20_000, at: eat("2025-06-03", "11:00"), provider: "stripe" }); // card
    await gift({ amount: 40_000, at: eat("2025-06-04", "08:00"), status: "refunded", reversed: true }); // dropped out
    await gift({ amount: 1_000, at: eat("2025-06-04", "23:30"), currency: "USD", provider: "paypal" }); // another currency
    await gift({ amount: 60_000, at: eat("2025-06-07", "01:30"), source: "paybill" }); // Saturday, early
  });

  it("the day-by-day report totals only succeeded gifts, every day listed, the rail of each shilling named", async () => {
    const out = (await reports.reportDaily({ from: "2025-06-01", to: "2025-06-07" })) as any;
    expect(out.report).toBe("daily");
    expect(out.rails.map((r: any) => r.key)).toEqual(["mpesa", "paybill", "card", "paypal", "airtel", "office"]);
    const kes = out.currencies.find((c: any) => c.currency === "KES");
    expect(kes.days.map((d: any) => d.day)).toEqual(["2025-06-01", "2025-06-02", "2025-06-03", "2025-06-04", "2025-06-05", "2025-06-06", "2025-06-07"]);
    const d2 = kes.days[1];
    expect(d2.total_minor).toBe(150_000); // 1,000 prompt + 500 paybill; the failed and the processing are not money
    expect(d2.count).toBe(2);
    expect(d2.rails.mpesa).toEqual({ amount_minor: 100_000, count: 1 });
    expect(d2.rails.paybill).toEqual({ amount_minor: 50_000, count: 1 });
    const d3 = kes.days[2];
    expect(d3.rails.office).toEqual({ amount_minor: 30_000, count: 1 });
    expect(d3.rails.card).toEqual({ amount_minor: 20_000, count: 1 });
    expect(kes.days[3].total_minor).toBe(0); // the reversed gift dropped out of its day
    expect(kes.days[6].rails.paybill.amount_minor).toBe(60_000);
    expect(kes.totals.total_minor).toBe(260_000);
    expect(kes.totals.count).toBe(5);
    expect(kes.totals.rails.paybill).toEqual({ amount_minor: 110_000, count: 2 });
    expect(kes.days_with_gifts).toBe(3);
    expect(kes.best_day).toBe("2025-06-02");
    const usd = out.currencies.find((c: any) => c.currency === "USD");
    expect(usd.totals.total_minor).toBe(1_000);
    expect(usd.totals.rails.paypal.count).toBe(1);
    // Each day's rails sum to the day; the days sum to the totals.
    for (const d of kes.days) expect(Object.values(d.rails).reduce((s: number, r: any) => s + r.amount_minor, 0)).toBe(d.total_minor);
    expect(kes.days.reduce((s: number, d: any) => s + d.total_minor, 0)).toBe(kes.totals.total_minor);
  });

  it("the report and its CSV are on the wire for finance:view / finance:export, and refuse a 401-day period", async () => {
    await q(`INSERT INTO rbac_user_permissions (user_id, module_id, capability) VALUES ($1, 'finance', 'view'), ($1, 'finance', 'export') ON CONFLICT DO NOTHING`, [admin]);
    const app = agent(env());
    const res = await app.get("/v1/admin/finance/reports/daily?from=2025-06-01&to=2025-06-07").set("authorization", adminTok).expect(200);
    expect(res.body.currencies[0].totals.total_minor).toBe(260_000);
    const csv = await app.get("/v1/admin/finance/reports/daily.csv?from=2025-06-01&to=2025-06-07").set("authorization", adminTok).expect(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    const lines = csv.text.replace(/^﻿/, "").split("\r\n").filter(Boolean);
    expect(lines[0]).toBe("currency,day,total,gifts,mpesa,mpesa_gifts,paybill,paybill_gifts,card,card_gifts,paypal,paypal_gifts,airtel,airtel_gifts,office,office_gifts");
    expect(lines).toContain("KES,2025-06-02,1500.00,2,1000.00,1,500.00,1,0.00,0,0.00,0,0.00,0,0.00,0");
    expect(lines).toContain("KES,TOTAL,2600.00,5,1000.00,1,1100.00,2,200.00,1,0.00,0,0.00,0,300.00,1");
    await app.get("/v1/admin/finance/reports/daily?from=2024-01-01&to=2025-06-07").set("authorization", adminTok).expect(400);
  });

  it("the overview's income counts the paybill money and none of the failed, and says what came in today", async () => {
    const ov = (await reports.overview({ from: "2025-06-01", to: "2025-06-07" }, new Date("2025-06-07T10:00:00+03:00"))) as any;
    const kes = ov.income.find((i: any) => i.currency === "KES");
    expect(kes.period_minor).toBe(260_000);
    expect(kes.period_count).toBe(5);
    expect(ov.today.day).toBe("2025-06-07");
    const todayKes = ov.today.by_currency.find((c: any) => c.currency === "KES");
    expect(todayKes).toEqual({ currency: "KES", total_minor: 60_000, count: 1, paybill_minor: 60_000, paybill_count: 1, prompt_minor: 0, prompt_count: 0 });
  });

  it("the transactions register filters by the paybill source and labels it", async () => {
    const page = await financial.listTransactions({ from: "2025-06-01", to: "2025-06-07", source: "paybill" } as any);
    expect(page.data.length).toBe(2);
    expect(page.data.every((r) => r.source === "paybill")).toBe(true);
    const income = (await reports.reportIncome({ year: 2025, by: "source" })) as any;
    const kes = income.currencies.find((c: any) => c.currency === "KES");
    expect(kes.rows.find((r: any) => r.key === "paybill")?.label).toBe("Paybill");
  });
});

describe("registering the URLs with Safaricom", () => {
  it("builds both URLs from the public origin and the secret, keeps Safaricom's answer, and shows it masked", async () => {
    const out = await financial.registerPaybillUrls(admin, SHORTCODE, {
      confirmationUrl: `https://pathway.example.org/v1/webhooks/mpesa/c2b/${SECRET}/confirmation`,
      validationUrl: `https://pathway.example.org/v1/webhooks/mpesa/c2b/${SECRET}/validation`,
    });
    expect(mpesa.c2bRegistrations.at(-1)?.confirmationUrl).toContain(`/c2b/${SECRET}/confirmation`);
    expect((out.response as any).ResponseCode).toBe("0");
    const status = (await financial.paybillStatus()) as any;
    expect(status.registered_shortcode).toBe(SHORTCODE);
    expect(status.confirmation_url).toBe("https://pathway.example.org/v1/webhooks/mpesa/c2b/<secret>/confirmation");
    expect(status.confirmation_url).not.toContain(SECRET);
    expect(status.last_30_days.recorded).toBeGreaterThanOrEqual(1);
    const audit = await q(`SELECT 1 FROM audit_log WHERE action = 'finance.mpesa.c2b_registered'`);
    expect(audit.rows.length).toBe(1);
  });

  it("the config read tells the office paybill confirmations are on, without the secret", async () => {
    const res = await agent(env()).get("/v1/admin/finance/config").set("authorization", adminTok).expect(200);
    expect(res.body.paybill.enabled).toBe(true);
    expect(res.body.paybill.shortcode).toBe(SHORTCODE);
    expect(res.body.paybill.registered_shortcode).toBe(SHORTCODE);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it("the register route needs finance:manage", async () => {
    const viewer = (await createUser({ congregationId: cong, fullName: "Viewer", phone: "+254700000002" })).user_id;
    await q(`INSERT INTO rbac_user_permissions (user_id, module_id, capability) VALUES ($1, 'finance', 'view')`, [viewer]);
    await agent(env()).post("/v1/admin/finance/mpesa/c2b/register").set("authorization", bearer({ sub: viewer, role: "Student", cong } as never)).expect(403);
  });
});
