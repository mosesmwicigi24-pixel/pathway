// Giving — Cycle 7 of 10 (owner request 2026-09-28): the office sees the
// truth and can act on it. Finance → Recurring gifts says in words why a gift
// is failing, flags what only the office can know (our own outage), stops
// counting a member's own pause as a failure, names the pledge a gift
// collects and what its next prompt will ask; and the office can pause,
// resume or cancel a gift when a member asks — with a reason, an audit trail
// naming who, and the member told.
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
import { NotificationService } from "../src/modules/notifications/service.js";
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
  unconfigured = false;
  private n = 0;
  readonly fetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    if (u.includes("/oauth/v1/generate")) return this.unconfigured ? json(401, { errorMessage: "bad credentials" }) : json(200, { access_token: "tok", expires_in: "3599" });
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

let cong: string, user: string, officer: string;
let safaricom: Safaricom, svc: FinancialService, partners: PartnersService;
beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  user = (await createUser({ congregationId: cong, phone: "0711222333", fullName: "Amina Wanjiru" })).user_id;
  officer = (await createUser({ congregationId: cong, role: "Instructor", email: "officer@dev.local", fullName: "Finance Officer" })).user_id;
  await q(`INSERT INTO rbac_user_roles (user_id, role_key) VALUES ($1, 'finance_officer') ON CONFLICT DO NOTHING`, [officer]);
  safaricom = new Safaricom();
  const daraja = new DarajaMpesaProvider(
    { consumerKey: "k", consumerSecret: "s", passkey: "p", shortcode: "4043755", env: "sandbox", txType: "CustomerPayBillOnline", callbackUrl: "https://example.org/cb" },
    safaricom.fetch,
  );
  svc = new FinancialService(testPool(), new FakeGateway(), { mpesa: daraja, airtel: new FakeMobileMoneyProvider("airtel") });
  partners = new PartnersService(testPool(), svc);
});
afterAll(async () => { await closeTestPool(); });

const weekly = async (who = user, amount = 50_000) =>
  String((await svc.createSchedule(who, { fund: "tithe", amount_minor: amount, currency: "KES", frequency: "weekly", method: "mpesa" } as never)).schedule_id);
const set = (id: string, sql: string, params: unknown[] = []) => q(`UPDATE giving_schedules SET ${sql} WHERE schedule_id = $1`, [id, ...params]);
const register = async (opts: Record<string, unknown> = {}) =>
  (await svc.listSchedulesAdmin(opts as never)).data as Array<Record<string, unknown>>;
const app = () => createApp({ env: { ...testEnv(), MPESA_CALLBACK_SECRET: "test-mm-secret" } as Env, db: { primary: testPool(), replica: testPool() }, log: pino({ level: "silent" }) });
const asOfficer = () => bearer({ sub: officer, role: "Instructor", cong });

describe("Cycle 7 — what needs the office", () => {
  it("S1 attention is failing, stopped-after-failures, or our own outage — never a member's own pause or a pledge's", async () => {
    const members = await Promise.all(["0722000001", "0722000002", "0722000003", "0722000004", "0722000005", "0722000006", "0722000007"]
      .map(async (phone, i) => (await createUser({ congregationId: cong, phone, fullName: `Member ${i}` })).user_id));
    const healthy = await weekly(members[0]);
    const failing = await weekly(members[1]);
    await set(failing, `consecutive_failures = 1, last_failure_code = 'insufficient_funds', last_error = 'x', last_failed_at = now()`);
    const stopped = await weekly(members[2]);
    await set(stopped, `status = 'paused', pause_reason = 'failures', paused_at = now(), consecutive_failures = 3, last_failure_code = 'cancelled'`);
    const mine = await weekly(members[3]);
    await set(mine, `status = 'paused', pause_reason = 'member', paused_at = now(), resume_on = (now() + interval '10 days')::date`);
    const withPledge = await weekly(members[4]);
    await set(withPledge, `status = 'paused', pause_reason = 'pledge', paused_at = now()`);
    const ours = await weekly(members[5]);
    await set(ours, `last_error = 'mpesa payments are not configured', last_failure_code = NULL, last_failed_at = now() - interval '1 hour'`);
    const oldOurs = await weekly(members[6]);
    await set(oldOurs, `last_error = 'mpesa payments are not configured', last_failure_code = NULL, last_failed_at = now() - interval '2 days'`);

    const attention = await register({ attention: true });
    expect(new Set(attention.map((r) => r.schedule_id))).toEqual(new Set([failing, stopped, ours]));
    const all = await register();
    const byId = new Map(all.map((r) => [r.schedule_id, r]));
    expect(all.slice(0, 3).every((r) => r.needs_attention)).toBe(true); // attention first
    expect(byId.get(healthy)).toMatchObject({ needs_attention: false, last_failure: null, office_alert: null });
    expect(byId.get(failing)).toMatchObject({ needs_attention: true, last_failure: { reason: expect.stringMatching(/money|enough|funds/i) } });
    expect(byId.get(mine)).toMatchObject({ needs_attention: false, pause_reason: "member" });
    expect(byId.get(withPledge)).toMatchObject({ needs_attention: false, pause_reason: "pledge" });
    expect(String(byId.get(ours)!.office_alert)).toContain("The giver has not been told");
    expect(byId.get(oldOurs)).toMatchObject({ needs_attention: false, office_alert: null });
  });

  it("S2 the Overview's alert counts exactly what the register flags", async () => {
    const a = await weekly();
    await set(a, `consecutive_failures = 2, last_failure_code = 'cancelled'`);
    const other = (await createUser({ congregationId: cong, phone: "0733000001" })).user_id;
    const b = await weekly(other);
    await set(b, `status = 'paused', pause_reason = 'member', paused_at = now()`);
    const res = await supertest(app()).get("/v1/admin/finance/overview").set("Authorization", asOfficer());
    expect(res.status).toBe(200);
    const alert = (res.body.alerts as Array<{ kind: string; count: number }>).find((x) => x.kind === "failing_schedules");
    expect(alert?.count).toBe((await register({ attention: true })).length);
    expect(alert?.count).toBe(1);
  });

  it("S3 a gift that collects a pledge names it and says what the next prompt will ask", async () => {
    const p = await partners.createPledge(user, { shape: "total", target_minor: 800_000, currency: "KES", due_on: "2026-12-31", reminders_enabled: true } as never);
    const s = String((await svc.createSchedule(user, { fund: "tithe", amount_minor: 500_000, currency: "KES", frequency: "monthly", method: "mpesa", pledge_id: String(p.pledge_id) } as never)).schedule_id);
    await q(`INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, idempotency_key, pledge_id, settled_at) VALUES ($1, (SELECT fund_id FROM funds WHERE code = 'tithe'), 500000, 'KES', 'succeeded', 'manual', 'c7-paid-1', $2, now())`, [user, p.pledge_id]);
    const row = (await register()).find((r) => r.schedule_id === s)!;
    expect(row.pledge).toEqual({ pledge_id: p.pledge_id, title: "General partnership" });
    expect(row.next_amount_minor).toBe(300_000);
  });

  it("S4 our own outage: the office sees it, the giver is not told, and it clears once a prompt goes through", async () => {
    const s = await weekly();
    await set(s, `next_run_at = now() - interval '1 minute'`);
    safaricom.unconfigured = true;
    await svc.runDueSchedules(new Date());
    const flagged = (await register({ attention: true })).find((r) => r.schedule_id === s);
    expect(String(flagged?.office_alert)).toContain("couldn't send the last prompt");
    expect((await q(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1`, [user])).rows[0].n).toBe(0);
    safaricom.unconfigured = false;
    await set(s, `retry_after = NULL`);
    await svc.runDueSchedules(new Date());
    const ref = safaricom.pushes[0]!.ref;
    safaricom.results.set(ref, "0");
    await svc.handleMobileMoneyCallback("mpesa", cb(ref, 0), "");
    expect((await register({ attention: true })).find((r) => r.schedule_id === s)).toBeUndefined();
  });
});

describe("Cycle 7 — the office acts when a member asks", () => {
  it("S5 pause until a date: the member's pause, the audit names the officer and the reason, the member is told", async () => {
    const s = await weekly();
    const res = await supertest(app()).post(`/v1/admin/finance/schedules/${s}/pause`).set("Authorization", asOfficer())
      .send({ note: "Called the office: travelling in October", resume_on: new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ schedule_id: s, status: "paused", pause_reason: "member" });
    const trail = (await q(`SELECT actor_id, action, metadata FROM audit_log WHERE entity_id = $1 AND action LIKE '%by_office' LIMIT 1`, [s])).rows[0];
    expect(trail).toMatchObject({ actor_id: officer, action: "giving.schedule_paused_by_office" });
    expect(JSON.stringify(trail.metadata)).toContain("travelling in October");
    const told = (await q(`SELECT template, payload FROM notifications WHERE user_id = $1`, [user])).rows;
    expect(told).toEqual([expect.objectContaining({ template: "giving_schedule_office_change", payload: expect.objectContaining({ action: "pause" }) })]);
    // The member's own app shows it as their pause, with the date.
    const mine = ((await svc.listSchedules(user)).data as Array<Record<string, unknown>>)[0]!;
    expect(mine).toMatchObject({ status: "paused", pause_reason: "member" });
  });

  it("S6 resume after failures clears the strikes and picks up at the next occurrence; a gift paused with its pledge is refused", async () => {
    const s = await weekly();
    await set(s, `status = 'paused', pause_reason = 'failures', paused_at = now(), consecutive_failures = 3, next_run_at = now() - interval '3 days'`);
    const res = await svc.officeScheduleAction(officer, s, "resume", { note: "Member topped up M-Pesa" });
    expect(res).toMatchObject({ status: "active", consecutive_failures: 0 });
    expect(new Date(String(res.next_run_at)).getTime()).toBeGreaterThan(Date.now());
    const p = await weekly((await createUser({ congregationId: cong, phone: "0744000001" })).user_id, 60_000);
    await set(p, `status = 'paused', pause_reason = 'pledge', paused_at = now()`);
    await expect(svc.officeScheduleAction(officer, p, "resume", { note: "asked" })).rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });

  it("S7 cancel: nothing is prompted again and the member is told", async () => {
    const s = await weekly();
    await svc.officeScheduleAction(officer, s, "cancel", { note: "Member moved church" });
    await set(s, `next_run_at = now() - interval '1 minute'`);
    await svc.runDueSchedules(new Date());
    expect(safaricom.pushes).toHaveLength(0);
    expect((await q(`SELECT template FROM notifications WHERE user_id = $1`, [user])).rows.map((r) => r.template)).toEqual(["giving_schedule_office_change"]);
    await expect(svc.officeScheduleAction(officer, s, "cancel", { note: "again" })).rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });

  it("S8 only finance:manage may act, a reason is required, and dates are checked", async () => {
    const s = await weekly();
    const member = bearer({ sub: user, role: "Student", cong });
    expect((await supertest(app()).post(`/v1/admin/finance/schedules/${s}/pause`).set("Authorization", member).send({ note: "please" })).status).toBe(403);
    expect((await supertest(app()).post(`/v1/admin/finance/schedules/${s}/pause`).set("Authorization", asOfficer()).send({})).status).toBe(400);
    expect((await supertest(app()).post(`/v1/admin/finance/schedules/${s}/pause`).set("Authorization", asOfficer()).send({ note: "ok", resume_on: "2020-01-01" })).status).toBe(400);
    expect((await supertest(app()).post(`/v1/admin/finance/schedules/00000000-0000-0000-0000-000000000000/cancel`).set("Authorization", asOfficer()).send({ note: "gone" })).status).toBe(404);
    expect((await q(`SELECT status::text AS status FROM giving_schedules WHERE schedule_id = $1`, [s])).rows[0].status).toBe("active");
  });
});

describe("Cycle 7 — the partner's page and the claims queue", () => {
  it("S9 a partner's page shows why a gift is paused or failing, in words; the queue flags a claim it can only reject", async () => {
    const p = await partners.createPledge(user, { shape: "total", target_minor: 800_000, currency: "KES", due_on: "2026-12-31", reminders_enabled: true } as never);
    const s = String((await svc.createSchedule(user, { fund: "tithe", amount_minor: 100_000, currency: "KES", frequency: "monthly", method: "mpesa", pledge_id: String(p.pledge_id) } as never)).schedule_id);
    await set(s, `consecutive_failures = 1, last_failure_code = 'wrong_pin'`);
    const detail = await partners.adminDetail(user);
    const sched = (detail.schedules as Array<Record<string, unknown>>).find((x) => x.schedule_id === s)!;
    expect(sched).toMatchObject({ pause_reason: null, last_failure: { reason: expect.stringMatching(/PIN/i) } });
    await q(`INSERT INTO pledge_claims (pledge_id, user_id, amount_minor, currency, paid_on) VALUES ($1, $2, 5000, 'USD', '2026-09-01')`, [p.pledge_id, user]);
    await partners.createClaim(user, String(p.pledge_id), { amount_minor: 10_000, currency: "KES", paid_on: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10) } as never);
    const queue = await partners.pendingClaims();
    expect(queue.map((c) => [c.currency, c.currency_mismatch])).toEqual([["USD", true], ["KES", false]]);
    expect(queue.every((c) => c.pledge_currency === "KES")).toBe(true);
  });
});

describe("Cycle 7 — the office's reminders", () => {
  it("S11 'remind everyone behind' spares a member whose automatic collection just failed (they were told why); a one-to-one reminder is the office's own choice", async () => {
    const notifications = new NotificationService(testPool());
    const mk = async (who: string, amount: number) => {
      const p = await partners.createPledge(who, { shape: "monthly", amount_minor: amount, currency: "KES", due_day: 1, reminders_enabled: true } as never);
      await q(`UPDATE pledges SET created_at = now() - interval '70 days' WHERE pledge_id = $1`, [p.pledge_id]); // instalments missed → behind
      return String(p.pledge_id);
    };
    const failedGiver = user;
    const failedPledge = await mk(failedGiver, 100_000);
    const s = String((await svc.createSchedule(failedGiver, { fund: "tithe", amount_minor: 100_000, currency: "KES", frequency: "monthly", method: "mpesa", pledge_id: failedPledge } as never)).schedule_id);
    await set(s, `consecutive_failures = 1, last_failure_code = 'insufficient_funds', last_failed_at = now() - interval '10 hours'`);
    const quiet = (await createUser({ congregationId: cong, phone: "0766000002", fullName: "Quiet Giver" })).user_id;
    const quietPledge = await mk(quiet, 120_000);
    const r = await partners.remindBehind(officer, notifications);
    expect(r).toMatchObject({ reminded: 1, skipped: 1 });
    const sent = async (pledgeId: string) => (await q(`SELECT count(*)::int AS n FROM pledge_reminders WHERE pledge_id = $1 AND kind = 'manual'`, [pledgeId])).rows[0].n as number;
    expect(await sent(failedPledge)).toBe(0);
    expect(await sent(quietPledge)).toBe(1);
    // The office can still remind that member deliberately.
    expect((await partners.adminRemind(officer, failedGiver, notifications, { pledge_id: failedPledge })).reminded).toBe(1);
  });
});

describe("Cycle 7 — volume", () => {
  it("S10 a hundred and fifty gifts in every state: attention first, the count and the list agree, one query for the page", async () => {
    const states = ["healthy", "failing", "mine", "stopped", "ours"] as const;
    const expected = new Set<string>();
    for (let i = 0; i < 150; i += 1) {
      const who = (await createUser({ congregationId: cong, phone: `0755${String(i).padStart(6, "0")}` })).user_id;
      const s = await weekly(who, 10_000 + i * 100);
      const kind = states[i % states.length]!;
      if (kind === "failing") await set(s, `consecutive_failures = 1, last_failure_code = 'no_answer'`);
      if (kind === "mine") await set(s, `status = 'paused', pause_reason = 'member', paused_at = now()`);
      if (kind === "stopped") await set(s, `status = 'paused', pause_reason = 'failures', paused_at = now(), consecutive_failures = 3`);
      if (kind === "ours") await set(s, `last_error = 'UPSTREAM', last_failure_code = NULL, last_failed_at = now()`);
      if (kind === "failing" || kind === "stopped" || kind === "ours") expected.add(s);
    }
    const all = await register({ limit: 200 });
    expect(all).toHaveLength(150);
    const firstNot = all.findIndex((r) => !r.needs_attention);
    expect(firstNot).toBe(expected.size);
    expect(new Set(all.slice(0, firstNot).map((r) => r.schedule_id))).toEqual(expected);
    const res = await supertest(app()).get("/v1/admin/finance/overview").set("Authorization", asOfficer());
    expect((res.body.alerts as Array<{ kind: string; count: number }>).find((x) => x.kind === "failing_schedules")?.count).toBe(expected.size);
  });
});
