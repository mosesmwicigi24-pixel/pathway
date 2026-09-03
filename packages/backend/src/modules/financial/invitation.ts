// The partner invitation — deciding whether to ask, before deciding what to say.
//
// The design (approved 2026-09-02) is mostly a list of times NOT to ask. That
// restraint lives HERE, on the server, for one reason: implemented in Swift and
// again in Kotlin it would drift, and the drift would always be in the same
// direction — towards asking more often. One engine, one set of tests, both
// apps rendering whatever it returns.
//
// Every rule below is a real check with a stated reason. A rule with no reason
// is a rule someone will delete.
import type pg from "pg";
import { maybeOne } from "../../db/db.js";
import { givingTiers, type GivingTier } from "./tiers.js";

/** Why we are NOT asking. Returned so the decision is auditable, never guessed. */
export type InviteRefusal =
  | "no_campaign"        // nothing is running for this congregation today
  | "already_partner"    // asking a partner to become one is the classic mistake
  | "minor"              // never solicit money from a child
  | "already_gave"       // they answered this campaign already
  | "declined"           // they said don't ask again. That is permanent.
  | "shown_enough"       // three times per campaign, ever
  | "wave_too_soon"      // 14 days between waves
  | "shown_today"        // never twice in a day
  | "quiet_hours"        // their own quiet window, the same one nudges honour
  | "too_new";           // still finding their feet

export interface InviteDecision {
  show: boolean;
  reason?: InviteRefusal;
  /**
   * How many times this member has already seen THIS campaign. The clients use
   * it for one thing: "Don't ask again" appears only from the second showing.
   * Offering a permanent no immediately invites one from someone who simply had
   * a busy morning — but a person who has now been asked twice deserves a way
   * to end it. Server-side like every other rule, so the two apps agree.
   */
  showing?: number;
  campaign?: {
    campaign_id: string;
    title: string;
    blurb: string;
    image_url: string | null;
    goal_minor: number;
    raised_minor: number;
    currency: string;
    ends_on: string;
    days_left: number;
    /** Present ONLY when a real person pledged it — see migration 212. */
    match?: { amount_minor: number; pledger: string };
    tiers: GivingTier[];
  };
}

/** A new member is not asked for money in their first week. */
const SETTLING_IN_DAYS = 7;
/** Three times per campaign, ever. */
const MAX_SHOWINGS = 3;
/** And at least this long between them. */
const WAVE_DAYS = 14;
/** A real deadline earns one extra showing — but only inside this window. */
const FINAL_DAYS = 3;

const no = (reason: InviteRefusal): InviteDecision => ({ show: false, reason });

/**
 * May we invite this member today?
 *
 * Ordered cheapest-and-most-decisive first: if no campaign is running we do no
 * further work, and the reasons that can never change (minor, declined) are
 * checked before the ones that merely depend on timing.
 */
export async function invitationFor(
  pool: pg.Pool,
  userId: string,
  now: Date = new Date(),
): Promise<InviteDecision> {
  const who = await maybeOne<{
    congregation_id: string | null;
    is_minor: boolean;
    created_at: string;
    quiet_from: string | null;
    quiet_to: string | null;
  }>(
    pool,
    `SELECT u.congregation_id, u.is_minor, u.created_at,
            p.quiet_from::text AS quiet_from, p.quiet_to::text AS quiet_to
       FROM users u
       LEFT JOIN notification_preferences p ON p.user_id = u.user_id
      WHERE u.user_id = $1 AND u.deleted_at IS NULL`,
    [userId],
  );
  if (!who?.congregation_id) return no("no_campaign");

  // Never solicit money from a child. First, and not negotiable.
  if (who.is_minor) return no("minor");

  // Someone still finding their feet is not asked for money.
  const daysHere = (now.getTime() - new Date(who.created_at).getTime()) / 86_400_000;
  if (daysHere < SETTLING_IN_DAYS) return no("too_new");

  // Their own quiet window — the same one the notification outbox honours. An
  // appeal at 11pm is worse than no appeal.
  if (inQuietHours(now, who.quiet_from ?? "21:00", who.quiet_to ?? "07:00")) {
    return no("quiet_hours");
  }

  // A partner is never asked to become a partner. They get the thank-you
  // instead — see the Partners page. This is the mistake most apps make.
  const partner = await maybeOne<{ n: number }>(
    pool,
    `SELECT 1 AS n FROM giving_schedules
      WHERE user_id = $1 AND status IN ('active','paused') LIMIT 1`,
    [userId],
  );
  if (partner) return no("already_partner");

  const campaign = await maybeOne<{
    campaign_id: string; title: string; blurb: string; image_url: string | null;
    goal_minor: string; currency: string; ends_on: string;
    match_minor: string | null; match_pledger: string | null;
  }>(
    pool,
    `SELECT campaign_id, title, blurb, image_url, goal_minor, currency,
            ends_on::text AS ends_on, match_minor, match_pledger
       FROM campaigns
      WHERE congregation_id = $1 AND status = 'live'
        AND starts_on <= $2::date AND ends_on >= $2::date
      ORDER BY ends_on LIMIT 1`,
    [who.congregation_id, now.toISOString().slice(0, 10)],
  );
  if (!campaign) return no("no_campaign");

  const log = await maybeOne<{
    times_shown: number; last_shown_on: string | null; outcome: string | null;
  }>(
    pool,
    `SELECT times_shown, last_shown_on::text AS last_shown_on, outcome
       FROM partner_invite_log WHERE user_id = $1 AND campaign_id = $2`,
    [userId, campaign.campaign_id],
  );

  if (log) {
    // "Don't ask again" is permanent. Not for this wave — permanently.
    if (log.outcome === "declined") return no("declined");
    // They already answered generously. Asking again is asking twice.
    if (log.outcome === "gave") return no("already_gave");

    const daysLeft = daysBetween(now, new Date(`${campaign.ends_on}T23:59:59Z`));
    const finalDays = daysLeft <= FINAL_DAYS;
    // A real deadline earns ONE extra showing — never an unlimited licence.
    if (log.times_shown >= MAX_SHOWINGS + (finalDays ? 1 : 0)) return no("shown_enough");

    if (log.last_shown_on) {
      const since = daysBetween(new Date(`${log.last_shown_on}T00:00:00Z`), now);
      if (since < 1) return no("shown_today");
      // The final days shorten the wave, but do not abolish it.
      if (since < (finalDays ? FINAL_DAYS : WAVE_DAYS)) return no("wave_too_soon");
    }
  }

  // Only now, having decided we may ask, do we work out what to say.
  const raised = await maybeOne<{ total: string | null }>(
    pool,
    `SELECT sum(t.amount_minor) AS total
       FROM transactions t
       JOIN campaigns c ON c.campaign_id = $1
      WHERE t.status = 'succeeded' AND t.fund_id = c.fund_id
        AND t.created_at >= c.starts_on::timestamptz`,
    [campaign.campaign_id],
  );

  const daysLeft = Math.max(0, daysBetween(now, new Date(`${campaign.ends_on}T23:59:59Z`)));
  return {
    show: true,
    // The showing this is about to become, not the one already recorded.
    showing: (log?.times_shown ?? 0) + 1,
    campaign: {
      campaign_id: campaign.campaign_id,
      title: campaign.title,
      blurb: campaign.blurb,
      image_url: campaign.image_url,
      goal_minor: Number(campaign.goal_minor),
      raised_minor: Number(raised?.total ?? 0),
      currency: campaign.currency,
      ends_on: campaign.ends_on,
      days_left: daysLeft,
      // The database already refuses a match without a matcher (migration 212).
      // This is the second gate: if either half is missing, no match is claimed.
      ...(campaign.match_minor != null && campaign.match_pledger != null
        ? { match: { amount_minor: Number(campaign.match_minor), pledger: campaign.match_pledger } }
        : {}),
      tiers: givingTiers(campaign.currency),
    },
  };
}

/**
 * Record that we showed it. Called only when the invitation is actually
 * rendered — a decision to show is not a showing.
 *
 * Takes the same `now` the decision was made with, rather than reading
 * CURRENT_DATE. The two must agree: if the decision says "not shown today" from
 * one clock while this writes another, the day-boundary rules quietly stop
 * meaning anything. That disagreement is exactly what the tests caught.
 */
export async function recordShown(
  pool: pg.Pool, userId: string, campaignId: string, now: Date = new Date(),
): Promise<void> {
  const today = now.toISOString().slice(0, 10);
  await pool.query(
    `INSERT INTO partner_invite_log (user_id, campaign_id, times_shown, last_shown_on)
     VALUES ($1, $2, 1, $3::date)
     ON CONFLICT (user_id, campaign_id) DO UPDATE
       SET times_shown = partner_invite_log.times_shown
                       + (CASE WHEN partner_invite_log.last_shown_on IS DISTINCT FROM $3::date
                               THEN 1 ELSE 0 END),
           last_shown_on = $3::date`,
    [userId, campaignId, today],
  );
}

/** Record what they did about it. 'declined' is the permanent one. */
export async function recordOutcome(
  pool: pg.Pool,
  userId: string,
  campaignId: string,
  outcome: "dismissed" | "declined" | "opened" | "gave",
): Promise<void> {
  await pool.query(
    `INSERT INTO partner_invite_log (user_id, campaign_id, outcome, outcome_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, campaign_id) DO UPDATE
       SET outcome = EXCLUDED.outcome, outcome_at = EXCLUDED.outcome_at`,
    [userId, campaignId, outcome],
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * Is `now` inside the member's quiet window? The window usually WRAPS midnight
 * (21:00 → 07:00), which is why this is not a simple `from <= t && t < to`.
 *
 * NOTE: this compares in UTC, matching how the notification outbox stores these
 * times today. That is a known simplification shared with the existing quiet
 * hours implementation, not a new one introduced here — when per-user timezones
 * arrive, both should change together.
 */
export function inQuietHours(now: Date, from: string, to: string): boolean {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const f = toMinutes(from);
  const t = toMinutes(to);
  return f <= t ? minutes >= f && minutes < t : minutes >= f || minutes < t;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
