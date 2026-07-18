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
  FALLBACK_LITURGY,
  LITURGY_ART,
  pickLiturgyArt,
  pickBandArt,
  type DayBand,
} from "../src/modules/intelligence/liturgy.js";
import { FakeAiProvider, type AiProvider } from "../src/modules/assistant/provider.js";

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

describe("composition + cache", () => {
  let cong: string;
  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation();
  });

  it("composes once, caches per congregation+day, and current() serves the clock's part", async () => {
    const svc = new LiturgyService(testPool(), new FakeAiProvider());
    const first = await svc.composeFor(cong);
    expect(first.cached).toBe(false);
    expect(first.day.morning.line).toContain("mercies");

    const again = await svc.composeFor(cong);
    expect(again.cached).toBe(true);

    const rows = await testPool().query(`SELECT count(*)::int AS n FROM liturgies`);
    expect(rows.rows[0].n).toBe(4);

    const now = await svc.current(cong);
    expect(["morning", "midday", "evening", "night"]).toContain(now.part);
    expect(now.line.length).toBeGreaterThan(10);
    expect(now.season).toBeTruthy();
    // The hour's tableau rides along, drawn from that band's curated (liturgy-card) pool.
    expect(now.art.url.startsWith("https://images.unsplash.com/photo-")).toBe(true);
    expect(now.art.alt.length).toBeGreaterThan(5);
    // The finer 7-band clock rides along too: a band, a second authored charge
    // line, and a curated verse-line for that band.
    expect(["sunrise", "morning", "midday", "afternoon", "evening", "night", "midnight"]).toContain(now.band);
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

  it("serves the fallback (uncached) when the model fails, then heals", async () => {
    const broken: AiProvider = {
      name: "broken",
      complete: () => Promise.reject(new Error("model down")),
    };
    const svc = new LiturgyService(testPool(), broken);
    const r = await svc.composeFor(cong);
    expect(r.day.morning.line).toBe(FALLBACK_LITURGY.morning.line);
    const rows = await testPool().query(`SELECT count(*)::int AS n FROM liturgies`);
    expect(rows.rows[0].n).toBe(0); // fallback is never cached

    const healed = await new LiturgyService(testPool(), new FakeAiProvider()).composeFor(cong);
    expect(healed.cached).toBe(false); // composed fresh now that the model is back
  });
});
