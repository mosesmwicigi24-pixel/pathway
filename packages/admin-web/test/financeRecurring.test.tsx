// @vitest-environment happy-dom
// Finance → Recurring gifts and Claims, the office's view (Giving Cycle 7):
// why a gift is paused (the member's own choice is not a failure), why it is
// failing in the member's words, our own outage flagged, the pledge a gift
// collects and what its next prompt asks — and, with finance:manage, pause /
// resume / cancel at the member's request with a required reason. A claim in
// another currency than its pledge can only be rejected.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { FinanceApi, type AdminScheduleRow, type PledgeClaimRow } from "../src/api/finance";
import { FinanceRecurring } from "../src/components/pages/finance/Recurring";
import { FinanceClaims } from "../src/components/pages/finance/Claims";
import { nairobiTomorrow, nextAskLabel, pauseReasonLabel } from "../src/components/finance/b/logic";
import { formatMinor } from "../src/components/finance/money";
import { ALL_FINANCE, renderPage } from "./financeBSetup";

vi.mock("../src/api/finance", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/api/finance")>();
  return {
    ...mod,
    FinanceApi: { ...mod.FinanceApi, schedules: vi.fn(), scheduleAction: vi.fn(), claims: vi.fn(), config: vi.fn(), partner: vi.fn(), collectionHealth: vi.fn() },
  };
});

afterEach(cleanup);

const api = FinanceApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

const row = (over: Partial<AdminScheduleRow>): AdminScheduleRow => ({
  schedule_id: "s-1",
  user_id: "u-1",
  full_name: "Amina Wanjiru",
  phone_number: "+254711222333",
  fund: "tithe",
  amount_minor: 500_000,
  currency: "KES",
  frequency: "monthly",
  method: "mpesa",
  status: "active",
  next_run_at: "2026-10-05T06:00:00.000Z",
  last_run_at: null,
  consecutive_failures: 0,
  last_error: null,
  last_failed_at: null,
  paused_at: null,
  created_at: "2026-09-01T06:00:00.000Z",
  needs_attention: false,
  ...over,
});

describe("the office's words for a recurring gift", () => {
  it("a pause reads as whose choice it was; only stopped-after-failures is the office's to chase", () => {
    expect(pauseReasonLabel({ status: "active", pause_reason: null })).toBeNull();
    expect(pauseReasonLabel({ status: "paused", pause_reason: "member", resume_on: null })).toBe("The member paused it");
    expect(pauseReasonLabel({ status: "paused", pause_reason: "member", resume_on: "2026-10-20" })).toMatch(/^The member paused it until .*20/);
    expect(pauseReasonLabel({ status: "paused", pause_reason: "pledge" })).toBe("Paused with its pledge");
    expect(pauseReasonLabel({ status: "paused", pause_reason: "failures" })).toBe("Stopped after failed prompts");
    expect(pauseReasonLabel({ status: "paused", pause_reason: null })).toBe("Stopped after failed prompts"); // older rows
  });

  it("the next prompt is named only when it differs from the gift", () => {
    expect(nextAskLabel({ status: "active", amount_minor: 500_000, currency: "KES", next_amount_minor: 500_000 })).toBeNull();
    expect(nextAskLabel({ status: "active", amount_minor: 500_000, currency: "KES", next_amount_minor: 300_000 })).toBe(`Next: ${formatMinor(300_000, "KES")} — the rest of the pledge`);
    expect(nextAskLabel({ status: "active", amount_minor: 500_000, currency: "KES", next_amount_minor: 0 })).toBe("Next: nothing — the pledge is already paid");
    expect(nextAskLabel({ status: "paused", amount_minor: 500_000, currency: "KES", next_amount_minor: 0 })).toBeNull();
  });

  it("tomorrow is Nairobi's tomorrow, even late at night UTC", () => {
    expect(nairobiTomorrow(new Date("2026-09-30T22:30:00Z"))).toBe("2026-10-02"); // 01:30 on 1 Oct in Nairobi
    expect(nairobiTomorrow(new Date("2026-09-30T12:00:00Z"))).toBe("2026-10-01");
  });
});

const HEALTH = {
  window_days: 30, prompts: 13, paid: 6, failed: 6, waiting: 1, success_rate: 0.5,
  by_reason: [
    { code: "unreachable", count: 3, reason: "We couldn't reach the phone.", member_answered: false },
    { code: "cancelled", count: 2, reason: "The M-Pesa prompt was cancelled.", member_answered: true },
  ],
  not_sent_by_us: 1,
  outage: { suspected: true, evidence: "8 of the last 10 M-Pesa prompts in the past hour never reached the phone.", resolved: 10, unreached: 8, unsent: 0 },
  month_end: "2026-09-30",
  forecast: [{ currency: "KES", gifts: 2, prompts: 3, scheduled_minor: 700_000, expected_minor: 600_000 }],
};

describe("Finance → Recurring gifts", () => {
  beforeEach(() => {
    api.schedules.mockReset();
    api.scheduleAction.mockReset();
    api.config.mockResolvedValue({ funds: [{ code: "tithe", name: "Tithe", is_active: true }], providers: [], step_up_required: false });
    api.collectionHealth.mockResolvedValue(HEALTH);
    api.schedules.mockResolvedValue([
      row({ schedule_id: "failing", full_name: "Failing Giver", consecutive_failures: 2, last_error: "raw provider text", last_failure: { reason: "There wasn't enough money in M-Pesa.", hint: "Top up." }, needs_attention: true }),
      row({ schedule_id: "ours", full_name: "Outage Giver", office_alert: "We couldn't send the last prompt (UPSTREAM). The giver has not been told; it tries again within the hour.", needs_attention: true }),
      row({ schedule_id: "mine", full_name: "Resting Giver", status: "paused", pause_reason: "member", resume_on: "2026-10-20", paused_at: "2026-09-20T06:00:00.000Z" }),
      row({ schedule_id: "pledged", full_name: "Pledge Giver", pledge: { pledge_id: "p-1", title: "Kenya trip" }, next_amount_minor: 300_000 }),
    ]);
  });

  it("says how collection is going: the outage in words, the success rate, why prompts failed, and the month's weighted forecast (Giving Cycle 9)", async () => {
    renderPage(<FinanceRecurring />, { path: "/finance/recurring" });
    expect(await screen.findByText("How collection is going")).toBeTruthy();
    expect(screen.getByText(/8 of the last 10 M-Pesa prompts/)).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText(/We couldn't reach the phone\./)).toBeTruthy();
    expect(screen.getByText("(never reached them)")).toBeTruthy();
    expect(screen.getByText("(their answer)")).toBeTruthy();
    expect(screen.getByText(/not sent by us today/)).toBeTruthy();
    expect(screen.getByText(/scheduled/)).toBeTruthy();
  });

  it("shows why: failure in words, our outage, whose pause, the pledge and its next ask", async () => {
    renderPage(<FinanceRecurring />, { path: "/finance/recurring" });
    await screen.findByText("Failing Giver");
    expect(screen.getByText("There wasn't enough money in M-Pesa.")).toBeTruthy();
    expect(screen.queryByText("raw provider text")).toBeNull();
    expect(screen.getByText(/The giver has not been told/)).toBeTruthy();
    expect(screen.getByText(/The member paused it until/)).toBeTruthy();
    expect(screen.getByText("Collects “Kenya trip”")).toBeTruthy();
    expect(screen.getByText(`Next: ${formatMinor(300_000, "KES")} — the rest of the pledge`)).toBeTruthy();
  });

  it("with finance:manage the office pauses at the member's request — a reason is required, the date is optional", async () => {
    api.scheduleAction.mockResolvedValue(row({ status: "paused", pause_reason: "member" }));
    renderPage(<FinanceRecurring />, { path: "/finance/recurring", permissions: ALL_FINANCE });
    const name = await screen.findByText("Pledge Giver");
    const tr = name.closest("tr")!;
    fireEvent.click(within(tr).getByRole("button", { name: /Pause/ }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Pause gift" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true); // no reason yet
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Called: travelling in October" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Pause gift" }));
    await waitFor(() => expect(api.scheduleAction).toHaveBeenCalledWith("pledged", "pause", { note: "Called: travelling in October", resume_on: null }));
  });

  it("a gift paused with its pledge offers no Resume; without finance:manage there are no office actions at all", async () => {
    api.schedules.mockResolvedValue([row({ schedule_id: "withpledge", full_name: "Paused Pledger", status: "paused", pause_reason: "pledge" })]);
    renderPage(<FinanceRecurring />, { path: "/finance/recurring", permissions: ALL_FINANCE });
    const tr = (await screen.findByText("Paused Pledger")).closest("tr")!;
    expect(within(tr).queryByRole("button", { name: /Resume/ })).toBeNull();
    expect(within(tr).getByRole("button", { name: /Cancel/ })).toBeTruthy();
    cleanup();
    renderPage(<FinanceRecurring />, { path: "/finance/recurring", permissions: ["finance:view"] });
    const tr2 = (await screen.findByText("Paused Pledger")).closest("tr")!;
    expect(within(tr2).queryByRole("button")).toBeNull();
  });
});

describe("Finance → Claims", () => {
  beforeEach(() => {
    api.config.mockResolvedValue({ funds: [], providers: [], step_up_required: false });
  });
  it("a claim in another currency than its pledge can only be rejected", async () => {
    const claim = (over: Partial<PledgeClaimRow>): PledgeClaimRow => ({
      claim_id: "c-1", pledge_id: "p-1", user_id: "u-1", full_name: "Amina Wanjiru", amount_minor: "5000", currency: "KES",
      paid_on: "2026-09-18", note: null, status: "pending", created_at: "2026-09-19T06:00:00.000Z", pledge_title: "Kenya trip",
      pledge_currency: "KES", currency_mismatch: false, ...over,
    });
    api.claims.mockResolvedValue([claim({}), claim({ claim_id: "c-2", full_name: "Dollar Giver", currency: "USD", currency_mismatch: true })]);
    renderPage(<FinanceClaims />, { path: "/finance/claims", permissions: ALL_FINANCE });
    const usdRow = (await screen.findByText("Dollar Giver")).closest("tr")!;
    expect((within(usdRow).getByRole("button", { name: /Confirm/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(usdRow).getByText("Pledge is in KES")).toBeTruthy();
    const kesRow = screen.getByText("Amina Wanjiru").closest("tr")!;
    expect((within(kesRow).getByRole("button", { name: /Confirm/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});
