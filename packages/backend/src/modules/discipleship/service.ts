// Module: discipleship — the Discipleship Hub read-aggregation layer, plus
// (Chat Redesign C2) the discipler_assignments write path: an explicit,
// history-preserving "who disciples whom" edge that replaces relying on
// relationship_tree's UNIQUE(disciple_id)-with-no-history for anything that
// needs REASSIGNMENT (docs/CHAT_REDESIGN.md "My Discipler",
// docs/CHAT_REDESIGN_PLAN.md §2.5).
//
// The Hub itself is a COMPOSITION layer: every building block (1:1 DM,
// reflection review, level-advancement usher, engagement snapshot, cell
// roster, growth scores) already exists. The gap it closes is a single call
// that answers "where is this student, who is their discipler, what are they
// waiting on." Pure read aggregation — no migration of its own.
//
// Three authority axes now (§5.4, extended by C2):
//   • discipler_assignments (disciple_user_id → discipler_user_id, ACTIVE row) —
//     the canonical, explicit assignment (C2).
//   • relationship_tree(multiplier_id, disciple_id) — the pre-C2 explicit edge,
//     kept as a fallback for anything not yet migrated into an assignment.
//   • leader_assignments → cell_group_id → users.cell_group_id (cell scope) —
//     an INFERENCE, never promoted to an "assignment" (owner brief: "Tab
//     active only when a valid discipler assignment exists").
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx, audit, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { assertCellInScope } from "../../http/auth.js";
import type { Principal } from "../../http/http.js";
import { ScoresService } from "../scores/service.js";

type ReflectionState = "approved" | "pending" | "returned" | "deferred";

/** A disciple's CURRENT explicit discipler, C2 resolution order:
 *  1. discipler_assignments (active row) — the canonical source.
 *  2. relationship_tree (an explicit edge never migrated into an assignment).
 *  Deliberately NEVER the cell-leader inference (cell_groups.leader_user_id) —
 *  that stays a display-only fallback inside resolveDiscipler below, not
 *  something a DISCIPLER chat thread or a "valid assignment" check may rely
 *  on (owner brief, "My Discipler": "Tab active only when a valid discipler
 *  assignment exists"). Exported so chat/service.ts (GET /chat/discipler/
 *  conversation, broadcast reply-policy "linked_thread" resolution) shares
 *  this ONE source of truth rather than re-deriving it. */
export async function resolveCurrentDiscipler(
  q: Queryable,
  discipleId: string,
): Promise<{ discipler_user_id: string; assigned_at: string; source: "assignment" | "relationship_tree" } | null> {
  const viaAssignment = await maybeOne<{ discipler_user_id: string; assigned_at: string }>(
    q,
    `SELECT discipler_user_id, assigned_at FROM discipler_assignments
      WHERE disciple_user_id = $1 AND ended_at IS NULL`,
    [discipleId],
  );
  if (viaAssignment) return { ...viaAssignment, source: "assignment" };
  const viaEdge = await maybeOne<{ multiplier_id: string; established_at: string }>(
    q,
    `SELECT multiplier_id, established_at FROM relationship_tree WHERE disciple_id = $1 LIMIT 1`,
    [discipleId],
  );
  if (viaEdge) {
    return { discipler_user_id: viaEdge.multiplier_id, assigned_at: viaEdge.established_at, source: "relationship_tree" };
  }
  return null;
}

/** One row of a disciple's full discipler-assignment history (GET
 *  /admin/discipler-assignments), newest first. */
export interface DisciplerAssignmentRow {
  assignment_id: string;
  disciple_user_id: string;
  discipler_user_id: string;
  discipler_full_name: string;
  assigned_by: string | null;
  assigned_at: string;
  ended_at: string | null;
  end_reason: "reassigned" | "removed" | null;
}

/** Shape returned by GET /me/discipleship (student-facing Hub). */
export interface MyDiscipleship {
  discipler: {
    user_id: string;
    full_name: string;
    avatar_url: string | null;
    role_label: "Cell Leader" | "Discipler";
    cell_name: string | null;
    established_at: string | null;
  } | null;
  dm_conversation_id: string | null;
  can_message: boolean;
  progression: {
    current_level: number;
    level_title: string;
    streak_days: number;
    modules_completed: number;
    modules_total: number;
    awaiting_review: boolean;
    awaiting_level: number | null;
  };
  scores: HubScores;
  reflections: Array<{
    module_id: string;
    module_title: string;
    level_number: number;
    state: ReflectionState;
    submitted_at: string;
    feedback_notes: string | null;
  }>;
  next_meeting_at: string | null;
  notes: Array<{ topic: string; body: string; met_at: string; next_meeting_at: string | null }>;
}

export interface HubScores {
  overall: number | null;
  word: number | null;
  prayer: number | null;
  habits: number | null;
  curriculum: number | null;
  attendance: number | null;
}

export interface RosterRow {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  cell_name: string | null;
  cell_group_id: string | null;
  current_level: number;
  band: string | null;
  streak_days: number;
  days_since_last_activity: number | null;
  pending_reflections: number;
  awaiting_level: number | null;
}

export class DiscipleshipService {
  private readonly scores: ScoresService;

  constructor(private readonly pool: Pool) {
    this.scores = new ScoresService(pool);
  }

  // ── STUDENT-facing ────────────────────────────────────────────────────────

  /** GET /me/discipleship — the whole member Hub in one call. Pure GET, no writes. */
  async myHub(userId: string): Promise<MyDiscipleship> {
    const me = await one<{
      user_id: string;
      full_name: string;
      is_minor: boolean;
      cell_group_id: string | null;
    }>(
      this.pool,
      `SELECT user_id, full_name, is_minor, cell_group_id
         FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );

    const [discipler, progression, scores, reflections] = await Promise.all([
      this.resolveDiscipler(me.user_id, me.cell_group_id),
      this.progression(me.user_id),
      this.scoresFor(me.user_id),
      this.myReflections(me.user_id),
    ]);

    // Existing DM with the discipler (do NOT create in a GET). can_message is
    // false for minors — chat blocks DMs to/from minors everywhere (§ chat).
    const dmConversationId = discipler ? await this.findDm(me.user_id, discipler.user_id) : null;
    const canMessage = !me.is_minor && discipler !== null;

    return {
      discipler,
      dm_conversation_id: dmConversationId,
      can_message: canMessage,
      progression,
      scores,
      reflections,
      // The Hub has no meeting/notes store yet — the contract reserves the shape
      // so iOS/portal can bind to it; both are empty/null until that lands.
      next_meeting_at: null,
      notes: [],
    };
  }

  // ── DISCIPLER-facing ──────────────────────────────────────────────────────

  /** GET /disciples — the leader's roster + triage across all their cells + edges. */
  async roster(principal: Principal): Promise<{ data: RosterRow[]; summary: { total_students: number; awaiting_action: number } }> {
    const ids = await this.discipleIds(principal);
    if (ids.length === 0) return { data: [], summary: { total_students: 0, awaiting_action: 0 } };

    const rows = await many<{
      user_id: string;
      full_name: string;
      avatar_url: string | null;
      cell_name: string | null;
      cell_group_id: string | null;
      current_level: number | null;
      band: string | null;
      streak_days: number | null;
      days_since_last_activity: number | null;
      pending_reflections: number;
      awaiting_level: number | null;
    }>(
      this.pool,
      `SELECT u.user_id, u.full_name, u.avatar_url,
              cg.name AS cell_name, u.cell_group_id,
              COALESCE(en.current_level, 1) AS current_level,
              es.band::text AS band,
              COALESCE(st.current_streak_days, 0) AS streak_days,
              (SELECT (CURRENT_DATE - MAX(ie.occurred_at)::date)
                 FROM interaction_events ie WHERE ie.user_id = u.user_id) AS days_since_last_activity,
              (SELECT count(*)::int FROM module_reflections mr
                 WHERE mr.user_id = u.user_id AND mr.state = 'pending') AS pending_reflections,
              (SELECT la.level_number FROM level_advancements la
                 WHERE la.user_id = u.user_id AND la.status = 'pending'
                 ORDER BY la.level_number DESC LIMIT 1) AS awaiting_level
         FROM users u
         LEFT JOIN cell_groups cg ON cg.cell_group_id = u.cell_group_id
         LEFT JOIN enrollments en ON en.user_id = u.user_id
         LEFT JOIN engagement_scores es ON es.user_id = u.user_id
         LEFT JOIN user_streaks st ON st.user_id = u.user_id
        WHERE u.user_id = ANY($1::uuid[]) AND u.deleted_at IS NULL`,
      [ids],
    );

    const data: RosterRow[] = rows.map((r) => ({
      user_id: r.user_id,
      full_name: r.full_name,
      avatar_url: r.avatar_url,
      cell_name: r.cell_name,
      cell_group_id: r.cell_group_id,
      current_level: Number(r.current_level ?? 1),
      band: r.band,
      streak_days: Number(r.streak_days ?? 0),
      days_since_last_activity:
        r.days_since_last_activity === null ? null : Number(r.days_since_last_activity),
      pending_reflections: Number(r.pending_reflections),
      awaiting_level: r.awaiting_level === null ? null : Number(r.awaiting_level),
    }));

    // Sort: students needing action first — awaiting_level, then pending_reflections
    // desc, then band risk (at_risk highest). Stable tail by name for determinism.
    const bandRisk: Record<string, number> = { at_risk: 4, watch: 3, steady: 2, thriving: 1 };
    data.sort((a, b) => {
      const al = a.awaiting_level !== null ? 1 : 0;
      const bl = b.awaiting_level !== null ? 1 : 0;
      if (al !== bl) return bl - al;
      if (a.pending_reflections !== b.pending_reflections) return b.pending_reflections - a.pending_reflections;
      const ar = bandRisk[a.band ?? ""] ?? 0;
      const br = bandRisk[b.band ?? ""] ?? 0;
      if (ar !== br) return br - ar;
      return a.full_name.localeCompare(b.full_name);
    });

    const awaitingAction = data.filter((r) => r.awaiting_level !== null || r.pending_reflections > 0).length;
    return { data, summary: { total_students: data.length, awaiting_action: awaitingAction } };
  }

  /** GET /disciples/:id — one student's full journey, scoped to their discipler. */
  async dossier(principal: Principal, studentId: string): Promise<Record<string, unknown>> {
    await this.assertInScope(principal, studentId);

    const m = await maybeOne<{
      user_id: string;
      full_name: string;
      avatar_url: string | null;
      cell_name: string | null;
      created_at: string;
      cell_group_id: string | null;
      e_score: number | null;
      band: string | null;
    }>(
      this.pool,
      `SELECT u.user_id, u.full_name, u.avatar_url, u.created_at, u.cell_group_id,
              cg.name AS cell_name,
              es.e_score::float AS e_score, es.band::text AS band
         FROM users u
         LEFT JOIN cell_groups cg ON cg.cell_group_id = u.cell_group_id
         LEFT JOIN engagement_scores es ON es.user_id = u.user_id
        WHERE u.user_id = $1 AND u.role = 'Student' AND u.deleted_at IS NULL`,
      [studentId],
    );
    if (!m) throw new ApiError("NOT_FOUND", "Member not found");

    // established_at: the relationship_tree edge, if one exists for this student.
    const edge = await maybeOne<{ established_at: string }>(
      this.pool,
      `SELECT established_at FROM relationship_tree WHERE disciple_id = $1 LIMIT 1`,
      [studentId],
    );

    const [progression, scores, daysSince, reflections, recentActivity] = await Promise.all([
      this.progression(studentId),
      this.scoresFor(studentId),
      this.daysSinceLastActivity(studentId),
      this.dossierReflections(studentId),
      this.recentActivity(studentId),
    ]);

    const dmConversationId = await this.findDm(principal.userId, studentId);

    return {
      member: {
        user_id: m.user_id,
        full_name: m.full_name,
        avatar_url: m.avatar_url,
        cell_name: m.cell_name,
        established_at: edge?.established_at ?? null,
        joined_at: m.created_at,
      },
      progression: {
        current_level: progression.current_level,
        level_title: progression.level_title,
        streak_days: progression.streak_days,
        modules_completed: progression.modules_completed,
        modules_total: progression.modules_total,
        awaiting_level: progression.awaiting_level,
      },
      scores,
      engagement: {
        e_score: m.e_score === null ? null : Math.round(m.e_score * 100),
        band: m.band,
        days_since_last_activity: daysSince,
      },
      reflections,
      recent_activity: recentActivity,
      dm_conversation_id: dmConversationId,
    };
  }

  // ── Discipler assignment (write path, Chat Redesign C2) ───────────────────

  static readonly AssignDiscipler = z.object({
    disciple_user_id: z.string().uuid(),
    discipler_user_id: z.string().uuid(),
  });

  /**
   * Assign (or REASSIGN) a member's discipler — the canonical write path C2
   * adds alongside the pre-existing, one-shot-only POST /relationships. Ends
   * the disciple's prior active row (if any, end_reason='reassigned') and
   * ARCHIVES the old DISCIPLER conversation between them
   * (chat_conversations.archived_at, migration 169) so it is never merged
   * into or exposed via the new assignment (owner brief, "My Discipler":
   * "reassignment does NOT merge or expose the former conversation").
   *
   * Scope: the SAME authority the app already trusts for "who may name this
   * member's discipler" — assertCellInScope (Instructor+, scoped to the
   * disciple's cell; Admin/SuperAdmin unrestricted), the identical gate
   * PortalService.addRelationship already uses. This is a parallel,
   * history-preserving path onto that authority, not a new permission
   * surface. relationship_tree itself is left untouched — other modules
   * (scores, signals, growth-content) still read it for the "multiplier"
   * growth-tree concept.
   */
  async assignDiscipler(
    principal: Principal,
    input: z.infer<typeof DiscipleshipService.AssignDiscipler>,
  ): Promise<{ assignment_id: string; disciple_user_id: string; discipler_user_id: string; reassigned: boolean }> {
    if (input.disciple_user_id === input.discipler_user_id) {
      throw new ApiError("VALIDATION_FAILED", "A member cannot disciple themselves");
    }
    return tx(this.pool, async (c) => {
      const disciple = await maybeOne<{ cell_group_id: string | null }>(
        c, `SELECT cell_group_id FROM users WHERE user_id = $1 AND deleted_at IS NULL`, [input.disciple_user_id],
      );
      if (!disciple) throw new ApiError("NOT_FOUND", "Member not found");
      await assertCellInScope(c, principal, disciple.cell_group_id ?? "");
      const discipler = await maybeOne(
        c, `SELECT 1 FROM users WHERE user_id = $1 AND deleted_at IS NULL`, [input.discipler_user_id],
      );
      if (!discipler) throw new ApiError("NOT_FOUND", "Discipler not found");

      const prior = await maybeOne<{ assignment_id: string; discipler_user_id: string }>(
        c,
        `SELECT assignment_id, discipler_user_id FROM discipler_assignments
          WHERE disciple_user_id = $1 AND ended_at IS NULL`,
        [input.disciple_user_id],
      );
      if (prior && prior.discipler_user_id === input.discipler_user_id) {
        // Idempotent no-op: already the current discipler — not a reassignment.
        return {
          assignment_id: prior.assignment_id,
          disciple_user_id: input.disciple_user_id,
          discipler_user_id: input.discipler_user_id,
          reassigned: false,
        };
      }
      if (prior) {
        await c.query(
          `UPDATE discipler_assignments SET ended_at = now(), end_reason = 'reassigned' WHERE assignment_id = $1`,
          [prior.assignment_id],
        );
        // Archive the OLD DISCIPLER conversation, if the pair ever opened
        // one — never merged into or exposed via the new assignment.
        await c.query(
          `UPDATE chat_conversations
              SET archived_at = now()
            WHERE kind = 'dm' AND type = 'DISCIPLER' AND archived_at IS NULL
              AND EXISTS (SELECT 1 FROM chat_members m WHERE m.conversation_id = chat_conversations.conversation_id AND m.user_id = $1)
              AND EXISTS (SELECT 1 FROM chat_members m2 WHERE m2.conversation_id = chat_conversations.conversation_id AND m2.user_id = $2)`,
          [input.disciple_user_id, prior.discipler_user_id],
        );
        await audit(c, principal.userId, "discipler.reassigned", "discipler_assignments", prior.assignment_id, {
          disciple_user_id: input.disciple_user_id,
          from_discipler_user_id: prior.discipler_user_id,
          to_discipler_user_id: input.discipler_user_id,
        });
      }
      const row = await one<{ assignment_id: string }>(
        c,
        `INSERT INTO discipler_assignments (disciple_user_id, discipler_user_id, assigned_by)
         VALUES ($1, $2, $3) RETURNING assignment_id`,
        [input.disciple_user_id, input.discipler_user_id, principal.userId],
      );
      await audit(c, principal.userId, "discipler.assigned", "discipler_assignments", row.assignment_id, {
        disciple_user_id: input.disciple_user_id,
        discipler_user_id: input.discipler_user_id,
      });
      return {
        assignment_id: row.assignment_id,
        disciple_user_id: input.disciple_user_id,
        discipler_user_id: input.discipler_user_id,
        reassigned: prior !== null,
      };
    });
  }

  /** Full assignment history for a disciple, newest first — same scope as assignDiscipler. */
  async disciplerAssignmentHistory(principal: Principal, discipleUserId: string): Promise<{ data: DisciplerAssignmentRow[] }> {
    const disciple = await maybeOne<{ cell_group_id: string | null }>(
      this.pool, `SELECT cell_group_id FROM users WHERE user_id = $1 AND deleted_at IS NULL`, [discipleUserId],
    );
    if (!disciple) throw new ApiError("NOT_FOUND", "Member not found");
    await assertCellInScope(this.pool, principal, disciple.cell_group_id ?? "");
    const data = await many<DisciplerAssignmentRow>(
      this.pool,
      `SELECT da.assignment_id, da.disciple_user_id, da.discipler_user_id, u.full_name AS discipler_full_name,
              da.assigned_by, da.assigned_at, da.ended_at, da.end_reason
         FROM discipler_assignments da
         JOIN users u ON u.user_id = da.discipler_user_id
        WHERE da.disciple_user_id = $1
        ORDER BY da.assigned_at DESC`,
      [discipleUserId],
    );
    return { data };
  }

  // ── shared building blocks ────────────────────────────────────────────────

  /** Canonical discipler resolution (student → discipler), C2:
   *  1. discipler_assignments / relationship_tree (resolveCurrentDiscipler
   *     above — an explicit ASSIGNMENT) — preferred.
   *  2. else cell_groups.leader_user_id for the student's cell (inference).
   *  3. else null. */
  private async resolveDiscipler(
    studentId: string,
    cellGroupId: string | null,
  ): Promise<MyDiscipleship["discipler"]> {
    const current = await resolveCurrentDiscipler(this.pool, studentId);
    if (current) {
      const person = await maybeOne<{ user_id: string; full_name: string; avatar_url: string | null }>(
        this.pool,
        `SELECT user_id, full_name, avatar_url FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
        [current.discipler_user_id],
      );
      if (person) {
        const cell = await maybeOne<{ name: string }>(
          this.pool, `SELECT name FROM cell_groups WHERE leader_user_id = $1 LIMIT 1`, [current.discipler_user_id],
        );
        return {
          user_id: person.user_id,
          full_name: person.full_name,
          avatar_url: person.avatar_url,
          role_label: "Discipler",
          cell_name: cell?.name ?? null,
          established_at: current.assigned_at,
        };
      }
    }

    if (cellGroupId) {
      const viaCell = await maybeOne<{
        user_id: string;
        full_name: string;
        avatar_url: string | null;
        cell_name: string;
      }>(
        this.pool,
        `SELECT l.user_id, l.full_name, l.avatar_url, cg.name AS cell_name
           FROM cell_groups cg
           JOIN users l ON l.user_id = cg.leader_user_id AND l.deleted_at IS NULL
          WHERE cg.cell_group_id = $1 AND cg.leader_user_id IS NOT NULL
          LIMIT 1`,
        [cellGroupId],
      );
      if (viaCell) {
        return {
          user_id: viaCell.user_id,
          full_name: viaCell.full_name,
          avatar_url: viaCell.avatar_url,
          role_label: "Cell Leader",
          cell_name: viaCell.cell_name,
          established_at: null,
        };
      }
    }
    return null;
  }

  /** Progression block: level + title, streak, modules at level, pending advancement. */
  private async progression(userId: string): Promise<{
    current_level: number;
    level_title: string;
    streak_days: number;
    modules_completed: number;
    modules_total: number;
    awaiting_review: boolean;
    awaiting_level: number | null;
  }> {
    const base = await maybeOne<{
      current_level: number | null;
      level_title: string | null;
      streak_days: number | null;
      awaiting_level: number | null;
    }>(
      this.pool,
      `SELECT en.current_level,
              lv.title AS level_title,
              st.current_streak_days AS streak_days,
              (SELECT la.level_number FROM level_advancements la
                 WHERE la.user_id = u.user_id AND la.status = 'pending'
                 ORDER BY la.level_number DESC LIMIT 1) AS awaiting_level
         FROM users u
         LEFT JOIN enrollments en ON en.user_id = u.user_id
         LEFT JOIN levels lv ON lv.level_number = en.current_level
         LEFT JOIN user_streaks st ON st.user_id = u.user_id
        WHERE u.user_id = $1`,
      [userId],
    );
    const currentLevel = Number(base?.current_level ?? 1);

    const curr = await one<{ done: string; total: string }>(
      this.pool,
      `SELECT
          (SELECT count(*) FROM module_progress mp
             JOIN enrollments e ON e.enrollment_id = mp.enrollment_id
             JOIN modules md ON md.module_id = mp.module_id
            WHERE e.user_id = $1 AND mp.is_completed AND md.level_number = $2) AS done,
          (SELECT count(*) FROM modules md
            WHERE md.level_number = $2 AND md.status = 'published') AS total`,
      [userId, currentLevel],
    );

    const awaitingLevel = base?.awaiting_level === null || base?.awaiting_level === undefined
      ? null
      : Number(base.awaiting_level);

    return {
      current_level: currentLevel,
      level_title: base?.level_title ?? `Level ${currentLevel}`,
      streak_days: Number(base?.streak_days ?? 0),
      modules_completed: Number(curr.done),
      modules_total: Number(curr.total),
      awaiting_review: awaitingLevel !== null,
      awaiting_level: awaitingLevel,
    };
  }

  /** Reuse the member scores service; map each 0–100 breakdown to a bare int. */
  private async scoresFor(userId: string): Promise<HubScores> {
    const all = await this.scores.all(userId);
    const pick = (k: string): number | null => {
      const v = all[k] as { score?: number } | undefined;
      return v && typeof v.score === "number" ? v.score : null;
    };
    return {
      overall: all.overall?.score ?? null,
      word: pick("word"),
      prayer: pick("prayer"),
      habits: pick("habits"),
      curriculum: pick("curriculum"),
      attendance: pick("attendance"),
    };
  }

  /** Member's own reflections — most-recent first, cap 20. Never exposes pastoral_note. */
  private async myReflections(userId: string): Promise<MyDiscipleship["reflections"]> {
    const rows = await many<{
      module_id: string;
      module_title: string;
      level_number: number;
      state: ReflectionState;
      submitted_at: string;
      feedback_notes: string | null;
    }>(
      this.pool,
      `SELECT mr.module_id, md.title AS module_title, md.level_number,
              mr.state::text AS state, mr.submitted_at, mr.feedback_notes
         FROM module_reflections mr
         JOIN modules md ON md.module_id = mr.module_id
        WHERE mr.user_id = $1
        ORDER BY mr.submitted_at DESC
        LIMIT 20`,
      [userId],
    );
    return rows.map((r) => ({
      module_id: r.module_id,
      module_title: r.module_title,
      level_number: Number(r.level_number),
      state: r.state,
      submitted_at: r.submitted_at,
      feedback_notes: r.feedback_notes,
    }));
  }

  /** Discipler-visible reflections — DOES include body + feedback_notes (pastoral). */
  private async dossierReflections(userId: string): Promise<Array<Record<string, unknown>>> {
    return many(
      this.pool,
      `SELECT mr.reflection_id, mr.module_id, md.title AS module_title, md.level_number,
              mr.state::text AS state, mr.submitted_at, mr.body, mr.feedback_notes
         FROM module_reflections mr
         JOIN modules md ON md.module_id = mr.module_id
        WHERE mr.user_id = $1
        ORDER BY mr.submitted_at DESC
        LIMIT 20`,
      [userId],
    );
  }

  private async recentActivity(userId: string): Promise<Array<{ kind: string; occurred_at: string }>> {
    return many(
      this.pool,
      `SELECT kind, occurred_at FROM interaction_events
        WHERE user_id = $1 ORDER BY occurred_at DESC LIMIT 20`,
      [userId],
    );
  }

  private async daysSinceLastActivity(userId: string): Promise<number | null> {
    const row = await maybeOne<{ d: number | null }>(
      this.pool,
      `SELECT (CURRENT_DATE - MAX(occurred_at)::date) AS d
         FROM interaction_events WHERE user_id = $1`,
      [userId],
    );
    return row?.d === null || row?.d === undefined ? null : Number(row.d);
  }

  /** Existing 1:1 DM between two users, else null. Read-only (never creates). */
  private async findDm(userId: string, otherUserId: string): Promise<string | null> {
    const row = await maybeOne<{ conversation_id: string }>(
      this.pool,
      `SELECT cv.conversation_id FROM chat_conversations cv
        WHERE cv.kind = 'dm'
          AND EXISTS (SELECT 1 FROM chat_members a WHERE a.conversation_id = cv.conversation_id AND a.user_id = $1)
          AND EXISTS (SELECT 1 FROM chat_members b WHERE b.conversation_id = cv.conversation_id AND b.user_id = $2)
        LIMIT 1`,
      [userId, otherUserId],
    );
    return row?.conversation_id ?? null;
  }

  // ── scope ─────────────────────────────────────────────────────────────────

  /** The caller's "my disciples" id set: deduped union of relationship_tree edges
   *  + members of the cells they lead (leader_assignments). Only Students. Admin/
   *  SuperAdmin bypass scoping entirely (handled by the callers that use this). */
  private async discipleIds(principal: Principal): Promise<string[]> {
    if (principal.role === "Admin" || principal.role === "SuperAdmin") {
      const rows = await many<{ user_id: string }>(
        this.pool,
        `SELECT user_id FROM users WHERE role = 'Student' AND deleted_at IS NULL`,
      );
      return rows.map((r) => r.user_id);
    }
    const rows = await many<{ user_id: string }>(
      this.pool,
      `SELECT u.user_id
         FROM users u
        WHERE u.role = 'Student' AND u.deleted_at IS NULL
          AND (
            EXISTS (SELECT 1 FROM relationship_tree rt WHERE rt.disciple_id = u.user_id AND rt.multiplier_id = $1)
            OR u.cell_group_id IN (SELECT cell_group_id FROM leader_assignments WHERE leader_user_id = $1)
          )`,
      [principal.userId],
    );
    return rows.map((r) => r.user_id);
  }

  /** Assert the caller may view this student; else 403 FORBIDDEN_SCOPE. */
  private async assertInScope(principal: Principal, studentId: string): Promise<void> {
    if (principal.role === "Admin" || principal.role === "SuperAdmin") return;
    const row = await maybeOne<{ ok: number }>(
      this.pool,
      `SELECT 1 AS ok FROM users u
        WHERE u.user_id = $1 AND u.deleted_at IS NULL
          AND (
            EXISTS (SELECT 1 FROM relationship_tree rt WHERE rt.disciple_id = u.user_id AND rt.multiplier_id = $2)
            OR u.cell_group_id IN (SELECT cell_group_id FROM leader_assignments WHERE leader_user_id = $2)
          )
        LIMIT 1`,
      [studentId, principal.userId],
    );
    if (!row) throw new ApiError("FORBIDDEN_SCOPE", "Student outside your disciple set");
  }
}
