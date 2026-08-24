// The liturgy, addressed to ONE person (owner's ask, 2026-08-24: "make the
// liturgy smart and custom for each person").
//
// The hour's LINE stays communal — it is the prayer of the whole church, and
// personalizing it would un-church it. What becomes personal is the CHARGE
// (the italic exhortation under the gold rule) and the companion VERSE: they
// now speak to what this member actually carries — the prayer still open in
// their journal, the reading plan waiting at day N, the pathway module left
// ajar. A member carrying nothing simply hears the church's own charge, as
// before; personalization only ever ADDS warmth, never replaces the liturgy.
//
// Wire-compatible by design: the composition rides the existing `charge` and
// `verse_line` fields, so every app build already in members' hands renders
// it with no client change at all.
//
// Choice is DAILY-STABLE per member (hash of user + day): the same signal all
// day — a liturgy should not flicker between fetches — and a different facet
// of their walk tomorrow.
import type pg from "pg";
import { maybeOne } from "../../db/db.js";
import type { DayBand, LiturgyPart, BandVerseLine } from "./liturgy.js";

export interface PersonalTouch {
  charge: string;
  verse_line: BandVerseLine;
}

type SignalKind = "prayer" | "plan" | "module";

interface Signal {
  kind: SignalKind;
  charge: string;
  verses: readonly BandVerseLine[];
}

/** Trim a member-written title to something a card can carry. */
function shortTopic(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  return t.length <= 44 ? t : t.slice(0, 41).trimEnd() + "…";
}

const PRAYER_VERSES: readonly BandVerseLine[] = [
  { text: "Do not be anxious about anything, but in everything by prayer and supplication with thanksgiving let your requests be made known to God.", reference: "Philippians 4:6" },
  { text: "Cast all your anxieties on him, because he cares for you.", reference: "1 Peter 5:7" },
];
const PLAN_VERSES: readonly BandVerseLine[] = [
  { text: "Your word is a lamp to my feet and a light to my path.", reference: "Psalm 119:105" },
  { text: "This Book of the Law shall not depart from your mouth, but you shall meditate on it day and night.", reference: "Joshua 1:8" },
];
const MODULE_VERSES: readonly BandVerseLine[] = [
  { text: "Do your best to present yourself to God as one approved, a worker who has no need to be ashamed.", reference: "2 Timothy 2:15" },
  { text: "The path of the righteous is like the light of dawn, which shines brighter and brighter until full day.", reference: "Proverbs 4:18" },
];

/** morning / midday / evening / night phrasings per signal. The voice matches
 *  the authored CHARGES: short, warm, imperative-adjacent, never saccharine. */
function prayerCharge(part: LiturgyPart, topic: string): string {
  switch (part) {
    case "morning": return `You laid “${topic}” before God — walk into the day like He heard you. He did.`;
    case "midday": return `Midday pause: “${topic}” is still before Him — and He is still working.`;
    case "evening": return `Before the day closes, remember “${topic}” — He does not forget what you gave Him.`;
    default: return `Sleep comes easier with “${topic}” in His hands — leave it there tonight.`;
  }
}
function planCharge(part: LiturgyPart, plan: string, day: number): string {
  switch (part) {
    case "morning": return `Day ${day} of ${plan} is waiting — read it before the world starts talking.`;
    case "midday": return `A page at midday steadies the afternoon — ${plan}, day ${day}, holds yours.`;
    case "evening": return `Day ${day} of ${plan} would end this day the way days should end — in the Word.`;
    default: return `One quiet page before sleep — ${plan}, day ${day}, is still open.`;
  }
}
function moduleCharge(part: LiturgyPart, module: string): string {
  switch (part) {
    case "morning": return `“${module}” is open on your pathway — one lesson this morning moves you forward.`;
    case "midday": return `There is still time today for “${module}” — growth is minutes, not seasons.`;
    case "evening": return `This evening has room for “${module}” — end the day a step further than it began.`;
    default: return `Tomorrow, “${module}” — set it in your heart before you sleep.`;
  }
}

/** FNV-ish stable hash — good enough to spread members across their signals. */
function stableHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Everything this member is carrying, gathered in three small reads:
 *  - the most recent UNANSWERED prayer from their journal (their own words,
 *    shown only to them — the title, which members keep short);
 *  - the most recently walked, unfinished reading plan and its current day;
 *  - the first unfinished module of their current level.
 */
async function gatherSignals(
  pool: pg.Pool,
  userId: string,
  part: LiturgyPart,
): Promise<Signal[]> {
  const signals: Signal[] = [];

  const prayer = await maybeOne<{ title: string }>(
    pool,
    `SELECT title FROM prayer_entries
      WHERE user_id = $1 AND NOT is_answered AND length(btrim(title)) > 0
      ORDER BY updated_at DESC LIMIT 1`,
    [userId],
  );
  if (prayer) {
    signals.push({ kind: "prayer", charge: prayerCharge(part, shortTopic(prayer.title)), verses: PRAYER_VERSES });
  }

  const plan = await maybeOne<{ title: string; current_day: number }>(
    pool,
    `SELECT p.title, pr.current_day
       FROM reading_plan_progress pr
       JOIN reading_plans p USING (plan_id)
      WHERE pr.user_id = $1 AND pr.completed_at IS NULL
      ORDER BY pr.updated_at DESC LIMIT 1`,
    [userId],
  );
  if (plan) {
    signals.push({ kind: "plan", charge: planCharge(part, plan.title, plan.current_day), verses: PLAN_VERSES });
  }

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
  if (module) {
    signals.push({ kind: "module", charge: moduleCharge(part, module.title), verses: MODULE_VERSES });
  }

  return signals;
}

/**
 * The member's personal charge + verse for this band, or null when they carry
 * no open signal (the communal charge then stands, exactly as before).
 */
export async function personalTouch(
  pool: pg.Pool,
  userId: string,
  part: LiturgyPart,
  band: DayBand,
  dayKey: string,
): Promise<PersonalTouch | null> {
  const signals = await gatherSignals(pool, userId, part);
  if (signals.length === 0) return null;
  const seed = stableHash(`${userId}:${dayKey}`);
  const signal = signals[seed % signals.length]!;
  // The verse rotates on a different stride than the signal, so two members
  // sharing a signal on the same day still don't read as photocopies.
  const verse = signal.verses[(seed + band.length) % signal.verses.length]!;
  return { charge: signal.charge, verse_line: verse };
}
