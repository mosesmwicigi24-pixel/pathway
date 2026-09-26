// @vitest-environment happy-dom
// Transactions → Record a gift (POST /admin/finance/gifts): the office's form.
// Channel-specific references, M-Pesa codes upper-cased as typed, the 366-day
// window, a pledge deciding the fund, DUPLICATE_RECEIPT naming the existing
// entry, the OR receipt on success, and one idempotency key per recording.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import type { BooksGiftInput, BooksGiftResult, FinanceFundRow, FinanceGiver } from "../src/api/finance";

const mocks = vi.hoisted(() => ({
  recordGift: vi.fn(),
  needs: vi.fn(),
  transactions: vi.fn(),
  searchGivers: vi.fn(),
}));
vi.mock("../src/api/finance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api/finance")>();
  return {
    ...actual,
    searchGivers: mocks.searchGivers,
    FinanceApi: { ...actual.FinanceApi, recordGift: mocks.recordGift, needs: mocks.needs, transactions: mocks.transactions },
  };
});

import { RecordGiftDrawer } from "../src/components/finance/a/RecordGiftDrawer";

const NOW = new Date("2026-09-26T06:00:00Z"); // 09:00 EAT

function fund(code: string, name: string): FinanceFundRow {
  return { code, name, name_sw: null, is_active: true, description: null, sort: 0, balances: [], income: [], expenses_ytd: [], transfers_in_ytd: [], transfers_out_ytd: [], last_activity_at: null };
}
const FUNDS = [fund("tithe", "Tithe"), fund("building", "Building Fund")];

const GRACE: FinanceGiver = {
  user_id: "u1",
  full_name: "Grace Wanjiru",
  phone: "+254700000001",
  email: null,
  congregation_name: "Nuru Place Nairobi",
  open_pledges: [
    { pledge_id: "p1", title: "Building pledge", currency: "KES", shape: "monthly", amount_minor: 500_000, target_minor: null, pays_to: { code: "building", name: "Building Fund" } },
    { pledge_id: "p2", title: "Missions (USD)", currency: "USD", shape: "total", amount_minor: null, target_minor: 100_000, pays_to: { code: "missions", name: "Missions" } },
  ],
};

function result(over: Partial<BooksGiftResult> = {}): BooksGiftResult {
  return {
    transaction_id: "tx-1",
    status: "succeeded",
    provider: "manual",
    source: "admin",
    receipt_code: "OR-2026-00042",
    amount_minor: 150_000,
    currency: "KES",
    fund: { code: "tithe", name: "Tithe" },
    channel: "onhand",
    reference: null,
    received_on: "2026-09-26",
    created_at: "2026-09-26T09:00:00Z",
    settled_at: "2026-09-26T09:00:00Z",
    user_id: null,
    member_name: null,
    giver_name: "Peter Otieno",
    giver_phone: null,
    anonymous: false,
    pledge: null,
    need: null,
    note: null,
    recorded_by: "admin-1",
    recorded_by_name: "Treasurer",
    reversed_at: null,
    reversed_by: null,
    reversed_by_name: null,
    reversal_reason: null,
    ledger: [],
    idempotency_key: "k",
    reused: false,
    ...over,
  };
}

function apiError(status: number, code: string, message: string, details?: Record<string, unknown>): AxiosError {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
  return new AxiosError("request failed", undefined, config, undefined, { status, statusText: "", headers: {}, config, data: { error: { code, message, request_id: "r", ...(details ? { details } : {}) } } });
}

afterEach(cleanup);
beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.needs.mockResolvedValue({ data: [], next_cursor: null, totals: [] });
  mocks.transactions.mockResolvedValue({ data: [], next_cursor: null, totals: [] });
});

function open(extra: { onView?: (id: string) => void; onRecorded?: () => void } = {}): void {
  render(<RecordGiftDrawer funds={FUNDS} onClose={() => undefined} onRecorded={extra.onRecorded ?? (() => undefined)} onView={extra.onView ?? (() => undefined)} now={NOW} />);
}

/** A complete walk-in gift, apart from the reference. */
function fillWalkin(channel: "onhand" | "bank" | "cheque" | "mpesa" | "other" = "onhand"): void {
  fireEvent.click(screen.getByRole("radio", { name: "Walk-in" }));
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Peter Otieno" } });
  fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "1500" } });
  fireEvent.change(screen.getByLabelText(/^Channel/), { target: { value: channel } });
  fireEvent.change(screen.getByLabelText(/^Fund/), { target: { value: "tithe" } });
}
const submit = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Record (gift|KES|USD)/ }));
  });
};

describe("Record a gift", () => {
  it("requires the reference for a bank payment, not for cash", async () => {
    mocks.recordGift.mockResolvedValue(result());
    open();
    fillWalkin("bank");
    await submit();
    expect(screen.getByText("Enter the bank reference — it is required for a bank payment.")).toBeTruthy();
    expect(mocks.recordGift).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/^Channel/), { target: { value: "onhand" } });
    await submit();
    expect(mocks.recordGift).toHaveBeenCalledTimes(1);
    const body = mocks.recordGift.mock.calls[0]?.[0] as BooksGiftInput;
    expect(body).toMatchObject({ giver_name: "Peter Otieno", amount_minor: 150_000, currency: "KES", channel: "onhand", fund: "tithe", received_on: "2026-09-26", reference: null });
  });

  it("upper-cases an M-Pesa code as it is typed and sends it that way", async () => {
    mocks.recordGift.mockResolvedValue(result({ channel: "mpesa", reference: "SJK4H7T2QX" }));
    open();
    fillWalkin("mpesa");
    const code = screen.getByLabelText(/^M-Pesa code/) as HTMLInputElement;
    fireEvent.change(code, { target: { value: "sjk4h7 t2qx" } });
    expect(code.value).toBe("SJK4H7T2QX");
    await submit();
    expect((mocks.recordGift.mock.calls[0]?.[0] as BooksGiftInput).reference).toBe("SJK4H7T2QX");
  });

  it("keeps the received date inside the books' window (EAT)", async () => {
    open();
    fillWalkin();
    const date = screen.getByLabelText(/^Received on/) as HTMLInputElement;
    expect(date.value).toBe("2026-09-26");
    expect(date.max).toBe("2026-09-26");
    expect(date.min).toBe("2025-09-25");
    fireEvent.change(date, { target: { value: "2025-09-01" } });
    await submit();
    expect(screen.getByText(/The books take dates from 25 Sep 2025 onwards/)).toBeTruthy();
    expect(mocks.recordGift).not.toHaveBeenCalled();
  });

  it("lets a pledge decide the fund — the fund picker disappears", async () => {
    mocks.searchGivers.mockResolvedValue([GRACE]);
    open();
    fireEvent.change(screen.getByPlaceholderText("Search members…"), { target: { value: "gra" } });
    fireEvent.click(await screen.findByRole("option", { name: /Grace Wanjiru/ }));
    expect(screen.getByLabelText(/^Fund/)).toBeTruthy();
    const pledge = screen.getByLabelText(/^Pledge/) as HTMLSelectElement;
    // Only the KES pledge is offered while the currency is KES; the USD one is named in the hint.
    expect(Array.from(pledge.options).map((o) => o.value)).toEqual(["", "p1"]);
    expect(screen.getByText(/1 open pledge in USD/)).toBeTruthy();
    fireEvent.change(pledge, { target: { value: "p1" } });
    expect(screen.queryByLabelText(/^Fund/)).toBeNull();
    expect(screen.queryByLabelText(/^Department need/)).toBeNull();
    expect(screen.getByTestId("fund-decided").textContent).toBe("Booked to Building Fund (the pledge's fund).");
  });

  it("warns when the member has an M-Pesa payment still processing", async () => {
    mocks.searchGivers.mockResolvedValue([GRACE]);
    mocks.transactions.mockResolvedValue({
      data: [
        {
          transaction_id: "tx-p",
          user_id: "u1",
          full_name: "Grace Wanjiru",
          display_name: "Grace Wanjiru",
          status: "processing",
          channel: "mpesa",
          amount_minor: 100_000,
          currency: "KES",
          created_at: "2026-09-26T05:10:00Z",
        },
      ],
      next_cursor: null,
      totals: [],
    });
    open();
    fireEvent.change(screen.getByPlaceholderText("Search members…"), { target: { value: "gra" } });
    fireEvent.click(await screen.findByRole("option", { name: /Grace Wanjiru/ }));
    expect(await screen.findByText("An M-Pesa payment of KES 1,000.00 from Grace is still processing since 08:10 — it may be this same payment.")).toBeTruthy();
    expect(mocks.transactions).toHaveBeenCalledWith(expect.objectContaining({ q: "+254700000001", from: "2026-09-24", to: "2026-09-26" }));
  });

  it("names the existing entry on DUPLICATE_RECEIPT", async () => {
    mocks.recordGift.mockRejectedValue(apiError(409, "DUPLICATE_RECEIPT", "SJK4H7T2QX is already on OR-2026-00007.", { transaction_id: "tx-9" }));
    const onView = vi.fn();
    open({ onView });
    fillWalkin("mpesa");
    fireEvent.change(screen.getByLabelText(/^M-Pesa code/), { target: { value: "SJK4H7T2QX" } });
    await submit();
    expect(screen.getByText(/already in the books/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open the existing entry" }));
    expect(onView).toHaveBeenCalledWith("tx-9");
  });

  it("shows the OR number; Record another keeps channel and date and uses a new key", async () => {
    mocks.recordGift.mockResolvedValueOnce(result()).mockResolvedValueOnce(result({ transaction_id: "tx-2", receipt_code: "OR-2026-00043" }));
    const onRecorded = vi.fn();
    open({ onRecorded });
    fillWalkin("cheque");
    fireEvent.change(screen.getByLabelText(/^Cheque number/), { target: { value: "004512" } });
    fireEvent.change(screen.getByLabelText(/^Received on/), { target: { value: "2026-09-20" } });
    await submit();
    expect(screen.getByTestId("receipt-number").textContent).toBe("OR-2026-00042");
    expect(onRecorded).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Record another" }));
    expect((screen.getByLabelText(/^Channel/) as HTMLSelectElement).value).toBe("cheque");
    expect((screen.getByLabelText(/^Received on/) as HTMLInputElement).value).toBe("2026-09-20");
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/^Cheque number/) as HTMLInputElement).value).toBe("");

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Mary Njeri" } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText(/^Cheque number/), { target: { value: "004513" } });
    fireEvent.change(screen.getByLabelText(/^Fund/), { target: { value: "building" } });
    await submit();
    await waitFor(() => expect(screen.getByTestId("receipt-number").textContent).toBe("OR-2026-00043"));
    const first = mocks.recordGift.mock.calls[0]?.[0] as BooksGiftInput;
    const second = mocks.recordGift.mock.calls[1]?.[0] as BooksGiftInput;
    expect(first.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.idempotency_key).not.toBe(first.idempotency_key);
    expect(second).toMatchObject({ giver_name: "Mary Njeri", amount_minor: 20_000, channel: "cheque", reference: "004513", fund: "building", received_on: "2026-09-20" });
  });

  it("a retry after a failure reuses the same key (a replay, never a second gift)", async () => {
    mocks.recordGift.mockRejectedValueOnce(new AxiosError("timeout", "ECONNABORTED")).mockResolvedValueOnce(result({ reused: true }));
    open();
    fillWalkin();
    await submit();
    expect(screen.getByText(/took too long/)).toBeTruthy();
    await submit();
    const [a, b] = mocks.recordGift.mock.calls.map((c) => (c[0] as BooksGiftInput).idempotency_key);
    expect(b).toBe(a);
    expect(screen.getByText(/had already been recorded/)).toBeTruthy();
  });
});
