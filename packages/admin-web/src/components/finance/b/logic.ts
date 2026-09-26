// Finance ERP — the pure rules behind Pledges, Claims, Recurring gifts,
// Campaigns, Department needs, Expenses, Budgets, Reports and Statements
// (docs/FINANCE_ERP.md §5). No React and no I/O: every figure here is exact
// integer arithmetic on minor units (BigInt where a sum could grow), every date
// is an East Africa Time calendar day, and every sentence is the one the page
// shows before a consequential action. Each function is unit-tested on its own
// (test/financeBLogic.test.ts).
//
// The server stays the only author of money and status (§1.1): nothing here
// decides what a pledge, claim or expense IS — only how a page words it, sums
// a column it was given (always within one currency), or checks that a
// server-built table foots before it is trusted.
import {
  FINANCE_LIMITS,
  type AdminScheduleRow,
  type BooksBudgetLine,
  type BooksBudgetLineInput,
  type BooksExpense,
  type BooksExpenseInput,
  type BooksExpensePatch,
  type BudgetLineKind,
  type CampaignInput,
  type FinancePledgeRow,
  type FinanceReportMatrix,
  type IsoDate,
  type OfficeChannel,
  type PledgeClaimRow,
  type WriteCurrency,
} from "../../../api/finance";
import { compareCurrencies, formatMinor, minorToMajorInput, parseMajorToMinor, toMinorBigInt, type MinorInput } from "../money";
import { currentYearEAT, eatYmd, fmtDay, isIsoDate, isoDate, todayEAT } from "../dates";

/* ====================================================================== */
/* Dates                                                                    */
/* ====================================================================== */

export const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** A calendar day moved by `delta` days ("2026-03-01" − 1 → "2026-02-28"). */
export function addDaysIso(day: IsoDate, delta: number): IsoDate {
  if (!isIsoDate(day)) return day;
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Whole days from `a` to `b` (b − a); 0 when either is not a day. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  if (!isIsoDate(a) || !isIsoDate(b)) return 0;
  const [ay, am, ad] = a.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = b.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** The days an office entry may be dated (the books' rule, §2 "Dates"):
 *  [today − 366 days, today] in Nairobi. */
export function backdateWindow(now: Date = new Date(), days: number = FINANCE_LIMITS.backdateDays): { min: IsoDate; max: IsoDate } {
  const max = todayEAT(now);
  return { min: addDaysIso(max, -days), max };
}

/** Why `day` cannot be used as an office date, or null. */
export function backdateError(day: string, now: Date = new Date(), days: number = FINANCE_LIMITS.backdateDays): string | null {
  if (!isIsoDate(day)) return "Pick a date.";
  const w = backdateWindow(now, days);
  if (day > w.max) return "That date is in the future.";
  if (day < w.min) return `That is more than ${days} days ago — the books only accept the last ${days} days.`;
  return null;
}

/** The Nairobi calendar day of an instant ("2026-09-26T22:30:00Z" → "2026-09-27"); null when unreadable. */
export function eatDayOf(iso: string | null | undefined): IsoDate | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const { y, m, d } = eatYmd(t);
  return isoDate(y, m, d);
}

/** How long ago an instant was, for a queue's "age" column: "just now",
 *  "12 minutes", "5 hours", "3 days". */
export function ageSince(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const minutes = Math.max(0, Math.floor((now.getTime() - t) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.floor(hours / 24);
  return `${days} days`;
}

/** Years for a year picker that also plans ahead: next year, this year and
 *  `back` years before (newest first), plus any `extra` years (years that
 *  already have data), de-duplicated. */
export function planningYears(now: Date = new Date(), back = 4, extra: readonly number[] = []): number[] {
  const y = currentYearEAT(now);
  const set = new Set<number>([y + 1, y, ...Array.from({ length: back }, (_, i) => y - 1 - i), ...extra]);
  return [...set].sort((a, b) => b - a);
}

/** A `?year=` value → a year, else `fallback`. */
export function parseYear(raw: string | null | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 2000 && n <= 2999 ? n : fallback;
}

/* ====================================================================== */
/* Money helpers (one currency at a time)                                  */
/* ====================================================================== */

/** Σ of same-currency minor amounts, exact (BigInt), returned as a number. */
export function sumMinor(values: readonly (MinorInput | null | undefined)[]): number {
  let s = 0n;
  for (const v of values) s += toMinorBigInt(v ?? 0) ?? 0n;
  return Number(s);
}

/** floor(part × 100 / whole), clamped at 0; null when whole ≤ 0. For a
 *  progress bar's width and its "24%" label — display only. */
export function percentOf(part: MinorInput | null | undefined, whole: MinorInput | null | undefined): number | null {
  const p = toMinorBigInt(part ?? 0) ?? 0n;
  const w = toMinorBigInt(whole ?? 0) ?? 0n;
  if (w <= 0n) return null;
  const pct = (p * 100n) / w;
  return pct < 0n ? 0 : Number(pct);
}

/* ====================================================================== */
/* Recurring gifts — the "≈ per month" run-rate                             */
/* ====================================================================== */

/** A schedule's yearly amount: weekly × 52, monthly × 12; null for a
 *  frequency this page does not know (it is then left out of the run-rate). */
export function scheduleAnnualMinor(amount_minor: MinorInput, frequency: string): bigint | null {
  const a = toMinorBigInt(amount_minor);
  if (a === null) return null;
  const f = frequency.trim().toLowerCase();
  if (f === "weekly") return a * 52n;
  if (f === "monthly") return a * 12n;
  return null;
}

/** A yearly amount ÷ 12, rounded half up — integer minor units. */
export function perMonthFromAnnual(annual: bigint): bigint {
  if (annual >= 0n) return (annual + 6n) / 12n;
  return -((-annual + 6n) / 12n);
}

export interface RecurringTotal {
  currency: string;
  /** Schedules in the selection, any status. */
  count: number;
  /** Of those, active — the only ones that bring money in. */
  active: number;
  /** ≈ per month from the ACTIVE schedules: (Σ weekly × 52 + Σ monthly × 12) ÷ 12, rounded. */
  monthly_minor: number;
  /** Active schedules with a frequency the run-rate could not read. */
  unknown: number;
}

/** Per-currency count and run-rate of a schedule list, KES first. The
 *  run-rate sums each currency's year first and divides once, so rounding
 *  happens once per currency, not once per schedule. */
export function recurringTotals(rows: readonly Pick<AdminScheduleRow, "amount_minor" | "currency" | "frequency" | "status">[]): RecurringTotal[] {
  const by = new Map<string, { count: number; active: number; annual: bigint; unknown: number }>();
  for (const r of rows) {
    const code = r.currency.trim().toUpperCase();
    const t = by.get(code) ?? { count: 0, active: 0, annual: 0n, unknown: 0 };
    t.count += 1;
    if (r.status === "active") {
      t.active += 1;
      const annual = scheduleAnnualMinor(r.amount_minor, r.frequency);
      if (annual === null) t.unknown += 1;
      else t.annual += annual;
    }
    by.set(code, t);
  }
  return [...by.entries()]
    .sort(([a], [b]) => compareCurrencies(a, b))
    .map(([currency, t]) => ({ currency, count: t.count, active: t.active, monthly_minor: Number(perMonthFromAnnual(t.annual)), unknown: t.unknown }));
}

/* ====================================================================== */
/* Pledges                                                                  */
/* ====================================================================== */

/** "KES 5,000.00 a month" / "KES 120,000.00 by 31 Dec 2026". */
export function pledgeTermsText(p: Pick<FinancePledgeRow, "shape" | "amount_minor" | "target_minor" | "currency" | "due_on">): string {
  if (p.shape === "monthly") return `${formatMinor(p.amount_minor, p.currency)} a month`;
  return `${formatMinor(p.target_minor, p.currency)}${p.due_on ? ` by ${fmtDay(p.due_on)}` : ""}`;
}

/** Kept of due, as the register counts it ("7 of 9"); total pledges have no
 *  instalments, so "—". */
export function keptOfDue(p: Pick<FinancePledgeRow, "shape" | "kept" | "due_count">): string {
  if (p.shape !== "monthly") return "—";
  return `${p.kept} of ${p.due_count}`;
}

export interface FaithfulnessSummary {
  /** The member's overall standing as of today: behind when any pledge is. */
  standing: "behind" | "on_track" | "fulfilled" | "paused" | "none";
  /** Σ kept / Σ due over the member's monthly pledges in the year. */
  kept: number;
  due: number;
  monthly: number;
  /** The earliest date any of their (not cancelled) pledges has been overdue since. */
  overdueSince: IsoDate | null;
  /** Per currency (KES first): pledged / paid / remaining in the year, and how many pledges.
   *  paid = paid_toward + paid_beyond and pledged = paid_toward + remaining. */
  totals: { currency: string; pledged_minor: number; paid_minor: number; remaining_minor: number; paid_toward_minor: number; paid_beyond_minor: number; count: number }[];
}

/** One member's pledge-register rows, summed for the partner drawer's
 *  faithfulness strip. Counts and same-currency sums only — the standing,
 *  kept, due and overdue dates are the server's, per pledge. */
export function faithfulnessSummary(rows: readonly FinancePledgeRow[]): FaithfulnessSummary {
  const live = rows.filter((r) => r.status !== "cancelled");
  const monthly = live.filter((r) => r.shape === "monthly");
  let standing: FaithfulnessSummary["standing"] = "none";
  if (live.some((r) => r.standing === "behind")) standing = "behind";
  else if (live.some((r) => r.standing === "on_track")) standing = "on_track";
  else if (live.length > 0 && live.every((r) => r.standing === "fulfilled")) standing = "fulfilled";
  else if (live.length > 0) standing = "paused";
  const overdue = live.map((r) => r.overdue_since).filter((d): d is string => typeof d === "string" && isIsoDate(d)).sort();
  const by = new Map<string, { pledged: bigint; paid: bigint; remaining: bigint; toward: bigint; beyond: bigint; count: number }>();
  for (const r of rows) {
    const code = r.currency.trim().toUpperCase();
    const t = by.get(code) ?? { pledged: 0n, paid: 0n, remaining: 0n, toward: 0n, beyond: 0n, count: 0 };
    const pledged = toMinorBigInt(r.pledged_year_minor) ?? 0n;
    const paid = toMinorBigInt(r.paid_year_minor) ?? 0n;
    t.pledged += pledged;
    t.paid += paid;
    t.remaining += toMinorBigInt(r.remaining_year_minor) ?? 0n;
    // Row by row: pledged = toward + remaining, paid = toward + beyond — so the
    // strip foots even when a cancelled pledge (promise 0) was paid this year.
    t.toward += paid < pledged ? paid : pledged;
    t.beyond += paid > pledged ? paid - pledged : 0n;
    t.count += 1;
    by.set(code, t);
  }
  return {
    standing,
    kept: monthly.reduce((n, r) => n + r.kept, 0),
    due: monthly.reduce((n, r) => n + r.due_count, 0),
    monthly: monthly.length,
    overdueSince: overdue[0] ?? null,
    totals: [...by.entries()]
      .sort(([a], [b]) => compareCurrencies(a, b))
      .map(([currency, t]) => ({ currency, pledged_minor: Number(t.pledged), paid_minor: Number(t.paid), remaining_minor: Number(t.remaining), paid_toward_minor: Number(t.toward), paid_beyond_minor: Number(t.beyond), count: t.count })),
  };
}

/* ====================================================================== */
/* Claims                                                                   */
/* ====================================================================== */

/** What confirming a claim does, in the office's words (§5 Claims). */
export function claimConfirmConsequence(c: Pick<PledgeClaimRow, "amount_minor" | "currency" | "pledge_title" | "full_name">, fundName: string | null): string {
  const amount = formatMinor(c.amount_minor, c.currency);
  const where = fundName ? fundName : "the fund the pledge pays to";
  return `Records ${amount} to ${where} and counts it toward “${c.pledge_title}”. ${c.full_name} gets a receipt. A mistake is corrected later by reversing the gift in Transactions.`;
}

/** What rejecting a claim does. */
export function claimRejectConsequence(c: Pick<PledgeClaimRow, "amount_minor" | "currency" | "full_name">): string {
  return `Rejects ${c.full_name}’s claim of ${formatMinor(c.amount_minor, c.currency)}. Nothing is recorded, and they are told the office could not confirm it.`;
}

/* ====================================================================== */
/* Expenses — maker-checker                                                 */
/* ====================================================================== */

/** The one sentence for "you may not approve this" — shown in place of the
 *  button, and for a 403 SAME_PERSON from the server. */
export const SAME_PERSON_SENTENCE = "Another person must approve this expense — whoever recorded or edited it cannot approve it.";

/** Everyone who counts as a maker of the expense: its recorder plus anyone who
 *  edited it while it was recorded (the server's rule, §2 "Maker-checker"). */
export function expenseMakers(e: Pick<BooksExpense, "recorded_by">, editors: readonly (string | null | undefined)[] = []): Set<string> {
  const s = new Set<string>();
  if (e.recorded_by) s.add(e.recorded_by);
  for (const x of editors) if (x) s.add(x);
  return s;
}

export interface ApproveGate {
  /** Show the Approve button. */
  show: boolean;
  /** Why it is not shown to someone who could otherwise approve (maker-checker), else null. */
  blocked: string | null;
}

/**
 * Whether this person sees Approve on this expense. Only a recorded expense
 * can be approved, and only with finance:approve (hidden while /me loads). A
 * maker (recorder or editor) never sees it — they get the sentence instead —
 * unless they are a SuperAdmin (who may approve their own). When the page does
 * not know who "me" is, the button shows and the server's SAME_PERSON answer
 * is mapped to the same sentence.
 */
export function approveGate(args: {
  expense: Pick<BooksExpense, "status" | "recorded_by">;
  canApprove: boolean;
  me: string | null;
  isSuperAdmin: boolean;
  editors?: readonly (string | null | undefined)[] | undefined;
}): ApproveGate {
  const { expense, canApprove, me, isSuperAdmin } = args;
  if (!canApprove || expense.status !== "recorded") return { show: false, blocked: null };
  if (isSuperAdmin || !me) return { show: true, blocked: null };
  const editors = args.editors ?? [];
  if (expense.recorded_by === me) return { show: false, blocked: "You recorded this expense, so another person must approve it." };
  if (editors.includes(me)) return { show: false, blocked: "You edited this expense, so another person must approve it." };
  return { show: true, blocked: null };
}

/** What approving posts: "Posts KES 1,500.00 out of General Fund via Cash on 26 Sep 2026." */
export function approveConsequence(e: Pick<BooksExpense, "amount_minor" | "currency" | "fund" | "channel" | "spent_on">, channelName: string): string {
  return `Posts ${formatMinor(e.amount_minor, e.currency)} out of ${e.fund.name} via ${channelName} on ${fmtDay(e.spent_on)}. The fund's balance drops by that amount.`;
}

/** What voiding does — a reversing entry only when it was approved (posted). */
export function voidConsequence(e: Pick<BooksExpense, "status" | "amount_minor" | "currency" | "fund">): string {
  if (e.status === "approved") {
    return `Posts the reversing entry — ${e.fund.name} gets ${formatMinor(e.amount_minor, e.currency)} back. The expense stays on the register as void, with your reason.`;
  }
  return "Nothing was posted yet, so nothing is reversed. The expense stays on the register as void, with your reason.";
}

/** A fund's balance in one currency (0 when it holds none) — from the
 *  per-currency balances GET /admin/finance/funds reports. */
export function fundBalanceIn(balances: readonly { currency: string; balance_minor: number }[], currency: string): number {
  const code = currency.trim().toUpperCase();
  return balances.find((b) => b.currency.trim().toUpperCase() === code)?.balance_minor ?? 0;
}

export interface FundImpact {
  before: number;
  after: number;
  /** "General Fund balance: KES 120,000.00 → KES 105,000.00 after this." */
  sentence: string;
  /** Set when the fund ends below zero — the action is still allowed (the money
   *  really left), but the person is told plainly first. */
  warning: string | null;
}

/**
 * What an expense posting does to its fund, in the expense's currency:
 * approving takes the amount out, voiding an approved expense puts it back.
 * The server allows an approval to overdraw a fund (the money has already
 * gone), so a negative result is a warning, never a block.
 */
export function fundImpact(args: { fundName: string; currency: string; balance_minor: number; amount_minor: number; action: "approve" | "void" }): FundImpact {
  const before = toMinorBigInt(args.balance_minor) ?? 0n;
  const amount = toMinorBigInt(args.amount_minor) ?? 0n;
  const after = args.action === "approve" ? before - amount : before + amount;
  const cur = args.currency;
  const sentence = `${args.fundName} balance: ${formatMinor(before, cur)} → ${formatMinor(after, cur)} after this.`;
  let warning: string | null = null;
  if (after < 0n) {
    warning =
      args.action === "approve"
        ? `${args.fundName} will be ${formatMinor(-after, cur)} overdrawn — approve only if the money has really left.`
        : `${args.fundName} will still be ${formatMinor(-after, cur)} overdrawn after this.`;
  }
  return { before: Number(before), after: Number(after), sentence, warning };
}

/** How an expense was paid — the books' office channels, in the office's words. */
export const EXPENSE_CHANNELS: readonly { value: OfficeChannel; label: string }[] = [
  { value: "onhand", label: "Cash" },
  { value: "bank", label: "Bank" },
  { value: "cheque", label: "Cheque" },
  { value: "mpesa", label: "M-Pesa" },
  { value: "other", label: "Other" },
];

/** The record / edit form as typed. */
export interface ExpenseFormValues {
  fund: string;
  category: string;
  payee: string;
  description: string;
  /** Major units as typed. */
  amount: string;
  currency: WriteCurrency;
  spent_on: string;
  channel: OfficeChannel | "";
  reference: string;
}

export type ExpenseFormErrors = Partial<Record<keyof ExpenseFormValues, string>>;

/** The books' expense rules (BooksExpenseInput), checked before sending so the
 *  form can point at the field: a fund and category, a payee of 2–120
 *  characters, a description ≤ 500, an amount within 1..1,000,000,000 minor,
 *  spent on within [today − 366 days, today] (EAT), how it was paid, and a
 *  reference ≤ 80. */
export function validateExpenseForm(f: ExpenseFormValues, now: Date = new Date()): { errors: ExpenseFormErrors; body: BooksExpenseInput | null } {
  const errors: ExpenseFormErrors = {};
  const payee = f.payee.trim();
  const description = f.description.trim();
  const reference = f.reference.trim();
  if (!f.fund) errors.fund = "Choose the fund it is paid from.";
  if (!f.category) errors.category = "Choose a category.";
  if (payee.length < FINANCE_LIMITS.payee.min || payee.length > FINANCE_LIMITS.payee.max) errors.payee = `Who was paid — ${FINANCE_LIMITS.payee.min}–${FINANCE_LIMITS.payee.max} characters.`;
  if (description.length > 500) errors.description = "At most 500 characters.";
  const amount = parseMajorToMinor(f.amount, { max: FINANCE_LIMITS.amountMaxMinor });
  if (!amount.ok) errors.amount = amount.error;
  const dateError = backdateError(f.spent_on, now);
  if (dateError) errors.spent_on = dateError;
  if (!f.channel) errors.channel = "How was it paid?";
  if (reference.length > FINANCE_LIMITS.reference.max) errors.reference = `At most ${FINANCE_LIMITS.reference.max} characters.`;
  if (Object.keys(errors).length > 0 || !amount.ok || !f.channel) return { errors, body: null };
  return {
    errors,
    body: {
      fund: f.fund,
      category: f.category,
      payee,
      description: description || null,
      amount_minor: amount.minor,
      currency: f.currency,
      spent_on: f.spent_on,
      channel: f.channel,
      reference: reference || null,
    },
  };
}

/** An expense's saved values as the form shows them. */
export function expenseFormFrom(e: BooksExpense): ExpenseFormValues {
  return {
    fund: e.fund.code,
    category: e.category.code,
    payee: e.payee,
    description: e.description ?? "",
    amount: minorToMajorInput(e.amount_minor),
    currency: e.currency,
    spent_on: e.spent_on,
    channel: e.channel,
    reference: e.reference ?? "",
  };
}

/** Only what changed (PATCH sends at least one field — {} means nothing to save). */
export function expensePatch(original: BooksExpense, body: BooksExpenseInput): BooksExpensePatch {
  const p: BooksExpensePatch = {};
  if (body.fund !== original.fund.code) p.fund = body.fund;
  if (body.category !== original.category.code) p.category = body.category;
  if (body.payee !== original.payee) p.payee = body.payee;
  if ((body.description ?? null) !== (original.description ?? null)) p.description = body.description ?? null;
  if (body.amount_minor !== original.amount_minor) p.amount_minor = body.amount_minor;
  if (body.currency !== original.currency) p.currency = body.currency;
  if (body.spent_on !== original.spent_on) p.spent_on = body.spent_on;
  if (body.channel !== original.channel) p.channel = body.channel;
  if ((body.reference ?? null) !== (original.reference ?? null)) p.reference = body.reference ?? null;
  return p;
}

/* ====================================================================== */
/* Budgets — the lines editor                                               */
/* ====================================================================== */

/** One editable budget line: amounts are the text typed (major units). */
export interface DraftLine {
  /** Local key (a line_id once saved). */
  key: string;
  kind: BudgetLineKind;
  /** Fund code ("" = none: required for income, optional — church-wide — for expense). */
  fund: string;
  /** Expense category code ("" for income lines). */
  category: string;
  label: string;
  /** 12 texts, January first; "" reads as 0. */
  months: string[];
}

export type CellParse = { ok: true; minor: number } | { ok: false; error: string };

/** A budget month as typed → minor units. Unlike a gift, a month may be 0
 *  (blank reads as 0). Otherwise the money rules: ≤ 2 decimals, a full stop
 *  for decimals, at most FINANCE_LIMITS.budgetMonthMaxMinor. */
export function parseBudgetCell(text: string): CellParse {
  const s = text.trim();
  if (s === "") return { ok: true, minor: 0 };
  if (/^\+?0*(?:\.0{0,2})?$/.test(s) && /\d/.test(s)) return { ok: true, minor: 0 };
  const p = parseMajorToMinor(s, { max: FINANCE_LIMITS.budgetMonthMaxMinor });
  return p.ok ? { ok: true, minor: p.minor } : { ok: false, error: p.error };
}

/** Spread a yearly amount evenly over 12 months: floor(annual ÷ 12) each, the
 *  remainder on December — the months always add back to exactly `annual`. */
export function spreadAnnual(annual_minor: number): number[] {
  const a = BigInt(Math.max(0, Math.trunc(annual_minor)));
  const base = a / 12n;
  const rest = a - base * 12n;
  return Array.from({ length: 12 }, (_, i) => Number(i === 11 ? base + rest : base));
}

/** The 12 month texts for a spread (for the grid's inputs). */
export function spreadAnnualTexts(annual_minor: number): string[] {
  return spreadAnnual(annual_minor).map((v) => minorToMajorInput(v));
}

/** A line's months parsed (0 where a cell does not parse). */
export function lineMonthsMinor(line: Pick<DraftLine, "months">): number[] {
  return Array.from({ length: 12 }, (_, i) => {
    const p = parseBudgetCell(line.months[i] ?? "");
    return p.ok ? p.minor : 0;
  });
}

/** Σ of a line's 12 months (exact). */
export function lineTotalMinor(line: Pick<DraftLine, "months">): number {
  return sumMinor(lineMonthsMinor(line));
}

/** Σ of every line of a kind (exact; KES — budgets have one currency). */
export function kindTotalMinor(lines: readonly DraftLine[], kind: BudgetLineKind): number {
  return sumMinor(lines.filter((l) => l.kind === kind).map((l) => lineTotalMinor(l)));
}

export interface LineIssues {
  label: string | null;
  fund: string | null;
  category: string | null;
  /** One entry per month (null = fine). */
  months: (string | null)[];
  /** Overlap with another line (the no-double-count rule). */
  overlap: string | null;
}

export interface BudgetValidation {
  ok: boolean;
  /** Keyed by DraftLine.key; only lines with a problem. */
  issues: Record<string, LineIssues>;
  /** A page-level problem (too many lines). */
  summary: string | null;
  /** The PUT body, only when ok. */
  payload: BooksBudgetLineInput[] | null;
}

const hasIssue = (i: LineIssues): boolean => Boolean(i.label || i.fund || i.category || i.overlap || i.months.some(Boolean));

/**
 * The books' line rules (PUT /budgets/:id/lines), checked before saving so the
 * grid can point at the cell: 12 amounts each ≥ 0 and ≤ the month bound; an
 * income line names a fund and no category; an expense line names a category
 * (a fund is optional); a label of 2–80 characters; at most 200 lines; and no
 * overlaps, so no shilling is budgeted twice — one income line per fund, and
 * per expense category either ONE church-wide line or lines for distinct funds,
 * never both.
 */
export function validateBudgetLines(lines: readonly DraftLine[]): BudgetValidation {
  const issues: Record<string, LineIssues> = {};
  const { min: labelMin, max: labelMax } = FINANCE_LIMITS.budgetLabel;
  const blank = (): LineIssues => ({ label: null, fund: null, category: null, months: Array.from({ length: 12 }, () => null), overlap: null });

  // Overlap bookkeeping.
  const incomeFunds = new Map<string, string[]>();
  const expenseByCategory = new Map<string, { churchWide: string[]; byFund: Map<string, string[]> }>();

  for (const l of lines) {
    const i = blank();
    const label = l.label.trim();
    if (label.length < labelMin || label.length > labelMax) i.label = `A label of ${labelMin}–${labelMax} characters.`;
    if (l.kind === "income") {
      if (!l.fund) i.fund = "An income line names the fund it comes into.";
      if (l.category) i.category = "An income line has no expense category.";
      if (l.fund) incomeFunds.set(l.fund, [...(incomeFunds.get(l.fund) ?? []), l.key]);
    } else {
      if (!l.category) i.category = "An expense line names its category.";
      if (l.category) {
        const e = expenseByCategory.get(l.category) ?? { churchWide: [], byFund: new Map<string, string[]>() };
        if (l.fund) e.byFund.set(l.fund, [...(e.byFund.get(l.fund) ?? []), l.key]);
        else e.churchWide.push(l.key);
        expenseByCategory.set(l.category, e);
      }
    }
    if (l.months.length !== 12) {
      i.months = Array.from({ length: 12 }, () => "Every line has 12 months.");
    } else {
      l.months.forEach((text, m) => {
        const p = parseBudgetCell(text);
        if (!p.ok) i.months[m] = p.error;
      });
    }
    issues[l.key] = i;
  }

  for (const keys of incomeFunds.values()) {
    if (keys.length > 1) for (const k of keys) (issues[k] as LineIssues).overlap = "Another income line already budgets this fund — one line per fund.";
  }
  for (const e of expenseByCategory.values()) {
    if (e.churchWide.length > 1) {
      for (const k of e.churchWide) (issues[k] as LineIssues).overlap = "This category already has a church-wide line.";
    }
    if (e.churchWide.length > 0 && e.byFund.size > 0) {
      for (const k of [...e.churchWide, ...[...e.byFund.values()].flat()]) {
        (issues[k] as LineIssues).overlap = "A category is budgeted either church-wide or per fund — not both.";
      }
    }
    for (const keys of e.byFund.values()) {
      if (keys.length > 1) for (const k of keys) (issues[k] as LineIssues).overlap = "Another line already budgets this category for this fund.";
    }
  }

  const summary = lines.length > FINANCE_LIMITS.budgetLines.max ? `A budget has at most ${FINANCE_LIMITS.budgetLines.max} lines.` : null;
  const withIssues: Record<string, LineIssues> = {};
  for (const [k, v] of Object.entries(issues)) if (hasIssue(v)) withIssues[k] = v;
  const ok = summary === null && Object.keys(withIssues).length === 0;
  return {
    ok,
    issues: withIssues,
    summary,
    payload: ok
      ? lines.map((l) => ({
          kind: l.kind,
          fund: l.fund ? l.fund : null,
          category: l.kind === "expense" ? l.category : null,
          label: l.label.trim(),
          monthly_minor: lineMonthsMinor(l),
        }))
      : null,
  };
}

/** A saved line → an editable one. Zero months show blank (the grid's
 *  placeholder reads 0). */
export function draftFromLine(line: BooksBudgetLine): DraftLine {
  return {
    key: line.line_id,
    kind: line.kind,
    fund: line.fund?.code ?? "",
    category: line.category?.code ?? "",
    label: line.label,
    months: Array.from({ length: 12 }, (_, i) => {
      const v = line.monthly_minor[i] ?? 0;
      return v === 0 ? "" : minorToMajorInput(v);
    }),
  };
}

/** Two editable line lists are the same budget (for the "unsaved changes" flag). */
export function sameLines(a: readonly DraftLine[], b: readonly DraftLine[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((l, i) => {
    const o = b[i];
    if (!o) return false;
    if (l.kind !== o.kind || l.fund !== o.fund || l.category !== o.category || l.label.trim() !== o.label.trim()) return false;
    const am = lineMonthsMinor(l);
    const bm = lineMonthsMinor(o);
    return am.every((v, m) => v === bm[m]) && l.months.every((t, m) => parseBudgetCell(t).ok === parseBudgetCell(o.months[m] ?? "").ok);
  });
}

/** How many months of `year` count as "to date" in Nairobi: all 12 for a past
 *  year, through this month for the current year, none for a future year. */
export function ytdMonthCount(year: number, now: Date = new Date()): number {
  const { y, m } = eatYmd(now);
  if (year < y) return 12;
  if (year > y) return 0;
  return m;
}

/** Σ of the first `months` values (exact). */
export function ytdSum(values: readonly number[], months: number): number {
  return sumMinor(values.slice(0, Math.max(0, Math.min(12, months))));
}

export type VarianceTone = "good" | "warn" | "neutral";

/** Variance = actual − budget. Income below budget and expense above budget
 *  are the warnings; the opposite is good; zero is neutral. */
export function varianceTone(kind: BudgetLineKind, variance_minor: number): VarianceTone {
  if (variance_minor === 0) return "neutral";
  if (kind === "income") return variance_minor < 0 ? "warn" : "good";
  return variance_minor > 0 ? "warn" : "good";
}

/** "+KES 1,000.00" / "-KES 500.00" / "KES 0.00" — a variance with its sign. */
export function signedMinor(amount_minor: number, currency: string | null, withCode = true): string {
  const s = formatMinor(amount_minor, currency, { withCode });
  return amount_minor > 0 ? `+${s}` : s;
}

/* ====================================================================== */
/* Reports — does a server table foot?                                      */
/* ====================================================================== */

type MatrixBlock = FinanceReportMatrix["currencies"][number];

/**
 * Check that a currency block of a report matrix adds up the way it says:
 * each row's months sum to its total, each month's rows sum to the totals
 * row, and the totals row's months sum to its total. Returns the problems
 * (empty = it foots). The page shows a warning instead of silently trusting
 * a table that does not add up.
 */
export function matrixProblems(block: MatrixBlock): string[] {
  const problems: string[] = [];
  const code = block.currency;
  for (const r of block.rows) {
    if (sumMinor(r.months) !== r.total_minor) problems.push(`${r.label}: the months add to ${formatMinor(sumMinor(r.months), code)}, the row says ${formatMinor(r.total_minor, code)}.`);
  }
  for (let m = 0; m < 12; m++) {
    const col = sumMinor(block.rows.map((r) => r.months[m] ?? 0));
    const tot = block.totals.months[m] ?? 0;
    if (col !== tot) problems.push(`${MONTH_LABELS[m]}: the rows add to ${formatMinor(col, code)}, the total says ${formatMinor(tot, code)}.`);
  }
  if (sumMinor(block.totals.months) !== block.totals.total_minor) {
    problems.push(`The months add to ${formatMinor(sumMinor(block.totals.months), code)}, the year total says ${formatMinor(block.totals.total_minor, code)}.`);
  }
  return problems;
}

/* ====================================================================== */
/* Statements                                                               */
/* ====================================================================== */

export type StatementKind = "giving" | "partners";

/** The toast for a statement PDF that does not exist (404). */
export function statementMissingText(kind: StatementKind, year: number): string {
  return `No ${kind === "partners" ? "partner" : "giving"} statement for ${year}`;
}

/* ====================================================================== */
/* Campaigns                                                                */
/* ====================================================================== */

export interface CampaignForm {
  title: string;
  blurb: string;
  image_url: string;
  fund: string;
  goal: string;
  currency: string;
  starts_on: string;
  ends_on: string;
  /** Text as typed; "" = no match. */
  match: string;
  match_pledger: string;
}

export interface CampaignFormErrors {
  title?: string;
  blurb?: string;
  image_url?: string;
  fund?: string;
  goal?: string;
  starts_on?: string;
  ends_on?: string;
  match?: string;
  match_pledger?: string;
}

/** The campaign rules (financial/campaigns.ts CampaignInput), checked first so
 *  the form can point at the field: title 3–120, blurb ≥ 10, an optional
 *  http(s) image URL, a fund, a goal, real dates with the end on or after the
 *  start, and a match only with the person who pledged it (both or neither). */
export function validateCampaignForm(f: CampaignForm): { errors: CampaignFormErrors; body: CampaignInput | null } {
  const errors: CampaignFormErrors = {};
  const title = f.title.trim();
  const blurb = f.blurb.trim();
  const image = f.image_url.trim();
  const pledger = f.match_pledger.trim();
  if (title.length < 3 || title.length > 120) errors.title = "A title of 3–120 characters.";
  if (blurb.length < 10) errors.blurb = "Say what the campaign is for — at least 10 characters.";
  if (image && !/^https?:\/\/\S+$/i.test(image)) errors.image_url = "A full web address starting with https://";
  if (!f.fund) errors.fund = "Choose the fund gifts go to.";
  const goal = parseMajorToMinor(f.goal);
  if (!goal.ok) errors.goal = goal.error;
  if (!isIsoDate(f.starts_on)) errors.starts_on = "Pick the start date.";
  if (!isIsoDate(f.ends_on)) errors.ends_on = "Pick the end date.";
  else if (isIsoDate(f.starts_on) && f.ends_on < f.starts_on) errors.ends_on = "A campaign cannot end before it starts.";
  let match: number | null = null;
  if (f.match.trim()) {
    const m = parseMajorToMinor(f.match);
    if (!m.ok) errors.match = m.error;
    else match = m.minor;
  }
  if (match !== null && pledger.length < 2) errors.match_pledger = "Name who pledged the match — a match nobody offered is never claimed.";
  if (match === null && !errors.match && pledger) errors.match = "Enter the match amount, or clear the pledger.";
  if (pledger && pledger.length > 120) errors.match_pledger = "At most 120 characters.";
  if (Object.keys(errors).length > 0 || !goal.ok) return { errors, body: null };
  return {
    errors,
    body: {
      title,
      blurb,
      image_url: image || null,
      fund: f.fund,
      goal_minor: goal.minor,
      currency: f.currency,
      starts_on: f.starts_on,
      ends_on: f.ends_on,
      match_minor: match,
      match_pledger: match === null ? null : pledger,
    },
  };
}
