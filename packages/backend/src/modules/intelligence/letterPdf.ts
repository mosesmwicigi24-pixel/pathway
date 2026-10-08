// "Keep this letter" — the Sunday Letter as one designed A4 page (owner,
// 2026-10-07: "a good report like a nice template from Pages"; the canvas's
// A4 board). Unlike the statements' minimal standard-14 writer, a letter needs
// its real typefaces — Fraunces, Inter and the signature face — and its
// photograph, so it is drawn with pdf-lib and the OFL fonts bundled under
// assets/fonts/letter (embedded as subsets).
//
// The photograph is fetched from the curated library's URL at render time; if
// that fails or times out the page is drawn without it — a letter is never
// refused for want of a picture.
//
// The letter runs the full measure, like its heading, in paragraphs, justified
// (owner, 2026-10-07: "format the font like the heading to reach the end of
// the page"). The page is measured before it is drawn: the roomiest fit that
// ends above the foot wins, so a long letter tightens instead of running off
// the page.
import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, clip, endPath, popGraphicsState, pushGraphicsState, rectangle, rgb, type Color, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { LetterV3 } from "./letters.js";

const NAVY = rgb(11 / 255, 31 / 255, 51 / 255);
const INK = rgb(27 / 255, 36 / 255, 48 / 255);
const MUTED = rgb(91 / 255, 102 / 255, 120 / 255);
const GOLD = rgb(200 / 255, 155 / 255, 60 / 255);
const GOLD_TEXT = rgb(168 / 255, 127 / 255, 46 / 255);
const SEAL_INK = rgb(30 / 255, 42 / 255, 31 / 255);
const PANEL = rgb(251 / 255, 243 / 255, 223 / 255);
const PAPER = rgb(255 / 255, 253 / 255, 248 / 255);

const FONT_DIR = new URL("../../../assets/fonts/letter/", import.meta.url);
const FONT_FILES = {
  serif: "Fraunces-Regular.ttf",
  serifItalic: "Fraunces-RegularItalic.ttf",
  serifBold: "Fraunces-SemiBold.ttf",
  sans: "Inter-Regular.ttf",
  sansBold: "Inter-SemiBold.ttf",
  signature: "MrsSaintDelafield-Regular.ttf",
} as const;
type FontKey = keyof typeof FONT_FILES;
let fontBytes: Promise<Record<FontKey, Uint8Array>> | null = null;
function loadFonts(): Promise<Record<FontKey, Uint8Array>> {
  fontBytes ??= (async () => {
    const out = {} as Record<FontKey, Uint8Array>;
    for (const [k, f] of Object.entries(FONT_FILES) as Array<[FontKey, string]>) {
      out[k] = new Uint8Array(await readFile(new URL(f, FONT_DIR)));
    }
    return out;
  })();
  return fontBytes;
}

const W = 595.28, H = 841.89, M = 48;
/** Every block runs the full measure, as the heading does. */
const MEASURE = W - 2 * M;
/** The lowest a block may end: the foot's rule sits at 44. */
const FLOOR = 58;

/** Recently used photographs, so a letter downloaded twice is fetched once.
 *  Small and in-process: the library is a few hundred images of ~80 KB. */
const photoCache = new Map<string, Uint8Array>();
const PHOTO_CACHE_MAX = 48;

/** The photograph as JPEG bytes at the strip's exact aspect (`height` points
 *  across the measure), or null. Cropped by detail, not the centre: a wide
 *  strip from the middle of a dawn photograph is a dark box, the detailed band
 *  is the sun (seen 2026-10-07). Two tries (5 s, then 8 s): a passing network
 *  blip shouldn't cost a member the picture on a letter they keep. */
export async function fetchLetterPhoto(url: string, height = 170): Promise<Uint8Array | null> {
  const h = Math.max(1, Math.round((1400 * height) / MEASURE));
  const sized = url.replace(/\?.*$/, "") + `?auto=compress&fm=jpg&fit=crop&crop=entropy&w=1400&h=${h}&q=78`;
  const hit = photoCache.get(sized);
  if (hit) return hit;
  for (const timeoutMs of [5000, 8000]) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(sized, { signal: ctrl.signal });
      if (res.ok && (res.headers.get("content-type") ?? "").includes("jpeg")) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (photoCache.size >= PHOTO_CACHE_MAX) photoCache.delete(photoCache.keys().next().value as string);
        photoCache.set(sized, bytes);
        return bytes;
      }
    } catch {
      /* try again, then go without */
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** Greedy word wrap; `widthAt(line)` lets the drop cap's lines run shorter. */
function wrapWords(words: string[], font: PDFFont, size: number, widthAt: (line: number) => number): string[][] {
  const lines: string[][] = [];
  let line: string[] = [];
  for (const word of words) {
    if (line.length === 0 || font.widthOfTextAtSize([...line, word].join(" "), size) <= widthAt(lines.length)) line.push(word);
    else {
      lines.push(line);
      line = [word];
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/** Draws on the page — or, without one, only measures. The same layout code
 *  runs both ways, so the page that was measured is the page that is drawn. */
class Pen {
  constructor(readonly page: PDFPage | null) {}
  text(s: string, o: NonNullable<Parameters<PDFPage["drawText"]>[1]>): void {
    this.page?.drawText(s, o);
  }
  line(o: Parameters<PDFPage["drawLine"]>[0]): void {
    this.page?.drawLine(o);
  }
  rect(o: Parameters<PDFPage["drawRectangle"]>[0]): void {
    this.page?.drawRectangle(o);
  }
  circle(o: Parameters<PDFPage["drawCircle"]>[0]): void {
    this.page?.drawCircle(o);
  }
  /** The image covers the box, centred and cropped to it. */
  photo(img: PDFImage, box: { x: number; y: number; width: number; height: number }): void {
    if (!this.page) return;
    const scale = Math.max(box.width / img.width, box.height / img.height);
    const w = img.width * scale, h = img.height * scale;
    this.page.pushOperators(pushGraphicsState(), rectangle(box.x, box.y, box.width, box.height), clip(), endPath());
    this.page.drawImage(img, { x: box.x - (w - box.width) / 2, y: box.y - (h - box.height) / 2, width: w, height: h });
    this.page.pushOperators(popGraphicsState());
  }
}

/** Wrapped, ragged text from `y` (its first baseline) down; returns the y below it. */
function block(pen: Pen, text: string, o: { x: number; y: number; width: number; font: PDFFont; size: number; leading: number; color: Color }): number {
  let y = o.y;
  for (const words of wrapWords(text.split(/\s+/).filter(Boolean), o.font, o.size, () => o.width)) {
    pen.text(words.join(" "), { x: o.x, y, size: o.size, font: o.font, color: o.color });
    y -= o.leading;
  }
  return y;
}

/** One paragraph of the letter, justified to the measure with its last line
 *  ragged. The first opens with a two-line drop cap, as on the phone. */
function paragraph(pen: Pen, text: string, o: { y: number; font: PDFFont; capFont: PDFFont; size: number; leading: number; dropCap: boolean }): number {
  let body = text;
  let indent = 0;
  if (o.dropCap && /^[A-Za-z]/.test(text)) {
    const cap = text[0]!;
    const capSize = (o.leading + 0.7 * o.size) / 0.7; // its top on line one's caps, its foot on line two
    indent = o.capFont.widthOfTextAtSize(cap, capSize) + 5;
    pen.text(cap, { x: M, y: o.y - o.leading, size: capSize, font: o.capFont, color: GOLD_TEXT });
    body = text.slice(1);
  }
  const widthAt = (i: number): number => (i < 2 ? MEASURE - indent : MEASURE);
  const lines = wrapWords(body.split(/\s+/).filter(Boolean), o.font, o.size, widthAt);
  const space = o.font.widthOfTextAtSize(" ", o.size);
  let y = o.y;
  lines.forEach((words, i) => {
    const x0 = M + (i < 2 ? indent : 0);
    const gap = words.length > 1 ? (widthAt(i) - o.font.widthOfTextAtSize(words.join(" "), o.size)) / (words.length - 1) + space : space;
    if (i === lines.length - 1 || words.length < 2 || gap > space * 3) {
      pen.text(words.join(" "), { x: x0, y, size: o.size, font: o.font, color: INK });
    } else {
      let x = x0;
      for (const w of words) {
        pen.text(w, { x, y, size: o.size, font: o.font, color: INK });
        x += o.font.widthOfTextAtSize(w, o.size) + gap;
      }
    }
    y -= o.leading;
  });
  // A one-line opening paragraph still clears its drop cap.
  return indent > 0 ? Math.min(y, o.y - 2 * o.leading) : y;
}

function spaced(text: string): string {
  return text.toUpperCase().split("").join(" ");
}

function longDate(weekOf: string): string {
  const d = new Date(`${weekOf}T12:00:00+03:00`);
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Nairobi" });
}

interface Fit {
  photoH: number;
  body: number;
  leading: number;
  pullQuote: boolean;
}
/** The type, roomiest first, each with the range its photograph may take.
 *  The photograph gives way first, and exactly as far as the page needs: its
 *  height is the one block that shrinks point for point, so a near miss costs
 *  a few points of picture, never the pull quote (a fixed ladder once dropped
 *  the quote for a single point and left an empty band at the foot). */
const LEVELS: readonly { body: number; leading: number; pullQuote: boolean; photoMax: number; photoMin: number }[] = [
  { body: 12.5, leading: 18.5, pullQuote: true, photoMax: 170, photoMin: 130 },
  { body: 12, leading: 17.5, pullQuote: true, photoMax: 150, photoMin: 110 },
  { body: 11.5, leading: 16.5, pullQuote: true, photoMax: 130, photoMin: 90 },
  { body: 11, leading: 15.5, pullQuote: true, photoMax: 110, photoMin: 80 },
  { body: 11, leading: 15.5, pullQuote: false, photoMax: 110, photoMin: 70 },
  { body: 10.5, leading: 14.5, pullQuote: false, photoMax: 90, photoMin: 60 },
  { body: 10, leading: 14, pullQuote: false, photoMax: 80, photoMin: 50 },
];

type Fonts = Record<FontKey, PDFFont>;

/** The narrowest width that keeps a heading on as few lines as the measure
 *  allows — so a two-line title shares its words, never one word alone. */
function balancedWidth(text: string, font: PDFFont, size: number, max: number): number {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = wrapWords(words, font, size, () => max).length;
  if (lines < 2) return max;
  let lo = max / lines, hi = max;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (wrapWords(words, font, size, () => mid).length > lines) lo = mid;
    else hi = mid;
  }
  return Math.ceil(hi);
}

/** The page from the masthead to the signature; returns where it ends. */
function layout(pen: Pen, letter: LetterV3, f: Fonts, fit: Fit, photo: { img: PDFImage | null } | null): number {
  let y = H - 46;

  // Masthead: the seal, the name, the issue and date.
  pen.circle({ x: M + 15, y: y - 12, size: 15, color: GOLD });
  pen.text("N", { x: M + 15 - f.serifBold.widthOfTextAtSize("N", 15) / 2, y: y - 17, size: 15, font: f.serifBold, color: SEAL_INK });
  pen.text("The Sunday Letter", { x: M + 40, y: y - 20, size: 25, font: f.serifItalic, color: NAVY });
  const issue = `No. ${letter.issue_no}`;
  const date = longDate(letter.week_of);
  pen.text(issue, { x: W - M - f.sans.widthOfTextAtSize(issue, 9), y: y - 8, size: 9, font: f.sans, color: MUTED });
  pen.text(date, { x: W - M - f.sans.widthOfTextAtSize(date, 9), y: y - 21, size: 9, font: f.sans, color: MUTED });
  y -= 34;
  pen.line({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: GOLD });
  pen.line({ start: { x: M, y: y - 2.6 }, end: { x: W - M, y: y - 2.6 }, thickness: 0.8, color: GOLD });
  y -= 14;

  // The photograph across the measure, and the scripture beneath it.
  if (photo && fit.photoH > 0) {
    if (photo.img) pen.photo(photo.img, { x: M, y: y - fit.photoH, width: MEASURE, height: fit.photoH });
    y -= fit.photoH + 6;
    if (letter.photo?.caption) {
      y = block(pen, letter.photo.caption, { x: M, y: y - 9, width: MEASURE, font: f.serifItalic, size: 9, leading: 12, color: MUTED }) - 4;
    }
  }

  // The title, then the letter, both across the full measure.
  const titleW = balancedWidth(letter.title, f.serifBold, 21, MEASURE);
  y = block(pen, letter.title, { x: M, y: y - 22, width: titleW, font: f.serifBold, size: 21, leading: 25, color: NAVY }) - 4;
  y = block(pen, letter.salutation, { x: M, y: y - 10, width: MEASURE, font: f.serifItalic, size: 14, leading: 19, color: NAVY }) - 4;
  // The paragraphs, the letter's own shareable line set as a pull quote after
  // the first — the phone's order, so the page and the screen read alike.
  letter.paragraphs.forEach((p, i) => {
    y = paragraph(pen, p, { y: y - 2, font: f.serif, capFont: f.serifBold, size: fit.body, leading: fit.leading, dropCap: i === 0 }) - fit.leading * 0.4;
    if (i === 0 && fit.pullQuote && letter.share_line) {
      y -= 4;
      pen.line({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.7, color: GOLD });
      y = block(pen, `\u201C${letter.share_line}\u201D`, { x: M, y: y - 24, width: MEASURE, font: f.serifItalic, size: 16, leading: 21, color: GOLD_TEXT }) - 4;
      pen.line({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.7, color: GOLD });
      y -= 18;
    }
  });
  y -= 4;

  // The week in figures, side by side.
  if (letter.figures.length > 0) {
    const h = 58;
    pen.rect({ x: M, y: y - h, width: MEASURE, height: h, color: PANEL });
    pen.text(spaced("Your week, in grace"), { x: M + 12, y: y - 15, size: 7, font: f.sansBold, color: GOLD_TEXT });
    const colW = (MEASURE - 24) / letter.figures.length;
    letter.figures.forEach((fig, i) => {
      pen.text(fig.value, { x: M + 12 + i * colW, y: y - 37, size: 19, font: f.serif, color: NAVY });
      pen.text(fig.label, { x: M + 12 + i * colW, y: y - 50, size: 8.5, font: f.sans, color: MUTED });
    });
    y -= h + 14;
  }

  // The verse in full; without its words in the library, its reference.
  if (letter.scripture) {
    const ref = letter.scripture.version ? `${letter.scripture.ref} · ${letter.scripture.version}` : letter.scripture.ref;
    if (letter.scripture.text) {
      y = block(pen, `\u201C${letter.scripture.text}\u201D`, { x: M, y: y - 6, width: MEASURE, font: f.serifItalic, size: 11.5, leading: 16, color: NAVY }) - 1;
      pen.text(spaced(ref), { x: M, y: y - 4, size: 7, font: f.sansBold, color: GOLD_TEXT });
    } else {
      pen.text(spaced(`Scripture · ${ref}`), { x: M, y: y - 6, size: 7, font: f.sansBold, color: GOLD_TEXT });
    }
    y -= 20;
  }

  // One step for the week.
  if (letter.next_step) {
    const boxH = 40;
    pen.rect({ x: M, y: y - boxH, width: MEASURE, height: boxH, borderColor: NAVY, borderWidth: 0.8 });
    pen.text(spaced("One step for this week"), { x: M + 12, y: y - 16, size: 7, font: f.sansBold, color: GOLD_TEXT });
    pen.text(letter.next_step.label, { x: M + 12, y: y - 31, size: 12, font: f.serifBold, color: NAVY });
    y -= boxH;
  }

  // Signed, last — as on the phone.
  pen.text("With grace,", { x: M, y: y - 18, size: 10.5, font: f.serifItalic, color: MUTED });
  pen.text(letter.signed_by.name, { x: M, y: y - 48, size: 30, font: f.signature, color: NAVY });
  pen.text(spaced(letter.signed_by.role), { x: M, y: y - 61, size: 7.5, font: f.sansBold, color: GOLD_TEXT });
  y -= 68;
  return y;
}

/** Which fit a letter takes, and where its page then ends: the roomiest type
 *  whose page ends above the foot with the photograph at most as short as
 *  that type allows; last of all, the page without its photograph. */
function fitLetter(letter: LetterV3, f: Fonts, withPhoto: boolean): { fit: Fit; end: number } {
  const room = withPhoto ? { img: null } : null;
  const measure = (fit: Fit): number => layout(new Pen(null), letter, f, fit, room);
  for (const lv of LEVELS) {
    const fit: Fit = { photoH: lv.photoMax, body: lv.body, leading: lv.leading, pullQuote: lv.pullQuote };
    const end = measure(fit);
    if (end >= FLOOR) return { fit, end };
    const photoH = Math.floor(lv.photoMax - (FLOOR - end));
    if (withPhoto && photoH >= lv.photoMin) {
      const shorter = { ...fit, photoH };
      return { fit: shorter, end: measure(shorter) };
    }
  }
  const last = LEVELS[LEVELS.length - 1]!;
  const fit: Fit = { photoH: 0, body: last.body, leading: last.leading, pullQuote: false };
  return { fit, end: measure(fit) };
}

/** The page plan for a letter — for tests: the fit, where the page ends, the
 *  lowest it may end, and the measure every block runs to. */
export async function planLetterPage(letter: LetterV3, withPhoto: boolean): Promise<{ fit: Fit; end: number; floor: number; measure: number }> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const bytes = await loadFonts();
  const f = {} as Fonts;
  for (const k of Object.keys(FONT_FILES) as FontKey[]) f[k] = await doc.embedFont(bytes[k], { subset: false });
  return { ...fitLetter(letter, f, withPhoto), floor: FLOOR, measure: MEASURE };
}

/** Render one letter as a single A4 page. `photo` lets tests (and callers
 *  with the bytes already) skip the network. */
export async function renderLetterPdf(
  letter: LetterV3,
  opts: { firstName: string | null; photo?: Uint8Array | null } = { firstName: null },
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`The Sunday Letter — ${letter.title}`);
  doc.setAuthor(`${letter.signed_by.name}, ${letter.signed_by.role}`);
  doc.setCreator("Nuru Place");
  const bytes = await loadFonts();
  const f = {} as Fonts;
  // Subset where it is safe; Inter is embedded whole — pdf-lib's subsetter
  // drops glyphs from Inter (seen 2026-10-07: "No. 6" printed as ". 6").
  for (const k of Object.keys(FONT_FILES) as FontKey[]) {
    f[k] = await doc.embedFont(bytes[k], { subset: k !== "sans" && k !== "sansBold" });
  }

  // Plan with the photograph, fetch it at that plan's strip, and re-plan
  // without it if it can't be had.
  const wantPhoto = opts.photo !== undefined ? opts.photo !== null : letter.photo !== null;
  let { fit } = fitLetter(letter, f, wantPhoto);
  let img: PDFImage | null = null;
  if (wantPhoto && fit.photoH > 0) {
    const photoBytes = opts.photo !== undefined ? opts.photo : await fetchLetterPhoto(letter.photo!.url, fit.photoH);
    if (photoBytes) {
      try {
        img = await doc.embedJpg(photoBytes);
      } catch {
        /* not a JPEG we can embed: the page stands without it */
      }
    }
    if (!img) fit = fitLetter(letter, f, false).fit;
  }

  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: PAPER });
  layout(new Pen(page), letter, f, fit, img ? { img } : null);

  page.drawLine({ start: { x: M, y: 44 }, end: { x: W - M, y: 44 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
  const foot = opts.firstName ? `A letter for ${opts.firstName}, written for the week` : "A letter written for your week";
  page.drawText(foot, { x: M, y: 30, size: 8.5, font: f.sans, color: MUTED });
  const brand = "Nuru Place · The Sunday Letter";
  page.drawText(brand, { x: W - M - f.sans.widthOfTextAtSize(brand, 8.5), y: 30, size: 8.5, font: f.sans, color: MUTED });

  return doc.save();
}
