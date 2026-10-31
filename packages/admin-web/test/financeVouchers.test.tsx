// @vitest-environment happy-dom
// Expenses as payment vouchers, and needs the office can run (owner,
// 2026-10-31):
//   · the expense drawer leads with the voucher — PV number, amount in words,
//     who was paid — lifts the M-Pesa code out of a pasted confirmation
//     message, shows the department and need, and downloads <PV>.pdf;
//   · the form books an expense to a department and one of its approved needs,
//     and a department suggests its fund;
//   · ?record=1&department=…&need=… (the Needs page's "Record expense") opens
//     the form at that need;
//   · the Needs page adds a need (approved at once by default), approves a
//     pending one in place, and shows what was spent.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { FinanceApi, type BooksExpense, type BooksExpenseList, type FinanceNeedRow, type FinanceNeedsPage } from "../src/api/finance";
import { DepartmentsApi } from "../src/api/client";
import { FinanceExpenses } from "../src/components/pages/finance/Expenses";
import { FinanceNeeds } from "../src/components/pages/finance/Needs";
import { amountInWords, mpesaCodeOf } from "../src/components/finance/b/logic";
import { renderPage } from "./financeBSetup";

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
      recordExpense: vi.fn(),
      needs: vi.fn(),
      expenseVoucherPdf: vi.fn(),
      expenseVoucherBlob: vi.fn(),
    },
  };
});
vi.mock("../src/api/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/api/client")>();
  return { ...mod, DepartmentsApi: { ...mod.DepartmentsApi, createNeed: vi.fn(), decideNeed: vi.fn() } };
});

afterEach(cleanup);

const MPESA = "UJVJ205LTV Confirmed. Ksh21,000.00 sent to ROBEEZ ELECTRONICS for account 33073";

const expense = (over: Partial<BooksExpense> = {}): BooksExpense => ({
  expense_id: "e1",
  fund: { code: "offering", name: "Offering" },
  category: { category_id: "c1", code: "worship-media", name: "Worship & media" },
  payee: "Joe Blessing",
  description: "Camera Stands",
  amount_minor: 2_160_000,
  currency: "KES",
  spent_on: "2026-10-31",
  channel: "mpesa",
  reference: MPESA,
  status: "approved",
  recorded_by: "someone",
  recorded_by_name: "Moses Mwicigi",
  recorded_at: "2026-10-31T13:16:00Z",
  approved_by: "other",
  approved_by_name: "Grace Wanjiru",
  approved_at: "2026-10-31T14:02:00Z",
  voided_by: null,
  voided_by_name: null,
  voided_at: null,
  void_reason: null,
  journal_id: "9a8b7c6d-0000-4000-8000-000000000000",
  void_journal_id: null,
  voucher_no: "PV-2026-00014",
  department: { department_id: "d1", name: "Worship & media" },
  need: { need_id: "n1", title: "Camera kit", status: "approved", target_minor: 6_000_000, currency: "KES" },
  ...over,
});
const listOf = (rows: BooksExpense[]): BooksExpenseList => ({
  data: rows,
  next_cursor: null,
  totals: [{ currency: "KES", amount_minor: 2_160_000, count: rows.length }],
  totals_by_status: [],
});
const need = (over: Partial<FinanceNeedRow> = {}): FinanceNeedRow => ({
  need_id: "n1",
  title: "Camera kit",
  why: "The live stream needs steady shots.",
  department_id: "d1",
  department_name: "Worship & media",
  fund_code: "media",
  target_minor: 6_000_000,
  raised_minor: 4_000_000,
  gifts_count: 9,
  spent_minor: 2_160_000,
  awaiting_minor: 50_000,
  expenses_count: 2,
  currency: "KES",
  deadline: null,
  status: "approved",
  created_at: "2026-10-01T09:00:00Z",
  decided_at: "2026-10-02T09:00:00Z",
  ...over,
});
const needsPage = (rows: FinanceNeedRow[]): FinanceNeedsPage => ({
  data: rows,
  next_cursor: null,
  totals: [{ currency: "KES", amount_minor: 4_000_000, count: rows.length, target_minor: 6_000_000, raised_minor: 4_000_000, spent_minor: 2_160_000 }],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(FinanceApi.config).mockResolvedValue({
    funds: [
      { code: "offering", name: "Offering", is_active: true },
      { code: "media", name: "Media Fund", is_active: true },
    ],
    providers: [],
    paybill: { enabled: false, shortcode: null, last_registered_at: null, registered_shortcode: null, confirmation_url: null, last_30_days: {} },
    departments: [
      { department_id: "d1", name: "Worship & media", fund_code: "media" },
      { department_id: "d2", name: "Youth", fund_code: null },
    ],
    step_up_required: true,
  });
  vi.mocked(FinanceApi.expenseCategories).mockResolvedValue([{ category_id: "c1", code: "worship-media", name: "Worship & media", is_active: true, sort: 0 }]);
  vi.mocked(FinanceApi.audit).mockResolvedValue({ data: [], next_cursor: null });
  vi.mocked(FinanceApi.expenses).mockResolvedValue(listOf([expense()]));
  vi.mocked(FinanceApi.expense).mockResolvedValue(expense());
  vi.mocked(FinanceApi.needs).mockResolvedValue(needsPage([need()]));
});

describe("voucher words", () => {
  it("reads the amount in words and lifts an M-Pesa code", () => {
    expect(amountInWords(2_160_000, "KES")).toBe("Twenty-one thousand six hundred Kenya shillings only");
    expect(mpesaCodeOf("mpesa", MPESA)).toBe("UJVJ205LTV");
    expect(mpesaCodeOf("bank", MPESA)).toBeNull();
    expect(mpesaCodeOf("mpesa", "paid at the shop")).toBeNull();
  });
});

describe("the expense drawer is the voucher", () => {
  it("leads with the PV number, amount in words and payee; shows department, need and the M-Pesa code", async () => {
    renderPage(<FinanceExpenses />, { path: "/finance/expenses?expense=e1" });
    const drawer = await screen.findByRole("dialog", { name: "Joe Blessing" });
    const card = within(drawer).getByRole("region", { name: "Voucher" });
    expect(within(card).getByText("PV-2026-00014")).toBeTruthy();
    expect(within(card).getByText("Twenty-one thousand six hundred Kenya shillings only")).toBeTruthy();
    expect(within(drawer).getByText("Camera kit")).toBeTruthy();
    expect(within(drawer).getByText("UJVJ205LTV")).toBeTruthy();
    expect(within(drawer).getByText(/sent to ROBEEZ ELECTRONICS/)).toBeTruthy();
    expect(within(drawer).getByText("Accountability trail")).toBeTruthy();
  });

  it("downloads the voucher as <PV>.pdf", async () => {
    vi.mocked(FinanceApi.expenseVoucherPdf).mockResolvedValue(undefined);
    renderPage(<FinanceExpenses />, { path: "/finance/expenses?expense=e1" });
    const drawer = await screen.findByRole("dialog", { name: "Joe Blessing" });
    await act(async () => {
      fireEvent.click(within(drawer).getByRole("button", { name: /Download voucher/ }));
    });
    expect(FinanceApi.expenseVoucherPdf).toHaveBeenCalledWith("e1", "PV-2026-00014.pdf");
  });

  it("says a recorded expense awaits approval, and a void one is void", async () => {
    vi.mocked(FinanceApi.expense).mockResolvedValue(expense({ status: "recorded", approved_by: null, approved_by_name: null, approved_at: null }));
    renderPage(<FinanceExpenses />, { path: "/finance/expenses?expense=e1", userId: "a-checker" });
    const drawer = await screen.findByRole("dialog", { name: "Joe Blessing" });
    expect(await within(drawer).findByText(/Awaiting approval: nothing is posted/)).toBeTruthy();
    cleanup();
    vi.mocked(FinanceApi.expense).mockResolvedValue(expense({ status: "void", voided_by_name: "Grace Wanjiru", voided_at: "2026-11-01T06:00:00Z", void_reason: "Entered twice" }));
    renderPage(<FinanceExpenses />, { path: "/finance/expenses?expense=e1" });
    const again = await screen.findByRole("dialog", { name: "Joe Blessing" });
    expect(await within(again).findByText(/“Entered twice”\. The voucher keeps its number and prints VOID/)).toBeTruthy();
  });
});

describe("recording an expense for a department", () => {
  it("books it to a department and an approved need; the department suggests its fund", async () => {
    vi.mocked(FinanceApi.needs).mockResolvedValue(needsPage([need(), need({ need_id: "n2", title: "Old screen", status: "pending" })]));
    vi.mocked(FinanceApi.recordExpense).mockResolvedValue(expense({ status: "recorded" }));
    renderPage(<FinanceExpenses />, { path: "/finance/expenses" });
    fireEvent.click(await screen.findByRole("button", { name: /Record expense/ }));
    const form = await screen.findByRole("dialog", { name: "Record expense" });
    await waitFor(() => expect(within(form).getAllByRole("option", { name: "Youth" }).length).toBe(1));
    fireEvent.change(within(form).getByLabelText(/^Department/), { target: { value: "d1" } });
    await waitFor(() => expect(FinanceApi.needs).toHaveBeenCalledWith(expect.objectContaining({ department_id: "d1" })));
    // Only approved needs are offered.
    const needSelect = within(form).getByLabelText(/^Spent against a need/) as HTMLSelectElement;
    await waitFor(() => expect(needSelect.disabled).toBe(false));
    expect([...needSelect.options].map((o) => o.textContent)).toEqual(["Not a specific need", "Camera kit · target KES 60,000.00"]);
    fireEvent.change(needSelect, { target: { value: "n1" } });
    expect((within(form).getByLabelText(/^Paid from fund/) as HTMLSelectElement).value).toBe("media");
    fireEvent.change(within(form).getByLabelText(/^Category/), { target: { value: "worship-media" } });
    fireEvent.change(within(form).getByLabelText(/^Paid to/), { target: { value: "Joe Blessing" } });
    fireEvent.change(within(form).getByLabelText(/^Amount/), { target: { value: "21600" } });
    fireEvent.change(within(form).getByLabelText(/^Paid by/), { target: { value: "mpesa" } });
    fireEvent.change(within(form).getByLabelText(/^Reference/), { target: { value: MPESA } });
    await act(async () => {
      fireEvent.click(within(form).getByRole("button", { name: "Record expense" }));
    });
    expect(FinanceApi.recordExpense).toHaveBeenCalledWith(
      expect.objectContaining({ department_id: "d1", need_id: "n1", fund: "media", amount_minor: 2_160_000, reference: MPESA }),
    );
  });

  it("opens the form at a need from ?record=1&department=…&need=…", async () => {
    renderPage(<FinanceExpenses />, { path: "/finance/expenses?record=1&department=d1&need=n1" });
    const form = await screen.findByRole("dialog", { name: "Record expense" });
    await waitFor(() => expect((within(form).getByLabelText(/^Spent against a need/) as HTMLSelectElement).value).toBe("n1"));
    expect((within(form).getByLabelText(/^Department/) as HTMLSelectElement).value).toBe("d1");
  });
});

describe("the Needs page runs needs", () => {
  it("shows what was spent and links to the need's expenses and a new one", async () => {
    renderPage(<FinanceNeeds />, { path: "/finance/needs" });
    await screen.findByText("Camera kit");
    expect(screen.getByText("KES 500.00 awaiting approval")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "2 expenses" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/finance/expenses?need=n1&spent=any"));
  });

  it("Record expense opens the expense form pointed at the need", async () => {
    renderPage(<FinanceNeeds />, { path: "/finance/needs" });
    await screen.findByText("Camera kit");
    fireEvent.click(screen.getByRole("button", { name: /Record expense/ }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/finance/expenses?record=1&department=d1&need=n1"));
  });

  it("adds a need for a department and approves it at once", async () => {
    vi.mocked(DepartmentsApi.createNeed).mockResolvedValue({ need_id: "n9", status: "pending", created_at: "2026-10-31T10:00:00Z" });
    vi.mocked(DepartmentsApi.decideNeed).mockResolvedValue({ status: "approved" });
    renderPage(<FinanceNeeds />, { path: "/finance/needs", permissions: ["finance:view", "departments:view", "departments:manage"] });
    fireEvent.click(await screen.findByRole("button", { name: /New need/ }));
    const drawer = await screen.findByRole("dialog", { name: "New need" });
    await waitFor(() => expect(within(drawer).getAllByRole("option", { name: "Youth" }).length).toBe(1));
    fireEvent.change(within(drawer).getByLabelText(/^Department/), { target: { value: "d2" } });
    fireEvent.change(within(drawer).getByLabelText(/^What is needed/), { target: { value: "Camp tents" } });
    fireEvent.change(within(drawer).getByLabelText(/^Why it matters/), { target: { value: "Forty young people sleep out at camp in December." } });
    fireEvent.change(within(drawer).getByLabelText(/^Target/), { target: { value: "45000" } });
    await act(async () => {
      fireEvent.click(within(drawer).getByRole("button", { name: "Add and approve" }));
    });
    expect(DepartmentsApi.createNeed).toHaveBeenCalledWith("d2", { title: "Camp tents", why: "Forty young people sleep out at camp in December.", target_minor: 4_500_000, currency: "KES", deadline: null });
    expect(DepartmentsApi.decideNeed).toHaveBeenCalledWith("n9", "approve", null);
  });

  it("approves a pending need in place; New need and Approve need departments:manage", async () => {
    vi.mocked(FinanceApi.needs).mockResolvedValue(needsPage([need({ status: "pending", spent_minor: 0, awaiting_minor: 0, expenses_count: 0 })]));
    vi.mocked(DepartmentsApi.decideNeed).mockResolvedValue({ status: "approved" });
    renderPage(<FinanceNeeds />, { path: "/finance/needs?status=pending", permissions: ["finance:view"] });
    await screen.findByText("Camera kit");
    expect(screen.queryByRole("button", { name: /New need/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Approve$/ })).toBeNull();
    cleanup();
    renderPage(<FinanceNeeds />, { path: "/finance/needs?status=pending", permissions: ["finance:view", "departments:manage"] });
    await screen.findByText("Camera kit");
    fireEvent.click(screen.getByRole("button", { name: /^Approve$/ }));
    const dialog = await screen.findByRole("alertdialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Approve need" }));
    });
    expect(DepartmentsApi.decideNeed).toHaveBeenCalledWith("n1", "approve", null);
  });
});
