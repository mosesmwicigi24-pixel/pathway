import type { NarrationBlock } from "./narration-source.js";

export class NarrationScriptError extends Error {
  constructor() { super("Narration scripture unavailable"); }
}

// The script is built exclusively from authorized plan content. Passage lookup
// is injected; a failed lookup fails the whole script instead of skipping Bible
// text. The caller must verify the permission to use a passage for narration.
export async function narrationScript(
  blocks: NarrationBlock[],
  passage: (reference: string) => Promise<string>,
): Promise<string[]> {
  const output: string[] = [];
  for (const block of blocks) {
    if (block.type === "scripture") {
      if (!block.reference) throw new NarrationScriptError();
      append(output, spokenReference(block.reference));
      append(output, "World English Bible.");
      let text: string;
      try { text = await passage(block.reference); } catch { throw new NarrationScriptError(); }
      if (!text?.trim()) throw new NarrationScriptError();
      append(output, withoutVerseNumbers(text, block.reference));
    } else {
      append(output, block.text);
    }
  }
  return output;
}

function append(output: string[], raw: string): void {
  const clean = raw.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/(^|\n)\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
  for (const block of clean.split(/\n\s*\n/)) {
    let remaining = block.replace(/\s+/g, " ").trim();
    while (remaining.length > 1200) {
      const cut = remaining.lastIndexOf(" ", 1200);
      let at = cut > 0 ? cut : 1200;
      // Never split a UTF-16 surrogate pair when an unusually long word has
      // no spaces (for example emoji or non-BMP script).
      if (at < remaining.length && /[\uD800-\uDBFF]/.test(remaining[at - 1] ?? "") && /[\uDC00-\uDFFF]/.test(remaining[at] ?? "")) at--;
      output.push(remaining.slice(0, at));
      remaining = remaining.slice(at).trim();
    }
    if (remaining) output.push(remaining);
  }
}

function spokenReference(reference: string): string {
  const match = reference.trim().match(/^((?:[1-3]\s*)?[A-Za-z][A-Za-z ]*?)\s+(\d+):(\d+)(?:\s*[-–]\s*(\d+)(?::(\d+))?)?$/);
  if (!match) return reference;
  const [, book, chapter, verse, end, endVerse] = match;
  if (!end) return `${book} ${chapter}, verse ${verse}.`;
  if (endVerse) return `${book} ${chapter}, verse ${verse} to chapter ${end}, verse ${endVerse}.`;
  return `${book} ${chapter}, verses ${verse} to ${end}.`;
}

function withoutVerseNumbers(text: string, reference: string | null): string {
  const candidates = Array.from(text.matchAll(/(?<!\S)(\d{1,3})(?=\s[A-Za-z“"'([])/g));
  const expected = reference?.match(/:(\d{1,3})/)?.[1];
  let next = expected ? Number(expected) : Number(candidates[0]?.[1]);
  const accepted = candidates.filter((candidate) => {
    if (Number(candidate[1]) !== next) return false;
    next++;
    return true;
  });
  for (const candidate of accepted.reverse()) {
    const index = candidate.index;
    if (index !== undefined) text = text.slice(0, index) + text.slice(index + candidate[0].length);
  }
  return text;
}
