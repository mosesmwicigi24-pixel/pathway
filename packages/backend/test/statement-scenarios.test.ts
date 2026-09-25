// The member's view the moment money moves (live report 2026-09-25: the owner
// paid KSh 1,000 toward his "Partnership" pledge — prod transaction succeeded,
// pledge_id set, booked to discipleship — but the apps showed stale data and
// the Give screen said "Tithe"). Every scenario drives the REAL code paths —
// createGivingIntent → the verified M-Pesa callback (handleMobileMoneyCallback
// → settle), runDueSchedules, the office's claim confirmation, updatePledge —
// and then reads the member's view straight back from the same services and
// over HTTP. There is no server-side cache: each read is a fresh query, and
// the before/after reads below prove it.
//
// The only thing tests pin by hand is WHEN a payment was started (created_at),
// so the calendar maths is deterministic; status only ever moves through the
// real callback / settle / confirm paths.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { agent, bearer } from "./helpers/app.js";
import { FinancialService } from "../src/modules/financial/service.js";
import { PartnersService } from "../src/modules/financial/partners.js";
import { CampaignService } from "../src/modules/financial/campaigns.js";
import { DepartmentsService } from "../src/modules/departments/service.js";
import { NotificationService } from "../src/modules/notifications/service.js";
import { FakeMobileMoneyProvider } from "../src/modules/financial/providers.js";
import { DEFAULT_PLEDGE_FUND } from "../src/modules/financial/constants.js";
import type { PaymentGateway } from "../src/modules/financial/gateway.js";

class FakeGateway implements PaymentGateway {
  private n = 0;
  async createIntent(): Promise<{ id: string; client_secret: string }> {
    this.n += 1;
    return { id: `pi_sc_${this.n}`, client_secret: `cs_${this.n}` };
  }
  verifyWebhook(): never { throw new Error("card webhooks are not used here — M-Pesa is the member's path"); }
}

type Pledge = { pledge_id: string; title: string; pays_to: { code: string; name: string } | null } & Record<string, unknown>;
type Intent = { transaction_id: string; provider_ref: string; status: string; reused: boolean; fund: { code: string; name: string } | null; pledge: { pledge_id: string; title: string } | null };

describe("the member's statement right after money moves (real paths, no cache)", () => {
  let cong: string; let user: string; let admin: string; let leader: string;
  let mm: FakeMobileMoneyProvider;
  let financial: FinancialService; let partners: PartnersService; let notifications: NotificationService;
  let events = 0;
  // The church's Sunday 20 September 2026, 12:00 — every "today" below.
  const now = new Date("2026-09-20T09:00:00Z");

  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation("Nairobi Central");
    user = (await createUser({ congregationId: cong, fullName: "Amina Wanjiru" })).user_id;
    admin = (await createUser({ congregationId: cong })).user_id;
    leader = (await createUser({ congregationId: cong })).user_id;
    mm = new FakeMobileMoneyProvider("mpesa");
    financial = new FinancialService(testPool(), new FakeGateway(), { mpesa: mm, airtel: new FakeMobileMoneyProvider("airtel") });
    partners = new PartnersService(testPool(), financial);
    notifications = new NotificationService(testPool());
    // Production has the programme default; the test seed does not.
    await testPool().query(`INSERT INTO funds (code, name, is_active) VALUES ($1, 'Discipleship', TRUE) ON CONFLICT (code) DO UPDATE SET is_active = TRUE`, [DEFAULT_PLEDGE_FUND]);
  });
  afterAll(async () => { await closeTestPool(); });

  // ── helpers: the real money paths ──

  async function pledge(input: Record<string, unknown>, createdAt: string): Promise<Pledge> {
    const p = (await partners.createPledge(user, { currency: "KES", reminders_enabled: true, ...input } as never)) as Pledge;
    await testPool().query(`UPDATE pledges SET created_at = $2 WHERE pledge_id = $1`, [p.pledge_id, createdAt]);
    return p;
  }

  /** An M-Pesa STK push from the app, started at `startedAt` (the "Tithe" chip
   *  is what a client might send — the server must ignore it for pledge money). */
  async function mpesaIntent(input: Record<string, unknown>, startedAt: string): Promise<Intent> {
    const r = (await financial.createGivingIntent(user, { fund: "tithe", currency: "KES", method: "mpesa", ...input } as never)) as Intent;
    await testPool().query(`UPDATE transactions SET created_at = $2 WHERE transaction_id = $1`, [r.transaction_id, startedAt]);
    return r;
  }

  /** Safaricom's callback, signed and verified the real way. */
  async function callback(ref: string, status: "succeeded" | "failed", eventId = `evt_${++events}`): Promise<Record<string, unknown>> {
    const body = JSON.stringify({ event_id: eventId, ref, status, ...(status === "succeeded" ? { receipt: `UJ${String(events).padStart(8, "0")}` } : {}) });
    return financial.handleMobileMoneyCallback("mpesa", body, mm.sign(body));
  }

  async function paid(input: Record<string, unknown>, startedAt: string): Promise<Intent> {
    const r = await mpesaIntent(input, startedAt);
    expect(await callback(r.provider_ref, "succeeded")).toMatchObject({ duplicate: false, status: "succeeded" });
    return r;
  }

  const statement = (year = 2026) => partners.statements(user, year, now);
  const row = async (id: string, year = 2026) => (await statement(year)).pledges.find((p) => p.pledge_id === id)!;

  // ── (a) ──
  it("(a) an instalment paid via M-Pesa shows at once in payments, paid, the pledge's paid/kept, months, faithfulness and impact — service and HTTP", async () => {
    const a = await pledge({ shape: "monthly", amount_minor: 100_000, due_day: 20 }, "2026-09-01 08:00:00+00"); // due today
    const before = await statement();
    expect(before).toMatchObject({ paid_minor: 0, pledged_minor: 400_000, remaining_minor: 400_000, payments: [], pending: [] });
    expect(before.months[8]).toEqual({ month: 9, status: "upcoming", due_minor: 100_000, paid_minor: 0 });
    expect(before.faithfulness).toEqual({ kept_on_time: 0, late: 0, missed: 0, due_count: 0 }); // due today, not yet paid — not counted until the day ends
    const http = async () => (await agent().get("/v1/giving/statements?year=2026").set("Authorization", bearer({ sub: user, role: "Student", cong }))).body as { paid_minor: number; payments: { transaction_id: string }[] };
    expect((await http()).paid_minor).toBe(0);

    const pay = await paid({ amount_minor: 100_000, pledge_id: a.pledge_id }, "2026-09-20 07:30:00+00"); // 10:30 in Nairobi

    const after = await statement();
    expect(after.payments).toHaveLength(1);
    expect(after.payments[0]).toMatchObject({ transaction_id: pay.transaction_id, amount_minor: 100_000, method: "mpesa", pledge_id: a.pledge_id, pledge_title: "General partnership", fund: "discipleship", fund_name: "Discipleship" });
    expect(after.payments[0]!.receipt_code).toMatch(/^UJ\d{8}$/);
    expect(after).toMatchObject({ paid_minor: 100_000, pledged_minor: 400_000, remaining_minor: 300_000, pending: [] });
    expect(after.pledges.find((p) => p.pledge_id === a.pledge_id)).toMatchObject({ paid_minor: 100_000, kept: 1, due_count: 1, remaining_year_minor: 300_000 });
    expect(after.months[8]).toEqual({ month: 9, status: "kept", due_minor: 100_000, paid_minor: 100_000 });
    expect(after.faithfulness).toEqual({ kept_on_time: 1, late: 0, missed: 0, due_count: 1 });
    expect(after.impact).toEqual({ paid_minor: 100_000, per_disciple_minor: 2_000_000, disciples_carried: 0, toward_next_minor: 100_000 });
    // Over HTTP too, on the very next request — nothing cached in between.
    const h = await http();
    expect(h.paid_minor).toBe(100_000);
    expect(h.payments.map((x) => x.transaction_id)).toEqual([pay.transaction_id]);
  });

  // FIXED (owner-delegated 2026-09-25): these three were pinned as known
  // defects — the card, the DUE list and the reminders read a period window
  // that never moved once an instalment was paid, and counted one late
  // payment twice. They now read the same instalment ledger as the statement.
  it("(a) FIXED: partnership() due[] drops a monthly pledge the moment its instalment is paid, and the card reads full", async () => {
    const a = await pledge({ shape: "monthly", amount_minor: 100_000, due_day: 20 }, "2026-09-01 08:00:00+00");
    const before = await partners.partnership(user, now);
    expect(before.due).toEqual([expect.objectContaining({ kind: "pledge", id: a.pledge_id, due_on: "2026-09-20", amount_minor: 100_000, overdue: false })]);
    await paid({ amount_minor: 100_000, pledge_id: a.pledge_id }, "2026-09-20 07:30:00+00");
    const after = await partners.partnership(user, now);
    expect(after.due).toEqual([]);
    expect((after.pledges as { progress: unknown }[])[0]!.progress).toEqual({ paid_minor: 100_000, period_paid_minor: 100_000, label: "on_track", next_due: "2026-10-20", overdue_since: null });
    // It comes back a week before the next instalment, asking for that one.
    const oct14 = await partners.partnership(user, new Date("2026-10-14T09:00:00Z"));
    expect(oct14.due).toEqual([expect.objectContaining({ id: a.pledge_id, due_on: "2026-10-20", amount_minor: 100_000 })]);
    expect((await partners.partnership(user, new Date("2026-10-12T09:00:00Z"))).due).toEqual([]);
  });

  it("(a) FIXED: no 'due soon' reminder for an instalment already paid ahead of its due date", async () => {
    const a = await pledge({ shape: "monthly", amount_minor: 100_000, due_day: 22 }, "2026-09-01 08:00:00+00"); // due in 2 days
    await paid({ amount_minor: 100_000, pledge_id: a.pledge_id }, "2026-09-20 07:30:00+00");
    expect((await partners.sendDueReminders(notifications, now)).due_soon).toBe(0);
    const logged = await testPool().query(`SELECT count(*)::int AS n FROM pledge_reminders WHERE pledge_id = $1`, [a.pledge_id]);
    expect(logged.rows[0].n).toBe(0);
  });

  it("(a) FIXED: after a late payment the card and the statement agree — the late payment settles September and does not fill October", async () => {
    const a = await pledge({ shape: "monthly", amount_minor: 100_000, due_day: 5 }, "2026-08-01 08:00:00+00");
    await paid({ amount_minor: 100_000, pledge_id: a.pledge_id }, "2026-08-05 07:00:00+00"); // August, on time
    await paid({ amount_minor: 100_000, pledge_id: a.pledge_id }, "2026-09-10 07:00:00+00"); // September, late
    // 2 October: three days before October's instalment.
    const oct2 = new Date("2026-10-02T09:00:00Z");
    const st = await partners.statements(user, 2026, oct2);
    expect(st.months.slice(7, 10)).toEqual([
      { month: 8, status: "kept", due_minor: 100_000, paid_minor: 100_000 },
      { month: 9, status: "late", due_minor: 100_000, paid_minor: 100_000 },
      { month: 10, status: "upcoming", due_minor: 100_000, paid_minor: 0 },
    ]);
    const ship = await partners.partnership(user, oct2);
    // (The old card read October as paid by the 10 Sep payment.)
    expect((ship.pledges as { progress: unknown }[])[0]!.progress).toEqual({ paid_minor: 200_000, period_paid_minor: 0, label: "on_track", next_due: "2026-10-05", overdue_since: null });
    expect(ship.due).toEqual([expect.objectContaining({ id: a.pledge_id, due_on: "2026-10-05", amount_minor: 100_000, overdue: false })]);
    // On 20 September the same card reads September full (settled late) and nothing due within the week.
    const sep = await partners.partnership(user, now);
    expect((sep.pledges as { progress: { period_paid_minor: number; next_due: string } }[])[0]!.progress).toMatchObject({ period_paid_minor: 100_000, next_due: "2026-10-05" });
    expect(sep.due).toEqual([]);
  });

  // ── (b) ──
  it("(b) a payment still processing is only in pending — not paid, months, faithfulness or impact — and moves to paid when it settles", async () => {
    const b = await pledge({ shape: "monthly", amount_minor: 50_000, due_day: 20, fund: "mission", title: "Kenya trip" }, "2026-09-01 08:00:00+00");
    const live = await mpesaIntent({ amount_minor: 50_000, pledge_id: b.pledge_id }, "2026-09-20 08:00:00+00");  // an hour ago
    await mpesaIntent({ amount_minor: 50_000, pledge_id: b.pledge_id }, "2026-09-17 08:00:00+00");               // abandoned: 3 days ago
    await mpesaIntent({ amount_minor: 7_000 }, "2026-09-20 08:10:00+00");                                        // a plain gift in flight

    const st = await statement();
    expect(st.pending).toEqual([{
      transaction_id: live.transaction_id, amount_minor: 50_000, currency: "KES", at: expect.stringMatching(/^2026-09-20 /) as unknown as string,
      status: "processing", method: "mpesa", receipt_code: null, pledge_id: b.pledge_id, pledge_title: "Kenya trip",
    }]);
    expect(st).toMatchObject({ paid_minor: 0, payments: [] });
    expect(st.pledges[0]).toMatchObject({ paid_minor: 0, kept: 0 });
    expect(st.months[8]).toEqual({ month: 9, status: "upcoming", due_minor: 50_000, paid_minor: 0 });
    expect(st.faithfulness).toEqual({ kept_on_time: 0, late: 0, missed: 0, due_count: 0 });
    expect(st.impact.paid_minor).toBe(0);

    await callback(live.provider_ref, "succeeded");
    const done = await statement();
    expect(done.pending).toEqual([]);
    expect(done.payments.map((x) => x.transaction_id)).toEqual([live.transaction_id]);
    expect(done).toMatchObject({ paid_minor: 50_000 });
    expect(done.pledges[0]).toMatchObject({ paid_minor: 50_000, kept: 1 });
    expect(done.months[8]).toEqual({ month: 9, status: "kept", due_minor: 50_000, paid_minor: 50_000 });
    expect(done.faithfulness).toEqual({ kept_on_time: 1, late: 0, missed: 0, due_count: 1 });
    expect(done.impact.paid_minor).toBe(50_000);
  });

  // ── (c) ──
  it("(c) a failed payment is in neither pending nor paid", async () => {
    const c = await pledge({ shape: "monthly", amount_minor: 50_000, due_day: 20 }, "2026-09-01 08:00:00+00");
    const r = await mpesaIntent({ amount_minor: 50_000, pledge_id: c.pledge_id }, "2026-09-20 08:00:00+00");
    expect((await statement()).pending).toHaveLength(1);
    expect(await callback(r.provider_ref, "failed")).toMatchObject({ duplicate: false, status: "failed" });
    const st = await statement();
    expect(st).toMatchObject({ pending: [], payments: [], paid_minor: 0 });
    expect(st.pledges[0]).toMatchObject({ paid_minor: 0, kept: 0 });
    expect(st.months[8]!.paid_minor).toBe(0);
  });

  // ── (d) ──
  it("(d) two pledges paid the same day are each counted to their own pledge", async () => {
    const one = await pledge({ shape: "monthly", amount_minor: 100_000, due_day: 20, fund: "mission", title: "Kenya trip" }, "2026-09-01 08:00:00+00");
    const two = await pledge({ shape: "total", target_minor: 300_000, due_on: "2026-12-31", fund: "media", title: "Sound desk" }, "2026-09-01 08:00:00+00");
    const p1 = await paid({ amount_minor: 100_000, pledge_id: one.pledge_id }, "2026-09-20 06:00:00+00");
    const p2 = await paid({ amount_minor: 80_000, pledge_id: two.pledge_id }, "2026-09-20 06:05:00+00");
    const st = await statement();
    expect(st.paid_minor).toBe(180_000);
    expect(st.payments.find((x) => x.transaction_id === p1.transaction_id)).toMatchObject({ pledge_id: one.pledge_id, pledge_title: "Kenya trip", fund: "mission" });
    expect(st.payments.find((x) => x.transaction_id === p2.transaction_id)).toMatchObject({ pledge_id: two.pledge_id, pledge_title: "Sound desk", fund: "media" });
    expect(await row(one.pledge_id)).toMatchObject({ paid_minor: 100_000, kept: 1, due_count: 1 });
    expect(await row(two.pledge_id)).toMatchObject({ paid_minor: 80_000, remaining_year_minor: 220_000, kept: 0, due_count: 0 });
    expect(st.by_pledge.map((b) => [b.title, b.total_minor]).sort()).toEqual([["Kenya trip", 100_000], ["Sound desk", 80_000]]);
    expect(st.months[8]).toEqual({ month: 9, status: "kept", due_minor: 100_000, paid_minor: 100_000 }); // the total pledge's money never enters the strip
  });

  // ── (e) ──
  it("(e) 23:50 EAT on 31 Dec lands in the old year, 00:10 EAT on 1 Jan in the new one", async () => {
    const t = await pledge({ shape: "total", target_minor: 500_000, due_on: "2026-06-30", title: "Roof" }, "2025-12-01 08:00:00+00");
    const late = await paid({ amount_minor: 100_000, pledge_id: t.pledge_id }, "2025-12-31 20:50:00+00"); // 23:50 EAT, 31 Dec 2025
    const early = await paid({ amount_minor: 200_000, pledge_id: t.pledge_id }, "2025-12-31 21:10:00+00"); // 00:10 EAT, 1 Jan 2026 (still 31 Dec in UTC)
    const y25 = await statement(2025);
    const y26 = await statement(2026);
    expect(y25.years).toEqual([2026, 2025]);
    expect(y25.payments.map((x) => x.transaction_id)).toEqual([late.transaction_id]);
    expect(y25.paid_minor).toBe(100_000);
    expect(y26.payments.map((x) => x.transaction_id)).toEqual([early.transaction_id]);
    expect(y26.paid_minor).toBe(200_000);
    expect(y26.pledges[0]).toMatchObject({ pledged_minor: 500_000, paid_minor: 200_000, remaining_year_minor: 300_000 });
  });

  // ── (f) ──
  it("(f) an idempotent replay — same intent key, same callback, a second callback for the same payment — never double counts", async () => {
    const f = await pledge({ shape: "monthly", amount_minor: 100_000, due_day: 20 }, "2026-09-01 08:00:00+00");
    const first = await mpesaIntent({ amount_minor: 100_000, pledge_id: f.pledge_id, idempotency_key: "give-f-0001" }, "2026-09-20 07:00:00+00");
    const again = (await financial.createGivingIntent(user, { fund: "tithe", currency: "KES", method: "mpesa", amount_minor: 100_000, pledge_id: f.pledge_id, idempotency_key: "give-f-0001" } as never)) as Intent;
    expect(again).toMatchObject({ transaction_id: first.transaction_id, reused: true });
    const body = JSON.stringify({ event_id: "evt_f_1", ref: first.provider_ref, status: "succeeded", receipt: "UJF0000001" });
    expect(await financial.handleMobileMoneyCallback("mpesa", body, mm.sign(body))).toMatchObject({ duplicate: false });
    expect(await financial.handleMobileMoneyCallback("mpesa", body, mm.sign(body))).toEqual({ duplicate: true });
    expect(await callback(first.provider_ref, "succeeded", "evt_f_2")).toMatchObject({ duplicate: false }); // a provider retry under a new event id
    expect(((await financial.createGivingIntent(user, { fund: "tithe", currency: "KES", method: "mpesa", amount_minor: 100_000, pledge_id: f.pledge_id, idempotency_key: "give-f-0001" } as never)) as Intent)).toMatchObject({ transaction_id: first.transaction_id, reused: true, status: "succeeded" });

    const st = await statement();
    expect(st.payments).toHaveLength(1);
    expect(st.paid_minor).toBe(100_000);
    expect(st.pledges[0]).toMatchObject({ paid_minor: 100_000, kept: 1 });
    expect(st.faithfulness.kept_on_time).toBe(1);
    const ledger = await testPool().query(`SELECT count(*)::int AS n FROM ledger_entries WHERE transaction_id = $1`, [first.transaction_id]);
    expect(ledger.rows[0].n).toBe(2);
    const rows = await testPool().query(`SELECT count(*)::int AS n FROM transactions WHERE pledge_id = $1`, [f.pledge_id]);
    expect(rows.rows[0].n).toBe(1);
  });

  // ── (g) ──
  it("(g) an 'I paid another way' claim confirmed by the office appears as a manual payment and counts — settling the oldest instalment first", async () => {
    const g = await pledge({ shape: "monthly", amount_minor: 100_000, due_day: 15, title: "Choir" }, "2026-08-01 08:00:00+00"); // due 15 Aug, 15 Sep
    const claim = (await partners.createClaim(user, g.pledge_id, { amount_minor: 100_000, currency: "KES", paid_on: "2026-09-14" })) as { claim_id: string };
    const waiting = await statement();
    expect(waiting).toMatchObject({ paid_minor: 0, payments: [], pending: [] }); // a claim is not money until the office confirms it
    const decided = await partners.decideClaim(admin, claim.claim_id, "confirm", notifications);
    const st = await statement();
    expect(st.payments).toHaveLength(1);
    expect(st.payments[0]).toMatchObject({ transaction_id: decided.transaction_id, amount_minor: 100_000, method: "manual", pledge_id: g.pledge_id, pledge_title: "Choir", fund: "discipleship" });
    expect(st.payments[0]!.at).toMatch(/^2026-09-14/);
    expect(st.paid_minor).toBe(100_000);
    // The ledger fills the OLDEST incomplete instalment: the 14 Sep payment
    // settles August (late); September's then goes unpaid past the 15th.
    expect(await row(g.pledge_id)).toMatchObject({ paid_minor: 100_000, kept: 1, due_count: 2 });
    expect(st.faithfulness).toEqual({ kept_on_time: 0, late: 1, missed: 1, due_count: 2 });
    expect(st.months.slice(7, 9)).toEqual([
      { month: 8, status: "late", due_minor: 100_000, paid_minor: 100_000 },
      { month: 9, status: "missed", due_minor: 100_000, paid_minor: 0 },
    ]);
  });

  // ── (h) ──
  it("(h) a scheduled charge bound to the pledge appears, attributed and booked to the pledge's fund", async () => {
    const h = await pledge({ shape: "monthly", amount_minor: 100_000, due_day: 20, fund: "mission", title: "Kenya trip" }, "2026-09-01 08:00:00+00");
    const sched = (await financial.createSchedule(user, { fund: "tithe", amount_minor: 100_000, currency: "KES", frequency: "monthly", method: "mpesa", pledge_id: h.pledge_id })) as { schedule_id: string };
    await testPool().query(`UPDATE giving_schedules SET next_run_at = now() - interval '1 hour' WHERE schedule_id = $1`, [sched.schedule_id]);
    expect(await financial.runDueSchedules(new Date())).toMatchObject({ run: 1, failed: 0 });
    const t = (await testPool().query<{ transaction_id: string; provider_ref: string; pledge_id: string; code: string }>(
      `SELECT t.transaction_id, t.provider_ref, t.pledge_id, f.code FROM transactions t JOIN funds f ON f.fund_id = t.fund_id WHERE t.schedule_id = $1`, [sched.schedule_id],
    )).rows;
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ pledge_id: h.pledge_id, code: "mission" });
    await testPool().query(`UPDATE transactions SET created_at = '2026-09-20 05:00:00+00' WHERE transaction_id = $1`, [t[0]!.transaction_id]);
    await callback(t[0]!.provider_ref, "succeeded");
    const st = await statement();
    expect(st.payments).toHaveLength(1);
    expect(st.payments[0]).toMatchObject({ transaction_id: t[0]!.transaction_id, pledge_id: h.pledge_id, pledge_title: "Kenya trip", fund: "mission", method: "mpesa" });
    expect(await row(h.pledge_id)).toMatchObject({ paid_minor: 100_000, kept: 1, due_count: 1 });
  });

  // ── (i) ──
  it("(i) renaming the pledge renames it on payments already made (and on one still pending) — and clearing the name restores the derived one", async () => {
    const i = await pledge({ shape: "monthly", amount_minor: 100_000, due_day: 20, fund: "mission" }, "2026-09-01 08:00:00+00");
    const done = await paid({ amount_minor: 100_000, pledge_id: i.pledge_id }, "2026-09-19 07:00:00+00");
    await mpesaIntent({ amount_minor: 100_000, pledge_id: i.pledge_id }, "2026-09-20 08:00:00+00");
    expect((await statement()).payments[0]!.pledge_title).toBe("Missions");

    await partners.updatePledge(user, i.pledge_id, { title: "Kenya mission" });
    const st = await statement();
    expect(st.payments[0]!.pledge_title).toBe("Kenya mission");
    expect(st.pending[0]!.pledge_title).toBe("Kenya mission");
    expect(st.by_pledge.find((b) => b.pledge_id === i.pledge_id)?.title).toBe("Kenya mission");
    expect(st.pledges[0]!.title).toBe("Kenya mission");
    const history = (await financial.listGiving(user)) as { transaction_id: string; pledge_title: string | null }[];
    expect(history.find((r) => r.transaction_id === done.transaction_id)?.pledge_title).toBe("Kenya mission");
    expect(((await financial.givingDetail(user, done.transaction_id)).pledge as { title: string }).title).toBe("Kenya mission");

    await partners.updatePledge(user, i.pledge_id, { title: null });
    expect((await statement()).payments[0]!.pledge_title).toBe("Missions");
  });

  // ── (j) ──
  it("(j) cancelling a pledge after paying keeps the money in paid and the pledge in that year's pledges[]", async () => {
    const j = await pledge({ shape: "monthly", amount_minor: 100_000, due_day: 5, title: "Old promise" }, "2026-07-01 08:00:00+00");
    await paid({ amount_minor: 100_000, pledge_id: j.pledge_id }, "2026-07-03 07:00:00+00");
    await paid({ amount_minor: 100_000, pledge_id: j.pledge_id }, "2026-08-05 07:00:00+00");
    await partners.updatePledge(user, j.pledge_id, { status: "cancelled" });
    const st = await statement();
    expect(st.paid_minor).toBe(200_000);
    expect(st.payments).toHaveLength(2);
    expect(st.pledges.map((p) => p.pledge_id)).toEqual([j.pledge_id]);
    expect(st.pledges[0]).toMatchObject({ status: "cancelled", pledged_minor: 0, paid_minor: 200_000, remaining_year_minor: 0, kept: 2, due_count: 3 });
    expect(st.pledged_minor).toBe(0);
    expect(st.by_pledge.find((b) => b.pledge_id === j.pledge_id)?.total_minor).toBe(200_000);
    // The strip and faithfulness read pledges not cancelled (as §3a's Pledged does).
    expect(st.months.every((m) => m.status === "none")).toBe(true);
    expect(st.faithfulness).toEqual({ kept_on_time: 0, late: 0, missed: 0, due_count: 0 });
  });

  // ── (k) ──
  it("(k) pays_to is exactly the fund the intent books — fund, campaign, need, general (default, and its fallback) — on every pledge object", async () => {
    const campaigns = new CampaignService(testPool());
    const campaign = await campaigns.create(cong, admin, { title: "New roof", blurb: "The hall leaks every rainy season.", fund: "media", goal_minor: 1_000_000, currency: "KES", starts_on: "2000-01-01", ends_on: "2099-12-31" });
    await campaigns.setStatus(cong, String(campaign.campaign_id), "live");
    const departments = new DepartmentsService(testPool(), notifications);
    const dept = await departments.create(admin, cong, { name: "Hospitality", purpose: "Tea", leader_user_id: leader, gift_keys: [], fund_code: "offering", is_open_to_join: true });
    const need = await departments.submitNeed(leader, String(dept.department_id), { title: "Urns", why: "Two urns for Sunday tea after service.", target_minor: 500_000, currency: "KES" });
    await departments.decideNeed(admin, String(need.need_id), "approve");

    const cases: [string, Record<string, unknown>, string][] = [
      ["fund", { fund: "mission" }, "mission"],
      ["campaign", { campaign_id: String(campaign.campaign_id) }, "media"],
      ["need", { need_id: String(need.need_id) }, "offering"],
      ["general", {}, DEFAULT_PLEDGE_FUND],
    ];
    const created: Record<string, Pledge> = {};
    for (const [kind, target, code] of cases) {
      const p = await pledge({ shape: "monthly", amount_minor: 10_000, due_day: 20, ...target }, "2026-09-01 08:00:00+00");
      created[kind] = p;
      const fundName = (await testPool().query<{ name: string }>(`SELECT name FROM funds WHERE code = $1`, [code])).rows[0]!.name;
      expect(p.pays_to, kind).toEqual({ code, name: fundName });
      // The intent — sent with the WRONG chip ("tithe") — books exactly pays_to.
      const intent = await mpesaIntent({ amount_minor: 10_000, pledge_id: p.pledge_id }, "2026-09-20 07:00:00+00");
      expect(intent.fund, kind).toEqual(p.pays_to);
      const booked = (await testPool().query<{ code: string }>(`SELECT f.code FROM transactions t JOIN funds f ON f.fund_id = t.fund_id WHERE t.transaction_id = $1`, [intent.transaction_id])).rows[0]!.code;
      expect(booked, kind).toBe(code);
      expect(await financial.pledgeFundCode(p.pledge_id), kind).toBe(code);
    }

    // The same pays_to on every pledge object the API returns.
    const ids = Object.values(created).map((p) => p.pledge_id);
    const expected = Object.fromEntries(Object.values(created).map((p) => [p.pledge_id, p.pays_to]));
    const pick = (list: { pledge_id?: string; id?: string; pays_to?: unknown; kind?: string }[]) =>
      Object.fromEntries(list.filter((x) => ids.includes(String(x.pledge_id ?? x.id))).map((x) => [String(x.pledge_id ?? x.id), x.pays_to]));
    expect(pick((await partners.listPledges(user, now)) as never)).toEqual(expected);
    const ship = await partners.partnership(user, now);
    expect(pick(ship.pledges as never)).toEqual(expected);
    expect(pick((ship.due as { kind: string }[]).filter((d) => d.kind === "pledge") as never)).toEqual(expected);
    expect(pick((await statement()).pledges as never)).toEqual(expected);
    expect(pick((await partners.adminDetail(user)).pledges as never)).toEqual(expected);
    for (const id of ids) expect((await partners.getPledge(user, id)).pays_to).toEqual(expected[id]);
    const updated = await partners.updatePledge(user, created.fund!.pledge_id, { note: "for the trip" });
    expect(updated.pays_to).toEqual(expected[created.fund!.pledge_id]);

    // General pledge, programme default inactive → the first active fund by code, and the money follows.
    await testPool().query(`UPDATE funds SET is_active = FALSE WHERE code = $1`, [DEFAULT_PLEDGE_FUND]);
    const general = await partners.getPledge(user, created.general!.pledge_id);
    expect(general.pays_to).toEqual({ code: "general", name: (await testPool().query<{ name: string }>(`SELECT name FROM funds WHERE code = 'general'`)).rows[0]!.name });
    const moved = await mpesaIntent({ amount_minor: 10_000, pledge_id: created.general!.pledge_id }, "2026-09-20 07:10:00+00");
    expect(moved.fund).toEqual(general.pays_to);
  });

  // ── (l) ──
  it("(l) a pledge with no fund, campaign or need is titled 'General partnership' everywhere it is named", async () => {
    const l = await pledge({ shape: "monthly", amount_minor: 100_000, due_day: 20 }, "2026-09-01 08:00:00+00");
    expect(l).toMatchObject({ title: "General partnership", custom_title: null });
    const intent = await paid({ amount_minor: 100_000, pledge_id: l.pledge_id }, "2026-09-20 07:00:00+00");
    expect(intent.pledge).toEqual({ pledge_id: l.pledge_id, title: "General partnership" });
    const st = await statement();
    expect(st.pledges[0]!.title).toBe("General partnership");
    expect(st.payments[0]!.pledge_title).toBe("General partnership");
    expect(st.by_pledge[0]!.title).toBe("General partnership");
    expect(((await partners.partnership(user, now)).pledges as { title: string }[])[0]!.title).toBe("General partnership");
    expect(((await financial.listGiving(user)) as { pledge_title: string | null }[])[0]!.pledge_title).toBe("General partnership");
    expect(((await financial.givingDetail(user, intent.transaction_id)).pledge as { title: string }).title).toBe("General partnership");
    await partners.createClaim(user, l.pledge_id, { amount_minor: 500, currency: "KES", paid_on: "2026-09-19" });
    expect((await partners.pendingClaims())[0]!.pledge_title).toBe("General partnership");
    const pdf = (await partners.partnersStatementPdf(user, 2026, now)).pdf.toString("latin1");
    expect(pdf).toContain("General partnership");
    expect(pdf).not.toMatch(/\(Partnership\b/);
  });

  // ── (m) ──
  it("(m) the office's 'behind' reads the same ledger: a late payment clears it, unless another instalment is still missed", async () => {
    const sep3 = new Date("2026-09-03T09:00:00Z"); // two days before September's instalment
    const a = await pledge({ shape: "monthly", amount_minor: 100_000, due_day: 5, title: "Kenya trip" }, "2026-07-20 08:00:00+00"); // first due 5 Aug
    const behindIds = async () => ((await partners.adminList({ status: "behind", sort: "recent" }, sep3)).data as { user_id: string }[]).map((d) => d.user_id);
    const label = async (id: string) => (((await partners.adminDetail(user, sep3)).pledges as { pledge_id: string; progress: { label: string; overdue_since: string | null } }[]).find((p) => p.pledge_id === id)!.progress);
    expect(await behindIds()).toEqual([user]);
    expect(await label(a.pledge_id)).toMatchObject({ label: "behind", overdue_since: "2026-08-05" });
    // Paid late on 2 Sep: August completes (late), September is not due yet → on track, not behind.
    await paid({ amount_minor: 100_000, pledge_id: a.pledge_id }, "2026-09-02 07:00:00+00");
    expect(await label(a.pledge_id)).toMatchObject({ label: "on_track", overdue_since: null });
    expect(await behindIds()).toEqual([]);
    expect(await partners.remindBehind(admin, notifications, sep3)).toEqual({ partners: 0, reminded: 0, skipped: 0 });
    // Another pledge with two instalments missed, one of them paid late: still behind.
    const b = await pledge({ shape: "monthly", amount_minor: 50_000, due_day: 1, title: "Choir" }, "2026-06-20 08:00:00+00"); // due 1 Jul, 1 Aug, 1 Sep
    await paid({ amount_minor: 50_000, pledge_id: b.pledge_id }, "2026-09-02 07:30:00+00"); // settles July, late
    expect(await label(b.pledge_id)).toMatchObject({ label: "behind", overdue_since: "2026-08-01" });
    expect(await behindIds()).toEqual([user]);
    const list = await partners.adminList({ status: "all", sort: "recent" }, sep3);
    expect((list.data as { user_id: string; behind: boolean; next_due_on: string }[])[0]).toMatchObject({ user_id: user, behind: true, next_due_on: "2026-08-01" });
    expect((await partners.remindBehind(admin, notifications, sep3)).partners).toBe(1);
  });

  // ── (n) ──
  it("(n) reminders follow the ledger: 'due soon' asks for what is left; follow-ups stop the moment the instalment is completed (late, or by a spill-over)", async () => {
    const a = await pledge({ shape: "monthly", amount_minor: 100_000, due_day: 5 }, "2026-07-20 08:00:00+00"); // first due 5 Aug
    await paid({ amount_minor: 150_000, pledge_id: a.pledge_id }, "2026-08-04 07:00:00+00"); // August + 500 spilling into September
    const asked = async (template: string) => (await testPool().query<{ payload: { amount_minor: number; due_on: string } }>(
      `SELECT payload FROM notifications WHERE user_id = $1 AND template = $2 ORDER BY scheduled_for DESC LIMIT 1`, [user, template],
    )).rows[0]?.payload;
    // 3 September, two days out: due soon — for the 500 still uncovered, not the whole 1,000.
    expect((await partners.sendDueReminders(notifications, new Date("2026-09-03T09:00:00Z"))).due_soon).toBe(1);
    expect(await asked("pledge_due_soon")).toMatchObject({ amount_minor: 50_000, due_on: "2026-09-05" });
    // 6 September 09:01 UTC (+12 h after the 5th ended): first follow-up, for the same 500.
    expect((await partners.sendDueReminders(notifications, new Date("2026-09-06T09:01:00Z"))).follow_ups).toBe(1);
    expect(await asked("pledge_overdue")).toMatchObject({ amount_minor: 50_000, due_on: "2026-09-05" });
    // The member tops up the 500 late: September completes → no further follow-ups for it.
    await paid({ amount_minor: 50_000, pledge_id: a.pledge_id }, "2026-09-06 10:00:00+00");
    expect(await partners.sendDueReminders(notifications, new Date("2026-09-06T21:01:00Z"))).toEqual({ due_soon: 0, follow_ups: 0 });
    expect(await partners.sendDueReminders(notifications, new Date("2026-09-07T09:01:00Z"))).toEqual({ due_soon: 0, follow_ups: 0 });
    const steps = await testPool().query(`SELECT due_on::text, sequence FROM pledge_reminders WHERE pledge_id = $1 ORDER BY sent_at`, [a.pledge_id]);
    expect(steps.rows).toEqual([{ due_on: "2026-09-05", sequence: 0 }, { due_on: "2026-09-05", sequence: 1 }]);
    // A payment that spills over completes the next instalment too: nothing is sent for it.
    await paid({ amount_minor: 100_000, pledge_id: a.pledge_id }, "2026-09-20 07:00:00+00"); // October, paid early
    expect(await partners.sendDueReminders(notifications, new Date("2026-10-03T09:00:00Z"))).toEqual({ due_soon: 0, follow_ups: 0 });
  });

  // ── (o) ──
  it("(o) a DUE row carries pending_minor while a payment toward it is in its 15-minute checkout window; an older one never blocks paying; settled, the row leaves", async () => {
    const o = await pledge({ shape: "monthly", amount_minor: 100_000, due_day: 20 }, "2026-09-01 08:00:00+00"); // due today
    const desk = await pledge({ shape: "total", target_minor: 500_000, due_on: "2026-12-31", title: "Sound desk" }, "2026-09-01 08:00:00+00");
    const dueRows = async () => (await partners.partnership(user, now)).due as { id: string; amount_minor: number; pending_minor: number }[];
    const row = async () => (await dueRows()).find((d) => d.id === o.pledge_id);
    expect(await row()).toMatchObject({ amount_minor: 100_000, pending_minor: 0 });

    const push = await mpesaIntent({ amount_minor: 100_000, pledge_id: o.pledge_id }, "2026-09-20 08:55:00+00"); // STK push, 5 minutes ago
    await mpesaIntent({ amount_minor: 30_000, pledge_id: desk.pledge_id }, "2026-09-20 08:58:00+00");         // another pledge's
    await mpesaIntent({ amount_minor: 7_000 }, "2026-09-20 08:58:00+00");                                        // a plain gift
    expect(await row()).toMatchObject({ amount_minor: 100_000, pending_minor: 100_000 }); // → "Processing", not Pay
    expect((await dueRows()).find((d) => d.id === desk.pledge_id)?.pending_minor).toBe(30_000);

    // 16 minutes on (pinned), the push is out of its window: Pay is offered again —
    // while the statement still lists it as pending for 48 hours.
    await testPool().query(`UPDATE transactions SET created_at = '2026-09-20 08:44:00+00' WHERE transaction_id = $1`, [push.transaction_id]);
    expect(await row()).toMatchObject({ amount_minor: 100_000, pending_minor: 0 });
    expect((await statement()).pending.map((x) => x.transaction_id)).toContain(push.transaction_id);

    // It settles: September's instalment is complete, so the row leaves the DUE list (the ledger).
    await callback(push.provider_ref, "succeeded");
    expect(await row()).toBeUndefined();
    expect((await statement()).pending.map((x) => x.transaction_id)).not.toContain(push.transaction_id);
  });
});
