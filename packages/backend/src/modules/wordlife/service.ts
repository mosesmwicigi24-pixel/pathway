// Per-member "Word & Reading life" — how a single member READS and PRACTISES the
// Word, for the admin Member Profile (§5.4: leader-facing, scoped). This is the
// per-person face of the Word pillar: it reuses the server-authoritative Word
// score (ScoresService.word) as the headline, then adds memorization depth,
// reading cadence, a 30-day Scripture rhythm, quiz comprehension, and a single
// coaching insight (the "reader vs. practiser" split a leader can act on).
//
// PRIVACY: this surfaces reading / memorization / quiz only. Prayer is pastoral-
// private (§5.4) and is intentionally NOT included in any per-member view.
import type { Pool } from "pg";
import { one, maybeOne } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { ScoresService } from "../scores/service.js";

const TZ = "Africa/Nairobi"; // EAT day boundary, matches the rhythm engine

export interface MemberWordLife {
  user_id: string;
  generated_at: string;
  word_score: { score: number; band: string; components: Record<string, number> };
  memorization: {
    verses_engaged: number;
    verses_mastered: number;
    verses_learning: number;
    avg_match_pct: number;
    last_practiced_at: string | null;
  };
  reading: {
    plans_active: number;
    plans_completed: number;
    days_read: number;
    last_read_at: string | null;
  };
  rhythm: { word_days_30: number; word_events_30: number; last_word_at: string | null };
  quiz: { attempts: number; passed: number; avg_score: number };
  insight: { profile: string; headline: string };
}

export class WordLifeService {
  private readonly scores: ScoresService;
  constructor(private readonly pool: Pool) {
    this.scores = new ScoresService(pool);
  }

  async memberWordLife(userId: string): Promise<MemberWordLife> {
    // Same existence semantics as the Member Profile aggregate (memberDetail):
    // real, non-deleted Students only — otherwise 404 (matches the documented contract).
    const exists = await maybeOne<{ ok: number }>(
      this.pool,
      `SELECT 1 AS ok FROM users WHERE user_id = $1 AND role = 'Student' AND deleted_at IS NULL`,
      [userId],
    );
    if (!exists) throw new ApiError("NOT_FOUND", "Member not found");

    const word = await this.scores.word(userId);

    const mem = await one<{
      engaged: number;
      mastered: number;
      learning: number;
      avg_match: number;
      last_practiced: string | null;
    }>(
      this.pool,
      `SELECT count(*)::int AS engaged,
              count(*) FILTER (WHERE status = 'mastered')::int AS mastered,
              count(*) FILTER (WHERE status = 'learning')::int AS learning,
              COALESCE(round(avg(best_match_pct)), 0)::int AS avg_match,
              max(updated_at) AS last_practiced
         FROM memory_verse_progress WHERE user_id = $1`,
      [userId],
    );

    const read = await one<{
      active: number;
      completed: number;
      days_read: number;
      last_read: string | null;
    }>(
      this.pool,
      `SELECT count(*) FILTER (WHERE completed_at IS NULL)::int     AS active,
              count(*) FILTER (WHERE completed_at IS NOT NULL)::int AS completed,
              COALESCE(sum(cardinality(completed_days)), 0)::int    AS days_read,
              max(updated_at) AS last_read
         FROM reading_plan_progress WHERE user_id = $1`,
      [userId],
    );

    const rhythm = await one<{ word_days_30: number; word_events_30: number; last_word: string | null }>(
      this.pool,
      `SELECT
          (SELECT count(DISTINCT (occurred_at AT TIME ZONE $2)::date)
             FROM interaction_events
            WHERE user_id = $1 AND kind IN ('word', 'scripture_read')
              AND occurred_at >= now() - interval '30 days')::int AS word_days_30,
          (SELECT count(*)
             FROM interaction_events
            WHERE user_id = $1 AND kind IN ('word', 'scripture_read')
              AND occurred_at >= now() - interval '30 days')::int AS word_events_30,
          (SELECT max(occurred_at)
             FROM interaction_events
            WHERE user_id = $1 AND kind IN ('word', 'scripture_read')) AS last_word`,
      [userId, TZ],
    );

    // quiz_attempts has no user_id — reach the member through module_progress → enrollment.
    const quiz = await one<{ attempts: number; passed: number; avg_score: number }>(
      this.pool,
      `SELECT count(*)::int AS attempts,
              count(*) FILTER (WHERE qa.is_passed)::int AS passed,
              COALESCE(round(avg(qa.score_achieved)), 0)::int AS avg_score
         FROM quiz_attempts qa
         JOIN module_progress mp ON mp.progress_id = qa.progress_id
         JOIN enrollments e ON e.enrollment_id = mp.enrollment_id
        WHERE e.user_id = $1`,
      [userId],
    );

    const insight = WordLifeService.insight({
      reads30: rhythm.word_days_30,
      mastered: mem.mastered,
      engaged: mem.engaged,
      reading: read.active + read.completed + read.days_read,
    });

    return {
      user_id: userId,
      generated_at: new Date().toISOString(),
      word_score: { score: word.score, band: word.band, components: word.components },
      memorization: {
        verses_engaged: mem.engaged,
        verses_mastered: mem.mastered,
        verses_learning: mem.learning,
        avg_match_pct: mem.avg_match,
        last_practiced_at: mem.last_practiced,
      },
      reading: {
        plans_active: read.active,
        plans_completed: read.completed,
        days_read: read.days_read,
        last_read_at: read.last_read,
      },
      rhythm: {
        word_days_30: rhythm.word_days_30,
        word_events_30: rhythm.word_events_30,
        last_word_at: rhythm.last_word,
      },
      quiz: { attempts: quiz.attempts, passed: quiz.passed, avg_score: quiz.avg_score },
      insight,
    };
  }

  /** The "reader vs. practiser" coaching cue — one explainable narrative a leader
   *  can act on. Pure function of the headline counts (testable, deterministic). */
  static insight(x: { reads30: number; mastered: number; engaged: number; reading: number }): {
    profile: string;
    headline: string;
  } {
    const readsRegularly = x.reads30 >= 4;
    const anyMemorizing = x.mastered > 0 || x.engaged > 0;
    if (x.reads30 === 0 && x.engaged === 0 && x.reading === 0) {
      return { profile: "dormant", headline: "No Scripture activity in the app recently — a gentle nudge to open the Word could help." };
    }
    if (readsRegularly && x.mastered === 0) {
      return { profile: "reader_not_memorizer", headline: "Engages the Word regularly but hasn't mastered a verse yet — encourage them to start memorizing." };
    }
    if (x.mastered > 0 && x.reads30 < 2) {
      return { profile: "memorizer_not_reader", headline: "Memorizing verses but rarely opening the Word day to day — nudge toward a daily reading rhythm." };
    }
    if (readsRegularly && x.mastered >= 1) {
      return { profile: "balanced", headline: "A steady Word rhythm with verses taking root — they're doing well here." };
    }
    if (anyMemorizing || x.reading > 0) {
      return { profile: "building", headline: "Early in their Word journey — keep the encouragement coming." };
    }
    return { profile: "building", headline: "Early in their Word journey — keep the encouragement coming." };
  }
}
