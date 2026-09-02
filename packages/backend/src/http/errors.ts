// Standard error envelope + taxonomy (spec §3.2). Every error response is shaped
// as { error: { code, message, request_id, details? } }; the code → HTTP status
// map lives in @nuru/shared so client and server agree.
import { API_ERROR_CODES, type ApiErrorCode, type ErrorBody } from "@nuru/shared";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = API_ERROR_CODES[code];
    this.details = details;
  }

  toBody(requestId: string): ErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        request_id: requestId,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}


/**
 * The provider itself is not set up on THIS server — no Daraja keys, no Stripe
 * secret. It is our misconfiguration, not the giver's payment failing, and the
 * two must never be treated the same:
 *
 *   · a card declined      → the member can act; tell them.
 *   · a provider unset     → the member can do nothing; telling them their
 *                            gift "didn't go through" alarms them about our
 *                            plumbing and offers a retry that cannot work.
 *
 * A distinct type rather than a string match, because a message anyone is free
 * to reword is not a thing to branch on. Found necessary on 2026-09-02, when
 * six real M-Pesa partners were three hours from being told their giving had
 * failed — because the server had never had Daraja credentials.
 */
export class ProviderNotConfiguredError extends ApiError {
  constructor(message: string) {
    super("UPSTREAM_UNAVAILABLE", message);
    this.name = "ProviderNotConfiguredError";
  }
}
