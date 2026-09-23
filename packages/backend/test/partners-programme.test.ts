// The Partners programme (docs/PARTNERS_PROGRAMME.md): join without money,
// pledges with computed progress, attribution written at giving time,
// statements by pledge and by fund, and the admin list.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { FinancialService } from "../src/modules/financial/service.js";
import { PartnersService } from "../src/modules/financial/partners.js";
import type { PaymentGateway } from "../src/modules/financial/gateway.js";

class FakeGateway implements PaymentGateway {
  private n = 0;
  async createIntent(): Promise<{ id: string; client_secret: string }> {
    this.n += 1;
    return { id: `pi_test_${this.n}`, client_secret: `cs_${this.n}` };
  }
  verifyWebhook(): never { throw new Error("not used in these tests"); }
}

describe("Partners programme", () => {
  let user: string;
  let other: string;
  let financial: FinancialService;
  let partners: PartnersService;

  beforeEach(async () => {
    await resetDb();
    const cong = await createCongregation();
    user = (await createUser({ congregationId: cong })).user_id;
    other = (await createUser({ congregationId: cong })).user_id;
    financial = new FinancialService(testPool(), new FakeGateway());
    partners = new PartnersService(testPool(), financial);
  });
  afterAll(async () => { await closeTestPool(); });

  it("joining needs no money and is idempotent", async () => {
    const first = await partners.join(user);
    expect(first.status).toBe("active");
    const again = await partners.join(user);
    expect(again.joined_at).toBe(first.joined_at);
    const p = await partners.partnership(user);
    expect(p.is_partner).toBe(true);
    expect((p.membership as { status: string }).status).toBe("active");
    expect(p.pledges).toEqual([]);
  });

  it("a monthly pledge with 'charge me automatically' binds a schedule, and its charges are attributed", async () => {
    const pledge = await partners.createPledge(user, {
      shape: "monthly", amount_minor: 500_000, currency: "KES", due_day: 15, fund: "tithe",
      reminders_enabled: true, auto_schedule: { method: "mpesa", frequency: "monthly" },
    });
    expect(pledge.status).toBe("active");
    expect(pledge.schedule_id).toBeTruthy();
    const sched = await testPool().query(`SELECT pledge_id, frequency FROM giving_schedules WHERE schedule_id = $1`, [pledge.schedule_id]);
    expect(sched.rows[0].pledge_id).toBe(pledge.pledge_id);
    expect(sched.rows[0].frequency).toBe("monthly");
    // A gift made from the pledge's "Pay now" carries pledge_id into the transaction.
    const gift = await financial.createGivingIntent(user, { fund: "tithe", amount_minor: 500_000, currency: "KES", method: "card", pledge_id: String(pledge.pledge_id) } as never);
    const txn = await testPool().query(`SELECT pledge_id FROM transactions WHERE transaction_id = $1`, [gift.transaction_id]);
    expect(txn.rows[0].pledge_id).toBe(pledge.pledge_id);
  });

  it("progress: a total pledge reads on track, then fulfilled once payments reach the target", async () => {
    const pledge = await partners.createPledge(user, { shape: "total", target_minor: 100_000, currency: "KES", due_on: "2099-12-31", reminders_enabled: true });
    let detail = await partners.getPledge(user, String(pledge.pledge_id));
    expect((detail.progress as { label: string }).label).toBe("on_track");
    // two succeeded payments attributed to it
    for (let i = 0; i < 2; i++) {
      const g = await financial.createGivingIntent(user, { fund: "offering", amount_minor: 50_000, currency: "KES", method: "card", pledge_id: String(pledge.pledge_id) } as never);
      await testPool().query(`UPDATE transactions SET status = 'succeeded', settled_at = now() WHERE transaction_id = $1`, [g.transaction_id]);
    }
    detail = await partners.getPledge(user, String(pledge.pledge_id));
    expect((detail.progress as { paid_minor: number; label: string }).paid_minor).toBe(100_000);
    expect((detail.progress as { label: string }).label).toBe("fulfilled");
    expect((detail.payments as unknown[]).length).toBe(2);
  });

  it("a total pledge past its date and short of target reads behind", async () => {
    const pledge = await partners.createPledge(user, { shape: "total", target_minor: 100_000, currency: "KES", due_on: "2020-01-01", reminders_enabled: true });
    const detail = await partners.getPledge(user, String(pledge.pledge_id));
    expect((detail.progress as { label: string; overdue_since: string }).label).toBe("behind");
    expect((detail.progress as { overdue_since: string }).overdue_since).toBe("2020-01-01");
  });

  it("someone else cannot read, edit, or pay toward my pledge", async () => {
    const pledge = await partners.createPledge(user, { shape: "monthly", amount_minor: 100_000, currency: "KES", due_day: 5, reminders_enabled: true });
    await expect(partners.getPledge(other, String(pledge.pledge_id))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(partners.updatePledge(other, String(pledge.pledge_id), { status: "cancelled" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      financial.createGivingIntent(other, { fund: "tithe", amount_minor: 1_000, currency: "KES", method: "card", pledge_id: String(pledge.pledge_id) } as never),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });

  it("pausing and cancelling a pledge carries its bound schedule along", async () => {
    const pledge = await partners.createPledge(user, {
      shape: "monthly", amount_minor: 200_000, currency: "KES", due_day: 1, fund: "tithe", reminders_enabled: true,
      auto_schedule: { method: "airtel", frequency: "monthly" },
    });
    const paused = await partners.updatePledge(user, String(pledge.pledge_id), { status: "paused" });
    expect((paused.progress as { label: string }).label).toBe("paused");
    let s = await testPool().query(`SELECT status FROM giving_schedules WHERE schedule_id = $1`, [pledge.schedule_id]);
    expect(s.rows[0].status).toBe("paused");
    await partners.updatePledge(user, String(pledge.pledge_id), { status: "active" });
    s = await testPool().query(`SELECT status FROM giving_schedules WHERE schedule_id = $1`, [pledge.schedule_id]);
    expect(s.rows[0].status).toBe("active");
    await partners.updatePledge(user, String(pledge.pledge_id), { status: "cancelled" });
    s = await testPool().query(`SELECT status FROM giving_schedules WHERE schedule_id = $1`, [pledge.schedule_id]);
    expect(s.rows[0].status).toBe("cancelled");
    await expect(partners.updatePledge(user, String(pledge.pledge_id), { amount_minor: 1 })).rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });

  it("statements group the year's succeeded gifts by pledge and by fund", async () => {
    const pledge = await partners.createPledge(user, { shape: "monthly", amount_minor: 100_000, currency: "KES", due_day: 10, fund: "mission", reminders_enabled: true });
    const a = await financial.createGivingIntent(user, { fund: "mission", amount_minor: 100_000, currency: "KES", method: "card", pledge_id: String(pledge.pledge_id) } as never);
    const b = await financial.createGivingIntent(user, { fund: "offering", amount_minor: 30_000, currency: "KES", method: "card" } as never);
    await testPool().query(`UPDATE transactions SET status = 'succeeded', settled_at = now() WHERE transaction_id = ANY($1::uuid[])`, [[a.transaction_id, b.transaction_id]]);
    const st = await partners.statements(user);
    expect(st.total_minor).toBe(130_000);
    const byPledge = st.by_pledge as { pledge_id: string | null; total_minor: number }[];
    expect(byPledge.find((x) => x.pledge_id === pledge.pledge_id)?.total_minor).toBe(100_000);
    expect(byPledge.find((x) => x.pledge_id === null)?.total_minor).toBe(30_000);
    const byFund = st.by_fund as { code: string; total_minor: number }[];
    expect(byFund.find((x) => x.code === "offering")?.total_minor).toBe(30_000);
  });

  it("the admin list counts partners, commitments and who is behind", async () => {
    await partners.join(user);
    await partners.createPledge(user, { shape: "total", target_minor: 100_000, currency: "KES", due_on: "2020-01-01", reminders_enabled: true });
    await partners.createPledge(other, { shape: "monthly", amount_minor: 500_000, currency: "KES", due_day: 20, reminders_enabled: true });
    const list = await partners.adminList({ status: "all", sort: "committed" });
    const summary = list.summary as { partners: number; behind: number; committed_monthly_minor: number; active_pledges: number };
    expect(summary.partners).toBe(2);
    expect(summary.behind).toBe(1);
    expect(summary.committed_monthly_minor).toBe(500_000);
    expect(summary.active_pledges).toBe(2);
    const behindOnly = await partners.adminList({ status: "behind", sort: "recent" });
    expect((behindOnly.data as { user_id: string }[]).map((d) => d.user_id)).toEqual([user]);
    const detail = await partners.adminDetail(other);
    expect((detail.member as { tier: { disciples_per_year: number } | null }).tier?.disciples_per_year).toBe(3);
  });
});
