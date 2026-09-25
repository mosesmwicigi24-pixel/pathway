// Minimal, dependency-free PDF renderer for a member's giving statement (mirrors
// certificates/pdf.ts). Produces a single-page, valid PDF/1.4 listing the gifts
// grouped by month. Long statements (> ~one page) are truncated with a note —
// good enough for a member's own annual statement; a richer multi-page template
// can replace this without touching callers.
function pdfEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export interface StatementGroup {
  label: string; // "MAY 2026"
  totalLabel: string; // "KSh 3,500"
  rows: string[]; // one line per gift
}

export interface StatementFacts {
  congregation: string;
  member: string;
  totalLabel: string;
  count: number;
  generatedAt: string;
  groups: StatementGroup[];
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

export interface PartnersStatementFacts {
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

/** The Partners statement for one year (docs/PARTNERS_PROGRAMME.md §3a):
 *  the Pledged / Paid / Remaining summary, one block per pledge, then the
 *  pledge-tied payments by month with subtotals and a year total. Gifts
 *  outside a pledge are NOT here — they are the giving statement's. Same
 *  dep-free writer and style as that statement. */
export function renderPartnersStatementPdf(f: PartnersStatementFacts): Buffer {
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
  return renderLinesPdf(lines);
}

export function renderStatementPdf(facts: StatementFacts): Buffer {
  const lines: string[] = [
    "NURU PATHWAY - GIVING STATEMENT",
    facts.congregation,
    facts.member,
    "",
    `Total given: ${facts.totalLabel}   (${facts.count} gift${facts.count === 1 ? "" : "s"})`,
    `Generated: ${facts.generatedAt}`,
    "",
  ];
  for (const g of facts.groups) {
    lines.push(`${g.label}   ${g.totalLabel}`);
    for (const r of g.rows) lines.push(`   ${r}`);
    lines.push("");
  }
  return renderLinesPdf(lines);
}

/** Shared one-page PDF/1.4 writer: a title line (14pt) then body lines (10pt),
 *  truncated to one page. Used by both the statement and the single-gift receipt. */
function renderLinesPdf(lines: string[]): Buffer {
  const shown = lines.slice(0, MAX_LINES);
  if (lines.length > MAX_LINES) shown.push(`… and ${lines.length - MAX_LINES} more line(s) — see the app for the full history.`);

  // 11pt title line, then 10pt body. Single text block, 14pt leading.
  let content = "BT /F1 14 Tf 56 748 Td 16 TL\n";
  content += `(${pdfEscape(shown[0] ?? "")}) Tj T*\n`;
  content += "/F1 10 Tf 14 TL\n";
  for (const line of shown.slice(1)) content += `(${pdfEscape(line)}) Tj T*\n`;
  content += "ET";

  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>",
    // WinAnsi so the latin1 bytes we write render as themselves — the middle
    // dot (0xB7) the Partners statement uses is a bullet in StandardEncoding.
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>",
    `<</Length ${Buffer.byteLength(content, "latin1")}>>\nstream\n${content}\nendstream`,
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
