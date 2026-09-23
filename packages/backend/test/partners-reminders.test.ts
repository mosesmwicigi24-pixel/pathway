// Reminders and claims (docs/PARTNERS_PROGRAMME.md §3): three days before,
// then up to three follow-ups twelve hours apart, never twice for one due
// date; the office's manual reminder respects the same spacing; a confirmed
// "I paid another way" is a real ledger-posted gift.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { PartnersService } from "../src/modules/financial/partners.js";
import { NotificationService } from "../src/modules/notifications/service.js";
import { PledgeReminderScanner } from "../src/workers/pledgeReminderScanner.js";

const H = 3_600_000;
/** Nairobi noon on a calendar date, as an instant. */
const noon = (ymd: string): number => new Date(`${ymd}T09:00:00Z`).getTime();

describe("pledge reminders", () => {
  let user: string; let admin: string;
  let clock = noon("2030-03-10");
  let partners: PartnersService; let notifications: NotificationService; let scanner: PledgeReminderScanner;

  const sentTemplates = async (): Promise<string[]> =>
    (await testPool().query(`SELECT DISTINCT template, min(scheduled_for) AS first FROM notifications WHERE user_id = $1 AND status <> 'suppressed' GROUP BY template ORDER BY first`, [user])).rows.map((r: { template: string }) => r.template);

  beforeEach(async () => {
    await resetDb();
    const cong = await createCongregation();
    user = (await createUser({ congregationId: cong })).user_id;
    admin = (await createUser({ congregationId: cong })).user_id;
    clock = noon("2030-03-10");
    partners = new PartnersService(testPool());
    notifications = new NotificationService(testPool(), () => clock);
    scanner = new PledgeReminderScanner(testPool(), notifications);
  });
  afterAll(async () => { await closeTestPool(); });

  it("a total pledge due in three days gets ONE due-soon notice, not two", async () => {
    await partners.createPledge(user, { shape: "total", target_minor: 100_000, currency: "KES", due_on: "2030-03-13", reminders_enabled: true });
    let r = await scanner.scanOnce(new Date(clock));
    expect(r.due_soon).toBe(1);
    r = await scanner.scanOnce(new Date(clock + 2 * H));
    expect(r.due_soon).toBe(0);
    expect(await sentTemplates()).toEqual(["pledge_due_soon"]);
  });

  it("after the due date: follow-ups at +12h, +24h, +36h and then silence; a payment stops them", async () => {
    const pledge = await partners.createPledge(user, { shape: "total", target_minor: 100_000, currency: "KES", due_on: "2030-03-10", reminders_enabled: true });
    // due day (10th) — nothing overdue yet; a due-soon notice may go out
    await scanner.scanOnce(new Date(noon("2030-03-10")));
    const dueEnd = new Date("2030-03-10T21:00:00Z").getTime(); // end of the Nairobi day
    // +6h: too early for the first follow-up
    expect((await scanner.scanOnce(new Date(dueEnd + 6 * H))).follow_ups).toBe(0);
    expect((await scanner.scanOnce(new Date(dueEnd + 12 * H + 60_000))).follow_ups).toBe(1);
    // 30 minutes later: nothing (spacing)
    clock = dueEnd + 12 * H + 30 * 60_000;
    expect((await scanner.scanOnce(new Date(clock))).follow_ups).toBe(0);
    clock = dueEnd + 24 * H + 60_000;
    expect((await scanner.scanOnce(new Date(clock))).follow_ups).toBe(1);
    // the member pays in full before the third
    await testPool().query(
      `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, idempotency_key, pledge_id, settled_at)
       VALUES ($1, (SELECT fund_id FROM funds WHERE code = 'tithe'), 100000, 'KES', 'succeeded', 'mpesa', 'paid-1', $2, now())`,
      [user, pledge.pledge_id],
    );
    clock = dueEnd + 36 * H + 60_000;
    const after = await scanner.scanOnce(new Date(clock));
    expect(after.follow_ups).toBe(0);
    expect(after.fulfilled).toBe(1);
    const rows = await testPool().query(`SELECT sequence FROM pledge_reminders WHERE pledge_id = $1 AND kind = 'auto' ORDER BY sequence`, [pledge.pledge_id]);
    expect(rows.rows.map((x: { sequence: number }) => x.sequence)).toEqual([0, 1, 2]);
    const steps = await testPool().query(`SELECT count(DISTINCT payload->>'sequence')::int AS n FROM notifications WHERE user_id = $1 AND template = 'pledge_overdue' AND status <> 'suppressed'`, [user]);
    expect(steps.rows[0].n).toBe(2); // one reminder per step, fanned out to the member's channels
    expect(await sentTemplates()).toContain("pledge_fulfilled");
  });

  it("never more than three follow-ups for one due date", async () => {
    const pledge = await partners.createPledge(user, { shape: "total", target_minor: 100_000, currency: "KES", due_on: "2030-03-10", reminders_enabled: true });
    const dueEnd = new Date("2030-03-10T21:00:00Z").getTime();
    for (const h of [12, 24, 36, 48, 72]) { clock = dueEnd + h * H + 60_000; await scanner.scanOnce(new Date(clock)); }
    const n = await testPool().query(`SELECT count(*)::int AS n FROM pledge_reminders WHERE pledge_id = $1 AND kind = 'auto' AND sequence > 0`, [pledge.pledge_id]);
    expect(n.rows[0].n).toBe(3);
  });

  it("reminders switched off on the pledge means no reminders", async () => {
    await partners.createPledge(user, { shape: "total", target_minor: 100_000, currency: "KES", due_on: "2030-03-12", reminders_enabled: false });
    expect((await scanner.scanOnce(new Date(clock))).due_soon).toBe(0);
  });

  it("the office's manual reminder is spaced twelve hours from any other", async () => {
    const pledge = await partners.createPledge(user, { shape: "monthly", amount_minor: 100_000, currency: "KES", due_day: 20, reminders_enabled: true });
    const first = await partners.adminRemind(admin, user, notifications, { pledge_id: String(pledge.pledge_id), message: "Karibu — a gentle reminder." }, new Date(clock));
    expect(first).toEqual({ reminded: 1, skipped: 0 });
    const second = await partners.adminRemind(admin, user, notifications, { pledge_id: String(pledge.pledge_id) }, new Date(clock + 3 * H));
    expect(second).toEqual({ reminded: 0, skipped: 1 });
    const third = await partners.adminRemind(admin, user, notifications, {}, new Date(clock + 13 * H));
    expect(third.reminded).toBe(1);
    const log = await testPool().query(`SELECT kind, sent_by FROM pledge_reminders WHERE pledge_id = $1`, [pledge.pledge_id]);
    expect(log.rows.every((r: { kind: string; sent_by: string }) => r.kind === "manual" && r.sent_by === admin)).toBe(true);
  });

  it("a confirmed 'I paid another way' is a real manual gift: attributed, ledger-posted, receipted", async () => {
    const pledge = await partners.createPledge(user, { shape: "total", target_minor: 50_000, currency: "KES", due_on: "2030-06-01", fund: "mission", reminders_enabled: true });
    const claim = await partners.createClaim(user, String(pledge.pledge_id), { amount_minor: 50_000, currency: "KES", paid_on: "2030-03-09", note: "cash at the office" });
    expect(claim.status).toBe("pending");
    expect((await partners.pendingClaims()).length).toBe(1);
    const decided = await partners.decideClaim(admin, String(claim.claim_id), "confirm", notifications);
    expect(decided.status).toBe("confirmed");
    const txn = await testPool().query(`SELECT status, provider, pledge_id, fund_id = (SELECT fund_id FROM funds WHERE code = 'mission') AS mission FROM transactions WHERE transaction_id = $1`, [decided.transaction_id]);
    expect(txn.rows[0]).toMatchObject({ status: "succeeded", provider: "manual", pledge_id: pledge.pledge_id, mission: true });
    const ledger = await testPool().query(`SELECT account, side::text AS side FROM ledger_entries WHERE transaction_id = $1 ORDER BY account`, [decided.transaction_id]);
    expect(ledger.rows).toEqual([{ account: "cash:manual", side: "debit" }, { account: "fund:mission", side: "credit" }]);
    const receipt = await testPool().query(`SELECT 1 FROM outbox WHERE topic = 'giving.receipt' AND payload->>'transaction_id' = $1`, [decided.transaction_id]);
    expect(receipt.rowCount).toBe(1);
    const detail = await partners.getPledge(user, String(pledge.pledge_id));
    expect((detail.progress as { label: string }).label).toBe("fulfilled");
    await expect(partners.decideClaim(admin, String(claim.claim_id), "reject", notifications)).rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });
});
