// Module-reflection review (Design Contract Matrix B3). The portal's Reflection
// Queue over PER-MODULE reflections: approve / return (sends it back to the
// member and re-locks gating until resubmitted) / defer (parks it without
// blocking). Reviewers are cell-scoped like every pastoral surface (§5.4); the
// internal pastoral note is never exposed to the member; every decision is
// audited and the member (and optionally their multiplier) is notified.
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, recordActivityEvent, tx, recordChange, audit } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { assertCellInScope } from "../../http/auth.js";
import type { Principal } from "../../http/http.js";
import { NotificationService } from "../notifications/service.js";
import { loadModule, isModuleUnlocked, loadEnrollment, ensureEnrollment } from "../progress/gating.js";

const DECISION_TO_STATE = { approve: "approved", return: "returned", defer: "deferred" } as const;

export class ModuleReflectionService {
  private readonly notifications: NotificationService;

  constructor(
    private readonly pool: Pool,
    notifications?: NotificationService,
  ) {
    this.notifications = notifications ?? new NotificationService(pool);
  }

  static readonly SaveBody = z.object({ body: z.string().trim().min(1).max(4000) });

  /** Same module-unlock check as getModule (§1.9): a member can only read/write
   *  a reflection for content they can actually open. NOT_FOUND / GATE_LOCKED. */
  private async assertModuleUnlocked(userId: string, moduleId: string): Promise<void> {
    const module = await loadModule(this.pool, moduleId);
    if (!module) throw new ApiError("NOT_FOUND", "Module not found");
    const enrollment = await loadEnrollment(this.pool, userId);
    if (
      module.level_number === 1 && module.module_sequence_number === 1
        ? false
        : !enrollment || !(await isModuleUnlocked(this.pool, enrollment, module))
    ) {
      throw new ApiError("GATE_LOCKED", "Module is not yet unlocked", {
        module_sequence_number: module.module_sequence_number,
      });
    }
  }

  /**
   * Member writes (or overwrites) their standalone reflection for a module. The
   * reflection is content, not a review submission — it upserts the current
   * reflection body in place. We create/reuse the member's module_progress row to
   * anchor the FK (module_reflections is keyed by progress_id). Re-saving a body
   * updates it and (when it had been sent back) re-enters 'pending' so the review
   * queue sees the fresh text; approved reflections stay approved. Gated by the
   * same module-unlock check as getModule.
   */
  async saveReflection(userId: string, moduleId: string, body: string): Promise<{ body: string; created_at: string }> {
    await this.assertModuleUnlocked(userId, moduleId);
    return tx(this.pool, async (c) => {
      const enrollment = await ensureEnrollment(c, userId);
      const prog = await one<{ progress_id: string }>(
        c,
        `INSERT INTO module_progress (enrollment_id, module_id) VALUES ($1, $2)
         ON CONFLICT (enrollment_id, module_id) DO UPDATE SET row_version = module_progress.row_version
         RETURNING progress_id`,
        [enrollment.enrollment_id, moduleId],
      );
      const row = await one<{ reflection_id: string; body: string; submitted_at: string }>(
        c,
        `INSERT INTO module_reflections (progress_id, user_id, module_id, body)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (progress_id) DO UPDATE
           SET body = EXCLUDED.body,
               state = CASE WHEN module_reflections.state = 'returned' THEN 'pending'::review_state
                            ELSE module_reflections.state END,
               submitted_at = now(),
               reviewed_by = NULL, reviewed_at = NULL, feedback_notes = NULL
         RETURNING reflection_id, body, submitted_at`,
        [prog.progress_id, userId, moduleId, body],
      );
      await recordChange(c, "module_reflections", row.reflection_id, userId, "upsert");
      // Writing a module reflection fulfills today's reflection rhythm (§1.8).
      await recordActivityEvent(c, userId, "reflection", { oncePerDayTz: "Africa/Nairobi" });
      await audit(c, userId, "reflection.saved", "module_reflections", row.reflection_id, { module_id: moduleId });
      return { body: row.body, created_at: row.submitted_at };
    });
  }

  /** The member's saved reflection body for a module, or null when none exists. */
  async getReflection(userId: string, moduleId: string): Promise<{ body: string; created_at: string } | null> {
    await this.assertModuleUnlocked(userId, moduleId);
    const row = await maybeOne<{ body: string; created_at: string }>(
      this.pool,
      `SELECT body, submitted_at AS created_at FROM module_reflections
        WHERE user_id = $1 AND module_id = $2`,
      [userId, moduleId],
    );
    return row ?? null;
  }

  /** The member's own reflection for a module — state + feedback, never the pastoral note. */
  async myReflection(userId: string, moduleId: string): Promise<unknown> {
    const row = await maybeOne(
      this.pool,
      `SELECT reflection_id, module_id, body, state::text, feedback_notes, submitted_at, reviewed_at
         FROM module_reflections WHERE user_id = $1 AND module_id = $2`,
      [userId, moduleId],
    );
    if (!row) throw new ApiError("NOT_FOUND", "No reflection submitted for this module");
    return row;
  }

  static readonly Queue = z.object({
    state: z.enum(["pending", "approved", "rejected", "returned", "deferred"]).default("pending"),
    overdue: z.coerce.boolean().optional(), // pending > 3 days
    limit: z.coerce.number().int().min(1).max(200).default(50),
  });

  /** The reviewer's queue, scoped: Instructors see only their assigned cells. */
  async queue(principal: Principal, q: z.infer<typeof ModuleReflectionService.Queue>): Promise<unknown[]> {
    const params: unknown[] = [q.state];
    const where: string[] = [`mr.state = $1::review_state`];
    if (q.overdue) where.push(`mr.submitted_at < now() - interval '3 days'`);
    if (principal.role !== "Admin" && principal.role !== "SuperAdmin") {
      params.push(principal.userId);
      where.push(
        `u.cell_group_id IN (SELECT cell_group_id FROM leader_assignments WHERE leader_user_id = $${params.length})`,
      );
    }
    params.push(q.limit);
    return many(
      this.pool,
      `SELECT mr.reflection_id, mr.user_id, u.full_name, u.cell_group_id, mr.module_id, m.title AS module_title,
              m.level_number, mr.body, mr.state::text, mr.submitted_at, mr.reviewed_at,
              (mr.state = 'pending' AND mr.submitted_at < now() - interval '3 days') AS overdue
         FROM module_reflections mr
         JOIN users u ON u.user_id = mr.user_id
         JOIN modules m ON m.module_id = mr.module_id
        WHERE ${where.join(" AND ")}
        ORDER BY mr.submitted_at ASC
        LIMIT $${params.length}`,
      params,
    );
  }

  static readonly Decision = z
    .object({
      decision: z.enum(["approve", "return", "defer"]),
      feedback_notes: z.string().max(2000).optional(), // shown to the member
      pastoral_note: z.string().max(2000).optional(), // internal only
      notify_multiplier: z.boolean().default(false),
    })
    .strict()
    .refine((d) => d.decision !== "return" || (d.feedback_notes ?? "").trim().length > 0, {
      message: "Returning a reflection requires feedback for the member",
    });

  /** Approve / return / defer — scope-checked, audited, member (+multiplier) notified. */
  async decide(
    principal: Principal,
    reflectionId: string,
    input: z.infer<typeof ModuleReflectionService.Decision>,
  ): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const refl = await maybeOne<{ user_id: string; module_id: string; cell_group_id: string | null; state: string }>(
        c,
        `SELECT mr.user_id, mr.module_id, u.cell_group_id, mr.state::text
           FROM module_reflections mr JOIN users u ON u.user_id = mr.user_id
          WHERE mr.reflection_id = $1 FOR UPDATE OF mr`,
        [reflectionId],
      );
      if (!refl) throw new ApiError("NOT_FOUND", "Reflection not found");
      await assertCellInScope(c, principal, refl.cell_group_id ?? "");

      const state = DECISION_TO_STATE[input.decision];
      const row = await one(
        c,
        `UPDATE module_reflections
            SET state = $2::review_state, reviewed_by = $3, reviewed_at = now(),
                feedback_notes = $4, pastoral_note = COALESCE($5, pastoral_note)
          WHERE reflection_id = $1
          RETURNING reflection_id, user_id, module_id, state, feedback_notes, reviewed_at`,
        [reflectionId, state, principal.userId, input.feedback_notes ?? null, input.pastoral_note ?? null],
      );
      await recordChange(c, "module_reflections", reflectionId, refl.user_id, "upsert");
      await audit(c, principal.userId, `reflection.${input.decision}`, "module_reflections", reflectionId, {
        user_id: refl.user_id,
        module_id: refl.module_id,
        // The pastoral note's CONTENT stays out of the audit metadata too —
        // only the fact one was recorded.
        pastoral_note_recorded: input.pastoral_note != null,
      });

      // Notify the member (and, when asked, their multiplier). Best-effort.
      const targets = [refl.user_id];
      if (input.notify_multiplier) {
        const rel = await maybeOne<{ multiplier_id: string }>(
          c,
          `SELECT multiplier_id FROM relationship_tree WHERE disciple_id = $1`,
          [refl.user_id],
        );
        if (rel) targets.push(rel.multiplier_id);
      }
      for (const userId of targets) {
        try {
          await this.notifications.schedule({
            userId,
            channel: "push",
            template: `reflection_${state}`,
            payload: { module_id: refl.module_id, feedback: input.feedback_notes ?? null },
          });
        } catch {
          // best-effort
        }
      }
      return row;
    });
  }

  /** Review history for one reflection — the audited decision trail. */
  async history(principal: Principal, reflectionId: string): Promise<unknown[]> {
    const refl = await maybeOne<{ cell_group_id: string | null }>(
      this.pool,
      `SELECT u.cell_group_id FROM module_reflections mr JOIN users u ON u.user_id = mr.user_id
        WHERE mr.reflection_id = $1`,
      [reflectionId],
    );
    if (!refl) throw new ApiError("NOT_FOUND", "Reflection not found");
    await assertCellInScope(this.pool, principal, refl.cell_group_id ?? "");
    return many(
      this.pool,
      `SELECT a.audit_id, a.actor_id, u.full_name AS actor_name, a.action, a.occurred_at
         FROM audit_log a LEFT JOIN users u ON u.user_id = a.actor_id
        WHERE a.entity = 'module_reflections' AND a.entity_id = $1
        ORDER BY a.audit_id DESC`,
      [reflectionId],
    );
  }
}
