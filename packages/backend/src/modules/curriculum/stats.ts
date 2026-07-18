// ONE stats source for the curriculum (docs/CURRICULUM_ARCHITECTURE.md §3).
// The audit found published-module counts computed in six independent SQL
// sites, four completion formulas and five certificate counts — this module now
// OWNS the aggregate SQL. Everything reads it: the Curriculum Dashboard
// (`/admin/curriculum/summary`), the completeness report (`/validate`), the
// classified activity feed (`/activity`), and adminops' levelsReport (whose
// per-level numbers delegate here; its response shape is unchanged).
// Replica reads only — nothing here writes.
import type { Pool } from "pg";
import { many, maybeOne } from "../../db/db.js";

export interface ValidationIssue {
  severity: "error" | "warning" | "info";
  level_number: number;
  module_id: string | null;
  code: string;
  message: string;
}

export type ActivityKind =
  | "published"
  | "edited"
  | "review"
  | "video"
  | "quiz"
  | "module"
  | "milestone";

/** Server-side classification of curriculum audit actions (§3 activity). */
export function classifyActivity(action: string): ActivityKind {
  if (action === "module.published" || action === "module.unpublished") return "published";
  if (action === "module.created" || action === "module.archived" || action === "module.reordered" || action === "level.created") {
    return "module";
  }
  if (action === "module.questions_added" || action === "level.exam_configured" || action.startsWith("question.")) {
    return "quiz";
  }
  if (action.startsWith("media.")) return "video";
  if (action.startsWith("reflection.")) return "review";
  if (action === "level.ushered" || action.startsWith("certificate.")) return "milestone";
  // module.updated | module.edited | module.reverted | level.updated | rest
  return "edited";
}

interface LevelReportRow {
  level_number: number;
  title: string;
  theme: string | null;
  duration: string | null;
  status: string;
  color: string;
  modules_total: number;
  modules_published: number;
  modules_draft: number;
  modules_archived: number;
  learners: number;
  completion_pct: number;
  certificates: number;
}

export class CurriculumStatsService {
  constructor(private readonly replica: Pool) {}

  /**
   * Per-level analytics rows — module counts by status, enrolled learners (by
   * current_level), completion of published modules (the ONE formula: distinct
   * completed published-module rows ÷ (learners × published modules)), and
   * certificates issued. Moved verbatim from adminops.levelsReport, which now
   * delegates here (§3 — one stats source).
   */
  levelsReportRows(): Promise<LevelReportRow[]> {
    return many<LevelReportRow>(
      this.replica,
      `WITH mod AS (
         SELECT level_number,
                count(*)::int                                            AS modules_total,
                count(*) FILTER (WHERE status = 'published')::int        AS modules_published,
                count(*) FILTER (WHERE status = 'draft')::int            AS modules_draft,
                count(*) FILTER (WHERE status = 'archived')::int         AS modules_archived
           FROM modules GROUP BY level_number
       ),
       enr AS (
         SELECT current_level AS level_number, count(*)::int AS learners
           FROM enrollments GROUP BY current_level
       ),
       done AS (
         SELECT m.level_number, count(*)::int AS completed
           FROM module_progress mp
           JOIN modules m       ON m.module_id = mp.module_id AND m.status = 'published'
           JOIN enrollments e   ON e.enrollment_id = mp.enrollment_id AND e.current_level = m.level_number
          WHERE mp.is_completed
          GROUP BY m.level_number
       ),
       cert AS (
         SELECT level_number, count(*)::int AS certificates
           FROM certificates WHERE level_number IS NOT NULL AND revoked_at IS NULL
          GROUP BY level_number
       )
       SELECT l.level_number, l.title, l.theme, l.duration, l.status, l.color,
              COALESCE(mod.modules_total, 0)     AS modules_total,
              COALESCE(mod.modules_published, 0) AS modules_published,
              COALESCE(mod.modules_draft, 0)     AS modules_draft,
              COALESCE(mod.modules_archived, 0)  AS modules_archived,
              COALESCE(enr.learners, 0)          AS learners,
              CASE WHEN COALESCE(enr.learners,0) > 0 AND COALESCE(mod.modules_published,0) > 0
                   THEN round(COALESCE(done.completed,0)::numeric
                              / (enr.learners * mod.modules_published) * 100)::int
                   ELSE 0 END                    AS completion_pct,
              COALESCE(cert.certificates, 0)     AS certificates
         FROM levels l
         LEFT JOIN mod  ON mod.level_number  = l.level_number
         LEFT JOIN enr  ON enr.level_number  = l.level_number
         LEFT JOIN done ON done.level_number = l.level_number
         LEFT JOIN cert ON cert.level_number = l.level_number
        ORDER BY l.level_number`,
    );
  }

  /**
   * The Curriculum Dashboard payload in ONE call (§3): totals, per-level
   * summary cards, and the pipeline counts. Level cards carry quiz status,
   * videos attached, estimated duration, last_updated and a validation badge —
   * derived from the same validate() issue list the report endpoint serves.
   */
  async summary(): Promise<Record<string, unknown>> {
    const [report, extras, totals, issues] = await Promise.all([
      this.levelsReportRows(),
      many<{
        level_number: number;
        locked: boolean;
        exam_status: string;
        exam_question_count: number | null;
        exam_exists: boolean;
        question_count: number;
        videos_attached: number;
        estimated_minutes: number;
        last_updated: string | null;
      }>(
        this.replica,
        `SELECT l.level_number, l.locked, l.exam_status, l.exam_question_count,
                EXISTS (SELECT 1 FROM modules m
                         WHERE m.level_number = l.level_number
                           AND m.evaluation_kind = 'exit_exam' AND m.status <> 'archived') AS exam_exists,
                (SELECT COUNT(*)::int FROM question_bank q
                   JOIN modules m ON m.module_id = q.module_id
                  WHERE m.level_number = l.level_number AND m.is_published AND q.is_active) AS question_count,
                (SELECT COUNT(DISTINCT x.asset)::int FROM (
                    SELECT p.media_asset_id AS asset
                      FROM media_placements p JOIN modules m ON m.module_id = p.module_id
                     WHERE m.level_number = l.level_number AND m.status <> 'archived'
                    UNION
                    SELECT m.media_asset_id FROM modules m
                     WHERE m.level_number = l.level_number AND m.status <> 'archived'
                       AND m.media_asset_id IS NOT NULL
                 ) x) AS videos_attached,
                (SELECT COALESCE(SUM(m.estimated_minutes), 0)::int FROM modules m
                  WHERE m.level_number = l.level_number AND m.status = 'published') AS estimated_minutes,
                (SELECT MAX(m.updated_at)::text FROM modules m
                  WHERE m.level_number = l.level_number) AS last_updated
           FROM levels l ORDER BY l.level_number`,
      ),
      maybeOne<Record<string, number | null>>(
        this.replica,
        `SELECT
           (SELECT COUNT(*)::int FROM levels WHERE status = 'published')  AS levels_published,
           (SELECT COUNT(*)::int FROM levels WHERE status = 'draft')      AS levels_draft,
           (SELECT COUNT(*)::int FROM levels WHERE status = 'in_review')  AS levels_in_review,
           (SELECT COUNT(*)::int FROM levels WHERE locked)                AS levels_locked,
           (SELECT COUNT(*)::int FROM modules WHERE status = 'published') AS modules_published,
           (SELECT COUNT(*)::int FROM modules WHERE status = 'draft')     AS modules_draft,
           (SELECT COUNT(*)::int FROM modules WHERE status = 'archived')  AS modules_archived,
           (SELECT COUNT(*)::int FROM modules m
             WHERE m.status <> 'archived' AND m.evaluation_kind <> 'exit_exam'
               AND m.media_asset_id IS NULL AND m.video_url IS NULL
               AND NOT EXISTS (SELECT 1 FROM media_placements p WHERE p.module_id = m.module_id))
                                                                          AS modules_missing_video,
           (SELECT COUNT(*)::int FROM modules m
             WHERE m.status <> 'archived' AND m.evaluation_kind = 'quiz'
               AND NOT EXISTS (SELECT 1 FROM question_bank q
                                WHERE q.module_id = m.module_id AND q.is_active))
                                                                          AS modules_missing_quiz,
           (SELECT COUNT(*)::int FROM modules m
             WHERE m.status <> 'archived' AND btrim(m.lesson_content) = '')
                                                                          AS modules_missing_content,
           (SELECT COUNT(*)::int FROM enrollments WHERE state = 'active') AS learners_active,
           (SELECT ROUND(AVG(score_achieved))::int FROM quiz_attempts)    AS avg_quiz_score,
           (SELECT COUNT(*)::int FROM certificates WHERE revoked_at IS NULL) AS certificates_issued,
           (SELECT COUNT(*)::int FROM badges)                             AS badges_configured,
           (SELECT COUNT(*)::int FROM module_reflections WHERE state = 'pending') AS reflection_queue,
           (SELECT COUNT(*)::int FROM level_advancements WHERE status = 'pending') AS level_reviews_waiting,
           (SELECT COUNT(*)::int FROM media_assets ma
             WHERE ma.deleted_at IS NULL
               AND (EXISTS (SELECT 1 FROM media_placements p WHERE p.media_asset_id = ma.media_asset_id)
                    OR EXISTS (SELECT 1 FROM modules m WHERE m.media_asset_id = ma.media_asset_id)))
                                                                          AS assets_attached,
           (SELECT COUNT(*)::int FROM media_assets ma
             WHERE ma.deleted_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM media_placements p WHERE p.media_asset_id = ma.media_asset_id)
               AND NOT EXISTS (SELECT 1 FROM modules m WHERE m.media_asset_id = ma.media_asset_id))
                                                                          AS assets_unattached,
           -- The ONE completion formula (§3): distinct completed published-module
           -- rows ÷ (active learners × published modules).
           (SELECT CASE WHEN t.learners > 0 AND t.pub > 0
                        THEN ROUND(t.completed::numeric / (t.learners * t.pub) * 100)::int
                        ELSE 0 END
              FROM (SELECT
                      (SELECT COUNT(*)::int FROM enrollments WHERE state = 'active') AS learners,
                      (SELECT COUNT(*)::int FROM modules WHERE status = 'published') AS pub,
                      (SELECT COUNT(*)::int FROM module_progress mp
                         JOIN modules m ON m.module_id = mp.module_id AND m.status = 'published'
                        WHERE mp.is_completed) AS completed) t)           AS avg_completion_pct`,
      ),
      this.validate(),
    ]);

    const extrasByLevel = new Map(extras.map((e) => [e.level_number, e]));
    const issuesByLevel = new Map<number, { errors: number; warnings: number }>();
    for (const issue of issues) {
      const bucket = issuesByLevel.get(issue.level_number) ?? { errors: 0, warnings: 0 };
      if (issue.severity === "error") bucket.errors += 1;
      else if (issue.severity === "warning") bucket.warnings += 1;
      issuesByLevel.set(issue.level_number, bucket);
    }

    const levels = report.map((row) => {
      const extra = extrasByLevel.get(row.level_number);
      const validation = issuesByLevel.get(row.level_number) ?? { errors: 0, warnings: 0 };
      return {
        level_number: row.level_number,
        title: row.title,
        theme: row.theme,
        color: row.color,
        status: row.status,
        locked: extra?.locked ?? false,
        duration: row.duration,
        modules_published: row.modules_published,
        modules_draft: row.modules_draft,
        modules_total: row.modules_total,
        modules_archived: row.modules_archived,
        quiz: {
          exam_exists: extra?.exam_exists ?? false,
          exam_published: extra?.exam_status === "published",
          exam_question_count: extra?.exam_question_count ?? null,
          question_count: extra?.question_count ?? 0,
        },
        videos_attached: extra?.videos_attached ?? 0,
        estimated_minutes: extra?.estimated_minutes ?? 0,
        learners: row.learners,
        completion_pct: row.completion_pct,
        certificates: row.certificates,
        last_updated: extra?.last_updated ?? null,
        validation: {
          ...validation,
          status: validation.errors > 0 ? "errors" : validation.warnings > 0 ? "warnings" : "ok",
        },
      };
    });

    const t = totals ?? {};
    const num = (k: string): number => Number(t[k] ?? 0);
    return {
      totals: {
        levels: {
          published: num("levels_published"),
          draft: num("levels_draft"),
          in_review: num("levels_in_review"),
          total: num("levels_published") + num("levels_draft") + num("levels_in_review"),
        },
        modules: {
          published: num("modules_published"),
          draft: num("modules_draft"),
          archived: num("modules_archived"),
          total: num("modules_published") + num("modules_draft") + num("modules_archived"),
        },
        modules_missing_video: num("modules_missing_video"),
        modules_missing_quiz: num("modules_missing_quiz"),
        modules_missing_content: num("modules_missing_content"),
        learners_active: num("learners_active"),
        avg_completion_pct: num("avg_completion_pct"),
        avg_quiz_score: t["avg_quiz_score"] == null ? null : Number(t["avg_quiz_score"]),
        certificates_issued: num("certificates_issued"),
        badges_configured: num("badges_configured"),
        reflection_queue: num("reflection_queue"),
        level_reviews_waiting: num("level_reviews_waiting"),
        video_assets: {
          attached: num("assets_attached"),
          unattached: num("assets_unattached"),
          total: num("assets_attached") + num("assets_unattached"),
        },
      },
      pipeline: {
        drafts: num("levels_draft"),
        in_review: num("levels_in_review"),
        locked: num("levels_locked"),
        live: num("levels_published"),
      },
      levels,
    };
  }

  /**
   * The completeness report (§3): every issue carries
   * {severity, level_number, module_id?, code, message}. Errors first, then by
   * level. One UNION ALL round trip.
   */
  validate(): Promise<ValidationIssue[]> {
    return many<ValidationIssue>(
      this.replica,
      `SELECT * FROM (
         SELECT 'error'::text AS severity, m.level_number, m.module_id::text AS module_id,
                'module_empty_content'::text AS code,
                'Published module "' || m.title || '" has empty content' AS message
           FROM modules m
          WHERE m.status = 'published' AND btrim(m.lesson_content) = ''
         UNION ALL
         SELECT 'error', m.level_number, m.module_id::text, 'quiz_no_questions',
                'Quiz module "' || m.title || '" is published with zero active questions'
           FROM modules m
          WHERE m.status = 'published' AND m.evaluation_kind = 'quiz'
            AND NOT EXISTS (SELECT 1 FROM question_bank q
                             WHERE q.module_id = m.module_id AND q.is_active)
         UNION ALL
         SELECT 'error', l.level_number, NULL, 'level_no_published_modules',
                'Level ' || l.level_number || ' ("' || l.title || '") is published with zero published modules'
           FROM levels l
          WHERE l.status = 'published'
            AND NOT EXISTS (SELECT 1 FROM modules m
                             WHERE m.level_number = l.level_number AND m.status = 'published')
         UNION ALL
         SELECT 'warning', l.level_number, NULL, 'exam_missing',
                'Level ' || l.level_number || ' has no exit-exam module'
           FROM levels l
          WHERE l.status = 'published'
            AND NOT EXISTS (SELECT 1 FROM modules m
                             WHERE m.level_number = l.level_number
                               AND m.evaluation_kind = 'exit_exam' AND m.status <> 'archived')
         UNION ALL
         SELECT 'warning', l.level_number, NULL, 'exam_unpublished',
                'Level ' || l.level_number || '''s exit exam is not published (members cannot take it)'
           FROM levels l
          WHERE l.status = 'published' AND l.exam_status <> 'published'
         UNION ALL
         SELECT 'warning', m.level_number, p.module_id::text, 'placement_archived_target',
                'A media placement points at an archived ' ||
                CASE WHEN m.status = 'archived' THEN 'module' ELSE 'asset' END
           FROM media_placements p
           JOIN modules m       ON m.module_id = p.module_id
           JOIN media_assets ma ON ma.media_asset_id = p.media_asset_id
          WHERE m.status = 'archived' OR ma.deleted_at IS NOT NULL
         UNION ALL
         SELECT 'info', m.level_number, m.module_id::text, 'required_no_evaluation',
                'Module "' || m.title || '" is required but has no evaluation'
           FROM modules m
          WHERE m.status <> 'archived' AND m.required AND m.evaluation_kind = 'none'
       ) issues
       ORDER BY CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                level_number, code`,
    );
  }

  /**
   * Classified activity (§3): the curriculum slice of the audit log, each row
   * tagged published | edited | review | video | quiz | module | milestone —
   * classified server-side so every surface groups identically.
   */
  async activity(limit = 40): Promise<unknown[]> {
    const rows = await many<{
      audit_id: string;
      actor_id: string | null;
      actor_name: string | null;
      action: string;
      entity: string;
      entity_id: string | null;
      metadata: Record<string, unknown> | null;
      occurred_at: string;
    }>(
      this.replica,
      `SELECT a.audit_id, a.actor_id, u.full_name AS actor_name, a.action,
              a.entity, a.entity_id, a.metadata, a.occurred_at::text
         FROM audit_log a
         LEFT JOIN users u ON u.user_id = a.actor_id
        WHERE a.action LIKE 'module.%' OR a.action LIKE 'level.%'
           OR a.action LIKE 'question.%' OR a.action LIKE 'media.%'
           OR a.action LIKE 'reflection.%' OR a.action LIKE 'certificate.%'
        ORDER BY a.occurred_at DESC, a.audit_id DESC
        LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({ ...r, kind: classifyActivity(r.action) }));
  }
}
