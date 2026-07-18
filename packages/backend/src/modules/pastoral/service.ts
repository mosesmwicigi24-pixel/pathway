// Module: pastoral — "Talk with My Pastor" (Chat Redesign C2,
// docs/CHAT_REDESIGN.md §"Talk with My Pastor",
// docs/CHAT_REDESIGN_PLAN.md §2.4/§4/§8 Open Question 2).
//
// pastor_assignments (migration 164) was schema-only until now — this module
// is its first reader/writer. Resolution order, in the exact words of the
// owner brief ("Unassigned → configured default pastoral account... no
// hard-coded user id"):
//   1. the member's own active PERSONAL row (assignment_kind IN primary/campus/cell).
//   2. the member's congregation's active DEFAULT row (member_user_id IS NULL).
//   3. last resort: the congregation's earliest-created SuperAdmin — audited
//      EVERY time it actually fires (plan §8 Open Question 2), so ops notices
//      the configuration gap instead of the fallback quietly becoming
//      permanent infrastructure.
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx, audit, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";

export type PastorSource = "assigned" | "congregation_default" | "fallback_superadmin";

export interface ResolvedPastor {
  pastor_user_id: string;
  source: PastorSource;
}

/**
 * The member's CURRENT pastor per the three-step resolution order above.
 * Step 3 is NOT audited here — firing an audit_log write on every plain read
 * (e.g. from broadcast reply-policy's "linked_thread" lookup) would spam the
 * log; callers that actually OPEN a thread on the strength of the fallback
 * (PastoralService.openMyThread) audit it themselves, once, at the point a
 * real conversation gets created from it. Returns null only when NOTHING
 * resolves (no assignment, no default, and not even a SuperAdmin exists to
 * fall back to).
 */
export async function resolvePastorForMember(
  q: Queryable,
  memberUserId: string,
): Promise<ResolvedPastor | null> {
  const assigned = await maybeOne<{ pastor_user_id: string }>(
    q,
    `SELECT pastor_user_id FROM pastor_assignments WHERE member_user_id = $1 AND ended_at IS NULL`,
    [memberUserId],
  );
  if (assigned) return { pastor_user_id: assigned.pastor_user_id, source: "assigned" };

  const member = await maybeOne<{ congregation_id: string | null }>(
    q, `SELECT congregation_id FROM users WHERE user_id = $1 AND deleted_at IS NULL`, [memberUserId],
  );
  if (member?.congregation_id) {
    const def = await maybeOne<{ pastor_user_id: string }>(
      q,
      `SELECT pastor_user_id FROM pastor_assignments
        WHERE congregation_id = $1 AND member_user_id IS NULL AND ended_at IS NULL`,
      [member.congregation_id],
    );
    if (def) return { pastor_user_id: def.pastor_user_id, source: "congregation_default" };
  }

  // Last resort: the earliest-created SuperAdmin — scoped to the member's own
  // congregation first (the same "reach" precedent as a congregation-scoped
  // broadcast), falling back to ANY SuperAdmin only when the member has no
  // congregation to scope to at all.
  const scoped = member?.congregation_id
    ? await maybeOne<{ user_id: string }>(
        q,
        `SELECT user_id FROM users WHERE congregation_id = $1 AND role = 'SuperAdmin' AND deleted_at IS NULL
          ORDER BY created_at ASC LIMIT 1`,
        [member.congregation_id],
      )
    : null;
  const fallback = scoped ?? (await maybeOne<{ user_id: string }>(
    q, `SELECT user_id FROM users WHERE role = 'SuperAdmin' AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
  ));
  if (!fallback) return null;
  return { pastor_user_id: fallback.user_id, source: "fallback_superadmin" };
}

export class PastoralService {
  constructor(private readonly pool: Pool) {}

  /**
   * Create-or-open the caller's PASTORAL thread with their CURRENT pastor.
   * Member-facing — no step-up (this is the owner's own conversation; §5.3
   * step-up applies to the PASTOR side reading the inbox, not here).
   * Minor-safe (D-M6) like every other DM. Never reuses an archived thread
   * (mirrors the DISCIPLER guard, migration 169 — symmetry, even though
   * pastoral reassignment doesn't archive in C2, see the C2 report). Audits
   * the fallback the FIRST time it actually creates a thread via step 3.
   */
  async openMyThread(userId: string): Promise<{ conversation_id: string; pastor_user_id: string; source: PastorSource }> {
    return tx(this.pool, async (c) => {
      const me = await maybeOne<{ is_minor: boolean; congregation_id: string | null }>(
        c, `SELECT is_minor, congregation_id FROM users WHERE user_id = $1 AND deleted_at IS NULL`, [userId],
      );
      if (!me) throw new ApiError("NOT_FOUND", "Member not found");
      const resolved = await resolvePastorForMember(c, userId);
      if (!resolved) throw new ApiError("NOT_FOUND", "No pastor available", { no_pastor: true });

      const pastor = await maybeOne<{ is_minor: boolean; congregation_id: string | null }>(
        c, `SELECT is_minor, congregation_id FROM users WHERE user_id = $1 AND deleted_at IS NULL`, [resolved.pastor_user_id],
      );
      if (!pastor) throw new ApiError("NOT_FOUND", "No pastor available", { no_pastor: true });
      if (me.is_minor || pastor.is_minor) {
        throw new ApiError("FORBIDDEN_SCOPE", "Direct messages are unavailable for minors");
      }

      const existing = await maybeOne<{ conversation_id: string }>(
        c,
        `SELECT cv.conversation_id FROM chat_conversations cv
          WHERE cv.kind = 'dm' AND cv.type = 'PASTORAL' AND cv.archived_at IS NULL
            AND EXISTS (SELECT 1 FROM chat_members m WHERE m.conversation_id = cv.conversation_id AND m.user_id = $1)
            AND EXISTS (SELECT 1 FROM chat_members m2 WHERE m2.conversation_id = cv.conversation_id AND m2.user_id = $2)
          LIMIT 1`,
        [userId, resolved.pastor_user_id],
      );
      if (existing) {
        return { conversation_id: existing.conversation_id, pastor_user_id: resolved.pastor_user_id, source: resolved.source };
      }

      if (resolved.source === "fallback_superadmin") {
        await audit(c, userId, "pastoral.fallback_used", "pastor_assignments", null, {
          member_user_id: userId,
          congregation_id: me.congregation_id,
          pastor_user_id: resolved.pastor_user_id,
        });
      }
      const convo = await one<{ conversation_id: string }>(
        c,
        `INSERT INTO chat_conversations (conversation_id, kind, type, congregation_id, created_by)
         VALUES (gen_random_uuid(), 'dm', 'PASTORAL', $1, $2) RETURNING conversation_id`,
        [me.congregation_id ?? pastor.congregation_id, userId],
      );
      await c.query(
        `INSERT INTO chat_members (conversation_id, user_id) VALUES ($1,$2),($1,$3)`,
        [convo.conversation_id, userId, resolved.pastor_user_id],
      );
      await audit(c, userId, "pastoral.thread_opened", "chat_conversations", convo.conversation_id, {
        pastor_user_id: resolved.pastor_user_id, source: resolved.source,
      });
      return { conversation_id: convo.conversation_id, pastor_user_id: resolved.pastor_user_id, source: resolved.source };
    });
  }

  /**
   * Pastoral Inbox — every PASTORAL thread the caller is a participant in
   * (their own assigned members, past + present — no-data-loss), or EVERY
   * PASTORAL thread for a SuperAdmin (the documented oversight/fallback
   * reach, plan §5 permission matrix — no `pastoral_admin` RBAC role in C2,
   * see the report). Anyone who has never held a pastor_assignments row and
   * isn't SuperAdmin is refused: this is the PASTOR-facing inbox, not a
   * member's own single thread (already reachable via POST /chat/pastoral +
   * ordinary GET /chat/conversations/:id).
   */
  async inbox(callerId: string, viewerRole?: string): Promise<{ data: unknown[] }> {
    const isSuperAdmin = viewerRole === "SuperAdmin";
    if (!isSuperAdmin) {
      const everPastor = await maybeOne(this.pool, `SELECT 1 FROM pastor_assignments WHERE pastor_user_id = $1 LIMIT 1`, [callerId]);
      if (!everPastor) throw new ApiError("FORBIDDEN_SCOPE", "Pastoral inbox requires a pastor assignment");
    }
    const data = await many(
      this.pool,
      `SELECT cv.conversation_id, cv.archived_at, cv.updated_at,
              m.user_id AS member_user_id, u.full_name AS member_name, u.avatar_url AS member_avatar_url,
              lm.body AS last_body, lm.created_at AS last_at
         FROM chat_conversations cv
         JOIN chat_members m ON m.conversation_id = cv.conversation_id AND m.user_id <> $1
         JOIN users u ON u.user_id = m.user_id
         LEFT JOIN LATERAL (
            SELECT body, created_at FROM chat_messages
             WHERE conversation_id = cv.conversation_id AND deleted_at IS NULL AND NOT is_hidden
             ORDER BY created_at DESC LIMIT 1
         ) lm ON TRUE
        WHERE cv.type = 'PASTORAL'
          AND ($2::boolean OR EXISTS (SELECT 1 FROM chat_members mm WHERE mm.conversation_id = cv.conversation_id AND mm.user_id = $1))
        ORDER BY COALESCE(lm.created_at, cv.created_at) DESC`,
      [callerId, isSuperAdmin],
    );
    return { data };
  }

  static readonly AssignPastor = z.object({
    member_user_id: z.string().uuid().nullable().optional(),
    congregation_id: z.string().uuid().optional(),
    pastor_user_id: z.string().uuid(),
    assignment_kind: z.enum(["primary", "campus", "cell", "default"]).default("primary"),
  });

  /**
   * Name (or rename) a member's pastor, or a congregation's default pastoral
   * account. Admin-gated (requireRole("Admin") at the route) — a smaller,
   * ready-made bar rather than a new `chatPastoral` RBAC module/permission,
   * which is deferred (see the C2 report; the plan's own permission matrix
   * names a `pastoral_admin` RBAC role for C3, not required to ship C2).
   * Ends the prior active row for the SAME key (member, or congregation
   * default) before inserting the new one — history-preserving, mirrors
   * DisciplerAssignmentsService.assignDiscipler.
   */
  async assign(
    actorId: string,
    input: z.infer<typeof PastoralService.AssignPastor>,
  ): Promise<{ assignment_id: string; reassigned: boolean }> {
    const isDefault = input.member_user_id == null;
    if (isDefault) {
      if (input.assignment_kind !== "default" || !input.congregation_id) {
        throw new ApiError("VALIDATION_FAILED", "A congregation default needs assignment_kind='default' and a congregation_id");
      }
    } else if (input.assignment_kind === "default") {
      throw new ApiError("VALIDATION_FAILED", "assignment_kind='default' requires no member_user_id");
    }
    return tx(this.pool, async (c) => {
      const pastor = await maybeOne(c, `SELECT 1 FROM users WHERE user_id = $1 AND deleted_at IS NULL`, [input.pastor_user_id]);
      if (!pastor) throw new ApiError("NOT_FOUND", "Pastor not found");

      let priorId: string | null = null;
      if (isDefault) {
        const prior = await maybeOne<{ assignment_id: string }>(
          c,
          `SELECT assignment_id FROM pastor_assignments WHERE congregation_id = $1 AND member_user_id IS NULL AND ended_at IS NULL`,
          [input.congregation_id],
        );
        priorId = prior?.assignment_id ?? null;
      } else {
        const member = await maybeOne(c, `SELECT 1 FROM users WHERE user_id = $1 AND deleted_at IS NULL`, [input.member_user_id]);
        if (!member) throw new ApiError("NOT_FOUND", "Member not found");
        const prior = await maybeOne<{ assignment_id: string }>(
          c, `SELECT assignment_id FROM pastor_assignments WHERE member_user_id = $1 AND ended_at IS NULL`, [input.member_user_id],
        );
        priorId = prior?.assignment_id ?? null;
      }
      if (priorId) {
        await c.query(`UPDATE pastor_assignments SET ended_at = now() WHERE assignment_id = $1`, [priorId]);
      }
      const row = await one<{ assignment_id: string }>(
        c,
        `INSERT INTO pastor_assignments (member_user_id, congregation_id, pastor_user_id, assignment_kind, assigned_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING assignment_id`,
        [input.member_user_id ?? null, input.congregation_id ?? null, input.pastor_user_id, input.assignment_kind, actorId],
      );
      await audit(c, actorId, priorId ? "pastor.reassigned" : "pastor.assigned", "pastor_assignments", row.assignment_id, {
        member_user_id: input.member_user_id ?? null,
        congregation_id: input.congregation_id ?? null,
        pastor_user_id: input.pastor_user_id,
      });
      return { assignment_id: row.assignment_id, reassigned: priorId !== null };
    });
  }

  /** Full assignment history for a member, newest first. */
  async history(memberUserId: string): Promise<{ data: unknown[] }> {
    const data = await many(
      this.pool,
      `SELECT pa.assignment_id, pa.member_user_id, pa.congregation_id, pa.pastor_user_id,
              u.full_name AS pastor_full_name, pa.assignment_kind, pa.assigned_by, pa.assigned_at, pa.ended_at
         FROM pastor_assignments pa
         JOIN users u ON u.user_id = pa.pastor_user_id
        WHERE pa.member_user_id = $1
        ORDER BY pa.assigned_at DESC`,
      [memberUserId],
    );
    return { data };
  }
}
