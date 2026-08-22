// What a text message actually costs, in characters.
//
// An SMS is not billed by "how long it looks". It is billed per SEGMENT, and
// the segment size depends on which alphabet the whole message can be encoded
// in:
//
//   GSM-7  →  160 characters in one segment, 153 each when concatenated
//   UCS-2  →   70 characters in one segment,  67 each when concatenated
//
// The trap is that ONE character outside GSM-7 demotes the ENTIRE message to
// UCS-2. An em dash, a curly apostrophe, an ellipsis — the things a text editor
// inserts helpfully — cut the budget from 160 to 70 and silently double the
// bill on every message that copy is used for. Nothing errors; the message
// arrives; only the invoice knows.
//
// So the length of an SMS is not `s.length`, and this module exists so that no
// piece of outgoing copy has to guess.

/**
 * The GSM 03.38 basic alphabet: one septet each.
 * Order is the standard's, kept so this is checkable against the spec table.
 */
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

/**
 * The extension table: still GSM-7, but each costs TWO septets because it is
 * sent as ESC + char. Cheap to forget, and a message full of them is half the
 * length you think it is.
 */
const GSM7_EXTENDED = "^{}\\[~]|€\f";

const BASIC = new Set(GSM7_BASIC);
const EXTENDED = new Set(GSM7_EXTENDED);

/** Every character in `s` that no GSM-7 table can encode. Empty ⇒ GSM-7 clean. */
export function nonGsm7Characters(s: string): string[] {
  return [...s].filter((ch) => !BASIC.has(ch) && !EXTENDED.has(ch));
}

/** True when the whole string encodes as GSM-7 (i.e. gets the 160/153 budget). */
export function isGsm7(s: string): boolean {
  return nonGsm7Characters(s).length === 0;
}

/**
 * Billable length in septets, or null when the string is not GSM-7 at all —
 * null means "this is a UCS-2 message" and the caller should stop measuring in
 * septets, not treat it as zero.
 */
export function gsm7Length(s: string): number | null {
  let n = 0;
  for (const ch of s) {
    if (BASIC.has(ch)) n += 1;
    else if (EXTENDED.has(ch)) n += 2;
    else return null;
  }
  return n;
}

/** How many segments the carrier will bill for this message. */
export function smsSegments(s: string): number {
  const septets = gsm7Length(s);
  if (septets !== null) {
    if (septets === 0) return 1;
    return septets <= 160 ? 1 : Math.ceil(septets / 153);
  }
  // UCS-2: measured in UTF-16 code units, which is what the encoding actually
  // ships. An emoji is a surrogate pair and therefore costs two.
  const units = s.length;
  if (units === 0) return 1;
  return units <= 70 ? 1 : Math.ceil(units / 67);
}

/**
 * Pick the first variant that fits the budget.
 *
 * Written this way because the alternative — render one template and truncate
 * the overflow — cuts through the middle of somebody's name and sends it. The
 * variants are ordered most-complete first and the LAST one must have no
 * variable parts, so "it always fits" is a property of the list rather than a
 * hope about the inputs. Returns the last variant if even that overflows, so
 * the caller still gets a sentence; assert on the list instead of at runtime.
 */
export function fitSms(variants: string[], budget: number): string {
  for (const v of variants) {
    const n = gsm7Length(v);
    if (n !== null && n <= budget) return v;
  }
  return variants[variants.length - 1] ?? "";
}

/** First name, for copy that greets someone. Empty string when there isn't one. */
export function firstNameOf(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/)[0] ?? "";
}
