// Giving — Cycle 5 of 10 (owner request 2026-09-28): partnership. A schedule
// that pays a pledge is the pledge's collector: it asks for what the pledge
// still owes, skips a month already paid, stops with the pledge, and starts
// when both apps promise ("from the next cycle, on the due day"). Around it:
// money counted in the currency it was pledged in, claims the office can
// check, one reminder voice per payment, a remaining figure that foots, and an
// invitation that never asks a partner or a sleeping member.
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
import { allocateInstalments, firstDueAfter, nairobiDate, pledgedInYear, statementSummary } from "../src/modules/financial/partnerStatementMath.js";
import { invitationFor } from "../src/modules/financial/invitation.js";
import { NotificationService } from "../src/modules/notifications/service.js";
import { DepartmentsService, needRaisedMinor } from "../src/modules/departments/service.js";
import type { PaymentGateway, WebhookEvent } from "../src/modules/financial/gateway.js";
import type { Env } from "../src/config/env.js";

class FakeGateway implements PaymentGateway {
  async createIntent(): Promise<{ id: string; client_secret: string }> { return { id: `pi_${Math.random()}`, client_secret: "cs" }; }
  verifyWebhook(rawBody: Buffer | string): WebhookEvent { return JSON.parse(String(rawBody)) as WebhookEvent; }
}
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
class Safaricom {
  readonly results = new Map<string, string>();
  readonly pushes: Array<{ phone: string; ref: string; amount: number }> = [];
  private n = 0;
  readonly fetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    if (u.includes("/oauth/v1/generate")) return json(200, { access_token: "tok", expires_in: "3599" });
    if (u.includes("/stkpush/v1/processrequest")) {
      const body = JSON.parse(String(init?.body)) as { PhoneNumber: string; Amount: number };
      this.n += 1;
      const ref = `ws_CO_${this.n}`;
      this.pushes.push({ phone: body.PhoneNumber, ref, amount: body.Amount });
      return json(200, { CheckoutRequestID: ref, ResponseCode: "0" });
    }
    if (u.includes("/stkpushquery/v1/query")) {
      const body = JSON.parse(String(init?.body)) as { CheckoutRequestID: string };
      const code = this.results.get(body.CheckoutRequestID);
      if (code === undefined) return json(500, { errorCode: "500.001.1001", errorMessage: "processing" });
      return json(200, { ResponseCode: "0", ResultCode: code, ResultDesc: "x" });
    }
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;
}
const cb = (ref: string, code: number) => JSON.stringify({ Body: { stkCallback: { CheckoutRequestID: ref, ResultCode: code, ResultDesc: "x" } } });
const q = (sql: string, params: unknown[] = []) => testPool().query(sql, params);

let cong: string, user: string;
let safaricom: Safaricom, svc: FinancialService, partners: PartnersService, notifications: NotificationService;
beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  user = (await createUser({ congregationId: cong, phone: "0711222333" })).user_id;
  safaricom = new Safaricom();
  const daraja = new DarajaMpesaProvider(
    { consumerKey: "k", consumerSecret: "s", passkey: "p", shortcode: "4043755", env: "sandbox", txType: "CustomerPayBillOnline", callbackUrl: "https://example.org/cb" },
    safaricom.fetch,
  );
  svc = new FinancialService(testPool(), new FakeGateway(), { mpesa: daraja, airtel: new FakeMobileMoneyProvider("airtel") });
  partners = new PartnersService(testPool(), svc);
  notifications = new NotificationService(testPool());
});
afterAll(async () => { await closeTestPool(); });

// The scenario calendar: a cycle on 5 October 2026 at 09:00 in Nairobi.
const CYCLE = "2026-10-05T06:00:00Z";
const AFTER = new Date("2026-10-05T06:01:00Z");

/** A monthly pledge collected automatically, placed on the scenario calendar. */
async function boundMonthly(o: { who?: string; amount?: number; dueDay?: number; created?: string; startsOn?: string | null; untilOn?: string | null; nextRun?: string }) {
  const who = o.who ?? user;
  const amount = o.amount ?? 500_000;
  const p = await partners.createPledge(who, { shape: "monthly", amount_minor: amount, currency: "KES", due_day: o.dueDay ?? 5, reminders_enabled: true, auto_schedule: { method: "mpesa", frequency: "monthly" } } as never);
  await q(`UPDATE pledges SET created_at = $2, starts_on = $3, until_on = $4 WHERE pledge_id = $1`, [p.pledge_id, o.created ?? "2026-09-01T09:00:00Z", o.startsOn === undefined ? "2026-10-05" : o.startsOn, o.untilOn ?? null]);
  await q(`UPDATE giving_schedules SET next_run_at = $2, anchor_day = $3 WHERE schedule_id = $1`, [p.schedule_id, o.nextRun ?? CYCLE, o.dueDay ?? 5]);
  return { pledgeId: String(p.pledge_id), scheduleId: String(p.schedule_id) };
}
/** Money the pledge already received (Pay now, a confirmed claim). */
async function paid(pledgeId: string, amount: number, at: string, currency = "KES", who = user): Promise<void> {
  await q(
    `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, idempotency_key, pledge_id, created_at, settled_at)
     VALUES ($1, (SELECT fund_id FROM funds WHERE code = 'tithe'), $2, $3, 'succeeded', 'manual', $4, $5, $6, $6)`,
    [who, amount, currency, `paid-${Math.random()}`, pledgeId, at],
  );
}
const schedule = async (id: string) =>
  (await q(`SELECT status::text AS status, pause_reason, next_run_at, amount_minor::int AS amount, anchor_day, consecutive_failures FROM giving_schedules WHERE schedule_id = $1`, [id])).rows[0];
const notices = async (template?: string) =>
  ((await q(`SELECT template, payload FROM notifications WHERE user_id = $1 ORDER BY scheduled_for`, [user])).rows as Array<{ template: string; payload: Record<string, unknown> }>)
    .filter((n) => !template || n.template === template);

describe("Cycle 5 — the collector starts when the apps promise", () => {
  it("S1 a pledge made on its own due day, collected automatically, starts next cycle: on track tomorrow, no overdue nudge, collected on the due day", async () => {
    const today = nairobiDate(new Date());
    const dueDay = Math.min(Number(today.slice(8, 10)), 28);
    const p = await partners.createPledge(user, { shape: "monthly", amount_minor: 300_000, currency: "KES", due_day: dueDay, reminders_enabled: true, auto_schedule: { method: "mpesa", frequency: "monthly" } } as never);
    const start = firstDueAfter(today, dueDay);
    expect(start > today).toBe(true);
    expect(p.starts_on).toBe(start);
    const s = await schedule(String(p.schedule_id));
    expect(s.anchor_day).toBe(dueDay);
    expect(nairobiDate(new Date(s.next_run_at))).toBe(start);
    // Tomorrow: nothing is due before the first collection, so nothing is behind.
    const tomorrow = new Date(Date.now() + 86_400_000);
    const detail = await partners.getPledge(user, String(p.pledge_id));
    expect((detail.progress as { label: string; next_due: string }).label).toBe("on_track");
    expect((detail.progress as { next_due: string }).next_due).toBe(start);
    expect((await partners.sendDueReminders(notifications, tomorrow)).follow_ups).toBe(0);
    // A due day later than today: the first collection is that day, not a month on.
    const other = dueDay === 5 ? 6 : 5;
    const p2 = await partners.createPledge(user, { shape: "monthly", amount_minor: 200_000, currency: "KES", due_day: other, reminders_enabled: true, auto_schedule: { method: "mpesa", frequency: "monthly" } } as never);
    const s2 = await schedule(String(p2.schedule_id));
    expect(s2.anchor_day).toBe(other);
    expect(nairobiDate(new Date(s2.next_run_at))).toBe(firstDueAfter(today, other));
  });

  it("S2 a refused collection refuses the pledge BEFORE anything is written — no half pledge, no duplicate on retry", async () => {
    await q(`UPDATE users SET phone_number = '+254200000000' WHERE user_id = $1`, [user]);
    await expect(partners.createPledge(user, { shape: "monthly", amount_minor: 300_000, currency: "KES", due_day: 5, reminders_enabled: true, auto_schedule: { method: "mpesa", frequency: "monthly" } } as never))
      .rejects.toMatchObject({ code: "PHONE_REQUIRED" });
    await q(`UPDATE users SET phone_number = '0711222333' WHERE user_id = $1`, [user]);
    await expect(partners.createPledge(user, { shape: "monthly", amount_minor: 30_000_000, currency: "KES", due_day: 5, reminders_enabled: true, auto_schedule: { method: "mpesa", frequency: "monthly" } } as never))
      .rejects.toMatchObject({ code: "AMOUNT_OUT_OF_RANGE" });
    expect((await q(`SELECT count(*)::int AS n FROM pledges`)).rows[0].n).toBe(0);
    expect((await q(`SELECT count(*)::int AS n FROM giving_schedules`)).rows[0].n).toBe(0);
  });

  it("S3 the wire refuses weekly collection of a monthly pledge and automatic collection of a total one", async () => {
    const app = createApp({ env: { ...testEnv(), MPESA_CALLBACK_SECRET: "test-mm-secret" } as Env, db: { primary: testPool(), replica: testPool() }, log: pino({ level: "silent" }) });
    const auth = bearer({ sub: user, role: "Student", cong });
    const weekly = await supertest(app).post("/v1/giving/pledges").set("Authorization", auth)
      .send({ shape: "monthly", amount_minor: 300_000, currency: "KES", due_day: 5, auto_schedule: { method: "mpesa", frequency: "weekly" } });
    expect(weekly.status).toBe(400);
    expect(weekly.body.error.code).toBe("VALIDATION_FAILED");
    const total = await supertest(app).post("/v1/giving/pledges").set("Authorization", auth)
      .send({ shape: "total", target_minor: 3_000_000, currency: "KES", due_on: "2026-12-31", auto_schedule: { method: "mpesa" } });
    expect(total.status).toBe(400);
    expect(total.body.error.code).toBe("VALIDATION_FAILED");
    expect((await q(`SELECT count(*)::int AS n FROM pledges`)).rows[0].n).toBe(0);
  });

  it("S4 a double tap — even two at once — is one pledge and one collector", async () => {
    const body = { shape: "monthly", amount_minor: 300_000, currency: "KES", due_day: 7, reminders_enabled: true, auto_schedule: { method: "mpesa", frequency: "monthly" } } as never;
    const [a, b] = await Promise.all([partners.createPledge(user, body), partners.createPledge(user, body)]);
    expect(a.pledge_id).toBe(b.pledge_id);
    expect([a.reused, b.reused].filter(Boolean)).toHaveLength(1);
    const again = await partners.createPledge(user, body);
    expect(again).toMatchObject({ pledge_id: a.pledge_id, reused: true });
    expect((await q(`SELECT count(*)::int AS n FROM pledges`)).rows[0].n).toBe(1);
    expect((await q(`SELECT count(*)::int AS n FROM giving_schedules`)).rows[0].n).toBe(1);
  });
});

describe("Cycle 5 — the collector asks what the pledge still owes", () => {
  it("S5 already paid by hand: the cycle is skipped, the member is told, strikes clear, the next month is still asked", async () => {
    const { pledgeId, scheduleId } = await boundMonthly({});
    await paid(pledgeId, 500_000, "2026-10-01T09:00:00Z");
    await q(`UPDATE giving_schedules SET consecutive_failures = 2 WHERE schedule_id = $1`, [scheduleId]);
    const r = await svc.runDueSchedules(AFTER);
    expect(r).toMatchObject({ run: 0, skipped: 1 });
    expect(safaricom.pushes).toHaveLength(0);
    const s = await schedule(scheduleId);
    expect(new Date(s.next_run_at).toISOString()).toBe("2026-11-05T06:00:00.000Z");
    expect(s.consecutive_failures).toBe(0);
    const [covered] = await notices("giving_schedule_covered");
    expect(covered?.payload).toMatchObject({ covered_through: "2026-10-05", title: "General partnership" });
    // November is asked in full.
    await svc.runDueSchedules(new Date("2026-11-05T06:01:00Z"));
    expect(safaricom.pushes.map((x) => x.amount)).toEqual([5000]);
  });

  it("S6 part-paid: the heads-up and the prompt both ask only the rest", async () => {
    const { pledgeId, scheduleId } = await boundMonthly({});
    await paid(pledgeId, 200_000, "2026-10-01T09:00:00Z");
    await svc.runDueSchedules(new Date("2026-10-05T05:50:00Z"));
    const [heads] = await notices("giving_schedule_heads_up");
    expect(heads?.payload).toMatchObject({ amount_minor: 300_000, partial: true, pledge_title: "General partnership" });
    await svc.runDueSchedules(AFTER);
    expect(safaricom.pushes.map((x) => x.amount)).toEqual([3000]);
    const t = (await q(`SELECT amount_minor::int AS amount, pledge_id, schedule_cycle_at FROM transactions WHERE schedule_id = $1`, [scheduleId])).rows[0];
    expect(t).toMatchObject({ amount: 300_000, pledge_id: pledgeId });
    expect(new Date(t.schedule_cycle_at).toISOString()).toBe(new Date(CYCLE).toISOString());
  });

  it("S7 arrears never raise the prompt above what the member agreed to", async () => {
    await boundMonthly({ created: "2026-08-20T09:00:00Z", startsOn: "2026-09-05" }); // September missed
    await svc.runDueSchedules(AFTER);
    expect(safaricom.pushes.map((x) => x.amount)).toEqual([5000]); // not 10,000
  });

  it("S8 a total pledge: the last prompt asks only the rest, and reaching the target fulfils it and stops the collector — one thank-you", async () => {
    const p = await partners.createPledge(user, { shape: "total", target_minor: 1_000_000, currency: "KES", due_on: "2026-12-31", reminders_enabled: true } as never);
    const s = await svc.createSchedule(user, { fund: "tithe", amount_minor: 500_000, currency: "KES", frequency: "monthly", method: "mpesa", pledge_id: String(p.pledge_id) } as never);
    const scheduleId = String(s.schedule_id);
    await q(`UPDATE giving_schedules SET next_run_at = $2, anchor_day = 5 WHERE schedule_id = $1`, [scheduleId, CYCLE]);
    await paid(String(p.pledge_id), 800_000, "2026-09-10T09:00:00Z");
    await svc.runDueSchedules(AFTER);
    expect(safaricom.pushes.map((x) => x.amount)).toEqual([2000]);
    const ref = safaricom.pushes[0]!.ref;
    safaricom.results.set(ref, "0");
    await svc.handleMobileMoneyCallback("mpesa", cb(ref, 0), "");
    // November: the target is met — no prompt; fulfilled, stopped, thanked once.
    await svc.runDueSchedules(new Date("2026-11-05T06:01:00Z"));
    expect(safaricom.pushes).toHaveLength(1);
    expect((await q(`SELECT status::text AS status FROM pledges WHERE pledge_id = $1`, [p.pledge_id])).rows[0].status).toBe("fulfilled");
    expect((await schedule(scheduleId)).status).toBe("cancelled");
    const thanks = await notices("pledge_fulfilled");
    expect(thanks.length).toBeGreaterThan(0);
    expect(thanks.every((n) => n.payload.schedule_stopped === true)).toBe(true);
    expect(await partners.fulfilCompleted(notifications)).toBe(0);
  });

  it("S9 a monthly pledge past its end stops its collector with a notice; its instalments end there on the statement too", async () => {
    const { scheduleId } = await boundMonthly({ created: "2026-08-01T09:00:00Z", startsOn: null, untilOn: "2026-10-31", nextRun: "2026-11-05T06:00:00Z" });
    await svc.runDueSchedules(new Date("2026-11-05T06:01:00Z"));
    expect(safaricom.pushes).toHaveLength(0);
    expect((await schedule(scheduleId)).status).toBe("cancelled");
    const [stopped] = await notices("giving_schedule_stopped");
    expect(stopped?.payload).toMatchObject({ reason: "pledge_ended", until_on: "2026-10-31" });
    // The pure rule: August, September, October — nothing pledged or missed after the end.
    const pledge = { pledge_id: "x", shape: "monthly" as const, amount_minor: 100, target_minor: null, status: "active" as const, due_day: 5, due_on: null, created_at: "2026-08-01", until_on: "2026-10-31" };
    expect(pledgedInYear(pledge, 2026)).toBe(300);
    expect(allocateInstalments(pledge, [], "2026-12-20").map((i) => i.due)).toEqual(["2026-08-05", "2026-09-05", "2026-10-05"]);
  });

  it("S10 older states: a collector still running for a cancelled pledge stops; for a paused pledge it pauses — neither prompts", async () => {
    const cancelled = await boundMonthly({ dueDay: 5 });
    await q(`UPDATE pledges SET status = 'cancelled', cancelled_at = now() WHERE pledge_id = $1`, [cancelled.pledgeId]);
    const other = (await createUser({ congregationId: cong, phone: "0722333444" })).user_id;
    const paused = await boundMonthly({ who: other, dueDay: 5 });
    await q(`UPDATE pledges SET status = 'paused' WHERE pledge_id = $1`, [paused.pledgeId]);
    await svc.runDueSchedules(AFTER);
    expect(safaricom.pushes).toHaveLength(0);
    expect((await schedule(cancelled.scheduleId)).status).toBe("cancelled");
    expect((await notices("giving_schedule_stopped"))[0]?.payload).toMatchObject({ reason: "pledge_cancelled" });
    expect(await schedule(paused.scheduleId)).toMatchObject({ status: "paused", pause_reason: "pledge" });
  });
});

describe("Cycle 5 — money counted in the currency it was pledged in", () => {
  it("S11 a gift, a schedule and a need each refuse another currency; a need's raised figure never adds one", async () => {
    const kes = await partners.createPledge(user, { shape: "total", target_minor: 1_000_000, currency: "KES", due_on: "2026-12-31", reminders_enabled: true } as never);
    await expect(svc.createGivingIntent(user, { fund: "tithe", amount_minor: 5_000, currency: "USD", method: "card", pledge_id: String(kes.pledge_id) } as never))
      .rejects.toMatchObject({ code: "CURRENCY_MISMATCH", details: { expected: "KES" } });
    const usd = await partners.createPledge(user, { shape: "total", target_minor: 50_000, currency: "USD", due_on: "2026-12-31", reminders_enabled: true } as never);
    await expect(svc.createSchedule(user, { fund: "tithe", amount_minor: 100_000, currency: "KES", frequency: "monthly", method: "mpesa", pledge_id: String(usd.pledge_id) } as never))
      .rejects.toMatchObject({ code: "CURRENCY_MISMATCH", details: { expected: "USD" } });
    expect((await q(`SELECT count(*)::int AS n FROM giving_schedules`)).rows[0].n).toBe(0);
    // A department need in KES.
    const admin = (await createUser({ congregationId: cong })).user_id;
    const leader = (await createUser({ congregationId: cong })).user_id;
    const departments = new DepartmentsService(testPool(), notifications);
    const dept = await departments.create(admin, cong, { name: "Building", purpose: "The roof", leader_user_id: leader, gift_keys: [], fund_code: "general", is_open_to_join: true });
    const roof = await departments.submitNeed(leader, String(dept.department_id), { title: "Roof sheets", why: "The rains are coming and the hall leaks.", target_minor: 300_000, currency: "KES" });
    await departments.decideNeed(admin, String(roof.need_id), "approve");
    await expect(svc.createGivingIntent(user, { fund: "tithe", amount_minor: 5_000, currency: "USD", method: "card", need_id: String(roof.need_id) } as never))
      .rejects.toMatchObject({ code: "CURRENCY_MISMATCH" });
    // Money already on the books in another currency is not added to shillings.
    await q(`INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, idempotency_key, need_id) VALUES ($1, (SELECT fund_id FROM funds WHERE code = 'general'), 5000, 'USD', 'succeeded', 'manual', 'usd-need-1', $2)`, [user, roof.need_id]);
    await q(`INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, idempotency_key, need_id) VALUES ($1, (SELECT fund_id FROM funds WHERE code = 'general'), 70000, 'KES', 'succeeded', 'manual', 'kes-need-1', $2)`, [user, roof.need_id]);
    expect(await needRaisedMinor(testPool(), String(roof.need_id))).toBe(70_000);
  });
});

describe("Cycle 5 — claims the office can check", () => {
  it("S12 in the pledge's currency, on a real day, told once, at most five waiting; an older wrong-currency claim is never confirmed", async () => {
    const now = new Date("2026-09-20T09:00:00Z");
    const p = await partners.createPledge(user, { shape: "total", target_minor: 1_000_000, currency: "KES", due_on: "2026-12-31", reminders_enabled: true } as never);
    const id = String(p.pledge_id);
    const claim = (o: Record<string, unknown>) => partners.createClaim(user, id, { amount_minor: 10_000, currency: "KES", paid_on: "2026-09-18", ...o } as never, now);
    await expect(claim({ currency: "USD" })).rejects.toMatchObject({ code: "CURRENCY_MISMATCH", details: { expected: "KES" } });
    await expect(claim({ paid_on: "2026-09-21" })).rejects.toMatchObject({ code: "INVALID_DATE" }); // tomorrow
    await expect(claim({ paid_on: "2025-09-01" })).rejects.toMatchObject({ code: "INVALID_DATE" }); // over a year ago
    await claim({});
    await expect(claim({})).rejects.toMatchObject({ code: "CONFLICT" }); // told twice
    for (const d of ["2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"]) await claim({ paid_on: d });
    await expect(claim({ paid_on: "2026-09-14" })).rejects.toMatchObject({ code: "CONFLICT" }); // a sixth waiting
    // An older claim recorded in another currency: the office can reject it, never confirm it.
    const legacy = (await q(`INSERT INTO pledge_claims (pledge_id, user_id, amount_minor, currency, paid_on) VALUES ($1, $2, 5000, 'USD', '2026-09-01') RETURNING claim_id`, [id, user])).rows[0].claim_id;
    const admin = (await createUser({ congregationId: cong })).user_id;
    await expect(partners.decideClaim(admin, legacy, "confirm", notifications)).rejects.toMatchObject({ code: "CURRENCY_MISMATCH" });
    expect((await partners.decideClaim(admin, legacy, "reject", notifications)).status).toBe("rejected");
  });
});

describe("Cycle 5 — one voice per payment", () => {
  it("S13 a pledge its collector will pay gets no 'due soon'; a collector that just failed gets no overdue nudge on top; pledges without one are reminded", async () => {
    const now = new Date("2026-10-03T06:00:00Z"); // 09:00 Nairobi; due on the 5th is two days away
    const mk = async (dueDay: number, amount: number) => {
      const p = await partners.createPledge(user, { shape: "monthly", amount_minor: amount, currency: "KES", due_day: dueDay, reminders_enabled: true } as never);
      await q(`UPDATE pledges SET created_at = '2026-09-20T09:00:00Z' WHERE pledge_id = $1`, [p.pledge_id]);
      return String(p.pledge_id);
    };
    const bind = async (pledgeId: string, nextRun: string, failedAt: string | null) => {
      const s = await svc.createSchedule(user, { fund: "tithe", amount_minor: 100_000, currency: "KES", frequency: "monthly", method: "mpesa", pledge_id: pledgeId, idempotency_key: `bind-${pledgeId}` } as never);
      await q(`UPDATE giving_schedules SET next_run_at = $2, last_failed_at = $3, consecutive_failures = CASE WHEN $3::timestamptz IS NULL THEN 0 ELSE 1 END WHERE schedule_id = $1`, [s.schedule_id, nextRun, failedAt]);
    };
    const collected = await mk(5, 100_000);
    await bind(collected, "2026-10-05T06:00:00Z", null);
    const manual = await mk(6, 110_000);
    const failing = await mk(1, 120_000); // due 1 Oct; its first nudge was due at noon on the 2nd
    await bind(failing, "2026-11-01T06:00:00Z", "2026-10-02T20:00:00Z"); // failed 10 h ago
    const forgotten = await mk(1, 130_000);
    await partners.sendDueReminders(notifications, now);
    const sent = async (pledgeId: string) => (await q(`SELECT sequence FROM pledge_reminders WHERE pledge_id = $1`, [pledgeId])).rows.map((r) => r.sequence as number);
    expect(await sent(collected)).toEqual([]);
    expect(await sent(manual)).toEqual([0]);
    expect(await sent(failing)).toEqual([]);
    expect(await sent(forgotten)).toEqual([1]);
  });
});

describe("Cycle 5 — the invitation", () => {
  const MID = new Date("2026-09-10T06:00:00Z"); // 09:00 Nairobi
  const campaign = async () =>
    (await q(
      `INSERT INTO campaigns (congregation_id, title, blurb, goal_minor, currency, starts_on, ends_on, status, fund_id)
       VALUES ($1, 'Carry a disciple', 'Forty through Level 1.', 4000000, 'KES', '2026-09-01', '2026-09-30', 'live', (SELECT fund_id FROM funds WHERE code = 'tithe'))
       RETURNING campaign_id`, [cong])).rows[0].campaign_id as string;
  const member = async (phone: string) => {
    const id = (await createUser({ congregationId: cong, phone })).user_id;
    await q(`UPDATE users SET created_at = '2026-06-01T09:00:00Z' WHERE user_id = $1`, [id]);
    return id;
  };

  it("S14 a Partners-programme member is never invited; quiet hours are the member's own; raised is the campaign's own currency and days", async () => {
    await campaign();
    const partner = await member("0733000001");
    await partners.join(partner);
    expect((await invitationFor(testPool(), partner, MID)).reason).toBe("already_partner");

    const guest = await member("0733000002");
    expect((await invitationFor(testPool(), guest, new Date("2026-09-10T19:30:00Z"))).reason).toBe("quiet_hours"); // 22:30 Nairobi
    expect((await invitationFor(testPool(), guest, new Date("2026-09-10T05:00:00Z"))).show).toBe(true); // 08:00 Nairobi

    const gift = (amount: number, currency: string, at: string) =>
      q(`INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, idempotency_key, created_at) VALUES ($1, (SELECT fund_id FROM funds WHERE code = 'tithe'), $2, $3, 'succeeded', 'manual', $4, $5)`, [user, amount, currency, `inv-${Math.random()}`, at]);
    await gift(100_000, "KES", "2026-08-31T22:30:00Z"); // 01:30 on 1 Sep in Nairobi — inside
    await gift(200_000, "KES", "2026-09-15T09:00:00Z"); // inside
    await gift(9_999, "USD", "2026-09-15T09:00:00Z");   // another currency — never added
    await gift(400_000, "KES", "2026-09-30T22:00:00Z"); // 01:00 on 1 Oct in Nairobi — after the end
    await gift(800_000, "KES", "2026-08-31T20:00:00Z"); // 23:00 on 31 Aug in Nairobi — before the start
    const shown = await invitationFor(testPool(), guest, MID);
    expect(shown.campaign?.raised_minor).toBe(300_000);
  });
});

describe("Cycle 5 — a collector follows its pledge", () => {
  it("S15 the pledge's amount and due day flow to its collector; the collector alone can't drift; resuming the pledge resumes only what the pledge paused", async () => {
    const p = await partners.createPledge(user, { shape: "monthly", amount_minor: 500_000, currency: "KES", due_day: 5, reminders_enabled: true, auto_schedule: { method: "mpesa", frequency: "monthly" } } as never);
    const pid = String(p.pledge_id), sid = String(p.schedule_id);
    await partners.updatePledge(user, pid, { amount_minor: 700_000 });
    expect((await schedule(sid)).amount).toBe(700_000);
    await expect(partners.updatePledge(user, pid, { amount_minor: 30_000_000 })).rejects.toMatchObject({ code: "AMOUNT_OUT_OF_RANGE" });
    expect((await q(`SELECT amount_minor::int AS a FROM pledges WHERE pledge_id = $1`, [pid])).rows[0].a).toBe(700_000);
    expect((await schedule(sid)).amount).toBe(700_000);
    await expect(svc.updateSchedule(user, sid, { amount_minor: 900_000 })).rejects.toMatchObject({ code: "UNPROCESSABLE", details: { pledge_id: pid } });
    await expect(svc.updateSchedule(user, sid, { day: 12 })).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    await partners.updatePledge(user, pid, { due_day: 12 });
    const moved = await schedule(sid);
    expect(moved.anchor_day).toBe(12);
    expect(nairobiDate(new Date(moved.next_run_at)).slice(8, 10)).toBe("12");
    // The member pauses the gift themselves; pausing and resuming the pledge leaves that alone.
    await svc.pauseSchedule(user, sid, {});
    await partners.updatePledge(user, pid, { status: "paused" });
    await partners.updatePledge(user, pid, { status: "active" });
    expect(await schedule(sid)).toMatchObject({ status: "paused", pause_reason: "member" });
    // The listing names the pledge and what the next prompt will ask.
    await svc.resumeSchedule(user, sid);
    const listed = ((await svc.listSchedules(user)).data as Array<Record<string, unknown>>).find((r) => r.schedule_id === sid)!;
    expect(listed.pledge).toEqual({ pledge_id: pid, title: "General partnership" });
    expect(listed.next_amount_minor).toBe(700_000);
  });

  it("S16 moving a gift's day never asks twice in a month or a week already given", () => {
    const eat = (s: string) => new Date(`${s}+03:00`);
    // Monthly on the 5th, September given; on 10 Sep the member moves it to the 20th → 20 October, not 20 September.
    expect(FinancialService.nextOnMonthDay(eat("2026-10-05T09:00:00"), 20, eat("2026-09-10T12:00:00")).toISOString()).toBe(eat("2026-10-20T09:00:00").toISOString());
    // …and to the 1st → 1 October (the pending month keeps one prompt).
    expect(FinancialService.nextOnMonthDay(eat("2026-10-05T09:00:00"), 1, eat("2026-09-10T12:00:00")).toISOString()).toBe(eat("2026-10-01T09:00:00").toISOString());
    // Weekly on Friday, given 25 Sep; on Saturday it moves to Sunday → 4 Oct, not 27 Sep.
    expect(FinancialService.nextOnWeekday(eat("2026-10-02T09:00:00"), 0, eat("2026-09-26T12:00:00")).toISOString()).toBe(eat("2026-10-04T09:00:00").toISOString());
    // …to Monday → 28 Sep (the pending week's Monday).
    expect(FinancialService.nextOnWeekday(eat("2026-10-02T09:00:00"), 1, eat("2026-09-26T12:00:00")).toISOString()).toBe(eat("2026-09-28T09:00:00").toISOString());
  });

  it("S17 remaining is owed per pledge and foots with the pledge rows", () => {
    const a = { pledge_id: "a", shape: "monthly" as const, amount_minor: 1_000, target_minor: null, status: "active" as const, due_day: 5, due_on: null, created_at: "2026-01-01" };
    const b = { pledge_id: "b", shape: "total" as const, amount_minor: null, target_minor: 3_000, status: "active" as const, due_day: null, due_on: "2026-11-30", created_at: "2026-01-01" };
    const c = { pledge_id: "c", shape: "total" as const, amount_minor: null, target_minor: 5_000, status: "cancelled" as const, due_day: null, due_on: "2026-11-30", created_at: "2026-01-01" };
    const s = statementSummary(2026, [a, b, c], [
      { pledge_id: "a", amount_minor: 4_000 },
      { pledge_id: "b", amount_minor: 5_000 }, // overpaid by 2,000
      { pledge_id: "c", amount_minor: 1_000 }, // paid, since cancelled
    ]);
    expect(s).toEqual({ pledged_minor: 15_000, paid_minor: 10_000, remaining_minor: 8_000 }); // 12,000 − 4,000 on a; 0 on b; 0 on c
  });
});

describe("Cycle 5 — Try again on a scheduled charge", () => {
  it("S19 the member's retry of a failed scheduled prompt is that cycle's attempt: paid, the strikes and the automatic retry clear; declined, it counts without a push", async () => {
    const s = await svc.createSchedule(user, { fund: "tithe", amount_minor: 50_000, currency: "KES", frequency: "weekly", method: "mpesa" } as never);
    const sid = String(s.schedule_id);
    const cycle = new Date(Date.now() - 60_000).toISOString();
    await q(`UPDATE giving_schedules SET next_run_at = $2 WHERE schedule_id = $1`, [sid, cycle]);
    await svc.runDueSchedules(new Date());
    const first = safaricom.pushes[0]!.ref;
    safaricom.results.set(first, "1037"); // the phone was unreachable
    await svc.handleMobileMoneyCallback("mpesa", cb(first, 1037), "");
    const failedTx = (await q(`SELECT transaction_id FROM transactions WHERE provider_ref = $1`, [first])).rows[0].transaction_id as string;
    expect((await q(`SELECT consecutive_failures, retry_cycle_at FROM giving_schedules WHERE schedule_id = $1`, [sid])).rows[0]).toMatchObject({ consecutive_failures: 1 });

    // Try again, declined while watching: counted, but no second push.
    const tried = await svc.retryGift(user, failedTx, {});
    const t2 = (await q(`SELECT schedule_id, schedule_cycle_at FROM transactions WHERE transaction_id = $1`, [tried.transaction_id])).rows[0];
    expect(t2.schedule_id).toBe(sid);
    expect(new Date(t2.schedule_cycle_at).toISOString()).toBe(new Date(cycle).toISOString());
    const second = safaricom.pushes[1]!.ref;
    safaricom.results.set(second, "1032");
    await svc.handleMobileMoneyCallback("mpesa", cb(second, 1032), "");
    expect((await q(`SELECT consecutive_failures FROM giving_schedules WHERE schedule_id = $1`, [sid])).rows[0].consecutive_failures).toBe(2);
    expect((await notices("giving_schedule_failed"))).toHaveLength(1); // only the first strike's

    // Try again, paid: the schedule is healthy and the automatic retry is off.
    const again = await svc.retryGift(user, String(tried.transaction_id), {});
    const third = safaricom.pushes[2]!.ref;
    safaricom.results.set(third, "0");
    await svc.handleMobileMoneyCallback("mpesa", cb(third, 0), "");
    expect((await q(`SELECT status::text AS status FROM transactions WHERE transaction_id = $1`, [again.transaction_id])).rows[0].status).toBe("succeeded");
    expect((await q(`SELECT consecutive_failures, retry_cycle_at, retry_at FROM giving_schedules WHERE schedule_id = $1`, [sid])).rows[0])
      .toEqual({ consecutive_failures: 0, retry_cycle_at: null, retry_at: null });
  });
});

describe("Cycle 5 — volume", () => {
  it("S18 forty-five collectors due at once: paid ones skipped, part-paid ones asked the rest, the rest asked in full — once each, and a second run asks nothing", async () => {
    const kinds: Array<"covered" | "partial" | "unpaid"> = [];
    for (let i = 0; i < 45; i += 1) {
      const who = (await createUser({ congregationId: cong, phone: `0712${String(i).padStart(6, "0")}` })).user_id;
      const { pledgeId } = await boundMonthly({ who });
      const kind = (["covered", "partial", "unpaid"] as const)[i % 3]!;
      kinds.push(kind);
      if (kind === "covered") await paid(pledgeId, 500_000, "2026-10-02T09:00:00Z", "KES", who);
      if (kind === "partial") await paid(pledgeId, 200_000, "2026-10-02T09:00:00Z", "KES", who);
    }
    const r = await svc.runDueSchedules(AFTER);
    expect(r).toMatchObject({ run: 30, skipped: 15, failed: 0, deferred: 0 });
    expect(safaricom.pushes.filter((x) => x.amount === 3000)).toHaveLength(15);
    expect(safaricom.pushes.filter((x) => x.amount === 5000)).toHaveLength(15);
    expect(new Set(safaricom.pushes.map((x) => x.phone)).size).toBe(30);
    const again = await svc.runDueSchedules(new Date("2026-10-05T06:30:00Z"));
    expect(again).toMatchObject({ run: 0, retried: 0 });
    expect(safaricom.pushes).toHaveLength(30);
  });
});
