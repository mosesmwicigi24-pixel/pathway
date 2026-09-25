import { describe, it, expect } from "vitest";
import { csvCell, csvDocument, minorToMajor } from "../src/modules/financial/csv.js";

describe("finance CSV", () => {
  it("neutralises spreadsheet formulas and quotes per RFC 4180", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+254700000000")).toBe("'+254700000000");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("Tithe, June")).toBe("\"Tithe, June\"");
    expect(csvCell("line1\nline2")).toBe("\"line1\nline2\"");
    expect(csvCell(-5)).toBe("-5"); // numbers are data, not formulas
    expect(csvCell(null)).toBe("");
  });
  it("prints money exactly from minor units", () => {
    expect(minorToMajor(123456)).toBe("1234.56");
    expect(minorToMajor(5)).toBe("0.05");
    expect(minorToMajor(-250)).toBe("-2.50");
    expect(minorToMajor("900719925474099312")).toBe("9007199254740993.12");
  });
  it("writes a BOM, a header and CRLF rows", () => {
    const doc = csvDocument(["a", "b"], [[1, "x"], [2, "=y"]]);
    expect(doc.startsWith("﻿a,b\r\n1,x\r\n2,'=y\r\n")).toBe(true);
  });
});
