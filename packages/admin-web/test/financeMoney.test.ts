// Finance money helpers (components/finance/money.ts): integer minor units +
// ISO currency, exact at any size, never a sum across currencies
// (docs/FINANCE_ERP.md principles).
import { describe, it, expect } from "vitest";
import {
  formatMinor,
  parseMajorToMinor,
  minorToMajorInput,
  totalsByCurrency,
  addMoney,
  formatTotals,
  sortTotals,
  totalFor,
  compareCurrencies,
  MAX_AMOUNT_MINOR,
} from "../src/components/finance/money";

describe("formatMinor", () => {
  it("formats each currency with its code, grouping and two decimals", () => {
    expect(formatMinor(123450, "KES")).toBe("KES 1,234.50");
    expect(formatMinor(1200, "USD")).toBe("USD 12.00");
    expect(formatMinor(5, "KES")).toBe("KES 0.05");
    expect(formatMinor(0, "KES")).toBe("KES 0.00");
    expect(formatMinor(100_000_000, "KES")).toBe("KES 1,000,000.00");
    expect(formatMinor(1200, "usd")).toBe("USD 12.00");
  });

  it("puts the sign in front of the code for negatives", () => {
    expect(formatMinor(-5000, "KES")).toBe("-KES 50.00");
    expect(formatMinor(-1, "USD")).toBe("-USD 0.01");
    expect(formatMinor(-123456789, "KES")).toBe("-KES 1,234,567.89");
    expect(formatMinor("-0", "KES")).toBe("KES 0.00");
  });

  it("is exact for huge values — BIGINT text and bigint, past 2^53", () => {
    // 2^53 + 1 cannot be a JS number; as text it must survive to the last digit.
    expect(formatMinor("9007199254740993", "KES")).toBe("KES 90,071,992,547,409.93");
    expect(formatMinor(10n ** 20n, "USD")).toBe("USD 1,000,000,000,000,000,000.00");
    expect(formatMinor(Number.MAX_SAFE_INTEGER, "KES")).toBe("KES 90,071,992,547,409.91");
  });

  it("accepts a BIGINT serialised as text (claims' amount_minor)", () => {
    expect(formatMinor("12345", "KES")).toBe("KES 123.45");
    expect(formatMinor(" 700 ", "KES")).toBe("KES 7.00");
  });

  it("never does float arithmetic (values that break /100 + toFixed)", () => {
    expect(formatMinor(1005, "KES")).toBe("KES 10.05");
    expect(formatMinor(29, "KES")).toBe("KES 0.29");
    expect(formatMinor(4_503_599_627_370_497, "KES")).toBe("KES 45,035,996,273,704.97");
  });

  it("can drop the code for a column that already names the currency", () => {
    expect(formatMinor(123450, "KES", { withCode: false })).toBe("1,234.50");
    expect(formatMinor(123450, null)).toBe("1,234.50");
  });

  it("shows a dash for anything that is not an amount", () => {
    expect(formatMinor(null, "KES")).toBe("—");
    expect(formatMinor(undefined, "KES")).toBe("—");
    expect(formatMinor(Number.NaN, "KES")).toBe("—");
    expect(formatMinor(Number.POSITIVE_INFINITY, "KES")).toBe("—");
    expect(formatMinor("12.5", "KES")).toBe("—");
    expect(formatMinor("abc", "KES")).toBe("—");
    expect(formatMinor("", "KES")).toBe("—");
  });

  it("rounds a computed non-integer (a display average) to the nearest minor unit", () => {
    expect(formatMinor(1234.6, "KES")).toBe("KES 12.35");
  });
});

describe("parseMajorToMinor", () => {
  const ok = (s: string): number => {
    const r = parseMajorToMinor(s);
    if (!r.ok) throw new Error(`expected ${s} to parse: ${r.error}`);
    return r.minor;
  };
  const err = (s: string, max?: number): string => {
    const r = parseMajorToMinor(s, { max });
    if (r.ok) throw new Error(`expected ${s} to be refused, got ${r.minor}`);
    return r.error;
  };

  it("reads plain and grouped amounts exactly", () => {
    expect(ok("1500")).toBe(150000);
    expect(ok("1,500")).toBe(150000);
    expect(ok("1,500.50")).toBe(150050);
    expect(ok("1,234,567.89")).toBe(123456789);
    expect(ok("0.5")).toBe(50);
    expect(ok(".5")).toBe(50);
    expect(ok("12.")).toBe(1200);
    expect(ok("  42  ")).toBe(4200);
    expect(ok("0.01")).toBe(1);
    expect(ok("19.99")).toBe(1999);
    expect(ok("+7")).toBe(700);
  });

  it("allows at most two decimals", () => {
    expect(err("1.234")).toMatch(/2 decimal/);
    expect(err("0.001")).toMatch(/2 decimal/);
  });

  it("refuses zero and negatives", () => {
    expect(err("0")).toMatch(/more than zero/);
    expect(err("0.00")).toMatch(/more than zero/);
    expect(err("-5")).toMatch(/more than zero/);
  });

  it("refuses what is not a number, instead of guessing", () => {
    expect(err("")).toBe("Enter an amount.");
    expect(err("   ")).toBe("Enter an amount.");
    expect(err("abc")).toMatch(/Enter a number/);
    expect(err("1e5")).toMatch(/Enter a number/);
    expect(err(".")).toMatch(/Enter a number/);
    expect(err("1 500")).toMatch(/Enter a number/);
    expect(err("1,2345")).toMatch(/Enter a number/);
    expect(err("KES 100")).toMatch(/Enter a number/);
  });

  it("refuses a decimal comma — '12,50' would otherwise be 1,250.00", () => {
    expect(err("12,50")).toMatch(/full stop/);
    expect(err("1,5")).toMatch(/full stop/);
    // …while a real thousands group still reads as one
    expect(ok("12,500")).toBe(1_250_000);
  });

  it("caps one entry at 1,000,000,000 minor (10,000,000.00)", () => {
    expect(MAX_AMOUNT_MINOR).toBe(1_000_000_000);
    expect(ok("10000000")).toBe(1_000_000_000);
    expect(ok("10,000,000.00")).toBe(1_000_000_000);
    expect(err("10000000.01")).toMatch(/10,000,000\.00 limit/);
    expect(err("99999999999999999999")).toMatch(/limit/);
    expect(err("500.01", 50_000)).toMatch(/500\.00 limit/);
  });
});

describe("minorToMajorInput", () => {
  it("seeds an input with the exact major-unit text", () => {
    expect(minorToMajorInput(150050)).toBe("1500.50");
    expect(minorToMajorInput(5)).toBe("0.05");
    expect(minorToMajorInput(-5)).toBe("-0.05");
    expect(minorToMajorInput(null)).toBe("");
  });
});

describe("per-currency totals", () => {
  it("groups per currency, KES first, and never adds across currencies", () => {
    const totals = totalsByCurrency([
      { amount_minor: 500, currency: "USD" },
      { amount_minor: 10000, currency: "KES" },
      { amount_minor: 25000, currency: "kes" },
      { amount_minor: 1, currency: "EUR" },
    ]);
    expect(totals).toEqual([
      { currency: "KES", amount_minor: 35000, count: 2 },
      { currency: "EUR", amount_minor: 1, count: 1 },
      { currency: "USD", amount_minor: 500, count: 1 },
    ]);
    expect(totalsByCurrency([])).toEqual([]);
  });

  it("adds only the same currency", () => {
    expect(addMoney({ amount_minor: 100, currency: "KES" }, { amount_minor: 250, currency: "kes" })).toEqual({ amount_minor: 350, currency: "KES" });
    expect(() => addMoney({ amount_minor: 100, currency: "KES" }, { amount_minor: 1, currency: "USD" })).toThrow(/per currency/);
  });

  it("orders KES first, then A to Z", () => {
    expect(["USD", "EUR", "KES"].sort(compareCurrencies)).toEqual(["KES", "EUR", "USD"]);
    expect(sortTotals([{ currency: "USD" }, { currency: "KES" }]).map((t) => t.currency)).toEqual(["KES", "USD"]);
  });

  it("formats and finds totals", () => {
    const totals = [
      { currency: "USD", amount_minor: 5, count: 1 },
      { currency: "KES", amount_minor: 350, count: 2 },
    ];
    expect(formatTotals(totals)).toBe("KES 3.50 · USD 0.05");
    expect(formatTotals([])).toBe("—");
    expect(formatTotals([], "Nothing yet")).toBe("Nothing yet");
    expect(totalFor(totals, "usd")?.amount_minor).toBe(5);
    expect(totalFor(totals, "EUR")).toBeNull();
  });
});
