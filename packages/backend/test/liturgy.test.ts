// The liturgy Home (intelligence Phase 4) — the season computus and clock are
// deterministic; composition is cached per congregation+day (shared, like
// module_explanations); a broken model serves the fallback without caching it.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation } from "./helpers/factories.js";
import {
  LiturgyService,
  easterOf,
  seasonOf,
  partOf,
  bandOf,
  spineFor,
  BANDS,
  FALLBACK_LITURGY,
  LITURGY_ART,
  pickLiturgyArt,
  pickBandArt,
  type DayBand,
} from "../src/modules/intelligence/liturgy.js";
import { LITURGY_SYSTEM } from "../src/modules/intelligence/prompts.js";
import { FakeAiProvider, type AiProvider, type AiCompletion } from "../src/modules/assistant/provider.js";

afterAll(async () => {
  await closeTestPool();
});

describe("computus + seasons + clock (pure)", () => {
  it("computes Easter correctly for known years", () => {
    expect(easterOf(2024)).toEqual({ month: 3, day: 31 });
    expect(easterOf(2025)).toEqual({ month: 4, day: 20 });
    expect(easterOf(2026)).toEqual({ month: 4, day: 5 });
    expect(easterOf(2027)).toEqual({ month: 3, day: 28 });
  });

  it("maps dates to church seasons (EAT calendar)", () => {
    expect(seasonOf(new Date("2026-12-25T12:00:00Z"))).toBe("christmas");
    expect(seasonOf(new Date("2026-01-03T12:00:00Z"))).toBe("christmas");
    expect(seasonOf(new Date("2026-12-01T12:00:00Z"))).toBe("advent"); // Advent 2026 starts Nov 29
    expect(seasonOf(new Date("2026-02-20T12:00:00Z"))).toBe("lent"); // Ash Wed 2026 = Feb 18
    expect(seasonOf(new Date("2026-04-05T12:00:00Z"))).toBe("easter"); // Easter Sunday
    expect(seasonOf(new Date("2026-05-24T12:00:00Z"))).toBe("easter"); // Pentecost (Easter+49)
    expect(seasonOf(new Date("2026-07-11T12:00:00Z"))).toBe("ordinary");
  });

  it("maps the EAT clock to liturgy parts (note: +3h from UTC)", () => {
    expect(partOf(new Date("2026-07-11T04:00:00Z"))).toBe("morning"); // 07:00 EAT
    expect(partOf(new Date("2026-07-11T09:00:00Z"))).toBe("midday"); // 12:00 EAT
    expect(partOf(new Date("2026-07-11T15:00:00Z"))).toBe("evening"); // 18:00 EAT
    expect(partOf(new Date("2026-07-11T20:00:00Z"))).toBe("night"); // 23:00 EAT
    expect(partOf(new Date("2026-07-11T23:30:00Z"))).toBe("night"); // 02:30 EAT next day
  });

  it("maps the EAT clock to the seven finer bands, at every boundary", () => {
    expect(bandOf(new Date("2026-07-11T02:59:00Z"))).toBe("midnight"); // 05:59 EAT
    expect(bandOf(new Date("2026-07-11T03:00:00Z"))).toBe("sunrise"); // 06:00 EAT
    expect(bandOf(new Date("2026-07-11T05:59:00Z"))).toBe("sunrise"); // 08:59 EAT
    expect(bandOf(new Date("2026-07-11T06:00:00Z"))).toBe("morning"); // 09:00 EAT
    expect(bandOf(new Date("2026-07-11T10:59:00Z"))).toBe("midday"); // 13:59 EAT
    expect(bandOf(new Date("2026-07-11T11:00:00Z"))).toBe("afternoon"); // 14:00 EAT
    expect(bandOf(new Date("2026-07-11T17:59:00Z"))).toBe("evening"); // 20:59 EAT
    expect(bandOf(new Date("2026-07-11T18:00:00Z"))).toBe("night"); // 21:00 EAT
  });
});

describe("band art — disjoint tableau photographs per card", () => {
  const BANDS: DayBand[] = ["sunrise", "morning", "midday", "afternoon", "evening", "night", "midnight"];
  const DAYS = ["2026-01-01", "2026-06-15", "2026-12-31"];

  it("pickBandArt('liturgy') and pickBandArt('verse') never coincide, for any band and day", () => {
    for (const band of BANDS) {
      for (const day of DAYS) {
        const liturgyArt = pickBandArt("liturgy", band, day);
        const verseArt = pickBandArt("verse", band, day);
        expect(liturgyArt.url).not.toBe(verseArt.url);
      }
    }
  });

  it("is deterministic per (card, band, day)", () => {
    expect(pickBandArt("liturgy", "sunrise", "2026-07-13")).toEqual(pickBandArt("liturgy", "sunrise", "2026-07-13"));
    expect(pickBandArt("verse", "midnight", "2026-07-13")).toEqual(pickBandArt("verse", "midnight", "2026-07-13"));
  });
});

describe("composition + cache (seven bands)", () => {
  let cong: string;
  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation();
  });

  it("composes seven bands once, caches per congregation+day, and current() serves the clock's band", async () => {
    const svc = new LiturgyService(testPool(), new FakeAiProvider());
    const first = await svc.composeFor(cong);
    expect(first.cached).toBe(false);
    expect(first.day.sunrise.line).toContain("mercies");
    for (const band of BANDS) {
      expect(typeof first.day[band].line).toBe("string");
      expect(first.day[band].line.length).toBeGreaterThan(8);
    }

    const again = await svc.composeFor(cong);
    expect(again.cached).toBe(true);

    const rows = await testPool().query(`SELECT count(*)::int AS n FROM liturgies`);
    expect(rows.rows[0].n).toBe(7);

    const now = await svc.current(cong);
    expect(["morning", "midday", "evening", "night"]).toContain(now.part); // legacy field, still one of 4
    expect(now.line.length).toBeGreaterThan(10);
    expect(now.season).toBeTruthy();
    // The hour's tableau rides along, drawn from that band's curated (liturgy-card) pool.
    expect(now.art.url.startsWith("https://images.unsplash.com/photo-")).toBe(true);
    expect(now.art.alt.length).toBeGreaterThan(5);
    // The finer 7-band clock rides along too: a band, a second authored charge
    // line, and a curated verse-line for that band.
    expect(BANDS).toContain(now.band);
    expect(typeof now.charge).toBe("string");
    expect(now.charge.length).toBeGreaterThan(10);
    expect(typeof now.verse_line.reference).toBe("string");
    expect(now.verse_line.reference.length).toBeGreaterThan(0);
    expect(typeof now.verse_line.text).toBe("string");
    expect(now.verse_line.text.length).toBeGreaterThan(10);
  });

  it("each part has ~30 hour-fitting images and rotates 30 days without repeating", () => {
    for (const part of ["morning", "midday", "evening", "night"] as const) {
      const pool = LITURGY_ART[part];
      expect(pool.length).toBeGreaterThanOrEqual(30); // a full month, no repeats
      expect(new Set(pool.map((a) => a.url)).size).toBe(pool.length); // no dup images
      for (const a of pool) expect(a.url).toMatch(/^https:\/\/images\.unsplash\.com\/photo-/);

      // 30 consecutive days → 30 distinct images (the one-per-day step).
      const days = Array.from({ length: 30 }, (_, i) => {
        const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
        return pickLiturgyArt(part, d).url;
      });
      expect(new Set(days).size).toBe(30);
    }
  });

  it("serves the fallback (uncached), covering all seven bands, when the model fails, then heals", async () => {
    const broken: AiProvider = {
      name: "broken",
      complete: () => Promise.reject(new Error("model down")),
    };
    const svc = new LiturgyService(testPool(), broken);
    const r = await svc.composeFor(cong);
    expect(r.day.sunrise.line).toBe(FALLBACK_LITURGY.sunrise.line);
    for (const band of BANDS) {
      expect(r.day[band].line.length).toBeGreaterThan(8);
      expect(r.day[band].scripture).toBeTruthy();
    }
    const rows = await testPool().query(`SELECT count(*)::int AS n FROM liturgies`);
    expect(rows.rows[0].n).toBe(0); // fallback is never cached

    const healed = await new LiturgyService(testPool(), new FakeAiProvider()).composeFor(cong);
    expect(healed.cached).toBe(false); // composed fresh now that the model is back
  });
});

describe("scripture spine", () => {
  const REF_RE = /^([1-3] )?[A-Za-z]+ \d+:\d+(-\d+)?$/;

  it("is deterministic for a given day", () => {
    const a = spineFor("2026-07-13");
    const b = spineFor("2026-07-13");
    expect(a).toEqual(b);
  });

  it("every reference is well-formed and every passage carries real text", () => {
    const days = Array.from({ length: 60 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 0, 1 + i * 6)).toISOString().slice(0, 10);
      return spineFor(d);
    });
    for (const spine of days) {
      for (const passage of [spine.psalm, spine.gospel, spine.epistle]) {
        expect(passage.reference).toMatch(REF_RE);
        expect(passage.text.length).toBeGreaterThan(15);
        expect(passage.text.trim()).toBe(passage.text); // no stray whitespace
      }
    }
  });

  it("does not repeat within a long (year-scale) window — not a 7-day loop", () => {
    const WINDOW_DAYS = 400; // > 1 year of days; comfortably beyond a week
    const seen = new Set<string>();
    for (let i = 0; i < WINDOW_DAYS; i++) {
      const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      const s = spineFor(d);
      const key = `${s.psalm.reference}|${s.gospel.reference}|${s.epistle.reference}`;
      expect(seen.has(key)).toBe(false); // the full triple must be new
      seen.add(key);
    }
    expect(seen.size).toBe(WINDOW_DAYS);

    // A literal 7-day loop would repeat the whole triple every week — assert
    // the spine one week later is NOT the same as today's.
    const day0 = spineFor("2026-03-01");
    const day7 = spineFor("2026-03-08");
    expect(day0).not.toEqual(day7);
  });
});

describe("memory — prior lines actually reach the prompt", () => {
  let cong: string;
  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation();
  });

  it("feeds the last 14 days' composed lines to the model, not just a rule about them", async () => {
    const dayDate = "2026-07-20"; // composeFor's target EAT day
    const markerA = "MARKER_LINE_ALPHA_this exact sentence must appear in the prompt payload";
    const markerB = "MARKER_LINE_BETA_this exact sentence must appear in the prompt payload";
    const tooOld = "MARKER_LINE_TOO_OLD_outside the 14-day window, must NOT appear";

    // Seed prior days directly (as if composed earlier), including one day
    // that's outside the 14-day lookback window.
    await testPool().query(
      `INSERT INTO liturgies (congregation_id, day_date, part, body, scripture_ref, season)
       VALUES ($1, '2026-07-18', 'morning', $2, 'Psalm 1:1', 'ordinary'),
              ($1, '2026-07-19', 'evening', $3, 'Psalm 2:1', 'ordinary'),
              ($1, '2026-06-01', 'morning', $4, 'Psalm 3:1', 'ordinary')`,
      [cong, markerA, markerB, tooOld],
    );

    let captured: AiCompletion | undefined;
    const capturing: AiProvider = {
      name: "capturing",
      complete: (input) => {
        captured = input;
        return new FakeAiProvider().complete(input);
      },
    };

    const svc = new LiturgyService(testPool(), capturing);
    await svc.composeFor(cong, new Date(`${dayDate}T09:00:00Z`));

    expect(captured).toBeDefined();
    const payload = captured!.messages.map((m) => m.text).join("\n");
    // The rule in LITURGY_SYSTEM references "prior_lines" — but a rule about
    // something the model can't see is no rule. Assert the ACTUAL lines are
    // in the payload the model receives, not merely that the prompt talks
    // about a rule.
    expect(payload).toContain(markerA);
    expect(payload).toContain(markerB);
    expect(payload).not.toContain(tooOld); // outside the 14-day window
    expect(payload).toContain("prior_lines");
  });
});

describe("sermon quotes — a third input, woven in only when offered and used", () => {
  let cong: string;
  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation();
  });

  async function insertActiveQuote(text: string): Promise<string> {
    const { rows } = await testPool().query<{ quote_id: string }>(
      `INSERT INTO teaching_quotes (quote_text, attribution, source_title, source_ref)
       VALUES ($1, 'Pastor Moses', 'Test Sermon', 'test-ref') RETURNING quote_id`,
      [text],
    );
    return rows[0]!.quote_id;
  }

  it("a liturgy composed against an empty teaching_quotes table still succeeds — the library is an enhancement, never a dependency", async () => {
    const svc = new LiturgyService(testPool(), new FakeAiProvider());
    const result = await svc.composeFor(cong);
    expect(result.cached).toBe(false);
    for (const band of BANDS) {
      expect(result.day[band].line.length).toBeGreaterThan(8);
    }
  });

  it("offers active quote candidates to the model in the prompt payload", async () => {
    await insertActiveQuote("The role of the spirit is to deliver the mind of God this very day.");

    let captured: AiCompletion | undefined;
    const capturing: AiProvider = {
      name: "capturing",
      complete: (input) => {
        captured = input;
        return new FakeAiProvider().complete(input);
      },
    };
    await new LiturgyService(testPool(), capturing).composeFor(cong);

    expect(captured).toBeDefined();
    const payload = captured!.messages.map((m) => m.text).join("\n");
    expect(payload).toContain("quotes");
    expect(payload).toContain("The role of the spirit is to deliver the mind of God this very day.");
    expect(captured!.system).toContain("Pastor Moses"); // LITURGY_SYSTEM's attribution instruction names him
  });

  it("does not offer an inactive quote to the model", async () => {
    await testPool().query(
      `INSERT INTO teaching_quotes (quote_text, attribution, source_title, source_ref, is_active)
       VALUES ('An inactive quote that must never reach the composer prompt.', 'Pastor Moses', 'Test Sermon', 'test-ref', FALSE)`,
    );
    let captured: AiCompletion | undefined;
    const capturing: AiProvider = {
      name: "capturing",
      complete: (input) => {
        captured = input;
        return new FakeAiProvider().complete(input);
      },
    };
    await new LiturgyService(testPool(), capturing).composeFor(cong);
    const payload = captured!.messages.map((m) => m.text).join("\n");
    expect(payload).not.toContain("An inactive quote that must never reach the composer prompt.");
  });

  it("marks a quote the model actually used, and rotates it out of tomorrow's candidates", async () => {
    const quoteId = await insertActiveQuote("A teaching line the model will choose to weave in today.");

    const weaving: AiProvider = {
      name: "weaving",
      complete: async (input) => {
        const raw = await new FakeAiProvider().complete(input);
        const obj = JSON.parse(raw) as Record<string, { line: string; scripture: string | null }>;
        // Simulate the model reporting it used this quote in the sunrise band.
        return JSON.stringify({ ...obj, sunrise: { ...obj.sunrise, quote_id: quoteId } });
      },
    };

    await new LiturgyService(testPool(), weaving).composeFor(cong, new Date("2026-07-20T09:00:00Z"));

    const { rows } = await testPool().query<{ use_count: number; last_used_at: Date | null }>(
      `SELECT use_count, last_used_at FROM teaching_quotes WHERE quote_id = $1`,
      [quoteId],
    );
    expect(rows[0]!.use_count).toBe(1);
    expect(rows[0]!.last_used_at).not.toBeNull();

    // A fresh selection right after must exclude it (14-day rotation window).
    const { selectQuoteCandidates } = await import("../src/modules/intelligence/teachingQuotes.js");
    const next = await selectQuoteCandidates(testPool());
    expect(next.map((q) => q.quoteId)).not.toContain(quoteId);
  });

  it("ignores a quote_id the model reports that was never actually offered (defense in depth)", async () => {
    const hallucinating: AiProvider = {
      name: "hallucinating",
      complete: async (input) => {
        const raw = await new FakeAiProvider().complete(input);
        const obj = JSON.parse(raw) as Record<string, { line: string; scripture: string | null }>;
        return JSON.stringify({ ...obj, sunrise: { ...obj.sunrise, quote_id: "00000000-0000-0000-0000-000000000000" } });
      },
    };
    // Should not throw, and should not touch any row (there is none to touch).
    const result = await new LiturgyService(testPool(), hallucinating).composeFor(cong);
    expect(result.cached).toBe(false);
    expect(result.day.sunrise.line.length).toBeGreaterThan(8);
  });

  it("every quote reaching the prompt carries attribution — a surfaced quote is never anonymous", async () => {
    await insertActiveQuote("Every candidate line the composer sees must already carry its own attribution.");
    let captured: AiCompletion | undefined;
    const capturing: AiProvider = {
      name: "capturing",
      complete: (input) => {
        captured = input;
        return new FakeAiProvider().complete(input);
      },
    };
    await new LiturgyService(testPool(), capturing).composeFor(cong);
    const payload = JSON.parse(captured!.messages[0]!.text) as { quotes: Array<{ id: string; text: string; source: string }> };
    expect(payload.quotes.length).toBeGreaterThan(0);
    for (const q of payload.quotes) {
      expect(q.id.length).toBeGreaterThan(0);
      expect(q.source.length).toBeGreaterThan(0);
    }
  });
});

describe("seven-band persistence + backward compatibility", () => {
  let cong: string;
  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation();
  });

  it("persists all seven bands and re-reads them correctly", async () => {
    const svc = new LiturgyService(testPool(), new FakeAiProvider());
    await svc.composeFor(cong, new Date("2026-07-20T09:00:00Z"));

    const rows = await testPool().query<{ part: string }>(
      `SELECT part FROM liturgies WHERE congregation_id = $1 AND day_date = '2026-07-20' ORDER BY part`,
      [cong],
    );
    const parts = rows.rows.map((r) => r.part).sort();
    expect(parts).toEqual([...BANDS].sort());

    // Re-reading via composeFor again must return the SAME content (cache hit).
    const reread = await svc.composeFor(cong, new Date("2026-07-20T09:00:00Z"));
    expect(reread.cached).toBe(true);
    for (const band of BANDS) {
      expect(reread.day[band].line).toBeTruthy();
    }
  });

  it("a four-part legacy row (pre-migration-187 shape) still serves without crashing", async () => {
    // Simulate data written before this migration: only the four legacy
    // parts, no spine column populated.
    await testPool().query(
      `INSERT INTO liturgies (congregation_id, day_date, part, body, scripture_ref, season)
       VALUES ($1, '2026-07-20', 'morning', 'Legacy morning line.', 'Psalm 5:1', 'ordinary'),
              ($1, '2026-07-20', 'midday', 'Legacy midday line.', 'Psalm 6:1', 'ordinary'),
              ($1, '2026-07-20', 'evening', 'Legacy evening line.', 'Psalm 7:1', 'ordinary'),
              ($1, '2026-07-20', 'night', 'Legacy night line.', 'Psalm 8:1', 'ordinary')`,
      [cong],
    );

    const svc = new LiturgyService(testPool(), new FakeAiProvider());
    const now = new Date("2026-07-20T09:00:00Z"); // EAT midday band
    const result = await svc.composeFor(cong, now);
    expect(result.cached).toBe(true); // legacy rows exist → served as-is, never force-recomposed
    expect(result.day.midday.line).toBe("Legacy midday line.");
    // The three new bands aren't in the legacy row set — they gracefully
    // fall back rather than throwing.
    expect(result.day.sunrise.line).toBe(FALLBACK_LITURGY.sunrise.line);
    expect(result.day.afternoon.line).toBe(FALLBACK_LITURGY.afternoon.line);
    expect(result.day.midnight.line).toBe(FALLBACK_LITURGY.midnight.line);

    // current() must not crash reading this legacy day either, and should
    // serve the legacy row's own content for the band it lands in (midday).
    const current = await svc.current(cong, now);
    expect(current.band).toBe("midday");
    expect(current.line).toBe("Legacy midday line.");
    expect(["morning", "midday", "evening", "night"]).toContain(current.part);
  });
});

describe("per-band length guidance", () => {
  it("the prompt encodes a distinct length band for every DayBand, not one global cap", () => {
    // Sunrise/evening earn a fuller paragraph; midday/afternoon stay one breath.
    expect(LITURGY_SYSTEM).toContain("sunrise (45-80 words");
    expect(LITURGY_SYSTEM).toContain("evening (45-80 words");
    expect(LITURGY_SYSTEM).toContain("midday (12-25 words");
    expect(LITURGY_SYSTEM).toContain("afternoon (12-25 words");
    expect(LITURGY_SYSTEM).toContain("morning (25-45 words");
    expect(LITURGY_SYSTEM).toContain("night (25-45 words");
    expect(LITURGY_SYSTEM).toContain("midnight (20-40 words");
    // Not a single uniform cap repeated seven times.
    const distinctLengthPhrases = new Set(
      [...LITURGY_SYSTEM.matchAll(/\d+-\d+ words/g)].map((m) => m[0]),
    );
    expect(distinctLengthPhrases.size).toBeGreaterThan(1);
  });

  it("the fallback set itself varies in length per band (sunrise/evening fuller, midday/afternoon terse)", () => {
    const wc = (s: string) => s.trim().split(/\s+/).length;
    expect(wc(FALLBACK_LITURGY.sunrise.line)).toBeGreaterThanOrEqual(40);
    expect(wc(FALLBACK_LITURGY.evening.line)).toBeGreaterThanOrEqual(40);
    expect(wc(FALLBACK_LITURGY.midday.line)).toBeLessThanOrEqual(25);
    expect(wc(FALLBACK_LITURGY.afternoon.line)).toBeLessThanOrEqual(25);
  });
});
