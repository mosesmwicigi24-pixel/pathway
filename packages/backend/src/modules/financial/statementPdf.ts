// Minimal, dependency-free PDF renderer for a member's statements and receipts
// (mirrors certificates/pdf.ts). Produces a valid PDF/1.4 from lines of text:
// one or more logical pages (the Partners statement is two: impact, then the
// ledger), each flowing onto continuation pages when it outgrows one — so a
// long history is printed whole, never cut off. Text is Helvetica in
// WinAnsiEncoding; the check and cross marks come from ZapfDingbats — both
// standard-14 fonts, so nothing is embedded.
function pdfEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Unicode punctuation above Latin-1 that WinAnsiEncoding still has a glyph
 *  for, at its WinAnsi code. Latin-1 itself (≤ 0xFF, e.g. the middle dot ·)
 *  maps to itself; anything else prints as "?" rather than as a wrong glyph. */
const WIN_ANSI: Readonly<Record<string, number>> = {
  "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "‰": 0x89, "‹": 0x8b,
  "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "™": 0x99, "›": 0x9b,
};
function winAnsi(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0x3f;
    const w = WIN_ANSI[ch];
    out += w !== undefined ? String.fromCharCode(w) : cp <= 0xff ? ch : "?";
  }
  return out;
}

/** Marks drawn from ZapfDingbats (font /F2), at their ZapfDingbats codes. */
const DINGBATS: Readonly<Record<string, string>> = { "✓": "3", "✔": "4", "✗": "7", "✘": "8" };

/** One line of text as content-stream operators at `size` pt: Helvetica runs,
 *  with any dingbat mark switched to /F2 and back, then a line break. */
function showLine(line: string, size: number): string {
  let ops = "";
  let run = "";
  const flush = (): void => {
    if (run) ops += `(${pdfEscape(winAnsi(run))}) Tj `;
    run = "";
  };
  for (const ch of line) {
    const z = DINGBATS[ch];
    if (z === undefined) { run += ch; continue; }
    flush();
    ops += `/F2 ${size} Tf (${z}) Tj /F1 ${size} Tf `;
  }
  flush();
  return `${ops}T*\n`;
}

export interface StatementGroup {
  label: string; // "MAY 2026"
  totalLabel: string; // "KSh 3,500"
  rows: string[]; // one line per gift
}

export interface StatementFacts {
  congregation: string;
  member: string;
  /** "Year 2026" when the statement covers one year (the office's download);
   *  absent for the member's complete record. */
  periodLabel?: string;
  /** Σ settled gifts outside a pledge ("KSh 3,500"). */
  giftsLabel: string;
  /** Σ settled pledge-tied payments; null when that is zero — the header
   *  then reads just "Total given KSh X", as both apps' hero does. */
  pledgesLabel: string | null;
  /** giftsLabel + pledgesLabel — the grand total; it must foot. */
  totalLabel: string;
  /** Records listed: gifts outside a pledge, and pledge payments. */
  giftCount: number;
  pledgeCount: number;
  generatedAt: string;
  /** Gifts outside a pledge only, grouped by day, newest first. */
  groups: StatementGroup[];
  /** The PARTNER PLEDGES section (§3d): pledge-tied payments with their
   *  pledge's title and a subtotal. Null when there are none. */
  pledges: { totalLabel: string; rows: string[] } | null;
}

const MAX_LINES = 52; // fits one US-Letter page at 14pt leading from y=748

export interface ReceiptFacts {
  congregation: string;
  member: string;
  ref: string;
  amountLabel: string;
  fund: string;
  /** "Named giving" (custom sheet, optional): the member's own label for this
   *  gift (e.g. "Building Fund", a loved one's name) — shown under the fund. */
  giftName?: string | null;
  /** The pledge this gift counted toward, under the words its card shows
   *  (PartnersService.title) — prints "toward your <title> pledge". */
  pledgeTitle?: string | null;
  /** The department need this gift went to — prints "toward <title>". */
  needTitle?: string | null;
  methodLabel: string;
  statusLabel: string;
  feeLabel: string;
  totalLabel: string;
  initiatedAt: string;
  settledAt: string | null;
  generatedAt: string;
}

/** A single-gift receipt as a one-page PDF (dep-free), mirroring the in-app
 *  "Giving receipt": header, the gift, a transaction journey, totals, and a
 *  scripture. Reuses the same minimal PDF/1.4 writer as the statement. */
export function renderReceiptPdf(f: ReceiptFacts): Buffer {
  const lines: string[] = [
    "NURU PATHWAY - GIVING RECEIPT",
    f.congregation,
    "Received with thanks",
    "",
    `${f.amountLabel}   ${f.fund}`,
    ...(f.giftName ? [`"${f.giftName}"`] : []),
    ...(f.pledgeTitle ? [`toward your ${f.pledgeTitle} pledge`] : []),
    ...(f.needTitle ? [`toward ${f.needTitle}`] : []),
    `Ref ${f.ref}   -   ${f.statusLabel}`,
    "",
    "TRANSACTION JOURNEY",
    `  01 Initiated   ${f.member}`,
    `     ${f.initiatedAt}`,
    `  02 Authorized  ${f.methodLabel}${f.ref ? `  -  Code ${f.ref}` : ""}`,
    `  03 Received     ${f.congregation}  -  ${f.fund}`,
    `  04 Settled      ${f.settledAt ? `Cleared ${f.amountLabel}  -  ${f.settledAt}` : f.statusLabel}`,
    "",
    `Account: ${f.fund}    Fee: ${f.feeLabel}    Total: ${f.totalLabel}`,
    "",
    '"Each of you should give what you have decided in your heart to give,',
    ' for God loves a cheerful giver."   - 2 Corinthians 9:7',
    "",
    `Official receipt - Finance - ${f.congregation}`,
    `Generated: ${f.generatedAt}`,
  ];
  return renderLinesPdf(lines);
}

/** One pledge's block on the Partners statement — labels prepared by the
 *  service (PartnersService.partnersStatementPdf), laid out here. */
export interface PartnersStatementPledgeBlock {
  title: string;              // "Kenya trip"
  termsLabel: string;         // "KSh 2,000 monthly · due on the 5th" | "KSh 50,000 by 15 Jan 2027"
  statusLabel: string;        // "Active"
  paidLabel: string;          // "Paid this year KSh 6,000"
  keptLabel: string | null;   // "3 of 6 kept" (monthly) | null (total)
}

/** One commitment on the Partners statement's first page. */
export interface PartnersStatementCommitment {
  title: string;              // "Kenya trip"
  termsLabel: string;         // "KSh 2,000 monthly · due on the 5th"
  remainingLabel: string;     // "Remaining this year KSh 14,000"
  churchLabel: string | null; // "The church is 16% of the way there" (a department need) | null
}

export interface PartnersStatementFacts {
  // Page 1 — what the partnership did (§3d).
  thanksLabel: string;        // "Thank you, Amina."
  impactLabel: string;        // "Carries one disciple through a level" | "KSh 4,000 of 20,000 toward carrying one disciple through a level"
  keptLabel: string;          // "Kept 4 of 6 · 2 late" (kept includes late)
  givenLabel: string;         // "Given KSh 4,000 toward pledges"
  stripLabel: string;         // "Jan –   Feb ✓   Mar late   Apr ✗ …"
  commitments: PartnersStatementCommitment[];
  // Page 2 — the ledger.
  year: number;
  congregation: string;
  member: string;
  sinceLabel: string | null;  // "Partner since Mar 2026"
  tierName: string | null;
  pledgedLabel: string;
  paidLabel: string;
  remainingLabel: string;
  pledges: PartnersStatementPledgeBlock[];
  /** Pledge-tied payments by month, January first — a year reads top-down. */
  groups: StatementGroup[];
  totalLabel: string;
  count: number;
  generatedAt: string;
}

/** The Partners statement for one year, two pages (docs/PARTNERS_PROGRAMME.md
 *  §3a, §3d). Page 1 leads with what the partnership did: the thank-you, the
 *  three figures (disciples carried, kept N of M, given), the month strip and
 *  the commitments with what remains this year. Page 2 is the ledger: the
 *  Pledged / Paid / Remaining summary, one block per pledge, then the
 *  pledge-tied payments by month with subtotals and a year total. Gifts
 *  outside a pledge are NOT here — they are the giving statement's. */
export function renderPartnersStatementPdf(f: PartnersStatementFacts): Buffer {
  const impact: string[] = [
    f.thanksLabel,
    ...(f.sinceLabel || f.tierName ? [[f.sinceLabel, f.tierName].filter(Boolean).join(" · ")] : []),
    `Partners statement · ${f.year} · ${f.congregation}`,
    "",
    `   ${f.impactLabel}`,
    `   ${f.keptLabel}`,
    `   ${f.givenLabel}`,
    "",
    "YOUR YEAR",
    `   ${f.stripLabel}`,
    "   ✓ kept on time    late: paid after the due date    ✗ missed    · upcoming    – nothing due",
    "",
    "COMMITMENTS",
  ];
  if (f.commitments.length === 0) impact.push(`   No commitments in ${f.year}.`);
  for (const c of f.commitments) {
    impact.push(`   ${c.title}`);
    impact.push(`      ${[c.termsLabel, c.remainingLabel, c.churchLabel].filter(Boolean).join("   -   ")}`);
  }

  const lines: string[] = [
    `Partners statement · ${f.year}`,
    f.congregation,
    f.member,
    ...(f.sinceLabel || f.tierName ? [[f.sinceLabel, f.tierName].filter(Boolean).join(" · ")] : []),
    "",
    "SUMMARY",
    `   Pledged     ${f.pledgedLabel}`,
    `   Paid        ${f.paidLabel}`,
    `   Remaining   ${f.remainingLabel}`,
    "",
    "PLEDGES",
  ];
  if (f.pledges.length === 0) lines.push(`   No pledges in ${f.year}.`);
  for (const p of f.pledges) {
    lines.push(`   ${p.title}`);
    lines.push(`      ${p.termsLabel}   -   ${p.statusLabel}`);
    lines.push(`      ${p.paidLabel}${p.keptLabel ? `   -   ${p.keptLabel}` : ""}`);
  }
  lines.push("", "PLEDGE PAYMENTS");
  if (f.groups.length === 0) lines.push(`   No pledge payments in ${f.year}.`);
  for (const g of f.groups) {
    lines.push(`${g.label}   ${g.totalLabel}`);
    for (const r of g.rows) lines.push(`   ${r}`);
  }
  lines.push("", `Year total: ${f.totalLabel}   (${f.count} payment${f.count === 1 ? "" : "s"})`);
  lines.push("", `Generated ${f.generatedAt} · Nuru Place`);
  return renderPagesPdf([impact, lines]);
}

/** The complete giving statement (§3d): every gift, every fund — pledge money
 *  is separated, never dropped. The header foots (gifts + partner pledges =
 *  total; just "Total given" when there is no pledge money); the day groups
 *  carry gifts outside a pledge only; the pledge-tied payments sit in their
 *  own PARTNER PLEDGES section with a subtotal. */
export function renderStatementPdf(facts: StatementFacts): Buffer {
  const lines: string[] = [
    "NURU PATHWAY - GIVING STATEMENT",
    facts.congregation,
    facts.member,
    ...(facts.periodLabel ? [facts.periodLabel] : []),
    "",
    facts.pledgesLabel === null
      ? `Total given ${facts.totalLabel}`
      : `Gifts ${facts.giftsLabel} · Partner pledges ${facts.pledgesLabel} · Total ${facts.totalLabel}`,
    `${facts.giftCount} gift${facts.giftCount === 1 ? "" : "s"}${facts.pledgeCount > 0 ? ` · ${facts.pledgeCount} pledge payment${facts.pledgeCount === 1 ? "" : "s"}` : ""}`,
    `Generated: ${facts.generatedAt}`,
    "",
  ];
  for (const g of facts.groups) {
    lines.push(`${g.label}   ${g.totalLabel}`);
    for (const r of g.rows) lines.push(`   ${r}`);
    lines.push("");
  }
  if (facts.pledges) {
    lines.push(`PARTNER PLEDGES   ${facts.pledges.totalLabel}`);
    for (const r of facts.pledges.rows) lines.push(`   ${r}`);
    lines.push("");
  }
  lines.push(`Total ${facts.totalLabel}`);
  return renderLinesPdf(lines);
}

/** One logical page: a title line (14pt) then body lines (10pt). Used by the
 *  statement and the single-gift receipt. */
function renderLinesPdf(lines: string[]): Buffer {
  return renderPagesPdf([lines]);
}

/** The shared PDF/1.4 writer. Each logical page starts on a new sheet with
 *  its first line as a 14pt title, then 10pt body lines at 14pt leading; a
 *  logical page longer than MAX_LINES flows onto continuation sheets (body
 *  lines only), so nothing is ever cut off. */
function renderPagesPdf(pages: string[][]): Buffer {
  const contents: string[] = [];
  for (const page of pages) {
    const [title = "", ...body] = page;
    // The first sheet spends one of its MAX_LINES on the title.
    let content = `BT /F1 14 Tf 56 748 Td 16 TL\n${showLine(title, 14)}/F1 10 Tf 14 TL\n`;
    let room = MAX_LINES - 1;
    for (const line of body) {
      if (room === 0) {
        contents.push(`${content}ET`);
        content = "BT /F1 10 Tf 56 748 Td 14 TL\n";
        room = MAX_LINES;
      }
      content += showLine(line, 10);
      room -= 1;
    }
    contents.push(`${content}ET`);
  }

  // 1 catalog · 2 page tree · 3 Helvetica · 4 ZapfDingbats · then a page and
  // its content stream per sheet.
  const pageObj = (i: number): number => 5 + i * 2;
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    `<</Type/Pages/Kids[${contents.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}]/Count ${contents.length}>>`,
    // WinAnsi so the bytes we write render as themselves — the middle dot
    // (0xB7) the Partners statement uses is a bullet in StandardEncoding.
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>",
    "<</Type/Font/Subtype/Type1/BaseFont/ZapfDingbats>>",
    ...contents.flatMap((content, i) => [
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 3 0 R/F2 4 0 R>>>>/Contents ${pageObj(i) + 1} 0 R>>`,
      `<</Length ${Buffer.byteLength(content, "latin1")}>>\nstream\n${content}\nendstream`,
    ]),
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}
