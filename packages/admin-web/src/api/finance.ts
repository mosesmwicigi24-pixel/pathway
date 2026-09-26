// Finance ERP — the typed API client (docs/FINANCE_ERP.md §4). Every call goes
// through the portal's one axios instance (`api` in client.ts: Bearer token,
// silent refresh on 401, /v1 base), so a Finance page never talks to the server
// any other way.
//
// Wire shapes are snake_case exactly as the OpenAPI contract names them
// (packages/shared/src/openapi/openapi.yaml, the "Finance ERP · reports" and
// "Finance ERP · books" sections). Money is always integer minor units with its
// ISO currency beside it — never a float, and never a sum across currencies.
import axios from "axios";
import {
  api,
  PartnersApi,
  type AdminScheduleRow,
  type FinanceConfig,
  type FundSummary,
  type PartnerDetail,
  type PartnerRow,
  type PartnerSort,
  type PartnerStatusFilter,
  type PartnersSummary,
  type PledgeClaimRow,
  type RemindBehindResult,
  type RemindResult,
} from "./client";

// The Partners / claims / schedules / summary / config shapes already live in
// client.ts (the Partners page uses them); re-exported so a Finance page
// imports everything from here.
export type {
  AdminScheduleRow,
  FinanceConfig,
  FundSummary,
  PartnerDetail,
  PartnerRow,
  PartnerSort,
  PartnerStatusFilter,
  PartnersSummary,
  PledgeClaimRow,
  RemindBehindResult,
  RemindResult,
};

/* ====================================================================== */
/* Common wire types                                                       */
/* ====================================================================== */

/** YYYY-MM-DD — an East Africa Time calendar day (the server's basis). */
export type IsoDate = string;
/** An ISO-8601 instant as the server serialises it. */
export type IsoDateTime = string;

/** FinanceCurrencyTotal — one currency's total over the WHOLE filtered set
 *  (every page, not just the rows loaded). Never a sum across currencies. */
export interface CurrencyTotal {
  currency: string;
  amount_minor: number;
  count: number;
}
/** FinanceCurrencyAmount. */
export interface CurrencyAmount {
  currency: string;
  amount_minor: number;
}
/** FinanceCurrencyBalance — credits − debits on a fund's account (negative when
 *  more left the fund than came in). */
export interface CurrencyBalance {
  currency: string;
  balance_minor: number;
}

/** The keyset-paged list envelope every register returns. `totals` cover the
 *  whole filtered set; pass `next_cursor` back as `cursor` (null = last page). */
export interface ListEnvelope<T, Tot extends CurrencyTotal = CurrencyTotal> {
  data: T[];
  next_cursor: string | null;
  totals: Tot[];
}

// Query shapes are `type` aliases (not interfaces) so a filters object can be
// handed straight to an ExportButton's `params` (QueryParams) as well.

/** Common list paging (Cursor + Limit parameters: limit ≤ 200, default 50). */
export type PageQuery = {
  cursor?: string | null | undefined;
  limit?: number | undefined;
};
/** Common period filter — inclusive EAT days. */
export type PeriodQuery = {
  from?: IsoDate | null | undefined;
  to?: IsoDate | null | undefined;
};

/** The common error envelope: `{ error: { code, message, request_id, details? } }`. */
export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    request_id?: string;
    details?: Record<string, unknown>;
  };
}

/* ====================================================================== */
/* Query params                                                            */
/* ====================================================================== */

/** A query value; a list is sent comma-joined (expenses ?status=recorded,approved). */
export type QueryValue = string | number | boolean | readonly string[] | null | undefined;
export type QueryParams = Record<string, QueryValue>;

/** Drop null / undefined / "" / [] so the URL carries only what was chosen and
 *  the server's own defaults apply to the rest. Words like "all" / "any" are
 *  kept: on some filters they are real values (needs ?status=all, ?pledged=any). */
export function cleanParams(params: QueryParams | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!params) return out;
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      const list = (v as readonly string[]).map((x) => x.trim()).filter(Boolean);
      if (list.length > 0) out[k] = list.join(",");
      continue;
    }
    if (typeof v === "string") {
      if (v.trim() !== "") out[k] = v.trim();
      continue;
    }
    out[k] = v as number | boolean;
  }
  return out;
}

/* ====================================================================== */
/* Errors                                                                   */
/* ====================================================================== */

function errorBody(e: unknown): ApiErrorBody["error"] | undefined {
  if (!axios.isAxiosError(e)) return undefined;
  const data = e.response?.data as ApiErrorBody | undefined;
  return data && typeof data === "object" ? data.error : undefined;
}

/** The server's error code (e.g. "DUPLICATE_RECEIPT", "SAME_PERSON"), or null. */
export function financeErrorCode(e: unknown): string | null {
  const code = errorBody(e)?.code;
  return typeof code === "string" && code ? code : null;
}

/** The error's `details` object (e.g. details.reason "NEGATIVE_BALANCE",
 *  details.balance_after_minor, details.transaction_id), or null. */
export function financeErrorDetails(e: unknown): Record<string, unknown> | null {
  const d = errorBody(e)?.details;
  return d && typeof d === "object" ? d : null;
}

/**
 * A sentence the office can act on. The server's own message wins — the books
 * write it for people ("That M-Pesa code is already the receipt of…"); then the
 * transport cases; then `fallback`. Use this rather than util/error.ts
 * errorMessage on Finance pages: that one answers every 403 with "You don't
 * have access to this cell."
 */
export function financeErrorMessage(e: unknown, fallback: string): string {
  if (!axios.isAxiosError(e)) return fallback;
  const status = e.response?.status;
  if (status === 401) return "Your session expired — please sign in again.";
  const raw = errorBody(e)?.message;
  const msg = typeof raw === "string" && raw.trim() ? raw.trim() : null;
  if (msg) return msg;
  if (status === 403) return "You don't have permission to do that.";
  if (!e.response) {
    return e.code === "ECONNABORTED"
      ? "The server took too long to answer — try again."
      : "Could not reach the server — check the connection and try again.";
  }
  if (status !== undefined && status >= 500) return `The server had a problem (${status}) — try again in a minute.`;
  return fallback;
}

/**
 * A download is fetched with responseType "blob", so a failure's body arrives
 * as a Blob, not JSON. Parse it back (in place) so financeErrorMessage /
 * financeErrorCode read the server's message exactly as for any other call.
 * A body that is not JSON (a proxy's HTML page) is dropped — the status-based
 * message is better than markup.
 */
export async function parseBlobError(e: unknown): Promise<unknown> {
  if (!axios.isAxiosError(e) || !e.response) return e;
  const data: unknown = e.response.data;
  if (typeof Blob === "undefined" || !(data instanceof Blob)) return e;
  try {
    const text = await data.text();
    e.response.data = text ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    e.response.data = undefined;
  }
  return e;
}

/* ====================================================================== */
/* Downloads (CSV twins, statement PDFs)                                    */
/* ====================================================================== */

/** Exports stream every matching row — give them longer than the 15 s default. */
export const DOWNLOAD_TIMEOUT_MS = 120_000;

/** "Transactions Sep 2026.csv" → "Transactions-Sep-2026.csv" (the server's rule). */
export function safeFilename(name: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "download";
}

function withExtension(name: string, ext: ".csv" | ".pdf"): string {
  return name.toLowerCase().endsWith(ext) ? name : `${name}${ext}`;
}

/** Hand a Blob to the browser as a file download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeFilename(filename);
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been handled (some browsers read the URL async).
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/**
 * GET `path` (relative to the API base, e.g. "/admin/finance/transactions.csv")
 * with the same auth as every other call, then save it as `filename`. Rejects
 * with the axios error — its body parsed back to JSON — so the caller shows
 * financeErrorMessage(e, …).
 */
export async function downloadFile(path: string, params: QueryParams | undefined, filename: string): Promise<void> {
  try {
    const res = await api.get<Blob>(path, { params: cleanParams(params), responseType: "blob", timeout: DOWNLOAD_TIMEOUT_MS });
    saveBlob(res.data, filename);
  } catch (e) {
    throw await parseBlobError(e);
  }
}

/** A CSV twin (finance:export): same filters as its list, every matching row. */
export function downloadCsv(path: string, params: QueryParams | undefined, filename: string): Promise<void> {
  return downloadFile(path, params, withExtension(filename, ".csv"));
}

/** A PDF (the member statements, finance:view). 404 = nothing to print. */
export function downloadPdf(path: string, params: QueryParams | undefined, filename: string): Promise<void> {
  return downloadFile(path, params, withExtension(filename, ".pdf"));
}

/* ====================================================================== */
/* Idempotency                                                              */
/* ====================================================================== */

/** A fresh idempotency key (UUID v4) for a money write. Make ONE per form
 *  opening, not per click: a retry after a timeout must replay, not re-post. */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ====================================================================== */
/* Contract bounds (the books' validation, so forms can say it first)       */
/* ====================================================================== */

export const FINANCE_LIMITS = {
  /** Gifts, expenses, transfers: 1..1,000,000,000 minor. */
  amountMaxMinor: 1_000_000_000,
  /** Opening balances: up to 1,000,000,000,000 minor. */
  openingMaxMinor: 1_000_000_000_000,
  /** One budget line's month: 0..100,000,000,000 minor. */
  budgetMonthMaxMinor: 100_000_000_000,
  /** Reversals, voids, journal reversals. */
  reason: { min: 5, max: 300 },
  /** Transfers and opening balances. */
  memo: { min: 3, max: 300 },
  payee: { min: 2, max: 120 },
  giverName: { min: 2, max: 120 },
  giverPhone: { min: 7, max: 32 },
  reference: { max: 80 },
  /** A gift's note — printed on the receipt as its name. */
  note: { max: 60 },
  fundName: { min: 2, max: 150 },
  categoryName: { min: 2, max: 60 },
  budgetName: { min: 2, max: 80 },
  budgetLabel: { min: 2, max: 80 },
  budgetLines: { max: 200 },
  /** Fund and expense-category codes: a permanent slug. */
  codePattern: /^[a-z][a-z0-9-]{1,39}$/,
  /** An M-Pesa code (trimmed, upper-cased). */
  mpesaCodePattern: /^[A-Z0-9]{8,12}$/,
  /** received_on / spent_on / occurred_on: within the last 366 days (EAT); opening as_of: 3660. */
  backdateDays: 366,
  openingBackdateDays: 3660,
  /** Search boxes (q). */
  searchMax: 80,
} as const;

/* ====================================================================== */
/* Enumerations                                                             */
/* ====================================================================== */

/** Currencies the books accept on a write. */
export type WriteCurrency = "KES" | "USD";
/** FinanceChannel — the office channel of an office gift, else the provider
 *  (card = Stripe; manual = a confirmed "I paid another way" claim). */
export type FinanceChannel = "card" | "mpesa" | "airtel" | "paypal" | "manual" | "onhand" | "bank" | "cheque" | "other";
/** How the office received or paid money (onhand = physical cash). */
export type OfficeChannel = "onhand" | "bank" | "cheque" | "mpesa" | "other";
export type TransactionStatus = "requires_action" | "processing" | "succeeded" | "failed" | "refunded";
export type TransactionSource = "app" | "website" | "admin";
export type AnyYesNo = "any" | "yes" | "no";
export type LedgerSide = "debit" | "credit";
export type JournalKind = "expense" | "expense_void" | "transfer" | "opening" | "reversal";
export type PledgeShapeValue = "monthly" | "total";
export type PledgeStatusValue = "active" | "paused" | "fulfilled" | "cancelled";
/** The pledge card's label as of today (cancelled reads paused). */
export type PledgeStanding = "on_track" | "behind" | "fulfilled" | "paused";
export type NeedStatusValue = "pending" | "approved" | "rejected" | "closed";
export type ExpenseStatus = "recorded" | "approved" | "void";
export type BudgetStatus = "draft" | "approved";
export type BudgetLineKind = "income" | "expense";
export type ReconciliationExceptionKind =
  | "stale_processing"
  | "failed"
  | "succeeded_without_ledger"
  | "unbalanced_transaction"
  | "refunded_without_reversal"
  | "duplicate_receipt"
  | "unbalanced_journal";
export type FinanceAlertKind =
  | "pending_claims"
  | "expenses_awaiting_approval"
  | "failing_schedules"
  | "stale_processing"
  | "integrity_issues"
  | "partners_behind";

/* ====================================================================== */
/* Reads — "Finance ERP · reports" schemas                                  */
/* ====================================================================== */

/** FinanceChannelTotal — money received per cash account, net of reversals. */
export interface FinanceChannelTotal {
  /** The account without its cash: prefix (stripe = card). */
  channel: string;
  account: string;
  currency: string;
  count: number;
  received_minor: number;
  reversed_minor: number;
  net_minor: number;
}

/** GET /admin/finance/overview */
export interface FinanceOverview {
  period: { from: IsoDate; to: IsoDate; mtd_from: IsoDate; ytd_from: IsoDate; last_year_from: IsoDate; last_year_to: IsoDate };
  /** Every currency the figures carry; KES first (always present), then A–Z. */
  currencies: string[];
  income: {
    currency: string;
    period_minor: number;
    period_count: number;
    mtd_minor: number;
    ytd_minor: number;
    same_period_last_year_minor: number;
  }[];
  /** APPROVED expenses only, by spent_on. */
  expenses: { currency: string; period_minor: number; period_count: number; ytd_minor: number }[];
  /** income − expenses, per currency. */
  net: { currency: string; period_minor: number; ytd_minor: number }[];
  outstanding_pledges: { currency: string; remaining_year_minor: number; pledges: number }[];
  partners: { count: number; behind: number };
  counts: {
    processing: number;
    failed_in_period: number;
    pending_claims: number;
    expenses_awaiting_approval: number;
    failing_schedules: number;
    stale_processing: number;
    integrity_issues: number;
  };
  /** Top 6 funds by KES balance (all time). */
  fund_balances: { code: string; name: string; is_active: boolean; balances: CurrencyBalance[] }[];
  channels: FinanceChannelTotal[];
  /** 12 months per currency, oldest first, the last being `to`'s month. month = "YYYY-MM". */
  series: { currency: string; months: { month: string; income_minor: number; expenses_minor: number }[] }[];
  /** Only kinds with count > 0; `link` is the web route that opens the queue. */
  alerts: { kind: FinanceAlertKind; count: number; link: string }[];
}

/** FinanceTransactionRow — one transaction as the office sees it. */
export interface FinanceTransactionRow {
  transaction_id: string;
  /** Null for a memberless gift (website, or an office walk-in / anonymous gift). */
  user_id: string | null;
  full_name: string | null;
  member_phone: string | null;
  /** member name → giver_name → giver_phone → "Anonymous". */
  display_name: string;
  amount_minor: number;
  currency: string;
  status: TransactionStatus;
  /** Fund code; null for a media purchase. */
  fund: string | null;
  fund_name: string | null;
  account_name: string | null;
  /** Legacy raw provider — prefer `channel`. */
  method: string | null;
  channel: FinanceChannel;
  source: TransactionSource;
  provider: string;
  provider_ref: string | null;
  /** Online M-Pesa: the M-Pesa code; office gift: OR-YYYY-NNNNN. */
  receipt_code: string | null;
  giver_name: string | null;
  giver_phone: string | null;
  pledge_id: string | null;
  pledge_title: string | null;
  need_id: string | null;
  need_title: string | null;
  office_channel: OfficeChannel | null;
  /** The M-Pesa code (upper-cased), cheque number or bank reference. */
  office_reference: string | null;
  recorded_by: string | null;
  recorded_by_name: string | null;
  reversed_at: IsoDateTime | null;
  reversed_by: string | null;
  reversed_by_name: string | null;
  reversal_reason: string | null;
  created_at: IsoDateTime;
  settled_at: IsoDateTime | null;
}
/** totals: amount_minor = Σ SUCCEEDED amounts; count = every matching row, any status. */
export type FinanceTransactionsPage = ListEnvelope<FinanceTransactionRow>;

/** FinanceLedgerLeg — a posting a transaction owns. */
export interface FinanceLedgerLeg {
  entry_id: string;
  account: string;
  side: LedgerSide;
  amount_minor: number;
  currency: string;
  created_at: IsoDateTime;
  /** A debit on a non-cash account or a credit on cash:*. */
  is_reversal: boolean;
}

/** GET /admin/finance/transactions/:id */
export interface FinanceTransactionDetail {
  transaction: FinanceTransactionRow & {
    stripe_payment_intent: string | null;
    idempotency_key: string | null;
    schedule_id: string | null;
    giver_email: string | null;
  };
  /** EVERY posting it owns — the original pair and, once reversed, the reversing pair. */
  ledger_entries: FinanceLedgerLeg[];
}

export type TransactionsFilters = PeriodQuery & {
  /** Fund code. */
  fund?: string | null | undefined;
  status?: TransactionStatus | null | undefined;
  /** `stripe` is accepted as an alias of `card`. */
  channel?: FinanceChannel | "stripe" | null | undefined;
  source?: TransactionSource | null | undefined;
  /** Receipt code, office reference, member / giver name or phone, provider reference. ≤ 80. */
  q?: string | null | undefined;
  pledged?: AnyYesNo | null | undefined;
  need?: AnyYesNo | null | undefined;
};
export type TransactionsQuery = TransactionsFilters & PageQuery;

/** FinancePledgeRow — a pledge evaluated by the instalment ledger. */
export interface FinancePledgeRow {
  pledge_id: string;
  user_id: string;
  member_name: string;
  member_phone: string | null;
  title: string;
  shape: PledgeShapeValue;
  /** A monthly pledge's instalment. */
  amount_minor: number | null;
  /** A total pledge's target. */
  target_minor: number | null;
  currency: string;
  status: PledgeStatusValue;
  standing: PledgeStanding;
  year: number;
  pledged_year_minor: number;
  paid_year_minor: number;
  remaining_year_minor: number;
  /** Every succeeded payment toward it, all time. */
  paid_total_minor: number;
  kept: number;
  due_count: number;
  next_due: IsoDate | null;
  overdue_since: IsoDate | null;
  due_day: number | null;
  due_on: IsoDate | null;
  created_at: IsoDateTime;
  pays_to: { code: string; name: string } | null;
}
/** amount_minor = pledged_minor (the common totals shape). */
export interface FinancePledgeTotal extends CurrencyTotal {
  pledged_minor: number;
  paid_minor: number;
  remaining_minor: number;
}
export interface FinancePledgesPage extends ListEnvelope<FinancePledgeRow, FinancePledgeTotal> {
  year: number;
}
export type PledgesFilters = {
  /** Default: the current year (EAT). */
  year?: number | null | undefined;
  status?: PledgeStatusValue | null | undefined;
  standing?: "on_track" | "behind" | null | undefined;
  shape?: PledgeShapeValue | null | undefined;
  /** Member name or phone, or the pledge title. */
  q?: string | null | undefined;
};
export type PledgesQuery = PledgesFilters & PageQuery;

/** FinanceFundRow — a fund with its balance per currency and activity. */
export interface FinanceFundRow {
  code: string;
  name: string;
  name_sw: string | null;
  is_active: boolean;
  description: string | null;
  sort: number;
  balances: CurrencyBalance[];
  income: { currency: string; period_minor: number; ytd_minor: number }[];
  expenses_ytd: CurrencyAmount[];
  transfers_in_ytd: CurrencyAmount[];
  transfers_out_ytd: CurrencyAmount[];
  /** The latest posting on the fund's account. */
  last_activity_at: IsoDateTime | null;
}
/** GET /admin/finance/funds — one page (next_cursor always null); totals = Σ balances per currency. */
export interface FinanceFundsPage {
  period: { from: IsoDate; to: IsoDate; ytd_from: IsoDate };
  data: FinanceFundRow[];
  next_cursor: null;
  totals: CurrencyTotal[];
}

/** FinanceLedgerRow — one posting, transaction or journal. */
export interface FinanceLedgerRow {
  entry_id: string;
  kind: "transaction" | "journal";
  transaction_id: string | null;
  journal_id: string | null;
  account: string;
  side: LedgerSide;
  amount_minor: number;
  currency: string;
  /** When the posting was written. */
  created_at: IsoDateTime;
  /** The EAT date every ledger view reads. */
  posted_on: IsoDate;
  receipt_code: string | null;
  user_id: string | null;
  /** The transaction's display name; null on a journal posting. */
  member_name: string | null;
  transaction_status: string | null;
  /** Null on a transaction posting. */
  journal_kind: JournalKind | null;
  memo: string | null;
}
/** amount_minor = debit_minor − credit_minor (0 over a balanced, unfiltered ledger). */
export interface FinanceLedgerTotal extends CurrencyTotal {
  debit_minor: number;
  credit_minor: number;
}
export type FinanceLedgerPage = ListEnvelope<FinanceLedgerRow, FinanceLedgerTotal>;
export type LedgerFilters = PeriodQuery & {
  /** An exact account (fund:tithe) or a prefix ending in ':' (cash:). */
  account?: string | null | undefined;
  kind?: "transaction" | "journal" | null | undefined;
};
/** Ledger paging: limit ≤ 500, default 100. */
export type LedgerQuery = LedgerFilters & PageQuery;

/** GET /admin/finance/trial-balance (no dates = all time). */
export interface FinanceTrialBalance {
  period: { from: IsoDate | null; to: IsoDate | null };
  data: {
    account: string;
    currency: string;
    debit_minor: number;
    credit_minor: number;
    /** On the account's normal side. */
    balance_minor: number;
    normal_side: LedgerSide;
  }[];
  totals: { currency: string; debit_minor: number; credit_minor: number; balanced: boolean }[];
  /** Every currency balances. */
  balanced: boolean;
}

export interface FinanceReconciliationException {
  kind: ReconciliationExceptionKind;
  transaction_id: string | null;
  journal_id: string | null;
  amount_minor: number | null;
  currency: string | null;
  /** When the row was created. */
  at: IsoDateTime | null;
  detail: string;
}
/** GET /admin/finance/reconciliation */
export interface FinanceReconciliation {
  period: { from: IsoDate; to: IsoDate };
  /** Newest day first; within a day by channel, then currency. amount_minor = received − reversed. */
  settlement: {
    day: IsoDate;
    channel: string;
    account: string;
    currency: string;
    count: number;
    received_minor: number;
    reversed_count: number;
    reversed_minor: number;
    amount_minor: number;
  }[];
  exceptions: FinanceReconciliationException[];
  exception_counts: Record<ReconciliationExceptionKind, number>;
  integrity: { currency: string; debit_minor: number; credit_minor: number; balanced: boolean }[];
}

export type IncomeReportBy = "fund" | "channel" | "source";
export type ExpensesReportBy = "category" | "fund";
/** GET /admin/finance/reports/income | /reports/expenses — rows × 12 months (January first), per currency. */
export interface FinanceReportMatrix {
  report: "income" | "expenses";
  year: number;
  by: "fund" | "channel" | "source" | "category";
  /** KES first, then A–Z; only currencies with data (KES always present). */
  currencies: {
    currency: string;
    /** Largest total first; key `none` when absent. */
    rows: { key: string; label: string; months: number[]; total_minor: number }[];
    totals: { months: number[]; total_minor: number };
  }[];
}

/** GET /admin/finance/reports/pledges */
export interface FinancePledgesReport {
  year: number;
  currencies: {
    currency: string;
    /** 12 entries, month 1–12. */
    months: { month: number; pledged_minor: number; paid_minor: number; kept: number; missed: number; behind_partners: number }[];
    totals: { pledged_minor: number; paid_minor: number; kept: number; missed: number; behind_partners: number };
  }[];
}

export interface FinanceAccountBalance {
  account: string;
  label: string;
  balance_minor: number;
}
/** GET /admin/finance/reports/financial-position — balanced = assets = funds + other. */
export interface FinanceFinancialPosition {
  as_of: IsoDate;
  currencies: {
    currency: string;
    /** cash:* accounts, debits − credits. */
    assets: FinanceAccountBalance[];
    /** fund:* accounts, credits − debits. */
    funds: (FinanceAccountBalance & { code: string })[];
    /** Every other account (sales:media, …), credits − debits. */
    other: FinanceAccountBalance[];
    totals: { assets_minor: number; funds_minor: number; other_minor: number };
    balanced: boolean;
  }[];
  balanced: boolean;
}

export interface FinanceStatementLine {
  /** Fund code, account, or expense category code. */
  key: string;
  label: string;
  amount_minor: number;
}
/** GET /admin/finance/reports/income-expenditure — transfers and openings excluded. */
export interface FinanceIncomeExpenditure {
  period: { from: IsoDate; to: IsoDate };
  currencies: {
    currency: string;
    /** Per fund: gifts net of reversals. */
    income: FinanceStatementLine[];
    /** key = the account (sales:media, …). */
    other_income: FinanceStatementLine[];
    /** Per expense category (approved, by spent_on). */
    expenses: FinanceStatementLine[];
    totals: { gifts_minor: number; other_income_minor: number; income_minor: number; expenses_minor: number; surplus_minor: number };
  }[];
}

/** FinanceStatementRow — a member who gave in the year. */
export interface FinanceStatementRow {
  user_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  /** Succeeded gifts in the year, every currency. */
  gifts: number;
  totals: CurrencyTotal[];
  by_fund: { code: string; name: string; currency: string; amount_minor: number }[];
  /** The part of the year's giving that was toward a pledge. */
  pledge_paid: CurrencyAmount[];
  last_gift_at: IsoDateTime;
}
/** totals: per currency over the whole filtered set (count = gifts). */
export interface FinanceStatementsPage extends ListEnvelope<FinanceStatementRow> {
  year: number;
}
export type StatementsFilters = {
  year?: number | null | undefined;
  /** Member name, phone or email. */
  q?: string | null | undefined;
};
export type StatementsQuery = StatementsFilters & PageQuery;

/** FinanceAuditRow — the finance slice of the append-only audit trail. */
export interface FinanceAuditRow {
  audit_id: number;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  occurred_at: IsoDateTime;
  actor_type: "System" | "Admin";
}
export interface FinanceAuditPage {
  data: FinanceAuditRow[];
  next_cursor: string | null;
}
export type AuditQuery = PeriodQuery &
  PageQuery & {
    /** Must itself start with a finance prefix: giving. purchase. finance. webhook. pledge. department.need expense. budget. journal. fund. */
    action_prefix?: string | null | undefined;
    /** "All" | "System" (no actor) | "Admin" (any signed-in actor) | a user id. */
    actor?: string | null | undefined;
  };

export interface FinanceTrendPoint {
  /** "Sep" */
  m: string;
  /** The month's first instant. */
  month: IsoDateTime;
  total_minor: number;
}
/** GET /admin/finance/trend — `data` is the KES series (back-compat); `series` has every currency. */
export interface FinanceTrend {
  data: FinanceTrendPoint[];
  currency: string;
  series: { currency: string; points: FinanceTrendPoint[] }[];
}

/** GET /admin/finance/settings — env var NAMES only, never values. */
export interface FinanceSettings {
  providers: { key: "stripe" | "mpesa" | "airtel" | "paypal"; label: string; configured: boolean; env: string[] }[];
  receipt_counter: { year: number; next: number; next_receipt: string };
  giving_tiers: { amount_minor: number; currency: string; disciples_per_year: number; meaning: string }[];
  cost_per_disciple_minor: number;
  reminder_policy: {
    due_soon_days: number;
    due_window_days: number;
    follow_up_hours: number;
    follow_ups: number;
    in_flight_minutes: number;
    text: string[];
  };
}

/** FinanceNeedRow — a department need as Finance sees it (read-only here). */
export interface FinanceNeedRow {
  need_id: string;
  title: string;
  why: string;
  department_id: string;
  department_name: string;
  /** Where a gift to the need is booked; null = the gift's own fund. */
  fund_code: string | null;
  target_minor: number;
  /** Every succeeded gift to the need or to a pledge toward it — the Departments page's own figure. */
  raised_minor: number;
  gifts_count: number;
  currency: string;
  deadline: IsoDate | null;
  status: NeedStatusValue;
  created_at: IsoDateTime;
  decided_at: IsoDateTime | null;
}
/** amount_minor = raised_minor (the common totals shape). */
export interface FinanceNeedTotal extends CurrencyTotal {
  target_minor: number;
  raised_minor: number;
}
export type FinanceNeedsPage = ListEnvelope<FinanceNeedRow, FinanceNeedTotal>;
export type NeedsQuery = PageQuery & {
  /** Default approved. */
  status?: NeedStatusValue | "all" | null | undefined;
  /** Need title or department name. */
  q?: string | null | undefined;
};

export type SchedulesQuery = {
  status?: "active" | "paused" | "cancelled" | null | undefined;
  /** true = only those needing attention (paused, or with a consecutive failure). */
  attention?: boolean | null | undefined;
  /** ≤ 200, default 100. */
  limit?: number | undefined;
};

/* ====================================================================== */
/* Books — "Finance ERP · books" schemas                                    */
/* ====================================================================== */

/** BooksCurrencyTotal — currency is KES | USD on the books' lists. */
export interface BooksCurrencyTotal extends CurrencyTotal {
  currency: WriteCurrency;
}
export interface BooksFundRef {
  code: string;
  name: string;
}
export interface BooksCategoryRef {
  category_id: string;
  code: string;
  name: string;
}
/** One side of a balanced posting (created_at = its economic date, 12:00 EAT for office postings). */
export interface BooksLedgerLeg {
  entry_id: string;
  /** cash:<onhand|bank|cheque|mpesa|manual|stripe|airtel|paypal> or fund:<code>. */
  account: string;
  side: LedgerSide;
  amount_minor: number;
  currency: string;
  created_at: IsoDateTime;
}

/** POST /admin/finance/gifts — exactly one giver mode: user_id, giver_name (+ phone), or anonymous. */
export type BooksGiftInput = {
  /** One per recording (newIdempotencyKey); a replay returns the booked transaction. */
  idempotency_key: string;
  user_id?: string | null | undefined;
  giver_name?: string | null | undefined;
  giver_phone?: string | null | undefined;
  anonymous?: boolean | undefined;
  /** Required unless pledge_id is set (the pledge decides) or need_id resolves to its department's fund. */
  fund?: string | null | undefined;
  amount_minor: number;
  currency: WriteCurrency;
  channel: OfficeChannel;
  /** Required for mpesa (the code), cheque and bank; stored as office_reference. */
  reference?: string | null | undefined;
  /** Within [today − 366 days, today] (EAT). */
  received_on: IsoDate;
  /** The member's open pledge (needs user_id). */
  pledge_id?: string | null | undefined;
  /** An approved department need. */
  need_id?: string | null | undefined;
  /** ≤ 60 — printed on the receipt as the gift's name. */
  note?: string | null | undefined;
};

/** BooksTransaction — a manual transaction (office gift or confirmed claim) with every ledger leg. */
export interface BooksTransaction {
  transaction_id: string;
  /** succeeded when recorded; refunded once reversed. */
  status: TransactionStatus;
  provider: string;
  source: TransactionSource;
  /** Office gifts: OR-<year>-<5 digits>. Confirmed claims: null. */
  receipt_code: string | null;
  amount_minor: number;
  currency: string;
  fund: BooksFundRef | null;
  /** office_channel; null on a claim. */
  channel: OfficeChannel | null;
  /** office_reference — M-Pesa code, cheque number or bank reference. */
  reference: string | null;
  received_on: IsoDate;
  created_at: IsoDateTime;
  settled_at: IsoDateTime | null;
  user_id: string | null;
  member_name: string | null;
  giver_name: string | null;
  giver_phone: string | null;
  /** No member, no name, no phone. */
  anonymous: boolean;
  pledge: { pledge_id: string; title: string } | null;
  need: { need_id: string; title: string } | null;
  /** account_name */
  note: string | null;
  recorded_by: string | null;
  recorded_by_name: string | null;
  reversed_at: IsoDateTime | null;
  reversed_by: string | null;
  reversed_by_name: string | null;
  reversal_reason: string | null;
  /** Oldest first: the original pair, then (once reversed) the mirror pair. */
  ledger: BooksLedgerLeg[];
}
export interface BooksGiftResult extends BooksTransaction {
  idempotency_key: string;
  /** true = a replay; nothing new was posted. */
  reused: boolean;
}
/** Reason 5–300 characters (trimmed). */
export type BooksReverseInput = { reason: string };

export interface BooksFund {
  fund_id: string;
  /** Permanent slug; the ledger account is fund:<code>. */
  code: string;
  name: string;
  name_sw: string | null;
  description: string | null;
  sort: number;
  is_active: boolean;
}
export type BooksFundInput = {
  code: string;
  name: string;
  name_sw?: string | null | undefined;
  description?: string | null | undefined;
  sort?: number | undefined;
  is_active?: boolean | undefined;
};
/** At least one field; the code never changes. */
export type BooksFundPatch = {
  name?: string | undefined;
  name_sw?: string | null | undefined;
  description?: string | null | undefined;
  sort?: number | undefined;
  is_active?: boolean | undefined;
  /** Deactivate even though money still routes to the fund (resend after a
   *  409 FUND_IN_USE, whose details count active_pledges, active_schedules,
   *  departments and live_campaigns). */
  force?: boolean | undefined;
};

export type BooksTransferInput = {
  from_fund: string;
  /** Active; different from from_fund. */
  to_fund: string;
  amount_minor: number;
  currency: WriteCurrency;
  occurred_on: IsoDate;
  /** 3–300. */
  memo: string;
  /** Post even if the from-fund goes below zero in this currency. */
  allow_negative?: boolean | undefined;
  /** Optional; a retry with the same key is a replay. */
  idempotency_key?: string | null | undefined;
};
export interface BooksTransfer {
  transfer_id: string;
  journal_id: string;
  from_fund: BooksFundRef;
  to_fund: BooksFundRef;
  amount_minor: number;
  currency: string;
  occurred_on: IsoDate;
  memo: string;
  created_by: string | null;
  created_at: IsoDateTime;
  /** The from-fund's balance right after (on a replay: now); may be negative with allow_negative. */
  from_balance_after_minor: number;
  reversed_by_journal_id: string | null;
  reused: boolean;
  ledger: BooksLedgerLeg[];
}

export interface BooksExpense {
  expense_id: string;
  fund: BooksFundRef;
  category: BooksCategoryRef;
  payee: string;
  description: string | null;
  amount_minor: number;
  currency: WriteCurrency;
  spent_on: IsoDate;
  channel: OfficeChannel;
  reference: string | null;
  status: ExpenseStatus;
  recorded_by: string | null;
  recorded_by_name: string | null;
  recorded_at: IsoDateTime;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: IsoDateTime | null;
  voided_by: string | null;
  voided_by_name: string | null;
  voided_at: IsoDateTime | null;
  void_reason: string | null;
  /** The expense journal posted on approval. */
  journal_id: string | null;
  /** The expense_void journal posted when an APPROVED expense is voided. */
  void_journal_id: string | null;
}
export type BooksExpenseInput = {
  /** Active fund code. */
  fund: string;
  /** Active expense category code. */
  category: string;
  payee: string;
  description?: string | null | undefined;
  amount_minor: number;
  currency: WriteCurrency;
  spent_on: IsoDate;
  channel: OfficeChannel;
  reference?: string | null | undefined;
};
/** At least one field; only while the expense is recorded. */
export type BooksExpensePatch = {
  fund?: string | undefined;
  category?: string | undefined;
  payee?: string | undefined;
  description?: string | null | undefined;
  amount_minor?: number | undefined;
  currency?: WriteCurrency | undefined;
  spent_on?: IsoDate | undefined;
  channel?: OfficeChannel | undefined;
  reference?: string | null | undefined;
};
/** totals: every status in the filter (filter status=recorded,approved to leave voids out). */
export interface BooksExpenseList extends ListEnvelope<BooksExpense, BooksCurrencyTotal> {
  totals_by_status: { status: ExpenseStatus; currency: WriteCurrency; amount_minor: number; count: number }[];
}
export type ExpensesFilters = PeriodQuery & {
  /** One status or several (sent comma-joined). */
  status?: ExpenseStatus | readonly ExpenseStatus[] | null | undefined;
  /** Fund code. */
  fund?: string | null | undefined;
  /** Expense category code. */
  category?: string | null | undefined;
  /** Payee, description or reference. */
  q?: string | null | undefined;
};
export type ExpensesQuery = ExpensesFilters & PageQuery;

export interface BooksExpenseCategory {
  category_id: string;
  code: string;
  name: string;
  is_active: boolean;
  sort: number;
}
export type BooksExpenseCategoryInput = {
  code: string;
  name: string;
  sort?: number | undefined;
  is_active?: boolean | undefined;
};
export type BooksExpenseCategoryPatch = {
  name?: string | undefined;
  sort?: number | undefined;
  is_active?: boolean | undefined;
};

export interface BooksBudget {
  budget_id: string;
  year: number;
  name: string;
  status: BudgetStatus;
  /** Budgets are KES only. */
  currency: "KES";
  created_by: string | null;
  created_by_name: string | null;
  created_at: IsoDateTime;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: IsoDateTime | null;
  line_count: number;
  income_total_minor: number;
  expense_total_minor: number;
}
export interface BooksBudgetLine {
  line_id: string;
  kind: BudgetLineKind;
  /** Always set on income lines; optional on expense lines. */
  fund: BooksFundRef | null;
  /** Set on expense lines only. */
  category: BooksCategoryRef | null;
  label: string;
  /** January → December. */
  monthly_minor: number[];
  total_minor: number;
}
export interface BooksBudgetDetail extends BooksBudget {
  /** Income lines first, then expense. */
  lines: BooksBudgetLine[];
}
export type BooksBudgetInput = { year: number; name: string };
/** At least one field; draft only. */
export type BooksBudgetPatch = { year?: number | undefined; name?: string | undefined };
export type BooksBudgetLineInput = {
  kind: BudgetLineKind;
  /** Fund code — required for income; optional for expense. */
  fund?: string | null | undefined;
  /** Category code — required for expense; absent for income. */
  category?: string | null | undefined;
  label: string;
  /** 12 non-negative KES minor amounts, January first. */
  monthly_minor: number[];
};
export type BooksBudgetLinesInput = { lines: BooksBudgetLineInput[] };
export interface BooksBudgetActualsRow {
  budget_minor: number[];
  actual_minor: number[];
  /** actual − budget (positive = above budget: good for income, overspend for expense). */
  variance_minor: number[];
  budget_total_minor: number;
  actual_total_minor: number;
  variance_total_minor: number;
}
/** GET /admin/finance/budgets/:id/actuals (KES). */
export interface BooksBudgetActuals {
  budget: BooksBudget;
  year: number;
  currency: "KES";
  /** YYYY-MM, January → December. */
  months: string[];
  lines: (BooksBudgetActualsRow & {
    line_id: string;
    kind: BudgetLineKind;
    label: string;
    fund: BooksFundRef | null;
    category: BooksCategoryRef | null;
  })[];
  /** Exactly two rows: income, then expense. unbudgeted = that kind's actual money no line covers. */
  totals: (BooksBudgetActualsRow & { kind: BudgetLineKind; unbudgeted_minor: number[]; unbudgeted_total_minor: number })[];
}

export type BooksOpeningBalanceInput = {
  idempotency_key: string;
  /** Where the money sits (other → cash:manual). */
  channel: OfficeChannel;
  /** Active fund code. */
  fund: string;
  /** 1..1,000,000,000,000 minor. */
  amount_minor: number;
  currency: WriteCurrency;
  /** Within [today − 3660 days, today] (EAT). */
  as_of: IsoDate;
  memo: string;
};
export type BooksJournalReverseInput = {
  /** 5–300 — becomes the reversal journal's memo. */
  reason: string;
  /** Reverse even if the debited fund goes below zero. */
  allow_negative?: boolean | undefined;
};
export interface BooksJournal {
  journal_id: string;
  kind: JournalKind;
  memo: string | null;
  /** The economic date. */
  occurred_on: IsoDate;
  /** When it was entered. */
  created_at: IsoDateTime;
  created_by: string | null;
  created_by_name: string | null;
  /** expense / expense_void → expense_id; transfer → transfer_id; reversal → its original's ref_id; opening → null. */
  ref_id: string | null;
  /** kind reversal: the journal it mirrors. */
  reversal_of: string | null;
  /** The reversal journal that undid this one, if any. */
  reversed_by_journal_id: string | null;
  /** Debit first. */
  legs: BooksLedgerLeg[];
  /** The journal's amount per currency. */
  totals: CurrencyAmount[];
}
export interface BooksJournalResult extends BooksJournal {
  reused: boolean;
}
/** totals: amount = Σ debit legs, count = journals. */
export type BooksJournalList = ListEnvelope<BooksJournal, BooksCurrencyTotal>;
export type JournalsQuery = PeriodQuery &
  PageQuery & {
    /** One kind or several (sent comma-joined). */
    kind?: JournalKind | readonly JournalKind[] | null | undefined;
  };

/** GET /admin/permissions/catalog — the server's own RBAC dimensions, in server order. */
export interface PermissionCatalog {
  modules: string[];
  capabilities: string[];
}

/* ====================================================================== */
/* Campaigns (financial/campaigns.ts — the OpenAPI carries no body schema)  */
/* ====================================================================== */

export type CampaignStatus = "draft" | "live" | "ended";
/** A count(*) the server sends as BIGINT text today — Number() it before arithmetic. */
export type BigCount = number | string;
export interface CampaignRow {
  campaign_id: string;
  title: string;
  blurb: string;
  image_url: string | null;
  goal_minor: number;
  currency: string;
  starts_on: IsoDate;
  ends_on: IsoDate;
  status: CampaignStatus;
  /** Both halves of a match, or neither. */
  match_minor: number | null;
  match_pledger: string | null;
  /** Fund code. */
  fund: string | null;
  created_at: IsoDateTime;
  /** Succeeded gifts to the campaign's fund, starts_on..ends_on (EAT). */
  raised_minor: number;
  people_asked: BigCount;
  gave: BigCount;
  declined: BigCount;
}
/** POST /admin/campaigns and PUT /admin/campaigns/:id — a campaign always starts as a draft. */
export type CampaignInput = {
  /** 3–120. */
  title: string;
  /** ≥ 10. */
  blurb: string;
  image_url?: string | null | undefined;
  /** Fund code. */
  fund: string;
  goal_minor: number;
  currency: string;
  starts_on: IsoDate;
  /** ≥ starts_on. */
  ends_on: IsoDate;
  /** A match needs match_pledger too (both or neither). */
  match_minor?: number | null | undefined;
  match_pledger?: string | null | undefined;
};
export interface CampaignWriteResult {
  campaign_id: string;
  status: CampaignStatus;
}
/** GET /admin/campaigns/:id/reach */
export interface CampaignReach {
  people_asked: BigCount;
  times_shown: BigCount;
  opened: BigCount;
  gave: BigCount;
  dismissed: BigCount;
  declined: BigCount;
}

/* ====================================================================== */
/* Endpoints                                                                */
/* ====================================================================== */

const F = "/admin/finance";
const id = (v: string): string => encodeURIComponent(v);

async function get<T>(path: string, params?: QueryParams): Promise<T> {
  const r = await api.get<T>(path, { params: cleanParams(params) });
  return r.data;
}
async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await api.post<T>(path, body ?? {});
  return r.data;
}
async function patch<T>(path: string, body: unknown): Promise<T> {
  const r = await api.patch<T>(path, body);
  return r.data;
}
async function put<T>(path: string, body: unknown): Promise<T> {
  const r = await api.put<T>(path, body);
  return r.data;
}

/** CSV twins (finance:export) — for ExportButton `path`, with the list's filters as `params`. */
export const FINANCE_CSV = {
  transactions: `${F}/transactions.csv`,
  pledges: `${F}/pledges.csv`,
  ledger: `${F}/ledger.csv`,
  expenses: `${F}/expenses.csv`,
  incomeReport: `${F}/reports/income.csv`,
  expensesReport: `${F}/reports/expenses.csv`,
  pledgesReport: `${F}/reports/pledges.csv`,
  financialPosition: `${F}/reports/financial-position.csv`,
  incomeExpenditure: `${F}/reports/income-expenditure.csv`,
  statements: `${F}/statements.csv`,
} as const;

/** The member statement PDFs (finance:view) — for DownloadButton `path` (kind "pdf"). */
export const statementPdfPath = (userId: string, kind: "giving" | "partners"): string => `${F}/statements/${id(userId)}/${kind}.pdf`;

/** GET /admin/permissions/catalog — rolesAdmin:view OR users:view OR finance:view. */
export function permissionsCatalog(): Promise<PermissionCatalog> {
  return get<PermissionCatalog>("/admin/permissions/catalog");
}

/**
 * Every Finance endpoint (docs/FINANCE_ERP.md §4). Reads need finance:view;
 * each write names its capability. Lists take the filters plus `cursor` /
 * `limit` and return `{ data, next_cursor, totals }` — hand them to
 * usePagedList (components/finance/kit.tsx).
 */
export const FinanceApi = {
  /* ---------- reads (finance:view) ---------- */

  /** GET /admin/finance/overview?from&to — defaults: this month to date. */
  overview: (q: PeriodQuery = {}) => get<FinanceOverview>(`${F}/overview`, q),
  /** GET /admin/finance/transactions — the register, keyset-paged. */
  transactions: (q: TransactionsQuery = {}) => get<FinanceTransactionsPage>(`${F}/transactions`, q),
  /** GET /admin/finance/transactions/:id — office + reversal fields and every ledger leg. */
  transaction: (transactionId: string) => get<FinanceTransactionDetail>(`${F}/transactions/${id(transactionId)}`),
  /** GET /admin/finance/pledges — the pledge register from the instalment ledger. */
  pledges: (q: PledgesQuery = {}) => get<FinancePledgesPage>(`${F}/pledges`, q),
  /** GET /admin/finance/funds?from&to — every fund (one page), balances per currency. */
  funds: (q: PeriodQuery = {}) => get<FinanceFundsPage>(`${F}/funds`, q),
  /** GET /admin/finance/ledger — postings, transaction and journal (limit ≤ 500). */
  ledger: (q: LedgerQuery = {}) => get<FinanceLedgerPage>(`${F}/ledger`, q),
  /** GET /admin/finance/trial-balance?from&to (no dates = all time). */
  trialBalance: (q: PeriodQuery = {}) => get<FinanceTrialBalance>(`${F}/trial-balance`, q),
  /** GET /admin/finance/reconciliation?from&to */
  reconciliation: (q: PeriodQuery = {}) => get<FinanceReconciliation>(`${F}/reconciliation`, q),
  /** GET /admin/finance/reports/income?year&by */
  incomeReport: (q: { year?: number | null | undefined; by?: IncomeReportBy | undefined } = {}) => get<FinanceReportMatrix>(`${F}/reports/income`, q),
  /** GET /admin/finance/reports/expenses?year&by */
  expensesReport: (q: { year?: number | null | undefined; by?: ExpensesReportBy | undefined } = {}) => get<FinanceReportMatrix>(`${F}/reports/expenses`, q),
  /** GET /admin/finance/reports/pledges?year */
  pledgesReport: (q: { year?: number | null | undefined } = {}) => get<FinancePledgesReport>(`${F}/reports/pledges`, q),
  /** GET /admin/finance/reports/financial-position?as_of (default today). */
  financialPosition: (q: { as_of?: IsoDate | null | undefined } = {}) => get<FinanceFinancialPosition>(`${F}/reports/financial-position`, q),
  /** GET /admin/finance/reports/income-expenditure?from&to */
  incomeExpenditure: (q: PeriodQuery = {}) => get<FinanceIncomeExpenditure>(`${F}/reports/income-expenditure`, q),
  /** GET /admin/finance/statements?year&q — year-end givers, keyset-paged. */
  statements: (q: StatementsQuery = {}) => get<FinanceStatementsPage>(`${F}/statements`, q),
  /** GET /admin/finance/audit — the finance audit trail, keyset-paged. */
  audit: (q: AuditQuery = {}) => get<FinanceAuditPage>(`${F}/audit`, q),
  /** GET /admin/finance/settings — providers (env names only), receipt counter, tiers, reminder policy. */
  settings: () => get<FinanceSettings>(`${F}/settings`),
  /** GET /admin/finance/needs — department needs, raised vs target (read-only). */
  needs: (q: NeedsQuery = {}) => get<FinanceNeedsPage>(`${F}/needs`, q),
  /** GET /admin/finance/expenses — the expense register. */
  expenses: (q: ExpensesQuery = {}) => get<BooksExpenseList>(`${F}/expenses`, q),
  /** GET /admin/finance/expenses/:id */
  expense: (expenseId: string) => get<BooksExpense>(`${F}/expenses/${id(expenseId)}`),
  /** GET /admin/finance/expense-categories — active and inactive, by sort then name. */
  expenseCategories: () => get<{ data: BooksExpenseCategory[] }>(`${F}/expense-categories`).then((r) => r.data),
  /** GET /admin/finance/budgets — newest year first. */
  budgets: () => get<{ data: BooksBudget[] }>(`${F}/budgets`).then((r) => r.data),
  /** GET /admin/finance/budgets/:id — with its lines. */
  budget: (budgetId: string) => get<BooksBudgetDetail>(`${F}/budgets/${id(budgetId)}`),
  /** GET /admin/finance/budgets/:id/actuals — budget vs actual per line and month (KES). */
  budgetActuals: (budgetId: string) => get<BooksBudgetActuals>(`${F}/budgets/${id(budgetId)}/actuals`),
  /** GET /admin/finance/journals — journals with their legs, keyset-paged. */
  journals: (q: JournalsQuery = {}) => get<BooksJournalList>(`${F}/journals`, q),
  /** GET /admin/finance/journals/:id */
  journal: (journalId: string) => get<BooksJournal>(`${F}/journals/${id(journalId)}`),

  // Existing reads the pages keep using.
  /** GET /admin/finance/summary — per-fund settled revenue (this month + all time). */
  summary: () => get<{ funds: FundSummary[] }>(`${F}/summary`),
  /** GET /admin/finance/trend?months (1–24; the server's default is 6) — per currency. */
  trend: (months?: number) => get<FinanceTrend>(`${F}/trend`, { months }),
  /** GET /admin/finance/config — funds + provider availability. */
  config: () => get<FinanceConfig>(`${F}/config`),
  /** GET /admin/finance/schedules — recurring gifts with collection health. */
  schedules: (q: SchedulesQuery = {}) => get<{ data: AdminScheduleRow[] }>(`${F}/schedules`, q).then((r) => r.data),

  /* ---------- writes ---------- */

  /** finance:manage. POST /admin/finance/gifts — record a gift the office received (201; a replay 200 with reused). */
  recordGift: (body: BooksGiftInput) => post<BooksGiftResult>(`${F}/gifts`, body),
  /** finance:manage. POST /admin/finance/transactions/:id/reverse — office gifts and confirmed claims only. */
  reverseTransaction: (transactionId: string, body: BooksReverseInput) => post<BooksTransaction>(`${F}/transactions/${id(transactionId)}/reverse`, body),
  /** finance:manage. POST /admin/finance/funds */
  createFund: (body: BooksFundInput) => post<BooksFund>(`${F}/funds`, body),
  /** finance:manage. PATCH /admin/finance/funds/:code — rename, describe, reorder, (de)activate. */
  updateFund: (code: string, body: BooksFundPatch) => patch<BooksFund>(`${F}/funds/${id(code)}`, body),
  /** finance:approve. POST /admin/finance/transfers — a journal kind transfer. */
  transferFunds: (body: BooksTransferInput) => post<BooksTransfer>(`${F}/transfers`, body),
  /** finance:manage. POST /admin/finance/expenses — recorded; nothing posts until approved. */
  recordExpense: (body: BooksExpenseInput) => post<BooksExpense>(`${F}/expenses`, body),
  /** finance:manage. PATCH /admin/finance/expenses/:id — while recorded; the editor can no longer approve it. */
  updateExpense: (expenseId: string, body: BooksExpensePatch) => patch<BooksExpense>(`${F}/expenses/${id(expenseId)}`, body),
  /** finance:approve. POST /admin/finance/expenses/:id/approve — maker-checker (403 SAME_PERSON). */
  approveExpense: (expenseId: string) => post<BooksExpense>(`${F}/expenses/${id(expenseId)}/approve`),
  /** finance:manage. POST /admin/finance/expenses/:id/void — reversing journal when it was approved. */
  voidExpense: (expenseId: string, body: BooksReverseInput) => post<BooksExpense>(`${F}/expenses/${id(expenseId)}/void`, body),
  /** finance:manage. POST /admin/finance/expense-categories */
  createExpenseCategory: (body: BooksExpenseCategoryInput) => post<BooksExpenseCategory>(`${F}/expense-categories`, body),
  /** finance:manage. PATCH /admin/finance/expense-categories/:id */
  updateExpenseCategory: (categoryId: string, body: BooksExpenseCategoryPatch) => patch<BooksExpenseCategory>(`${F}/expense-categories/${id(categoryId)}`, body),
  /** finance:manage. POST /admin/finance/budgets — a draft (one per year; KES). */
  createBudget: (body: BooksBudgetInput) => post<BooksBudgetDetail>(`${F}/budgets`, body),
  /** finance:manage. PATCH /admin/finance/budgets/:id — draft only. */
  updateBudget: (budgetId: string, body: BooksBudgetPatch) => patch<BooksBudgetDetail>(`${F}/budgets/${id(budgetId)}`, body),
  /** finance:manage. PUT /admin/finance/budgets/:id/lines — replaces ALL lines (draft only). */
  replaceBudgetLines: (budgetId: string, body: BooksBudgetLinesInput) => put<BooksBudgetDetail>(`${F}/budgets/${id(budgetId)}/lines`, body),
  /** finance:approve. POST /admin/finance/budgets/:id/approve — needs at least one line. */
  approveBudget: (budgetId: string) => post<BooksBudgetDetail>(`${F}/budgets/${id(budgetId)}/approve`),
  /** finance:approve. POST /admin/finance/opening-balances — a journal kind opening (201; a replay 200 with reused). */
  postOpeningBalance: (body: BooksOpeningBalanceInput) => post<BooksJournalResult>(`${F}/opening-balances`, body),
  /** finance:approve. POST /admin/finance/journals/:id/reverse — transfers and openings only, once (201). */
  reverseJournal: (journalId: string, body: BooksJournalReverseInput) => post<BooksJournal>(`${F}/journals/${id(journalId)}/reverse`, body),

  /* ---------- Partners programme (existing; client.ts PartnersApi) ---------- */

  /** GET /admin/partners?q&status&sort */
  partners: (q: { q?: string; status?: PartnerStatusFilter; sort?: PartnerSort } = {}): Promise<{ data: PartnerRow[]; summary: PartnersSummary }> => PartnersApi.list(q),
  /** GET /admin/partners/:userId */
  partner: (userId: string): Promise<PartnerDetail> => PartnersApi.detail(userId),
  /** finance:manage. POST /admin/partners/:userId/remind — one partner (optionally one pledge; message ≤ 200). */
  remindPartner: (userId: string, body: { pledge_id?: string | null; message?: string | null } = {}): Promise<RemindResult> => PartnersApi.remind(userId, body),
  /** finance:manage. POST /admin/partners/remind-behind */
  remindBehind: (): Promise<RemindBehindResult> => PartnersApi.remindBehind(),
  /** GET /admin/partners/claims — pending claims, oldest first. */
  claims: (): Promise<PledgeClaimRow[]> => PartnersApi.claims(),
  /** finance:manage. POST /admin/partners/claims/:id/confirm — records a manual gift (422 = already decided). */
  confirmClaim: (claimId: string) => PartnersApi.confirmClaim(claimId),
  /** finance:manage. POST /admin/partners/claims/:id/reject — the member is told (422 = already decided). */
  rejectClaim: (claimId: string) => PartnersApi.rejectClaim(claimId),

  /* ---------- Campaigns (existing) ---------- */

  /** GET /admin/campaigns — the caller's congregation, with reach and money raised. */
  campaigns: () => get<{ data: CampaignRow[] }>("/admin/campaigns").then((r) => r.data),
  /** finance:manage. POST /admin/campaigns — always a draft (201). */
  createCampaign: (body: CampaignInput) => post<CampaignWriteResult>("/admin/campaigns", body),
  /** finance:manage. PUT /admin/campaigns/:id */
  updateCampaign: (campaignId: string, body: CampaignInput) => put<CampaignWriteResult>(`/admin/campaigns/${id(campaignId)}`, body),
  /** finance:manage. POST /admin/campaigns/:id/status {status: live} — members can be asked from now. */
  goLive: (campaignId: string) => post<CampaignWriteResult>(`/admin/campaigns/${id(campaignId)}/status`, { status: "live" }),
  /** finance:manage. POST /admin/campaigns/:id/status {status: ended} — final (409 when already ended). */
  endCampaign: (campaignId: string) => post<CampaignWriteResult>(`/admin/campaigns/${id(campaignId)}/status`, { status: "ended" }),
  /** GET /admin/campaigns/:id/reach */
  campaignReach: (campaignId: string) => get<CampaignReach>(`/admin/campaigns/${id(campaignId)}/reach`),

  /** GET /admin/permissions/catalog */
  permissionsCatalog,

  /* ---------- downloads ---------- */

  /** finance:export. The transactions register as CSV (same filters, every row). */
  transactionsCsv: (q: TransactionsFilters, filename = "transactions.csv") => downloadCsv(FINANCE_CSV.transactions, q, filename),
  /** finance:export. */
  pledgesCsv: (q: PledgesFilters, filename = "pledges.csv") => downloadCsv(FINANCE_CSV.pledges, q, filename),
  /** finance:export. */
  ledgerCsv: (q: LedgerFilters, filename = "ledger.csv") => downloadCsv(FINANCE_CSV.ledger, q, filename),
  /** finance:export. */
  expensesCsv: (q: ExpensesFilters, filename = "expenses.csv") => downloadCsv(FINANCE_CSV.expenses, q, filename),
  /** finance:export. */
  incomeReportCsv: (q: { year?: number | null | undefined; by?: IncomeReportBy | undefined }, filename = "income.csv") => downloadCsv(FINANCE_CSV.incomeReport, q, filename),
  /** finance:export. */
  expensesReportCsv: (q: { year?: number | null | undefined; by?: ExpensesReportBy | undefined }, filename = "expenses-report.csv") => downloadCsv(FINANCE_CSV.expensesReport, q, filename),
  /** finance:export. */
  pledgesReportCsv: (q: { year?: number | null | undefined }, filename = "pledges-report.csv") => downloadCsv(FINANCE_CSV.pledgesReport, q, filename),
  /** finance:export. */
  financialPositionCsv: (q: { as_of?: IsoDate | null | undefined }, filename = "financial-position.csv") => downloadCsv(FINANCE_CSV.financialPosition, q, filename),
  /** finance:export. */
  incomeExpenditureCsv: (q: PeriodQuery, filename = "income-expenditure.csv") => downloadCsv(FINANCE_CSV.incomeExpenditure, q, filename),
  /** finance:export. */
  statementsCsv: (q: StatementsFilters, filename = "statements.csv") => downloadCsv(FINANCE_CSV.statements, q, filename),
  /** finance:view. A member's giving statement PDF for a year (404 = no gift that year). */
  givingStatementPdf: (userId: string, year: number, filename = `giving-statement-${year}.pdf`) => downloadPdf(statementPdfPath(userId, "giving"), { year }, filename),
  /** finance:view. A member's Partners statement PDF for a year (404 = never a partner). */
  partnerStatementPdf: (userId: string, year: number, filename = `partners-statement-${year}.pdf`) => downloadPdf(statementPdfPath(userId, "partners"), { year }, filename),
};

/* ====================================================================== */
/* Givers — member search for "Record a gift" (appended: web pages set A)   */
/* ====================================================================== */

/** One of a member's open (active | paused) pledges, as the gift form offers it. */
export interface GiverOpenPledge {
  pledge_id: string;
  title: string;
  currency: string;
  shape: PledgeShapeValue;
  /** A monthly pledge's instalment. */
  amount_minor: number | null;
  /** A total pledge's target. */
  target_minor: number | null;
  /** The fund the pledge routes a gift to (the books ignore the form's fund under a pledge). */
  pays_to: { code: string; name: string } | null;
}

/** GET /admin/finance/givers row — a member the office can record a gift for. */
export interface FinanceGiver {
  user_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  congregation_name: string | null;
  open_pledges: GiverOpenPledge[];
}

/**
 * finance:view. GET /admin/finance/givers?q&limit — members matching a name,
 * phone or email, each with their open pledges (search-as-you-type in the
 * Record a gift drawer). `limit` defaults to 8 here.
 */
export function searchGivers(q: string, limit = 8): Promise<FinanceGiver[]> {
  return get<{ data: FinanceGiver[] }>(`${F}/givers`, { q, limit }).then((r) => r.data);
}
