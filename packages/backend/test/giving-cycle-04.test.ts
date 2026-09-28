// Giving — Cycle 4 of 10 (owner request 2026-09-28): a recurring gift the
// member controls. "Give now and every week", a heads-up before each prompt,
// pausing on their own terms, changing a gift instead of cancelling it, and a
// resumed pledge that never charges the cycle it skipped.
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
import { nairobiDate } from "../src/modules/financial/partnerStatementMath.js";
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
  down = false;
  private n = 0;
  readonly fetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    if (u.includes("/oauth/v1/generate")) return json(200, { access_token: "tok", expires_in: "3599" });
    if (u.includes("/stkpush/v1/processrequest")) {
      if (this.down) return json(503, { errorMessage: "down" });
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
const EAT = 3 * 3_600_000;
const eatParts = (dt: Date) => { const e = new Date(dt.getTime() + EAT); return { y: e.getUTCFullYear(), m: e.getUTCMonth() + 1, d: e.getUTCDate(), h: e.getUTCHours(), dow: e.getUTCDay() }; };

let cong: string, user: string;
let safaricom: Safaricom, svc: FinancialService;
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
});
afterAll(async () => { await closeTestPool(); });

const weekly = (over: Record<string, unknown> = {}) =>
  svc.createSchedule(user, { fund: "tithe", amount_minor: 50_000, currency: "KES", frequency: "weekly", method: "mpesa", ...over } as never) as Promise<Record<string, unknown>>;
const row = async (id: string) =>
  (await testPool().query(`SELECT status, pause_reason, resume_on::text AS resume_on, consecutive_failures, next_run_at, anchor_day, amount_minor::int AS amount, phone_number, heads_up FROM giving_schedules WHERE schedule_id = $1`, [id])).rows[0];
const notices = async () =>
  (await testPool().query(`SELECT template, payload FROM notifications WHERE user_id = $1 ORDER BY scheduled_for`, [user])).rows as Array<{ template: string; payload: Record<string, unknown> }>;

describe("Cycle 4 — give now and every week", () => {
  it("S1 the first prompt goes out now as the schedule's first cycle; paid, the rhythm starts next week", async () => {
    const s = await weekly({ first_charge: "now" });
    const first = s.first_charge as { transaction_id: string; provider_ref: string; status: string };
    expect(first).toMatchObject({ status: "processing" });
    expect(safaricom.pushes).toHaveLength(1);
    const t = (await testPool().query(`SELECT schedule_id, schedule_cycle_at, idempotency_key FROM transactions WHERE transaction_id = $1`, [first.transaction_id])).rows[0];
    expect(t.schedule_id).toBe(s.schedule_id);
    expect(t.idempotency_key).toBe(`sched:${s.schedule_id}:first`);
    safaricom.results.set(first.provider_ref, "0");
    await svc.handleMobileMoneyCallback("mpesa", cb(first.provider_ref, 0), "");
    const r = await row(String(s.schedule_id));
    expect(r.consecutive_failures).toBe(0);
    expect(new Date(r.next_run_at).getTime() - Date.now()).toBeGreaterThan(6 * 86_400_000);
    // A double tap is the same schedule AND the same prompt.
    const again = await weekly({ first_charge: "now" });
    expect(again.schedule_id).toBe(s.schedule_id);
    expect(safaricom.pushes).toHaveLength(1);
  });

  it("S2 a first prompt the member declines while watching counts, but the screen tells them — no push", async () => {
    const s = await weekly({ first_charge: "now" });
    const ref = (s.first_charge as { provider_ref: string }).provider_ref;
    safaricom.results.set(ref, "1032");
    await svc.handleMobileMoneyCallback("mpesa", cb(ref, 1032), "");
    expect((await row(String(s.schedule_id))).consecutive_failures).toBe(1);
    expect(await notices()).toHaveLength(0);
  });

  it("S3 Safaricom down at set-up: the gift is set up, today's prompt is explained, no strike", async () => {
    safaricom.down = true;
    const s = await weekly({ first_charge: "now" });
    expect(s.first_charge).toBeNull();
    expect(String(s.first_charge_error)).toContain("unavailable");
    expect((await row(String(s.schedule_id)))).toMatchObject({ status: "active", consecutive_failures: 0 });
  });

  it("S4 'give now' while a prompt is already on the phone creates nothing", async () => {
    await svc.createGivingIntent(user, { fund: "tithe", amount_minor: 20_000, currency: "KES", method: "mpesa", idempotency_key: "busy-0001" } as never);
    await expect(weekly({ first_charge: "now" })).rejects.toMatchObject({ code: "GIFT_IN_PROGRESS" });
    expect((await testPool().query(`SELECT count(*)::int AS n FROM giving_schedules`)).rows[0].n).toBe(0);
  });
});

describe("Cycle 4 — the heads-up", () => {
  it("S5 one push minutes before the prompt, never twice (two runners), none when switched off", async () => {
    const on = await weekly();
    const off = await weekly({ amount_minor: 60_000, heads_up: false });
    const soon = new Date(Date.now() + 10 * 60_000).toISOString();
    await testPool().query(`UPDATE giving_schedules SET next_run_at = $1`, [soon]);
    await Promise.all([svc.runDueSchedules(new Date()), svc.runDueSchedules(new Date())]);
    await svc.runDueSchedules(new Date());
    const n = await notices();
    expect(n.map((x) => x.template)).toEqual(["giving_schedule_heads_up"]);
    expect(n[0]!.payload).toMatchObject({ schedule_id: on.schedule_id, amount_minor: 50_000 });
    expect(safaricom.pushes).toHaveLength(0); // the prompt itself waits for its time
    void off;
  });
});

describe("Cycle 4 — pausing on the member's own terms", () => {
  it("S6 paused until a date: no prompts meanwhile; on that date it resumes at its next occurrence, in prompt hours", async () => {
    const s = await weekly();
    const tomorrow = nairobiDate(new Date(Date.now() + 86_400_000));
    const in3 = nairobiDate(new Date(Date.now() + 3 * 86_400_000));
    await expect(svc.pauseSchedule(user, String(s.schedule_id), { resume_on: nairobiDate(new Date()) })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await svc.pauseSchedule(user, String(s.schedule_id), { resume_on: in3 });
    await testPool().query(`UPDATE giving_schedules SET next_run_at = now() - interval '1 hour'`);
    await svc.runDueSchedules(new Date());
    expect(safaricom.pushes).toHaveLength(0);
    expect(await row(String(s.schedule_id))).toMatchObject({ status: "paused", pause_reason: "member", resume_on: in3 });
    const onThatDay = new Date(Date.parse(`${in3}T09:00:00Z`) - EAT); // 09:00 Nairobi on the resume date
    await svc.runDueSchedules(onThatDay);
    const r = await row(String(s.schedule_id));
    expect(r).toMatchObject({ status: "active", pause_reason: null, resume_on: null });
    expect(nairobiDate(new Date(r.next_run_at)) >= in3).toBe(true);
    const h = eatParts(new Date(r.next_run_at)).h;
    expect(h >= 7 && h < 21).toBe(true);
    void tomorrow;
  });

  it("S7 a member's pause with no date holds until they resume; resuming starts clean", async () => {
    const s = await weekly();
    await svc.pauseSchedule(user, String(s.schedule_id), {});
    await testPool().query(`UPDATE giving_schedules SET next_run_at = now() - interval '1 hour'`);
    await svc.runDueSchedules(new Date(Date.now() + 30 * 86_400_000));
    expect(safaricom.pushes).toHaveLength(0);
    await svc.resumeSchedule(user, String(s.schedule_id));
    expect(await row(String(s.schedule_id))).toMatchObject({ status: "active", pause_reason: null });
  });

  it("S8 a gift paused by its pledge follows the pledge — and resuming the pledge never charges the skipped cycle", async () => {
    const partners = new PartnersService(testPool(), svc);
    const pledge = (await partners.createPledge(user, {
      shape: "monthly", amount_minor: 100_000, currency: "KES", due_day: 5, reminders_enabled: true,
      auto_schedule: { method: "mpesa", frequency: "weekly" },
    } as never)) as { pledge_id: string; schedule_id: string };
    const sid = (await testPool().query(`SELECT schedule_id FROM pledges WHERE pledge_id = $1`, [pledge.pledge_id])).rows[0].schedule_id as string;
    await partners.updatePledge(user, pledge.pledge_id, { status: "paused" } as never);
    expect(await row(sid)).toMatchObject({ status: "paused", pause_reason: "pledge" });
    await expect(svc.resumeSchedule(user, sid)).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    // The cycle it skipped is now in the past.
    await testPool().query(`UPDATE giving_schedules SET next_run_at = now() - interval '2 days' WHERE schedule_id = $1`, [sid]);
    await partners.updatePledge(user, pledge.pledge_id, { status: "active" } as never);
    const r = await row(sid);
    expect(r.status).toBe("active");
    expect(new Date(r.next_run_at).getTime()).toBeGreaterThan(Date.now());
    await svc.runDueSchedules(new Date());
    expect(safaricom.pushes).toHaveLength(0); // no surprise charge on resume
  });

  it("S9 three failed prompts pause a gift with the reason 'failures'", async () => {
    const s = await weekly();
    await testPool().query(`UPDATE giving_schedules SET consecutive_failures = 2, next_run_at = now() - interval '1 hour' WHERE schedule_id = $1`, [s.schedule_id]);
    await svc.runDueSchedules(new Date());
    const ref = safaricom.pushes[0]!.ref;
    safaricom.results.set(ref, "1032");
    await svc.handleMobileMoneyCallback("mpesa", cb(ref, 1032), "");
    expect(await row(String(s.schedule_id))).toMatchObject({ status: "paused", pause_reason: "failures" });
  });
});

describe("Cycle 4 — change a gift instead of cancelling it", () => {
  it("S10 a new amount is checked like a new gift and takes effect next cycle; a twin amount is refused", async () => {
    const a = await weekly();
    await weekly({ amount_minor: 70_000 });
    await expect(svc.updateSchedule(user, String(a.schedule_id), { amount_minor: 70_050 })).rejects.toMatchObject({ code: "AMOUNT_OUT_OF_RANGE" });
    await expect(svc.updateSchedule(user, String(a.schedule_id), { amount_minor: 70_000 })).rejects.toMatchObject({ code: "SCHEDULE_EXISTS" });
    const u = await svc.updateSchedule(user, String(a.schedule_id), { amount_minor: 80_000 });
    expect(u).toMatchObject({ amount_minor: 80_000 });
    await testPool().query(`UPDATE giving_schedules SET next_run_at = now() - interval '1 hour' WHERE schedule_id = $1`, [a.schedule_id]);
    await svc.runDueSchedules(new Date());
    expect(safaricom.pushes[0]!.amount).toBe(800);
  });

  it("S11 moving the day: monthly to the 15th, weekly to Friday — the next prompt lands there, in prompt hours", async () => {
    const m = await svc.createSchedule(user, { fund: "offering", amount_minor: 100_000, currency: "KES", frequency: "monthly", method: "mpesa" } as never) as Record<string, unknown>;
    await svc.updateSchedule(user, String(m.schedule_id), { day: 15 });
    const mr = await row(String(m.schedule_id));
    expect(mr.anchor_day).toBe(15);
    expect(eatParts(new Date(mr.next_run_at)).d).toBe(15);
    const w = await weekly();
    await svc.updateSchedule(user, String(w.schedule_id), { day: 5 });
    const wr = await row(String(w.schedule_id));
    expect(eatParts(new Date(wr.next_run_at)).dow).toBe(5);
    expect(new Date(wr.next_run_at).getTime()).toBeGreaterThan(Date.now());
    await expect(svc.updateSchedule(user, String(w.schedule_id), { day: 9 })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("S12 another number for this gift, then back to the profile's; nonsense refused", async () => {
    const s = await weekly();
    await svc.updateSchedule(user, String(s.schedule_id), { phone_number: "0722 000 111" });
    expect((await row(String(s.schedule_id))).phone_number).toBe("+254722000111");
    await expect(svc.updateSchedule(user, String(s.schedule_id), { phone_number: "12" })).rejects.toMatchObject({ code: "PHONE_REQUIRED" });
    await svc.updateSchedule(user, String(s.schedule_id), { phone_number: null });
    expect((await row(String(s.schedule_id))).phone_number).toBeNull();
  });

  it("S13 HTTP: PATCH and pause are the member's own — another member's schedule is a 404", async () => {
    const s = await weekly();
    const other = (await createUser({ congregationId: cong, phone: "0733444555" })).user_id;
    const app = createApp({ env: { ...testEnv(), MPESA_CALLBACK_SECRET: "test-mm-secret" } as Env, db: { primary: testPool(), replica: testPool() }, log: pino({ level: "silent" }) });
    const mine = bearer({ sub: user, role: "Student", cong });
    const theirs = bearer({ sub: other, role: "Student", cong });
    expect((await supertest(app).patch(`/v1/giving/schedules/${s.schedule_id}`).set("Authorization", theirs).send({ heads_up: false })).status).toBe(404);
    expect((await supertest(app).post(`/v1/giving/schedules/${s.schedule_id}/pause`).set("Authorization", theirs).send({})).status).toBe(404);
    const ok = await supertest(app).patch(`/v1/giving/schedules/${s.schedule_id}`).set("Authorization", mine).send({ heads_up: false });
    expect(ok.status).toBe(200);
    expect(ok.body.heads_up).toBe(false);
    const listed = await supertest(app).get("/v1/giving/schedules").set("Authorization", mine);
    expect(listed.body.data[0]).toMatchObject({ heads_up: false, pause_reason: null });
  });

  it("S14 volume: 120 gifts due in the next quarter hour get one heads-up each across overlapping runs", async () => {
    const fund = (await testPool().query(`SELECT fund_id FROM funds WHERE code = 'tithe'`)).rows[0].fund_id as string;
    const soon = new Date(Date.now() + 12 * 60_000).toISOString();
    for (let i = 0; i < 120; i += 1) {
      const m = (await createUser({ congregationId: cong, phone: `07${String(50_000_000 + i)}` })).user_id;
      await testPool().query(
        `INSERT INTO giving_schedules (user_id, fund_id, amount_minor, currency, frequency, method, next_run_at, idempotency_key) VALUES ($1,$2,10000,'KES','weekly','mpesa',$3,$4)`,
        [m, fund, soon, `hu-${i}`],
      );
    }
    await Promise.all([svc.runDueSchedules(new Date()), svc.runDueSchedules(new Date()), svc.runDueSchedules(new Date())]);
    const n = (await testPool().query(`SELECT count(*)::int AS n FROM notifications WHERE template = 'giving_schedule_heads_up'`)).rows[0].n;
    expect(n).toBe(120);
  }, 60_000);
});
