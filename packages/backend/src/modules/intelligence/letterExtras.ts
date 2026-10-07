// The Sunday Letter, v3 (owner, 2026-10-07: "a better Sunday Letter… images…
// a good report like a nice template from Pages"; the editorial design chosen
// on the canvas). Everything here is DERIVED, never written by the model:
//
//  - the photograph: from the eye-checked nature library (nature.ts), chosen
//    by the letter's theme and the week's weather season, deterministic per
//    letter. The bundled geometry art stays the clients' fallback, so the
//    original promise holds: nothing unvetted can ever appear on a letter.
//  - the figures: true counts of the member's own week (lessons finished,
//    days in the Word, reflections, prayers answered, gatherings attended).
//  - the scripture text: looked up in the church's own daily-verse library,
//    never typed by the model.
//  - the issue number and reading time.
//
// New letters freeze photo, figures and scripture text into the `highlights`
// JSON at compose time, so the archive stays a true snapshot of that week;
// older letters derive them on read the same way.
import type { Pool } from "pg";
import { many, maybeOne } from "../../db/db.js";
import { NATURE, photoUrl, weatherOf, type NaturePhoto } from "./nature.js";
import type { LetterTheme } from "./prompts.js";

export interface LetterPhoto {
  id: string;
  url: string;
  alt: string;
  caption: string;
}
export interface LetterFigure {
  value: string;
  label: string;
}
export interface LetterScripture {
  ref: string;
  text: string | null;
  version: string | null;
}

/** Who signs the letter (owner, 2026-10-07: "Pastor Moses, handwritten"). */
export const LETTER_SIGNED_BY = { name: "Pastor Moses", role: "Nuru Place" } as const;

/** What each theme's photograph says about the week, for its caption. */
const THEME_PHRASE: Record<LetterTheme, string> = {
  dawn: "a week of new beginnings",
  water: "a week of being refreshed",
  path: "a week of walking on",
  harvest: "a week of fruit",
  shelter: "a week of being held",
  light: "a week of light breaking through",
  seed: "a week of small beginnings",
  garden: "a week of quiet growth",
  mountain: "a week of steady strength",
  rest: "a week of rest",
};

const has = (p: NaturePhoto, motif: string): boolean => (p.motifs ?? []).includes(motif);
const at = (p: NaturePhoto, ...hours: string[]): boolean => p.hours.some((h) => hours.includes(h));

/** Which photographs fit each theme. Daylight first: a letter is opened on a
 *  phone at any hour, and its hero should read as an image, not a dark box. */
const THEME_FITS: Record<LetterTheme, (p: NaturePhoto) => boolean> = {
  dawn: (p) => at(p, "sunrise", "predawn"),
  water: (p) => has(p, "water") && at(p, "morning", "midday", "afternoon", "golden", "sunset"),
  path: (p) => has(p, "path"),
  harvest: (p) => has(p, "field") && at(p, "golden", "afternoon"),
  shelter: (p) => has(p, "rest") && !at(p, "deepnight"),
  light: (p) => has(p, "light") && at(p, "sunrise", "morning", "golden"),
  seed: (p) => has(p, "field") && at(p, "sunrise", "morning", "midday"),
  garden: (p) => (p.church ?? []).includes("easter") || (has(p, "field") && at(p, "morning", "midday")),
  mountain: (p) => has(p, "mountain") && at(p, "sunrise", "morning", "midday", "afternoon", "golden"),
  rest: (p) => has(p, "rest") || (has(p, "water") && at(p, "sunset", "nightfall")),
};

function stableHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Noon EAT on the letter's Sunday — the day whose season the photo keeps. */
function sundayNoon(weekOf: string): Date {
  return new Date(`${weekOf}T12:00:00+03:00`);
}

/** The letter's photograph: fits its theme and the week's weather season,
 *  deterministic per letter. `photoId` (frozen at compose time) wins. */
export function photoForLetter(letterId: string, theme: LetterTheme, weekOf: string, photoId?: string | null): LetterPhoto | null {
  const weather = weatherOf(sundayNoon(weekOf));
  const frozen = photoId ? NATURE.find((p) => p.id === photoId) : undefined;
  let photo = frozen;
  if (!photo) {
    const inSeason = NATURE.filter((p) => !p.weather || p.weather === weather);
    let pool = inSeason.filter(THEME_FITS[theme]).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (pool.length === 0) pool = inSeason.filter((p) => at(p, "sunrise")).sort((a, b) => (a.id < b.id ? -1 : 1));
    if (pool.length === 0) return null;
    photo = pool[stableHash(letterId) % pool.length]!;
  }
  return { id: photo.id, url: photoUrl(photo.id), alt: photo.alt, caption: `${photo.alt}. Chosen for ${THEME_PHRASE[theme]}.` };
}

/** The letter's week in EAT: the seven days ending on its Sunday. */
export function weekWindow(weekOf: string): { from: string; to: string } {
  const sundayStart = new Date(`${weekOf}T00:00:00+03:00`);
  const from = new Date(sundayStart.getTime() - 6 * 86_400_000);
  const to = new Date(sundayStart.getTime() + 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** True counts of the member's week, most telling first, at most three, and
 *  never a zero (a quiet week shows fewer figures rather than "0"). */
export async function letterFigures(pool: Pool, userId: string, weekOf: string): Promise<LetterFigure[]> {
  const { from, to } = weekWindow(weekOf);
  const r = await maybeOne<{ lessons: number; days: number; reflections: number; answered: number; gatherings: number }>(
    pool,
    `SELECT
       (SELECT count(*)::int FROM module_progress mp JOIN enrollments e ON e.enrollment_id = mp.enrollment_id
         WHERE e.user_id = $1 AND mp.is_completed AND mp.completed_at >= $2 AND mp.completed_at < $3) AS lessons,
       (SELECT count(DISTINCT (sp.completed_at AT TIME ZONE 'Africa/Nairobi')::date)::int FROM reading_plan_segment_progress sp
         WHERE sp.user_id = $1 AND sp.completed_at >= $2 AND sp.completed_at < $3) AS days,
       (SELECT count(*)::int FROM module_reflections mr
         WHERE mr.user_id = $1 AND mr.submitted_at >= $2 AND mr.submitted_at < $3) AS reflections,
       (SELECT count(*)::int FROM prayer_entries pe
         WHERE pe.user_id = $1 AND pe.is_answered AND pe.answered_at >= $2 AND pe.answered_at < $3) AS answered,
       (SELECT count(*)::int FROM attendance_logs al
         WHERE al.user_id = $1 AND al.checked_in_at >= $2 AND al.checked_in_at < $3) AS gatherings`,
    [userId, from, to],
  );
  if (!r) return [];
  const out: LetterFigure[] = [];
  if (r.lessons > 0) out.push({ value: String(r.lessons), label: plural(r.lessons, "lesson finished", "lessons finished") });
  if (r.days > 0) out.push({ value: `${Math.min(r.days, 7)} of 7`, label: "days in the Word" });
  if (r.reflections > 0) out.push({ value: String(r.reflections), label: plural(r.reflections, "reflection written", "reflections written") });
  if (r.answered > 0) out.push({ value: String(r.answered), label: plural(r.answered, "prayer answered", "prayers answered") });
  if (r.gatherings > 0) out.push({ value: String(r.gatherings), label: plural(r.gatherings, "gathering attended", "gatherings attended") });
  return out.slice(0, 3);
}

/** The verse's own words, from the church's daily-verse library. */
export async function scriptureFor(pool: Pool, ref: string | null): Promise<LetterScripture | null> {
  if (!ref) return null;
  const hit = await maybeOne<{ verse_text: string | null; version: string | null }>(
    pool,
    `SELECT verse_text, version FROM daily_verses
      WHERE lower(regexp_replace(reference, '\\s+', ' ', 'g')) = lower(regexp_replace($1, '\\s+', ' ', 'g'))
        AND verse_text IS NOT NULL
      ORDER BY day_index LIMIT 1`,
    [ref.trim()],
  );
  return { ref: ref.trim(), text: hit?.verse_text ?? null, version: hit?.version ?? null };
}

/** References the model may choose from — so the verse always has its text.
 *  A stable sample per member and week, so letters vary. */
export async function scriptureChoices(pool: Pool, userId: string, weekOf: string, n = 40): Promise<string[]> {
  const rows = await many<{ reference: string }>(
    pool,
    `SELECT DISTINCT reference FROM daily_verses WHERE verse_text IS NOT NULL ORDER BY reference`,
  );
  const refs = rows.map((r) => r.reference);
  if (refs.length <= n) return refs;
  const start = stableHash(`${userId}:${weekOf}`) % refs.length;
  return Array.from({ length: n }, (_, i) => refs[(start + i * 7) % refs.length]!).filter((v, i, a) => a.indexOf(v) === i);
}

/** This letter's place in the member's series, counting from 1. */
export async function issueNo(pool: Pool, userId: string, weekOf: string): Promise<number> {
  const r = await maybeOne<{ n: number }>(
    pool,
    `SELECT count(*)::int AS n FROM pastoral_letters WHERE user_id = $1 AND week_of <= $2`,
    [userId, weekOf],
  );
  return Math.max(1, r?.n ?? 1);
}

/** The body as paragraphs (the model writes two, separated by a blank line). */
export function paragraphsOf(body: string): string[] {
  const parts = body.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
  return parts.length > 0 ? parts : [body.trim()];
}

/** Minutes to read, at an unhurried 180 words a minute; at least one. */
export function readingMinutes(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 180));
}
