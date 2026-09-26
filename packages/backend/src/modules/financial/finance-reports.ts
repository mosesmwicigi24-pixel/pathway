// Finance ERP — the read side (docs/FINANCE_ERP.md §2a, §4, §5): the Overview,
// the registers (transactions, pledges, funds, needs, ledger), the trial
// balance, reconciliation, the year reports, the two financial statements, the
// year-end giver list and the read-only settings.
//
// Rules this file keeps (the spec's, restated where they bite):
//   · Money is integer minor units per ISO currency. Nothing here ever adds
//     KES to USD: every total is a list of { currency, … }.
//   · Date bases (§2a) — so every page foots:
//       transaction views (Overview income, Transactions, Reports income,
//       Statements, Pledges, campaign raised) → transactions.created_at in
//       Africa/Nairobi, succeeded rows only;
//       ledger views (Ledger, Trial balance, fund movements, daily settlement,
//       the financial statements) → ledger_entries.created_at in
//       Africa/Nairobi (every leg carries its economic date);
//       expense views → expenses.spent_on.
//     from/to are inclusive EAT calendar days.
//   · The pledge register reads PartnersService.pledgeRegister — the member
//     statement's own instalment ledger — never a second copy of that math.
//   · Every list returns { data, next_cursor, totals } with totals over the
//     WHOLE filtered set, never just the page.
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import type { Env } from "../../config/env.js";
import { nairobiDate, partnerDate } from "./partnerStatementMath.js";
import { PartnersService, pledgeTitleSql, type PledgeRegisterEntry, type PledgeRegisterRow } from "./partners.js";
import type { FinancialService } from "./service.js";
import { methodLabel, PLEDGE_PAYS_TO_CODE, PLEDGE_PAYS_TO_JOINS, PLEDGE_PAYS_TO_NAME } from "./constants.js";
import { givingTiers, COST_PER_DISCIPLE_MINOR } from "./tiers.js";
import { needGiving } from "../departments/service.js";

export const TZ = "Africa/Nairobi";

// ── small shared pieces ─────────────────────────────────────────────────────

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

function isRealDay(s: string): boolean {
  if (!YMD.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** A calendar day, YYYY-MM-DD (read as the church's day, EAT). */
export const Day = z.string().refine(isRealDay, { message: "Expected a real date, YYYY-MM-DD" });
export const Year = z.coerce.number().int().min(2000).max(2999);
/** ?flag=true|false|1|0 → boolean. */
export const BoolParam = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

const pad2 = (n: number): string => String(n).padStart(2, "0");

export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

/** The same calendar day `years` away (29 Feb → 28 Feb). */
function shiftYears(ymd: string, years: number): string {
  const y = Number(ymd.slice(0, 4)) + years;
  const m = Number(ymd.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad2(m)}-${pad2(Math.min(Number(ymd.slice(8, 10)), last))}`;
}

/** "YYYY-MM" `n` months before `ym`. */
function monthsBefore(ym: string, n: number): string {
  const total = Number(ym.slice(0, 4)) * 12 + (Number(ym.slice(5, 7)) - 1) - n;
  return `${Math.floor(total / 12)}-${pad2((total % 12) + 1)}`;
}

/** SQL: the instant an EAT calendar day (a bound parameter) starts. */
const eatStart = (p: string): string => `((${p})::date::timestamp AT TIME ZONE '${TZ}')`;
/** SQL: the instant the EAT day AFTER `p` starts — the exclusive bound of an inclusive `to`. */
const eatEnd = (p: string): string => `(((${p})::date + 1)::timestamp AT TIME ZONE '${TZ}')`;
/** SQL: the EAT calendar date of a timestamptz column. */
const eatDate = (col: string): string => `((${col}) AT TIME ZONE '${TZ}')::date`;
/** SQL: a timestamptz as UTC text with microseconds — exact keyset cursors. */
const cursorTs = (col: string): string => `to_char((${col}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Positional parameters for a query being assembled. */
class Params {
  readonly values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

/** ILIKE '%q%' with the user's own % and _ taken literally. */
function likeContains(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** KES first, then A–Z; `withKes` keeps KES present even with no data. */
export function sortCurrencies(cs: Iterable<string>, withKes = false): string[] {
  const set = new Set(cs);
  if (withKes) set.add("KES");
  return [...set].sort((a, b) => (a === b ? 0 : a === "KES" ? -1 : b === "KES" ? 1 : a.localeCompare(b)));
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

function encodeCursor(parts: string[]): string {
  return Buffer.from(JSON.stringify(parts), "utf8").toString("base64url");
}

function decodeCursor(raw: string, arity: number): string[] {
  let v: unknown = null;
  try {
    v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    v = null;
  }
  if (!Array.isArray(v) || v.length !== arity || !v.every((x) => typeof x === "string")) {
    throw new ApiError("VALIDATION_FAILED", "Malformed cursor");
  }
  return v as string[];
}

/** The transactions register's keyset: (created_at, receipt, id). Office
 *  gifts are all dated 12:00 EAT on their received day, so same-day entries tie
 *  on created_at; the gapless OR- number then orders them newest receipt first
 *  (zero-padded, so text order is number order). A legacy 2-part cursor
 *  (created_at, id) is still accepted. */
function txnCursor(raw: string): { ts: string; receipt: string | null; id: string } {
  let parts: string[];
  try {
    parts = decodeCursor(raw, 3);
  } catch {
    const [ts, id] = tsIdCursor(raw);
    return { ts, receipt: null, id };
  }
  const [ts, receipt, id] = parts as [string, string, string];
  if (!TS_RE.test(ts) || !isUuid(id) || receipt.length > 80) throw new ApiError("VALIDATION_FAILED", "Malformed cursor");
  return { ts, receipt, id };
}

/** A (timestamp, uuid) keyset cursor, validated before it reaches SQL. */
function tsIdCursor(raw: string): [string, string] {
  const [ts, id] = decodeCursor(raw, 2) as [string, string];
  if (!TS_RE.test(ts) || !isUuid(id)) throw new ApiError("VALIDATION_FAILED", "Malformed cursor");
  return [ts, id];
}

function checkRange(from: string | undefined, to: string | undefined): void {
  if (from && to && from > to) throw new ApiError("VALIDATION_FAILED", "`from` is after `to`");
}

/** A period with defaults: `to` = today (EAT); `from` = the first day of `to`'s month. */
export function resolvePeriod(from: string | undefined, to: string | undefined, now: Date): { from: string; to: string } {
  const t = to ?? nairobiDate(now);
  const f = from ?? `${t.slice(0, 8)}01`;
  checkRange(f, t);
  return { from: f, to: t };
}

// ── channels, labels, names ────────────────────────────────────────────────

/** Where a transaction's money came in (FinanceChannel): the office channel
 *  for an office-recorded gift, else the provider — `stripe` reads `card`. */
export const CHANNEL_SQL = `(CASE WHEN t.office_channel IS NOT NULL THEN t.office_channel WHEN t.provider = 'stripe' THEN 'card' ELSE t.provider END)`;

/** Who a transaction is from, for display: member → giver name → giver phone → "Anonymous". */
const DISPLAY_NAME_SQL = `COALESCE(u.full_name, NULLIF(btrim(t.giver_name), ''), NULLIF(btrim(t.giver_phone), ''), 'Anonymous')`;

export const CHANNELS = ["card", "mpesa", "airtel", "paypal", "manual", "onhand", "bank", "cheque", "other"] as const;

/** The cash accounts every channel breakdown lists, even at zero. */
const KNOWN_CASH_ACCOUNTS = ["cash:mpesa", "cash:airtel", "cash:stripe", "cash:paypal", "cash:manual", "cash:onhand", "cash:bank", "cash:cheque"];

export function channelLabel(channel: string): string {
  const office: Record<string, string> = {
    onhand: "Cash",
    bank: "Bank",
    cheque: "Cheque",
    other: "Other",
    manual: "Manual (confirmed claims)",
    stripe: "Card",
  };
  return office[channel] ?? methodLabel(channel);
}

/** cash:stripe → card; cash:mpesa → mpesa. */
function channelOfAccount(account: string): string {
  const c = account.startsWith("cash:") ? account.slice(5) : account;
  return c === "stripe" ? "card" : c;
}

function accountLabel(account: string, fundNames: Map<string, string>): string {
  if (account.startsWith("cash:")) return channelLabel(channelOfAccount(account));
  if (account.startsWith("fund:")) return fundNames.get(account.slice(5)) ?? account.slice(5);
  if (account === "sales:media") return "Media sales";
  return account;
}

const SOURCE_LABELS: Record<string, string> = { app: "App", website: "Website", admin: "Office" };

// ── transactions (the register; also serves FinancialService.listTransactions) ──

export const TransactionsQuery = z.object({
  from: Day.optional(),
  to: Day.optional(),
  fund: z.string().trim().min(1).max(40).optional(),
  status: z.enum(["requires_action", "processing", "succeeded", "failed", "refunded"]).optional(),
  // FinanceChannel, plus `stripe` as an alias of `card`.
  channel: z.enum(["card", "mpesa", "airtel", "paypal", "manual", "onhand", "bank", "cheque", "other", "stripe"]).optional(),
  source: z.enum(["app", "website", "admin"]).optional(),
  q: z.string().trim().max(80).optional(),
  pledged: z.enum(["any", "yes", "no"]).default("any"),
  need: z.enum(["any", "yes", "no"]).default("any"),
  cursor: z.string().max(400).optional(),
  /** The earlier paging parameter: a created_at instant, or a cursor. */
  before: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type TransactionsQueryInput = z.input<typeof TransactionsQuery>;
type TransactionsFilter = z.infer<typeof TransactionsQuery>;

const TXN_FROM = `
  FROM transactions t
  LEFT JOIN users u ON u.user_id = t.user_id
  LEFT JOIN funds f ON f.fund_id = t.fund_id`;

function transactionFilters(q: TransactionsFilter, P: Params): string[] {
  checkRange(q.from, q.to);
  const w: string[] = [];
  if (q.from) w.push(`t.created_at >= ${eatStart(P.add(q.from))}`);
  if (q.to) w.push(`t.created_at < ${eatEnd(P.add(q.to))}`);
  if (q.fund) w.push(`f.code = ${P.add(q.fund)}`);
  if (q.status) w.push(`t.status = ${P.add(q.status)}::txn_status`);
  if (q.channel) w.push(`${CHANNEL_SQL} = ${P.add(q.channel === "stripe" ? "card" : q.channel)}`);
  if (q.source) w.push(`t.source = ${P.add(q.source)}`);
  if (q.pledged === "yes") w.push(`t.pledge_id IS NOT NULL`);
  if (q.pledged === "no") w.push(`t.pledge_id IS NULL`);
  if (q.need === "yes") w.push(`t.need_id IS NOT NULL`);
  if (q.need === "no") w.push(`t.need_id IS NULL`);
  if (q.q) {
    const like = P.add(likeContains(q.q));
    w.push(`(t.receipt_code ILIKE ${like} OR t.office_reference ILIKE ${like}
             OR u.full_name ILIKE ${like} OR u.phone_number ILIKE ${like}
             OR t.giver_name ILIKE ${like} OR t.giver_phone ILIKE ${like}
             OR t.provider_ref ILIKE ${like} OR t.stripe_payment_intent ILIKE ${like})`);
  }
  return w;
}

const TXN_COLUMNS = `
       t.transaction_id, t.user_id, u.full_name, u.phone_number AS member_phone,
       ${DISPLAY_NAME_SQL} AS display_name,
       t.amount_minor::text AS amount_minor, t.currency, t.status::text AS status,
       f.code AS fund, f.name AS fund_name, t.account_name,
       t.provider AS method, ${CHANNEL_SQL} AS channel, t.source, t.provider,
       COALESCE(t.provider_ref, t.stripe_payment_intent) AS provider_ref,
       t.receipt_code, t.giver_name, t.giver_phone,
       t.pledge_id, ${pledgeTitleSql({ pledge: "p", fund: "pf", campaign: "c" })} AS pledge_title,
       t.need_id, n.title AS need_title,
       t.office_channel, t.office_reference,
       t.recorded_by, rb.full_name AS recorded_by_name,
       t.reversed_at, t.reversed_by, vb.full_name AS reversed_by_name, t.reversal_reason,
       t.created_at, t.settled_at`;

const TXN_DETAIL_JOINS = `
  LEFT JOIN pledges p ON p.pledge_id = t.pledge_id
  LEFT JOIN funds pf ON pf.fund_id = p.fund_id
  LEFT JOIN campaigns c ON c.campaign_id = p.campaign_id
  LEFT JOIN department_needs n ON n.need_id = t.need_id
  LEFT JOIN users rb ON rb.user_id = t.recorded_by
  LEFT JOIN users vb ON vb.user_id = t.reversed_by`;

export interface FinanceTransactionRow extends Record<string, unknown> {
  transaction_id: string;
  amount_minor: number;
  currency: string;
  status: string;
}

function shapeTxn(r: Record<string, unknown>): FinanceTransactionRow {
  const { cursor_ts: _c, ...rest } = r;
  void _c;
  return { ...rest, amount_minor: Number(r.amount_minor) } as FinanceTransactionRow;
}

export interface CurrencyTotal { currency: string; amount_minor: number; count: number }

function totalsFrom(rows: { currency: string; amount_minor: unknown; count: unknown }[]): CurrencyTotal[] {
  const by = new Map(rows.map((r) => [r.currency, r]));
  return sortCurrencies(by.keys()).map((c) => ({ currency: c, amount_minor: num(by.get(c)!.amount_minor), count: num(by.get(c)!.count) }));
}

/** The transactions register: one keyset page (or, with `all`, every matching
 *  row — the CSV) and per-currency totals over the WHOLE filtered set
 *  (amount = succeeded only; count = every row). */
export async function listFinanceTransactions(
  pool: Queryable,
  input: TransactionsQueryInput,
  opts: { all?: boolean } = {},
): Promise<{ data: FinanceTransactionRow[]; next_cursor: string | null; totals: CurrencyTotal[] }> {
  const q = TransactionsQuery.parse(input);

  const T = new Params();
  const tw = transactionFilters(q, T);
  const totals = totalsFrom(
    await many<{ currency: string; amount_minor: string; count: number }>(
      pool,
      `SELECT t.currency,
              COALESCE(sum(t.amount_minor) FILTER (WHERE t.status = 'succeeded'), 0)::text AS amount_minor,
              count(*)::int AS count
         ${TXN_FROM}
        WHERE ${tw.length ? tw.join(" AND ") : "TRUE"}
        GROUP BY t.currency`,
      T.values,
    ),
  );

  const P = new Params();
  const w = transactionFilters(q, P);
  if (!opts.all) {
    let keyset: { ts: string; receipt: string | null; id: string } | null = q.cursor ? txnCursor(q.cursor) : null;
    if (!keyset && q.before) {
      // The earlier API paged with `before` = a created_at; accept a cursor
      // there too, so a client that fed next_cursor back as `before` works.
      try {
        keyset = txnCursor(q.before);
      } catch {
        const at = Date.parse(q.before);
        if (Number.isNaN(at)) throw new ApiError("VALIDATION_FAILED", "`before` is neither a timestamp nor a cursor");
        w.push(`t.created_at < ${P.add(new Date(at).toISOString())}::timestamptz`);
      }
    }
    if (keyset && keyset.receipt !== null) {
      w.push(`(t.created_at, COALESCE(t.receipt_code, ''), t.transaction_id) < (${P.add(keyset.ts)}::timestamptz, ${P.add(keyset.receipt)}::text, ${P.add(keyset.id)}::uuid)`);
    } else if (keyset) {
      w.push(`(t.created_at, t.transaction_id) < (${P.add(keyset.ts)}::timestamptz, ${P.add(keyset.id)}::uuid)`);
    }
  }
  const limit = opts.all ? 100_000 : q.limit + 1;
  const rows = await many<Record<string, unknown>>(
    pool,
    `SELECT ${TXN_COLUMNS}, ${cursorTs("t.created_at")} AS cursor_ts
       ${TXN_FROM}
       ${TXN_DETAIL_JOINS}
      WHERE ${w.length ? w.join(" AND ") : "TRUE"}
      ORDER BY t.created_at DESC, COALESCE(t.receipt_code, '') DESC, t.transaction_id DESC
      LIMIT ${P.add(limit)}`,
    P.values,
  );
  const hasMore = !opts.all && rows.length > q.limit;
  const page = hasMore ? rows.slice(0, q.limit) : rows;
  const last = page[page.length - 1];
  return {
    data: page.map(shapeTxn),
    next_cursor: hasMore && last ? encodeCursor([String(last.cursor_ts), String(last.receipt_code ?? ""), String(last.transaction_id)]) : null,
    totals,
  };
}

/** One transaction as the office sees it — office and reversal fields, who
 *  recorded / reversed it — with EVERY posting it owns (the original pair and
 *  any reversing pair). Null when there is no such transaction. */
export async function financeTransactionDetail(pool: Queryable, id: string): Promise<Record<string, unknown> | null> {
  if (!isUuid(id)) return null;
  const txn = await maybeOne<Record<string, unknown>>(
    pool,
    `SELECT ${TXN_COLUMNS},
            t.stripe_payment_intent, t.idempotency_key, t.schedule_id, t.giver_email
       ${TXN_FROM}
       ${TXN_DETAIL_JOINS}
      WHERE t.transaction_id = $1`,
    [id],
  );
  if (!txn) return null;
  const legs = await many<Record<string, unknown>>(
    pool,
    `SELECT entry_id, account, side::text AS side, amount_minor::text AS amount_minor, currency, created_at,
            ((side = 'debit' AND account NOT LIKE 'cash:%') OR (side = 'credit' AND account LIKE 'cash:%')) AS is_reversal
       FROM ledger_entries
      WHERE transaction_id = $1
      ORDER BY 7, (side = 'debit') DESC, created_at, entry_id`,
    [id],
  );
  return {
    transaction: { ...txn, amount_minor: Number(txn.amount_minor) },
    ledger_entries: legs.map((l) => ({ ...l, amount_minor: Number(l.amount_minor) })),
  };
}

// ── the trend (per currency; also serves FinancialService.financeTrend) ──────

export interface TrendPoint { m: string; month: string; total_minor: number }

/** Succeeded giving per EAT month (created_at), zero-filled, the last `months`
 *  months ending with the current one — one series PER CURRENCY. `data` is
 *  the KES series: the old response added every currency together, and the
 *  old Finance page reads `data`. */
export async function financeTrendByCurrency(
  pool: Queryable,
  months: number,
  now: Date = new Date(),
): Promise<{ data: TrendPoint[]; currency: string; series: { currency: string; points: TrendPoint[] }[] }> {
  const n = Math.min(Math.max(Math.trunc(months), 1), 24);
  const thisMonth = nairobiDate(now).slice(0, 7);
  const firstMonth = monthsBefore(thisMonth, n - 1);
  const rows = await many<{ ym: string; currency: string; total: string }>(
    pool,
    `SELECT to_char(t.created_at AT TIME ZONE '${TZ}', 'YYYY-MM') AS ym, t.currency, sum(t.amount_minor)::text AS total
       FROM transactions t
      WHERE t.status = 'succeeded'
        AND t.created_at >= ${eatStart("$1")}
        AND t.created_at < ${eatStart("$2")}
      GROUP BY 1, 2`,
    [`${firstMonth}-01`, `${monthsBefore(thisMonth, -1)}-01`],
  );
  const yms = Array.from({ length: n }, (_, i) => monthsBefore(thisMonth, n - 1 - i));
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const series = sortCurrencies(rows.map((r) => r.currency), true).map((currency) => ({
    currency,
    points: yms.map((ym) => ({
      m: MON[Number(ym.slice(5, 7)) - 1]!,
      // The calendar month's first day, as the old response carried it.
      month: `${ym}-01T00:00:00.000Z`,
      total_minor: num(rows.find((r) => r.ym === ym && r.currency === currency)?.total),
    })),
  }));
  return { data: series[0]!.points, currency: "KES", series };
}

// ── the finance audit trail (also serves FinancialService.financeAudit) ─────

/** The finance slice of the audit log (§5.10). */
export const FINANCE_AUDIT_PREFIXES = [
  "giving.", "purchase.", "finance.", "webhook.", "pledge.", "department.need",
  "expense.", "budget.", "journal.", "fund.",
] as const;

export const FinanceAuditQuery = z.object({
  action_prefix: z.string().trim().min(1).max(80).optional(),
  actor: z.union([z.enum(["All", "System", "Admin"]), z.string().uuid()]).default("All"),
  from: Day.optional(),
  to: Day.optional(),
  cursor: z.string().regex(/^\d{1,18}$/, "Malformed cursor").optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type FinanceAuditQueryInput = z.input<typeof FinanceAuditQuery>;

export async function financeAuditPage(
  pool: Queryable,
  input: FinanceAuditQueryInput,
): Promise<{ data: Record<string, unknown>[]; next_cursor: string | null }> {
  const q = FinanceAuditQuery.parse(input);
  checkRange(q.from, q.to);
  const P = new Params();
  const w: string[] = [`(${FINANCE_AUDIT_PREFIXES.map((p) => `left(a.action, ${p.length}) = ${P.add(p)}`).join(" OR ")})`];
  if (q.action_prefix) {
    const prefix = q.action_prefix;
    if (!FINANCE_AUDIT_PREFIXES.some((p) => prefix.startsWith(p))) {
      throw new ApiError("VALIDATION_FAILED", `action_prefix must start with one of: ${FINANCE_AUDIT_PREFIXES.join(", ")}`);
    }
    w.push(`left(a.action, ${prefix.length}) = ${P.add(prefix)}`);
  }
  if (q.actor === "System") w.push(`a.actor_id IS NULL`);
  else if (q.actor === "Admin") w.push(`a.actor_id IS NOT NULL`);
  else if (q.actor !== "All") w.push(`a.actor_id = ${P.add(q.actor)}::uuid`);
  if (q.from) w.push(`a.occurred_at >= ${eatStart(P.add(q.from))}`);
  if (q.to) w.push(`a.occurred_at < ${eatEnd(P.add(q.to))}`);
  if (q.cursor) w.push(`a.audit_id < ${P.add(q.cursor)}::bigint`);
  const rows = await many<Record<string, unknown>>(
    pool,
    `SELECT a.audit_id, a.actor_id, u.full_name AS actor_name, a.action, a.entity,
            a.entity_id, a.metadata, a.occurred_at,
            CASE WHEN a.actor_id IS NULL THEN 'System' ELSE 'Admin' END AS actor_type
       FROM audit_log a LEFT JOIN users u ON u.user_id = a.actor_id
      WHERE ${w.join(" AND ")}
      ORDER BY a.audit_id DESC
      LIMIT ${P.add(q.limit + 1)}`,
    P.values,
  );
  const hasMore = rows.length > q.limit;
  const page = (hasMore ? rows.slice(0, q.limit) : rows).map((r) => ({ ...r, audit_id: Number(r.audit_id) }));
  return { data: page, next_cursor: hasMore ? String(page[page.length - 1]!.audit_id) : null };
}

// ── the ledger (postings; also serves FinancialService.listLedger) ──────────

export const LedgerQuery = z.object({
  /** An exact account (fund:tithe), or a prefix ending in ':' (cash:). */
  account: z.string().trim().min(1).max(60).optional(),
  kind: z.enum(["transaction", "journal"]).optional(),
  from: Day.optional(),
  to: Day.optional(),
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type LedgerQueryInput = z.input<typeof LedgerQuery>;

function ledgerFilters(q: z.infer<typeof LedgerQuery>, P: Params): string[] {
  checkRange(q.from, q.to);
  const w: string[] = [];
  if (q.account) {
    w.push(q.account.endsWith(":")
      ? `left(le.account, ${q.account.length}) = ${P.add(q.account)}`
      : `le.account = ${P.add(q.account)}`);
  }
  if (q.kind === "transaction") w.push(`le.transaction_id IS NOT NULL`);
  if (q.kind === "journal") w.push(`le.journal_id IS NOT NULL`);
  if (q.from) w.push(`le.created_at >= ${eatStart(P.add(q.from))}`);
  if (q.to) w.push(`le.created_at < ${eatEnd(P.add(q.to))}`);
  return w;
}

export interface LedgerTotal { currency: string; amount_minor: number; count: number; debit_minor: number; credit_minor: number }

export async function listLedgerPage(
  pool: Queryable,
  input: LedgerQueryInput,
  opts: { all?: boolean } = {},
): Promise<{ data: Record<string, unknown>[]; next_cursor: string | null; totals: LedgerTotal[] }> {
  const q = LedgerQuery.parse(input);
  const T = new Params();
  const tw = ledgerFilters(q, T);
  const trows = await many<{ currency: string; debit: string; credit: string; count: number }>(
    pool,
    `SELECT le.currency,
            COALESCE(sum(le.amount_minor) FILTER (WHERE le.side = 'debit'), 0)::text AS debit,
            COALESCE(sum(le.amount_minor) FILTER (WHERE le.side = 'credit'), 0)::text AS credit,
            count(*)::int AS count
       FROM ledger_entries le
      WHERE ${tw.length ? tw.join(" AND ") : "TRUE"}
      GROUP BY le.currency`,
    T.values,
  );
  const by = new Map(trows.map((r) => [r.currency, r]));
  const totals = sortCurrencies(by.keys()).map((c) => {
    const r = by.get(c)!;
    return { currency: c, amount_minor: num(r.debit) - num(r.credit), count: r.count, debit_minor: num(r.debit), credit_minor: num(r.credit) };
  });

  const P = new Params();
  const w = ledgerFilters(q, P);
  if (!opts.all && q.cursor) {
    const [ts, id] = tsIdCursor(q.cursor);
    w.push(`(le.created_at, le.entry_id) < (${P.add(ts)}::timestamptz, ${P.add(id)}::uuid)`);
  }
  const limit = opts.all ? 200_000 : q.limit + 1;
  const rows = await many<Record<string, unknown>>(
    pool,
    `SELECT le.entry_id,
            CASE WHEN le.journal_id IS NULL THEN 'transaction' ELSE 'journal' END AS kind,
            le.transaction_id, le.journal_id, le.account, le.side::text AS side,
            le.amount_minor::text AS amount_minor, le.currency, le.created_at,
            ${eatDate("le.created_at")}::text AS posted_on,
            t.receipt_code, t.user_id,
            CASE WHEN t.transaction_id IS NULL THEN NULL ELSE ${DISPLAY_NAME_SQL} END AS member_name,
            t.status::text AS transaction_status,
            j.kind AS journal_kind, j.memo,
            ${cursorTs("le.created_at")} AS cursor_ts
       FROM ledger_entries le
       LEFT JOIN transactions t ON t.transaction_id = le.transaction_id
       LEFT JOIN users u ON u.user_id = t.user_id
       LEFT JOIN journals j ON j.journal_id = le.journal_id
      WHERE ${w.length ? w.join(" AND ") : "TRUE"}
      ORDER BY le.created_at DESC, le.entry_id DESC
      LIMIT ${P.add(limit)}`,
    P.values,
  );
  const hasMore = !opts.all && rows.length > q.limit;
  const page = hasMore ? rows.slice(0, q.limit) : rows;
  const last = page[page.length - 1];
  return {
    data: page.map((r) => {
      const { cursor_ts: _c, ...rest } = r;
      void _c;
      return { ...rest, amount_minor: Number(r.amount_minor) };
    }),
    next_cursor: hasMore && last ? encodeCursor([String(last.cursor_ts), String(last.entry_id)]) : null,
    totals,
  };
}

// ── query schemas for the service below ─────────────────────────────────────

export const PeriodQuery = z.object({ from: Day.optional(), to: Day.optional() });
export const PledgesQuery = z.object({
  year: Year.optional(),
  status: z.enum(["active", "paused", "fulfilled", "cancelled"]).optional(),
  standing: z.enum(["on_track", "behind"]).optional(),
  shape: z.enum(["monthly", "total"]).optional(),
  q: z.string().trim().max(80).optional(),
  /** One member's pledges (the partner drawer's faithfulness strip) — exact,
   *  where searching by name could catch a namesake. */
  user_id: z.string().uuid().optional(),
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const IncomeReportQuery = z.object({ year: Year.optional(), by: z.enum(["fund", "channel", "source"]).default("fund") });
export const ExpenseReportQuery = z.object({ year: Year.optional(), by: z.enum(["category", "fund"]).default("category") });
export const YearQuery = z.object({ year: Year.optional() });
export const StatementsQuery = z.object({
  year: Year.optional(),
  q: z.string().trim().max(80).optional(),
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const NeedsQuery = z.object({
  status: z.enum(["pending", "approved", "rejected", "closed", "all"]).default("approved"),
  q: z.string().trim().max(80).optional(),
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const AsOfQuery = z.object({ as_of: Day.optional() });
export const GiversQuery = z.object({
  q: z.string().trim().min(2, "Type at least 2 characters").max(80),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

/** Accents folded and lower-cased, in SQL: the Latin diacritics a member's
 *  name may carry, upper and lower case (lower() alone does not fold them in
 *  the C locale). Chained replace() rather than translate(): replace matches
 *  whole byte sequences, so it folds correctly under any server encoding
 *  (translate works per character and mis-folds in a SQL_ASCII database —
 *  the test cluster's). Cheap and extension-free; the query term is folded
 *  the same way in JS (foldText). */
const FOLD_FROM = "áàâäãåāéèêëēíìîïīóòôöõōúùûüūñçýÿÁÀÂÄÃÅĀÉÈÊËĒÍÌÎÏĪÓÒÔÖÕŌÚÙÛÜŪÑÇÝ";
const FOLD_TO = "aaaaaaaeeeeeiiiiioooooouuuuuncyyaaaaaaaeeeeeiiiiioooooouuuuuncy";
const FOLD_PAIRS: [string, string][] = [...FOLD_FROM].map((c, i) => [c, FOLD_TO[i]!]);
const foldSql = (col: string): string => `lower(${FOLD_PAIRS.reduce((acc, [f, t]) => `replace(${acc}, '${f}', '${t}')`, col)})`;
function foldText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export type ReconciliationKind =
  | "stale_processing" | "failed" | "succeeded_without_ledger" | "unbalanced_transaction"
  | "refunded_without_reversal" | "duplicate_receipt" | "unbalanced_journal";
export const RECONCILIATION_KINDS: readonly ReconciliationKind[] = [
  "stale_processing", "failed", "succeeded_without_ledger", "unbalanced_transaction",
  "refunded_without_reversal", "duplicate_receipt", "unbalanced_journal",
];
/** The kinds that mean the books themselves are wrong (the Overview's integrity_issues). */
const INTEGRITY_KINDS: readonly ReconciliationKind[] = [
  "succeeded_without_ledger", "unbalanced_transaction", "refunded_without_reversal", "duplicate_receipt", "unbalanced_journal",
];

export interface ReconciliationException {
  kind: ReconciliationKind;
  transaction_id: string | null;
  journal_id: string | null;
  amount_minor: number | null;
  currency: string | null;
  at: string | null;
  detail: string;
}

/** M-Pesa / Airtel STK pushes are stale after this; cards and PayPal after 24 h. */
export const STALE_STK_MINUTES = 30;
export const STALE_CHECKOUT_HOURS = 24;

interface MatrixRow { key: string; label: string; months: number[]; total_minor: number }
interface MatrixCurrency { currency: string; rows: MatrixRow[]; totals: { months: number[]; total_minor: number } }

/** rows × 12 months per currency from flat (currency, month, key, label, total) cells. */
function buildMatrix(cells: { currency: string; m: number; key: string; label: string; total: string | number }[]): MatrixCurrency[] {
  return sortCurrencies(cells.map((c) => c.currency), true).map((currency) => {
    const rows = new Map<string, MatrixRow>();
    for (const c of cells.filter((x) => x.currency === currency)) {
      const row = rows.get(c.key) ?? { key: c.key, label: c.label, months: Array<number>(12).fill(0), total_minor: 0 };
      row.months[c.m - 1] = (row.months[c.m - 1] ?? 0) + num(c.total);
      row.total_minor += num(c.total);
      rows.set(c.key, row);
    }
    const list = [...rows.values()].sort((a, b) => b.total_minor - a.total_minor || a.key.localeCompare(b.key));
    const months = Array.from({ length: 12 }, (_, i) => list.reduce((a, r) => a + (r.months[i] ?? 0), 0));
    return { currency, rows: list, totals: { months, total_minor: months.reduce((a, v) => a + v, 0) } };
  });
}

/** Plain code-point order on a two-part key (what the registers sort by, so a
 *  keyset comparison agrees with the sort). */
function cmpKey(a: [string, string], b: [string, string]): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  return 0;
}

/** Keyset paging over an in-memory list (the evaluated registers), sorted by
 *  `keyOf` in `dir`: the page starts at the first row strictly after the
 *  cursor's key, so a row that changed or vanished never causes a repeat or a
 *  skip of the rows around it. */
function pageBy<T>(items: T[], keyOf: (x: T) => [string, string], dir: "asc" | "desc", cursor: string | undefined, limit: number): { page: T[]; next_cursor: string | null } {
  const sorted = [...items].sort((x, y) => (dir === "asc" ? cmpKey(keyOf(x), keyOf(y)) : cmpKey(keyOf(y), keyOf(x))));
  let start = 0;
  if (cursor) {
    const k = decodeCursor(cursor, 2) as [string, string];
    const i = sorted.findIndex((x) => (dir === "asc" ? cmpKey(keyOf(x), k) > 0 : cmpKey(keyOf(x), k) < 0));
    start = i < 0 ? sorted.length : i;
  }
  const page = sorted.slice(start, start + limit);
  const more = start + limit < sorted.length;
  const last = page[page.length - 1];
  return { page, next_cursor: more && last ? encodeCursor(keyOf(last)) : null };
}

/** KES first, then A–Z, for sorting rows by currency. */
function currencyOrder(a: string, b: string): number {
  return a === b ? 0 : a === "KES" ? -1 : b === "KES" ? 1 : a.localeCompare(b);
}

/** One currency-amount per currency a row list carries for `code`, zeros dropped. */
function amountsFor<R extends { code: string; currency: string }>(rows: R[], code: string, pick: (r: R) => number): { currency: string; amount_minor: number }[] {
  const mine = rows.filter((r) => r.code === code);
  return sortCurrencies(mine.map((r) => r.currency))
    .map((c) => ({ currency: c, amount_minor: mine.filter((r) => r.currency === c).reduce((a, r) => a + pick(r), 0) }))
    .filter((x) => x.amount_minor !== 0);
}

/** A year-end giver (GET /statements). */
export interface GiverRow {
  user_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  gifts: number;
  totals: CurrencyTotal[];
  by_fund: { code: string; name: string; currency: string; amount_minor: number }[];
  pledge_paid: { currency: string; amount_minor: number }[];
  last_gift_at: Date;
}

export interface FinanceReportsDeps {
  financial: FinancialService;
  partners: PartnersService;
}

export class FinanceReportsService {
  constructor(private readonly pool: Pool, private readonly deps: FinanceReportsDeps) {}

  // ── fund names ───────────────────────────────────────────────────────────

  private async fundNames(): Promise<Map<string, string>> {
    const rows = await many<{ code: string; name: string }>(this.pool, `SELECT code, name FROM funds`);
    return new Map(rows.map((r) => [r.code, r.name]));
  }

  // ── reconciliation ───────────────────────────────────────────────────────

  /** Every exception kind (§4 Reconciliation). `failed` is bounded by the
   *  period; every other kind is an open issue whenever it arose. */
  async exceptions(period: { from: string; to: string }, now: Date = new Date()): Promise<ReconciliationException[]> {
    const out: ReconciliationException[] = [];
    const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

    const stale = await many<{ transaction_id: string; amount_minor: string; currency: string; created_at: Date; provider: string; status: string; minutes: number }>(
      this.pool,
      `SELECT t.transaction_id, t.amount_minor::text, t.currency, t.created_at, t.provider, t.status::text AS status,
              floor(extract(epoch FROM ($1::timestamptz - t.created_at)) / 60)::int AS minutes
         FROM transactions t
        WHERE t.status IN ('processing', 'requires_action')
          AND ((t.provider IN ('mpesa', 'airtel') AND t.created_at < $1::timestamptz - make_interval(mins => $2))
               OR (t.provider NOT IN ('mpesa', 'airtel') AND t.created_at < $1::timestamptz - make_interval(hours => $3)))
        ORDER BY t.created_at`,
      [now.toISOString(), STALE_STK_MINUTES, STALE_CHECKOUT_HOURS],
    );
    for (const r of stale) {
      const h = Math.floor(r.minutes / 60);
      const age = h >= 48 ? `${Math.floor(h / 24)} days` : h >= 1 ? `${h} h ${r.minutes % 60} min` : `${r.minutes} min`;
      out.push({
        kind: "stale_processing", transaction_id: r.transaction_id, journal_id: null,
        amount_minor: Number(r.amount_minor), currency: r.currency, at: iso(r.created_at),
        detail: `${channelLabel(r.provider)} payment still ${r.status.replace("_", " ")} after ${age}`,
      });
    }

    const failed = await many<{ transaction_id: string; amount_minor: string; currency: string; created_at: Date; provider: string }>(
      this.pool,
      `SELECT t.transaction_id, t.amount_minor::text, t.currency, t.created_at, t.provider
         FROM transactions t
        WHERE t.status = 'failed' AND t.created_at >= ${eatStart("$1")} AND t.created_at < ${eatEnd("$2")}
        ORDER BY t.created_at DESC`,
      [period.from, period.to],
    );
    for (const r of failed) {
      out.push({
        kind: "failed", transaction_id: r.transaction_id, journal_id: null,
        amount_minor: Number(r.amount_minor), currency: r.currency, at: iso(r.created_at),
        detail: `${channelLabel(r.provider)} payment failed`,
      });
    }

    const noLedger = await many<{ transaction_id: string; amount_minor: string; currency: string; created_at: Date }>(
      this.pool,
      `SELECT t.transaction_id, t.amount_minor::text, t.currency, t.created_at
         FROM transactions t
        WHERE t.status = 'succeeded'
          AND NOT EXISTS (SELECT 1 FROM ledger_entries le WHERE le.transaction_id = t.transaction_id)
        ORDER BY t.created_at DESC`,
    );
    for (const r of noLedger) {
      out.push({
        kind: "succeeded_without_ledger", transaction_id: r.transaction_id, journal_id: null,
        amount_minor: Number(r.amount_minor), currency: r.currency, at: iso(r.created_at),
        detail: "Succeeded, but nothing was posted to the ledger",
      });
    }

    const unbalanced = await many<{ transaction_id: string; created_at: Date; off: { currency: string; debit: number; credit: number }[] }>(
      this.pool,
      `WITH per AS (
         SELECT le.transaction_id, le.currency,
                COALESCE(sum(le.amount_minor) FILTER (WHERE le.side = 'debit'), 0) AS debit,
                COALESCE(sum(le.amount_minor) FILTER (WHERE le.side = 'credit'), 0) AS credit
           FROM ledger_entries le WHERE le.transaction_id IS NOT NULL
          GROUP BY le.transaction_id, le.currency)
       SELECT t.transaction_id, t.created_at,
              json_agg(json_build_object('currency', per.currency, 'debit', per.debit, 'credit', per.credit) ORDER BY per.currency) AS off
         FROM per JOIN transactions t ON t.transaction_id = per.transaction_id
        WHERE per.debit <> per.credit
        GROUP BY t.transaction_id, t.created_at
        ORDER BY t.created_at DESC`,
    );
    for (const r of unbalanced) {
      const first = r.off[0]!;
      out.push({
        kind: "unbalanced_transaction", transaction_id: r.transaction_id, journal_id: null,
        amount_minor: Math.abs(num(first.debit) - num(first.credit)), currency: first.currency, at: iso(r.created_at),
        detail: r.off.map((o) => `${o.currency}: debits ${num(o.debit)} ≠ credits ${num(o.credit)}`).join("; "),
      });
    }

    const refunded = await many<{ transaction_id: string; amount_minor: string; currency: string; created_at: Date }>(
      this.pool,
      `SELECT t.transaction_id, t.amount_minor::text, t.currency, t.created_at
         FROM transactions t
        WHERE t.status = 'refunded'
          AND NOT EXISTS (SELECT 1 FROM ledger_entries le
                           WHERE le.transaction_id = t.transaction_id AND le.side = 'credit' AND le.account LIKE 'cash:%')
        ORDER BY t.created_at DESC`,
    );
    for (const r of refunded) {
      out.push({
        kind: "refunded_without_reversal", transaction_id: r.transaction_id, journal_id: null,
        amount_minor: Number(r.amount_minor), currency: r.currency, at: iso(r.created_at),
        detail: "Marked refunded, but no reversing entry takes the money back out of cash",
      });
    }

    // (a) one receipt code on more than one live row — the unique index is
    // exact-match, so compare trimmed and case-folded.
    const dupCodes = await many<{ code: string; ids: string[]; codes: string[]; created_at: Date; amount_minor: string; currency: string }>(
      this.pool,
      `SELECT upper(btrim(t.receipt_code)) AS code,
              array_agg(t.transaction_id::text ORDER BY t.created_at, t.transaction_id) AS ids,
              array_agg(t.receipt_code ORDER BY t.created_at, t.transaction_id) AS codes,
              max(t.created_at) AS created_at,
              (array_agg(t.amount_minor::text ORDER BY t.created_at DESC, t.transaction_id DESC))[1] AS amount_minor,
              (array_agg(t.currency ORDER BY t.created_at DESC, t.transaction_id DESC))[1] AS currency
         FROM transactions t
        WHERE t.receipt_code IS NOT NULL AND btrim(t.receipt_code) <> '' AND t.status <> 'failed'
        GROUP BY 1 HAVING count(*) > 1
        ORDER BY 1`,
    );
    for (const r of dupCodes) {
      out.push({
        kind: "duplicate_receipt", transaction_id: r.ids[r.ids.length - 1]!, journal_id: null,
        amount_minor: Number(r.amount_minor), currency: r.currency, at: iso(r.created_at),
        detail: `Receipt ${r.code} is on ${r.ids.length} transactions: ${r.ids.map((id, i) => `${id} (${r.codes[i]})`).join(", ")}`,
      });
    }
    // (b) an office M-Pesa entry whose code also settled online — the office
    // recorded a payment that arrived by itself; reverse the office row.
    const doubleEntered = await many<{ office_id: string; office_receipt: string | null; office_reference: string; amount_minor: string; currency: string; created_at: Date; others: { id: string; receipt: string }[] }>(
      this.pool,
      `SELECT o.transaction_id AS office_id, o.receipt_code AS office_receipt, o.office_reference,
              o.amount_minor::text, o.currency, o.created_at,
              json_agg(json_build_object('id', x.transaction_id, 'receipt', x.receipt_code) ORDER BY x.created_at) AS others
         FROM transactions o
         JOIN transactions x ON x.transaction_id <> o.transaction_id AND x.status = 'succeeded'
                            AND upper(btrim(x.receipt_code)) = upper(btrim(o.office_reference))
        WHERE o.office_channel = 'mpesa' AND o.status = 'succeeded'
          AND o.office_reference IS NOT NULL AND btrim(o.office_reference) <> ''
        GROUP BY o.transaction_id
        ORDER BY o.created_at DESC`,
    );
    for (const r of doubleEntered) {
      const code = r.office_reference.trim().toUpperCase();
      out.push({
        kind: "duplicate_receipt", transaction_id: r.office_id, journal_id: null,
        amount_minor: Number(r.amount_minor), currency: r.currency, at: iso(r.created_at),
        detail: `Office M-Pesa entry ${r.office_receipt ?? r.office_id} (${r.office_id}) records M-Pesa code ${code}, which is also the receipt of settled ${r.others
          .map((x) => `${x.id} (${x.receipt})`)
          .join(", ")} — reverse the office entry`,
      });
    }

    const journals = await many<{ journal_id: string; kind: string; memo: string | null; created_at: Date; legs: number; off: { currency: string; net: number }[] | null }>(
      this.pool,
      `WITH per AS (
         SELECT le.journal_id, le.currency,
                sum(CASE WHEN le.side = 'debit' THEN le.amount_minor ELSE -le.amount_minor END) AS net
           FROM ledger_entries le WHERE le.journal_id IS NOT NULL
          GROUP BY le.journal_id, le.currency)
       SELECT j.journal_id, j.kind, j.memo, j.created_at,
              (SELECT count(*)::int FROM ledger_entries le WHERE le.journal_id = j.journal_id) AS legs,
              (SELECT json_agg(json_build_object('currency', per.currency, 'net', per.net) ORDER BY per.currency)
                 FROM per WHERE per.journal_id = j.journal_id AND per.net <> 0) AS off
         FROM journals j
        WHERE NOT EXISTS (SELECT 1 FROM ledger_entries le WHERE le.journal_id = j.journal_id)
           OR EXISTS (SELECT 1 FROM per WHERE per.journal_id = j.journal_id AND per.net <> 0)
        ORDER BY j.created_at DESC`,
    );
    for (const r of journals) {
      const first = r.off?.[0] ?? null;
      out.push({
        kind: "unbalanced_journal", transaction_id: null, journal_id: r.journal_id,
        amount_minor: first ? Math.abs(num(first.net)) : null, currency: first?.currency ?? null, at: iso(r.created_at),
        detail: r.legs === 0
          ? `Journal (${r.kind}) has no postings`
          : `Journal (${r.kind}${r.memo ? `: ${r.memo}` : ""}) does not balance — ${(r.off ?? []).map((o) => `${o.currency} off by ${Math.abs(num(o.net))}`).join("; ")}`,
      });
    }
    return out;
  }

  /** Σ debits and Σ credits over the whole ledger, per currency. */
  private async integrity(): Promise<{ currency: string; debit_minor: number; credit_minor: number; balanced: boolean }[]> {
    const rows = await many<{ currency: string; debit: string; credit: string }>(
      this.pool,
      `SELECT currency,
              COALESCE(sum(amount_minor) FILTER (WHERE side = 'debit'), 0)::text AS debit,
              COALESCE(sum(amount_minor) FILTER (WHERE side = 'credit'), 0)::text AS credit
         FROM ledger_entries GROUP BY currency`,
    );
    const by = new Map(rows.map((r) => [r.currency, r]));
    return sortCurrencies(by.keys(), true).map((c) => {
      const r = by.get(c);
      const d = num(r?.debit);
      const cr = num(r?.credit);
      return { currency: c, debit_minor: d, credit_minor: cr, balanced: d === cr };
    });
  }

  /** Money received per EAT day per cash account (transaction-owned postings):
   *  debits in, reversing credits out. Reversal legs carry the original gift's
   *  date, so a reversal restates the day it corrects. */
  private async settlementRows(period: { from: string; to: string }): Promise<{ day: string; account: string; currency: string; count: number; received: number; reversed_count: number; reversed: number }[]> {
    const rows = await many<{ day: string; account: string; currency: string; count: number; received: string; reversed_count: number; reversed: string }>(
      this.pool,
      `SELECT ${eatDate("le.created_at")}::text AS day, le.account, le.currency,
              count(*) FILTER (WHERE le.side = 'debit')::int AS count,
              COALESCE(sum(le.amount_minor) FILTER (WHERE le.side = 'debit'), 0)::text AS received,
              count(*) FILTER (WHERE le.side = 'credit')::int AS reversed_count,
              COALESCE(sum(le.amount_minor) FILTER (WHERE le.side = 'credit'), 0)::text AS reversed
         FROM ledger_entries le
        WHERE le.transaction_id IS NOT NULL AND le.account LIKE 'cash:%'
          AND le.created_at >= ${eatStart("$1")} AND le.created_at < ${eatEnd("$2")}
        GROUP BY 1, 2, 3
        ORDER BY 1 DESC, 2, 3`,
      [period.from, period.to],
    );
    return rows.map((r) => ({ ...r, received: num(r.received), reversed: num(r.reversed) }));
  }

  async reconciliation(input: z.input<typeof PeriodQuery>, now: Date = new Date()): Promise<Record<string, unknown>> {
    const q = PeriodQuery.parse(input);
    const period = resolvePeriod(q.from, q.to, now);
    const settlement = (await this.settlementRows(period)).map((r) => ({
      day: r.day,
      channel: channelOfAccount(r.account),
      account: r.account,
      currency: r.currency,
      count: r.count,
      received_minor: r.received,
      reversed_count: r.reversed_count,
      reversed_minor: r.reversed,
      amount_minor: r.received - r.reversed,
    }));
    const exceptions = await this.exceptions(period, now);
    const exception_counts = Object.fromEntries(
      RECONCILIATION_KINDS.map((k) => [k, exceptions.filter((e) => e.kind === k).length]),
    ) as Record<ReconciliationKind, number>;
    return { period, settlement, exceptions, exception_counts, integrity: await this.integrity() };
  }

  // ── the trial balance ────────────────────────────────────────────────────

  async trialBalance(input: z.input<typeof PeriodQuery>): Promise<Record<string, unknown>> {
    const q = PeriodQuery.parse(input);
    checkRange(q.from, q.to);
    const P = new Params();
    const w: string[] = [];
    if (q.from) w.push(`created_at >= ${eatStart(P.add(q.from))}`);
    if (q.to) w.push(`created_at < ${eatEnd(P.add(q.to))}`);
    const rows = await many<{ account: string; currency: string; debit: string; credit: string }>(
      this.pool,
      `SELECT account, currency,
              COALESCE(sum(amount_minor) FILTER (WHERE side = 'debit'), 0)::text AS debit,
              COALESCE(sum(amount_minor) FILTER (WHERE side = 'credit'), 0)::text AS credit
         FROM ledger_entries
        WHERE ${w.length ? w.join(" AND ") : "TRUE"}
        GROUP BY account, currency
        ORDER BY account, currency`,
      P.values,
    );
    const data = rows.map((r) => {
      const debit = num(r.debit);
      const credit = num(r.credit);
      const normal = r.account.startsWith("cash:") ? "debit" : "credit";
      return { account: r.account, currency: r.currency, debit_minor: debit, credit_minor: credit, balance_minor: normal === "debit" ? debit - credit : credit - debit, normal_side: normal };
    });
    const totals = sortCurrencies(data.map((d) => d.currency), true).map((c) => {
      const mine = data.filter((d) => d.currency === c);
      const debit = mine.reduce((a, d) => a + d.debit_minor, 0);
      const credit = mine.reduce((a, d) => a + d.credit_minor, 0);
      return { currency: c, debit_minor: debit, credit_minor: credit, balanced: debit === credit };
    });
    return { period: { from: q.from ?? null, to: q.to ?? null }, data, totals, balanced: totals.every((t) => t.balanced) };
  }

  // ── funds ────────────────────────────────────────────────────────────────

  /** Balance per currency on every fund:<code> account, all time (credits −
   *  debits over every posting — transaction and journal, every kind). */
  private async fundBalances(): Promise<Map<string, { currency: string; balance: number; last: Date | null }[]>> {
    const rows = await many<{ code: string; currency: string; balance: string; last: Date | null }>(
      this.pool,
      `SELECT substr(account, 6) AS code, currency,
              sum(CASE WHEN side = 'credit' THEN amount_minor ELSE -amount_minor END)::text AS balance,
              max(created_at) AS last
         FROM ledger_entries
        WHERE account LIKE 'fund:%'
        GROUP BY 1, 2`,
    );
    const out = new Map<string, { currency: string; balance: number; last: Date | null }[]>();
    for (const r of rows) (out.get(r.code) ?? out.set(r.code, []).get(r.code)!).push({ currency: r.currency, balance: num(r.balance), last: r.last });
    return out;
  }

  async funds(input: z.input<typeof PeriodQuery>, now: Date = new Date()): Promise<Record<string, unknown>> {
    const q = PeriodQuery.parse(input);
    const period = resolvePeriod(q.from, q.to, now);
    const ytdFrom = `${period.to.slice(0, 4)}-01-01`;
    const funds = await many<{ code: string; name: string; name_sw: string | null; is_active: boolean; description: string | null; sort: number }>(
      this.pool,
      `SELECT code, name, name_sw, is_active, description, sort FROM funds ORDER BY sort, name, code`,
    );
    const balances = await this.fundBalances();
    // Giving's movement on each fund, from the ledger: transaction-owned
    // credits − debits (a reversal nets out on the gift's own date).
    const income = await many<{ code: string; currency: string; period: string; ytd: string }>(
      this.pool,
      `SELECT substr(le.account, 6) AS code, le.currency,
              COALESCE(sum(CASE WHEN le.side = 'credit' THEN le.amount_minor ELSE -le.amount_minor END)
                         FILTER (WHERE le.created_at >= ${eatStart("$1")}), 0)::text AS period,
              COALESCE(sum(CASE WHEN le.side = 'credit' THEN le.amount_minor ELSE -le.amount_minor END)
                         FILTER (WHERE le.created_at >= ${eatStart("$3")}), 0)::text AS ytd
         FROM ledger_entries le
        WHERE le.account LIKE 'fund:%' AND le.transaction_id IS NOT NULL
          AND le.created_at >= LEAST(${eatStart("$1")}, ${eatStart("$3")}) AND le.created_at < ${eatEnd("$2")}
        GROUP BY 1, 2`,
      [period.from, period.to, ytdFrom],
    );
    const expenses = await many<{ code: string; currency: string; total: string }>(
      this.pool,
      `SELECT f.code, e.currency, sum(e.amount_minor)::text AS total
         FROM expenses e JOIN funds f ON f.fund_id = e.fund_id
        WHERE e.status = 'approved' AND e.spent_on >= $1::date AND e.spent_on <= $2::date
        GROUP BY 1, 2`,
      [ytdFrom, period.to],
    );
    const transfers = await many<{ code: string; currency: string; tin: string; tout: string }>(
      this.pool,
      `SELECT substr(le.account, 6) AS code, le.currency,
              COALESCE(sum(le.amount_minor) FILTER (WHERE le.side = 'credit'), 0)::text AS tin,
              COALESCE(sum(le.amount_minor) FILTER (WHERE le.side = 'debit'), 0)::text AS tout
         FROM ledger_entries le JOIN journals j ON j.journal_id = le.journal_id
        WHERE j.kind = 'transfer' AND le.account LIKE 'fund:%'
          AND le.created_at >= ${eatStart("$1")} AND le.created_at < ${eatEnd("$2")}
        GROUP BY 1, 2`,
      [ytdFrom, period.to],
    );
    const data = funds.map((f) => {
      const bal = balances.get(f.code) ?? [];
      const last = bal.reduce<Date | null>((a, b) => (b.last && (!a || b.last > a) ? b.last : a), null);
      return {
        code: f.code,
        name: f.name,
        name_sw: f.name_sw,
        is_active: f.is_active,
        description: f.description,
        sort: f.sort,
        balances: sortCurrencies(bal.map((b) => b.currency)).map((c) => ({ currency: c, balance_minor: bal.find((b) => b.currency === c)!.balance })),
        income: sortCurrencies(income.filter((r) => r.code === f.code).map((r) => r.currency)).map((c) => {
          const r = income.find((x) => x.code === f.code && x.currency === c)!;
          return { currency: c, period_minor: num(r.period), ytd_minor: num(r.ytd) };
        }),
        expenses_ytd: amountsFor(expenses, f.code, (r) => num(r.total)),
        transfers_in_ytd: amountsFor(transfers, f.code, (r) => num(r.tin)),
        transfers_out_ytd: amountsFor(transfers, f.code, (r) => num(r.tout)),
        last_activity_at: last,
      };
    });
    const totals = sortCurrencies(data.flatMap((d) => d.balances.map((b) => b.currency))).map((c) => ({
      currency: c,
      amount_minor: data.reduce((a, d) => a + (d.balances.find((b) => b.currency === c)?.balance_minor ?? 0), 0),
      count: data.filter((d) => d.balances.some((b) => b.currency === c)).length,
    }));
    return { period: { from: period.from, to: period.to, ytd_from: ytdFrom }, data, next_cursor: null, totals };
  }

  // ── the pledge register ──────────────────────────────────────────────────

  private static pledgeWire(r: PledgeRegisterRow): Record<string, unknown> {
    const { member_deleted: _d, ...rest } = r;
    void _d;
    return rest;
  }

  /** Every pledge, evaluated by the member statement's own ledger
   *  (PartnersService.pledgeRegister), filtered. */
  private async registerRows(q: z.infer<typeof PledgesQuery>, year: number, now: Date): Promise<PledgeRegisterRow[]> {
    const entries: PledgeRegisterEntry[] = await this.deps.partners.pledgeRegister(year, now);
    const needle = q.q?.toLowerCase() ?? "";
    return entries
      .map((e) => e.row)
      .filter((r) => (!q.user_id || r.user_id === q.user_id)
        && (!q.status || r.status === q.status)
        && (!q.standing || r.standing === q.standing)
        && (!q.shape || r.shape === q.shape)
        && (!needle || r.member_name.toLowerCase().includes(needle)
          || (r.member_phone ?? "").toLowerCase().includes(needle)
          || r.title.toLowerCase().includes(needle)));
  }

  async pledges(input: z.input<typeof PledgesQuery>, now: Date = new Date(), opts: { all?: boolean } = {}): Promise<{ year: number; data: Record<string, unknown>[]; next_cursor: string | null; totals: Record<string, unknown>[] }> {
    const q = PledgesQuery.parse(input);
    const year = q.year ?? Number(nairobiDate(now).slice(0, 4));
    const rows = await this.registerRows(q, year, now);
    const totals = sortCurrencies(rows.map((r) => r.currency)).map((c) => {
      const mine = rows.filter((r) => r.currency === c);
      const pledged = mine.reduce((a, r) => a + r.pledged_year_minor, 0);
      return {
        currency: c,
        amount_minor: pledged,
        count: mine.length,
        pledged_minor: pledged,
        paid_minor: mine.reduce((a, r) => a + r.paid_year_minor, 0),
        remaining_minor: mine.reduce((a, r) => a + r.remaining_year_minor, 0),
        // paid = toward + beyond, and pledged = toward + remaining, row by row.
        // "Beyond" is money paid to a pledge above this year's promise — a
        // cancelled pledge's payments (its promise this year is 0) or a pledge
        // paid ahead. Without the split the three totals above cannot foot.
        paid_toward_minor: mine.reduce((a, r) => a + Math.min(r.paid_year_minor, r.pledged_year_minor), 0),
        paid_beyond_minor: mine.reduce((a, r) => a + Math.max(r.paid_year_minor - r.pledged_year_minor, 0), 0),
      };
    });
    // Newest pledge first.
    const key = (r: PledgeRegisterRow): [string, string] => [r.created_at, r.pledge_id];
    if (opts.all) {
      const sorted = [...rows].sort((a, b) => cmpKey(key(b), key(a)));
      return { year, data: sorted.map(FinanceReportsService.pledgeWire), next_cursor: null, totals };
    }
    const { page, next_cursor } = pageBy(rows, key, "desc", q.cursor, q.limit);
    return { year, data: page.map(FinanceReportsService.pledgeWire), next_cursor, totals };
  }

  /** Per month of `year`, per currency: pledged, paid, kept, missed and the
   *  partners behind — sums over the register's own instalment ledger. */
  async reportPledges(input: z.input<typeof YearQuery>, now: Date = new Date()): Promise<Record<string, unknown>> {
    const q = YearQuery.parse(input);
    const year = q.year ?? Number(nairobiDate(now).slice(0, 4));
    const entries = await this.deps.partners.pledgeRegister(year, now);
    const prefix = `${year}-`;
    const currencies = sortCurrencies(entries.map((e) => e.row.currency), true).map((currency) => {
      const mine = entries.filter((e) => e.row.currency === currency);
      const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, pledged_minor: 0, paid_minor: 0, kept: 0, missed: 0, behind_partners: 0 }));
      const behindByMonth = months.map(() => new Set<string>());
      const behindYear = new Set<string>();
      for (const e of mine) {
        const r = e.row;
        if (r.status !== "cancelled") {
          if (r.shape === "monthly") {
            for (const i of e.instalments) {
              const m = months[Number(i.due.slice(5, 7)) - 1]!;
              m.pledged_minor += i.amount_minor;
              if (i.status === "kept" || i.status === "late") m.kept += 1;
              if (i.status === "missed") {
                m.missed += 1;
                // Behind = still expected to pay: an ACTIVE pledge (a paused
                // one reads "paused", never "behind", on the pledge card).
                if (r.status === "active") {
                  behindByMonth[m.month - 1]!.add(r.user_id);
                  behindYear.add(r.user_id);
                }
              }
            }
          } else if (r.due_on && r.due_on.startsWith(prefix)) {
            months[Number(r.due_on.slice(5, 7)) - 1]!.pledged_minor += r.target_minor ?? 0;
          }
        }
        for (const p of e.payments) {
          const on = partnerDate(p.at);
          if (on && on.startsWith(prefix)) months[Number(on.slice(5, 7)) - 1]!.paid_minor += p.amount_minor;
        }
      }
      months.forEach((m, i) => { m.behind_partners = behindByMonth[i]!.size; });
      return {
        currency,
        months,
        totals: {
          pledged_minor: months.reduce((a, m) => a + m.pledged_minor, 0),
          paid_minor: months.reduce((a, m) => a + m.paid_minor, 0),
          kept: months.reduce((a, m) => a + m.kept, 0),
          missed: months.reduce((a, m) => a + m.missed, 0),
          behind_partners: behindYear.size,
        },
      };
    });
    return { year, currencies };
  }

  // ── the Overview ─────────────────────────────────────────────────────────

  async overview(input: z.input<typeof PeriodQuery>, now: Date = new Date()): Promise<Record<string, unknown>> {
    const q = PeriodQuery.parse(input);
    const { from, to } = resolvePeriod(q.from, q.to, now);
    const mtdFrom = `${to.slice(0, 8)}01`;
    const ytdFrom = `${to.slice(0, 4)}-01-01`;
    const lyFrom = shiftYears(from, -1);
    const lyTo = shiftYears(to, -1);

    const income = await many<{ currency: string; period: string; period_count: number; mtd: string; ytd: string; ly: string }>(
      this.pool,
      `SELECT t.currency,
              COALESCE(sum(t.amount_minor) FILTER (WHERE t.created_at >= ${eatStart("$1")} AND t.created_at < ${eatEnd("$2")}), 0)::text AS period,
              count(*) FILTER (WHERE t.created_at >= ${eatStart("$1")} AND t.created_at < ${eatEnd("$2")})::int AS period_count,
              COALESCE(sum(t.amount_minor) FILTER (WHERE t.created_at >= ${eatStart("$3")} AND t.created_at < ${eatEnd("$2")}), 0)::text AS mtd,
              COALESCE(sum(t.amount_minor) FILTER (WHERE t.created_at >= ${eatStart("$4")} AND t.created_at < ${eatEnd("$2")}), 0)::text AS ytd,
              COALESCE(sum(t.amount_minor) FILTER (WHERE t.created_at >= ${eatStart("$5")} AND t.created_at < ${eatEnd("$6")}), 0)::text AS ly
         FROM transactions t
        WHERE t.status = 'succeeded'
          AND t.created_at >= LEAST(${eatStart("$1")}, ${eatStart("$3")}, ${eatStart("$4")}, ${eatStart("$5")})
          AND t.created_at < GREATEST(${eatEnd("$2")}, ${eatEnd("$6")})
        GROUP BY t.currency`,
      [from, to, mtdFrom, ytdFrom, lyFrom, lyTo],
    );
    const expenses = await many<{ currency: string; period: string; period_count: number; ytd: string }>(
      this.pool,
      `SELECT e.currency,
              COALESCE(sum(e.amount_minor) FILTER (WHERE e.spent_on >= $1::date AND e.spent_on <= $2::date), 0)::text AS period,
              count(*) FILTER (WHERE e.spent_on >= $1::date AND e.spent_on <= $2::date)::int AS period_count,
              COALESCE(sum(e.amount_minor) FILTER (WHERE e.spent_on >= $3::date AND e.spent_on <= $2::date), 0)::text AS ytd
         FROM expenses e
        WHERE e.status = 'approved' AND e.spent_on >= LEAST($1::date, $3::date) AND e.spent_on <= $2::date
        GROUP BY e.currency`,
      [from, to, ytdFrom],
    );

    // Pledges and partners — the register's own evaluation.
    const year = Number(to.slice(0, 4));
    const entries = await this.deps.partners.pledgeRegister(year, now);
    const active = entries.map((e) => e.row).filter((r) => r.status === "active");
    const partnersCount = await maybeOne<{ n: number }>(
      this.pool,
      `SELECT count(*)::int AS n FROM users u
        WHERE u.deleted_at IS NULL
          AND (EXISTS (SELECT 1 FROM partner_memberships pm WHERE pm.user_id = u.user_id)
               OR EXISTS (SELECT 1 FROM pledges p WHERE p.user_id = u.user_id)
               OR EXISTS (SELECT 1 FROM giving_schedules s WHERE s.user_id = u.user_id AND s.status IN ('active', 'paused')))`,
    );
    const behind = new Set(
      entries.map((e) => e.row).filter((r) => !r.member_deleted && r.status !== "cancelled" && r.standing === "behind").map((r) => r.user_id),
    ).size;

    const counts = await maybeOne<{ processing: number; failed_in_period: number; pending_claims: number; expenses_awaiting_approval: number; failing_schedules: number }>(
      this.pool,
      `SELECT (SELECT count(*)::int FROM transactions WHERE status IN ('processing', 'requires_action')) AS processing,
              (SELECT count(*)::int FROM transactions WHERE status = 'failed'
                  AND created_at >= ${eatStart("$1")} AND created_at < ${eatEnd("$2")}) AS failed_in_period,
              (SELECT count(*)::int FROM pledge_claims WHERE status = 'pending') AS pending_claims,
              (SELECT count(*)::int FROM expenses WHERE status = 'recorded') AS expenses_awaiting_approval,
              (SELECT count(*)::int FROM giving_schedules
                WHERE status <> 'cancelled' AND (status = 'paused' OR consecutive_failures > 0)) AS failing_schedules`,
      [from, to],
    );
    const exceptions = await this.exceptions({ from, to }, now);
    const staleCount = exceptions.filter((e) => e.kind === "stale_processing").length;
    const integrityCount = exceptions.filter((e) => INTEGRITY_KINDS.includes(e.kind)).length;

    const fundRows = await many<{ code: string; name: string; is_active: boolean }>(this.pool, `SELECT code, name, is_active FROM funds`);
    const balances = await this.fundBalances();
    const fund_balances = fundRows
      .map((f) => {
        const bal = balances.get(f.code) ?? [];
        return {
          code: f.code,
          name: f.name,
          is_active: f.is_active,
          balances: sortCurrencies(bal.map((b) => b.currency)).map((c) => ({ currency: c, balance_minor: bal.find((b) => b.currency === c)!.balance })),
        };
      })
      .sort((a, b) => {
        const ka = a.balances.find((x) => x.currency === "KES")?.balance_minor ?? 0;
        const kb = b.balances.find((x) => x.currency === "KES")?.balance_minor ?? 0;
        return kb - ka || a.code.localeCompare(b.code);
      })
      .slice(0, 6);

    const settle = await this.settlementRows({ from, to });
    const chanMap = new Map<string, { account: string; currency: string; count: number; received: number; reversed: number }>();
    for (const r of settle) {
      const k = `${r.account}|${r.currency}`;
      const e = chanMap.get(k) ?? { account: r.account, currency: r.currency, count: 0, received: 0, reversed: 0 };
      e.count += r.count;
      e.received += r.received;
      e.reversed += r.reversed;
      chanMap.set(k, e);
    }
    for (const a of KNOWN_CASH_ACCOUNTS) {
      if (![...chanMap.values()].some((x) => x.account === a)) chanMap.set(`${a}|KES`, { account: a, currency: "KES", count: 0, received: 0, reversed: 0 });
    }
    const order = (a: string): number => {
      const i = KNOWN_CASH_ACCOUNTS.indexOf(a);
      return i < 0 ? KNOWN_CASH_ACCOUNTS.length : i;
    };
    const channels = [...chanMap.values()]
      .sort((a, b) => order(a.account) - order(b.account) || a.account.localeCompare(b.account) || currencyOrder(a.currency, b.currency))
      .map((c) => ({ channel: channelOfAccount(c.account), account: c.account, currency: c.currency, count: c.count, received_minor: c.received, reversed_minor: c.reversed, net_minor: c.received - c.reversed }));

    // The 12 months ending with `to`'s month.
    const lastYm = to.slice(0, 7);
    const firstYm = monthsBefore(lastYm, 11);
    const sIncome = await many<{ ym: string; currency: string; total: string }>(
      this.pool,
      `SELECT to_char(t.created_at AT TIME ZONE '${TZ}', 'YYYY-MM') AS ym, t.currency, sum(t.amount_minor)::text AS total
         FROM transactions t
        WHERE t.status = 'succeeded' AND t.created_at >= ${eatStart("$1")} AND t.created_at < ${eatEnd("$2")}
        GROUP BY 1, 2`,
      [`${firstYm}-01`, to],
    );
    const sExpenses = await many<{ ym: string; currency: string; total: string }>(
      this.pool,
      `SELECT to_char(e.spent_on, 'YYYY-MM') AS ym, e.currency, sum(e.amount_minor)::text AS total
         FROM expenses e
        WHERE e.status = 'approved' AND e.spent_on >= $1::date AND e.spent_on <= $2::date
        GROUP BY 1, 2`,
      [`${firstYm}-01`, to],
    );
    const yms = Array.from({ length: 12 }, (_, i) => monthsBefore(lastYm, 11 - i));

    const currencies = sortCurrencies([...income.map((r) => r.currency), ...expenses.map((r) => r.currency), ...active.map((r) => r.currency), ...sIncome.map((r) => r.currency), ...sExpenses.map((r) => r.currency)], true);
    const inc = new Map(income.map((r) => [r.currency, r]));
    const exp = new Map(expenses.map((r) => [r.currency, r]));

    const alertsSrc: { kind: string; count: number; link: string }[] = [
      { kind: "pending_claims", count: counts?.pending_claims ?? 0, link: "/finance/claims" },
      { kind: "expenses_awaiting_approval", count: counts?.expenses_awaiting_approval ?? 0, link: "/finance/expenses?status=recorded" },
      { kind: "failing_schedules", count: counts?.failing_schedules ?? 0, link: "/finance/recurring?attention=true" },
      { kind: "stale_processing", count: staleCount, link: "/finance/reconciliation?tab=exceptions" },
      { kind: "integrity_issues", count: integrityCount, link: "/finance/reconciliation?tab=integrity" },
      { kind: "partners_behind", count: behind, link: "/finance/pledges?standing=behind" },
    ];

    return {
      period: { from, to, mtd_from: mtdFrom, ytd_from: ytdFrom, last_year_from: lyFrom, last_year_to: lyTo },
      currencies,
      income: currencies.map((c) => {
        const r = inc.get(c);
        return { currency: c, period_minor: num(r?.period), period_count: r?.period_count ?? 0, mtd_minor: num(r?.mtd), ytd_minor: num(r?.ytd), same_period_last_year_minor: num(r?.ly) };
      }),
      expenses: currencies.map((c) => {
        const r = exp.get(c);
        return { currency: c, period_minor: num(r?.period), period_count: r?.period_count ?? 0, ytd_minor: num(r?.ytd) };
      }),
      net: currencies.map((c) => ({
        currency: c,
        period_minor: num(inc.get(c)?.period) - num(exp.get(c)?.period),
        ytd_minor: num(inc.get(c)?.ytd) - num(exp.get(c)?.ytd),
      })),
      outstanding_pledges: currencies.map((c) => {
        const mine = active.filter((r) => r.currency === c);
        return { currency: c, remaining_year_minor: mine.reduce((a, r) => a + r.remaining_year_minor, 0), pledges: mine.length };
      }),
      partners: { count: partnersCount?.n ?? 0, behind },
      counts: {
        processing: counts?.processing ?? 0,
        failed_in_period: counts?.failed_in_period ?? 0,
        pending_claims: counts?.pending_claims ?? 0,
        expenses_awaiting_approval: counts?.expenses_awaiting_approval ?? 0,
        failing_schedules: counts?.failing_schedules ?? 0,
        stale_processing: staleCount,
        integrity_issues: integrityCount,
      },
      fund_balances,
      channels,
      series: currencies.map((c) => ({
        currency: c,
        months: yms.map((ym) => ({
          month: ym,
          income_minor: num(sIncome.find((r) => r.ym === ym && r.currency === c)?.total),
          expenses_minor: num(sExpenses.find((r) => r.ym === ym && r.currency === c)?.total),
        })),
      })),
      alerts: alertsSrc.filter((a) => a.count > 0),
    };
  }

  // ── year reports ─────────────────────────────────────────────────────────

  async reportIncome(input: z.input<typeof IncomeReportQuery>, now: Date = new Date()): Promise<Record<string, unknown>> {
    const q = IncomeReportQuery.parse(input);
    const year = q.year ?? Number(nairobiDate(now).slice(0, 4));
    const key = q.by === "fund" ? `COALESCE(f.code, 'none')` : q.by === "channel" ? CHANNEL_SQL : `t.source`;
    const cells = await many<{ currency: string; m: number; key: string; fund_name: string | null; total: string }>(
      this.pool,
      `SELECT t.currency, extract(month FROM t.created_at AT TIME ZONE '${TZ}')::int AS m, ${key} AS key,
              max(f.name) AS fund_name, sum(t.amount_minor)::text AS total
         FROM transactions t LEFT JOIN funds f ON f.fund_id = t.fund_id
        WHERE t.status = 'succeeded'
          AND t.created_at >= (make_date($1::int, 1, 1)::timestamp AT TIME ZONE '${TZ}')
          AND t.created_at < (make_date($1::int + 1, 1, 1)::timestamp AT TIME ZONE '${TZ}')
        GROUP BY 1, 2, 3`,
      [year],
    );
    const label = (c: { key: string; fund_name: string | null }): string =>
      q.by === "fund" ? (c.key === "none" ? "No fund (media sales)" : c.fund_name ?? c.key)
        : q.by === "channel" ? channelLabel(c.key) : SOURCE_LABELS[c.key] ?? c.key;
    return { report: "income", year, by: q.by, currencies: buildMatrix(cells.map((c) => ({ ...c, label: label(c) }))) };
  }

  async reportExpenses(input: z.input<typeof ExpenseReportQuery>, now: Date = new Date()): Promise<Record<string, unknown>> {
    const q = ExpenseReportQuery.parse(input);
    const year = q.year ?? Number(nairobiDate(now).slice(0, 4));
    const cells = await many<{ currency: string; m: number; key: string; label: string; total: string }>(
      this.pool,
      `SELECT e.currency, extract(month FROM e.spent_on)::int AS m,
              ${q.by === "category" ? "c.code" : "f.code"} AS key,
              max(${q.by === "category" ? "c.name" : "f.name"}) AS label,
              sum(e.amount_minor)::text AS total
         FROM expenses e
         JOIN expense_categories c ON c.category_id = e.category_id
         JOIN funds f ON f.fund_id = e.fund_id
        WHERE e.status = 'approved' AND e.spent_on >= make_date($1::int, 1, 1) AND e.spent_on < make_date($1::int + 1, 1, 1)
        GROUP BY 1, 2, 3`,
      [year],
    );
    return { report: "expenses", year, by: q.by, currencies: buildMatrix(cells) };
  }

  // ── the two financial statements ─────────────────────────────────────────

  /** Statement of financial position as of a day, from every ledger posting. */
  async financialPosition(input: z.input<typeof AsOfQuery>, now: Date = new Date()): Promise<Record<string, unknown>> {
    const q = AsOfQuery.parse(input);
    const asOf = q.as_of ?? nairobiDate(now);
    const rows = await many<{ account: string; currency: string; debit: string; credit: string }>(
      this.pool,
      `SELECT account, currency,
              COALESCE(sum(amount_minor) FILTER (WHERE side = 'debit'), 0)::text AS debit,
              COALESCE(sum(amount_minor) FILTER (WHERE side = 'credit'), 0)::text AS credit
         FROM ledger_entries
        WHERE created_at < ${eatEnd("$1")}
        GROUP BY account, currency
        ORDER BY account, currency`,
      [asOf],
    );
    const names = await this.fundNames();
    const currencies = sortCurrencies(rows.map((r) => r.currency), true).map((currency) => {
      const mine = rows.filter((r) => r.currency === currency);
      const assets = mine.filter((r) => r.account.startsWith("cash:"))
        .map((r) => ({ account: r.account, label: accountLabel(r.account, names), balance_minor: num(r.debit) - num(r.credit) }));
      const funds = mine.filter((r) => r.account.startsWith("fund:"))
        .map((r) => ({ account: r.account, code: r.account.slice(5), label: accountLabel(r.account, names), balance_minor: num(r.credit) - num(r.debit) }));
      const other = mine.filter((r) => !r.account.startsWith("cash:") && !r.account.startsWith("fund:"))
        .map((r) => ({ account: r.account, label: accountLabel(r.account, names), balance_minor: num(r.credit) - num(r.debit) }));
      const totals = {
        assets_minor: assets.reduce((a, r) => a + r.balance_minor, 0),
        funds_minor: funds.reduce((a, r) => a + r.balance_minor, 0),
        other_minor: other.reduce((a, r) => a + r.balance_minor, 0),
      };
      return { currency, assets, funds, other, totals, balanced: totals.assets_minor === totals.funds_minor + totals.other_minor };
    });
    return { as_of: asOf, currencies, balanced: currencies.every((c) => c.balanced) };
  }

  /** Income and expenditure for a period: giving net of reversals from the
   *  ledger, other income, approved expenses by category; transfers, opening
   *  balances and their reversals (journal postings) are internal movements. */
  async incomeExpenditure(input: z.input<typeof PeriodQuery>, now: Date = new Date()): Promise<Record<string, unknown>> {
    const q = PeriodQuery.parse(input);
    const period = resolvePeriod(q.from, q.to, now);
    const inc = await many<{ account: string; currency: string; net: string }>(
      this.pool,
      `SELECT le.account, le.currency,
              sum(CASE WHEN le.side = 'credit' THEN le.amount_minor ELSE -le.amount_minor END)::text AS net
         FROM ledger_entries le
        WHERE le.transaction_id IS NOT NULL AND le.account NOT LIKE 'cash:%'
          AND le.created_at >= ${eatStart("$1")} AND le.created_at < ${eatEnd("$2")}
        GROUP BY 1, 2
        ORDER BY 1, 2`,
      [period.from, period.to],
    );
    const exp = await many<{ currency: string; code: string; name: string; total: string }>(
      this.pool,
      `SELECT e.currency, c.code, c.name, sum(e.amount_minor)::text AS total
         FROM expenses e JOIN expense_categories c ON c.category_id = e.category_id
        WHERE e.status = 'approved' AND e.spent_on >= $1::date AND e.spent_on <= $2::date
        GROUP BY 1, 2, 3`,
      [period.from, period.to],
    );
    const names = await this.fundNames();
    const byAmount = (a: { amount_minor: number; key: string }, b: { amount_minor: number; key: string }): number => b.amount_minor - a.amount_minor || a.key.localeCompare(b.key);
    const currencies = sortCurrencies([...inc.map((r) => r.currency), ...exp.map((r) => r.currency)], true).map((currency) => {
      const lines = inc.filter((r) => r.currency === currency && num(r.net) !== 0);
      const income = lines.filter((r) => r.account.startsWith("fund:"))
        .map((r) => ({ key: r.account.slice(5), label: accountLabel(r.account, names), amount_minor: num(r.net) })).sort(byAmount);
      const other_income = lines.filter((r) => !r.account.startsWith("fund:"))
        .map((r) => ({ key: r.account, label: accountLabel(r.account, names), amount_minor: num(r.net) })).sort(byAmount);
      const expenses = exp.filter((r) => r.currency === currency)
        .map((r) => ({ key: r.code, label: r.name, amount_minor: num(r.total) })).sort(byAmount);
      const gifts = income.reduce((a, r) => a + r.amount_minor, 0);
      const other = other_income.reduce((a, r) => a + r.amount_minor, 0);
      const spent = expenses.reduce((a, r) => a + r.amount_minor, 0);
      return {
        currency, income, other_income, expenses,
        totals: { gifts_minor: gifts, other_income_minor: other, income_minor: gifts + other, expenses_minor: spent, surplus_minor: gifts + other - spent },
      };
    });
    return { period, currencies };
  }

  // ── statements (year-end givers) ─────────────────────────────────────────

  private async givers(q: z.infer<typeof StatementsQuery>, year: number): Promise<GiverRow[]> {
    const P = new Params();
    const y = P.add(year);
    const w = [
      `t.status = 'succeeded'`,
      `t.created_at >= (make_date(${y}::int, 1, 1)::timestamp AT TIME ZONE '${TZ}')`,
      `t.created_at < (make_date(${y}::int + 1, 1, 1)::timestamp AT TIME ZONE '${TZ}')`,
    ];
    if (q.q) {
      const like = P.add(likeContains(q.q));
      w.push(`(u.full_name ILIKE ${like} OR u.phone_number ILIKE ${like} OR u.email ILIKE ${like})`);
    }
    // JOIN funds, as the member's own statement does: giving, not purchases.
    const cells = await many<{ user_id: string; full_name: string; phone: string | null; email: string | null; currency: string; code: string; name: string; pledged: boolean; n: number; total: string; last: Date }>(
      this.pool,
      `SELECT t.user_id, u.full_name, u.phone_number AS phone, u.email::text AS email, t.currency, f.code, f.name,
              (t.pledge_id IS NOT NULL) AS pledged, count(*)::int AS n, sum(t.amount_minor)::text AS total, max(t.created_at) AS last
         FROM transactions t
         JOIN users u ON u.user_id = t.user_id
         JOIN funds f ON f.fund_id = t.fund_id
        WHERE ${w.join(" AND ")}
        GROUP BY t.user_id, u.full_name, u.phone_number, u.email, t.currency, f.code, f.name, (t.pledge_id IS NOT NULL)`,
      P.values,
    );
    const people = new Map<string, typeof cells>();
    for (const c of cells) (people.get(c.user_id) ?? people.set(c.user_id, []).get(c.user_id)!).push(c);
    const out = [...people.values()].map((cs) => {
      const first = cs[0]!;
      const cur = sortCurrencies(cs.map((c) => c.currency));
      const funds = new Map<string, { code: string; name: string; currency: string; amount_minor: number }>();
      for (const c of cs) {
        const k = `${c.code}|${c.currency}`;
        const e = funds.get(k) ?? { code: c.code, name: c.name, currency: c.currency, amount_minor: 0 };
        e.amount_minor += num(c.total);
        funds.set(k, e);
      }
      return {
        user_id: first.user_id,
        full_name: first.full_name,
        phone: first.phone,
        email: first.email,
        gifts: cs.reduce((a, c) => a + c.n, 0),
        totals: cur.map((cc) => ({
          currency: cc,
          amount_minor: cs.filter((c) => c.currency === cc).reduce((a, c) => a + num(c.total), 0),
          count: cs.filter((c) => c.currency === cc).reduce((a, c) => a + c.n, 0),
        })),
        by_fund: [...funds.values()].sort((a, b) => currencyOrder(a.currency, b.currency) || b.amount_minor - a.amount_minor || a.code.localeCompare(b.code)),
        pledge_paid: cur
          .map((cc) => ({ currency: cc, amount_minor: cs.filter((c) => c.currency === cc && c.pledged).reduce((a, c) => a + num(c.total), 0) }))
          .filter((x) => x.amount_minor > 0),
        last_gift_at: cs.reduce<Date>((a, c) => (c.last > a ? c.last : a), first.last),
      };
    });
    // By name (code-point order of the lower-cased name, then id — the keyset).
    return out.sort((a, b) => cmpKey(FinanceReportsService.giverKey(a), FinanceReportsService.giverKey(b)));
  }

  private static giverKey(g: GiverRow): [string, string] {
    return [g.full_name.toLowerCase(), g.user_id];
  }

  async statements(input: z.input<typeof StatementsQuery>, now: Date = new Date(), opts: { all?: boolean } = {}): Promise<{ year: number; data: GiverRow[]; next_cursor: string | null; totals: CurrencyTotal[] }> {
    const q = StatementsQuery.parse(input);
    const year = q.year ?? Number(nairobiDate(now).slice(0, 4));
    const all = await this.givers(q, year);
    const totals = sortCurrencies(all.flatMap((g) => g.totals.map((t) => t.currency))).map((c) => ({
      currency: c,
      amount_minor: all.reduce((a, g) => a + (g.totals.find((t) => t.currency === c)?.amount_minor ?? 0), 0),
      count: all.reduce((a, g) => a + (g.totals.find((t) => t.currency === c)?.count ?? 0), 0),
    }));
    if (opts.all) return { year, data: all, next_cursor: null, totals };
    const { page, next_cursor } = pageBy(all, FinanceReportsService.giverKey, "asc", q.cursor, q.limit);
    return { year, data: page, next_cursor, totals };
  }

  /** The member's own giving statement PDF, for one year; 404 when they have
   *  no succeeded gift that year. */
  async givingPdf(userId: string, yearIn: number | undefined, now: Date = new Date()): Promise<{ year: number; pdf: Buffer }> {
    if (!isUuid(userId)) throw new ApiError("NOT_FOUND", "Member not found");
    const year = yearIn ?? Number(nairobiDate(now).slice(0, 4));
    const any = await maybeOne<{ ok: number }>(
      this.pool,
      `SELECT 1 AS ok FROM transactions t
        WHERE t.user_id = $1 AND t.status = 'succeeded'
          AND t.created_at >= (make_date($2::int, 1, 1)::timestamp AT TIME ZONE '${TZ}')
          AND t.created_at < (make_date($2::int + 1, 1, 1)::timestamp AT TIME ZONE '${TZ}')
        LIMIT 1`,
      [userId, year],
    );
    if (!any) throw new ApiError("NOT_FOUND", `No gifts in ${year}`);
    return { year, pdf: await this.deps.financial.statementPdf(userId, year) };
  }

  /** The member's own Partners statement PDF (404: never a partner). */
  async partnersPdf(userId: string, yearIn: number | undefined, now: Date = new Date()): Promise<{ year: number; pdf: Buffer }> {
    if (!isUuid(userId)) throw new ApiError("NOT_FOUND", "Member not found");
    return this.deps.partners.partnersStatementPdf(userId, yearIn ?? Number(nairobiDate(now).slice(0, 4)), now);
  }

  // ── department needs, as Finance sees them ───────────────────────────────

  async needs(input: z.input<typeof NeedsQuery>): Promise<Record<string, unknown>> {
    const q = NeedsQuery.parse(input);
    const P = new Params();
    const w: string[] = [];
    if (q.status !== "all") w.push(`n.status = ${P.add(q.status)}`);
    if (q.q) {
      const like = P.add(likeContains(q.q));
      w.push(`(n.title ILIKE ${like} OR d.name ILIKE ${like})`);
    }
    const rows = await many<{ need_id: string; title: string; why: string; department_id: string; department_name: string; target_minor: string; currency: string; deadline: string | null; status: string; created_at: Date; decided_at: Date | null; cursor_ts: string }>(
      this.pool,
      `SELECT n.need_id, n.title, n.why, n.department_id, d.name AS department_name, n.target_minor::text AS target_minor,
              n.currency, n.deadline::text AS deadline, n.status, n.created_at, n.decided_at, ${cursorTs("n.created_at")} AS cursor_ts
         FROM department_needs n JOIN departments d ON d.department_id = n.department_id
        WHERE ${w.length ? w.join(" AND ") : "TRUE"}
        ORDER BY n.created_at DESC, n.need_id DESC`,
      P.values,
    );
    // Raised and routing come from the functions gifts and the department page
    // already use — the two screens can never disagree.
    const shaped: Record<string, unknown>[] = [];
    for (const r of rows) {
      const giving = await needGiving(this.pool, r.need_id);
      shaped.push({
        need_id: r.need_id,
        title: r.title,
        why: r.why,
        department_id: r.department_id,
        department_name: r.department_name,
        fund_code: await this.deps.financial.needFundCode(r.need_id),
        target_minor: Number(r.target_minor),
        raised_minor: giving.raised_minor,
        gifts_count: giving.gifts,
        currency: r.currency,
        deadline: r.deadline,
        status: r.status,
        created_at: r.created_at,
        decided_at: r.decided_at,
        cursor_ts: r.cursor_ts,
      });
    }
    const totals = sortCurrencies(shaped.map((s) => String(s.currency))).map((c) => {
      const mine = shaped.filter((s) => s.currency === c);
      const raised = mine.reduce((a, s) => a + Number(s.raised_minor), 0);
      return { currency: c, amount_minor: raised, count: mine.length, target_minor: mine.reduce((a, s) => a + Number(s.target_minor), 0), raised_minor: raised };
    });
    const { page, next_cursor } = pageBy(shaped, (s) => [String(s.cursor_ts), String(s.need_id)], "desc", q.cursor, q.limit);
    return {
      data: page.map((s) => {
        const { cursor_ts: _c, ...rest } = s;
        void _c;
        return rest;
      }),
      next_cursor,
      totals,
    };
  }

  // ── giver search, for "Record a gift" (a clerk may lack members:view) ────

  /** Members (any role, not deleted) by name (case- and accent-insensitive),
   *  email, or phone — digits only, so "0722 123" finds +254722123…: a
   *  query of digits (and + - ( ) spaces) matches the phone's digits, also
   *  without the leading trunk 0. Names that START with the query first, then
   *  by name. Each with their open pledges (active | paused) under the words
   *  their cards show and where the money is booked (pays_to). */
  async giverSearch(input: z.input<typeof GiversQuery>): Promise<{ data: Record<string, unknown>[] }> {
    const q = GiversQuery.parse(input);
    const P = new Params();
    const folded = foldText(q.q);
    const nameLike = P.add(likeContains(folded));
    const prefix = P.add(folded);
    const emailLike = P.add(likeContains(q.q));
    const or = [`${foldSql("u.full_name")} LIKE ${nameLike}`, `u.email ILIKE ${emailLike}`];
    if (!/[a-z]/i.test(q.q)) {
      const digits = q.q.replace(/\D/g, "");
      const patterns = [...new Set([digits, digits.replace(/^0+/, "")])].filter((d) => d.length >= 3).map((d) => `%${d}%`);
      if (patterns.length > 0) or.push(`regexp_replace(u.phone_number, '\\D', '', 'g') LIKE ANY(${P.add(patterns)}::text[])`);
    }
    const people = await many<{ user_id: string; full_name: string; phone: string | null; email: string | null; congregation_name: string | null }>(
      this.pool,
      `SELECT u.user_id, u.full_name, u.phone_number AS phone, u.email::text AS email, c.name AS congregation_name
         FROM users u
         LEFT JOIN congregations c ON c.congregation_id = u.congregation_id
        WHERE u.deleted_at IS NULL AND (${or.join(" OR ")})
        ORDER BY (left(${foldSql("u.full_name")}, length(${prefix}::text)) = ${prefix}::text) DESC, lower(u.full_name), u.user_id
        LIMIT ${P.add(q.limit)}`,
      P.values,
    );
    const ids = people.map((p) => p.user_id);
    const pledges = ids.length === 0 ? [] : await many<{ user_id: string; pledge_id: string; title: string; currency: string; shape: string; status: string; amount_minor: string | null; target_minor: string | null; pays_to_code: string | null; pays_to_name: string | null }>(
      this.pool,
      `SELECT p.user_id, p.pledge_id, ${pledgeTitleSql({ pledge: "p", fund: "f", campaign: "c" })} AS title,
              p.currency, p.shape, p.status, p.amount_minor::text AS amount_minor, p.target_minor::text AS target_minor,
              ${PLEDGE_PAYS_TO_CODE} AS pays_to_code, ${PLEDGE_PAYS_TO_NAME} AS pays_to_name
         FROM pledges p
         LEFT JOIN funds f ON f.fund_id = p.fund_id
         LEFT JOIN campaigns c ON c.campaign_id = p.campaign_id${PLEDGE_PAYS_TO_JOINS}
        WHERE p.user_id = ANY($1::uuid[]) AND p.status IN ('active', 'paused')
        ORDER BY p.created_at DESC, p.pledge_id`,
      [ids],
    );
    return {
      data: people.map((p) => ({
        ...p,
        open_pledges: pledges.filter((x) => x.user_id === p.user_id).map((x) => ({
          pledge_id: x.pledge_id,
          title: x.title,
          currency: x.currency,
          shape: x.shape,
          status: x.status,
          amount_minor: x.amount_minor === null ? null : Number(x.amount_minor),
          target_minor: x.target_minor === null ? null : Number(x.target_minor),
          pays_to: x.pays_to_code ? { code: x.pays_to_code, name: x.pays_to_name ?? x.pays_to_code } : null,
        })),
      })),
    };
  }

  // ── settings (read-only) ─────────────────────────────────────────────────

  async settings(env: Env, now: Date = new Date()): Promise<Record<string, unknown>> {
    const year = Number(nairobiDate(now).slice(0, 4));
    const counter = await maybeOne<{ next: number }>(this.pool, `SELECT next FROM receipt_counters WHERE year = $1`, [year]);
    const next = counter?.next ?? 1;
    // Names only — never a value (§5.6/§5.10).
    const providers = [
      { key: "stripe", label: "Stripe (cards & wallets)", configured: Boolean(env.STRIPE_SECRET_KEY), env: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] },
      {
        key: "mpesa",
        label: "M-Pesa (STK push)",
        configured: Boolean(env.MPESA_CONSUMER_KEY && env.MPESA_PASSKEY && env.MPESA_SHORTCODE) || Boolean(env.MPESA_CALLBACK_SECRET),
        env: ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_PASSKEY", "MPESA_SHORTCODE", "MPESA_CALLBACK_URL", "MPESA_CALLBACK_SECRET", "MPESA_ENV"],
      },
      { key: "airtel", label: "Airtel Money", configured: Boolean(env.AIRTEL_CALLBACK_SECRET), env: ["AIRTEL_CALLBACK_SECRET"] },
      { key: "paypal", label: "PayPal (USD)", configured: Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET), env: ["PAYPAL_CLIENT_ID", "PAYPAL_SECRET", "PAYPAL_ENV"] },
    ];
    const P = PartnersService;
    return {
      providers,
      receipt_counter: { year, next, next_receipt: `OR-${year}-${String(next).padStart(5, "0")}` },
      giving_tiers: givingTiers("KES"),
      cost_per_disciple_minor: COST_PER_DISCIPLE_MINOR,
      reminder_policy: {
        due_soon_days: P.DUE_SOON_DAYS,
        due_window_days: P.DUE_WINDOW_DAYS,
        follow_up_hours: P.FOLLOW_UP_HOURS,
        follow_ups: P.FOLLOW_UPS,
        in_flight_minutes: P.IN_FLIGHT_MINUTES,
        text: [
          `A partner hears once, up to ${P.DUE_SOON_DAYS} days before an instalment is due.`,
          `An unpaid instalment gets at most ${P.FOLLOW_UPS} follow-ups, ${P.FOLLOW_UP_HOURS} hours apart, starting ${P.FOLLOW_UP_HOURS} hours after its day ends — then silence.`,
          `No two reminders reach one pledge within ${P.FOLLOW_UP_HOURS} hours, whoever sends them; the office's own reminder obeys the same spacing.`,
          `A pledge shows as due ${P.DUE_WINDOW_DAYS} days ahead; a payment still processing counts for ${P.IN_FLIGHT_MINUTES} minutes before Pay shows again.`,
          "Members who turned reminders off — for a pledge or for partnership — are never reminded.",
        ],
      },
    };
  }
}
