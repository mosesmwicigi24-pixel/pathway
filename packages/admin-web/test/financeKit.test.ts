// Finance kit pure pieces (components/finance/kit.tsx) and the client's helpers
// (api/finance.ts): capabilities (docs/FINANCE_ERP.md §6), status chips, the
// giver name rule, params, errors — including a download's Blob error body.
import { describe, it, expect } from "vitest";
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import { financeCaps, statusChip, STATUS_CHIPS, giverDisplayName, channelLabel } from "../src/components/finance/kit";
import {
  cleanParams,
  financeErrorMessage,
  financeErrorCode,
  financeErrorDetails,
  parseBlobError,
  safeFilename,
  newIdempotencyKey,
} from "../src/api/finance";

function axiosError(status: number | null, data?: unknown, code?: string): AxiosError {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
  const response =
    status === null
      ? undefined
      : { status, statusText: "", headers: {}, config, data };
  return new AxiosError("request failed", code, config, undefined, response);
}

describe("financeCaps (§6)", () => {
  it("while /me loads: reads open, every write and export closed", () => {
    expect(financeCaps(null)).toEqual({ view: true, export: false, manage: false, approve: false, loading: true });
  });

  it("maps each capability to its own permission key", () => {
    expect(financeCaps([])).toEqual({ view: false, export: false, manage: false, approve: false, loading: false });
    expect(financeCaps(["finance:view"])).toEqual({ view: true, export: false, manage: false, approve: false, loading: false });
    expect(financeCaps(["finance:view", "finance:export"]).export).toBe(true);
    expect(financeCaps(["finance:view", "finance:manage"]).manage).toBe(true);
    expect(financeCaps(["finance:view", "finance:approve"]).approve).toBe(true);
    // another module's capability is not a finance capability
    expect(financeCaps(["departments:manage", "finance:view"]).manage).toBe(false);
  });
});

describe("status chips", () => {
  it("has a chip for every status the Finance pages show", () => {
    for (const s of ["succeeded", "processing", "failed", "refunded", "recorded", "approved", "void", "draft", "pending", "confirmed", "rejected", "on_track", "behind"]) {
      expect(STATUS_CHIPS[s], s).toBeDefined();
      expect(statusChip(s).label).toBe(STATUS_CHIPS[s]?.label);
    }
    expect(statusChip("on_track").label).toBe("On track");
  });

  it("keeps one colour per meaning", () => {
    const green = statusChip("succeeded").color;
    expect(statusChip("approved").color).toBe(green);
    expect(statusChip("confirmed").color).toBe(green);
    expect(statusChip("on_track").color).toBe(green);
    const amber = statusChip("processing").color;
    expect(statusChip("pending").color).toBe(amber);
    expect(statusChip("behind").color).toBe(amber);
    expect(statusChip("failed").color).toBe(statusChip("rejected").color);
  });

  it("names an unknown status readably instead of failing", () => {
    expect(statusChip("partially_paid").label).toBe("Partially paid");
    expect(statusChip(null).label).toBe("—");
    expect(statusChip("ON TRACK").label).toBe("On track");
  });
});

describe("giverDisplayName", () => {
  it("member name → giver name → giver phone → Anonymous", () => {
    expect(giverDisplayName({ member_name: "Grace W.", giver_name: "G", giver_phone: "+2547" })).toBe("Grace W.");
    expect(giverDisplayName({ full_name: "Peter K." })).toBe("Peter K.");
    expect(giverDisplayName({ member_name: null, giver_name: "Walk-in Mary", giver_phone: "+2547" })).toBe("Walk-in Mary");
    expect(giverDisplayName({ member_name: "  ", giver_name: null, giver_phone: "+254700000000" })).toBe("+254700000000");
    expect(giverDisplayName({ member_name: null, giver_name: null, giver_phone: null })).toBe("Anonymous");
  });

  it("labels channels", () => {
    expect(channelLabel("onhand")).toBe("Cash");
    expect(channelLabel("mpesa")).toBe("M-Pesa");
    expect(channelLabel("stripe")).toBe("Card");
    expect(channelLabel("barter")).toBe("Barter");
    expect(channelLabel(null)).toBe("—");
  });
});

describe("api/finance helpers", () => {
  it("cleanParams drops empty values but keeps real ones", () => {
    expect(cleanParams({ from: "2026-09-01", to: "", fund: null, q: "  grace ", status: undefined, pledged: "any", limit: 50, allow: false })).toEqual({
      from: "2026-09-01",
      q: "grace",
      pledged: "any",
      limit: 50,
      allow: false,
    });
    expect(cleanParams(undefined)).toEqual({});
  });

  it("cleanParams sends a list comma-joined, and drops an empty one", () => {
    expect(cleanParams({ status: ["recorded", " approved "], kind: [], q: " " })).toEqual({ status: "recorded,approved" });
  });

  it("financeErrorMessage prefers the server's own sentence", () => {
    const e = axiosError(409, { error: { code: "DUPLICATE_RECEIPT", message: "That M-Pesa code is already recorded.", request_id: "r1", details: { transaction_id: "t1" } } });
    expect(financeErrorMessage(e, "Could not record the gift.")).toBe("That M-Pesa code is already recorded.");
    expect(financeErrorCode(e)).toBe("DUPLICATE_RECEIPT");
    expect(financeErrorDetails(e)).toEqual({ transaction_id: "t1" });
  });

  it("financeErrorMessage covers the transport cases", () => {
    expect(financeErrorMessage(axiosError(401, { error: { message: "jwt expired" } }), "x")).toMatch(/session expired/);
    expect(financeErrorMessage(axiosError(403, undefined), "x")).toBe("You don't have permission to do that.");
    expect(financeErrorMessage(axiosError(403, { error: { code: "SAME_PERSON", message: "You recorded this expense." } }), "x")).toBe("You recorded this expense.");
    expect(financeErrorMessage(axiosError(null), "x")).toMatch(/Could not reach the server/);
    expect(financeErrorMessage(axiosError(null, undefined, "ECONNABORTED"), "x")).toMatch(/too long/);
    expect(financeErrorMessage(axiosError(502, "<html>bad gateway</html>"), "x")).toMatch(/\(502\)/);
    expect(financeErrorMessage(axiosError(422, {}), "Could not save.")).toBe("Could not save.");
    expect(financeErrorMessage(new Error("boom"), "Could not save.")).toBe("Could not save.");
    expect(financeErrorCode(new Error("boom"))).toBeNull();
  });

  it("parseBlobError turns a download's Blob error body back into JSON", async () => {
    const body = new Blob([JSON.stringify({ error: { code: "NOT_FOUND", message: "No giving in 2025 for this member." } })], { type: "application/json" });
    const e = await parseBlobError(axiosError(404, body));
    expect(financeErrorMessage(e, "Could not download the PDF.")).toBe("No giving in 2025 for this member.");
    expect(financeErrorCode(e)).toBe("NOT_FOUND");
  });

  it("parseBlobError drops a body that is not JSON (a proxy's HTML page)", async () => {
    const e = await parseBlobError(axiosError(504, new Blob(["<html>Gateway Timeout</html>"], { type: "text/html" })));
    expect(financeErrorMessage(e, "Could not export the CSV.")).toMatch(/\(504\)/);
    const empty = await parseBlobError(axiosError(403, new Blob([])));
    expect(financeErrorMessage(empty, "x")).toBe("You don't have permission to do that.");
  });

  it("makes file names safe and idempotency keys unique", () => {
    expect(safeFilename("Transactions Sep 2026.csv")).toBe("Transactions-Sep-2026.csv");
    expect(safeFilename("///")).toBe("download");
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});
