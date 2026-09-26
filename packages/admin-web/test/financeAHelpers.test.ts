// Finance pages set A — the pure rules (components/finance/a/helpers.ts): the
// sentences a treasurer reads before an action, the guards the forms apply, and
// the codes turned into words. docs/FINANCE_ERP.md is the spec.
import { describe, it, expect } from "vitest";
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import type { FinanceTransactionRow } from "../src/api/finance";
import {
  ALERT_COPY,
  EXCEPTION_COPY,
  EXCEPTION_ORDER,
  accountLabel,
  addDaysIso,
  alertLink,
  article,
  auditDetails,
  auditEntityHref,
  backdateBounds,
  buildGiftInput,
  codeError,
  compactMinor,
  dayError,
  fmtPct,
  fundDecisionText,
  fundInUse,
  fundInUseText,
  giftErrorView,
  giftFundDecision,
  giftReversalConsequence,
  giftReversible,
  humanizeAction,
  journalReversalConsequence,
  journalReversibility,
  lengthError,
  negativeBalance,
  normalizeReferenceInput,
  pctChange,
  pendingForMember,
  pendingNoticeText,
  referenceError,
  referenceRule,
  reorderPlan,
  suggestCode,
  trialBalanceState,
  validateGift,
  type GiftForm,
} from "../src/components/finance/a/helpers";

function axiosError(status: number, data?: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
  return new AxiosError("request failed", undefined, config, undefined, { status, statusText: "", headers: {}, config, data });
}
const apiError = (status: number, code: string, message = "", details?: Record<string, unknown>): AxiosError =>
  axiosError(status, { error: { code, message, request_id: "r1", ...(details ? { details } : {}) } });

// 2026-09-26 09:00 EAT
const NOW = new Date("2026-09-26T06:00:00Z");

function row(over: Partial<FinanceTransactionRow>): FinanceTransactionRow {
  return {
    transaction_id: "t1",
    user_id: "u1",
    full_name: "Grace Wanjiru",
    member_phone: "+254700000001",
    display_name: "Grace Wanjiru",
    amount_minor: 100_000,
    currency: "KES",
    status: "processing",
    fund: "tithe",
    fund_name: "Tithe",
    account_name: null,
    method: "mpesa",
    channel: "mpesa",
    source: "app",
    provider: "mpesa",
    provider_ref: null,
    receipt_code: null,
    giver_name: null,
    giver_phone: null,
    pledge_id: null,
    pledge_title: null,
    need_id: null,
    need_title: null,
    office_channel: null,
    office_reference: null,
    recorded_by: null,
    recorded_by_name: null,
    reversed_at: null,
    reversed_by: null,
    reversed_by_name: null,
    reversal_reason: null,
    created_at: "2026-09-26T07:42:00Z",
    settled_at: null,
    ...over,
  };
}

describe("comparisons and figures", () => {
  it("pctChange is a whole percent, null when there is nothing to compare with", () => {
    expect(pctChange(120, 100)).toBe(20);
    expect(pctChange(80, 100)).toBe(-20);
    expect(pctChange(1, 3)).toBe(-67);
    expect(pctChange(500, 0)).toBeNull();
    expect(pctChange(0, 0)).toBeNull();
  });
  it("fmtPct signs the change with a true minus", () => {
    expect(fmtPct(12)).toBe("+12%");
    expect(fmtPct(-8)).toBe("−8%");
    expect(fmtPct(0)).toBe("0%");
    expect(fmtPct(null)).toBe("—");
  });
  it("compactMinor labels a chart axis from minor units", () => {
    expect(compactMinor(125_000_000)).toBe("1.3M");
    expect(compactMinor(100_000_000)).toBe("1M");
    expect(compactMinor(4_500_000)).toBe("45k");
    expect(compactMinor(100_000_000_000)).toBe("1B");
    expect(compactMinor(12_345)).toBe("123");
    expect(compactMinor(-4_500_000)).toBe("−45k");
  });
});

describe("dates", () => {
  it("addDaysIso crosses months, leap days and years exactly", () => {
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysIso("2024-03-01", -1)).toBe("2024-02-29");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("2026-09-26", -366)).toBe("2025-09-25");
  });
  it("backdateBounds counts from today in Nairobi, not the browser's zone", () => {
    // 21:30 UTC on the 26th is already 00:30 on the 27th in Nairobi.
    expect(backdateBounds(366, new Date("2026-09-26T21:30:00Z"))).toEqual({ min: "2025-09-26", max: "2026-09-27" });
  });
  it("dayError names what is wrong with a picked day", () => {
    const b = { min: "2025-09-25", max: "2026-09-26" };
    expect(dayError("", b, "day the money was received")).toBe("Pick the day the money was received.");
    expect(dayError("2026-02-30", b, "date")).toMatch(/not a date/);
    expect(dayError("2026-09-27", b, "date")).toBe("The date can't be in the future.");
    expect(dayError("2025-09-24", b, "date")).toMatch(/25 Sep 2025 onwards/);
    expect(dayError("2025-09-25", b, "date")).toBeNull();
    expect(dayError("2026-09-26", b, "date")).toBeNull();
  });
});

describe("references (POST /gifts)", () => {
  it("is required for M-Pesa, cheque and bank only", () => {
    expect(referenceRule("mpesa")).toMatchObject({ label: "M-Pesa code", required: true });
    expect(referenceRule("cheque")).toMatchObject({ label: "Cheque number", required: true });
    expect(referenceRule("bank")).toMatchObject({ label: "Bank reference", required: true });
    expect(referenceRule("onhand").required).toBe(false);
    expect(referenceRule("other").required).toBe(false);
    expect(referenceError("bank", "")).toMatch(/required for a bank payment/);
    expect(referenceError("cheque", "  ")).toMatch(/required for a cheque/);
    expect(referenceError("mpesa", "")).toMatch(/required for an M-Pesa payment/);
    expect(referenceError("onhand", "")).toBeNull();
    expect(referenceError("other", "")).toBeNull();
  });
  it("upper-cases an M-Pesa code as it is typed and checks its shape", () => {
    expect(normalizeReferenceInput("mpesa", " sjk4h7 t2qx ")).toBe("SJK4H7T2QX");
    expect(normalizeReferenceInput("bank", " ft26 ab ")).toBe(" ft26 ab ");
    expect(referenceError("mpesa", "SJK4H7T2QX")).toBeNull();
    expect(referenceError("mpesa", "ABC12")).toMatch(/8–12 letters and digits/);
    expect(referenceError("mpesa", "SJK4-H7T2Q")).toMatch(/8–12 letters and digits/);
    expect(referenceError("bank", "x".repeat(81))).toBe("At most 80 characters.");
  });
});

const BASE: GiftForm = {
  mode: "walkin",
  memberId: null,
  walkinName: "Peter Otieno",
  walkinPhone: "",
  amountMinor: 150_000,
  currency: "KES",
  channel: "onhand",
  reference: "",
  receivedOn: "2026-09-26",
  pledgeId: "",
  needId: "",
  fund: "tithe",
  note: "",
};
const BOUNDS = { min: "2025-09-25", max: "2026-09-26" };

describe("validateGift", () => {
  it("accepts a complete walk-in gift", () => {
    expect(validateGift(BASE, { bounds: BOUNDS, fundDecided: false })).toEqual({});
  });
  it("names every missing or bad field", () => {
    const e = validateGift(
      { ...BASE, walkinName: "A", walkinPhone: "123", amountMinor: null, channel: "cheque", receivedOn: "2026-09-27", fund: "", note: "x".repeat(61) },
      { bounds: BOUNDS, fundDecided: false },
    );
    expect(Object.keys(e).sort()).toEqual(["amount", "fund", "note", "receivedOn", "reference", "walkinName", "walkinPhone"]);
  });
  it("wants a member in member mode, and no fund when a pledge or need decides it", () => {
    expect(validateGift({ ...BASE, mode: "member" }, { bounds: BOUNDS, fundDecided: false }).giver).toMatch(/Choose the member/);
    expect(validateGift({ ...BASE, fund: "" }, { bounds: BOUNDS, fundDecided: true }).fund).toBeUndefined();
  });
});

describe("fund decision + request body", () => {
  const fundName = (c: string): string | null => ({ tithe: "Tithe", building: "Building Fund" })[c] ?? null;
  it("a pledge decides first, then a need whose department has a fund, else the picker", () => {
    expect(giftFundDecision({ pays_to: { code: "building", name: "Building Fund" } }, { fund_code: "missions" }, fundName)).toEqual({ by: "pledge", code: "building", name: "Building Fund" });
    expect(giftFundDecision(null, { fund_code: "tithe" }, fundName)).toEqual({ by: "need", code: "tithe", name: "Tithe" });
    expect(giftFundDecision(null, { fund_code: null }, fundName)).toEqual({ by: null, code: null, name: null });
    expect(fundDecisionText({ by: "pledge", code: "building", name: "Building Fund" })).toBe("Booked to Building Fund (the pledge's fund).");
    expect(fundDecisionText({ by: "need", code: "tithe", name: "Tithe" })).toBe("Booked to Tithe (the department's fund).");
    expect(fundDecisionText({ by: null, code: null, name: null })).toBeNull();
  });
  it("sends exactly one giver mode, the decided fund and a clean reference", () => {
    const member = buildGiftInput(
      { ...BASE, mode: "member", memberId: "u1", pledgeId: "p1", needId: "n1", channel: "mpesa", reference: "sjk4h7t2qx", fund: "tithe", note: "  " },
      "key-1",
      { by: "pledge", code: "building", name: "Building Fund" },
    );
    expect(member).toEqual({
      idempotency_key: "key-1",
      amount_minor: 150_000,
      currency: "KES",
      channel: "mpesa",
      received_on: "2026-09-26",
      fund: "building",
      reference: "SJK4H7T2QX",
      note: null,
      user_id: "u1",
      pledge_id: "p1",
    });
    const walkin = buildGiftInput({ ...BASE, walkinPhone: " +254711 ", needId: "n1" }, "key-2", { by: null, code: null, name: null });
    expect(walkin).toMatchObject({ giver_name: "Peter Otieno", giver_phone: "+254711", fund: "tithe", need_id: "n1", reference: null });
    expect(walkin.user_id).toBeUndefined();
    const anon = buildGiftInput({ ...BASE, mode: "anonymous" }, "key-3", { by: null, code: null, name: null });
    expect(anon.anonymous).toBe(true);
    expect(anon.giver_name).toBeUndefined();
  });
});

describe("giftErrorView — the books' named codes as sentences", () => {
  it("links the entry a duplicate M-Pesa code already belongs to", () => {
    const v = giftErrorView(apiError(409, "DUPLICATE_RECEIPT", "That code is on OR-2026-00007", { transaction_id: "tx-9" }));
    expect(v.duplicateTransactionId).toBe("tx-9");
    expect(v.field).toBe("reference");
    expect(v.message).toMatch(/already in the books/);
  });
  it("turns each 422 into a plain sentence", () => {
    expect(giftErrorView(apiError(422, "INVALID_DATE")).message).toBe("The received date must be today or within the last 366 days.");
    expect(giftErrorView(apiError(422, "INVALID_REFERENCE")).message).toMatch(/not an M-Pesa code/);
    expect(giftErrorView(apiError(422, "CURRENCY_MISMATCH")).message).toMatch(/same currency as the pledge or need/);
    expect(giftErrorView(apiError(422, "UNPROCESSABLE", "That pledge is not open.")).message).toBe("That pledge is not open.");
    expect(giftErrorView(apiError(422, "UNPROCESSABLE")).message).toMatch(/check the member, the fund/);
    expect(giftErrorView(new Error("boom")).message).toBe("The gift was not recorded — try again.");
  });
});

describe("a member's payment still in flight", () => {
  it("keeps only this member's processing / awaiting rows from the last 48 hours, newest first", () => {
    const rows = [
      row({ transaction_id: "a", created_at: "2026-09-26T05:00:00Z" }),
      row({ transaction_id: "b", created_at: "2026-09-26T05:30:00Z", status: "requires_action" }),
      row({ transaction_id: "c", status: "succeeded" }),
      row({ transaction_id: "d", user_id: "someone-else" }),
      row({ transaction_id: "e", created_at: "2026-09-23T05:00:00Z" }),
    ];
    expect(pendingForMember(rows, "u1", NOW).map((r) => r.transaction_id)).toEqual(["b", "a"]);
  });
  it("picks a / an by sound", () => {
    expect(article("M-Pesa")).toBe("an");
    expect(article("Airtel Money")).toBe("an");
    expect(article("Card")).toBe("a");
    expect(article("PayPal")).toBe("a");
  });
  it("says what may be the same payment, in Nairobi time", () => {
    expect(pendingNoticeText(row({}), NOW)).toBe("An M-Pesa payment of KES 1,000.00 from Grace is still processing since 10:42 — it may be this same payment.");
    expect(pendingNoticeText(row({ status: "requires_action", created_at: "2026-09-25T07:42:00Z", channel: "card" }), NOW)).toBe(
      "A Card payment of KES 1,000.00 from Grace is waiting for them to confirm since 25 Sep 2026, 10:42 — it may be this same payment.",
    );
  });
});

describe("reversals — the consequence first", () => {
  it("only office gifts and confirmed claims that succeeded can be reversed here", () => {
    expect(giftReversible({ provider: "manual", status: "succeeded" })).toBe(true);
    expect(giftReversible({ provider: "mpesa", status: "succeeded" })).toBe(false);
    expect(giftReversible({ provider: "manual", status: "refunded" })).toBe(false);
    expect(giftReversible({ provider: "manual", status: "succeeded", reversed_at: "2026-09-20T09:00:00Z" })).toBe(false);
  });
  it("states the fund, the statement and the instalment", () => {
    const pledged = giftReversalConsequence({ ...row({ status: "succeeded" }), pledge_title: "Building pledge", receipt_code: "OR-2026-00042" });
    expect(pledged).toContain("Posts KES 1,000.00 back out of Tithe; the gift leaves Grace Wanjiru's statement and re-opens their instalment on “Building pledge”.");
    expect(pledged).toContain("OR-2026-00042 stays on the reversed entry");
    const walkin = giftReversalConsequence({ ...row({ user_id: null, full_name: null, display_name: "Peter" }), receipt_code: null });
    expect(walkin).toContain("It was not on any member's statement.");
  });
  it("journals: transfers and opening balances only, once", () => {
    expect(journalReversibility({ kind: "transfer", reversed_by_journal_id: null })).toEqual({ ok: true, reason: null });
    expect(journalReversibility({ kind: "opening", reversed_by_journal_id: "j2" }).reason).toBe("Already reversed.");
    expect(journalReversibility({ kind: "expense", reversed_by_journal_id: null }).reason).toMatch(/voiding it/);
    expect(journalReversibility({ kind: "reversal", reversed_by_journal_id: null }).reason).toMatch(/never reversed/);
  });
  it("describes what reversing a transfer or an opening balance moves", () => {
    const legs = (debit: string, credit: string) => [
      { entry_id: "1", account: debit, side: "debit" as const, amount_minor: 500_000, currency: "KES", created_at: "2026-09-01T09:00:00Z" },
      { entry_id: "2", account: credit, side: "credit" as const, amount_minor: 500_000, currency: "KES", created_at: "2026-09-01T09:00:00Z" },
    ];
    const label = (a: string): string => accountLabel(a, (c) => ({ tithe: "Tithe", missions: "Missions" })[c] ?? null);
    expect(journalReversalConsequence({ kind: "transfer", legs: legs("fund:tithe", "fund:missions"), totals: [{ currency: "KES", amount_minor: 500_000 }], occurred_on: "2026-09-01" }, label)).toMatch(
      /^Moves KES 5,000.00 back from Missions to Tithe, dated 1 Sep 2026/,
    );
    expect(journalReversalConsequence({ kind: "opening", legs: legs("cash:bank", "fund:tithe"), totals: [{ currency: "KES", amount_minor: 500_000 }], occurred_on: "2026-09-01" }, label)).toMatch(
      /^Takes the KES 5,000.00 opening balance back out of Tithe and Bank/,
    );
  });
});

describe("funds", () => {
  it("suggests a permanent code from a name", () => {
    expect(suggestCode("Building Fund 2026")).toBe("building-fund-2026");
    expect(suggestCode("2026 Missions!")).toBe("missions");
    expect(suggestCode("Église Fund")).toBe("eglise-fund");
    const long = suggestCode("A very long fund name that keeps going and going past forty");
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith("-")).toBe(false);
  });
  it("checks the slug rule", () => {
    expect(codeError("tithe")).toBeNull();
    expect(codeError("building-2026")).toBeNull();
    expect(codeError("")).toBe("Enter a code.");
    expect(codeError("a")).toMatch(/2 to 40/);
    expect(codeError("Tithe")).toMatch(/Lowercase/);
    expect(codeError("1tithe")).toMatch(/starting with a letter/);
  });
  it("lengthError trims and names the field", () => {
    expect(lengthError("  ", { min: 3, max: 300 }, "a memo")).toBe("Enter a memo.");
    expect(lengthError("ab", { min: 3, max: 300 }, "a memo")).toBe("Memo needs at least 3 characters.");
    expect(lengthError("abc", { min: 3, max: 300 }, "a memo")).toBeNull();
    expect(lengthError("x".repeat(501), { max: 500 }, "a description")).toBe("At most 500 characters.");
  });
  it("reads NEGATIVE_BALANCE figures from a 422", () => {
    expect(negativeBalance(apiError(422, "UNPROCESSABLE", "", { reason: "NEGATIVE_BALANCE", balance_minor: 20_000, balance_after_minor: -30_000 }))).toEqual({ balance_minor: 20_000, balance_after_minor: -30_000 });
    expect(negativeBalance(apiError(422, "UNPROCESSABLE", "", { reason: "OTHER" }))).toBeNull();
    expect(negativeBalance(new Error("x"))).toBeNull();
  });
  it("reads FUND_IN_USE counts and says who still sends money", () => {
    const u = fundInUse(apiError(409, "FUND_IN_USE", "Still in use", { active_pledges: 12, active_schedules: 3, departments: 1, live_campaigns: 0 }));
    expect(u).toMatchObject({ active_pledges: 12, active_schedules: 3, departments: 1, live_campaigns: 0 });
    expect(fundInUseText("Building fund", u!)).toBe("12 active pledges, 3 recurring gifts and 1 department still send money to Building fund — their payments will fail while it is inactive.");
    expect(fundInUseText("Missions", { active_pledges: 1, active_schedules: 0, departments: 0, live_campaigns: 0, message: "" })).toBe(
      "1 active pledge still sends money to Missions — its payments will fail while it is inactive.",
    );
    expect(fundInUse(apiError(409, "CONFLICT"))).toBeNull();
  });
});

describe("words for codes", () => {
  it("accountLabel names cash accounts and funds", () => {
    const nameOf = (c: string): string | null => (c === "tithe" ? "Tithe" : null);
    expect(accountLabel("cash:mpesa")).toBe("M-Pesa");
    expect(accountLabel("cash:onhand")).toBe("Cash on hand");
    expect(accountLabel("cash:manual")).toBe("Manual / other");
    expect(accountLabel("fund:tithe", nameOf)).toBe("Tithe");
    expect(accountLabel("fund:unknown", nameOf)).toBe("unknown");
    expect(accountLabel("sales:media")).toBe("Media sales");
    expect(accountLabel("cash:")).toBe("All cash accounts");
    expect(accountLabel("fund:")).toBe("All funds");
  });
  it("alertLink follows only in-app paths; integrity always opens the exceptions", () => {
    expect(alertLink("pending_claims", "/finance/claims")).toBe("/finance/claims");
    expect(alertLink("pending_claims", "https://evil.example")).toBe(ALERT_COPY.pending_claims.fallbackLink);
    expect(alertLink("stale_processing", "//evil.example")).toBe("/finance/reconciliation?tab=exceptions");
    expect(alertLink("integrity_issues", "/finance/ledger")).toBe("/finance/reconciliation?tab=exceptions");
    expect(ALERT_COPY.expenses_awaiting_approval.title(1)).toBe("1 expense to approve");
    expect(ALERT_COPY.pending_claims.title(3)).toBe("3 claims waiting");
    expect(ALERT_COPY.failing_schedules.title(1)).toBe("1 recurring gift needs attention");
    expect(ALERT_COPY.failing_schedules.title(2)).toBe("2 recurring gifts need attention");
    expect(ALERT_COPY.integrity_issues.title(1)).toBe("1 issue in the books");
  });
  it("every reconciliation kind has an explanation and what to do", () => {
    expect([...EXCEPTION_ORDER].sort()).toEqual(Object.keys(EXCEPTION_COPY).sort());
    expect(EXCEPTION_ORDER).toHaveLength(7);
    for (const k of EXCEPTION_ORDER) {
      expect(EXCEPTION_COPY[k].explain.length, k).toBeGreaterThan(10);
      expect(EXCEPTION_COPY[k].todo.length, k).toBeGreaterThan(10);
    }
    expect(EXCEPTION_COPY.succeeded_without_ledger.todo).toMatch(/Do not record the gift again/);
    expect(EXCEPTION_COPY.duplicate_receipt.todo).toMatch(/reverse it/);
  });
  it("trialBalanceState", () => {
    expect(trialBalanceState({ data: [], balanced: true })).toBe("empty");
    expect(trialBalanceState({ data: [{}], balanced: true })).toBe("balanced");
    expect(trialBalanceState({ data: [{}], balanced: false })).toBe("unbalanced");
  });
  it("humanizeAction reads known actions and splits the rest", () => {
    expect(humanizeAction("finance.gift_recorded")).toBe("Recorded a gift");
    expect(humanizeAction("journal.transfer_posted")).toBe("Moved money between funds");
    expect(humanizeAction("pledge.claim_confirmed")).toBe("Pledge · claim confirmed");
    expect(humanizeAction("department.need_approved")).toBe("Department · need approved");
  });
  it("auditDetails picks money, receipt, the move and the reason — never ids", () => {
    expect(auditDetails({ amount_minor: 150_000, currency: "KES", receipt_code: "OR-2026-00042", reason: "Entered twice", transaction_id: "abc" })).toEqual([
      "KES 1,500.00",
      "Receipt OR-2026-00042",
      "“Entered twice”",
    ]);
    expect(auditDetails({ from_fund: "tithe", to_fund: "missions", memo: "Seed" })).toEqual(["tithe → missions", "memo: Seed"]);
    expect(auditDetails(null)).toEqual([]);
    expect(auditDetails({ a: 1, b: 2, c: 3, d: 4, e: 5 })).toHaveLength(4);
  });
  it("auditEntityHref links transactions and journals only", () => {
    expect(auditEntityHref("transactions", "t1")).toBe("/finance/transactions?tx=t1");
    expect(auditEntityHref("journals", "j1")).toBe("/finance/ledger?tab=journals&journal=j1");
    expect(auditEntityHref("funds", "tithe")).toBeNull();
    expect(auditEntityHref("transactions", null)).toBeNull();
  });
});

describe("reorderPlan — expense categories", () => {
  const cats = (sorts: number[]) => sorts.map((sort, i) => ({ category_id: `c${i}`, sort }));
  it("renumbers so a seeded all-0 list can move", () => {
    expect(reorderPlan(cats([0, 0, 0]), 2, -1)).toEqual([
      { category_id: "c0", sort: 10 },
      { category_id: "c2", sort: 20 },
      { category_id: "c1", sort: 30 },
    ]);
  });
  it("patches only what changes, and nothing out of range", () => {
    expect(reorderPlan(cats([10, 20, 30]), 0, 1)).toEqual([
      { category_id: "c1", sort: 10 },
      { category_id: "c0", sort: 20 },
    ]);
    expect(reorderPlan(cats([10, 20]), 0, -1)).toEqual([]);
    expect(reorderPlan(cats([10, 20]), 1, 1)).toEqual([]);
  });
});
