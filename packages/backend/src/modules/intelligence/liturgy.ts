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
    { url: LU("1418065460487-3e41a6c84dc5"), alt: "Mist over a pine forest at first light" },
    { url: LU("1506744038136-46273834b3fb"), alt: "Morning mist on a mountain river" },
    { url: LU("1507525428034-b723cf961d3e"), alt: "Dawn breaking over a quiet shore" },
    { url: LU("1470252649378-9c29740c9fa8"), alt: "Sunrise over an open field" },
  ],
  midday: [
    { url: LU("1490750967868-88aa4486c946"), alt: "Poppies open to a bright blue sky" },
    { url: LU("1502082553048-f009c37129b9"), alt: "A great tree under a wide noon sky" },
    { url: LU("1433086966358-54859d0ed716"), alt: "A waterfall through sunlit green cliffs" },
    { url: LU("1465146344425-f00d5f5c8f07"), alt: "Wildflowers in a bright wheat field" },
  ],
  evening: [
    { url: LU("1472120435266-53107fd0c44a"), alt: "Deep sunset over a still field" },
    { url: LU("1495616811223-4d98c6e9c869"), alt: "Golden dusk over a lake and jetty" },
    { url: LU("1500382017468-9049fed747ef"), alt: "Sun rays fading over the wheat" },
    { url: LU("1499002238440-d264edd596ec"), alt: "Sunset over a lavender field" },
  ],
  night: [
    { url: LU("1419242902214-272b3f66ee7a"), alt: "A meteor over starlit mountains" },
    { url: LU("1483086431886-3590a88317fe"), alt: "Aurora over the pines" },
    { url: LU("1519681393784-d120267933ba"), alt: "The Milky Way over the mountains" },
    { url: LU("1475924156734-496f6cac6ec1"), alt: "Deep twilight over a quiet sea" },
  ],
};

/** Stable 32-bit FNV-1a hash — deterministic across runs/processes. */
function litHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Today's photograph for a part: same across the congregation, fresh daily. */
export function pickLiturgyArt(part: LiturgyPart, dayKey: string): LiturgyArt {
  const pool = LITURGY_ART[part];
  return pool[litHash(`${part}|${dayKey}`) % pool.length]!;
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
        tier: "standard",
        temperature: 0.4,
        maxTokens: 600,
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
    season: Season;
    is_sunday: boolean;
    line: string;
    scripture_ref: string | null;
    art: LiturgyArt;
  }> {
    const part = partOf(now);
    const season = seasonOf(now);
    const isSunday = eatDate(now).getUTCDay() === 0;
    let line = FALLBACK_LITURGY[part];
    if (congregationId) {
      const { day } = await this.composeFor(congregationId, now);
      line = day[part];
    }
    return {
      part,
      season,
      is_sunday: isSunday,
      line: line.line,
      scripture_ref: line.scripture,
      art: pickLiturgyArt(part, ymd(eatDate(now))),
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
