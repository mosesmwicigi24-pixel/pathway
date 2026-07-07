// Member growth scores (§1.8 extended). A small, server-authoritative (§1.1)
// scoring layer over the activity already captured in the DB. Every score is
// 0–100, blends CONSISTENCY (recent cadence) with DEPTH (quality), and is
// pastoral (formative, not a leaderboard).
//
// Everything is measured over a ROLLING 28-DAY WINDOW ending at an `asOf`
// instant (default: now). Because the window is relative to the request time it
// slides on its own — today looks back 28 days, tomorrow looks back 28 days
// shifted by one — so `all()` can also compute the SAME composite one window
// earlier (asOf − 28d) and hand back a growth trend (this 28 days vs the
// previous 28), the way a page-insights view shows "up/down vs last period".
import type { Pool } from "pg";
import { one, maybeOne } from "../../db/db.js";

const TZ = "Africa/Nairobi"; // EAT day boundary, matches the rhythm engine
const WINDOW = 28; // the rolling window, in days — one lunar-ish month
const DAY_TARGET = 20; // active days in the window that earn full "consistency"

/** Weighted composite of the five domain scores (owner's blend; sums to 1.0). */
function overallOf(habits: number, curriculum: number, attendance: number, word: number, prayer: number): number {
  return Math.round(0.25 * habits + 0.25 * curriculum + 0.2 * attendance + 0.15 * word + 0.15 * prayer);
}

export interface ScoreBreakdown {
  score: number; // 0–100 composite
  band: string; // pastoral label
  components: Record<string, number>; // each 0–100
  detail: Record<string, number>; // raw counts for transparency
}

export interface Breakdowns {
  overall: { score: number; band: string };
  habits: ScoreBreakdown;
  curriculum: ScoreBreakdown;
  attendance: ScoreBreakdown;
  word: ScoreBreakdown;
  prayer: ScoreBreakdown;
}

function band(score: number): string {
  if (score >= 80) return "Deeply rooted";
  if (score >= 60) return "Growing";
  if (score >= 35) return "Sprouting";
  return "Just beginning";
}

export class ScoresService {
  constructor(private readonly pool: Pool) {}

  /**
   * WORD score — "how is the Word taking root in you?"
   *   • consistency (0.45): distinct days in the window you engaged Scripture
   *     (a 'word' rhythm tick or a 'scripture_read' event); DAY_TARGET days = full.
   *   • memorization (0.40): half your mastery RATE, half your average best match %.
   *   • breadth (0.15): how many distinct verses you've engaged; 10 = full.
   * Consistency is windowed (drives the trend); depth is lifetime (stable).
   */
  async word(userId: string, asOf: Date = new Date()): Promise<ScoreBreakdown> {
    const row = await one<{
      attempted: number;
      mastered: number;
      avg_match: number;
      active_days: number;
    }>(
      this.pool,
      `WITH verse AS (
         SELECT count(*)::int AS attempted,
                count(*) FILTER (WHERE status = 'mastered')::int AS mastered,
                COALESCE(round(avg(best_match_pct)), 0)::int AS avg_match
           FROM memory_verse_progress
          WHERE user_id = $1
       ),
       days AS (
         SELECT count(DISTINCT (occurred_at AT TIME ZONE $2)::date)::int AS active_days
           FROM interaction_events
          WHERE user_id = $1
            AND kind IN ('word', 'scripture_read')
            AND occurred_at >= $3::timestamptz - make_interval(days => $4)
            AND occurred_at <  $3::timestamptz
       )
       SELECT v.attempted, v.mastered, v.avg_match, d.active_days
         FROM verse v, days d`,
      [userId, TZ, asOf, WINDOW],
    );

    const consistency = Math.min(100, Math.round((100 * row.active_days) / DAY_TARGET));
    const memorization =
      row.attempted === 0
        ? 0
        : Math.round(0.5 * ((100 * row.mastered) / row.attempted) + 0.5 * row.avg_match);
    const breadth = Math.min(100, Math.round((100 * row.attempted) / 10));
    const score = Math.round(0.45 * consistency + 0.4 * memorization + 0.15 * breadth);

    return {
      score,
      band: band(score),
      components: { consistency, memorization, breadth },
      detail: {
        verses_engaged: row.attempted,
        verses_mastered: row.mastered,
        avg_match_pct: row.avg_match,
        active_days: row.active_days,
        window_days: WINDOW,
      },
    };
  }

  /**
   * PRAYER score — "how is your prayer life?"
   *   • consistency (0.60): distinct days you prayed in the window; DAY_TARGET = full.
   *   • depth (0.40): breadth of your prayer life (entries) + share marked answered.
   * Private — never leaves the member.
   */
  async prayer(userId: string, asOf: Date = new Date()): Promise<ScoreBreakdown> {
    const row = await one<{ total: number; answered: number; prayer_days: number }>(
      this.pool,
      `WITH entries AS (
         SELECT count(*)::int AS total, count(*) FILTER (WHERE is_answered)::int AS answered
           FROM prayer_entries WHERE user_id = $1
       ),
       days AS (
         SELECT count(DISTINCT (occurred_at AT TIME ZONE $2)::date)::int AS prayer_days
           FROM interaction_events
          WHERE user_id = $1 AND kind = 'prayer'
            AND occurred_at >= $3::timestamptz - make_interval(days => $4)
            AND occurred_at <  $3::timestamptz
       )
       SELECT e.total, e.answered, d.prayer_days FROM entries e, days d`,
      [userId, TZ, asOf, WINDOW],
    );
    const consistency = Math.min(100, Math.round((100 * row.prayer_days) / DAY_TARGET));
    const depth =
      row.total === 0
        ? 0
        : Math.round(0.6 * Math.min(100, (100 * row.total) / 10) + 0.4 * ((100 * row.answered) / row.total));
    const score = Math.round(0.6 * consistency + 0.4 * depth);
    return {
      score,
      band: band(score),
      components: { consistency, depth },
      detail: { prayers_logged: row.total, answered: row.answered, prayer_days: row.prayer_days, window_days: WINDOW },
    };
  }

  /**
   * HABITS score — "how steady is your daily rhythm?" (prayer/word/reflection)
   *   • consistency (0.60): distinct days with ≥1 discipline in the window.
   *   • completeness (0.40): share of all possible discipline-ticks (3×WINDOW) hit.
   * Also surfaces this week's rhythm % (ticks / 21) for the weekly gauge.
   */
  async habits(userId: string, asOf: Date = new Date()): Promise<ScoreBreakdown> {
    const row = await one<{ active_days: number; ticks: number; ticks_7: number }>(
      this.pool,
      `SELECT count(DISTINCT (occurred_at AT TIME ZONE $2)::date)::int AS active_days,
              count(*)::int AS ticks,
              count(*) FILTER (WHERE occurred_at >= $3::timestamptz - interval '7 days')::int AS ticks_7
         FROM interaction_events
        WHERE user_id = $1 AND kind IN ('prayer', 'word', 'reflection')
          AND occurred_at >= $3::timestamptz - make_interval(days => $4)
          AND occurred_at <  $3::timestamptz`,
      [userId, TZ, asOf, WINDOW],
    );
    const consistency = Math.min(100, Math.round((100 * row.active_days) / DAY_TARGET));
    const completeness = Math.min(100, Math.round((100 * row.ticks) / (3 * WINDOW)));
    const score = Math.round(0.6 * consistency + 0.4 * completeness);
    return {
      score,
      band: band(score),
      components: { consistency, completeness },
      detail: {
        active_days: row.active_days,
        window_days: WINDOW,
        rhythm_week_pct: Math.min(100, Math.round((100 * row.ticks_7) / 21)),
      },
    };
  }

  /**
   * CURRICULUM score — "how is your learning going?"
   *   • completion (0.65): published modules completed AS OF the window end (so
   *     modules finished inside the window register as growth vs the prior window).
   *   • mastery (0.35): average score on passed quizzes taken as of the window end.
   */
  async curriculum(userId: string, asOf: Date = new Date()): Promise<ScoreBreakdown> {
    const row = await one<{ completed: number; published: number; avg_score: number; attempts: number }>(
      this.pool,
      `WITH cur AS (
         SELECT count(*) FILTER (
                  WHERE mp.is_completed AND (mp.completed_at IS NULL OR mp.completed_at < $2::timestamptz)
                )::int AS completed
           FROM enrollments e JOIN module_progress mp USING (enrollment_id)
          WHERE e.user_id = $1
       ),
       pub AS (SELECT GREATEST(count(*), 1)::int AS total FROM modules WHERE is_published),
       qz AS (
         SELECT COALESCE(round(avg(qa.score_achieved)), 0)::int AS avg_score, count(*)::int AS attempts
           FROM quiz_attempts qa
           JOIN module_progress mp ON mp.progress_id = qa.progress_id
           JOIN enrollments e ON e.enrollment_id = mp.enrollment_id
          WHERE e.user_id = $1 AND qa.is_passed AND qa.attempted_at < $2::timestamptz
       )
       SELECT cur.completed, pub.total AS published, qz.avg_score, qz.attempts FROM cur, pub, qz`,
      [userId, asOf],
    );
    const completion = Math.min(100, Math.round((100 * row.completed) / row.published));
    const mastery = row.attempts === 0 ? null : row.avg_score;
    const score = mastery === null ? completion : Math.round(0.65 * completion + 0.35 * mastery);
    return {
      score,
      band: band(score),
      components: mastery === null ? { completion } : { completion, mastery },
      detail: { modules_completed: row.completed, modules_published: row.published, quizzes_passed: row.attempts },
    };
  }

  /**
   * ATTENDANCE score — "are you showing up?" Credited by PRESENT DAYS in the
   * window: any day the member did something in the app (any interaction event,
   * which includes a real gathering check-in). Owner's call — app presence, so
   * the signal always has data and reflects how disciples gather today: in the
   * community app between Sundays, not only at physical events. DAY_TARGET days
   * present = full marks.
   */
  async attendance(userId: string, asOf: Date = new Date()): Promise<ScoreBreakdown> {
    const row = await one<{ present_days: number }>(
      this.pool,
      `SELECT count(DISTINCT (occurred_at AT TIME ZONE $2)::date)::int AS present_days
         FROM interaction_events
        WHERE user_id = $1
          AND occurred_at >= $3::timestamptz - make_interval(days => $4)
          AND occurred_at <  $3::timestamptz`,
      [userId, TZ, asOf, WINDOW],
    );
    const score = Math.min(100, Math.round((100 * row.present_days) / DAY_TARGET));
    return {
      score,
      band: band(score),
      components: { attendance: score },
      detail: { present_days: row.present_days, target: DAY_TARGET, window_days: WINDOW },
    };
  }

  /** The five domain scores + weighted overall, computed as of `asOf`. */
  async breakdownsAt(userId: string, asOf: Date): Promise<Breakdowns> {
    const [habits, curriculum, attendance, word, prayer] = await Promise.all([
      this.habits(userId, asOf),
      this.curriculum(userId, asOf),
      this.attendance(userId, asOf),
      this.word(userId, asOf),
      this.prayer(userId, asOf),
    ]);
    const overallScore = overallOf(habits.score, curriculum.score, attendance.score, word.score, prayer.score);
    return { overall: { score: overallScore, band: band(overallScore) }, habits, curriculum, attendance, word, prayer };
  }

  /**
   * Composite for Home — the five scores + weighted overall for the CURRENT
   * 28-day window, plus a `trend` comparing it to the PREVIOUS 28 days (the
   * rolling growth signal). One call, two windows, no stored history.
   */
  async all(userId: string): Promise<
    Breakdowns & {
      trend: {
        window_days: number;
        previous: number;
        delta: number;
        direction: "up" | "down" | "flat";
        domains: Record<string, number>;
      };
      // Index signature kept so the Home "weakest discipline" helpers can read
      // the composite generically (they iterate the domain keys).
      [k: string]: unknown;
    }
  > {
    const now = new Date();
    const prior = new Date(now.getTime() - WINDOW * 24 * 60 * 60 * 1000);
    const [cur, prev] = await Promise.all([this.breakdownsAt(userId, now), this.breakdownsAt(userId, prior)]);
    const delta = cur.overall.score - prev.overall.score;
    return {
      ...cur,
      trend: {
        window_days: WINDOW,
        previous: prev.overall.score,
        delta,
        direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
        domains: {
          habits: cur.habits.score - prev.habits.score,
          curriculum: cur.curriculum.score - prev.curriculum.score,
          attendance: cur.attendance.score - prev.attendance.score,
          word: cur.word.score - prev.word.score,
          prayer: cur.prayer.score - prev.prayer.score,
        },
      },
    };
  }

  /**
   * A LEVEL's mastery, out of 100 (owner's model):
   *   • exam (50): the member's best level-exam score % × 0.5.
   *   • modules (30): the average of the member's best quiz score in each
   *     published module of the level × 0.3.
   *   • participation (20): the member's overall growth score × 0.2 — the
   *     "other participation in the app" (habits/word/prayer/attendance blend).
   * The three are server-computed and only ever rendered by the clients.
   */
  async levelScore(
    userId: string,
    levelNumber: number,
  ): Promise<{
    level_number: number;
    total: number;
    band: string;
    exam: { score: number; of: number; raw_pct: number; passed: boolean };
    modules: { score: number; of: number; raw_pct: number };
    participation: { score: number; of: number; raw_pct: number };
  }> {
    const examRow = await maybeOne<{ best: string | null; passed: boolean | null }>(
      this.pool,
      `SELECT MAX(lea.score_achieved) AS best, bool_or(lea.is_passed) AS passed
         FROM level_exam_attempts lea
         JOIN enrollments e ON e.enrollment_id = lea.enrollment_id
        WHERE e.user_id = $1 AND lea.level_number = $2`,
      [userId, levelNumber],
    );
    const modRow = await maybeOne<{ avg_best: string | null }>(
      this.pool,
      `SELECT AVG(best_per_module) AS avg_best FROM (
         SELECT MAX(qa.score_achieved) AS best_per_module
           FROM quiz_attempts qa
           JOIN module_progress mp ON mp.progress_id = qa.progress_id
           JOIN enrollments e ON e.enrollment_id = mp.enrollment_id
           JOIN modules m ON m.module_id = mp.module_id
          WHERE e.user_id = $1 AND m.level_number = $2 AND m.is_published
          GROUP BY m.module_id
       ) t`,
      [userId, levelNumber],
    );
    const composite = await this.breakdownsAt(userId, new Date());

    const examPct = Math.max(0, Math.min(100, Number(examRow?.best ?? 0)));
    const modulesPct = Math.max(0, Math.min(100, Number(modRow?.avg_best ?? 0)));
    const participationPct = composite.overall.score;

    const exam50 = Math.round(examPct * 0.5);
    const modules30 = Math.round(modulesPct * 0.3);
    const participation20 = Math.round(participationPct * 0.2);
    const total = exam50 + modules30 + participation20;

    return {
      level_number: levelNumber,
      total,
      band: band(total),
      exam: { score: exam50, of: 50, raw_pct: Math.round(examPct), passed: examRow?.passed === true },
      modules: { score: modules30, of: 30, raw_pct: Math.round(modulesPct) },
      participation: { score: participation20, of: 20, raw_pct: participationPct },
    };
  }
}
