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
//
// Statement v2 (§3d) adds, still pure: the year's impact in disciples carried
// (the owner's costing in tiers.ts, rounded DOWN), and ONE instalment ledger
// for monthly pledges (owner-delegated 2026-09-25) — `allocateInstalments`:
// a pledge's succeeded payments over its whole history fill its instalments
// oldest-first. Everything that says whether a monthly pledge is paid reads
// it: the statement's "N of M kept", month strip and faithfulness, AND the
// pledge card, the DUE list, the reminders and the office's "behind"
// (partners.ts) — so "I paid" can never look unpaid on one surface and paid
// on another.
import { COST_PER_DISCIPLE_MINOR } from "./tiers.js";

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

/** "N of M kept" for one pledge in `year`, from its instalment ledger
 *  (`allocateInstalments`, one definition of kept — owner-delegated
 *  2026-09-25): `kept` = its instalments due in `year` that are complete, on
 *  time or late; `due_count` = those that are resolved — kept, late or missed.
 *  An instalment due today and not yet complete is not counted until its day
 *  ends, so a due day never reads like a miss; one pre-paid ahead of a due
 *  date still to come counts as kept. `payments` are the pledge's succeeded
 *  payments over its WHOLE history (others' are ignored), because a payment
 *  in one year can settle or pre-pay an instalment in another. A total pledge
 *  has no instalments: 0 and 0. */
export function keptInYear(
  p: StatementPledgeInput,
  payments: StatementDatedPaymentInput[],
  year: number,
  today: string,
): { kept: number; due_count: number } {
  if (p.shape !== "monthly") return { kept: 0, due_count: 0 };
  const f = instalmentFaithfulness(instalmentsInYear(p, payments, year, today));
  return { kept: f.kept_on_time + f.late, due_count: f.due_count };
}

// ── statement v2 (§3d): impact, the month strip, faithfulness ─────────────

/** What the year's pledge money comes to in the owner's costing
 *  (tiers.ts: KSh 20,000 carries one disciple through one level). */
export interface StatementImpact {
  /** The year's pledge-tied payments — the statement's `paid_minor`. */
  paid_minor: number;
  per_disciple_minor: number;
  /** floor(paid ÷ per_disciple) — rounded DOWN, never up (tiers.ts). */
  disciples_carried: number;
  /** paid mod per_disciple — progress toward the next one. */
  toward_next_minor: number;
}

export function statementImpact(paidMinor: number, perDiscipleMinor: number = COST_PER_DISCIPLE_MINOR): StatementImpact {
  const paid = Math.max(0, Math.trunc(paidMinor));
  if (perDiscipleMinor <= 0) return { paid_minor: paid, per_disciple_minor: perDiscipleMinor, disciples_carried: 0, toward_next_minor: paid };
  return {
    paid_minor: paid,
    per_disciple_minor: perDiscipleMinor,
    disciples_carried: Math.floor(paid / perDiscipleMinor),
    toward_next_minor: paid % perDiscipleMinor,
  };
}

export type StatementMonthStatus = "kept" | "late" | "missed" | "upcoming" | "none";

/** One month of the strip. */
export interface StatementMonth {
  month: number; // 1..12
  status: StatementMonthStatus;
  /** Σ amount of the monthly pledges due this month. */
  due_minor: number;
  /** Σ payments to those pledges dated (Nairobi) in this month. */
  paid_minor: number;
}

/** Counted per instalment (one monthly pledge's due date), over resolved ones. */
export interface StatementFaithfulness {
  kept_on_time: number;
  late: number;
  missed: number;
  /** kept_on_time + late + missed — Σ pledges[].due_count over the monthly
   *  pledges not cancelled. */
  due_count: number;
}

/** A payment with its date — what the month strip reads. */
export interface StatementDatedPaymentInput extends StatementPaymentInput {
  /** ISO instant, Postgres timestamptz text, or a bare YYYY-MM-DD. */
  at: string;
}

// ── the instalment ledger (owner-delegated 2026-09-25) ────────────────────

/** How one instalment stands (the wire's month strip folds `due` into
 *  `upcoming`):
 *    kept      completed on or before its due date (end of that day, EAT) —
 *              including one pre-paid ahead of a due date still to come
 *    late      completed after its due date
 *    missed    its due date's day has ended and it is not complete
 *    due       due today and not complete
 *    upcoming  due in the future and not complete */
export type InstalmentStatus = "kept" | "late" | "missed" | "due" | "upcoming";

/** One instalment of a monthly pledge, as the ledger allocated it. */
export interface Instalment {
  /** Its due date, YYYY-MM-DD in the church's calendar. */
  due: string;
  amount_minor: number;
  /** How much of it the pledge's payments have filled, 0..amount_minor. */
  covered_minor: number;
  /** The date (EAT) of the payment that completed it; null while incomplete. */
  completed_on: string | null;
  status: InstalmentStatus;
}

/** A payment the ledger allocates; `transaction_id` breaks ties between
 *  payments at the same instant. */
export interface LedgerPaymentInput extends StatementDatedPaymentInput {
  transaction_id?: string;
}

/** Instalments are generated for at most this many months — a guard, never
 *  reached by a real pledge (200 years). */
const MAX_INSTALMENTS = 2400;

/** The first `day`-of-the-month date on or after `from` (YYYY-MM-DD). */
function firstDueOnOrAfter(from: string, day: number): string {
  const y = Number(from.slice(0, 4));
  const m = Number(from.slice(5, 7));
  const same = ymd(y, m, day);
  if (same >= from) return same;
  return m === 12 ? ymd(y + 1, 1, day) : ymd(y, m + 1, day);
}

/** The same `day` one month after `due`. */
function nextMonthly(due: string, day: number): string {
  const y = Number(due.slice(0, 4));
  const m = Number(due.slice(5, 7));
  return m === 12 ? ymd(y + 1, 1, day) : ymd(y, m + 1, day);
}

/**
 * THE instalment ledger for one monthly pledge.
 *
 *  1. Instalments are the pledge's due dates — its due_day (clamped 1..28) in
 *     the church's calendar — from the first one on or after its creation,
 *     onward: through `through` (default today), and further while money
 *     remains to pre-pay them, ending with the first incomplete one after
 *     that — so "the earliest incomplete instalment" always exists.
 *  2. The pledge's payments (others' are ignored) are poured in payment order
 *     — by instant, then transaction id — into the OLDEST incomplete
 *     instalment first: a payment larger than what is left of one spills
 *     into the next, money beyond everything due so far pre-pays future
 *     instalments, a partial payment leaves one partly covered. Every
 *     succeeded payment counts — gifts, scheduled charges, confirmed claims —
 *     over the pledge's whole history.
 *  3. Each instalment's status — kept, late, missed, due, upcoming — is read
 *     against `today` (YYYY-MM-DD, the church's day) as InstalmentStatus
 *     says.
 *
 * A total pledge, or a monthly one with no positive amount, has none. Status
 * (paused / cancelled) is not consulted here: callers decide what a paused or
 * cancelled pledge shows. Known limit: pause history is not recorded, so a
 * pledge that was paused for a while still has those due dates.
 */
export function allocateInstalments(
  p: StatementPledgeInput,
  payments: LedgerPaymentInput[],
  today: string,
  through: string = today,
): Instalment[] {
  const amount = p.amount_minor ?? 0;
  if (p.shape !== "monthly" || amount <= 0) return [];
  const day = Math.min(28, Math.max(1, Math.trunc(p.due_day ?? DEFAULT_DUE_DAY)));

  const mine = payments
    .filter((x) => x.pledge_id === p.pledge_id && x.amount_minor > 0)
    .flatMap((x) => {
      const on = partnerDate(x.at);
      if (on === null) return [];
      const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(x.at.trim()) ? `${x.at.trim()}T00:00:00+03:00` : x.at).getTime();
      return [{ on, t, id: x.transaction_id ?? "", amount: x.amount_minor }];
    })
    .sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // Cumulative money after each payment, and the date it arrived.
  let running = 0;
  const cumulative = mine.map((x) => ({ on: x.on, total: (running += x.amount) }));
  const total = running;

  // A pledge with no recorded creation starts with the earliest year in play.
  const created = partnerDate(p.created_at);
  const start = created ?? `${Math.min(Number(today.slice(0, 4)), Number(through.slice(0, 4)), ...mine.map((x) => Number(x.on.slice(0, 4))))}-01-01`;
  const horizon = through > today ? through : today;

  const out: Instalment[] = [];
  let due = firstDueOnOrAfter(start, day);
  let dueSoFar = 0;
  let seenIncomplete = false;
  while (out.length < MAX_INSTALMENTS && !(due > horizon && seenIncomplete)) {
    const before = dueSoFar;
    dueSoFar += amount;
    const covered = Math.max(0, Math.min(amount, total - before));
    const completedOn = total >= dueSoFar ? cumulative.find((c) => c.total >= dueSoFar)!.on : null;
    const status: InstalmentStatus = completedOn !== null
      ? (completedOn <= due ? "kept" : "late")
      : due < today ? "missed" : due === today ? "due" : "upcoming";
    out.push({ due, amount_minor: amount, covered_minor: covered, completed_on: completedOn, status });
    if (completedOn === null) seenIncomplete = true;
    due = nextMonthly(due, day);
  }
  return out;
}

/** A pledge's instalments due in `year`, allocated over its whole history. */
export function instalmentsInYear(
  p: StatementPledgeInput,
  payments: LedgerPaymentInput[],
  year: number,
  today: string,
): Instalment[] {
  const prefix = `${year}-`;
  return allocateInstalments(p, payments, today, `${year}-12-31`).filter((i) => i.due.startsWith(prefix));
}

/** Faithfulness over instalments: kept (on time), late, missed, and
 *  due_count = the resolved ones (kept + late + missed). Due-today and
 *  upcoming instalments are not counted; a pre-paid future one is (kept). */
export function instalmentFaithfulness(instalments: Instalment[]): StatementFaithfulness {
  const count = (s: InstalmentStatus): number => instalments.filter((i) => i.status === s).length;
  const kept_on_time = count("kept");
  const late = count("late");
  const missed = count("missed");
  return { kept_on_time, late, missed, due_count: kept_on_time + late + missed };
}

/** A month's status from the instalments due in it: none when nothing is
 *  due; else the worst of them — missed, then due/upcoming (the month is not
 *  over for someone), then late, then kept. With one monthly pledge it IS
 *  that pledge's instalment status (due reads as upcoming). */
export function monthStatus(instalments: Instalment[]): StatementMonthStatus {
  if (instalments.reduce((a, i) => a + i.amount_minor, 0) <= 0) return "none";
  const has = (s: InstalmentStatus): boolean => instalments.some((i) => i.status === s);
  if (has("missed")) return "missed";
  if (has("due") || has("upcoming")) return "upcoming";
  if (has("late")) return "late";
  return "kept";
}

/** The monthly pledges the strip and faithfulness read: not cancelled (as
 *  §3a's Pledged reads them). */
function stripPledges(pledges: StatementPledgeInput[]): StatementPledgeInput[] {
  return pledges.filter((p) => p.shape === "monthly" && p.status !== "cancelled");
}

/** The twelve-month strip for `year` (§3d), January first, from each monthly
 *  pledge's instalment ledger (not cancelled; a total pledge never drives
 *  it). due_minor = Σ the instalments due that month (Σ over the strip = Σ
 *  monthly pledgedInYear); paid_minor = Σ what the ledger allocated to them
 *  — so a late payment shows under the month it settled, not the month it
 *  arrived; status per `monthStatus`. `payments` are the pledges' succeeded
 *  payments over their whole history. */
export function statementMonths(
  year: number,
  pledges: StatementPledgeInput[],
  payments: LedgerPaymentInput[],
  today: string,
): StatementMonth[] {
  const all = stripPledges(pledges).flatMap((p) => instalmentsInYear(p, payments, year, today));
  const out: StatementMonth[] = [];
  for (let m = 1; m <= 12; m++) {
    const prefix = ymd(year, m, 1).slice(0, 8);
    const mine = all.filter((i) => i.due.startsWith(prefix));
    out.push({
      month: m,
      status: monthStatus(mine),
      due_minor: mine.reduce((a, i) => a + i.amount_minor, 0),
      paid_minor: mine.reduce((a, i) => a + i.covered_minor, 0),
    });
  }
  return out;
}

/** The statement's faithfulness: the same instalments the strip reads (every
 *  monthly pledge not cancelled), per instalment — so it foots with
 *  pledges[]: Σ kept = kept_on_time + late and Σ due_count = due_count. */
export function statementFaithfulness(
  year: number,
  pledges: StatementPledgeInput[],
  payments: LedgerPaymentInput[],
  today: string,
): StatementFaithfulness {
  return instalmentFaithfulness(stripPledges(pledges).flatMap((p) => instalmentsInYear(p, payments, year, today)));
}
