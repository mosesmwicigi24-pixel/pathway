// Request signing for nuruplace.org → Pathway.
//
// The church website has no session and no user to authenticate as. What it has
// is a secret shared with this API, so every payload it forwards — an enquiry, a
// gift — carries an HMAC and we trust the bytes or refuse them. Same trust model
// as the Stripe and mobile-money receivers next door (§3.5).
//
// The header format is Stripe's, on purpose:
//
//     x-nuruplace-signature: t=1755792000,v1=<64 hex chars>
//
// signing `${timestamp}.${rawBody}`. Not because Stripe is authoritative, but
// because this team reads Stripe's headers every week and a second, cleverer
// scheme would be one more thing to get subtly wrong at 11pm.
import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "./errors.js";

/** How far out of date a signed request may be before it is treated as a replay. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

const SIGNATURE_RE = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/;

/**
 * Verify `x-nuruplace-signature` against the raw body, or throw.
 *
 * Timestamp and body are signed TOGETHER, so a captured request cannot be
 * replayed once the tolerance passes — signing the body alone would let anyone
 * who ever saw one valid request repeat it forever.
 *
 * Compared in constant time: a short-circuiting `===` leaks how many leading
 * bytes of a forged signature were right, which is enough to build the rest one
 * byte at a time.
 */
export function verifyWebsiteSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
  nowMs: number = Date.now(),
): void {
  const match = SIGNATURE_RE.exec(header?.trim() ?? "");
  if (!match) {
    throw new ApiError("AUTH_REQUIRED", "Missing or malformed signature header");
  }
  const [, timestamp, given] = match as unknown as [string, string, string];
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) {
    throw new ApiError("AUTH_REQUIRED", "Signature timestamp is outside the accepted window");
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const a = Buffer.from(given, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ApiError("AUTH_REQUIRED", "Signature does not match");
  }
}

/** Produce the header a caller would send. Exported for tests and for anything
 *  on our side that needs to sign outbound (none today). */
export function websiteSignatureHeader(rawBody: string, secret: string, nowMs: number = Date.now()): string {
  const t = Math.floor(nowMs / 1000).toString();
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")}`;
}
