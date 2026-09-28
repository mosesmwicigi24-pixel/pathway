// Giving — Cycle 3 of 10 (owner request 2026-09-28): recovery. When a gift
// fails the member can try again without losing what it was for; a member
// waiting on the screen hears the verdict fast; a failure they could not see
// reaches them; nothing is left "processing" for ever; and the office can see
// why. Scenario suite against the real Daraja adapter + a scripted Safaricom.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import supertest from "supertest";
import { pino } from "pino";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { testEnv, bearer } from "./helpers/app.js";
import { createApp } from "../src/http/app.js";
import { FinancialService } from "../src/modules/financial/service.js";
import { PartnersService } from "../src/modules/financial/partners.js";
import { DarajaMpesaProvider, FakeMobileMoneyProvider } from "../src/modules/financial/providers.js";
import { FakePayPalGateway } from "../src/modules/financial/paypal.js";
import type { PaymentGateway, WebhookEvent } from "../src/modules/financial/gateway.js";
import type { Env } from "../src/config/env.js";

class FakeGateway implements PaymentGateway {
  private n = 0;
  async createIntent(): Promise<{ id: string; client_secret: string }> {
    this.n += 1;
    return { id: `pi_${this.n}`, client_secret: `cs_${this.n}` };
  }
  verifyWebhook(rawBody: Buffer | string): WebhookEvent {
    return JSON.parse(typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")) as WebhookEvent;
  }
}
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
class Safaricom {
  readonly results = new Map<string, { code: string; desc: string }>();
  readonly pushes: Array<{ phone: string; ref: string }> = [];
  queries = 0;
  private n = 0;
  readonly fetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    if (u.includes("/oauth/v1/generate")) return json(200, { access_token: "tok", expires_in: "3599" });
    if (u.includes("/stkpush/v1/processrequest")) {
      const body = JSON.parse(String(init?.body)) as { PhoneNumber: string };
      this.n += 1;
      const ref = `ws_CO_${this.n}`;
      this.pushes.push({ phone: body.PhoneNumber, ref });
      return json(200, { CheckoutRequestID: ref, ResponseCode: "0" });
    }
    if (u.includes("/stkpushquery/v1/query")) {
      this.queries += 1;
      const body = JSON.parse(String(init?.body)) as { CheckoutRequestID: string };
      const r = this.results.get(body.CheckoutRequestID);
      if (!r) return json(500, { errorCode: "500.001.1001", errorMessage: "The transaction is being processed" });
      return json(200, { ResponseCode: "0", ResultCode: r.code, ResultDesc: r.desc });
    }
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;
  paid(ref: string): void { this.results.set(ref, { code: "0", desc: "ok" }); }
  failed(ref: string, code: string): void { this.results.set(ref, { code, desc: "no" }); }
}
const cb = (ref: string, code: number) =>
  JSON.stringify({ Body: { stkCallback: { CheckoutRequestID: ref, ResultCode: code, ResultDesc: "x" } } });

let cong: string, user: string, other: string;
let safaricom: Safaricom, svc: FinancialService, gw: FakeGateway;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  user = (await createUser({ congregationId: cong, phone: "0711222333", fullName: "Grace Wanjiru" })).user_id;
  other = (await createUser({ congregationId: cong, phone: "0722333444" })).user_id;
  safaricom = new Safaricom();
  gw = new FakeGateway();
  const daraja = new DarajaMpesaProvider(
    { consumerKey: "k", consumerSecret: "s", passkey: "p", shortcode: "4043755", env: "sandbox", txType: "CustomerPayBillOnline", callbackUrl: "https://example.org/cb" },
    safaricom.fetch,
  );
  svc = new FinancialService(testPool(), gw, { mpesa: daraja, airtel: new FakeMobileMoneyProvider("airtel") }, new FakePayPalGateway("pending"));
});
afterAll(async () => {
  await closeTestPool();
});

async function give(over: Record<string, unknown> = {}): Promise<{ transaction_id: string; provider_ref: string }> {
  return (await svc.createGivingIntent(user, {
    fund: "tithe", amount_minor: 100_000, currency: "KES", method: "mpesa", idempotency_key: `k-${Math.random()}`, ...over,
  } as never)) as { transaction_id: string; provider_ref: string };
}
const age = (id: string, seconds: number) =>
  testPool().query(`UPDATE transactions SET created_at = now() - make_interval(secs => $2) WHERE transaction_id = $1`, [id, seconds]);
const status = async (id: string) => (await testPool().query(`SELECT status, failure_code FROM transactions WHERE transaction_id = $1`, [id])).rows[0];
const notices = async (who = user) =>
  (await testPool().query(`SELECT template, payload FROM notifications WHERE user_id = $1 ORDER BY scheduled_for`, [who])).rows as Array<{ template: string; payload: Record<string, unknown> }>;

describe("Cycle 3 — try again, without losing what the gift was for", () => {
  it("S1 a failed gift is retried with its fund, amount, pledge, name and fee cover — as a new gift", async () => {
    const partners = new PartnersService(testPool(), svc);
    const pledge = (await partners.createPledge(user, { shape: "monthly", amount_minor: 101_300, currency: "KES", due_day: 5, reminders_enabled: true } as never)) as { pledge_id: string };
    const g = await give({ amount_minor: 101_300, pledge_id: pledge.pledge_id, account_name: "October", cover_fee_minor: 1_300 });
    safaricom.failed(g.provider_ref, "1037");
    await svc.handleMobileMoneyCallback("mpesa", cb(g.provider_ref, 1037), "");
    const r = (await svc.retryGift(user, g.transaction_id, { idempotency_key: "retry-0001" })) as Record<string, unknown>;
    expect(r).toMatchObject({ status: "processing", retry_of: g.transaction_id, pledge: { pledge_id: pledge.pledge_id } });
    const row = (await testPool().query(
      `SELECT t.amount_minor::int AS amt, t.currency, f.code AS fund, t.pledge_id, t.account_name, t.fee_cover_minor::int AS fee
         FROM transactions t JOIN funds f ON f.fund_id = t.fund_id WHERE t.transaction_id = $1`, [r.transaction_id])).rows[0];
    expect(row).toMatchObject({ amt: 101_300, currency: "KES", pledge_id: pledge.pledge_id, account_name: "October", fee: 1_300 });
    expect((await status(g.transaction_id)).status).toBe("failed");
    expect(safaricom.pushes).toHaveLength(2);
  });

  it("S2 only the giver's own FAILED gift can be retried; a waiting one is named, a paid one refused", async () => {
    const g = await give();
    await expect(svc.retryGift(other, g.transaction_id, {})).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(svc.retryGift(user, g.transaction_id, {})).rejects.toMatchObject({ code: "UNPROCESSABLE", message: expect.stringContaining("still waiting") });
    safaricom.paid(g.provider_ref);
    await svc.handleMobileMoneyCallback("mpesa", cb(g.provider_ref, 0), "");
    await expect(svc.retryGift(user, g.transaction_id, {})).rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });

  it("S3 a retry toward a pledge cancelled since is refused, as any gift to it would be", async () => {
    const partners = new PartnersService(testPool(), svc);
    const pledge = (await partners.createPledge(user, { shape: "monthly", amount_minor: 50_000, currency: "KES", due_day: 5, reminders_enabled: true } as never)) as { pledge_id: string };
    const g = await give({ amount_minor: 50_000, pledge_id: pledge.pledge_id });
    safaricom.failed(g.provider_ref, "1032");
    await svc.handleMobileMoneyCallback("mpesa", cb(g.provider_ref, 1032), "");
    await partners.updatePledge(user, pledge.pledge_id, { status: "cancelled" } as never);
    await expect(svc.retryGift(user, g.transaction_id, {})).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    expect(safaricom.pushes).toHaveLength(1);
  });

  it("S4 a retry is idempotent on its key, and a second retry while the first waits is GIFT_IN_PROGRESS", async () => {
    const g = await give();
    safaricom.failed(g.provider_ref, "1037");
    await svc.handleMobileMoneyCallback("mpesa", cb(g.provider_ref, 1037), "");
    const a = (await svc.retryGift(user, g.transaction_id, { idempotency_key: "retry-same" })) as { transaction_id: string };
    const b = (await svc.retryGift(user, g.transaction_id, { idempotency_key: "retry-same" })) as { transaction_id: string };
    expect(b.transaction_id).toBe(a.transaction_id);
    await expect(svc.retryGift(user, g.transaction_id, { idempotency_key: "retry-other" })).rejects.toMatchObject({ code: "GIFT_IN_PROGRESS" });
  });
});

describe("Cycle 3 — a member waiting on the screen hears the verdict fast, whatever happens to the callback", () => {
  it("S5 polling a 30-second-old prompt asks Safaricom and shows 'paid' with no callback at all", async () => {
    const g = await give();
    safaricom.paid(g.provider_ref);
    await age(g.transaction_id, 30);
    const d = await svc.givingDetail(user, g.transaction_id);
    expect(d.status).toBe("succeeded");
    expect((d.ledger as unknown[]).length).toBe(2);
  });

  it("S6 polling hard asks Safaricom at most once per 10 s per prompt, and never in the first 20 s", async () => {
    const young = await give();
    for (let i = 0; i < 5; i += 1) await svc.givingDetail(user, young.transaction_id);
    expect(safaricom.queries).toBe(0);
    await age(young.transaction_id, 25);
    for (let i = 0; i < 10; i += 1) await svc.givingDetail(user, young.transaction_id);
    expect(safaricom.queries).toBe(1);
  });

  it("S7 a failure the member could not see reaches them; their own decline, or one they watched, does not", async () => {
    const unseen = await give();
    await age(unseen.transaction_id, 120);
    safaricom.failed(unseen.provider_ref, "1037");
    await svc.reconcileMobileMoney(new Date());
    let n = await notices();
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ template: "giving_gift_failed", payload: { failure_code: "unreachable", transaction_id: unseen.transaction_id } });
    const declined = await give();
    await age(declined.transaction_id, 120);
    safaricom.failed(declined.provider_ref, "1032");
    await svc.reconcileMobileMoney(new Date());
    const watched = await give();
    safaricom.failed(watched.provider_ref, "1037");
    await svc.handleMobileMoneyCallback("mpesa", cb(watched.provider_ref, 1037), "");
    n = await notices();
    expect(n).toHaveLength(1);
    // A stranger's website gift that fails has nobody to notify — and nothing breaks.
    await testPool().query(
      `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, provider_ref, idempotency_key, source, giver_name, giver_phone, created_at)
       SELECT NULL, fund_id, 50000, 'KES', 'processing', 'mpesa', 'ws_CO_web', 'web-key-0001', 'website', 'A Visitor', '+254733000000', now() - interval '3 minutes'
         FROM funds WHERE code = 'tithe'`,
    );
    safaricom.failed("ws_CO_web", "1037");
    await expect(svc.reconcileMobileMoney(new Date())).resolves.toBeTruthy();
    expect((await testPool().query(`SELECT status FROM transactions WHERE provider_ref = 'ws_CO_web'`)).rows[0].status).toBe("failed");
  });

  it("S8 a recurring charge's failure speaks through its schedule notice, not a second message", async () => {
    const s = (await svc.createSchedule(user, { fund: "tithe", amount_minor: 50_000, currency: "KES", frequency: "weekly", method: "mpesa" } as never)) as { schedule_id: string };
    await testPool().query(`UPDATE giving_schedules SET next_run_at = now() - interval '1 hour' WHERE schedule_id = $1`, [s.schedule_id]);
    await svc.runDueSchedules(new Date());
    const ref = safaricom.pushes[0]!.ref;
    await testPool().query(`UPDATE transactions SET created_at = now() - interval '2 minutes' WHERE provider_ref = $1`, [ref]);
    safaricom.failed(ref, "1037");
    await svc.reconcileMobileMoney(new Date());
    expect((await notices()).map((n) => n.template)).toEqual(["giving_schedule_failed"]);
  });

  it("S9 abandoned PayPal and card payments close after 48 h — and a card later reported paid still books", async () => {
    const pp = (await svc.createGivingIntent(user, { fund: "tithe", amount_minor: 2_000, currency: "USD", method: "paypal", idempotency_key: "pp-old-0001" } as never)) as { transaction_id: string };
    const card = (await svc.createGivingIntent(user, { fund: "tithe", amount_minor: 50_000, currency: "KES", method: "card", idempotency_key: "card-old-001" } as never)) as { transaction_id: string };
    await age(pp.transaction_id, 49 * 3600);
    await age(card.transaction_id, 49 * 3600);
    expect(await svc.reconcileMobileMoney(new Date())).toMatchObject({ expired: 2 });
    expect(await status(pp.transaction_id)).toMatchObject({ status: "failed", failure_code: "no_answer" });
    const intentId = (await testPool().query(`SELECT stripe_payment_intent FROM transactions WHERE transaction_id = $1`, [card.transaction_id])).rows[0].stripe_payment_intent;
    await svc.handleWebhook(JSON.stringify({ id: "evt_late", type: "payment_intent.succeeded", data: { object: { id: intentId } } }), "sig");
    expect((await status(card.transaction_id)).status).toBe("succeeded");
  });
});

describe("Cycle 3 — the office sees why, and nothing races into a double booking", () => {
  it("S10 the register and its CSV say why a gift failed and how much fee a member covered", async () => {
    const failed = await give();
    safaricom.failed(failed.provider_ref, "1");
    await svc.handleMobileMoneyCallback("mpesa", cb(failed.provider_ref, 1), "");
    const covered = await give({ amount_minor: 101_300, cover_fee_minor: 1_300 });
    safaricom.paid(covered.provider_ref);
    await svc.handleMobileMoneyCallback("mpesa", cb(covered.provider_ref, 0), "");
    const admin = (await createUser({ congregationId: cong, role: "Admin", email: "office@c3.test" })).user_id;
    const app = createApp({ env: { ...testEnv() } as Env, db: { primary: testPool(), replica: testPool() }, log: pino({ level: "silent" }) });
    const tok = bearer({ sub: admin, role: "Admin", cong });
    const res = await supertest(app).get("/v1/admin/finance/transactions").set("Authorization", tok);
    expect(res.status).toBe(200);
    const byId = new Map((res.body.data as Array<Record<string, unknown>>).map((t) => [t.transaction_id, t]));
    expect(byId.get(failed.transaction_id)).toMatchObject({
      failure: { code: "insufficient_funds", reason: "There wasn't enough in the M-Pesa account." },
      failure_detail: expect.stringContaining("ResultCode 1"),
    });
    expect(byId.get(covered.transaction_id)).toMatchObject({ fee_cover_minor: 1_300, failure: null });
    const csv = await supertest(app).get("/v1/admin/finance/transactions.csv").set("Authorization", tok);
    expect(csv.text.split("\n")[0]).toContain("failure_reason,provider_detail,fee_cover");
    expect(csv.text).toContain("There wasn't enough in the M-Pesa account.");
    expect(csv.text).toContain(",13");
  });

  it("S11 a callback, a poll and the sweeper racing on one prompt book it exactly once", async () => {
    const g = await give();
    safaricom.paid(g.provider_ref);
    await age(g.transaction_id, 120);
    await Promise.all([
      svc.handleMobileMoneyCallback("mpesa", cb(g.provider_ref, 0), ""),
      svc.givingDetail(user, g.transaction_id),
      svc.reconcileMobileMoney(new Date()),
    ]);
    expect((await status(g.transaction_id)).status).toBe("succeeded");
    expect((await testPool().query(`SELECT count(*)::int AS n FROM ledger_entries WHERE transaction_id = $1`, [g.transaction_id])).rows[0].n).toBe(2);
  });

  it("S12 sixty members polling at once: each prompt resolved once, Safaricom asked once each, no deadlock", async () => {
    const ids: string[] = [];
    const members: string[] = [];
    for (let i = 0; i < 60; i += 1) {
      const m = (await createUser({ congregationId: cong, phone: `07${String(40_000_000 + i)}` })).user_id;
      members.push(m);
      const g = (await svc.createGivingIntent(m, { fund: "tithe", amount_minor: 10_000, currency: "KES", method: "mpesa", idempotency_key: `poll-${i}-xxxx` } as never)) as { transaction_id: string; provider_ref: string };
      ids.push(g.transaction_id);
      if (i % 2 === 0) safaricom.paid(g.provider_ref); else safaricom.failed(g.provider_ref, "1032");
    }
    await testPool().query(`UPDATE transactions SET created_at = now() - interval '30 seconds'`);
    const t0 = Date.now();
    await Promise.all(ids.map((id, i) => svc.givingDetail(members[i]!, id)));
    expect(Date.now() - t0).toBeLessThan(30_000);
    expect(safaricom.queries).toBe(60);
    const rows = (await testPool().query(`SELECT status::text AS status, count(*)::int AS n FROM transactions GROUP BY 1 ORDER BY 1`)).rows;
    expect(rows, JSON.stringify(rows)).toEqual([{ status: "failed", n: 30 }, { status: "succeeded", n: 30 }]);
    expect((await testPool().query(`SELECT count(*)::int AS n FROM ledger_entries`)).rows[0].n).toBe(60);
  }, 60_000);
});
