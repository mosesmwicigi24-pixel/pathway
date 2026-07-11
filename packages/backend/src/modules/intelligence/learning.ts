// The living curriculum (Phase 3) — the lesson adapts to the learner.
//   • explain(style)  — the SAME lesson rendered differently (simple English /
//     Kiswahili / story form). Cached per module+style: generated once, served
//     to everyone. §1.9 intact — only members who can already read the lesson
//     can request a rendering of it.
//   • remediate()     — after a FAILED quiz, a short "Review with Nuru" built
//     from the module's own teaching + the exact questions missed. Teaches the
//     concept; never reveals the answer key. Cached per failed attempt.
//   • dueVerses()     — spaced repetition over memory_verse_progress: the
//     weaker the verse and the longer since practice, the sooner it's due.
// AI writes words only — completion, scoring and gating stay deterministic.
import type { Pool } from "pg";
import { many, maybeOne } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { loadEnrollment, loadModule, isModuleUnlocked, isEntryModule } from "../progress/gating.js";
import type { AiProvider } from "../assistant/provider.js";
import { EXPLAIN_SYSTEM, REMEDIATION_SYSTEM } from "./prompts.js";

export type ExplainStyle = "simple" | "swahili" | "story";
export const EXPLAIN_STYLES: ExplainStyle[] = ["simple", "swahili", "story"];

const LESSON_EXCERPT = 6000; // enough context without shipping a whole book

export class LearningService {
  constructor(
    private readonly pool: Pool,
    private readonly provider: AiProvider,
  ) {}

  /** §1.9: the member must be able to READ the lesson to use learning tools on it. */
  private async assertUnlocked(userId: string, moduleId: string): Promise<{ title: string; lesson: string }> {
    const module = await loadModule(this.pool, moduleId);
    if (!module) throw new ApiError("NOT_FOUND", "Module not found");
    const enrollment = await loadEnrollment(this.pool, userId);
    const unlocked =
      isEntryModule(module.level_number, module.module_sequence_number) ||
      (enrollment !== null && (await isModuleUnlocked(this.pool, enrollment, module)));
    if (!unlocked) throw new ApiError("GATE_LOCKED", "Module is not yet unlocked");
    const row = await maybeOne<{ title: string; lesson_content: string }>(
      this.pool,
      `SELECT title, lesson_content FROM modules WHERE module_id = $1 AND is_published = TRUE`,
      [moduleId],
    );
    if (!row) throw new ApiError("NOT_FOUND", "Module not found");
    return { title: row.title, lesson: row.lesson_content };
  }

  /** The lesson, rendered differently. Cached per (module, style). */
  async explain(userId: string, moduleId: string, style: ExplainStyle): Promise<{ style: ExplainStyle; body: string; cached: boolean }> {
    const { title, lesson } = await this.assertUnlocked(userId, moduleId);
    const cached = await maybeOne<{ body: string }>(
      this.pool,
      `SELECT body FROM module_explanations WHERE module_id = $1 AND style = $2`,
      [moduleId, style],
    );
    if (cached) return { style, body: cached.body, cached: true };

    const body = (
      await this.provider.complete({
        system: EXPLAIN_SYSTEM(style),
        messages: [{ role: "user", text: `Lesson title: ${title}\n\nLesson:\n${lesson.slice(0, LESSON_EXCERPT)}` }],
        tier: "standard",
        maxTokens: 1000,
        temperature: 0.5,
      })
    ).trim();
    await this.pool.query(
      `INSERT INTO module_explanations (module_id, style, body) VALUES ($1, $2, $3)
       ON CONFLICT (module_id, style) DO UPDATE SET body = $3, created_at = now()`,
      [moduleId, style, body],
    );
    return { style, body, cached: false };
  }

  /** "Review with Nuru" for the member's latest failed attempt on a module. */
  async remediate(userId: string, moduleId: string): Promise<{ attempt_id: string; body: string; missed: number; cached: boolean }> {
    const { title, lesson } = await this.assertUnlocked(userId, moduleId);
    const attempt = await maybeOne<{ attempt_id: string; score_achieved: string }>(
      this.pool,
      `SELECT qa.attempt_id, qa.score_achieved::text
         FROM quiz_attempts qa
         JOIN module_progress mp ON mp.progress_id = qa.progress_id
         JOIN enrollments e ON e.enrollment_id = mp.enrollment_id
        WHERE e.user_id = $1 AND mp.module_id = $2 AND qa.is_passed = FALSE
        ORDER BY qa.attempted_at DESC LIMIT 1`,
      [userId, moduleId],
    );
    if (!attempt) throw new ApiError("VALIDATION_FAILED", "No failed attempt to review — take the quiz first");

    const cached = await maybeOne<{ body: string }>(
      this.pool,
      `SELECT body FROM quiz_remediations WHERE user_id = $1 AND module_id = $2 AND attempt_id = $3`,
      [userId, moduleId, attempt.attempt_id],
    );
    const missedRows = await many<{ question_text: string; given_answer: string }>(
      this.pool,
      `SELECT qb.question_text, a.given_answer
         FROM quiz_attempt_answers a JOIN question_bank qb ON qb.question_id = a.question_id
        WHERE a.attempt_id = $1 AND a.is_correct = FALSE LIMIT 8`,
      [attempt.attempt_id],
    );
    if (cached) return { attempt_id: attempt.attempt_id, body: cached.body, missed: missedRows.length, cached: true };

    const missedBlock = missedRows
      .map((m, i) => `${i + 1}. Q: ${m.question_text}\n   Their answer: ${m.given_answer}`)
      .join("\n");
    const body = (
      await this.provider.complete({
        system: REMEDIATION_SYSTEM,
        messages: [
          {
            role: "user",
            text:
              `Module: ${title} (scored ${Math.round(Number(attempt.score_achieved))}%)\n\n` +
              `Questions they missed:\n${missedBlock || "(answer detail unavailable — review the lesson's core ideas)"}\n\n` +
              `The lesson they studied:\n${lesson.slice(0, LESSON_EXCERPT)}`,
          },
        ],
        tier: "standard",
        maxTokens: 700,
        temperature: 0.4,
      })
    ).trim();
    await this.pool.query(
      `INSERT INTO quiz_remediations (user_id, module_id, attempt_id, body) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, module_id, attempt_id) DO UPDATE SET body = $4`,
      [userId, moduleId, attempt.attempt_id, body],
    );
    return { attempt_id: attempt.attempt_id, body, missed: missedRows.length, cached: false };
  }

  /** Spaced repetition: verses due for review, weakest-and-stalest first.
   *  learning <50% → due after 1 day · learning <80% → 3 days ·
   *  learning ≥80% → 7 days · mastered → refresh after 21 days. */
  async dueVerses(userId: string): Promise<
    Array<{ memory_verse_id: string; reference: string; verse_text: string; best_match_pct: number; status: string; days_since: number }>
  > {
    return many(
      this.pool,
      `SELECT mv.memory_verse_id, mv.reference, mv.verse_text, p.best_match_pct, p.status,
              floor(extract(epoch FROM (now() - p.updated_at)) / 86400)::int AS days_since
         FROM memory_verse_progress p
         JOIN memory_verses mv ON mv.memory_verse_id = p.memory_verse_id AND mv.is_active
        WHERE p.user_id = $1
          AND (
            (p.status = 'learning' AND p.best_match_pct < 50 AND p.updated_at < now() - interval '1 day') OR
            (p.status = 'learning' AND p.best_match_pct >= 50 AND p.best_match_pct < 80 AND p.updated_at < now() - interval '3 days') OR
            (p.status = 'learning' AND p.best_match_pct >= 80 AND p.updated_at < now() - interval '7 days') OR
            (p.status = 'mastered' AND p.updated_at < now() - interval '21 days')
          )
        ORDER BY p.best_match_pct ASC, p.updated_at ASC
        LIMIT 5`,
      [userId],
    );
  }
}
