// The liturgy, addressed to ONE person — composed, not templated (owner's
// asks, 2026-08-24: "make the liturgy smart and custom", then "do not quote
// any prayer — be inspired and write something beautiful", then "one
// statement, bible verse and an explanation… brief, combining all wisdom").
//
// The card is ONE thought in three parts:
//   statement  — one sentence spoken to the member, shaped by what they carry
//   verse      — one Scripture chosen for that moment (exact text, from a
//                server-authoritative menu — the model never invents text)
//   explanation— one sentence landing the verse in their walk
//
// The member's own written words (prayer titles, bodies) are INSPIRATION and
// are never echoed back — being known, not being read aloud to.
//
// Composition happens at most once per (member, day, part) and is cached in
// personal_liturgies, so the word is stable for the whole window (a liturgy
// must not flicker between opens). Provider failures fall back to quote-free
// authored lines — and the fallback is cached too: stable beats fancy.
//
// Wire-compatible: rides the existing line/charge/verse_line fields
// (statement → line, explanation → charge), so every installed build renders
// it with no client change. Empty-handed members keep the communal liturgy.
import type pg from "pg";
import { maybeOne } from "../../db/db.js";
import type { AiProvider } from "../assistant/provider.js";
import { PERSONAL_LITURGY_SYSTEM } from "./prompts.js";
import type { DayBand, LiturgyPart, BandVerseLine } from "./liturgy.js";

export interface PersonalTouch {
  statement: string;
  charge: string; // the explanation — rides the wire's `charge` field
  verse_line: BandVerseLine;
}

type SignalKind = "prayer" | "plan" | "module";

interface Signal {
  kind: SignalKind;
  /** Context for the composer / fallback phrasing — never quoted to the member. */
  detail: Record<string, unknown>;
}

interface Walk {
  signals: Signal[];
  streak: { current: number; status: string } | null;
}

/** The verse menu — server-authoritative text; the model only picks a ref. */
const VERSE_MENU: readonly BandVerseLine[] = [
  { reference: "Philippians 4:6", text: "Do not be anxious about anything, but in everything by prayer and supplication with thanksgiving let your requests be made known to God." },
  { reference: "1 Peter 5:7", text: "Cast all your anxieties on him, because he cares for you." },
  { reference: "Psalm 34:17", text: "The righteous cry, and the LORD hears, and delivers them out of all their troubles." },
  { reference: "Isaiah 65:24", text: "Before they call, I will answer; and while they are yet speaking, I will hear." },
  { reference: "Psalm 119:105", text: "Your word is a lamp to my feet and a light to my path." },
  { reference: "Joshua 1:8", text: "This Book of the Law shall not depart from your mouth, but you shall meditate on it day and night." },
  { reference: "Psalm 1:2-3", text: "His delight is in the law of the LORD; he will be like a tree planted by the streams of water, that produces its fruit in its season." },
  { reference: "2 Timothy 2:15", text: "Do your best to present yourself to God as one approved, a worker who has no need to be ashamed." },
  { reference: "Proverbs 4:18", text: "The path of the righteous is like the light of dawn, which shines brighter and brighter until full day." },
  { reference: "Philippians 1:6", text: "He who began a good work in you will complete it until the day of Jesus Christ." },
  { reference: "Galatians 6:9", text: "Let's not be weary in doing good, for we will reap in due season if we don't give up." },
  { reference: "Psalm 46:10", text: "Be still, and know that I am God." },
];

const menuByRef = new Map(VERSE_MENU.map((v) => [v.reference.toLowerCase(), v]));

/** FNV-ish stable hash — deterministic per member per day. */
function stableHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Everything the member is carrying, gathered in small reads: the most recent
 * open prayer (theme only — never echoed), the plan mid-walk, the first
 * unfinished module of their level, and their gathering faithfulness.
 */
async function gatherWalk(pool: pg.Pool, userId: string): Promise<Walk> {
  const signals: Signal[] = [];

  const prayer = await maybeOne<{ title: string }>(
    pool,
    `SELECT title FROM prayer_entries
      WHERE user_id = $1 AND NOT is_answered AND length(btrim(title)) > 0
      ORDER BY updated_at DESC LIMIT 1`,
    [userId],
  );
  if (prayer) signals.push({ kind: "prayer", detail: { open_prayer_theme: prayer.title.slice(0, 120) } });

  const plan = await maybeOne<{ title: string; current_day: number }>(
    pool,
    `SELECT p.title, pr.current_day
       FROM reading_plan_progress pr
       JOIN reading_plans p USING (plan_id)
      WHERE pr.user_id = $1 AND pr.completed_at IS NULL
      ORDER BY pr.updated_at DESC LIMIT 1`,
    [userId],
  );
  if (plan) signals.push({ kind: "plan", detail: { reading_plan: plan.title, day: plan.current_day } });

  const module = await maybeOne<{ title: string }>(
    pool,
    `SELECT m.title
       FROM enrollments e
       JOIN modules m ON m.level_number = e.current_level
       LEFT JOIN module_progress mp
         ON mp.enrollment_id = e.enrollment_id AND mp.module_id = m.module_id AND mp.is_completed
      WHERE e.user_id = $1 AND e.state = 'active' AND mp.progress_id IS NULL
      ORDER BY m.module_sequence_number ASC LIMIT 1`,
    [userId],
  );
  if (module) signals.push({ kind: "module", detail: { unfinished_lesson: module.title } });

  const streak = await maybeOne<{ current_streak: number; status: string }>(
    pool,
    `SELECT current_streak, status FROM service_attendance_streaks WHERE user_id = $1`,
    [userId],
  );

  return {
    signals,
    streak: streak && streak.current_streak > 0 ? { current: streak.current_streak, status: streak.status } : null,
  };
}

// ---------- Quote-free authored fallback (also the offline voice) ----------

function fallbackTriple(part: LiturgyPart, walk: Walk, seed: number): { statement: string; explanation: string; verses: readonly BandVerseLine[] } {
  const signal = walk.signals[seed % walk.signals.length]!;
  switch (signal.kind) {
    case "prayer": {
      const statement = {
        morning: "You did not walk into this morning alone — what you asked of Him went ahead of you.",
        midday: "The prayer you left with Him this morning is still being worked on.",
        evening: "The day is closing; what you asked of Him is not.",
        night: "What you laid before Him is safe with Him tonight — you can sleep.",
      }[part];
      const explanation = {
        morning: "He heard you the first time; walk today like the answer is already on its way.",
        midday: "Nothing you have handed to God is waiting in a queue — He is working while you work.",
        evening: "Prayers do not expire at sunset; He keeps what you gave Him through the night.",
        night: "The One who keeps your request does not sleep, so you may.",
      }[part];
      return { statement, explanation, verses: [VERSE_MENU[0]!, VERSE_MENU[1]!, VERSE_MENU[2]!, VERSE_MENU[3]!] };
    }
    case "plan": {
      const statement = {
        morning: "There is a page waiting for you today — let the Word speak before the world does.",
        midday: "A few quiet verses now would steady everything the afternoon brings.",
        evening: "End the day the way days are meant to end — inside the Word.",
        night: "One quiet page before sleep settles the heart better than the last scroll.",
      }[part];
      const explanation = {
        morning: "The Word you keep returning to is quietly building a path under your feet.",
        midday: "Scripture read in the middle of the day is light exactly where the road bends.",
        evening: "What you read tonight goes to bed with you and rises with you.",
        night: "A heart that closes the day on Scripture wakes already pointed home.",
      }[part];
      return { statement, explanation, verses: [VERSE_MENU[4]!, VERSE_MENU[5]!, VERSE_MENU[6]!] };
    }
    default: {
      const statement = {
        morning: "There is a step on your pathway with your name on it — take it this morning.",
        midday: "Growth is minutes, not seasons — there is still time in this day.",
        evening: "This evening could leave you one step further than it found you.",
        night: "Set tomorrow's step in your heart tonight, and sleep on good ground.",
      }[part];
      const explanation = {
        morning: "The lesson you finish today becomes the strength you stand on tomorrow.",
        midday: "Faithfulness in a small hour of learning is how a disciple is quietly made.",
        evening: "He is not rushing you — but He is still building you, one step at a time.",
        night: "What you set in your heart before sleep is waiting for you at sunrise.",
      }[part];
      return { statement, explanation, verses: [VERSE_MENU[7]!, VERSE_MENU[8]!, VERSE_MENU[9]!] };
    }
  }
}

// ------------------------------ Composition ------------------------------

interface ComposedRow {
  statement: string;
  verse_ref: string;
  verse_text: string;
  explanation: string;
}

async function readCache(pool: pg.Pool, userId: string, dayKey: string, part: LiturgyPart): Promise<ComposedRow | null> {
  return maybeOne<ComposedRow>(
    pool,
    `SELECT statement, verse_ref, verse_text, explanation
       FROM personal_liturgies WHERE user_id = $1 AND day_date = $2 AND part = $3`,
    [userId, dayKey, part],
  );
}

async function writeCache(pool: pg.Pool, userId: string, dayKey: string, part: LiturgyPart, row: ComposedRow): Promise<void> {
  await pool.query(
    `INSERT INTO personal_liturgies (user_id, day_date, part, statement, verse_ref, verse_text, explanation)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, day_date, part) DO NOTHING`,
    [userId, dayKey, part, row.statement, row.verse_ref, row.verse_text, row.explanation],
  );
}

/** One sentence, sane length, and none of the member's own words leaked. */
function acceptable(s: string, min: number, max: number, forbidden: string[]): boolean {
  const words = s.trim().split(/\s+/).length;
  if (words < min || words > max + 8) return false;
  const low = s.toLowerCase();
  return !forbidden.some((f) => f.length >= 6 && low.includes(f.toLowerCase()));
}

async function compose(
  provider: AiProvider,
  pool: pg.Pool,
  userId: string,
  part: LiturgyPart,
  dayKey: string,
  season: string,
  walk: Walk,
): Promise<ComposedRow> {
  const seed = stableHash(`${userId}:${dayKey}`);
  // The member's raw words — the composer sees them as context; the output
  // must not contain them. Checked, not trusted.
  const forbidden = walk.signals
    .map((s) => String(s.detail.open_prayer_theme ?? ""))
    .filter((t) => t.length > 0);
  try {
    const raw = await provider.complete({
      system: PERSONAL_LITURGY_SYSTEM,
      messages: [{
        role: "user",
        text: JSON.stringify({
          part,
          season,
          walk: {
            carrying: walk.signals.map((s) => s.detail),
            gathering_faithfulness: walk.streak,
          },
          verses: VERSE_MENU,
        }),
      }],
      tier: "standard",
      effort: "low", // interactive path — first fetch of a part waits on this
      feature: "personal_liturgy",
    });
    const parsed = JSON.parse(raw.trim().replace(/^```json?\s*|\s*```$/g, "")) as {
      statement?: string;
      verse_ref?: string;
      explanation?: string;
    };
    const verse = menuByRef.get(String(parsed.verse_ref ?? "").toLowerCase());
    const statement = String(parsed.statement ?? "").trim();
    const explanation = String(parsed.explanation ?? "").trim();
    if (
      verse &&
      acceptable(statement, 6, 20, forbidden) &&
      acceptable(explanation, 8, 24, forbidden)
    ) {
      return { statement, verse_ref: verse.reference, verse_text: verse.text, explanation };
    }
  } catch {
    /* fall through to the authored fallback */
  }
  const fb = fallbackTriple(part, walk, seed);
  const verse = fb.verses[seed % fb.verses.length]!;
  return { statement: fb.statement, verse_ref: verse.reference, verse_text: verse.text, explanation: fb.explanation };
}

/**
 * The member's personal card for this part of the day — statement + verse +
 * explanation — or null when they carry nothing (the communal liturgy then
 * stands, exactly as before).
 */
export async function personalTouch(
  pool: pg.Pool,
  provider: AiProvider,
  userId: string,
  part: LiturgyPart,
  band: DayBand,
  dayKey: string,
): Promise<PersonalTouch | null> {
  void band;
  const walk = await gatherWalk(pool, userId);
  if (walk.signals.length === 0) return null;

  let row = await readCache(pool, userId, dayKey, part);
  if (!row) {
    const season = "ordinary"; // season colour is the communal line's job; the personal word stays personal
    row = await compose(provider, pool, userId, part, dayKey, season, walk);
    await writeCache(pool, userId, dayKey, part, row);
    // Two concurrent first-fetches may race; the cache row, not the local
    // value, is the day's truth — re-read so both callers speak one word.
    row = (await readCache(pool, userId, dayKey, part)) ?? row;
  }
  return {
    statement: row.statement,
    charge: row.explanation,
    verse_line: { reference: row.verse_ref, text: row.verse_text },
  };
}
