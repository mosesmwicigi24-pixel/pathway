// @vitest-environment happy-dom
// api/finance.ts wiring: each call hits the contract's method + path with the
// cleaned params / body (docs/FINANCE_ERP.md §4). A stub axios adapter records
// the requests; nothing leaves the process.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { AxiosAdapter, InternalAxiosRequestConfig } from "axios";
import { api } from "../src/api/client";
import { FinanceApi, FINANCE_CSV, statementPdfPath, permissionsCatalog } from "../src/api/finance";

interface Call {
  method: string;
  url: string;
  params: Record<string, unknown> | undefined;
  data: unknown;
  responseType: string | undefined;
}
const calls: Call[] = [];
let respond: (config: InternalAxiosRequestConfig) => unknown = () => ({ data: [], next_cursor: null, totals: [] });
const original = api.defaults.adapter;

beforeEach(() => {
  calls.length = 0;
  respond = () => ({ data: [], next_cursor: null, totals: [] });
  const adapter: AxiosAdapter = async (config) => {
    calls.push({
      method: (config.method ?? "get").toUpperCase(),
      url: config.url ?? "",
      params: config.params as Record<string, unknown> | undefined,
      data: typeof config.data === "string" ? JSON.parse(config.data) : config.data,
      responseType: config.responseType,
    });
    return { data: respond(config), status: 200, statusText: "OK", headers: {}, config };
  };
  api.defaults.adapter = adapter;
});
afterEach(() => {
  api.defaults.adapter = original;
  vi.unstubAllGlobals();
});
const last = (): Call => calls[calls.length - 1] as Call;

describe("reads", () => {
  it("sends only the filters that were chosen", async () => {
    await FinanceApi.transactions({ from: "2026-09-01", to: "2026-09-26", fund: "", status: "succeeded", q: "  OR-2026 ", pledged: "any", cursor: null, limit: 50 });
    expect(last()).toMatchObject({
      method: "GET",
      url: "/admin/finance/transactions",
      params: { from: "2026-09-01", to: "2026-09-26", status: "succeeded", q: "OR-2026", pledged: "any", limit: 50 },
    });
    expect(last().params).not.toHaveProperty("fund");
    expect(last().params).not.toHaveProperty("cursor");
  });

  it("joins a list filter with commas", async () => {
    await FinanceApi.expenses({ status: ["recorded", "approved"], category: "utilities" });
    expect(last()).toMatchObject({ url: "/admin/finance/expenses", params: { status: "recorded,approved", category: "utilities" } });
    await FinanceApi.journals({ kind: ["transfer", "opening"] });
    expect(last()).toMatchObject({ url: "/admin/finance/journals", params: { kind: "transfer,opening" } });
  });

  it("hits every register and report at its contract path", async () => {
    const cases: [() => Promise<unknown>, string][] = [
      [() => FinanceApi.overview({ from: "2026-09-01" }), "/admin/finance/overview"],
      [() => FinanceApi.pledges({ year: 2026, standing: "behind" }), "/admin/finance/pledges"],
      [() => FinanceApi.funds(), "/admin/finance/funds"],
      [() => FinanceApi.ledger({ account: "cash:" }), "/admin/finance/ledger"],
      [() => FinanceApi.trialBalance(), "/admin/finance/trial-balance"],
      [() => FinanceApi.reconciliation(), "/admin/finance/reconciliation"],
      [() => FinanceApi.incomeReport({ year: 2026, by: "channel" }), "/admin/finance/reports/income"],
      [() => FinanceApi.expensesReport({ by: "fund" }), "/admin/finance/reports/expenses"],
      [() => FinanceApi.pledgesReport({ year: 2026 }), "/admin/finance/reports/pledges"],
      [() => FinanceApi.financialPosition({ as_of: "2026-09-26" }), "/admin/finance/reports/financial-position"],
      [() => FinanceApi.incomeExpenditure({ from: "2026-01-01", to: "2026-09-26" }), "/admin/finance/reports/income-expenditure"],
      [() => FinanceApi.statements({ year: 2025 }), "/admin/finance/statements"],
      [() => FinanceApi.audit({ action_prefix: "expense." }), "/admin/finance/audit"],
      [() => FinanceApi.settings(), "/admin/finance/settings"],
      [() => FinanceApi.needs({ status: "all" }), "/admin/finance/needs"],
      [() => FinanceApi.budgetActuals("b1"), "/admin/finance/budgets/b1/actuals"],
      [() => FinanceApi.journal("j1"), "/admin/finance/journals/j1"],
      [() => FinanceApi.summary(), "/admin/finance/summary"],
      [() => FinanceApi.trend(12), "/admin/finance/trend"],
      [() => FinanceApi.config(), "/admin/finance/config"],
      [() => FinanceApi.campaigns(), "/admin/campaigns"],
      [() => FinanceApi.campaignReach("c1"), "/admin/campaigns/c1/reach"],
      [() => permissionsCatalog(), "/admin/permissions/catalog"],
    ];
    for (const [call, url] of cases) {
      await call();
      expect(last().method, url).toBe("GET");
      expect(last().url).toBe(url);
    }
  });

  it("encodes ids in paths", async () => {
    await FinanceApi.transaction("a/b?c");
    expect(last().url).toBe("/admin/finance/transactions/a%2Fb%3Fc");
    expect(statementPdfPath("u 1", "partners")).toBe("/admin/finance/statements/u%201/partners.pdf");
  });

  it("unwraps the { data } lists", async () => {
    respond = () => ({ data: [{ category_id: "x", code: "rent", name: "Rent", is_active: true, sort: 0 }] });
    expect(await FinanceApi.expenseCategories()).toEqual([{ category_id: "x", code: "rent", name: "Rent", is_active: true, sort: 0 }]);
    respond = () => ({ data: [] });
    expect(await FinanceApi.schedules({ attention: true })).toEqual([]);
    expect(last()).toMatchObject({ url: "/admin/finance/schedules", params: { attention: true } });
  });
});

describe("writes", () => {
  it("posts each write to its contract path and method", async () => {
    await FinanceApi.recordGift({ idempotency_key: "k-12345678", anonymous: true, fund: "tithe", amount_minor: 150000, currency: "KES", channel: "onhand", received_on: "2026-09-26" });
    expect(last()).toMatchObject({ method: "POST", url: "/admin/finance/gifts", data: { idempotency_key: "k-12345678", anonymous: true, amount_minor: 150000 } });
    await FinanceApi.reverseTransaction("t1", { reason: "wrong fund" });
    expect(last()).toMatchObject({ method: "POST", url: "/admin/finance/transactions/t1/reverse", data: { reason: "wrong fund" } });
    await FinanceApi.updateFund("building", { is_active: false });
    expect(last()).toMatchObject({ method: "PATCH", url: "/admin/finance/funds/building", data: { is_active: false } });
    await FinanceApi.transferFunds({ from_fund: "tithe", to_fund: "missions", amount_minor: 100, currency: "KES", occurred_on: "2026-09-26", memo: "Q3 allocation" });
    expect(last()).toMatchObject({ method: "POST", url: "/admin/finance/transfers" });
    await FinanceApi.approveExpense("e1");
    expect(last()).toMatchObject({ method: "POST", url: "/admin/finance/expenses/e1/approve", data: {} });
    await FinanceApi.voidExpense("e1", { reason: "duplicate entry" });
    expect(last()).toMatchObject({ method: "POST", url: "/admin/finance/expenses/e1/void" });
    await FinanceApi.replaceBudgetLines("b1", { lines: [{ kind: "income", fund: "tithe", label: "Tithes", monthly_minor: Array(12).fill(0) }] });
    expect(last()).toMatchObject({ method: "PUT", url: "/admin/finance/budgets/b1/lines" });
    await FinanceApi.postOpeningBalance({ idempotency_key: "k-12345678", channel: "bank", fund: "tithe", amount_minor: 1, currency: "KES", as_of: "2026-01-01", memo: "Brought forward" });
    expect(last()).toMatchObject({ method: "POST", url: "/admin/finance/opening-balances" });
    await FinanceApi.reverseJournal("j1", { reason: "posted twice" });
    expect(last()).toMatchObject({ method: "POST", url: "/admin/finance/journals/j1/reverse" });
    await FinanceApi.goLive("c1");
    expect(last()).toMatchObject({ method: "POST", url: "/admin/campaigns/c1/status", data: { status: "live" } });
    await FinanceApi.endCampaign("c1");
    expect(last()).toMatchObject({ method: "POST", url: "/admin/campaigns/c1/status", data: { status: "ended" } });
    await FinanceApi.updateCampaign("c1", { title: "Roof", blurb: "Fix the roof before the rains", fund: "building", goal_minor: 1, currency: "KES", starts_on: "2026-09-01", ends_on: "2026-10-31" });
    expect(last()).toMatchObject({ method: "PUT", url: "/admin/campaigns/c1" });
    await FinanceApi.confirmClaim("cl1");
    expect(last()).toMatchObject({ method: "POST", url: "/admin/partners/claims/cl1/confirm" });
  });
});

// URL with the two object-URL statics replaced (the page would hand the Blob to the browser).
function stubObjectUrls(create: () => string, revoke: () => void = () => undefined): void {
  class FakeURL extends URL {
    static override createObjectURL = create;
    static override revokeObjectURL = revoke;
  }
  vi.stubGlobal("URL", FakeURL);
}

describe("downloads", () => {
  it("fetches the CSV twin as a blob with the same filters and saves it", async () => {
    const create = vi.fn(() => "blob:finance");
    stubObjectUrls(create);
    respond = () => new Blob(["a,b\r\n"], { type: "text/csv" });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    await FinanceApi.transactionsCsv({ from: "2026-09-01", status: "succeeded", fund: null }, "Transactions Sep 2026");
    expect(last()).toMatchObject({ method: "GET", url: FINANCE_CSV.transactions, params: { from: "2026-09-01", status: "succeeded" }, responseType: "blob" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("Transactions-Sep-2026.csv");
    click.mockRestore();
  });

  it("asks for a member's statement PDF with its year", async () => {
    stubObjectUrls(() => "blob:pdf");
    respond = () => new Blob(["%PDF"], { type: "application/pdf" });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    await FinanceApi.givingStatementPdf("u1", 2025);
    expect(last()).toMatchObject({ url: "/admin/finance/statements/u1/giving.pdf", params: { year: 2025 }, responseType: "blob" });
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe("giving-statement-2025.pdf");
    click.mockRestore();
  });
});
