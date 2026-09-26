// @vitest-environment happy-dom
// Finance → Claims and Finance → Recurring gifts: claim decisions are shown
// only with finance:manage and state their consequence (the pledge's own fund)
// before anything is recorded; a claim someone else decided drops out quietly;
// the recurring page's run-rate is integer math per currency and its
// "needs attention" deep link reaches the server.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { AdminScheduleRow, PartnerDetail, PledgeClaimRow } from "../src/api/client";
import { FinanceApi } from "../src/api/finance";
import { FinanceClaims } from "../src/components/pages/finance/Claims";
import { FinanceRecurring } from "../src/components/pages/finance/Recurring";
import { apiError, renderPage } from "./financeBSetup";

vi.mock("../src/api/finance", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/api/finance")>();
  return {
    ...mod,
    FinanceApi: { ...mod.FinanceApi, claims: vi.fn(), confirmClaim: vi.fn(), rejectClaim: vi.fn(), partner: vi.fn(), schedules: vi.fn(), config: vi.fn() },
  };
});

afterEach(cleanup);

const claim: PledgeClaimRow = {
  claim_id: "c1",
  pledge_id: "p1",
  user_id: "u1",
  full_name: "Grace Wanjiru",
  amount_minor: "250000",
  currency: "KES",
  paid_on: "2026-09-20",
  note: "Cash at the office, Sunday",
  status: "pending",
  created_at: "2026-09-21T09:00:00Z",
  pledge_title: "Building Fund",
};

const partner = {
  member: { user_id: "u1", full_name: "Grace Wanjiru" },
  pledges: [{ pledge_id: "p1", fund: null, pays_to: { code: "building", name: "Building" } }],
  schedules: [],
  payments: [],
  reminders: [],
} as unknown as PartnerDetail;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(FinanceApi.claims).mockResolvedValue([claim]);
  vi.mocked(FinanceApi.partner).mockResolvedValue(partner);
  vi.mocked(FinanceApi.confirmClaim).mockResolvedValue({ claim_id: "c1", status: "confirmed", transaction_id: "t1" });
  vi.mocked(FinanceApi.rejectClaim).mockResolvedValue({ claim_id: "c1", status: "rejected" });
  vi.mocked(FinanceApi.config).mockResolvedValue({ funds: [{ code: "general", name: "General Fund", is_active: true }], providers: [], step_up_required: true });
});

describe("Claims (/finance/claims)", () => {
  it("hides Confirm and Reject without finance:manage — and while /me is still loading", async () => {
    renderPage(<FinanceClaims />, { path: "/finance/claims", permissions: ["finance:view"] });
    await screen.findByText("Grace Wanjiru");
    expect(screen.queryByText("Confirm")).toBeNull();
    expect(screen.queryByText("Reject")).toBeNull();
    cleanup();
    renderPage(<FinanceClaims />, { path: "/finance/claims", permissions: null });
    await screen.findByText("Grace Wanjiru");
    expect(screen.queryByText("Confirm")).toBeNull();
  });

  it("states the consequence — the pledge's own fund — before recording, then reloads", async () => {
    renderPage(<FinanceClaims />, { path: "/finance/claims" });
    fireEvent.click(await screen.findByText("Confirm"));
    const dialog = await screen.findByRole("alertdialog", { name: "Confirm this claim?" });
    expect(FinanceApi.partner).toHaveBeenCalledWith("u1");
    expect(dialog.textContent).toContain("Records KES 2,500.00 to Building and counts it toward “Building Fund”.");
    expect(FinanceApi.confirmClaim).not.toHaveBeenCalled();
    vi.mocked(FinanceApi.claims).mockResolvedValue([]);
    await act(async () => {
      fireEvent.click(within(dialog).getByText("Confirm KES 2,500.00"));
    });
    expect(FinanceApi.confirmClaim).toHaveBeenCalledWith("c1");
    await waitFor(() => expect(screen.getByText("Recorded KES 2,500.00 from Grace Wanjiru — receipt on its way")).toBeTruthy());
    expect(await screen.findByText("No claims waiting")).toBeTruthy();
    expect(FinanceApi.claims).toHaveBeenCalledTimes(2);
  });

  it("rejects with its own consequence", async () => {
    renderPage(<FinanceClaims />, { path: "/finance/claims" });
    fireEvent.click(await screen.findByText("Reject"));
    const dialog = await screen.findByRole("alertdialog", { name: "Reject this claim?" });
    expect(dialog.textContent).toContain("Rejects Grace Wanjiru’s claim of KES 2,500.00. Nothing is recorded");
    await act(async () => {
      fireEvent.click(within(dialog).getByText("Reject claim"));
    });
    expect(FinanceApi.rejectClaim).toHaveBeenCalledWith("c1");
  });

  it("lets a claim someone else decided drop out, and says so", async () => {
    vi.mocked(FinanceApi.confirmClaim).mockRejectedValue(apiError(422, "UNPROCESSABLE", "Claim already confirmed"));
    renderPage(<FinanceClaims />, { path: "/finance/claims" });
    fireEvent.click(await screen.findByText("Confirm"));
    const dialog = await screen.findByRole("alertdialog");
    vi.mocked(FinanceApi.claims).mockResolvedValue([]);
    await act(async () => {
      fireEvent.click(within(dialog).getByText("Confirm KES 2,500.00"));
    });
    expect(await screen.findByText("Claim already confirmed")).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(await screen.findByText("No claims waiting")).toBeTruthy();
  });

  it("explains what claims are when none are waiting", async () => {
    vi.mocked(FinanceApi.claims).mockResolvedValue([]);
    renderPage(<FinanceClaims />, { path: "/finance/claims" });
    expect(await screen.findByText("No claims waiting")).toBeTruthy();
    expect(screen.getByText(/I paid another way/, { selector: "div" })).toBeTruthy();
  });
});

const schedule = (over: Partial<AdminScheduleRow>): AdminScheduleRow => ({
  schedule_id: "s1",
  user_id: "u1",
  full_name: "Grace Wanjiru",
  phone_number: "+254700000001",
  fund: "general",
  amount_minor: 100_100,
  currency: "KES",
  frequency: "weekly",
  method: "mpesa",
  status: "active",
  next_run_at: "2026-10-01T06:00:00Z",
  last_run_at: "2026-09-24T06:00:00Z",
  consecutive_failures: 0,
  last_error: null,
  last_failed_at: null,
  paused_at: null,
  created_at: "2026-01-01T00:00:00Z",
  needs_attention: false,
  ...over,
});

describe("Recurring gifts (/finance/recurring)", () => {
  it("shows the ≈ per month run-rate per currency, from active schedules only", async () => {
    vi.mocked(FinanceApi.schedules).mockResolvedValue([
      schedule({}),
      schedule({ schedule_id: "s2", user_id: "u2", full_name: "Peter Otieno" }),
      schedule({ schedule_id: "s3", user_id: "u3", full_name: "Mary Achieng", frequency: "monthly", amount_minor: 900_000, status: "paused", needs_attention: true, consecutive_failures: 3, last_error: "Insufficient funds" }),
      schedule({ schedule_id: "s4", user_id: "u4", full_name: "John Doe", currency: "USD", frequency: "monthly", amount_minor: 2_500 }),
    ]);
    renderPage(<FinanceRecurring />, { path: "/finance/recurring" });
    await screen.findByText("Mary Achieng");
    const groups = [...document.querySelectorAll("[data-currency]")];
    expect(groups.map((g) => g.getAttribute("data-currency"))).toEqual(["KES", "USD"]);
    // 2 × 1,001.00 weekly × 52 ÷ 12 = 8,675.33 — the paused monthly gift is not income.
    expect(groups[0]?.textContent).toContain("KES 8,675.33");
    expect(groups[0]?.textContent).toContain("3 schedules · 2 active");
    expect(groups[1]?.textContent).toContain("USD 25.00");
    expect(screen.getByText("3 in a row")).toBeTruthy();
    expect(screen.getByText("Insufficient funds")).toBeTruthy();
  });

  it("asks the server for the needs-attention list from the deep link, and opens a partner", async () => {
    vi.mocked(FinanceApi.schedules).mockResolvedValue([schedule({ status: "paused", needs_attention: true })]);
    renderPage(<FinanceRecurring />, { path: "/finance/recurring?attention=true" });
    await screen.findByText("Grace Wanjiru");
    expect(FinanceApi.schedules).toHaveBeenCalledWith({ status: null, attention: true, limit: 200 });
    fireEvent.click(screen.getByText("Grace Wanjiru"));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/finance/partners?member=u1"));
  });
});
