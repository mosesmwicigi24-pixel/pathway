// API envelope + error taxonomy — §3.1 conventions and §3.2 error catalog.

export interface ErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    request_id: string;
    details?: Record<string, unknown>;
  };
}

// §3.2 error catalog (code → typical HTTP status).
export const API_ERROR_CODES = {
  VALIDATION_FAILED: 400,
  AUTH_REQUIRED: 401,
  TOKEN_EXPIRED: 401,
  FORBIDDEN_SCOPE: 403,
  CONSENT_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VERSION_STALE: 409,
  GATE_LOCKED: 409,
  CONTENT_INCOMPLETE: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  UPSTREAM_UNAVAILABLE: 503,
  // Finance books (docs/FINANCE_ERP.md §2, §4) — named so a client can tell
  // the office exactly what to do, not just that something failed.
  /** That M-Pesa code is already on a succeeded transaction (online or office). */
  DUPLICATE_RECEIPT: 409,
  /** The payment reference is not in the shape its channel requires (e.g. an M-Pesa code). */
  INVALID_REFERENCE: 422,
  /** A money date outside the books' window: after today, or more than 366 days ago (EAT). */
  INVALID_DATE: 422,
  /** A gift's currency differs from the pledge's or need's currency it counts toward. */
  CURRENCY_MISMATCH: 422,
  /** Only an office gift / manual claim that succeeded can be reversed here. */
  NOT_REVERSIBLE: 422,
  /** The transaction was reversed already — reversing twice is refused. */
  ALREADY_REVERSED: 422,
  /** An expense journal is undone by voiding its expense, not by reversing the journal. */
  USE_EXPENSE_VOID: 422,
  /** Maker-checker: the person who recorded or edited an expense cannot approve it. */
  SAME_PERSON: 403,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_CODES;

// Cursor-paginated list envelope (§3.1 — no offset pagination on large tables).
export interface Paginated<T> {
  data: T[];
  next_cursor: string | null;
}

// Money is always { amount_minor, currency } on the wire (§3.1).
export interface Money {
  amount_minor: number;
  currency: string;
}
