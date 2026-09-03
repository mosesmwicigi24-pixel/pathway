// Campaign authoring — the church's side of the invitation.
//
// The member-facing engine (invitation.ts) decides whether to ask. This decides
// what there is to ask about, and it is where a campaign is written, put live,
// and afterwards judged.
//
// Two things it refuses to let the church do, both deliberate:
//
//   1. Claim a match nobody pledged. The database already makes that state
//      unrepresentable (migration 212); this layer catches it first so the
//      answer is a clear message rather than a constraint violation.
//   2. Run a campaign without an end. An ask with no deadline is not a
//      campaign, it is a permanent solicitation — and the "final days" rule
//      depends on the end being real.
import { z } from "zod";
import type pg from "pg";
import { many, maybeOne } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";

const Money = z.number().int().positive();
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const CampaignInput = z
  .object({
    title: z.string().trim().min(3).max(120),
    blurb: z.string().trim().min(10),
    image_url: z.string().url().nullish(),
    fund: z.string().trim().min(1),
    goal_minor: Money,
    currency: z.string().length(3),
    starts_on: Day,
    ends_on: Day,
    // Both halves of a match, or neither. Never one.
    match_minor: Money.nullish(),
    match_pledger: z.string().trim().min(2).max(120).nullish(),
  })
  .refine((c) => c.ends_on >= c.starts_on, {
    message: "A campaign cannot end before it starts",
    path: ["ends_on"],
  })
  .refine((c) => (c.match_minor == null) === (c.match_pledger == null), {
    message:
      "A match needs someone who pledged it. Name the pledger, or remove the match — " +
      "claiming a match nobody offered is the fastest way to lose a congregation's trust.",
    path: ["match_pledger"],
  });

export type CampaignInputT = z.infer<typeof CampaignInput>;

export class CampaignService {
  constructor(private readonly pool: pg.Pool) {}

  async list(congregationId: string): Promise<{ data: unknown[] }> {
    const rows = await many<Record<string, unknown>>(
      this.pool,
      `SELECT c.campaign_id, c.title, c.blurb, c.image_url, c.goal_minor, c.currency,
              c.starts_on::text AS starts_on, c.ends_on::text AS ends_on, c.status,
              c.match_minor, c.match_pledger, f.code AS fund, c.created_at,
              -- Raised so far: succeeded gifts to this fund inside the window.
              (SELECT coalesce(sum(t.amount_minor), 0) FROM transactions t
                WHERE t.fund_id = c.fund_id AND t.status = 'succeeded'
                  AND t.created_at >= c.starts_on::timestamptz)          AS raised_minor,
              -- Who has been asked, and what came of it. This is the honest
              -- answer to "why did nobody give?" — it distinguishes a campaign
              -- nobody saw from one people saw and declined.
              (SELECT count(*) FROM partner_invite_log l
                WHERE l.campaign_id = c.campaign_id)                     AS people_asked,
              (SELECT count(*) FROM partner_invite_log l
                WHERE l.campaign_id = c.campaign_id AND l.outcome = 'gave')    AS gave,
              (SELECT count(*) FROM partner_invite_log l
                WHERE l.campaign_id = c.campaign_id AND l.outcome = 'declined') AS declined
         FROM campaigns c
         LEFT JOIN funds f ON f.fund_id = c.fund_id
        WHERE c.congregation_id = $1
        ORDER BY c.starts_on DESC`,
      [congregationId],
    );
    return {
      data: rows.map((r) => ({
        ...r,
        goal_minor: Number(r.goal_minor),
        raised_minor: Number(r.raised_minor),
        match_minor: r.match_minor == null ? null : Number(r.match_minor),
      })),
    };
  }

  async create(
    congregationId: string,
    userId: string,
    input: CampaignInputT,
  ): Promise<Record<string, unknown>> {
    const fund = await this.fundId(input.fund);
    const row = await maybeOne<Record<string, unknown>>(
      this.pool,
      `INSERT INTO campaigns (congregation_id, title, blurb, image_url, fund_id,
                              goal_minor, currency, starts_on, ends_on,
                              match_minor, match_pledger, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10,$11,$12)
       RETURNING campaign_id, status`,
      [
        congregationId, input.title, input.blurb, input.image_url ?? null, fund,
        input.goal_minor, input.currency.toUpperCase(), input.starts_on, input.ends_on,
        input.match_minor ?? null, input.match_pledger ?? null, userId,
      ],
    );
    // Created as a draft, always. Nothing reaches a member until someone
    // deliberately puts it live.
    return row ?? {};
  }

  async update(
    congregationId: string,
    campaignId: string,
    input: CampaignInputT,
  ): Promise<Record<string, unknown>> {
    const fund = await this.fundId(input.fund);
    const row = await maybeOne<Record<string, unknown>>(
      this.pool,
      `UPDATE campaigns
          SET title=$3, blurb=$4, image_url=$5, fund_id=$6, goal_minor=$7, currency=$8,
              starts_on=$9::date, ends_on=$10::date, match_minor=$11, match_pledger=$12,
              updated_at=now()
        WHERE campaign_id=$1 AND congregation_id=$2
        RETURNING campaign_id, status`,
      [
        campaignId, congregationId, input.title, input.blurb, input.image_url ?? null, fund,
        input.goal_minor, input.currency.toUpperCase(), input.starts_on, input.ends_on,
        input.match_minor ?? null, input.match_pledger ?? null,
      ],
    );
    if (!row) throw new ApiError("NOT_FOUND", "No such campaign");
    return row;
  }

  /**
   * Put a campaign live, or end it.
   *
   * Going live is the moment members can be asked, so it is a separate,
   * deliberate act rather than a field on a form — the same reason a draft is
   * the default. Ending is never undone: a campaign that has run is history,
   * and re-opening one would let a closed appeal quietly resume.
   */
  async setStatus(
    congregationId: string,
    campaignId: string,
    status: "live" | "ended",
  ): Promise<Record<string, unknown>> {
    const current = await maybeOne<{ status: string }>(
      this.pool,
      `SELECT status FROM campaigns WHERE campaign_id=$1 AND congregation_id=$2`,
      [campaignId, congregationId],
    );
    if (!current) throw new ApiError("NOT_FOUND", "No such campaign");
    if (current.status === "ended") {
      throw new ApiError("CONFLICT", "This campaign has ended. Create a new one rather than reopening it.");
    }
    const row = await maybeOne<Record<string, unknown>>(
      this.pool,
      `UPDATE campaigns SET status=$3, updated_at=now()
        WHERE campaign_id=$1 AND congregation_id=$2
        RETURNING campaign_id, status`,
      [campaignId, congregationId, status],
    );
    return row ?? {};
  }

  /**
   * How an invitation actually fared. Deliberately reports what was SHOWN
   * separately from what was given: a campaign nobody saw and a campaign
   * everybody declined look identical in the giving totals, and the church
   * should be able to tell them apart.
   */
  async reach(congregationId: string, campaignId: string): Promise<Record<string, unknown>> {
    const row = await maybeOne<Record<string, unknown>>(
      this.pool,
      `SELECT
         (SELECT count(*) FROM partner_invite_log WHERE campaign_id=$1)                        AS people_asked,
         (SELECT coalesce(sum(times_shown),0) FROM partner_invite_log WHERE campaign_id=$1)    AS times_shown,
         (SELECT count(*) FROM partner_invite_log WHERE campaign_id=$1 AND outcome='opened')   AS opened,
         (SELECT count(*) FROM partner_invite_log WHERE campaign_id=$1 AND outcome='gave')     AS gave,
         (SELECT count(*) FROM partner_invite_log WHERE campaign_id=$1 AND outcome='dismissed') AS dismissed,
         (SELECT count(*) FROM partner_invite_log WHERE campaign_id=$1 AND outcome='declined')  AS declined
       FROM campaigns WHERE campaign_id=$1 AND congregation_id=$2`,
      [campaignId, congregationId],
    );
    if (!row) throw new ApiError("NOT_FOUND", "No such campaign");
    return row;
  }

  private async fundId(code: string): Promise<string> {
    const f = await maybeOne<{ fund_id: string }>(
      this.pool, `SELECT fund_id FROM funds WHERE code = $1`, [code],
    );
    if (!f) throw new ApiError("UNPROCESSABLE", `No such fund: ${code}`);
    return f.fund_id;
  }
}
