// Mobile-money providers (Contract Matrix B7). M-Pesa / Airtel Money ride the
// SAME flow as Stripe: server initiates an STK-style push, the provider calls
// back a signed webhook, settlement + the balanced ledger happen ONLY on that
// verified callback (§5.6). Abstracted so the financial logic is testable with
// no network/secrets (CLAUDE.md); a real deployment binds Daraja / Airtel APIs
// here by env-named credentials.
import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError, ProviderNotConfiguredError } from "../../http/errors.js";
import type { Env } from "../../config/env.js";

export type MobileMoneyKey = "mpesa" | "airtel";

export interface MobileMoneyCharge {
  amountMinor: number;
  currency: string;
  phoneNumber: string; // E.164 — where the STK push lands
  metadata: Record<string, string>;
}

export interface MobileMoneyCallback {
  event_id: string;
  ref: string; // the checkout reference we stored on the transaction
  status: "succeeded" | "failed";
  /** M-Pesa confirmation code from the customer's SMS (e.g. UG3J29U3OL), when the
   *  success callback carries it. Display-only; settlement still keys off `ref`. */
  receipt?: string | undefined;
  /** The provider's own result code and text (Daraja ResultCode / ResultDesc). */
  result_code?: string | undefined;
  result_desc?: string | undefined;
}

/** What the provider itself says happened to a prompt (Giving Cycle 1). */
export type MobileMoneyStatus =
  | { state: "succeeded" }
  | { state: "failed"; code: string; desc?: string | undefined }
  | { state: "pending" };

export interface MobileMoneyProvider {
  readonly key: MobileMoneyKey;
  /**
   * True when `verifyCallback` PROVES the callback came from the provider (an
   * HMAC over the body). False for Daraja: Safaricom signs nothing, so a
   * callback is only a hint that something happened, and the outcome is read
   * from the provider with `queryStatus` before any money moves (Cycle 1 —
   * anyone who knew a CheckoutRequestID could otherwise post "paid").
   */
  readonly signedCallbacks: boolean;
  /** Send the STK push; returns the provider checkout reference. */
  initiate(input: MobileMoneyCharge): Promise<{ ref: string }>;
  /** Verify the callback signature and parse it, or throw on tamper. */
  verifyCallback(rawBody: Buffer | string, signature: string): MobileMoneyCallback;
  /** Ask the provider what happened to a prompt. `pending` = no answer yet
   *  (still on the phone, or the provider could not say) — never a guess. */
  queryStatus(ref: string): Promise<MobileMoneyStatus>;
}

/**
 * Our word for why a mobile-money payment failed, from the provider's code —
 * the thing a member can act on ("you cancelled it" is not "your phone was
 * off") and the thing a schedule decides with: `retryable` failures happened
 * to the member (they never had a chance to answer), the others were the
 * member's answer or their account's, and a machine must not keep asking.
 */
export type GiftFailureCode =
  | "cancelled"
  | "unreachable"
  | "expired"
  | "insufficient_funds"
  | "wrong_pin"
  | "busy"
  | "limit_exceeded"
  | "declined"
  | "system"
  | "no_answer"
  | "no_phone";

export interface GiftFailure {
  code: GiftFailureCode;
  retryable: boolean;
}

const MPESA_RESULT: Record<string, GiftFailure> = {
  "1032": { code: "cancelled", retryable: false },
  "1037": { code: "unreachable", retryable: true },
  "1019": { code: "expired", retryable: true },
  "1": { code: "insufficient_funds", retryable: false },
  "2001": { code: "wrong_pin", retryable: false },
  "1001": { code: "busy", retryable: true },
  "1025": { code: "system", retryable: true },
  "9999": { code: "system", retryable: true },
  "26": { code: "system", retryable: true },
  "17": { code: "system", retryable: true },
};

/** Provider result code → our failure word. Unknown codes are a plain
 *  "declined" — not retried, because we do not know it is safe to. */
export function mobileMoneyFailure(providerCode: string | number | undefined | null): GiftFailure {
  const key = providerCode === undefined || providerCode === null ? "" : String(providerCode).trim();
  return MPESA_RESULT[key] ?? { code: "declined", retryable: false };
}

/**
 * Deterministic HMAC-verified fake. Tests sign callback bodies with the same
 * shared secret the provider holds — the verification path is the real one.
 */
export class FakeMobileMoneyProvider implements MobileMoneyProvider {
  readonly signedCallbacks = true;
  readonly initiated: MobileMoneyCharge[] = [];
  /** What `queryStatus` answers per ref (tests set it; default pending). */
  readonly outcomes = new Map<string, MobileMoneyStatus>();
  /** Every ref `queryStatus` was asked about, in order. */
  readonly queried: string[] = [];
  constructor(
    readonly key: MobileMoneyKey,
    private readonly secret = "test-mm-secret",
    /** Set by a dev server (never in tests): the counter restarts with the
     *  process, and a ref an earlier run already stored made every new
     *  prompt a 500 — a per-run prefix keeps refs unique across restarts. */
    private readonly runPrefix = "",
  ) {}

  async initiate(input: MobileMoneyCharge): Promise<{ ref: string }> {
    this.initiated.push(input);
    return { ref: `${this.key}_co_${this.runPrefix}${this.initiated.length}` };
  }

  async queryStatus(ref: string): Promise<MobileMoneyStatus> {
    this.queried.push(ref);
    return this.outcomes.get(ref) ?? { state: "pending" };
  }

  sign(rawBody: string): string {
    return createHmac("sha256", this.secret).update(rawBody).digest("hex");
  }

  verifyCallback(rawBody: Buffer | string, signature: string): MobileMoneyCallback {
    const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    const expected = this.sign(body);
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(/^[0-9a-f]+$/i.test(signature) ? signature : "00", "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ApiError("VALIDATION_FAILED", `Invalid ${this.key} callback signature`);
    }
    const parsed = JSON.parse(body) as Partial<MobileMoneyCallback>;
    if (!parsed.event_id || !parsed.ref || !parsed.status) {
      throw new ApiError("VALIDATION_FAILED", "Malformed mobile-money callback");
    }
    return {
      event_id: parsed.event_id,
      ref: parsed.ref,
      status: parsed.status === "succeeded" ? "succeeded" : "failed",
      receipt: typeof parsed.receipt === "string" ? parsed.receipt : undefined,
      result_code: parsed.result_code === undefined ? undefined : String(parsed.result_code),
      result_desc: typeof parsed.result_desc === "string" ? parsed.result_desc : undefined,
    };
  }
}

/**
 * M-Pesa AccountReference sanitizer ("named giving"): Daraja's AccountReference
 * is alphanumeric + spaces only and capped at 12 chars — it's what shows up on
 * the church's M-Pesa statement, so a member-entered gift name (which may carry
 * emoji/punctuation) must be cleaned before it rides the STK push. Collapses
 * whitespace, strips everything else, then truncates. Empty after cleaning (or
 * absent) → undefined, so callers fall back to their own default reference.
 */
export function sanitizeAccountReference(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 12) : undefined;
}

/** E.164 / local → Daraja MSISDN (2547XXXXXXXX, no plus). */
export function toMsisdn(phone: string): string {
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("0")) d = `254${d.slice(1)}`;
  else if (d.length === 9 && /^[17]/.test(d)) d = `254${d}`; // 7XX… and the 01XX range without its 0
  return d;
}

function yyyymmddhhmmss(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  );
}

export interface DarajaConfig {
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  shortcode: string;
  env: "sandbox" | "production";
  txType: "CustomerPayBillOnline" | "CustomerBuyGoodsOnline";
  callbackUrl: string;
}

/**
 * Real M-Pesa Daraja adapter (Lipa na M-Pesa Online). `initiate` sends the STK
 * push; the member confirms with their PIN on the handset. Daraja then POSTs an
 * unsigned `stkCallback` to our CallBackURL — settlement happens only on that
 * verified callback (§5.6). Authenticity rests on URL secrecy + Safaricom IP
 * allowlisting (Daraja does not HMAC-sign), so `verifyCallback` parses the
 * Daraja shape; idempotency is the unique CheckoutRequestID via processed_webhooks.
 */
export class DarajaMpesaProvider implements MobileMoneyProvider {
  readonly key = "mpesa" as const;
  readonly signedCallbacks = false;
  private token?: { value: string; expiresAt: number };
  private readonly base: string;
  constructor(
    private readonly cfg: DarajaConfig,
    /** Injected in tests to play Safaricom; the real `fetch` otherwise. */
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = cfg.env === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
  }

  private password(timestamp: string): string {
    return Buffer.from(`${this.cfg.shortcode}${this.cfg.passkey}${timestamp}`).toString("base64");
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const basic = Buffer.from(`${this.cfg.consumerKey}:${this.cfg.consumerSecret}`).toString("base64");
    const json = (await this.fetchJson(`${this.base}/oauth/v1/generate?grant_type=client_credentials`, {
      method: "GET",
      headers: { authorization: `Basic ${basic}` },
    })) as { access_token?: string; expires_in?: string };
    if (!json.access_token) throw new ApiError("UPSTREAM_UNAVAILABLE", "M-Pesa authorization failed");
    this.token = { value: json.access_token, expiresAt: Date.now() + Number(json.expires_in ?? 3000) * 1000 };
    return this.token.value;
  }

  async initiate(input: MobileMoneyCharge): Promise<{ ref: string }> {
    if (input.currency.toUpperCase() !== "KES") {
      throw new ApiError("VALIDATION_FAILED", "M-Pesa settles in KES only");
    }
    const token = await this.accessToken();
    const timestamp = yyyymmddhhmmss(new Date());
    const password = this.password(timestamp);
    const amount = Math.max(1, Math.round(input.amountMinor / 100)); // Daraja takes whole KES
    const account =
      sanitizeAccountReference(input.metadata.reference) ??
      sanitizeAccountReference(input.metadata.fund) ??
      "NuruGiving";
    // Why a push was refused decides whose problem it is (Giving Cycle 1): a
    // network error, a 5xx or a rate limit is Safaricom being unavailable —
    // OURS to retry, never a strike against the giver — while a 400 about the
    // number or the amount is the gift's own problem, which the giver can fix.
    let res: Response;
    try {
      res = await this.fetchWithTimeout(`${this.base}/mpesa/stkpush/v1/processrequest`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
        BusinessShortCode: this.cfg.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: this.cfg.txType,
        Amount: amount,
        PartyA: toMsisdn(input.phoneNumber),
        PartyB: this.cfg.shortcode,
        PhoneNumber: toMsisdn(input.phoneNumber),
        CallBackURL: this.cfg.callbackUrl,
        AccountReference: account,
        TransactionDesc: "Giving",
        }),
      });
    } catch {
      throw new ApiError("UPSTREAM_UNAVAILABLE", "M-Pesa is unavailable right now");
    }
    let json: { ResponseCode?: string; CheckoutRequestID?: string; errorMessage?: string; errorCode?: string } = {};
    try {
      json = (await res.json()) as typeof json;
    } catch {
      /* no body — judged by the status below */
    }
    if (res.ok && json.ResponseCode === "0" && json.CheckoutRequestID) return { ref: json.CheckoutRequestID };
    const message = (json.errorMessage ?? "").toString();
    if (res.status >= 500 || res.status === 429 || res.status === 401 || res.status === 403 || (res.ok && !json.ResponseCode)) {
      throw new ApiError("UPSTREAM_UNAVAILABLE", "M-Pesa is unavailable right now");
    }
    if (/phone|party ?a|msisdn/i.test(message)) {
      throw new ApiError("PHONE_REQUIRED", "M-Pesa couldn't send a prompt to that number. Check it is an M-Pesa line.");
    }
    throw new ApiError("UNPROCESSABLE", message ? `M-Pesa refused the prompt: ${message.slice(0, 120)}` : "M-Pesa refused the prompt.");
  }

  /**
   * STK Push Query: Safaricom's own answer about one prompt. A response that
   * carries a ResultCode is final (0 = paid, anything else = not paid, with
   * why); an error response without one ("the transaction is being
   * processed", a rate limit, an expired token) means Safaricom cannot say
   * yet — `pending`, asked again later, never guessed.
   */
  async queryStatus(ref: string): Promise<MobileMoneyStatus> {
    let token: string;
    try {
      token = await this.accessToken();
    } catch {
      return { state: "pending" };
    }
    const timestamp = yyyymmddhhmmss(new Date());
    let res: Response;
    try {
      res = await this.fetchWithTimeout(`${this.base}/mpesa/stkpushquery/v1/query`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          BusinessShortCode: this.cfg.shortcode,
          Password: this.password(timestamp),
          Timestamp: timestamp,
          CheckoutRequestID: ref,
        }),
      });
    } catch {
      return { state: "pending" };
    }
    let json: { ResultCode?: unknown; ResultDesc?: unknown } = {};
    try {
      json = (await res.json()) as typeof json;
    } catch {
      return { state: "pending" };
    }
    if (json.ResultCode === undefined || json.ResultCode === null || String(json.ResultCode).trim() === "") {
      return { state: "pending" };
    }
    const code = String(json.ResultCode).trim();
    if (code === "0") return { state: "succeeded" };
    return { state: "failed", code, desc: typeof json.ResultDesc === "string" ? json.ResultDesc : undefined };
  }

  /** Parse Daraja's stkCallback. No signature to verify (Daraja sends none),
   *  so the result is a hint: the service confirms it with `queryStatus`. */
  verifyCallback(rawBody: Buffer | string): MobileMoneyCallback {
    const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    let parsed: {
      Body?: {
        stkCallback?: {
          CheckoutRequestID?: string;
          ResultCode?: number;
          ResultDesc?: string;
          CallbackMetadata?: { Item?: Array<{ Name?: string; Value?: unknown }> };
        };
      };
    };
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new ApiError("VALIDATION_FAILED", "Malformed M-Pesa callback");
    }
    const cb = parsed.Body?.stkCallback;
    if (!cb?.CheckoutRequestID || cb.ResultCode === undefined) {
      throw new ApiError("VALIDATION_FAILED", "Malformed M-Pesa callback");
    }
    const succeeded = Number(cb.ResultCode) === 0;
    // On success the metadata carries the MpesaReceiptNumber (the code in the
    // member's SMS). Failures/cancellations have no receipt.
    let receipt: string | undefined;
    if (succeeded) {
      const item = cb.CallbackMetadata?.Item?.find((i) => i?.Name === "MpesaReceiptNumber");
      if (typeof item?.Value === "string" && item.Value) receipt = item.Value;
    }
    return {
      event_id: cb.CheckoutRequestID, // unique per push → idempotency key
      ref: cb.CheckoutRequestID,
      status: succeeded ? "succeeded" : "failed",
      receipt,
      result_code: String(cb.ResultCode),
      result_desc: typeof cb.ResultDesc === "string" ? cb.ResultDesc.slice(0, 200) : undefined,
    };
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchJson(url: string, init: RequestInit): Promise<unknown> {
    try {
      const res = await this.fetchWithTimeout(url, init);
      if (!res.ok) throw new ApiError("UPSTREAM_UNAVAILABLE", "M-Pesa is unavailable right now");
      return await res.json();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError("UPSTREAM_UNAVAILABLE", "M-Pesa is unavailable right now");
    }
  }
}

class NotConfiguredProvider implements MobileMoneyProvider {
  readonly signedCallbacks = true;
  /** Marker for the methods endpoint: this rail cannot take money here. */
  readonly notConfigured = true;
  constructor(readonly key: MobileMoneyKey) {}
  initiate(): Promise<{ ref: string }> {
    throw new ProviderNotConfiguredError(`${this.key} payments are not configured`);
  }
  verifyCallback(): MobileMoneyCallback {
    throw new ProviderNotConfiguredError(`${this.key} payments are not configured`);
  }
  queryStatus(): Promise<MobileMoneyStatus> {
    throw new ProviderNotConfiguredError(`${this.key} payments are not configured`);
  }
}

/** True when this provider can actually take money on this server. */
export function providerIsLive(p: MobileMoneyProvider): boolean {
  return !(p as { notConfigured?: boolean }).notConfigured;
}

export type MobileMoneyProviders = Record<MobileMoneyKey, MobileMoneyProvider>;

/**
 * Env-named secrets only (§5.10); unconfigured providers degrade to clear 503s.
 *
 * The HMAC fakes exist for tests and local development. In production they are
 * NEVER built (Giving Cycle 1): a stray `AIRTEL_CALLBACK_SECRET` used to switch
 * on an "Airtel" that accepted gifts and prompted no phone at all, leaving each
 * one "processing" for ever. Production has Daraja or nothing.
 */
export function buildMobileMoneyProviders(env: Env): MobileMoneyProviders {
  const fakesAllowed = env.NODE_ENV !== "production";
  const darajaReady =
    env.MPESA_CONSUMER_KEY && env.MPESA_CONSUMER_SECRET && env.MPESA_PASSKEY && env.MPESA_SHORTCODE && env.MPESA_CALLBACK_URL;
  return {
    mpesa: darajaReady
      ? new DarajaMpesaProvider({
          consumerKey: env.MPESA_CONSUMER_KEY!,
          consumerSecret: env.MPESA_CONSUMER_SECRET!,
          passkey: env.MPESA_PASSKEY!,
          shortcode: env.MPESA_SHORTCODE!,
          env: env.MPESA_ENV,
          txType: env.MPESA_TX_TYPE,
          callbackUrl: env.MPESA_CALLBACK_URL!,
        })
      : fakesAllowed && env.MPESA_CALLBACK_SECRET
        ? new FakeMobileMoneyProvider("mpesa", env.MPESA_CALLBACK_SECRET, `${Date.now().toString(36)}_`)
        : new NotConfiguredProvider("mpesa"),
    // There is no real Airtel Money integration yet — only the test fake.
    airtel: fakesAllowed && env.AIRTEL_CALLBACK_SECRET
      ? new FakeMobileMoneyProvider("airtel", env.AIRTEL_CALLBACK_SECRET, `${Date.now().toString(36)}_`)
      : new NotConfiguredProvider("airtel"),
  };
}
