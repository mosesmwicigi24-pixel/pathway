// Member-facing words for a failed gift (Giving Cycle 1). One table for the
// apps, the receipts, the schedule notices and the office, so "you cancelled
// the prompt" never reads as "your phone is broken" anywhere. Every reason says
// what happened; every hint says what to do next, and whether money moved.
import type { GiftFailureCode } from "./providers.js";

export interface GiftFailureCopy {
  code: GiftFailureCode;
  /** What happened, in one sentence. */
  reason: string;
  /** What to do next. */
  hint: string;
  /** True when the member never had a chance to answer (phone off, prompt
   *  expired, another payment in progress, M-Pesa's own fault) — the only
   *  failures a recurring gift may try again on its own. */
  retryable: boolean;
}

const COPY: Record<GiftFailureCode, { reason: string; hint: string; retryable: boolean }> = {
  cancelled: {
    reason: "The M-Pesa prompt was cancelled.",
    hint: "Nothing was taken. Give again whenever you're ready.",
    retryable: false,
  },
  unreachable: {
    reason: "The M-Pesa prompt couldn't reach the phone.",
    hint: "Check the phone is on and has signal, then try again.",
    retryable: true,
  },
  expired: {
    reason: "The M-Pesa prompt timed out before it was answered.",
    hint: "Try again and enter your PIN when the prompt appears.",
    retryable: true,
  },
  insufficient_funds: {
    reason: "There wasn't enough in the M-Pesa account.",
    hint: "Nothing was taken. Top up, or try a smaller amount.",
    retryable: false,
  },
  wrong_pin: {
    reason: "The M-Pesa PIN was entered incorrectly.",
    hint: "Nothing was taken. Try again and enter the PIN carefully.",
    retryable: false,
  },
  busy: {
    reason: "Another M-Pesa payment was in progress on that phone.",
    hint: "Wait a minute, then try again.",
    retryable: true,
  },
  limit_exceeded: {
    reason: "The amount is over the M-Pesa limit for that account.",
    hint: "Try a smaller amount, or give in two parts.",
    retryable: false,
  },
  declined: {
    reason: "M-Pesa declined the payment.",
    hint: "Nothing was taken. Try again, or use another number.",
    retryable: false,
  },
  system: {
    reason: "M-Pesa had a problem on their side.",
    hint: "Nothing was taken. Try again in a few minutes.",
    retryable: true,
  },
  no_phone: {
    reason: "There's no M-Pesa number we can prompt for this gift.",
    hint: "Add your M-Pesa number, then try again.",
    retryable: false,
  },
  no_answer: {
    reason: "M-Pesa never told us how this prompt ended.",
    hint: "If money left your account, the office will match it. Otherwise, give again.",
    retryable: false,
  },
};

/** The words for a stored failure code; null when there is none (or the gift
 *  did not fail). An unknown code reads as a plain decline. */
export function giftFailureCopy(code: string | null | undefined): GiftFailureCopy | null {
  if (!code) return null;
  const known = (COPY as Record<string, (typeof COPY)[GiftFailureCode]>)[code];
  const c = known ?? COPY.declined;
  return { code: (known ? code : "declined") as GiftFailureCode, reason: c.reason, hint: c.hint, retryable: c.retryable };
}
