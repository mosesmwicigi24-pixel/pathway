// Wave 3 of companion presence — FOOTPRINTS + YOUR WALK.
// Deliberately AI-free, like echoes: everything here is counted, not guessed.
//   • Footprints: who from your cell already walked this module — their faces
//     and when they finished. The trail is worn; you are not the first.
//   • Your Walk: the member's own history as one thread — began the pathway,
//     finished modules, wrote reflections, passed levels, mastered verses,
//     completed plans, earned badges. Real rows, real timestamps.
import type { Pool } from "pg";
import { many, maybeOne } from "../../db/db.js";

export interface Footprint {
  first_name: string;
  avatar_url: string | null;
  completed_at: string;
}

export interface FootprintsRes {
  count: number;
  scope: "cell" | "congregation";
  footprints: Footprint[];
}

export type WalkKind =
  | "began"
  | "module"
  | "reflection"
  | "level"
  | "certificate"
  | "verse"
  | "plan"
  | "badge";

export interface WalkEvent {
  kind: WalkKind;
  title: string;
  detail: string | null;
  quote: string | null;
  occurred_at: string;
}

export class WalkService {
  constructor(private readonly pool: Pool) {}

  /** Cell-mates (congregation when cell-less) who completed this module. */
  async footprints(userId: string, moduleId: string): Promise<FootprintsRes> {
    const me = await maybeOne<{ cell_group_id: string | null; congregation_id: string | null }>(
      this.pool,
      `SELECT cell_group_id, congregation_id FROM users WHERE user_id = $1`,
      [userId],
    );
    const scope: "cell" | "congregation" = me?.cell_group_id ? "cell" : "congregation";
    const rows = await many<Footprint & { total: number }>(
      this.pool,
      `WITH walkers AS (
         SELECT split_part(u.full_name, ' ', 1) AS first_name, u.avatar_url,
                mp.completed_at
           FROM module_progress mp
           JOIN enrollments e ON e.enrollment_id = mp.enrollment_id
           JOIN users u ON u.user_id = e.user_id
          WHERE mp.module_id = $2 AND mp.is_completed AND mp.completed_at IS NOT NULL
            AND u.user_id <> $1 AND u.deleted_at IS NULL
            AND (($3::uuid IS NOT NULL AND u.cell_group_id = $3)
                 OR ($3::uuid IS NULL AND u.congregation_id = $4))
       )
       SELECT first_name, avatar_url, completed_at, count(*) OVER () AS total
         FROM walkers ORDER BY completed_at DESC LIMIT 5`,
      [userId, moduleId, me?.cell_group_id ?? null, me?.congregation_id ?? null],
    );
    return {
      count: Number(rows[0]?.total ?? 0),
      scope,
      footprints: rows.map(({ first_name, avatar_url, completed_at }) => ({
        first_name,
        avatar_url,
        completed_at,
      })),
    };
  }

  /** The member's whole journey as one descending thread (capped at 80). */
  async yourWalk(userId: string): Promise<WalkEvent[]> {
    return many<WalkEvent>(
      this.pool,
      `SELECT * FROM (
         SELECT 'began'::text AS kind, 'You began the pathway'::text AS title,
                NULL::text AS detail, NULL::text AS quote, e.started_at AS occurred_at
           FROM enrollments e WHERE e.user_id = $1

         UNION ALL
         SELECT 'module', 'Finished "' || m.title || '"',
                'Level ' || m.level_number, NULL, mp.completed_at
           FROM module_progress mp
           JOIN enrollments e ON e.enrollment_id = mp.enrollment_id
           JOIN modules m ON m.module_id = mp.module_id
          WHERE e.user_id = $1 AND mp.is_completed AND mp.completed_at IS NOT NULL

         UNION ALL
         SELECT 'reflection', 'You wrote after "' || m.title || '"', NULL,
                left(trim(mr.body), 140) || CASE WHEN length(trim(mr.body)) > 140 THEN '…' ELSE '' END,
                mr.submitted_at
           FROM module_reflections mr
           JOIN modules m ON m.module_id = mr.module_id
          WHERE mr.user_id = $1 AND length(trim(mr.body)) >= 10

         UNION ALL
         SELECT 'level', 'Passed the Level ' || t.level_number || ' exam',
                t.score_achieved || '%', NULL, t.attempted_at
           FROM (SELECT DISTINCT ON (lea.level_number)
                        lea.level_number, lea.score_achieved, lea.attempted_at
                   FROM level_exam_attempts lea
                   JOIN enrollments e ON e.enrollment_id = lea.enrollment_id
                  WHERE e.user_id = $1 AND lea.is_passed
                  ORDER BY lea.level_number, lea.attempted_at) t

         UNION ALL
         SELECT 'certificate', 'Level ' || c.level_number || ' certificate',
                'Sealed and verifiable', NULL, c.issued_at
           FROM certificates c
          WHERE c.user_id = $1 AND c.revoked_at IS NULL

         UNION ALL
         SELECT 'verse', 'Mastered ' || mv.reference,
                mvp.best_match_pct || '% word-perfect', NULL, mvp.updated_at
           FROM memory_verse_progress mvp
           JOIN memory_verses mv ON mv.memory_verse_id = mvp.memory_verse_id
          WHERE mvp.user_id = $1 AND mvp.status = 'mastered'

         UNION ALL
         SELECT 'plan', 'Completed "' || rp.title || '"',
                rp.day_count || ' days', NULL, rpp.completed_at
           FROM reading_plan_progress rpp
           JOIN reading_plans rp ON rp.plan_id = rpp.plan_id
          WHERE rpp.user_id = $1 AND rpp.completed_at IS NOT NULL

         UNION ALL
         SELECT 'badge', b.name, b.description, NULL, ub.awarded_at
           FROM user_badges ub
           JOIN badges b ON b.badge_id = ub.badge_id
          WHERE ub.user_id = $1 AND ub.revoked_at IS NULL
       ) walk
       ORDER BY occurred_at DESC
       LIMIT 80`,
      [userId],
    );
  }
}
