// Finance books — the WRITE side of the Finance ERP (docs/FINANCE_ERP.md §2,
// §2a, §4, §6): office-recorded gifts and their reversal, funds, transfers,
// opening balances, journals, expenses with maker-checker, expense categories,
// budgets and budget-vs-actual.
//
// Rules this file keeps (and asserts):
//   · Every money write is ONE database transaction with its ledger legs.
//   · Every posting is balanced — one debit, one credit, same amount and
//     currency — checked in code before a leg is written (assertBalanced).
//   · Every leg carries the ECONOMIC date of what it records (12:00 Nairobi on
//     the received / spent / occurred day; a reversal or void restates the
//     timestamp of the legs it mirrors). When a row was actually entered lives
//     on the owning row and in the audit log (§2a).
//   · Nothing is deleted: mistakes are reversed (gifts, transfers, opening
//     balances) or voided (expenses). Money is integer minor units; KES and USD
//     are never added together.
//   · The server decides where money is booked: a pledge's gift lands in the
//     pledge's fund (FinancialService.pledgeFundCode), a need's in its
//     department's fund (needFundCode) — the same rules the apps' gifts use.
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx, audit, enqueueOutbox, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import type { Principal } from "../../http/http.js";
import type { FinancialService } from "./service.js";
import { pledgeTitleFor } from "./partners.js";
import { nairobiDate } from "./partnerStatementMath.js";
import { minorToMajor, type CsvCell } from "./csv.js";

// ── vocabulary ────────────────────────────────────────────────────────────

export const OFFICE_CHANNELS = ["onhand", "bank", "cheque", "mpesa", "other"] as const;
export type OfficeChannel = (typeof OFFICE_CHANNELS)[number];
export const BOOKS_CURRENCIES = ["KES", "USD"] as const;
export type BooksCurrency = (typeof BOOKS_CURRENCIES)[number];
export const EXPENSE_STATUSES = ["recorded", "approved", "void"] as const;
export const JOURNAL_KINDS = ["expense", "expense_void", "transfer", "opening", "reversal"] as const;

/** The largest single gift / expense / transfer (KES 10,000,000.00). */
export const MAX_MONEY_MINOR = 1_000_000_000;
/** An opening balance can be a whole bank account (KES 10,000,000,000.00). */
export const MAX_OPENING_MINOR = 1_000_000_000_000;
/** A budget month per line (KES 1,000,000,000.00). */
export const MAX_BUDGET_MONTH_MINOR = 100_000_000_000;
/** How far back a gift / expense / transfer may be dated. */
export const BOOKS_MAX_BACK_DAYS = 366;
/** …and an opening balance (ten years). */
export const OPENING_MAX_BACK_DAYS = 3660;

const CODE_SLUG = /^[a-z][a-z0-9-]{1,39}$/;
const MPESA_CODE = /^[A-Z0-9]{8,12}$/;
const EAT = "Africa/Nairobi";

/** Where money on a channel sits: the cash account a posting uses. `other`
 *  shares cash:manual with legacy confirmed claims. */
export function cashAccount(channel: OfficeChannel): string {
  return channel === "other" ? "cash:manual" : `cash:${channel}`;
}

// ── dates ─────────────────────────────────────────────────────────────────

const YMD = /^\d{4}-\d{2}-\d{2}$/;
function isRealDate(s: string): boolean {
  if (!YMD.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const ymd = z.string().refine(isRealDate, { message: "must be a real date, YYYY-MM-DD" });

function addDaysYmd(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** 422 INVALID_DATE unless `day` is within [today − maxBackDays, today], both
 *  as the church's calendar (Africa/Nairobi). */
export function assertBooksDate(field: string, day: string, now: Date, maxBackDays = BOOKS_MAX_BACK_DAYS): void {
  const today = nairobiDate(now);
  const earliest = addDaysYmd(today, -maxBackDays);
  if (day > today) {
    throw new ApiError("INVALID_DATE", `${field} cannot be after today (${today})`, { field, today, earliest });
  }
  if (day < earliest) {
    throw new ApiError("INVALID_DATE", `${field} cannot be more than ${maxBackDays} days ago (earliest ${earliest})`, { field, today, earliest });
  }
}

/** SQL for "12:00 on this Nairobi calendar day" as a timestamptz. */
const noonEat = (param: string): string => `((${param})::date + time '12:00') AT TIME ZONE '${EAT}'`;

// ── input helpers ─────────────────────────────────────────────────────────

/** Optional text: trimmed; null / "" / absent all read as null. */
function optText(min: number, max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null))
    .refine((v) => v === null || v.length >= min, { message: `must be ${min}–${max} characters` });
}
/** PATCH text: absent = unchanged; null / "" = clear. */
function patchText(min: number, max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v && v.length > 0 ? v : null))
    .refine((v) => v === undefined || v === null || v.length >= min, { message: `must be ${min}–${max} characters` });
}
const currency = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.enum(BOOKS_CURRENCIES));
const uuidOrNull = z
  .string()
  .uuid()
  .nullish()
  .transform((v) => v ?? null);
const nonEmpty = (o: Record<string, unknown>): boolean => Object.values(o).some((v) => v !== undefined);

/** A comma list of allowed values ("recorded,approved") → a deduped array. */
function commaList<T extends string>(allowed: readonly T[]) {
  return z
    .string()
    .max(200)
    .optional()
    .transform((s) => (s ? [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))] : []))
    .refine((xs) => xs.every((x) => (allowed as readonly string[]).includes(x)), { message: `each must be one of ${allowed.join(", ")}` })
    .transform((xs) => xs as T[]);
}

function encodeCursor(parts: string[]): string {
  return Buffer.from(JSON.stringify(parts), "utf8").toString("base64url");
}
function decodeCursor(cursor: string, n: number): string[] {
  try {
    const parts = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (Array.isArray(parts) && parts.length === n && parts.every((p) => typeof p === "string")) return parts as string[];
  } catch {
    /* fall through */
  }
  throw new ApiError("VALIDATION_FAILED", "Bad cursor — start again from the first page");
}

// ── postings ──────────────────────────────────────────────────────────────

export interface Leg {
  account: string;
  side: "debit" | "credit";
  amount_minor: number;
  currency: string;
}

/** The balance invariant, in code: at least two legs, one currency, positive
 *  whole amounts, Σ debit = Σ credit, never a leg against its own account.
 *  A violation is a programming error, never a user one — it refuses loudly. */
export function assertBalanced(legs: Leg[]): void {
  const fail = (why: string): never => {
    throw new ApiError("INTERNAL", `Refusing an unbalanced posting: ${why}`, { legs });
  };
  if (legs.length < 2) fail("fewer than two legs");
  const cur = legs[0]!.currency;
  let debit = 0;
  let credit = 0;
  for (const l of legs) {
    if (l.currency !== cur) fail("mixed currencies");
    if (!Number.isSafeInteger(l.amount_minor) || l.amount_minor <= 0) fail("non-positive or non-integer amount");
    if (!/^(cash|fund|sales):\S+$/.test(l.account)) fail(`unknown account ${l.account}`);
    if (l.side === "debit") debit += l.amount_minor;
    else credit += l.amount_minor;
  }
  if (debit !== credit) fail(`debits ${debit} ≠ credits ${credit}`);
  const debits = new Set(legs.filter((l) => l.side === "debit").map((l) => l.account));
  if (legs.some((l) => l.side === "credit" && debits.has(l.account))) fail("an account on both sides");
}

/** Write one balanced posting for a transaction or a journal, every leg dated
 *  `at` (a timestamptz value or its exact text). */
async function postLegs(c: Queryable, owner: { transaction_id: string } | { journal_id: string }, legs: Leg[], at: string | Date): Promise<void> {
  assertBalanced(legs);
  const txId = "transaction_id" in owner ? owner.transaction_id : null;
  const jId = "journal_id" in owner ? owner.journal_id : null;
  for (const l of legs) {
    await c.query(
      `INSERT INTO ledger_entries (transaction_id, journal_id, account, side, amount_minor, currency, created_at)
       VALUES ($1, $2, $3, $4::ledger_side, $5, $6, $7::timestamptz)`,
      [txId, jId, l.account, l.side, l.amount_minor, l.currency, at instanceof Date ? at.toISOString() : at],
    );
  }
}

/** The mirror of a posting (sides swapped), for a reversal or a void. */
function mirror(legs: Leg[]): Leg[] {
  return legs.map((l) => ({ ...l, side: l.side === "debit" ? "credit" : "debit" }));
}

interface StoredLeg extends Leg {
  entry_id: string;
  at_text: string;
}
/** A stored posting that can be mirrored: exactly one debit and one credit of
 *  the same amount and currency. Anything else is not a simple posting and is
 *  not reversed automatically. */
function simplePair(legs: StoredLeg[]): legs is [StoredLeg, StoredLeg] {
  if (legs.length !== 2) return false;
  const d = legs.find((l) => l.side === "debit");
  const c = legs.find((l) => l.side === "credit");
  return Boolean(d && c && d.amount_minor === c.amount_minor && d.currency === c.currency && d.at_text === c.at_text);
}

async function storedLegs(c: Queryable, where: "transaction_id" | "journal_id", id: string): Promise<StoredLeg[]> {
  const rows = await many<{ entry_id: string; account: string; side: "debit" | "credit"; amount_minor: string; currency: string; at_text: string }>(
    c,
    `SELECT entry_id, account, side::text AS side, amount_minor::text, currency, created_at::text AS at_text
       FROM ledger_entries WHERE ${where} = $1 ORDER BY ledger_entries.side, entry_id`,
    [id],
  );
  return rows.map((r) => ({ ...r, amount_minor: Number(r.amount_minor) }));
}

/** credits − debits on fund:<code> in one currency, over EVERY ledger row
 *  (transactions and journals). */
async function fundBalance(c: Queryable, code: string, cur: string): Promise<number> {
  const r = await one<{ bal: string }>(
    c,
    `SELECT COALESCE(sum(CASE WHEN side = 'credit' THEN amount_minor ELSE -amount_minor END), 0)::text AS bal
       FROM ledger_entries WHERE account = $1 AND currency = $2`,
    [`fund:${code}`, cur],
  );
  return Number(r.bal);
}

/** The next gapless office receipt number for a year. The counter row stays
 *  locked until the caller's transaction ends, so concurrent recorders queue
 *  here and a rolled-back attempt gives its number back. `next` is the number
 *  the NEXT gift will get (a year with no row → 1). */
async function nextOfficeReceipt(c: PoolClient, year: number): Promise<string> {
  const r = await one<{ issued: number }>(
    c,
    `INSERT INTO receipt_counters (year, next) VALUES ($1, 2)
     ON CONFLICT (year) DO UPDATE SET next = receipt_counters.next + 1
     RETURNING next - 1 AS issued`,
    [year],
  );
  return `OR-${year}-${String(r.issued).padStart(5, "0")}`;
}

/** A pg unique violation, and on which constraint / index. */
function uniqueViolation(err: unknown): string | null {
  const e = err as { code?: string; constraint?: string };
  return e && e.code === "23505" ? (e.constraint ?? "") : null;
}

const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const isoReq = (v: unknown): string => iso(v) ?? "";

// ── wire shapes ───────────────────────────────────────────────────────────

export interface LedgerLegOut {
  entry_id: string;
  account: string;
  side: "debit" | "credit";
  amount_minor: number;
  currency: string;
  created_at: string;
}

async function legsOut(c: Queryable, where: "transaction_id" | "journal_id", ids: string[]): Promise<Map<string, LedgerLegOut[]>> {
  const out = new Map<string, LedgerLegOut[]>();
  if (ids.length === 0) return out;
  // Debit first — by ledger_entries.side, the enum: a bare `side` would bind
  // to the text alias below and sort alphabetically. A journal holds one
  // posting. A reversed transaction holds two, and the reversal restates the
  // ORIGINAL legs' timestamp, so time cannot order them: the original pair is
  // the one that debits cash and credits the fund (a gift), the reversal its
  // mirror — so the reversal goes second.
  const order =
    where === "journal_id"
      ? `journal_id, ledger_entries.side, entry_id`
      : `transaction_id, created_at, CASE WHEN (ledger_entries.side = 'debit') = (account LIKE 'cash:%') THEN 0 ELSE 1 END, ledger_entries.side, entry_id`;
  const rows = await many<{ owner: string; entry_id: string; account: string; side: "debit" | "credit"; amount_minor: string; currency: string; created_at: Date }>(
    c,
    `SELECT ${where} AS owner, entry_id, account, side::text AS side, amount_minor::text, currency, created_at
       FROM ledger_entries WHERE ${where} = ANY($1::uuid[])
      ORDER BY ${order}`,
    [ids],
  );
  for (const r of rows) {
    const arr = out.get(r.owner) ?? [];
    arr.push({ entry_id: r.entry_id, account: r.account, side: r.side, amount_minor: Number(r.amount_minor), currency: r.currency, created_at: isoReq(r.created_at) });
    out.set(r.owner, arr);
  }
  return out;
}

export type BooksTransaction = Record<string, unknown> & { transaction_id: string; status: string };

// ── the service ───────────────────────────────────────────────────────────

export class FinanceBooks {
  constructor(
    private readonly pool: Pool,
    private readonly fin: FinancialService,
  ) {}

  // ════════════════════════════════════════════════════════════════════════
  // Office gifts
  // ════════════════════════════════════════════════════════════════════════

  static readonly GiftInput = z.object({
    idempotency_key: z.string().min(8).max(255),
    user_id: uuidOrNull,
    giver_name: optText(2, 120),
    giver_phone: optText(7, 32),
    anonymous: z.boolean().nullish().transform((v) => v ?? false),
    fund: optText(1, 40),
    amount_minor: z.number().int().min(1).max(MAX_MONEY_MINOR),
    currency,
    channel: z.enum(OFFICE_CHANNELS),
    reference: optText(1, 80),
    received_on: ymd,
    pledge_id: uuidOrNull,
    need_id: uuidOrNull,
    note: optText(1, 60),
  });

  /** Record a gift the office received. See the OpenAPI description of
   *  POST /admin/finance/gifts for the whole contract. */
  async recordGift(actorId: string, input: z.infer<typeof FinanceBooks.GiftInput>, now: Date = new Date()): Promise<BooksTransaction & { idempotency_key: string; reused: boolean }> {
    // ── the request's own shape (400) ──
    const walkIn = input.giver_name !== null || input.giver_phone !== null;
    const modes = [input.user_id !== null, walkIn, input.anonymous].filter(Boolean).length;
    if (modes !== 1) {
      throw new ApiError("VALIDATION_FAILED", "Say who gave: a member (user_id), a walk-in (giver_name and/or giver_phone), or anonymous — exactly one");
    }
    if (input.pledge_id && !input.user_id) {
      throw new ApiError("VALIDATION_FAILED", "A pledge payment needs the member (user_id) whose pledge it is");
    }
    let reference = input.reference;
    if (["mpesa", "cheque", "bank"].includes(input.channel) && !reference) {
      throw new ApiError("VALIDATION_FAILED", `A ${input.channel === "mpesa" ? "M-Pesa code" : input.channel === "cheque" ? "cheque number" : "bank reference"} is required for this channel`, {
        fields: [{ path: "reference", message: "required for mpesa, cheque and bank" }],
      });
    }
    if (input.channel === "mpesa" && reference) {
      reference = reference.toUpperCase();
      if (!MPESA_CODE.test(reference)) {
        throw new ApiError("INVALID_REFERENCE", `"${reference}" is not an M-Pesa code — 8 to 12 letters and digits, as on the M-Pesa message`, { field: "reference" });
      }
    }
    assertBooksDate("received_on", input.received_on, now);

    // ── a replay returns what was booked, and books nothing ──
    const replay = await this.giftReplay(input.idempotency_key);
    if (replay) return replay;

    try {
      const transactionId = await tx(this.pool, async (c) => {
        let member: { user_id: string } | null = null;
        if (input.user_id) {
          member = await maybeOne<{ user_id: string }>(c, `SELECT user_id FROM users WHERE user_id = $1 AND deleted_at IS NULL`, [input.user_id]);
          if (!member) throw new ApiError("UNPROCESSABLE", "No such member");
        }

        // Where the money is booked — the server's rule, never the form's.
        let fundCode = input.fund;
        if (input.pledge_id) {
          // resolvePledgeId's rule: the member's own pledge, still open.
          const p = await maybeOne<{ pledge_id: string; currency: string }>(
            c,
            `SELECT pledge_id, currency FROM pledges WHERE pledge_id = $1 AND user_id = $2 AND status IN ('active','paused') FOR SHARE`,
            [input.pledge_id, input.user_id],
          );
          if (!p) throw new ApiError("UNPROCESSABLE", "That pledge is not this member's or is no longer open");
          if (p.currency.trim() !== input.currency) {
            throw new ApiError("CURRENCY_MISMATCH", `That pledge is in ${p.currency.trim()} — record the gift in ${p.currency.trim()}`, { expected: p.currency.trim() });
          }
          fundCode = await this.fin.pledgeFundCode(p.pledge_id, c);
        }
        if (input.need_id) {
          // resolveNeedId's rule: approved (open for giving).
          const n = await maybeOne<{ need_id: string; currency: string }>(
            c,
            `SELECT need_id, currency FROM department_needs WHERE need_id = $1 AND status = 'approved'`,
            [input.need_id],
          );
          if (!n) throw new ApiError("UNPROCESSABLE", "That need is not open for giving");
          if (n.currency.trim() !== input.currency) {
            throw new ApiError("CURRENCY_MISMATCH", `That need is in ${n.currency.trim()} — record the gift in ${n.currency.trim()}`, { expected: n.currency.trim() });
          }
          if (!input.pledge_id) fundCode = (await this.fin.needFundCode(n.need_id, c)) ?? input.fund;
        }
        if (!fundCode) throw new ApiError("VALIDATION_FAILED", "Choose the fund this gift is for", { fields: [{ path: "fund", message: "required" }] });
        const fund = await maybeOne<{ fund_id: string; code: string; is_active: boolean }>(c, `SELECT fund_id, code, is_active FROM funds WHERE code = $1`, [fundCode]);
        if (!fund || !fund.is_active) {
          throw new ApiError("UNPROCESSABLE", input.pledge_id ? `The fund this pledge pays to (${fundCode}) is not active` : `Unknown or inactive fund: ${fundCode}`);
        }

        // One payment, one record: an M-Pesa code already settled online, or
        // already on a live office entry, is refused with the row that has it.
        if (input.channel === "mpesa" && reference) await this.assertMpesaCodeFree(c, reference);

        const receipt = await nextOfficeReceipt(c, Number(nairobiDate(now).slice(0, 4)));
        const t = await one<{ transaction_id: string; created_at: Date; at_text: string }>(
          c,
          `INSERT INTO transactions
             (user_id, fund_id, amount_minor, currency, status, provider, idempotency_key, account_name, pledge_id, need_id,
              source, giver_name, giver_phone, receipt_code, office_channel, office_reference, recorded_by, created_at, settled_at)
           VALUES ($1, $2, $3, $4, 'succeeded', 'manual', $5, $6, $7, $8,
                   'admin', $9, $10, $11, $12, $13, $14, ${noonEat("$15")}, ${noonEat("$15")})
           RETURNING transaction_id, created_at, created_at::text AS at_text`,
          [
            input.user_id, fund.fund_id, input.amount_minor, input.currency, input.idempotency_key, input.note, input.pledge_id, input.need_id,
            input.giver_name, input.giver_phone, receipt, input.channel, reference, actorId, input.received_on,
          ],
        );
        await postLegs(
          c,
          { transaction_id: t.transaction_id },
          [
            { account: cashAccount(input.channel), side: "debit", amount_minor: input.amount_minor, currency: input.currency },
            { account: `fund:${fund.code}`, side: "credit", amount_minor: input.amount_minor, currency: input.currency },
          ],
          t.at_text,
        );
        // A member is thanked exactly as for an app gift (email + SMS receipt).
        if (input.user_id) await enqueueOutbox(c, "giving.receipt", { transaction_id: t.transaction_id, user_id: input.user_id });
        await audit(c, actorId, "finance.gift_recorded", "transactions", t.transaction_id, {
          receipt_code: receipt, amount_minor: input.amount_minor, currency: input.currency, fund: fund.code,
          channel: input.channel, reference, received_on: input.received_on,
          giver: input.user_id ? "member" : walkIn ? "walk_in" : "anonymous", user_id: input.user_id,
          pledge_id: input.pledge_id, need_id: input.need_id,
        });
        return t.transaction_id;
      });
      const view = await this.transactionView(this.pool, transactionId);
      return { ...view, idempotency_key: input.idempotency_key, reused: false };
    } catch (err) {
      const which = uniqueViolation(err);
      if (which !== null && which.includes("idempotency_key")) {
        // A concurrent request with the same key won; answer as its replay.
        const again = await this.giftReplay(input.idempotency_key);
        if (again) return again;
      }
      if (which === "transactions_office_mpesa_ref_uniq" && reference) {
        // Two recorders raced with the same code; the other committed first.
        await this.assertMpesaCodeFree(this.pool, reference);
      }
      throw err;
    }
  }

  /** 409 DUPLICATE_RECEIPT when an M-Pesa code is already the receipt of a
   *  settled transaction, or the reference of a live office M-Pesa entry. */
  private async assertMpesaCodeFree(c: Queryable, code: string): Promise<void> {
    const hit = await maybeOne<{ transaction_id: string; receipt_code: string | null; source: string; day: string }>(
      c,
      `SELECT t.transaction_id, t.receipt_code, t.source, (t.created_at AT TIME ZONE '${EAT}')::date::text AS day
         FROM transactions t
        WHERE t.status = 'succeeded'
          AND (t.receipt_code = $1 OR (t.office_channel = 'mpesa' AND upper(t.office_reference) = $1))
        ORDER BY t.created_at LIMIT 1`,
      [code],
    );
    if (!hit) return;
    const what = hit.source === "admin" ? `an office entry (receipt ${hit.receipt_code ?? "—"}, ${hit.day})` : `a settled online payment (${hit.day})`;
    throw new ApiError("DUPLICATE_RECEIPT", `M-Pesa code ${code} is already recorded as ${what}, transaction ${hit.transaction_id}`, {
      transaction_id: hit.transaction_id,
      receipt_code: hit.receipt_code,
    });
  }

  /** The office gift an idempotency key already booked, or null. A key that
   *  belongs to some other kind of payment is a 409. */
  private async giftReplay(key: string): Promise<(BooksTransaction & { idempotency_key: string; reused: boolean }) | null> {
    const hit = await maybeOne<{ transaction_id: string; source: string; provider: string }>(
      this.pool,
      `SELECT transaction_id, source, provider FROM transactions WHERE idempotency_key = $1`,
      [key],
    );
    if (!hit) return null;
    if (hit.source !== "admin" || hit.provider !== "manual") {
      throw new ApiError("CONFLICT", "That idempotency key already belongs to a different payment — generate a new one");
    }
    return { ...(await this.transactionView(this.pool, hit.transaction_id)), idempotency_key: key, reused: true };
  }

  /** A transaction as the books show it: office fields, reversal fields,
   *  names, and every ledger leg. */
  async transactionView(c: Queryable, id: string): Promise<BooksTransaction> {
    const t = await maybeOne<Record<string, unknown> & { transaction_id: string; status: string; pledge_id: string | null }>(
      c,
      `SELECT t.transaction_id, t.status::text AS status, t.provider, t.source, t.receipt_code,
              t.amount_minor::text AS amount_minor, t.currency, f.code AS fund_code, f.name AS fund_name,
              t.office_channel, t.office_reference, (t.created_at AT TIME ZONE '${EAT}')::date::text AS received_on,
              t.created_at, t.settled_at, t.user_id, u.full_name AS member_name, t.giver_name, t.giver_phone,
              t.pledge_id, t.need_id, n.title AS need_title, t.account_name,
              t.recorded_by, rb.full_name AS recorded_by_name,
              t.reversed_at, t.reversed_by, rv.full_name AS reversed_by_name, t.reversal_reason
         FROM transactions t
         LEFT JOIN funds f ON f.fund_id = t.fund_id
         LEFT JOIN users u ON u.user_id = t.user_id
         LEFT JOIN users rb ON rb.user_id = t.recorded_by
         LEFT JOIN users rv ON rv.user_id = t.reversed_by
         LEFT JOIN department_needs n ON n.need_id = t.need_id
        WHERE t.transaction_id = $1`,
      [id],
    );
    if (!t) throw new ApiError("NOT_FOUND", "Transaction not found");
    const pledgeTitle = t.pledge_id ? await pledgeTitleFor(c, t.pledge_id) : null;
    const legs = (await legsOut(c, "transaction_id", [id])).get(id) ?? [];
    return {
      transaction_id: t.transaction_id,
      status: t.status,
      provider: String(t.provider ?? "stripe"),
      source: String(t.source),
      receipt_code: (t.receipt_code as string | null) ?? null,
      amount_minor: Number(t.amount_minor),
      currency: String(t.currency),
      fund: t.fund_code ? { code: String(t.fund_code), name: String(t.fund_name) } : null,
      channel: (t.office_channel as string | null) ?? null,
      reference: (t.office_reference as string | null) ?? null,
      received_on: String(t.received_on),
      created_at: isoReq(t.created_at),
      settled_at: iso(t.settled_at),
      user_id: (t.user_id as string | null) ?? null,
      member_name: (t.member_name as string | null) ?? null,
      giver_name: (t.giver_name as string | null) ?? null,
      giver_phone: (t.giver_phone as string | null) ?? null,
      anonymous: !t.user_id && !t.giver_name && !t.giver_phone,
      pledge: t.pledge_id && pledgeTitle ? { pledge_id: t.pledge_id, title: pledgeTitle } : null,
      need: t.need_id && t.need_title ? { need_id: String(t.need_id), title: String(t.need_title) } : null,
      note: (t.account_name as string | null) ?? null,
      recorded_by: (t.recorded_by as string | null) ?? null,
      recorded_by_name: (t.recorded_by_name as string | null) ?? null,
      reversed_at: iso(t.reversed_at),
      reversed_by: (t.reversed_by as string | null) ?? null,
      reversed_by_name: (t.reversed_by_name as string | null) ?? null,
      reversal_reason: (t.reversal_reason as string | null) ?? null,
      ledger: legs,
    };
  }

  static readonly ReverseInput = z.object({ reason: z.string().trim().min(5).max(300) });

  /** Reverse an office gift or a confirmed manual claim: the mirror of its
   *  legs (restating their timestamp), status refunded, reversal fields. */
  async reverseTransaction(actorId: string, id: string, reason: string): Promise<BooksTransaction> {
    await tx(this.pool, async (c) => {
      const t = await maybeOne<{ transaction_id: string; status: string; provider: string | null; reversed_at: Date | null; amount_minor: string; currency: string; pledge_id: string | null; receipt_code: string | null; source: string; fund_code: string | null }>(
        c,
        `SELECT t.transaction_id, t.status::text AS status, t.provider, t.reversed_at, t.amount_minor::text, t.currency,
                t.pledge_id, t.receipt_code, t.source, f.code AS fund_code
           FROM transactions t LEFT JOIN funds f ON f.fund_id = t.fund_id
          WHERE t.transaction_id = $1 FOR UPDATE OF t`,
        [id],
      );
      if (!t) throw new ApiError("NOT_FOUND", "Transaction not found");
      if (t.reversed_at || t.status === "refunded") throw new ApiError("ALREADY_REVERSED", "This gift was reversed already");
      if (t.provider !== "manual") {
        throw new ApiError("NOT_REVERSIBLE", "Only a gift recorded by hand (office gift or confirmed claim) can be reversed here — M-Pesa, card and PayPal payments are refunded at the provider");
      }
      if (t.status !== "succeeded") throw new ApiError("NOT_REVERSIBLE", `Only a succeeded gift can be reversed (this one is ${t.status})`);
      const legs = await storedLegs(c, "transaction_id", id);
      if (!simplePair(legs) || legs[0].amount_minor !== Number(t.amount_minor) || legs[0].currency !== t.currency) {
        throw new ApiError("NOT_REVERSIBLE", "Its ledger postings are not one balanced debit/credit pair — reconcile it before reversing");
      }
      // The correction restates the day it corrects (§2a): same timestamp as
      // the legs it mirrors, so every period nets to zero.
      await postLegs(c, { transaction_id: id }, mirror(legs), legs[0].at_text);
      await c.query(
        `UPDATE transactions SET status = 'refunded', reversed_at = now(), reversed_by = $2, reversal_reason = $3 WHERE transaction_id = $1`,
        [id, actorId, reason],
      );
      // A total pledge this gift had fulfilled is open again when what is left
      // no longer reaches its target (monthly instalments re-open by
      // themselves — the ledger only counts succeeded gifts).
      if (t.pledge_id) {
        const p = await maybeOne<{ shape: string; status: string; target_minor: string | null }>(
          c, `SELECT shape, status, target_minor::text FROM pledges WHERE pledge_id = $1 FOR UPDATE`, [t.pledge_id],
        );
        if (p && p.shape === "total" && p.status === "fulfilled") {
          const paid = await one<{ paid: string }>(
            c, `SELECT COALESCE(sum(amount_minor), 0)::text AS paid FROM transactions WHERE pledge_id = $1 AND status = 'succeeded'`, [t.pledge_id],
          );
          if (Number(paid.paid) < Number(p.target_minor ?? 0)) {
            await c.query(`UPDATE pledges SET status = 'active', fulfilled_at = NULL, updated_at = now() WHERE pledge_id = $1`, [t.pledge_id]);
            await audit(c, actorId, "pledge.reopened", "pledges", t.pledge_id, { transaction_id: id, reason: "gift reversed" });
          }
        }
      }
      await audit(c, actorId, "finance.gift_reversed", "transactions", id, {
        amount_minor: Number(t.amount_minor), currency: t.currency, fund: t.fund_code, receipt_code: t.receipt_code, source: t.source, reason,
      });
    });
    return this.transactionView(this.pool, id);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Funds
  // ════════════════════════════════════════════════════════════════════════

  static readonly FundInput = z.object({
    code: z.string().regex(CODE_SLUG, "lower-case letters, digits and dashes, starting with a letter (2–40)"),
    name: z.string().trim().min(2).max(150),
    name_sw: optText(2, 150),
    description: optText(1, 500),
    sort: z.number().int().min(-1_000_000).max(1_000_000).nullish().transform((v) => v ?? 0),
    is_active: z.boolean().nullish().transform((v) => v ?? true),
  });
  static readonly FundPatch = z
    .object({
      name: z.string().trim().min(2).max(150).optional(),
      name_sw: patchText(2, 150),
      description: patchText(1, 500),
      sort: z.number().int().min(-1_000_000).max(1_000_000).optional(),
      is_active: z.boolean().optional(),
    })
    .strict()
    .refine(nonEmpty, { message: "Nothing to change" });

  private static readonly FUND_COLS = `fund_id, code, name, name_sw, description, sort, is_active`;
  private static fundOut(r: Record<string, unknown>): Record<string, unknown> {
    return {
      fund_id: String(r.fund_id), code: String(r.code), name: String(r.name),
      name_sw: (r.name_sw as string | null) ?? null, description: (r.description as string | null) ?? null,
      sort: Number(r.sort ?? 0), is_active: Boolean(r.is_active),
    };
  }

  async createFund(actorId: string, input: z.infer<typeof FinanceBooks.FundInput>): Promise<Record<string, unknown>> {
    try {
      return await tx(this.pool, async (c) => {
        const r = await one<Record<string, unknown>>(
          c,
          `INSERT INTO funds (code, name, name_sw, description, sort, is_active) VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING ${FinanceBooks.FUND_COLS}`,
          [input.code, input.name, input.name_sw, input.description, input.sort, input.is_active],
        );
        await audit(c, actorId, "fund.created", "funds", String(r.fund_id), { code: input.code, name: input.name, is_active: input.is_active });
        return FinanceBooks.fundOut(r);
      });
    } catch (err) {
      if (uniqueViolation(err) !== null) throw new ApiError("CONFLICT", `A fund with the code "${input.code}" already exists`);
      throw err;
    }
  }

  async updateFund(actorId: string, code: string, patch: z.infer<typeof FinanceBooks.FundPatch>): Promise<Record<string, unknown>> {
    return tx(this.pool, async (c) => {
      const before = await maybeOne<Record<string, unknown>>(c, `SELECT ${FinanceBooks.FUND_COLS} FROM funds WHERE code = $1 FOR NO KEY UPDATE`, [code]);
      if (!before) throw new ApiError("NOT_FOUND", "Fund not found");
      const sets: string[] = [];
      const params: unknown[] = [code];
      const changes: Record<string, unknown> = {};
      for (const k of ["name", "name_sw", "description", "sort", "is_active"] as const) {
        const v = patch[k];
        if (v === undefined) continue;
        params.push(v);
        sets.push(`${k} = $${params.length}`);
        changes[k] = { from: before[k] ?? null, to: v };
      }
      const r = await one<Record<string, unknown>>(c, `UPDATE funds SET ${sets.join(", ")} WHERE code = $1 RETURNING ${FinanceBooks.FUND_COLS}`, params);
      await audit(c, actorId, "fund.updated", "funds", String(r.fund_id), { code, changes });
      return FinanceBooks.fundOut(r);
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // Journals: transfers, opening balances, reversal, the register
  // ════════════════════════════════════════════════════════════════════════

  static readonly TransferInput = z.object({
    from_fund: z.string().trim().min(1).max(40),
    to_fund: z.string().trim().min(1).max(40),
    amount_minor: z.number().int().min(1).max(MAX_MONEY_MINOR),
    currency,
    occurred_on: ymd,
    memo: z.string().trim().min(3).max(300),
    allow_negative: z.boolean().nullish().transform((v) => v ?? false),
    idempotency_key: z.string().min(8).max(255).nullish().transform((v) => v ?? null),
  });

  /** Journal-level idempotency: the journal a key already posted (of the
   *  expected kind), or null. Another kind under the key is a 409. */
  private async journalByKey(key: string | null, kind: "transfer" | "opening"): Promise<string | null> {
    if (!key) return null;
    const j = await maybeOne<{ journal_id: string; kind: string }>(this.pool, `SELECT journal_id, kind FROM journals WHERE idempotency_key = $1`, [key]);
    if (!j) return null;
    if (j.kind !== kind) throw new ApiError("CONFLICT", "That idempotency key already belongs to a different posting — generate a new one");
    return j.journal_id;
  }

  /** Lock funds (in code order, so two opposite transfers cannot deadlock).
   *  NO KEY UPDATE, not UPDATE: it serialises the balance guards against each
   *  other without blocking the foreign-key checks of gifts being booked to
   *  the same fund meanwhile. */
  private async lockFunds(c: Queryable, codes: string[]): Promise<Map<string, { fund_id: string; code: string; name: string; is_active: boolean }>> {
    const rows = await many<{ fund_id: string; code: string; name: string; is_active: boolean }>(
      c, `SELECT fund_id, code, name, is_active FROM funds WHERE code = ANY($1::text[]) ORDER BY code FOR NO KEY UPDATE`, [codes],
    );
    return new Map(rows.map((r) => [r.code, r]));
  }

  private negativeGuard(code: string, cur: string, balance: number, amount: number, allow: boolean): void {
    const after = balance - amount;
    if (after < 0 && !allow) {
      throw new ApiError("UNPROCESSABLE", `This would take the ${code} fund below zero in ${cur} (balance ${minorToMajor(balance)}, after ${minorToMajor(after)}) — confirm to allow a negative balance`, {
        reason: "NEGATIVE_BALANCE", fund: code, currency: cur, balance_minor: balance, balance_after_minor: after,
      });
    }
  }

  async postTransfer(actorId: string, input: z.infer<typeof FinanceBooks.TransferInput>, now: Date = new Date()): Promise<Record<string, unknown>> {
    if (input.from_fund === input.to_fund) throw new ApiError("VALIDATION_FAILED", "Choose two different funds");
    assertBooksDate("occurred_on", input.occurred_on, now);
    const replayId = await this.journalByKey(input.idempotency_key, "transfer");
    if (replayId) return this.transferView(this.pool, replayId, null, true);
    try {
      const out = await tx(this.pool, async (c) => {
        const funds = await this.lockFunds(c, [input.from_fund, input.to_fund]);
        const from = funds.get(input.from_fund);
        const to = funds.get(input.to_fund);
        if (!from) throw new ApiError("UNPROCESSABLE", `Unknown fund: ${input.from_fund}`);
        if (!to) throw new ApiError("UNPROCESSABLE", `Unknown fund: ${input.to_fund}`);
        if (!to.is_active) throw new ApiError("UNPROCESSABLE", `The ${to.code} fund is not active — activate it before moving money into it`);
        const balance = await fundBalance(c, from.code, input.currency);
        this.negativeGuard(from.code, input.currency, balance, input.amount_minor, input.allow_negative);
        const j = await one<{ journal_id: string }>(
          c,
          `INSERT INTO journals (kind, memo, occurred_on, created_by, idempotency_key) VALUES ('transfer', $1, $2, $3, $4) RETURNING journal_id`,
          [input.memo, input.occurred_on, actorId, input.idempotency_key],
        );
        const at = await one<{ at: string }>(c, `SELECT (${noonEat("$1")})::text AS at`, [input.occurred_on]);
        await postLegs(c, { journal_id: j.journal_id }, [
          { account: `fund:${from.code}`, side: "debit", amount_minor: input.amount_minor, currency: input.currency },
          { account: `fund:${to.code}`, side: "credit", amount_minor: input.amount_minor, currency: input.currency },
        ], at.at);
        const ft = await one<{ transfer_id: string }>(
          c,
          `INSERT INTO fund_transfers (from_fund_id, to_fund_id, amount_minor, currency, occurred_on, memo, created_by, journal_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING transfer_id`,
          [from.fund_id, to.fund_id, input.amount_minor, input.currency, input.occurred_on, input.memo, actorId, j.journal_id],
        );
        await c.query(`UPDATE journals SET ref_id = $2 WHERE journal_id = $1`, [j.journal_id, ft.transfer_id]);
        await audit(c, actorId, "journal.transfer_posted", "journals", j.journal_id, {
          transfer_id: ft.transfer_id, from: from.code, to: to.code, amount_minor: input.amount_minor, currency: input.currency,
          occurred_on: input.occurred_on, allow_negative: input.allow_negative, from_balance_after_minor: balance - input.amount_minor,
        });
        return { journal_id: j.journal_id, after: balance - input.amount_minor };
      });
      return this.transferView(this.pool, out.journal_id, out.after, false);
    } catch (err) {
      if (uniqueViolation(err) === "journals_idempotency_key_uniq") {
        const again = await this.journalByKey(input.idempotency_key, "transfer");
        if (again) return this.transferView(this.pool, again, null, true);
      }
      throw err;
    }
  }

  private async transferView(c: Queryable, journalId: string, balanceAfter: number | null, reused: boolean): Promise<Record<string, unknown>> {
    const t = await one<Record<string, unknown>>(
      c,
      `SELECT ft.transfer_id, ft.journal_id, ff.code AS from_code, ff.name AS from_name, tf.code AS to_code, tf.name AS to_name,
              ft.amount_minor::text AS amount_minor, ft.currency, ft.occurred_on::text AS occurred_on, ft.memo, ft.created_by, ft.created_at,
              r.journal_id AS reversed_by_journal_id
         FROM fund_transfers ft
         JOIN funds ff ON ff.fund_id = ft.from_fund_id
         JOIN funds tf ON tf.fund_id = ft.to_fund_id
         LEFT JOIN journals r ON r.reversal_of = ft.journal_id
        WHERE ft.journal_id = $1`,
      [journalId],
    );
    const after = balanceAfter ?? (await fundBalance(c, String(t.from_code), String(t.currency)));
    return {
      transfer_id: String(t.transfer_id),
      journal_id: String(t.journal_id),
      from_fund: { code: String(t.from_code), name: String(t.from_name) },
      to_fund: { code: String(t.to_code), name: String(t.to_name) },
      amount_minor: Number(t.amount_minor),
      currency: String(t.currency),
      occurred_on: String(t.occurred_on),
      memo: String(t.memo),
      created_by: (t.created_by as string | null) ?? null,
      created_at: isoReq(t.created_at),
      from_balance_after_minor: after,
      reversed_by_journal_id: (t.reversed_by_journal_id as string | null) ?? null,
      reused,
      ledger: (await legsOut(c, "journal_id", [journalId])).get(journalId) ?? [],
    };
  }

  static readonly OpeningInput = z.object({
    idempotency_key: z.string().min(8).max(255),
    channel: z.enum(OFFICE_CHANNELS),
    fund: z.string().trim().min(1).max(40),
    amount_minor: z.number().int().min(1).max(MAX_OPENING_MINOR),
    currency,
    as_of: ymd,
    memo: z.string().trim().min(3).max(300),
  });

  async postOpeningBalance(actorId: string, input: z.infer<typeof FinanceBooks.OpeningInput>, now: Date = new Date()): Promise<Record<string, unknown>> {
    assertBooksDate("as_of", input.as_of, now, OPENING_MAX_BACK_DAYS);
    const replayId = await this.journalByKey(input.idempotency_key, "opening");
    if (replayId) return { ...(await this.journalView(this.pool, replayId)), reused: true };
    try {
      const journalId = await tx(this.pool, async (c) => {
        const fund = await maybeOne<{ code: string; is_active: boolean }>(c, `SELECT code, is_active FROM funds WHERE code = $1`, [input.fund]);
        if (!fund || !fund.is_active) throw new ApiError("UNPROCESSABLE", `Unknown or inactive fund: ${input.fund}`);
        const j = await one<{ journal_id: string }>(
          c,
          `INSERT INTO journals (kind, memo, occurred_on, created_by, idempotency_key) VALUES ('opening', $1, $2, $3, $4) RETURNING journal_id`,
          [input.memo, input.as_of, actorId, input.idempotency_key],
        );
        const at = await one<{ at: string }>(c, `SELECT (${noonEat("$1")})::text AS at`, [input.as_of]);
        await postLegs(c, { journal_id: j.journal_id }, [
          { account: cashAccount(input.channel), side: "debit", amount_minor: input.amount_minor, currency: input.currency },
          { account: `fund:${fund.code}`, side: "credit", amount_minor: input.amount_minor, currency: input.currency },
        ], at.at);
        await audit(c, actorId, "journal.opening_posted", "journals", j.journal_id, {
          fund: fund.code, channel: input.channel, account: cashAccount(input.channel), amount_minor: input.amount_minor, currency: input.currency, as_of: input.as_of,
        });
        return j.journal_id;
      });
      return { ...(await this.journalView(this.pool, journalId)), reused: false };
    } catch (err) {
      if (uniqueViolation(err) === "journals_idempotency_key_uniq") {
        const again = await this.journalByKey(input.idempotency_key, "opening");
        if (again) return { ...(await this.journalView(this.pool, again)), reused: true };
      }
      throw err;
    }
  }

  static readonly JournalReverseInput = z.object({
    reason: z.string().trim().min(5).max(300),
    allow_negative: z.boolean().nullish().transform((v) => v ?? false),
  });

  /** Reverse a transfer or an opening balance: a reversal journal with the
   *  mirrored legs at the original's leg timestamp. Once per journal. */
  async reverseJournal(actorId: string, id: string, input: z.infer<typeof FinanceBooks.JournalReverseInput>): Promise<Record<string, unknown>> {
    try {
      const reversalId = await tx(this.pool, async (c) => {
        const j = await maybeOne<{ journal_id: string; kind: string; occurred_on: string; ref_id: string | null }>(
          c, `SELECT journal_id, kind, occurred_on::text AS occurred_on, ref_id FROM journals WHERE journal_id = $1 FOR UPDATE`, [id],
        );
        if (!j) throw new ApiError("NOT_FOUND", "Journal not found");
        if (j.kind === "expense" || j.kind === "expense_void") {
          throw new ApiError("USE_EXPENSE_VOID", "An expense's posting is undone by voiding the expense, not by reversing its journal", { ref_id: j.ref_id });
        }
        if (j.kind === "reversal") throw new ApiError("NOT_REVERSIBLE", "A reversal is not reversed — post the right journal instead");
        const prior = await maybeOne<{ journal_id: string }>(c, `SELECT journal_id FROM journals WHERE reversal_of = $1`, [id]);
        if (prior) throw new ApiError("ALREADY_REVERSED", "This journal was reversed already", { reversed_by_journal_id: prior.journal_id });
        const legs = await storedLegs(c, "journal_id", id);
        if (!simplePair(legs)) throw new ApiError("NOT_REVERSIBLE", "Its ledger postings are not one balanced debit/credit pair — reconcile it before reversing");
        const back = mirror(legs);
        // The fund the reversal takes money out of may not go negative unless
        // the office says so (a transfer's receiving fund; an opening's fund).
        const debited = back.find((l) => l.side === "debit")!;
        if (debited.account.startsWith("fund:")) {
          const code = debited.account.slice("fund:".length);
          await this.lockFunds(c, [code]);
          this.negativeGuard(code, debited.currency, await fundBalance(c, code, debited.currency), debited.amount_minor, input.allow_negative);
        }
        const r = await one<{ journal_id: string }>(
          c,
          `INSERT INTO journals (kind, memo, occurred_on, ref_id, reversal_of, created_by) VALUES ('reversal', $1, $2, $3, $4, $5) RETURNING journal_id`,
          [input.reason, j.occurred_on, j.ref_id, id, actorId],
        );
        await postLegs(c, { journal_id: r.journal_id }, back, legs[0].at_text);
        await audit(c, actorId, "journal.reversed", "journals", id, {
          reversal_journal_id: r.journal_id, kind: j.kind, reason: input.reason, amount_minor: legs[0].amount_minor, currency: legs[0].currency, allow_negative: input.allow_negative,
        });
        return r.journal_id;
      });
      return this.journalView(this.pool, reversalId);
    } catch (err) {
      if (uniqueViolation(err) === "journals_one_reversal") throw new ApiError("ALREADY_REVERSED", "This journal was reversed already");
      throw err;
    }
  }

  static readonly JournalQuery = z.object({
    kind: commaList(JOURNAL_KINDS),
    from: ymd.optional(),
    to: ymd.optional(),
    cursor: z.string().max(500).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  });

  private static readonly JOURNAL_SELECT = `
    SELECT j.journal_id, j.kind, j.memo, j.occurred_on::text AS occurred_on, j.created_at, j.created_at::text AS created_at_text,
           j.created_by, u.full_name AS created_by_name, j.ref_id, j.reversal_of, r.journal_id AS reversed_by_journal_id
      FROM journals j
      LEFT JOIN users u ON u.user_id = j.created_by
      LEFT JOIN journals r ON r.reversal_of = j.journal_id`;

  private async journalsOut(c: Queryable, rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
    const legs = await legsOut(c, "journal_id", rows.map((r) => String(r.journal_id)));
    return rows.map((r) => {
      const ls = legs.get(String(r.journal_id)) ?? [];
      const byCur = new Map<string, number>();
      for (const l of ls) if (l.side === "debit") byCur.set(l.currency, (byCur.get(l.currency) ?? 0) + l.amount_minor);
      return {
        journal_id: String(r.journal_id),
        kind: String(r.kind),
        memo: (r.memo as string | null) ?? null,
        occurred_on: String(r.occurred_on),
        created_at: isoReq(r.created_at),
        created_by: (r.created_by as string | null) ?? null,
        created_by_name: (r.created_by_name as string | null) ?? null,
        ref_id: (r.ref_id as string | null) ?? null,
        reversal_of: (r.reversal_of as string | null) ?? null,
        reversed_by_journal_id: (r.reversed_by_journal_id as string | null) ?? null,
        legs: ls,
        totals: [...byCur.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cur, amount]) => ({ currency: cur, amount_minor: amount })),
      };
    });
  }

  async journalView(c: Queryable, id: string): Promise<Record<string, unknown>> {
    const row = await maybeOne<Record<string, unknown>>(c, `${FinanceBooks.JOURNAL_SELECT} WHERE j.journal_id = $1`, [id]);
    if (!row) throw new ApiError("NOT_FOUND", "Journal not found");
    return (await this.journalsOut(c, [row]))[0]!;
  }

  async listJournals(q: z.infer<typeof FinanceBooks.JournalQuery>): Promise<Record<string, unknown>> {
    const params: unknown[] = [];
    const where: string[] = ["TRUE"];
    if (q.kind.length) { params.push(q.kind); where.push(`j.kind = ANY($${params.length}::text[])`); }
    if (q.from) { params.push(q.from); where.push(`j.occurred_on >= $${params.length}::date`); }
    if (q.to) { params.push(q.to); where.push(`j.occurred_on <= $${params.length}::date`); }
    const filtered = [...where];
    const filteredParams = [...params];
    if (q.cursor) {
      const [d, at, jid] = decodeCursor(q.cursor, 3) as [string, string, string];
      params.push(d, at, jid);
      where.push(`(j.occurred_on, j.created_at, j.journal_id) < ($${params.length - 2}::date, $${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    params.push(q.limit + 1);
    const rows = await many<Record<string, unknown>>(
      this.pool,
      `${FinanceBooks.JOURNAL_SELECT} WHERE ${where.join(" AND ")}
        ORDER BY j.occurred_on DESC, j.created_at DESC, j.journal_id DESC LIMIT $${params.length}`,
      params,
    );
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    const totals = await many<{ currency: string; amount: string; n: number }>(
      this.pool,
      `SELECT le.currency, sum(le.amount_minor)::text AS amount, count(DISTINCT j.journal_id)::int AS n
         FROM journals j JOIN ledger_entries le ON le.journal_id = j.journal_id AND le.side = 'debit'
        WHERE ${filtered.join(" AND ")} GROUP BY le.currency ORDER BY le.currency`,
      filteredParams,
    );
    return {
      data: await this.journalsOut(this.pool, page),
      next_cursor: rows.length > q.limit && last ? encodeCursor([String(last.occurred_on), String(last.created_at_text), String(last.journal_id)]) : null,
      totals: totals.map((t) => ({ currency: t.currency, amount_minor: Number(t.amount), count: t.n })),
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // Expenses (maker-checker)
  // ════════════════════════════════════════════════════════════════════════

  static readonly ExpenseInput = z.object({
    fund: z.string().trim().min(1).max(40),
    category: z.string().trim().min(1).max(40),
    payee: z.string().trim().min(2).max(120),
    description: optText(1, 500),
    amount_minor: z.number().int().min(1).max(MAX_MONEY_MINOR),
    currency,
    spent_on: ymd,
    channel: z.enum(OFFICE_CHANNELS),
    reference: optText(1, 80),
  });
  static readonly ExpensePatch = z
    .object({
      fund: z.string().trim().min(1).max(40).optional(),
      category: z.string().trim().min(1).max(40).optional(),
      payee: z.string().trim().min(2).max(120).optional(),
      description: patchText(1, 500),
      amount_minor: z.number().int().min(1).max(MAX_MONEY_MINOR).optional(),
      currency: currency.optional(),
      spent_on: ymd.optional(),
      channel: z.enum(OFFICE_CHANNELS).optional(),
      reference: patchText(1, 80),
    })
    .strict()
    .refine(nonEmpty, { message: "Nothing to change" });
  static readonly ExpenseQuery = z.object({
    status: commaList(EXPENSE_STATUSES),
    fund: z.string().trim().max(40).optional(),
    category: z.string().trim().max(40).optional(),
    from: ymd.optional(),
    to: ymd.optional(),
    q: z.string().trim().max(80).optional(),
    cursor: z.string().max(500).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  });

  private static readonly EXPENSE_SELECT = `
    SELECT e.expense_id, f.code AS fund_code, f.name AS fund_name, ec.category_id, ec.code AS category_code, ec.name AS category_name,
           e.payee, e.description, e.amount_minor::text AS amount_minor, e.currency, e.spent_on::text AS spent_on, e.channel, e.reference, e.status,
           e.recorded_by, ur.full_name AS recorded_by_name, e.recorded_at, e.recorded_at::text AS recorded_at_text,
           e.approved_by, ua.full_name AS approved_by_name, e.approved_at,
           e.voided_by, uv.full_name AS voided_by_name, e.voided_at, e.void_reason, e.journal_id, e.void_journal_id
      FROM expenses e
      JOIN funds f ON f.fund_id = e.fund_id
      JOIN expense_categories ec ON ec.category_id = e.category_id
      LEFT JOIN users ur ON ur.user_id = e.recorded_by
      LEFT JOIN users ua ON ua.user_id = e.approved_by
      LEFT JOIN users uv ON uv.user_id = e.voided_by`;

  private static expenseOut(r: Record<string, unknown>): Record<string, unknown> {
    return {
      expense_id: String(r.expense_id),
      fund: { code: String(r.fund_code), name: String(r.fund_name) },
      category: { category_id: String(r.category_id), code: String(r.category_code), name: String(r.category_name) },
      payee: String(r.payee),
      description: (r.description as string | null) ?? null,
      amount_minor: Number(r.amount_minor),
      currency: String(r.currency),
      spent_on: String(r.spent_on),
      channel: String(r.channel),
      reference: (r.reference as string | null) ?? null,
      status: String(r.status),
      recorded_by: (r.recorded_by as string | null) ?? null,
      recorded_by_name: (r.recorded_by_name as string | null) ?? null,
      recorded_at: isoReq(r.recorded_at),
      approved_by: (r.approved_by as string | null) ?? null,
      approved_by_name: (r.approved_by_name as string | null) ?? null,
      approved_at: iso(r.approved_at),
      voided_by: (r.voided_by as string | null) ?? null,
      voided_by_name: (r.voided_by_name as string | null) ?? null,
      voided_at: iso(r.voided_at),
      void_reason: (r.void_reason as string | null) ?? null,
      journal_id: (r.journal_id as string | null) ?? null,
      void_journal_id: (r.void_journal_id as string | null) ?? null,
    };
  }

  async getExpense(c: Queryable, id: string): Promise<Record<string, unknown>> {
    const r = await maybeOne<Record<string, unknown>>(c, `${FinanceBooks.EXPENSE_SELECT} WHERE e.expense_id = $1`, [id]);
    if (!r) throw new ApiError("NOT_FOUND", "Expense not found");
    return FinanceBooks.expenseOut(r);
  }

  private async activeFund(c: Queryable, code: string): Promise<{ fund_id: string; code: string }> {
    const f = await maybeOne<{ fund_id: string; code: string; is_active: boolean }>(c, `SELECT fund_id, code, is_active FROM funds WHERE code = $1`, [code]);
    if (!f || !f.is_active) throw new ApiError("UNPROCESSABLE", `Unknown or inactive fund: ${code}`);
    return f;
  }
  private async activeCategory(c: Queryable, code: string): Promise<{ category_id: string; code: string }> {
    const k = await maybeOne<{ category_id: string; code: string; is_active: boolean }>(c, `SELECT category_id, code, is_active FROM expense_categories WHERE code = $1`, [code]);
    if (!k || !k.is_active) throw new ApiError("UNPROCESSABLE", `Unknown or inactive expense category: ${code}`);
    return k;
  }

  async recordExpense(actorId: string, input: z.infer<typeof FinanceBooks.ExpenseInput>, now: Date = new Date()): Promise<Record<string, unknown>> {
    assertBooksDate("spent_on", input.spent_on, now);
    const id = await tx(this.pool, async (c) => {
      const fund = await this.activeFund(c, input.fund);
      const cat = await this.activeCategory(c, input.category);
      const e = await one<{ expense_id: string }>(
        c,
        `INSERT INTO expenses (fund_id, category_id, payee, description, amount_minor, currency, spent_on, channel, reference, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING expense_id`,
        [fund.fund_id, cat.category_id, input.payee, input.description, input.amount_minor, input.currency, input.spent_on, input.channel, input.reference, actorId],
      );
      await audit(c, actorId, "expense.recorded", "expenses", e.expense_id, {
        fund: fund.code, category: cat.code, payee: input.payee, amount_minor: input.amount_minor, currency: input.currency, spent_on: input.spent_on, channel: input.channel,
      });
      return e.expense_id;
    });
    return this.getExpense(this.pool, id);
  }

  async updateExpense(actorId: string, id: string, patch: z.infer<typeof FinanceBooks.ExpensePatch>, now: Date = new Date()): Promise<Record<string, unknown>> {
    if (patch.spent_on !== undefined) assertBooksDate("spent_on", patch.spent_on, now);
    await tx(this.pool, async (c) => {
      const e = await maybeOne<{ status: string }>(c, `SELECT status FROM expenses WHERE expense_id = $1 FOR UPDATE`, [id]);
      if (!e) throw new ApiError("NOT_FOUND", "Expense not found");
      if (e.status !== "recorded") throw new ApiError("UNPROCESSABLE", `An ${e.status === "approved" ? "approved" : "void"} expense cannot be edited — void it and record it again`);
      const sets: string[] = [];
      const params: unknown[] = [id];
      const changes: Record<string, unknown> = {};
      const put = (col: string, v: unknown, shown: unknown = v): void => {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
        changes[col] = shown;
      };
      if (patch.fund !== undefined) put("fund_id", (await this.activeFund(c, patch.fund)).fund_id, patch.fund);
      if (patch.category !== undefined) put("category_id", (await this.activeCategory(c, patch.category)).category_id, patch.category);
      for (const k of ["payee", "description", "amount_minor", "currency", "spent_on", "channel", "reference"] as const) {
        if (patch[k] !== undefined) put(k, patch[k]);
      }
      await c.query(`UPDATE expenses SET ${sets.join(", ")} WHERE expense_id = $1`, params);
      // The editor is one of the expense's makers — approveExpense reads this.
      await audit(c, actorId, "expense.updated", "expenses", id, { changes });
    });
    return this.getExpense(this.pool, id);
  }

  /** Maker-checker: nobody who recorded or edited an expense approves it
   *  (a SuperAdmin may approve their own). Approval posts the expense journal
   *  at spent_on 12:00 EAT. */
  async approveExpense(principal: Pick<Principal, "userId" | "role">, id: string): Promise<Record<string, unknown>> {
    await tx(this.pool, async (c) => {
      const e = await maybeOne<{ status: string; recorded_by: string | null; fund_code: string; amount_minor: string; currency: string; channel: OfficeChannel; spent_on: string; payee: string; description: string | null }>(
        c,
        `SELECT e.status, e.recorded_by, f.code AS fund_code, e.amount_minor::text, e.currency, e.channel, e.spent_on::text AS spent_on, e.payee, e.description
           FROM expenses e JOIN funds f ON f.fund_id = e.fund_id WHERE e.expense_id = $1 FOR UPDATE OF e`,
        [id],
      );
      if (!e) throw new ApiError("NOT_FOUND", "Expense not found");
      if (e.status !== "recorded") throw new ApiError("UNPROCESSABLE", `This expense is ${e.status === "approved" ? "approved already" : "void"}`);
      if (principal.role !== "SuperAdmin") {
        const makers = await many<{ actor_id: string }>(
          c,
          `SELECT DISTINCT actor_id::text AS actor_id FROM audit_log
            WHERE entity = 'expenses' AND entity_id = $1 AND action IN ('expense.recorded', 'expense.updated') AND actor_id IS NOT NULL`,
          [id],
        );
        const made = new Set([...(e.recorded_by ? [e.recorded_by] : []), ...makers.map((m) => m.actor_id)]);
        if (made.has(principal.userId)) {
          throw new ApiError("SAME_PERSON", "You recorded or edited this expense, so someone else must approve it");
        }
      }
      const amount = Number(e.amount_minor);
      const j = await one<{ journal_id: string }>(
        c,
        `INSERT INTO journals (kind, memo, occurred_on, ref_id, created_by) VALUES ('expense', $1, $2, $3, $4) RETURNING journal_id`,
        [e.description ? `${e.payee} — ${e.description}` : e.payee, e.spent_on, id, principal.userId],
      );
      const at = await one<{ at: string }>(c, `SELECT (${noonEat("$1")})::text AS at`, [e.spent_on]);
      await postLegs(c, { journal_id: j.journal_id }, [
        { account: `fund:${e.fund_code}`, side: "debit", amount_minor: amount, currency: e.currency },
        { account: cashAccount(e.channel), side: "credit", amount_minor: amount, currency: e.currency },
      ], at.at);
      await c.query(`UPDATE expenses SET status = 'approved', approved_by = $2, approved_at = now(), journal_id = $3 WHERE expense_id = $1`, [id, principal.userId, j.journal_id]);
      await audit(c, principal.userId, "expense.approved", "expenses", id, { journal_id: j.journal_id, amount_minor: amount, currency: e.currency, fund: e.fund_code });
    });
    return this.getExpense(this.pool, id);
  }

  /** Void: a recorded expense simply stops; an approved one also gets the
   *  mirror of its approval journal (same timestamp, so its month nets to 0). */
  async voidExpense(actorId: string, id: string, reason: string): Promise<Record<string, unknown>> {
    await tx(this.pool, async (c) => {
      const e = await maybeOne<{ status: string; journal_id: string | null; spent_on: string }>(
        c, `SELECT status, journal_id, spent_on::text AS spent_on FROM expenses WHERE expense_id = $1 FOR UPDATE`, [id],
      );
      if (!e) throw new ApiError("NOT_FOUND", "Expense not found");
      if (e.status === "void") throw new ApiError("UNPROCESSABLE", "This expense is void already");
      let voidJournal: string | null = null;
      if (e.status === "approved") {
        if (!e.journal_id) throw new ApiError("NOT_REVERSIBLE", "This approved expense has no posting to undo — reconcile it first");
        const legs = await storedLegs(c, "journal_id", e.journal_id);
        if (!simplePair(legs)) throw new ApiError("NOT_REVERSIBLE", "Its ledger postings are not one balanced debit/credit pair — reconcile it before voiding");
        const j = await one<{ journal_id: string }>(
          c,
          `INSERT INTO journals (kind, memo, occurred_on, ref_id, created_by) VALUES ('expense_void', $1, $2, $3, $4) RETURNING journal_id`,
          [reason, e.spent_on, id, actorId],
        );
        await postLegs(c, { journal_id: j.journal_id }, mirror(legs), legs[0].at_text);
        voidJournal = j.journal_id;
      }
      await c.query(
        `UPDATE expenses SET status = 'void', voided_by = $2, voided_at = now(), void_reason = $3, void_journal_id = $4 WHERE expense_id = $1`,
        [id, actorId, reason, voidJournal],
      );
      await audit(c, actorId, "expense.voided", "expenses", id, { was: e.status, reason, void_journal_id: voidJournal });
    });
    return this.getExpense(this.pool, id);
  }

  private expenseFilters(q: Omit<z.infer<typeof FinanceBooks.ExpenseQuery>, "cursor" | "limit">): { where: string[]; params: unknown[] } {
    const params: unknown[] = [];
    const where: string[] = ["TRUE"];
    if (q.status.length) { params.push(q.status); where.push(`e.status = ANY($${params.length}::text[])`); }
    if (q.fund) { params.push(q.fund); where.push(`f.code = $${params.length}`); }
    if (q.category) { params.push(q.category); where.push(`ec.code = $${params.length}`); }
    if (q.from) { params.push(q.from); where.push(`e.spent_on >= $${params.length}::date`); }
    if (q.to) { params.push(q.to); where.push(`e.spent_on <= $${params.length}::date`); }
    if (q.q) {
      params.push(`%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
      where.push(`(e.payee ILIKE $${params.length} OR e.description ILIKE $${params.length} OR e.reference ILIKE $${params.length})`);
    }
    return { where, params };
  }

  async listExpenses(q: z.infer<typeof FinanceBooks.ExpenseQuery>): Promise<Record<string, unknown>> {
    const { where, params } = this.expenseFilters(q);
    const totalsRows = await many<{ status: string; currency: string; amount: string; n: number }>(
      this.pool,
      `SELECT e.status, e.currency, sum(e.amount_minor)::text AS amount, count(*)::int AS n
         FROM expenses e JOIN funds f ON f.fund_id = e.fund_id JOIN expense_categories ec ON ec.category_id = e.category_id
        WHERE ${where.join(" AND ")} GROUP BY e.status, e.currency ORDER BY e.currency, e.status`,
      params,
    );
    const pageWhere = [...where];
    const pageParams = [...params];
    if (q.cursor) {
      const [d, at, eid] = decodeCursor(q.cursor, 3) as [string, string, string];
      pageParams.push(d, at, eid);
      pageWhere.push(`(e.spent_on, e.recorded_at, e.expense_id) < ($${pageParams.length - 2}::date, $${pageParams.length - 1}::timestamptz, $${pageParams.length}::uuid)`);
    }
    pageParams.push(q.limit + 1);
    const rows = await many<Record<string, unknown>>(
      this.pool,
      `${FinanceBooks.EXPENSE_SELECT} WHERE ${pageWhere.join(" AND ")}
        ORDER BY e.spent_on DESC, e.recorded_at DESC, e.expense_id DESC LIMIT $${pageParams.length}`,
      pageParams,
    );
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    const byCur = new Map<string, { amount: number; n: number }>();
    for (const t of totalsRows) {
      const cur = byCur.get(t.currency) ?? { amount: 0, n: 0 };
      cur.amount += Number(t.amount);
      cur.n += t.n;
      byCur.set(t.currency, cur);
    }
    return {
      data: page.map(FinanceBooks.expenseOut),
      next_cursor: rows.length > q.limit && last ? encodeCursor([String(last.spent_on), String(last.recorded_at_text), String(last.expense_id)]) : null,
      totals: [...byCur.entries()].map(([cur, v]) => ({ currency: cur, amount_minor: v.amount, count: v.n })),
      totals_by_status: totalsRows.map((t) => ({ status: t.status, currency: t.currency, amount_minor: Number(t.amount), count: t.n })),
    };
  }

  /** The CSV twin: same filters, every row, fixed column order. */
  async expensesCsvRows(q: Omit<z.infer<typeof FinanceBooks.ExpenseQuery>, "cursor" | "limit">): Promise<{ header: string[]; rows: CsvCell[][] }> {
    const { where, params } = this.expenseFilters(q);
    const rows = await many<Record<string, unknown>>(
      this.pool,
      `${FinanceBooks.EXPENSE_SELECT} WHERE ${where.join(" AND ")} ORDER BY e.spent_on DESC, e.recorded_at DESC, e.expense_id DESC`,
      params,
    );
    const header = ["expense_id", "spent_on", "payee", "category", "fund", "description", "amount", "currency", "channel", "reference", "status", "recorded_by", "recorded_at", "approved_by", "approved_at", "voided_by", "voided_at", "void_reason"];
    return {
      header,
      rows: rows.map((r) => [
        String(r.expense_id), String(r.spent_on), String(r.payee), String(r.category_name), String(r.fund_name),
        (r.description as string | null) ?? null, minorToMajor(String(r.amount_minor)), String(r.currency), String(r.channel),
        (r.reference as string | null) ?? null, String(r.status),
        (r.recorded_by_name as string | null) ?? null, iso(r.recorded_at),
        (r.approved_by_name as string | null) ?? null, iso(r.approved_at),
        (r.voided_by_name as string | null) ?? null, iso(r.voided_at), (r.void_reason as string | null) ?? null,
      ]),
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // Expense categories
  // ════════════════════════════════════════════════════════════════════════

  static readonly CategoryInput = z.object({
    code: z.string().regex(CODE_SLUG, "lower-case letters, digits and dashes, starting with a letter (2–40)"),
    name: z.string().trim().min(2).max(60),
    sort: z.number().int().min(-1_000_000).max(1_000_000).nullish().transform((v) => v ?? 0),
    is_active: z.boolean().nullish().transform((v) => v ?? true),
  });
  static readonly CategoryPatch = z
    .object({
      name: z.string().trim().min(2).max(60).optional(),
      sort: z.number().int().min(-1_000_000).max(1_000_000).optional(),
      is_active: z.boolean().optional(),
    })
    .strict()
    .refine(nonEmpty, { message: "Nothing to change" });

  private static readonly CATEGORY_COLS = `category_id, code, name, is_active, sort`;
  private static categoryOut(r: Record<string, unknown>): Record<string, unknown> {
    return { category_id: String(r.category_id), code: String(r.code), name: String(r.name), is_active: Boolean(r.is_active), sort: Number(r.sort ?? 0) };
  }

  async listCategories(): Promise<Record<string, unknown>[]> {
    const rows = await many<Record<string, unknown>>(this.pool, `SELECT ${FinanceBooks.CATEGORY_COLS} FROM expense_categories ORDER BY sort, name`);
    return rows.map(FinanceBooks.categoryOut);
  }

  async createCategory(actorId: string, input: z.infer<typeof FinanceBooks.CategoryInput>): Promise<Record<string, unknown>> {
    try {
      return await tx(this.pool, async (c) => {
        const r = await one<Record<string, unknown>>(
          c,
          `INSERT INTO expense_categories (code, name, sort, is_active) VALUES ($1, $2, $3, $4) RETURNING ${FinanceBooks.CATEGORY_COLS}`,
          [input.code, input.name, input.sort, input.is_active],
        );
        await audit(c, actorId, "finance.category_created", "expense_categories", String(r.category_id), { code: input.code, name: input.name });
        return FinanceBooks.categoryOut(r);
      });
    } catch (err) {
      if (uniqueViolation(err) !== null) throw new ApiError("CONFLICT", `A category with the code "${input.code}" already exists`);
      throw err;
    }
  }

  async updateCategory(actorId: string, id: string, patch: z.infer<typeof FinanceBooks.CategoryPatch>): Promise<Record<string, unknown>> {
    return tx(this.pool, async (c) => {
      const before = await maybeOne<Record<string, unknown>>(c, `SELECT ${FinanceBooks.CATEGORY_COLS} FROM expense_categories WHERE category_id = $1 FOR UPDATE`, [id]);
      if (!before) throw new ApiError("NOT_FOUND", "Expense category not found");
      const sets: string[] = [];
      const params: unknown[] = [id];
      const changes: Record<string, unknown> = {};
      for (const k of ["name", "sort", "is_active"] as const) {
        const v = patch[k];
        if (v === undefined) continue;
        params.push(v);
        sets.push(`${k} = $${params.length}`);
        changes[k] = { from: before[k] ?? null, to: v };
      }
      const r = await one<Record<string, unknown>>(c, `UPDATE expense_categories SET ${sets.join(", ")} WHERE category_id = $1 RETURNING ${FinanceBooks.CATEGORY_COLS}`, params);
      await audit(c, actorId, "finance.category_updated", "expense_categories", id, { code: before.code, changes });
      return FinanceBooks.categoryOut(r);
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // Budgets (KES)
  // ════════════════════════════════════════════════════════════════════════

  static readonly BudgetInput = z.object({ year: z.number().int().min(2020).max(2100), name: z.string().trim().min(2).max(80) });
  static readonly BudgetPatch = z
    .object({ year: z.number().int().min(2020).max(2100).optional(), name: z.string().trim().min(2).max(80).optional() })
    .strict()
    .refine(nonEmpty, { message: "Nothing to change" });
  static readonly BudgetLinesInput = z.object({
    lines: z
      .array(
        z.object({
          kind: z.enum(["income", "expense"]),
          fund: z.string().trim().min(1).max(40).nullish().transform((v) => v ?? null),
          category: z.string().trim().min(1).max(40).nullish().transform((v) => v ?? null),
          label: z.string().trim().min(2).max(80),
          monthly_minor: z.array(z.number().int().min(0).max(MAX_BUDGET_MONTH_MINOR)).length(12),
        }),
      )
      .max(200),
  });

  private static readonly BUDGET_SELECT = `
    SELECT b.budget_id, b.year, b.name, b.status, b.created_by, uc.full_name AS created_by_name, b.created_at,
           b.approved_by, ua.full_name AS approved_by_name, b.approved_at,
           (SELECT count(*)::int FROM budget_lines l WHERE l.budget_id = b.budget_id) AS line_count,
           (SELECT COALESCE(sum(x), 0)::text FROM budget_lines l, unnest(l.monthly_minor) x WHERE l.budget_id = b.budget_id AND l.kind = 'income') AS income_total,
           (SELECT COALESCE(sum(x), 0)::text FROM budget_lines l, unnest(l.monthly_minor) x WHERE l.budget_id = b.budget_id AND l.kind = 'expense') AS expense_total
      FROM budgets b
      LEFT JOIN users uc ON uc.user_id = b.created_by
      LEFT JOIN users ua ON ua.user_id = b.approved_by`;

  private static budgetOut(r: Record<string, unknown>): Record<string, unknown> {
    return {
      budget_id: String(r.budget_id), year: Number(r.year), name: String(r.name), status: String(r.status), currency: "KES",
      created_by: (r.created_by as string | null) ?? null, created_by_name: (r.created_by_name as string | null) ?? null, created_at: isoReq(r.created_at),
      approved_by: (r.approved_by as string | null) ?? null, approved_by_name: (r.approved_by_name as string | null) ?? null, approved_at: iso(r.approved_at),
      line_count: Number(r.line_count ?? 0), income_total_minor: Number(r.income_total ?? 0), expense_total_minor: Number(r.expense_total ?? 0),
    };
  }

  async listBudgets(): Promise<Record<string, unknown>[]> {
    const rows = await many<Record<string, unknown>>(this.pool, `${FinanceBooks.BUDGET_SELECT} ORDER BY b.year DESC`);
    return rows.map(FinanceBooks.budgetOut);
  }

  private async budgetLines(c: Queryable, budgetId: string): Promise<Array<Record<string, unknown> & { line_id: string; kind: "income" | "expense"; monthly_minor: number[]; fund_id: string | null; category_id: string | null }>> {
    const rows = await many<Record<string, unknown>>(
      c,
      `SELECT l.line_id, l.kind, l.label, l.monthly_minor::text[] AS monthly, l.fund_id, f.code AS fund_code, f.name AS fund_name,
              l.category_id, ec.code AS category_code, ec.name AS category_name
         FROM budget_lines l
         LEFT JOIN funds f ON f.fund_id = l.fund_id
         LEFT JOIN expense_categories ec ON ec.category_id = l.category_id
        WHERE l.budget_id = $1
        ORDER BY (l.kind = 'expense'), l.position, l.line_id`,
      [budgetId],
    );
    return rows.map((r) => {
      const monthly = (r.monthly as string[]).map(Number);
      return {
        line_id: String(r.line_id),
        kind: r.kind as "income" | "expense",
        fund: r.fund_code ? { code: String(r.fund_code), name: String(r.fund_name) } : null,
        category: r.category_id ? { category_id: String(r.category_id), code: String(r.category_code), name: String(r.category_name) } : null,
        label: String(r.label),
        monthly_minor: monthly,
        total_minor: monthly.reduce((a, b) => a + b, 0),
        fund_id: (r.fund_id as string | null) ?? null,
        category_id: (r.category_id as string | null) ?? null,
      };
    });
  }

  async getBudget(c: Queryable, id: string): Promise<Record<string, unknown>> {
    const b = await maybeOne<Record<string, unknown>>(c, `${FinanceBooks.BUDGET_SELECT} WHERE b.budget_id = $1`, [id]);
    if (!b) throw new ApiError("NOT_FOUND", "Budget not found");
    const lines = (await this.budgetLines(c, id)).map(({ fund_id: _f, category_id: _c, ...wire }) => wire);
    return { ...FinanceBooks.budgetOut(b), lines };
  }

  async createBudget(actorId: string, input: z.infer<typeof FinanceBooks.BudgetInput>): Promise<Record<string, unknown>> {
    try {
      const id = await tx(this.pool, async (c) => {
        const b = await one<{ budget_id: string }>(c, `INSERT INTO budgets (year, name, created_by) VALUES ($1, $2, $3) RETURNING budget_id`, [input.year, input.name, actorId]);
        await audit(c, actorId, "budget.created", "budgets", b.budget_id, { year: input.year, name: input.name });
        return b.budget_id;
      });
      return this.getBudget(this.pool, id);
    } catch (err) {
      if (uniqueViolation(err) !== null) throw new ApiError("CONFLICT", `${input.year} already has a budget`);
      throw err;
    }
  }

  private async lockDraft(c: Queryable, id: string): Promise<{ year: number; name: string }> {
    const b = await maybeOne<{ status: string; year: number; name: string }>(c, `SELECT status, year, name FROM budgets WHERE budget_id = $1 FOR UPDATE`, [id]);
    if (!b) throw new ApiError("NOT_FOUND", "Budget not found");
    if (b.status !== "draft") throw new ApiError("UNPROCESSABLE", "This budget is approved — it can no longer change");
    return b;
  }

  async updateBudget(actorId: string, id: string, patch: z.infer<typeof FinanceBooks.BudgetPatch>): Promise<Record<string, unknown>> {
    try {
      await tx(this.pool, async (c) => {
        const before = await this.lockDraft(c, id);
        const sets: string[] = [];
        const params: unknown[] = [id];
        const changes: Record<string, unknown> = {};
        for (const k of ["year", "name"] as const) {
          const v = patch[k];
          if (v === undefined) continue;
          params.push(v);
          sets.push(`${k} = $${params.length}`);
          changes[k] = { from: before[k], to: v };
        }
        await c.query(`UPDATE budgets SET ${sets.join(", ")} WHERE budget_id = $1`, params);
        await audit(c, actorId, "budget.updated", "budgets", id, { changes });
      });
    } catch (err) {
      if (uniqueViolation(err) !== null) throw new ApiError("CONFLICT", `${patch.year ?? "That year"} already has a budget`);
      throw err;
    }
    return this.getBudget(this.pool, id);
  }

  /** Replace all of a draft's lines. No overlaps, so no shilling is counted
   *  twice in the totals: one income line per fund; per expense category
   *  either one church-wide line (no fund) or lines for distinct funds. */
  async replaceBudgetLines(actorId: string, id: string, input: z.infer<typeof FinanceBooks.BudgetLinesInput>): Promise<Record<string, unknown>> {
    const problems: Array<{ path: string; message: string }> = [];
    const seenIncome = new Set<string>();
    const expenseFunds = new Map<string, Set<string>>(); // category → funds ('' = church-wide)
    input.lines.forEach((l, i) => {
      if (l.kind === "income") {
        if (!l.fund) problems.push({ path: `lines.${i}.fund`, message: "an income line needs a fund" });
        if (l.category) problems.push({ path: `lines.${i}.category`, message: "an income line has no category" });
        if (l.fund) {
          if (seenIncome.has(l.fund)) problems.push({ path: `lines.${i}.fund`, message: `a second income line for ${l.fund}` });
          seenIncome.add(l.fund);
        }
      } else {
        if (!l.category) {
          problems.push({ path: `lines.${i}.category`, message: "an expense line needs a category" });
          return;
        }
        const funds = expenseFunds.get(l.category) ?? new Set<string>();
        const key = l.fund ?? "";
        if (funds.has(key) || (key === "" && funds.size > 0) || (key !== "" && funds.has(""))) {
          problems.push({ path: `lines.${i}`, message: `${l.category} is budgeted twice (church-wide and per fund, or the same fund twice)` });
        }
        funds.add(key);
        expenseFunds.set(l.category, funds);
      }
    });
    if (problems.length) throw new ApiError("VALIDATION_FAILED", "Some budget lines are not valid", { fields: problems });

    await tx(this.pool, async (c) => {
      await this.lockDraft(c, id);
      const fundCodes = [...new Set(input.lines.flatMap((l) => (l.fund ? [l.fund] : [])))];
      const catCodes = [...new Set(input.lines.flatMap((l) => (l.category ? [l.category] : [])))];
      const funds = new Map((await many<{ code: string; fund_id: string }>(c, `SELECT code, fund_id FROM funds WHERE code = ANY($1::text[])`, [fundCodes])).map((f) => [f.code, f.fund_id]));
      const cats = new Map((await many<{ code: string; category_id: string }>(c, `SELECT code, category_id FROM expense_categories WHERE code = ANY($1::text[])`, [catCodes])).map((k) => [k.code, k.category_id]));
      const unknown = [...fundCodes.filter((f) => !funds.has(f)).map((f) => `fund ${f}`), ...catCodes.filter((k) => !cats.has(k)).map((k) => `category ${k}`)];
      if (unknown.length) throw new ApiError("UNPROCESSABLE", `Unknown ${unknown.join(", ")}`);
      await c.query(`DELETE FROM budget_lines WHERE budget_id = $1`, [id]);
      let position = 0;
      for (const l of input.lines) {
        await c.query(
          `INSERT INTO budget_lines (budget_id, kind, fund_id, category_id, label, position, monthly_minor) VALUES ($1, $2, $3, $4, $5, $6, $7::bigint[])`,
          [id, l.kind, l.fund ? funds.get(l.fund) : null, l.category ? cats.get(l.category) : null, l.label, position++, l.monthly_minor],
        );
      }
      await audit(c, actorId, "budget.lines_replaced", "budgets", id, {
        lines: input.lines.length,
        income_total_minor: input.lines.filter((l) => l.kind === "income").reduce((a, l) => a + l.monthly_minor.reduce((x, y) => x + y, 0), 0),
        expense_total_minor: input.lines.filter((l) => l.kind === "expense").reduce((a, l) => a + l.monthly_minor.reduce((x, y) => x + y, 0), 0),
      });
    });
    return this.getBudget(this.pool, id);
  }

  async approveBudget(actorId: string, id: string): Promise<Record<string, unknown>> {
    await tx(this.pool, async (c) => {
      const b = await this.lockDraft(c, id);
      const n = await one<{ n: number }>(c, `SELECT count(*)::int AS n FROM budget_lines WHERE budget_id = $1`, [id]);
      if (n.n === 0) throw new ApiError("UNPROCESSABLE", "Add at least one line before approving the budget");
      await c.query(`UPDATE budgets SET status = 'approved', approved_by = $2, approved_at = now() WHERE budget_id = $1`, [id, actorId]);
      await audit(c, actorId, "budget.approved", "budgets", id, { year: b.year, lines: n.n });
    });
    return this.getBudget(this.pool, id);
  }

  /** Budget vs actual (KES). Income actual: succeeded KES gifts to the line's
   *  fund by the Nairobi month of the gift. Expense actual: APPROVED KES
   *  expenses in the line's category (and fund, when it names one) by
   *  spent_on month. `unbudgeted` = that kind's actual money no line covers. */
  async budgetActuals(id: string): Promise<Record<string, unknown>> {
    const b = await maybeOne<Record<string, unknown>>(this.pool, `${FinanceBooks.BUDGET_SELECT} WHERE b.budget_id = $1`, [id]);
    if (!b) throw new ApiError("NOT_FOUND", "Budget not found");
    const year = Number(b.year);
    const lines = await this.budgetLines(this.pool, id);
    const income = await many<{ fund_id: string; m: number; total: string }>(
      this.pool,
      `SELECT t.fund_id, extract(month from t.created_at AT TIME ZONE '${EAT}')::int AS m, sum(t.amount_minor)::text AS total
         FROM transactions t
        WHERE t.status = 'succeeded' AND t.currency = 'KES' AND t.fund_id IS NOT NULL
          AND t.created_at >= (make_date($1, 1, 1)::timestamp AT TIME ZONE '${EAT}')
          AND t.created_at <  (make_date($1 + 1, 1, 1)::timestamp AT TIME ZONE '${EAT}')
        GROUP BY t.fund_id, m`,
      [year],
    );
    const spend = await many<{ category_id: string; fund_id: string; m: number; total: string }>(
      this.pool,
      `SELECT e.category_id, e.fund_id, extract(month from e.spent_on)::int AS m, sum(e.amount_minor)::text AS total
         FROM expenses e
        WHERE e.status = 'approved' AND e.currency = 'KES'
          AND e.spent_on >= make_date($1, 1, 1) AND e.spent_on < make_date($1 + 1, 1, 1)
        GROUP BY e.category_id, e.fund_id, m`,
      [year],
    );
    const zero = (): number[] => Array.from({ length: 12 }, () => 0);
    const add = (arr: number[], i: number, v: number): void => { arr[i] = (arr[i] ?? 0) + v; };
    const row = (budget: number[], actual: number[]): Record<string, unknown> => {
      const variance = actual.map((a, i) => a - (budget[i] ?? 0));
      const sum = (xs: number[]): number => xs.reduce((a, b2) => a + b2, 0);
      return {
        budget_minor: budget, actual_minor: actual, variance_minor: variance,
        budget_total_minor: sum(budget), actual_total_minor: sum(actual), variance_total_minor: sum(variance),
      };
    };
    const outLines: Record<string, unknown>[] = [];
    const kindTotals = { income: { budget: zero(), actual: zero() }, expense: { budget: zero(), actual: zero() } };
    const covered = { income: zero(), expense: zero() };
    for (const l of lines) {
      const actual = zero();
      if (l.kind === "income") {
        for (const r of income) if (r.fund_id === l.fund_id) add(actual, r.m - 1, Number(r.total));
      } else {
        for (const r of spend) if (r.category_id === l.category_id && (l.fund_id === null || r.fund_id === l.fund_id)) add(actual, r.m - 1, Number(r.total));
      }
      l.monthly_minor.forEach((v, i) => add(kindTotals[l.kind].budget, i, v));
      actual.forEach((v, i) => { add(kindTotals[l.kind].actual, i, v); add(covered[l.kind], i, v); });
      outLines.push({ line_id: l.line_id, kind: l.kind, label: l.label, fund: l.fund, category: l.category, ...row(l.monthly_minor, actual) });
    }
    const allIncome = zero();
    for (const r of income) add(allIncome, r.m - 1, Number(r.total));
    const allSpend = zero();
    for (const r of spend) add(allSpend, r.m - 1, Number(r.total));
    const totals = (["income", "expense"] as const).map((kind) => {
      const all = kind === "income" ? allIncome : allSpend;
      const unbudgeted = all.map((v, i) => v - (covered[kind][i] ?? 0));
      return { kind, ...row(kindTotals[kind].budget, kindTotals[kind].actual), unbudgeted_minor: unbudgeted, unbudgeted_total_minor: unbudgeted.reduce((a, v) => a + v, 0) };
    });
    return {
      budget: FinanceBooks.budgetOut(b),
      year,
      currency: "KES",
      months: Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`),
      lines: outLines,
      totals,
    };
  }
}
