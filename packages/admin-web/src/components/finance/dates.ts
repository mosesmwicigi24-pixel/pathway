// Finance dates — East Africa Time (Africa/Nairobi). The server reads every
// `from` / `to` as an EAT calendar day, inclusive, and buckets months and years
// in EAT (docs/FINANCE_ERP.md §2a, §4). Nairobi has been UTC+3 with no daylight
// saving since 1942, so everything here is the instant shifted +3 h and read
// with UTC getters: a browser in London or Los Angeles picks exactly the days
// the office in Nairobi does, and the result never depends on the machine's
// time zone.
import type { IsoDate } from "../../api/finance";

export const EAT_OFFSET_MINUTES = 180;
export const EAT_TIME_ZONE = "Africa/Nairobi";

export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

export type DatePreset = "this_month" | "last_month" | "this_quarter" | "this_year" | "last_12_months" | "custom";

export const DATE_PRESETS: readonly { key: DatePreset; label: string }[] = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_quarter", label: "This quarter" },
  { key: "this_year", label: "This year" },
  { key: "last_12_months", label: "Last 12 months" },
  { key: "custom", label: "Custom" },
];

/** A FilterBar period: the preset chosen and the inclusive EAT days it means. */
export interface PeriodValue extends DateRange {
  preset: DatePreset;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const pad2 = (n: number): string => String(n).padStart(2, "0");

interface Ymd {
  y: number;
  /** 1–12 */
  m: number;
  d: number;
}

/** The EAT calendar day of an instant. */
export function eatYmd(at: Date): Ymd {
  const t = new Date(at.getTime() + EAT_OFFSET_MINUTES * 60_000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export const isoDate = (y: number, m: number, d: number): IsoDate => `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`;

/** Today in Nairobi, YYYY-MM-DD. */
export function todayEAT(now: Date = new Date()): IsoDate {
  const { y, m, d } = eatYmd(now);
  return isoDate(y, m, d);
}

/** This year in Nairobi (the default for every year picker). */
export function currentYearEAT(now: Date = new Date()): number {
  return eatYmd(now).y;
}

const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** (y, m) moved by `delta` months. */
function shiftMonth(y: number, m: number, delta: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + delta;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

/**
 * The inclusive EAT day range a preset means today:
 * - This month / quarter / year: its first day → today (to-date, so "same
 *   period last year" comparisons on the server are like for like).
 * - Last month: the whole previous calendar month.
 * - Last 12 months: the first day of the month eleven months back → today —
 *   twelve calendar months, the current one partial, matching the 12-month
 *   series the Overview draws.
 * - Custom: `custom` as given (missing ends default to today).
 */
export function presetRange(preset: DatePreset, now: Date = new Date(), custom?: Partial<DateRange>): DateRange {
  const { y, m } = eatYmd(now);
  const today = todayEAT(now);
  switch (preset) {
    case "this_month":
      return { from: isoDate(y, m, 1), to: today };
    case "last_month": {
      const p = shiftMonth(y, m, -1);
      return { from: isoDate(p.y, p.m, 1), to: isoDate(p.y, p.m, daysInMonth(p.y, p.m)) };
    }
    case "this_quarter": {
      const qm = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: isoDate(y, qm, 1), to: today };
    }
    case "this_year":
      return { from: isoDate(y, 1, 1), to: today };
    case "last_12_months": {
      const s = shiftMonth(y, m, -11);
      return { from: isoDate(s.y, s.m, 1), to: today };
    }
    case "custom":
      return { from: custom?.from || today, to: custom?.to || today };
  }
}

/** A PeriodValue for a preset (what a FilterBar starts from). */
export function periodFor(preset: DatePreset, now: Date = new Date(), custom?: Partial<DateRange>): PeriodValue {
  return { preset, ...presetRange(preset, now, custom) };
}

/** True for a real calendar day written YYYY-MM-DD. */
export function isIsoDate(s: string | null | undefined): s is IsoDate {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** Why a range can't be used, or null when it can. */
export function rangeError(r: Partial<DateRange>): string | null {
  if (!isIsoDate(r.from) || !isIsoDate(r.to)) return "Pick both dates.";
  if (r.from > r.to) return "The start date is after the end date.";
  return null;
}

/** Years for a year picker: this year (EAT) back `count − 1` years, newest first. */
export function yearOptions(now: Date = new Date(), count = 6): number[] {
  const y = currentYearEAT(now);
  return Array.from({ length: Math.max(1, count) }, (_, i) => y - i);
}

/* ---------- display ---------- */

/** "2026-09-26" → "26 Sep 2026" (a calendar day — no time-zone shift). */
export function fmtDay(day: IsoDate | null | undefined): string {
  if (!isIsoDate(day)) return "—";
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
}

/** "2026-09" (or "2026-09-01") → "Sep 2026". */
export function fmtMonth(month: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(month ?? "");
  if (!m) return "—";
  const mi = Number(m[2]);
  return mi >= 1 && mi <= 12 ? `${MONTHS_SHORT[mi - 1]} ${m[1]}` : "—";
}

/** An instant as Nairobi sees it: "26 Sep 2026, 14:05". */
export function fmtDateTimeEAT(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "—";
  const s = new Date(t.getTime() + EAT_OFFSET_MINUTES * 60_000);
  return `${s.getUTCDate()} ${MONTHS_SHORT[s.getUTCMonth()]} ${s.getUTCFullYear()}, ${pad2(s.getUTCHours())}:${pad2(s.getUTCMinutes())}`;
}

/** An instant's Nairobi calendar day: "26 Sep 2026". */
export function fmtDateEAT(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "—";
  const { y, m, d } = eatYmd(t);
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
}

/** "1 Sep – 26 Sep 2026" / "1 Dec 2025 – 26 Jan 2026" / "26 Sep 2026". */
export function fmtRange(r: Partial<DateRange>): string {
  if (!isIsoDate(r.from) || !isIsoDate(r.to)) return "—";
  if (r.from === r.to) return fmtDay(r.from);
  const [fy, fm, fd] = r.from.split("-").map(Number) as [number, number, number];
  const [ty] = r.to.split("-").map(Number) as [number];
  const start = fy === ty ? `${fd} ${MONTHS_SHORT[fm - 1]}` : fmtDay(r.from);
  return `${start} – ${fmtDay(r.to)}`;
}
