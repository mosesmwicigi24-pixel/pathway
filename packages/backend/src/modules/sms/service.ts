// Bulk SMS campaigns (migration 207): compose → audience → send → the truth.
//
// The design premise, paid for on 2026-08-22: accepted != sent != delivered.
// Africa's Talking answers a submit with a per-recipient statusCode, and the
// FINAL outcome arrives later on their delivery-report webhook with a failure
// reason ("InsufficientCredit", "AbsentSubscriber"...). So a recipient here is
// a state machine — queued → submitted → delivered | failed — and "delivered"
// has exactly one source: the webhook. A report built from submit responses
// would be the same lie the outbox told at 21:54.
//
// Broadcast respects the opt-in. Receipts and welcomes are transactional and
// bypass it; a campaign is precisely the traffic notification_preferences.
// sms_enabled exists to govern. The suppressed are counted and named — "why
// did person C not get it" must be answerable from the table.
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx, enqueueOutbox, audit } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { gsm7Length, smsSegments } from "../../lib/sms-text.js";

/** What the campaign service needs from a bulk-capable SMS provider. */
export interface SmsBulkSender {
  sendBatch(
    numbers: string[],
    body: string,
  ): Promise<Array<{ number: string; statusCode: number; status: string; messageId: string | null; cost: string | null }>>;
  balance(): Promise<string | null>;
}

export const audienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("cells"), cell_group_ids: z.array(z.string().uuid()).min(1).max(50) }),
  z.object({ kind: z.literal("level"), level_number: z.number().int().min(1).max(20) }),
  z.object({ kind: z.literal("group"), group_id: z.string().uuid() }),
  z.object({ kind: z.literal("individuals"), user_ids: z.array(z.string().uuid()).min(1).max(500) }),
  z.object({ kind: z.literal("event_rsvps"), event_id: z.string().min(1).max(100) }),
]);
export type Audience = z.infer<typeof audienceSchema>;

export const campaignSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(612), // 4 GSM-7 segments — the hard wall
  audience: audienceSchema,
});

/** Africa's Talking submit codes that mean "we have it" (100/101/102). */
const AT_ACCEPTED = new Set([100, 101, 102]);
/** Numbers per submit request. AT accepts far more; 100 keeps each HTTP
 *  round-trip small enough that one failure re-queues little. */
const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 3;

/**
 * Delivery-report failure reasons where a retry is a waste of the church's
 * money until a HUMAN fixes something (the number, the blacklist, the sender
 * id). Everything else — credit topped up, subscriber back in coverage — is
 * retryable, bounded by MAX_ATTEMPTS. Unknown reasons count as retryable on
 * purpose: optimism is capped, pessimism is forever.
 */
const TERMINAL_REASONS = new Set([
  "UserInBlacklist",
  "InvalidPhoneNumber",
  "UnsupportedNumberType",
  "InvalidSenderId",
  "UserDoesNotExist",
]);
export function isRetryableReason(reason: string | null): boolean {
  return !reason || !TERMINAL_REASONS.has(reason);
}

interface Member {
  user_id: string;
  full_name: string;
  phone_number: string | null;
  sms_enabled: boolean;
}

export class SmsCampaignService {
  constructor(
    private readonly pool: Pool,
    private readonly at?: SmsBulkSender | undefined,
  ) {}

  // ---------------- groups ----------------

  async listGroups(congId: string): Promise<unknown[]> {
    return many(
      this.pool,
      `SELECT g.group_id, g.name, g.created_at, count(m.user_id)::int AS members
         FROM sms_groups g LEFT JOIN sms_group_members m ON m.group_id = g.group_id
        WHERE g.congregation_id = $1
        GROUP BY g.group_id ORDER BY g.name`,
      [congId],
    );
  }

  async createGroup(congId: string, adminId: string, name: string): Promise<{ group_id: string }> {
    const row = await maybeOne<{ group_id: string }>(
      this.pool,
      `INSERT INTO sms_groups (congregation_id, name, created_by) VALUES ($1, $2, $3)
       ON CONFLICT (congregation_id, name) DO NOTHING RETURNING group_id`,
      [congId, name, adminId],
    );
    if (!row) throw new ApiError("CONFLICT", "A group with that name already exists");
    return row;
  }

  async deleteGroup(congId: string, groupId: string): Promise<void> {
    const res = await this.pool.query(
      `DELETE FROM sms_groups WHERE group_id = $1 AND congregation_id = $2`,
      [groupId, congId],
    );
    if (res.rowCount === 0) throw new ApiError("NOT_FOUND", "Group not found");
  }

  async addGroupMembers(congId: string, groupId: string, userIds: string[]): Promise<{ added: number }> {
    await this.requireGroup(congId, groupId);
    // Only members of THIS congregation may be added — a group must not become
    // a way to text another branch's roster.
    const res = await this.pool.query(
      `INSERT INTO sms_group_members (group_id, user_id)
       SELECT $1, u.user_id FROM users u
        WHERE u.user_id = ANY($2::uuid[]) AND u.deleted_at IS NULL AND u.congregation_id = $3
       ON CONFLICT DO NOTHING`,
      [groupId, userIds, congId],
    );
    return { added: res.rowCount ?? 0 };
  }

  async removeGroupMember(congId: string, groupId: string, userId: string): Promise<void> {
    await this.requireGroup(congId, groupId);
    await this.pool.query(`DELETE FROM sms_group_members WHERE group_id = $1 AND user_id = $2`, [groupId, userId]);
  }

  async groupMembers(congId: string, groupId: string): Promise<unknown[]> {
    await this.requireGroup(congId, groupId);
    return many(
      this.pool,
      `SELECT u.user_id, u.full_name, u.phone_number FROM sms_group_members m
         JOIN users u ON u.user_id = m.user_id
        WHERE m.group_id = $1 AND u.deleted_at IS NULL ORDER BY u.full_name`,
      [groupId],
    );
  }

  private async requireGroup(congId: string, groupId: string): Promise<void> {
    const g = await maybeOne(
      this.pool,
      `SELECT 1 FROM sms_groups WHERE group_id = $1 AND congregation_id = $2`,
      [groupId, congId],
    );
    if (!g) throw new ApiError("NOT_FOUND", "Group not found");
  }

  // ---------------- audience + preview ----------------

  /** Everyone the audience names, with the two facts that decide sendability. */
  private async resolveAudience(congId: string, audience: Audience): Promise<Member[]> {
    const base = `SELECT u.user_id, u.full_name, u.phone_number,
                         COALESCE(p.sms_enabled, FALSE) AS sms_enabled
                    FROM users u
                    LEFT JOIN notification_preferences p ON p.user_id = u.user_id`;
    switch (audience.kind) {
      case "all":
        return many(this.pool, `${base} WHERE u.deleted_at IS NULL AND u.congregation_id = $1 ORDER BY u.full_name`, [congId]);
      case "cells":
        return many(
          this.pool,
          `${base} WHERE u.deleted_at IS NULL AND u.congregation_id = $1 AND u.cell_group_id = ANY($2::uuid[]) ORDER BY u.full_name`,
          [congId, audience.cell_group_ids],
        );
      case "level":
        return many(
          this.pool,
          `${base} JOIN enrollments e ON e.user_id = u.user_id
            WHERE u.deleted_at IS NULL AND u.congregation_id = $1 AND e.current_level = $2 ORDER BY u.full_name`,
          [congId, audience.level_number],
        );
      case "group": {
        await this.requireGroup(congId, audience.group_id);
        return many(
          this.pool,
          `${base} JOIN sms_group_members m ON m.user_id = u.user_id
            WHERE u.deleted_at IS NULL AND u.congregation_id = $1 AND m.group_id = $2 ORDER BY u.full_name`,
          [congId, audience.group_id],
        );
      }
      case "individuals":
        return many(
          this.pool,
          `${base} WHERE u.deleted_at IS NULL AND u.congregation_id = $1 AND u.user_id = ANY($2::uuid[]) ORDER BY u.full_name`,
          [congId, audience.user_ids],
        );
      case "event_rsvps":
        return many(
          this.pool,
          `${base} JOIN event_rsvps r ON r.user_id = u.user_id
            WHERE u.deleted_at IS NULL AND u.congregation_id = $1
              AND r.event_id = $2 AND r.status = 'going' ORDER BY u.full_name`,
          [congId, audience.event_id],
        );
    }
  }

  /**
   * Everything an admin sees BEFORE spending: who it reaches, who it cannot
   * and why, what one copy costs in segments, and the account balance beside
   * it. The segment figure refuses to guess on a non-GSM-7 body — the compose
   * box should have caught it, and a wrong estimate is worse than none.
   */
  async preview(congId: string, audience: Audience, body: string): Promise<{
    total: number;
    sendable: number;
    suppressed: { opted_out: number; no_phone: number; duplicate_phone: number };
    septets: number | null;
    segments: number;
    message_units: number;
    balance: string | null;
  }> {
    const members = await this.resolveAudience(congId, audience);
    const { sendable, suppressed } = partition(members);
    const septets = gsm7Length(body);
    const segments = smsSegments(body);
    return {
      total: members.length,
      sendable: sendable.length,
      suppressed: {
        opted_out: suppressed.filter((s) => s.reason === "opted_out").length,
        no_phone: suppressed.filter((s) => s.reason === "no_phone").length,
        duplicate_phone: suppressed.filter((s) => s.reason === "duplicate_phone").length,
      },
      septets,
      segments,
      message_units: sendable.length * segments,
      balance: this.at ? await this.at.balance() : null,
    };
  }

  // ---------------- campaigns ----------------

  async createDraft(
    congId: string,
    adminId: string,
    input: z.infer<typeof campaignSchema>,
  ): Promise<{ campaign_id: string }> {
    const row = await one<{ campaign_id: string }>(
      this.pool,
      `INSERT INTO sms_campaigns (congregation_id, title, body, audience, segments, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING campaign_id`,
      [congId, input.title, input.body, JSON.stringify(input.audience), smsSegments(input.body), adminId],
    );
    await audit(this.pool, adminId, "sms_campaign.created", "sms_campaigns", row.campaign_id, {
      title: input.title,
    });
    return row;
  }

  async listCampaigns(congId: string): Promise<unknown[]> {
    return many(
      this.pool,
      `SELECT c.campaign_id, c.title, c.status, c.segments, c.created_at, c.sent_at, c.audience,
              count(r.recipient_id)::int                                        AS recipients,
              count(*) FILTER (WHERE r.status = 'delivered')::int               AS delivered,
              count(*) FILTER (WHERE r.status = 'submitted')::int               AS awaiting,
              count(*) FILTER (WHERE r.status = 'failed')::int                  AS failed,
              count(*) FILTER (WHERE r.status = 'suppressed')::int              AS suppressed
         FROM sms_campaigns c
         LEFT JOIN sms_campaign_recipients r ON r.campaign_id = c.campaign_id
        WHERE c.congregation_id = $1
        GROUP BY c.campaign_id ORDER BY c.created_at DESC LIMIT 100`,
      [congId],
    );
  }

  /** The report: the campaign, its totals, and every person with their state. */
  async report(congId: string, campaignId: string): Promise<Record<string, unknown>> {
    const campaign = await maybeOne<Record<string, unknown>>(
      this.pool,
      `SELECT campaign_id, title, body, audience, segments, status, created_at, sent_at
         FROM sms_campaigns WHERE campaign_id = $1 AND congregation_id = $2`,
      [campaignId, congId],
    );
    if (!campaign) throw new ApiError("NOT_FOUND", "Campaign not found");
    const recipients = await many(
      this.pool,
      `SELECT recipient_id, user_id, full_name, phone, status, suppress_reason,
              failure_reason, cost, attempts, submitted_at, delivered_at
         FROM sms_campaign_recipients WHERE campaign_id = $1
        ORDER BY CASE status WHEN 'failed' THEN 0 WHEN 'queued' THEN 1
                             WHEN 'submitted' THEN 2 WHEN 'suppressed' THEN 3 ELSE 4 END,
                 full_name`,
      [campaignId],
    );
    return { ...campaign, recipients };
  }

  /**
   * Fire a draft: freeze the audience into recipient rows and hand the actual
   * submitting to the outbox. The status flip is the idempotency anchor — a
   * double-click loses the race on `WHERE status = 'draft'` and becomes a 409,
   * not a second blast.
   */
  async send(congId: string, adminId: string, campaignId: string): Promise<{ queued: number; suppressed: number }> {
    if (!this.at) {
      throw new ApiError("UNPROCESSABLE", "SMS is not configured — set the Africa's Talking keys first");
    }
    return tx(this.pool, async (c) => {
      const campaign = await maybeOne<{ campaign_id: string; audience: Audience; body: string }>(
        c,
        `UPDATE sms_campaigns SET status = 'sending'
          WHERE campaign_id = $1 AND congregation_id = $2 AND status = 'draft'
          RETURNING campaign_id, audience, body`,
        [campaignId, congId],
      );
      if (!campaign) {
        const exists = await maybeOne(c, `SELECT status FROM sms_campaigns WHERE campaign_id = $1 AND congregation_id = $2`, [campaignId, congId]);
        if (!exists) throw new ApiError("NOT_FOUND", "Campaign not found");
        throw new ApiError("CONFLICT", "This campaign has already been sent");
      }

      const members = await this.resolveAudience(congId, audienceSchema.parse(campaign.audience));
      if (members.length === 0) throw new ApiError("UNPROCESSABLE", "The audience matches nobody");
      const { sendable, suppressed } = partition(members);

      for (const m of sendable) {
        await c.query(
          `INSERT INTO sms_campaign_recipients (campaign_id, user_id, full_name, phone, status)
           VALUES ($1, $2, $3, $4, 'queued') ON CONFLICT (campaign_id, phone) DO NOTHING`,
          [campaignId, m.user_id, m.full_name, m.phone_number],
        );
      }
      for (const s of suppressed) {
        await c.query(
          `INSERT INTO sms_campaign_recipients (campaign_id, user_id, full_name, phone, status, suppress_reason)
           VALUES ($1, $2, $3, $4, 'suppressed', $5) ON CONFLICT (campaign_id, phone) DO NOTHING`,
          [campaignId, s.member.user_id, s.member.full_name, s.member.phone_number ?? `none:${s.member.user_id.slice(0, 8)}`, s.reason],
        );
      }

      await enqueueOutbox(c, "sms.campaign_submit", { campaign_id: campaignId });
      await audit(c, adminId, "sms_campaign.sent", "sms_campaigns", campaignId, {
        queued: sendable.length,
        suppressed: suppressed.length,
      });
      return { queued: sendable.length, suppressed: suppressed.length };
    });
  }

  /**
   * Worker side: push every queued row to Africa's Talking in batches and
   * record their per-recipient verdict. Safe to re-run — it only ever selects
   * rows still queued, so a crash mid-blast resumes instead of repeating.
   */
  async submit(campaignId: string): Promise<{ submitted: number; failed: number }> {
    const campaign = await maybeOne<{ body: string; status: string }>(
      this.pool,
      `SELECT body, status FROM sms_campaigns WHERE campaign_id = $1`,
      [campaignId],
    );
    if (!campaign) return { submitted: 0, failed: 0 };

    let submitted = 0;
    let failed = 0;
    for (;;) {
      const batch = await many<{ recipient_id: string; phone: string }>(
        this.pool,
        `SELECT recipient_id, phone FROM sms_campaign_recipients
          WHERE campaign_id = $1 AND status = 'queued' ORDER BY full_name LIMIT $2`,
        [campaignId, BATCH_SIZE],
      );
      if (batch.length === 0) break;

      if (!this.at) {
        // The provider vanished between send and submit (a redeploy without
        // keys). Say so on every row rather than leaving them queued forever.
        await this.pool.query(
          `UPDATE sms_campaign_recipients SET status = 'failed', failure_reason = 'no_provider', attempts = attempts + 1
            WHERE recipient_id = ANY($1::uuid[])`,
          [batch.map((b) => b.recipient_id)],
        );
        failed += batch.length;
        continue;
      }

      const results = await this.at.sendBatch(batch.map((b) => b.phone), campaign.body);
      const byNumber = new Map(results.map((r) => [normalize(r.number), r]));
      for (const row of batch) {
        const r = byNumber.get(normalize(row.phone));
        if (r && AT_ACCEPTED.has(r.statusCode)) {
          await this.pool.query(
            `UPDATE sms_campaign_recipients
                SET status = 'submitted', at_message_id = $2, cost = $3,
                    submitted_at = now(), attempts = attempts + 1, failure_reason = NULL
              WHERE recipient_id = $1`,
            [row.recipient_id, r.messageId, r.cost],
          );
          submitted += 1;
        } else {
          await this.pool.query(
            `UPDATE sms_campaign_recipients
                SET status = 'failed', failure_reason = $2, attempts = attempts + 1
              WHERE recipient_id = $1`,
            [row.recipient_id, r ? `${r.status || "rejected"} (code ${r.statusCode})` : "no result for this number"],
          );
          failed += 1;
        }
      }
    }

    await this.pool.query(
      `UPDATE sms_campaigns SET status = 'sent', sent_at = COALESCE(sent_at, now()) WHERE campaign_id = $1`,
      [campaignId],
    );
    return { submitted, failed };
  }

  /**
   * Put retryable failures back in the queue, bounded by MAX_ATTEMPTS. The
   * skipped are itemised — "these 3 cannot be retried until the number is
   * fixed" is a sentence, not a silent subtraction.
   */
  async retry(congId: string, adminId: string, campaignId: string): Promise<{ retried: number; skipped_terminal: number; skipped_attempts: number }> {
    const campaign = await maybeOne(
      this.pool,
      `SELECT 1 FROM sms_campaigns WHERE campaign_id = $1 AND congregation_id = $2`,
      [campaignId, congId],
    );
    if (!campaign) throw new ApiError("NOT_FOUND", "Campaign not found");

    const failedRows = await many<{ recipient_id: string; failure_reason: string | null; attempts: number }>(
      this.pool,
      `SELECT recipient_id, failure_reason, attempts FROM sms_campaign_recipients
        WHERE campaign_id = $1 AND status = 'failed'`,
      [campaignId],
    );
    const retryable = failedRows.filter((r) => r.attempts < MAX_ATTEMPTS && isRetryableReason(r.failure_reason));
    const terminal = failedRows.filter((r) => !isRetryableReason(r.failure_reason));
    if (retryable.length > 0) {
      await this.pool.query(
        `UPDATE sms_campaign_recipients SET status = 'queued' WHERE recipient_id = ANY($1::uuid[])`,
        [retryable.map((r) => r.recipient_id)],
      );
      await enqueueOutbox(this.pool, "sms.campaign_submit", { campaign_id: campaignId });
    }
    await audit(this.pool, adminId, "sms_campaign.retried", "sms_campaigns", campaignId, {
      retried: retryable.length,
    });
    return {
      retried: retryable.length,
      skipped_terminal: terminal.length,
      skipped_attempts: failedRows.length - retryable.length - terminal.length,
    };
  }

  /**
   * The delivery-report webhook lands here: Africa's Talking telling us what
   * finally happened to one message. The ONLY writer of 'delivered'.
   * Idempotent; an unknown id is logged by the caller and otherwise ignored —
   * answering non-2xx would make their retrier hammer us over a message we
   * never sent.
   */
  async recordDeliveryReport(atMessageId: string, status: string, failureReason: string | null): Promise<boolean> {
    if (/^(Success|Delivered)$/i.test(status)) {
      const res = await this.pool.query(
        `UPDATE sms_campaign_recipients
            SET status = 'delivered', delivered_at = COALESCE(delivered_at, now()), failure_reason = NULL
          WHERE at_message_id = $1`,
        [atMessageId],
      );
      return (res.rowCount ?? 0) > 0;
    }
    if (/^(Failed|Rejected|Expired)$/i.test(status)) {
      const res = await this.pool.query(
        `UPDATE sms_campaign_recipients
            SET status = 'failed', failure_reason = COALESCE($2, 'DeliveryFailure')
          WHERE at_message_id = $1 AND status <> 'delivered'`,
        [atMessageId, failureReason],
      );
      return (res.rowCount ?? 0) > 0;
    }
    // Buffered / Sent / Submitted — intermediate states; the row stays
    // 'submitted' and the final report will arrive later.
    return true;
  }
}

/** Split resolved members into the sendable and the named-suppressed. */
function partition(members: Member[]): {
  sendable: Member[];
  suppressed: Array<{ member: Member; reason: "opted_out" | "no_phone" | "duplicate_phone" }>;
} {
  const sendable: Member[] = [];
  const suppressed: Array<{ member: Member; reason: "opted_out" | "no_phone" | "duplicate_phone" }> = [];
  const seen = new Set<string>();
  for (const m of members) {
    if (!m.phone_number) suppressed.push({ member: m, reason: "no_phone" });
    else if (!m.sms_enabled) suppressed.push({ member: m, reason: "opted_out" });
    else if (seen.has(normalize(m.phone_number))) suppressed.push({ member: m, reason: "duplicate_phone" });
    else {
      seen.add(normalize(m.phone_number));
      sendable.push(m);
    }
  }
  return { sendable, suppressed };
}

/** AT echoes numbers back in E.164 with a +; ours are stored that way too. */
function normalize(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}
