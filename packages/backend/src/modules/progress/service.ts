// Progress service (spec §1.5, §1.9, §3.3). Module completion with offline
// idempotency and forward-only (monotonic) merge — a stale client claiming
// "incomplete" never overwrites a server "complete" (§1.7).
import type { Pool, PoolClient } from "pg";
import { maybeOne, one, tx, recordChange, enqueueOutbox, recordActivityEvent } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { loadEnrollment, ensureEnrollment, loadModule, isModuleUnlocked, isEntryModule, type EnrollmentRef } from "./gating.js";
import { AssessmentService } from "../assessment/service.js";

export interface CompleteResult {
  progress_id: string;
  module_id: string;
  is_completed: boolean;
  duplicate: boolean;
  next_module_unlocked: boolean;
}

export class ProgressService {
  constructor(private readonly pool: Pool) {}

  async completeModule(
    userId: string,
    moduleId: string,
    clientMutationId: string | null,
    completedAt?: string,
    reflectionText?: string,
  ): Promise<CompleteResult> {
    return tx(this.pool, async (c) => {
      // Offline idempotency: a replayed mutation id is a no-op returning the prior result.
      if (clientMutationId) {
        const dup = await maybeOne<{ progress_id: string; module_id: string; is_completed: boolean }>(
          c,
          `SELECT progress_id, module_id, is_completed FROM module_progress WHERE client_mutation_id = $1`,
          [clientMutationId],
        );
        if (dup) {
          return {
            progress_id: dup.progress_id,
            module_id: dup.module_id,
            is_completed: dup.is_completed,
            duplicate: true,
            next_module_unlocked: await this.nextUnlocked(c, userId, moduleId),
          };
        }
      }

      // Universal entry point: auto-enroll at L1 if the member has no enrollment
      // yet (self-registered / elevated accounts), so completing a lesson works.
      const enrollment = await ensureEnrollment(c, userId);
      const module = await loadModule(c, moduleId);
      if (!module) throw new ApiError("NOT_FOUND", "Module not found");
      if (!(await isModuleUnlocked(c, enrollment, module))) {
        throw new ApiError("GATE_LOCKED", "Module is not yet unlocked", {
          module_sequence_number: module.module_sequence_number,
        });
      }

      // Content gate on "Mark complete" (§1.3): a non-quiz module may only be
      // completed once its content is genuinely consumed AND reflected on —
      // read → watch → listen → reflect, same server-authoritative gate the quiz
      // uses. Quiz modules are exempt here: they complete by passing the quiz,
      // whose assembleQuiz already enforced this gate. The universal entry point
      // (L1·M1) stays frictionless. If the client supplies the reflection inline,
      // persist it FIRST so the gate sees it. Throws CONTENT_INCOMPLETE (409).
      const kindRow = await one<{ evaluation_kind: string }>(
        c,
        `SELECT evaluation_kind FROM modules WHERE module_id = $1`,
        [moduleId],
      );
      const isEntry = isEntryModule(module.level_number, module.module_sequence_number);
      const contentGated = kindRow.evaluation_kind !== "quiz" && !isEntry;

      // Anchor the progress row (created here if absent) so any inline reflection
      // can be persisted BEFORE the content gate runs — the reflect step must see
      // this request's reflection, matching quiz-submit semantics.
      const prog = await one<{ progress_id: string }>(
        c,
        `INSERT INTO module_progress (enrollment_id, module_id) VALUES ($1, $2)
         ON CONFLICT (enrollment_id, module_id) DO UPDATE SET row_version = module_progress.row_version
         RETURNING progress_id`,
        [enrollment.enrollment_id, moduleId],
      );

      // A submitted reflection becomes a reviewable module_reflections row (B3):
      // new submissions enter 'pending'; resubmitting a 'returned' one re-enters
      // 'pending' with the new body. Pending/approved/deferred pass gating;
      // only 'returned' re-locks (see modulePassedPredicate).
      if (reflectionText) {
        const refl = await one<{ reflection_id: string }>(
          c,
          `INSERT INTO module_reflections (progress_id, user_id, module_id, body)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (progress_id) DO UPDATE
             SET body = EXCLUDED.body, state = 'pending', submitted_at = now(),
                 reviewed_by = NULL, reviewed_at = NULL, feedback_notes = NULL
           RETURNING reflection_id`,
          [prog.progress_id, userId, moduleId, reflectionText],
        );
        await recordChange(c, "module_reflections", refl.reflection_id, userId, "upsert");
      }

      // Content gate on "Mark complete" (§1.3): a non-quiz module may only be
      // completed once its content is genuinely consumed AND reflected on —
      // read → watch → listen → reflect, the same server-authoritative gate the
      // quiz uses. Quiz modules are exempt here (they complete by passing the
      // quiz, whose assembleQuiz already enforced this); the universal entry
      // point (L1·M1) stays frictionless. Throws CONTENT_INCOMPLETE (409).
      if (contentGated) {
        await AssessmentService.requireContentComplete(c, userId, moduleId);
      }

      // Forward-only completion: is_completed only moves forward (§1.7 monotonic).
      const row = await one<{ progress_id: string; is_completed: boolean }>(
        c,
        `UPDATE module_progress
            SET is_completed = TRUE,
                completed_at = COALESCE(completed_at, $2),
                client_mutation_id = COALESCE(client_mutation_id, $3),
                reflection_text = COALESCE($4, reflection_text),
                row_version = row_version + 1
          WHERE progress_id = $1
          RETURNING progress_id, is_completed`,
        [prog.progress_id, completedAt ?? new Date().toISOString(), clientMutationId, reflectionText ?? null],
      );

      await recordChange(c, "module_progress", row.progress_id, userId, "upsert");
      // Verified signal → re-evaluate faithfulness badges (§G.3). Idempotent worker.
      await enqueueOutbox(c, "gamification.evaluate", { user_id: userId });
      // Feed the activity ledger so completion counts toward habit/curriculum
      // scores + streak, and refresh the leader engagement snapshot promptly (§1.8).
      await recordActivityEvent(c, userId, "module_completed", { moduleId });
      await enqueueOutbox(c, "engagement.recompute", { user_id: userId });
      return {
        progress_id: row.progress_id,
        module_id: moduleId,
        is_completed: row.is_completed,
        duplicate: false,
        next_module_unlocked: await this.nextUnlocked(c, userId, moduleId),
      };
    });
  }

  /** Is the module immediately after `moduleId` (same level) now unlocked? */
  private async nextUnlocked(c: Pool | PoolClient, userId: string, moduleId: string): Promise<boolean> {
    const enrollment = await loadEnrollment(c, userId);
    if (!enrollment) return false;
    const next = await maybeOne<{ module_id: string; level_number: number; module_sequence_number: number }>(
      c,
      `SELECT n.module_id, n.level_number, n.module_sequence_number
         FROM modules cur
         JOIN modules n ON n.level_number = cur.level_number
          AND n.module_sequence_number = cur.module_sequence_number + 1
        WHERE cur.module_id = $1`,
      [moduleId],
    );
    if (!next) return false;
    return isModuleUnlocked(c, enrollment as EnrollmentRef, next);
  }
}
