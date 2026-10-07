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
import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
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

/** Recently used photographs, so a letter downloaded twice is fetched once.
 *  Small and in-process: the library is a few hundred images of ~80 KB. */
const photoCache = new Map<string, Uint8Array>();
const PHOTO_CACHE_MAX = 48;

/** The photograph as JPEG bytes at the page's exact aspect, or null. Two
 *  tries (5 s, then 8 s): a passing network blip shouldn't cost a member the
 *  picture on a letter they keep (seen 2026-10-07 while building this). */
export async function fetchLetterPhoto(url: string): Promise<Uint8Array | null> {
  const sized = url.replace(/\?.*$/, "") + "?auto=compress&fm=jpg&fit=crop&w=1400&h=490&q=78";
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

/** Greedy word wrap to `width` points. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Draw wrapped text from `y` (its first baseline) down; returns the y below it. */
function block(page: PDFPage, text: string, o: { x: number; y: number; width: number; font: PDFFont; size: number; leading: number; color: ReturnType<typeof rgb> }): number {
  let y = o.y;
  for (const l of wrap(text, o.font, o.size, o.width)) {
    page.drawText(l, { x: o.x, y, size: o.size, font: o.font, color: o.color });
    y -= o.leading;
  }
  return y;
}

function spaced(text: string): string {
  return text.toUpperCase().split("").join(" ");
}

function longDate(weekOf: string): string {
  const d = new Date(`${weekOf}T12:00:00+03:00`);
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Nairobi" });
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
  const f = {} as Record<FontKey, PDFFont>;
  // Subset where it is safe; Inter is embedded whole — pdf-lib's subsetter
  // drops glyphs from Inter (seen 2026-10-07: "No. 6" printed as ". 6").
  for (const k of Object.keys(FONT_FILES) as FontKey[]) {
    f[k] = await doc.embedFont(bytes[k], { subset: k !== "sans" && k !== "sansBold" });
  }

  const W = 595.28, H = 841.89, M = 48;
  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: PAPER });
  const cw = W - 2 * M;
  let y = H - 46;

  // Masthead: the seal, the name, the issue and date.
  page.drawCircle({ x: M + 15, y: y - 12, size: 15, color: GOLD });
  page.drawText("N", { x: M + 15 - f.serifBold.widthOfTextAtSize("N", 15) / 2, y: y - 17, size: 15, font: f.serifBold, color: SEAL_INK });
  page.drawText("The Sunday Letter", { x: M + 40, y: y - 20, size: 25, font: f.serifItalic, color: NAVY });
  const issue = `No. ${letter.issue_no}`;
  const date = longDate(letter.week_of);
  page.drawText(issue, { x: W - M - f.sans.widthOfTextAtSize(issue, 9), y: y - 8, size: 9, font: f.sans, color: MUTED });
  page.drawText(date, { x: W - M - f.sans.widthOfTextAtSize(date, 9), y: y - 21, size: 9, font: f.sans, color: MUTED });
  y -= 34;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: GOLD });
  page.drawLine({ start: { x: M, y: y - 2.6 }, end: { x: W - M, y: y - 2.6 }, thickness: 0.8, color: GOLD });
  y -= 14;

  // The photograph, at the page's measure (fetched at its exact aspect).
  const photoBytes = opts.photo !== undefined ? opts.photo : letter.photo ? await fetchLetterPhoto(letter.photo.url) : null;
  if (photoBytes) {
    try {
      const img = await doc.embedJpg(photoBytes);
      const h = cw * (490 / 1400);
      page.drawImage(img, { x: M, y: y - h, width: cw, height: h });
      y -= h + 6;
      if (letter.photo) y = block(page, letter.photo.caption, { x: M, y: y - 8, width: cw, font: f.serifItalic, size: 8.5, leading: 11, color: MUTED }) - 4;
    } catch {
      /* not a JPEG we can embed: the page stands without it */
    }
  }

  // The title.
  y = block(page, letter.title, { x: M, y: y - 20, width: cw, font: f.serifBold, size: 21, leading: 25, color: NAVY }) - 6;

  // Two columns: the letter, and the week in figures beside it.
  const gap = 22;
  const leftW = (cw - gap) * (2 / 3);
  const rightX = M + leftW + gap;
  const rightW = cw - leftW - gap;
  const top = y;

  let ly = block(page, letter.salutation, { x: M, y: top - 4, width: leftW, font: f.serifItalic, size: 13.5, leading: 18, color: NAVY }) - 4;
  for (const para of letter.paragraphs) {
    ly = block(page, para, { x: M, y: ly, width: leftW, font: f.serif, size: 11, leading: 16.5, color: INK }) - 7;
  }
  page.drawText("With grace,", { x: M, y: ly - 6, size: 10.5, font: f.serifItalic, color: MUTED });
  page.drawText(letter.signed_by.name, { x: M, y: ly - 40, size: 32, font: f.signature, color: NAVY });
  page.drawText(spaced(letter.signed_by.role), { x: M, y: ly - 54, size: 7.5, font: f.sansBold, color: GOLD_TEXT });
  ly -= 64;

  let ry = top;
  if (letter.figures.length > 0) {
    const rowH = 34;
    const panelH = 22 + letter.figures.length * rowH;
    page.drawRectangle({ x: rightX, y: ry - panelH, width: rightW, height: panelH, color: PANEL });
    page.drawText(spaced("Your week, in grace"), { x: rightX + 10, y: ry - 15, size: 7, font: f.sansBold, color: GOLD_TEXT });
    let fy = ry - 22;
    for (const fig of letter.figures) {
      page.drawText(fig.value, { x: rightX + 10, y: fy - 18, size: 19, font: f.serif, color: NAVY });
      page.drawText(fig.label, { x: rightX + 10, y: fy - 29, size: 8.5, font: f.sans, color: MUTED });
      fy -= rowH;
    }
    ry -= panelH + 14;
  }
  if (letter.scripture) {
    const verse = letter.scripture.text ? `“${letter.scripture.text}”` : null;
    if (verse) ry = block(page, verse, { x: rightX, y: ry - 4, width: rightW, font: f.serifItalic, size: 10.5, leading: 15, color: NAVY }) - 2;
    const ref = letter.scripture.version ? `${letter.scripture.ref} · ${letter.scripture.version}` : letter.scripture.ref;
    page.drawText(spaced(ref), { x: rightX, y: ry - 4, size: 7, font: f.sansBold, color: GOLD_TEXT });
    ry -= 16;
  }

  // The letter's own shareable line, as a pull quote — as on the phone.
  y = Math.min(ly, ry) - 10;
  if (letter.share_line) {
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.7, color: GOLD });
    y = block(page, `\u201C${letter.share_line}\u201D`, { x: M, y: y - 26, width: cw, font: f.serifItalic, size: 17, leading: 23, color: GOLD_TEXT }) - 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.7, color: GOLD });
    y -= 18;
  }

  // One step for the week, then the foot of the page.
  if (letter.next_step) {
    const boxH = 40;
    page.drawRectangle({ x: M, y: y - boxH, width: cw, height: boxH, borderColor: NAVY, borderWidth: 0.8 });
    page.drawText(spaced("One step for this week"), { x: M + 12, y: y - 16, size: 7, font: f.sansBold, color: GOLD_TEXT });
    page.drawText(letter.next_step.label, { x: M + 12, y: y - 31, size: 12, font: f.serifBold, color: NAVY });
  }
  page.drawLine({ start: { x: M, y: 44 }, end: { x: W - M, y: 44 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
  const foot = opts.firstName ? `A letter for ${opts.firstName}, written for the week` : "A letter written for your week";
  page.drawText(foot, { x: M, y: 30, size: 8.5, font: f.sans, color: MUTED });
  const brand = "Nuru Place · The Sunday Letter";
  page.drawText(brand, { x: W - M - f.sans.widthOfTextAtSize(brand, 8.5), y: 30, size: 8.5, font: f.sans, color: MUTED });

  return doc.save();
}
