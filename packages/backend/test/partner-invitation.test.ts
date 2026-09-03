// The partner invitation's restraint, rule by rule.
//
// The approved design is mostly a list of times NOT to ask. Each of those is a
// test here, because a rule with no test is a rule that will quietly stop
// applying the first time someone refactors this file — and the failure mode is
// silent and one-directional: the app starts asking more often, and nobody
// notices until a member complains.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { invitationFor, recordShown, recordOutcome, inQuietHours } from "../src/modules/financial/invitation.js";
import { CampaignService, CampaignInput } from "../src/modules/financial/campaigns.js";

let cong: string, user: string;

/** Mid-morning, comfortably outside anyone's quiet hours. */
const MIDMORNING = new Date("2026-09-10T09:00:00Z");

async function liveCampaign(opts: {
  starts?: string; ends?: string; match?: [number, string] | null;
} = {}): Promise<string> {
  const { rows } = await testPool().query<{ campaign_id: string }>(
    `INSERT INTO campaigns (congregation_id, title, blurb, goal_minor, currency,
                            starts_on, ends_on, status, match_minor, match_pledger,
                            fund_id)
     VALUES ($1, 'Carry a disciple', 'Forty through Level 1.', 4000000, 'KES',
             $2::date, $3::date, 'live', $4, $5,
             (SELECT fund_id FROM funds WHERE code = 'tithe'))
     RETURNING campaign_id`,
    [cong, opts.starts ?? "2026-09-01", opts.ends ?? "2026-09-30",
     opts.match?.[0] ?? null, opts.match?.[1] ?? null],
  );
  return rows[0]!.campaign_id;
}

/** Old enough to be asked — the settling-in rule is tested separately. */
async function settledMember(): Promise<string> {
  const id = (await createUser({ congregationId: cong, phone: `+2547${Date.now() % 100000000}` })).user_id;
  await testPool().query(
    `UPDATE users SET created_at = now() - interval '60 days' WHERE user_id = $1`, [id]);
  return id;
}

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  user = await settledMember();
});
afterAll(async () => { await closeTestPool(); });

describe("the invitation asks, and mostly declines to ask", () => {
  it("asks when there is a live campaign and nothing standing in the way", async () => {
    await liveCampaign();
    const d = await invitationFor(testPool(), user, MIDMORNING);
    expect(d.show).toBe(true);
    expect(d.campaign?.title).toBe("Carry a disciple");
    // The tiers arrive with the invitation, derived from the owner's costing.
    expect(d.campaign?.tiers.length).toBe(3);
    expect(d.campaign?.tiers[0]?.meaning).toContain("one disciple");
  });

  it("says nothing at all when no campaign is running", async () => {
    const d = await invitationFor(testPool(), user, MIDMORNING);
    expect(d).toEqual({ show: false, reason: "no_campaign" });
  });

  // The mistake most apps make.
  it("never asks an existing partner to become a partner", async () => {
    await liveCampaign();
    await testPool().query(
      `INSERT INTO giving_schedules (user_id, fund_id, amount_minor, currency, frequency,
                                     method, next_run_at, idempotency_key)
       SELECT $1, fund_id, 100000, 'KES', 'monthly', 'mpesa', now() + interval '7 days', 'inv-partner'
         FROM funds WHERE code = 'tithe'`, [user]);
    expect((await invitationFor(testPool(), user, MIDMORNING)).reason).toBe("already_partner");
  });

  it("never asks a child", async () => {
    await liveCampaign();
    await testPool().query(`UPDATE users SET is_minor = TRUE WHERE user_id = $1`, [user]);
    expect((await invitationFor(testPool(), user, MIDMORNING)).reason).toBe("minor");
  });

  it("never asks someone in their first week", async () => {
    await liveCampaign();
    // Two days before the test's clock — not the database's, which is a
    // different day entirely and made this rule silently untested.
    await testPool().query(
      `UPDATE users SET created_at = $2::timestamptz WHERE user_id = $1`,
      [user, new Date(MIDMORNING.getTime() - 2 * 86_400_000).toISOString()]);
    expect((await invitationFor(testPool(), user, MIDMORNING)).reason).toBe("too_new");
  });

  it("never asks during their quiet hours", async () => {
    await liveCampaign();
    const elevenPm = new Date("2026-09-10T23:00:00Z");
    expect((await invitationFor(testPool(), user, elevenPm)).reason).toBe("quiet_hours");
  });

  it("stops permanently once they say don't ask again", async () => {
    const c = await liveCampaign();
    await recordOutcome(testPool(), user, c, "declined");
    expect((await invitationFor(testPool(), user, MIDMORNING)).reason).toBe("declined");
  });

  it("does not ask again once they have given", async () => {
    const c = await liveCampaign();
    await recordOutcome(testPool(), user, c, "gave");
    expect((await invitationFor(testPool(), user, MIDMORNING)).reason).toBe("already_gave");
  });

  it("never shows twice in one day", async () => {
    const c = await liveCampaign();
    await recordShown(testPool(), user, c, MIDMORNING);
    expect((await invitationFor(testPool(), user, MIDMORNING)).reason).toBe("shown_today");
  });

  it("waits a fortnight between waves", async () => {
    const c = await liveCampaign();
    await recordShown(testPool(), user, c, MIDMORNING);
    await testPool().query(
      `UPDATE partner_invite_log SET last_shown_on = $1::date - 5`,
      [MIDMORNING.toISOString().slice(0, 10)]);
    expect((await invitationFor(testPool(), user, MIDMORNING)).reason).toBe("wave_too_soon");

    // Past the fortnight, it may ask again.
    await testPool().query(
      `UPDATE partner_invite_log SET last_shown_on = $1::date - 15`,
      [MIDMORNING.toISOString().slice(0, 10)]);
    expect((await invitationFor(testPool(), user, MIDMORNING)).show).toBe(true);
  });

  it("stops after three showings, however long the campaign runs", async () => {
    const c = await liveCampaign();
    await testPool().query(
      `INSERT INTO partner_invite_log (user_id, campaign_id, times_shown, last_shown_on)
       VALUES ($1, $2, 3, $3::date - 30)`, [user, c, MIDMORNING.toISOString().slice(0, 10)]);
    expect((await invitationFor(testPool(), user, MIDMORNING)).reason).toBe("shown_enough");
  });

  it("allows ONE extra showing in the final days, and no more", async () => {
    // Ends in two days: inside the final-days window.
    const c = await liveCampaign({ ends: "2026-09-12" });
    await testPool().query(
      `INSERT INTO partner_invite_log (user_id, campaign_id, times_shown, last_shown_on)
       VALUES ($1, $2, 3, $3::date - 30)`, [user, c, MIDMORNING.toISOString().slice(0, 10)]);
    expect((await invitationFor(testPool(), user, MIDMORNING)).show).toBe(true);

    // But a fourth is the end of it — the deadline buys one, not a licence.
    await testPool().query(`UPDATE partner_invite_log SET times_shown = 4`);
    expect((await invitationFor(testPool(), user, MIDMORNING)).reason).toBe("shown_enough");
  });
});

describe("what the invitation says", () => {
  it("claims a match only when a real person pledged one", async () => {
    await liveCampaign({ match: [1000000, "The Kamau family"] });
    const d = await invitationFor(testPool(), user, MIDMORNING);
    expect(d.campaign?.match).toEqual({ amount_minor: 1000000, pledger: "The Kamau family" });
  });

  it("claims no match when nobody pledged one", async () => {
    await liveCampaign();
    const d = await invitationFor(testPool(), user, MIDMORNING);
    expect(d.campaign?.match).toBeUndefined();
  });

  it("reports what has really been raised, not what we hope", async () => {
    await liveCampaign();
    await testPool().query(
      `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, idempotency_key)
       SELECT $1, fund_id, 250000, 'KES', 'succeeded', 'inv-raised-1' FROM funds WHERE code='tithe'`,
      [user]);
    // A failed gift is not money raised.
    await testPool().query(
      `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, idempotency_key)
       SELECT $1, fund_id, 999999, 'KES', 'failed', 'inv-raised-2' FROM funds WHERE code='tithe'`,
      [user]);
    const d = await invitationFor(testPool(), user, MIDMORNING);
    expect(d.campaign?.raised_minor).toBe(250000);
  });
});

describe("quiet hours wrap midnight", () => {
  const at = (h: number): Date => new Date(`2026-09-10T${String(h).padStart(2, "0")}:00:00Z`);

  it("treats 21:00→07:00 as one window across midnight", () => {
    expect(inQuietHours(at(22), "21:00", "07:00")).toBe(true);   // late evening
    expect(inQuietHours(at(3), "21:00", "07:00")).toBe(true);    // small hours
    expect(inQuietHours(at(12), "21:00", "07:00")).toBe(false);  // midday
    expect(inQuietHours(at(7), "21:00", "07:00")).toBe(false);   // the moment it lifts
  });

  it("handles a same-day window too", () => {
    expect(inQuietHours(at(13), "12:00", "14:00")).toBe(true);
    expect(inQuietHours(at(15), "12:00", "14:00")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Campaign authoring. Two refusals matter more than the CRUD around them.
describe("what the church may not author", () => {
  const draft = {
    title: "Carry a disciple", blurb: "Forty through Level 1.",
    fund: "tithe", goal_minor: 4000000, currency: "KES",
    starts_on: "2026-09-01", ends_on: "2026-09-30",
  };

  it("refuses a match with no one who pledged it", () => {
    const bad = CampaignInput.safeParse({ ...draft, match_minor: 1000000, match_pledger: null });
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error?.issues)).toContain("Name the pledger");
  });

  it("accepts a match when someone really pledged it", () => {
    expect(CampaignInput.safeParse({
      ...draft, match_minor: 1000000, match_pledger: "The Kamau family",
    }).success).toBe(true);
  });

  it("refuses a campaign that ends before it starts", () => {
    expect(CampaignInput.safeParse({
      ...draft, starts_on: "2026-09-30", ends_on: "2026-09-01",
    }).success).toBe(false);
  });

  it("creates as a DRAFT — nothing reaches a member by accident", async () => {
    const svc = new CampaignService(testPool());
    const created = await svc.create(cong, user, draft as never) as
      { status: string; campaign_id: string };
    expect(created.status).toBe("draft");

    // A draft is invisible to the invitation engine.
    expect((await invitationFor(testPool(), user, MIDMORNING)).reason).toBe("no_campaign");

    // Going live is the deliberate act that changes that.
    await svc.setStatus(cong, created.campaign_id, "live");
    expect((await invitationFor(testPool(), user, MIDMORNING)).show).toBe(true);
  });

  it("never reopens an ended campaign", async () => {
    const svc = new CampaignService(testPool());
    const c = await svc.create(cong, user, draft as never) as { campaign_id: string };
    await svc.setStatus(cong, c.campaign_id, "ended");
    await expect(svc.setStatus(cong, c.campaign_id, "live")).rejects.toThrow(/ended/i);
  });

  it("tells a campaign nobody saw apart from one everybody declined", async () => {
    const svc = new CampaignService(testPool());
    const c = await svc.create(cong, user, draft as never) as { campaign_id: string };

    expect(Number((await svc.reach(cong, c.campaign_id)).people_asked)).toBe(0);

    await recordShown(testPool(), user, c.campaign_id, MIDMORNING);
    await recordOutcome(testPool(), user, c.campaign_id, "declined");
    const seen = await svc.reach(cong, c.campaign_id);
    expect(Number(seen.people_asked)).toBe(1);
    expect(Number(seen.declined)).toBe(1);
    expect(Number(seen.gave)).toBe(0);
  });
});
