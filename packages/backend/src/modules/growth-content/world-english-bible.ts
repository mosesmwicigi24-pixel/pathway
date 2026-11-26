// The World English Bible is public domain: https://ebible.org/eng-web/copr.htm
// Only this fixed translation and host are used; plan references never form a URL host.
const BOOKS: Record<string, string> = {
  genesis: "GEN", exodus: "EXO", leviticus: "LEV", numbers: "NUM", deuteronomy: "DEU",
  joshua: "JOS", judges: "JDG", ruth: "RUT", "1 samuel": "1SA", "2 samuel": "2SA",
  "1 kings": "1KI", "2 kings": "2KI", "1 chronicles": "1CH", "2 chronicles": "2CH",
  ezra: "EZR", nehemiah: "NEH", esther: "EST", job: "JOB", psalm: "PSA", psalms: "PSA",
  proverbs: "PRO", ecclesiastes: "ECC", "song of solomon": "SNG", "song of songs": "SNG",
  isaiah: "ISA", jeremiah: "JER", lamentations: "LAM", ezekiel: "EZK", daniel: "DAN",
  hosea: "HOS", joel: "JOL", amos: "AMO", obadiah: "OBA", jonah: "JON", micah: "MIC",
  nahum: "NAM", habakkuk: "HAB", zephaniah: "ZEP", haggai: "HAG", zechariah: "ZEC", malachi: "MAL",
  matthew: "MAT", mark: "MRK", luke: "LUK", john: "JHN", acts: "ACT", romans: "ROM",
  "1 corinthians": "1CO", "2 corinthians": "2CO", galatians: "GAL", ephesians: "EPH",
  philippians: "PHP", colossians: "COL", "1 thessalonians": "1TH", "2 thessalonians": "2TH",
  "1 timothy": "1TI", "2 timothy": "2TI", titus: "TIT", philemon: "PHM", hebrews: "HEB",
  james: "JAS", "1 peter": "1PE", "2 peter": "2PE", "1 john": "1JN", "2 john": "2JN",
  "3 john": "3JN", jude: "JUD", revelation: "REV", revelations: "REV",
};
const SINGLE_CHAPTER = new Set(["OBA", "PHM", "2JN", "3JN", "JUD"]);
const MAX_BODY = 1024 * 1024;

interface Selection { book: string; chapter: number; verses: number[] | null; startAt?: string }

/** Reject unsupported or ambiguous references instead of reading the wrong verses. */
export function parseWorldEnglishReference(reference: string): Selection[] {
  if (!reference.trim() || reference.length > 300) throw new Error("Invalid Bible reference");
  return reference.split(";").map((raw) => {
    const part = raw.trim().replace(/[–—]/g, "-");
    // This published plan references the latter clause of Romans 12:2. Match
    // its explicit WEB wording and fail closed if the source changes.
    if (/^romans\s+12:2b$/i.test(part)) return { book: "ROM", chapter: 12, verses: [2], startAt: "but be transformed" };
    const match = /^(?:([1-3])\s*)?([A-Za-z]+(?:\s+[A-Za-z]+)*)\s+(\d+)(?::(\d+(?:\s*-\s*\d+)?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*))?(?:\s*-\s*(\d+))?$/.exec(part);
    if (!match) throw new Error("Unsupported Bible reference");
    const name = `${match[1] ? `${match[1]} ` : ""}${match[2]}`.toLowerCase().replace(/\s+/g, " ");
    const book = BOOKS[name];
    if (!book) throw new Error("Unsupported Bible book");
    let chapter = Number(match[3]);
    let list = match[4];
    if (match[5] && (!SINGLE_CHAPTER.has(book) || list)) throw new Error("Unsupported Bible reference");
    if (!list && SINGLE_CHAPTER.has(book)) { list = match[5] ? `${match[3]}-${match[5]}` : match[3]; chapter = 1; }
    if (!Number.isInteger(chapter) || chapter < 1 || chapter > 150) throw new Error("Invalid Bible chapter");
    if (!list) return { book, chapter, verses: null };
    const verses: number[] = [];
    for (const item of list.split(",")) {
      const [startText, endText] = item.trim().split(/\s*-\s*/);
      const start = Number(startText), end = Number(endText ?? startText);
      if (!Number.isInteger(start) || start < 1 || end < start || end > 176 || end - start > 100) throw new Error("Invalid Bible verse range");
      for (let v = start; v <= end; v++) verses.push(v);
    }
    if (verses.length > 176 || new Set(verses).size !== verses.length) throw new Error("Invalid Bible verses");
    return { book, chapter, verses };
  });
}

export async function worldEnglishPassage(reference: string, request: typeof fetch = fetch): Promise<string> {
  const selected = parseWorldEnglishReference(reference);
  if (selected.length > 8) throw new Error("Too many Bible passages");
  const chapters = new Map<string, Map<number, string>>();
  const result: string[] = [];
  for (const selection of selected) {
    const key = `${selection.book}/${selection.chapter}`;
    let verses = chapters.get(key);
    if (!verses) {
      const response = await request(`https://bible.helloao.org/api/ENGWEBP/${key}.json`, {
        redirect: "error", signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error("Bible source unavailable");
      const length = Number(response.headers.get("content-length") ?? 0);
      if (length > MAX_BODY) throw new Error("Bible response too large");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Bible response unavailable");
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const next = await reader.read(); if (next.done) break;
          size += next.value.byteLength; if (size > MAX_BODY) throw new Error("Bible response too large");
          chunks.push(next.value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const body = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      const json = JSON.parse(new TextDecoder().decode(body)) as {
        translation?: { id?: string }; book?: { id?: string }; chapter?: { number?: number; content?: unknown[] };
      };
      if (json.translation?.id !== "ENGWEBP" || json.book?.id !== selection.book || json.chapter?.number !== selection.chapter || !Array.isArray(json.chapter.content)) throw new Error("Unexpected Bible response");
      verses = new Map<number, string>();
      for (const item of json.chapter.content) {
        if (!item || typeof item !== "object") continue;
        const verse = item as { type?: unknown; number?: unknown; content?: unknown };
        if (verse.type !== "verse" || typeof verse.number !== "number" || !Array.isArray(verse.content)) continue;
        const text = verse.content.map((piece: unknown) => typeof piece === "string" ? piece :
          piece && typeof piece === "object" && typeof (piece as { text?: unknown }).text === "string" ? (piece as { text: string }).text : "").filter(Boolean).join(" ").trim();
        if (verses.has(verse.number) || !text) throw new Error("Invalid Bible verse");
        verses.set(verse.number, text);
      }
      chapters.set(key, verses);
    }
    const numbers = selection.verses ?? [...verses.keys()].sort((a, b) => a - b);
    if (!numbers.length) throw new Error("Bible passage unavailable");
    for (const number of numbers) {
      const text = verses.get(number); if (!text) throw new Error("Bible verse unavailable");
      if (selection.startAt) {
        const at = text.toLowerCase().indexOf(selection.startAt);
        if (at < 0 || text.toLowerCase().indexOf(selection.startAt, at + 1) >= 0) throw new Error("Bible verse section unavailable");
        result.push(text.slice(at));
      } else result.push(text);
    }
  }
  return result.join(" ");
}
