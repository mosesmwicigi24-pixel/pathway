// Reading & Social R1 — shared plan groups ("Read with a Friend", spec §3;
// docs/READING_SOCIAL_PLAN.md §2.1/§4). A bounded, invite-only group of
// members walking ONE reading_plans row together (migration 174).
//
// Deliberately NO second progress table: joining a group enrolls the member
// in the underlying plan via the existing, unmodified
// GrowthContentService.startPlan() — this service reuses it rather than
// re-implementing enrollment. "Per-participant progress" is answered by
// joining shared_plan_group_members to reading_plan_progress on
// (user_id, plan_id = group.plan_id): one source of truth, never duplicated.
//
// Progress-visibility scope (a real, narrow exception to reading_plan_progress
// being private to the member, per docs/READING_SOCIAL_PLAN.md §2.1): another
// member's current_day/completed_days is exposed ONLY when both callers are
// status='active' members of the same shared_plan_group, and only for that
// group's plan_id — enforced here by every query joining through group
// membership, never by a bare reading_plan_progress lookup.
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx, audit, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { NotificationService } from "../notifications/service.js";
import { GrowthContentService } from "../growth-content/service.js";
import { mintInviteToken } from "./tokens.js";

export interface GroupMemberRow {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  status: "active" | "left" | "removed";
  joined_at: string;
  left_at: string | null;
  current_day: number | null;
  completed_days: number[] | null;
  days_done: number;
  completed_at: string | null;
}

export interface GroupRow {
  group_id: string;
  plan_id: string;
  created_by: string;
  name: string | null;
  created_at: string;
  archived_at: string | null;
  plan: { code: string; title: string; subtitle: string | null; description: string | null; day_count: number; image_url: string | null };
  members: GroupMemberRow[];
}

export class ReadingSocialService {
  private readonly notifications: NotificationService;
  private readonly growthContent: GrowthContentService;

  constructor(private readonly pool: Pool, notifications?: NotificationService) {
    this.notifications = notifications ?? new NotificationService(pool);
    this.growthContent = new GrowthContentService(pool);
  }

  private async notify(userId: string, template: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.notifications.schedule({ userId, channel: "push", template, payload });
    } catch {
      // best-effort — group/invite state is authoritative regardless
    }
  }

  /** A live, non-deleted user (404s rather than leaking "deleted" as a distinct state). */
  private async person(c: Queryable, userId: string): Promise<{ user_id: string; full_name: string; is_minor: boolean }> {
    const row = await maybeOne<{ user_id: string; full_name: string; is_minor: boolean; deleted_at: string | null }>(
      c, `SELECT user_id, full_name, is_minor, deleted_at FROM users WHERE user_id = $1`, [userId],
    );
    if (!row || row.deleted_at) throw new ApiError("NOT_FOUND", "Member not found");
    return row;
  }

  private async membersOf(c: Queryable, groupId: string, planId: string): Promise<GroupMemberRow[]> {
    return many<GroupMemberRow>(
      c,
      `SELECT m.user_id, u.full_name, u.avatar_url, m.status, m.joined_at, m.left_at,
              pr.current_day, pr.completed_days, COALESCE(array_length(pr.completed_days, 1), 0) AS days_done,
              pr.completed_at
         FROM shared_plan_group_members m
         JOIN users u ON u.user_id = m.user_id
         LEFT JOIN reading_plan_progress pr ON pr.user_id = m.user_id AND pr.plan_id = $2
        WHERE m.group_id = $1
        ORDER BY m.joined_at`,
      [groupId, planId],
    );
  }

  private async groupRow(c: Queryable, groupId: string): Promise<{
    group_id: string; plan_id: string; created_by: string; name: string | null; created_at: string; archived_at: string | null;
    code: string; title: string; subtitle: string | null; description: string | null; day_count: number; image_url: string | null;
  } | null> {
    return maybeOne(
      c,
      `SELECT g.group_id, g.plan_id, g.created_by, g.name, g.created_at, g.archived_at,
              p.code, p.title, p.subtitle, p.description, p.day_count, p.image_url
         FROM shared_plan_groups g
         JOIN reading_plans p ON p.plan_id = g.plan_id
        WHERE g.group_id = $1`,
      [groupId],
    );
  }

  private toGroup(row: NonNullable<Awaited<ReturnType<ReadingSocialService["groupRow"]>>>, members: GroupMemberRow[]): GroupRow {
    return {
      group_id: row.group_id, plan_id: row.plan_id, created_by: row.created_by, name: row.name,
      created_at: row.created_at, archived_at: row.archived_at,
      plan: { code: row.code, title: row.title, subtitle: row.subtitle, description: row.description, day_count: row.day_count, image_url: row.image_url },
      members,
    };
  }

  private async assertActiveMember(c: Queryable, groupId: string, userId: string): Promise<void> {
    const row = await maybeOne(c, `SELECT 1 FROM shared_plan_group_members WHERE group_id = $1 AND user_id = $2 AND status = 'active'`, [groupId, userId]);
    if (!row) throw new ApiError("FORBIDDEN_SCOPE", "Not an active member of this shared plan group");
  }

  static readonly CreateGroup = z.object({
    plan_id: z.string().uuid(),
    member_user_ids: z.array(z.string().uuid()).max(7).optional(),
    name: z.string().trim().min(1).max(120).optional(),
  });

  /**
   * Create-or-get: if the caller is already an active member of a (non-
   * archived) group for this plan, that SAME group is returned rather than a
   * duplicate being minted — "create-or-get my group for a plan". Any newly
   * named `member_user_ids` are still processed as targeted invites either
   * way (idempotent — an existing pending invite to the same person is a
   * no-op, not a second row).
   */
  async createOrGetGroup(userId: string, input: z.infer<typeof ReadingSocialService.CreateGroup>): Promise<GroupRow> {
    const result = await tx(this.pool, async (c) => {
      const plan = await maybeOne<{ plan_id: string }>(c, `SELECT plan_id FROM reading_plans WHERE plan_id = $1 AND is_active`, [input.plan_id]);
      if (!plan) throw new ApiError("NOT_FOUND", "Reading plan not found");

      const memberIds = [...new Set((input.member_user_ids ?? []).filter((id) => id !== userId))];
      // Validate every named member is an accepted connection BEFORE writing
      // anything (§4: "each entry must be an accepted user_connections peer,
      // else 403 CONSENT_REQUIRED" — fail the whole call, not partially).
      for (const id of memberIds) {
        const invitee = await this.person(c, id);
        const me = await this.person(c, userId);
        if (me.is_minor || invitee.is_minor) throw new ApiError("FORBIDDEN_SCOPE", "Shared reading plans are unavailable for minors");
        const pair = await maybeOne<{ status: string }>(
          c, `SELECT status FROM user_connections WHERE user_a = LEAST($1::uuid,$2::uuid) AND user_b = GREATEST($1::uuid,$2::uuid)`, [userId, id],
        );
        if (pair?.status !== "accepted") {
          throw new ApiError("CONSENT_REQUIRED", "Invite requires an accepted connection first", { hint: "connect first", user_id: id });
        }
      }

      const existing = await maybeOne<{ group_id: string }>(
        c,
        `SELECT g.group_id FROM shared_plan_groups g
           JOIN shared_plan_group_members m ON m.group_id = g.group_id
          WHERE g.plan_id = $1 AND m.user_id = $2 AND m.status = 'active' AND g.archived_at IS NULL
          ORDER BY g.created_at LIMIT 1`,
        [input.plan_id, userId],
      );

      let groupId: string;
      if (existing) {
        groupId = existing.group_id;
      } else {
        const created = await one<{ group_id: string }>(
          c,
          `INSERT INTO shared_plan_groups (plan_id, created_by, name) VALUES ($1, $2, $3) RETURNING group_id`,
          [input.plan_id, userId, input.name ?? null],
        );
        groupId = created.group_id;
        await c.query(`INSERT INTO shared_plan_group_members (group_id, user_id) VALUES ($1, $2)`, [groupId, userId]);
        await audit(c, userId, "reading_group.created", "shared_plan_groups", groupId, { plan_id: input.plan_id });
      }

      for (const id of memberIds) {
        const active = await maybeOne(c, `SELECT 1 FROM shared_plan_group_members WHERE group_id = $1 AND user_id = $2 AND status = 'active'`, [groupId, id]);
        if (active) continue;
        const pending = await maybeOne(c, `SELECT 1 FROM shared_plan_invites WHERE group_id = $1 AND invitee_user_id = $2 AND status = 'pending'`, [groupId, id]);
        if (pending) continue;
        const token = await mintInviteToken(c);
        const inviteRow = await one<{ invite_id: string }>(
          c,
          `INSERT INTO shared_plan_invites (group_id, inviter_id, invitee_user_id, token, expires_at)
           VALUES ($1, $2, $3, $4, now() + interval '14 days') RETURNING invite_id`,
          [groupId, userId, id, token],
        );
        const inviter = await this.person(c, userId);
        await audit(c, userId, "reading_invite.created", "shared_plan_invites", inviteRow.invite_id, { group_id: groupId, invitee_user_id: id });
        await this.notify(id, "plan_group_invite_received", { group_id: groupId, invite_token: token, inviter_id: userId, inviter_name: inviter.full_name });
      }

      const row = await this.groupRow(c, groupId);
      if (!row) throw new ApiError("NOT_FOUND", "Group not found");
      const members = await this.membersOf(c, groupId, row.plan_id);
      return this.toGroup(row, members);
    });
    // Enrollment runs on a SEPARATE connection than the transaction above
    // (GrowthContentService always queries through its own stored Pool, never
    // a passed-in transaction client) — deliberately run AFTER commit, not
    // nested inside tx(), so it never holds a second pool connection while
    // the first is still checked out (pool starvation/deadlock risk under
    // load). Idempotent upsert either way, so this is safe to run standalone.
    await this.growthContent.startPlan(userId, input.plan_id);
    return result;
  }

  /** My active shared groups (plan summary + full member list + progress). */
  async listMyGroups(userId: string): Promise<{ data: GroupRow[] }> {
    const groupIds = await many<{ group_id: string }>(
      this.pool,
      `SELECT g.group_id FROM shared_plan_groups g
         JOIN shared_plan_group_members m ON m.group_id = g.group_id
        WHERE m.user_id = $1 AND m.status = 'active'
        ORDER BY g.created_at DESC`,
      [userId],
    );
    const data: GroupRow[] = [];
    for (const { group_id } of groupIds) {
      const row = await this.groupRow(this.pool, group_id);
      if (!row) continue;
      const members = await this.membersOf(this.pool, group_id, row.plan_id);
      data.push(this.toGroup(row, members));
    }
    return { data };
  }

  /** Full detail — active member only. 403 (not 404) for a non-member so a
   *  stray group_id never confirms/denies a group's existence to a stranger. */
  async getGroup(userId: string, groupId: string): Promise<GroupRow> {
    const row = await this.groupRow(this.pool, groupId);
    if (!row) throw new ApiError("NOT_FOUND", "Group not found");
    await this.assertActiveMember(this.pool, groupId, userId);
    const members = await this.membersOf(this.pool, groupId, row.plan_id);
    return this.toGroup(row, members);
  }

  /** Creator-only. Soft "ended" state — membership + history are kept. Idempotent. */
  async archiveGroup(userId: string, groupId: string): Promise<{ group_id: string; archived_at: string }> {
    return tx(this.pool, async (c) => {
      const row = await maybeOne<{ created_by: string; archived_at: string | null }>(
        c, `SELECT created_by, archived_at FROM shared_plan_groups WHERE group_id = $1`, [groupId],
      );
      if (!row) throw new ApiError("NOT_FOUND", "Group not found");
      if (row.created_by !== userId) throw new ApiError("FORBIDDEN_SCOPE", "Only the group's creator can archive it");
      if (row.archived_at) return { group_id: groupId, archived_at: row.archived_at };
      const updated = await one<{ archived_at: string }>(
        c, `UPDATE shared_plan_groups SET archived_at = now() WHERE group_id = $1 RETURNING archived_at`, [groupId],
      );
      await audit(c, userId, "reading_group.archived", "shared_plan_groups", groupId, {});
      return { group_id: groupId, archived_at: updated.archived_at };
    });
  }

  /** Any active member may leave (including the creator — ownership is not
   *  reassigned in R1, per docs/READING_SOCIAL_PLAN.md Open Question 4).
   *  Idempotent: leaving twice is a no-op. */
  async leaveGroup(userId: string, groupId: string): Promise<{ group_id: string; status: string }> {
    return tx(this.pool, async (c) => {
      const row = await maybeOne<{ status: string }>(
        c, `SELECT status FROM shared_plan_group_members WHERE group_id = $1 AND user_id = $2`, [groupId, userId],
      );
      if (!row) throw new ApiError("NOT_FOUND", "You are not a member of this group");
      if (row.status !== "active") return { group_id: groupId, status: row.status };
      await c.query(`UPDATE shared_plan_group_members SET status = 'left', left_at = now() WHERE group_id = $1 AND user_id = $2`, [groupId, userId]);
      await audit(c, userId, "reading_group.left", "shared_plan_groups", groupId, {});
      return { group_id: groupId, status: "left" };
    });
  }

  // ---- Internal: shared by invites.ts (accept) ----

  /** Add (or reactivate) a member — membership row only, on the CALLER's
   *  transaction client. Idempotent: returns false when already active.
   *  Deliberately does NOT enroll in the plan here — GrowthContentService
   *  always queries through its own stored Pool, never a passed-in
   *  transaction client, so that call must run after commit (see
   *  enrollInPlan / the caller in invites.ts) rather than nested inside this
   *  transaction (pool starvation/deadlock risk under load). */
  async addMember(c: Queryable, groupId: string, userId: string): Promise<boolean> {
    const existing = await maybeOne<{ status: string }>(c, `SELECT status FROM shared_plan_group_members WHERE group_id = $1 AND user_id = $2`, [groupId, userId]);
    if (existing?.status === "active") return false;
    if (existing) {
      await c.query(`UPDATE shared_plan_group_members SET status = 'active', joined_at = now(), left_at = NULL WHERE group_id = $1 AND user_id = $2`, [groupId, userId]);
    } else {
      await c.query(`INSERT INTO shared_plan_group_members (group_id, user_id) VALUES ($1, $2)`, [groupId, userId]);
    }
    return true;
  }

  /** Enroll in the underlying plan — a thin, deliberately post-commit
   *  passthrough to the existing, unmodified GrowthContentService.startPlan()
   *  (docs/READING_SOCIAL_PLAN.md §2.1: one source of truth, never
   *  duplicated). Idempotent upsert; safe to call standalone. */
  async enrollInPlan(userId: string, planId: string): Promise<void> {
    await this.growthContent.startPlan(userId, planId);
  }

  async notifyMemberJoined(groupId: string, joinerId: string, joinerName: string, excludeUserId: string): Promise<void> {
    const others = await many<{ user_id: string }>(
      this.pool, `SELECT user_id FROM shared_plan_group_members WHERE group_id = $1 AND status = 'active' AND user_id NOT IN ($2, $3)`,
      [groupId, joinerId, excludeUserId],
    );
    for (const o of others) {
      await this.notify(o.user_id, "plan_group_member_joined", { group_id: groupId, user_id: joinerId, full_name: joinerName });
    }
  }

  /**
   * Progress-event fan-out (spec §3; docs/READING_SOCIAL_PLAN.md §4 + Open
   * Question 5). Called after a successful completeDay/completeSegment
   * roll-up. Best-effort (never throws — wrapped internally) and deduped per
   * (group_id, day_number, notifier, recipient) so a client retry or the
   * completeSegment/completeDay race never double-notifies; the existing
   * notification_preferences.max_daily cap is the fatigue backstop, not a
   * second feature-specific throttle.
   */
  async notifyDayCompleted(userId: string, planId: string, dayNumber: number): Promise<void> {
    try {
      const groups = await many<{ group_id: string }>(
        this.pool,
        `SELECT g.group_id FROM shared_plan_group_members m
           JOIN shared_plan_groups g ON g.group_id = m.group_id
          WHERE m.user_id = $1 AND m.status = 'active' AND g.plan_id = $2 AND g.archived_at IS NULL`,
        [userId, planId],
      );
      if (groups.length === 0) return;
      const me = await maybeOne<{ full_name: string }>(this.pool, `SELECT full_name FROM users WHERE user_id = $1`, [userId]);
      for (const g of groups) {
        const others = await many<{ user_id: string }>(
          this.pool, `SELECT user_id FROM shared_plan_group_members WHERE group_id = $1 AND status = 'active' AND user_id <> $2`,
          [g.group_id, userId],
        );
        for (const o of others) {
          const dup = await maybeOne(
            this.pool,
            `SELECT 1 FROM notifications
              WHERE user_id = $1 AND template = 'plan_group_day_completed'
                AND payload ->> 'group_id' = $2 AND payload ->> 'day_number' = $3 AND payload ->> 'notifier_user_id' = $4
              LIMIT 1`,
            [o.user_id, g.group_id, String(dayNumber), userId],
          );
          if (dup) continue;
          await this.notify(o.user_id, "plan_group_day_completed", {
            group_id: g.group_id, plan_id: planId, day_number: dayNumber, notifier_user_id: userId, notifier_name: me?.full_name ?? "A friend",
          });
        }
      }
    } catch {
      // best-effort — never break the caller's completeDay/completeSegment response
    }
  }
}
