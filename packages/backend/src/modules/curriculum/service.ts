// Curriculum service (spec §1.5, §3.3). Levels, modules, lesson content, and the
// admin editing path that versions content. Reads are gated: locked module bodies
// are never returned (hard-lock invariant, §1.9).
import type { Pool } from "pg";
import type Redis from "ioredis";
import { z } from "zod";
import { many, maybeOne, one, tx, recordChange, audit } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { cacheGetSet, cacheKeys } from "../../cache.js";
import { loadEnrollment, loadModule, isModuleUnlocked, isEntryModule } from "../progress/gating.js";

/** Authoring marker that splits a lesson body into mobile reader pages. */
const PAGE_BREAK = /<!--\s*page-break\s*-->/;

/** How long a brokered lesson media URL stays valid (10 min — matches media TTL). */
const MEDIA_TTL_SEC = 600;

/**
 * The slice of MediaService the reader needs to broker a lesson media reference.
 * Injecting only this keeps CurriculumService constructible without Cloudinary
 * (tests / Redis-less dev) — brokering degrades to a raw passthrough when absent.
 */
export interface MediaSigner {
  signedUrl(objectKey: string, ttlSeconds?: number): { url: string; expires_at: string };
}

/**
 * Broker a stored lesson media reference to a member-safe URL. Mirrors the media
 * module's rule (§4.5, video.ts): already-absolute `http(s)://` links are external
 * (inherently shareable) and pass through unchanged; hosted object keys are signed
 * into a short-lived, tamper-evident URL so the raw storage ref never leaks. With
 * no signer configured (or a blank value) the raw value passes through so the
 * service stays usable without media credentials.
 */
export function brokerMediaUrl(value: string | null, signer?: MediaSigner): string | null {
  if (!value) return null;
  if (!signer) return value;
  if (/^https?:\/\//i.test(value)) return value; // external, shareable link — no signing
  return signer.signedUrl(value, MEDIA_TTL_SEC).url;
}

/**
 * Server-authored pagination: split lesson_content on the `<!-- page-break -->`
 * marker (whitespace-tolerant), trim the pieces, drop empties. Falls back to a
 * single page (the whole body) when no markers are present.
 */
export function splitContentPages(lessonContent: string): string[] {
  const pages = lessonContent
    .split(PAGE_BREAK)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return pages.length > 0 ? pages : [lessonContent];
}

export class CurriculumService {
  constructor(
    private readonly pool: Pool,
    private readonly redis?: Redis,
    // Optional media broker: when present, member lesson media (video/audio) is
    // signed into short-lived URLs (§4.5). Absent → raw refs pass through, so the
    // service still builds without Cloudinary (tests / Redis-less dev).
    private readonly media?: MediaSigner,
  ) {}

  /** Level catalog — identical for everyone, so cached (busted on admin edits). */
  listLevels(): Promise<unknown[]> {
    return cacheGetSet(this.redis, cacheKeys.levels, 600, () =>
      many(
        this.pool,
        `SELECT level_number, title, theme, required_exam_pass_mark FROM levels ORDER BY level_number`,
      ),
    );
  }

  /**
   * Per-level pathway summary for the member: every level with its published
   * module count, how many this member has completed, and a derived status
   * (completed / active / locked) respecting the hard-lock ceiling (§1.9).
   * Powers the Home dashboard and Levels overview in one round-trip.
   */
  async getPathwaySummary(userId: string): Promise<unknown> {
    const enrollment = await loadEnrollment(this.pool, userId);
    const currentLevel = enrollment?.current_level ?? 1;

    // Levels the member has passed the exam for but a discipler has not yet
    // ushered them past (§1.9 usher gate). These surface as 'awaiting_review' so
    // the client can show "awaiting your discipler" instead of a bare "active".
    const awaitingRows = await many<{ level_number: number }>(
      this.pool,
      `SELECT level_number FROM level_advancements WHERE user_id = $1 AND status = 'pending'`,
      [userId],
    );
    const awaitingLevels = new Set(awaitingRows.map((r) => r.level_number));
    const rows = await many<{
      level_number: number;
      title: string;
      theme: string | null;
      description: string | null;
      total_modules: number;
      completed_modules: number;
      minutes: number;
      exam_status: string;
    }>(
      this.pool,
      // A module counts as done if the member completed it OR it sits before the
      // admin-set entry point in their placed level (covered by placement, §1.9
      // entry-point). Defaults (start_level 1, seq 1) make the covered clause inert.
      `SELECT l.level_number, l.title, l.theme, l.description, l.exam_status,
              COUNT(m.module_id)::int AS total_modules,
              COUNT(*) FILTER (
                WHERE m.module_id IS NOT NULL
                  AND (mp.progress_id IS NOT NULL
                       OR (l.level_number = $2 AND m.module_sequence_number < $3))
              )::int AS completed_modules,
              COALESCE(SUM(m.estimated_minutes), 0)::int AS minutes
         FROM levels l
         LEFT JOIN modules m
           ON m.level_number = l.level_number AND m.is_published = TRUE
         LEFT JOIN module_progress mp
           ON mp.module_id = m.module_id AND mp.is_completed
          AND mp.enrollment_id = $1
        GROUP BY l.level_number, l.title, l.theme, l.description, l.exam_status
        ORDER BY l.level_number`,
      [enrollment?.enrollment_id ?? null, enrollment?.start_level ?? 1, enrollment?.start_module_sequence ?? 1],
    );

    const levels = rows.map((r) => {
      const allDone = r.total_modules > 0 && r.completed_modules >= r.total_modules;
      // The member has cleared this level's exam and is awaiting their discipler:
      // report 'awaiting_review' (the next level stays locked until ushered).
      const awaitingReview = awaitingLevels.has(r.level_number) && r.level_number === currentLevel;
      const status = awaitingReview
        ? "awaiting_review"
        : r.level_number < currentLevel
          ? "completed"
          : r.level_number > currentLevel
            ? "locked"
            : allDone
              ? "completed"
              : "active";
      return {
        level_number: r.level_number,
        title: r.title,
        theme: r.theme,
        description: r.description,
        total_modules: r.total_modules,
        completed_modules: r.completed_modules,
        minutes: r.minutes,
        status,
        awaiting_review: awaitingReview,
        // The level's final exam is live only once an admin publishes it — the
        // client hides the exam gate until then (the exam is "in review").
        exam_published: r.exam_status === "published",
      };
    });
    return { current_level: currentLevel, levels };
  }

  /** Modules for a level. Locked modules return metadata + locked:true, no body. */
  async listModulesForLevel(userId: string, levelNumber: number): Promise<unknown[]> {
    const enrollment = await loadEnrollment(this.pool, userId);
    const modules = await many<{
      module_id: string;
      level_number: number;
      module_sequence_number: number;
      title: string;
      summary: string | null;
      estimated_minutes: number | null;
      evaluation_kind: string;
      quiz_pass_mark: string;
      is_published: boolean;
    }>(
      this.pool,
      // The exit-exam module is a CONTAINER for the level's exam questions, not a
      // readable lesson — it must not appear in the member's trail (it can't be
      // "read" to completion, which would deadlock the "finish every module" exam
      // gate). Members reach the exam via the separate "Take the Level N exam" gate.
      `SELECT module_id, level_number, module_sequence_number, title, summary, estimated_minutes,
              evaluation_kind, quiz_pass_mark, is_published
         FROM modules
        WHERE level_number = $1 AND is_published = TRUE AND evaluation_kind <> 'exit_exam'
         ORDER BY module_sequence_number`,
      [levelNumber],
    );

    // One query for everything this member has completed; cheap set membership.
    const completedRows = enrollment
      ? await many<{ module_id: string }>(
          this.pool,
          `SELECT module_id FROM module_progress WHERE enrollment_id = $1 AND is_completed`,
          [enrollment.enrollment_id],
        )
      : [];
    const completedSet = new Set(completedRows.map((r) => r.module_id));

    const out: unknown[] = [];
    for (const m of modules) {
      const unlocked =
        isEntryModule(m.level_number, m.module_sequence_number) ||
        (enrollment !== null &&
          (await isModuleUnlocked(this.pool, enrollment, {
            module_id: m.module_id,
            level_number: m.level_number,
            module_sequence_number: m.module_sequence_number,
          })));
      // Modules before the admin-set entry point are "covered" by the placement —
      // shown as completed (the member begins at the entry module).
      const covered =
        enrollment !== null &&
        m.level_number === enrollment.start_level &&
        m.module_sequence_number < enrollment.start_module_sequence;
      const completed = completedSet.has(m.module_id) || covered;
      const status = completed ? "completed" : unlocked ? "next" : "locked";
      out.push({
        module_id: m.module_id,
        level_number: m.level_number,
        module_sequence_number: m.module_sequence_number,
        title: m.title,
        summary: m.summary,
        estimated_minutes: m.estimated_minutes,
        evaluation_kind: m.evaluation_kind,
        quiz_pass_mark: Number(m.quiz_pass_mark),
        completed,
        status,
        progress: completed ? 100 : 0,
        locked: !unlocked,
      });
    }
    return out;
  }

  /**
   * The member getModule gating check (§1.9), shared by every member-facing
   * read/write on a module body — 404 for unknown or non-published modules,
   * 409 GATE_LOCKED when the module is not yet unlocked for this member.
   */
  private async assertUnlocked(userId: string, moduleId: string): Promise<void> {
    const module = await loadModule(this.pool, moduleId);
    if (!module) throw new ApiError("NOT_FOUND", "Module not found");
    // Students never receive non-published bodies — drafts/archived are invisible
    // (the hard-lock invariant extends to lifecycle state, §1.9).
    const pub = await maybeOne<{ is_published: boolean }>(
      this.pool,
      `SELECT is_published FROM modules WHERE module_id = $1`,
      [moduleId],
    );
    if (!pub?.is_published) throw new ApiError("NOT_FOUND", "Module not found");
    // Level 1 · Module 1 is the universal entry point — always readable, even
    // before an enrollment exists. Everything else stays gated (§1.9).
    if (!isEntryModule(module.level_number, module.module_sequence_number)) {
      const enrollment = await loadEnrollment(this.pool, userId);
      if (!enrollment || !(await isModuleUnlocked(this.pool, enrollment, module))) {
        throw new ApiError("GATE_LOCKED", "Module is not yet unlocked", {
          module_sequence_number: module.module_sequence_number,
        });
      }
    }
  }

  /** Full lesson content + (signed) media URL. 409 GATE_LOCKED if not unlocked. */
  async getModule(userId: string, moduleId: string): Promise<unknown> {
    await this.assertUnlocked(userId, moduleId);
    // Published lesson bodies are identical for every reader, so the (heavy)
    // content read is cached and busted whenever an admin edits the module.
    const full = await cacheGetSet(this.redis, cacheKeys.moduleContent(moduleId), 600, () =>
      one<{
        lesson_content: string;
        video_url: string | null;
        video_duration_sec: number | null;
        audio_url: string | null;
        audio_duration_sec: number | null;
      }>(
        this.pool,
        `SELECT module_id, level_number, module_sequence_number, title, lesson_content,
                summary, key_verses, video_url, video_duration_sec,
                audio_url, audio_duration_sec, evaluation_kind, estimated_minutes,
                quiz_pass_mark, current_version
           FROM modules WHERE module_id = $1`,
        [moduleId],
      ),
    );
    // Lesson media is brokered to signed, expiring URLs so raw storage refs never
    // leak (§4.5) — done AFTER the cache read (the raw row is cached; per-request
    // signed URLs are not). Durations pass through as whole seconds for the reader's
    // "watch X min / listen Y min" labels. content_pages is derived (never stored):
    // lesson_content stays untouched for older clients; the reader paginates on the
    // server-authored split. CONTRACT (iOS): video_url signed, video_duration_sec,
    // audio_url signed|null, audio_duration_sec.
    return {
      ...full,
      video_url: brokerMediaUrl(full.video_url, this.media),
      audio_url: brokerMediaUrl(full.audio_url, this.media),
      content_pages: splitContentPages(full.lesson_content),
      locked: false,
    };
  }

  /** Heartbeat body — all deltas optional; each capped at 600s (10 min). */
  static readonly EngagementSchema = z.object({
    reading_seconds: z.number().int().min(0).max(600).optional(),
    audio_seconds: z.number().int().min(0).max(600).optional(),
    video_seconds: z.number().int().min(0).max(600).optional(),
    last_page: z.number().int().min(1).optional(),
  });

  /**
   * Accumulate an engagement heartbeat for (user, module). Totals grow by the
   * clamped deltas (a single heartbeat can never claim more than 600s per
   * channel — server-side cap, defense in depth beyond the zod bound);
   * last_page overwrites only when provided. Gated exactly like getModule:
   * a member cannot write engagement for content they cannot open (§1.9).
   */
  async recordEngagement(
    userId: string,
    moduleId: string,
    input: z.infer<typeof CurriculumService.EngagementSchema>,
  ): Promise<unknown> {
    await this.assertUnlocked(userId, moduleId);
    const clamp = (v: number | undefined): number => Math.max(0, Math.min(v ?? 0, 600));
    return one(
      this.pool,
      `INSERT INTO module_engagement (user_id, module_id, reading_seconds, audio_seconds, video_seconds, last_page)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 1))
       ON CONFLICT (user_id, module_id) DO UPDATE SET
         reading_seconds = module_engagement.reading_seconds + EXCLUDED.reading_seconds,
         audio_seconds   = module_engagement.audio_seconds   + EXCLUDED.audio_seconds,
         video_seconds   = module_engagement.video_seconds   + EXCLUDED.video_seconds,
         last_page       = COALESCE($6, module_engagement.last_page),
         updated_at      = now()
       RETURNING reading_seconds, audio_seconds, video_seconds, last_page`,
      [userId, moduleId, clamp(input.reading_seconds), clamp(input.audio_seconds), clamp(input.video_seconds), input.last_page ?? null],
    );
  }

  /** The member's accumulated engagement for a module (zeros / page 1 when none). */
  async getEngagement(userId: string, moduleId: string): Promise<unknown> {
    await this.assertUnlocked(userId, moduleId);
    const row = await maybeOne(
      this.pool,
      `SELECT reading_seconds, audio_seconds, video_seconds, last_page
         FROM module_engagement WHERE user_id = $1 AND module_id = $2`,
      [userId, moduleId],
    );
    return row ?? { reading_seconds: 0, audio_seconds: 0, video_seconds: 0, last_page: 1 };
  }

  static readonly EditModuleSchema = z
    .object({
      lesson_content: z.string().min(1).optional(),
      quiz_pass_mark: z.number().min(0).max(100).optional(),
      title: z.string().min(1).max(255).optional(),
      is_published: z.boolean().optional(),
    })
    .strict();

  /** Admin edit: writes an immutable module_versions row, bumps current_version. */
  async editModule(
    moduleId: string,
    editorId: string,
    input: z.infer<typeof CurriculumService.EditModuleSchema>,
  ): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const existing = await maybeOne<{ current_version: number; lesson_content: string }>(
        c,
        `SELECT current_version, lesson_content FROM modules WHERE module_id = $1`,
        [moduleId],
      );
      if (!existing) throw new ApiError("NOT_FOUND", "Module not found");

      if (input.lesson_content !== undefined) {
        const nextVersion = existing.current_version + 1;
        await c.query(
          `INSERT INTO module_versions (module_id, version_number, lesson_content, edited_by)
           VALUES ($1,$2,$3,$4)`,
          [moduleId, nextVersion, input.lesson_content, editorId],
        );
        await c.query(
          `UPDATE modules SET lesson_content = $1, current_version = $2 WHERE module_id = $3`,
          [input.lesson_content, nextVersion, moduleId],
        );
      }
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (input.quiz_pass_mark !== undefined) {
        sets.push(`quiz_pass_mark = $${i++}`);
        params.push(input.quiz_pass_mark);
      }
      if (input.title !== undefined) {
        sets.push(`title = $${i++}`);
        params.push(input.title);
      }
      if (input.is_published !== undefined) {
        // is_published is a generated mirror of status now — write status instead.
        sets.push(`status = $${i++}`);
        params.push(input.is_published ? "published" : "draft");
      }
      if (sets.length > 0) {
        params.push(moduleId);
        await c.query(`UPDATE modules SET ${sets.join(", ")} WHERE module_id = $${i}`, params);
      }

      await recordChange(c, "modules", moduleId, null, "upsert");
      await audit(c, editorId, "module.edited", "modules", moduleId, {});
      const updated = await one(c, `SELECT * FROM modules WHERE module_id = $1`, [moduleId]);
      return updated;
    });
  }

  static readonly AddQuestionsSchema = z.object({
    questions: z
      .array(
        z.object({
          q_type: z.enum(["MultipleChoice", "TrueFalse", "FillInTheBlank"]),
          question_text: z.string().min(1),
          answer_options: z.array(z.string()).optional(),
          correct_answer: z.string().min(1),
          difficulty_rating: z.number().int().min(1).max(5).default(1),
        }),
      )
      .min(1),
  });

  async addQuestions(
    moduleId: string,
    editorId: string,
    input: z.infer<typeof CurriculumService.AddQuestionsSchema>,
  ): Promise<{ added: number }> {
    return tx(this.pool, async (c) => {
      const module = await maybeOne(c, `SELECT module_id FROM modules WHERE module_id = $1`, [moduleId]);
      if (!module) throw new ApiError("NOT_FOUND", "Module not found");
      for (const q of input.questions) {
        await c.query(
          `INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            moduleId,
            q.q_type,
            q.question_text,
            q.answer_options ? JSON.stringify(q.answer_options) : null,
            q.correct_answer,
            q.difficulty_rating,
          ],
        );
      }
      await audit(c, editorId, "module.questions_added", "modules", moduleId, {
        count: input.questions.length,
      });
      return { added: input.questions.length };
    });
  }
}
