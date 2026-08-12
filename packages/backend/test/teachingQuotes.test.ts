// The church's own teaching-quote library (sermon-quotes build, Step 3):
// pure extraction against REAL staged sample text (not synthetic fixtures —
// the whole point of this table is fidelity to what the owner actually
// wrote), plus the DB-facing seeding/selection/usage-tracking behavior.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import {
  extractQuotableLines,
  dedupeQuoteCandidates,
  seedTeachingQuotesFromCorpus,
  selectQuoteCandidates,
  markQuotesUsed,
  DEFAULT_CORPUS_DIR,
  EXCLUDED_SLUGS,
  OWNER_ATTRIBUTION,
  type QuoteCandidate,
} from "../src/modules/intelligence/teachingQuotes.js";

afterAll(async () => {
  await closeTestPool();
});

/** Loads a real staged corpus file's body (header stripped by the
 *  extractor itself) — tests assert against the OWNER'S ACTUAL WORDS as
 *  staged in Step 1, not synthetic strings, per the task's own test spec. */
function loadCorpusFile(slug: string): string {
  return readFileSync(join(DEFAULT_CORPUS_DIR, `${slug}.txt`), "utf8");
}

describe("extractQuotableLines — real staged sample text", () => {
  it("keeps the exact teaching lines named as ground truth, drops Scripture", () => {
    const greatQuotes = extractQuotableLines(loadCorpusFile("great-quotes"), {
      title: "great quotes",
      ref: "1UzyrIc_qC6DWFA3wiOdCk4nFQ7hpHCyc",
    });
    const texts = greatQuotes.map((c) => c.text);
    expect(texts).toContain("The role of the spirit is to deliver the mind of God.");

    const bearingFruits = extractQuotableLines(loadCorpusFile("bearing-fruits"), {
      title: "Bearing Fruits",
      ref: "15GvcYr35oCHP7aJpPhB8zqSTLPnmC9p6",
    });
    const bfTexts = bearingFruits.map((c) => c.text);
    expect(bfTexts).toContain("The word in season changes people’s seasons.");
    expect(bfTexts).toContain("Knowing a thing is knowledge, applying knowledge is wisdom.");
    // None of Bearing Fruits' many Scripture quotations (Psalm 1:3, John
    // 15:1-4, Genesis 1:11-12, Mathew 7:7, ...) survive as a candidate.
    for (const t of bfTexts) {
      expect(t).not.toMatch(/\b[1-3]?\s?[A-Z][A-Za-z]+\.?\s+\d{1,3}:\d{1,3}/);
    }
    expect(bfTexts.some((t) => /streams of water/i.test(t))).toBe(false); // Psalm 1:3
    expect(bfTexts.some((t) => /true vine/i.test(t))).toBe(false); // John 15:1

    const mindset = extractQuotableLines(loadCorpusFile("change-your-mindset"), {
      title: "Change your mindset",
      ref: "1bUToLNjP7FHxKriNT_ks79P0HSLW0FaD",
    });
    const mindsetTexts = mindset.map((c) => c.text);
    expect(mindsetTexts).toContain("Our mindset dictates the lenses that we use to see.");
    expect(mindsetTexts).toContain("Your purpose is hidden in your understanding of Gods will.");
    expect(mindsetTexts.some((t) => /pour new wine into an old wineskin/i.test(t))).toBe(false); // Mark 2:22
  });

  it("drops sermon scaffolding, headings, and fragments outside the 6-25 word window", () => {
    const candidates = extractQuotableLines("Faith\n\nHebrew 11\n\nMoses\n\nDavid\n\nPaul", {
      title: "x",
      ref: "x",
    });
    expect(candidates).toEqual([]); // every fragment here is a 1-word heading/name
  });

  it("drops lines naming a private individual found in the corpus", () => {
    const candidates = extractQuotableLines(loadCorpusFile("how-much-is-one-mans-gift"), {
      title: "How much is one man's gift",
      ref: "1JEL4S8Fm4hROqmrDsYXYP9HePjV_-wCS",
    });
    expect(candidates.some((c) => /Wairimu/i.test(c.text))).toBe(false);
  });

  it("drops witchcraft/demonic-content lines even from an otherwise-included document", () => {
    const candidates = extractQuotableLines(loadCorpusFile("covenants"), {
      title: "Covenants",
      ref: "1aJLKG4FxkcmznV0lPMHLFPM1lTHmVqkv",
    });
    for (const c of candidates) {
      expect(c.text).not.toMatch(/witch|demon|curse|occult|divination|sorcery|molek/i);
    }
  });

  it("drops the guest-speaker document and the excluded-book documents entirely when seeding (see EXCLUDED_SLUGS)", () => {
    expect(EXCLUDED_SLUGS.has("leadership")).toBe(true);
    expect(EXCLUDED_SLUGS.has("influencing-the-salt")).toBe(true);
    expect(EXCLUDED_SLUGS.has("heavenly-marriages")).toBe(true);
    expect(EXCLUDED_SLUGS.has("the-power-of-becoming")).toBe(true);
    expect(EXCLUDED_SLUGS.has("leader-without-a-title")).toBe(true);
    expect(EXCLUDED_SLUGS.has("altars-and-covenants")).toBe(true);
    expect(EXCLUDED_SLUGS.has("faith")).toBe(true); // near-verbatim Hebrews 11 paraphrase
    expect(EXCLUDED_SLUGS.has("he-is-coming-like-a-thief")).toBe(true); // PDF mid-sentence line-wrap artifacts
    // A genuinely-owned document stays eligible.
    expect(EXCLUDED_SLUGS.has("great-quotes")).toBe(false);
  });

  it("strips the embedded third-party paragraph from 'Be transformed' while keeping its own lines", () => {
    const candidates = extractQuotableLines(loadCorpusFile("be-transformed"), {
      title: "Be transformed",
      ref: "15Yhv2E31wYeypm0RekRk7aK47gv2acGu",
    });
    const texts = candidates.map((c) => c.text);
    expect(texts).toContain("The key to learning is to sit down and the key to speed is to wait.");
    expect(texts.some((t) => /Christ-exalting Christians/i.test(t))).toBe(false);
    expect(texts.some((t) => /metemorph/i.test(t))).toBe(false);
  });

  it("every surviving candidate is 6-25 words and ends with terminal punctuation", () => {
    const all = [
      "great-quotes",
      "bearing-fruits",
      "change-your-mindset",
      "destiny",
      "knowing-your-assignment",
    ].flatMap((slug) => extractQuotableLines(loadCorpusFile(slug), { title: slug, ref: slug }));
    for (const c of all) {
      const words = c.text.split(/\s+/).length;
      expect(words).toBeGreaterThanOrEqual(6);
      expect(words).toBeLessThanOrEqual(25);
      expect(c.text).toMatch(/[.!?]["'”’]?$/); // terminal punctuation, possibly inside a closing quote mark
    }
  });
});

describe("dedupeQuoteCandidates", () => {
  it("collapses the same line repeated across documents, case/punctuation-insensitive", () => {
    const candidates: QuoteCandidate[] = [
      { text: "Our mindset dictates the lenses that we use to see.", sourceTitle: "Doc A", sourceRef: "a" },
      { text: "our mindset dictates the lenses that we use to see", sourceTitle: "Doc B (repeat)", sourceRef: "b" },
      { text: "Your purpose is hidden in your understanding of Gods will.", sourceTitle: "Doc A", sourceRef: "a" },
    ];
    const deduped = dedupeQuoteCandidates(candidates);
    expect(deduped).toHaveLength(2);
    expect(deduped[0]!.sourceTitle).toBe("Doc A"); // first occurrence wins
  });
});

describe("seedTeachingQuotesFromCorpus — real Postgres", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("seeds from the real staged corpus and reports documents/quotes counts", async () => {
    const result = await seedTeachingQuotesFromCorpus(testPool());
    expect(result.documentsRead).toBeGreaterThanOrEqual(30);
    expect(result.documentsExcluded).toBe(EXCLUDED_SLUGS.size);
    expect(result.quotesInserted).toBeGreaterThan(0);

    const { rows } = await testPool().query<{ n: string; attribution: string }>(
      `SELECT count(*)::text AS n, min(attribution) AS attribution FROM teaching_quotes`,
    );
    expect(Number(rows[0]!.n)).toBe(result.quotesInserted);
    expect(rows[0]!.attribution).toBe(OWNER_ATTRIBUTION);

    // Nothing from an excluded document made it in.
    const leaked = await testPool().query(
      `SELECT 1 FROM teaching_quotes WHERE source_ref = $1 LIMIT 1`,
      ["1WmXNdG6SmJN5y4hZleY2u2gCxh4MXEm5"], // Leadership's Drive id
    );
    expect(leaked.rows).toHaveLength(0);
  });

  it("is idempotent — re-running inserts nothing new", async () => {
    const first = await seedTeachingQuotesFromCorpus(testPool());
    expect(first.quotesInserted).toBeGreaterThan(0);

    const second = await seedTeachingQuotesFromCorpus(testPool());
    expect(second.quotesInserted).toBe(0);
    expect(second.duplicatesSkipped).toBe(first.quotesInserted);

    const { rows } = await testPool().query<{ n: string }>(`SELECT count(*)::text AS n FROM teaching_quotes`);
    expect(Number(rows[0]!.n)).toBe(first.quotesInserted); // unchanged
  });

  it("every seeded row carries attribution, a source title, and a Drive-id source ref", async () => {
    await seedTeachingQuotesFromCorpus(testPool());
    const { rows } = await testPool().query<{
      attribution: string;
      source_title: string;
      source_ref: string;
      quote_text: string;
    }>(`SELECT attribution, source_title, source_ref, quote_text FROM teaching_quotes`);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.attribution).toBe(OWNER_ATTRIBUTION);
      expect(r.source_title.length).toBeGreaterThan(0);
      expect(r.source_ref.length).toBeGreaterThan(0);
      expect(r.quote_text.length).toBeGreaterThan(0);
    }
  });
});

describe("selectQuoteCandidates — rotation avoids repetition", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function insertQuote(text: string, opts: { isActive?: boolean; lastUsedAt?: string } = {}): Promise<string> {
    const { rows } = await testPool().query<{ quote_id: string }>(
      `INSERT INTO teaching_quotes (quote_text, attribution, source_title, source_ref, is_active, last_used_at)
       VALUES ($1, $2, 'Test Sermon', 'test-ref', $3, $4)
       RETURNING quote_id`,
      [text, OWNER_ATTRIBUTION, opts.isActive ?? true, opts.lastUsedAt ?? null],
    );
    return rows[0]!.quote_id;
  }

  it("returns [] against an empty table — the library is an enhancement, never a dependency", async () => {
    const candidates = await selectQuoteCandidates(testPool());
    expect(candidates).toEqual([]);
  });

  it("excludes a quote used within the lookback window, includes one used long ago", async () => {
    // insertQuote's last_used_at parameter binds a literal, so set the real
    // relative timestamps with a follow-up UPDATE instead.
    const recent = await insertQuote("A quote that was used just yesterday in the liturgy.");
    await testPool().query(`UPDATE teaching_quotes SET last_used_at = now() - interval '1 day' WHERE quote_id = $1`, [recent]);
    const old = await insertQuote("A quote that has not been used in a very long time here.");
    await testPool().query(`UPDATE teaching_quotes SET last_used_at = now() - interval '30 days' WHERE quote_id = $1`, [old]);
    const never = await insertQuote("A quote that has genuinely never been used by the liturgy yet.");

    const candidates = await selectQuoteCandidates(testPool(), { excludeUsedWithinDays: 14 });
    const ids = candidates.map((c) => c.quoteId);
    expect(ids).not.toContain(recent);
    expect(ids).toContain(old);
    expect(ids).toContain(never);
  });

  it("excludes inactive quotes", async () => {
    const inactive = await insertQuote("A quote the church has decided not to surface anymore today.", { isActive: false });
    const candidates = await selectQuoteCandidates(testPool());
    expect(candidates.map((c) => c.quoteId)).not.toContain(inactive);
  });

  it("every returned candidate carries attribution — a surfaced quote is never anonymous", async () => {
    await insertQuote("Every quote offered to the composer must carry its own attribution.");
    const candidates = await selectQuoteCandidates(testPool());
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.attribution).toBe(OWNER_ATTRIBUTION);
      expect(c.sourceTitle.length).toBeGreaterThan(0);
    }
  });

  it("markQuotesUsed rotates a quote out of the next selection", async () => {
    const a = await insertQuote("The first quote that will be marked used right now today.");
    const b = await insertQuote("The second quote that stays fresh and eligible for selection.");

    const before = await selectQuoteCandidates(testPool());
    expect(before.map((c) => c.quoteId).sort()).toEqual([a, b].sort());

    await markQuotesUsed(testPool(), [a]);

    const after = await selectQuoteCandidates(testPool());
    const afterIds = after.map((c) => c.quoteId);
    expect(afterIds).not.toContain(a);
    expect(afterIds).toContain(b);

    const { rows } = await testPool().query<{ use_count: number; last_used_at: Date | null }>(
      `SELECT use_count, last_used_at FROM teaching_quotes WHERE quote_id = $1`,
      [a],
    );
    expect(rows[0]!.use_count).toBe(1);
    expect(rows[0]!.last_used_at).not.toBeNull();
  });

  it("markQuotesUsed is a safe no-op for an empty list", async () => {
    await expect(markQuotesUsed(testPool(), [])).resolves.toBeUndefined();
  });
});
