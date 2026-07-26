// M-Pesa Daraja adapter (real STK-push provider). Only the pure callback-parsing
// path is unit-tested here — initiate() makes live Safaricom calls and is never
// exercised in CI (no network/secrets, CLAUDE.md). Settlement still rides the
// existing webhook → processed_webhooks → ledger path (covered by financial.test).
import { describe, it, expect } from "vitest";
import { DarajaMpesaProvider, sanitizeAccountReference } from "../src/modules/financial/providers.js";

const provider = new DarajaMpesaProvider({
  consumerKey: "k",
  consumerSecret: "s",
  passkey: "p",
  shortcode: "4043755",
  env: "sandbox",
  txType: "CustomerPayBillOnline",
  callbackUrl: "https://example.org/v1/webhooks/mobilemoney/mpesa",
});

const callback = (resultCode: number, checkoutId = "ws_CO_123", receipt?: string) =>
  JSON.stringify({
    Body: {
      stkCallback: {
        MerchantRequestID: "m-1",
        CheckoutRequestID: checkoutId,
        ResultCode: resultCode,
        ResultDesc: resultCode === 0 ? "The service request is processed successfully." : "Cancelled",
        ...(resultCode === 0
          ? {
              CallbackMetadata: {
                Item: [
                  { Name: "Amount", Value: 200 },
                  ...(receipt ? [{ Name: "MpesaReceiptNumber", Value: receipt }] : []),
                  { Name: "PhoneNumber", Value: 254711222333 },
                ],
              },
            }
          : {}),
      },
    },
  });

describe("DarajaMpesaProvider.verifyCallback", () => {
  it("maps ResultCode 0 → succeeded, keyed by CheckoutRequestID", () => {
    const cb = provider.verifyCallback(callback(0, "ws_CO_ABC"));
    expect(cb).toEqual({ event_id: "ws_CO_ABC", ref: "ws_CO_ABC", status: "succeeded" });
  });

  it("maps a non-zero ResultCode → failed", () => {
    expect(provider.verifyCallback(callback(1032)).status).toBe("failed");
  });

  it("accepts a Buffer body (raw webhook)", () => {
    const cb = provider.verifyCallback(Buffer.from(callback(0, "ws_CO_BUF")));
    expect(cb.ref).toBe("ws_CO_BUF");
  });

  it("rejects a malformed callback", () => {
    expect(() => provider.verifyCallback("{ not json")).toThrow();
    expect(() => provider.verifyCallback(JSON.stringify({ Body: {} }))).toThrow();
  });

  it("extracts MpesaReceiptNumber from the success metadata", () => {
    const cb = provider.verifyCallback(callback(0, "ws_CO_RCPT", "UG3J29U3OL"));
    expect(cb.status).toBe("succeeded");
    expect(cb.receipt).toBe("UG3J29U3OL");
  });

  it("leaves receipt undefined when the success callback carries no receipt", () => {
    expect(provider.verifyCallback(callback(0, "ws_CO_NORCPT")).receipt).toBeUndefined();
  });

  it("never surfaces a receipt on a failed callback", () => {
    expect(provider.verifyCallback(callback(1032, "ws_CO_FAIL")).receipt).toBeUndefined();
  });
});

// "Named giving" (custom sheet, optional): the member's gift name rides the
// STK push AccountReference, sanitized to Daraja's alphanumeric+space, 12-char
// field. Pure function, unit-tested directly (initiate() itself makes live
// Safaricom calls and is never exercised in CI).
describe("sanitizeAccountReference (named giving → M-Pesa AccountReference)", () => {
  it("passes clean alphanumeric+space names through untouched", () => {
    expect(sanitizeAccountReference("Tithe")).toBe("Tithe");
    expect(sanitizeAccountReference("Building Fund")).toBe("Building Fun"); // 12-char cap
  });

  it("strips emoji and symbols, keeping only alphanumerics and spaces", () => {
    expect(sanitizeAccountReference("Thanksgiving 🎉!!")).toBe("Thanksgiving"); // exactly 12 chars, no truncation
    expect(sanitizeAccountReference("Mom's 60th ❤️")).toBe("Moms 60th");
    expect(sanitizeAccountReference("R&D @ Church#1")).toBe("RD Church1");
  });

  it("truncates to Daraja's 12-char AccountReference limit", () => {
    const long = "Thanksgiving Offering For The Whole Family";
    const out = sanitizeAccountReference(long);
    expect(out).toBe(long.slice(0, 12));
    expect(out!.length).toBe(12);
  });

  it("collapses internal whitespace before truncating", () => {
    expect(sanitizeAccountReference("A   B    C")).toBe("A B C");
  });

  it("returns undefined for empty, whitespace-only, absent, or symbols-only input", () => {
    expect(sanitizeAccountReference(undefined)).toBeUndefined();
    expect(sanitizeAccountReference(null)).toBeUndefined();
    expect(sanitizeAccountReference("")).toBeUndefined();
    expect(sanitizeAccountReference("   ")).toBeUndefined();
    expect(sanitizeAccountReference("🎉🎉🎉")).toBeUndefined();
  });
});
