// Scripture imagery — the picture KNOWS the words and the hour (owner's ask,
// 2026-08-25: "the message is the same as the image displayed and at which
// time — a runner at night with stars behind").
//
// One themed, curated library serves every surface that pairs Scripture with
// a photograph: the Verse-for-Today tableau today, plan covers tomorrow
// (each entry is hand-tagged with the biblical MOTIFS it depicts and the
// TIME of day it was shot). Selection is deterministic and free — keyword
// scoring, no model call — so it is testable and never flickers:
//   score = motif hits in the verse text (dominant)
//         + time-of-day affinity with the current band
//         + a per-day stable tie-break.
// Below a minimum motif score the selector returns null and the caller keeps
// its old band rotation — a wrong-but-pretty picture is worse than a general
// one. Every URL in this file was verified live (curl 200) when added; the
// clients already fall back to a quiet gradient if one ever dies.
import type { DayBand, LiturgyArt } from "./liturgy.js";

export type ArtTime = "dawn" | "day" | "golden" | "night" | "any";

export interface ThemedArt extends LiturgyArt {
  themes: readonly string[];
  time: ArtTime;
}

const U = (id: string): string => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1080&q=70`;

/** Biblical motifs → the words that summon them in a verse. Lower-cased. */
export const MOTIF_KEYWORDS: Record<string, readonly string[]> = {
  race: ["race", "run", "runner", "runners", "running", "prize", "press on", "finish", "athlete"],
  path: ["path", "paths", "way", "walk", "walking", "steps", "feet", "road", "journey", "lead", "guide", "lamp"],
  light: ["light", "shine", "shines", "darkness", "dark", "morning star", "dawn"],
  water: ["water", "waters", "river", "rivers", "stream", "streams", "sea", "waves", "thirst", "thirsty", "well", "rain", "fountain"],
  mountain: ["mountain", "mountains", "hill", "hills", "rock", "high places"],
  field: ["seed", "sow", "sows", "harvest", "fruit", "vine", "branch", "branches", "tree", "planted", "grow", "grows", "wheat", "grain", "vineyard"],
  heavens: ["stars", "star", "heavens", "heaven", "sky", "skies", "creation", "created"],
  shepherd: ["shepherd", "sheep", "flock", "pasture", "pastures", "lamb"],
  storm: ["storm", "storms", "wind", "winds", "tempest", "anchor", "boat", "ship"],
  rest: ["rest", "sleep", "peace", "still", "quiet", "quietness", "green pastures", "be still"],
  strength: ["strength", "strong", "eagle", "eagles", "wings", "soar", "mount up", "power"],
  hands: ["hand", "hands", "hold", "holds", "carry", "carries", "lifted"],
  door: ["door", "doors", "gate", "gates", "knock", "open"],
  bread: ["bread", "table", "feast", "eat", "food", "hunger", "hungry"],
  fire: ["fire", "flame", "refine", "furnace", "burn"],
};

/**
 * The curated collection. Tags are honest: an image is tagged with a motif
 * only when the PICTURE actually shows it — the selector's promise to the
 * member ("a runner at night") only holds if the tags hold.
 */
export const THEMED_LIBRARY: readonly ThemedArt[] = [
  // race / movement
  { url: U("1502904550040-7534597429ae"), alt: "Starry night over dark mountains", themes: ["heavens", "mountain"], time: "night" },
  { url: U("1476611317561-60117649dd94"), alt: "A runner on an open road at dusk", themes: ["race", "path"], time: "golden" },
  { url: U("1483721310020-03333e577078"), alt: "A runner training alone", themes: ["race", "strength"], time: "day" },
  { url: U("1461896836934-ffe607ba8211"), alt: "A runner lacing up on a track", themes: ["race"], time: "day" },
  { url: U("1486218119243-13883505764c"), alt: "A road stretching toward the horizon", themes: ["path", "race"], time: "day" },
  // path / way
  { url: U("1441974231531-c6227db76b6e"), alt: "Light falling through a forest path", themes: ["path", "light"], time: "day" },
  { url: U("1500530855697-b586d89ba3ee"), alt: "A footpath through golden fields", themes: ["path", "field"], time: "golden" },
  { url: U("1476820865390-c52aeebb9891"), alt: "A winding mountain road at dawn", themes: ["path", "mountain"], time: "dawn" },
  { url: U("1465188162913-8fb5709d6d57"), alt: "A lantern held out in the dark", themes: ["light", "path"], time: "night" },
  // light / dawn
  { url: U("1470252649378-9c29740c9fa8"), alt: "Sunrise breaking over a quiet field", themes: ["light", "field"], time: "dawn" },
  { url: U("1447752875215-b2761acb3c5d"), alt: "Morning light through forest trees", themes: ["light", "path"], time: "dawn" },
  { url: U("1475924156734-496f6cac6ec1"), alt: "Golden light over the sea", themes: ["light", "water"], time: "golden" },
  // water
  { url: U("1505142468610-359e7d316be0"), alt: "Calm turquoise sea and sky", themes: ["water", "rest"], time: "day" },
  { url: U("1439066615861-d1af74d74000"), alt: "A still lake mirroring the sky", themes: ["water", "rest"], time: "day" },
  { url: U("1444464666168-49d633b86797"), alt: "A river running through green land", themes: ["water", "field"], time: "day" },
  { url: U("1468581264429-2548ef9eb732"), alt: "Waves under an evening sky", themes: ["water", "storm"], time: "golden" },
  // mountains
  { url: U("1506905925346-21bda4d32df4"), alt: "A high mountain range at daylight", themes: ["mountain", "strength"], time: "day" },
  { url: U("1464822759023-fed622ff2c3b"), alt: "Sunlit peaks above the clouds", themes: ["mountain", "heavens"], time: "day" },
  { url: U("1486870591958-9b9d0d1dda99"), alt: "A climber facing the summit at dawn", themes: ["mountain", "race", "strength"], time: "dawn" },
  // field / harvest / growth
  { url: U("1500382017468-9049fed747ef"), alt: "Wheat field ready for harvest", themes: ["field", "bread"], time: "golden" },
  { url: U("1416879595882-3373a0480b5b"), alt: "A young plant growing from soil", themes: ["field"], time: "day" },
  { url: U("1425913397330-cf8af2ff40a1"), alt: "A great tree standing alone in a field", themes: ["field", "strength"], time: "day" },
  { url: U("1445264718234-a623be589d37"), alt: "Vineyard rows in evening light", themes: ["field"], time: "golden" },
  // heavens / stars
  { url: U("1419242902214-272b3f66ee7a"), alt: "The Milky Way over a dark horizon", themes: ["heavens"], time: "night" },
  { url: U("1435224668334-0f82ec57b605"), alt: "Stars above a mountain silhouette", themes: ["heavens", "mountain"], time: "night" },
  { url: U("1475274047050-1d0c0975c63e"), alt: "A sky full of stars over water", themes: ["heavens", "water"], time: "night" },
  // shepherd / flock
  { url: U("1484557985045-edf25e08da73"), alt: "Sheep grazing on a green hillside", themes: ["shepherd", "field", "rest"], time: "day" },
  { url: U("1500595046743-cd271d694d30"), alt: "A shepherd's flock on open pasture", themes: ["shepherd"], time: "day" },
  // storm / sea
  { url: U("1454789548928-9efd52dc4031"), alt: "Storm clouds gathering over the sea", themes: ["storm", "water"], time: "day" },
  { url: U("1505118380757-91f5f5632de0"), alt: "A lone boat on open water", themes: ["storm", "water"], time: "day" },
  // rest / stillness
  { url: U("1476231682828-37e571bc172f"), alt: "Morning mist over still water", themes: ["rest", "water"], time: "dawn" },
  { url: U("1518098268026-4e89f1a2cd8e"), alt: "A quiet bench under evening trees", themes: ["rest"], time: "golden" },
  // strength / wings
  { url: U("1470114716159-e389f8712fda"), alt: "An eagle soaring on high winds", themes: ["strength", "heavens"], time: "day" },
  // hands
  { url: U("1469571486292-0ba58a3f068b"), alt: "Open hands lifted toward the light", themes: ["hands", "light"], time: "day" },
  { url: U("1490730141103-6cac27aaab94"), alt: "Hands raised against a sunrise", themes: ["hands", "light"], time: "dawn" },
  // door / gate
  { url: U("1506377247377-2a5b3b417ebb"), alt: "An old wooden door in golden light", themes: ["door"], time: "golden" },
  // bread / table
  { url: U("1509440159596-0249088772ff"), alt: "Fresh bread on a wooden table", themes: ["bread"], time: "any" },
  // fire
  { url: U("1475738972911-5b44ce984c42"), alt: "Embers glowing in the dark", themes: ["fire"], time: "night" },
];

const BAND_TIME: Record<DayBand, ArtTime> = {
  sunrise: "dawn",
  morning: "day",
  midday: "day",
  afternoon: "golden",
  evening: "golden",
  night: "night",
  midnight: "night",
};

/** FNV-ish stable hash — per-day tie-break, no wall-clock dependence. */
function stableHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * The picture for these words at this hour — or null when no motif genuinely
 * matches (caller keeps its band rotation; a general picture beats a wrong one).
 */
export function artForText(text: string | null | undefined, band: DayBand, dayKey: string): LiturgyArt | null {
  if (!text) return null;
  const low = ` ${text.toLowerCase().replace(/[^a-z\s]/g, " ")} `;
  const motifScore = (a: ThemedArt): number => {
    let s = 0;
    for (const theme of a.themes) {
      for (const kw of MOTIF_KEYWORDS[theme] ?? []) {
        if (low.includes(` ${kw} `)) s += kw.includes(" ") ? 14 : 10;
      }
    }
    return s;
  };
  const wanted = BAND_TIME[band];
  let best: { art: ThemedArt; score: number } | null = null;
  for (const a of THEMED_LIBRARY) {
    const motifs = motifScore(a);
    if (motifs < 10) continue; // at least one real motif hit, or stay silent
    const time = a.time === wanted ? 6 : a.time === "any" ? 3 : 0;
    const tie = stableHash(`${dayKey}:${a.url}`) % 3;
    const score = motifs + time + tie;
    if (!best || score > best.score) best = { art: a, score };
  }
  return best ? { url: best.art.url, alt: best.art.alt } : null;
}
