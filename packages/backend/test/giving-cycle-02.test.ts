// Giving — Cycle 2 of 10 (owner request 2026-09-28): honest money on paper and
// on the calendar. Scenario suite: statements and receipts in Nairobi time and
// in each gift's own currency, the fee a member covered, receipts that tell the
// truth about their gift, and monthly gifts that keep their day of the month.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import supertest from "supertest";
import { pino } from "pino";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { testEnv, bearer } from "./helpers/app.js";
import { createApp } from "../src/http/app.js";
import { FinancialService } from "../src/modules/financial/service.js";
import { PartnersService } from "../src/modules/financial/partners.js";
import { FakeMobileMoneyProvider } from "../src/modules/financial/providers.js";
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

let cong: string, user: string;
let mpesa: FakeMobileMoneyProvider, svc: FinancialService;
const EAT = 3 * 3_600_000;
/** An instant given as a Nairobi wall-clock time. */
const eat = (y: number, m: number, d: number, h = 10, mi = 0): Date => new Date(Date.UTC(y, m - 1, d, h, mi) - EAT);
const eatParts = (dt: Date) => {
  const e = new Date(dt.getTime() + EAT);
  return { y: e.getUTCFullYear(), m: e.getUTCMonth() + 1, d: e.getUTCDate(), h: e.getUTCHours(), mi: e.getUTCMinutes() };
};

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  user = (await createUser({ congregationId: cong, fullName: "Amina Wanjiru", phone: "0711222333" })).user_id;
  mpesa = new FakeMobileMoneyProvider("mpesa");
  svc = new FinancialService(testPool(), new FakeGateway(), { mpesa, airtel: new FakeMobileMoneyProvider("airtel") }, new FakePayPalGateway("completed"));
});
afterAll(async () => {
  await closeTestPool();
});

/** A settled M-Pesa gift at a chosen instant (created and settled then). */
async function mpesaGift(amountMinor: number, at: Date, over: Record<string, unknown> = {}): Promise<string> {
  const intent = (await svc.createGivingIntent(user, {
    fund: "tithe", amount_minor: amountMinor, currency: "KES", method: "mpesa", idempotency_key: `g-${Math.random()}`, ...over,
  } as never)) as { transaction_id: string; provider_ref: string };
  const body = JSON.stringify({ event_id: `e-${intent.provider_ref}`, ref: intent.provider_ref, status: "succeeded" });
  await svc.handleMobileMoneyCallback("mpesa", body, mpesa.sign(body));
  await testPool().query(`UPDATE transactions SET created_at = $2, settled_at = $2 WHERE transaction_id = $1`, [intent.transaction_id, at.toISOString()]);
  return intent.transaction_id;
}
async function paypalGift(amountMinorUsd: number, at: Date): Promise<string> {
  const intent = (await svc.createGivingIntent(user, {
    fund: "mission", amount_minor: amountMinorUsd, currency: "USD", method: "paypal", idempotency_key: `p-${Math.random()}`,
  } as never)) as { transaction_id: string; provider_ref: string };
  await svc.capturePayPal(user, intent.provider_ref);
  await testPool().query(`UPDATE transactions SET created_at = $2, settled_at = $2 WHERE transaction_id = $1`, [intent.transaction_id, at.toISOString()]);
  return intent.transaction_id;
}
const text = (pdf: Buffer): string => pdf.toString("latin1");

describe("Cycle 2 — statements and receipts are honest about when, how much and in what", () => {
  it("S1 a gift at 00:30 on 1 January (Nairobi) is dated 1 January at 12:30 AM, and belongs to the new year only", async () => {
    await mpesaGift(50_000, eat(2026, 1, 1, 0, 30));
    const y2026 = text(await svc.statementPdf(user, 2026));
    expect(y2026).toContain("Jan 1, 2026");
    expect(y2026).toContain("12:30 AM");
    expect(y2026).not.toContain("Dec 31");
    expect(text(await svc.statementPdf(user, 2025))).not.toContain("KSh 500");
  });

  it("S2 shillings and dollars on one statement are printed each in its own currency and never added", async () => {
    await mpesaGift(350_000, eat(2026, 3, 2));
    await paypalGift(2_000, eat(2026, 3, 3));
    const pdf = text(await svc.statementPdf(user, 2026));
    expect(pdf).toContain("KSh 3,500 + USD 20.00");
    expect(pdf).toContain("USD 20.00");
    expect(pdf).not.toContain("KSh 20");          // the old bug: USD printed as shillings
    expect(pdf).not.toContain("KSh 3,520");        // …and summed with them
  });

  it("S3 GET /giving/statements totals per currency; total_minor is one currency's, by_fund never mixes", async () => {
    await mpesaGift(350_000, eat(2026, 3, 2));
    await paypalGift(2_000, eat(2026, 3, 3));
    const st = await new PartnersService(testPool(), svc).statements(user, 2026, eat(2026, 9, 20));
    expect(st.totals).toEqual([{ currency: "KES", total_minor: 350_000 }, { currency: "USD", total_minor: 2_000 }]);
    expect(st.total_minor).toBe(350_000);
    expect(st.currency).toBe("KES");
    expect(st.by_fund.map((f) => [f.code, f.currency, f.total_minor]).sort()).toEqual([["mission", "USD", 2_000], ["tithe", "KES", 350_000]]);
  });

  it("S4 a dollar gift's receipt is in dollars, dated in Nairobi time", async () => {
    const id = await paypalGift(2_500, eat(2026, 4, 1, 23, 45));
    const r = text(await svc.receiptPdf(user, id));
    expect(r).toContain("USD 25.00");
    expect(r).not.toContain("KSh");
    expect(r).toContain("Apr 1, 2026");
    expect(r).toContain("11:45 PM");
  });

  it("S5 a covered fee is recorded and shown: gift, fee cover, total — and the books are unchanged", async () => {
    const id = await mpesaGift(101_300, eat(2026, 5, 5), { cover_fee_minor: 1_300 });
    const hist = (await svc.listGiving(user)) as Array<{ transaction_id: string; fee_cover_minor: number | null }>;
    expect(hist.find((h) => h.transaction_id === id)!.fee_cover_minor).toBe(1_300);
    const r = text(await svc.receiptPdf(user, id));
    expect(r).toContain("Gift: KSh 1,000");
    expect(r).toContain("Fee cover: KSh 13 covered by you");
    expect(r).toContain("Total: KSh 1,013");
    const ledger = await testPool().query(`SELECT account, amount_minor::int AS amt FROM ledger_entries WHERE transaction_id = $1 ORDER BY side::text`, [id]);
    expect(ledger.rows).toEqual([{ account: "fund:tithe", amt: 101_300 }, { account: "cash:mpesa", amt: 101_300 }]);
  });

  it("S6 a fee cover must make sense: not above half the gift, whole shillings for M-Pesa, never negative", async () => {
    const base = { fund: "tithe", amount_minor: 100_000, currency: "KES", method: "mpesa" };
    await expect(svc.createGivingIntent(user, { ...base, cover_fee_minor: 60_000, idempotency_key: "f1-xxxx" } as never)).rejects.toMatchObject({ code: "AMOUNT_OUT_OF_RANGE" });
    await expect(svc.createGivingIntent(user, { ...base, cover_fee_minor: 1_350, idempotency_key: "f2-xxxx" } as never)).rejects.toMatchObject({ code: "AMOUNT_OUT_OF_RANGE" });
    const app = createApp({ env: { ...testEnv(), MPESA_CALLBACK_SECRET: "test-mm-secret" } as Env, db: { primary: testPool(), replica: testPool() }, log: pino({ level: "silent" }) });
    const res = await supertest(app).post("/v1/giving/intents").set("Authorization", bearer({ sub: user, role: "Student", cong }))
      .send({ ...base, cover_fee_minor: -100, idempotency_key: "f3-xxxx" });
    expect(res.status).toBe(400);
    expect(mpesa.initiated).toHaveLength(0);
  });

  it("S7 a receipt tells the truth: a failed gift is not 'received with thanks', says why, and is not a receipt", async () => {
    const intent = (await svc.createGivingIntent(user, { fund: "tithe", amount_minor: 20_000, currency: "KES", method: "mpesa", idempotency_key: "fail-xxxx" } as never)) as { transaction_id: string; provider_ref: string };
    const waiting = text(await svc.receiptPdf(user, intent.transaction_id));
    expect(waiting).toContain("Waiting for the payment to clear");
    expect(waiting).not.toContain("Official receipt");
    const body = JSON.stringify({ event_id: "e-fail", ref: intent.provider_ref, status: "failed", result_code: "1032" });
    await svc.handleMobileMoneyCallback("mpesa", body, mpesa.sign(body));
    const failed = text(await svc.receiptPdf(user, intent.transaction_id));
    expect(failed).toContain("This gift did not go through");
    expect(failed).toContain("The M-Pesa prompt was cancelled.");
    expect(failed).toContain("Not a receipt: no money has been received for this gift.");
    expect(failed).not.toContain("Received with thanks");
    expect(failed).not.toContain("Official receipt");
    expect(failed).toContain("GIFT RECORD");
  });
});

describe("Cycle 2 — a monthly gift keeps its day, on the Nairobi calendar, in prompt hours", () => {
  it("S8 the 31st clamps to short months and comes back: 31 Jan → 28 Feb → 31 Mar → 30 Apr; 29 Feb in a leap year", () => {
    let d = eat(2027, 1, 31, 10);
    const seen: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      d = FinancialService.nextRun(d, "monthly", 31);
      const p = eatParts(d);
      seen.push(`${p.y}-${p.m}-${p.d} ${p.h}:00`);
    }
    expect(seen).toEqual(["2027-2-28 10:00", "2027-3-31 10:00", "2027-4-30 10:00", "2027-5-31 10:00"]);
    const leap = eatParts(FinancialService.nextRun(eat(2028, 1, 31, 10), "monthly", 31));
    expect([leap.m, leap.d]).toEqual([2, 29]);
    const dec = eatParts(FinancialService.nextRun(eat(2026, 12, 15, 9), "monthly", 15));
    expect([dec.y, dec.m, dec.d, dec.h]).toEqual([2027, 1, 15, 9]);
  });

  it("S9 a gift set up at 01:00 on the 1st (Nairobi) stays on the 1st — the old UTC arithmetic crept back to the 31st", () => {
    const setUp = eat(2026, 10, 1, 1, 0); // 22:00 UTC on 30 September
    let d = setUp;
    for (let i = 0; i < 6; i += 1) {
      d = FinancialService.nextRun(d, "monthly", 1);
      expect(eatParts(d).d).toBe(1);
    }
    // …and the prompt itself is moved into prompt hours on that same day.
    const prompt = eatParts(FinancialService.sameDayPromptHours(FinancialService.nextRun(setUp, "monthly", 1)));
    expect([prompt.m, prompt.d, prompt.h]).toEqual([11, 1, 7]);
  });

  it("S10 prompts stay inside 07:00–21:00 on their own day (a weekly gift keeps its weekday)", () => {
    const night = eatParts(FinancialService.sameDayPromptHours(eat(2026, 9, 27, 23, 40)));
    expect([night.d, night.h]).toEqual([27, 20]);
    const dawn = eatParts(FinancialService.sameDayPromptHours(eat(2026, 9, 27, 5, 30)));
    expect([dawn.d, dawn.h]).toEqual([27, 7]);
    const noon = FinancialService.sameDayPromptHours(eat(2026, 9, 27, 13, 17));
    expect(eatParts(noon)).toMatchObject({ d: 27, h: 13, mi: 17 });
    // A retry that would land at night waits for the morning.
    expect(eatParts(FinancialService.daytimeEat(eat(2026, 9, 27, 22, 0)))).toMatchObject({ d: 28, h: 7 });
  });

  it("S11 a new monthly gift records today's Nairobi day as its anchor and its first prompt falls in prompt hours", async () => {
    const s = (await svc.createSchedule(user, { fund: "tithe", amount_minor: 100_000, currency: "KES", frequency: "monthly", method: "mpesa" } as never)) as { schedule_id: string };
    const row = (await testPool().query(`SELECT anchor_day, next_run_at FROM giving_schedules WHERE schedule_id = $1`, [s.schedule_id])).rows[0];
    expect(row.anchor_day).toBe(FinancialService.eatDay(new Date()));
    const h = eatParts(new Date(row.next_run_at)).h;
    expect(h).toBeGreaterThanOrEqual(7);
    expect(h).toBeLessThan(21);
  });

  it("S12 the scheduler moves a monthly gift on by its anchor across February", async () => {
    const s = (await svc.createSchedule(user, { fund: "tithe", amount_minor: 100_000, currency: "KES", frequency: "monthly", method: "mpesa" } as never)) as { schedule_id: string };
    await testPool().query(`UPDATE giving_schedules SET anchor_day = 31, next_run_at = $2 WHERE schedule_id = $1`, [s.schedule_id, eat(2027, 1, 31, 10).toISOString()]);
    await svc.runDueSchedules(eat(2027, 1, 31, 10, 5));
    let row = (await testPool().query(`SELECT next_run_at FROM giving_schedules WHERE schedule_id = $1`, [s.schedule_id])).rows[0];
    expect(eatParts(new Date(row.next_run_at))).toMatchObject({ m: 2, d: 28, h: 10 });
    // The February prompt goes out and March lands back on the 31st.
    await testPool().query(`UPDATE transactions SET status = 'failed'`);
    await svc.runDueSchedules(eat(2027, 2, 28, 10, 5));
    row = (await testPool().query(`SELECT next_run_at FROM giving_schedules WHERE schedule_id = $1`, [s.schedule_id])).rows[0];
    expect(eatParts(new Date(row.next_run_at))).toMatchObject({ m: 3, d: 31, h: 10 });
  });

  it("S13 a schedule far behind rolls forward to its own day, not a drifted one", () => {
    const rolled = FinancialService.rollForward(eat(2026, 1, 31, 10), "monthly", eat(2026, 5, 15, 12), 31);
    expect(eatParts(rolled)).toMatchObject({ y: 2026, m: 5, d: 31, h: 10 });
  });

  it("S14 resuming a paused monthly gift re-anchors it to today, in prompt hours", async () => {
    const s = (await svc.createSchedule(user, { fund: "tithe", amount_minor: 100_000, currency: "KES", frequency: "monthly", method: "mpesa" } as never)) as { schedule_id: string };
    await testPool().query(`UPDATE giving_schedules SET status = 'paused', paused_at = now(), anchor_day = 3 WHERE schedule_id = $1`, [s.schedule_id]);
    await svc.resumeSchedule(user, s.schedule_id);
    const row = (await testPool().query(`SELECT anchor_day, next_run_at FROM giving_schedules WHERE schedule_id = $1`, [s.schedule_id])).rows[0];
    expect(row.anchor_day).toBe(FinancialService.eatDay(new Date()));
    const h = eatParts(new Date(row.next_run_at)).h;
    expect(h >= 7 && h < 21).toBe(true);
  });

  it("S15 a member can ask for one year's giving statement PDF; a nonsense year is refused", async () => {
    await mpesaGift(50_000, eat(2025, 6, 1));
    await mpesaGift(70_000, eat(2026, 6, 1));
    const app = createApp({ env: { ...testEnv(), MPESA_CALLBACK_SECRET: "test-mm-secret" } as Env, db: { primary: testPool(), replica: testPool() }, log: pino({ level: "silent" }) });
    const tok = bearer({ sub: user, role: "Student", cong });
    const y = await supertest(app).get("/v1/giving/statement.pdf?year=2026").set("Authorization", tok).buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on("data", (c: Buffer) => b.push(c)); res.on("end", () => cb(null, Buffer.concat(b))); });
    expect(y.status).toBe(200);
    expect(y.headers["content-disposition"]).toContain("2026");
    const t = (y.body as Buffer).toString("latin1");
    expect(t).toContain("KSh 700");
    expect(t).not.toContain("KSh 500");
    expect((await supertest(app).get("/v1/giving/statement.pdf?year=abc").set("Authorization", tok)).status).toBe(400);
  });

  it("S16 volume: 200 monthly gifts anchored 28–31, all due on 28 Feb, each lands on its own day in March", async () => {
    const fund = (await testPool().query(`SELECT fund_id FROM funds WHERE code = 'tithe'`)).rows[0].fund_id as string;
    const values: string[] = [];
    const params: unknown[] = [];
    for (let i = 0; i < 200; i += 1) {
      const m = (await createUser({ congregationId: cong, phone: `07${String(30_000_000 + i)}` })).user_id;
      const anchor = 28 + (i % 4);
      params.push(m, fund, anchor, eat(2027, 2, 28, 9).toISOString());
      const n = params.length;
      values.push(`($${n - 3}, $${n - 2}, 10000, 'KES', 'monthly', 'mpesa', $${n}, 'vol-${i}', $${n - 1})`);
    }
    await testPool().query(
      `INSERT INTO giving_schedules (user_id, fund_id, amount_minor, currency, frequency, method, next_run_at, idempotency_key, anchor_day) VALUES ${values.join(",")}`,
      params,
    );
    const res = await svc.runDueSchedules(eat(2027, 2, 28, 9, 5));
    expect(res).toMatchObject({ run: 200, deferred: 0, failed: 0 });
    const days = (await testPool().query(
      `SELECT anchor_day, EXTRACT(DAY FROM next_run_at AT TIME ZONE 'Africa/Nairobi')::int AS d, count(*)::int AS n
         FROM giving_schedules GROUP BY 1, 2 ORDER BY 1`,
    )).rows;
    expect(days).toEqual([
      { anchor_day: 28, d: 28, n: 50 }, { anchor_day: 29, d: 29, n: 50 },
      { anchor_day: 30, d: 30, n: 50 }, { anchor_day: 31, d: 31, n: 50 },
    ]);
  }, 120_000);
});
