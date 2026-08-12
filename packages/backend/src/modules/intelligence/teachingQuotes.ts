// The church's own teaching-quote library (STEP 3 of the sermon-quotes
// build — see scripts/sermon-corpus/CURATION.md for the source review and
// scripts/sermon-corpus/*.txt for the staged raw text, Step 1).
//
// Two halves live in this one file, same convention as liturgy.ts:
//   - pure extraction (extractQuotableLines / dedupeQuoteCandidates) — reads
//     staged corpus text and pulls out short, standalone, non-Scripture
//     teaching lines in the owner's own voice. No I/O, directly testable
//     against real sample text.
//   - DB-facing (seedTeachingQuotesFromCorpus / selectQuoteCandidates /
//     markQuotesUsed) — idempotent seeding + rotation-aware selection for
//     the liturgy composer (see liturgy.ts).
//
// HARD RULE (owner-issued): only the owner's own words go in this table.
// Scripture is dropped — it belongs to the liturgy's scripture spine
// (spineFor() in liturgy.ts), and re-attributing it to the owner would be
// wrong. Sermon scaffolding, headings, fragments, and anything naming a
// private individual are dropped too. A handful of documents on
// CURATION.md's owner-approved INCLUDE list turned out, on inspection, not
// to be safe to attribute to him (embedded third-party copyrighted text, a
// guest speaker's own words, or no identifiable first-person voice) — see
// EXCLUDED_SLUGS below and CURATION.md's addendum for the specific reason
// for each.
import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const here = dirname(fileURLToPath(import.meta.url));
/** packages/backend/src/modules/intelligence -> packages/backend/scripts/sermon-corpus */
export const DEFAULT_CORPUS_DIR = join(here, "..", "..", "..", "scripts", "sermon-corpus");

/** Attribution convention already established for the owner's own voice
 *  elsewhere in the app — see home/verses.ts's ENCOURAGEMENTS ("— Pastor
 *  Moses"). Kept as one constant so it only needs to change in one place. */
export const OWNER_ATTRIBUTION = "Pastor Moses";

/** Staged documents (matched by file basename, without extension) that
 *  CURATION.md's owner-approved INCLUDE list named, but that turned out on
 *  inspection not to be safe to attribute to the owner. See
 *  scripts/sermon-corpus/CURATION.md's addendum for the full reasoning
 *  behind each: two contain large unattributed excerpts from other named
 *  authors (a Piper-style sermon, a Forbes.com article, a Crossway.org
 *  book, dadabhagwan.org), one is explicitly credited to a guest speaker,
 *  and one reads as collected external aphorisms with no first-person
 *  voice. Their raw text stays staged for audit; they are simply never
 *  fed to the extractor. */
export const EXCLUDED_SLUGS: ReadonlySet<string> = new Set([
  "leadership",
  "the-power-of-becoming",
  "heavenly-marriages",
  "influencing-the-salt",
  "leader-without-a-title",
]);

/** Verbatim strings identified as another author's words that survived
 *  into an otherwise-kept staged document (see CURATION.md's addendum) —
 *  matched by substring so a rewrapped/re-punctuated copy still gets
 *  caught. Currently just the Piper "renewal of the mind" passage embedded
 *  in "Be transformed" (the same passage that's part of why "Leadership"
 *  is excluded wholesale above). */
const KNOWN_NON_ORIGINAL_LINES: readonly string[] = [
  "We are perfectly useless as Christ-exalting Christians",
  "The word “transformed” is used one time in all the gospels",
  "Don’t become so well-adjusted to your culture",
];

// A "Book C:V" or "Book C:V-V" reference, anywhere in the candidate —
// almost always means the line is Scripture or Scripture-adjacent
// commentary quoting it directly (this pastor's own style always keeps
// the reference right next to the quoted text). Name-agnostic on purpose:
// the corpus has misspelled book names ("Mathew", "Hebrew") that a fixed
// book list would miss.
const SCRIPTURE_REF_RE = /\b[1-3]?\s?[A-Z][A-Za-z]+\.?\s+\d{1,3}:\d{1,3}(?:[-–]\d{1,3})?\b/;
// Any hyperlink (markdown or bare) is a strong signal of copied/cited
// material — this also happens to catch most of the theological-commentary
// blocks identified during review (biblegateway.com, biblestudytools.com,
// biblia.com, knowing-jesus.com, esv.org, crossway.org, ...).
const URL_RE = /https?:\/\/|\[[^\]]*\]\(/;
// Sermon scaffolding / anecdotes that name real people.
const NAMED_SOURCE_RE = /\b(testimony|speaker:|personal testimony)\b/i;
// Sensitivity filter — mirrors CURATION.md EXCLUDE §2's own rationale ("a
// member meeting this material at 6am, with no context and no pastor
// present, is a pastoral harm the app would be causing"). Applied to every
// candidate line from every document, not just the sermons CURATION.md
// named, since several INCLUDEd documents (Gates and Doors, Gatekeepers,
// Covenants, Altars and Covenants, Hearing from the Lord: Dreams) share
// the same witchcraft/curses/demonic-covenant subject matter.
const SENSITIVE_RE = /\b(witch\w*|demon\w*|curs(e|ed|es|ing)\b|occult\w*|divination\w*|diviners?|sorcer\w*|satan\w*|spell(s|ed|ing)?\b|medium\w*|spiritist\w*|molek\w*|possession\w*|exorcis\w*)\b/i;
// A light net for the specific private individuals named in this corpus
// (found during the Drive review) — not a general name-recognition system.
const PRIVATE_NAME_RE = /\b(Wairimu|Nganga|Jackline|Lennie|Shelley Zalis|Robyn Ward)\b/;

const MIN_WORDS = 6;
const MAX_WORDS = 25;

function stripMarkup(line: string): string {
  return line
    .replace(/^\s*[-•*]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .trim();
}

/** A fragment that ends mid-sentence (trailing comma, or a coordinating
 *  conjunction) needs the next fragment merged in before it means
 *  anything on its own — e.g. staged bullets "Knowing a thing is
 *  knowledge," / "applying knowledge is wisdom." split across two lines
 *  by the source document's own formatting. */
const CONTINUES_RE = /(,|\b(?:and|or|but|so)\s*)$/i;
// Sentence boundary within a single raw line — splits "...mindset. The
// flesh..." into two fragments so two unrelated sentences typed on one
// line don't get glued into one over-long candidate.
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+(?=[A-Z])/;
// A block that is JUST a Scripture reference (optionally with a short
// translation code, e.g. "John 15:1-4" or "Proverbs 3:13-16 NET") and
// nothing else. This pastor's style sometimes writes the reference on its
// own line, then the quoted verse text as the NEXT paragraph with no
// reference repeated in it — SCRIPTURE_REF_RE alone can't see that, so a
// reference-only block poisons (drops) the block that immediately follows
// it. See the "true vine" regression this caught in teachingQuotes.test.ts.
const REFERENCE_ONLY_BLOCK_RE = /^[1-3]?\s?[A-Z][A-Za-z]+\.?\s+\d{1,3}:\d{1,3}(?:[-–]\d{1,3})?(?:,\s?\d{1,3}(?::\d{1,3})?)?(?:\s*[A-Za-z]{2,6}\.?)?$/;

export interface QuoteCandidate {
  text: string;
  sourceTitle: string;
  sourceRef: string;
}

export interface QuoteSource {
  title: string;
  ref: string;
}

/** Splits one staged document's raw text into candidate teaching lines.
 *  Pure (no I/O) — directly unit-testable against real staged sample text.
 *  Drops Scripture, sermon scaffolding, headings, fragments, sensitive
 *  spiritual-warfare content, and anything naming a private individual;
 *  keeps lines that stand alone and mean something out of context. */
export function extractQuotableLines(text: string, source: QuoteSource): QuoteCandidate[] {
  const body = text.replace(/^#.*\n/gm, "").trim(); // drop the staging header block
  const blocks = body.split(/\n\s*\n/);
  const out: QuoteCandidate[] = [];

  let skipNextBlock = false;
  for (const block of blocks) {
    const stripped = stripMarkup(block.replace(/\n/g, " ").replace(/\s+/g, " ").trim());
    const isReferenceOnly = REFERENCE_ONLY_BLOCK_RE.test(stripped);
    if (skipNextBlock) {
      skipNextBlock = isReferenceOnly; // a reference block immediately after another still poisons the next
      continue;
    }
    if (isReferenceOnly) {
      skipNextBlock = true;
      continue; // too short to be a candidate anyway, but be explicit
    }

    const fragments = block
      .split("\n")
      .map(stripMarkup)
      .filter((l) => l.length > 0)
      .flatMap((l) => l.split(SENTENCE_SPLIT_RE));

    let buffer = "";
    const flush = () => {
      const candidate = finalizeCandidate(buffer, source);
      if (candidate) out.push(candidate);
      buffer = "";
    };
    for (const fragment of fragments) {
      buffer = buffer ? `${buffer} ${fragment}` : fragment;
      if (!CONTINUES_RE.test(buffer)) flush();
    }
    flush();
  }
  return out;
}

function finalizeCandidate(raw: string, source: QuoteSource): QuoteCandidate | null {
  const candidate = raw.replace(/\s+/g, " ").trim();
  if (!candidate) return null;
  if (SCRIPTURE_REF_RE.test(candidate)) return null;
  if (URL_RE.test(candidate)) return null;
  if (NAMED_SOURCE_RE.test(candidate)) return null;
  if (SENSITIVE_RE.test(candidate)) return null;
  if (PRIVATE_NAME_RE.test(candidate)) return null;
  if (KNOWN_NON_ORIGINAL_LINES.some((known) => candidate.includes(known))) return null;

  const wordCount = candidate.split(/\s+/).length;
  if (wordCount < MIN_WORDS || wordCount > MAX_WORDS) return null;

  // ALL-CAPS heading fragments ("AVOID THE ISSUES THAT CAN DEFILE YOUR
  // DESTINY.") are document structure, not a spoken teaching line.
  const letters = candidate.replace(/[^A-Za-z]/g, "");
  if (letters.length > 8 && letters === letters.toUpperCase()) return null;

  const text = /[.!?]$/.test(candidate) ? candidate : `${candidate}.`;
  return { text, sourceTitle: source.title, sourceRef: source.ref };
}

function dedupKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Deduplicates candidates across (or within) documents by normalized
 *  (case/punctuation-insensitive) text equality — first occurrence wins.
 *  The corpus is full of near-duplicate files and repeated lines (see
 *  CURATION.md #4); this is the fix at the extraction layer, on top of
 *  the DB's own UNIQUE(quote_text) as a second, idempotency-focused line
 *  of defense. */
export function dedupeQuoteCandidates(candidates: QuoteCandidate[]): QuoteCandidate[] {
  const seen = new Set<string>();
  const out: QuoteCandidate[] = [];
  for (const c of candidates) {
    const key = dedupKey(c.text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// ============================== DB-facing ===================================

export interface SeedResult {
  documentsRead: number;
  documentsExcluded: number;
  candidatesExtracted: number;
  quotesInserted: number;
  duplicatesSkipped: number;
}

/** Reads every staged .txt in corpusDir, extracts + dedupes quotable
 *  lines, and idempotently upserts them (ON CONFLICT (quote_text) DO
 *  NOTHING — a re-run inserts nothing new and reports it via
 *  duplicatesSkipped, never duplicating a row). */
export async function seedTeachingQuotesFromCorpus(pool: Pool, corpusDir: string = DEFAULT_CORPUS_DIR): Promise<SeedResult> {
  const files = readdirSync(corpusDir)
    .filter((f) => f.endsWith(".txt"))
    .sort();

  let documentsRead = 0;
  let documentsExcluded = 0;
  const allCandidates: QuoteCandidate[] = [];

  for (const file of files) {
    const slug = basename(file, ".txt");
    documentsRead += 1;
    if (EXCLUDED_SLUGS.has(slug)) {
      documentsExcluded += 1;
      continue;
    }
    const raw = readFileSync(join(corpusDir, file), "utf8");
    const titleMatch = raw.match(/^# (.+)$/m);
    const refMatch = raw.match(/^# Drive file id: (.+)$/m);
    const source: QuoteSource = {
      title: titleMatch ? titleMatch[1]!.trim() : slug,
      ref: refMatch ? refMatch[1]!.trim() : slug,
    };
    allCandidates.push(...extractQuotableLines(raw, source));
  }

  const deduped = dedupeQuoteCandidates(allCandidates);

  let quotesInserted = 0;
  let duplicatesSkipped = 0;
  for (const c of deduped) {
    const { rows } = await pool.query(
      `INSERT INTO teaching_quotes (quote_text, attribution, source_title, source_ref)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (quote_text) DO NOTHING
       RETURNING quote_id`,
      [c.text, OWNER_ATTRIBUTION, c.sourceTitle, c.sourceRef],
    );
    if (rows.length > 0) quotesInserted += 1;
    else duplicatesSkipped += 1;
  }

  return { documentsRead, documentsExcluded, candidatesExtracted: deduped.length, quotesInserted, duplicatesSkipped };
}

export interface TeachingQuote {
  quoteId: string;
  quoteText: string;
  attribution: string;
  sourceTitle: string;
  theme: string | null;
}

export interface QuoteSelectionOptions {
  /** How many candidates to hand the liturgy composer. Default 6. */
  limit?: number;
  /** Draws randomly from this many least-recently-used rows, so the exact
   *  set offered isn't the same every day even before rotation kicks in.
   *  Default 20. */
  poolSize?: number;
  /** A quote used within this many days is excluded outright — matches
   *  the liturgy's own 14-day prior-lines memory window (see
   *  LiturgyService.priorLines() in liturgy.ts). Default 14. */
  excludeUsedWithinDays?: number;
}

/** Picks a small, rotating set of not-recently-used active quotes to offer
 *  the liturgy composer. Least-recently-used (nulls — never used — first)
 *  is the ordering; a poolSize-wide slice of that is shuffled so the
 *  offered set varies day to day while the whole library still cycles
 *  through rather than looping over the same handful of favourites.
 *  Returns [] when the table is empty or has no eligible rows — the
 *  caller must treat that as normal, not an error: the library is an
 *  enhancement to the liturgy, never a dependency. */
export async function selectQuoteCandidates(pool: Pool, opts: QuoteSelectionOptions = {}): Promise<TeachingQuote[]> {
  const limit = opts.limit ?? 6;
  const poolSize = opts.poolSize ?? 20;
  const excludeDays = opts.excludeUsedWithinDays ?? 14;

  const { rows } = await pool.query<{
    quote_id: string;
    quote_text: string;
    attribution: string;
    source_title: string;
    theme: string | null;
  }>(
    `SELECT quote_id, quote_text, attribution, source_title, theme
       FROM teaching_quotes
      WHERE is_active = TRUE
        AND (last_used_at IS NULL OR last_used_at < now() - ($1 || ' days')::interval)
      ORDER BY last_used_at ASC NULLS FIRST
      LIMIT $2`,
    [excludeDays, poolSize],
  );

  return shuffle(rows)
    .slice(0, limit)
    .map((r) => ({
      quoteId: r.quote_id,
      quoteText: r.quote_text,
      attribution: r.attribution,
      sourceTitle: r.source_title,
      theme: r.theme,
    }));
}

function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Marks quotes as used just now, for rotation. Best-effort: a liturgy has
 *  already composed and been cached by the time this is called, so a
 *  failure here must never surface to the caller — see composeFor() in
 *  liturgy.ts, which calls this fire-and-forget. */
export async function markQuotesUsed(pool: Pool, quoteIds: readonly string[]): Promise<void> {
  if (quoteIds.length === 0) return;
  try {
    await pool.query(
      `UPDATE teaching_quotes
          SET last_used_at = now(), use_count = use_count + 1, updated_at = now()
        WHERE quote_id = ANY($1::uuid[])`,
      [quoteIds],
    );
  } catch {
    /* usage tracking must never break a liturgy that already composed successfully */
  }
}
