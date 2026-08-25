// Scripture imagery (owner's ask, 2026-08-25): the picture knows the words
// and the hour. These tests pin the owner's own example — the race verse at
// night — plus the silence rule (no motif → null → caller keeps rotation),
// determinism, and library hygiene (tags only from the known motif set,
// no duplicate URLs — each plan cover must be able to be distinct).
import { describe, it, expect } from "vitest";
import { artForText, THEMED_LIBRARY, MOTIF_KEYWORDS } from "../src/modules/intelligence/imagery.js";

const RACE_VERSE =
  "Do you not know that in a race all the runners run, but only one gets the prize? Run in such a way as to get the prize.";

describe("the picture knows the words and the hour", () => {
  it("the race verse at night finds a runner or the night it is run under", () => {
    const art = artForText(RACE_VERSE, "night", "2026-08-25");
    expect(art).not.toBeNull();
    const entry = THEMED_LIBRARY.find((a) => a.url === art!.url)!;
    expect(entry.themes.some((t) => t === "race" || t === "heavens")).toBe(true);
  });

  it("the same race verse by day prefers the runner in daylight", () => {
    const art = artForText(RACE_VERSE, "morning", "2026-08-25");
    const entry = THEMED_LIBRARY.find((a) => a.url === art!.url)!;
    expect(entry.themes).toContain("race");
    expect(["day", "golden", "any"]).toContain(entry.time);
  });

  it("shepherd words find the flock", () => {
    const art = artForText("The LORD is my shepherd; I shall not want. He makes me lie down in green pastures.", "midday", "2026-08-25");
    const entry = THEMED_LIBRARY.find((a) => a.url === art!.url)!;
    expect(entry.themes.some((t) => ["shepherd", "rest"].includes(t))).toBe(true);
  });

  it("words with no pictured motif stay silent — the caller keeps its rotation", () => {
    expect(artForText("Owe no one anything, except to love each other.", "morning", "2026-08-25")).toBeNull();
    expect(artForText(null, "morning", "2026-08-25")).toBeNull();
  });

  it("the choice is stable within a day", () => {
    const a = artForText(RACE_VERSE, "night", "2026-08-25");
    const b = artForText(RACE_VERSE, "night", "2026-08-25");
    expect(a!.url).toBe(b!.url);
  });

  it("library hygiene: every tag is a known motif and no URL repeats", () => {
    const known = new Set(Object.keys(MOTIF_KEYWORDS));
    const urls = new Set<string>();
    for (const a of THEMED_LIBRARY) {
      expect(a.themes.length).toBeGreaterThan(0);
      for (const t of a.themes) expect(known.has(t)).toBe(true);
      expect(urls.has(a.url)).toBe(false);
      urls.add(a.url);
    }
  });
});
