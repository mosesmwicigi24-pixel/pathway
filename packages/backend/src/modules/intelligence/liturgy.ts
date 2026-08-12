// Intelligence Phase 4 — the daily liturgy (v2: seven bands + a scripture
// spine + memory).
// Home breathes with the hours of the day: SEVEN short AI-composed prayer
// lines per congregation per day (sunrise / morning / midday / afternoon /
// evening / night / midnight), coloured by the church season. The SEASON and
// the CLOCK are deterministic code (computus below); AI only writes the
// words, once, shared by everyone (§1.1 — nothing here gates, scores or
// advances anything). If the model is down the member still gets a liturgy:
// a fixed fallback set (all seven bands) is served, and never cached, so the
// next compose attempt can replace it.
//
// v1 repeated because the composer had nothing to go on but the season and
// the date, and its lines were capped uniformly short. v2 fixes both:
//   - a SCRIPTURE SPINE (see spineFor() below) gives the model real, fresh
//     text to pray FROM every day, on a year-scale rotation;
//   - MEMORY (see LiturgyService.priorLines()) shows the model the last 14
//     days it actually wrote, with an explicit no-reuse/no-reword rule;
//   - composition now covers the full seven-band clock, not just four, and
//     each band has its own pastoral character and its own length (sunrise/
//     evening earn a fuller paragraph; midday/afternoon stay one breath).
// Four of the seven band names (morning/midday/evening/night) are literally
// the four legacy part values, so a client that only ever reads those four
// keeps working unchanged — the other three (sunrise/afternoon/midnight) are
// purely additive. See rowsToDay()/composeFor() for exactly how.
import type { Pool } from "pg";
import type { AiProvider } from "../assistant/provider.js";
import { LITURGY_SYSTEM } from "./prompts.js";

/** The legacy four-window clock label — kept ONLY for current().part, which
 *  existing clients read expecting exactly these four strings. Computed by
 *  the unchanged partOf() below; no longer used to key liturgy composition
 *  or storage (see DayBand). */
export type LiturgyPart = "morning" | "midday" | "evening" | "night";
export type Season = "advent" | "christmas" | "lent" | "easter" | "ordinary";

// Home breathes with SEVEN times of day. This is now BOTH the finer clock
// driving imagery/charge/verse-line AND the unit liturgy lines are composed
// and stored in (liturgies.part — see migration 187).
export type DayBand = "sunrise" | "morning" | "midday" | "afternoon" | "evening" | "night" | "midnight";

/** Every band, in clock order — the canonical iteration order for
 *  composition, parsing, storage, and the fallback set. */
export const BANDS: readonly DayBand[] = ["sunrise", "morning", "midday", "afternoon", "evening", "night", "midnight"];

export interface LiturgyLine {
  line: string;
  scripture: string | null;
}
export type LiturgyDay = Record<DayBand, LiturgyLine>;

// ======================= Liturgy art (the hour, beheld) =====================
// Home breathes with the hours, so the liturgy card carries a photograph of
// the hour itself: dawn light for morning, a wide bright sky for midday, a
// golden sunset for evening, a starfield for night. Curated + theme-matched
// (every URL verified live and visually reviewed), chosen deterministically
// per (part, EAT day) so the whole congregation sees the same tableau that
// day and it rotates day to day. Clients fall back to the navy card offline.

export interface LiturgyArt {
  url: string;
  alt: string;
}

const LU = (id: string): string => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1080&q=70`;

export const LITURGY_ART: Record<LiturgyPart, LiturgyArt[]> = {
  morning: [
    { url: LU("1444090542259-0af8fa96557e"), alt: "First light over the hills" },
    { url: LU("1484766280341-87861644c80d"), alt: "Dawn mist in the valley" },
    { url: LU("1498112943420-8eacc6e7cfc3"), alt: "Sunrise breaking the horizon" },
    { url: LU("1504252060324-1c76e2e09939"), alt: "Morning fog on the mountains" },
    { url: LU("1508108712903-49b7ef9b1df8"), alt: "The early sky" },
    { url: LU("1514241516423-6c0a5e031aa2"), alt: "A misty morning field" },
    { url: LU("1517835797465-ac2216c77362"), alt: "Daybreak over the ridge" },
    { url: LU("1519414442781-fbd745c5b497"), alt: "Golden dawn light" },
    { url: LU("1533387520709-752d83de3630"), alt: "First light over the hills" },
    { url: LU("1626348448069-9b156d20faeb"), alt: "Dawn mist in the valley" },
    { url: LU("1635001360483-6772df57f2f9"), alt: "Sunrise breaking the horizon" },
    { url: LU("1653203201902-c103cd99531e"), alt: "Morning fog on the mountains" },
    { url: LU("1665849863678-fc03a642a9aa"), alt: "The early sky" },
    { url: LU("1672917585946-339e22ac54dc"), alt: "A misty morning field" },
    { url: LU("1675652202189-d33f7fa075f0"), alt: "Daybreak over the ridge" },
    { url: LU("1678218718965-b6bd7b7c4dab"), alt: "Golden dawn light" },
    { url: LU("1732106846688-3bac122e4f97"), alt: "First light over the hills" },
    { url: LU("1743309411498-a0f4f4b96b65"), alt: "Dawn mist in the valley" },
    { url: LU("1760783320169-44e82cd3265f"), alt: "Sunrise breaking the horizon" },
    { url: LU("1762689744940-8488691b0610"), alt: "Morning fog on the mountains" },
    { url: LU("1763887277852-be39663e9191"), alt: "The early sky" },
    { url: LU("1764618979735-dc750932d8a7"), alt: "A misty morning field" },
    { url: LU("1766200064130-1da9bab345bf"), alt: "Daybreak over the ridge" },
    { url: LU("1774381498861-bb182e9de9d8"), alt: "Golden dawn light" },
    { url: LU("1775679226397-ac4366205c91"), alt: "First light over the hills" },
    { url: LU("1775891842789-e6d8a48b1a91"), alt: "Dawn mist in the valley" },
    { url: LU("1776806399638-3f6693f8dcd4"), alt: "Sunrise breaking the horizon" },
    { url: LU("1778236262726-452ab6686b0f"), alt: "Morning fog on the mountains" },
    { url: LU("1783104122850-3991e530001a"), alt: "The early sky" },
    { url: LU("1783413193834-69b25f5949d9"), alt: "A misty morning field" },
  ],
  midday: [
    { url: LU("1582053403239-c58c07d86ce1"), alt: "A bright blue noon sky" },
    { url: LU("1582053403303-3c2c5f96c8b3"), alt: "Sunlit hills at midday" },
    { url: LU("1604440095301-4ec2f9230155"), alt: "Clear water under a wide sky" },
    { url: LU("1629905439673-86199719057a"), alt: "A bright summer meadow" },
    { url: LU("1650442940325-7f57848ffb9c"), alt: "Full daylight on the mountains" },
    { url: LU("1701906268617-e56feaedfdb6"), alt: "Turquoise sea at noon" },
    { url: LU("1714544047757-89462703581e"), alt: "A sunny green valley" },
    { url: LU("1714544566545-96da265563df"), alt: "Bright day over the water" },
    { url: LU("1717683822555-06409656b1bd"), alt: "A bright blue noon sky" },
    { url: LU("1717683822568-3b85cb0b2844"), alt: "Sunlit hills at midday" },
    { url: LU("1717683823239-2ad7891c0ee4"), alt: "Clear water under a wide sky" },
    { url: LU("1722194664034-26eef4dbda48"), alt: "A bright summer meadow" },
    { url: LU("1723767625670-a6c509338c22"), alt: "Full daylight on the mountains" },
    { url: LU("1734454736580-23f19bdf6423"), alt: "Turquoise sea at noon" },
    { url: LU("1738508370941-6b333ae8a3dc"), alt: "A sunny green valley" },
    { url: LU("1744932126743-8954e1432a5a"), alt: "Bright day over the water" },
    { url: LU("1759363199657-9bfac6fca7dc"), alt: "A bright blue noon sky" },
    { url: LU("1761204676901-2c751d77bd80"), alt: "Sunlit hills at midday" },
    { url: LU("1762858924495-fde7d1935ef5"), alt: "Clear water under a wide sky" },
    { url: LU("1770959837753-63e67740c99d"), alt: "A bright summer meadow" },
    { url: LU("1775566981662-9b18f0eb8651"), alt: "Full daylight on the mountains" },
    { url: LU("1777386189712-68b109195907"), alt: "Turquoise sea at noon" },
    { url: LU("1777473084121-aeae63c9813a"), alt: "A sunny green valley" },
    { url: LU("1778099744694-b29acc79927b"), alt: "Bright day over the water" },
    { url: LU("1782092323103-862e70d6657e"), alt: "A bright blue noon sky" },
    { url: LU("1783883614310-18b4ffdf9df1"), alt: "Sunlit hills at midday" },
    { url: LU("1709486851809-ca174bfed7ed"), alt: "Clear water under a wide sky" },
    { url: LU("1623876355063-15d1d5e5b89b"), alt: "A bright summer meadow" },
    { url: LU("1586359716568-3e1907e4cf9f"), alt: "Full daylight on the mountains" },
    { url: LU("1781036150366-3854152f37db"), alt: "Turquoise sea at noon" },
  ],
  evening: [
    { url: LU("1433477077279-9354d2d72f6b"), alt: "Golden hour over the hills" },
    { url: LU("1470252649378-9c29740c9fa8"), alt: "Sunset over the mountains" },
    { url: LU("1494548162494-384bba4ab999"), alt: "Dusk settling on the sea" },
    { url: LU("1500534623283-312aade485b7"), alt: "The evening sky ablaze" },
    { url: LU("1503803548695-c2a7b4a5b875"), alt: "Sun sinking behind the ridge" },
    { url: LU("1506880648420-aafaa650d147"), alt: "A golden sunset field" },
    { url: LU("1510784722466-f2aa9c52fff6"), alt: "Twilight over the water" },
    { url: LU("1519614218660-ea0a24a43b4c"), alt: "The last light of day" },
    { url: LU("1523177839081-99e24a24e9a6"), alt: "Golden hour over the hills" },
    { url: LU("1571040514537-0424f4a4ee1e"), alt: "Sunset over the mountains" },
    { url: LU("1581224463294-908316338239"), alt: "Dusk settling on the sea" },
    { url: LU("1585215148712-c6505c99c392"), alt: "The evening sky ablaze" },
    { url: LU("1595495745485-f5ffc0318e7f"), alt: "Sun sinking behind the ridge" },
    { url: LU("1595495745827-85bcc5c9a028"), alt: "A golden sunset field" },
    { url: LU("1604223190546-a43e4c7f29d7"), alt: "Twilight over the water" },
    { url: LU("1607947242748-a1a4d4b72022"), alt: "The last light of day" },
    { url: LU("1612676239016-41e2c92b8e06"), alt: "Golden hour over the hills" },
    { url: LU("1613365891889-7f7e3316be61"), alt: "Sunset over the mountains" },
    { url: LU("1616036740257-9449ea1f6605"), alt: "Dusk settling on the sea" },
    { url: LU("1621472126228-d20f26ff6aee"), alt: "The evening sky ablaze" },
    { url: LU("1622993288089-18298ec89b78"), alt: "Sun sinking behind the ridge" },
    { url: LU("1625647891375-91463187659f"), alt: "A golden sunset field" },
    { url: LU("1625865757464-dad39944b5c2"), alt: "Twilight over the water" },
    { url: LU("1626663082558-31972acf4763"), alt: "The last light of day" },
    { url: LU("1648706903501-8b74096438df"), alt: "Golden hour over the hills" },
    { url: LU("1648885533514-1ed16479bdd7"), alt: "Sunset over the mountains" },
    { url: LU("1654362248566-6804dbcc5bdc"), alt: "Dusk settling on the sea" },
    { url: LU("1659608300525-a71e30dd2420"), alt: "The evening sky ablaze" },
    { url: LU("1682999959985-66f1a4875740"), alt: "Sun sinking behind the ridge" },
    { url: LU("1723251679023-9fc478009dbb"), alt: "A golden sunset field" },
  ],
  night: [
    { url: LU("1435224668334-0f82ec57b605"), alt: "The Milky Way over the mountains" },
    { url: LU("1456530308602-976f6a4bb440"), alt: "Aurora over the pines" },
    { url: LU("1468186402854-9a641fd7a7c4"), alt: "A starlit night sky" },
    { url: LU("1483347756197-71ef80e95f73"), alt: "Northern lights over the lake" },
    { url: LU("1488415032361-b7e238421f1b"), alt: "Stars above the peaks" },
    { url: LU("1488866022504-f2584929ca5f"), alt: "Aurora over the snow" },
    { url: LU("1501418611786-e29f9929fe03"), alt: "Deep night over the hills" },
    { url: LU("1502957291543-d85480254bf8"), alt: "The night sky, ablaze with stars" },
    { url: LU("1504858700536-882c978a3464"), alt: "The Milky Way over the mountains" },
    { url: LU("1516249181155-bbf89a130f77"), alt: "Aurora over the pines" },
    { url: LU("1517928260182-5688aead3066"), alt: "A starlit night sky" },
    { url: LU("1526644253653-a411eaafdfe6"), alt: "Northern lights over the lake" },
    { url: LU("1527467779599-34448b3fa6a7"), alt: "Stars above the peaks" },
    { url: LU("1529963183134-61a90db47eaf"), alt: "Aurora over the snow" },
    { url: LU("1531366936337-7c912a4589a7"), alt: "Deep night over the hills" },
    { url: LU("1568607689150-17e625c1586e"), alt: "The night sky, ablaze with stars" },
    { url: LU("1571371867188-fdc3f1f8e62d"), alt: "The Milky Way over the mountains" },
    { url: LU("1595520519880-a86c48ea536c"), alt: "Aurora over the pines" },
    { url: LU("1604608672516-f1b9b1d37076"), alt: "A starlit night sky" },
    { url: LU("1605286700104-15889419f60b"), alt: "Northern lights over the lake" },
    { url: LU("1609528911883-fc7e0ee63c51"), alt: "Stars above the peaks" },
    { url: LU("1610989432929-9769f3cf8006"), alt: "Aurora over the snow" },
    { url: LU("1621603523799-bbdadeb207c2"), alt: "Deep night over the hills" },
    { url: LU("1628818144466-856f7d477125"), alt: "The night sky, ablaze with stars" },
    { url: LU("1630822957190-7e020791a7e0"), alt: "The Milky Way over the mountains" },
    { url: LU("1637055972140-64608c1abe53"), alt: "Aurora over the pines" },
    { url: LU("1678054055852-0f9d40a24dab"), alt: "A starlit night sky" },
    { url: LU("1720293862142-bba219b0190e"), alt: "Northern lights over the lake" },
    { url: LU("1720293862191-32c6a907a8ae"), alt: "Stars above the peaks" },
    { url: LU("1720675009618-a38716724700"), alt: "Aurora over the snow" },
  ],
};

/** Days since the Unix epoch for an EAT calendar day string ("YYYY-MM-DD"). */
function epochDay(dayKey: string): number {
  return Math.floor(Date.parse(`${dayKey}T00:00:00Z`) / 86_400_000);
}

/**
 * Today's photograph for a part — a 30-day non-repeating rotation. Each pool
 * holds ~30 hour-fitting images; stepping the index by ONE per day walks the
 * whole pool before any image repeats, so a full month passes without a repeat.
 * A per-part offset keeps the four hours from landing on the same day-index.
 * Deterministic per (part, day) → the whole congregation sees the same tableau.
 */
const PART_OFFSET: Record<LiturgyPart, number> = { morning: 0, midday: 7, evening: 14, night: 21 };
export function pickLiturgyArt(part: LiturgyPart, dayKey: string): LiturgyArt {
  const pool = LITURGY_ART[part];
  const idx = ((epochDay(dayKey) + PART_OFFSET[part]) % pool.length + pool.length) % pool.length;
  return pool[idx]!;
}

// ==================== Band art (seven times of day, two cards) =============
// The liturgy card and the verse card each need their own hour-fitting
// photograph, and the two must never coincide. Rather than curate a fifth set
// of pools, we slice the four verified LITURGY_ART pools above into the seven
// bands, then split each band's slice into even/odd indices — one half for
// the liturgy card, the other for the verse card. Same source list sliced two
// ways is disjoint by construction, so no (band, day) pair can ever collide.
function splitEvenOdd(pool: readonly LiturgyArt[]): { even: LiturgyArt[]; odd: LiturgyArt[] } {
  const even: LiturgyArt[] = [];
  const odd: LiturgyArt[] = [];
  pool.forEach((art, i) => (i % 2 === 0 ? even : odd).push(art));
  return { even, odd };
}

const BAND_SOURCE: Record<DayBand, LiturgyArt[]> = {
  sunrise: LITURGY_ART.morning, // dawn imagery, unsliced
  morning: LITURGY_ART.midday.slice(0, 15), // bright fresh daylight
  midday: LITURGY_ART.midday.slice(15, 30),
  afternoon: LITURGY_ART.evening.slice(0, 15), // golden slanting light
  evening: LITURGY_ART.evening.slice(15, 30),
  night: LITURGY_ART.night.slice(0, 15),
  midnight: LITURGY_ART.night.slice(15, 30), // deep stars
};

export const BAND_ART: Record<"liturgy" | "verse", Record<DayBand, LiturgyArt[]>> = (() => {
  const liturgy = {} as Record<DayBand, LiturgyArt[]>;
  const verse = {} as Record<DayBand, LiturgyArt[]>;
  for (const band of Object.keys(BAND_SOURCE) as DayBand[]) {
    const { even, odd } = splitEvenOdd(BAND_SOURCE[band]);
    liturgy[band] = even; // liturgy card: even indices
    verse[band] = odd; // verse card: odd indices — guaranteed disjoint
  }
  return { liturgy, verse };
})();

const BAND_OFFSET: Record<DayBand, number> = {
  sunrise: 0,
  morning: 1,
  midday: 2,
  afternoon: 3,
  evening: 4,
  night: 5,
  midnight: 6,
};

/** Today's photograph for a card + band — deterministic per (card, band, EAT day). */
export function pickBandArt(card: "liturgy" | "verse", band: DayBand, dayKey: string): LiturgyArt {
  const pool = BAND_ART[card][band];
  const idx = ((epochDay(dayKey) + BAND_OFFSET[band]) % pool.length + pool.length) % pool.length;
  return pool[idx]!;
}

/** Gregorian Easter Sunday (Meeus/Jones/Butcher computus). Month is 1-based. */
export function easterOf(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

const DAY_MS = 24 * 3600_000;

/** The EAT (UTC+3, no DST) calendar date of `now`, as a UTC-midnight Date. */
function eatDate(now: Date): Date {
  const eat = new Date(now.getTime() + 3 * 3600_000);
  return new Date(Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate()));
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Church season for an EAT calendar day (western calendar, kept coarse on
 *  purpose: advent / christmas / lent / easter / ordinary). */
export function seasonOf(now: Date = new Date()): Season {
  const day = eatDate(now);
  const y = day.getUTCFullYear();

  // Christmas: Dec 25 → Jan 5 (crosses the year boundary).
  const m = day.getUTCMonth() + 1;
  const dom = day.getUTCDate();
  if ((m === 12 && dom >= 25) || (m === 1 && dom <= 5)) return "christmas";

  // Advent: the 4th Sunday before Christmas through Dec 24.
  const christmas = Date.UTC(y, 11, 25);
  const christmasDow = new Date(christmas).getUTCDay(); // 0 = Sunday
  const adventStart = christmas - (christmasDow === 0 ? 7 : christmasDow) * DAY_MS - 21 * DAY_MS;
  if (day.getTime() >= adventStart && day.getTime() < christmas) return "advent";

  // Lent: Ash Wednesday (Easter − 46 days) → Holy Saturday.
  const { month: em, day: ed } = easterOf(y);
  const easter = Date.UTC(y, em - 1, ed);
  const ashWednesday = easter - 46 * DAY_MS;
  if (day.getTime() >= ashWednesday && day.getTime() < easter) return "lent";

  // Easter season: Easter Sunday → Pentecost (Easter + 49 days), inclusive.
  if (day.getTime() >= easter && day.getTime() <= easter + 49 * DAY_MS) return "easter";

  return "ordinary";
}

/** Which liturgy part the EAT clock is in right now. */
export function partOf(now: Date = new Date()): LiturgyPart {
  const eatHour = (now.getUTCHours() + 3) % 24;
  if (eatHour >= 4 && eatHour < 11) return "morning";
  if (eatHour >= 11 && eatHour < 16) return "midday";
  if (eatHour >= 16 && eatHour < 21) return "evening";
  return "night";
}

/** Which of the seven finer bands the EAT clock is in right now. */
export function bandOf(now: Date = new Date()): DayBand {
  const eatHour = (now.getUTCHours() + 3) % 24;
  if (eatHour >= 6 && eatHour < 9) return "sunrise";
  if (eatHour >= 9 && eatHour < 12) return "morning";
  if (eatHour >= 12 && eatHour < 14) return "midday";
  if (eatHour >= 14 && eatHour < 17) return "afternoon";
  if (eatHour >= 17 && eatHour < 21) return "evening";
  if (eatHour >= 21 && eatHour < 24) return "night";
  return "midnight"; // 0–5:59
}

/** A second authored exhortation line per band — the liturgy card's "charge".
 *  Two per band, rotated by the EAT day's parity (owner-approved voice, WEB). */
export const CHARGES: Record<DayBand, readonly [string, string]> = {
  sunrise: [
    "Before the phone, the Father — give him the first word of your day.",
    "The light you're watching rise — he spoke it. Start here.",
  ],
  morning: [
    "Work as worship: whatever your hands find this morning, do it unto him.",
    "The day is young and so is his mercy — walk into it unhurried.",
  ],
  midday: [
    "Stop at the summit of the day. One breath, one thank-you, before the descent.",
    "Half the day is his already — give him the other half on purpose.",
  ],
  afternoon: [
    "The long stretch is where faithfulness is proved. Keep going — he sees.",
    "Tired is not the same as finished. Lean on him for the last hours.",
  ],
  evening: [
    "Come home to him before you come home to the couch.",
    "Lay the day's weight down at the door — it was never yours to carry overnight.",
  ],
  night: [
    "Review the day with grace: where did you see him? Thank him for that.",
    "The dark is not empty — it is where he keeps watch.",
  ],
  midnight: [
    "If you're awake at this hour, maybe it's because heaven wanted company.",
    "Even now he is not asleep. Whisper — he hears the quietest hour.",
  ],
};

export interface BandVerseLine {
  reference: string;
  text: string;
}

/** Curated scripture FOR that band — two per band, rotated by EAT day parity (WEB). */
export const VERSE_LINES: Record<DayBand, readonly [BandVerseLine, BandVerseLine]> = {
  sunrise: [
    { reference: "Lamentations 3:22-23", text: "His mercies never come to an end; they are new every morning; great is your faithfulness." },
    { reference: "Psalm 143:8", text: "Cause me to hear your loving kindness in the morning, for I trust in you." },
  ],
  morning: [
    { reference: "Psalm 90:14", text: "Satisfy us in the morning with your loving kindness, that we may rejoice and be glad all our days." },
    { reference: "Proverbs 16:3", text: "Commit your deeds to the LORD, and your plans shall succeed." },
  ],
  midday: [
    { reference: "Psalm 121:5-6", text: "The LORD is your keeper... The sun will not harm you by day." },
    { reference: "Philippians 4:5", text: "The Lord is at hand." },
  ],
  afternoon: [
    { reference: "Galatians 6:9", text: "Let's not be weary in doing good, for we will reap in due season if we don't give up." },
    { reference: "Isaiah 40:31", text: "Those who wait for the LORD will renew their strength... they will walk, and not faint." },
  ],
  evening: [
    { reference: "Psalm 55:17", text: "Evening, morning, and at noon I will cry out in distress, and he will hear my voice." },
    { reference: "Matthew 11:28", text: "Come to me, all you who labour and are heavily burdened, and I will give you rest." },
  ],
  night: [
    { reference: "Psalm 139:23-24", text: "Search me, God, and know my heart... lead me in the everlasting way." },
    { reference: "Psalm 4:8", text: "In peace I will both lay myself down and sleep, for you alone, LORD, make me live in safety." },
  ],
  midnight: [
    { reference: "Psalm 63:6", text: "When I remember you on my bed, I meditate on you in the night watches." },
    { reference: "Psalm 121:3-4", text: "He who keeps you will not slumber... He who keeps Israel will neither slumber nor sleep." },
  ],
};

// ================= Scripture spine (real material to pray from) ===========
// The liturgy repeated because the composer had nothing but the season and
// the date to work with — no fresh text, no memory of what it already wrote.
// This is half the fix (the other half is priorLines() below, on the service
// class). Every day gets a deterministic, ROTATING anchor: one psalm, one
// gospel passage, one epistle passage — real reference AND real text (public-
// domain, WEB-style wording, matching the CHARGES/VERSE_LINES convention
// above), so the model prays FROM a passage instead of recalling one
// unaided.
//
// This is a deterministic WALK over three short curated lists, not 365 hand-
// written entries: 24 psalms · 23 gospel passages · 25 epistle passages, all
// pairwise-coprime lengths, so the exact (psalm, gospel, epistle) TRIPLE for
// a given day does not recur for 24 × 23 × 25 = 13,800 days — about 38 years.
// A year-scale cycle, never a short loop, built honestly from real Scripture
// rather than invented content.
export interface SpinePassage {
  reference: string;
  text: string;
}
export interface ScriptureSpine {
  psalm: SpinePassage;
  gospel: SpinePassage;
  epistle: SpinePassage;
}

const PSALM_SPINE: readonly SpinePassage[] = [
  { reference: "Psalm 1:1-3", text: "Blessed is the man who doesn't walk in the counsel of the wicked, nor stand on the path of sinners. His delight is in the LORD's law; he is like a tree planted by streams of water, yielding fruit in its season." },
  { reference: "Psalm 8:3-4", text: "When I consider your heavens, the work of your fingers, the moon and the stars which you have ordained — what is man, that you think of him, the son of man, that you care for him?" },
  { reference: "Psalm 16:11", text: "You will show me the path of life. In your presence is fullness of joy; in your right hand there are pleasures forever more." },
  { reference: "Psalm 19:1-2", text: "The heavens declare the glory of God. The skies proclaim the work of his hands. Day after day they pour out speech, and night after night they reveal knowledge." },
  { reference: "Psalm 23:1-3", text: "The LORD is my shepherd; I shall lack nothing. He makes me lie down in green pastures. He leads me beside still waters. He restores my soul." },
  { reference: "Psalm 27:1", text: "The LORD is my light and my salvation — whom shall I fear? The LORD is the strength of my life — of whom shall I be afraid?" },
  { reference: "Psalm 34:8", text: "Taste and see that the LORD is good. Blessed is the man who takes refuge in him." },
  { reference: "Psalm 37:4-5", text: "Delight yourself in the LORD, and he will give you the desires of your heart. Commit your way to the LORD; trust also in him, and he will act." },
  { reference: "Psalm 42:1-2", text: "As the deer pants for streams of water, so my soul pants for you, God. My soul thirsts for God, for the living God." },
  { reference: "Psalm 46:1", text: "God is our refuge and strength, a very present help in trouble." },
  { reference: "Psalm 51:10", text: "Create in me a clean heart, O God, and renew a right spirit within me." },
  { reference: "Psalm 62:1-2", text: "My soul finds rest in God alone; my salvation comes from him. He alone is my rock and my salvation, my fortress — I will never be greatly shaken." },
  { reference: "Psalm 63:1", text: "God, you are my God. I earnestly seek you. My soul thirsts for you, my flesh longs for you, in a dry and weary land where there is no water." },
  { reference: "Psalm 84:1-2", text: "How lovely is your dwelling place, LORD of Hosts! My soul longs, even faints, for the courts of the LORD; my heart and flesh cry out for the living God." },
  { reference: "Psalm 90:14", text: "Satisfy us in the morning with your loving kindness, that we may rejoice and be glad all our days." },
  { reference: "Psalm 91:1-2", text: "He who dwells in the secret place of the Most High rests in the shadow of the Almighty. I will say of the LORD, he is my refuge and my fortress, my God, in whom I trust." },
  { reference: "Psalm 100:4-5", text: "Enter his gates with thanksgiving, and his courts with praise. Give thanks to him and bless his name — for the LORD is good, and his loving kindness endures forever." },
  { reference: "Psalm 103:2-4", text: "Praise the LORD, my soul, and forget none of his benefits — who forgives all your sins, who heals all your diseases, who redeems your life from the pit, who crowns you with loving kindness." },
  { reference: "Psalm 118:24", text: "This is the day that the LORD has made; we will rejoice and be glad in it." },
  { reference: "Psalm 121:1-2", text: "I lift up my eyes to the mountains — where does my help come from? My help comes from the LORD, who made heaven and earth." },
  { reference: "Psalm 130:5-6", text: "I wait for the LORD; my soul waits, and in his word I put my hope. My soul waits for the Lord more than watchmen wait for the morning." },
  { reference: "Psalm 139:9-10", text: "If I rise on the wings of the dawn, if I settle on the far side of the sea, even there your hand will guide me, your right hand will hold me fast." },
  { reference: "Psalm 143:10", text: "Teach me to do your will, for you are my God. May your good Spirit lead me on level ground." },
  { reference: "Psalm 145:18-19", text: "The LORD is near to all who call on him, to all who call on him in truth. He fulfills the desires of those who fear him; he hears their cry and saves them." },
];

const GOSPEL_SPINE: readonly SpinePassage[] = [
  { reference: "Matthew 5:14-16", text: "You are the light of the world. A city located on a hill can't be hidden. Let your light shine before men, that they may see your good works and glorify your Father who is in heaven." },
  { reference: "Matthew 6:33", text: "Seek first God's Kingdom, and his righteousness; and all these things will be given to you as well." },
  { reference: "Matthew 6:34", text: "Therefore don't be anxious for tomorrow, for tomorrow will be anxious for itself. Each day's own trouble is sufficient for it." },
  { reference: "Matthew 7:7-8", text: "Ask, and it will be given you. Seek, and you will find. Knock, and it will be opened for you. Everyone who asks receives, and he who seeks finds." },
  { reference: "Matthew 11:28-30", text: "Come to me, all you who labor and are heavily burdened, and I will give you rest. Take my yoke upon you, and learn from me, for I am gentle and lowly in heart; and you will find rest for your souls." },
  { reference: "Matthew 28:20", text: "Behold, I am with you always, even to the end of the age." },
  { reference: "Mark 1:35", text: "Early in the morning, while it was still dark, he rose up and went out, and departed into a deserted place, and prayed there." },
  { reference: "Mark 4:39", text: "He awoke, and rebuked the wind, and said to the sea, 'Peace! Be still!' The wind ceased, and there was a great calm." },
  { reference: "Mark 10:27", text: "With men it is impossible, but not with God, for all things are possible with God." },
  { reference: "Mark 12:30-31", text: "Love the Lord your God with all your heart, with all your soul, with all your mind, and with all your strength. Love your neighbor as yourself." },
  { reference: "Luke 1:37", text: "For with God, nothing will be impossible." },
  { reference: "Luke 6:38", text: "Give, and it will be given to you — good measure, pressed down, shaken together, running over. With the same measure you use, it will be measured back to you." },
  { reference: "Luke 10:41-42", text: "Martha, Martha, you are anxious and troubled about many things, but one thing is needed. Mary has chosen the good part, which will not be taken away from her." },
  { reference: "Luke 12:6-7", text: "Aren't five sparrows sold for two small coins? Not one of them is forgotten by God. You are of more value than many sparrows." },
  { reference: "Luke 15:32", text: "It was appropriate to celebrate and be glad, for this, your brother, was dead, and is alive again. He was lost, and is found." },
  { reference: "Luke 24:32", text: "Weren't our hearts burning within us, while he spoke to us along the way, and while he opened the Scriptures to us?" },
  { reference: "John 1:14", text: "The Word became flesh, and lived among us. We saw his glory, such glory as of the one and only Son of the Father, full of grace and truth." },
  { reference: "John 3:16", text: "For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life." },
  { reference: "John 8:12", text: "I am the light of the world. He who follows me will not walk in the darkness, but will have the light of life." },
  { reference: "John 10:10", text: "The thief only comes to steal, kill, and destroy. I came that they may have life, and have it abundantly." },
  { reference: "John 14:27", text: "Peace I leave with you. My peace I give to you; not as the world gives, give I to you. Don't let your heart be troubled, neither let it be fearful." },
  { reference: "John 15:5", text: "I am the vine. You are the branches. He who remains in me, and I in him, the same bears much fruit, for apart from me you can do nothing." },
  { reference: "John 16:33", text: "In the world you have trouble; but cheer up! I have overcome the world." },
];

const EPISTLE_SPINE: readonly SpinePassage[] = [
  { reference: "Romans 5:3-5", text: "We also rejoice in our sufferings, knowing that suffering produces perseverance, and perseverance produces proven character, and proven character produces hope — and hope doesn't disappoint us, because God's love has been poured out into our hearts through the Holy Spirit." },
  { reference: "Romans 8:1", text: "There is therefore now no condemnation to those who are in Christ Jesus." },
  { reference: "Romans 8:28", text: "We know that all things work together for good for those who love God, for those who are called according to his purpose." },
  { reference: "Romans 8:38-39", text: "I am persuaded that neither death, nor life, nor angels, nor anything else in all creation will be able to separate us from the love of God in Christ Jesus our Lord." },
  { reference: "Romans 12:1-2", text: "Present your bodies a living sacrifice, holy and acceptable to God — don't be conformed to this world, but be transformed by the renewing of your mind." },
  { reference: "Romans 15:13", text: "Now may the God of hope fill you with all joy and peace in believing, that you may abound in hope, in the power of the Holy Spirit." },
  { reference: "1 Corinthians 10:13", text: "God is faithful, who will not allow you to be tempted above what you are able, but will with the temptation also make the way of escape." },
  { reference: "1 Corinthians 13:4-7", text: "Love is patient and is kind. Love doesn't envy. Love doesn't brag, is not proud. It bears all things, believes all things, hopes all things, endures all things." },
  { reference: "1 Corinthians 15:57-58", text: "Thanks be to God, who gives us the victory through our Lord Jesus Christ — be steadfast, always abounding in the Lord's work, because your labor is not in vain in the Lord." },
  { reference: "2 Corinthians 1:3-4", text: "Blessed be the Father of mercies and God of all comfort, who comforts us in all our affliction, that we may be able to comfort those who are in any affliction." },
  { reference: "2 Corinthians 4:16-18", text: "Our light affliction, which is for the moment, works for us more and more exceedingly an eternal weight of glory, while we don't look at the things seen, but at the things unseen." },
  { reference: "2 Corinthians 5:17", text: "If anyone is in Christ, he is a new creation. The old things have passed away. Behold, all things have become new." },
  { reference: "Galatians 5:22-23", text: "The fruit of the Spirit is love, joy, peace, patience, kindness, goodness, faith, gentleness, and self-control." },
  { reference: "Galatians 6:9", text: "Let us not be weary in doing good, for we will reap in due season, if we don't give up." },
  { reference: "Ephesians 2:8-9", text: "By grace you have been saved through faith, and that not of yourselves; it is the gift of God, not of works, that no one would boast." },
  { reference: "Ephesians 3:20-21", text: "Now to him who is able to do exceedingly abundantly above all that we ask or think, according to the power that works in us, be glory." },
  { reference: "Ephesians 6:10-11", text: "Be strong in the Lord, and in the strength of his might. Put on the whole armor of God, that you may be able to stand against the wiles of the devil." },
  { reference: "Philippians 4:6-7", text: "In nothing be anxious, but in everything, by prayer and petition with thanksgiving, let your requests be made known to God. And the peace of God will guard your hearts and thoughts." },
  { reference: "Philippians 4:13", text: "I can do all things through Christ, who strengthens me." },
  { reference: "Colossians 3:2", text: "Set your mind on the things that are above, not on the things that are on the earth." },
  { reference: "1 Thessalonians 5:16-18", text: "Rejoice always. Pray without ceasing. In everything give thanks, for this is the will of God in Christ Jesus toward you." },
  { reference: "2 Timothy 1:7", text: "God didn't give us a spirit of fear, but of power, love, and self-control." },
  { reference: "Hebrews 11:1", text: "Now faith is assurance of things hoped for, proof of things not seen." },
  { reference: "Hebrews 12:1-2", text: "Let us run with perseverance the race that is set before us, looking to Jesus, the author and perfecter of faith." },
  { reference: "James 1:2-3", text: "Count it all joy, my brothers, when you fall into various temptations, knowing that the testing of your faith produces endurance." },
];

/** Today's scripture spine — a deterministic walk (see the comment above),
 *  reproducible from the day alone and persisted alongside the composed
 *  lines (the `spine` column) so it's inspectable after the fact. */
export function spineFor(dayKey: string): ScriptureSpine {
  const day = epochDay(dayKey);
  const psalmIdx = ((day % PSALM_SPINE.length) + PSALM_SPINE.length) % PSALM_SPINE.length;
  const gospelIdx = ((day % GOSPEL_SPINE.length) + GOSPEL_SPINE.length) % GOSPEL_SPINE.length;
  const epistleIdx = ((day % EPISTLE_SPINE.length) + EPISTLE_SPINE.length) % EPISTLE_SPINE.length;
  return {
    psalm: PSALM_SPINE[psalmIdx]!,
    gospel: GOSPEL_SPINE[gospelIdx]!,
    epistle: EPISTLE_SPINE[epistleIdx]!,
  };
}

/** Served when the model is unavailable — never cached, always whole (all
 *  seven bands), each roughly honoring its band's length (see LITURGY_SYSTEM
 *  for the per-band guidance the composer itself is given). */
export const FALLBACK_LITURGY: LiturgyDay = {
  sunrise: {
    line: "Before the world has your attention, give the first word of this day to the God who is already awake with you. His mercies are new this morning — no failure from yesterday disqualifies you from today's grace. Meet him here, before the phone, before the noise, before anyone else asks anything of you.",
    scripture: "Lamentations 3:22-23",
  },
  morning: {
    line: "Whatever your hands find to do this morning — the desk, the market, the classroom, the kitchen — do it as worship, not as burden. He sees the ordinary work and calls it holy.",
    scripture: "Colossians 3:23",
  },
  midday: {
    line: "Stop at the summit of the day. One breath, one thank-you — he is near, even here.",
    scripture: "Philippians 4:5",
  },
  afternoon: {
    line: "Tired is not the same as finished. Keep going — he sees the faithfulness nobody else is watching.",
    scripture: "Galatians 6:9",
  },
  evening: {
    line: "Look back over today with honesty, not judgment. Where did you see him — in a kindness, a provision, a quiet moment you almost missed? Name it and thank him. Where you failed, he already knew and already forgave; lay it down here and let the day close in peace, not shame.",
    scripture: "Psalm 139:23-24",
  },
  night: {
    line: "Lie down in peace tonight — you don't have to keep watch over your own life. The One who keeps you does not slumber, does not grow tired of loving what he made.",
    scripture: "Psalm 121:3-4",
  },
  midnight: {
    line: "If you're awake at this hour, you are not alone in it. He who keeps you neither slumbers nor sleeps — whisper to him now; the quietest hour is not too quiet for God to hear.",
    scripture: "Psalm 63:6",
  },
};

export class LiturgyService {
  constructor(
    private readonly pool: Pool,
    private readonly provider: AiProvider,
  ) {}

  /** Compose (or fetch) the seven lines for one congregation + EAT day.
   *  Idempotent: ANY existing rows for the day win — a legacy four-part day
   *  (pre-migration-187 data) is served exactly as it was, never force-
   *  recomposed, which is what keeps old data serving unchanged. A fresh
   *  compose inserts ON CONFLICT DO NOTHING (so a retry after a partial
   *  write only fills the gaps, never duplicates). */
  async composeFor(congregationId: string, now: Date = new Date()): Promise<{ day: LiturgyDay; cached: boolean }> {
    const dayDate = ymd(eatDate(now));
    const season = seasonOf(now);

    const cached = await this.pool.query(
      `SELECT part, body, scripture_ref FROM liturgies WHERE congregation_id = $1 AND day_date = $2`,
      [congregationId, dayDate],
    );
    if (cached.rows.length > 0) {
      return { day: this.rowsToDay(cached.rows), cached: true };
    }

    const spine = spineFor(dayDate);
    const priorLines = await this.priorLines(congregationId, dayDate);

    let day: LiturgyDay;
    try {
      const raw = await this.provider.complete({
        system: LITURGY_SYSTEM,
        messages: [{
          role: "user",
          text: JSON.stringify({
            season,
            date: dayDate,
            // The day's real material to pray FROM — see spineFor()'s doc.
            spine,
            // The last 14 days this congregation was actually prayed, so the
            // no-reuse rule in LITURGY_SYSTEM has something real to check
            // against (a rule about lines the model can't see is no rule at
            // all — see the header comment on this file).
            prior_lines: priorLines,
          }),
        }],
        // Tier: deep. Volume here is the lowest in the whole intelligence layer
        // (once per CONGREGATION per day, not per member) while readership is
        // the highest (every member sees one of these 7 lines on Home every
        // day) — the clearest case in the app for "pastoral writing a member
        // actually reads deserves the strongest writer" at a cost that's a
        // rounding error.
        tier: "deep",
        // 3200, not 1400: output nearly doubled (seven bands, two of them a
        // full 45-80 word paragraph) and deep-tier thinking shares the same
        // max_tokens budget with the visible JSON — leave it headroom.
        maxTokens: 3200,
        feature: "daily_liturgy",
      });
      day = this.parse(raw);
    } catch {
      return { day: FALLBACK_LITURGY, cached: false }; // serve, don't cache — retry next call
    }

    for (const band of BANDS) {
      await this.pool.query(
        `INSERT INTO liturgies (congregation_id, day_date, part, body, scripture_ref, season, spine)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (congregation_id, day_date, part) DO NOTHING`,
        [congregationId, dayDate, band, day[band].line, day[band].scripture, season, JSON.stringify(spine)],
      );
    }
    return { day, cached: false };
  }

  /** What the member's Home shows right now: the current BAND's line +
   *  context. `part` is still returned (and still computed by the unchanged
   *  partOf()) purely so a client built for the four-part era keeps reading
   *  a value it understands — but `line`/`scripture_ref` are now the current
   *  band's own content, the same finer clock that already drives
   *  art/charge/verse_line, so "capturing every hour of the day as it is"
   *  is true of the headline line too, not just its trimmings.
   *
   *  recorded_audio_url/recorded_audio_duration_sec (migration 189): when the
   *  pastor has recorded THIS band, the client plays him instead of
   *  synthesizing the line — both fields are simply null when he hasn't,
   *  which is the normal, permanent, non-degraded case for most bands (see
   *  liturgy_recordings' header comment). No recorded_by / admin identity
   *  ever rides on this member-facing payload — corporate content only. */
  async current(congregationId: string | null, now: Date = new Date()): Promise<{
    part: LiturgyPart;
    band: DayBand;
    season: Season;
    is_sunday: boolean;
    line: string;
    scripture_ref: string | null;
    art: LiturgyArt;
    charge: string;
    verse_line: BandVerseLine;
    recorded_audio_url: string | null;
    recorded_audio_duration_sec: number | null;
  }> {
    const part = partOf(now);
    const band = bandOf(now);
    const season = seasonOf(now);
    const isSunday = eatDate(now).getUTCDay() === 0;
    let line = FALLBACK_LITURGY[band];
    let recordedUrl: string | null = null;
    let recordedDurationSec: number | null = null;
    if (congregationId) {
      const { day } = await this.composeFor(congregationId, now);
      line = day[band];
      const rec = await this.pool.query<{ audio_url: string; duration_sec: number }>(
        `SELECT audio_url, duration_sec FROM liturgy_recordings WHERE congregation_id = $1 AND band = $2`,
        [congregationId, band],
      );
      if (rec.rows.length > 0) {
        recordedUrl = rec.rows[0]!.audio_url;
        recordedDurationSec = rec.rows[0]!.duration_sec;
      }
    }
    const dayKey = ymd(eatDate(now));
    const parity = epochDay(dayKey) % 2;
    return {
      part,
      band,
      season,
      is_sunday: isSunday,
      line: line.line,
      scripture_ref: line.scripture,
      art: pickBandArt("liturgy", band, dayKey),
      charge: CHARGES[band][parity]!,
      verse_line: VERSE_LINES[band][parity]!,
      recorded_audio_url: recordedUrl,
      recorded_audio_duration_sec: recordedDurationSec,
    };
  }

  /** Nightly cron: compose today's liturgy for every congregation. */
  async composeAll(now: Date = new Date()): Promise<number> {
    const congs = await this.pool.query(`SELECT congregation_id FROM congregations`);
    let n = 0;
    for (const c of congs.rows) {
      try {
        const r = await this.composeFor(String(c.congregation_id), now);
        if (!r.cached) n += 1;
      } catch {
        /* one congregation failing must not stop the rest */
      }
    }
    return n;
  }

  /** The last 14 days' composed lines for this congregation (any band),
   *  most recent first — fed to the model so its no-reuse rule has real
   *  material to check against. Flat strings only (not scripture refs or
   *  band labels): keeps the payload small and puts the model's attention
   *  on exactly what it must not repeat. */
  private async priorLines(congregationId: string, dayDate: string): Promise<string[]> {
    const rows = await this.pool.query<{ body: string }>(
      `SELECT body FROM liturgies
        WHERE congregation_id = $1
          AND day_date >= ($2::date - INTERVAL '14 days')
          AND day_date < $2::date
        ORDER BY day_date DESC, part ASC`,
      [congregationId, dayDate],
    );
    return rows.rows.map((r) => r.body);
  }

  /** Builds a full seven-band day from whatever rows exist. Any band missing
   *  from `rows` (a legacy four-part day, or a partial write) falls back to
   *  FALLBACK_LITURGY rather than failing — so an old row always still
   *  serves, just without the three newer bands' own content. */
  private rowsToDay(rows: Array<{ part: string; body: string; scripture_ref: string | null }>): LiturgyDay {
    const day = { ...FALLBACK_LITURGY };
    for (const r of rows) {
      if (BANDS.includes(r.part as DayBand)) {
        day[r.part as DayBand] = { line: r.body, scripture: r.scripture_ref };
      }
    }
    return day;
  }

  /** Strict-JSON parse with shape checks; throws to trigger the fallback. */
  private parse(raw: string): LiturgyDay {
    const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const obj = JSON.parse(cleaned) as Record<string, { line?: unknown; scripture?: unknown }>;
    const day = {} as LiturgyDay;
    for (const band of BANDS) {
      const p = obj[band];
      if (!p || typeof p.line !== "string" || p.line.length < 8) throw new Error(`liturgy band missing: ${band}`);
      day[band] = { line: p.line, scripture: typeof p.scripture === "string" ? p.scripture : null };
    }
    return day;
  }
}
