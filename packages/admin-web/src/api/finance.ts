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
import { api } from "./client";

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

/** Common list paging (Cursor + Limit parameters: limit ≤ 200, default 50). */
export interface PageQuery {
  cursor?: string | null | undefined;
  limit?: number | undefined;
}
/** Common period filter — inclusive EAT days. */
export interface PeriodQuery {
  from?: IsoDate | null | undefined;
  to?: IsoDate | null | undefined;
}

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

export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

/** Drop null / undefined / "" so the URL carries only what was chosen and the
 *  server's own defaults apply to the rest. Words like "all" / "any" are kept:
 *  on some filters they are real values (needs ?status=all, ?pledged=any). */
export function cleanParams(params: QueryParams | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!params) return out;
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = typeof v === "string" ? v.trim() : v;
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
