// @vitest-environment happy-dom
// Finance → Pledges and Finance → Partners: the register links a row to the
// member's partner drawer (?member=), the drawer opens from that link (and the
// older ?partner=), shows the faithfulness strip from the pledge register —
// never a namesake's pledges — and the old claims tab now lives on its own page.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { PartnersApi, type PartnerDetail, type PartnerRow } from "../src/api/client";
import { FinanceApi, type FinancePledgeRow, type FinancePledgesPage } from "../src/api/finance";
import { Partners } from "../src/components/pages/Partners";
import { FinancePledges } from "../src/components/pages/finance/Pledges";
import { currentYearEAT } from "../src/components/finance/dates";
import { ALL_FINANCE, renderPage } from "./financeBSetup";

vi.mock("../src/api/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/api/client")>();
  return {
    ...mod,
    PartnersApi: { ...mod.PartnersApi, list: vi.fn(), detail: vi.fn(), claims: vi.fn(), remind: vi.fn(), remindBehind: vi.fn() },
  };
});
vi.mock("../src/api/finance", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/api/finance")>();
  return {
    ...mod,
    FinanceApi: { ...mod.FinanceApi, pledges: vi.fn(), givingStatementPdf: vi.fn(), partnerStatementPdf: vi.fn() },
  };
});

afterEach(cleanup);

const YEAR = currentYearEAT();

const partnerRow: PartnerRow = {
  user_id: "u1",
  full_name: "Grace Wanjiru",
  avatar_url: null,
  phone: "+254700000001",
  email: "grace@example.org",
  cell_name: "Kilimani",
  membership: { status: "active", joined_at: "2026-01-10T09:00:00Z" },
  tier: null,
  pledges_active: 1,
  committed_monthly_minor: 500_000,
  given_year_minor: 3_500_000,
  last_gift_at: "2026-09-05T09:00:00Z",
  behind: true,
  next_due_on: "2026-08-05",
};

const detail: PartnerDetail = {
  member: partnerRow,
  pledges: [
    {
      pledge_id: "p1",
      shape: "monthly",
      amount_minor: 500_000,
      target_minor: null,
      currency: "KES",
      due_day: 5,
      due_on: null,
      fund: { code: "tithe", name: "Tithe" },
      campaign: null,
      status: "active",
      progress: { paid_minor: 3_500_000, period_paid_minor: 0, label: "behind", next_due: "2026-08-05" },
      schedule_id: null,
      reminders_enabled: true,
      created_at: "2026-01-10T09:00:00Z",
    },
  ],
  schedules: [],
  payments: [],
  reminders: [],
};

const registerRow = (over: Partial<FinancePledgeRow>): FinancePledgeRow => ({
  pledge_id: "p1",
  user_id: "u1",
  member_name: "Grace Wanjiru",
  member_phone: "+254700000001",
  title: "Tithe",
  shape: "monthly",
  amount_minor: 500_000,
  target_minor: null,
  currency: "KES",
  status: "active",
  standing: "behind",
  year: YEAR,
  pledged_year_minor: 4_500_000,
  paid_year_minor: 3_500_000,
  remaining_year_minor: 1_000_000,
  paid_total_minor: 3_500_000,
  kept: 7,
  due_count: 9,
  next_due: "2026-08-05",
  overdue_since: "2026-08-05",
  due_day: 5,
  due_on: null,
  created_at: "2026-01-10T09:00:00Z",
  pays_to: { code: "tithe", name: "Tithe" },
  ...over,
});

const page = (rows: FinancePledgeRow[], totals: FinancePledgesPage["totals"] = []): FinancePledgesPage => ({ year: YEAR, data: rows, next_cursor: null, totals });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(PartnersApi.list).mockResolvedValue({
    data: [partnerRow],
    summary: { partners: 1, active_pledges: 1, committed_monthly_minor: 500_000, behind: 1, given_year_minor: 3_500_000 },
  });
  vi.mocked(PartnersApi.detail).mockResolvedValue(detail);
  vi.mocked(PartnersApi.claims).mockResolvedValue([]);
  vi.mocked(FinanceApi.pledges).mockResolvedValue(
    page([
      registerRow({}),
      // A namesake — same name, another member: must never show in Grace's strip.
      registerRow({ pledge_id: "p9", user_id: "u9", title: "Namesake's building pledge", kept: 1, due_count: 1, standing: "on_track", overdue_since: null }),
    ]),
  );
});

describe("Partners (/finance/partners)", () => {
  it("opens the partner drawer from ?member=, with the faithfulness strip from the register", async () => {
    renderPage(<Partners />, { path: "/finance/partners?member=u1" });
    await waitFor(() => expect(PartnersApi.detail).toHaveBeenCalledWith("u1"));
    const drawer = await screen.findByRole("dialog", { name: "Partner" });
    await within(drawer).findByText("Faithfulness");
    // The strip (Σ over Grace's pledges) and her one pledge's row both read 7 of 9 —
    // the namesake's 1 of 1 is not added in.
    await waitFor(() => expect(within(drawer).getAllByText("7 of 9")).toHaveLength(2));
    expect(within(drawer).getAllByText("Overdue since 5 Aug 2026").length).toBeGreaterThan(0);
    expect(within(drawer).queryByText("Namesake's building pledge")).toBeNull();
    expect(FinanceApi.pledges).toHaveBeenCalledWith(expect.objectContaining({ q: "Grace Wanjiru", year: YEAR }));
    // The year's statements are one click away.
    expect(within(drawer).getByText("Partner statement PDF")).toBeTruthy();
    expect(within(drawer).getByText("Giving statement PDF")).toBeTruthy();
  });

  it("still opens from the older ?partner= link", async () => {
    renderPage(<Partners />, { path: "/finance/partners?partner=u1" });
    await waitFor(() => expect(PartnersApi.detail).toHaveBeenCalledWith("u1"));
    expect(await screen.findByRole("dialog", { name: "Partner" })).toBeTruthy();
  });

  it("writes ?member= when a row is opened and clears it on close", async () => {
    renderPage(<Partners />, { path: "/finance/partners" });
    fireEvent.click(await screen.findByText("Grace Wanjiru"));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/finance/partners?member=u1"));
    const drawer = await screen.findByRole("dialog", { name: "Partner" });
    fireEvent.click(within(drawer).getByText("Close"));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/finance/partners"));
  });

  it("sends the old claims tab to the Claims page, and the Claims badge links there", async () => {
    renderPage(<Partners />, { path: "/finance/partners?tab=claims" });
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/finance/claims"));
    cleanup();
    vi.mocked(PartnersApi.claims).mockResolvedValue([
      { claim_id: "c1", pledge_id: "p1", user_id: "u1", full_name: "Grace Wanjiru", amount_minor: "250000", currency: "KES", paid_on: "2026-09-20", note: null, status: "pending", created_at: "2026-09-21T09:00:00Z", pledge_title: "Tithe" },
    ]);
    renderPage(<Partners />, { path: "/finance/partners" });
    const badge = await screen.findByLabelText("1 pending");
    fireEvent.click(badge);
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/finance/claims"));
  });

  it("offers no office actions without finance:manage", async () => {
    renderPage(<Partners />, { path: "/finance/partners", permissions: ["finance:view"] });
    await screen.findByText("Grace Wanjiru");
    expect(screen.queryByText("Remind everyone behind")).toBeNull();
  });
});

describe("Pledges (/finance/pledges)", () => {
  it("lists the register, totals per currency, and opens the member's partner drawer", async () => {
    vi.mocked(FinanceApi.pledges).mockResolvedValue(
      page(
        [registerRow({}), registerRow({ pledge_id: "p2", user_id: "u2", member_name: "Peter Otieno", currency: "USD", standing: "on_track", overdue_since: null, amount_minor: 5_000, kept: 3, due_count: 3 })],
        [
          { currency: "USD", amount_minor: 45_000, count: 1, pledged_minor: 45_000, paid_minor: 15_000, remaining_minor: 30_000 },
          { currency: "KES", amount_minor: 4_500_000, count: 1, pledged_minor: 4_500_000, paid_minor: 3_500_000, remaining_minor: 1_000_000 },
        ],
      ),
    );
    renderPage(<FinancePledges />, { path: "/finance/pledges?standing=behind" });
    await screen.findByText("Peter Otieno");
    expect(FinanceApi.pledges).toHaveBeenCalledWith(expect.objectContaining({ standing: "behind", year: YEAR }));
    expect(screen.getByText("Overdue since 5 Aug 2026")).toBeTruthy();
    expect(screen.getByText("7 of 9")).toBeTruthy();
    // Totals: one group per currency, KES first — never a sum across them.
    const groups = document.querySelectorAll("[data-currency]");
    expect([...groups].map((g) => g.getAttribute("data-currency"))).toEqual(["KES", "USD"]);
    expect(groups[0]?.textContent).toContain("KES 45,000.00");
    expect(groups[1]?.textContent).toContain("USD 450.00");
    fireEvent.click(screen.getByText("Grace Wanjiru"));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/finance/partners?member=u1"));
  });

  it("clears every filter at once (one navigation, not one per filter)", async () => {
    renderPage(<FinancePledges />, { path: `/finance/pledges?year=${YEAR - 1}&status=active&standing=behind&shape=monthly&q=grace` });
    await screen.findAllByText("Grace Wanjiru");
    expect(FinanceApi.pledges).toHaveBeenCalledWith(expect.objectContaining({ year: YEAR - 1, status: "active", standing: "behind", shape: "monthly", q: "grace" }));
    fireEvent.click(screen.getByText("Clear"));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/finance/pledges"));
    await waitFor(() => expect(FinanceApi.pledges).toHaveBeenLastCalledWith(expect.objectContaining({ year: YEAR, status: null, standing: null, shape: null, q: null })));
  });

  it("shows Export CSV only with finance:export", async () => {
    renderPage(<FinancePledges />, { path: "/finance/pledges", permissions: ALL_FINANCE });
    expect(await screen.findByText("Export CSV")).toBeTruthy();
    cleanup();
    renderPage(<FinancePledges />, { path: "/finance/pledges", permissions: ["finance:view"] });
    await screen.findAllByText("Grace Wanjiru");
    expect(screen.queryByText("Export CSV")).toBeNull();
  });
});
