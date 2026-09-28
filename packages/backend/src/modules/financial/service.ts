// Financial service (spec §1.10 Flow C, §3.5, §5.6). Giving via Stripe (cards/
// wallets) and mobile money (M-Pesa/Airtel STK push, B7) behind the same
// intent → verified-webhook → balanced double-entry ledger flow, plus recurring
// giving schedules driven by a server-side scheduler. Money is always integer
// minor units + ISO currency — never floats — and never queued offline.
import type { Pool, PoolClient } from "pg";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { maybeOne, one, many, tx, audit, enqueueOutbox, type Queryable } from "../../db/db.js";
import { NotificationService } from "../notifications/service.js";
import { ApiError, ProviderNotConfiguredError } from "../../http/errors.js";
import type { RateLimitStore } from "../../http/rateLimit.js";
import type { PaymentGateway } from "./gateway.js";
import {
  sanitizeAccountReference, mobileMoneyFailure, providerIsLive, toMsisdn,
  type GiftFailure, type GiftFailureCode, type MobileMoneyKey, type MobileMoneyProviders, type MobileMoneyStatus,
} from "./providers.js";
import { paypalIsLive, type PayPalGateway } from "./paypal.js";
import { giftFailureCopy } from "./giftFailure.js";
import { renderStatementPdf, renderReceiptPdf } from "./statementPdf.js";
import { PLEDGE_PAYS_TO_CODE, PLEDGE_PAYS_TO_JOINS, methodLabel, giftMethodLabel } from "./constants.js";
// partners.ts imports FinancialService as a TYPE only, so this is not a cycle.
import { PartnersService, pledgeTitleFor, pledgeTitleSql } from "./partners.js";
import { allocateInstalments, nairobiDate, type LedgerPaymentInput } from "./partnerStatementMath.js";

/** What one cycle of a schedule that pays a pledge should do (Giving Cycle 5,
 *  FinancialService.pledgeCyclePlan). */
export type PledgeCyclePlan =
  | { action: "charge"; pledge_id: string; title: string; amount_minor: number; owed_minor: number }
  | { action: "skip"; pledge_id: string; title: string; covered_through: string | null }
  | { action: "fulfil"; pledge_id: string; title: string }
  | { action: "pause"; pledge_id: string; title: string }
  | { action: "stop"; pledge_id: string; title: string; reason: "pledge_fulfilled" | "pledge_ended" | "pledge_cancelled"; until_on: string | null };
// The Finance ERP read side (docs/FINANCE_ERP.md §4) owns the admin registers;
// the methods below that the older routes and tests call delegate to it, so
// there is one implementation of each.
import {
  TransactionsQuery, listFinanceTransactions, financeTransactionDetail, financeTrendByCurrency,
  FinanceAuditQuery, financeAuditPage, listLedgerPage,
  type TransactionsQueryInput, type FinanceAuditQueryInput, type FinanceTransactionRow, type CurrencyTotal, type TrendPoint,
} from "./finance-reports.js";

// Defined in constants.ts (so partners.ts can print it too); still exported
// from here for the callers and tests that always imported it from the service.
export { methodLabel };

const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

/** The provider's own words for a failure, kept for Reconciliation. */
function failureDetail(code: string | undefined, desc: string | undefined): string | null {
  const text = [code ? `ResultCode ${code}` : null, desc ?? null].filter(Boolean).join(": ");
  return text ? text.slice(0, 300) : null;
}

/** A Kenyan mobile-money number as E.164 (+2547XXXXXXXX / +2541XXXXXXXX), or
 *  null when it is not one — the only numbers an M-Pesa prompt can reach. */
export function kenyanMobileNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const msisdn = toMsisdn(raw);
  return /^254[17]\d{8}$/.test(msisdn) ? `+${msisdn}` : null;
}

/** Settled money per currency, shillings first — "KSh 3,500" or
 *  "KSh 3,500 + USD 20.00" — never one sum across currencies. Empty = KSh 0. */
function perCurrencyLabel(rows: Array<{ amount_minor: number; currency: string }>): string {
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.currency, (by.get(r.currency) ?? 0) + r.amount_minor);
  if (by.size === 0) return moneyWords(0, "KES");
  return [...by.entries()]
    .sort((a, b) => (a[0] === "KES" ? -1 : b[0] === "KES" ? 1 : a[0].localeCompare(b[0])))
    .map(([cur, minor]) => moneyWords(minor, cur))
    .join(" + ");
}

/** "KSh 1,000" / "USD 12.50" — for messages a member reads. */
const moneyWords = (minor: number, currency: string): string =>
  currency === "KES"
    ? `KSh ${(minor / 100).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`
    : `${currency} ${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface FinancialOptions {
  /**
   * Card giving from the member apps. Neither app can confirm a card payment
   * yet (no Stripe SDK), so a card intent nobody confirms sat "processing" for
   * ever. Off in production unless CARD_GIVING_ENABLED=true; on elsewhere so
   * tests and a future web checkout can use the Stripe path.
   */
  cardGiving?: boolean;
  /** The rate-limit store the website's donate button uses (Giving Cycle 6):
   *  a member's prompt to a number that is not their own spends the SAME
   *  per-number bucket, so the app is not a second way to ring a stranger. */
  promptLimiter?: RateLimitStore;
}

/** The outcome of one mobile-money prompt, as the provider confirmed it. */
type MobileMoneyOutcome =
  | { kind: "succeeded"; receipt?: string | undefined }
  | { kind: "failed"; failure: GiftFailure; detail: string | null };

export class FinancialService {
  constructor(
    private readonly pool: Pool,
    private readonly gateway: PaymentGateway,
    private readonly mobileMoney?: MobileMoneyProviders,
    private readonly paypal?: PayPalGateway,
    private readonly options: FinancialOptions = {},
  ) {}

  /**
   * Each giving rail (Giving Cycle 1): what it settles in, its limits, whether
   * a recurring gift can run on it, and whether it prompts a phone. M-Pesa
   * takes whole shillings from KSh 1 (its own floor — a small gift is still a
   * gift) up to its KSh 250,000 per-payment limit; PayPal settles in US
   * dollars (it cannot hold KES), so a PayPal amount IS dollars.
   */
  static readonly RAILS = {
    mpesa: { label: "M-Pesa", currency: "KES", min_minor: 100, max_minor: 25_000_000, whole_units: true, recurring: true, needs_phone: true },
    airtel: { label: "Airtel Money", currency: "KES", min_minor: 100, max_minor: 15_000_000, whole_units: true, recurring: true, needs_phone: true },
    paypal: { label: "PayPal", currency: "USD", min_minor: 100, max_minor: 1_000_000, whole_units: false, recurring: false, needs_phone: false },
    card: { label: "Card", currency: null, min_minor: 100, max_minor: 100_000_000, whole_units: false, recurring: false, needs_phone: false },
  } as const;

  /** Can this rail take a member's money on this server right now? */
  private railEnabled(method: keyof typeof FinancialService.RAILS): boolean {
    if (method === "mpesa" || method === "airtel") {
      const p = this.mobileMoney?.[method];
      return Boolean(p && providerIsLive(p));
    }
    if (method === "paypal") return Boolean(this.paypal && paypalIsLive(this.paypal));
    return this.options.cardGiving !== false && !(this.gateway as { notConfigured?: boolean }).notConfigured;
  }

  /**
   * GET /giving/methods — the rails a member can use here, with their currency
   * and limits, the number on file for a prompt, and which rail to start on.
   * The apps draw their method list from this instead of hard-coding one, so
   * a rail that cannot take money (Airtel, cards) is never offered as if it
   * could (Giving Cycle 1: both apps offered Airtel, and Android offered cards).
   */
  async listMethods(userId: string): Promise<Record<string, unknown>> {
    const u = await maybeOne<{ phone_number: string | null }>(
      this.pool, `SELECT phone_number FROM users WHERE user_id = $1`, [userId],
    );
    const order: Array<keyof typeof FinancialService.RAILS> = ["mpesa", "airtel", "paypal", "card"];
    const methods = order.map((key) => {
      const r = FinancialService.RAILS[key];
      const enabled = this.railEnabled(key);
      return {
        key,
        label: r.label,
        enabled,
        unavailable_reason: enabled ? null : key === "mpesa" ? "unavailable" : "coming_soon",
        currency: r.currency,
        min_minor: r.min_minor,
        max_minor: r.max_minor,
        whole_units: r.whole_units,
        recurring: r.recurring && enabled,
        needs_phone: r.needs_phone,
      };
    });
    return {
      methods,
      phone_on_file: kenyanMobileNumber(u?.phone_number),
      default_method: methods.find((m) => m.enabled)?.key ?? null,
    };
  }

  /**
   * The checks every gift passes BEFORE anyone's phone rings (Giving Cycle 1):
   * the rail is live, the currency is the rail's, the amount is inside its
   * limits (and whole shillings for M-Pesa, which cannot take cents — Daraja
   * rounded KSh 100.50 to 101 while we booked 100.50), and there is a real
   * Kenyan number to prompt. Returns that number (E.164) for mobile money.
   * A scheduled charge on a rail that is not live is OUR fault, never the
   * giver's, so it raises the configuration error the scheduler handles.
   */
  private async checkGift(
    userId: string,
    method: keyof typeof FinancialService.RAILS,
    amountMinor: number,
    currency: string,
    phoneHint: string | null | undefined,
    scheduled: boolean,
  ): Promise<{ phone: string | null }> {
    const rail = FinancialService.RAILS[method];
    if (!this.railEnabled(method)) {
      if (scheduled) throw new ProviderNotConfiguredError(`${method} payments are not configured`);
      throw new ApiError(
        "METHOD_UNAVAILABLE",
        method === "card"
          ? "Card giving is coming soon. Please give with M-Pesa for now."
          : method === "airtel"
            ? "Airtel Money giving is coming soon. Please give with M-Pesa for now."
            : `${rail.label} isn't available for giving right now.`,
        { method },
      );
    }
    if (rail.currency && currency !== rail.currency) {
      throw new ApiError(
        "METHOD_CURRENCY",
        rail.currency === "USD"
          ? "PayPal gifts are in US dollars. Enter the amount in dollars."
          : `${rail.label} gifts are in Kenyan shillings.`,
        { method, currency: rail.currency },
      );
    }
    if (amountMinor < rail.min_minor || amountMinor > rail.max_minor) {
      throw new ApiError(
        "AMOUNT_OUT_OF_RANGE",
        `${rail.label} gifts are from ${moneyWords(rail.min_minor, currency)} to ${moneyWords(rail.max_minor, currency)}.`,
        { method, min_minor: rail.min_minor, max_minor: rail.max_minor },
      );
    }
    if (rail.whole_units && amountMinor % 100 !== 0) {
      throw new ApiError("AMOUNT_OUT_OF_RANGE", `${rail.label} takes whole shillings — no cents.`, {
        method, step_minor: 100,
      });
    }
    if (!rail.needs_phone) return { phone: null };
    let phone = kenyanMobileNumber(phoneHint ?? null);
    if (!phone && phoneHint) {
      throw new ApiError("PHONE_REQUIRED", "That doesn't look like a Kenyan mobile number. Use 07XX XXX XXX or 01XX XXX XXX.", { method });
    }
    if (!phone) {
      const u = await maybeOne<{ phone_number: string | null }>(
        this.pool, `SELECT phone_number FROM users WHERE user_id = $1`, [userId],
      );
      phone = kenyanMobileNumber(u?.phone_number);
    }
    if (!phone) {
      throw new ApiError("PHONE_REQUIRED", "Add the M-Pesa number to prompt for this gift.", { method });
    }
    return { phone };
  }

  /** Lazily built so the money path carries no notification cost until a
   *  recurring gift actually fails (runDueSchedules is the only caller). */
  private notificationsSvc?: NotificationService;
  private get notifications(): NotificationService {
    this.notificationsSvc ??= new NotificationService(this.pool);
    return this.notificationsSvc;
  }

  static readonly GivingIntent = z.object({
    fund: z.string().min(2).max(40), // validated against the funds table (data-driven, B7)
    amount_minor: z.number().int().positive(),
    currency: z.string().length(3),
    method: z.enum(["card", "mpesa", "airtel", "paypal"]).default("card"),
    // nullish, not optional: Android's kotlinx Json sends "phone_number": null
    // for non-mobile-money methods. Mobile money; defaults to the profile phone.
    phone_number: z.string().min(7).max(32).nullish(),
    // A gift started from a pledge's "Pay now" (docs/PARTNERS_PROGRAMME.md §1):
    // attributed at the moment of giving, never re-derived. Must be the
    // caller's own active pledge.
    pledge_id: z.string().uuid().nullish(),
    /** A gift to a department need (docs/PARTNERS_PROGRAMME.md §4): must be approved and open. */
    need_id: z.string().uuid().nullish(),
    // "Named giving" (custom sheet, optional): a member-chosen label for the
    // gift — like an M-Pesa Paybill account name. Trimmed; empty → absent so
    // behavior is unchanged when the field isn't used. Sanitized separately
    // (providers.ts) before it rides the M-Pesa AccountReference.
    account_name: z
      .string()
      .trim()
      .max(60)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : undefined)),
    idempotency_key: z.string().min(8).max(255).optional(),
    /** "Cover the fee" (Giving Cycle 2): how much of amount_minor the member
     *  added to cover the M-Pesa fee. amount_minor is still what is charged
     *  and booked; this only lets the receipt say how much was the fee cover. */
    cover_fee_minor: z.number().int().min(0).nullish(),
  });

  private provider(key: MobileMoneyKey) {
    const p = this.mobileMoney?.[key];
    if (!p) throw new ProviderNotConfiguredError(`${key} payments are not configured`);
    return p;
  }

  private paypalGw(): PayPalGateway {
    if (!this.paypal) throw new ApiError("UPSTREAM_UNAVAILABLE", "PayPal is not configured");
    return this.paypal;
  }

  /** Create a payment intent (card via Stripe, or an STK push via mobile money)
   *  and the matching pending transaction (§1.10 C). Settlement only ever
   *  happens on the verified webhook/callback — never here. */
  async createGivingIntent(
    userId: string,
    input: z.infer<typeof FinancialService.GivingIntent>,
    scheduleId?: string,
    /** Scheduled charges only: the billing cycle this attempt belongs to, and
     *  the schedule's own number to prompt (null = the profile number).
     *  `watched`: the member is on the screen (a give-now first prompt). */
    scheduled?: { cycleAt: string; phone: string | null; watched?: boolean },
  ): Promise<Record<string, unknown>> {
    // Keys in the server's own namespaces are the server's (Giving Cycle 6): a
    // member's key shaped like a schedule cycle's could make the scheduler
    // think that cycle was already sent, and one shaped like a confirmed
    // claim's would block the office from confirming it.
    if (!scheduleId && input.idempotency_key && FinancialService.RESERVED_KEY.test(input.idempotency_key)) {
      throw new ApiError("VALIDATION_FAILED", "That request key is reserved. Send a fresh one.", { fields: [{ path: "idempotency_key", message: "reserved" }] });
    }
    // Which pledge, if any, this gift counts toward: the caller's explicit
    // choice, else the pledge bound to the schedule that is charging.
    const pledgeId = await this.resolvePledgeId(userId, input.pledge_id ?? null, scheduleId ?? null);
    const needId = await this.resolveNeedId(input.need_id ?? null);
    const key = input.idempotency_key ?? randomUUID();

    // Idempotent: the same client key returns the existing transaction — with
    // the fund and pledge it was BOOKED to, never what this replay asked for.
    const existing = await maybeOne<{ transaction_id: string; status: string; pledge_id: string | null; fund_code: string | null; fund_name: string | null; provider: string | null; provider_ref: string | null }>(
      this.pool,
      `SELECT t.transaction_id, t.status, t.pledge_id, f.code AS fund_code, f.name AS fund_name, t.provider, t.provider_ref
         FROM transactions t LEFT JOIN funds f ON f.fund_id = t.fund_id
        WHERE t.idempotency_key = $1 AND t.user_id = $2`,
      [key, userId],
    );
    if (existing) {
      return {
        transaction_id: existing.transaction_id,
        status: existing.status,
        // The same shape the first answer had (Giving Cycle 6): a resend
        // learns which prompt it is — null while it is still being sent.
        ...(existing.provider ? { provider: existing.provider, provider_ref: existing.provider_ref } : {}),
        idempotency_key: key,
        reused: true,
        ...(await this.intentAttribution(
          existing.fund_code && existing.fund_name ? { code: existing.fund_code, name: existing.fund_name } : null,
          existing.pledge_id,
        )),
      };
    }

    // Server-authoritative (§1.1): money follows the promise, not the fund chip
    // the client happened to show. A pledge-attributed gift lands in the
    // pledge's own fund (pledge → campaign → need → programme default); a gift
    // to a need lands in that department's fund. Only a plain gift keeps
    // `input.fund`. When both are sent, the pledge wins.
    const fundCode = pledgeId
      ? await this.pledgeFundCode(pledgeId)
      : (needId && (await this.needFundCode(needId))) || input.fund;
    const fund = await maybeOne<{ fund_id: string; code: string; name: string }>(
      this.pool,
      `SELECT fund_id, code, name FROM funds WHERE code = $1 AND is_active`,
      [fundCode],
    );
    if (!fund) throw new ApiError("VALIDATION_FAILED", "Unknown or inactive fund");
    const attribution = await this.intentAttribution({ code: fund.code, name: fund.name }, pledgeId);

    const currency = input.currency.toUpperCase();
    await this.assertSameCurrency(currency, pledgeId, needId);
    // Direct (non-HTTP) callers may omit the method; the zod default is card.
    const method = input.method ?? "card";
    const { phone } = await this.checkGift(
      userId, method, input.amount_minor, currency,
      input.phone_number ?? scheduled?.phone ?? null, Boolean(scheduleId),
    );
    const feeCover = input.cover_fee_minor && input.cover_fee_minor > 0 ? input.cover_fee_minor : null;
    if (feeCover !== null) {
      if (feeCover * 2 > input.amount_minor) {
        throw new ApiError("AMOUNT_OUT_OF_RANGE", "The fee cover can't be more than half of the gift.", { cover_fee_minor: feeCover });
      }
      if (FinancialService.RAILS[method].whole_units && feeCover % 100 !== 0) {
        throw new ApiError("AMOUNT_OUT_OF_RANGE", "The fee cover must be whole shillings.", { cover_fee_minor: feeCover });
      }
    }

    if ((input.method === "mpesa" || input.method === "airtel") && phone) {
      // ── The row first, then the phone (Giving Cycle 6) ─────────────────
      // A client that times out waiting on Safaricom and sends again (same
      // key), or two taps (fresh keys), used to run this twice AT ONCE: both
      // passed every check, both rang the phone, and with the same key the
      // second row failed to insert AFTER its prompt was out — approved, that
      // money arrived with no record at all. Now the member's row is claimed
      // under a per-member lock before anything rings: a concurrent request
      // waits, then finds it (same key → the same gift; another key →
      // GIFT_IN_PROGRESS).
      const claim = await tx(this.pool, async (c) => {
        await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`giving_intent:${userId}`]);
        const again = await maybeOne<{ transaction_id: string }>(
          c, `SELECT transaction_id FROM transactions WHERE idempotency_key = $1 AND user_id = $2`, [key, userId],
        );
        if (again) return { reused: again.transaction_id };
        await this.assertKeyFree(c, key);
        // One prompt at a time (Giving Cycle 1). A phone shows ONE M-Pesa
        // prompt; a second push while the first is still on screen fails as
        // "busy" (1001). If a prompt for this member from the last 90 seconds
        // is still unanswered — their own gift, or their recurring gift's
        // prompt on the phone right now — say so instead of sending one that
        // cannot succeed. Scheduled charges are staggered by the scheduler.
        if (!scheduleId) {
          const inflight = await maybeOne<{ transaction_id: string }>(
            c,
            `SELECT transaction_id FROM transactions
              WHERE user_id = $1 AND provider IN ('mpesa','airtel') AND status = 'processing'
                AND created_at > now() - interval '90 seconds'
              ORDER BY created_at DESC LIMIT 1`,
            [userId],
          );
          if (inflight) {
            throw new ApiError(
              "GIFT_IN_PROGRESS",
              "A prompt from a moment ago is still waiting on your phone. Approve it, or wait a minute and try again.",
              { transaction_id: inflight.transaction_id },
            );
          }
        }
        if (!scheduleId || scheduled?.watched) await this.limitPromptTo(c, userId, phone);
        const row = await one<{ transaction_id: string; status: string }>(
          c,
          `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, provider_ref, idempotency_key, schedule_id, account_name, pledge_id, need_id, schedule_cycle_at, fee_cover_minor)
           VALUES ($1, $2, $3, $4, 'processing', $5, NULL, $6, $7, $8, $9, $10, $11, $12)
           RETURNING transaction_id, status`,
          [userId, fund.fund_id, input.amount_minor, currency, input.method, key, scheduleId ?? null, input.account_name ?? null, pledgeId, needId, scheduled?.cycleAt ?? null, feeCover],
        );
        return { row };
      });
      if ("reused" in claim) {
        const same = await maybeOne<{ status: string; pledge_id: string | null; fund_code: string | null; fund_name: string | null; provider_ref: string | null }>(
          this.pool,
          `SELECT t.status, t.pledge_id, t.provider_ref, f.code AS fund_code, f.name AS fund_name
             FROM transactions t LEFT JOIN funds f ON f.fund_id = t.fund_id WHERE t.transaction_id = $1`,
          [claim.reused],
        );
        return {
          transaction_id: claim.reused,
          status: same?.status ?? "processing",
          provider: input.method,
          provider_ref: same?.provider_ref ?? null,
          idempotency_key: key,
          reused: true,
          ...(await this.intentAttribution(same?.fund_code && same.fund_name ? { code: same.fund_code, name: same.fund_name } : null, same?.pledge_id ?? null)),
        };
      }
      const txn = claim.row;
      let charge: { ref: string };
      try {
        charge = await this.provider(input.method).initiate({
          amountMinor: input.amount_minor,
          currency,
          phoneNumber: phone,
          metadata: {
            user_id: userId,
            fund: fund.code, // the fund actually booked — it is the M-Pesa statement's fallback reference
            // Named giving: only set `reference` when the member entered a name —
            // absent, the provider falls back to its existing fund/default ref.
            ...(input.account_name ? { reference: input.account_name } : {}),
          },
        });
      } catch (err) {
        // It never reached the phone, so no money can move: the claimed row
        // goes, as if it had never been asked.
        await this.pool.query(`DELETE FROM transactions WHERE transaction_id = $1 AND provider_ref IS NULL AND status = 'processing'`, [txn.transaction_id]);
        throw err;
      }
      await this.pool.query(`UPDATE transactions SET provider_ref = $2 WHERE transaction_id = $1`, [txn.transaction_id, charge.ref]);
      await audit(this.pool, userId, "giving.intent_created", "transactions", txn.transaction_id, {
        amount_minor: input.amount_minor,
        currency,
        fund: fund.code,
        method: input.method,
        account_name: input.account_name ?? null,
      });
      return {
        transaction_id: txn.transaction_id,
        provider: input.method,
        provider_ref: charge.ref, // STK push sent — the member confirms on their phone
        status: txn.status,
        idempotency_key: key,
        reused: false,
        ...attribution,
      };
    }

    // A key another gift already holds is a 409, never a 500 (Giving Cycle 6).
    await this.assertKeyFree(this.pool, key);

    if (input.method === "paypal") {
      // PayPal can't transact KES — gifts settle in USD (amount treated as USD).
      const order = await this.paypalGw().createOrder({ amountMinor: input.amount_minor, reference: `${userId}:${fund.code}` });
      const txn = await maybeOne<{ transaction_id: string; status: string }>(
        this.pool,
        `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, provider_ref, idempotency_key, schedule_id, account_name, pledge_id, need_id, fee_cover_minor)
         VALUES ($1, $2, $3, 'USD', 'processing', 'paypal', $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING transaction_id, status`,
        [userId, fund.fund_id, input.amount_minor, order.orderId, key, scheduleId ?? null, input.account_name ?? null, pledgeId, needId, feeCover],
      );
      // The same request raced itself (Giving Cycle 6): the first row stands and
      // this order is never captured — capture looks orders up by our rows.
      if (!txn) return this.keyReplay(userId, key);
      await audit(this.pool, userId, "giving.intent_created", "transactions", txn.transaction_id, {
        amount_minor: input.amount_minor, currency: "USD", fund: fund.code, method: "paypal", account_name: input.account_name ?? null,
      });
      return {
        transaction_id: txn.transaction_id,
        provider: "paypal",
        provider_ref: order.orderId,
        approve_url: order.approveUrl, // open this; member approves on PayPal, then capture
        status: txn.status,
        idempotency_key: key,
        reused: false,
        ...attribution,
      };
    }

    const intent = await this.gateway.createIntent({
      amountMinor: input.amount_minor,
      currency,
      metadata: { user_id: userId, fund: fund.code },
    });

    const txn = await maybeOne<{ transaction_id: string; status: string }>(
      this.pool,
      `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, stripe_payment_intent, idempotency_key, schedule_id, account_name, pledge_id, need_id, fee_cover_minor)
       VALUES ($1, $2, $3, $4, 'processing', $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING transaction_id, status`,
      [userId, fund.fund_id, input.amount_minor, currency, intent.id, key, scheduleId ?? null, input.account_name ?? null, pledgeId, needId, feeCover],
    );
    if (!txn) return this.keyReplay(userId, key);
    await audit(this.pool, userId, "giving.intent_created", "transactions", txn.transaction_id, {
      amount_minor: input.amount_minor,
      currency,
      fund: fund.code,
      method: "card",
      account_name: input.account_name ?? null,
    });
    return {
      transaction_id: txn.transaction_id,
      client_secret: intent.client_secret,
      status: txn.status,
      idempotency_key: key,
      reused: false,
      ...attribution,
    };
  }

  /** What the client shows after "Pay": the fund the gift was actually booked
   *  to (server-authoritative — may differ from the chip that was tapped) and
   *  the pledge it counts toward, under the same words its card carries. */
  private async intentAttribution(
    fund: { code: string; name: string } | null,
    pledgeId: string | null,
  ): Promise<{ fund: { code: string; name: string } | null; pledge: { pledge_id: string; title: string } | null }> {
    const title = pledgeId ? await pledgeTitleFor(this.pool, pledgeId) : null;
    return { fund, pledge: pledgeId && title ? { pledge_id: pledgeId, title } : null };
  }

  // ==========================================================================
  // Website giving (migration 202) — a gift from someone with no account.
  // ==========================================================================

  /**
   * What nuruplace.org may send. Deliberately narrower than `GivingIntent`:
   *
   *  - **Mobile money only.** A card or PayPal gift from an anonymous visitor
   *    needs a hosted checkout page and a return URL to land on, which is a
   *    separate piece of work with its own PCI surface. M-Pesa needs neither:
   *    the visitor types their number, their phone asks them to confirm, and
   *    nothing sensitive crosses our servers.
   *  - **Bounded amount.** An open endpoint that will initiate any figure is a
   *    typo away from a KES 5,000,000 prompt, and Safaricom caps a single STK
   *    push at 150,000 anyway. Rejecting here gives a readable error instead of
   *    a Daraja rejection the visitor cannot act on.
   *  - **Phone required, not optional.** For a member it defaults to the number
   *    on their profile. A stranger has no profile, and `transactions_
   *    attributable` (migration 202) will not accept a row with neither.
   */
  static readonly WebsiteGift = z.object({
    fund: z.string().min(2).max(40),
    amount_minor: z.number().int().positive(),
    currency: z.string().length(3).default("KES"),
    method: z.enum(["mpesa", "airtel"]).default("mpesa"),
    phone_number: z.string().min(7).max(32),
    giver_name: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : undefined)),
    giver_email: z
      .string()
      .trim()
      .max(255)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : undefined)),
    idempotency_key: z.string().min(8).max(255),
    /** The visitor's IP as the website saw it — our peer is always the website
     *  server, so without this every visitor shares one bucket. Advisory: the
     *  website could lie, which is why the per-phone bucket is the real guard. */
    client_ip: z.string().max(64).optional(),
  });

  /** M-Pesa's per-transaction ceiling. Anything above it is refused by Safaricom. */
  static readonly WEBSITE_MAX_MINOR = 150_000_00;
  /** Below this a "gift" is somebody testing whether the endpoint rings phones. */
  static readonly WEBSITE_MIN_MINOR = 10_00;

  /**
   * Create a memberless giving intent from the church website.
   *
   * Same shape as `createGivingIntent` and deliberately the same settlement
   * path — the mobile-money callback finds this row by `provider_ref` and posts
   * the identical double entry, so a website gift is a normal line in the
   * ledger rather than a parallel system the treasurer has to reconcile twice.
   *
   * What it does NOT do is create a user. See the migration header.
   */
  async createWebsiteGivingIntent(
    input: z.infer<typeof FinancialService.WebsiteGift>,
  ): Promise<Record<string, unknown>> {
    const currency = input.currency.toUpperCase();
    if (currency !== "KES") {
      throw new ApiError("VALIDATION_FAILED", "Website giving settles in KES");
    }
    if (input.amount_minor > FinancialService.WEBSITE_MAX_MINOR) {
      throw new ApiError("VALIDATION_FAILED", "That amount is above the M-Pesa limit for one payment");
    }
    if (input.amount_minor < FinancialService.WEBSITE_MIN_MINOR) {
      throw new ApiError("VALIDATION_FAILED", "That amount is below the smallest gift the website accepts");
    }

    // Idempotent, and scoped to website rows. `idempotency_key` is globally
    // unique, so looking it up without the `source` filter would hand a website
    // caller back a MEMBER's transaction id whenever the keys happened to
    // collide — a small leak, but a leak of exactly the thing this endpoint has
    // no business seeing.
    const existing = await maybeOne<{ transaction_id: string; status: string }>(
      this.pool,
      `SELECT transaction_id, status FROM transactions
        WHERE idempotency_key = $1 AND source = 'website'`,
      [input.idempotency_key],
    );
    if (existing) {
      return {
        transaction_id: existing.transaction_id,
        status: existing.status,
        idempotency_key: input.idempotency_key,
        reused: true,
      };
    }

    const fund = await maybeOne<{ fund_id: string }>(
      this.pool,
      `SELECT fund_id FROM funds WHERE code = $1 AND is_active`,
      [input.fund],
    );
    if (!fund) throw new ApiError("VALIDATION_FAILED", "Unknown or inactive fund");

    // The reference that shows on the church's M-Pesa statement. A giver's name
    // is far more useful there than "GENERAL", and it is what makes an
    // anonymous gift reconcilable at all — but it goes through the same
    // sanitizer as named giving, because Daraja accepts 12 alphanumerics.
    const reference = sanitizeAccountReference(input.giver_name) ?? "WEBSITE";

    // The row first, then the phone (Giving Cycle 6) — the member path's
    // rule: a resent request used to ring twice and lose the second row after
    // its prompt was out. The key is claimed under a lock on the key itself.
    const claim = await tx(this.pool, async (c) => {
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`website_intent:${input.idempotency_key}`]);
      const again = await maybeOne<{ transaction_id: string; status: string }>(
        c, `SELECT transaction_id, status FROM transactions WHERE idempotency_key = $1 AND source = 'website'`, [input.idempotency_key],
      );
      if (again) return { reused: again };
      await this.assertKeyFree(c, input.idempotency_key);
      const row = await one<{ transaction_id: string; status: string }>(
        c,
        `INSERT INTO transactions
           (user_id, fund_id, amount_minor, currency, status, provider, provider_ref,
            idempotency_key, account_name, source, giver_name, giver_phone, giver_email)
         VALUES (NULL, $1, $2, $3, 'processing', $4, NULL, $5, $6, 'website', $7, $8, $9)
         RETURNING transaction_id, status`,
        [
          fund.fund_id,
          input.amount_minor,
          currency,
          input.method,
          input.idempotency_key,
          input.giver_name ?? null,
          input.giver_name ?? null,
          input.phone_number,
          input.giver_email ?? null,
        ],
      );
      return { row };
    });
    if ("reused" in claim) {
      return { transaction_id: claim.reused.transaction_id, status: claim.reused.status, idempotency_key: input.idempotency_key, reused: true };
    }
    const txn = claim.row;
    let charge: { ref: string };
    try {
      charge = await this.provider(input.method).initiate({
        amountMinor: input.amount_minor,
        currency,
        phoneNumber: input.phone_number,
        metadata: { source: "website", fund: input.fund, reference },
      });
    } catch (err) {
      await this.pool.query(`DELETE FROM transactions WHERE transaction_id = $1 AND provider_ref IS NULL AND status = 'processing'`, [txn.transaction_id]);
      throw err;
    }
    await this.pool.query(`UPDATE transactions SET provider_ref = $2 WHERE transaction_id = $1`, [txn.transaction_id, charge.ref]);

    // actor null: nobody signed in did this. The metadata carries who it was as
    // far as we know them, which is a phone number and possibly a name.
    await audit(this.pool, null, "giving.website_intent_created", "transactions", txn.transaction_id, {
      amount_minor: input.amount_minor,
      currency,
      fund: input.fund,
      method: input.method,
      giver_phone: input.phone_number,
      giver_name: input.giver_name ?? null,
    });

    return {
      transaction_id: txn.transaction_id,
      provider: input.method,
      provider_ref: charge.ref, // STK push sent — the giver confirms on their phone
      status: txn.status,
      idempotency_key: input.idempotency_key,
      reused: false,
    };
  }

  /**
   * Has a website gift landed yet?
   *
   * The website asks this after sending someone to their handset, so it can
   * stop saying "check your phone" and start saying thank you. Without it the
   * page's last word is an instruction: a visitor pays and the site behaves as
   * though nothing happened.
   *
   * Scoped to `source = 'website'`, which is not a formality. Anyone able to
   * sign a request could otherwise read the status of any transaction in the
   * ledger by its id, including a member's. This endpoint exists to answer for
   * gifts the website itself started and nothing else.
   *
   * What it returns is deliberately narrow. The amount and fund the giver
   * chose, whether it settled, and the M-Pesa code so they can match it to
   * their SMS. NOT the phone number and NOT the giver's name: the website sent
   * those, so echoing them back adds nothing and puts personal data on a
   * response that a polling page will fetch dozens of times.
   */
  async websiteGiftStatus(transactionId: string): Promise<{
    status: string;
    amount_minor: number;
    currency: string;
    fund: string | null;
    fund_sw: string | null;
    receipt_code: string | null;
    settled_at: string | null;
  } | null> {
    const row = await maybeOne<{
      status: string;
      amount_minor: string;
      currency: string;
      fund: string | null;
      fund_sw: string | null;
      receipt_code: string | null;
      settled_at: string | null;
    }>(
      this.pool,
      // Both names, because the thank-you screen names the fund back to the
      // giver and /sw must not thank somebody "kwa Tithe". Which one is shown
      // is the website's decision — it knows the locale, this does not.
      `SELECT t.status, t.amount_minor, t.currency,
              f.name AS fund, f.name_sw AS fund_sw,
              t.receipt_code, t.settled_at
         FROM transactions t LEFT JOIN funds f ON f.fund_id = t.fund_id
        WHERE t.transaction_id = $1 AND t.source = 'website'`,
      [transactionId],
    );
    if (!row) return null;
    // amount_minor is BIGINT and arrives as a string; the giver's own figure
    // should not reach their screen as "50000" when it is 500.00.
    return { ...row, amount_minor: Number(row.amount_minor) };
  }

  /**
   * Active funds a visitor may give to. Public — no auth, so it carries the
   * code and the display names and nothing else about the church's finances.
   *
   * `name_sw` is null for any fund the church has not named in Swahili; the
   * caller falls back to `name`. Ordered by the English name so the list does
   * not reshuffle between the two locales — a giver who switches language
   * should find the funds where they left them.
   */
  async publicFunds(): Promise<{ code: string; name: string; name_sw: string | null }[]> {
    const rows = await many<Record<string, unknown>>(
      this.pool,
      `SELECT code, name, name_sw FROM funds WHERE is_active ORDER BY name`,
    );
    return rows.map((r) => ({
      code: String(r.code),
      name: String(r.name),
      name_sw: r.name_sw == null ? null : String(r.name_sw),
    }));
  }

  /** Capture a PayPal order the member approved; settle the ledger on COMPLETED
   *  (§5.6 — money moves only here). Idempotent: an already-settled order is a no-op. */
  async capturePayPal(userId: string, orderId: string): Promise<{ status: string }> {
    const txn = await maybeOne<{ status: string }>(
      this.pool,
      `SELECT status FROM transactions WHERE provider = 'paypal' AND provider_ref = $1 AND user_id = $2`,
      [orderId, userId],
    );
    if (!txn) throw new ApiError("NOT_FOUND", "Order not found");
    if (txn.status === "succeeded" || txn.status === "settled") return { status: "succeeded" };
    const result = await this.paypalGw().captureOrder(orderId);
    if (result.status === "completed") {
      await tx(this.pool, async (c) => { await this.settle(c, { provider_ref: orderId }); });
      return { status: "succeeded" };
    }
    if (result.status === "failed") {
      // With its reason, like every other failed gift (Giving Cycle 6).
      await this.pool.query(
        `UPDATE transactions SET status = 'failed', failure_code = 'declined', failed_at = now(),
                failure_detail = 'PayPal did not complete the payment'
          WHERE provider_ref = $1 AND status = 'processing'`,
        [orderId],
      );
      return { status: "failed" };
    }
    return { status: "processing" };
  }

  /**
   * A mobile-money callback (B7; Giving Cycle 1).
   *
   * Signed providers (the HMAC fakes) prove their callback, so its outcome is
   * applied as before. Daraja signs NOTHING, and its callback URL is public, so
   * a member who knew their own CheckoutRequestID (the app is told it) could
   * post "ResultCode 0" and get a receipt, a ledger credit and a kept pledge
   * without paying. So for an unsigned provider the callback is only a HINT:
   *   · a ref that is not one of our waiting prompts costs one indexed read
   *     and nothing else — no provider call, no write (spam is cheap);
   *   · otherwise we ask Safaricom (STK Push Query) what really happened, at
   *     most once every 10 seconds per prompt, and apply THAT;
   *   · if Safaricom cannot say yet, nothing moves — the sweeper
   *     (reconcileMobileMoney) asks again until it can.
   */
  async handleMobileMoneyCallback(
    providerKey: MobileMoneyKey,
    rawBody: Buffer | string,
    signature: string,
  ): Promise<Record<string, unknown>> {
    const provider = this.provider(providerKey);
    const cb = provider.verifyCallback(rawBody, signature);
    if (provider.signedCallbacks) {
      const outcome: MobileMoneyOutcome =
        cb.status === "succeeded"
          ? { kind: "succeeded", receipt: cb.receipt }
          : { kind: "failed", failure: mobileMoneyFailure(cb.result_code), detail: failureDetail(cb.result_code, cb.result_desc) };
      return this.applyMobileMoneyOutcome(providerKey, cb.ref, outcome, { eventId: cb.event_id, rawBody });
    }

    return this.confirmPrompt(providerKey, cb.ref, { receipt: cb.receipt, eventId: cb.event_id, rawBody });
  }

  /**
   * Ask the provider how one of OUR waiting prompts ended and apply that
   * answer — the one path for an unsigned callback and for a member's app
   * polling a gift (Giving Cycle 3). A ref that is not a waiting prompt of
   * ours costs one read; the provider is asked at most every 10 seconds per
   * prompt, however many callbacks or polls arrive.
   */
  private async confirmPrompt(
    providerKey: MobileMoneyKey,
    ref: string,
    hint: { receipt?: string | undefined; eventId?: string; rawBody?: Buffer | string } = {},
  ): Promise<Record<string, unknown>> {
    const known = await maybeOne<{ status: string; checked_recently: boolean }>(
      this.pool,
      `SELECT status, (provider_checked_at IS NOT NULL AND provider_checked_at > now() - interval '10 seconds') AS checked_recently
         FROM transactions WHERE provider = $1 AND provider_ref = $2`,
      [providerKey, ref],
    );
    if (!known) return { ignored: true };
    if (known.status !== "processing") return { duplicate: true, status: known.status };
    if (known.checked_recently) return { verified: false, status: "processing" };

    const truth = await this.askProvider(providerKey, ref);
    if (truth.state === "pending") return { verified: false, status: "processing" };
    const outcome: MobileMoneyOutcome =
      truth.state === "succeeded"
        // The receipt code rides the (unverifiable) callback; it is only kept
        // once Safaricom itself has said the payment went through.
        ? { kind: "succeeded", receipt: hint.receipt }
        : { kind: "failed", failure: mobileMoneyFailure(truth.code), detail: failureDetail(truth.code, truth.desc) };
    return this.applyMobileMoneyOutcome(providerKey, ref, outcome, {
      ...(hint.eventId ? { eventId: hint.eventId } : {}),
      ...(hint.rawBody ? { rawBody: hint.rawBody } : {}),
    });
  }

  /** True when this provider's callbacks prove themselves (HMAC). */
  mobileMoneySigned(providerKey: MobileMoneyKey): boolean {
    return Boolean(this.mobileMoney?.[providerKey]?.signedCallbacks);
  }

  /** Ask the provider about one prompt; a provider that errors has not
   *  answered. Stamps provider_checked_at either way (the throttle). */
  private async askProvider(providerKey: MobileMoneyKey, ref: string): Promise<MobileMoneyStatus> {
    let truth: MobileMoneyStatus;
    try {
      truth = await this.provider(providerKey).queryStatus(ref);
    } catch {
      truth = { state: "pending" };
    }
    await this.pool.query(`UPDATE transactions SET provider_checked_at = now() WHERE provider_ref = $1`, [ref]);
    return truth;
  }

  /**
   * Apply a CONFIRMED outcome to a mobile-money prompt, once. A success
   * settles the ledger (settle() locks the row and skips a settled one); a
   * failure records WHY (failure_code) and only ever moves a prompt that is
   * still processing, so replays and the sweeper racing a callback cannot
   * count one failure twice. A scheduled charge's outcome is fed back to its
   * schedule in the same transaction; notifications go out after commit.
   */
  private async applyMobileMoneyOutcome(
    providerKey: MobileMoneyKey,
    ref: string,
    outcome: MobileMoneyOutcome,
    meta: { eventId?: string; rawBody?: Buffer | string } = {},
  ): Promise<Record<string, unknown>> {
    const after: Array<() => Promise<void>> = [];
    const result = await tx(this.pool, async (c) => {
      if (meta.eventId) {
        const ins = await c.query(
          `INSERT INTO processed_webhooks (event_id, provider, payload_hash)
           VALUES ($1, $2, $3) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
          [meta.eventId, providerKey, sha256(meta.rawBody ?? meta.eventId)],
        );
        if (ins.rowCount === 0) return { duplicate: true };
      }

      if (outcome.kind === "succeeded") {
        const before = await maybeOne<{ status: string; schedule_id: string | null; schedule_cycle_at: string | null }>(
          c,
          `SELECT status, schedule_id, schedule_cycle_at FROM transactions WHERE provider_ref = $1`,
          [ref],
        );
        await this.settle(c, { provider_ref: ref });
        await c.query(`UPDATE transactions SET verified_at = now() WHERE provider_ref = $1`, [ref]);
        // Capture the M-Pesa receipt code (from the SMS) for the member's
        // statement — display-only, set once, never overwrites, never touches
        // amount/status/ledger.
        //
        // Savepoint-guarded (migration 216's transactions_receipt_code_uniq):
        // if another live transaction already holds this code, the UPDATE is a
        // unique violation, and without the savepoint it would abort THIS
        // transaction — rolling back the settlement and the processed_webhooks
        // row, so every provider retry failed the same way, forever. A
        // display-only field must never undo money that arrived. The clash is
        // left for Reconciliation (duplicate_receipt); anything else rethrows.
        if (outcome.receipt) {
          await c.query("SAVEPOINT receipt_capture");
          try {
            await c.query(
              `UPDATE transactions SET receipt_code = $2
                WHERE provider_ref = $1 AND receipt_code IS NULL`,
              [ref, outcome.receipt],
            );
            await c.query("RELEASE SAVEPOINT receipt_capture");
          } catch (err) {
            if ((err as { code?: string }).code !== "23505") throw err;
            await c.query("ROLLBACK TO SAVEPOINT receipt_capture");
            const holder = await maybeOne<{ transaction_id: string }>(
              c,
              `SELECT transaction_id FROM transactions WHERE receipt_code = $1 AND status <> 'failed' LIMIT 1`,
              [outcome.receipt],
            );
            console.warn(
              `[giving] ${providerKey} receipt ${outcome.receipt} (provider_ref ${ref}) is already on transaction ` +
                `${holder?.transaction_id ?? "unknown"} — settled without capturing it; Reconciliation flags the duplicate`,
            );
          }
        }
        if (before?.schedule_id && before.status !== "succeeded") {
          await this.recordScheduleOutcome(c, before.schedule_id, before.schedule_cycle_at, null);
        }
        return { duplicate: false, status: "succeeded" };
      }

      const failed = await maybeOne<{
        transaction_id: string; user_id: string | null; schedule_id: string | null; schedule_cycle_at: string | null;
        amount_minor: string; currency: string; fund: string | null; unseen: boolean;
      }>(
        c,
        `UPDATE transactions t
            SET status = 'failed', failure_code = $2, failure_detail = $3, failed_at = now(), verified_at = now()
          WHERE t.provider_ref = $1 AND t.status = 'processing'
          RETURNING t.transaction_id, t.user_id, t.schedule_id, t.schedule_cycle_at, t.amount_minor, t.currency,
                    (SELECT f.code FROM funds f WHERE f.fund_id = t.fund_id) AS fund,
                    (t.created_at < now() - interval '45 seconds') AS unseen,
                    -- Watched: a give-now first prompt, or the member's own
                    -- Try again of a scheduled charge (any key not the runner's).
                    (t.idempotency_key LIKE 'sched:%:first' OR t.idempotency_key NOT LIKE 'sched:%') AS first_charge`,
        [ref, outcome.failure.code, outcome.detail],
      );
      if (failed?.schedule_id) {
        const quiet = Boolean((failed as { first_charge?: boolean }).first_charge) && !failed.unseen;
        const notice = await this.recordScheduleOutcome(c, failed.schedule_id, failed.schedule_cycle_at, outcome.failure, new Date(), quiet);
        if (notice) after.push(notice);
      } else if (failed?.user_id && failed.unseen && (outcome.failure.retryable || outcome.failure.code === "no_answer")) {
        // A member's own gift that failed where they could not see it (Giving
        // Cycle 3): the prompt never reached their phone, or no answer came
        // before they left the Give screen. A decline they made themselves
        // (cancelled, wrong PIN, not enough money) is not re-announced.
        const copy = giftFailureCopy(outcome.failure.code)!;
        const f = failed;
        after.push(async () => {
          await this.notifications.schedule({
            userId: f.user_id!,
            channel: "push",
            template: "giving_gift_failed",
            payload: {
              transaction_id: f.transaction_id, amount_minor: Number(f.amount_minor), currency: f.currency,
              fund: f.fund, failure_code: outcome.failure.code, reason: copy.reason, hint: copy.hint,
            },
          });
        });
      }
      return { duplicate: false, status: "failed", failure_code: outcome.failure.code };
    });
    for (const send of after) {
      try {
        await send();
      } catch {
        /* the ledger matters more than the notice */
      }
    }
    return result;
  }

  /**
   * Feed a scheduled charge's REAL outcome back to its schedule (Giving
   * Cycle 1). The scheduler used to call a cycle "done" the moment the prompt
   * was SENT: a declined or ignored prompt never counted, nobody was told, the
   * office saw a healthy schedule, and the church quietly missed the gift (in
   * production, 14 of 15 scheduled charges had failed with every schedule
   * showing zero failures).
   *
   * Now: a success clears the failure state. A failure counts one strike, and
   *   · if it was not the member's answer (the phone was unreachable, the
   *     prompt expired, another payment was in progress, M-Pesa faltered) the
   *     cycle is tried ONCE more, two hours later and inside 07:00–21:00 EAT —
   *     never once the next cycle is due;
   *   · if it was the member's answer (cancelled, wrong PIN, not enough in the
   *     account) nothing is re-sent — a machine does not keep asking someone
   *     who said no;
   *   · three strikes in a row pauses the schedule and asks the member.
   * The member hears on the first strike and on the pause, with the reason.
   * Returns the notice to send after commit.
   */
  private async recordScheduleOutcome(
    c: PoolClient,
    scheduleId: string,
    cycleAt: string | null,
    failure: GiftFailure | null,
    now: Date = new Date(),
    /** The member is watching this prompt (a "give now" first charge):
     *  count it, but the screen tells them — no push. */
    quiet = false,
  ): Promise<(() => Promise<void>) | null> {
    if (!failure) {
      await c.query(
        `UPDATE giving_schedules
            SET consecutive_failures = 0, last_error = NULL, last_failed_at = NULL, last_failure_code = NULL,
                retry_cycle_at = NULL, retry_at = NULL, retry_after = NULL
          WHERE schedule_id = $1`,
        [scheduleId],
      );
      return null;
    }
    const s = await maybeOne<{
      status: string; consecutive_failures: number; cycle_attempts: number; next_run_at: string;
      user_id: string; fund: string; amount_minor: string; currency: string; method: string; frequency: string;
    }>(
      c,
      `SELECT s.status, s.consecutive_failures, s.cycle_attempts, s.next_run_at, s.user_id, f.code AS fund,
              s.amount_minor, s.currency, s.method, s.frequency
         FROM giving_schedules s JOIN funds f ON f.fund_id = s.fund_id
        WHERE s.schedule_id = $1 FOR UPDATE OF s`,
      [scheduleId],
    );
    if (!s || s.status === "cancelled") return null;
    const copy = giftFailureCopy(failure.code)!;
    const strikes = s.consecutive_failures + 1;
    const paused = s.status === "active" && strikes >= FinancialService.SCHEDULE_MAX_ATTEMPTS;
    const retryAt = FinancialService.daytimeEat(new Date(now.getTime() + 2 * 3_600_000));
    const retry =
      !paused && s.status === "active" && failure.retryable && s.cycle_attempts < 1 && cycleAt !== null &&
      retryAt.getTime() < new Date(s.next_run_at).getTime();
    await c.query(
      `UPDATE giving_schedules
          SET consecutive_failures = $2, last_error = $3, last_failure_code = $4, last_failed_at = $5,
              retry_cycle_at = $6, retry_at = $7,
              cycle_attempts = cycle_attempts + CASE WHEN $6::timestamptz IS NULL THEN 0 ELSE 1 END,
              status = CASE WHEN $8 THEN 'paused' ELSE status END,
              paused_at = CASE WHEN $8 THEN $5::timestamptz ELSE paused_at END,
              pause_reason = CASE WHEN $8 THEN 'failures' ELSE pause_reason END
        WHERE schedule_id = $1`,
      [scheduleId, strikes, copy.reason, failure.code, now.toISOString(),
       retry ? cycleAt : null, retry ? retryAt.toISOString() : null, paused],
    );
    if ((strikes !== 1 && !paused) || (quiet && !paused)) return null;
    const payload = {
      schedule_id: scheduleId,
      fund: s.fund,
      amount_minor: Number(s.amount_minor),
      currency: s.currency,
      method: s.method,
      frequency: s.frequency,
      failure_code: failure.code,
      reason: copy.reason,
      hint: copy.hint,
      retry_at: retry ? retryAt.toISOString() : null,
    };
    return async () => {
      await this.notifications.schedule({
        userId: s.user_id,
        channel: "push",
        template: paused ? "giving_schedule_paused" : "giving_schedule_failed",
        payload,
      });
    };
  }

  /** `at`, moved forward into prompt hours (07:00–21:00 Nairobi): before
   *  07:00 → 07:00 that day; from 21:00 → 07:00 the next day. */
  static daytimeEat(at: Date): Date {
    const eat = new Date(at.getTime() + FinancialService.EAT_MS);
    const hour = eat.getUTCHours();
    if (hour >= FinancialService.PROMPT_FROM_HOUR && hour < FinancialService.PROMPT_UNTIL_HOUR) return at;
    const day = Date.UTC(
      eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate() + (hour >= FinancialService.PROMPT_UNTIL_HOUR ? 1 : 0),
      FinancialService.PROMPT_FROM_HOUR,
    );
    return new Date(day - FinancialService.EAT_MS);
  }

  /**
   * The mobile-money sweeper (worker, every minute; Giving Cycle 1). A prompt
   * whose callback never came — or whose callback arrived before Safaricom
   * could confirm it — is asked about again: after 90 seconds, at most once a
   * minute each, `limit` per run. One still waiting after 48 hours is closed
   * as "no_answer" (as far as anyone can tell no money moved; a late M-Pesa
   * statement line would be matched by the office). Returns what it did.
   */
  async reconcileMobileMoney(
    now: Date = new Date(),
    limit = 25,
  ): Promise<{ checked: number; settled: number; failed: number; expired: number }> {
    const out = { checked: 0, settled: 0, failed: 0, expired: 0 };
    const cutoff = new Date(now.getTime() - 48 * 3_600_000).toISOString();
    // A row claimed for a prompt that never went out — the process stopped
    // between claiming it and ringing the phone (Giving Cycle 6). Nothing can
    // settle it; say so instead of leaving it "processing" for 48 hours.
    const unsent = await this.pool.query(
      `UPDATE transactions
          SET status = 'failed', failure_code = 'system', failed_at = now(), failure_detail = 'the prompt was never sent'
        WHERE status = 'processing' AND provider IN ('mpesa','airtel') AND provider_ref IS NULL
          AND created_at < $1`,
      [new Date(now.getTime() - 5 * 60_000).toISOString()],
    );
    out.failed += unsent.rowCount ?? 0;
    const stale = await many<{ provider: MobileMoneyKey; provider_ref: string }>(
      this.pool,
      `SELECT provider, provider_ref FROM transactions
        WHERE status = 'processing' AND provider IN ('mpesa','airtel') AND provider_ref IS NOT NULL AND created_at < $1
        ORDER BY created_at LIMIT 200`,
      [cutoff],
    );
    for (const t of stale) {
      await this.applyMobileMoneyOutcome(t.provider, t.provider_ref, {
        kind: "failed",
        failure: { code: "no_answer", retryable: false },
        detail: "no provider answer within 48 hours",
      });
      out.expired += 1;
    }
    // PayPal orders nobody approved and card intents nobody confirmed have no
    // callback to wait for (Giving Cycle 3): after 48 hours they are closed
    // too. If the provider ever does report one paid later, settle() still
    // books it — money that arrived always wins over a closed record.
    const abandoned = await this.pool.query(
      `UPDATE transactions
          SET status = 'failed', failure_code = 'no_answer', failed_at = now(),
              failure_detail = 'never completed within 48 hours'
        WHERE status = 'processing' AND provider IN ('paypal', 'stripe') AND created_at < $1`,
      [cutoff],
    );
    out.expired += abandoned.rowCount ?? 0;
    const waiting = await many<{ provider: MobileMoneyKey; provider_ref: string }>(
      this.pool,
      `SELECT provider, provider_ref FROM transactions
        WHERE status = 'processing' AND provider IN ('mpesa','airtel') AND provider_ref IS NOT NULL
          AND created_at < $1 AND created_at >= $2
          AND (provider_checked_at IS NULL OR provider_checked_at < $3)
        ORDER BY created_at LIMIT $4`,
      [new Date(now.getTime() - 90_000).toISOString(), cutoff, new Date(now.getTime() - 60_000).toISOString(), limit],
    );
    for (const t of waiting) {
      const p = this.mobileMoney?.[t.provider];
      if (!p || !providerIsLive(p)) continue;
      out.checked += 1;
      const truth = await this.askProvider(t.provider, t.provider_ref);
      if (truth.state === "pending") continue;
      if (truth.state === "succeeded") {
        await this.applyMobileMoneyOutcome(t.provider, t.provider_ref, { kind: "succeeded" });
        out.settled += 1;
      } else {
        await this.applyMobileMoneyOutcome(t.provider, t.provider_ref, {
          kind: "failed",
          failure: mobileMoneyFailure(truth.code),
          detail: failureDetail(truth.code, truth.desc),
        });
        out.failed += 1;
      }
    }
    return out;
  }

  /**
   * Verify + process a Stripe webhook. HMAC check first (throws on tamper), then
   * a row-locked dedupe on event_id, then the ledger post — all in one tx so the
   * dedupe row and the double-entry commit together (§3.5).
   */
  async handleWebhook(rawBody: Buffer | string, signature: string): Promise<Record<string, unknown>> {
    const event = this.gateway.verifyWebhook(rawBody, signature);
    return tx(this.pool, async (c) => {
      const ins = await c.query(
        `INSERT INTO processed_webhooks (event_id, provider, payload_hash)
         VALUES ($1, 'Stripe', $2) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
        [event.id, sha256(rawBody)],
      );
      if (ins.rowCount === 0) return { duplicate: true }; // already processed — idempotent no-op

      if (event.type === "payment_intent.succeeded") {
        await this.settle(c, event.data.object);
      } else if (event.type === "payment_intent.payment_failed") {
        await c.query(
          `UPDATE transactions SET status = 'failed' WHERE stripe_payment_intent = $1 AND status <> 'succeeded'`,
          [String(event.data.object.id ?? "")],
        );
      }
      return { duplicate: false, type: event.type };
    });
  }

  /** Mark a transaction succeeded, post the double-entry, and grant a purchase
   *  if applicable. Looks up by Stripe intent id or mobile-money provider_ref;
   *  cash is debited to the provider's account (cash:stripe / cash:mpesa / …). */
  private async settle(c: PoolClient, intent: Record<string, unknown>): Promise<void> {
    const byProviderRef = typeof intent.provider_ref === "string";
    const ref = byProviderRef ? String(intent.provider_ref) : String(intent.id ?? "");
    const metadata = (intent.metadata as Record<string, unknown> | undefined) ?? {};
    const productId = typeof metadata.product_id === "string" ? metadata.product_id : null;

    const txn = await maybeOne<{
      transaction_id: string;
      // Nullable since migration 202 — a website gift belongs to no member.
      user_id: string | null;
      amount_minor: string;
      currency: string;
      status: string;
      provider: string;
      fund_code: string | null;
    }>(
      c,
      `SELECT t.transaction_id, t.user_id, t.amount_minor, t.currency, t.status, t.provider, f.code AS fund_code
         FROM transactions t LEFT JOIN funds f ON f.fund_id = t.fund_id
        WHERE ${byProviderRef ? "t.provider_ref" : "t.stripe_payment_intent"} = $1 FOR UPDATE OF t`,
      [ref],
    );
    if (!txn || txn.status === "succeeded") return; // unknown intent or already settled

    await c.query(`UPDATE transactions SET status = 'succeeded', settled_at = now() WHERE transaction_id = $1`, [
      txn.transaction_id,
    ]);
    // Debit cash, credit the fund (giving) or media sales (purchase) — balanced (§5.6).
    const creditAccount = productId ? "sales:media" : `fund:${txn.fund_code ?? "general"}`;
    await c.query(
      `INSERT INTO ledger_entries (transaction_id, account, side, amount_minor, currency)
       VALUES ($1, $5, 'debit', $2, $3), ($1, $4, 'credit', $2, $3)`,
      [txn.transaction_id, txn.amount_minor, txn.currency, creditAccount, `cash:${txn.provider}`],
    );

    // A product purchase grants access on settlement (§3.3).
    if (productId) {
      await c.query(
        `INSERT INTO purchases (user_id, product_id, transaction_id)
         VALUES ($1, $2, $3) ON CONFLICT (user_id, product_id) DO NOTHING`,
        [txn.user_id, productId, txn.transaction_id],
      );
    }
    // `user_id` is null for a website gift (migration 202). The receipt handler
    // treats a null user as a malformed payload and no-ops, which is correct but
    // worth saying out loud: a stranger who gives through nuruplace.org gets
    // M-Pesa's own confirmation SMS with the transaction code, and nothing from
    // us. A church-branded receipt to `giver_email` needs a delivery path that
    // is not `notifications` — every row there is keyed to a user_id — so it is
    // deliberately out of scope here rather than half-built. The gift itself is
    // in the ledger and on the website report either way.
    await enqueueOutbox(c, "giving.receipt", { transaction_id: txn.transaction_id, user_id: txn.user_id });
  }

  /** Active media catalogue (§3.3). */
  async listProducts(): Promise<unknown[]> {
    const rows = await many<{ price_minor: string }>(
      this.pool,
      `SELECT product_id, title, price_minor, currency FROM products WHERE is_active ORDER BY title`,
    );
    return rows.map((r) => ({ ...r, price_minor: Number(r.price_minor) }));
  }

  /** Start a media purchase: PaymentIntent + pending transaction; grant lands on the webhook. */
  async createPurchase(userId: string, productId: string): Promise<Record<string, unknown>> {
    const product = await maybeOne<{ price_minor: string; currency: string }>(
      this.pool,
      `SELECT price_minor, currency FROM products WHERE product_id = $1 AND is_active`,
      [productId],
    );
    if (!product) throw new ApiError("NOT_FOUND", "Product not found");

    const owned = await maybeOne(
      this.pool,
      `SELECT 1 FROM purchases WHERE user_id = $1 AND product_id = $2`,
      [userId, productId],
    );
    if (owned) throw new ApiError("CONFLICT", "Product already purchased");

    const key = `purchase:${userId}:${productId}`;
    const existing = await maybeOne<{ transaction_id: string; status: string }>(
      this.pool,
      `SELECT transaction_id, status FROM transactions WHERE idempotency_key = $1 AND user_id = $2`,
      [key, userId],
    );
    if (existing) return { transaction_id: existing.transaction_id, status: existing.status, reused: true };

    const currency = String(product.currency).toUpperCase();
    const intent = await this.gateway.createIntent({
      amountMinor: Number(product.price_minor),
      currency,
      metadata: { user_id: userId, product_id: productId, kind: "purchase" },
    });
    const txn = await one<{ transaction_id: string; status: string }>(
      this.pool,
      `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, stripe_payment_intent, idempotency_key)
       VALUES ($1, NULL, $2, $3, 'processing', $4, $5)
       RETURNING transaction_id, status`,
      [userId, product.price_minor, currency, intent.id, key],
    );
    await audit(this.pool, userId, "purchase.intent_created", "products", productId, {
      transaction_id: txn.transaction_id,
    });
    return {
      transaction_id: txn.transaction_id,
      client_secret: intent.client_secret,
      status: txn.status,
      reused: false,
    };
  }

  /** A member's giving history (§3.3). Includes the payment method + a short
   *  provider reference so the mobile statement can show "via M-Pesa · Ref …".
   *  `provider` is 'stripe' for cards; we surface that as method 'card' and fall
   *  back to the Stripe payment-intent id when there's no mobile-money ref.
   *  Each row also names the pledge it counted toward (`pledge_id`,
   *  `pledge_title` under the pledge card's own words; both null off-pledge)
   *  so the Give statement can label pledge payments without a second call,
   *  and the department need it was given to (`need_id`, null otherwise) — the
   *  apps' "Repeat last gift" skips pledge and need gifts. */
  async listGiving(userId: string): Promise<unknown[]> {
    const rows = await many<Record<string, unknown>>(
      this.pool,
      `SELECT t.transaction_id, t.amount_minor, t.currency, t.status, f.code AS fund,
              t.provider,
              COALESCE(t.provider_ref, t.stripe_payment_intent) AS provider_ref,
              t.receipt_code, t.account_name,
              t.created_at, t.settled_at,
              t.pledge_id, ${pledgeTitleSql({ pledge: "p", fund: "pf", campaign: "c" })} AS pledge_title,
              t.need_id, t.office_channel, t.failure_code, t.fee_cover_minor
         FROM transactions t
         LEFT JOIN funds f ON f.fund_id = t.fund_id
         LEFT JOIN pledges p ON p.pledge_id = t.pledge_id
         LEFT JOIN funds pf ON pf.fund_id = p.fund_id
         LEFT JOIN campaigns c ON c.campaign_id = p.campaign_id
        WHERE t.user_id = $1 ORDER BY t.created_at DESC`,
      [userId],
    );
    return rows.map((r) => {
      const provider = (r.provider as string | null) ?? "stripe";
      // office_channel only chooses the words; it is not part of the member's row.
      const { provider: _omit, office_channel: _office, failure_code: _fc, ...rest } = r;
      void _omit;
      void _office;
      void _fc;
      const method = provider === "stripe" ? "card" : provider;
      return {
        ...rest,
        amount_minor: Number(r.amount_minor),
        method,
        method_label: giftMethodLabel(method, (r.office_channel as string | null) ?? null),
        fee_cover_minor: r.fee_cover_minor === null || r.fee_cover_minor === undefined ? null : Number(r.fee_cover_minor),
        // Why it failed, in words the member can act on (Giving Cycle 1).
        failure: r.status === "failed" ? giftFailureCopy((r.failure_code as string | null) ?? "declined") : null,
      };
    });
  }

  /**
   * "Try again" on a failed gift (Giving Cycle 3): a NEW gift with everything
   * the failed one carried — fund, amount, currency, method, the pledge or
   * need it counted toward, the gift's name and the fee cover — so a retry
   * can never quietly lose its pledge. Owner-scoped (404); only a gift that
   * failed (422 otherwise). The pledge and the need are checked afresh (a
   * pledge cancelled since is refused, as any gift to it would be), and every
   * Cycle 1 check runs again. A scheduled charge retried by hand is a one-off
   * gift: the schedule keeps its own rhythm.
   */
  async retryGift(
    userId: string,
    transactionId: string,
    input: { idempotency_key?: string | undefined; phone_number?: string | null | undefined },
  ): Promise<Record<string, unknown>> {
    const t = await maybeOne<{
      status: string; provider: string | null; amount_minor: string; currency: string; fund: string | null;
      pledge_id: string | null; need_id: string | null; account_name: string | null; fee_cover_minor: string | null;
      schedule_id: string | null; schedule_cycle_at: string | null; schedule_open: boolean | null;
    }>(
      this.pool,
      `SELECT t.status, t.provider, t.amount_minor, t.currency, f.code AS fund, t.pledge_id, t.need_id,
              t.account_name, t.fee_cover_minor, t.schedule_id, t.schedule_cycle_at,
              (s.status IN ('active','paused')) AS schedule_open
         FROM transactions t LEFT JOIN funds f ON f.fund_id = t.fund_id
         LEFT JOIN giving_schedules s ON s.schedule_id = t.schedule_id
        WHERE t.transaction_id = $1 AND t.user_id = $2`,
      [transactionId, userId],
    );
    if (!t) throw new ApiError("NOT_FOUND", "Gift not found");
    if (t.status !== "failed") {
      throw new ApiError("UNPROCESSABLE", t.status === "processing"
        ? "That gift is still waiting on the payment. Approve the prompt, or wait a minute."
        : "Only a gift that did not go through can be tried again.");
    }
    const method = t.provider === "stripe" || !t.provider ? "card" : t.provider;
    if (method !== "mpesa" && method !== "airtel" && method !== "paypal" && method !== "card") {
      throw new ApiError("UNPROCESSABLE", "This gift cannot be tried again from the app. Give again from Give.");
    }
    const result = await this.createGivingIntent(userId, {
      fund: t.fund ?? "general",
      amount_minor: Number(t.amount_minor),
      currency: t.currency,
      method,
      phone_number: input.phone_number ?? null,
      pledge_id: t.pledge_id,
      need_id: t.need_id,
      account_name: t.account_name ?? undefined,
      cover_fee_minor: t.fee_cover_minor ? Number(t.fee_cover_minor) : null,
      ...(input.idempotency_key ? { idempotency_key: input.idempotency_key } : {}),
    });
    // A retried SCHEDULED charge is that cycle's attempt (Giving Cycle 5): paid,
    // it clears the schedule's strikes and its automatic retry of the cycle;
    // declined, it counts like any attempt the member watched. It used to be
    // a stray one-off gift the schedule never heard about.
    if (t.schedule_id && t.schedule_cycle_at && t.schedule_open && typeof result.transaction_id === "string") {
      await this.pool.query(
        `UPDATE transactions SET schedule_id = $2, schedule_cycle_at = $3 WHERE transaction_id = $1 AND schedule_id IS NULL`,
        [result.transaction_id, t.schedule_id, t.schedule_cycle_at],
      );
    }
    return { ...result, retry_of: transactionId };
  }

  /** Full detail for ONE of the caller's gifts — every field plus the balanced
   *  ledger trail (cash + fund accounts). Scoped to the owner (404 otherwise).
   *  Carries everything the in-app receipt prints so the apps render it from
   *  this one payload: the fund's NAME beside its code, the pledge or department
   *  need the gift counted toward (under the same words their cards show), the
   *  method's display label, and who gave where. */
  async givingDetail(userId: string, transactionId: string): Promise<Record<string, unknown>> {
    // The app polls this while the member waits on the prompt (Giving Cycle
    // 3). Past 20 seconds with no verdict, ask the provider now — callbacks
    // can be slow or lost, and the sweeper only looks after 90 seconds — so
    // the member sees "paid" or "why not" while still on the screen. The
    // provider is asked at most every 10 seconds per prompt however hard the
    // app polls; the verdict is applied exactly as a callback's would be.
    const waiting = await maybeOne<{ provider: MobileMoneyKey; provider_ref: string }>(
      this.pool,
      `SELECT provider, provider_ref FROM transactions
        WHERE transaction_id = $1 AND user_id = $2 AND status = 'processing'
          AND provider IN ('mpesa','airtel') AND provider_ref IS NOT NULL
          AND created_at < now() - interval '20 seconds'`,
      [transactionId, userId],
    );
    if (waiting) {
      const p = this.mobileMoney?.[waiting.provider];
      if (p && providerIsLive(p)) {
        try {
          await this.confirmPrompt(waiting.provider, waiting.provider_ref);
        } catch {
          /* a provider hiccup must never break reading a gift */
        }
      }
    }
    const t = await maybeOne<Record<string, unknown>>(
      this.pool,
      `SELECT t.transaction_id, t.amount_minor, t.currency, t.status, f.code AS fund, f.name AS fund_name,
              t.provider, COALESCE(t.provider_ref, t.stripe_payment_intent) AS provider_ref,
              t.receipt_code, t.account_name,
              t.schedule_id, t.created_at, t.settled_at,
              t.pledge_id, t.need_id, n.title AS need_title, t.office_channel, t.failure_code, t.fee_cover_minor,
              u.full_name AS member_name, c.name AS congregation
         FROM transactions t
         LEFT JOIN funds f ON f.fund_id = t.fund_id
         LEFT JOIN department_needs n ON n.need_id = t.need_id
         JOIN users u ON u.user_id = t.user_id
         LEFT JOIN congregations c ON c.congregation_id = u.congregation_id
        WHERE t.transaction_id = $1 AND t.user_id = $2`,
      [transactionId, userId],
    );
    if (!t) throw new ApiError("NOT_FOUND", "Gift not found");
    const ledger = await many<Record<string, unknown>>(
      this.pool,
      `SELECT side, account, amount_minor, currency FROM ledger_entries WHERE transaction_id = $1 ORDER BY side`,
      [transactionId],
    );
    const provider = (t.provider as string | null) ?? "stripe";
    const method = provider === "stripe" ? "card" : provider;
    // Same effective-title rule as the intent result (pledgeTitleFor): the
    // member's own name for the pledge, else the derived one. A pledge_id whose
    // row is gone (FK is ON DELETE SET NULL, so only mid-delete) reads as null.
    const pledgeId = (t.pledge_id as string | null) ?? null;
    const pledgeTitle = pledgeId ? await pledgeTitleFor(this.pool, pledgeId) : null;
    const needId = (t.need_id as string | null) ?? null;
    const needTitle = (t.need_title as string | null) ?? null;
    const { provider: _p, pledge_id: _pl, need_id: _n, need_title: _nt, failure_code: _fc, ...rest } = t;
    void _p; void _pl; void _n; void _nt; void _fc;
    return {
      ...rest,
      amount_minor: Number(t.amount_minor),
      fee_cover_minor: t.fee_cover_minor === null || t.fee_cover_minor === undefined ? null : Number(t.fee_cover_minor),
      failure: t.status === "failed" ? giftFailureCopy((t.failure_code as string | null) ?? "declined") : null,
      method,
      method_label: giftMethodLabel(method, (t.office_channel as string | null) ?? null),
      pledge: pledgeId && pledgeTitle ? { pledge_id: pledgeId, title: pledgeTitle } : null,
      need: needId && needTitle ? { need_id: needId, title: needTitle } : null,
      ledger: ledger.map((l) => ({ ...l, amount_minor: Number(l.amount_minor) })),
    };
  }

  /** Render the caller's giving statement as a PDF (dep-free) — the complete
   *  record, every gift and every fund, with settled-only totals; what the
   *  mobile "Download" action saves. Pledge money is separated, never dropped
   *  (docs/PARTNERS_PROGRAMME.md §3d): the header reads "Gifts X · Partner
   *  pledges Y · Total X+Y" (just "Total given X" when Y = 0, as both apps'
   *  hero does), the day groups list gifts outside a pledge only,
   *  and the pledge-tied payments sit in one PARTNER PLEDGES section under
   *  their pledge's title with a subtotal — so the total still foots with the
   *  member's bank and the church ledger. */
  async statementPdf(userId: string, year?: number): Promise<Buffer> {
    const all = (await this.listGiving(userId)) as Array<{ amount_minor: number; currency: string; status: string; fund: string; method: string; method_label?: string; provider_ref: string | null; receipt_code: string | null; account_name: string | null; created_at: string; pledge_id: string | null; pledge_title: string | null }>;
    // One church year (EAT, by created_at — the statements' own year rule)
    // when the office asks for one; otherwise the complete record.
    const rows = year === undefined
      ? all
      // pg hands created_at back as a Date (typed text above); both parse.
      : all.filter((r) => nairobiDate(new Date(r.created_at as string | Date)).startsWith(`${year}-`));
    const me = await maybeOne<{ full_name: string; congregation: string | null }>(
      this.pool,
      `SELECT u.full_name, c.name AS congregation FROM users u LEFT JOIN congregations c ON c.congregation_id = u.congregation_id WHERE u.user_id = $1`,
      [userId],
    );
    const settled = (s: string): boolean => s === "succeeded" || s === "settled" || s === "completed";
    // Every amount in its OWN currency, and totals per currency — KSh and US
    // dollars are never added (Giving Cycle 2: a USD PayPal gift used to be
    // printed and summed as shillings).
    const settledLabel = (rs: typeof rows): string => perCurrencyLabel(rs.filter((r) => settled(r.status)));
    const hasSettled = (rs: typeof rows): boolean => rs.some((r) => settled(r.status));
    const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v)); // pg returns timestamps as Date
    // Days and times on the NAIROBI calendar (Giving Cycle 2): a gift at 00:30
    // on 1 January belongs to 1 January here, as it does in the year filter
    // and the in-app statement — it used to print under 31 December (UTC).
    const dayKey = (v: unknown): string => nairobiDate(new Date(iso(v)));
    const dayLabel = (v: unknown): string => new Date(iso(v)).toLocaleDateString("en-US", { timeZone: "Africa/Nairobi", weekday: "short", day: "numeric", month: "short", year: "numeric" });
    const timeLabel = (v: unknown): string => new Date(iso(v)).toLocaleTimeString("en-US", { timeZone: "Africa/Nairobi", hour: "numeric", minute: "2-digit" });
    // Prefer the real M-Pesa receipt code when present; fall back to the
    // trimmed provider_ref for older/non-mobile-money gifts.
    const refOf = (r: (typeof rows)[number]): string => r.receipt_code
      ? r.receipt_code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
      : (r.provider_ref ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase();
    const fundLabel = (r: (typeof rows)[number]): string => `${r.fund[0]!.toUpperCase()}${r.fund.slice(1)}`;

    const gifts = rows.filter((r) => !r.pledge_id);
    const pledgeRows = rows.filter((r) => Boolean(r.pledge_id));

    // Gifts outside a pledge, grouped by calendar day, newest first — mirrors
    // the in-app statement layout.
    const byDay = new Map<string, typeof rows>();
    for (const r of gifts) {
      const k = dayKey(r.created_at);
      (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(r);
    }
    const groups = [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([, recs]) => ({
        label: dayLabel(recs[0]!.created_at),
        totalLabel: settledLabel(recs),
        rows: recs.map((r) => {
          const ref = refOf(r);
          return `${fundLabel(r)}  ${moneyWords(r.amount_minor, r.currency)}  ${timeLabel(r.created_at)}  ${r.method_label ?? methodLabel(r.method)}  ${r.status.toUpperCase()}${ref ? `  Ref ${ref}` : ""}${r.account_name ? `  "${r.account_name}"` : ""}`;
        }),
      }));
    // Pledge-tied payments, newest first (listGiving's order), each dated and
    // tagged "<title> pledge" as the in-app history tags them.
    const pledges = pledgeRows.length === 0 ? null : {
      totalLabel: settledLabel(pledgeRows),
      rows: pledgeRows.map((r) => {
        const ref = refOf(r);
        return `${dayLabel(r.created_at)}  ${r.pledge_title ?? "General partnership"} pledge  ${fundLabel(r)}  ${moneyWords(r.amount_minor, r.currency)}  ${r.method_label ?? methodLabel(r.method)}  ${r.status.toUpperCase()}${ref ? `  Ref ${ref}` : ""}`;
      }),
    };
    return renderStatementPdf({
      congregation: me?.congregation ?? "Nuru Pathway",
      member: me?.full_name ?? "",
      ...(year === undefined ? {} : { periodLabel: `Year ${year}` }),
      giftsLabel: settledLabel(gifts),
      // No pledge money (Y = 0): the header is just "Total given KSh X".
      pledgesLabel: hasSettled(pledgeRows) ? settledLabel(pledgeRows) : null,
      totalLabel: settledLabel(rows),
      giftCount: gifts.length,
      pledgeCount: pledgeRows.length,
      generatedAt: new Date().toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" }),
      groups,
      pledges,
    });
  }

  /** Render ONE of the caller's gifts as a downloadable receipt PDF (the in-app
   *  "Giving receipt"). Owner-scoped (404 otherwise). Money stays server-side. */
  async receiptPdf(userId: string, transactionId: string): Promise<Buffer> {
    const t = await maybeOne<{ amount_minor: number; currency: string; status: string; fund: string | null; fund_name: string | null; provider: string | null; provider_ref: string | null; receipt_code: string | null; account_name: string | null; pledge_id: string | null; need_title: string | null; office_channel: string | null; created_at: unknown; settled_at: unknown; fee_cover_minor: string | null; failure_code: string | null }>(
      this.pool,
      `SELECT t.amount_minor, t.currency, t.status, f.code AS fund, f.name AS fund_name, t.provider,
              COALESCE(t.provider_ref, t.stripe_payment_intent) AS provider_ref, t.receipt_code, t.account_name,
              t.pledge_id, n.title AS need_title, t.office_channel, t.created_at, t.settled_at,
              t.fee_cover_minor, t.failure_code
         FROM transactions t
         LEFT JOIN funds f ON f.fund_id = t.fund_id
         LEFT JOIN department_needs n ON n.need_id = t.need_id
        WHERE t.transaction_id = $1 AND t.user_id = $2`,
      [transactionId, userId],
    );
    if (!t) throw new ApiError("NOT_FOUND", "Gift not found");
    // The same words the pledge card and the detail payload carry.
    const pledgeTitle = t.pledge_id ? await pledgeTitleFor(this.pool, t.pledge_id) : null;
    const me = await maybeOne<{ full_name: string; congregation: string | null }>(
      this.pool,
      `SELECT u.full_name, c.name AS congregation FROM users u LEFT JOIN congregations c ON c.congregation_id = u.congregation_id WHERE u.user_id = $1`,
      [userId],
    );
    const money = (m: number): string => moneyWords(m, t.currency);
    const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
    const stamp = (v: unknown): string => new Date(iso(v)).toLocaleString("en-US", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
    const settled = (s: string): boolean => s === "succeeded" || s === "settled" || s === "completed";
    const provider = (t.provider as string | null) ?? "stripe";
    const method = provider === "stripe" ? "card" : provider;
    // The fund's display name ("General Giving"), not its code; a code-only
    // fund (name missing) still reads as a word, and no fund at all as "Gift".
    const fund = t.fund_name ?? (t.fund ? t.fund[0]!.toUpperCase() + t.fund.slice(1) : "Gift");
    // Prefer the real M-Pesa receipt code; fall back to provider_ref otherwise.
    const ref = (t.receipt_code ?? t.provider_ref ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    // A receipt tells the truth about its gift (Giving Cycle 2): only money
    // that arrived is "received with thanks"; a gift still waiting on M-Pesa
    // or one that failed says so, with why — it used to read "Received with
    // thanks … Official receipt" whatever had happened.
    const done = settled(t.status);
    const failure = t.status === "failed" ? giftFailureCopy(t.failure_code ?? "declined") : null;
    const feeCover = t.fee_cover_minor ? Number(t.fee_cover_minor) : 0;
    const total = Number(t.amount_minor);
    return renderReceiptPdf({
      congregation: me?.congregation ?? "Nuru Place Church",
      member: me?.full_name ?? "",
      ref,
      headline: done
        ? "Received with thanks"
        : t.status === "failed" ? "This gift did not go through"
          : t.status === "refunded" ? "This gift was refunded"
            : "Waiting for the payment to clear",
      notice: failure ? `${failure.reason} ${failure.hint}` : null,
      official: done,
      amountLabel: money(total),
      fund,
      giftName: t.account_name,
      pledgeTitle,
      needTitle: t.need_title,
      methodLabel: giftMethodLabel(method, t.office_channel),
      statusLabel: settled(t.status) ? "Completed" : t.status[0]!.toUpperCase() + t.status.slice(1),
      giftLabel: feeCover > 0 ? money(total - feeCover) : null,
      feeLabel: feeCover > 0 ? `${money(feeCover)} covered by you` : "none",
      totalLabel: money(total),
      initiatedAt: stamp(t.created_at),
      settledAt: t.settled_at ? stamp(t.settled_at) : null,
      generatedAt: new Date().toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" }),
    });
  }

  // ---------------- Recurring giving (Contract Matrix B7) ----------------
  // The member manages the schedule ONLINE (money is never queued offline,
  // §3.6); the server-side scheduler is what creates each cycle's intent (§1.1).

  static readonly CreateSchedule = z.object({
    fund: z.string().min(2).max(40),
    amount_minor: z.number().int().positive(),
    currency: z.string().length(3),
    frequency: z.enum(["weekly", "monthly"]),
    // Recurring gifts run on mobile money (a card or PayPal schedule could
    // never be charged — the card needs the member present, and the PayPal
    // column was never allowed in the table). Default = M-Pesa.
    method: z.enum(["card", "mpesa", "airtel", "paypal"]).default("mpesa"),
    idempotency_key: z.string().min(8).max(255).optional(),
    /** Bind this schedule to a pledge: every charge it makes is attributed. */
    pledge_id: z.string().uuid().nullish(),
    /** The number to prompt each cycle; absent = the member's profile number. */
    phone_number: z.string().min(7).max(32).nullish(),
    /** "Give now and every week/month" (Giving Cycle 4): the first prompt goes
     *  out now, while the member is in the app; "next" waits for the next
     *  cycle (the old behaviour, still the default for old clients). */
    first_charge: z.enum(["now", "next"]).default("next"),
    /** A push minutes before each prompt (default on). */
    heads_up: z.boolean().default(true),
  });

  static readonly UpdateSchedule = z.object({
    amount_minor: z.number().int().positive().optional(),
    /** Monthly: day of the month 1–31 (clamped to short months). Weekly: day
     *  of the week 0–6, Sunday = 0. The next prompt moves to that day. */
    day: z.number().int().min(0).max(31).optional(),
    /** Another number to prompt; null = back to the profile number. */
    phone_number: z.string().min(7).max(32).nullable().optional(),
    heads_up: z.boolean().optional(),
  });

  static readonly PauseSchedule = z.object({
    /** Resume on its own on this Nairobi date (YYYY-MM-DD); absent = until resumed. */
    resume_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  });

  /** The pledge a gift counts toward. An explicit pledge must be the caller's
   *  own and active (422 otherwise); a charging schedule passes its binding. */
  private async resolvePledgeId(userId: string, explicit: string | null, scheduleId: string | null): Promise<string | null> {
    if (explicit) {
      const own = await maybeOne<{ pledge_id: string }>(
        this.pool,
        `SELECT pledge_id FROM pledges WHERE pledge_id = $1 AND user_id = $2 AND status IN ('active','paused')`,
        [explicit, userId],
      );
      if (!own) throw new ApiError("UNPROCESSABLE", "That pledge is not yours or is no longer open");
      return own.pledge_id;
    }
    if (scheduleId) {
      const bound = await maybeOne<{ pledge_id: string | null }>(
        this.pool, `SELECT pledge_id FROM giving_schedules WHERE schedule_id = $1`, [scheduleId],
      );
      return bound?.pledge_id ?? null;
    }
    return null;
  }

  /** A department need a gift goes to: approved and still open (422 otherwise). */
  /** The fund a need's money belongs to: its department's `fund_code`, when
   *  that names an active fund. Null means "no opinion" — callers fall back
   *  to the gift's own fund or the programme default. One rule for gifts,
   *  pledge schedules and confirmed claims, so a need never splits across funds
   *  by client. */
  async needFundCode(needId: string | null, q: Queryable = this.pool): Promise<string | null> {
    if (!needId) return null;
    const r = await maybeOne<{ code: string }>(
      q,
      `SELECT f.code FROM department_needs n
         JOIN departments d ON d.department_id = n.department_id
         JOIN funds f ON f.code = d.fund_code AND f.is_active
        WHERE n.need_id = $1`,
      [needId],
    );
    return r?.code ?? null;
  }

  /** The fund a pledge's money belongs to — ONE rule for a gift made from a
   *  pledge, the schedule that charges it, and a confirmed "I paid another
   *  way" claim, so a pledge never splits across funds by client. The pledge's
   *  own fund, else its campaign's, else its need's department's (active only),
   *  else the programme default when that is an active fund, else the first
   *  active fund by code — the SQL rule in constants.ts that every pledge's
   *  `pays_to` reads too, so what a pledge says it pays to is where its money
   *  goes. 404 when the pledge does not exist; 422 when no fund is active.
   *  `q` lets a caller read it inside its own transaction (finance books). */
  async pledgeFundCode(pledgeId: string, q: Queryable = this.pool): Promise<string> {
    const p = await maybeOne<{ code: string | null }>(
      q,
      `SELECT ${PLEDGE_PAYS_TO_CODE} AS code FROM pledges p ${PLEDGE_PAYS_TO_JOINS} WHERE p.pledge_id = $1`,
      [pledgeId],
    );
    if (!p) throw new ApiError("NOT_FOUND", "Pledge not found");
    if (!p.code) throw new ApiError("UNPROCESSABLE", "No active fund can receive pledge gifts");
    return p.code;
  }

  private async resolveNeedId(explicit: string | null): Promise<string | null> {
    if (!explicit) return null;
    const open = await maybeOne<{ need_id: string }>(
      this.pool, `SELECT need_id FROM department_needs WHERE need_id = $1 AND status = 'approved'`, [explicit],
    );
    if (!open) throw new ApiError("UNPROCESSABLE", "That need is not open for giving");
    return open.need_id;
  }

  /** Africa/Nairobi is UTC+3 all year (no DST). */
  static readonly EAT_MS = 3 * 3_600_000;
  /** Prompts go out 07:00–21:00 Nairobi — the platform's quiet hours are
   *  21:00–07:00 for every nudge, and a PIN prompt is the loudest nudge. */
  static readonly PROMPT_FROM_HOUR = 7;
  static readonly PROMPT_UNTIL_HOUR = 21;

  /**
   * The next occurrence of a cadence after `from` (Giving Cycle 2). Weekly is
   * +7 days (no DST, so the wall-clock time holds). Monthly is computed on the
   * NAIROBI calendar, keeping the gift's own day of the month (`anchorDay`,
   * default `from`'s day) clamped to short months — 31 Jan → 28/29 Feb →
   * 31 Mar — at the same Nairobi time of day. It used to be setUTCMonth on a
   * UTC instant: a gift on the 31st jumped to the 3rd of the month after next,
   * and one set up at 01:00 EAT on the 1st (22:00 UTC the day before) crept
   * back a day every month.
   */
  static nextRun(from: Date, frequency: "weekly" | "monthly", anchorDay?: number | null): Date {
    if (frequency === "weekly") return new Date(from.getTime() + 7 * 86_400_000);
    const eat = new Date(from.getTime() + FinancialService.EAT_MS);
    const y = eat.getUTCFullYear();
    const m = eat.getUTCMonth();
    const anchor = anchorDay && anchorDay >= 1 && anchorDay <= 31 ? anchorDay : eat.getUTCDate();
    const lastDayNext = new Date(Date.UTC(y, m + 2, 0)).getUTCDate();
    const wall = Date.UTC(
      y, m + 1, Math.min(anchor, lastDayNext),
      eat.getUTCHours(), eat.getUTCMinutes(), eat.getUTCSeconds(), eat.getUTCMilliseconds(),
    );
    return new Date(wall - FinancialService.EAT_MS);
  }

  /** `at` kept on its own Nairobi day but inside prompt hours: before 07:00 →
   *  07:00, from 21:00 → 20:00. A weekly gift keeps its weekday. */
  static sameDayPromptHours(at: Date): Date {
    const eat = new Date(at.getTime() + FinancialService.EAT_MS);
    const h = eat.getUTCHours();
    if (h >= FinancialService.PROMPT_FROM_HOUR && h < FinancialService.PROMPT_UNTIL_HOUR) return at;
    const wall = Date.UTC(
      eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate(),
      h < FinancialService.PROMPT_FROM_HOUR ? FinancialService.PROMPT_FROM_HOUR : FinancialService.PROMPT_UNTIL_HOUR - 1, 0, 0, 0,
    );
    return new Date(wall - FinancialService.EAT_MS);
  }

  /** Today's day of the month in Nairobi — a monthly gift's anchor. */
  static eatDay(at: Date): number {
    return new Date(at.getTime() + FinancialService.EAT_MS).getUTCDate();
  }

  /** A Nairobi date (YYYY-MM-DD) at `timeOf`'s Nairobi time of day, in
   *  prompt hours — a pledge's first collection (Giving Cycle 5). */
  static onDayAt(ymd: string, timeOf: Date): Date {
    const t = new Date(timeOf.getTime() + FinancialService.EAT_MS);
    const wall = Date.parse(`${ymd}T00:00:00Z`) + (t.getUTCHours() * 60 + t.getUTCMinutes()) * 60_000;
    return FinancialService.sameDayPromptHours(new Date(wall - FinancialService.EAT_MS));
  }

  /** "5 October" (with the year when it is not this one) for a Nairobi date. */
  static dayWords(ymd: string, now: Date = new Date()): string {
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const [y, m, d] = ymd.split("-").map(Number);
    const words = `${d} ${months[(m ?? 1) - 1]}`;
    return String(y) === nairobiDate(now).slice(0, 4) ? words : `${words} ${y}`;
  }

  /** What can be charged every cycle (Giving Cycle 1): a live mobile-money
   *  rail, its currency, its limits, whole shillings, and a real number. The
   *  Partners programme checks a pledge's automatic collection with this
   *  BEFORE making the pledge (Giving Cycle 5), so a refusal never leaves
   *  half a pledge behind. */
  async validateSchedule(
    userId: string,
    method: keyof typeof FinancialService.RAILS,
    amountMinor: number,
    currency: string,
    phoneNumber: string | null,
  ): Promise<{ phone: string | null }> {
    const rail = FinancialService.RAILS[method];
    if (!rail.recurring || !this.railEnabled(method)) {
      throw new ApiError(
        "METHOD_UNAVAILABLE",
        "Recurring gifts are collected with M-Pesa. Choose M-Pesa to set one up.",
        { method },
      );
    }
    return this.checkGift(userId, method, amountMinor, currency.toUpperCase(), phoneNumber, false);
  }

  /** A request that lost a same-key race to itself: the member's first row,
   *  as a replay — or, if the key is someone else's, a conflict. */
  private async keyReplay(userId: string, key: string): Promise<Record<string, unknown>> {
    const first = await maybeOne<{ transaction_id: string; status: string; provider: string | null; provider_ref: string | null }>(
      this.pool, `SELECT transaction_id, status, provider, provider_ref FROM transactions WHERE idempotency_key = $1 AND user_id = $2`, [key, userId],
    );
    if (!first) throw new ApiError("CONFLICT", "That request key is already in use. Try again.", { fields: [{ path: "idempotency_key", message: "in use" }] });
    return { transaction_id: first.transaction_id, status: first.status, provider: first.provider, provider_ref: first.provider_ref, idempotency_key: key, reused: true };
  }

  /** Server-made keys (schedule cycles, confirmed claims, website and office
   *  rows); a member's own key may not take their shape (Giving Cycle 6). */
  static readonly RESERVED_KEY = /^(sched|claim|pledge|web|website|office):/i;

  /** `transactions.idempotency_key` is unique across ALL givers: a key some
   *  other row holds is refused as a conflict, before any phone rings or
   *  order is made — it used to surface as a 500 after the fact. */
  private async assertKeyFree(q: Queryable, key: string): Promise<void> {
    const taken = await maybeOne<{ n: number }>(q, `SELECT 1 AS n FROM transactions WHERE idempotency_key = $1`, [key]);
    if (taken) throw new ApiError("CONFLICT", "That request key is already in use. Try again.", { fields: [{ path: "idempotency_key", message: "in use" }] });
  }

  /**
   * A prompt to a number that is not the member's own (Giving Cycle 6). The
   * app used to ring ANY Kenyan number every 90 seconds — the harassment the
   * website's donate button was built to stop. Such a prompt spends the SAME
   * per-number bucket as the website (three, then one every ten minutes), so
   * the two can't be combined, and a per-member bucket (five, then one every
   * half hour) so one account can't work through a list of strangers. The
   * member's own profile number is never limited here — the one-prompt-at-a-
   * time rule already paces it. No store (a bare service in tests) = no limit.
   */
  private async limitPromptTo(c: Queryable, userId: string, phone: string): Promise<void> {
    const store = this.options.promptLimiter;
    if (!store) return;
    // On the claim's own connection: a second pool connection inside the
    // locked claim could starve the pool when many members give at once.
    const own = await maybeOne<{ phone_number: string | null }>(c, `SELECT phone_number FROM users WHERE user_id = $1`, [userId]);
    if (kenyanMobileNumber(own?.phone_number ?? null) === phone) return;
    const refuse = (retryAfterSec: number): never => {
      const minutes = Math.max(1, Math.ceil(retryAfterSec / 60));
      throw new ApiError(
        "RATE_LIMITED",
        `We've sent several prompts to that number just now. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or give from your own number.`,
        { retry_after_sec: retryAfterSec },
      );
    };
    const member = await store.consume(`give:others:${userId}`, FinancialService.OTHERS_BURST, FinancialService.OTHERS_REFILL_PER_SEC);
    if (!member.allowed) refuse(member.retryAfterSec);
    // website.ts keys this bucket by toMsisdn (254…, no plus): the same key.
    const number = await store.consume(`webgive:phone:${toMsisdn(phone)}`, FinancialService.PHONE_BURST, FinancialService.PHONE_REFILL_PER_SEC);
    if (!number.allowed) refuse(number.retryAfterSec);
  }
  /** One number: three prompts, then one every ten minutes (website.ts's rule). */
  static readonly PHONE_BURST = 3;
  static readonly PHONE_REFILL_PER_SEC = 1 / 600;
  /** One member, numbers not their own: five, then one every half hour. */
  static readonly OTHERS_BURST = 5;
  static readonly OTHERS_REFILL_PER_SEC = 1 / 1800;

  /** What a gift pays toward is counted in ITS currency (Giving Cycle 5): a
   *  USD gift toward a KES pledge used to add its cents to the shillings (and
   *  a need's raised figure the same). The office's record-a-gift already
   *  refused this (books.ts); the member's own gift did not. */
  private async assertSameCurrency(currency: string, pledgeId: string | null, needId: string | null): Promise<void> {
    if (pledgeId) {
      const p = await maybeOne<{ currency: string }>(this.pool, `SELECT currency FROM pledges WHERE pledge_id = $1`, [pledgeId]);
      const want = p?.currency.trim();
      if (want && want !== currency) {
        throw new ApiError("CURRENCY_MISMATCH", `This pledge is in ${want}. Give toward it in ${want}.`, { expected: want });
      }
    }
    if (needId) {
      const n = await maybeOne<{ currency: string }>(this.pool, `SELECT currency FROM department_needs WHERE need_id = $1`, [needId]);
      const want = n?.currency.trim();
      if (want && want !== currency) {
        throw new ApiError("CURRENCY_MISMATCH", `This need is in ${want}. Give toward it in ${want}.`, { expected: want });
      }
    }
  }

  /**
   * One cycle of a schedule that pays a pledge (Giving Cycle 5). The schedule
   * is the pledge's collector, so a cycle asks for what the pledge still owes
   * BEFORE THE NEXT CYCLE — a monthly pledge's uncovered instalments due until
   * then (its one instalment ledger, arrears included), a total pledge's rest
   * of the target — never more than the schedule's own amount, rounded up to
   * whole shillings on M-Pesa. Nothing, when the member already paid (Pay
   * now, a claim the office confirmed): the cycle is skipped and they are
   * told. A pledge that is fulfilled, cancelled or past its end stops the
   * schedule; one that is paused pauses it; a total pledge that reached its
   * target is fulfilled here. It used to charge the schedule's amount every
   * cycle regardless — past the target, past the end date, on top of a
   * manual payment. Null = not bound to a pledge (charge as set). Counts only
   * succeeded money, as every pledge surface does; a prompt still on the
   * phone is kept apart by the runner's one-prompt-per-phone rule.
   */
  async pledgeCyclePlan(scheduleId: string, cycleAt: Date): Promise<PledgeCyclePlan | null> {
    const row = await maybeOne<{
      amount_minor: string; currency: string; method: keyof typeof FinancialService.RAILS; frequency: "weekly" | "monthly"; anchor_day: number | null;
      pledge_id: string; shape: "monthly" | "total"; p_amount: string | null; target: string | null; p_currency: string;
      p_status: "active" | "paused" | "fulfilled" | "cancelled"; due_day: number | null; due_on: string | null; until_on: string | null;
      starts_on: string | null; created_at: string;
    }>(
      this.pool,
      `SELECT s.amount_minor::text, s.currency, s.method::text AS method, s.frequency::text AS frequency, s.anchor_day,
              p.pledge_id, p.shape::text AS shape, p.amount_minor::text AS p_amount, p.target_minor::text AS target,
              p.currency AS p_currency, p.status::text AS p_status, p.due_day, p.due_on::text, p.until_on::text,
              p.starts_on::text, p.created_at::text
         FROM giving_schedules s JOIN pledges p ON p.pledge_id = s.pledge_id
        WHERE s.schedule_id = $1`,
      [scheduleId],
    );
    if (!row) return null;
    // A binding across currencies is refused at the door now; one made before
    // is left to createGivingIntent to refuse, never counted in the wrong unit.
    if (row.p_currency.trim() !== row.currency.trim()) return null;
    const title = (await pledgeTitleFor(this.pool, row.pledge_id)) ?? "your pledge";
    const base = { pledge_id: row.pledge_id, title };
    if (row.p_status === "fulfilled") return { action: "stop", reason: "pledge_fulfilled", until_on: row.until_on, ...base };
    if (row.p_status === "cancelled") return { action: "stop", reason: "pledge_cancelled", until_on: row.until_on, ...base };
    if (row.p_status === "paused") return { action: "pause", ...base };

    const cycleDay = nairobiDate(cycleAt);
    const paid = await many<{ transaction_id: string; amount_minor: string; at: string }>(
      this.pool,
      `SELECT transaction_id, amount_minor::text, created_at::text AS at FROM transactions
        WHERE pledge_id = $1 AND status = 'succeeded' ORDER BY created_at, transaction_id`,
      [row.pledge_id],
    );
    const payments: LedgerPaymentInput[] = paid.map((x) => ({ transaction_id: x.transaction_id, pledge_id: row.pledge_id, amount_minor: Number(x.amount_minor), at: x.at }));
    const scheduleAmount = Number(row.amount_minor);
    let owed: number;
    if (row.shape === "total") {
      owed = Math.max(0, Number(row.target ?? 0) - payments.reduce((a, x) => a + x.amount_minor, 0));
      if (owed === 0) return { action: "fulfil", ...base };
    } else {
      if (row.until_on && cycleDay > row.until_on) return { action: "stop", reason: "pledge_ended", until_on: row.until_on, ...base };
      const nextCycleDay = nairobiDate(FinancialService.nextRun(cycleAt, row.frequency, row.anchor_day));
      const ledger = allocateInstalments(
        {
          pledge_id: row.pledge_id, shape: "monthly", amount_minor: Number(row.p_amount ?? 0), target_minor: null,
          status: row.p_status, due_day: row.due_day, due_on: row.due_on, created_at: row.created_at,
          starts_on: row.starts_on, until_on: row.until_on,
        },
        payments, cycleDay, nextCycleDay,
      );
      owed = ledger.filter((i) => i.due < nextCycleDay).reduce((a, i) => a + (i.amount_minor - i.covered_minor), 0);
      if (owed === 0) {
        // Paid through this cycle (paid ahead, or to its end): skip it. A
        // pledge paid to its end is skipped until the end passes, then stops.
        return { action: "skip", covered_through: ledger.filter((i) => i.completed_on !== null).at(-1)?.due ?? null, ...base };
      }
    }
    const rounded = FinancialService.RAILS[row.method]?.whole_units ? Math.ceil(owed / 100) * 100 : owed;
    return { action: "charge", amount_minor: Math.min(scheduleAmount, rounded), owed_minor: owed, ...base };
  }

  /** Carry out a plan that is not a charge (runner, Giving Cycle 5). */
  private async applyPledgePlan(
    s: { schedule_id: string; user_id: string; amount_minor: string; currency: string; frequency: "weekly" | "monthly"; next_run_at: Date; anchor_day: number | null },
    plan: Exclude<PledgeCyclePlan, { action: "charge" }>,
    regular: boolean,
    now: Date,
  ): Promise<void> {
    if (plan.action === "fulfil") {
      // Flips the pledge, stops every schedule paying it, and thanks the member once.
      await new PartnersService(this.pool).fulfilOne(this.notifications, plan.pledge_id, now);
      return;
    }
    if (plan.action === "pause") {
      await this.pool.query(
        `UPDATE giving_schedules SET status = 'paused', paused_at = $2, pause_reason = 'pledge',
                retry_cycle_at = NULL, retry_at = NULL, retry_after = NULL
          WHERE schedule_id = $1 AND status = 'active'`,
        [s.schedule_id, now.toISOString()],
      );
      return;
    }
    if (plan.action === "stop") {
      const stopped = await this.pool.query(
        `UPDATE giving_schedules SET status = 'cancelled', cancelled_at = $2,
                retry_cycle_at = NULL, retry_at = NULL, retry_after = NULL
          WHERE schedule_id = $1 AND status = 'active'`,
        [s.schedule_id, now.toISOString()],
      );
      if (!stopped.rowCount) return;
      await audit(this.pool, s.user_id, "giving.schedule_stopped", "giving_schedules", s.schedule_id, { reason: plan.reason, pledge_id: plan.pledge_id });
      try {
        await this.notifications.schedule({
          userId: s.user_id, channel: "push", template: "giving_schedule_stopped",
          payload: {
            schedule_id: s.schedule_id, pledge_id: plan.pledge_id, title: plan.title, reason: plan.reason,
            until_on: plan.until_on, amount_minor: Number(s.amount_minor), currency: s.currency, frequency: s.frequency,
          },
        });
      } catch {
        /* the stop matters more than the notice */
      }
      return;
    }
    // skip — the pledge is paid for this cycle.
    if (!regular) {
      // The retry's cycle has been paid since it failed: nothing to retry.
      await this.pool.query(`UPDATE giving_schedules SET retry_cycle_at = NULL, retry_at = NULL WHERE schedule_id = $1`, [s.schedule_id]);
      return;
    }
    const next = FinancialService.sameDayPromptHours(FinancialService.nextRun(new Date(s.next_run_at), s.frequency, s.anchor_day));
    await this.pool.query(
      `UPDATE giving_schedules
          SET next_run_at = $2, retry_after = NULL, retry_cycle_at = NULL, retry_at = NULL, cycle_attempts = 0,
              consecutive_failures = 0, last_error = NULL, last_failed_at = NULL, last_failure_code = NULL
        WHERE schedule_id = $1`,
      [s.schedule_id, next.toISOString()],
    );
    try {
      await this.notifications.schedule({
        userId: s.user_id, channel: "push", template: "giving_schedule_covered",
        payload: {
          schedule_id: s.schedule_id, pledge_id: plan.pledge_id, title: plan.title, frequency: s.frequency,
          currency: s.currency, covered_through: plan.covered_through, next_prompt_at: next.toISOString(),
        },
      });
    } catch {
      /* a missed notice never blocks the ledger */
    }
  }

  async createSchedule(
    userId: string,
    raw: z.input<typeof FinancialService.CreateSchedule>,
    /** The Partners programme only: a pledge's automatic collection falls on
     *  the pledge's due day, from its first due date (never today). */
    opts: { anchorDay?: number; firstRunOn?: string } = {},
  ): Promise<Record<string, unknown>> {
    // Direct callers (the Partners programme's "charge me automatically")
    // may leave the defaults out; the route has already applied them.
    const input = {
      ...raw,
      method: raw.method ?? "mpesa",
      first_charge: raw.first_charge ?? "next",
      heads_up: raw.heads_up ?? true,
    } as z.infer<typeof FinancialService.CreateSchedule>;
    const key = input.idempotency_key ?? randomUUID();
    const existing = await maybeOne<{ schedule_id: string; status: string; next_run_at: string }>(
      this.pool,
      `SELECT schedule_id, status, next_run_at FROM giving_schedules WHERE idempotency_key = $1 AND user_id = $2`,
      [key, userId],
    );
    if (existing) return { ...existing, reused: true };

    const currency = input.currency.toUpperCase();
    const { phone } = await this.validateSchedule(userId, input.method, input.amount_minor, currency, input.phone_number ?? null);
    // Store a number only when the member chose one for THIS gift; otherwise
    // every cycle follows their profile number, so a changed number is used.
    const schedulePhone = input.phone_number ? phone : null;
    const giveNow = input.first_charge === "now";
    if (giveNow) {
      // The first prompt would collide with one already on the phone.
      const inflight = await maybeOne<{ transaction_id: string }>(
        this.pool,
        `SELECT transaction_id FROM transactions
          WHERE user_id = $1 AND provider IN ('mpesa','airtel') AND status = 'processing'
            AND created_at > now() - interval '90 seconds' LIMIT 1`,
        [userId],
      );
      if (inflight) {
        throw new ApiError(
          "GIFT_IN_PROGRESS",
          "A prompt from a moment ago is still waiting on your phone. Approve it, or wait a minute and try again.",
          { transaction_id: inflight.transaction_id },
        );
      }
    }

    // A schedule started for a pledge is bound to it (ownership checked), and
    // is STORED on the pledge's fund — the same one every charge it makes
    // lands in (createGivingIntent routes by the binding) — so the schedules
    // rail and the schedule detail never show a fund the money does not go to.
    // Without a pledge, the client's fund stands.
    const boundPledge = await this.resolvePledgeId(userId, input.pledge_id ?? null, null);
    await this.assertSameCurrency(currency, boundPledge, null);
    const fundCode = boundPledge ? await this.pledgeFundCode(boundPledge) : input.fund;
    const fund = await maybeOne<{ fund_id: string; name: string }>(
      this.pool,
      `SELECT fund_id, name FROM funds WHERE code = $1 AND is_active`,
      [fundCode],
    );
    if (!fund) throw new ApiError("VALIDATION_FAILED", "Unknown or inactive fund");

    const created = await tx(this.pool, async (c) => {
      // One schedule decision per member at a time: two taps with two fresh
      // keys (production has two such pairs — two identical prompts to one
      // phone every week, each making the other fail as "busy") serialise
      // here, and the second finds the first.
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`giving_schedule:${userId}`]);
      const twin = await maybeOne<{ schedule_id: string; status: string; next_run_at: string; fresh: boolean }>(
        c,
        `SELECT schedule_id, status, next_run_at, (created_at > now() - interval '10 minutes') AS fresh
           FROM giving_schedules
          WHERE user_id = $1 AND fund_id = $2 AND amount_minor = $3 AND currency = $4
            AND frequency = $5 AND method = $6 AND pledge_id IS NOT DISTINCT FROM $7
            AND status IN ('active', 'paused')
          ORDER BY created_at DESC LIMIT 1`,
        [userId, fund.fund_id, input.amount_minor, currency, input.frequency, input.method, boundPledge],
      );
      if (twin?.fresh) {
        // The same gift a moment ago: the SAME schedule, not a second one.
        return { schedule_id: twin.schedule_id, status: twin.status, next_run_at: twin.next_run_at, reused: true, duplicate_of: twin.schedule_id };
      }
      if (twin) {
        throw new ApiError(
          "SCHEDULE_EXISTS",
          `You already give ${moneyWords(input.amount_minor, currency)} ${input.frequency === "weekly" ? "every week" : "every month"} to ${fund.name}. Change that gift instead of adding a second one.`,
          { schedule_id: twin.schedule_id, status: twin.status },
        );
      }
      // First charge on the next cycle boundary; give now if you want to give
      // now. Monthly gifts keep today's Nairobi day as their anchor; the
      // prompt time is today's, kept inside prompt hours (Giving Cycle 2).
      const now = new Date();
      const anchor = input.frequency === "monthly" ? (opts.anchorDay ?? FinancialService.eatDay(now)) : null;
      // A pledge's automatic collection starts on its first due day (Giving
      // Cycle 5): it used to start a month from today and then fall on
      // today's date every month — not the due day both apps promise.
      const firstRun = opts.firstRunOn
        ? FinancialService.onDayAt(opts.firstRunOn, now)
        : FinancialService.nextRun(FinancialService.sameDayPromptHours(now), input.frequency, anchor);
      const row = await one<{ schedule_id: string; next_run_at: string }>(
        c,
        `INSERT INTO giving_schedules (user_id, fund_id, amount_minor, currency, frequency, method, next_run_at, idempotency_key, pledge_id, phone_number, anchor_day, heads_up)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING schedule_id, next_run_at`,
        [userId, fund.fund_id, input.amount_minor, currency, input.frequency, input.method, firstRun.toISOString(), key, boundPledge, schedulePhone, anchor, input.heads_up],
      );
      if (boundPledge) {
        await c.query(`UPDATE pledges SET schedule_id = $1, updated_at = now() WHERE pledge_id = $2 AND schedule_id IS NULL`, [row.schedule_id, boundPledge]);
      }
      return { schedule_id: row.schedule_id, status: "active", next_run_at: row.next_run_at, reused: false };
    });
    if (!created.reused) {
      await audit(this.pool, userId, "giving.schedule_created", "giving_schedules", created.schedule_id, {
        fund: fundCode,
        amount_minor: input.amount_minor,
        frequency: input.frequency,
        method: input.method,
        first_charge: input.first_charge,
      });
    }
    if (!giveNow) return created;
    // Give now (Giving Cycle 4): the first prompt goes out while the member is
    // looking at the screen — the moment they are most likely to approve it —
    // as this schedule's first cycle, so its outcome counts like any other.
    // Its key is fixed per schedule, so a double tap (or the reused twin)
    // finds the same prompt instead of sending another.
    const firstKey = `sched:${created.schedule_id}:first`;
    let firstAmount = input.amount_minor;
    if (boundPledge) {
      // A pledge's schedule asks for what the pledge owes now (Giving Cycle 5).
      // A replay finds its prompt by key and needs no plan.
      const prior = await maybeOne<{ n: number }>(this.pool, `SELECT 1 AS n FROM transactions WHERE idempotency_key = $1 AND user_id = $2`, [firstKey, userId]);
      const plan = prior ? null : await this.pledgeCyclePlan(created.schedule_id, new Date());
      if (plan && plan.action !== "charge") {
        return {
          ...created,
          first_charge: null,
          first_charge_error: plan.action === "skip"
            ? `Nothing is due on your pledge right now${plan.covered_through ? ` — it's paid through ${FinancialService.dayWords(plan.covered_through)}` : ""}. Your first prompt comes when the next payment is due.`
            : "Your pledge isn't open for payments right now.",
        };
      }
      if (plan) firstAmount = plan.amount_minor;
    }
    try {
      const first = await this.createGivingIntent(
        userId,
        {
          fund: fundCode, amount_minor: firstAmount, currency, method: input.method,
          idempotency_key: firstKey,
        },
        created.schedule_id,
        { cycleAt: new Date().toISOString(), phone: schedulePhone ?? phone, watched: true },
      );
      return { ...created, first_charge: first };
    } catch (err) {
      // The schedule stands; only today's prompt could not go out. Say so —
      // the member can give once now, and the rhythm starts next cycle.
      return {
        ...created,
        first_charge: null,
        first_charge_error: err instanceof ApiError ? err.message : "Today's prompt could not be sent.",
      };
    }
  }

  /**
   * The member pauses their own recurring gift (Giving Cycle 4) — "this month
   * is tight" — optionally until a date, when it resumes on its own at its
   * next occurrence. Only an active schedule; a date must be tomorrow or later
   * and within a year (Nairobi).
   */
  async pauseSchedule(userId: string, scheduleId: string, input: z.infer<typeof FinancialService.PauseSchedule>): Promise<Record<string, unknown>> {
    const resumeOn = input.resume_on ?? null;
    if (resumeOn) {
      const today = nairobiDate(new Date());
      const limit = nairobiDate(new Date(Date.now() + 366 * 86_400_000));
      if (resumeOn <= today || resumeOn > limit) {
        throw new ApiError("VALIDATION_FAILED", "Choose a date from tomorrow to a year from now.", { resume_on: resumeOn });
      }
    }
    const row = await maybeOne<{ schedule_id: string }>(
      this.pool,
      `UPDATE giving_schedules
          SET status = 'paused', paused_at = now(), pause_reason = 'member', resume_on = $3,
              retry_cycle_at = NULL, retry_at = NULL, retry_after = NULL
        WHERE schedule_id = $1 AND user_id = $2 AND status = 'active'
        RETURNING schedule_id`,
      [scheduleId, userId, resumeOn],
    );
    if (!row) throw new ApiError("NOT_FOUND", "Active schedule not found");
    await audit(this.pool, userId, "giving.schedule_paused", "giving_schedules", scheduleId, { resume_on: resumeOn });
    return { schedule_id: scheduleId, status: "paused", pause_reason: "member", resume_on: resumeOn };
  }

  /**
   * Change a recurring gift instead of cancelling it and starting another
   * (Giving Cycle 4 — SCHEDULE_EXISTS tells the member to do exactly this):
   * the amount (from the next cycle), the day, the number, the heads-up. Every
   * Cycle 1 check runs on the new amount and number; an amount that would make
   * it the twin of another of their gifts is SCHEDULE_EXISTS.
   */
  async updateSchedule(
    userId: string,
    scheduleId: string,
    patch: z.infer<typeof FinancialService.UpdateSchedule>,
    /** The pledge itself is moving its collection (PartnersService.updatePledge). */
    opts: { fromPledge?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    const s = await maybeOne<{
      fund_id: string; fund_name: string; amount_minor: string; currency: string; frequency: "weekly" | "monthly";
      method: "mpesa" | "airtel" | "card" | "paypal"; next_run_at: Date; anchor_day: number | null; pledge_id: string | null;
      phone_number: string | null; status: string;
    }>(
      this.pool,
      `SELECT s.fund_id, f.name AS fund_name, s.amount_minor, s.currency, s.frequency, s.method, s.next_run_at,
              s.anchor_day, s.pledge_id, s.phone_number, s.status
         FROM giving_schedules s JOIN funds f ON f.fund_id = s.fund_id
        WHERE s.schedule_id = $1 AND s.user_id = $2 AND s.status IN ('active', 'paused')`,
      [scheduleId, userId],
    );
    if (!s) throw new ApiError("NOT_FOUND", "Schedule not found");
    // A monthly pledge's automatic collection IS the pledge's amount on the
    // pledge's due day (Giving Cycle 5): it follows the pledge, never the
    // other way round — a schedule changed on its own drifted from its pledge
    // and left it behind or overpaid every month.
    const amountChange = patch.amount_minor !== undefined && patch.amount_minor !== Number(s.amount_minor);
    if (!opts.fromPledge && s.pledge_id && (amountChange || patch.day !== undefined)) {
      const bound = await maybeOne<{ shape: string }>(this.pool, `SELECT shape FROM pledges WHERE pledge_id = $1`, [s.pledge_id]);
      if (bound?.shape === "monthly") {
        const title = (await pledgeTitleFor(this.pool, s.pledge_id)) ?? "your pledge";
        throw new ApiError(
          "UNPROCESSABLE",
          `This gift collects your pledge “${title}”. Change the pledge's ${amountChange ? "amount" : "due day"} and this gift follows it.`,
          { pledge_id: s.pledge_id },
        );
      }
    }
    const sets: string[] = [];
    const vals: unknown[] = [scheduleId];
    const set = (col: string, v: unknown): void => { vals.push(v); sets.push(`${col} = $${vals.length}`); };

    if (patch.amount_minor !== undefined && patch.amount_minor !== Number(s.amount_minor)) {
      await this.checkGift(userId, s.method, patch.amount_minor, s.currency, s.phone_number, false);
      const twin = await maybeOne<{ schedule_id: string }>(
        this.pool,
        `SELECT schedule_id FROM giving_schedules
          WHERE user_id = $1 AND schedule_id <> $2 AND fund_id = $3 AND amount_minor = $4 AND currency = $5
            AND frequency = $6 AND method = $7 AND pledge_id IS NOT DISTINCT FROM $8 AND status IN ('active','paused')
          LIMIT 1`,
        [userId, scheduleId, s.fund_id, patch.amount_minor, s.currency, s.frequency, s.method, s.pledge_id],
      );
      if (twin) {
        throw new ApiError("SCHEDULE_EXISTS", `You already give ${moneyWords(patch.amount_minor, s.currency)} ${s.frequency === "weekly" ? "every week" : "every month"} to ${s.fund_name}.`, { schedule_id: twin.schedule_id });
      }
      set("amount_minor", patch.amount_minor);
    }
    if (patch.phone_number !== undefined) {
      if (patch.phone_number === null) set("phone_number", null);
      else {
        const normalized = kenyanMobileNumber(patch.phone_number);
        if (!normalized) throw new ApiError("PHONE_REQUIRED", "That doesn't look like a Kenyan mobile number. Use 07XX XXX XXX or 01XX XXX XXX.");
        set("phone_number", normalized);
      }
    }
    if (patch.heads_up !== undefined) set("heads_up", patch.heads_up);
    if (patch.day !== undefined) {
      const now = new Date();
      if (s.frequency === "monthly") {
        if (patch.day < 1) throw new ApiError("VALIDATION_FAILED", "A monthly gift's day is 1–31.");
        set("anchor_day", patch.day);
        set("next_run_at", FinancialService.nextOnMonthDay(new Date(s.next_run_at), patch.day, now).toISOString());
      } else {
        if (patch.day > 6) throw new ApiError("VALIDATION_FAILED", "A weekly gift's day is 0–6 (Sunday = 0).");
        set("next_run_at", FinancialService.nextOnWeekday(new Date(s.next_run_at), patch.day, now).toISOString());
      }
      sets.push("retry_cycle_at = NULL", "retry_at = NULL", "cycle_attempts = 0", "heads_up_cycle_at = NULL");
    }
    if (sets.length === 0) return this.scheduleRow(userId, scheduleId);
    await this.pool.query(`UPDATE giving_schedules SET ${sets.join(", ")} WHERE schedule_id = $1`, vals);
    await audit(this.pool, userId, "giving.schedule_updated", "giving_schedules", scheduleId, { ...patch });
    return this.scheduleRow(userId, scheduleId);
  }

  private async scheduleRow(userId: string, scheduleId: string): Promise<Record<string, unknown>> {
    const all = (await this.listSchedules(userId)).data as Array<{ schedule_id: string }>;
    return all.find((r) => r.schedule_id === scheduleId) ?? { schedule_id: scheduleId };
  }

  /** The next time a monthly gift falls on `day` (clamped to short months)
   *  after `now`, at `timeOf`'s Nairobi time of day, in prompt hours. */
  static nextOnMonthDay(timeOf: Date, day: number, now: Date): Date {
    const t = new Date(timeOf.getTime() + FinancialService.EAT_MS);
    // The pending gift moves within ITS OWN month (Giving Cycle 5): moving the
    // 5th to the 20th on the 10th used to prompt again on the 20th — twice in
    // a month already given. `timeOf` is the pending prompt.
    const pendingMonth = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1);
    const n = new Date(Math.max(now.getTime() + FinancialService.EAT_MS, pendingMonth));
    for (let add = 0; add < 3; add += 1) {
      const y = n.getUTCFullYear();
      const m = n.getUTCMonth() + add;
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const wall = Date.UTC(y, m, Math.min(day, last), t.getUTCHours(), t.getUTCMinutes(), 0, 0);
      const at = FinancialService.sameDayPromptHours(new Date(wall - FinancialService.EAT_MS));
      if (at.getTime() > now.getTime()) return at;
    }
    return FinancialService.nextRun(now, "monthly", day);
  }

  /** The next `weekday` (Sunday = 0) after `now`, at `timeOf`'s Nairobi time
   *  of day, in prompt hours. */
  static nextOnWeekday(timeOf: Date, weekday: number, now: Date): Date {
    const t = new Date(timeOf.getTime() + FinancialService.EAT_MS);
    // Within the pending gift's own week, Monday–Sunday in Nairobi (Giving
    // Cycle 5): Friday's gift moved to Sunday used to prompt again two days
    // after Friday's. `timeOf` is the pending prompt.
    const weekStart = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
    const n = new Date(Math.max(now.getTime() + FinancialService.EAT_MS, weekStart));
    for (let add = 0; add <= 7; add += 1) {
      const wall = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + add, t.getUTCHours(), t.getUTCMinutes(), 0, 0);
      const d = new Date(wall);
      if (d.getUTCDay() !== weekday) continue;
      const at = FinancialService.sameDayPromptHours(new Date(wall - FinancialService.EAT_MS));
      if (at.getTime() > now.getTime()) return at;
    }
    return new Date(now.getTime() + 7 * 86_400_000);
  }

  /**
   * A schedule coming back from a pause — its pledge resumed, or the member's
   * own pause ending — picks up at its next occurrence from NOW (Giving Cycle
   * 4). Resuming a paused pledge used to leave the old due date in place, so a
   * weekly gift resumed on a Tuesday charged the Sunday it had skipped, at
   * once and unannounced.
   */
  async rearmAfterPause(scheduleId: string, from: Date = new Date()): Promise<void> {
    const s = await maybeOne<{ next_run_at: Date; frequency: "weekly" | "monthly"; anchor_day: number | null }>(
      this.pool, `SELECT next_run_at, frequency, anchor_day FROM giving_schedules WHERE schedule_id = $1`, [scheduleId],
    );
    if (!s) return;
    const next = new Date(s.next_run_at).getTime() > from.getTime()
      ? new Date(s.next_run_at)
      : FinancialService.sameDayPromptHours(FinancialService.rollForward(new Date(s.next_run_at), s.frequency, from, s.anchor_day));
    await this.pool.query(
      `UPDATE giving_schedules
          SET status = 'active', paused_at = NULL, pause_reason = NULL, resume_on = NULL, consecutive_failures = 0,
              retry_after = NULL, retry_cycle_at = NULL, retry_at = NULL, cycle_attempts = 0,
              last_error = NULL, last_failed_at = NULL, last_failure_code = NULL, next_run_at = $2
        WHERE schedule_id = $1`,
      [scheduleId, next.toISOString()],
    );
  }

  async listSchedules(userId: string): Promise<{ data: unknown[] }> {
    const rows = await many<Record<string, unknown>>(
      this.pool,
      `SELECT s.schedule_id, f.code AS fund, s.amount_minor, s.currency, s.frequency, s.method,
              s.status, s.next_run_at, s.last_run_at, s.created_at,
              s.consecutive_failures, s.last_failed_at, s.paused_at,
              s.last_failure_code, s.retry_at, s.phone_number,
              s.pause_reason, s.resume_on::text AS resume_on, s.heads_up, s.anchor_day,
              s.pledge_id AS bound_pledge_id, ${pledgeTitleSql({ pledge: "p", fund: "pf", campaign: "pc" })} AS bound_pledge_title
         FROM giving_schedules s JOIN funds f ON f.fund_id = s.fund_id
         LEFT JOIN pledges p ON p.pledge_id = s.pledge_id
         LEFT JOIN funds pf ON pf.fund_id = p.fund_id
         LEFT JOIN campaigns pc ON pc.campaign_id = p.campaign_id
        WHERE s.user_id = $1 ORDER BY s.created_at DESC`,
      [userId],
    );
    const data: unknown[] = [];
    for (const r of rows) {
      const { last_failure_code: code, bound_pledge_id: pledgeId, bound_pledge_title: pledgeTitle, ...rest } = r;
      const amount = Number(r.amount_minor);
      // What the next prompt will ask for (Giving Cycle 5): a schedule that
      // pays a pledge asks only what the pledge still owes — 0 when it is
      // covered; null when nothing is coming (paused, cancelled, stopping).
      let next: number | null = r.status === "active" ? amount : null;
      if (pledgeId && r.status === "active") {
        const plan = await this.pledgeCyclePlan(r.schedule_id as string, new Date(r.next_run_at as string));
        next = !plan ? amount : plan.action === "charge" ? plan.amount_minor : plan.action === "skip" ? 0 : null;
      }
      data.push({
        ...rest,
        amount_minor: amount,
        // The last charge's reason while the schedule is still failing.
        last_failure: Number(r.consecutive_failures) > 0 ? giftFailureCopy((code as string | null) ?? "declined") : null,
        pledge: pledgeId ? { pledge_id: pledgeId, title: pledgeTitle ?? "Your pledge" } : null,
        next_amount_minor: next,
      });
    }
    return { data };
  }

  /**
   * A member's standing as a PARTNER — someone who decided in advance to keep
   * giving, rather than someone who gave once.
   *
   * Nothing here is new money machinery. A partner IS an active or paused
   * giving_schedule; this derives the standing rather than storing it, so a
   * paused schedule and a lapsed partner can never disagree with each other.
   *
   * TWO HONESTY RULES, and they are the whole reason this method is careful:
   *
   * 1. `kept` counts CYCLES ACTUALLY COLLECTED (succeeded transactions carrying
   *    this member's schedule_id), never cycles scheduled. A partner whose
   *    M-Pesa failed in June did not keep June, and telling them they did would
   *    be flattery built on a false number.
   *
   * 2. `since_you_began` is what the WHOLE CHURCH did during their partnership.
   *    It is NOT their money traced to an outcome — we cannot trace a shilling
   *    to a disciple and must never imply we can. The field is named for what it
   *    is, and the clients say "since you began partnering", never "your giving
   *    produced". Attribution we cannot prove is not encouragement, it is a lie
   *    told kindly.
   */
  async partnership(userId: string): Promise<Record<string, unknown>> {
    const standing = await maybeOne<{
      schedule_id: string; status: string; since: string; frequency: string; method: string;
      amount_minor: string; currency: string; next_run_at: string | null;
      fund: string; consecutive_failures: number; last_failed_at: string | null;
      paused_at: string | null;
    }>(
      this.pool,
      `SELECT s.schedule_id, s.status, s.created_at AS since, s.frequency, s.method, s.amount_minor,
              s.currency, s.next_run_at, f.code AS fund,
              s.consecutive_failures, s.last_failed_at, s.paused_at
         FROM giving_schedules s JOIN funds f ON f.fund_id = s.fund_id
        WHERE s.user_id = $1 AND s.status IN ('active','paused')
        ORDER BY s.created_at ASC LIMIT 1`,
      [userId],
    );

    if (!standing) {
      // Not a partner today. We still say whether they ever were — someone who
      // partnered and stopped is not a stranger, and the page greets them
      // differently from someone who never has.
      const past = await maybeOne<{ since: string }>(
        this.pool,
        `SELECT min(created_at) AS since FROM giving_schedules
          WHERE user_id = $1 AND status = 'cancelled'`,
        [userId],
      );
      return {
        is_partner: false,
        ever_partnered: past?.since != null,
        since: past?.since ?? null,
        kept: 0,
        rhythm: null,
        trouble: null,
        since_you_began: null,
      };
    }

    // Cycles actually collected, and what they came to. Both from succeeded
    // transactions tied to this member's schedules — never from the calendar.
    const collected = await maybeOne<{ kept: number; total_minor: string | null }>(
      this.pool,
      `SELECT count(*)::int AS kept, sum(t.amount_minor) AS total_minor
         FROM transactions t
         JOIN giving_schedules s ON s.schedule_id = t.schedule_id
        WHERE s.user_id = $1 AND t.status = 'succeeded'`,
      [userId],
    );

    const together = await this.churchSince(standing.since);

    const failing = standing.consecutive_failures > 0;
    return {
      is_partner: true,
      ever_partnered: true,
      schedule_id: standing.schedule_id,
      status: standing.status,
      since: standing.since,
      kept: collected?.kept ?? 0,
      given_minor: Number(collected?.total_minor ?? 0),
      currency: standing.currency,
      rhythm: {
        frequency: standing.frequency,
        method: standing.method,
        amount_minor: Number(standing.amount_minor),
        fund: standing.fund,
        next_run_at: standing.status === "active" ? standing.next_run_at : null,
      },
      // Present only when there is something to say. A partner whose giving is
      // collecting cleanly should never see a trouble block at all.
      trouble: failing || standing.status === "paused"
        ? {
            paused: standing.status === "paused",
            consecutive_failures: standing.consecutive_failures,
            last_failed_at: standing.last_failed_at,
            // Deliberately NOT last_error: the provider's wording is for the
            // church's admin view, not for the member who is already worried.
          }
        : null,
      since_you_began: {
        from: standing.since,
        levels_completed: together.levels,
        modules_completed: together.modules,
        plans_finished: together.plans,
      },
    };
  }

  /** What the church did in a partner's season — `since_you_began`'s counts,
   *  and the Partners statement's `season` for a partner without a recurring
   *  gift (from their join date). Aggregate and anonymous — counts of
   *  completions, never a name, never a ranking. */
  async churchSince(since: Date | string): Promise<{ levels: number; modules: number; plans: number }> {
    const together = await maybeOne<{
      levels: number; modules: number; plans: number;
    }>(
      this.pool,
      // Only one parameter here: the day they began. The member's own id is
      // deliberately absent — these are church-wide counts, not their own.
      `SELECT
         (SELECT count(*)::int FROM enrollments
           WHERE completed_at IS NOT NULL AND completed_at >= $1)                AS levels,
         (SELECT count(*)::int FROM module_progress
           WHERE is_completed AND completed_at >= $1)                            AS modules,
         (SELECT count(*)::int FROM reading_plan_progress
           WHERE completed_at IS NOT NULL AND completed_at >= $1)                AS plans`,
      [since],
    );
    return { levels: together?.levels ?? 0, modules: together?.modules ?? 0, plans: together?.plans ?? 0 };
  }

  async cancelSchedule(userId: string, scheduleId: string): Promise<Record<string, unknown>> {
    const row = await maybeOne<{ schedule_id: string }>(
      this.pool,
      `UPDATE giving_schedules SET status = 'cancelled', cancelled_at = now()
        WHERE schedule_id = $1 AND user_id = $2 AND status IN ('active', 'paused')
        RETURNING schedule_id`,
      [scheduleId, userId],
    );
    if (!row) throw new ApiError("NOT_FOUND", "Active schedule not found");
    await audit(this.pool, userId, "giving.schedule_cancelled", "giving_schedules", scheduleId, {});
    return { schedule_id: scheduleId, status: "cancelled" };
  }

  /**
   * Resume a schedule that repeated collection failures paused. The giver's
   * intent was never in question — only the collection — so this is one tap.
   *
   * The missed cycle is deliberately NOT charged on resume: money must never
   * surprise anyone. The schedule re-arms from now, and the caller is told
   * exactly when the next gift will be collected; anyone wanting to cover the
   * gap can give once, on purpose.
   */
  async resumeSchedule(userId: string, scheduleId: string): Promise<Record<string, unknown>> {
    const current = await maybeOne<{ frequency: "weekly" | "monthly"; pause_reason: string | null }>(
      this.pool,
      `SELECT frequency, pause_reason FROM giving_schedules
        WHERE schedule_id = $1 AND user_id = $2 AND status = 'paused'`,
      [scheduleId, userId],
    );
    if (!current) throw new ApiError("NOT_FOUND", "Paused schedule not found");
    if (current.pause_reason === "pledge") {
      throw new ApiError("UNPROCESSABLE", "This gift follows its pledge. Resume the pledge to resume it.");
    }
    const now = new Date();
    const anchor = current.frequency === "monthly" ? FinancialService.eatDay(now) : null;
    const nextRun = FinancialService.nextRun(FinancialService.sameDayPromptHours(now), current.frequency, anchor);
    await this.pool.query(
      `UPDATE giving_schedules
          SET status = 'active', paused_at = NULL, consecutive_failures = 0,
              retry_after = NULL, last_error = NULL, last_failed_at = NULL,
              last_failure_code = NULL, retry_cycle_at = NULL, retry_at = NULL, cycle_attempts = 0,
              pause_reason = NULL, resume_on = NULL, next_run_at = $3, anchor_day = $4
        WHERE schedule_id = $1 AND user_id = $2`,
      [scheduleId, userId, nextRun.toISOString(), anchor],
    );
    await audit(this.pool, userId, "giving.schedule_resumed", "giving_schedules", scheduleId, {});
    return { schedule_id: scheduleId, status: "active", next_run_at: nextRun.toISOString() };
  }

  /**
   * The next occurrence of this cadence strictly AFTER `now`, keeping the
   * original phase — a Tuesday-evening weekly gift stays Tuesday evening, and a
   * monthly gift keeps its day of the month. Stepping interval by interval
   * (rather than computing an offset) is what preserves that phase through
   * month-length differences and DST.
   *
   * Bounded so a corrupt far-past date cannot spin: 520 weeks is ten years, far
   * beyond any real backlog, and reaching it means the data is wrong rather
   * than merely stale.
   */
  static rollForward(from: Date, frequency: "weekly" | "monthly", now: Date, anchorDay?: number | null): Date {
    let next = FinancialService.nextRun(from, frequency, anchorDay);
    for (let i = 0; i < 520 && next.getTime() <= now.getTime(); i += 1) {
      next = FinancialService.nextRun(next, frequency, anchorDay);
    }
    return next;
  }

  /**
   * Scheduler hook: charge every due active schedule. Each cycle's FIRST
   * prompt uses the deterministic key `sched:{id}:{due}`, so a crashed or
   * overlapping run can never send it twice; next_run_at advances from the DUE
   * time, not "now", so cadence never drifts.
   *
   * Sending a prompt is NOT collecting a gift (Giving Cycle 1). Whether the
   * member paid, declined or never saw it arrives later — the callback or the
   * sweeper — and recordScheduleOutcome feeds it back: strikes, the pause, the
   * member's notice, and at most ONE retry of the cycle, which runs here with
   * the key `sched:{id}:{cycle}:r{n}` once it has proved no attempt of that
   * cycle succeeded or is still waiting on the phone.
   *
   * Two prompts must never race to one phone (the second fails as "busy" and
   * can take the first down with it): a phone already prompted in this run, or
   * with a prompt from the last two minutes still waiting, is deferred three
   * minutes. That is not a failure — nobody said no.
   */
  async runDueSchedules(
    now: Date = new Date(),
  ): Promise<{ run: number; failed: number; skipped: number; retried: number; deferred: number }> {
    const due = await many<{
      schedule_id: string;
      user_id: string;
      fund: string;
      amount_minor: string;
      currency: string;
      frequency: "weekly" | "monthly";
      method: "card" | "mpesa" | "airtel";
      next_run_at: Date;
      retry_after: Date | null;
      consecutive_failures: number;
      retry_cycle_at: Date | null;
      retry_at: Date | null;
      cycle_attempts: number;
      phone: string | null;
      anchor_day: number | null;
    }>(
      this.pool,
      `SELECT s.schedule_id, s.user_id, f.code AS fund, s.amount_minor, s.currency,
              s.frequency, s.method, s.next_run_at, s.retry_after, s.consecutive_failures,
              s.retry_cycle_at, s.retry_at, s.cycle_attempts, s.anchor_day,
              COALESCE(s.phone_number, u.phone_number) AS phone
         FROM giving_schedules s
         JOIN funds f ON f.fund_id = s.fund_id
         JOIN users u ON u.user_id = s.user_id
        WHERE s.status = 'active'
          AND ((s.next_run_at <= $1 AND (s.retry_after IS NULL OR s.retry_after <= $1))
            OR (s.retry_cycle_at IS NOT NULL AND s.retry_at <= $1))
        ORDER BY s.next_run_at
        LIMIT 500`,
      [now.toISOString()],
    );
    const counts = { run: 0, failed: 0, skipped: 0, retried: 0, deferred: 0 };
    await this.sendHeadsUps(now);
    await this.resumeDuePauses(now);
    const prompted = new Set<string>();
    for (const s of due) {
      // The regular cycle wins over a retry of an older one: a new cycle
      // supersedes whatever the last one left undone.
      const regular =
        new Date(s.next_run_at).getTime() <= now.getTime() &&
        (!s.retry_after || new Date(s.retry_after).getTime() <= now.getTime());

      if (regular) {
        // ── THE BACKLOG GUARD ──────────────────────────────────────────────
        // A schedule can fall far behind — the provider was unconfigured for
        // weeks, the worker was down, the church changed gateways. When it
        // catches up, next_run_at advances by ONE interval per success, so a
        // schedule ten weeks overdue would be charged ten times in quick
        // succession on the next few passes.
        //
        // The double-charge guard does NOT protect against this: each stale
        // cycle has its own idempotency key, so these are ten legitimately
        // distinct charges, not a repeat of one.
        //
        // A member who set up "KSh 1,000 weekly" consented to a rhythm, not to
        // a lump sum arriving without warning. So we do not collect the
        // backlog: we roll the schedule forward to its next FUTURE occurrence
        // and start the rhythm again from there. The church forgoes money it
        // never collected — the right trade against surprising a partner with
        // ten charges they did not expect.
        //
        // Discovered in production 2026-09-02: six real M-Pesa schedules from
        // June had never collected once ("mpesa payments are not configured"),
        // and configuring the provider would have triggered exactly this.
        const dueAt = new Date(s.next_run_at);
        const nextAfterDue = FinancialService.nextRun(dueAt, s.frequency, s.anchor_day);
        if (nextAfterDue.getTime() <= now.getTime()) {
          const rolled = FinancialService.sameDayPromptHours(FinancialService.rollForward(dueAt, s.frequency, now, s.anchor_day));
          console.warn(
            `[giving] schedule ${s.schedule_id} was ${Math.round(
              (now.getTime() - dueAt.getTime()) / 86_400_000,
            )} days behind; rolling to ${rolled.toISOString()} WITHOUT collecting the backlog`,
          );
          await this.pool.query(
            `UPDATE giving_schedules
                SET next_run_at = $2, consecutive_failures = 0, retry_after = NULL,
                    last_error = NULL, last_failed_at = NULL, last_failure_code = NULL,
                    retry_cycle_at = NULL, retry_at = NULL, cycle_attempts = 0
              WHERE schedule_id = $1`,
            [s.schedule_id, rolled.toISOString()],
          );
          counts.skipped += 1;
          continue;
        }
      }

      // One prompt per phone at a time — unless this is a REPLAY of a prompt
      // already sent for this very cycle (a crash between sending and moving
      // the schedule on), which re-sends nothing: its key finds the prompt
      // that exists, and the schedule simply moves on.
      const phoneKey = kenyanMobileNumber(s.phone) ?? `user:${s.user_id}`;
      const replay = regular
        ? await maybeOne<{ n: number }>(
            this.pool,
            `SELECT 1 AS n FROM transactions WHERE idempotency_key = $1 AND schedule_id = $2 LIMIT 1`,
            [`sched:${s.schedule_id}:${s.next_run_at}`, s.schedule_id],
          )
        : null;
      const waiting = replay
        ? null
        : await maybeOne<{ n: number }>(
            this.pool,
            `SELECT 1 AS n FROM transactions
              WHERE user_id = $1 AND provider IN ('mpesa','airtel') AND status = 'processing'
                AND created_at > $2 LIMIT 1`,
            [s.user_id, new Date(now.getTime() - 2 * 60_000).toISOString()],
          );
      if (!replay && (prompted.has(phoneKey) || waiting)) {
        const later = new Date(now.getTime() + 3 * 60_000).toISOString();
        await this.pool.query(
          regular
            ? `UPDATE giving_schedules SET retry_after = $2 WHERE schedule_id = $1`
            : `UPDATE giving_schedules SET retry_at = $2 WHERE schedule_id = $1`,
          [s.schedule_id, later],
        );
        counts.deferred += 1;
        continue;
      }

      let cycleAt: Date;
      let key: string;
      if (regular) {
        cycleAt = new Date(s.next_run_at);
        // Unchanged key shape: cycles already sent before this release keep
        // their key, so none of them can be sent a second time.
        key = `sched:${s.schedule_id}:${s.next_run_at}`;
      } else {
        cycleAt = new Date(s.retry_cycle_at!);
        // A retry proves its cycle is still open: nothing of it succeeded and
        // no attempt of it is still on the phone.
        const open = await maybeOne<{ n: number }>(
          this.pool,
          `SELECT 1 AS n FROM transactions
            WHERE schedule_id = $1 AND schedule_cycle_at = $2 AND status IN ('succeeded','processing') LIMIT 1`,
          [s.schedule_id, cycleAt.toISOString()],
        );
        if (open) {
          await this.pool.query(
            `UPDATE giving_schedules SET retry_cycle_at = NULL, retry_at = NULL WHERE schedule_id = $1`,
            [s.schedule_id],
          );
          continue;
        }
        key = `sched:${s.schedule_id}:${cycleAt.toISOString()}:r${s.cycle_attempts}`;
      }

      // A schedule that pays a pledge asks for what the pledge still owes
      // (Giving Cycle 5) — nothing when it is paid, and it stops or pauses
      // with its pledge. A replay re-sends nothing, so it needs no plan.
      let amountMinor = Number(s.amount_minor);
      if (!replay) {
        const plan = await this.pledgeCyclePlan(s.schedule_id, cycleAt);
        if (plan && plan.action !== "charge") {
          await this.applyPledgePlan(s, plan, regular, now);
          counts.skipped += 1;
          continue;
        }
        if (plan) amountMinor = plan.amount_minor;
      }

      prompted.add(phoneKey);
      try {
        await this.createGivingIntent(
          s.user_id,
          {
            fund: s.fund,
            amount_minor: amountMinor,
            currency: s.currency,
            method: s.method,
            idempotency_key: key,
          },
          s.schedule_id,
          { cycleAt: cycleAt.toISOString(), phone: s.phone },
        );
        if (regular) {
          // The prompt is out. Its OUTCOME is not known yet, so the failure
          // state is left alone — only a confirmed payment clears it.
          await this.pool.query(
            `UPDATE giving_schedules
                SET last_run_at = $2, next_run_at = $3, retry_after = NULL,
                    retry_cycle_at = NULL, retry_at = NULL, cycle_attempts = 0
              WHERE schedule_id = $1`,
            [s.schedule_id, now.toISOString(),
             FinancialService.sameDayPromptHours(FinancialService.nextRun(new Date(s.next_run_at), s.frequency, s.anchor_day)).toISOString()],
          );
          counts.run += 1;
        } else {
          await this.pool.query(
            `UPDATE giving_schedules SET retry_cycle_at = NULL, retry_at = NULL WHERE schedule_id = $1`,
            [s.schedule_id],
          );
          counts.retried += 1;
        }
      } catch (err) {
        counts.failed += 1;
        await this.scheduleSendFailed(s, err, regular, now);
      }
    }
    return counts;
  }

  /**
   * The prompt could not even be SENT. A failed cycle is VISIBLE, BOUNDED and
   * RECOVERABLE (owner, 2026-08-28) — it used to be `catch { failed += 1 }`:
   * silent to the giver, silent to the church, retried every five minutes
   * forever.
   *
   * next_run_at deliberately does NOT move — it anchors this cycle's
   * idempotency key, so every retry inside the cycle reuses that key and can
   * never charge twice. Backoff rides the separate retry_after gate instead.
   */
  private async scheduleSendFailed(
    s: { schedule_id: string; user_id: string; fund: string; amount_minor: string; currency: string; method: string; frequency: string; consecutive_failures: number },
    err: unknown,
    regular: boolean,
    now: Date,
  ): Promise<void> {
    const reason = err instanceof Error ? err.message : String(err);
    // OUR FAULT, NOT THEIRS. If the provider is not configured on this
    // server — or Safaricom itself is down — the giver's payment did not fail:
    // we never got to ask. Telling them "your recurring gift didn't go
    // through" alarms them about our plumbing and offers a retry that cannot
    // possibly work, so a configuration fault or an outage:
    //   · does NOT count toward their three strikes
    //   · does NOT pause their schedule
    //   · does NOT notify them at all
    // It is recorded and shouted at the operator instead, because the people
    // who can fix it are us. (Owner, 2026-09-02, on finding six real partners
    // three hours from exactly that message; outages added in Giving Cycle 1.)
    const ours =
      err instanceof ProviderNotConfiguredError ||
      (err instanceof ApiError && err.code === "UPSTREAM_UNAVAILABLE");
    if (ours) {
      console.error(
        `[giving] ${err instanceof ProviderNotConfiguredError ? "CONFIGURATION FAULT" : "PROVIDER OUTAGE"} — ` +
          `schedule ${s.schedule_id} could not be prompted: ${reason}. The giver has NOT been notified.`,
      );
      await this.pool.query(
        regular
          ? `UPDATE giving_schedules SET last_error = $2, last_failed_at = $3, retry_after = $4 WHERE schedule_id = $1`
          : `UPDATE giving_schedules SET last_error = $2, last_failed_at = $3, retry_at = $4 WHERE schedule_id = $1`,
        [s.schedule_id, reason.slice(0, 500), now.toISOString(), new Date(now.getTime() + 60 * 60_000).toISOString()],
      );
      return;
    }

    // The giver's side: no usable number, an amount M-Pesa refuses, a rail
    // the gift can no longer use. One strike each, with the reason in words.
    const code: GiftFailureCode =
      err instanceof ApiError && err.code === "PHONE_REQUIRED" ? "no_phone" : "declined";
    const attempts = s.consecutive_failures + 1;
    console.error(`[giving] schedule ${s.schedule_id} could not be prompted (attempt ${attempts}, ${s.method}): ${reason}`);
    const paused = attempts >= FinancialService.SCHEDULE_MAX_ATTEMPTS;
    const backoffMs = FinancialService.SCHEDULE_BACKOFF_MIN[
      Math.min(attempts - 1, FinancialService.SCHEDULE_BACKOFF_MIN.length - 1)
    ]! * 60_000;
    await this.pool.query(
      `UPDATE giving_schedules
          SET consecutive_failures = $2,
              last_error = $3,
              last_failure_code = $7,
              last_failed_at = $4,
              retry_after = CASE WHEN $8 THEN $5::timestamptz ELSE retry_after END,
              retry_cycle_at = CASE WHEN $8 THEN retry_cycle_at ELSE NULL END,
              retry_at = CASE WHEN $8 THEN retry_at ELSE NULL END,
              status = CASE WHEN $6 THEN 'paused' ELSE status END,
              paused_at = CASE WHEN $6 THEN $4::timestamptz ELSE paused_at END,
              pause_reason = CASE WHEN $6 THEN 'failures' ELSE pause_reason END
        WHERE schedule_id = $1`,
      [
        s.schedule_id,
        attempts,
        reason.slice(0, 500),
        now.toISOString(),
        new Date(now.getTime() + backoffMs).toISOString(),
        paused,
        code,
        regular,
      ],
    );
    // Tell the giver — once when it first fails, and again if we stop.
    // Best-effort: a notification hiccup must never break the tick.
    try {
      if (attempts === 1 || paused) {
        const copy = giftFailureCopy(code)!;
        await this.notifications.schedule({
          userId: s.user_id,
          channel: "push",
          template: paused ? "giving_schedule_paused" : "giving_schedule_failed",
          payload: {
            schedule_id: s.schedule_id,
            fund: s.fund,
            amount_minor: Number(s.amount_minor),
            currency: s.currency,
            method: s.method,
            frequency: s.frequency,
            failure_code: code,
            reason: err instanceof ApiError ? err.message : copy.reason,
            hint: copy.hint,
            retry_at: null,
          },
        });
      }
    } catch {
      /* the ledger matters more than the notice */
    }
  }

  /**
   * The heads-up (Giving Cycle 4): a push minutes before each scheduled
   * prompt, so the PIN prompt is expected rather than dismissed as a scam.
   * Claimed with one UPDATE … RETURNING per cycle, so two scheduler runs never
   * announce the same prompt twice. Off per schedule with heads_up = false.
   */
  private async sendHeadsUps(now: Date): Promise<void> {
    const announced = await many<{ user_id: string; schedule_id: string; amount_minor: string; currency: string; frequency: string; fund_name: string; next_run_at: Date }>(
      this.pool,
      `UPDATE giving_schedules s SET heads_up_cycle_at = s.next_run_at
         FROM funds f
        WHERE f.fund_id = s.fund_id AND s.status = 'active' AND s.heads_up
          AND s.next_run_at > $1 AND s.next_run_at <= $1::timestamptz + interval '15 minutes'
          AND s.heads_up_cycle_at IS DISTINCT FROM s.next_run_at
        RETURNING s.user_id, s.schedule_id, s.amount_minor, s.currency, s.frequency, f.name AS fund_name, s.next_run_at`,
      [now.toISOString()],
    );
    for (const a of announced) {
      try {
        // Announce what will actually be asked (Giving Cycle 5): a pledge's
        // schedule may ask less than its amount, or nothing at all.
        const plan = await this.pledgeCyclePlan(a.schedule_id, new Date(a.next_run_at));
        if (plan && plan.action !== "charge") continue;
        const amount = plan ? plan.amount_minor : Number(a.amount_minor);
        await this.notifications.schedule({
          userId: a.user_id,
          channel: "push",
          template: "giving_schedule_heads_up",
          payload: {
            schedule_id: a.schedule_id, amount_minor: amount, currency: a.currency,
            frequency: a.frequency, fund_name: a.fund_name, prompt_at: new Date(a.next_run_at).toISOString(),
            pledge_title: plan?.title ?? null, partial: plan ? amount < Number(a.amount_minor) : false,
          },
        });
      } catch {
        /* a missed heads-up never blocks the gift */
      }
    }
  }

  /** A member's own pause with a date ends on that date (Nairobi): the gift
   *  picks up at its next occurrence on or after it, in prompt hours. */
  private async resumeDuePauses(now: Date): Promise<void> {
    const due = await many<{ schedule_id: string; resume_on: string }>(
      this.pool,
      `SELECT schedule_id, resume_on::text AS resume_on FROM giving_schedules
        WHERE status = 'paused' AND pause_reason = 'member' AND resume_on IS NOT NULL AND resume_on <= $1::date`,
      [nairobiDate(now)],
    );
    for (const d of due) {
      const startOfDay = new Date(Date.parse(`${d.resume_on}T00:00:00Z`) - FinancialService.EAT_MS);
      await this.rearmAfterPause(d.schedule_id, new Date(Math.max(startOfDay.getTime() - 1, now.getTime())));
    }
  }

  /** Minutes to wait before re-attempting a failed cycle (1h, 6h, 24h). */
  private static readonly SCHEDULE_BACKOFF_MIN = [60, 360, 1440] as const;
  /** Consecutive failures after which we stop and ask the giver. */
  private static readonly SCHEDULE_MAX_ATTEMPTS = 3;

  // ---------------- Admin finance reads (ERP, Contract Matrix B1) ----------------
  // Admin = view-only over the ledger; fund/financial CONFIG stays SuperAdmin (§5.4).

  /**
   * Recurring giving, for the people responsible for it. There was NO admin
   * read of giving_schedules at all — the only visibility was two aggregates
   * buried in Member Intelligence — so a partner whose collection kept failing
   * was invisible to the church. `needs_attention` first: paused, then the most
   * failures, then soonest due.
   */
  async listSchedulesAdmin(opts: { status?: string | undefined; attention?: boolean | undefined; limit?: number | undefined } = {}): Promise<{ data: unknown[] }> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
    const params: unknown[] = [limit];
    let where = `WHERE s.status <> 'cancelled'`;
    if (opts.status) {
      params.push(opts.status);
      where = `WHERE s.status = $${params.length}`;
    }
    // Only the ones needing attention — the needs_attention rule below, never
    // a cancelled schedule (Finance → Recurring gifts, Overview alert).
    if (opts.attention) where += ` AND s.status <> 'cancelled' AND (s.status = 'paused' OR s.consecutive_failures > 0)`;
    const rows = await many<Record<string, unknown>>(
      this.pool,
      `SELECT s.schedule_id, s.user_id, u.full_name, u.phone_number,
              f.code AS fund, s.amount_minor, s.currency, s.frequency, s.method,
              s.status, s.next_run_at, s.last_run_at,
              s.consecutive_failures, s.last_error, s.last_failed_at, s.paused_at, s.created_at
         FROM giving_schedules s
         JOIN funds f ON f.fund_id = s.fund_id
         JOIN users u ON u.user_id = s.user_id
         ${where}
        ORDER BY (s.status = 'paused') DESC, s.consecutive_failures DESC, s.next_run_at
        LIMIT $1`,
      params,
    );
    return {
      data: rows.map((r) => ({
        ...r,
        amount_minor: Number(r.amount_minor),
        needs_attention: r.status === "paused" || Number(r.consecutive_failures ?? 0) > 0,
      })),
    };
  }

  /** Per-fund revenue: settled totals this month + all time (the "Fund Revenue" card). */
  async financeSummary(): Promise<Record<string, unknown>> {
    const funds = await many<Record<string, unknown>>(
      this.pool,
      `SELECT f.code, f.name, t.currency,
              COALESCE(sum(t.amount_minor) FILTER (WHERE t.status = 'succeeded'), 0)::bigint AS total_minor,
              -- This month = the church's (EAT) month by created_at — the
              -- Finance Overview's basis, so the Dashboard card foots with it.
              COALESCE(sum(t.amount_minor) FILTER (
                WHERE t.status = 'succeeded'
                  AND t.created_at >= (date_trunc('month', now() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi')), 0)::bigint AS month_minor,
              count(t.transaction_id) FILTER (WHERE t.status = 'succeeded')::int AS gift_count
         FROM funds f
         LEFT JOIN transactions t ON t.fund_id = f.fund_id
        GROUP BY f.code, f.name, t.currency
        ORDER BY f.code`,
    );
    return {
      funds: funds.map((r) => ({ ...r, total_minor: Number(r.total_minor), month_minor: Number(r.month_minor) })),
    };
  }

  /** The transactions register's query (finance-reports.ts TransactionsQuery):
   *  from/to, fund, status, channel, source, q, pledged, need, cursor — and
   *  the earlier `before` / `limit`. */
  static readonly ListTransactions = TransactionsQuery;

  /** The transactions register — one keyset page plus per-currency totals
   *  over the whole filtered set (finance-reports.ts). */
  async listTransactions(
    q: TransactionsQueryInput,
  ): Promise<{ data: FinanceTransactionRow[]; next_cursor: string | null; totals: CurrencyTotal[] }> {
    return listFinanceTransactions(this.pool, q);
  }

  /** Recent double-entry ledger postings — transaction AND journal — newest
   *  first (always balanced, §5.6). */
  async listLedger(limit = 100): Promise<unknown[]> {
    return (await listLedgerPage(this.pool, { limit: Math.min(Math.max(limit, 1), 500) })).data;
  }

  /** Succeeded giving per EAT month, per currency (`data` = the KES series). */
  async financeTrend(months = 6): Promise<{ data: TrendPoint[]; currency: string; series: { currency: string; points: TrendPoint[] }[] }> {
    return financeTrendByCurrency(this.pool, months);
  }

  static readonly ListFinanceAudit = FinanceAuditQuery;

  /** Finance-scoped slice of the append-only audit trail (§5.10) — the money paper trail. */
  async financeAudit(
    q: FinanceAuditQueryInput,
  ): Promise<{ data: unknown[]; next_cursor: string | null }> {
    return financeAuditPage(this.pool, q);
  }

  /** A single transaction plus EVERY ledger posting it owns (the detail drawer). */
  async transactionDetail(id: string): Promise<Record<string, unknown> | null> {
    return financeTransactionDetail(this.pool, id);
  }

  /** Read-only configuration view: funds + which payment providers are wired.
      Never returns secrets (§5.6/§5.10) — only on/off availability. */
  async financeFunds(): Promise<{ code: string; name: string; is_active: boolean }[]> {
    const rows = await many<Record<string, unknown>>(
      this.pool,
      `SELECT code, name, is_active FROM funds ORDER BY code`,
    );
    return rows.map((r) => ({ code: String(r.code), name: String(r.name), is_active: Boolean(r.is_active) }));
  }
}
