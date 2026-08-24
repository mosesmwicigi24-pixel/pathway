// The composed personal liturgy (owner's format, 2026-08-24): ONE thought in
// three parts — statement, Scripture, explanation — inspired by what the
// member carries but NEVER echoing their own words. These tests pin the
// no-echo guarantee (composed AND fallback paths), the verse staying
// server-authoritative (menu text, never model text), the once-per-part cache
// (a liturgy must not flicker), and the empty-handed communal fallthrough.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { personalTouch } from "../src/modules/intelligence/personalLiturgy.js";
import type { AiProvider, AiCompletion } from "../src/modules/assistant/provider.js";

const RAW_TITLE = "Pray for Kenya my country";

/** A provider that answers like a well-behaved composer, counting its calls. */
function fakeProvider(reply?: string): AiProvider & { calls: AiCompletion[] } {
  const calls: AiCompletion[] = [];
  return {
    name: "fake",
    calls,
    async complete(input: AiCompletion): Promise<string> {
      calls.push(input);
      return (
        reply ??
        JSON.stringify({
          statement: "What you carried to Him this morning is already being carried for you.",
          verse_ref: "1 Peter 5:7",
          explanation: "The weight you keep lifting was never meant to stay on your shoulders — hand it over again.",
        })
      );
    },
  };
}

const failingProvider: AiProvider = {
  name: "down",
  async complete(): Promise<string> {
    throw new Error("upstream unavailable");
  },
};

async function memberWithPrayer(): Promise<string> {
  const cong = await createCongregation();
  const u = await createUser({ congregationId: cong, email: "lit@dev.local" });
  await testPool().query(
    `INSERT INTO prayer_entries (entry_id, user_id, title, body, is_answered)
     VALUES (gen_random_uuid(), $1, $2, 'long private text…', false)`,
    [u.user_id, RAW_TITLE],
  );
  return u.user_id;
}

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPool();
});

describe("the personal liturgy is composed, never recited", () => {
  it("composes statement + menu verse + explanation; the member's words appear nowhere", async () => {
    const userId = await memberWithPrayer();
    const p = fakeProvider();
    const touch = await personalTouch(testPool(), p, userId, "morning", "morning", "2026-08-24");
    expect(touch).not.toBeNull();
    expect(touch!.statement.length).toBeGreaterThan(10);
    expect(touch!.charge.length).toBeGreaterThan(10);
    // Verse is server-authoritative: exact menu text for the chosen ref.
    expect(touch!.verse_line.reference).toBe("1 Peter 5:7");
    expect(touch!.verse_line.text).toBe("Cast all your anxieties on him, because he cares for you.");
    for (const field of [touch!.statement, touch!.charge, touch!.verse_line.text]) {
      expect(field.toLowerCase()).not.toContain(RAW_TITLE.toLowerCase());
    }
    // The composer DID receive the theme as inspiration.
    expect(JSON.stringify(p.calls[0])).toContain("Kenya");
  });

  it("composes once per (member, day, part) — the cached word is the day's truth", async () => {
    const userId = await memberWithPrayer();
    const p = fakeProvider();
    const a = await personalTouch(testPool(), p, userId, "morning", "morning", "2026-08-24");
    const b = await personalTouch(testPool(), p, userId, "morning", "morning", "2026-08-24");
    expect(p.calls).toHaveLength(1);
    expect(b!.statement).toBe(a!.statement);
    expect(b!.charge).toBe(a!.charge);
    // A different part composes anew.
    await personalTouch(testPool(), p, userId, "evening", "evening", "2026-08-24");
    expect(p.calls).toHaveLength(2);
  });

  it("a model reply that leaks the member's words is refused — fallback speaks instead", async () => {
    const userId = await memberWithPrayer();
    const leaky = fakeProvider(
      JSON.stringify({
        statement: `He heard "${RAW_TITLE}" and will answer.`,
        verse_ref: "1 Peter 5:7",
        explanation: "He cares for you.",
      }),
    );
    const touch = await personalTouch(testPool(), leaky, userId, "night", "night", "2026-08-24");
    expect(touch).not.toBeNull();
    expect(touch!.statement.toLowerCase()).not.toContain("kenya");
    expect(touch!.charge.toLowerCase()).not.toContain("kenya");
  });

  it("a model verse OUTSIDE the menu is refused — no invented Scripture ever ships", async () => {
    const userId = await memberWithPrayer();
    const inventive = fakeProvider(
      JSON.stringify({
        statement: "A perfectly lovely statement about your quiet faithfulness today.",
        verse_ref: "Hezekiah 3:16",
        explanation: "A perfectly lovely explanation that lands the verse in your walk today.",
      }),
    );
    const touch = await personalTouch(testPool(), inventive, userId, "midday", "midday", "2026-08-24");
    const menuRefs = ["Philippians 4:6", "1 Peter 5:7", "Psalm 34:17", "Isaiah 65:24"];
    expect(menuRefs).toContain(touch!.verse_line.reference);
  });

  it("provider down → the authored fallback answers, quote-free, and is cached for stability", async () => {
    const userId = await memberWithPrayer();
    const a = await personalTouch(testPool(), failingProvider, userId, "night", "night", "2026-08-24");
    expect(a).not.toBeNull();
    expect(a!.statement.toLowerCase()).not.toContain("kenya");
    expect(a!.charge.toLowerCase()).not.toContain("kenya");
    // Cached: a later HEALTHY provider does not change the day's word.
    const healthy = fakeProvider();
    const b = await personalTouch(testPool(), healthy, userId, "night", "night", "2026-08-24");
    expect(healthy.calls).toHaveLength(0);
    expect(b!.statement).toBe(a!.statement);
  });

  it("empty-handed members keep the church's own liturgy (null)", async () => {
    const cong = await createCongregation();
    const u = await createUser({ congregationId: cong, email: "empty@dev.local" });
    expect(await personalTouch(testPool(), fakeProvider(), u.user_id, "midday", "midday", "2026-08-24")).toBeNull();
  });

  it("an ANSWERED prayer no longer speaks", async () => {
    const cong = await createCongregation();
    const u = await createUser({ congregationId: cong, email: "ans@dev.local" });
    await testPool().query(
      `INSERT INTO prayer_entries (entry_id, user_id, title, body, is_answered)
       VALUES (gen_random_uuid(), $1, 'Old request', 'x', true)`,
      [u.user_id],
    );
    expect(await personalTouch(testPool(), fakeProvider(), u.user_id, "morning", "morning", "2026-08-24")).toBeNull();
  });
});
