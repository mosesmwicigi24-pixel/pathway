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
 *  inspection not to be safe to attribute to the owner, or not to produce
 *  usable candidates at all. See scripts/sermon-corpus/CURATION.md's
 *  addendum for the full reasoning behind each:
 *   - "leadership", "the-power-of-becoming", "heavenly-marriages": large
 *     unattributed excerpts from other named authors (a Piper-style
 *     sermon, a Forbes.com article, a Crossway.org book, dadabhagwan.org).
 *   - "influencing-the-salt": explicitly credited to a guest speaker.
 *   - "leader-without-a-title": collected external aphorisms, no
 *     first-person voice.
 *   - "altars-and-covenants": so dominated by uncited Scripture narrative,
 *     copied theological commentary, and pagan-mythology description that
 *     line-level filtering left in far too much (a dry run produced 236 of
 *     801 candidates from this one 86K-character document).
 *   - "faith": paraphrases nearly the entirety of Hebrews 11, verse by
 *     verse, closely enough that keeping it would attribute Scripture's
 *     own content to the owner as if it were his original teaching — the
 *     same rule that drops verbatim citation, applied to close paraphrase.
 *   - "he-is-coming-like-a-thief": the source PDF's text extraction hard-
 *     wrapped mid-sentence with blank lines between wraps, so the block
 *     splitter treats every wrap as its own paragraph — every candidate
 *     from this file was a sentence fragment ending mid-clause.
 *  Their raw text stays staged for audit; they are simply never fed to
 *  the extractor. */
export const EXCLUDED_SLUGS: ReadonlySet<string> = new Set([
  "leadership",
  "the-power-of-becoming",
  "heavenly-marriages",
  "influencing-the-salt",
  "leader-without-a-title",
  "altars-and-covenants",
  "faith",
  "he-is-coming-like-a-thief",
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
// book list would miss. Two citation styles appear: "Book C:V" (most of
// it) and, occasionally, "Book C vs V" / "Book C v V" ("Mathew 24 vs 37").
const SCRIPTURE_REF_RE =
  /\b[1-3]?\s?[A-Z][A-Za-z]+\.?\s+\d{1,3}(?::\s?\d{1,3}(?:\s?[-–]\s?\d{1,3})?|\s+vs?\.?\s?\d{1,3})\b/;
/** God speaking in the first person, or a prophetic formula, with NO
 *  reference anywhere nearby to catch via SCRIPTURE_REF_RE — most often
 *  the sermon's own title, which is frequently a verse itself ("I am
 *  making all things new" = Revelation 21:5). Deliberately narrow: it must
 *  not swallow the pastor's own first person ("I have seen people
 *  who..."), only the declarative divine voice of quoted Scripture. */
const DIVINE_SPEECH_RE =
  /(^|[\s"“])(behold|verily)\b|\b(thus says?|declares?|says) the (lord|father)\b|\bI am (making|doing|the (lord|way|truth|life|vine|good shepherd|bread|light))\b|\bI will (make a way|pour out|restore|build my church|never leave)\b/i;
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
const SENSITIVE_RE =
  /\b(witch\w*|demon\w*|curs(e|ed|es|ing)\b|occult\w*|divination\w*|diviners?|sorcer\w*|satan\w*|spell(s|ed|ing)?\b|medium\w*|spiritist\w*|molek\w*|possession\w*|exorcis\w*|altar\w*|territorial\w*|territory|principalit\w*|stronghold\w*|ancestral\w*|generational\w*|magic\w*)\b/i;
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
const REFERENCE_ONLY_BLOCK_RE =
  /^[1-3]?\s?[A-Z][A-Za-z]+\.?\s+\d{1,3}:\s?\d{1,3}(?:\s?[-–]\s?\d{1,3})?(?:,\s?\d{1,3}(?::\d{1,3})?)?(?:\s*[A-Za-z]{2,6}\.?)?$/;

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

    // A block containing a Scripture reference ANYWHERE is discarded WHOLE,
    // not just the reference-bearing line. Filtering out only that one line
    // still leaked verse text: this pastor writes a citation on one line
    // and lets the verse run across the next several, so the continuation
    // lines carry no reference of their own and sailed straight through —
    // that is how "I will make a way in the wilderness" (Isaiah 43:19)
    // once came out attributed to him. His own teaching lines live in their
    // own bullets/paragraphs, separate from the verse blocks, so dropping
    // the whole block costs little and prevents the one error this feature
    // must never make: putting God's words in his mouth.
    const rawLines = block.split("\n").map(stripMarkup).filter((l) => l.length > 0);
    if (rawLines.some((l) => SCRIPTURE_REF_RE.test(l))) continue;

    const fragments = rawLines.flatMap((l) => l.split(SENTENCE_SPLIT_RE));

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

// An ellipsis ("...", "…") means the source itself elided text — almost
// always a truncated Scripture quotation carried over from a preceding
// verse fragment, never a complete standalone thought.
const ELLIPSIS_RE = /\.\.\.|…/;
// A trailing bare number right before the final period ("...persecution
// 36.") is a leaked verse/footnote number from Scripture commentary that
// wasn't caught as a Book C:V reference.
const TRAILING_VERSE_NUMBER_RE = /\s\d{1,3}\.$/;
// A couple of specific dark phrases (child sacrifice, in this corpus
// always a paraphrase of Deuteronomy 18) that survive because they don't
// contain any single SENSITIVE_RE trigger word on their own.
const KNOWN_SENSITIVE_PHRASES: readonly string[] = [
  "sacrifices his son or daughter in the fire",
  "sacrifices their son or daughter in the fire",
];

function finalizeCandidate(raw: string, source: QuoteSource): QuoteCandidate | null {
  const candidate = raw.replace(/\s+/g, " ").trim();
  if (!candidate) return null;
  // A trailing comma or colon means the buffer ran out of fragments to
  // merge before the thought actually finished (comma) or is a bare list
  // introduction ("There are some of us who:") — either way it's not a
  // complete standalone line, and papering over it with an appended
  // period would misrepresent it as one.
  if (/[,:;]$/.test(candidate)) return null;
  // A candidate that starts mid-sentence (lowercase) is a broken
  // continuation, not something that could plausibly open a surfaced quote.
  if (/^[a-z]/.test(candidate)) return null;
  // A candidate that starts with a bare digit is a leaked verse/list
  // number (e.g. a bold "**15**" verse marker whose markup was stripped
  // but the number itself wasn't followed by "." or ")" for the
  // numbered-list stripper to catch).
  if (/^\d/.test(candidate)) return null;
  if (SCRIPTURE_REF_RE.test(candidate)) return null;
  // Scripture quoted with NO reference anywhere near it — most often the
  // sermon's own title, which is frequently a verse ("I am making all things
  // new" = Revelation 21:5). These are God speaking in the first person or a
  // prophetic formula; attributing them to the pastor is worse than dropping
  // a few real lines.
  if (DIVINE_SPEECH_RE.test(candidate)) return null;
  if (URL_RE.test(candidate)) return null;
  if (NAMED_SOURCE_RE.test(candidate)) return null;
  if (SENSITIVE_RE.test(candidate)) return null;
  if (PRIVATE_NAME_RE.test(candidate)) return null;
  if (ELLIPSIS_RE.test(candidate)) return null;
  if (TRAILING_VERSE_NUMBER_RE.test(candidate)) return null;
  if (KNOWN_NON_ORIGINAL_LINES.some((known) => candidate.includes(known))) return null;
  if (KNOWN_SENSITIVE_PHRASES.some((known) => candidate.toLowerCase().includes(known))) return null;

  const wordCount = candidate.split(/\s+/).length;
  if (wordCount < MIN_WORDS || wordCount > MAX_WORDS) return null;

  // ALL-CAPS heading fragments ("AVOID THE ISSUES THAT CAN DEFILE YOUR
  // DESTINY.") are document structure, not a spoken teaching line.
  const letters = candidate.replace(/[^A-Za-z]/g, "");
  if (letters.length > 8 && letters === letters.toUpperCase()) return null;

  // Title Case Heading Fragments ("Authority Over the Devil Through the
  // Blood of Jesus") read as bullet-list section titles, not something a
  // person actually said — if most content words (excluding the first,
  // which is capitalized regardless) start uppercase, treat it as one.
  const words = candidate.replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean).slice(1);
  const eligible = words.filter((w) => w.length > 2);
  if (eligible.length >= 4) {
    const capitalized = eligible.filter((w) => /^[A-Z]/.test(w)).length;
    if (capitalized / eligible.length > 0.6) return null;
  }

  // The candidate already ends with terminal punctuation, possibly inside
  // a closing quote mark ('..."'); only append a period when there's
  // truly none, so we never produce a doubled '."."'.
  const text = /[.!?]["'”’]?$/.test(candidate) ? candidate : `${candidate}.`;
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
