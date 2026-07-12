// Wave 1 of companion presence — ECHOES: the app remembers you.
// One moment per member per day, chosen by fixed priority from the member's
// OWN history. Deliberately AI-free: their reflection words are quoted back
// verbatim, returns are met with grace, anniversaries are counted from real
// completions. The craft rules live here in code: specificity or silence
// (no generic praise), one echo per day (PK user+day), and nothing echoes
// twice (kind+ref checked against the full log).
import type { Pool } from "pg";
import { maybeOne } from "../../db/db.js";

export type EchoKind = "welcome_back" | "reflection_echo" | "anniversary";

export interface Echo {
  kind: EchoKind;
  body: string;
  quote: string | null;
  ref: string | null;
}

/** The EAT (UTC+3, no DST) calendar date of `now`, as YYYY-MM-DD. */
function eatDay(now: Date = new Date()): string {
  return new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}

/** Trim a member's reflection to a quotable length on a word boundary. */
function quotable(body: string, max = 220): string {
  const t = body.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const atWord = cut.slice(0, cut.lastIndexOf(" "));
  return `${atWord}…`;
}

export class EchoesService {
  constructor(private readonly pool: Pool) {}

  /** Today's echo for this member — computed once per EAT day, then stable. */
  async today(userId: string, now: Date = new Date()): Promise<Echo | null> {
    const day = eatDay(now);
    const logged = await maybeOne<Echo & { kind: EchoKind }>(
      this.pool,
      `SELECT kind, body, quote, ref FROM echo_log WHERE user_id = $1 AND day_date = $2`,
      [userId, day],
    );
    if (logged) return logged;

    const chosen =
      (await this.welcomeBack(userId, day)) ??
      (await this.reflectionEcho(userId)) ??
      (await this.anniversary(userId));
    if (!chosen) return null;

    // First write wins — a concurrent request simply reads the logged row.
    await this.pool.query(
      `INSERT INTO echo_log (user_id, day_date, kind, ref_id, body, quote, ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, day_date) DO NOTHING`,
      [userId, day, chosen.kind, chosen.refId, chosen.body, chosen.quote, chosen.ref],
    );
    return { kind: chosen.kind, body: chosen.body, quote: chosen.quote, ref: chosen.ref };
  }

  /** Grace-first re-entry: ≥4 quiet days, and we haven't welcomed this return. */
  private async welcomeBack(userId: string, day: string) {
    const row = await maybeOne<{ gap_days: number | null; recently_welcomed: boolean }>(
      this.pool,
      `SELECT
         (($2::date) - max(me.updated_at AT TIME ZONE 'Africa/Nairobi')::date)::int AS gap_days,
         EXISTS (
           SELECT 1 FROM echo_log el
            WHERE el.user_id = $1 AND el.kind = 'welcome_back'
              AND el.day_date > ($2::date - 7)
         ) AS recently_welcomed
       FROM module_engagement me
       WHERE me.user_id = $1 AND me.updated_at < ($2::date)::timestamptz - interval '3 hours'`,
      [userId, day],
    );
    if (!row || row.gap_days === null || row.gap_days < 4 || row.recently_welcomed) return null;
    return {
      kind: "welcome_back" as const,
      refId: null,
      body: "You're back. That's what matters — not the days in between.",
      quote: "He does not treat us as our sins deserve… as far as the east is from the west, so far has he removed our transgressions from us.",
      ref: "Psalm 103:10–12",
    };
  }

  /** Their own words, 6–10 days later — each reflection echoes at most once. */
  private async reflectionEcho(userId: string) {
    const r = await maybeOne<{ reflection_id: string; body: string; days_ago: number; title: string }>(
      this.pool,
      `SELECT mr.reflection_id, mr.body,
              (now()::date - mr.submitted_at::date)::int AS days_ago,
              m.title
         FROM module_reflections mr
         JOIN modules m ON m.module_id = mr.module_id
        WHERE mr.user_id = $1
          AND mr.submitted_at BETWEEN now() - interval '10 days' AND now() - interval '6 days'
          AND length(trim(mr.body)) >= 40
          AND NOT EXISTS (
            SELECT 1 FROM echo_log el
             WHERE el.user_id = $1 AND el.kind = 'reflection_echo' AND el.ref_id = mr.reflection_id
          )
        ORDER BY mr.submitted_at DESC
        LIMIT 1`,
      [userId],
    );
    if (!r) return null;
    const days = r.days_ago === 7 ? "Seven days" : `${r.days_ago} days`;
    return {
      kind: "reflection_echo" as const,
      refId: r.reflection_id,
      body: `${days} ago, after "${r.title}", you wrote this. Is the Spirit still asking it of you?`,
      quote: quotable(r.body),
      ref: null,
    };
  }

  /** One month to the day since a module was finished — counted, not guessed. */
  private async anniversary(userId: string) {
    const a = await maybeOne<{ module_id: string; title: string }>(
      this.pool,
      `SELECT mp.module_id, m.title
         FROM module_progress mp
         JOIN enrollments e ON e.enrollment_id = mp.enrollment_id
         JOIN modules m ON m.module_id = mp.module_id
        WHERE e.user_id = $1 AND mp.is_completed
          AND mp.completed_at::date = now()::date - 30
          AND NOT EXISTS (
            SELECT 1 FROM echo_log el
             WHERE el.user_id = $1 AND el.kind = 'anniversary' AND el.ref_id = mp.module_id
          )
        ORDER BY mp.completed_at DESC
        LIMIT 1`,
      [userId],
    );
    if (!a) return null;
    return {
      kind: "anniversary" as const,
      refId: a.module_id,
      body: `One month ago today you finished "${a.title}." Look how far you've walked.`,
      quote: null,
      ref: null,
    };
  }
}
