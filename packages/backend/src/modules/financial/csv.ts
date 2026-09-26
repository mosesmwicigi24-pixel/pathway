// CSV for finance exports (docs/FINANCE_ERP.md §4). RFC 4180 quoting, a
// header row, and spreadsheet-formula neutralisation: a cell that starts with
// = + - @ (or a tab / carriage return) gets a leading apostrophe so Excel and
// Sheets show it as text instead of executing it. Money goes out as major
// units with two decimals (from integer minor units — never floats in, exact
// string out) plus the ISO currency in its own column.

export type CsvCell = string | number | boolean | null | undefined | Date;

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : typeof v === "number" ? String(v) : String(v);
  if (typeof v === "string" && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(cells: CsvCell[]): string {
  return cells.map(csvCell).join(",");
}

/** A whole document: header + rows, CRLF line endings (RFC 4180), UTF-8 BOM so
 *  Excel opens KES / Swahili names correctly. */
export function csvDocument(header: string[], rows: CsvCell[][]): string {
  return "﻿" + [csvRow(header), ...rows.map(csvRow)].join("\r\n") + "\r\n";
}

/** 123456 → "1234.56" — exact, from integer minor units. Negative safe. */
export function minorToMajor(minor: number | bigint | string): string {
  const n = BigInt(minor);
  const neg = n < 0n;
  const a = neg ? -n : n;
  const whole = a / 100n;
  const cents = (a % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole}.${cents}`;
}

/** Send a CSV download (Express response-like object). */
export function sendCsv(
  res: { setHeader(name: string, value: string): unknown; send(body: string): unknown },
  filename: string,
  header: string[],
  rows: CsvCell[][],
): void {
  const safe = filename.replace(/[^A-Za-z0-9_.-]/g, "-");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safe}"`);
  res.send(csvDocument(header, rows));
}
