// Reading & Social R1 — shared plan invites (spec §3/§6; migration 175;
// docs/READING_SOCIAL_PLAN.md §2.2/§4/§5). One shape covers both a targeted
// in-app invite (invitee_user_id set) and an open, shareable link
// (invitee_user_id NULL) — both resolve through the same /join/{token}
// public page and the same accept endpoint.
//
// Targeted invites (whether minted at group creation or via this module)
// require an ALREADY-accepted user_connections peer, same gate as group
// creation (403 CONSENT_REQUIRED otherwise) — see groups.ts. Open-link
// invites have no target to check against creation time, so per
// docs/READING_SOCIAL_PLAN.md Open Question 2, the accepted connection is
// instead ESTABLISHED on the spot at accept time (a plan invite is already
// unambiguous, unsolicited-DM-shaped consent). Open-link invites also stay
// 'pending' after a redemption (rather than moving to a terminal 'accepted')
// so the SAME shared link keeps working for the next friend in a 2-8 person
// circle — accepted_by/decided_at just record the most recent redeemer,
// informationally; shared_plan_group_members is the actual membership source
// of truth, never this row.
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx, audit, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { NotificationService } from "../notifications/service.js";
import type { ReadingSocialService } from "./groups.js";
import { mintInviteToken } from "./tokens.js";

interface InviteRow {
  invite_id: string;
  group_id: string;
  inviter_id: string;
  invitee_user_id: string | null;
  token: string;
  status: string;
  message: string | null;
  created_at: string;
  expires_at: string | null;
  decided_at: string | null;
  accepted_by: string | null;
}

export interface InvitePreview {
  token: string;
  status: string;
  message: string | null;
  group_id: string;
  plan: { code: string; title: string; subtitle: string | null; description: string | null; day_count: number; image_url: string | null };
  inviter: { user_id: string; full_name: string };
  member_count: number;
}

export class ReadingInvitesService {
  private readonly notifications: NotificationService;

  constructor(
    private readonly pool: Pool,
    private readonly groups: ReadingSocialService,
    notifications?: NotificationService,
  ) {
    this.notifications = notifications ?? new NotificationService(pool);
  }

  private async notify(userId: string, template: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.notifications.schedule({ userId, channel: "push", template, payload });
    } catch {
      // best-effort
    }
  }

  private async person(c: Queryable, userId: string): Promise<{ user_id: string; full_name: string; is_minor: boolean }> {
    const row = await maybeOne<{ user_id: string; full_name: string; is_minor: boolean; deleted_at: string | null }>(
      c, `SELECT user_id, full_name, is_minor, deleted_at FROM users WHERE user_id = $1`, [userId],
    );
    if (!row || row.deleted_at) throw new ApiError("NOT_FOUND", "Member not found");
    return row;
  }

  private async group(c: Queryable, groupId: string): Promise<{ group_id: string; plan_id: string; created_by: string; archived_at: string | null }> {
    const row = await maybeOne<{ group_id: string; plan_id: string; created_by: string; archived_at: string | null }>(
      c, `SELECT group_id, plan_id, created_by, archived_at FROM shared_plan_groups WHERE group_id = $1`, [groupId],
    );
    if (!row) throw new ApiError("NOT_FOUND", "Group not found");
    return row;
  }

  private async assertActiveMember(c: Queryable, groupId: string, userId: string): Promise<void> {
    const row = await maybeOne(c, `SELECT 1 FROM shared_plan_group_members WHERE group_id = $1 AND user_id = $2 AND status = 'active'`, [groupId, userId]);
    if (!row) throw new ApiError("FORBIDDEN_SCOPE", "Not an active member of this shared plan group");
  }

  static readonly CreateInvite = z.object({
    // nullish, not optional: Android's kotlinx Json (encodeDefaults=true +
    // explicitNulls default) sends null for unset fields (null user_id = link invite).
    user_id: z.string().uuid().nullish(),
    message: z.string().max(500).nullish(),
    client_mutation_id: z.string().uuid().optional(),
  });

  /** Mint a new invite in an existing group — active member only. Idempotent
   *  on client_mutation_id (offline-originated writes, §3.6), matching
   *  ConnectionsService.requestConnection()'s replay-dedup precedent. */
  async createInvite(userId: string, groupId: string, input: z.infer<typeof ReadingInvitesService.CreateInvite>): Promise<InviteRow & { duplicate?: boolean }> {
    return tx(this.pool, async (c) => {
      if (input.client_mutation_id) {
        const dup = await maybeOne<InviteRow>(c, `SELECT * FROM shared_plan_invites WHERE client_mutation_id = $1`, [input.client_mutation_id]);
        if (dup) return { ...dup, duplicate: true };
      }
      const g = await this.group(c, groupId);
      if (g.archived_at) throw new ApiError("CONFLICT", "This shared plan has ended");
      await this.assertActiveMember(c, groupId, userId);

      if (input.user_id) {
        if (input.user_id === userId) throw new ApiError("UNPROCESSABLE", "Cannot invite yourself");
        const me = await this.person(c, userId);
        const invitee = await this.person(c, input.user_id);
        if (me.is_minor || invitee.is_minor) throw new ApiError("FORBIDDEN_SCOPE", "Shared reading plans are unavailable for minors");
        const pair = await maybeOne<{ status: string }>(
          c, `SELECT status FROM user_connections WHERE user_a = LEAST($1::uuid,$2::uuid) AND user_b = GREATEST($1::uuid,$2::uuid)`, [userId, input.user_id],
        );
        if (pair?.status !== "accepted") {
          throw new ApiError("CONSENT_REQUIRED", "Invite requires an accepted connection first", { hint: "connect first", user_id: input.user_id });
        }
        const activeMember = await maybeOne(c, `SELECT 1 FROM shared_plan_group_members WHERE group_id = $1 AND user_id = $2 AND status = 'active'`, [groupId, input.user_id]);
        if (activeMember) throw new ApiError("CONFLICT", "Already a member of this group");
        const pending = await maybeOne<InviteRow>(c, `SELECT * FROM shared_plan_invites WHERE group_id = $1 AND invitee_user_id = $2 AND status = 'pending'`, [groupId, input.user_id]);
        if (pending) return pending;

        const token = await mintInviteToken(c);
        const row = await one<InviteRow>(
          c,
          `INSERT INTO shared_plan_invites (group_id, inviter_id, invitee_user_id, token, message, expires_at, client_mutation_id)
           VALUES ($1, $2, $3, $4, $5, now() + interval '14 days', $6) RETURNING *`,
          [groupId, userId, input.user_id, token, input.message ?? null, input.client_mutation_id ?? null],
        );
        await audit(c, userId, "reading_invite.created", "shared_plan_invites", row.invite_id, { group_id: groupId, invitee_user_id: input.user_id });
        await this.notify(input.user_id, "plan_group_invite_received", { group_id: groupId, invite_token: token, inviter_id: userId, inviter_name: me.full_name });
        return row;
      }

      // Open share-link — no target, no connection gate, no expiry.
      const token = await mintInviteToken(c);
      const row = await one<InviteRow>(
        c,
        `INSERT INTO shared_plan_invites (group_id, inviter_id, invitee_user_id, token, message, client_mutation_id)
         VALUES ($1, $2, NULL, $3, $4, $5) RETURNING *`,
        [groupId, userId, token, input.message ?? null, input.client_mutation_id ?? null],
      );
      await audit(c, userId, "reading_invite.created", "shared_plan_invites", row.invite_id, { group_id: groupId, open_link: true });
      return row;
    });
  }

  /** Pending + past invites for a group — active member only. */
  async listInvites(userId: string, groupId: string): Promise<{ data: InviteRow[] }> {
    await this.group(this.pool, groupId);
    await this.assertActiveMember(this.pool, groupId, userId);
    const data = await many<InviteRow>(this.pool, `SELECT * FROM shared_plan_invites WHERE group_id = $1 ORDER BY created_at DESC`, [groupId]);
    return { data };
  }

  /** inviter_id or the group's creator may revoke. Idempotent. */
  async revokeInvite(userId: string, groupId: string, inviteId: string): Promise<{ invite_id: string; status: string }> {
    return tx(this.pool, async (c) => {
      const g = await this.group(c, groupId);
      const invite = await maybeOne<InviteRow>(c, `SELECT * FROM shared_plan_invites WHERE invite_id = $1 AND group_id = $2`, [inviteId, groupId]);
      if (!invite) throw new ApiError("NOT_FOUND", "Invite not found");
      if (invite.inviter_id !== userId && g.created_by !== userId) {
        throw new ApiError("FORBIDDEN_SCOPE", "Only the inviter or the group's creator can revoke this invite");
      }
      if (invite.status !== "pending") return { invite_id: inviteId, status: invite.status };
      await c.query(`UPDATE shared_plan_invites SET status = 'revoked', decided_at = now() WHERE invite_id = $1`, [inviteId]);
      await audit(c, userId, "reading_invite.revoked", "shared_plan_invites", inviteId, {});
      return { invite_id: inviteId, status: "revoked" };
    });
  }

  private isDead(invite: Pick<InviteRow, "status" | "expires_at">): boolean {
    if (invite.status === "revoked" || invite.status === "declined" || invite.status === "expired") return true;
    if (invite.status === "pending" && invite.expires_at && new Date(invite.expires_at) < new Date()) return true;
    return false;
  }

  private async lazilyExpire(c: Queryable, invite: InviteRow): Promise<InviteRow> {
    if (invite.status === "pending" && invite.expires_at && new Date(invite.expires_at) < new Date()) {
      await c.query(`UPDATE shared_plan_invites SET status = 'expired', decided_at = now() WHERE invite_id = $1`, [invite.invite_id]);
      return { ...invite, status: "expired" };
    }
    return invite;
  }

  /** Authenticated in-app preview — what the client calls right after a deep
   *  link opens the app while logged in. 404 on unknown/expired/revoked/declined. */
  async getInvitePreview(_userId: string, token: string): Promise<InvitePreview> {
    const invite = await maybeOne<InviteRow>(this.pool, `SELECT * FROM shared_plan_invites WHERE token = $1`, [token]);
    if (!invite) throw new ApiError("NOT_FOUND", "Invite not found");
    const live = await this.lazilyExpire(this.pool, invite);
    if (this.isDead(live)) throw new ApiError("NOT_FOUND", "Invite not found");
    const g = await maybeOne<{ group_id: string; plan_id: string; code: string; title: string; subtitle: string | null; description: string | null; day_count: number; image_url: string | null }>(
      this.pool,
      `SELECT g.group_id, g.plan_id, p.code, p.title, p.subtitle, p.description, p.day_count, p.image_url
         FROM shared_plan_groups g JOIN reading_plans p ON p.plan_id = g.plan_id WHERE g.group_id = $1`,
      [live.group_id],
    );
    if (!g) throw new ApiError("NOT_FOUND", "Invite not found");
    const inviter = await this.person(this.pool, live.inviter_id);
    const count = await one<{ n: number }>(this.pool, `SELECT count(*)::int AS n FROM shared_plan_group_members WHERE group_id = $1 AND status = 'active'`, [live.group_id]);
    return {
      token: live.token, status: live.status, message: live.message, group_id: live.group_id,
      plan: { code: g.code, title: g.title, subtitle: g.subtitle, description: g.description, day_count: g.day_count, image_url: g.image_url },
      inviter: { user_id: inviter.user_id, full_name: inviter.full_name },
      member_count: count.n,
    };
  }

  /**
   * Redeem. Idempotent: replaying an already-accepted TARGETED invite by the
   * same caller is a no-op. Open-link invites never move off 'pending' so the
   * same link can be shared with (and redeemed by) more than one friend —
   * see the module header. Establishes the accepted connection on the spot
   * (Open Question 2) rather than requiring one pre-exist, since an
   * open-link redeemer may be a stranger to the inviter.
   */
  async acceptInvite(userId: string, token: string): Promise<{ group_id: string; status: string; joined: boolean }> {
    let planIdToEnroll: string | null = null;
    const result = await tx(this.pool, async (c) => {
      const invite = await maybeOne<InviteRow>(c, `SELECT * FROM shared_plan_invites WHERE token = $1 FOR UPDATE`, [token]);
      if (!invite) throw new ApiError("NOT_FOUND", "Invite not found");
      const live = await this.lazilyExpire(c, invite);
      if (invite.invitee_user_id && invite.invitee_user_id !== userId) {
        throw new ApiError("FORBIDDEN_SCOPE", "This invite is for someone else");
      }
      if (live.invitee_user_id && live.status === "accepted" && live.accepted_by === userId) {
        return { group_id: live.group_id, status: "accepted", joined: false };
      }
      if (this.isDead(live)) throw new ApiError("NOT_FOUND", "Invite not found");

      const g = await this.group(c, live.group_id);
      if (g.archived_at) throw new ApiError("CONFLICT", "This shared plan has ended");

      const me = await this.person(c, userId);
      if (me.is_minor) throw new ApiError("FORBIDDEN_SCOPE", "Shared reading plans are unavailable for minors");
      await this.ensureConnection(c, live.inviter_id, userId);

      // Membership row only, on THIS transaction's client — plan enrollment
      // runs after commit (see the enrollInPlan call below): GrowthContentService
      // always queries through its own stored Pool, so calling it here would
      // silently escape this transaction and hold a second pool connection
      // while this one is still checked out.
      const joined = await this.groups.addMember(c, live.group_id, userId);
      if (joined) planIdToEnroll = g.plan_id;

      if (live.invitee_user_id) {
        await c.query(`UPDATE shared_plan_invites SET status = 'accepted', accepted_by = $1, decided_at = now() WHERE invite_id = $2`, [userId, live.invite_id]);
      } else {
        // Open link: stays 'pending' — record the most recent redeemer only.
        await c.query(`UPDATE shared_plan_invites SET accepted_by = $1, decided_at = now() WHERE invite_id = $2`, [userId, live.invite_id]);
      }
      await audit(c, userId, "reading_invite.accepted", "shared_plan_invites", live.invite_id, { group_id: live.group_id });

      if (joined) {
        await this.notify(live.inviter_id, "plan_group_invite_accepted", { group_id: live.group_id, user_id: userId, full_name: me.full_name });
        await this.groups.notifyMemberJoined(live.group_id, userId, me.full_name, live.inviter_id);
      }
      return { group_id: live.group_id, status: live.invitee_user_id ? "accepted" : "joined", joined };
    });
    if (planIdToEnroll) await this.groups.enrollInPlan(userId, planIdToEnroll);
    return result;
  }

  /** Targeted invites only — 403 on an open link (no single party to decline for everyone). */
  async declineInvite(userId: string, token: string): Promise<{ status: string; already: boolean }> {
    return tx(this.pool, async (c) => {
      const invite = await maybeOne<InviteRow>(c, `SELECT * FROM shared_plan_invites WHERE token = $1 FOR UPDATE`, [token]);
      if (!invite) throw new ApiError("NOT_FOUND", "Invite not found");
      if (!invite.invitee_user_id) throw new ApiError("FORBIDDEN_SCOPE", "An open share link cannot be declined");
      if (invite.invitee_user_id !== userId) throw new ApiError("FORBIDDEN_SCOPE", "This invite is for someone else");
      if (invite.status !== "pending") return { status: invite.status, already: true };
      await c.query(`UPDATE shared_plan_invites SET status = 'declined', decided_at = now() WHERE invite_id = $1`, [invite.invite_id]);
      await audit(c, userId, "reading_invite.declined", "shared_plan_invites", invite.invite_id, {});
      return { status: "declined", already: false };
    });
  }

  /** Create (or reinstate) an accepted connection between two people —
   *  mirrors ConnectionsService's mutual-accept upsert. Refuses a blocked
   *  pair or a minor on either side; a no-op if already accepted. */
  private async ensureConnection(c: Queryable, userA: string, userB: string): Promise<void> {
    if (userA === userB) return;
    const pair = await maybeOne<{ status: string }>(
      c, `SELECT status FROM user_connections WHERE user_a = LEAST($1::uuid,$2::uuid) AND user_b = GREATEST($1::uuid,$2::uuid)`, [userA, userB],
    );
    if (pair?.status === "accepted") return;
    if (pair?.status === "blocked") throw new ApiError("FORBIDDEN_SCOPE", "This connection is blocked");
    const a = await this.person(c, userA);
    const b = await this.person(c, userB);
    if (a.is_minor || b.is_minor) throw new ApiError("FORBIDDEN_SCOPE", "Connections are unavailable for minors");
    await c.query(
      `INSERT INTO user_connections (user_a, user_b, status) VALUES (LEAST($1::uuid,$2::uuid), GREATEST($1::uuid,$2::uuid), 'accepted')
       ON CONFLICT (user_a, user_b) DO UPDATE SET status = 'accepted', blocked_by = NULL, updated_at = now()`,
      [userA, userB],
    );
  }
}
