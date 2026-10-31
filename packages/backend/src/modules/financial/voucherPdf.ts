// The payment voucher — one expense as a printable, forwardable A4 page
// (owner, 2026-10-31: "a PDF receipt that is downloadable and printable, which
// can be forwarded to individuals for accountability"). Drawn with pdf-lib in
// the church's own typefaces (Fraunces, Inter — the letter's bundled OFL
// fonts), so what the treasurer prints looks like the portal it came from.
//
// What a voucher must answer for an auditor, a pastor or the person paid:
//   · how much, in figures AND in words (words are what stop a "1" becoming a "7");
//   · to whom, when, from which fund, for which department / need, by what means
//     and with which reference;
//   · who prepared it, who approved it — or that nobody has yet — and a blank
//     line for the person who received the money to sign;
//   · whether it still stands: a void voucher says VOID across the page and why.
import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, degrees, rgb, type Color, type PDFFont, type PDFPage } from "pdf-lib";

const NAVY = rgb(11 / 255, 31 / 255, 51 / 255);
const INK = rgb(27 / 255, 36 / 255, 48 / 255);
const MUTED = rgb(91 / 255, 102 / 255, 120 / 255);
const FAINT = rgb(150 / 255, 158 / 255, 172 / 255);
const RULE = rgb(222 / 255, 226 / 255, 232 / 255);
const GOLD = rgb(200 / 255, 155 / 255, 60 / 255);
const GOLD_TEXT = rgb(168 / 255, 127 / 255, 46 / 255);
const PANEL = rgb(251 / 255, 247 / 255, 236 / 255);
const CELL = rgb(246 / 255, 247 / 255, 249 / 255);
const WHITE = rgb(1, 1, 1);

const TONES = {
  approved: { fg: rgb(15 / 255, 107 / 255, 51 / 255), bg: rgb(232 / 255, 246 / 255, 236 / 255), label: "APPROVED" },
  recorded: { fg: rgb(168 / 255, 118 / 255, 22 / 255), bg: rgb(255 / 255, 244 / 255, 218 / 255), label: "AWAITING APPROVAL" },
  void: { fg: rgb(180 / 255, 35 / 255, 24 / 255), bg: rgb(253 / 255, 236 / 255, 236 / 255), label: "VOID" },
} as const;

const FONT_DIR = new URL("../../../assets/fonts/letter/", import.meta.url);
const FONT_FILES = {
  serif: "Fraunces-Regular.ttf",
  serifBold: "Fraunces-SemiBold.ttf",
  serifItalic: "Fraunces-RegularItalic.ttf",
  sans: "Inter-Regular.ttf",
  sansBold: "Inter-SemiBold.ttf",
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

export interface VoucherFacts {
  church: string;
  voucherNo: string;
  status: "recorded" | "approved" | "void";
  amountLabel: string;   // "KES 21,600.00"
  amountWords: string;   // "Twenty-one thousand six hundred Kenya shillings only"
  payee: string;
  spentOn: string;       // "31 Oct 2026"
  fund: string;
  category: string;
  department: string | null;
  need: string | null;
  /** "Target KES 60,000.00 · spent against it so far KES 21,600.00" */
  needLine: string | null;
  channel: string;       // "M-Pesa"
  mpesaCode: string | null;
  reference: string | null;
  description: string | null;
  preparedBy: string;
  preparedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  voidedBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  expenseId: string;
  journalRef: string | null;
  generatedBy: string;
  generatedAt: string;
}

const W = 595.28, H = 841.89, M = 44;
const MEASURE = W - 2 * M;

/** Words that fit `width`, greedily; a word longer than the line is cut. */
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r/g, "").split("\n")) {
    let line = "";
    for (const raw of para.split(/\s+/).filter(Boolean)) {
      let word = raw;
      while (font.widthOfTextAtSize(word, size) > width) {
        let cut = word.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > width) cut--;
        if (line) { out.push(line); line = ""; }
        out.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out.length ? out : [""];
}

function box(page: PDFPage, x: number, y: number, w: number, h: number, color: Color, border?: Color): void {
  page.drawRectangle({ x, y, width: w, height: h, color, ...(border ? { borderColor: border, borderWidth: 0.75 } : {}) });
}

export async function renderVoucherPdf(f: VoucherFacts): Promise<Buffer> {
  const bytes = await loadFonts();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = {} as Record<FontKey, PDFFont>;
  // Inter is embedded whole: pdf-lib's subsetter drops glyphs from it (the
  // letter learned this on 2026-10-07). Fraunces subsets cleanly.
  for (const k of Object.keys(FONT_FILES) as FontKey[]) font[k] = await doc.embedFont(bytes[k], { subset: k !== "sans" && k !== "sansBold" });
  doc.setTitle(`Payment voucher ${f.voucherNo}`);
  doc.setAuthor(f.church);
  doc.setSubject(`${f.amountLabel} to ${f.payee}`);
  doc.setCreator("Nuru Pathway");
  const page = doc.addPage([W, H]);
  const text = (s: string, x: number, y: number, size: number, k: FontKey, color: Color = INK): void => {
    page.drawText(s, { x, y, size, font: font[k], color });
  };
  const right = (s: string, xRight: number, y: number, size: number, k: FontKey, color: Color = INK): void => {
    text(s, xRight - font[k].widthOfTextAtSize(s, size), y, size, k, color);
  };
  /** Tracked capitals, letter by letter (pdf-lib has no letter-spacing). */
  const spaced = (s: string, x: number, y: number, size: number, color: Color, track: number): number => {
    let cx = x;
    for (const ch of s) {
      page.drawText(ch, { x: cx, y, size, font: font.sansBold, color });
      cx += font.sansBold.widthOfTextAtSize(ch, size) + track;
    }
    return cx - x - track;
  };
  const spacedWidth = (s: string, size: number, track: number): number =>
    [...s].reduce((a, ch) => a + font.sansBold.widthOfTextAtSize(ch, size) + track, 0) - track;
  const label = (s: string, x: number, y: number, color: Color = MUTED): void => {
    spaced(s.toUpperCase(), x, y, 7, color, 0.9);
  };

  // ── Head: the church, and which document this is ─────────────────────────
  const headH = 104;
  box(page, 0, H - headH, W, headH, NAVY);
  page.drawRectangle({ x: 0, y: H - headH - 3, width: W, height: 3, color: GOLD });
  // A gold monogram, like the portal's mark.
  page.drawCircle({ x: M + 17, y: H - 50, size: 17, color: GOLD });
  const mono = (f.church.trim()[0] ?? "N").toUpperCase();
  text(mono, M + 17 - font.serifBold.widthOfTextAtSize(mono, 18) / 2, H - 56.5, 18, "serifBold", NAVY);
  const churchLines = wrap(f.church, font.serifBold, 18, 250);
  text(churchLines[0]!, M + 44, H - 47, 18, "serifBold", WHITE);
  text("Finance office · accountability record", M + 44, H - 64, 9, "sans", rgb(0.8, 0.84, 0.9));
  spaced("PAYMENT VOUCHER", W - M - spacedWidth("PAYMENT VOUCHER", 8, 1.2), H - 42, 8, GOLD, 1.2);
  right(f.voucherNo, W - M, H - 62, 17, "sansBold", WHITE);
  right(`Paid ${f.spentOn}`, W - M, H - 79, 9, "sans", rgb(0.8, 0.84, 0.9));

  // ── Status and the amount ─────────────────────────────────────────────────
  let y = H - headH - 30;
  const tone = TONES[f.status];
  const chipW = spacedWidth(tone.label, 8, 0.8) + 22;
  page.drawRectangle({ x: M, y: y - 6, width: chipW, height: 19, color: tone.bg, borderColor: tone.fg, borderWidth: 0.6 });
  spaced(tone.label, M + 11, y, 8, tone.fg, 0.8);
  const statusNote =
    f.status === "approved" ? `Approved by ${f.approvedBy ?? "—"} · ${f.approvedAt ?? ""}`
    : f.status === "void" ? `Voided by ${f.voidedBy ?? "—"} · ${f.voidedAt ?? ""}`
    : "Recorded, not yet approved — not final until a second person approves it";
  text(statusNote, M + chipW + 10, y, 9, "sans", MUTED);

  y -= 26;
  const amtH = 86;
  box(page, M, y - amtH, MEASURE, amtH, PANEL);
  page.drawRectangle({ x: M, y: y - amtH, width: 3, height: amtH, color: GOLD });
  label("Amount paid", M + 18, y - 20, GOLD_TEXT);
  text(f.amountLabel, M + 18, y - 50, 28, "serifBold", NAVY);
  const words = wrap(f.amountWords, font.serifItalic, 10.5, MEASURE - 36);
  words.slice(0, 2).forEach((l, i) => text(l, M + 18, y - 68 - i * 13, 10.5, "serifItalic", INK));
  label("Paid to", M + MEASURE * 0.6, y - 20);
  wrap(f.payee, font.sansBold, 13, MEASURE * 0.4 - 18).slice(0, 2).forEach((l, i) => text(l, M + MEASURE * 0.6, y - 38 - i * 16, 13, "sansBold", NAVY));
  y -= amtH + 18;

  // ── The facts, two columns of cells ───────────────────────────────────────
  const gap = 10;
  const colW = (MEASURE - gap) / 2;
  type Cell = { k: string; v: string; mono?: boolean };
  const refText = f.reference && f.mpesaCode && f.reference.startsWith(f.mpesaCode) ? f.reference.slice(f.mpesaCode.length).trim() : f.reference;
  const cells: Cell[] = [
    { k: "Paid from fund", v: f.fund },
    { k: "Category", v: f.category },
    { k: "Department", v: f.department ?? "Not tied to a department" },
    { k: "Department need", v: f.need ?? "—" },
    { k: "Paid by", v: f.channel },
    { k: f.mpesaCode ? "M-Pesa code" : "Reference", v: f.mpesaCode ?? f.reference ?? "—", mono: true },
  ];
  const cellRows: Cell[][] = [];
  for (let i = 0; i < cells.length; i += 2) cellRows.push(cells.slice(i, i + 2));
  for (const row of cellRows) {
    const lines = row.map((c) => wrap(c.v, font.sans, 10.5, colW - 24).slice(0, 2));
    const h = 34 + (Math.max(...lines.map((l) => l.length)) - 1) * 13;
    row.forEach((c, i) => {
      const x = M + i * (colW + gap);
      box(page, x, y - h, colW, h, CELL);
      label(c.k, x + 12, y - 14);
      lines[i]!.forEach((l, j) => text(l, x + 12, y - 28 - j * 13, 10.5, c.mono ? "sansBold" : "sans", INK));
    });
    y -= h + gap;
  }
  if (f.needLine) {
    for (const l of wrap(f.needLine, font.sans, 8.5, MEASURE).slice(0, 2)) {
      text(l, M, y - 4, 8.5, "sans", MUTED);
      y -= 12;
    }
    y -= 6;
  }

  // ── Purpose, and the full reference as it was pasted ──────────────────────
  y -= 6;
  label("Purpose", M, y);
  y -= 15;
  for (const l of wrap(f.description ?? "No description was given.", font.serif, 11, MEASURE).slice(0, 4)) {
    text(l, M, y, 11, "serif", f.description ? INK : FAINT);
    y -= 14.5;
  }
  if (refText && refText !== (f.mpesaCode ?? "")) {
    y -= 4;
    label(f.mpesaCode ? "Payment message" : "Reference", M, y);
    y -= 13;
    for (const l of wrap(refText, font.sans, 9, MEASURE).slice(0, 3)) {
      text(l, M, y, 9, "sans", MUTED);
      y -= 12;
    }
  }
  if (f.status === "void") {
    y -= 6;
    const reason = `Void: ${f.voidReason ?? "no reason given"}`;
    for (const l of wrap(reason, font.sansBold, 10, MEASURE).slice(0, 2)) {
      text(l, M, y, 10, "sansBold", TONES.void.fg);
      y -= 13;
    }
  }

  // ── Accountability: who prepared, who approved, who received ──────────────
  // Every block above is capped (cells 2 lines, purpose 4, message 3, void 2),
  // so the longest voucher still ends its signatures above the foot at 74.
  const signTop = Math.min(y - 18, 268);
  page.drawLine({ start: { x: M, y: signTop }, end: { x: W - M, y: signTop }, thickness: 0.75, color: RULE });
  text("Accountability", M, signTop - 22, 13, "serifBold", NAVY);
  const blockW = (MEASURE - 2 * 14) / 3;
  const blocks = [
    { k: "Prepared by", name: f.preparedBy, when: f.preparedAt, sign: false },
    {
      k: "Approved by",
      name: f.approvedBy ?? (f.status === "void" ? "Not approved" : "Awaiting approval"),
      when: f.approvedAt ?? "",
      sign: false,
    },
    { k: "Received by", name: "", when: "", sign: true },
  ];
  const bTop = signTop - 40;
  blocks.forEach((b, i) => {
    const x = M + i * (blockW + 14);
    label(b.k, x, bTop);
    if (b.sign) {
      for (const [j, cap] of ["Name", "Signature", "ID / phone · date"].entries()) {
        const ly = bTop - 30 - j * 30;
        page.drawLine({ start: { x, y: ly }, end: { x: x + blockW, y: ly }, thickness: 0.6, color: FAINT });
        text(cap, x, ly - 10, 7.5, "sans", FAINT);
      }
    } else {
      wrap(b.name, font.sansBold, 10.5, blockW).slice(0, 2).forEach((l, j) => text(l, x, bTop - 17 - j * 13, 10.5, "sansBold", b.name.startsWith("Awaiting") || b.name.startsWith("Not ") ? FAINT : INK));
      if (b.when) text(b.when, x, bTop - 47, 8.5, "sans", MUTED);
      const ly = bTop - 72;
      page.drawLine({ start: { x, y: ly }, end: { x: x + blockW, y: ly }, thickness: 0.6, color: FAINT });
      text("Signature", x, ly - 10, 7.5, "sans", FAINT);
    }
  });

  // ── Foot: what this document is, and where it came from ───────────────────
  page.drawLine({ start: { x: M, y: 74 }, end: { x: W - M, y: 74 }, thickness: 0.75, color: RULE });
  const foot1 = `${f.voucherNo} · expense ${f.expenseId}${f.journalRef ? ` · ledger journal ${f.journalRef}` : ""}`;
  text(foot1, M, 60, 7.5, "sans", MUTED);
  text(`Printed ${f.generatedAt} by ${f.generatedBy}, from the church's finance books (Nuru Pathway).`, M, 49, 7.5, "sans", MUTED);
  text(
    f.status === "approved"
      ? "An approved voucher: the money is posted in the ledger. Keep it with the payee's receipt or invoice."
      : f.status === "void"
        ? "This voucher is void. The money it records was reversed or never posted; keep it for the sequence."
        : "Not final: this expense is recorded but not yet approved, and nothing is posted in the ledger.",
    M, 38, 7.5, "sansBold", f.status === "approved" ? MUTED : tone.fg,
  );
  right("“Let all things be done decently and in order.” 1 Cor 14:40", W - M, 24, 7.5, "serifItalic", FAINT);

  // A void voucher says so across the whole page.
  if (f.status === "void") {
    page.drawText("VOID", {
      x: W / 2 - 150, y: H / 2 - 120, size: 150, font: font.sansBold, color: TONES.void.fg,
      opacity: 0.1, rotate: degrees(35),
    });
  }

  return Buffer.from(await doc.save());
}

// ── amounts in words ──────────────────────────────────────────────────────────

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function below1000(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100), r = n % 100;
  if (h) parts.push(`${ONES[h]} hundred`);
  if (r) {
    if (r < 20) parts.push(ONES[r]!);
    else parts.push(TENS[Math.floor(r / 10)]! + (r % 10 ? `-${ONES[r % 10]}` : ""));
  }
  return parts.join(" ");
}

/** 21600 → "twenty-one thousand six hundred". Whole numbers up to trillions. */
export function numberInWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  n = Math.floor(n);
  if (n === 0) return "zero";
  const scales = ["", " thousand", " million", " billion", " trillion"];
  const out: string[] = [];
  let i = 0;
  while (n > 0 && i < scales.length) {
    const chunk = n % 1000;
    if (chunk) out.unshift(below1000(chunk) + scales[i]);
    n = Math.floor(n / 1000);
    i++;
  }
  return out.join(" ");
}

const CURRENCY_WORDS: Record<string, [string, string]> = {
  KES: ["Kenya shillings", "cents"],
  USD: ["US dollars", "cents"],
  UGX: ["Uganda shillings", "cents"],
  TZS: ["Tanzania shillings", "cents"],
  EUR: ["euros", "cents"],
  GBP: ["pounds sterling", "pence"],
};

/** 2160000 KES → "Twenty-one thousand six hundred Kenya shillings only". */
export function amountInWords(amountMinor: number, currency: string): string {
  const [unit, sub] = CURRENCY_WORDS[currency.toUpperCase()] ?? [currency.toUpperCase(), "cents"];
  const whole = Math.floor(amountMinor / 100);
  const cents = amountMinor % 100;
  const s = `${numberInWords(whole)} ${unit}${cents ? ` and ${numberInWords(cents)} ${sub}` : ""} only`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
