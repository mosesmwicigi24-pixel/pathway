// Home's photographs keep the hour and the season, and show nature only
// (owner, 2026-10-06 01:42: a crowd of people under soap bubbles sat behind the
// race verse at midnight — "now this is midnight, there must be something
// beautiful demonstrating midnight").
import { describe, it, expect } from "vitest";
import { ART_HOURS, NATURE, artHourOf, cardPool, natureArt, photoUrl, weatherOf, type ArtHour } from "../src/modules/intelligence/nature.js";
import type { Season } from "../src/modules/intelligence/liturgy.js";
import { artForText } from "../src/modules/intelligence/imagery.js";

/** A Nairobi wall-clock time. */
const at = (eat: string): Date => new Date(`${eat}+03:00`);
const photoOf = (url: string) => NATURE.find((p) => photoUrl(p.id) === url)!;
const RACE =
  "Do you not know that in a race all the runners run, but only one gets the prize? Run in such a way as to get the prize.";

// The old pools' people, objects and far-north skies — looked at on contact
// sheets, 2026-10-06. None may come back.
const PEOPLE_AND_OBJECTS = [
  "1502904550040-7534597429ae", // runners on a track (was tagged "night")
  "1476611317561-60117649dd94", // a crowd under soap bubbles (the owner's 01:42 card)
  "1483721310020-03333e577078", // a man lacing his shoes
  "1461896836934-ffe607ba8211", // a sprinter's feet
  "1486218119243-13883505764c", // a runner on a road
  "1465188162913-8fb5709d6d57", // a person on a ridge (was "a lantern in the dark")
  "1416879595882-3373a0480b5b", // a garden trowel
  "1500595046743-cd271d694d30", // a cow's face
  "1454789548928-9efd52dc4031", // an astronaut (was tagged "storm, water")
  "1469571486292-0ba58a3f068b", // painted hands
  "1490730141103-6cac27aaab94", // a person at sunset
  "1506377247377-2a5b3b417ebb", // a wine glass
  "1509440159596-0249088772ff", // bread loaves
];
const NORTHERN_LIGHTS_AND_SNOW = [
  "1483347756197-71ef80e95f73", "1488415032361-b7e238421f1b", "1504858700536-882c978a3464", "1517928260182-5688aead3066",
  "1526644253653-a411eaafdfe6", "1529963183134-61a90db47eaf", "1531366936337-7c912a4589a7", "1568607689150-17e625c1586e",
  "1571371867188-fdc3f1f8e62d", "1604608672516-f1b9b1d37076", "1605286700104-15889419f60b", "1609528911883-fc7e0ee63c51",
  "1610989432929-9769f3cf8006", "1628818144466-856f7d477125", "1637055972140-64608c1abe53", "1621603523799-bbdadeb207c2",
  "1678054055852-0f9d40a24dab",
];

describe("the photograph keeps the hour", () => {
  it("the old picker is what put a daytime crowd behind the race verse at 01:42 — words outranked the hour", () => {
    // Root cause, kept as evidence: artForText scored motif hits (10 per word)
    // far above the time-of-day match (6), so "race … runners … prize" won at
    // midnight with a photograph of a crowd under soap bubbles.
    const old = artForText(RACE, "midnight", "2026-10-06");
    expect(old?.url).toContain("1476611317561-60117649dd94");
  });

  it("01:42 on 6 October: the race verse gets a midnight photograph, not a daytime crowd", () => {
    const art = natureArt("verse", at("2026-10-06T01:42:00"), { season: "ordinary", text: RACE });
    const photo = photoOf(art.url);
    expect(photo.hours).toContain("deepnight");
    expect(PEOPLE_AND_OBJECTS.some((id) => art.url.includes(id))).toBe(false);
    // and the liturgy card beside it is night too, and a different picture
    const liturgy = natureArt("liturgy", at("2026-10-06T01:42:00"), { season: "ordinary" });
    expect(photoOf(liturgy.url).hours).toContain("deepnight");
    expect(liturgy.url).not.toBe(art.url);
  });

  it("the clock follows Nairobi's sun, not four fixed blocks", () => {
    const cases: Array<[string, ArtHour]> = [
      ["00:00", "deepnight"], ["04:59", "deepnight"], ["05:00", "predawn"], ["06:14", "predawn"],
      ["06:15", "sunrise"], ["08:29", "sunrise"], ["08:30", "morning"], ["11:59", "morning"],
      ["12:00", "midday"], ["14:29", "midday"], ["14:30", "afternoon"], ["16:59", "afternoon"],
      ["17:00", "golden"], ["18:14", "golden"], ["18:15", "sunset"], ["19:14", "sunset"],
      ["19:15", "nightfall"], ["23:59", "nightfall"],
    ];
    for (const [hm, hour] of cases) expect(artHourOf(at(`2026-10-06T${hm}:00`)), hm).toBe(hour);
  });

  it("two in the afternoon is never a sunset, and half past eight at night is never daylight", () => {
    for (let d = 1; d <= 60; d++) {
      const day = new Date(Date.UTC(2026, 9, d)).toISOString().slice(0, 10);
      for (const card of ["liturgy", "verse"] as const) {
        expect(photoOf(natureArt(card, at(`${day}T14:00:00`), { season: "ordinary" }).url).hours).toContain("midday");
        expect(photoOf(natureArt(card, at(`${day}T20:30:00`), { season: "ordinary" }).url).hours).toContain("nightfall");
      }
    }
  });

  it("whatever the verse says, the picture is one of this hour's", () => {
    const verses = [RACE, "The LORD is my shepherd", "Be still, and know that I am God", "Your word is a lamp to my feet",
      "He makes me lie down in green pastures; he leads me beside still waters", "Let there be light"];
    for (const hour of ["01:00", "05:30", "07:00", "10:00", "13:00", "15:30", "17:30", "18:45", "21:00"]) {
      const now = at(`2026-10-06T${hour}:00`);
      for (const text of verses) {
        expect(photoOf(natureArt("verse", now, { season: "ordinary", text }).url).hours).toContain(artHourOf(now));
      }
    }
  });
});

describe("the photograph fits the season", () => {
  it("the rains never show a dry savanna; the dry months never show rain", () => {
    for (let d = 0; d < 365; d += 3) {
      const now = new Date(Date.UTC(2026, 0, 1) + d * 86_400_000 + 9 * 3_600_000);
      const w = weatherOf(now);
      for (const card of ["liturgy", "verse"] as const) {
        const p = photoOf(natureArt(card, now, { season: "ordinary" }).url);
        if (p.weather) expect(p.weather, now.toISOString()).toBe(w);
      }
    }
  });

  it("October is the short rains, July is dry, April is the long rains", () => {
    expect(weatherOf(at("2026-10-06T12:00:00"))).toBe("rains");
    expect(weatherOf(at("2026-07-15T12:00:00"))).toBe("dry");
    expect(weatherOf(at("2027-04-10T12:00:00"))).toBe("rains");
    expect(weatherOf(at("2027-01-20T12:00:00"))).toBe("dry");
  });

  it("Advent nights prefer the church year's skies", () => {
    const art = natureArt("verse", at("2026-12-10T02:00:00"), { season: "advent" as Season });
    expect(photoOf(art.url).church ?? []).toContain("advent");
  });
});

describe("the words choose among the hour's photographs", () => {
  it("a verse about water, at two in the morning, gets night over water", () => {
    const art = natureArt("verse", at("2026-10-06T02:00:00"), { season: "ordinary", text: "He leads me beside still waters" });
    const p = photoOf(art.url);
    expect(p.hours).toContain("deepnight");
    expect(p.motifs ?? []).toContain("water");
  });
});

describe("variety, and two cards that never coincide", () => {
  it("every hour has at least four photographs per card in both seasons", () => {
    for (const w of ["rains", "dry"] as const) {
      for (const hour of ART_HOURS) {
        for (const card of ["liturgy", "verse"] as const) {
          expect(cardPool(card, hour, w).length, `${card} ${hour} ${w}`).toBeGreaterThanOrEqual(4);
        }
      }
    }
  });

  it("the liturgy and verse cards never show the same photograph — any hour, any day of a year", () => {
    for (let d = 0; d < 366; d++) {
      for (const hm of ["01:00", "05:30", "07:00", "10:00", "13:00", "15:30", "17:30", "18:45", "21:00"]) {
        const base = new Date(Date.UTC(2026, 0, 1) + d * 86_400_000).toISOString().slice(0, 10);
        const now = at(`${base}T${hm}:00`);
        expect(natureArt("liturgy", now, { season: "ordinary" }).url).not.toBe(natureArt("verse", now, { season: "ordinary" }).url);
      }
    }
  });

  it("the picture changes from day to day — not the same image always", () => {
    const week = new Set<string>();
    for (let d = 1; d <= 7; d++) week.add(natureArt("verse", at(`2026-10-0${d}T01:42:00`), { season: "ordinary" }).url);
    expect(week.size).toBeGreaterThanOrEqual(5);
  });

  it("the whole congregation sees the same picture in a given hour of a given day", () => {
    const a = natureArt("verse", at("2026-10-06T01:10:00"), { season: "ordinary", text: RACE });
    const b = natureArt("verse", at("2026-10-06T04:50:00"), { season: "ordinary", text: RACE });
    expect(a).toEqual(b);
  });
});

describe("nature only", () => {
  it("none of the old people, objects or far-north skies come back", () => {
    const ids = new Set(NATURE.map((p) => p.id));
    for (const id of [...PEOPLE_AND_OBJECTS, ...NORTHERN_LIGHTS_AND_SNOW]) expect(ids.has(id), id).toBe(false);
  });

  it("every entry is a unique Unsplash photograph with at least one hour and a description", () => {
    const ids = NATURE.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of NATURE) {
      expect(p.id).toMatch(/^\d{10,13}-[0-9a-f]{12}$/);
      expect(p.hours.length).toBeGreaterThan(0);
      expect(p.alt.length).toBeGreaterThan(8);
    }
  });
});
