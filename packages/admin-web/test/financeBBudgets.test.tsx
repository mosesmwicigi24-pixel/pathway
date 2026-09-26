// @vitest-environment happy-dom
// Finance → Budgets: start a year's budget (finance:manage); the draft grid's
// row and column totals, the spread helper's December remainder, the 12-value
// PUT body and the cell that blocks it; approving locks the lines
// (finance:approve, never with unsaved changes); an approved budget's variance
// is coloured where it needs attention and USD is reported beside it.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { FinanceApi, type BooksBudget, type BooksBudgetActuals, type BooksBudgetDetail, type FinanceReportMatrix } from "../src/api/finance";
import { FinanceBudgets } from "../src/components/pages/finance/Budgets";
import { currentYearEAT } from "../src/components/finance/dates";
import { renderPage } from "./financeBSetup";

vi.mock("../src/api/finance", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/api/finance")>();
  return {
    ...mod,
    FinanceApi: {
      ...mod.FinanceApi,
      budgets: vi.fn(),
      budget: vi.fn(),
      createBudget: vi.fn(),
      updateBudget: vi.fn(),
      replaceBudgetLines: vi.fn(),
      approveBudget: vi.fn(),
      budgetActuals: vi.fn(),
      incomeReport: vi.fn(),
      expensesReport: vi.fn(),
      config: vi.fn(),
      expenseCategories: vi.fn(),
    },
  };
});

afterEach(cleanup);

const YEAR = currentYearEAT();
const twelve = (v: number): number[] => Array.from({ length: 12 }, () => v);

const summary = (over: Partial<BooksBudget> = {}): BooksBudget => ({
  budget_id: "b1",
  year: YEAR,
  name: `${YEAR} budget`,
  status: "draft",
  currency: "KES",
  created_by: "u9",
  created_by_name: "Ruth Njeri",
  created_at: `${YEAR}-01-05T09:00:00Z`,
  approved_by: null,
  approved_by_name: null,
  approved_at: null,
  line_count: 2,
  income_total_minor: 1_200_000,
  expense_total_minor: 600_000,
  ...over,
});
const detail = (over: Partial<BooksBudget> = {}): BooksBudgetDetail => ({
  ...summary(over),
  lines: [
    { line_id: "L1", kind: "income", fund: { code: "tithe", name: "Tithe" }, category: null, label: "Tithes", monthly_minor: twelve(100_000), total_minor: 1_200_000 },
    { line_id: "L2", kind: "expense", fund: null, category: { category_id: "c1", code: "rent", name: "Rent" }, label: "Rent", monthly_minor: twelve(50_000), total_minor: 600_000 },
  ],
});

const matrix = (report: "income" | "expenses", usd: number): FinanceReportMatrix => ({
  report,
  year: YEAR,
  by: report === "income" ? "fund" : "category",
  currencies: [
    { currency: "KES", rows: [], totals: { months: twelve(0), total_minor: 0 } },
    ...(usd ? [{ currency: "USD", rows: [], totals: { months: twelve(0), total_minor: usd } }] : []),
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(FinanceApi.config).mockResolvedValue({ funds: [{ code: "tithe", name: "Tithe", is_active: true }, { code: "general", name: "General Fund", is_active: true }], providers: [], step_up_required: true });
  vi.mocked(FinanceApi.expenseCategories).mockResolvedValue([{ category_id: "c1", code: "rent", name: "Rent", is_active: true, sort: 0 }]);
  vi.mocked(FinanceApi.budgets).mockResolvedValue([summary()]);
  vi.mocked(FinanceApi.budget).mockResolvedValue(detail());
  vi.mocked(FinanceApi.incomeReport).mockResolvedValue(matrix("income", 45_000));
  vi.mocked(FinanceApi.expensesReport).mockResolvedValue(matrix("expenses", 0));
  vi.mocked(FinanceApi.budgetActuals).mockRejectedValue(new Error("not needed here"));
});

describe("Budgets — no budget yet", () => {
  it("starts the year's budget with finance:manage", async () => {
    vi.mocked(FinanceApi.budgets).mockResolvedValue([]);
    vi.mocked(FinanceApi.createBudget).mockResolvedValue({ ...detail(), lines: [], line_count: 0 });
    renderPage(<FinanceBudgets />, { path: "/finance/budgets" });
    fireEvent.click(await screen.findByText(`Start the ${YEAR} budget`));
    const dialog = await screen.findByRole("alertdialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByText("Start draft"));
    });
    expect(FinanceApi.createBudget).toHaveBeenCalledWith({ year: YEAR, name: `${YEAR} budget` });
  });

  it("says who may start one otherwise", async () => {
    vi.mocked(FinanceApi.budgets).mockResolvedValue([]);
    renderPage(<FinanceBudgets />, { path: "/finance/budgets", permissions: ["finance:view"] });
    expect(await screen.findByText("Starting a budget needs finance:manage.")).toBeTruthy();
    expect(screen.queryByText(`Start the ${YEAR} budget`)).toBeNull();
  });
});

describe("Budgets — the draft grid", () => {
  it("totals each row and each month, and updates as a cell changes", async () => {
    renderPage(<FinanceBudgets />, { path: "/finance/budgets" });
    await screen.findByDisplayValue("Tithes");
    expect(screen.getByTestId("line-total-L1").textContent).toBe("12,000.00");
    expect(screen.getByTestId("line-total-L2").textContent).toBe("6,000.00");
    const surplus = screen.getAllByText("Budgeted surplus").find((el) => el.tagName === "TD")?.closest("tr") as HTMLElement;
    expect(surplus.textContent).toContain("6,000.00");
    fireEvent.change(screen.getByLabelText("Tithes Jan"), { target: { value: "2,000" } });
    expect(screen.getByTestId("line-total-L1").textContent).toBe("13,000.00");
    expect((screen.getByText("Total income").closest("tr") as HTMLElement).textContent).toContain("2,000.00");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("spreads a yearly amount evenly with the remainder on December, footing exactly", async () => {
    renderPage(<FinanceBudgets />, { path: "/finance/budgets" });
    await screen.findByDisplayValue("Tithes");
    fireEvent.click(screen.getAllByLabelText("Spread an annual amount evenly")[0] as HTMLElement);
    fireEvent.change(screen.getByLabelText("Spread a yearly amount evenly (KES)"), { target: { value: "10,000" } });
    fireEvent.click(screen.getByText("Spread"));
    expect((screen.getByLabelText("Tithes Jan") as HTMLInputElement).value).toBe("833.33");
    expect((screen.getByLabelText("Tithes Nov") as HTMLInputElement).value).toBe("833.33");
    expect((screen.getByLabelText("Tithes Dec") as HTMLInputElement).value).toBe("833.37");
    expect(screen.getByTestId("line-total-L1").textContent).toBe("10,000.00");
  });

  it("refuses to save a cell the books would refuse, then sends 12 integers per line", async () => {
    vi.mocked(FinanceApi.replaceBudgetLines).mockImplementation(async (_id, body) => ({ ...detail(), lines: detail().lines.map((l, i) => ({ ...l, monthly_minor: body.lines[i]?.monthly_minor ?? l.monthly_minor })) }));
    renderPage(<FinanceBudgets />, { path: "/finance/budgets" });
    await screen.findByDisplayValue("Tithes");
    const feb = screen.getByLabelText("Rent Feb");
    fireEvent.change(feb, { target: { value: "12,50" } });
    expect(feb.getAttribute("aria-invalid")).toBe("true");
    await act(async () => {
      fireEvent.click(screen.getByText("Save lines"));
    });
    expect(FinanceApi.replaceBudgetLines).not.toHaveBeenCalled();
    expect(screen.getByText(/Some lines need fixing/)).toBeTruthy();
    fireEvent.change(feb, { target: { value: "750" } });
    await act(async () => {
      fireEvent.click(screen.getByText("Save lines"));
    });
    expect(FinanceApi.replaceBudgetLines).toHaveBeenCalledTimes(1);
    const body = vi.mocked(FinanceApi.replaceBudgetLines).mock.calls[0]?.[1];
    expect(body?.lines).toHaveLength(2);
    expect(body?.lines.every((l) => l.monthly_minor.length === 12 && l.monthly_minor.every(Number.isInteger))).toBe(true);
    expect(body?.lines[0]).toEqual({ kind: "income", fund: "tithe", category: null, label: "Tithes", monthly_minor: twelve(100_000) });
    expect(body?.lines[1]?.monthly_minor[1]).toBe(75_000);
    expect(body?.lines[1]).toMatchObject({ kind: "expense", fund: null, category: "rent", label: "Rent" });
  });

  it("approves only with finance:approve, never over unsaved changes, and says it locks the lines", async () => {
    vi.mocked(FinanceApi.approveBudget).mockResolvedValue(detail({ status: "approved", approved_by_name: "Peter", approved_at: `${YEAR}-02-01T09:00:00Z` }));
    renderPage(<FinanceBudgets />, { path: "/finance/budgets" });
    await screen.findByDisplayValue("Tithes");
    fireEvent.change(screen.getByLabelText("Tithes Jan"), { target: { value: "2,000" } });
    const approve = screen.getByText("Approve").closest("button") as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Tithes Jan"), { target: { value: "1000" } });
    await waitFor(() => expect((screen.getByText("Approve").closest("button") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText("Approve"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Locks the lines");
    await act(async () => {
      fireEvent.click(within(dialog).getByText("Approve and lock"));
    });
    expect(FinanceApi.approveBudget).toHaveBeenCalledWith("b1");
  });

  it("is read-only without finance:manage and offers no approve without finance:approve", async () => {
    renderPage(<FinanceBudgets />, { path: "/finance/budgets", permissions: ["finance:view"] });
    expect(await screen.findByText("Tithes")).toBeTruthy();
    expect(screen.queryByLabelText("Tithes Jan")).toBeNull();
    expect(screen.queryByText("Save lines")).toBeNull();
    expect(screen.queryByText("Approve")).toBeNull();
  });
});

describe("Budgets — approved: budget vs actual", () => {
  it("colours income below budget and spending above it, and reports USD beside the budget", async () => {
    const approved = detail({ status: "approved", approved_by_name: "Peter", approved_at: `${YEAR}-02-01T09:00:00Z` });
    vi.mocked(FinanceApi.budgets).mockResolvedValue([summary({ status: "approved" })]);
    vi.mocked(FinanceApi.budget).mockResolvedValue(approved);
    const row = (budget: number[], actual: number[]) => ({
      budget_minor: budget,
      actual_minor: actual,
      variance_minor: actual.map((a, i) => a - (budget[i] ?? 0)),
      budget_total_minor: budget.reduce((n, v) => n + v, 0),
      actual_total_minor: actual.reduce((n, v) => n + v, 0),
      variance_total_minor: actual.reduce((n, v) => n + v, 0) - budget.reduce((n, v) => n + v, 0),
    });
    const income = row(twelve(100_000), twelve(90_000)); // 100 below budget every month
    const expense = row(twelve(50_000), twelve(60_000)); // 100 above budget every month
    const actuals: BooksBudgetActuals = {
      budget: summary({ status: "approved" }),
      year: YEAR,
      currency: "KES",
      months: Array.from({ length: 12 }, (_, i) => `${YEAR}-${String(i + 1).padStart(2, "0")}`),
      lines: [
        { ...income, line_id: "L1", kind: "income", label: "Tithes", fund: { code: "tithe", name: "Tithe" }, category: null },
        { ...expense, line_id: "L2", kind: "expense", label: "Rent", fund: null, category: { category_id: "c1", code: "rent", name: "Rent" } },
      ],
      totals: [
        { ...income, kind: "income", unbudgeted_minor: twelve(0), unbudgeted_total_minor: 0 },
        { ...expense, kind: "expense", unbudgeted_minor: twelve(0), unbudgeted_total_minor: 0 },
      ],
    };
    vi.mocked(FinanceApi.budgetActuals).mockResolvedValue(actuals);
    renderPage(<FinanceBudgets />, { path: "/finance/budgets" });
    const table = await screen.findByRole("table", { name: "Budget vs actual" });
    const tithes = within(table).getByText("Tithes").closest("tr") as HTMLElement;
    const rent = within(table).getByText("Rent").closest("tr") as HTMLElement;
    const amber = /A87616|168, 118, 22/i;
    // The year's variance cells (last column): income −1,200.00 and spending +1,200.00 — both amber.
    const lastCell = (tr: HTMLElement): HTMLElement => tr.querySelectorAll("td")[6] as HTMLElement;
    expect(lastCell(tithes).textContent).toBe("-1,200.00");
    expect(lastCell(tithes).getAttribute("style") ?? "").toMatch(amber);
    expect(lastCell(rent).textContent).toBe("+1,200.00");
    expect(lastCell(rent).getAttribute("style") ?? "").toMatch(amber);
    expect(await screen.findByText(/Outside the budget in \d{4}: income USD 450\.00/)).toBeTruthy();
    // The approved lines are shown locked.
    expect(screen.getByText("Approved lines")).toBeTruthy();
    expect(screen.queryByText("Save lines")).toBeNull();
  });
});
