// One phone format, applied at the door.
//
// Numbers were stored four ways (+254…, 0…, 254…, and with spaces), and the
// mess had already caused a real failure: migration 192 deduplicated members by
// comparing phone_number as a raw string, so `0700529451` and `+254700529451`
// read as two different people. Migration 195 cleaned the existing rows; this
// keeps them clean, because a one-off backfill against a field anyone can still
// type into freely is a fix with a shelf life.
//
// Kenya-first, not Kenya-only. The membership is Kenyan, so a bare `0…`, `254…`
// or nine digits is unambiguously +254. But one member's number is
// +96875035055 — a valid Omani mobile, a Kenyan working in the Gulf — and
// forcing that to +254 would produce a number that reaches nobody. So an
// already-international number is preserved untouched.

/** Kenyan mobile national number: 9 digits beginning 7 (Safaricom/Airtel) or 1 (newer ranges). */
const KE_NATIONAL = /^[17][0-9]{8}$/;

/** Any plausible E.164: '+', country code 1-9, then 6-14 more digits. */
const E164 = /^\+[1-9][0-9]{6,14}$/;

/**
 * Normalise a phone number to E.164, assuming Kenya when no country is implied.
 *
 * Never throws and never guesses a country for a number that already declares
 * one. Unrecognised input comes back stripped rather than mangled, so a human
 * sees what was actually typed instead of a plausible-looking wrong number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  // Spaces, hyphens, brackets and dots are how humans write numbers, and are
  // exactly what made five production rows differ from otherwise identical ones.
  const s = raw.replace(/[\s\-().]/g, "");
  if (s === "") return null;

  // Already international — including +968 and anything else not ours to
  // reinterpret.
  if (s.startsWith("+")) return s;

  if (/^254[17][0-9]{8}$/.test(s)) return `+${s}`;
  if (/^0[17][0-9]{8}$/.test(s)) return `+254${s.slice(1)}`;
  if (KE_NATIONAL.test(s)) return `+254${s}`;
  return s;
}

/** True when the value is already a well-formed E.164 number. */
export function isE164(value: string | null | undefined): boolean {
  return typeof value === "string" && E164.test(value);
}
