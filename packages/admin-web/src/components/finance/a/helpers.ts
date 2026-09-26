// Finance ERP web pages (set A: Overview, Transactions, Funds, Ledger,
// Reconciliation, Audit, Settings) — the pure rules behind them. No React here:
// every sentence a treasurer reads before an action, every guard a form applies
// and every label a code turns into lives in this file, so each one is
// unit-tested (test/financeAHelpers.test.ts). docs/FINANCE_ERP.md is the spec.
import {
  FINANCE_LIMITS,
  financeErrorCode,
  financeErrorDetails,
  financeErrorMessage,
  type BooksGiftInput,
  type BooksJournal,
  type FinanceAlertKind,
  type FinanceTransactionRow,
  type IsoDate,
  type JournalKind,
  type OfficeChannel,
  type ReconciliationExceptionKind,
  type WriteCurrency,
} from "../../../api/finance";
import { formatMinor, toMinorBigInt } from "../money";
import { eatYmd, fmtDateTimeEAT, fmtDay, isIsoDate, isoDate, todayEAT } from "../dates";
import { channelLabel, type Tone } from "../kit";

/* ====================================================================== */
/* Small words                                                              */
/* ====================================================================== */

/** "1 gift" / "3 gifts". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/* ====================================================================== */
/* Comparisons                                                              */
/* ====================================================================== */

/** Whole-percent change from `previous` to `current`; null when there is
 *  nothing to compare with (previous is 0 — the figure is new). A display
 *  ratio, never money. */
export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** +12% / −8% / 0% / "—" (a true minus sign, so it reads as one in DM Mono). */
export function fmtPct(p: number | null): string {
  if (p === null) return "—";
  if (p === 0) return "0%";
  return p > 0 ? `+${p}%` : `−${Math.abs(p)}%`;
}

/** A chart axis label for a minor amount: 125_000_000 → "1.3M", 4_500_000 → "45k".
 *  Display only — the tooltips and tables carry the exact figure. */
export function compactMinor(minor: number): string {
  const major = minor / 100;
  const abs = Math.abs(major);
  const sign = major < 0 ? "−" : "";
  const trim = (s: string): string => s.replace(/\.0$/, "");
  if (abs >= 1_000_000_000) return `${sign}${trim((abs / 1_000_000_000).toFixed(1))}B`;
  if (abs >= 1_000_000) return `${sign}${trim((abs / 1_000_000).toFixed(1))}M`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}k`;
  return `${sign}${Math.round(abs)}`;
}

/* ====================================================================== */
/* Dates                                                                    */
/* ====================================================================== */

/** "2026-09-26" moved by `days` calendar days (exact; no time zone involved). */
export function addDaysIso(day: IsoDate, days: number): IsoDate {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** The window the books accept for an economic date: [today − days, today], EAT. */
export function backdateBounds(days: number, now: Date = new Date()): { min: IsoDate; max: IsoDate } {
  const today = todayEAT(now);
  return { min: addDaysIso(today, -days), max: today };
}

/** Why a picked day can't be used, or null. `what` names it in the sentence. */
export function dayError(value: string, bounds: { min: IsoDate; max: IsoDate }, what: string): string | null {
  if (!value) return `Pick the ${what}.`;
  if (!isIsoDate(value)) return `That is not a date — pick the ${what} from the calendar.`;
  if (value > bounds.max) return `The ${what} can't be in the future.`;
  if (value < bounds.min) return `The books take dates from ${fmtDay(bounds.min)} onwards — this one is older.`;
  return null;
}

/* ====================================================================== */
/* Office channels + references (POST /gifts)                               */
/* ====================================================================== */

export interface ChannelOption {
  value: OfficeChannel;
  label: string;
}

/** How the office received a gift (onhand = physical cash; mpesa = a payment
 *  made to the till/paybill and recorded here by hand). */
export const GIFT_CHANNELS: readonly ChannelOption[] = [
  { value: "onhand", label: "Cash on hand" },
  { value: "bank", label: "Bank" },
  { value: "cheque", label: "Cheque" },
  { value: "mpesa", label: "M-Pesa (paid by M-Pesa, recorded here)" },
  { value: "other", label: "Other" },
];

/** Where money sits (opening balances, the ledger's cash accounts). */
export const HOLDING_CHANNELS: readonly ChannelOption[] = [
  { value: "onhand", label: "Cash on hand (cash box / safe)" },
  { value: "bank", label: "Bank account" },
  { value: "cheque", label: "Cheques not yet banked" },
  { value: "mpesa", label: "M-Pesa till / paybill" },
  { value: "other", label: "Other" },
];

export interface ReferenceRule {
  label: string;
  required: boolean;
  placeholder: string;
  hint: string;
}

/** What the reference field is called and whether the books require it
 *  (BooksGiftInput.reference: required for mpesa, cheque and bank). */
export function referenceRule(channel: OfficeChannel): ReferenceRule {
  switch (channel) {
    case "mpesa":
      return { label: "M-Pesa code", required: true, placeholder: "SJK4H7T2QX", hint: "The 10-character code from the M-Pesa message." };
    case "cheque":
      return { label: "Cheque number", required: true, placeholder: "e.g. 004512", hint: "As printed on the cheque." };
    case "bank":
      return { label: "Bank reference", required: true, placeholder: "e.g. FT26269ABCD", hint: "The reference on the bank statement or deposit slip." };
    case "onhand":
      return { label: "Reference", required: false, placeholder: "Optional — envelope or register number", hint: "Optional." };
    case "other":
      return { label: "Reference", required: false, placeholder: "Optional", hint: "Optional — anything that helps find it later." };
  }
}

/** The field's text as it is typed: an M-Pesa code is upper-cased and loses
 *  its spaces on the way in (the books store it that way). */
export function normalizeReferenceInput(channel: OfficeChannel, raw: string): string {
  return channel === "mpesa" ? raw.toUpperCase().replace(/\s+/g, "") : raw;
}

/** Why the reference can't be used for this channel, or null. */
export function referenceError(channel: OfficeChannel, value: string): string | null {
  const v = value.trim();
  const rule = referenceRule(channel);
  if (!v) {
    if (!rule.required) return null;
    const what = channel === "mpesa" ? "an M-Pesa payment" : channel === "cheque" ? "a cheque" : "a bank payment";
    // "M-Pesa code" keeps its capitals; "Cheque number" reads "cheque number".
    const label = /^[A-Z][a-z]/.test(rule.label) && !rule.label.startsWith("M-Pesa") ? rule.label[0]!.toLowerCase() + rule.label.slice(1) : rule.label;
    return `Enter the ${label} — it is required for ${what}.`;
  }
  if (v.length > FINANCE_LIMITS.reference.max) return `At most ${FINANCE_LIMITS.reference.max} characters.`;
  if (channel === "mpesa" && !FINANCE_LIMITS.mpesaCodePattern.test(v.toUpperCase())) {
    return "An M-Pesa code is 8–12 letters and digits, like SJK4H7T2QX.";
  }
  return null;
}

/* ====================================================================== */
/* Record a gift — the form's rules                                        */
/* ====================================================================== */

export type GiverMode = "member" | "walkin" | "anonymous";

export interface GiftForm {
  mode: GiverMode;
  memberId: string | null;
  walkinName: string;
  walkinPhone: string;
  /** The amount as parsed by MoneyInput (null = not a usable amount yet). */
  amountMinor: number | null;
  currency: WriteCurrency;
  channel: OfficeChannel;
  reference: string;
  receivedOn: string;
  /** "" = none. */
  pledgeId: string;
  /** "" = none. */
  needId: string;
  /** The fund picked in the form ("" = none) — used only when nothing else decides. */
  fund: string;
  note: string;
}

export type GiftField = "giver" | "walkinName" | "walkinPhone" | "amount" | "reference" | "receivedOn" | "fund" | "note";
export type GiftErrors = Partial<Record<GiftField, string>>;

/** Who decides the fund: a pledge (its own fund), a need whose department has
 *  an active fund, or the person (the fund picker). The server applies the
 *  same order (POST /gifts: pledge → need's department fund → `fund`). */
export interface FundDecision {
  by: "pledge" | "need" | null;
  code: string | null;
  name: string | null;
}

export function giftFundDecision(
  pledge: { pays_to: { code: string; name: string } | null } | null,
  need: { fund_code: string | null } | null,
  fundName: (code: string) => string | null,
): FundDecision {
  if (pledge) return { by: "pledge", code: pledge.pays_to?.code ?? null, name: pledge.pays_to?.name ?? null };
  if (need && need.fund_code) return { by: "need", code: need.fund_code, name: fundName(need.fund_code) ?? need.fund_code };
  return { by: null, code: null, name: null };
}

/** The sentence that replaces the fund picker when something else decides it. */
export function fundDecisionText(d: FundDecision): string | null {
  if (d.by === "pledge") return `Booked to ${d.name ?? "the pledge's fund"} (the pledge's fund).`;
  if (d.by === "need") return `Booked to ${d.name ?? "the department's fund"} (the department's fund).`;
  return null;
}

/** Every reason the gift can't be recorded yet, per field (empty = ready). */
export function validateGift(f: GiftForm, ctx: { bounds: { min: IsoDate; max: IsoDate }; fundDecided: boolean }): GiftErrors {
  const e: GiftErrors = {};
  if (f.mode === "member" && !f.memberId) e.giver = "Choose the member who gave, or switch to Walk-in or Anonymous.";
  if (f.mode === "walkin") {
    const n = f.walkinName.trim();
    if (n.length < FINANCE_LIMITS.giverName.min) e.walkinName = "Enter the giver's name (at least 2 characters).";
    else if (n.length > FINANCE_LIMITS.giverName.max) e.walkinName = `At most ${FINANCE_LIMITS.giverName.max} characters.`;
    const p = f.walkinPhone.trim();
    if (p && (p.length < FINANCE_LIMITS.giverPhone.min || p.length > FINANCE_LIMITS.giverPhone.max)) {
      e.walkinPhone = `A phone number is ${FINANCE_LIMITS.giverPhone.min}–${FINANCE_LIMITS.giverPhone.max} characters.`;
    }
  }
  if (f.amountMinor === null) e.amount = "Enter the amount received.";
  const ref = referenceError(f.channel, f.reference);
  if (ref) e.reference = ref;
  const day = dayError(f.receivedOn, ctx.bounds, "day the money was received");
  if (day) e.receivedOn = day;
  if (!ctx.fundDecided && !f.fund) e.fund = "Choose the fund this gift goes to.";
  if (f.note.trim().length > FINANCE_LIMITS.note.max) e.note = `At most ${FINANCE_LIMITS.note.max} characters.`;
  return e;
}

/** The POST /gifts body for a valid form (call validateGift first). Exactly one
 *  giver mode is sent; the fund is the decided one when a pledge or need
 *  decides it (the server ignores it under a pledge anyway). */
export function buildGiftInput(f: GiftForm, idempotencyKey: string, decision: FundDecision): BooksGiftInput {
  const ref = f.reference.trim();
  const note = f.note.trim();
  const body: BooksGiftInput = {
    idempotency_key: idempotencyKey,
    amount_minor: f.amountMinor ?? 0,
    currency: f.currency,
    channel: f.channel,
    received_on: f.receivedOn,
    fund: decision.code ?? (f.fund || null),
    reference: ref ? (f.channel === "mpesa" ? ref.toUpperCase() : ref) : null,
    note: note || null,
  };
  if (f.mode === "member") {
    body.user_id = f.memberId;
    if (f.pledgeId) body.pledge_id = f.pledgeId;
  } else if (f.mode === "walkin") {
    body.giver_name = f.walkinName.trim();
    const phone = f.walkinPhone.trim();
    if (phone) body.giver_phone = phone;
  } else {
    body.anonymous = true;
  }
  if (f.needId && !f.pledgeId) body.need_id = f.needId;
  return body;
}

export interface GiftErrorView {
  message: string;
  /** DUPLICATE_RECEIPT names the transaction that already holds the code. */
  duplicateTransactionId: string | null;
  field: GiftField | null;
}

/** A failed POST /gifts, as plain sentences (the named codes the books use). */
export function giftErrorView(e: unknown): GiftErrorView {
  const code = financeErrorCode(e);
  const details = financeErrorDetails(e);
  switch (code) {
    case "DUPLICATE_RECEIPT":
      return {
        message:
          "That M-Pesa code is already in the books — the payment also arrived online, or the office recorded it before. Open the existing entry before recording anything.",
        duplicateTransactionId: typeof details?.transaction_id === "string" ? details.transaction_id : null,
        field: "reference",
      };
    case "INVALID_DATE":
      return { message: "The received date must be today or within the last 366 days.", duplicateTransactionId: null, field: "receivedOn" };
    case "INVALID_REFERENCE":
      return { message: "That is not an M-Pesa code — it is 8–12 letters and digits, like SJK4H7T2QX.", duplicateTransactionId: null, field: "reference" };
    case "CURRENCY_MISMATCH":
      return { message: "The gift must be in the same currency as the pledge or need it pays toward.", duplicateTransactionId: null, field: null };
    case "UNPROCESSABLE":
      return {
        message: financeErrorMessage(e, "Something in this gift can't be used — check the member, the fund, and the pledge or need."),
        duplicateTransactionId: null,
        field: null,
      };
    default:
      return { message: financeErrorMessage(e, "The gift was not recorded — try again."), duplicateTransactionId: null, field: null };
  }
}

/* ====================================================================== */
/* A member's payment that may still be in flight                           */
/* ====================================================================== */

/** The member's own processing / awaiting-payer transactions from the last
 *  `hours` hours, newest first — the office may be about to record the same
 *  M-Pesa payment by hand. */
export function pendingForMember(rows: readonly FinanceTransactionRow[], userId: string, now: Date = new Date(), hours = 48): FinanceTransactionRow[] {
  const since = now.getTime() - hours * 3_600_000;
  return rows
    .filter((r) => r.user_id === userId && (r.status === "processing" || r.status === "requires_action"))
    .filter((r) => {
      const t = new Date(r.created_at).getTime();
      return Number.isFinite(t) && t >= since;
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/** "10:42" when it was today (EAT), else "25 Sep 2026, 10:42". */
export function sinceEAT(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "—";
  const a = eatYmd(t);
  const b = eatYmd(now);
  const full = fmtDateTimeEAT(iso);
  if (a.y === b.y && a.m === b.m && a.d === b.d) return full.slice(full.lastIndexOf(", ") + 2);
  return full;
}

/** "a" / "an" by sound: an Airtel…, an M-Pesa… (a letter said "em"), a Card…. */
export function article(word: string): "a" | "an" {
  if (/^[aeiou]/i.test(word)) return "an";
  if (/^[FHLMNRSX](?:-|[A-Z])/.test(word)) return "an";
  return "a";
}

/** "An M-Pesa payment of KES 1,000.00 from Grace is still processing since 10:42 — it may be this same payment." */
export function pendingNoticeText(r: FinanceTransactionRow, now: Date = new Date()): string {
  const who = (r.full_name ?? r.display_name).trim().split(/\s+/)[0] || "this member";
  const label = channelLabel(r.channel);
  const art = article(label);
  const what = `${art === "an" ? "An" : "A"} ${label} payment of ${formatMinor(r.amount_minor, r.currency)} from ${who}`;
  const state = r.status === "requires_action" ? "is waiting for them to confirm" : "is still processing";
  return `${what} ${state} since ${sinceEAT(r.created_at, now)} — it may be this same payment.`;
}

/* ====================================================================== */
/* Reversals — the consequence, stated before the click                     */
/* ====================================================================== */

/** Only office gifts and confirmed claims (provider manual) that succeeded can
 *  be reversed here; provider payments are refunded at the provider. */
export function giftReversible(t: { provider: string; status: string; reversed_at?: string | null | undefined }): boolean {
  return t.provider === "manual" && t.status === "succeeded" && !t.reversed_at;
}

/** "Posts KES 1,000.00 back out of Tithe; the gift leaves Grace Wanjiru's
 *  statement and re-opens their instalment. …" */
export function giftReversalConsequence(t: {
  amount_minor: number;
  currency: string;
  fund: string | null;
  fund_name: string | null;
  user_id: string | null;
  full_name: string | null;
  display_name: string;
  pledge_title: string | null;
  receipt_code: string | null;
}): string {
  const money = formatMinor(t.amount_minor, t.currency);
  const fund = t.fund_name ?? t.fund ?? "its fund";
  const member = t.full_name ?? t.display_name;
  let s = `Posts ${money} back out of ${fund}`;
  if (t.user_id) {
    s += `; the gift leaves ${member}'s statement`;
    s += t.pledge_title ? ` and re-opens their instalment on “${t.pledge_title}”.` : ".";
  } else {
    s += ". It was not on any member's statement.";
  }
  if (t.receipt_code) s += ` The receipt number ${t.receipt_code} stays on the reversed entry and is never reused.`;
  s += " Nothing is deleted: the gift and its reversal both stay in the ledger.";
  return s;
}

export const JOURNAL_KIND_LABELS: Readonly<Record<JournalKind, string>> = {
  expense: "Expense",
  expense_void: "Expense void",
  transfer: "Transfer",
  opening: "Opening balance",
  reversal: "Reversal",
};

/** Why a journal can (or can't) be reversed here. */
export function journalReversibility(j: Pick<BooksJournal, "kind" | "reversed_by_journal_id">): { ok: boolean; reason: string | null } {
  if (j.kind === "expense" || j.kind === "expense_void") return { ok: false, reason: "An expense is corrected by voiding it on the Expenses page." };
  if (j.kind === "reversal") return { ok: false, reason: "A reversal is never reversed — post the right journal instead." };
  if (j.reversed_by_journal_id) return { ok: false, reason: "Already reversed." };
  return { ok: true, reason: null };
}

/** What reversing a transfer or an opening balance does, in the treasurer's words. */
export function journalReversalConsequence(j: Pick<BooksJournal, "kind" | "legs" | "totals" | "occurred_on">, label: (account: string) => string): string {
  const debit = j.legs.find((l) => l.side === "debit");
  const credit = j.legs.find((l) => l.side === "credit");
  const money = j.totals.length > 0 ? j.totals.map((x) => formatMinor(x.amount_minor, x.currency)).join(" + ") : "the amount";
  const when = fmtDay(j.occurred_on);
  if (j.kind === "transfer" && debit && credit) {
    return `Moves ${money} back from ${label(credit.account)} to ${label(debit.account)}, dated ${when} like the original. The transfer stays in the ledger, marked reversed; a reversal can't itself be undone.`;
  }
  if (j.kind === "opening" && debit && credit) {
    return `Takes the ${money} opening balance back out of ${label(credit.account)} and ${label(debit.account)}, dated ${when}. Post the correct opening balance afterwards; this can't be undone.`;
  }
  return `Posts the mirror of this journal (${money}), dated ${when}. This can't be undone.`;
}

/* ====================================================================== */
/* Funds + slugs                                                            */
/* ====================================================================== */

/** A permanent code suggested from a name: "Building Fund 2026" → "building-fund-2026". */
export function suggestCode(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/** Why a fund / category code can't be used, or null. */
export function codeError(code: string): string | null {
  if (!code) return "Enter a code.";
  if (!FINANCE_LIMITS.codePattern.test(code)) return "Lowercase letters, digits and hyphens, starting with a letter — 2 to 40 characters.";
  return null;
}

/** Trimmed length within [min, max], or why not. */
export function lengthError(value: string, bounds: { min?: number; max: number }, what: string): string | null {
  const n = value.trim().length;
  if (bounds.min !== undefined && n < bounds.min) return n === 0 ? `Enter ${what}.` : `${capitalise(what)} needs at least ${bounds.min} characters.`;
  if (n > bounds.max) return `At most ${bounds.max} characters.`;
  return null;
}

function capitalise(s: string): string {
  const t = s.replace(/^(a|an|the) /i, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** 422 with details.reason NEGATIVE_BALANCE (transfers, journal reversals). */
export function negativeBalance(e: unknown): { balance_minor: number | null; balance_after_minor: number | null } | null {
  const d = financeErrorDetails(e);
  if (!d || d.reason !== "NEGATIVE_BALANCE") return null;
  const num = (v: unknown): number | null => {
    const n = toMinorBigInt(typeof v === "number" || typeof v === "string" ? v : null);
    return n === null ? null : Number(n);
  };
  return { balance_minor: num(d.balance_minor), balance_after_minor: num(d.balance_after_minor) };
}

/** 409 FUND_IN_USE on PATCH /funds/:code {is_active:false}: money still routes
 *  to the fund. Resending with force: true deactivates it anyway. */
export interface FundInUse {
  active_pledges: number;
  active_schedules: number;
  departments: number;
  live_campaigns: number;
  /** The server's own sentence naming them (may be empty). */
  message: string;
}

export function fundInUse(e: unknown): FundInUse | null {
  if (financeErrorCode(e) !== "FUND_IN_USE") return null;
  const d = financeErrorDetails(e) ?? {};
  const n = (v: unknown): number => {
    const x = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0;
    return Number.isFinite(x) && x > 0 ? Math.trunc(x) : 0;
  };
  return {
    active_pledges: n(d.active_pledges),
    active_schedules: n(d.active_schedules),
    departments: n(d.departments),
    live_campaigns: n(d.live_campaigns),
    message: financeErrorMessage(e, ""),
  };
}

/** "a, b and c" */
export function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`;
}

/** "12 active pledges, 3 recurring gifts and 1 department still send money to
 *  Building fund — their payments will fail while it is inactive." */
export function fundInUseText(fundName: string, u: FundInUse): string {
  const parts: string[] = [];
  if (u.active_pledges > 0) parts.push(plural(u.active_pledges, "active pledge"));
  if (u.active_schedules > 0) parts.push(plural(u.active_schedules, "recurring gift"));
  if (u.departments > 0) parts.push(plural(u.departments, "department"));
  if (u.live_campaigns > 0) parts.push(plural(u.live_campaigns, "live campaign"));
  if (parts.length === 0) return u.message || `Money still routes to ${fundName} — payments to it will fail while it is inactive.`;
  const single = parts.length === 1 && (u.active_pledges + u.active_schedules + u.departments + u.live_campaigns === 1);
  return `${joinAnd(parts)} still ${single ? "sends" : "send"} money to ${fundName} — ${single ? "its" : "their"} payments will fail while it is inactive.`;
}

/* ====================================================================== */
/* Accounts                                                                 */
/* ====================================================================== */

/** The cash account an office channel posts to (other → cash:manual). */
export const CASH_ACCOUNT_FOR: Readonly<Record<OfficeChannel, string>> = {
  onhand: "cash:onhand",
  bank: "cash:bank",
  cheque: "cash:cheque",
  mpesa: "cash:mpesa",
  other: "cash:manual",
};

export const CASH_ACCOUNT_LABELS: Readonly<Record<string, string>> = {
  "cash:onhand": "Cash on hand",
  "cash:bank": "Bank",
  "cash:cheque": "Cheques",
  "cash:mpesa": "M-Pesa",
  "cash:manual": "Manual / other",
  "cash:stripe": "Card (Stripe)",
  "cash:airtel": "Airtel Money",
  "cash:paypal": "PayPal",
};

/** A ledger account in words: cash:mpesa → "M-Pesa", fund:tithe → "Tithe" (the fund's name when known). */
export function accountLabel(account: string, fundName?: (code: string) => string | null | undefined): string {
  if (account === "cash:") return "All cash accounts";
  if (account === "fund:") return "All funds";
  const cash = CASH_ACCOUNT_LABELS[account];
  if (cash) return cash;
  if (account.startsWith("fund:")) {
    const code = account.slice(5);
    return fundName?.(code) ?? code;
  }
  if (account === "sales:media") return "Media sales";
  if (account.startsWith("cash:")) return channelLabel(account.slice(5));
  return account;
}

/* ====================================================================== */
/* Overview alerts                                                          */
/* ====================================================================== */

export interface AlertCopy {
  title: (n: number) => string;
  hint: string;
  fallbackLink: string;
  tone: Tone;
}

export const ALERT_COPY: Readonly<Record<FinanceAlertKind, AlertCopy>> = {
  pending_claims: {
    title: (n) => `${plural(n, "claim")} waiting`,
    hint: "Members who say they paid another way — confirm or reject each one.",
    fallbackLink: "/finance/claims",
    tone: "warn",
  },
  expenses_awaiting_approval: {
    title: (n) => `${plural(n, "expense")} to approve`,
    hint: "Recorded but not posted — someone other than the recorder approves them.",
    fallbackLink: "/finance/expenses?status=recorded",
    tone: "warn",
  },
  failing_schedules: {
    title: (n) => `${plural(n, "recurring gift")} ${n === 1 ? "needs" : "need"} attention`,
    hint: "Paused, or the last collection failed.",
    fallbackLink: "/finance/recurring?attention=true",
    tone: "warn",
  },
  stale_processing: {
    title: (n) => `${plural(n, "payment")} stuck processing`,
    hint: "An M-Pesa prompt older than 30 minutes, or a card payment older than a day.",
    fallbackLink: "/finance/reconciliation?tab=exceptions",
    tone: "warn",
  },
  integrity_issues: {
    title: (n) => `${plural(n, "issue")} in the books`,
    hint: "Postings that are missing or don't balance — tell the developer; don't re-record.",
    fallbackLink: "/finance/reconciliation?tab=exceptions",
    tone: "error",
  },
  partners_behind: {
    title: (n) => `${plural(n, "partner")} behind`,
    hint: "A pledge instalment is overdue.",
    fallbackLink: "/finance/partners?status=behind",
    tone: "info",
  },
};

/** Only an in-app path is followed ("/finance/…"); anything else from the wire
 *  falls back to the kind's own route. Integrity always opens the exceptions. */
export function alertLink(kind: FinanceAlertKind, link: string | null | undefined): string {
  if (kind === "integrity_issues") return "/finance/reconciliation?tab=exceptions";
  const copy = ALERT_COPY[kind];
  if (typeof link === "string" && link.startsWith("/") && !link.startsWith("//")) return link;
  return copy.fallbackLink;
}

/* ====================================================================== */
/* Reconciliation exceptions                                                */
/* ====================================================================== */

export interface ExceptionCopy {
  title: string;
  explain: string;
  todo: string;
  tone: Tone;
}

/** Most serious first: money counted twice, then books that don't foot, then
 *  work in flight. */
export const EXCEPTION_ORDER: readonly ReconciliationExceptionKind[] = [
  "duplicate_receipt",
  "succeeded_without_ledger",
  "unbalanced_transaction",
  "unbalanced_journal",
  "refunded_without_reversal",
  "stale_processing",
  "failed",
];

export const EXCEPTION_COPY: Readonly<Record<ReconciliationExceptionKind, ExceptionCopy>> = {
  duplicate_receipt: {
    title: "Recorded twice",
    explain: "The same receipt is on two entries — usually the office recorded an M-Pesa payment that also arrived online.",
    todo: "Open the office entry and reverse it (reason: “Also received online”). The online payment stays.",
    tone: "error",
  },
  succeeded_without_ledger: {
    title: "Succeeded, but not in the books",
    explain: "The payment is marked succeeded but has no ledger postings, so no fund shows the money.",
    todo: "Tell the developer. Do not record the gift again by hand — it would be counted twice once fixed.",
    tone: "error",
  },
  unbalanced_transaction: {
    title: "Gift postings don't balance",
    explain: "The gift's debits and credits differ, so the ledger no longer foots.",
    todo: "Tell the developer. Don't reverse or re-record it yourself.",
    tone: "error",
  },
  unbalanced_journal: {
    title: "Journal doesn't balance",
    explain: "A journal whose debits and credits differ, or that has no postings at all.",
    todo: "Tell the developer. Don't post a correcting journal by hand.",
    tone: "error",
  },
  refunded_without_reversal: {
    title: "Refunded without a reversal",
    explain: "Marked refunded, but nothing was taken back out of the books — the fund still counts the money.",
    todo: "Tell the developer so the reversing entry is posted. Don't record anything by hand.",
    tone: "error",
  },
  stale_processing: {
    title: "Stuck processing",
    explain: "An M-Pesa or Airtel prompt older than 30 minutes, or a card / PayPal payment older than 24 hours, that never settled.",
    todo: "Check the M-Pesa statement (or the card dashboard). If the money arrived, wait — the confirmation usually lands. Don't record it by hand while it is processing.",
    tone: "warn",
  },
  failed: {
    title: "Failed in the period",
    explain: "The payer cancelled, had too little balance, or the provider refused. Nothing was posted.",
    todo: "Nothing to fix in the books. If the member says they paid, look for the code on the statement.",
    tone: "info",
  },
};

/* ====================================================================== */
/* Trial balance                                                            */
/* ====================================================================== */

export type TrialBalanceState = "balanced" | "unbalanced" | "empty";

export function trialBalanceState(tb: { data: readonly unknown[]; balanced: boolean }): TrialBalanceState {
  if (tb.data.length === 0) return "empty";
  return tb.balanced ? "balanced" : "unbalanced";
}

/* ====================================================================== */
/* Audit                                                                    */
/* ====================================================================== */

export const AUDIT_PREFIXES: readonly { value: string; label: string }[] = [
  { value: "", label: "All finance" },
  { value: "giving.", label: "Giving" },
  { value: "finance.", label: "Office (gifts, categories)" },
  { value: "pledge.", label: "Pledges & claims" },
  { value: "department.need", label: "Department needs" },
  { value: "expense.", label: "Expenses" },
  { value: "budget.", label: "Budgets" },
  { value: "journal.", label: "Journals" },
  { value: "fund.", label: "Funds" },
  { value: "webhook.", label: "Webhooks" },
  { value: "purchase.", label: "Purchases" },
];

const KNOWN_ACTIONS: Readonly<Record<string, string>> = {
  "finance.gift_recorded": "Recorded a gift",
  "finance.gift_reversed": "Reversed a gift",
  "finance.category_created": "Added an expense category",
  "finance.category_updated": "Changed an expense category",
  "fund.created": "Created a fund",
  "fund.updated": "Changed a fund",
  "journal.transfer_posted": "Moved money between funds",
  "journal.opening_posted": "Posted an opening balance",
  "journal.reversed": "Reversed a journal",
  "expense.recorded": "Recorded an expense",
  "expense.updated": "Corrected an expense",
  "expense.approved": "Approved an expense",
  "expense.voided": "Voided an expense",
  "budget.created": "Started a budget",
  "budget.updated": "Changed a budget",
  "budget.lines_replaced": "Replaced the budget lines",
  "budget.approved": "Approved a budget",
};

/** "expense.approved" → "Approved an expense"; unknown actions read as
 *  "Pledge · claim confirmed" (module · what happened). */
export function humanizeAction(action: string): string {
  const known = KNOWN_ACTIONS[action];
  if (known) return known;
  const dot = action.indexOf(".");
  if (dot <= 0) return action.replace(/_/g, " ");
  const head = action.slice(0, dot);
  const rest = action.slice(dot + 1).replace(/[._]+/g, " ").trim();
  return `${head.charAt(0).toUpperCase()}${head.slice(1)} · ${rest || head}`;
}

/** Where an audit row's entity can be opened on these pages, or null. */
export function auditEntityHref(entity: string, entityId: string | null): string | null {
  if (!entityId) return null;
  const e = entity.toLowerCase();
  if (e === "transactions" || e === "transaction") return `/finance/transactions?tx=${encodeURIComponent(entityId)}`;
  if (e === "journals" || e === "journal") return `/finance/ledger?tab=journals&journal=${encodeURIComponent(entityId)}`;
  return null;
}

/* ====================================================================== */
/* Expense categories — ordering                                            */
/* ====================================================================== */

/**
 * Move the category at `index` one place up (-1) or down (+1) and renumber the
 * whole list 10, 20, 30… so ties (a freshly seeded list is often all 0) can't
 * swallow the move. Returns only the categories whose sort changes — the PATCHes
 * to send — or [] when the move is out of range.
 */
export function reorderPlan<T extends { category_id: string; sort: number }>(list: readonly T[], index: number, dir: -1 | 1): { category_id: string; sort: number }[] {
  const target = index + dir;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [];
  const next = [...list];
  const a = next[index];
  const b = next[target];
  if (!a || !b) return [];
  next[index] = b;
  next[target] = a;
  return next.map((c, i) => ({ category_id: c.category_id, sort: (i + 1) * 10, was: c.sort })).filter((c) => c.sort !== c.was).map(({ category_id, sort }) => ({ category_id, sort }));
}

const scalar = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() ? v.trim() : null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  return null;
};
const clip = (s: string, n = 80): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The few facts from an audit row's metadata worth a column: money first,
 *  then receipt / reference / funds / reason, then any other plain values. */
export function auditDetails(metadata: Record<string, unknown> | null | undefined, max = 4): string[] {
  if (!metadata) return [];
  const out: string[] = [];
  const used = new Set<string>();
  const take = (key: string, render: (v: string) => string): void => {
    if (out.length >= max || used.has(key)) return;
    const v = scalar(metadata[key]);
    used.add(key);
    if (v !== null) out.push(render(v));
  };
  const amount = metadata.amount_minor;
  const currency = scalar(metadata.currency);
  if ((typeof amount === "number" || typeof amount === "string") && toMinorBigInt(amount) !== null) {
    out.push(formatMinor(amount, currency));
    used.add("amount_minor");
    used.add("currency");
  }
  take("receipt_code", (v) => `Receipt ${v}`);
  take("reference", (v) => `Ref ${v}`);
  // journal.transfer_posted records {from, to}; older rows used {from_fund, to_fund}.
  const fromKey = metadata.from_fund !== undefined ? "from_fund" : "from";
  const toKey = metadata.to_fund !== undefined ? "to_fund" : "to";
  const from = scalar(metadata[fromKey]);
  const to = scalar(metadata[toKey]);
  if (from && to && out.length < max) {
    out.push(`${from} → ${to}`);
    used.add(fromKey);
    used.add(toKey);
  }
  take("fund", (v) => `Fund ${v}`);
  take("reason", (v) => `“${clip(v)}”`);
  // Money lines carry their currency, so the bare currency key is not repeated.
  if (Object.keys(metadata).some((k) => k.endsWith("_minor"))) used.add("currency");
  for (const [k, v] of Object.entries(metadata)) {
    if (out.length >= max) break;
    if (used.has(k) || k.endsWith("_id") || k === "idempotency_key") continue;
    const s = scalar(v);
    if (s !== null && k.endsWith("_minor") && toMinorBigInt(s) !== null) {
      // Money in metadata is minor units — show it as money, never raw digits.
      out.push(`${k.slice(0, -"_minor".length).replace(/_/g, " ")}: ${formatMinor(s, currency ?? "KES")}`);
    } else if (s !== null) out.push(`${k.replace(/_/g, " ")}: ${clip(s, 40)}`);
    used.add(k);
  }
  return out;
}
