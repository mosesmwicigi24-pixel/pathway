// The partner-only statement rule (docs/PARTNERS_PROGRAMME.md §3a), as pure
// functions over plain values — no database, no clock of its own — so the
// numbers a partner sees are pinned by unit tests and match both apps
// (Android `PartnerStatementMath.kt`, iOS `PartnersView`) exactly.
//
//   Paid      = Σ statement payments[].amount_minor where pledge_id is set
//   Pledged   = Σ over pledges not cancelled:
//                 monthly → amount_minor × number of due_day dates in the year
//                           from max(pledge created_at, 1 Jan) through 31 Dec
//                 total   → target_minor if due_on falls in the year, else 0
//   Remaining = max(Pledged − Paid, 0)
//
// Gifts without a pledge are never counted here; they stay in the full
// giving statement. Dates are the church's day (Africa/Nairobi, UTC+3, no
// DST) — the same calendar partners.ts keeps for due dates and reminders.

/** Africa/Nairobi is UTC+3 all year (no DST), so a fixed offset is exact. */
export const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Nairobi calendar date (YYYY-MM-DD) of an instant. */
export function nairobiDate(d: Date): string {
  return new Date(d.getTime() + NAIROBI_OFFSET_MS).toISOString().slice(0, 10);
}

/** ISO instant, Postgres timestamptz text, or a bare YYYY-MM-DD → the Nairobi
 *  calendar date (YYYY-MM-DD), or null when absent or unparseable. A bare
 *  date is already a calendar day and is returned as-is, never shifted. */
export function partnerDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const s = String(iso).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? null : nairobiDate(new Date(t));
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Every monthly pledge has a due day 1..28 (spec §1); a row without one is
 *  malformed, and the 1st is the least-surprising day to count from. */
const DEFAULT_DUE_DAY = 1;

/** How many `dueDay`-of-the-month dates fall in `year` on or after `from`
 *  (clamped to 1 Jan) and on or before `through` (clamped to 31 Dec).
 *  Dates are YYYY-MM-DD strings, so lexical order is calendar order. */
export function dueDatesInYear(year: number, dueDay: number, from: string | null, through: string | null = null): number {
  const jan1 = ymd(year, 1, 1);
  const dec31 = ymd(year, 12, 31);
  const start = from !== null && from > jan1 ? from : jan1;
  const end = through !== null && through < dec31 ? through : dec31;
  if (end < start) return 0;
  const day = Math.min(28, Math.max(1, Math.trunc(dueDay)));
  let n = 0;
  for (let m = 1; m <= 12; m++) {
    const d = ymd(year, m, day);
    if (d >= start && d <= end) n += 1;
  }
  return n;
}

/** The facts about one pledge the rule reads — a subset of the wire `Pledge`. */
export interface StatementPledgeInput {
  pledge_id: string;
  shape: "monthly" | "total";
  amount_minor: number | null;
  target_minor: number | null;
  status: "active" | "paused" | "fulfilled" | "cancelled";
  due_day: number | null;
  due_on: string | null;
  /** ISO instant / timestamptz text; null falls back to the whole year. */
  created_at: string | null;
}

/** The facts about one payment the rule reads — a subset of `payments[]`. */
export interface StatementPaymentInput {
  pledge_id: string | null;
  amount_minor: number;
}

export interface StatementSummary {
  pledged_minor: number;
  paid_minor: number;
  remaining_minor: number;
}

/** What one pledge contributes to the year's Pledged figure (rule above). */
export function pledgedInYear(p: StatementPledgeInput, year: number): number {
  if (p.status === "cancelled") return 0;
  if (p.shape === "total") {
    const due = partnerDate(p.due_on);
    return due !== null && Number(due.slice(0, 4)) === year ? (p.target_minor ?? 0) : 0;
  }
  return (p.amount_minor ?? 0) * dueDatesInYear(year, p.due_day ?? DEFAULT_DUE_DAY, partnerDate(p.created_at));
}

/** The pledge-tied payments only — the rows a Partners statement shows. */
export function pledgePayments<T extends StatementPaymentInput>(payments: T[]): T[] {
  return payments.filter((x) => typeof x.pledge_id === "string" && x.pledge_id.trim() !== "");
}

/** The statement's three numbers for `year`, all minor units. `payments` are
 *  the year's succeeded payments (any pledge, or none); `pledges` are the
 *  member's pledges in any state (cancelled ones contribute nothing). */
export function statementSummary(year: number, pledges: StatementPledgeInput[], payments: StatementPaymentInput[]): StatementSummary {
  const pledged = pledges.reduce((a, p) => a + pledgedInYear(p, year), 0);
  const paid = pledgePayments(payments).reduce((a, x) => a + x.amount_minor, 0);
  return { pledged_minor: pledged, paid_minor: paid, remaining_minor: Math.max(pledged - paid, 0) };
}

/** "N of M kept" for one pledge in `year`: `kept` = the year's payments
 *  attributed to it (a raw count — an early or doubled gift is still a gift
 *  kept); `due_count` = its due dates in `year` elapsed through `today`
 *  (YYYY-MM-DD), monthly only — a total pledge has no instalments, so 0. A
 *  year still ahead has nothing elapsed; a year gone by has all of it. */
export function keptInYear(
  p: StatementPledgeInput,
  yearPayments: StatementPaymentInput[],
  year: number,
  today: string,
): { kept: number; due_count: number } {
  const kept = yearPayments.filter((x) => x.pledge_id === p.pledge_id).length;
  if (p.shape !== "monthly") return { kept, due_count: 0 };
  const due_count = dueDatesInYear(year, p.due_day ?? DEFAULT_DUE_DAY, partnerDate(p.created_at), today);
  return { kept, due_count };
}
