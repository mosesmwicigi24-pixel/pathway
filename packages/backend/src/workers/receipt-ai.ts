// A thank-you written for THIS giver, not mail-merged for every giver.
//
// The owner's ask (2026-08-22): "make the message unique for every giver, use
// their history too, and occasionally throw in a word that encourages." The
// static template stays — as the fallback and as the yardstick — but when the
// Nuru AI provider is configured, Claude writes the receipt: a first gift gets
// a welcome, a third gift gets noticed, and roughly one message in three
// carries a short word of Scripture.
//
// The architecture is "AI writes, code verifies", because this text lands on a
// phone and costs the church money:
//
//   * the FACTS are not the model's to state. The amount, fund and M-Pesa ref
//     are handed over as exact strings and the validator refuses any draft
//     that does not contain them verbatim — a warm message with a wrong figure
//     is worse than a cold one with the right figure.
//   * the ALPHABET is enforced, not requested. One character outside GSM-7
//     bills the text double (tonight's em-dash lesson, twice over), so the
//     validator measures with the same sms-text functions the tests use.
//   * ONE SEGMENT, hard. 160 septets or the draft is discarded.
//   * any failure — provider down, slow, off-script — falls back to the
//     template silently-to-the-giver, loudly-to-the-log. A receipt must never
//     be late because a language model was having a day.
import type { Logger } from "pino";
import type { AiProvider } from "../modules/assistant/provider.js";
import { gsm7Length, firstNameOf } from "../lib/sms-text.js";
import { renderGivingReceiptSms } from "./dispatch.js";

/** Everything the message may state, plus everything it may draw on. */
export interface ReceiptFacts {
  giver_name: string | null;
  /** Exact display string, e.g. "KES 10.00" — the model must echo it verbatim. */
  amount: string;
  fund: string;
  /** M-Pesa confirmation code, or null when the provider gave none. */
  receipt_code: string | null;
  /** Settled gifts from this phone BEFORE this one. 0 = a first gift. */
  prior_gifts: number;
  /** Whole months since their first gift, when there was one. */
  months_giving: number | null;
  /** Stable per-transaction seed so retries render the same "occasionally". */
  seed: number;
}

export const RECEIPT_SIGNATURE = "- The Good News Mission";
/** One GSM-7 segment. The validator is the contract; the prompt just aims low. */
const MAX_SEPTETS = 160;
const AI_TIMEOUT_MS = 6_000;

const SYSTEM = `You write the SMS a Kenyan church sends to thank someone the moment their M-Pesa gift arrives. One message, plain text, no preamble — reply with the message only.

Voice: warm, brief, genuinely grateful — a person, not a mail-merge. English with natural Kiswahili welcome (Asante, Mungu akubariki, Karibu). Never saccharine, never begging, never advice about money.

Hard rules — a draft that breaks any of these is thrown away by the code that called you:
- Use ONLY plain characters: letters, digits, spaces, . , ! ? ' ( ) : and the plain hyphen "-". NO em dashes, curly quotes, ellipsis characters, emoji or symbols.
- At most 150 characters in total.
- Include, verbatim and unaltered, each fact string the user message marks REQUIRED. Never restate amounts or counts in your own words and never invent figures, dates or history beyond the facts given.
- End with exactly: ${RECEIPT_SIGNATURE}
- If first_name is given, the message starts with it. If it is null, do not guess a name.
- No links, no phone numbers, no opt-out text, never the word STOP.

Use the history: prior_gifts 0 means a first gift — welcome them. A milestone count (3, 5, 10...) is worth a warm mention. months_giving tells you how long they have walked with the church. Vary your wording from message to message (the seed changes per gift); when seed is divisible by 3, weave in one very short Scripture reference (like 2 Cor 9:7 or Prov 11:25) — otherwise leave Scripture out.`;

/** Draft with the model, verify with code, fall back to the template. */
export async function composeReceiptSms(
  ai: AiProvider | undefined,
  facts: ReceiptFacts,
  log?: Logger,
): Promise<{ body: string; source: "ai" | "template" }> {
  const template = renderGivingReceiptSms({
    amount_minor: minorFromDisplay(facts.amount),
    currency: facts.amount.split(" ")[0] ?? "KES",
    fund: facts.fund,
    receipt_code: facts.receipt_code,
    member_name: facts.giver_name,
  });
  if (!ai) return { body: template, source: "template" };

  try {
    const draft = await Promise.race([
      ai.complete({
        system: SYSTEM,
        messages: [{ role: "user", text: JSON.stringify(userFacts(facts)) }],
        tier: "deep",
        effort: "low",
        maxTokens: 300,
        feature: "giving_receipt_sms",
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`receipt AI took longer than ${AI_TIMEOUT_MS}ms`)), AI_TIMEOUT_MS),
      ),
    ]);
    const cleaned = draft.replace(/\s+/g, " ").trim();
    const why = rejectReason(cleaned, facts);
    if (why) {
      log?.info({ why, draft_length: cleaned.length }, "receipt AI draft rejected — using the template");
      return { body: template, source: "template" };
    }
    return { body: cleaned, source: "ai" };
  } catch (err) {
    // The giver is thanked either way; only the log knows the difference.
    log?.warn({ err }, "receipt AI unavailable — using the template");
    return { body: template, source: "template" };
  }
}

/** The user-turn payload, with REQUIRED markers the system prompt refers to. */
function userFacts(f: ReceiptFacts): Record<string, unknown> {
  return {
    first_name: firstNameOf(f.giver_name) || null,
    amount: `REQUIRED verbatim: ${f.amount}`,
    fund: `REQUIRED verbatim: ${f.fund}`,
    mpesa_ref: f.receipt_code ? `REQUIRED verbatim: M-Pesa ref ${f.receipt_code}` : null,
    prior_gifts: f.prior_gifts,
    months_giving: f.months_giving,
    seed: f.seed,
  };
}

/**
 * Why a draft cannot be sent, or null when it can.
 *
 * Every rule here re-checks something the prompt already demanded, because a
 * prompt is a request and this is money on someone's phone. Ordered so the log
 * names the FIRST broken rule, which is usually the interesting one.
 */
export function rejectReason(draft: string, facts: ReceiptFacts): string | null {
  if (!draft) return "empty";
  const septets = gsm7Length(draft);
  if (septets === null) return "not GSM-7 (would bill as UCS-2)";
  if (septets > MAX_SEPTETS) return `over one segment (${septets} septets)`;
  if (!draft.includes(facts.amount)) return "amount missing or altered";
  if (!draft.includes(facts.fund)) return "fund missing or altered";
  if (facts.receipt_code && !draft.includes(facts.receipt_code)) return "M-Pesa ref missing";
  if (!draft.endsWith(RECEIPT_SIGNATURE)) return "signature missing";
  const name = firstNameOf(facts.giver_name);
  if (name && !draft.startsWith(name)) return "does not greet the giver by name";
  if (/https?:|www\.|\bSTOP\b/i.test(draft)) return "contains a link or opt-out text";
  return null;
}

/** "KES 10.00" → 1000. Display strings are built by us, so this stays simple —
 *  and the digits-not-floats rule from lib/money still applies. */
function minorFromDisplay(amount: string): number {
  const m = /(\d[\d,]*)(?:\.(\d{2}))?$/.exec(amount);
  if (!m) return 0;
  return Number(m[1]!.replace(/,/g, "")) * 100 + Number(m[2] ?? "0");
}
