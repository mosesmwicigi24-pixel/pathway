// Finance dates (components/finance/dates.ts): every range is inclusive EAT
// calendar days (Africa/Nairobi, UTC+3) — the server's basis. The dangerous
// window is 21:00–03:00 UTC, when the UTC date and the Nairobi date differ.
import { describe, it, expect, afterEach } from "vitest";
import {
  todayEAT,
  currentYearEAT,
  presetRange,
  periodFor,
  isIsoDate,
  rangeError,
  yearOptions,
  fmtDay,
  fmtMonth,
  fmtDateTimeEAT,
  fmtDateEAT,
  fmtRange,
  DATE_PRESETS,
} from "../src/components/finance/dates";

const at = (iso: string): Date => new Date(iso);

describe("todayEAT", () => {
  it("turns over at 21:00 UTC (midnight in Nairobi)", () => {
    expect(todayEAT(at("2026-09-30T20:59:59Z"))).toBe("2026-09-30");
    expect(todayEAT(at("2026-09-30T21:00:00Z"))).toBe("2026-10-01");
  });

  it("is already tomorrow through the small hours UTC", () => {
    expect(todayEAT(at("2026-09-30T23:30:00Z"))).toBe("2026-10-01");
    expect(todayEAT(at("2026-10-01T02:59:59Z"))).toBe("2026-10-01");
    expect(todayEAT(at("2026-10-01T03:00:00Z"))).toBe("2026-10-01");
  });
});

describe("presetRange — month boundaries in EAT", () => {
  it("This month: 1st of the Nairobi month → today", () => {
    expect(presetRange("this_month", at("2026-09-30T20:59:59Z"))).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("this_month", at("2026-09-30T21:00:00Z"))).toEqual({ from: "2026-10-01", to: "2026-10-01" });
    expect(presetRange("this_month", at("2026-10-01T02:30:00Z"))).toEqual({ from: "2026-10-01", to: "2026-10-01" });
  });

  it("Last month: the whole previous Nairobi month", () => {
    expect(presetRange("last_month", at("2026-09-30T20:59:59Z"))).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(presetRange("last_month", at("2026-09-30T21:00:00Z"))).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    // January → December of the previous year
    expect(presetRange("last_month", at("2026-01-15T09:00:00Z"))).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    // leap February
    expect(presetRange("last_month", at("2024-03-10T09:00:00Z"))).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(presetRange("last_month", at("2026-03-10T09:00:00Z"))).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("This quarter: the quarter's first day → today", () => {
    expect(presetRange("this_quarter", at("2026-09-30T20:59:59Z"))).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(presetRange("this_quarter", at("2026-09-30T21:00:00Z"))).toEqual({ from: "2026-10-01", to: "2026-10-01" });
    expect(presetRange("this_quarter", at("2026-02-14T09:00:00Z"))).toEqual({ from: "2026-01-01", to: "2026-02-14" });
  });

  it("This year: 1 January (Nairobi) → today, across the New Year edge", () => {
    expect(presetRange("this_year", at("2025-12-31T20:59:59Z"))).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(presetRange("this_year", at("2025-12-31T21:00:00Z"))).toEqual({ from: "2026-01-01", to: "2026-01-01" });
  });

  it("Last 12 months: twelve calendar months, the current one to date", () => {
    expect(presetRange("last_12_months", at("2026-09-26T12:00:00Z"))).toEqual({ from: "2025-10-01", to: "2026-09-26" });
    expect(presetRange("last_12_months", at("2025-12-31T21:00:00Z"))).toEqual({ from: "2025-02-01", to: "2026-01-01" });
  });

  it("Custom: the chosen days, today for a missing end", () => {
    const now = at("2026-09-26T12:00:00Z");
    expect(presetRange("custom", now, { from: "2026-01-05", to: "2026-02-10" })).toEqual({ from: "2026-01-05", to: "2026-02-10" });
    expect(presetRange("custom", now, { from: "2026-01-05" })).toEqual({ from: "2026-01-05", to: "2026-09-26" });
    expect(presetRange("custom", now)).toEqual({ from: "2026-09-26", to: "2026-09-26" });
    expect(periodFor("this_month", now)).toEqual({ preset: "this_month", from: "2026-09-01", to: "2026-09-26" });
  });

  it("offers the six presets of the spec", () => {
    expect(DATE_PRESETS.map((p) => p.label)).toEqual(["This month", "Last month", "This quarter", "This year", "Last 12 months", "Custom"]);
  });
});

describe("independence from the machine's time zone", () => {
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it("picks Nairobi's days from Los Angeles and from Tokyo", () => {
    for (const tz of ["America/Los_Angeles", "Asia/Tokyo", "UTC"]) {
      process.env.TZ = tz;
      expect(todayEAT(at("2026-09-30T21:00:00Z"))).toBe("2026-10-01");
      expect(presetRange("last_month", at("2026-09-30T21:00:00Z"))).toEqual({ from: "2026-09-01", to: "2026-09-30" });
      expect(currentYearEAT(at("2025-12-31T21:00:00Z"))).toBe(2026);
      expect(fmtDateTimeEAT("2026-09-30T21:05:00Z")).toBe("1 Oct 2026, 00:05");
    }
  });
});

describe("validation", () => {
  it("knows a real calendar day", () => {
    expect(isIsoDate("2026-09-26")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-9-1")).toBe(false);
    expect(isIsoDate("")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });

  it("explains a bad range", () => {
    expect(rangeError({ from: "2026-09-01", to: "2026-09-30" })).toBeNull();
    expect(rangeError({ from: "2026-09-30", to: "2026-09-30" })).toBeNull();
    expect(rangeError({ from: "2026-10-01", to: "2026-09-30" })).toMatch(/after/);
    expect(rangeError({ from: "2026-10-01" })).toMatch(/both/);
  });

  it("lists years newest first, from Nairobi's year", () => {
    expect(yearOptions(at("2026-06-01T00:00:00Z"), 3)).toEqual([2026, 2025, 2024]);
    expect(yearOptions(at("2025-12-31T21:00:00Z"), 2)).toEqual([2026, 2025]);
  });
});

describe("display", () => {
  it("prints days, months, instants and ranges the same way everywhere", () => {
    expect(fmtDay("2026-09-26")).toBe("26 Sep 2026");
    expect(fmtDay("2026-02-30")).toBe("—");
    expect(fmtMonth("2026-09")).toBe("Sep 2026");
    expect(fmtMonth("2026-09-01")).toBe("Sep 2026");
    expect(fmtMonth("bad")).toBe("—");
    expect(fmtDateTimeEAT("2026-09-30T21:05:00Z")).toBe("1 Oct 2026, 00:05");
    expect(fmtDateTimeEAT("2026-09-30T09:00:00Z")).toBe("30 Sep 2026, 12:00");
    expect(fmtDateTimeEAT(null)).toBe("—");
    expect(fmtDateEAT("2026-09-30T21:05:00Z")).toBe("1 Oct 2026");
    expect(fmtRange({ from: "2026-09-01", to: "2026-09-26" })).toBe("1 Sep – 26 Sep 2026");
    expect(fmtRange({ from: "2025-12-01", to: "2026-01-26" })).toBe("1 Dec 2025 – 26 Jan 2026");
    expect(fmtRange({ from: "2026-09-26", to: "2026-09-26" })).toBe("26 Sep 2026");
  });
});
