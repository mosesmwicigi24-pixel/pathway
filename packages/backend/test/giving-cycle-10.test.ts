// Giving — Cycle 10 of 10 (owner request 2026-09-28): the whole journey,
// end to end, and the last rough edges the apps found. A notice names what it
// is about in its title ("Kenya trip — due in 3 days", not "Kenya trip"); a
// reminder sent on three channels is ONE notice in the member's centre, read
// once; and a member's year with the church — a pledge collected
// automatically, a declined prompt, Try again, a month paid by hand, a claim
// the office confirms, the office pausing at their request, a dollar gift on
// the side — adds up the same on every surface.
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { FinancialService } from "../src/modules/financial/service.js";
import { PartnersService } from "../src/modules/financial/partners.js";
import { DarajaMpesaProvider, FakeMobileMoneyProvider } from "../src/modules/financial/providers.js";
import { FakePayPalGateway } from "../src/modules/financial/paypal.js";
import { NotificationService } from "../src/modules/notifications/service.js";
import { pushCopy, PUSH_TEMPLATE_COPY, type DispatchMessage } from "../src/workers/dispatch.js";
import type { PaymentGateway, WebhookEvent } from "../src/modules/financial/gateway.js";

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
const push = (template: string, payload: Record<string, unknown>): DispatchMessage => ({ channel: "push", to: "device-token", template, payload });

let cong: string, user: string, officer: string;
let safaricom: Safaricom, svc: FinancialService, partners: PartnersService, notifications: NotificationService;
beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  user = (await createUser({ congregationId: cong, phone: "0711222333", fullName: "Amina Wanjiru" })).user_id;
  officer = (await createUser({ congregationId: cong, role: "Instructor", email: "officer@dev.local" })).user_id;
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

describe("Cycle 10 — a notice names what it is about", () => {
  it("S1 a payload's title that is a pledge's or a need's NAME never becomes the push title; a composed title + body still does", () => {
    expect(pushCopy(push("pledge_due_soon", { title: "Kenya trip", amount_minor: 500_000, currency: "KES", days_away: 3 })).title).toBe("Kenya trip — due in 3 days");
    expect(pushCopy(push("giving_schedule_covered", { title: "Kenya trip", frequency: "monthly", covered_through: "2026-10-05" })).title).toBe("Nothing to pay this month");
    expect(pushCopy(push("pledge_claim_confirmed", { title: "Kenya trip", amount_minor: 500_000, currency: "KES" })).title).toBe("Your payment is recorded");
    expect(pushCopy(push("department_need_open", { title: "Roof sheets" })).title).toBe("Roof sheets — giving is open");
    expect(pushCopy(push("pledge_fulfilled", { title: "Kenya trip" }))).toMatchObject({ title: "Pledge fulfilled — thank you", body: expect.stringContaining("Kenya trip") });
    // A call site that composes its own copy (title AND body) still wins.
    expect(pushCopy(push("badge_awarded", { title: "Custom title", body: "Custom body" }))).toEqual({ title: "Custom title", body: "Custom body" });
  });
});

describe("Cycle 10 — one notice, one row", () => {
  const fanOut = async (payload: Record<string, unknown>) => {
    for (const channel of ["push", "sms", "email"] as const) {
      await notifications.schedule({ userId: user, channel, template: "pledge_due_soon", payload, timezone: "Africa/Nairobi" });
    }
    await q(`UPDATE notifications SET status = 'sent', sent_at = now() WHERE user_id = $1 AND status = 'scheduled'`, [user]);
  };

  it("S2 a reminder sent on push, SMS and email is ONE row in the member's centre and ONE unread; reading it reads all three", async () => {
    await fanOut({ pledge_id: "p1", title: "Kenya trip", amount_minor: 500_000, currency: "KES", due_on: "2026-10-05", days_away: 3 });
    const before = await notifications.listMine(user);
    expect(before.data).toHaveLength(1);
    expect(before.unread).toBe(1);
    const [row] = before.data as Array<{ notification_id: string }>;
    await notifications.markRead(user, [row!.notification_id]);
    const after = await notifications.listMine(user);
    expect(after.unread).toBe(0);
    // Every DELIVERED row of it is read (a suppressed channel was never delivered, so it is never "unread").
    expect((await q(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND status = 'sent' AND read_at IS NULL`, [user])).rows[0].n).toBe(0);
    expect((await q(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND status = 'sent' AND read_at IS NOT NULL`, [user])).rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it("S3 a member with push off still sees the notice their SMS delivered; two different pledges are two notices", async () => {
    await q(`INSERT INTO notification_preferences (user_id, push_enabled) VALUES ($1, false) ON CONFLICT (user_id) DO UPDATE SET push_enabled = false`, [user]);
    await fanOut({ pledge_id: "p1", title: "Kenya trip", amount_minor: 500_000, currency: "KES", due_on: "2026-10-05", days_away: 3 });
    await fanOut({ pledge_id: "p2", title: "Roof", amount_minor: 200_000, currency: "KES", due_on: "2026-10-05", days_away: 3 });
    const list = await notifications.listMine(user);
    expect(list.data).toHaveLength(2);
    expect(list.unread).toBe(2);
    expect((list.data as Array<{ payload: { pledge_id: string } }>).map((r) => r.payload.pledge_id).sort()).toEqual(["p1", "p2"]);
  });
});

describe("Cycle 10 — the whole class of named notices", () => {
  it("S6 every template in the push table that takes a `title` as the THING it is about keeps its own words as the push title", () => {
    const name = "Kenya trip ZZ";
    const sample = { title: name, amount_minor: 500_000, currency: "KES", days_away: 2, due_on: "2026-10-05", frequency: "monthly", reason: "pledge_fulfilled", covered_through: "2026-10-05", until_on: "2026-10-31", department: "Media", sequence: 1, of: 3 };
    const offenders: string[] = [];
    for (const template of Object.keys(PUSH_TEMPLATE_COPY)) {
      const generated = PUSH_TEMPLATE_COPY[template]!(sample);
      if (!generated?.title) continue;
      const { title } = pushCopy(push(template, sample));
      if (title !== generated.title) offenders.push(template);
    }
    expect(offenders).toEqual([]);
  });

  it("S7 department need notices name the need inside their own words", () => {
    expect(pushCopy(push("department_need_approved", { title: "Roof sheets" })).title).toBe("Your need was approved");
    expect(pushCopy(push("department_need_closed", { title: "Roof sheets" })).body).toContain("Roof sheets");
  });

  it("S8 a chat-style notice that composes its own title and body is untouched", () => {
    expect(pushCopy(push("chat_dm", { title: "Grace", body: "See you on Sunday" }))).toEqual({ title: "Grace", body: "See you on Sunday" });
  });

  it("S9 volume: sixty channel rows for twenty reminders are twenty notices, twenty unread; reading all empties the count", async () => {
    const n = new NotificationService(testPool());
    // Delivered rows as the dispatcher leaves them (schedule() would apply the daily cap).
    await q(
      `INSERT INTO notifications (user_id, channel, template, payload, status, scheduled_for, sent_at)
       SELECT $1, c::notif_channel, 'pledge_overdue',
              jsonb_build_object('pledge_id', 'p' || i, 'title', 'Pledge ' || i, 'amount_minor', 100000, 'currency', 'KES', 'due_on', '2026-10-01', 'sequence', 1, 'of', 3),
              'sent', now() - (i || ' minutes')::interval, now()
         FROM generate_series(0, 19) AS i, unnest(ARRAY['push','sms','email']) AS c`,
      [user],
    );
    const list = await n.listMine(user, 100);
    expect(list.data).toHaveLength(20);
    expect(list.unread).toBe(20);
    await n.markRead(user);
    expect((await n.listMine(user, 100)).unread).toBe(0);
  });

  it("S10 a covered month, end to end: the runner skips, the notice is stored once, and its push reads 'Nothing to pay this month'", async () => {
    const p = await partners.createPledge(user, { shape: "monthly", amount_minor: 500_000, currency: "KES", due_day: 5, title: "Kenya trip", reminders_enabled: true, auto_schedule: { method: "mpesa", frequency: "monthly" } } as never);
    await q(`UPDATE pledges SET created_at = '2026-09-01T09:00:00Z', starts_on = '2026-10-05' WHERE pledge_id = $1`, [p.pledge_id]);
    await q(`UPDATE giving_schedules SET next_run_at = '2026-10-05T06:00:00Z', anchor_day = 5 WHERE schedule_id = $1`, [p.schedule_id]);
    await q(`INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, idempotency_key, pledge_id, created_at) VALUES ($1, (SELECT fund_id FROM funds WHERE code = 'tithe'), 500000, 'KES', 'succeeded', 'manual', 'c10-cov-1', $2, '2026-10-01T09:00:00Z')`, [user, p.pledge_id]);
    await svc.runDueSchedules(new Date("2026-10-05T06:01:00Z"));
    const rows = (await q(`SELECT template, payload FROM notifications WHERE user_id = $1 AND template = 'giving_schedule_covered'`, [user])).rows;
    expect(rows).toHaveLength(1);
    expect(pushCopy(push("giving_schedule_covered", rows[0].payload)).title).toBe("Nothing to pay this month");
  });

  it("S11 an outage comes and goes: flagged while most of the hour's prompts can't reach phones, quiet again an hour after", async () => {
    const at = new Date("2026-10-10T09:00:00Z");
    for (let i = 0; i < 6; i += 1) {
      await q(`INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, provider_ref, idempotency_key, failure_code, created_at)
               VALUES ($1, (SELECT fund_id FROM funds WHERE code = 'tithe'), 10000, 'KES', 'failed', 'mpesa', $2, $2, 'unreachable', $3)`, [user, `c10-out-${i}`, new Date(at.getTime() - 10 * 60_000).toISOString()]);
    }
    expect((await svc.outageCheck(at)).suspected).toBe(true);
    expect((await svc.outageCheck(new Date(at.getTime() + 2 * 3_600_000))).suspected).toBe(false);
  });
});

describe("Cycle 10 — a resent PayPal gift can still be approved", () => {
  it("S5 the resend answers with the same order AND its approval page, so the app can reopen it; a settled one has none", async () => {
    const pp = new FinancialService(testPool(), new FakeGateway(), { mpesa: new FakeMobileMoneyProvider("mpesa"), airtel: new FakeMobileMoneyProvider("airtel") }, new FakePayPalGateway());
    const body = { fund: "tithe", amount_minor: 2_500, currency: "USD", method: "paypal", idempotency_key: "c10-pp-resend-1" };
    const first = await pp.createGivingIntent(user, body as never);
    const again = await pp.createGivingIntent(user, body as never);
    expect(again).toMatchObject({ transaction_id: first.transaction_id, reused: true, provider: "paypal", provider_ref: first.provider_ref, approve_url: first.approve_url });
    await q(`UPDATE transactions SET status = 'succeeded' WHERE transaction_id = $1`, [first.transaction_id]);
    expect((await pp.createGivingIntent(user, body as never)).approve_url).toBeUndefined();
  });
});

describe("Cycle 10 — a member's year, end to end", () => {
  it("S4 pledge → automatic collection → a declined prompt → Try again → a month paid by hand → a covered month → a claim the office confirms → the office pauses at their request → a dollar gift on the side: every figure agrees", async () => {
    // 1. A monthly pledge of KSh 5,000 due on the 5th, collected automatically, made on 20 Sep 2026.
    const p = await partners.createPledge(user, { shape: "monthly", amount_minor: 500_000, currency: "KES", due_day: 5, title: "Kenya trip", reminders_enabled: true, auto_schedule: { method: "mpesa", frequency: "monthly" } } as never);
    const pid = String(p.pledge_id), sid = String(p.schedule_id);
    await q(`UPDATE pledges SET created_at = '2026-09-20T09:00:00Z', starts_on = '2026-10-05' WHERE pledge_id = $1`, [pid]);
    await q(`UPDATE giving_schedules SET next_run_at = '2026-10-05T06:00:00Z', anchor_day = 5 WHERE schedule_id = $1`, [sid]);

    // 2. 5 Oct: the heads-up, then the prompt — the member cancels it (a strike, told why).
    await svc.runDueSchedules(new Date("2026-10-05T05:50:00Z"));
    await svc.runDueSchedules(new Date("2026-10-05T06:01:00Z"));
    const first = safaricom.pushes[0]!;
    expect(first.amount).toBe(5000);
    safaricom.results.set(first.ref, "1032");
    await svc.handleMobileMoneyCallback("mpesa", cb(first.ref, 1032), "");
    const failedTx = String((await q(`SELECT transaction_id FROM transactions WHERE provider_ref = $1`, [first.ref])).rows[0].transaction_id);

    // 3. She taps Try again and pays: the cycle is paid, the strike clears.
    const again = await svc.retryGift(user, failedTx, {});
    const second = safaricom.pushes[1]!;
    safaricom.results.set(second.ref, "0");
    await svc.handleMobileMoneyCallback("mpesa", cb(second.ref, 0), "");
    expect((await q(`SELECT status::text AS status, schedule_id FROM transactions WHERE transaction_id = $1`, [again.transaction_id])).rows[0]).toEqual({ status: "succeeded", schedule_id: sid });
    expect((await q(`SELECT consecutive_failures FROM giving_schedules WHERE schedule_id = $1`, [sid])).rows[0].consecutive_failures).toBe(0);
    // Both prompts were written on the real clock; they belong to the
    // scenario's 5 October (09:01 and 09:05 in Nairobi). Left on the real
    // clock, the 20 Dec health check below stopped counting them after
    // 20 Dec 2026, and the 2026 statement lost the Try-again payment in 2027.
    await q(`UPDATE transactions SET created_at = '2026-10-05T06:01:00Z' WHERE transaction_id = $1`, [failedTx]);
    await q(`UPDATE transactions SET created_at = '2026-10-05T06:05:00Z' WHERE transaction_id = $1`, [again.transaction_id]);

    // 4. She pays November by hand at the church office; she tells the app, the office confirms.
    const claim = await partners.createClaim(user, pid, { amount_minor: 500_000, currency: "KES", paid_on: "2026-11-01", note: "Cash at the office" } as never, new Date("2026-11-01T12:00:00Z"));
    await partners.decideClaim(officer, String(claim.claim_id), "confirm", notifications);

    // 5. 5 Nov: November is covered — no prompt, she is told.
    await svc.runDueSchedules(new Date("2026-11-05T06:01:00Z"));
    expect(safaricom.pushes).toHaveLength(2);
    expect((await q(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND template = 'giving_schedule_covered'`, [user])).rows[0].n).toBe(1);

    // 6. She calls the office in November: pause December, back in January.
    //    The office's date check reads the wall clock (it takes no `now`), so
    //    the call is made on the scenario's own November day — on the real
    //    clock, 1 Jan 2027 stopped being "from tomorrow" on 1 Jan 2027.
    //    Fake Date only: faking timers too would stall the pg driver.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T09:00:00Z"));
    try {
      await svc.officeScheduleAction(officer, sid, "pause", { note: "Travelling in December", resume_on: "2027-01-01" });
    } finally {
      vi.useRealTimers();
    }
    await svc.runDueSchedules(new Date("2026-12-05T06:01:00Z"));
    expect(safaricom.pushes).toHaveLength(2);

    // 7. A dollar gift on the side (PayPal-style, recorded as settled), never added to her shillings.
    await q(`INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, idempotency_key, created_at, settled_at)
             VALUES ($1, (SELECT fund_id FROM funds WHERE code = 'tithe'), 2500, 'USD', 'succeeded', 'manual', 'usd-side-1', '2026-11-10T09:00:00Z', '2026-11-10T09:00:00Z')`, [user]);

    // The year adds up: two instalments paid (Oct by M-Pesa after Try again, Nov by claim), December owed.
    const st = await partners.statements(user, 2026, new Date("2026-12-20T09:00:00Z"));
    expect(st.summary_by_currency).toEqual([{ currency: "KES", pledged_minor: 1_500_000, paid_minor: 1_000_000, remaining_minor: 500_000 }]);
    const row = st.pledges.find((x) => x.pledge_id === pid)!;
    expect(row).toMatchObject({ pledged_minor: 1_500_000, paid_minor: 1_000_000, remaining_year_minor: 500_000 });
    expect(st.totals).toEqual(expect.arrayContaining([{ currency: "KES", total_minor: 1_000_000 }, { currency: "USD", total_minor: 2500 }]));
    // The office sees the same: the pause is hers, nothing needs chasing, collection health counts her prompts.
    const reg = ((await svc.listSchedulesAdmin({})).data as Array<Record<string, unknown>>).find((r) => r.schedule_id === sid)!;
    expect(reg).toMatchObject({ status: "paused", pause_reason: "member", resume_on: "2027-01-01", needs_attention: false });
    const health = await svc.collectionHealth(90, new Date("2026-12-20T09:00:00Z"));
    expect(health).toMatchObject({ prompts: 2, paid: 1, failed: 1 });
    // 1 Jan 2027: it resumes by itself at its next occurrence — 5 January, the full month.
    await svc.runDueSchedules(new Date("2027-01-01T06:00:00Z"));
    expect((await q(`SELECT status::text AS status FROM giving_schedules WHERE schedule_id = $1`, [sid])).rows[0].status).toBe("active");
    await svc.runDueSchedules(new Date("2027-01-05T06:01:00Z"));
    expect(safaricom.pushes.map((x) => x.amount)).toEqual([5000, 5000, 5000]);
  });
});
