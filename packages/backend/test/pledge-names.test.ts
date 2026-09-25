// Pledge names + server-authoritative pledge money (migration 215; owner, 2026-09-25).
//
//   · A pledge may carry the member's own name; null keeps the derived title,
//     and the DUE list, statements and the office's claim queue use it too.
//   · GET /giving/partnership lists what a new pledge may point at, in order,
//     in every state — including before the member has joined.
//   · Money made FROM a pledge lands in the pledge's fund. The client's fund
//     chip is never honoured for pledge money: the gift, the schedule that
//     charges it, and a confirmed "I paid another way" all route through ONE
//     helper (FinancialService.pledgeFundCode), so a pledge never splits
//     across funds by client. This is the bug that started it: "Pay" on a
//     pledge instalment charged the Tithe chip instead of the pledge's target.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { FinancialService } from "../src/modules/financial/service.js";
import { PartnersService, type PledgeOption } from "../src/modules/financial/partners.js";
import { CampaignService } from "../src/modules/financial/campaigns.js";
import { DepartmentsService } from "../src/modules/departments/service.js";
import { NotificationService } from "../src/modules/notifications/service.js";
import { DEFAULT_PLEDGE_FUND } from "../src/modules/financial/constants.js";
import type { PaymentGateway } from "../src/modules/financial/gateway.js";

class FakeGateway implements PaymentGateway {
  private n = 0;
  async createIntent(): Promise<{ id: string; client_secret: string }> {
    this.n += 1;
    return { id: `pi_test_${this.n}`, client_secret: `cs_${this.n}` };
  }
  verifyWebhook(): never { throw new Error("not used in these tests"); }
}

/** The fund code a transaction was booked to. */
async function fundOf(transactionId: unknown): Promise<string> {
  const r = await testPool().query<{ code: string }>(
    `SELECT f.code FROM transactions t JOIN funds f ON f.fund_id = t.fund_id WHERE t.transaction_id = $1`,
    [transactionId],
  );
  return r.rows[0]!.code;
}

/** The test seed carries general/gift/media/mission/offering/tithe — NOT the
 *  programme default. Tests that want the default seed it explicitly. */
const seedDiscipleship = () =>
  testPool().query(`INSERT INTO funds (code, name, is_active) VALUES ($1, 'Discipleship', TRUE) ON CONFLICT (code) DO NOTHING`, [DEFAULT_PLEDGE_FUND]);

describe("pledge names + pledge money routing", () => {
  let cong: string; let user: string; let admin: string; let leader: string;
  let financial: FinancialService; let partners: PartnersService;
  let campaigns: CampaignService; let departments: DepartmentsService; let notifications: NotificationService;

  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation();
    user = (await createUser({ congregationId: cong })).user_id;
    admin = (await createUser({ congregationId: cong })).user_id;
    leader = (await createUser({ congregationId: cong })).user_id;
    financial = new FinancialService(testPool(), new FakeGateway());
    partners = new PartnersService(testPool(), financial);
    campaigns = new CampaignService(testPool());
    notifications = new NotificationService(testPool());
    departments = new DepartmentsService(testPool(), notifications);
  });
  afterAll(async () => { await closeTestPool(); });

  /** A campaign on `fund`, live today, in `congregation` (default: the member's). */
  async function liveCampaign(fund: string, title = "New roof", congregation = cong, by = admin): Promise<string> {
    const c = await campaigns.create(congregation, by, {
      title, blurb: "The hall leaks every rainy season.", fund, goal_minor: 1_000_000, currency: "KES", starts_on: "2000-01-01", ends_on: "2099-12-31",
    });
    await campaigns.setStatus(congregation, String(c.campaign_id), "live");
    return String(c.campaign_id);
  }
  /** An approved need on a fresh department whose money belongs to `fundCode`. */
  async function approvedNeed(fundCode: string | null, title = "Roof sheets", congregation = cong, by = admin, lead = leader): Promise<{ need_id: string; department_id: string }> {
    const d = await departments.create(by, congregation, { name: `Building ${title}`, purpose: "The roof", leader_user_id: lead, gift_keys: [], fund_code: fundCode, is_open_to_join: true });
    const n = await departments.submitNeed(lead, String(d.department_id), { title, why: "The rains are coming and the hall leaks.", target_minor: 200_000, currency: "KES" });
    await departments.decideNeed(by, String(n.need_id), "approve");
    return { need_id: String(n.need_id), department_id: String(d.department_id) };
  }
  const payFromPledge = (pledgeId: unknown, extra: Record<string, unknown> = {}) =>
    financial.createGivingIntent(user, { fund: "tithe", amount_minor: 1_000, currency: "KES", method: "card", pledge_id: String(pledgeId), ...extra } as never);

  // ── (i) names ───────────────────────────────────────────────────────────

  it("a custom title round-trips create → list → get → due; PATCH title: null restores the derived name", async () => {
    // Through the zod schema, as the route does: the name is trimmed.
    const input = PartnersService.CreatePledge.parse({ shape: "monthly", amount_minor: 100_000, currency: "KES", due_day: 15, fund: "mission", title: "  School fees for Amani " });
    const created = await partners.createPledge(user, input);
    expect(created.title).toBe("School fees for Amani");
    expect(created.custom_title).toBe("School fees for Amani");
    const [listed] = await partners.listPledges(user);
    expect(listed!.title).toBe("School fees for Amani");
    const got = await partners.getPledge(user, String(created.pledge_id));
    expect(got.title).toBe("School fees for Amani");
    expect(got.custom_title).toBe("School fees for Amani");
    // The DUE list on the partnership payload carries the same words.
    const due = (await partners.partnership(user)).due as { id: string; title: string }[];
    expect(due.find((d) => d.id === created.pledge_id)?.title).toBe("School fees for Amani");

    // null clears it → the derived name (the fund's) returns.
    const cleared = await partners.updatePledge(user, String(created.pledge_id), { title: null });
    expect(cleared.title).toBe("Missions");
    expect(cleared.custom_title).toBeNull();
    // A rename, trimmed; patching something else leaves the name alone.
    const renamed = await partners.updatePledge(user, String(created.pledge_id), PartnersService.UpdatePledge.parse({ title: " Amani " }));
    expect(renamed.title).toBe("Amani");
    const untouched = await partners.updatePledge(user, String(created.pledge_id), { note: "term two" });
    expect(untouched.title).toBe("Amani");
    expect(untouched.custom_title).toBe("Amani");
    // A pledge that was never named derives as before.
    const unnamed = await partners.createPledge(user, { shape: "total", target_minor: 10_000, currency: "KES", due_on: "2099-01-01", reminders_enabled: true });
    expect(unnamed.title).toBe("Partnership");
    expect(unnamed.custom_title).toBeNull();
  });

  it("names are bounded to 2–60 characters at the schema AND the table", async () => {
    expect(PartnersService.CreatePledge.safeParse({ shape: "total", target_minor: 1, due_on: "2099-01-01", title: "x" }).success).toBe(false);
    expect(PartnersService.CreatePledge.safeParse({ shape: "total", target_minor: 1, due_on: "2099-01-01", title: " x " }).success).toBe(false);
    expect(PartnersService.UpdatePledge.safeParse({ title: "a".repeat(61) }).success).toBe(false);
    expect(PartnersService.UpdatePledge.safeParse({ title: null }).success).toBe(true);
    expect(PartnersService.UpdatePledge.safeParse({}).success).toBe(true);
    const p = await partners.createPledge(user, { shape: "total", target_minor: 1, currency: "KES", due_on: "2099-01-01", reminders_enabled: true });
    await expect(testPool().query(`UPDATE pledges SET title = 'x' WHERE pledge_id = $1`, [p.pledge_id])).rejects.toThrow(/check constraint/i);
    await expect(testPool().query(`UPDATE pledges SET title = repeat('a', 61) WHERE pledge_id = $1`, [p.pledge_id])).rejects.toThrow(/check constraint/i);
  });

  it("the custom name follows the pledge into statements and the office's pending-claims queue", async () => {
    const pledge = await partners.createPledge(user, { shape: "monthly", amount_minor: 10_000, currency: "KES", due_day: 1, fund: "mission", title: "Kenya trip", reminders_enabled: true });
    const gift = await payFromPledge(pledge.pledge_id);
    await testPool().query(`UPDATE transactions SET status = 'succeeded', settled_at = now() WHERE transaction_id = $1`, [gift.transaction_id]);
    const st = await partners.statements(user);
    expect((st.by_pledge as { pledge_id: string | null; title: string }[]).find((x) => x.pledge_id === pledge.pledge_id)?.title).toBe("Kenya trip");
    expect((st.payments as { pledge_title: string | null }[])[0]!.pledge_title).toBe("Kenya trip");
    await partners.createClaim(user, String(pledge.pledge_id), { amount_minor: 500, currency: "KES", paid_on: "2026-09-01" });
    expect((await partners.pendingClaims())[0]!.pledge_title).toBe("Kenya trip");
  });

  // ── (ii) pledge_options ─────────────────────────────────────────────────

  it("pledge_options: general, then active funds by name, then live campaigns, then approved needs — before and after joining", async () => {
    const live = await liveCampaign("media", "New roof");
    // Not offered: a draft, an ended campaign, another congregation's, an inactive fund, a pending need, an archived department's need.
    await campaigns.create(cong, admin, { title: "Still a draft", blurb: "Nobody should see this yet.", fund: "media", goal_minor: 1, currency: "KES", starts_on: "2000-01-01", ends_on: "2099-12-31" });
    const ended = await liveCampaign("media", "Last year");
    await campaigns.setStatus(cong, ended, "ended");
    const cong2 = await createCongregation("Elsewhere");
    const admin2 = (await createUser({ congregationId: cong2 })).user_id;
    const leader2 = (await createUser({ congregationId: cong2 })).user_id;
    await liveCampaign("media", "Their roof", cong2, admin2);
    await approvedNeed("general", "Their robes", cong2, admin2, leader2);
    await testPool().query(`UPDATE funds SET is_active = FALSE WHERE code = 'gift'`);
    const { need_id: need, department_id } = await approvedNeed("general", "Roof sheets");
    await departments.submitNeed(leader, department_id, { title: "Not approved yet", why: "Pending needs are not giving targets.", target_minor: 1_000, currency: "KES" });
    const archived = await approvedNeed("general", "Old chairs");
    await departments.update(admin, archived.department_id, { status: "archived" });

    // Not yet a partner: the options are still there.
    const before = await partners.partnership(user);
    expect(before.is_partner).toBe(false);
    const opts = before.pledge_options as PledgeOption[];
    expect(opts.map((o) => o.key)).toEqual([
      "general", "fund:general", "fund:media", "fund:mission", "fund:offering", "fund:tithe", `campaign:${live}`, `need:${need}`,
    ]);
    expect(opts[0]).toEqual({ key: "general", title: "General partnership", kind: "general" });
    expect(opts.find((o) => o.key === "fund:mission")).toEqual({ key: "fund:mission", title: "Missions", kind: "fund", fund: "mission" });
    expect(opts.find((o) => o.kind === "campaign")).toEqual({ key: `campaign:${live}`, title: "New roof", kind: "campaign", campaign_id: live });
    expect(opts.find((o) => o.kind === "need")).toEqual({ key: `need:${need}`, title: "Roof sheets", kind: "need", need_id: need });

    // Joined, pledged: the same options.
    await partners.join(user);
    await partners.createPledge(user, { shape: "monthly", amount_minor: 1_000, currency: "KES", due_day: 1, reminders_enabled: true });
    const after = await partners.partnership(user);
    expect(after.is_partner).toBe(true);
    expect((after.pledge_options as PledgeOption[]).map((o) => o.key)).toEqual(opts.map((o) => o.key));
  });

  // ── (iii) money follows the promise ─────────────────────────────────────

  it("a gift with pledge_id lands in the pledge's fund whatever fund chip the client sent: own fund, campaign's, need's department's, or the default", async () => {
    const fundPledge = await partners.createPledge(user, { shape: "monthly", amount_minor: 10_000, currency: "KES", due_day: 1, fund: "mission", reminders_enabled: true });
    const campaignPledge = await partners.createPledge(user, { shape: "total", target_minor: 50_000, currency: "KES", due_on: "2099-01-01", campaign_id: await liveCampaign("media"), reminders_enabled: true });
    const { need_id } = await approvedNeed("general");
    const needPledge = await partners.createPledge(user, { shape: "total", target_minor: 50_000, currency: "KES", due_on: "2099-01-01", need_id, reminders_enabled: true });
    const generalPledge = await partners.createPledge(user, { shape: "monthly", amount_minor: 10_000, currency: "KES", due_day: 1, reminders_enabled: true });

    // The helper itself, then the money.
    expect(await financial.pledgeFundCode(String(fundPledge.pledge_id))).toBe("mission");
    expect(await financial.pledgeFundCode(String(campaignPledge.pledge_id))).toBe("media");
    expect(await financial.pledgeFundCode(String(needPledge.pledge_id))).toBe("general");
    await expect(financial.pledgeFundCode("00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(await fundOf((await payFromPledge(fundPledge.pledge_id)).transaction_id)).toBe("mission");
    expect(await fundOf((await payFromPledge(campaignPledge.pledge_id)).transaction_id)).toBe("media");
    expect(await fundOf((await payFromPledge(needPledge.pledge_id)).transaction_id)).toBe("general");
    // A general pledge: "discipleship" is not in the test seed, so the FIRST ACTIVE FUND BY CODE ("general")…
    expect(await financial.pledgeFundCode(String(generalPledge.pledge_id))).toBe("general");
    expect(await fundOf((await payFromPledge(generalPledge.pledge_id)).transaction_id)).toBe("general");
    // …and the programme default the moment that fund exists and is active.
    await seedDiscipleship();
    expect(await financial.pledgeFundCode(String(generalPledge.pledge_id))).toBe(DEFAULT_PLEDGE_FUND);
    expect(await fundOf((await payFromPledge(generalPledge.pledge_id)).transaction_id)).toBe(DEFAULT_PLEDGE_FUND);
    // pledge_id AND need_id together: the pledge wins.
    expect(await fundOf((await payFromPledge(fundPledge.pledge_id, { need_id })).transaction_id)).toBe("mission");
    // A need without a department fund falls through to the default like a general pledge.
    const { need_id: bareNeed } = await approvedNeed(null, "Hymnals");
    const bareNeedPledge = await partners.createPledge(user, { shape: "total", target_minor: 5_000, currency: "KES", due_on: "2099-01-01", need_id: bareNeed, reminders_enabled: true });
    expect(await fundOf((await payFromPledge(bareNeedPledge.pledge_id)).transaction_id)).toBe(DEFAULT_PLEDGE_FUND);
    // A plain gift still goes where the client said.
    const plain = await financial.createGivingIntent(user, { fund: "tithe", amount_minor: 1_000, currency: "KES", method: "card" } as never);
    expect(await fundOf(plain.transaction_id)).toBe("tithe");
    // The audit row records the fund actually booked, never the chip.
    const audit = await testPool().query<{ metadata: { fund: string } }>(
      `SELECT metadata FROM audit_log WHERE action = 'giving.intent_created' AND entity_id = $1`, [plain.transaction_id],
    );
    expect(audit.rows[0]!.metadata.fund).toBe("tithe");
    const routed = await payFromPledge(fundPledge.pledge_id);
    const audit2 = await testPool().query<{ metadata: { fund: string } }>(
      `SELECT metadata FROM audit_log WHERE action = 'giving.intent_created' AND entity_id = $1`, [routed.transaction_id],
    );
    expect(audit2.rows[0]!.metadata.fund).toBe("mission");
  });

  it("a schedule started for a pledge is STORED on the pledge's fund and its charges land there — the rail and the money agree", async () => {
    // A schedule started elsewhere for a mission-fund pledge, on a DIFFERENT fund chip.
    const pledge = await partners.createPledge(user, { shape: "monthly", amount_minor: 10_000, currency: "KES", due_day: 1, fund: "mission", reminders_enabled: true });
    const sched = await financial.createSchedule(user, { fund: "tithe", amount_minor: 10_000, currency: "KES", frequency: "monthly", method: "card", pledge_id: String(pledge.pledge_id) });
    // Stored on the pledge's fund, bound to the pledge…
    const stored = await testPool().query<{ code: string; pledge_id: string }>(`SELECT f.code, s.pledge_id FROM giving_schedules s JOIN funds f ON f.fund_id = s.fund_id WHERE s.schedule_id = $1`, [sched.schedule_id]);
    expect(stored.rows[0]).toEqual({ code: "mission", pledge_id: pledge.pledge_id });
    // …which is what the "Active schedules" rail reads…
    const listed = (await financial.listSchedules(user)).data as { schedule_id: string; fund: string }[];
    expect(listed.find((s) => s.schedule_id === sched.schedule_id)?.fund).toBe("mission");
    // …and where the charge lands.
    const gift = await financial.createGivingIntent(user, { fund: "tithe", amount_minor: 10_000, currency: "KES", method: "card" } as never, String(sched.schedule_id));
    expect(await fundOf(gift.transaction_id)).toBe("mission");
    expect((gift.pledge as { pledge_id: string }).pledge_id).toBe(pledge.pledge_id);
    // The audit says what was stored, not the chip.
    const audit = await testPool().query<{ metadata: { fund: string } }>(`SELECT metadata FROM audit_log WHERE action = 'giving.schedule_created' AND entity_id = $1`, [sched.schedule_id]);
    expect(audit.rows[0]!.metadata.fund).toBe("mission");
    // Without a pledge, the client's fund stands.
    const plain = await financial.createSchedule(user, { fund: "tithe", amount_minor: 5_000, currency: "KES", frequency: "weekly", method: "card" });
    const plainStored = await testPool().query<{ code: string; pledge_id: string | null }>(`SELECT f.code, s.pledge_id FROM giving_schedules s JOIN funds f ON f.fund_id = s.fund_id WHERE s.schedule_id = $1`, [plain.schedule_id]);
    expect(plainStored.rows[0]).toEqual({ code: "tithe", pledge_id: null });
  });

  // ── (iv) the intent result ──────────────────────────────────────────────

  it("the intent result says where the money went and which pledge it counts toward — first call and idempotent replay alike", async () => {
    const pledge = await partners.createPledge(user, { shape: "monthly", amount_minor: 10_000, currency: "KES", due_day: 1, fund: "mission", title: "Kenya trip", reminders_enabled: true });
    const body = { fund: "tithe", amount_minor: 10_000, currency: "KES", method: "card", pledge_id: String(pledge.pledge_id), idempotency_key: "pledge-names-replay-1" };
    const first = await financial.createGivingIntent(user, body as never);
    expect(first.reused).toBe(false);
    expect(first.fund).toEqual({ code: "mission", name: "Missions" });
    expect(first.pledge).toEqual({ pledge_id: pledge.pledge_id, title: "Kenya trip" });
    // The replay: same transaction, and it reports what was BOOKED, not what this call asked for.
    const again = await financial.createGivingIntent(user, { ...body, fund: "offering" } as never);
    expect(again.reused).toBe(true);
    expect(again.transaction_id).toBe(first.transaction_id);
    expect(again.fund).toEqual({ code: "mission", name: "Missions" });
    expect(again.pledge).toEqual({ pledge_id: pledge.pledge_id, title: "Kenya trip" });
    // Renamed since: the replay carries the current words.
    await partners.updatePledge(user, String(pledge.pledge_id), { title: "Nairobi trip" });
    expect((await financial.createGivingIntent(user, body as never)).pledge).toEqual({ pledge_id: pledge.pledge_id, title: "Nairobi trip" });
    // A gift outside a pledge: fund is the chip, pledge is null — on both paths.
    const plainBody = { fund: "offering", amount_minor: 500, currency: "KES", method: "card", idempotency_key: "pledge-names-replay-2" };
    const plain = await financial.createGivingIntent(user, plainBody as never);
    expect(plain.fund).toEqual({ code: "offering", name: "Offering" });
    expect(plain.pledge).toBeNull();
    const plainAgain = await financial.createGivingIntent(user, plainBody as never);
    expect(plainAgain.reused).toBe(true);
    expect(plainAgain.fund).toEqual({ code: "offering", name: "Offering" });
    expect(plainAgain.pledge).toBeNull();
  });

  // ── (v) the auto-schedule ───────────────────────────────────────────────

  it("'charge me automatically' binds the schedule to the pledge's fund — the programme default for a general pledge", async () => {
    const scheduleFund = async (scheduleId: unknown): Promise<{ code: string; pledge_id: string }> =>
      (await testPool().query<{ code: string; pledge_id: string }>(`SELECT f.code, s.pledge_id FROM giving_schedules s JOIN funds f ON f.fund_id = s.fund_id WHERE s.schedule_id = $1`, [scheduleId])).rows[0]!;
    // No "discipleship" in the seed → first active fund by code.
    const fallback = await partners.createPledge(user, { shape: "monthly", amount_minor: 20_000, currency: "KES", due_day: 5, reminders_enabled: true, auto_schedule: { method: "mpesa", frequency: "monthly" } });
    expect(await scheduleFund(fallback.schedule_id)).toEqual({ code: "general", pledge_id: fallback.pledge_id });
    // The default, once it is an active fund.
    await seedDiscipleship();
    const general = await partners.createPledge(user, { shape: "monthly", amount_minor: 20_000, currency: "KES", due_day: 5, reminders_enabled: true, auto_schedule: { method: "mpesa", frequency: "monthly" } });
    expect(await scheduleFund(general.schedule_id)).toEqual({ code: DEFAULT_PLEDGE_FUND, pledge_id: general.pledge_id });
    // A campaign pledge's schedule follows the campaign's fund; a need pledge's, the department's.
    const forCampaign = await partners.createPledge(user, { shape: "monthly", amount_minor: 20_000, currency: "KES", due_day: 5, campaign_id: await liveCampaign("media"), reminders_enabled: true, auto_schedule: { method: "airtel", frequency: "monthly" } });
    expect((await scheduleFund(forCampaign.schedule_id)).code).toBe("media");
    const { need_id } = await approvedNeed("general");
    const forNeed = await partners.createPledge(user, { shape: "monthly", amount_minor: 20_000, currency: "KES", due_day: 5, need_id, reminders_enabled: true, auto_schedule: { method: "airtel", frequency: "monthly" } });
    expect((await scheduleFund(forNeed.schedule_id)).code).toBe("general");
  });

  // ── (vi) claims ─────────────────────────────────────────────────────────

  it("confirming an 'I paid another way' claim books the money to the pledge's fund through the same helper", async () => {
    const pledge = await partners.createPledge(user, { shape: "total", target_minor: 50_000, currency: "KES", due_on: "2099-01-01", campaign_id: await liveCampaign("media"), reminders_enabled: true });
    const claim = await partners.createClaim(user, String(pledge.pledge_id), { amount_minor: 5_000, currency: "KES", paid_on: "2026-09-01" });
    const decided = await partners.decideClaim(admin, String(claim.claim_id), "confirm", notifications);
    expect(decided.status).toBe("confirmed");
    expect(await fundOf(decided.transaction_id)).toBe("media");
    const ledger = await testPool().query<{ account: string; side: string }>(`SELECT account, side::text AS side FROM ledger_entries WHERE transaction_id = $1 ORDER BY account`, [decided.transaction_id]);
    expect(ledger.rows).toEqual([{ account: "cash:manual", side: "debit" }, { account: "fund:media", side: "credit" }]);
    // A general pledge's claim: the first active fund by code without the default, the default with it.
    const general = await partners.createPledge(user, { shape: "total", target_minor: 50_000, currency: "KES", due_on: "2099-01-01", reminders_enabled: true });
    const c2 = await partners.createClaim(user, String(general.pledge_id), { amount_minor: 5_000, currency: "KES", paid_on: "2026-09-02" });
    expect(await fundOf((await partners.decideClaim(admin, String(c2.claim_id), "confirm", notifications)).transaction_id)).toBe("general");
    await seedDiscipleship();
    const c3 = await partners.createClaim(user, String(general.pledge_id), { amount_minor: 5_000, currency: "KES", paid_on: "2026-09-03" });
    expect(await fundOf((await partners.decideClaim(admin, String(c3.claim_id), "confirm", notifications)).transaction_id)).toBe(DEFAULT_PLEDGE_FUND);
  });
});
