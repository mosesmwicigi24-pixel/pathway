// The pure rules behind the Pledges … Statements pages (components/finance/b/logic.ts):
// run-rate integer math, the budget grid (spread remainder, 12-value
// validation, overlap rules), maker-checker gating and consequence wording,
// report footing, and the small date helpers.
import { describe, it, expect } from "vitest";
import {
  addDaysIso,
  ageSince,
  approveConsequence,
  approveGate,
  backdateError,
  backdateWindow,
  claimConfirmConsequence,
  claimRejectConsequence,
  daysBetween,
  draftFromLine,
  faithfulnessSummary,
  fundBalanceIn,
  fundImpact,
  keptOfDue,
  kindTotalMinor,
  lineTotalMinor,
  matrixProblems,
  parseBudgetCell,
  parseYear,
  percentOf,
  perMonthFromAnnual,
  planningYears,
  pledgeTermsText,
  recurringTotals,
  SAME_PERSON_SENTENCE,
  sameLines,
  scheduleAnnualMinor,
  signedMinor,
  spreadAnnual,
  spreadAnnualTexts,
  statementMissingText,
  sumMinor,
  validateBudgetLines,
  validateCampaignForm,
  varianceTone,
  voidConsequence,
  ytdMonthCount,
  ytdSum,
  type CampaignForm,
  type DraftLine,
} from "../src/components/finance/b/logic";
import type { BooksExpense, FinancePledgeRow, FinanceReportMatrix } from "../src/api/finance";

// 26 Sep 2026, 10:00 in Nairobi.
const NOW = new Date("2026-09-26T07:00:00Z");

describe("dates", () => {
  it("moves calendar days across month and year ends", () => {
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysIso("2024-03-01", -1)).toBe("2024-02-29");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-09-01", "2026-09-26")).toBe(25);
  });

  it("keeps an office date within [today − 366, today] in Nairobi", () => {
    expect(backdateWindow(NOW)).toEqual({ min: "2025-09-25", max: "2026-09-26" });
    expect(backdateError("2026-09-26", NOW)).toBeNull();
    expect(backdateError("2025-09-25", NOW)).toBeNull();
    expect(backdateError("2025-09-24", NOW)).toMatch(/more than 366 days ago/);
    expect(backdateError("2026-09-27", NOW)).toBe("That date is in the future.");
    expect(backdateError("", NOW)).toBe("Pick a date.");
  });

  it("uses the Nairobi day even late in the UTC evening", () => {
    // 22:30 UTC on the 26th is already the 27th in Nairobi.
    expect(backdateWindow(new Date("2026-09-26T22:30:00Z")).max).toBe("2026-09-27");
  });

  it("words an age", () => {
    expect(ageSince("2026-09-26T06:59:40Z", NOW)).toBe("just now");
    expect(ageSince("2026-09-26T06:48:00Z", NOW)).toBe("12 minutes");
    expect(ageSince("2026-09-26T02:00:00Z", NOW)).toBe("5 hours");
    expect(ageSince("2026-09-23T07:00:00Z", NOW)).toBe("3 days");
    expect(ageSince(null, NOW)).toBe("—");
  });

  it("offers next year for planning and reads ?year=", () => {
    expect(planningYears(NOW, 2)).toEqual([2027, 2026, 2025, 2024]);
    expect(planningYears(NOW, 1, [2019])).toEqual([2027, 2026, 2025, 2019]);
    expect(parseYear("2025", 2026)).toBe(2025);
    expect(parseYear("nope", 2026)).toBe(2026);
    expect(parseYear("1999", 2026)).toBe(2026);
  });
});

describe("money helpers", () => {
  it("sums exactly, text and numbers alike", () => {
    expect(sumMinor([100, "250", null, undefined])).toBe(350);
    expect(sumMinor([900_000_000_000, 900_000_000_000])).toBe(1_800_000_000_000);
  });

  it("gives a floor percentage, or null without a whole", () => {
    expect(percentOf(2_400, 10_000)).toBe(24);
    expect(percentOf(9_999, 10_000)).toBe(99);
    expect(percentOf(15_000, 10_000)).toBe(150);
    expect(percentOf(1, 0)).toBeNull();
  });

  it("signs a variance", () => {
    expect(signedMinor(100_000, "KES")).toBe("+KES 1,000.00");
    expect(signedMinor(-50_000, "KES")).toBe("-KES 500.00");
    expect(signedMinor(0, "KES")).toBe("KES 0.00");
  });
});

describe("recurring run-rate (weekly × 52 / 12, integer math)", () => {
  it("annualises weekly and monthly, and knows nothing else", () => {
    expect(scheduleAnnualMinor(1_000, "weekly")).toBe(52_000n);
    expect(scheduleAnnualMinor(5_000, "Monthly")).toBe(60_000n);
    expect(scheduleAnnualMinor(5_000, "fortnightly")).toBeNull();
  });

  it("divides a year by 12, rounding half up, in integers", () => {
    expect(perMonthFromAnnual(52_000n)).toBe(4_333n); // 4,333.33
    expect(perMonthFromAnnual(78_000n)).toBe(6_500n);
    expect(perMonthFromAnnual(52_078n)).toBe(4_340n); // 4,339.83 → 4,340
    expect(perMonthFromAnnual(6n)).toBe(1n); // 0.5 → 1
    expect(perMonthFromAnnual(5n)).toBe(0n);
  });

  it("totals per currency, rounds once per currency, and counts only active schedules in the run-rate", () => {
    const rows = [
      { amount_minor: 100_100, currency: "KES", frequency: "weekly", status: "active" },
      { amount_minor: 100_100, currency: "KES", frequency: "weekly", status: "active" },
      { amount_minor: 500_000, currency: "KES", frequency: "monthly", status: "paused" },
      { amount_minor: 2_500, currency: "USD", frequency: "monthly", status: "active" },
      { amount_minor: 1_000, currency: "usd", frequency: "quarterly", status: "active" },
    ];
    const totals = recurringTotals(rows);
    expect(totals.map((t) => t.currency)).toEqual(["KES", "USD"]);
    const kes = totals[0];
    // 2 × 100,100 × 52 = 10,410,400 a year → 867,533.33 a month → 867,533.
    // (Rounding each schedule first would give 2 × 433,767 = 867,534.)
    expect(kes).toEqual({ currency: "KES", count: 3, active: 2, monthly_minor: 867_533, unknown: 0 });
    expect(totals[1]).toEqual({ currency: "USD", count: 2, active: 2, monthly_minor: 2_500, unknown: 1 });
  });
});

describe("pledges", () => {
  const monthly = { shape: "monthly" as const, amount_minor: 500_000, target_minor: null, currency: "KES", due_on: null, kept: 7, due_count: 9 };
  it("words terms and kept of due", () => {
    expect(pledgeTermsText(monthly)).toBe("KES 5,000.00 a month");
    expect(pledgeTermsText({ shape: "total", amount_minor: null, target_minor: 12_000_000, currency: "KES", due_on: "2026-12-31" })).toBe("KES 120,000.00 by 31 Dec 2026");
    expect(keptOfDue(monthly)).toBe("7 of 9");
    expect(keptOfDue({ shape: "total", kept: 0, due_count: 0 })).toBe("—");
  });

  const row = (over: Partial<FinancePledgeRow>): FinancePledgeRow => ({
    pledge_id: "p",
    user_id: "u",
    member_name: "Grace",
    member_phone: null,
    title: "Tithe",
    shape: "monthly",
    amount_minor: 500_000,
    target_minor: null,
    currency: "KES",
    status: "active",
    standing: "on_track",
    year: 2026,
    pledged_year_minor: 4_500_000,
    paid_year_minor: 3_500_000,
    remaining_year_minor: 1_000_000,
    paid_total_minor: 3_500_000,
    kept: 7,
    due_count: 9,
    next_due: "2026-10-05",
    overdue_since: null,
    due_day: 5,
    due_on: null,
    created_at: "2026-01-01T00:00:00Z",
    pays_to: { code: "tithe", name: "Tithe" },
    ...over,
  });

  it("summarises a member's faithfulness without adding currencies", () => {
    const s = faithfulnessSummary([
      row({ pledge_id: "a", standing: "behind", overdue_since: "2026-08-05" }),
      row({ pledge_id: "b", kept: 2, due_count: 2, overdue_since: null }),
      row({ pledge_id: "c", shape: "total", kept: 0, due_count: 0, currency: "USD", pledged_year_minor: 10_000, paid_year_minor: 2_500, remaining_year_minor: 7_500 }),
      row({ pledge_id: "d", status: "cancelled", standing: "paused", overdue_since: "2026-01-05" }),
    ]);
    expect(s.standing).toBe("behind");
    expect(s.kept).toBe(9);
    expect(s.due).toBe(11);
    expect(s.monthly).toBe(2);
    expect(s.overdueSince).toBe("2026-08-05"); // the cancelled pledge's date does not count
    expect(s.totals).toEqual([
      { currency: "KES", pledged_minor: 13_500_000, paid_minor: 10_500_000, remaining_minor: 3_000_000, count: 3 },
      { currency: "USD", pledged_minor: 10_000, paid_minor: 2_500, remaining_minor: 7_500, count: 1 },
    ]);
    expect(faithfulnessSummary([]).standing).toBe("none");
    expect(faithfulnessSummary([row({ standing: "fulfilled" })]).standing).toBe("fulfilled");
  });
});

describe("claims wording", () => {
  const claim = { amount_minor: "250000", currency: "KES", pledge_title: "Building Fund", full_name: "Grace Wanjiru" };
  it("states what confirming and rejecting do", () => {
    expect(claimConfirmConsequence(claim, "Building")).toMatch(/^Records KES 2,500\.00 to Building and counts it toward “Building Fund”\./);
    expect(claimConfirmConsequence(claim, null)).toContain("to the fund the pledge pays to");
    expect(claimRejectConsequence(claim)).toContain("Rejects Grace Wanjiru’s claim of KES 2,500.00. Nothing is recorded");
  });
});

describe("expenses — maker-checker", () => {
  const e = { status: "recorded" as const, recorded_by: "me" };
  it("hides Approve from the recorder, with the sentence", () => {
    expect(approveGate({ expense: e, canApprove: true, me: "me", isSuperAdmin: false })).toEqual({ show: false, blocked: "You recorded this expense, so another person must approve it." });
  });
  it("hides it from an editor too", () => {
    expect(approveGate({ expense: { ...e, recorded_by: "other" }, canApprove: true, me: "me", isSuperAdmin: false, editors: ["me"] }).blocked).toBe("You edited this expense, so another person must approve it.");
  });
  it("shows it to a different approver, and to a SuperAdmin who recorded it", () => {
    expect(approveGate({ expense: { ...e, recorded_by: "other" }, canApprove: true, me: "me", isSuperAdmin: false }).show).toBe(true);
    expect(approveGate({ expense: e, canApprove: true, me: "me", isSuperAdmin: true }).show).toBe(true);
  });
  it("never shows it without finance:approve, or once approved/void — and says nothing then", () => {
    expect(approveGate({ expense: { ...e, recorded_by: "other" }, canApprove: false, me: "me", isSuperAdmin: false })).toEqual({ show: false, blocked: null });
    expect(approveGate({ expense: { status: "approved", recorded_by: "other" }, canApprove: true, me: "me", isSuperAdmin: false }).show).toBe(false);
  });
  it("shows it when it cannot tell who I am (the server's SAME_PERSON answers)", () => {
    expect(approveGate({ expense: e, canApprove: true, me: null, isSuperAdmin: false }).show).toBe(true);
    expect(SAME_PERSON_SENTENCE).toMatch(/Another person must approve/);
  });

  const exp = { amount_minor: 150_000, currency: "KES" as const, fund: { code: "general", name: "General Fund" }, channel: "onhand" as const, spent_on: "2026-09-20", status: "approved" as BooksExpense["status"] };
  it("states what approving posts", () => {
    expect(approveConsequence(exp, "Cash")).toBe("Posts KES 1,500.00 out of General Fund via Cash on 20 Sep 2026. The fund's balance drops by that amount.");
  });
  it("states what approving and voiding do to the fund's balance, in the expense's currency", () => {
    const balances = [
      { currency: "KES", balance_minor: 12_000_000 },
      { currency: "USD", balance_minor: 5_000 },
    ];
    expect(fundBalanceIn(balances, "usd")).toBe(5_000);
    expect(fundBalanceIn(balances, "EUR")).toBe(0);
    const approve = fundImpact({ fundName: "General Fund", currency: "KES", balance_minor: fundBalanceIn(balances, "KES"), amount_minor: 1_500_000, action: "approve" });
    expect(approve).toEqual({ before: 12_000_000, after: 10_500_000, sentence: "General Fund balance: KES 120,000.00 → KES 105,000.00 after this.", warning: null });
    const back = fundImpact({ fundName: "General Fund", currency: "KES", balance_minor: 10_500_000, amount_minor: 1_500_000, action: "void" });
    expect(back.sentence).toBe("General Fund balance: KES 105,000.00 → KES 120,000.00 after this.");
    expect(back.warning).toBeNull();
  });

  it("warns — but does not block — when an approval overdraws the fund", () => {
    const over = fundImpact({ fundName: "Missions", currency: "KES", balance_minor: 100_000, amount_minor: 950_000, action: "approve" });
    expect(over.after).toBe(-850_000);
    expect(over.sentence).toBe("Missions balance: KES 1,000.00 → -KES 8,500.00 after this.");
    expect(over.warning).toBe("Missions will be KES 8,500.00 overdrawn — approve only if the money has really left.");
    const still = fundImpact({ fundName: "Missions", currency: "KES", balance_minor: -900_000, amount_minor: 50_000, action: "void" });
    expect(still.warning).toBe("Missions will still be KES 8,500.00 overdrawn after this.");
  });

  it("words a void differently for approved and recorded expenses", () => {
    expect(voidConsequence(exp)).toBe("Posts the reversing entry — General Fund gets KES 1,500.00 back. The expense stays on the register as void, with your reason.");
    expect(voidConsequence({ ...exp, status: "recorded" })).toMatch(/^Nothing was posted yet, so nothing is reversed\./);
  });
});

describe("budget grid", () => {
  const line = (over: Partial<DraftLine>): DraftLine => ({ key: "k", kind: "income", fund: "tithe", category: "", label: "Tithes", months: Array.from({ length: 12 }, () => ""), ...over });

  it("reads a blank or zero month as 0 and refuses what the books would", () => {
    expect(parseBudgetCell("")).toEqual({ ok: true, minor: 0 });
    expect(parseBudgetCell("0")).toEqual({ ok: true, minor: 0 });
    expect(parseBudgetCell("0.00")).toEqual({ ok: true, minor: 0 });
    expect(parseBudgetCell("1,500.50")).toEqual({ ok: true, minor: 150_050 });
    expect(parseBudgetCell("12,50").ok).toBe(false);
    expect(parseBudgetCell("-5").ok).toBe(false);
    expect(parseBudgetCell("1000000001").ok).toBe(false); // > 1,000,000,000.00
  });

  it("spreads a year evenly, the remainder on December, footing exactly", () => {
    const months = spreadAnnual(1_000_000);
    expect(months.slice(0, 11).every((m) => m === 83_333)).toBe(true);
    expect(months[11]).toBe(83_337);
    expect(sumMinor(months)).toBe(1_000_000);
    expect(spreadAnnual(11)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 11]);
    expect(spreadAnnual(1_200)).toEqual(Array.from({ length: 12 }, () => 100));
    expect(spreadAnnualTexts(1_000_000)[11]).toBe("833.37");
  });

  it("totals a row and a kind", () => {
    const a = line({ months: ["1000", "", "0", "500.50", "", "", "", "", "", "", "", "2,000"] });
    expect(lineTotalMinor(a)).toBe(350_050);
    const b = line({ key: "b", kind: "expense", fund: "", category: "rent", label: "Rent", months: Array.from({ length: 12 }, () => "100") });
    expect(kindTotalMinor([a, b], "income")).toBe(350_050);
    expect(kindTotalMinor([a, b], "expense")).toBe(120_000);
  });

  it("builds a PUT body of exactly 12 integers per line", () => {
    const v = validateBudgetLines([line({ months: ["1,000", "", "", "", "", "", "", "", "", "", "", "12.5"] })]);
    expect(v.ok).toBe(true);
    expect(v.payload).toEqual([{ kind: "income", fund: "tithe", category: null, label: "Tithes", monthly_minor: [100_000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1_250] }]);
    expect(v.payload?.[0]?.monthly_minor).toHaveLength(12);
  });

  it("refuses a line without 12 months, and points at a bad cell", () => {
    const short = validateBudgetLines([line({ months: Array.from({ length: 11 }, () => "1") })]);
    expect(short.ok).toBe(false);
    expect(short.payload).toBeNull();
    expect(short.issues.k?.months.every((m) => m === "Every line has 12 months.")).toBe(true);
    const bad = validateBudgetLines([line({ months: ["1", "x", "", "", "", "", "", "", "", "", "", ""] })]);
    expect(bad.issues.k?.months[1]).toMatch(/Enter a number/);
    expect(bad.issues.k?.months[0]).toBeNull();
  });

  it("applies the kind rules and the label bounds", () => {
    const v = validateBudgetLines([
      line({ key: "i", fund: "" }),
      line({ key: "e", kind: "expense", fund: "", category: "", label: "X" }),
    ]);
    expect(v.issues.i?.fund).toMatch(/names the fund/);
    expect(v.issues.e?.category).toMatch(/names its category/);
    expect(v.issues.e?.label).toMatch(/2–80/);
  });

  it("refuses overlaps so no shilling is budgeted twice", () => {
    const dupIncome = validateBudgetLines([line({ key: "a" }), line({ key: "b" })]);
    expect(dupIncome.issues.a?.overlap).toMatch(/one line per fund/);
    const mixed = validateBudgetLines([
      line({ key: "w", kind: "expense", fund: "", category: "rent", label: "Rent" }),
      line({ key: "f", kind: "expense", fund: "missions", category: "rent", label: "Rent (missions)" }),
    ]);
    expect(mixed.issues.w?.overlap).toMatch(/either church-wide or per fund/);
    expect(mixed.issues.f?.overlap).toMatch(/either church-wide or per fund/);
    const perFund = validateBudgetLines([
      line({ key: "x", kind: "expense", fund: "missions", category: "rent", label: "Rent A" }),
      line({ key: "y", kind: "expense", fund: "general", category: "rent", label: "Rent B" }),
    ]);
    expect(perFund.ok).toBe(true);
  });

  it("maps a saved line to the grid and spots unsaved changes", () => {
    const saved = { line_id: "L1", kind: "expense" as const, fund: null, category: { category_id: "c", code: "rent", name: "Rent" }, label: "Rent", monthly_minor: [0, 150_000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], total_minor: 150_000 };
    const d = draftFromLine(saved);
    expect(d).toMatchObject({ key: "L1", kind: "expense", fund: "", category: "rent" });
    expect(d.months[0]).toBe("");
    expect(d.months[1]).toBe("1500.00");
    expect(sameLines([d], [{ ...d, months: d.months.map((m, i) => (i === 1 ? "1,500" : m)) }])).toBe(true);
    expect(sameLines([d], [{ ...d, label: "Rent!" }])).toBe(false);
  });

  it("counts year-to-date months in Nairobi", () => {
    expect(ytdMonthCount(2025, NOW)).toBe(12);
    expect(ytdMonthCount(2026, NOW)).toBe(9);
    expect(ytdMonthCount(2027, NOW)).toBe(0);
    expect(ytdSum([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 3)).toBe(6);
  });

  it("warns on income below budget and expense above it", () => {
    expect(varianceTone("income", -1)).toBe("warn");
    expect(varianceTone("income", 1)).toBe("good");
    expect(varianceTone("expense", 1)).toBe("warn");
    expect(varianceTone("expense", -1)).toBe("good");
    expect(varianceTone("expense", 0)).toBe("neutral");
  });
});

describe("report footing", () => {
  const block = (over: Partial<FinanceReportMatrix["currencies"][number]> = {}): FinanceReportMatrix["currencies"][number] => ({
    currency: "KES",
    rows: [
      { key: "tithe", label: "Tithe", months: [100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], total_minor: 100 },
      { key: "general", label: "General", months: [50, 25, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], total_minor: 75 },
    ],
    totals: { months: [150, 25, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], total_minor: 175 },
    ...over,
  });
  it("accepts a table that adds up", () => {
    expect(matrixProblems(block())).toEqual([]);
  });
  it("names each place a table does not add up", () => {
    const b = block({ totals: { months: [150, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], total_minor: 175 } });
    const problems = matrixProblems(b);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toBe("Feb: the rows add to KES 0.25, the total says KES 0.30.");
    expect(problems[1]).toMatch(/^The months add to KES 1\.80, the year total says KES 1\.75\./);
  });
});

describe("statements", () => {
  it("says plainly when there is no statement", () => {
    expect(statementMissingText("partners", 2026)).toBe("No partner statement for 2026");
    expect(statementMissingText("giving", 2025)).toBe("No giving statement for 2025");
  });
});

describe("campaign form", () => {
  const form = (over: Partial<CampaignForm> = {}): CampaignForm => ({
    title: "Roof appeal",
    blurb: "Replace the sanctuary roof before the rains.",
    image_url: "",
    fund: "building",
    goal: "500,000",
    currency: "KES",
    starts_on: "2026-10-01",
    ends_on: "2026-12-31",
    match: "",
    match_pledger: "",
    ...over,
  });
  it("builds the body in minor units", () => {
    const v = validateCampaignForm(form({ match: "100000", match_pledger: "The elders" }));
    expect(v.body).toEqual({
      title: "Roof appeal",
      blurb: "Replace the sanctuary roof before the rains.",
      image_url: null,
      fund: "building",
      goal_minor: 50_000_000,
      currency: "KES",
      starts_on: "2026-10-01",
      ends_on: "2026-12-31",
      match_minor: 10_000_000,
      match_pledger: "The elders",
    });
  });
  it("refuses a match nobody pledged, and an end before the start", () => {
    expect(validateCampaignForm(form({ match: "1000" })).errors.match_pledger).toMatch(/Name who pledged the match/);
    expect(validateCampaignForm(form({ match_pledger: "Elders" })).errors.match).toMatch(/Enter the match amount/);
    expect(validateCampaignForm(form({ ends_on: "2026-09-30" })).errors.ends_on).toBe("A campaign cannot end before it starts.");
    expect(validateCampaignForm(form({ blurb: "short" })).body).toBeNull();
    expect(validateCampaignForm(form({ image_url: "ftp://x" })).errors.image_url).toMatch(/https/);
  });
});
