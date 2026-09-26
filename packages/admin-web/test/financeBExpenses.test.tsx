// @vitest-environment happy-dom
// Finance → Expenses, maker-checker: the recorder (and anyone who edited it)
// never sees Approve — they read the sentence instead — unless SuperAdmin; a
// 403 SAME_PERSON from the server lands on the same sentence; approving and
// voiding state their consequence, including the fund's balance before → after
// (an overdraw is a warning, not a block); a void needs a reason; the
// "awaiting approval" deep link shows every date.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { FinanceApi, type BooksExpense, type BooksExpenseList, type FinanceAuditRow, type FinanceFundsPage } from "../src/api/finance";
import { FinanceExpenses } from "../src/components/pages/finance/Expenses";
import { SAME_PERSON_SENTENCE } from "../src/components/finance/b/logic";
import { ALL_FINANCE, apiError, renderPage } from "./financeBSetup";

vi.mock("../src/api/finance", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/api/finance")>();
  return {
    ...mod,
    FinanceApi: {
      ...mod.FinanceApi,
      expenses: vi.fn(),
      expense: vi.fn(),
      audit: vi.fn(),
      funds: vi.fn(),
      config: vi.fn(),
      expenseCategories: vi.fn(),
      approveExpense: vi.fn(),
      voidExpense: vi.fn(),
      recordExpense: vi.fn(),
      updateExpense: vi.fn(),
    },
  };
});

afterEach(cleanup);

const ME = "me-0001";

const expense = (over: Partial<BooksExpense>): BooksExpense => ({
  expense_id: "e1",
  fund: { code: "general", name: "General Fund" },
  category: { category_id: "c1", code: "utilities", name: "Utilities" },
  payee: "Kenya Power",
  description: "September electricity",
  amount_minor: 1_500_000,
  currency: "KES",
  spent_on: "2026-09-20",
  channel: "mpesa",
  reference: "UIK2LS8P0Q",
  status: "recorded",
  recorded_by: "someone-else",
  recorded_by_name: "Ruth Njeri",
  recorded_at: "2026-09-20T08:00:00Z",
  approved_by: null,
  approved_by_name: null,
  approved_at: null,
  voided_by: null,
  voided_by_name: null,
  voided_at: null,
  void_reason: null,
  journal_id: null,
  void_journal_id: null,
  ...over,
});

const listOf = (rows: BooksExpense[]): BooksExpenseList => ({
  data: rows,
  next_cursor: null,
  totals: [{ currency: "KES", amount_minor: rows.reduce((n, r) => n + r.amount_minor, 0), count: rows.length }],
  totals_by_status: [{ status: "recorded", currency: "KES", amount_minor: rows.reduce((n, r) => n + r.amount_minor, 0), count: rows.length }],
});

const fundsPage = (balance: number): FinanceFundsPage =>
  ({
    period: { from: "2026-09-01", to: "2026-09-26", ytd_from: "2026-01-01" },
    data: [{ code: "general", name: "General Fund", balances: [{ currency: "KES", balance_minor: balance }] }],
    next_cursor: null,
    totals: [],
  }) as unknown as FinanceFundsPage;

function useExpense(e: BooksExpense, audit: FinanceAuditRow[] = []): void {
  vi.mocked(FinanceApi.expenses).mockResolvedValue(listOf([e]));
  vi.mocked(FinanceApi.expense).mockResolvedValue(e);
  vi.mocked(FinanceApi.audit).mockResolvedValue({ data: audit, next_cursor: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(FinanceApi.config).mockResolvedValue({ funds: [{ code: "general", name: "General Fund", is_active: true }], providers: [], step_up_required: true });
  vi.mocked(FinanceApi.expenseCategories).mockResolvedValue([{ category_id: "c1", code: "utilities", name: "Utilities", is_active: true, sort: 0 }]);
  vi.mocked(FinanceApi.funds).mockResolvedValue(fundsPage(12_000_000));
  useExpense(expense({}));
});

const openDrawer = async (): Promise<HTMLElement> => screen.findByRole("dialog", { name: "Kenya Power" });

describe("Expenses — approve (maker-checker)", () => {
  it("hides Approve from the person who recorded it, and says why", async () => {
    useExpense(expense({ recorded_by: ME, recorded_by_name: "Me" }));
    renderPage(<FinanceExpenses />, { path: "/finance/expenses?expense=e1", userId: ME, role: "Admin" });
    const drawer = await openDrawer();
    expect(await within(drawer).findByText("You recorded this expense, so another person must approve it.")).toBeTruthy();
    expect(within(drawer).queryByText("Approve")).toBeNull();
  });

  it("hides it from someone who edited it (read from the audit trail)", async () => {
    useExpense(expense({}), [
      { audit_id: 9, actor_id: ME, actor_name: "Me", action: "expense.updated", entity: "expenses", entity_id: "e1", metadata: null, occurred_at: "2026-09-21T09:00:00Z", actor_type: "Admin" },
      { audit_id: 8, actor_id: "x", actor_name: "Other", action: "expense.updated", entity: "expenses", entity_id: "e-other", metadata: null, occurred_at: "2026-09-21T08:00:00Z", actor_type: "Admin" },
    ]);
    renderPage(<FinanceExpenses />, { path: "/finance/expenses?expense=e1", userId: ME });
    const drawer = await openDrawer();
    expect(await within(drawer).findByText("You edited this expense, so another person must approve it.")).toBeTruthy();
    expect(within(drawer).queryByText("Approve")).toBeNull();
    expect(FinanceApi.audit).toHaveBeenCalledWith(expect.objectContaining({ action_prefix: "expense.updated", from: "2026-09-20" }));
    // The trail lists the edit.
    expect(within(drawer).getByText("Edited")).toBeTruthy();
  });

  it("lets a SuperAdmin approve their own", async () => {
    useExpense(expense({ recorded_by: ME }));
    renderPage(<FinanceExpenses />, { path: "/finance/expenses?expense=e1", userId: ME, role: "SuperAdmin" });
    const drawer = await openDrawer();
    expect(await within(drawer).findByText("Approve")).toBeTruthy();
  });

  it("never shows Approve without finance:approve", async () => {
    renderPage(<FinanceExpenses />, { path: "/finance/expenses?expense=e1", userId: ME, permissions: ["finance:view", "finance:manage"] });
    const drawer = await openDrawer();
    await within(drawer).findByText("Waiting for approval");
    expect(within(drawer).queryByText("Approve")).toBeNull();
    expect(within(drawer).queryByText(/another person must approve it/)).toBeNull();
  });

  it("states what approving posts and what it does to the fund, then approves", async () => {
    vi.mocked(FinanceApi.approveExpense).mockResolvedValue(expense({ status: "approved", approved_by: ME, approved_by_name: "Me", approved_at: "2026-09-26T07:00:00Z", journal_id: "j1" }));
    renderPage(<FinanceExpenses />, { path: "/finance/expenses?expense=e1", userId: ME });
    const drawer = await openDrawer();
    fireEvent.click(await within(drawer).findByText("Approve"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Posts KES 15,000.00 out of General Fund via M-Pesa on 20 Sep 2026.");
    expect(dialog.textContent).toContain("General Fund balance: KES 120,000.00 → KES 105,000.00 after this.");
    await act(async () => {
      fireEvent.click(within(dialog).getByText("Approve and post"));
    });
    expect(FinanceApi.approveExpense).toHaveBeenCalledWith("e1");
    expect(await screen.findByText("Approved — KES 15,000.00 posted out of General Fund")).toBeTruthy();
  });

  it("warns — but still allows — an approval that overdraws the fund", async () => {
    vi.mocked(FinanceApi.funds).mockResolvedValue(fundsPage(650_000));
    renderPage(<FinanceExpenses />, { path: "/finance/expenses?expense=e1", userId: ME });
    const drawer = await openDrawer();
    fireEvent.click(await within(drawer).findByText("Approve"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("General Fund will be KES 8,500.00 overdrawn — approve only if the money has really left.");
    expect((within(dialog).getByText("Approve and post").closest("button") as HTMLButtonElement).disabled).toBe(false);
  });

  it("maps a 403 SAME_PERSON to the same sentence and takes the button away", async () => {
    vi.mocked(FinanceApi.approveExpense).mockRejectedValue(apiError(403, "SAME_PERSON", "maker-checker: approver is a maker"));
    renderPage(<FinanceExpenses />, { path: "/finance/expenses?expense=e1", userId: ME });
    const drawer = await openDrawer();
    fireEvent.click(await within(drawer).findByText("Approve"));
    const dialog = await screen.findByRole("alertdialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByText("Approve and post"));
    });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(within(drawer).getAllByText(SAME_PERSON_SENTENCE).length).toBeGreaterThan(0);
    expect(within(drawer).queryByText("Approve")).toBeNull();
  });
});

describe("Expenses — void", () => {
  it("says an approved expense's void posts the reversing entry, with the fund going back up", async () => {
    useExpense(expense({ status: "approved", approved_by: "x", approved_by_name: "Ruth", approved_at: "2026-09-21T09:00:00Z", journal_id: "j1" }));
    vi.mocked(FinanceApi.funds).mockResolvedValue(fundsPage(10_500_000));
    vi.mocked(FinanceApi.voidExpense).mockResolvedValue(expense({ status: "void", voided_at: "2026-09-26T07:00:00Z", void_reason: "Recorded twice", void_journal_id: "j2" }));
    renderPage(<FinanceExpenses />, { path: "/finance/expenses?expense=e1", userId: ME });
    const drawer = await openDrawer();
    fireEvent.click(await within(drawer).findByText("Void"));
    const dialog = await screen.findByRole("alertdialog", { name: "Void this approved expense?" });
    expect(dialog.textContent).toContain("Posts the reversing entry — General Fund gets KES 15,000.00 back.");
    expect(dialog.textContent).toContain("General Fund balance: KES 105,000.00 → KES 120,000.00 after this.");
    const confirm = within(dialog).getByText("Void expense").closest("button") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true); // a reason is required
    fireEvent.change(within(dialog).getByLabelText("Why is it being voided?"), { target: { value: "Recorded twice" } });
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(FinanceApi.voidExpense).toHaveBeenCalledWith("e1", { reason: "Recorded twice" });
  });

  it("says a recorded expense's void moves no money", async () => {
    renderPage(<FinanceExpenses />, { path: "/finance/expenses?expense=e1", userId: ME });
    const drawer = await openDrawer();
    fireEvent.click(await within(drawer).findByText("Void"));
    const dialog = await screen.findByRole("alertdialog", { name: "Void this expense?" });
    expect(dialog.textContent).toContain("Nothing was posted yet, so nothing is reversed.");
    expect(dialog.textContent).not.toContain("balance:");
    expect(FinanceApi.funds).not.toHaveBeenCalled();
  });
});

describe("Expenses — register", () => {
  it("records only with finance:manage, and says nothing posts until someone else approves", async () => {
    renderPage(<FinanceExpenses />, { path: "/finance/expenses", permissions: ["finance:view"] });
    await screen.findByText("Kenya Power");
    expect(screen.queryByText("Record expense")).toBeNull();
    cleanup();
    renderPage(<FinanceExpenses />, { path: "/finance/expenses", permissions: ALL_FINANCE });
    fireEvent.click(await screen.findByText("Record expense"));
    const drawer = await screen.findByRole("dialog", { name: "Record expense" });
    expect(within(drawer).getByText(/Nothing is posted until another person approves it/)).toBeTruthy();
  });

  it("opens the approval queue at any date from the Overview's link", async () => {
    renderPage(<FinanceExpenses />, { path: "/finance/expenses?status=recorded" });
    await screen.findByText("Kenya Power");
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/finance/expenses?status=recorded&spent=any"));
    const last = vi.mocked(FinanceApi.expenses).mock.calls.at(-1)?.[0];
    expect(last).toMatchObject({ status: ["recorded"], from: null, to: null });
  });
});
