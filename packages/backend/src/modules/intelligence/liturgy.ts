// Intelligence Phase 4 — the daily liturgy.
// Home breathes with the hours of the day: four short AI-composed prayer lines
// per congregation per day (morning / midday / evening / night), coloured by
// the church season. The SEASON and the CLOCK are deterministic code (computus
// below); AI only writes the words, once, shared by everyone (§1.1 — nothing
// here gates, scores or advances anything). If the model is down the member
// still gets a liturgy: a fixed fallback set is served (and not cached, so the
// next compose attempt can replace it).
import type { Pool } from "pg";
import type { AiProvider } from "../assistant/provider.js";
import { LITURGY_SYSTEM } from "./prompts.js";

export type LiturgyPart = "morning" | "midday" | "evening" | "night";
export type Season = "advent" | "christmas" | "lent" | "easter" | "ordinary";

// Home breathes with SEVEN times of day (finer-grained than the 4-part liturgy
// clock above). Composed prayer lines stay on the 4 windows — only imagery and
// the new charge/verse-line content below key off this richer clock.
export type DayBand = "sunrise" | "morning" | "midday" | "afternoon" | "evening" | "night" | "midnight";

export interface LiturgyLine {
  line: string;
  scripture: string | null;
}
export type LiturgyDay = Record<LiturgyPart, LiturgyLine>;

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

/** Served when the model is unavailable — never cached, always whole. */
export const FALLBACK_LITURGY: LiturgyDay = {
  morning: { line: "Rise — his mercies are new for you this morning; meet him before the day meets you.", scripture: "Lamentations 3:22-23" },
  midday: { line: "Pause one breath — the Lord is near, even in the middle of the noise.", scripture: "Philippians 4:5" },
  evening: { line: "Look back over today with honesty and grace; he was in every hour of it.", scripture: "Psalm 139:23-24" },
  night: { line: "Lie down in peace tonight — he who keeps you neither slumbers nor sleeps.", scripture: "Psalm 4:8" },
};

const PARTS: LiturgyPart[] = ["morning", "midday", "evening", "night"];

export class LiturgyService {
  constructor(
    private readonly pool: Pool,
    private readonly provider: AiProvider,
  ) {}

  /** Compose (or fetch) the four lines for one congregation + EAT day.
   *  Idempotent: cached rows win; a fresh compose inserts ON CONFLICT DO NOTHING. */
  async composeFor(congregationId: string, now: Date = new Date()): Promise<{ day: LiturgyDay; cached: boolean }> {
    const dayDate = ymd(eatDate(now));
    const season = seasonOf(now);

    const cached = await this.pool.query(
      `SELECT part, body, scripture_ref FROM liturgies WHERE congregation_id = $1 AND day_date = $2`,
      [congregationId, dayDate],
    );
    if (cached.rows.length === PARTS.length) {
      return { day: this.rowsToDay(cached.rows), cached: true };
    }

    let day: LiturgyDay;
    try {
      const raw = await this.provider.complete({
        system: LITURGY_SYSTEM,
        messages: [{ role: "user", text: `Season: ${season}. Date: ${dayDate}. Compose today's liturgy.` }],
        // Tier: deep. Volume here is the lowest in the whole intelligence layer
        // (once per CONGREGATION per day, not per member) while readership is
        // the highest (every member sees these 4 lines on Home every day) —
        // the clearest case in the app for "pastoral writing a member actually
        // reads deserves the strongest writer" at a cost that's a rounding error.
        tier: "deep",
        // 1400, not 600: deep-tier thinking is on by default and shares the
        // max_tokens budget with the visible JSON — leave it headroom.
        maxTokens: 1400,
        feature: "daily_liturgy",
      });
      day = this.parse(raw);
    } catch {
      return { day: FALLBACK_LITURGY, cached: false }; // serve, don't cache — retry next call
    }

    for (const part of PARTS) {
      await this.pool.query(
        `INSERT INTO liturgies (congregation_id, day_date, part, body, scripture_ref, season)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (congregation_id, day_date, part) DO NOTHING`,
        [congregationId, dayDate, part, day[part].line, day[part].scripture, season],
      );
    }
    return { day, cached: false };
  }

  /** What the member's Home shows right now: the current part's line + context. */
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
  }> {
    const part = partOf(now);
    const band = bandOf(now);
    const season = seasonOf(now);
    const isSunday = eatDate(now).getUTCDay() === 0;
    let line = FALLBACK_LITURGY[part];
    if (congregationId) {
      const { day } = await this.composeFor(congregationId, now);
      line = day[part];
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

  private rowsToDay(rows: Array<{ part: string; body: string; scripture_ref: string | null }>): LiturgyDay {
    const day = { ...FALLBACK_LITURGY };
    for (const r of rows) {
      if (PARTS.includes(r.part as LiturgyPart)) {
        day[r.part as LiturgyPart] = { line: r.body, scripture: r.scripture_ref };
      }
    }
    return day;
  }

  /** Strict-JSON parse with shape checks; throws to trigger the fallback. */
  private parse(raw: string): LiturgyDay {
    const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const obj = JSON.parse(cleaned) as Record<string, { line?: unknown; scripture?: unknown }>;
    const day = {} as LiturgyDay;
    for (const part of PARTS) {
      const p = obj[part];
      if (!p || typeof p.line !== "string" || p.line.length < 8) throw new Error(`liturgy part missing: ${part}`);
      day[part] = { line: p.line, scripture: typeof p.scripture === "string" ? p.scripture : null };
    }
    return day;
  }
}
