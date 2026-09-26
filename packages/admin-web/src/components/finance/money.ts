// Finance money helpers (docs/FINANCE_ERP.md: "integer minor units + ISO
// currency, never floats … multi-currency totals are always per currency — KES
// and USD are never added"). Every conversion here is exact BigInt / integer
// arithmetic; nothing divides by 100 in floating point.
import type { CurrencyTotal } from "../../api/finance";

/**
 * Every currency on this platform is kept in hundredths. The server's CSV
 * exporter (backend financial/csv.ts minorToMajor) uses the same two decimals
 * for every currency, so a figure on screen and the same figure in the
 * spreadsheet always agree.
 */
export const MINOR_DIGITS = 2;
/** The largest single amount an office form accepts (the books' bound):
 *  1,000,000,000 minor = 10,000,000.00. */
export const MAX_AMOUNT_MINOR = 1_000_000_000;
/** The church's home currency — listed first wherever currencies are listed. */
export const HOME_CURRENCY = "KES";

/** A minor-unit amount as the wire may carry it: a number, a BIGINT serialised
 *  as text (e.g. claims' amount_minor), or a bigint. */
export type MinorInput = number | bigint | string;

/** A single amount with its currency. */
export interface Money {
  amount_minor: number;
  currency: string;
}

const INTEGER_TEXT = /^[-+]?\d+$/;

/** Parse any MinorInput to a bigint; null when it is not a whole number. A
 *  non-integer number (only ever a computed display value, e.g. an average) is
 *  rounded to the nearest minor unit. */
export function toMinorBigInt(v: MinorInput | null | undefined): bigint | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return Number.isFinite(v) ? BigInt(Math.round(v)) : null;
  const s = v.trim();
  return INTEGER_TEXT.test(s) ? BigInt(s) : null;
}

const group3 = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * 123450, "KES" → "KES 1,234.50"; 1200, "usd" → "USD 12.00"; -5000 → "-KES 50.00".
 * Exact for any size (BigInt). `withCode: false` drops the currency code
 * ("1,234.50") for a column whose header already says it. Unparseable → "—".
 */
export function formatMinor(
  amount_minor: MinorInput | null | undefined,
  currency: string | null | undefined,
  opts: { withCode?: boolean | undefined } = {},
): string {
  const n = toMinorBigInt(amount_minor);
  if (n === null) return "—";
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const whole = abs / 100n;
  const cents = (abs % 100n).toString().padStart(MINOR_DIGITS, "0");
  const number = `${group3(whole.toString())}.${cents}`;
  const code = (currency ?? "").trim().toUpperCase();
  const body = code && opts.withCode !== false ? `${code} ${number}` : number;
  return negative ? `-${body}` : body;
}

/** 123450 → "1234.50" — the plain major-unit text an input field is seeded with
 *  (no grouping, no code). Exact. */
export function minorToMajorInput(amount_minor: MinorInput | null | undefined): string {
  const n = toMinorBigInt(amount_minor);
  if (n === null) return "";
  const negative = n < 0n;
  const abs = negative ? -n : n;
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(MINOR_DIGITS, "0")}`;
}

export type ParsedAmount = { ok: true; minor: number } | { ok: false; error: string };

// "1234", "1,234", "1,234.5", "1234.50", ".5", "12." — commas only as thousands
// separators in the right places, a full stop for decimals, at most 2 decimals.
const AMOUNT_TEXT = /^\+?(?:(\d{1,3}(?:,\d{3})+)|(\d*))(?:\.(\d*))?$/;
// "12,50" — a decimal comma; read literally it would be 1,250.00 (100× the intent).
const DECIMAL_COMMA = /^\d+,\d{1,2}$/;

/**
 * What the person typed → integer minor units, or the reason it can't be used.
 * Rules (the books' own bounds): a plain positive number, at most 2 decimal
 * places, more than zero, at most `max` minor (default 1,000,000,000). Nothing
 * is guessed: "12,50" is refused rather than read as 1,250.00.
 */
export function parseMajorToMinor(input: string, opts: { max?: number | undefined } = {}): ParsedAmount {
  const s = input.trim();
  if (s === "") return { ok: false, error: "Enter an amount." };
  if (s.startsWith("-")) return { ok: false, error: "The amount must be more than zero." };
  if (DECIMAL_COMMA.test(s)) return { ok: false, error: "Use a full stop for decimals — 12.50, not 12,50." };
  const m = AMOUNT_TEXT.exec(s);
  const whole = m ? (m[1] ?? m[2] ?? "").replace(/,/g, "") : "";
  const frac = m ? (m[3] ?? "") : "";
  if (!m || (whole === "" && frac === "")) return { ok: false, error: "Enter a number, like 1500 or 1,500.50." };
  if (frac.length > MINOR_DIGITS) return { ok: false, error: "Use at most 2 decimal places." };
  const minor = BigInt(whole || "0") * 100n + BigInt(frac.padEnd(MINOR_DIGITS, "0"));
  if (minor <= 0n) return { ok: false, error: "The amount must be more than zero." };
  const max = BigInt(opts.max ?? MAX_AMOUNT_MINOR);
  if (minor > max) return { ok: false, error: `That is more than the ${formatMinor(max, null)} limit for one entry.` };
  return { ok: true, minor: Number(minor) };
}

/* ---------- per-currency totals ---------- */

/** KES first, then A→Z — the order every per-currency list uses. */
export function compareCurrencies(a: string, b: string): number {
  if (a === b) return 0;
  if (a === HOME_CURRENCY) return -1;
  if (b === HOME_CURRENCY) return 1;
  return a < b ? -1 : 1;
}

/** Same-currency addition. Throws rather than add KES to USD. */
export function addMoney(a: Money, b: Money): Money {
  if (a.currency.toUpperCase() !== b.currency.toUpperCase()) {
    throw new Error(`Cannot add ${a.currency} to ${b.currency} — totals are kept per currency.`);
  }
  return { amount_minor: a.amount_minor + b.amount_minor, currency: a.currency.toUpperCase() };
}

/** Group amounts per currency — integer sums and counts — KES first. For totals
 *  the client builds itself (a drawer's legs, a form's lines); a register's
 *  totals come from the server, which sees the whole filtered set. */
export function totalsByCurrency(rows: readonly { amount_minor: number; currency: string }[]): CurrencyTotal[] {
  const by = new Map<string, { amount: bigint; count: number }>();
  for (const r of rows) {
    const code = r.currency.trim().toUpperCase();
    const cur = by.get(code) ?? { amount: 0n, count: 0 };
    cur.amount += toMinorBigInt(r.amount_minor) ?? 0n;
    cur.count += 1;
    by.set(code, cur);
  }
  return [...by.entries()]
    .sort(([a], [b]) => compareCurrencies(a, b))
    .map(([currency, t]) => ({ currency, amount_minor: Number(t.amount), count: t.count }));
}

/** The same list, KES first then A→Z (the server already orders most lists so). */
export function sortTotals<T extends { currency: string }>(totals: readonly T[]): T[] {
  return [...totals].sort((a, b) => compareCurrencies(a.currency, b.currency));
}

/** One currency's entry, or null. */
export function totalFor<T extends { currency: string }>(totals: readonly T[], currency: string): T | null {
  const code = currency.toUpperCase();
  return totals.find((t) => t.currency.toUpperCase() === code) ?? null;
}

/** "KES 1,234.50 · USD 12.00" — `empty` when there is nothing. */
export function formatTotals(totals: readonly { amount_minor: number; currency: string }[], empty = "—"): string {
  if (totals.length === 0) return empty;
  return sortTotals(totals)
    .map((t) => formatMinor(t.amount_minor, t.currency))
    .join(" · ");
}
