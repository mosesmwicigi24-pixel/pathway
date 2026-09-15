// A passed quiz completes its module — on the server, in the same transaction.
//
// Found 2026-09-16: 33 module_progress rows across 18 members carried a
// PASSING quiz attempt while `is_completed` stayed false. Gating already
// treated a pass as done (modulePassedPredicate), so the NEXT module unlocked,
// but the module itself never read as completed: the member app showed the
// quiz again on every visit, and the portal counted 0/11. Nothing set
// is_completed for quiz modules once the native apps replaced the RN app —
// the old client used to push completion through /sync; the new ones rely on
// the server, and the server only completed non-quiz modules (completeModule).
//
// This is the twin of ProgressService.completeModule's effect block (same
// forward-only UPDATE, same change_log / activity / outbox signals) for the
// quiz path, minus the content gate — assembleQuiz already enforced it.
import { one, maybeOne, recordChange, recordActivityEvent, enqueueOutbox, type Queryable } from "../../db/db.js";

export async function completeModuleOnQuizPass(
  c: Queryable,
  userId: string,
  moduleId: string,
  progressId: string,
): Promise<{ newly_completed: boolean }> {
  const before = await maybeOne<{ is_completed: boolean }>(
    c,
    `SELECT is_completed FROM module_progress WHERE progress_id = $1`,
    [progressId],
  );
  if (!before || before.is_completed) return { newly_completed: false }; // a retake: nothing to flip
  await one<{ progress_id: string }>(
    c,
    `UPDATE module_progress
        SET is_completed = TRUE,
            completed_at = COALESCE(completed_at, now()),
            row_version = row_version + 1
      WHERE progress_id = $1
      RETURNING progress_id`,
    [progressId],
  );
  await recordChange(c, "module_progress", progressId, userId, "upsert");
  await enqueueOutbox(c, "gamification.evaluate", { user_id: userId });
  await recordActivityEvent(c, userId, "module_completed", { moduleId });
  await enqueueOutbox(c, "engagement.recompute", { user_id: userId });
  return { newly_completed: true };
}
