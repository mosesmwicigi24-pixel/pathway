// The Member Story — ONE understanding layer per member ("one brain, many
// hands"). `facts` is deterministic SQL aggregation over what the platform
// already records; `narrative` is a short AI-composed pastoral dossier over
// those facts. Rebuilt nightly by the worker; the companion, the Sunday
// Letter, and future surfaces all read from here.
//
// Privacy covenant (users.ai_opt_out):
//   • opted out → the member's WRITTEN words (reflections, talk posts) are
//     never sent to a model and no narrative/letter is generated. Behavioral
//     aggregates still exist exactly as they already power the app's UI.
//   • prayer content NEVER enters facts — only counts. The journal stays
//     between the member and God (§ privacy tier T3).
import type { Pool } from "pg";
import { many, maybeOne } from "../../db/db.js";
import { ScoresService } from "../scores/service.js";
import type { AiProvider } from "../assistant/provider.js";
import { STORY_NARRATIVE_SYSTEM } from "./prompts.js";

export interface StoryFacts {
  name: string;
  member_since: string | null;
  level: number;
  modules_completed_total: number;
  last_module_completed: { title: string; at: string } | null;
  levels_passed: number[];
  quiz_recent_avg: number | null;
  scores: {
    overall: number;
    band: string;
    trend_delta: number;
    habits: number;
    curriculum: number;
    attendance: number;
    word: number;
    prayer: number;
  };
  active_days_28: number;
  checkins_28: number;
  prayer: { entries_28: number; answered_28: number; answered_total: number };
  reflections_recent: Array<{ at: string; about: string; excerpt: string }>;
  talk_posts_28: number;
}

export interface MemberStoryRow {
  user_id: string;
  facts: StoryFacts;
  narrative: string;
  built_at: string;
}

const EXCERPT = 220;

export class StoryService {
  constructor(
    private readonly pool: Pool,
    private readonly provider: AiProvider,
    private readonly scores = new ScoresService(pool),
  ) {}

  async get(userId: string): Promise<MemberStoryRow | null> {
    return maybeOne<MemberStoryRow>(
      this.pool,
      `SELECT user_id, facts, narrative, built_at FROM member_story WHERE user_id = $1`,
      [userId],
    );
  }

  /** Deterministic aggregation — no AI, no prayer bodies, reflections only when consented. */
  async buildFacts(userId: string): Promise<{ facts: StoryFacts; optOut: boolean } | null> {
    const user = await maybeOne<{ full_name: string; ai_opt_out: boolean; created_at: string }>(
      this.pool,
      `SELECT full_name, ai_opt_out, created_at::text AS created_at FROM users WHERE user_id = $1`,
      [userId],
    );
    if (!user) return null;

    const enrollment = await maybeOne<{ enrollment_id: string; current_level: number }>(
      this.pool,
      `SELECT enrollment_id, current_level FROM enrollments WHERE user_id = $1`,
      [userId],
    );

    const progress = await maybeOne<{ total: number; last_title: string | null; last_at: string | null }>(
      this.pool,
      `SELECT count(*) FILTER (WHERE mp.is_completed)::int AS total,
              (SELECT m2.title FROM module_progress mp2 JOIN modules m2 ON m2.module_id = mp2.module_id
                WHERE mp2.enrollment_id = e.enrollment_id AND mp2.is_completed
                ORDER BY mp2.completed_at DESC NULLS LAST LIMIT 1) AS last_title,
              (SELECT mp2.completed_at::text FROM module_progress mp2
                WHERE mp2.enrollment_id = e.enrollment_id AND mp2.is_completed
                ORDER BY mp2.completed_at DESC NULLS LAST LIMIT 1) AS last_at
         FROM enrollments e LEFT JOIN module_progress mp ON mp.enrollment_id = e.enrollment_id
        WHERE e.user_id = $1
        GROUP BY e.enrollment_id`,
      [userId],
    );

    const levelsPassed = await many<{ level_number: number }>(
      this.pool,
      `SELECT DISTINCT lea.level_number FROM level_exam_attempts lea
         JOIN enrollments e ON e.enrollment_id = lea.enrollment_id
        WHERE e.user_id = $1 AND lea.is_passed ORDER BY lea.level_number`,
      [userId],
    );

    const quiz = await maybeOne<{ avg: string | null }>(
      this.pool,
      `SELECT round(avg(score_achieved))::text AS avg FROM (
         SELECT qa.score_achieved FROM quiz_attempts qa
           JOIN module_progress mp ON mp.progress_id = qa.progress_id
           JOIN enrollments e ON e.enrollment_id = mp.enrollment_id
          WHERE e.user_id = $1 ORDER BY qa.attempted_at DESC LIMIT 5) t`,
      [userId],
    );

    const rhythm = await maybeOne<{ active_days: number; checkins: number }>(
      this.pool,
      `SELECT count(DISTINCT (occurred_at AT TIME ZONE 'Africa/Nairobi')::date)::int AS active_days,
              (SELECT count(*)::int FROM attendance_logs a
                WHERE a.user_id = $1 AND a.checked_in_at >= now() - interval '28 days') AS checkins
         FROM interaction_events
        WHERE user_id = $1 AND occurred_at >= now() - interval '28 days'`,
      [userId],
    );

    const prayer = await maybeOne<{ entries_28: number; answered_28: number; answered_total: number }>(
      this.pool,
      `SELECT count(*) FILTER (WHERE created_at >= now() - interval '28 days')::int AS entries_28,
              count(*) FILTER (WHERE is_answered AND answered_at >= now() - interval '28 days')::int AS answered_28,
              count(*) FILTER (WHERE is_answered)::int AS answered_total
         FROM prayer_entries WHERE user_id = $1`,
      [userId],
    );

    const talk = await maybeOne<{ n: number }>(
      this.pool,
      `SELECT count(*)::int AS n FROM plan_day_talk_posts
        WHERE user_id = $1 AND created_at >= now() - interval '28 days'`,
      [userId],
    );

    // Written content (privacy tier T2) — only when the member has not opted out.
    const reflections = user.ai_opt_out
      ? []
      : await many<{ at: string; about: string; excerpt: string }>(
          this.pool,
          `SELECT submitted_at::text AS at, m.title AS about, left(r.body, ${EXCERPT}) AS excerpt
             FROM module_reflections r JOIN modules m ON m.module_id = r.module_id
            WHERE r.user_id = $1 ORDER BY r.submitted_at DESC LIMIT 3`,
          [userId],
        );

    const s = await this.scores.all(userId);
    const facts: StoryFacts = {
      name: user.full_name,
      member_since: user.created_at?.slice(0, 10) ?? null,
      level: enrollment?.current_level ?? 1,
      modules_completed_total: progress?.total ?? 0,
      last_module_completed:
        progress?.last_title && progress.last_at ? { title: progress.last_title, at: progress.last_at.slice(0, 10) } : null,
      levels_passed: levelsPassed.map((r) => r.level_number),
      quiz_recent_avg: quiz?.avg ? Number(quiz.avg) : null,
      scores: {
        overall: s.overall.score,
        band: s.overall.band,
        trend_delta: s.trend.delta,
        habits: s.habits.score,
        curriculum: s.curriculum.score,
        attendance: s.attendance.score,
        word: s.word.score,
        prayer: s.prayer.score,
      },
      active_days_28: rhythm?.active_days ?? 0,
      checkins_28: rhythm?.checkins ?? 0,
      prayer: {
        entries_28: prayer?.entries_28 ?? 0,
        answered_28: prayer?.answered_28 ?? 0,
        answered_total: prayer?.answered_total ?? 0,
      },
      reflections_recent: reflections,
      talk_posts_28: talk?.n ?? 0,
    };
    return { facts, optOut: user.ai_opt_out };
  }

  /** Rebuild one member's story (facts always; narrative only when consented). */
  async rebuildFor(userId: string): Promise<MemberStoryRow | null> {
    const built = await this.buildFacts(userId);
    if (!built) return null;
    let narrative = "";
    if (!built.optOut) {
      try {
        narrative = await this.provider.complete({
          system: STORY_NARRATIVE_SYSTEM,
          messages: [{ role: "user", text: JSON.stringify(built.facts) }],
          tier: "fast",
          maxTokens: 260,
          feature: "story_narrative",
        });
      } catch {
        narrative = ""; // the nightly batch must never die on one member
      }
    }
    await this.pool.query(
      `INSERT INTO member_story (user_id, facts, narrative, built_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id) DO UPDATE SET facts = $2, narrative = $3, built_at = now()`,
      [userId, JSON.stringify(built.facts), narrative],
    );
    return this.get(userId);
  }

  /** Nightly batch: everyone active in the last 60 days, plus enrolled members
   *  who have no story yet. Sequential on purpose (gentle on the provider). */
  async rebuildAll(limit = 500): Promise<{ rebuilt: number }> {
    const users = await many<{ user_id: string }>(
      this.pool,
      `SELECT DISTINCT u.user_id FROM users u
        WHERE EXISTS (SELECT 1 FROM interaction_events ie
                       WHERE ie.user_id = u.user_id AND ie.occurred_at >= now() - interval '60 days')
           OR (EXISTS (SELECT 1 FROM enrollments e WHERE e.user_id = u.user_id)
               AND NOT EXISTS (SELECT 1 FROM member_story ms WHERE ms.user_id = u.user_id))
        LIMIT $1`,
      [limit],
    );
    let rebuilt = 0;
    for (const u of users) {
      try {
        await this.rebuildFor(u.user_id);
        rebuilt++;
      } catch {
        /* keep going */
      }
    }
    return { rebuilt };
  }

  /** Compact grounding for the companion — null when opted out (no personalization). */
  async forCompanion(userId: string): Promise<{ narrative: string; factsLine: string } | null> {
    const optOut = await maybeOne<{ ai_opt_out: boolean }>(
      this.pool,
      `SELECT ai_opt_out FROM users WHERE user_id = $1`,
      [userId],
    );
    if (!optOut || optOut.ai_opt_out) return null;
    const row = await this.get(userId);
    if (!row) return null;
    const f = row.facts;
    const trend = f.scores.trend_delta > 0 ? `up ${f.scores.trend_delta}` : f.scores.trend_delta < 0 ? `down ${Math.abs(f.scores.trend_delta)}` : "steady";
    const factsLine =
      `${f.name.split(" ")[0]} · Level ${f.level} · growth ${f.scores.overall}/100 (${trend} vs last 28d) · ` +
      `${f.active_days_28} active days/28 · ${f.prayer.answered_total} answered prayers recorded`;
    return { narrative: row.narrative, factsLine };
  }
}
