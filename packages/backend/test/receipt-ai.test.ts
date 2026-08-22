// Claude writes the thank-you; this file is the reason that is safe.
//
// The owner asked for receipts that are unique per giver, aware of their
// history, and occasionally encouraging. A language model is good at exactly
// that — and also, occasionally, at inventing a figure, reaching for an em
// dash, or writing a paragraph. Every one of those lands on a phone and costs
// the church money, so the contract is "AI drafts, code verifies": the
// validator here is the product, and the prompt is merely its best customer.
import { describe, it, expect } from "vitest";
import { pino } from "pino";
import { composeReceiptSms, rejectReason, RECEIPT_SIGNATURE, type ReceiptFacts } from "../src/workers/receipt-ai.js";
import type { AiProvider, AiCompletion } from "../src/modules/assistant/provider.js";

const log = pino({ level: "silent" });

const FACTS: ReceiptFacts = {
  giver_name: "Moses Mwicigi",
  amount: "KES 10.00",
  fund: "Discipleship",
  receipt_code: "UHMJ23O8BO",
  prior_gifts: 2,
  months_giving: 4,
  seed: 3,
};

const GOOD = `Moses, asante for your 3rd gift! KES 10.00 to Discipleship. M-Pesa ref UHMJ23O8BO. 2 Cor 9:7 - a cheerful giver. ${RECEIPT_SIGNATURE}`;

/** An AiProvider that answers with a fixed draft (or throws). */
function stub(reply: string | Error, capture?: { input?: AiCompletion }): AiProvider {
  return {
    name: "stub",
    complete: (input: AiCompletion) => {
      if (capture) capture.input = input;
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
    },
  };
}

describe("the validator — every rule must be able to say no", () => {
  it("accepts a draft that keeps all the rules", () => {
    expect(rejectReason(GOOD, FACTS)).toBeNull();
  });

  const cases: Array<[string, string, string]> = [
    ["an em dash", GOOD.replace("- a cheerful", "— a cheerful"), "not GSM-7"],
    ["an altered amount", GOOD.replace("KES 10.00", "KES 100.00"), "amount"],
    ["a missing fund", GOOD.replace("Discipleship", "the church"), "fund"],
    ["a missing M-Pesa ref", GOOD.replace("UHMJ23O8BO", "somewhere"), "M-Pesa ref"],
    ["a dropped signature", GOOD.replace(RECEIPT_SIGNATURE, "- TGNM"), "signature"],
    ["ignoring the giver's name", GOOD.replace("Moses, asante", "Asante"), "name"],
    ["a link", GOOD.replace("2 Cor 9:7", "see https://x.test"), "link"],
    ["opt-out text", GOOD.replace("2 Cor 9:7", "reply STOP to opt out"), "link or opt-out"],
    ["two segments", `Moses, ${"bless ".repeat(30)}KES 10.00 to Discipleship. M-Pesa ref UHMJ23O8BO. ${RECEIPT_SIGNATURE}`, "segment"],
  ];
  for (const [label, draft, why] of cases) {
    it(`rejects ${label}`, () => {
      expect(rejectReason(draft, FACTS)).toMatch(new RegExp(why, "i"));
    });
  }

  it("does not demand a greeting when there is no name to greet", () => {
    const anon = { ...FACTS, giver_name: null };
    expect(rejectReason(GOOD.replace("Moses, asante", "Asante"), anon)).toBeNull();
  });
});

describe("composeReceiptSms — drafts, verifies, falls back", () => {
  it("sends the model's draft when it keeps the rules", async () => {
    const out = await composeReceiptSms(stub(GOOD), FACTS, log);
    expect(out).toEqual({ body: GOOD, source: "ai" });
  });

  it("falls back to the template on an off-script draft — the giver is still thanked", async () => {
    const out = await composeReceiptSms(stub("Dearest friend — blessings!"), FACTS, log);
    expect(out.source).toBe("template");
    expect(out.body).toContain("KES 10.00");
    expect(out.body).toContain("UHMJ23O8BO");
    expect(out.body).toContain(RECEIPT_SIGNATURE);
  });

  it("falls back when the provider throws", async () => {
    const out = await composeReceiptSms(stub(new Error("upstream 529")), FACTS, log);
    expect(out.source).toBe("template");
  });

  it("uses the template outright when no provider is configured", async () => {
    const out = await composeReceiptSms(undefined, FACTS, log);
    expect(out.source).toBe("template");
    expect(out.body).toBe((await composeReceiptSms(undefined, FACTS, log)).body); // deterministic
  });

  it("hands the model the history and marks the facts REQUIRED", async () => {
    const cap: { input?: AiCompletion } = {};
    await composeReceiptSms(stub(GOOD, cap), FACTS, log);
    const user = cap.input!.messages[0]!.text;
    expect(user).toContain('"prior_gifts":2');
    expect(user).toContain('"months_giving":4');
    expect(user).toContain("REQUIRED verbatim: KES 10.00");
    expect(user).toContain("REQUIRED verbatim: Discipleship");
    expect(cap.input!.feature).toBe("giving_receipt_sms");
  });

  it("collapses whitespace so a multi-line draft becomes one message", async () => {
    const out = await composeReceiptSms(stub(GOOD.replace("! ", "!\n\n  ")), FACTS, log);
    expect(out.source).toBe("ai");
    expect(out.body).not.toMatch(/\n/);
  });
});
