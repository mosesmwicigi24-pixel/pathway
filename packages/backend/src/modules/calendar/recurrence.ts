// Recurrence engine (Features v2 §C.0/§D.2). Expands an RRULE in the series'
// IANA timezone (not UTC) so occurrences hold their wall-clock across DST. The
// RRULE is validated against an allow-list first — recurrence-expansion bombs are
// a DoS vector (§C.4). Pure functions; no DB.
// `rrule` is a CommonJS module; under Node's ESM loader its named exports aren't
// statically detectable, so import the default (module.exports) and destructure.
import rrulePkg from "rrule";
import { DateTime } from "luxon";

const { RRule } = rrulePkg;
import { ApiError } from "../../http/errors.js";

const ALLOWED_FREQ = new Set([RRule.DAILY, RRule.WEEKLY, RRule.MONTHLY]);
const MAX_INTERVAL = 4;
const MAX_COUNT = 260;

export interface SeriesSpec {
  timezone: string; // IANA
  dtstart_local: string | Date; // wall-clock anchor in `timezone`
  duration_min: number;
  rrule: string | null;
}

export interface Occurrence {
  start_at: string; // UTC ISO
  end_at: string; // UTC ISO
}

/** Validate an RRULE against the allow-list. Throws 422 UNPROCESSABLE on violation. */
export function validateRrule(rrule: string): void {
  let opts;
  try {
    opts = RRule.parseString(rrule);
  } catch {
    throw new ApiError("UNPROCESSABLE", "Unparseable RRULE");
  }
  if (opts.freq === undefined || !ALLOWED_FREQ.has(opts.freq)) {
    throw new ApiError("UNPROCESSABLE", "RRULE FREQ must be DAILY, WEEKLY or MONTHLY");
  }
  if (opts.interval !== undefined && opts.interval !== null && opts.interval > MAX_INTERVAL) {
    throw new ApiError("UNPROCESSABLE", `RRULE INTERVAL must be ≤ ${MAX_INTERVAL}`);
  }
  // Open-ended rules (no COUNT/UNTIL) are LEGAL (EVENTS_ARCHITECTURE §2):
  // windowed expansion makes unbounded recurrence safe, so long-running series
  // no longer die at an artificial horizon. INTERVAL/COUNT caps stay as DoS
  // guards on rules that DO bound themselves.
  const hasCount = opts.count !== undefined && opts.count !== null;
  if (hasCount && (opts.count as number) > MAX_COUNT) {
    throw new ApiError("UNPROCESSABLE", `RRULE COUNT must be ≤ ${MAX_COUNT}`);
  }
}

// Interpret a naive wall-clock Date (whose UTC fields ARE the local fields) in the
// given zone, returning the real UTC instant.
function wallClockToUtc(naive: Date, zone: string): DateTime {
  return DateTime.fromObject(
    {
      year: naive.getUTCFullYear(),
      month: naive.getUTCMonth() + 1,
      day: naive.getUTCDate(),
      hour: naive.getUTCHours(),
      minute: naive.getUTCMinutes(),
    },
    { zone },
  );
}

/**
 * Expand a series into UTC occurrences overlapping [fromUtc, toUtc], capped at
 * maxInstances. One-off series (rrule = null) yield a single occurrence.
 */
// Read the wall-clock components of a naive local timestamp WITHOUT applying any
// timezone (avoids the new Date("...no Z...") local-parse pitfall). Accepts the
// "YYYY-MM-DD[ T]HH:MM[:SS]" string the service produces via to_char.
function wallClockParts(local: string | Date): { y: number; mo: number; d: number; h: number; mi: number } {
  const s = typeof local === "string" ? local : local.toISOString();
  const m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s);
  if (!m) throw new ApiError("VALIDATION_FAILED", "Invalid dtstart_local");
  return { y: +m[1]!, mo: +m[2]!, d: +m[3]!, h: +m[4]!, mi: +m[5]! };
}

export function expandOccurrences(
  series: SeriesSpec,
  fromUtc: Date,
  toUtc: Date,
  maxInstances: number,
): Occurrence[] {
  const wc = wallClockParts(series.dtstart_local);
  // Treat the stored wall-clock as floating: build a UTC Date carrying those fields.
  const floatingDtstart = new Date(Date.UTC(wc.y, wc.mo - 1, wc.d, wc.h, wc.mi));

  const out: Occurrence[] = [];
  const emit = (naive: Date): void => {
    const startDt = wallClockToUtc(naive, series.timezone);
    const start = startDt.toUTC();
    const end = startDt.plus({ minutes: series.duration_min }).toUTC();
    const startMs = start.toMillis();
    if (startMs >= fromUtc.getTime() && startMs <= toUtc.getTime()) {
      out.push({ start_at: start.toISO()!, end_at: end.toISO()! });
    }
  };

  if (!series.rrule) {
    emit(floatingDtstart);
    return out;
  }

  const opts = RRule.parseString(series.rrule);
  opts.dtstart = floatingDtstart;
  const rule = new RRule(opts);
  // EVENTS_ARCHITECTURE §2: expand with between() over the REQUESTED window —
  // never enumerate from DTSTART — so the instance cap applies to occurrences
  // emitted in-window rather than counted from the series anchor. (The old
  // rule.all + index cap made any weekly series older than `maxInstances` weeks
  // report no upcoming occurrences at all.) The naive window is padded ±1 day
  // because rule dates are wall-clock while from/to are UTC instants; emit()
  // re-filters precisely after timezone conversion.
  const lo = new Date(fromUtc.getTime() - 86_400_000);
  const hi = new Date(toUtc.getTime() + 86_400_000);
  for (const date of rule.between(lo, hi, true)) {
    if (out.length >= maxInstances) break;
    emit(date);
  }
  return out;
}
