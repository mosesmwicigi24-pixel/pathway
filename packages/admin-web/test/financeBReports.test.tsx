// @vitest-environment happy-dom
// Finance → Reports and Finance → Statements: one table per currency with its
// own totals row (KES and USD never mixed), a table that does not foot says so,
// the grouping and period reach the server, the financial position banner
// reads the server's balance flag, and a statement PDF that does not exist
// says so plainly.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { FinanceApi, type FinanceDailyReport, type FinanceFinancialPosition, type FinanceIncomeExpenditure, type FinanceReportMatrix, type FinanceStatementsPage } from "../src/api/finance";
import { FinanceReports } from "../src/components/pages/finance/Reports";
import { FinanceStatements } from "../src/components/pages/finance/Statements";
import { currentYearEAT, presetRange } from "../src/components/finance/dates";
import { compactMajor } from "../src/components/finance/b/ReportMatrix";
import { ALL_FINANCE, apiError, renderPage } from "./financeBSetup";

vi.mock("../src/api/finance", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/api/finance")>();
  return {
    ...mod,
    FinanceApi: {
      ...mod.FinanceApi,
      incomeReport: vi.fn(),
      expensesReport: vi.fn(),
      pledgesReport: vi.fn(),
      dailyReport: vi.fn(),
      incomeExpenditure: vi.fn(),
      financialPosition: vi.fn(),
      statements: vi.fn(),
      givingStatementPdf: vi.fn(),
      partnerStatementPdf: vi.fn(),
    },
  };
});

afterEach(cleanup);

const YEAR = currentYearEAT();
const zeros = (): number[] => Array.from({ length: 12 }, () => 0);
const months = (jan: number, feb = 0): number[] => [jan, feb, ...Array.from({ length: 10 }, () => 0)];

const incomeMatrix = (kesFebTotal = 25_000): FinanceReportMatrix => ({
  report: "income",
  year: YEAR,
  by: "fund",
  currencies: [
    {
      currency: "KES",
      rows: [
        { key: "tithe", label: "Tithe", months: months(100_000), total_minor: 100_000 },
        { key: "general", label: "General", months: months(50_000, 25_000), total_minor: 75_000 },
      ],
      totals: { months: months(150_000, kesFebTotal), total_minor: 175_000 },
    },
    { currency: "USD", rows: [{ key: "missions", label: "Missions", months: months(45_000), total_minor: 45_000 }], totals: { months: months(45_000), total_minor: 45_000 } },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(FinanceApi.incomeReport).mockResolvedValue(incomeMatrix());
  vi.mocked(FinanceApi.expensesReport).mockResolvedValue({ report: "expenses", year: YEAR, by: "category", currencies: [{ currency: "KES", rows: [], totals: { months: zeros(), total_minor: 0 } }] });
});

describe("Reports — income matrix", () => {
  it("draws one table per currency, each with its own totals — never KES + USD", async () => {
    renderPage(<FinanceReports />, { path: "/finance/reports" });
    const kes = await screen.findByTestId("matrix-total-KES");
    const usd = screen.getByTestId("matrix-total-USD");
    expect(kes.textContent).toContain("1,500.00"); // January, KES only
    expect(kes.textContent).toContain("1,750.00"); // the KES year
    expect(kes.textContent).not.toContain("2,200.00"); // what KES + USD would wrongly be
    expect(usd.textContent).toContain("450.00");
    expect(usd.textContent).not.toContain("1,750.00");
    const blocks = [...document.querySelectorAll("[data-currency-block]")].map((b) => b.getAttribute("data-currency-block"));
    expect(blocks).toEqual(["KES", "USD"]);
    expect(screen.getAllByText(/Every row adds up across the months/).length).toBe(2);
    expect(FinanceApi.incomeReport).toHaveBeenCalledWith({ year: YEAR, by: "fund" });
  });

  it("says so when a table does not add up", async () => {
    vi.mocked(FinanceApi.incomeReport).mockResolvedValue(incomeMatrix(30_000));
    renderPage(<FinanceReports />, { path: "/finance/reports" });
    expect(await screen.findByText(/These figures do not add up/)).toBeTruthy();
    expect(screen.getByText(/Feb: the rows add to KES 250\.00, the total says KES 300\.00\./)).toBeTruthy();
  });

  it("sends the grouping, and an expenses tab falls back to its own default", async () => {
    renderPage(<FinanceReports />, { path: "/finance/reports?by=channel" });
    await screen.findByTestId("matrix-total-KES");
    expect(FinanceApi.incomeReport).toHaveBeenLastCalledWith({ year: YEAR, by: "channel" });
    fireEvent.click(screen.getByRole("tab", { name: "Expenses" }));
    await waitFor(() => expect(FinanceApi.expensesReport).toHaveBeenCalledWith({ year: YEAR, by: "category" }));
  });

  it("offers CSV only with finance:export", async () => {
    renderPage(<FinanceReports />, { path: "/finance/reports", permissions: ALL_FINANCE });
    await screen.findByTestId("matrix-total-KES");
    expect(screen.getByText("Export CSV")).toBeTruthy();
    cleanup();
    renderPage(<FinanceReports />, { path: "/finance/reports", permissions: ["finance:view"] });
    await screen.findByTestId("matrix-total-KES");
    expect(screen.queryByText("Export CSV")).toBeNull();
  });

  it("labels the chart axis compactly", () => {
    expect(compactMajor(125_000_000)).toBe("1.3M");
    expect(compactMajor(4_500_000)).toBe("45k");
    expect(compactMajor(99_900)).toBe("999");
  });
});

describe("Reports — daily giving", () => {
  const cell = (amount_minor = 0, count = 0) => ({ amount_minor, count });
  const rails = (over: Partial<Record<"mpesa" | "paybill" | "card" | "paypal" | "airtel" | "office", { amount_minor: number; count: number }>> = {}) => ({
    mpesa: cell(), paybill: cell(), card: cell(), paypal: cell(), airtel: cell(), office: cell(), ...over,
  });
  const daily = (): FinanceDailyReport => ({
    report: "daily",
    period: { from: "2025-06-01", to: "2025-06-03" },
    rails: [
      { key: "mpesa", label: "M-Pesa prompt" }, { key: "paybill", label: "M-Pesa paybill" }, { key: "card", label: "Card" },
      { key: "paypal", label: "PayPal" }, { key: "airtel", label: "Airtel Money" }, { key: "office", label: "Office" },
    ],
    currencies: [
      {
        currency: "KES",
        days: [
          { day: "2025-06-01", total_minor: 0, count: 0, rails: rails() },
          { day: "2025-06-02", total_minor: 150_000, count: 2, rails: rails({ mpesa: cell(100_000, 1), paybill: cell(50_000, 1) }) },
          { day: "2025-06-03", total_minor: 30_000, count: 1, rails: rails({ office: cell(30_000, 1) }) },
        ],
        totals: { total_minor: 180_000, count: 3, rails: rails({ mpesa: cell(100_000, 1), paybill: cell(50_000, 1), office: cell(30_000, 1) }) },
        days_with_gifts: 2,
        best_day: "2025-06-02",
      },
      {
        currency: "USD",
        days: [
          { day: "2025-06-01", total_minor: 0, count: 0, rails: rails() },
          { day: "2025-06-02", total_minor: 0, count: 0, rails: rails() },
          { day: "2025-06-03", total_minor: 1_000, count: 1, rails: rails({ paypal: cell(1_000, 1) }) },
        ],
        totals: { total_minor: 1_000, count: 1, rails: rails({ paypal: cell(1_000, 1) }) },
        days_with_gifts: 1,
        best_day: "2025-06-03",
      },
    ],
  });

  it("lists every day of the period per currency, names the paybill money, and asks the server for this month by default", async () => {
    vi.mocked(FinanceApi.dailyReport).mockResolvedValue(daily());
    renderPage(<FinanceReports />, { path: "/finance/reports?tab=daily" });
    expect(await screen.findByText(/KES · KES 1,800\.00 over 2 of 3 days/)).toBeTruthy();
    const month = presetRange("this_month");
    expect(FinanceApi.dailyReport).toHaveBeenCalledWith({ from: month.from, to: month.to });
    const blocks = [...document.querySelectorAll("[data-currency-block]")].map((b) => b.getAttribute("data-currency-block"));
    expect(blocks).toEqual(["KES", "USD"]);
    // The header line says how much walked in through the paybill.
    expect(screen.getByText(/KES 500\.00 straight to the paybill \(1\)/)).toBeTruthy();
    // Three day rows in each table (a quiet day is still a row), plus the period footer.
    const kes = screen.getByRole("table", { name: "Daily giving KES" });
    expect(kes.querySelectorAll("tbody tr").length).toBe(3);
    expect(kes.textContent).toContain("1,500.00");
    expect(kes.textContent).toContain("Period");
    expect(kes.textContent).not.toContain("1,810.00"); // never KES + USD
    expect(screen.getAllByRole("columnheader", { name: "M-Pesa paybill" }).length).toBe(2); // one per currency table
  });

  it("moves the period as one and offers the CSV only with finance:export", async () => {
    vi.mocked(FinanceApi.dailyReport).mockResolvedValue(daily());
    renderPage(<FinanceReports />, { path: "/finance/reports?tab=daily&period=last_month", permissions: ["finance:view"] });
    await screen.findByText(/over 2 of 3 days/);
    const last = presetRange("last_month");
    expect(FinanceApi.dailyReport).toHaveBeenLastCalledWith({ from: last.from, to: last.to });
    expect(screen.queryByText("Export CSV")).toBeNull();
  });

  it("says plainly when nothing was given", async () => {
    vi.mocked(FinanceApi.dailyReport).mockResolvedValue({ ...daily(), currencies: [] });
    renderPage(<FinanceReports />, { path: "/finance/reports?tab=daily" });
    expect(await screen.findByText(/Nothing given between/)).toBeTruthy();
  });
});

describe("Reports — statements", () => {
  it("shows income & expenditure for this month by default, per currency, with a deficit named as one", async () => {
    const ie: FinanceIncomeExpenditure = {
      period: presetRange("this_month"),
      currencies: [
        {
          currency: "KES",
          income: [{ key: "tithe", label: "Tithe", amount_minor: 500_000 }],
          other_income: [],
          expenses: [{ key: "rent", label: "Rent", amount_minor: 800_000 }],
          totals: { gifts_minor: 500_000, other_income_minor: 0, income_minor: 500_000, expenses_minor: 800_000, surplus_minor: -300_000 },
        },
      ],
    };
    vi.mocked(FinanceApi.incomeExpenditure).mockResolvedValue(ie);
    renderPage(<FinanceReports />, { path: "/finance/reports?tab=ie" });
    expect(await screen.findByText("Deficit")).toBeTruthy();
    const month = presetRange("this_month");
    expect(FinanceApi.incomeExpenditure).toHaveBeenCalledWith({ from: month.from, to: month.to });
    expect(screen.getByText(/income − expenditure = deficit/)).toBeTruthy();
  });

  it("moves the whole period at once when a preset is picked", async () => {
    vi.mocked(FinanceApi.incomeExpenditure).mockResolvedValue({ period: presetRange("last_month"), currencies: [] });
    renderPage(<FinanceReports />, { path: "/finance/reports?tab=ie" });
    await waitFor(() => expect(FinanceApi.incomeExpenditure).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "last_month" } });
    const last = presetRange("last_month");
    await waitFor(() => expect(FinanceApi.incomeExpenditure).toHaveBeenLastCalledWith({ from: last.from, to: last.to }));
    expect(screen.getByTestId("location").textContent).toBe("/finance/reports?tab=ie&period=last_month");
  });

  it("shows the Balanced ✓ banner only when the server says so", async () => {
    const pos = (balanced: boolean): FinanceFinancialPosition => ({
      as_of: "2026-09-26",
      balanced,
      currencies: [
        {
          currency: "KES",
          assets: [{ account: "cash:mpesa", label: "M-Pesa", balance_minor: 1_000_000 }],
          funds: [{ account: "fund:general", label: "General Fund", code: "general", balance_minor: balanced ? 1_000_000 : 900_000 }],
          other: [],
          totals: { assets_minor: 1_000_000, funds_minor: balanced ? 1_000_000 : 900_000, other_minor: 0 },
          balanced,
        },
      ],
    });
    vi.mocked(FinanceApi.financialPosition).mockResolvedValue(pos(true));
    renderPage(<FinanceReports />, { path: "/finance/reports?tab=position" });
    expect(await screen.findByText(/^Balanced ✓/)).toBeTruthy();
    cleanup();
    vi.mocked(FinanceApi.financialPosition).mockResolvedValue(pos(false));
    renderPage(<FinanceReports />, { path: "/finance/reports?tab=position" });
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toMatch(/^Not balanced — in at least one currency, cash ≠ funds \+ other/);
    expect(screen.queryByText(/^Balanced ✓/)).toBeNull();
  });
});

const givers: FinanceStatementsPage = {
  year: YEAR,
  next_cursor: null,
  totals: [
    { currency: "KES", amount_minor: 4_500_000, count: 9 },
    { currency: "USD", amount_minor: 10_000, count: 1 },
  ],
  data: [
    {
      user_id: "u1",
      full_name: "Grace Wanjiru",
      phone: "+254700000001",
      email: "grace@example.org",
      gifts: 10,
      totals: [
        { currency: "KES", amount_minor: 4_500_000, count: 9 },
        { currency: "USD", amount_minor: 10_000, count: 1 },
      ],
      by_fund: [{ code: "tithe", name: "Tithe", currency: "KES", amount_minor: 4_500_000 }],
      pledge_paid: [{ currency: "KES", amount_minor: 3_500_000 }],
      last_gift_at: "2026-09-05T09:00:00Z",
    },
  ],
};

describe("Statements (/finance/statements)", () => {
  it("says plainly when a member has no partner statement for the year (404)", async () => {
    vi.mocked(FinanceApi.statements).mockResolvedValue(givers);
    vi.mocked(FinanceApi.partnerStatementPdf).mockRejectedValue(apiError(404, "NOT_FOUND", "Not found"));
    renderPage(<FinanceStatements />, { path: "/finance/statements" });
    await screen.findByText("Grace Wanjiru");
    await act(async () => {
      fireEvent.click(screen.getByText("Partner PDF"));
    });
    expect(FinanceApi.partnerStatementPdf).toHaveBeenCalledWith("u1", YEAR, `Grace Wanjiru partner statement ${YEAR}`);
    expect(await screen.findByText(`No partner statement for ${YEAR}`)).toBeTruthy();
  });

  it("passes any other failure through in the server's words", async () => {
    vi.mocked(FinanceApi.statements).mockResolvedValue(givers);
    vi.mocked(FinanceApi.givingStatementPdf).mockRejectedValue(apiError(500, "INTERNAL", "The PDF renderer is down"));
    renderPage(<FinanceStatements />, { path: `/finance/statements?year=${YEAR - 1}` });
    await screen.findByText("Grace Wanjiru");
    expect(FinanceApi.statements).toHaveBeenCalledWith(expect.objectContaining({ year: YEAR - 1 }));
    await act(async () => {
      fireEvent.click(screen.getByText("Giving PDF"));
    });
    expect(FinanceApi.givingStatementPdf).toHaveBeenCalledWith("u1", YEAR - 1, `Grace Wanjiru giving statement ${YEAR - 1}`);
    expect(await screen.findByText("The PDF renderer is down")).toBeTruthy();
  });

  it("totals per currency and keeps CSV behind finance:export", async () => {
    vi.mocked(FinanceApi.statements).mockResolvedValue(givers);
    renderPage(<FinanceStatements />, { path: "/finance/statements", permissions: ["finance:view"] });
    await screen.findByText("Grace Wanjiru");
    expect(screen.queryByText("Export CSV")).toBeNull();
    expect(screen.getAllByText("KES 45,000.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("USD 100.00").length).toBeGreaterThan(0);
    expect(screen.getByText("Tithe")).toBeTruthy();
  });
});
