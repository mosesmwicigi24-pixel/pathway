// @vitest-environment happy-dom
// Finance pages set A, rendered: write actions appear only with their
// capability (and never while /me loads), Reverse only for office entries,
// the transfer's NEGATIVE_BALANCE → "Post anyway" → allow_negative resubmit,
// FUND_IN_USE → "Deactivate anyway" → force, the trial balance's verdict, and
// each page rendering its figures with the words that explain them.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import type { ReactElement } from "react";
import type { BooksTransferInput, FinanceFundRow, FinanceOverview as OverviewData, FinanceReconciliation, FinanceTransactionDetail, FinanceTrialBalance } from "../src/api/finance";
import { authReducer, setPermissions } from "../src/store/authSlice";

const api = vi.hoisted(() => ({
  transaction: vi.fn(),
  reverseTransaction: vi.fn(),
  transactions: vi.fn(),
  funds: vi.fn(),
  transferFunds: vi.fn(),
  updateFund: vi.fn(),
  trialBalance: vi.fn(),
  overview: vi.fn(),
  reconciliation: vi.fn(),
  audit: vi.fn(),
  settings: vi.fn(),
  expenseCategories: vi.fn(),
  ledger: vi.fn(),
  needs: vi.fn(),
}));
vi.mock("../src/api/finance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api/finance")>();
  return { ...actual, FinanceApi: { ...actual.FinanceApi, ...api } };
});

import { TransactionDrawer } from "../src/components/finance/a/TransactionDrawer";
import { TransferDrawer } from "../src/components/finance/a/TransferDrawer";
import { FundFormDrawer } from "../src/components/finance/a/FundFormDrawer";
import { TrialBalancePanel } from "../src/components/finance/a/LedgerPanels";
import { FinanceTransactions } from "../src/components/pages/finance/Transactions";
import { FinanceFunds } from "../src/components/pages/finance/Funds";
import { FinanceOverview } from "../src/components/pages/finance/Overview";
import { FinanceReconciliation } from "../src/components/pages/finance/Reconciliation";
import { FinanceAudit } from "../src/components/pages/finance/Audit";
import { FinanceSettings } from "../src/components/pages/finance/Settings";

function renderApp(ui: ReactElement, opts: { permissions?: string[] | null; route?: string } = {}): void {
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setPermissions(opts.permissions === undefined ? ["finance:view"] : opts.permissions));
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[opts.route ?? "/"]}>{ui}</MemoryRouter>
    </Provider>,
  );
}

function apiError(status: number, code: string, message: string, details?: Record<string, unknown>): AxiosError {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
  return new AxiosError("request failed", undefined, config, undefined, { status, statusText: "", headers: {}, config, data: { error: { code, message, request_id: "r", ...(details ? { details } : {}) } } });
}

function fundRow(code: string, name: string, kes = 0, over: Partial<FinanceFundRow> = {}): FinanceFundRow {
  return {
    code,
    name,
    name_sw: null,
    is_active: true,
    description: null,
    sort: 0,
    balances: kes ? [{ currency: "KES", balance_minor: kes }] : [],
    income: [],
    expenses_ytd: [],
    transfers_in_ytd: [],
    transfers_out_ytd: [],
    last_activity_at: null,
    ...over,
  };
}

function detail(over: Partial<FinanceTransactionDetail["transaction"]> = {}): FinanceTransactionDetail {
  return {
    transaction: {
      transaction_id: "tx-1",
      user_id: "u1",
      full_name: "Grace Wanjiru",
      member_phone: "+254700000001",
      display_name: "Grace Wanjiru",
      amount_minor: 100_000,
      currency: "KES",
      status: "succeeded",
      fund: "tithe",
      fund_name: "Tithe",
      account_name: null,
      method: "manual",
      channel: "onhand",
      source: "admin",
      provider: "manual",
      provider_ref: null,
      receipt_code: "OR-2026-00042",
      giver_name: null,
      giver_phone: null,
      pledge_id: "p1",
      pledge_title: "Building pledge",
      need_id: null,
      need_title: null,
      office_channel: "onhand",
      office_reference: null,
      recorded_by: "a1",
      recorded_by_name: "Treasurer",
      reversed_at: null,
      reversed_by: null,
      reversed_by_name: null,
      reversal_reason: null,
      created_at: "2026-09-20T09:00:00Z",
      settled_at: "2026-09-20T09:00:00Z",
      stripe_payment_intent: null,
      idempotency_key: "k",
      schedule_id: null,
      giver_email: null,
      ...over,
    },
    ledger_entries: [
      { entry_id: "e1", account: "cash:onhand", side: "debit", amount_minor: 100_000, currency: "KES", created_at: "2026-09-20T09:00:00Z", is_reversal: false },
      { entry_id: "e2", account: "fund:tithe", side: "credit", amount_minor: 100_000, currency: "KES", created_at: "2026-09-20T09:00:00Z", is_reversal: false },
    ],
  };
}

const EMPTY_PAGE = { data: [], next_cursor: null, totals: [] };

afterEach(cleanup);
beforeEach(() => {
  for (const m of Object.values(api)) m.mockReset();
  api.transactions.mockResolvedValue(EMPTY_PAGE);
  api.funds.mockResolvedValue({ period: { from: "2026-09-01", to: "2026-09-26", ytd_from: "2026-01-01" }, data: [fundRow("tithe", "Tithe", 2_000_000)], next_cursor: null, totals: [] });
  api.ledger.mockResolvedValue(EMPTY_PAGE);
  api.needs.mockResolvedValue(EMPTY_PAGE);
});

describe("Transaction drawer — Reverse", () => {
  it("is hidden without finance:manage, and while /me loads", async () => {
    api.transaction.mockResolvedValue(detail());
    renderApp(<TransactionDrawer transactionId="tx-1" onClose={() => undefined} />, { permissions: ["finance:view"] });
    expect(await screen.findByText("Ledger postings")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reverse" })).toBeNull();
    cleanup();
    renderApp(<TransactionDrawer transactionId="tx-1" onClose={() => undefined} />, { permissions: null });
    expect(await screen.findByText("Ledger postings")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reverse" })).toBeNull();
  });

  it("is hidden for a provider payment — refunded at the provider", async () => {
    api.transaction.mockResolvedValue(detail({ provider: "mpesa", channel: "mpesa", source: "app", office_channel: null, receipt_code: "SJK4H7T2QX" }));
    renderApp(<TransactionDrawer transactionId="tx-1" onClose={() => undefined} />, { permissions: ["finance:view", "finance:manage"] });
    expect(await screen.findByText(/refunded at the provider/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reverse" })).toBeNull();
  });

  it("states the consequence, needs a reason, and reverses an office gift", async () => {
    api.transaction.mockResolvedValue(detail());
    api.reverseTransaction.mockResolvedValue({});
    const onChanged = vi.fn();
    renderApp(<TransactionDrawer transactionId="tx-1" onClose={() => undefined} onChanged={onChanged} />, { permissions: ["finance:view", "finance:manage"] });
    fireEvent.click(await screen.findByRole("button", { name: "Reverse" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/Posts KES 1,000.00 back out of Tithe; the gift leaves Grace Wanjiru's statement and re-opens their instalment/)).toBeTruthy();
    const confirm = within(dialog).getByRole("button", { name: "Reverse gift" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Entered twice — same envelope" } });
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(api.reverseTransaction).toHaveBeenCalledWith("tx-1", { reason: "Entered twice — same envelope" });
    expect(onChanged).toHaveBeenCalled();
  });
});

describe("write actions follow the capability — hidden, not greyed", () => {
  it("Transactions: Record a gift and Export need manage / export; nothing while /me loads", async () => {
    renderApp(<FinanceTransactions />, { permissions: null });
    expect(await screen.findByText("Register")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Record a gift/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Export CSV/ })).toBeNull();
    cleanup();
    renderApp(<FinanceTransactions />, { permissions: ["finance:view", "finance:manage", "finance:export"] });
    expect(await screen.findByRole("button", { name: /Record a gift/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Export CSV/ })).toBeTruthy();
  });

  it("Funds: New fund needs manage; Transfer and Opening balance need approve", async () => {
    renderApp(<FinanceFunds />, { permissions: null });
    expect(await screen.findByText("Tithe")).toBeTruthy();
    for (const name of [/New fund/, /Transfer between funds/, /Opening balance/]) expect(screen.queryByRole("button", { name })).toBeNull();
    cleanup();
    renderApp(<FinanceFunds />, { permissions: ["finance:view", "finance:manage"] });
    expect(await screen.findByRole("button", { name: /New fund/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Transfer between funds/ })).toBeNull();
    cleanup();
    renderApp(<FinanceFunds />, { permissions: ["finance:view", "finance:approve"] });
    expect(await screen.findByRole("button", { name: /Transfer between funds/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Opening balance/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /New fund/ })).toBeNull();
  });
});

describe("Transfer between funds", () => {
  it("NEGATIVE_BALANCE shows the balance, and Post anyway resends with allow_negative (same key)", async () => {
    api.transferFunds
      .mockRejectedValueOnce(apiError(422, "UNPROCESSABLE", "Tithe would go below zero.", { reason: "NEGATIVE_BALANCE", balance_minor: 2_000_000, balance_after_minor: -3_000_000 }))
      .mockResolvedValueOnce({ transfer_id: "tr1", journal_id: "j1", from_fund: { code: "tithe", name: "Tithe" }, to_fund: { code: "missions", name: "Missions" }, amount_minor: 5_000_000, currency: "KES", occurred_on: "2026-09-26", memo: "Seed missions", created_by: null, created_at: "", from_balance_after_minor: -3_000_000, reversed_by_journal_id: null, reused: false, ledger: [] });
    const onPosted = vi.fn();
    render(<TransferDrawer funds={[fundRow("tithe", "Tithe", 2_000_000), fundRow("missions", "Missions")]} onClose={() => undefined} onPosted={onPosted} now={new Date("2026-09-26T06:00:00Z")} />);
    fireEvent.change(screen.getByLabelText(/^From/), { target: { value: "tithe" } });
    fireEvent.change(screen.getByLabelText(/^To/), { target: { value: "missions" } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "50000" } });
    fireEvent.change(screen.getByLabelText(/^Memo/), { target: { value: "Seed missions" } });
    expect(screen.getByTestId("from-balance").textContent).toMatch(/Tithe holds KES 20,000.00 in KES — after this transfer: -KES 30,000.00/);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Post KES 50,000.00/ }));
    });
    expect(screen.getByText(/Tithe has KES 20,000.00 in KES; this transfer would leave it at -KES 30,000.00/)).toBeTruthy();
    expect(onPosted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Post anyway" }));
    const dialog = screen.getByRole("alertdialog", { name: "Post the transfer anyway?" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Post anyway" }));
    });
    await waitFor(() => expect(onPosted).toHaveBeenCalledTimes(1));
    const [first, second] = api.transferFunds.mock.calls.map((c) => c[0] as BooksTransferInput);
    expect(first?.allow_negative).toBeUndefined();
    expect(second?.allow_negative).toBe(true);
    expect(second?.idempotency_key).toBe(first?.idempotency_key);
    expect(second).toMatchObject({ from_fund: "tithe", to_fund: "missions", amount_minor: 5_000_000, currency: "KES", memo: "Seed missions" });
  });
});

describe("Deactivating a fund money still routes to", () => {
  it("shows FUND_IN_USE counts; Deactivate anyway asks again and sends force", async () => {
    api.updateFund
      .mockRejectedValueOnce(apiError(409, "FUND_IN_USE", "Building Fund is still in use.", { active_pledges: 12, active_schedules: 3, departments: 1, live_campaigns: 0 }))
      .mockResolvedValueOnce({ fund_id: "f1", code: "building", name: "Building Fund", name_sw: null, description: null, sort: 0, is_active: false });
    const onSaved = vi.fn();
    render(<FundFormDrawer fund={fundRow("building", "Building Fund")} onClose={() => undefined} onSaved={onSaved} />);
    expect((screen.getByLabelText(/^Code/) as HTMLInputElement).readOnly).toBe(true);
    fireEvent.click(screen.getByLabelText(/Active/));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });
    expect(screen.getByText("12 active pledges, 3 recurring gifts and 1 department still send money to Building Fund — their payments will fail while it is inactive.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Deactivate anyway" }));
    const dialog = screen.getByRole("alertdialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate anyway" }));
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(api.updateFund.mock.calls[0]).toEqual(["building", { is_active: false }]);
    expect(api.updateFund.mock.calls[1]).toEqual(["building", { is_active: false, force: true }]);
  });
});

describe("Trial balance verdict", () => {
  const tb = (balanced: boolean, rows = true): FinanceTrialBalance => ({
    period: { from: null, to: null },
    data: rows
      ? [
          { account: "cash:mpesa", currency: "KES", debit_minor: 500_000, credit_minor: 0, balance_minor: 500_000, normal_side: "debit" },
          { account: "fund:tithe", currency: "KES", debit_minor: 0, credit_minor: balanced ? 500_000 : 400_000, balance_minor: balanced ? 500_000 : 400_000, normal_side: "credit" },
        ]
      : [],
    totals: rows ? [{ currency: "KES", debit_minor: 500_000, credit_minor: balanced ? 500_000 : 400_000, balanced }] : [],
    balanced,
  });
  it("says Balanced ✓ when debits equal credits", async () => {
    api.trialBalance.mockResolvedValue(tb(true));
    renderApp(<TrialBalancePanel nameOf={() => null} />);
    expect(await screen.findByText("Balanced ✓")).toBeTruthy();
    expect(screen.getByText("✓ balanced")).toBeTruthy();
  });
  it("says Not balanced and names the currency when they differ", async () => {
    api.trialBalance.mockResolvedValue(tb(false));
    renderApp(<TrialBalancePanel nameOf={() => null} />);
    expect(await screen.findByText("Not balanced")).toBeTruthy();
    expect(screen.getByText(/Debits and credits differ in KES/)).toBeTruthy();
  });
  it("says there is nothing to balance in an empty period", async () => {
    api.trialBalance.mockResolvedValue(tb(true, false));
    renderApp(<TrialBalancePanel nameOf={() => null} />);
    expect(await screen.findByText(/No postings in this period/)).toBeTruthy();
  });
});

const OVERVIEW: OverviewData = {
  period: { from: "2026-09-01", to: "2026-09-26", mtd_from: "2026-09-01", ytd_from: "2026-01-01", last_year_from: "2025-09-01", last_year_to: "2025-09-26" },
  currencies: ["KES", "USD"],
  income: [
    { currency: "KES", period_minor: 12_000_000, period_count: 40, mtd_minor: 12_000_000, ytd_minor: 90_000_000, same_period_last_year_minor: 10_000_000 },
    { currency: "USD", period_minor: 50_000, period_count: 2, mtd_minor: 50_000, ytd_minor: 90_000, same_period_last_year_minor: 0 },
  ],
  expenses: [{ currency: "KES", period_minor: 3_000_000, period_count: 5, ytd_minor: 20_000_000 }],
  net: [
    { currency: "KES", period_minor: 9_000_000, ytd_minor: 70_000_000 },
    { currency: "USD", period_minor: 50_000, ytd_minor: 90_000 },
  ],
  outstanding_pledges: [{ currency: "KES", remaining_year_minor: 45_000_000, pledges: 46 }],
  partners: { count: 46, behind: 7 },
  counts: { processing: 2, failed_in_period: 3, pending_claims: 3, expenses_awaiting_approval: 1, failing_schedules: 0, stale_processing: 1, integrity_issues: 1 },
  fund_balances: [{ code: "tithe", name: "Tithe", is_active: true, balances: [{ currency: "KES", balance_minor: 50_000_000 }] }],
  channels: [{ channel: "mpesa", account: "cash:mpesa", currency: "KES", count: 30, received_minor: 10_000_000, reversed_minor: 100_000, net_minor: 9_900_000 }],
  series: [{ currency: "KES", months: [{ month: "2026-09", income_minor: 12_000_000, expenses_minor: 3_000_000 }] }],
  alerts: [
    { kind: "pending_claims", count: 3, link: "/finance/claims" },
    { kind: "integrity_issues", count: 1, link: "/finance/ledger" },
  ],
};

describe("pages render their figures with the words that explain them", () => {
  it("Overview: income against last year, alerts, channels, fund balances", async () => {
    api.overview.mockResolvedValue(OVERVIEW);
    renderApp(<FinanceOverview />);
    expect(await screen.findByText("+20% vs KES 100,000.00 last year")).toBeTruthy();
    expect(screen.getByText("new — nothing this time last year")).toBeTruthy();
    expect(screen.getByText("3 claims waiting")).toBeTruthy();
    expect(screen.getByText("1 books issue")).toBeTruthy();
    expect(screen.getByText("7 of 46")).toBeTruthy();
    expect(screen.getByText("Money in by channel")).toBeTruthy();
    expect(screen.getByText("Total KES")).toBeTruthy();
    expect(screen.getAllByText("Tithe").length).toBeGreaterThan(0);
    expect(api.overview).toHaveBeenCalledWith(expect.objectContaining({ from: expect.stringMatching(/^\d{4}-\d{2}-01$/) }));
  });

  it("Reconciliation opens on ?tab=exceptions with what to do per kind", async () => {
    const rec: FinanceReconciliation = {
      period: { from: "2026-09-01", to: "2026-09-26" },
      settlement: [{ day: "2026-09-21", channel: "mpesa", account: "cash:mpesa", currency: "KES", count: 12, received_minor: 3_000_000, reversed_count: 0, reversed_minor: 0, amount_minor: 3_000_000 }],
      exceptions: [
        { kind: "duplicate_receipt", transaction_id: "tx-office", journal_id: null, amount_minor: 100_000, currency: "KES", at: "2026-09-21T08:00:00Z", detail: "SJK4H7T2QX is on OR-2026-00007 and an online payment." },
        { kind: "unbalanced_journal", transaction_id: null, journal_id: "j-bad", amount_minor: null, currency: null, at: null, detail: "No postings." },
      ],
      exception_counts: { stale_processing: 0, failed: 0, succeeded_without_ledger: 0, unbalanced_transaction: 0, refunded_without_reversal: 0, duplicate_receipt: 1, unbalanced_journal: 1 },
      integrity: [{ currency: "KES", debit_minor: 1, credit_minor: 1, balanced: true }],
    };
    api.reconciliation.mockResolvedValue(rec);
    renderApp(<FinanceReconciliation />, { route: "/finance/reconciliation?tab=exceptions" });
    // once in the summary chips, once as the section's title
    expect(await screen.findAllByText("Recorded twice · 1")).toHaveLength(2);
    expect(screen.getAllByText(/What to do:/).length).toBe(2);
    expect(screen.getByRole("link", { name: /Open the office entry/ }).getAttribute("href")).toBe("/finance/transactions?tx=tx-office");
    expect(screen.getByRole("link", { name: /Open journal/ }).getAttribute("href")).toBe("/finance/ledger?tab=journals&journal=j-bad");
  });

  it("Audit shows who did what in words, with the key facts", async () => {
    api.audit.mockResolvedValue({
      data: [
        { audit_id: 1, actor_id: "a1", actor_name: "Treasurer", action: "finance.gift_reversed", entity: "transactions", entity_id: "tx-1", metadata: { amount_minor: 100_000, currency: "KES", reason: "Entered twice" }, occurred_at: "2026-09-21T08:00:00Z", actor_type: "Admin" },
      ],
      next_cursor: null,
    });
    renderApp(<FinanceAudit />);
    expect(await screen.findByText("Reversed a gift")).toBeTruthy();
    expect(screen.getByText("Treasurer")).toBeTruthy();
    expect(screen.getByText("KES 1,000.00")).toBeTruthy();
    expect(screen.getByText("“Entered twice”")).toBeTruthy();
    expect(screen.getByRole("link", { name: "tx-1" }).getAttribute("href")).toBe("/finance/transactions?tx=tx-1");
  });

  it("Settings: categories, providers by name only, next receipt, who can do what", async () => {
    api.expenseCategories.mockResolvedValue([{ category_id: "c1", code: "utilities", name: "Utilities", is_active: true, sort: 10 }]);
    api.settings.mockResolvedValue({
      providers: [{ key: "mpesa", label: "M-Pesa", configured: true, env: ["MPESA_CONSUMER_KEY", "MPESA_SHORTCODE"] }],
      receipt_counter: { year: 2026, next: 43, next_receipt: "OR-2026-00043" },
      giving_tiers: [{ amount_minor: 2_000_000, currency: "KES", disciples_per_year: 1, meaning: "Carries one disciple through a level" }],
      cost_per_disciple_minor: 2_000_000,
      reminder_policy: { due_soon_days: 3, due_window_days: 7, follow_up_hours: 48, follow_ups: 2, in_flight_minutes: 30, text: ["A reminder goes three days before an instalment is due."] },
    });
    renderApp(<FinanceSettings />, { permissions: ["finance:view", "finance:manage"] });
    expect(await screen.findByText("Utilities")).toBeTruthy();
    expect(await screen.findByText("OR-2026-00043")).toBeTruthy();
    expect(screen.getByText("MPESA_CONSUMER_KEY, MPESA_SHORTCODE")).toBeTruthy();
    expect(screen.getByText("finance:approve")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add category/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Deactivate/ })).toBeTruthy();
  });
});
