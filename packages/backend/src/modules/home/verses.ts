// Tailored "Verse for today" — the curated pool + deterministic per-member picker.
//
// DESIGN (read before editing):
//  - Scripture is NEVER AI-generated or AI-selected. We surface a vetted, well-
//    known reference from a hand-curated pool, tagged by pastoral THEME. The verse
//    TEXT is fetched by the client from the existing /scripture service (a real
//    translation), so we only ever choose a *reference* here. This keeps doctrine
//    safe and deterministic while the *which verse* decision is personal.
//  - The member's THEME is chosen from their real growth signals (see service.ts
//    `verseTheme`): the discipline they're leaning into / need encouragement in.
//  - Selection is deterministic for a given (user, day) so it's stable through the
//    day and explainable, and it avoids verses the member has seen recently.
//
// To extend: add references to a theme list, or add a new theme + its reason line.
// Keep references in a form the /scripture endpoint accepts ("Book C:V" or ranges).

export type VerseTheme =
  | "foundations" // brand-new believer — identity & new life
  | "return" // welcoming a member back after a lapse — grace
  | "prayer"
  | "word" // time in Scripture / memorization
  | "habits" // faithfulness & perseverance in the daily rhythm
  | "growth" // wisdom & maturity (the pathway/curriculum)
  | "fellowship" // gathering with the body
  | "uplift"; // a word over a member who is thriving everywhere

/** Curated, theologically-vetted references per theme (public-domain friendly). */
export const VERSE_POOL: Record<VerseTheme, string[]> = {
  foundations: ["John 3:16", "2 Corinthians 5:17", "Ephesians 2:8-9", "John 1:12", "Romans 10:9", "1 Peter 2:9", "Romans 8:1"],
  return: ["Lamentations 3:22-23", "Joel 2:25", "Luke 15:20", "Isaiah 43:18-19", "Psalm 103:8-12", "Philippians 1:6", "Jeremiah 31:3"],
  prayer: ["Philippians 4:6-7", "1 Thessalonians 5:16-18", "Matthew 6:6", "Jeremiah 33:3", "Mark 11:24", "Psalm 145:18", "James 5:16"],
  word: ["Psalm 119:105", "Joshua 1:8", "2 Timothy 3:16-17", "Hebrews 4:12", "Psalm 119:11", "Matthew 4:4", "Isaiah 40:8"],
  habits: ["Galatians 6:9", "1 Corinthians 15:58", "Lamentations 3:22-23", "Philippians 3:13-14", "Hebrews 12:1-2", "Colossians 3:23", "Proverbs 4:23"],
  growth: ["Proverbs 1:7", "James 1:5", "2 Peter 3:18", "Colossians 1:9-10", "Proverbs 9:10", "Psalm 1:1-3", "Ephesians 4:15"],
  fellowship: ["Hebrews 10:24-25", "Acts 2:42", "Ecclesiastes 4:9-10", "Romans 12:5", "1 Corinthians 12:27", "Psalm 133:1", "Galatians 6:2"],
  uplift: ["Jeremiah 29:11", "Romans 8:28", "Psalm 100:4", "Philippians 4:13", "Isaiah 41:10", "Romans 12:1-2", "Ephesians 2:10", "Psalm 37:4"],
};

/** A short, warm "why this verse is for you" line shown under the reference. */
export const THEME_REASON: Record<VerseTheme, string> = {
  foundations: "A foundation for the journey you've begun.",
  return: "Grace to welcome you back.",
  prayer: "Because you're leaning into prayer right now.",
  word: "To strengthen your time in the Word.",
  habits: "A word of strength for your daily rhythm.",
  growth: "For your next step of growth.",
  fellowship: "A reminder you belong to the body.",
  uplift: "A word over your life today.",
};

/** Stable 32-bit hash of a string (FNV-1a) — deterministic across runs/processes. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Pick today's verse reference for a member: deterministic for (userId, dayKey),
 * drawn from the theme's pool, skipping any reference in `recent` (verses already
 * served lately) when possible so the same member sees variety day to day.
 */
export function pickVerse(theme: VerseTheme, userId: string, dayKey: string, recent: readonly string[] = []): string {
  const pool = VERSE_POOL[theme] ?? VERSE_POOL.uplift;
  const seen = new Set(recent);
  const start = hash(`${userId}|${dayKey}`) % pool.length;
  // Walk the pool from a deterministic offset; take the first not-recently-seen.
  for (let i = 0; i < pool.length; i++) {
    const ref = pool[(start + i) % pool.length]!;
    if (!seen.has(ref)) return ref;
  }
  // Everything in the pool was seen recently — fall back to the deterministic pick.
  return pool[start]!;
}

// ============================ Verse art =====================================
// The tableau layer: each theme carries a small, hand-curated set of warm,
// faceless photographs (fruit on the vine, bread, wheat at dawn, still water)
// so the day's verse arrives as something beheld, not only read. Server-chosen
// so every surface agrees; clients fall back to the plain card offline. All
// URLs verified live at curation time; Unsplash CDN with width/quality caps
// keeps the download modest on mobile data.

export interface VerseArt {
  url: string;
  alt: string;
}

const U = (id: string) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1080&q=70`;

export const VERSE_ART: Record<VerseTheme, VerseArt[]> = {
  foundations: [
    { url: U("1457530378978-8bac673b8062"), alt: "New seedlings breaking through the soil" },
    { url: U("1507525428034-b723cf961d3e"), alt: "A soft sunrise over a quiet shore" },
    { url: U("1433086966358-54859d0ed716"), alt: "A waterfall pouring through green cliffs" },
  ],
  return: [
    { url: U("1470071459604-3b5ec3a7fe05"), alt: "The sun breaking over a green valley" },
    { url: U("1506744038136-46273834b3fb"), alt: "Morning mist lifting off a mountain river" },
    { url: U("1470252649378-9c29740c9fa8"), alt: "Golden sunrise over an open field" },
  ],
  prayer: [
    { url: U("1495616811223-4d98c6e9c869"), alt: "A still lake and jetty at dusk" },
    { url: U("1475924156734-496f6cac6ec1"), alt: "Dawn light over a quiet sea" },
    { url: U("1418065460487-3e41a6c84dc5"), alt: "Mist resting on a pine forest" },
    { url: U("1519681393784-d120267933ba"), alt: "A sky full of stars over the mountains" },
  ],
  word: [
    { url: U("1504052434569-70ad5836ab65"), alt: "An open Bible held in one hand" },
    { url: U("1470115636492-6d2b56f9146d"), alt: "Light breaking through tall trees onto the road" },
    { url: U("1519791883288-dc8bd696e667"), alt: "An open book glowing with warm light" },
    { url: U("1544716278-ca5e3f4abd8c"), alt: "An open book beside morning coffee" },
  ],
  habits: [
    { url: U("1476820865390-c52aeebb9891"), alt: "A long road through autumn trees" },
    { url: U("1441974231531-c6227db76b6e"), alt: "A sunlit path through the forest" },
    { url: U("1447752875215-b2761acb3c5d"), alt: "A footbridge leading into the woods" },
  ],
  growth: [
    { url: U("1537640538966-79f369143f8f"), alt: "Grapes ripening on the vine in golden light" },
    { url: U("1423483641154-5411ec9c0ddf"), alt: "Two hands full of harvested grapes" },
    { url: U("1502082553048-f009c37129b9"), alt: "A great tree standing alone in a green field" },
  ],
  fellowship: [
    { url: U("1549931319-a545dcf3bc73"), alt: "A loaf of bread, sliced and ready to share" },
    { url: U("1464226184884-fa280b87c399"), alt: "Bowls of fresh harvest vegetables" },
    { url: U("1518495973542-4542c06a5843"), alt: "Sunlight through the canopy of a great tree" },
  ],
  uplift: [
    { url: U("1490750967868-88aa4486c946"), alt: "Golden poppies open to a blue sky" },
    { url: U("1465146344425-f00d5f5c8f07"), alt: "Wildflowers scattered through a wheat field" },
    { url: U("1500382017468-9049fed747ef"), alt: "Sun rays pouring over a wheat field" },
  ],
};

/**
 * Deterministic art for (user, day): same tableau all day, fresh tomorrow.
 * Mood-library themes ("Gratitude", "Fear & Anxiety", …) aren't art-keyed —
 * they draw from the union of every pool so each day still lands somewhere
 * beautiful rather than always on one theme's images.
 */
export function pickVerseArt(theme: VerseTheme | string, userId: string, dayKey: string): VerseArt {
  const pool = VERSE_ART[(theme as VerseTheme)] ?? Object.values(VERSE_ART).flat();
  return pool[hash(`${userId}|${dayKey}|art`) % pool.length]!;
}
