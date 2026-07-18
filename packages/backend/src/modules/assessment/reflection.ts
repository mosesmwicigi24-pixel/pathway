// Reflection review (spec §1.9 rule 3, §3.3). After a member finishes a
// level's modules they submit a written reflection; a pastor (Instructor+)
// approves or rejects it from the review queue. SINGLE ADVANCEMENT WRITER
// (docs/CURRICULUM_ARCHITECTURE.md §2.4): approving a reflection only RECORDS
// the decision — enrollments.current_level is written exclusively by the
// discipler-usher path (levelAdvancement.ts), which also carries certificate
// issuance. All decisions are server-side and scope-checked (§5.4).
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx, audit, enqueueOutbox } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { assertCellInScope } from "../../http/auth.js";
import type { Principal } from "../../http/http.js";
import { ensureEnrollment, entryFloorSeq } from "../progress/gating.js";

export class ReflectionService {
  constructor(private readonly pool: Pool) {}

  static readonly SubmitSchema = z.object({
    reflection_text: z.string().min(20).max(5000),
  });

  static readonly DecisionSchema = z.object({
    decision: z.enum(["approve", "reject"]),
    feedback_notes: z.string().max(2000).optional(),
  });

  /**
   * Submit (or re-submit) the reflection for the member's current level. Allowed
   * only once every published module in the level is completed and its quiz
   * passed. Re-submitting a pending/rejected reflection resets it to pending; an
   * already-approved reflection is immutable.
   */
  async submit(userId: string, levelNumber: number, text: string): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const enrollment = await ensureEnrollment(c, userId);
      if (levelNumber !== enrollment.current_level) {
        throw new ApiError("GATE_LOCKED", "You can only reflect on your current level", {
          current_level: enrollment.current_level,
        });
      }

      // Every published module in the level must be completed AND its quiz passed
      // (a module with no active questions passes on completion) — same rule the
      // gating engine uses (§1.9).
      const pending = await one<{ n: number }>(
        c,
        `SELECT count(*)::int AS n
           FROM modules m
          WHERE m.level_number = $1 AND m.is_published
            AND m.module_sequence_number >= $3
            AND NOT EXISTS (
              SELECT 1 FROM module_progress mp
                JOIN enrollments e ON e.enrollment_id = mp.enrollment_id
               WHERE e.user_id = $2 AND mp.module_id = m.module_id AND mp.is_completed
                 AND (
                   NOT EXISTS (SELECT 1 FROM question_bank q WHERE q.module_id = m.module_id AND q.is_active)
                   OR EXISTS (SELECT 1 FROM quiz_attempts qa WHERE qa.progress_id = mp.progress_id AND qa.is_passed)
                 )
            )`,
        [levelNumber, userId, entryFloorSeq(enrollment, levelNumber)],
      );
      if (pending.n > 0) {
        throw new ApiError("UNPROCESSABLE", "Finish and pass every module in this level first", {
          modules_remaining: pending.n,
        });
      }

      // §1.9 rule 2: the level exam must be passed before the reflection gate.
      const exam = await maybeOne<{ ok: number }>(
        c,
        `SELECT 1 AS ok FROM level_exam_attempts
          WHERE enrollment_id = $1 AND level_number = $2 AND is_passed LIMIT 1`,
        [enrollment.enrollment_id, levelNumber],
      );
      if (!exam) {
        throw new ApiError("GATE_LOCKED", "Pass the level exam before submitting your reflection");
      }

      const existing = await maybeOne<{ state: string }>(
        c,
        `SELECT state FROM reflection_reviews WHERE user_id = $1 AND level_number = $2`,
        [userId, levelNumber],
      );
      if (existing?.state === "approved") {
        throw new ApiError("CONFLICT", "This level's reflection is already approved");
      }

      const row = await one<{ review_id: string; state: string; level_number: number }>(
        c,
        `INSERT INTO reflection_reviews (user_id, level_number, reflection_text, state)
         VALUES ($1, $2, $3, 'pending')
         ON CONFLICT (user_id, level_number) DO UPDATE
           SET reflection_text = EXCLUDED.reflection_text, state = 'pending',
               reviewed_by = NULL, reviewed_at = NULL, feedback_notes = NULL, submitted_at = now()
         RETURNING review_id, state, level_number`,
        [userId, levelNumber, text],
      );
      await enqueueOutbox(c, "reflection.submitted", {
        review_id: row.review_id,
        user_id: userId,
        level_number: levelNumber,
      });
      await audit(c, userId, "reflection.submitted", "reflection_reviews", row.review_id, {
        level_number: levelNumber,
      });
      return row;
    });
  }

  /** Pending review queue, scoped to the reviewer's authority (§5.4). */
  async listPending(principal: Principal): Promise<unknown[]> {
    const base = `SELECT r.review_id, r.user_id, r.level_number, r.reflection_text, r.submitted_at,
                         u.full_name, u.cell_group_id
                    FROM reflection_reviews r
                    JOIN users u ON u.user_id = r.user_id
                   WHERE r.state = 'pending'`;
    if (principal.role === "SuperAdmin" || principal.role === "Admin") {
      return many(this.pool, `${base} ORDER BY r.submitted_at`);
    }
    // Instructor/Multiplier: only members in their assigned cells.
    return many(
      this.pool,
      `${base}
         AND u.cell_group_id IN (
           SELECT cell_group_id FROM leader_assignments WHERE leader_user_id = $1
         )
       ORDER BY r.submitted_at`,
      [principal.userId],
    );
  }

  /**
   * Approve or reject a pending reflection. The decision is RECORDED, nothing
   * else (§2.4 single advancement writer): advancement of current_level and
   * certificate issuance belong exclusively to the discipler-usher path
   * (levelAdvancement.usher). The reviewer must be in scope for the member's
   * cell (§5.4). `leveled_up` stays on the wire for old clients — always false.
   */
  async decide(
    principal: Principal,
    reviewId: string,
    input: z.infer<typeof ReflectionService.DecisionSchema>,
  ): Promise<{ review_id: string; state: string; leveled_up: boolean }> {
    return tx(this.pool, async (c) => {
      const review = await maybeOne<{
        review_id: string;
        user_id: string;
        level_number: number;
        state: string;
        cell_group_id: string | null;
      }>(
        c,
        `SELECT r.review_id, r.user_id, r.level_number, r.state, u.cell_group_id
           FROM reflection_reviews r JOIN users u ON u.user_id = r.user_id
          WHERE r.review_id = $1`,
        [reviewId],
      );
      if (!review) throw new ApiError("NOT_FOUND", "Review not found");
      if (review.state !== "pending") throw new ApiError("CONFLICT", "Review already decided");

      await assertCellInScope(c, principal, review.cell_group_id ?? "");

      const newState = input.decision === "approve" ? "approved" : "rejected";
      await c.query(
        `UPDATE reflection_reviews SET state = $1, reviewed_by = $2, reviewed_at = now(), feedback_notes = $3
           WHERE review_id = $4`,
        [newState, principal.userId, input.feedback_notes ?? null, reviewId],
      );

      // §2.4: no enrollment write, no certificate, no level-completed nudge here
      // — the usher path is the sole advancer and issues the certificate.
      await audit(c, principal.userId, `reflection.${newState}`, "reflection_reviews", reviewId, {
        user_id: review.user_id,
        level_number: review.level_number,
      });
      return { review_id: reviewId, state: newState, leveled_up: false };
    });
  }
}
