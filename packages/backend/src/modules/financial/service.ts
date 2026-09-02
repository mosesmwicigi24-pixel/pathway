// Financial service (spec §1.10 Flow C, §3.5, §5.6). Giving via Stripe (cards/
// wallets) and mobile money (M-Pesa/Airtel STK push, B7) behind the same
// intent → verified-webhook → balanced double-entry ledger flow, plus recurring
// giving schedules driven by a server-side scheduler. Money is always integer
// minor units + ISO currency — never floats — and never queued offline.
import type { Pool, PoolClient } from "pg";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { maybeOne, one, many, tx, audit, enqueueOutbox } from "../../db/db.js";
import { NotificationService } from "../notifications/service.js";
import { ApiError } from "../../http/errors.js";
import type { PaymentGateway } from "./gateway.js";
import { sanitizeAccountReference, type MobileMoneyKey, type MobileMoneyProviders } from "./providers.js";
import type { PayPalGateway } from "./paypal.js";
import { renderStatementPdf, renderReceiptPdf } from "./statementPdf.js";

const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

export class FinancialService {
  constructor(
    private readonly pool: Pool,
    private readonly gateway: PaymentGateway,
    private readonly mobileMoney?: MobileMoneyProviders,
    private readonly paypal?: PayPalGateway,
  ) {}

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
  });

  private provider(key: MobileMoneyKey) {
    const p = this.mobileMoney?.[key];
    if (!p) throw new ApiError("UPSTREAM_UNAVAILABLE", `${key} payments are not configured`);
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
  ): Promise<Record<string, unknown>> {
    const key = input.idempotency_key ?? randomUUID();

    // Idempotent: the same client key returns the existing transaction.
    const existing = await maybeOne<{ transaction_id: string; status: string }>(
      this.pool,
      `SELECT transaction_id, status FROM transactions WHERE idempotency_key = $1 AND user_id = $2`,
      [key, userId],
    );
    if (existing) {
      return { transaction_id: existing.transaction_id, status: existing.status, idempotency_key: key, reused: true };
    }

    const fund = await maybeOne<{ fund_id: string }>(
      this.pool,
      `SELECT fund_id FROM funds WHERE code = $1 AND is_active`,
      [input.fund],
    );
    if (!fund) throw new ApiError("VALIDATION_FAILED", "Unknown or inactive fund");

    const currency = input.currency.toUpperCase();

    if (input.method === "mpesa" || input.method === "airtel") {
      const phone =
        input.phone_number ??
        (await one<{ phone_number: string }>(this.pool, `SELECT phone_number FROM users WHERE user_id = $1`, [userId]))
          .phone_number;
      const charge = await this.provider(input.method).initiate({
        amountMinor: input.amount_minor,
        currency,
        phoneNumber: phone,
        metadata: {
          user_id: userId,
          fund: input.fund,
          // Named giving: only set `reference` when the member entered a name —
          // absent, the provider falls back to its existing fund/default ref.
          ...(input.account_name ? { reference: input.account_name } : {}),
        },
      });
      const txn = await one<{ transaction_id: string; status: string }>(
        this.pool,
        `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, provider_ref, idempotency_key, schedule_id, account_name)
         VALUES ($1, $2, $3, $4, 'processing', $5, $6, $7, $8, $9)
         RETURNING transaction_id, status`,
        [userId, fund.fund_id, input.amount_minor, currency, input.method, charge.ref, key, scheduleId ?? null, input.account_name ?? null],
      );
      await audit(this.pool, userId, "giving.intent_created", "transactions", txn.transaction_id, {
        amount_minor: input.amount_minor,
        currency,
        fund: input.fund,
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
      };
    }

    if (input.method === "paypal") {
      // PayPal can't transact KES — gifts settle in USD (amount treated as USD).
      const order = await this.paypalGw().createOrder({ amountMinor: input.amount_minor, reference: `${userId}:${input.fund}` });
      const txn = await one<{ transaction_id: string; status: string }>(
        this.pool,
        `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, provider_ref, idempotency_key, schedule_id, account_name)
         VALUES ($1, $2, $3, 'USD', 'processing', 'paypal', $4, $5, $6, $7)
         RETURNING transaction_id, status`,
        [userId, fund.fund_id, input.amount_minor, order.orderId, key, scheduleId ?? null, input.account_name ?? null],
      );
      await audit(this.pool, userId, "giving.intent_created", "transactions", txn.transaction_id, {
        amount_minor: input.amount_minor, currency: "USD", fund: input.fund, method: "paypal", account_name: input.account_name ?? null,
      });
      return {
        transaction_id: txn.transaction_id,
        provider: "paypal",
        provider_ref: order.orderId,
        approve_url: order.approveUrl, // open this; member approves on PayPal, then capture
        status: txn.status,
        idempotency_key: key,
        reused: false,
      };
    }

    const intent = await this.gateway.createIntent({
      amountMinor: input.amount_minor,
      currency,
      metadata: { user_id: userId, fund: input.fund },
    });

    const txn = await one<{ transaction_id: string; status: string }>(
      this.pool,
      `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, stripe_payment_intent, idempotency_key, schedule_id, account_name)
       VALUES ($1, $2, $3, $4, 'processing', $5, $6, $7, $8)
       RETURNING transaction_id, status`,
      [userId, fund.fund_id, input.amount_minor, currency, intent.id, key, scheduleId ?? null, input.account_name ?? null],
    );
    await audit(this.pool, userId, "giving.intent_created", "transactions", txn.transaction_id, {
      amount_minor: input.amount_minor,
      currency,
      fund: input.fund,
      method: "card",
      account_name: input.account_name ?? null,
    });
    return {
      transaction_id: txn.transaction_id,
      client_secret: intent.client_secret,
      status: txn.status,
      idempotency_key: key,
      reused: false,
    };
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

    const charge = await this.provider(input.method).initiate({
      amountMinor: input.amount_minor,
      currency,
      phoneNumber: input.phone_number,
      metadata: { source: "website", fund: input.fund, reference },
    });

    const txn = await one<{ transaction_id: string; status: string }>(
      this.pool,
      `INSERT INTO transactions
         (user_id, fund_id, amount_minor, currency, status, provider, provider_ref,
          idempotency_key, account_name, source, giver_name, giver_phone, giver_email)
       VALUES (NULL, $1, $2, $3, 'processing', $4, $5, $6, $7, 'website', $8, $9, $10)
       RETURNING transaction_id, status`,
      [
        fund.fund_id,
        input.amount_minor,
        currency,
        input.method,
        charge.ref,
        input.idempotency_key,
        input.giver_name ?? null,
        input.giver_name ?? null,
        input.phone_number,
        input.giver_email ?? null,
      ],
    );

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
      await this.pool.query(`UPDATE transactions SET status = 'failed' WHERE provider_ref = $1 AND status <> 'succeeded'`, [orderId]);
      return { status: "failed" };
    }
    return { status: "processing" };
  }

  /**
   * Verified mobile-money callback (B7): HMAC check, idempotent dedupe in
   * processed_webhooks, then settlement by provider_ref — the same trust model
   * as the Stripe webhook (§3.5).
   */
  async handleMobileMoneyCallback(
    providerKey: MobileMoneyKey,
    rawBody: Buffer | string,
    signature: string,
  ): Promise<Record<string, unknown>> {
    const cb = this.provider(providerKey).verifyCallback(rawBody, signature);
    return tx(this.pool, async (c) => {
      const ins = await c.query(
        `INSERT INTO processed_webhooks (event_id, provider, payload_hash)
         VALUES ($1, $2, $3) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
        [cb.event_id, providerKey, sha256(rawBody)],
      );
      if (ins.rowCount === 0) return { duplicate: true };

      if (cb.status === "succeeded") {
        await this.settle(c, { provider_ref: cb.ref });
        // Capture the M-Pesa receipt code (from the SMS) for the member's
        // statement — display-only, set once, never overwrites, never touches
        // amount/status/ledger.
        if (cb.receipt) {
          await c.query(
            `UPDATE transactions SET receipt_code = $2
              WHERE provider_ref = $1 AND receipt_code IS NULL`,
            [cb.ref, cb.receipt],
          );
        }
      } else {
        await c.query(
          `UPDATE transactions SET status = 'failed' WHERE provider_ref = $1 AND status <> 'succeeded'`,
          [cb.ref],
        );
      }
      return { duplicate: false, status: cb.status };
    });
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
   *  back to the Stripe payment-intent id when there's no mobile-money ref. */
  async listGiving(userId: string): Promise<unknown[]> {
    const rows = await many<Record<string, unknown>>(
      this.pool,
      `SELECT t.transaction_id, t.amount_minor, t.currency, t.status, f.code AS fund,
              t.provider,
              COALESCE(t.provider_ref, t.stripe_payment_intent) AS provider_ref,
              t.receipt_code, t.account_name,
              t.created_at, t.settled_at
         FROM transactions t LEFT JOIN funds f ON f.fund_id = t.fund_id
        WHERE t.user_id = $1 ORDER BY t.created_at DESC`,
      [userId],
    );
    return rows.map((r) => {
      const provider = (r.provider as string | null) ?? "stripe";
      const { provider: _omit, ...rest } = r;
      void _omit;
      return { ...rest, amount_minor: Number(r.amount_minor), method: provider === "stripe" ? "card" : provider };
    });
  }

  /** Full detail for ONE of the caller's gifts — every field plus the balanced
   *  ledger trail (cash + fund accounts). Scoped to the owner (404 otherwise). */
  async givingDetail(userId: string, transactionId: string): Promise<Record<string, unknown>> {
    const t = await maybeOne<Record<string, unknown>>(
      this.pool,
      `SELECT t.transaction_id, t.amount_minor, t.currency, t.status, f.code AS fund,
              t.provider, COALESCE(t.provider_ref, t.stripe_payment_intent) AS provider_ref,
              t.receipt_code, t.account_name,
              t.schedule_id, t.created_at, t.settled_at
         FROM transactions t LEFT JOIN funds f ON f.fund_id = t.fund_id
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
    const { provider: _p, ...rest } = t;
    void _p;
    return {
      ...rest,
      amount_minor: Number(t.amount_minor),
      method: provider === "stripe" ? "card" : provider,
      ledger: ledger.map((l) => ({ ...l, amount_minor: Number(l.amount_minor) })),
    };
  }

  /** Render the caller's giving statement as a PDF (dep-free), grouped by month
   *  with settled-only totals — what the mobile "Download" action saves. */
  async statementPdf(userId: string): Promise<Buffer> {
    const rows = (await this.listGiving(userId)) as Array<{ amount_minor: number; status: string; fund: string; method: string; provider_ref: string | null; receipt_code: string | null; account_name: string | null; created_at: string }>;
    const me = await maybeOne<{ full_name: string; congregation: string | null }>(
      this.pool,
      `SELECT u.full_name, c.name AS congregation FROM users u LEFT JOIN congregations c ON c.congregation_id = u.congregation_id WHERE u.user_id = $1`,
      [userId],
    );
    const settled = (s: string): boolean => s === "succeeded" || s === "settled" || s === "completed";
    const ksh = (m: number): string => `KSh ${(m / 100).toLocaleString("en-US")}`;
    const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v)); // pg returns timestamps as Date
    const dayKey = (v: unknown): string => iso(v).slice(0, 10); // YYYY-MM-DD
    const dayLabel = (v: unknown): string => new Date(iso(v)).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    const timeLabel = (v: unknown): string => new Date(iso(v)).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const methodLabel = (m: string): string => ({ mpesa: "M-Pesa", airtel: "Airtel Money", card: "Card", paypal: "PayPal" } as Record<string, string>)[m] ?? m;

    // Group by calendar day, newest first — mirrors the in-app statement layout.
    const byDay = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = dayKey(r.created_at);
      (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(r);
    }
    const groups = [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([, recs]) => ({
        label: dayLabel(recs[0]!.created_at),
        totalLabel: ksh(recs.reduce((s, r) => s + (settled(r.status) ? r.amount_minor : 0), 0)),
        rows: recs.map((r) => {
          // Prefer the real M-Pesa receipt code when present; fall back to the
          // trimmed provider_ref for older/non-mobile-money gifts.
          const ref = r.receipt_code
            ? r.receipt_code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
            : (r.provider_ref ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase();
          return `${r.fund[0]!.toUpperCase()}${r.fund.slice(1)}  ${ksh(r.amount_minor)}  ${timeLabel(r.created_at)}  ${methodLabel(r.method)}  ${r.status.toUpperCase()}${ref ? `  Ref ${ref}` : ""}${r.account_name ? `  "${r.account_name}"` : ""}`;
        }),
      }));
    const total = rows.reduce((s, r) => s + (settled(r.status) ? r.amount_minor : 0), 0);
    return renderStatementPdf({
      congregation: me?.congregation ?? "Nuru Pathway",
      member: me?.full_name ?? "",
      totalLabel: ksh(total),
      count: rows.length,
      generatedAt: new Date().toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" }),
      groups,
    });
  }

  /** Render ONE of the caller's gifts as a downloadable receipt PDF (the in-app
   *  "Giving receipt"). Owner-scoped (404 otherwise). Money stays server-side. */
  async receiptPdf(userId: string, transactionId: string): Promise<Buffer> {
    const t = await maybeOne<{ amount_minor: number; currency: string; status: string; fund: string | null; provider: string | null; provider_ref: string | null; receipt_code: string | null; account_name: string | null; created_at: unknown; settled_at: unknown }>(
      this.pool,
      `SELECT t.amount_minor, t.currency, t.status, f.code AS fund, t.provider,
              COALESCE(t.provider_ref, t.stripe_payment_intent) AS provider_ref, t.receipt_code, t.account_name, t.created_at, t.settled_at
         FROM transactions t LEFT JOIN funds f ON f.fund_id = t.fund_id
        WHERE t.transaction_id = $1 AND t.user_id = $2`,
      [transactionId, userId],
    );
    if (!t) throw new ApiError("NOT_FOUND", "Gift not found");
    const me = await maybeOne<{ full_name: string; congregation: string | null }>(
      this.pool,
      `SELECT u.full_name, c.name AS congregation FROM users u LEFT JOIN congregations c ON c.congregation_id = u.congregation_id WHERE u.user_id = $1`,
      [userId],
    );
    const ksh = (m: number): string => `KSh ${(m / 100).toLocaleString("en-US")}`;
    const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
    const stamp = (v: unknown): string => new Date(iso(v)).toLocaleString("en-US", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
    const settled = (s: string): boolean => s === "succeeded" || s === "settled" || s === "completed";
    const provider = (t.provider as string | null) ?? "stripe";
    const method = provider === "stripe" ? "card" : provider;
    const methodLabel = ({ mpesa: "M-PESA", airtel: "Airtel Money", card: "Card", paypal: "PayPal" } as Record<string, string>)[method] ?? method;
    const fund = t.fund ? t.fund[0]!.toUpperCase() + t.fund.slice(1) : "Gift";
    // Prefer the real M-Pesa receipt code; fall back to provider_ref otherwise.
    const ref = (t.receipt_code ?? t.provider_ref ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    return renderReceiptPdf({
      congregation: me?.congregation ?? "Nuru Place Church",
      member: me?.full_name ?? "",
      ref,
      amountLabel: ksh(Number(t.amount_minor)),
      fund,
      giftName: t.account_name,
      methodLabel,
      statusLabel: settled(t.status) ? "Completed" : t.status[0]!.toUpperCase() + t.status.slice(1),
      feeLabel: ksh(0),
      totalLabel: ksh(Number(t.amount_minor)),
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
    method: z.enum(["card", "mpesa", "airtel", "paypal"]).default("card"),
    idempotency_key: z.string().min(8).max(255).optional(),
  });

  private static nextRun(from: Date, frequency: "weekly" | "monthly"): Date {
    const next = new Date(from);
    if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7);
    else next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }

  async createSchedule(
    userId: string,
    input: z.infer<typeof FinancialService.CreateSchedule>,
  ): Promise<Record<string, unknown>> {
    const key = input.idempotency_key ?? randomUUID();
    const existing = await maybeOne<{ schedule_id: string; status: string }>(
      this.pool,
      `SELECT schedule_id, status FROM giving_schedules WHERE idempotency_key = $1 AND user_id = $2`,
      [key, userId],
    );
    if (existing) return { ...existing, reused: true };

    const fund = await maybeOne<{ fund_id: string }>(
      this.pool,
      `SELECT fund_id FROM funds WHERE code = $1 AND is_active`,
      [input.fund],
    );
    if (!fund) throw new ApiError("VALIDATION_FAILED", "Unknown or inactive fund");

    // First charge on the next cycle boundary; give now if you want to give now.
    const firstRun = FinancialService.nextRun(new Date(), input.frequency);
    const row = await one<{ schedule_id: string; next_run_at: string }>(
      this.pool,
      `INSERT INTO giving_schedules (user_id, fund_id, amount_minor, currency, frequency, method, next_run_at, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING schedule_id, next_run_at`,
      [userId, fund.fund_id, input.amount_minor, input.currency.toUpperCase(), input.frequency, input.method, firstRun.toISOString(), key],
    );
    await audit(this.pool, userId, "giving.schedule_created", "giving_schedules", row.schedule_id, {
      fund: input.fund,
      amount_minor: input.amount_minor,
      frequency: input.frequency,
      method: input.method,
    });
    return { schedule_id: row.schedule_id, status: "active", next_run_at: row.next_run_at, reused: false };
  }

  async listSchedules(userId: string): Promise<{ data: unknown[] }> {
    const rows = await many<Record<string, unknown>>(
      this.pool,
      `SELECT s.schedule_id, f.code AS fund, s.amount_minor, s.currency, s.frequency, s.method,
              s.status, s.next_run_at, s.last_run_at, s.created_at,
              s.consecutive_failures, s.last_failed_at, s.paused_at
         FROM giving_schedules s JOIN funds f ON f.fund_id = s.fund_id
        WHERE s.user_id = $1 ORDER BY s.created_at DESC`,
      [userId],
    );
    return { data: rows.map((r) => ({ ...r, amount_minor: Number(r.amount_minor) })) };
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

    // What the church did in their season. Aggregate and anonymous — counts of
    // completions, never a name, never a ranking.
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
      [standing.since],
    );

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
        levels_completed: together?.levels ?? 0,
        modules_completed: together?.modules ?? 0,
        plans_finished: together?.plans ?? 0,
      },
    };
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
    const current = await maybeOne<{ frequency: "weekly" | "monthly" }>(
      this.pool,
      `SELECT frequency FROM giving_schedules
        WHERE schedule_id = $1 AND user_id = $2 AND status = 'paused'`,
      [scheduleId, userId],
    );
    if (!current) throw new ApiError("NOT_FOUND", "Paused schedule not found");
    const nextRun = FinancialService.nextRun(new Date(), current.frequency);
    await this.pool.query(
      `UPDATE giving_schedules
          SET status = 'active', paused_at = NULL, consecutive_failures = 0,
              retry_after = NULL, last_error = NULL, last_failed_at = NULL,
              next_run_at = $3
        WHERE schedule_id = $1 AND user_id = $2`,
      [scheduleId, userId, nextRun.toISOString()],
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
  static rollForward(from: Date, frequency: "weekly" | "monthly", now: Date): Date {
    let next = FinancialService.nextRun(from, frequency);
    for (let i = 0; i < 520 && next.getTime() <= now.getTime(); i += 1) {
      next = FinancialService.nextRun(next, frequency);
    }
    return next;
  }

  /**
   * Scheduler hook: charge every due active schedule. The cycle's intent key is
   * deterministic (schedule id + the due instant), so a crashed/overlapping run
   * can never double-charge; next_run_at advances from the DUE time, not "now",
   * so cadence never drifts.
   */
  async runDueSchedules(now: Date = new Date()): Promise<{ run: number; failed: number; skipped: number }> {
    const due = await many<{
      schedule_id: string;
      user_id: string;
      fund: string;
      amount_minor: string;
      currency: string;
      frequency: "weekly" | "monthly";
      method: "card" | "mpesa" | "airtel";
      next_run_at: string;
      consecutive_failures: number;
    }>(
      this.pool,
      `SELECT s.schedule_id, s.user_id, f.code AS fund, s.amount_minor, s.currency,
              s.frequency, s.method, s.next_run_at, s.consecutive_failures
         FROM giving_schedules s JOIN funds f ON f.fund_id = s.fund_id
        WHERE s.status = 'active' AND s.next_run_at <= $1
          AND (s.retry_after IS NULL OR s.retry_after <= $1)
        ORDER BY s.next_run_at`,
      [now.toISOString()],
    );
    let run = 0;
    let failed = 0;
    let skipped = 0;
    for (const s of due) {
      // ── THE BACKLOG GUARD ────────────────────────────────────────────────
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
      // A member who set up "KSh 1,000 weekly" consented to a rhythm, not to a
      // lump sum arriving without warning. So we do not collect the backlog:
      // we roll the schedule forward to its next FUTURE occurrence and start
      // the rhythm again from there. The church forgoes money it never
      // collected — which is the right trade against surprising a partner with
      // ten charges they did not expect.
      //
      // Discovered in production 2026-09-02: six real M-Pesa schedules from
      // June had never collected once ("mpesa payments are not configured"),
      // and configuring the provider would have triggered exactly this.
      const dueAt = new Date(s.next_run_at);
      const nextAfterDue = FinancialService.nextRun(dueAt, s.frequency);
      if (nextAfterDue.getTime() <= now.getTime()) {
        const rolled = FinancialService.rollForward(dueAt, s.frequency, now);
        console.warn(
          `[giving] schedule ${s.schedule_id} was ${Math.round(
            (now.getTime() - dueAt.getTime()) / 86_400_000,
          )} days behind; rolling to ${rolled.toISOString()} WITHOUT collecting the backlog`,
        );
        await this.pool.query(
          `UPDATE giving_schedules
              SET next_run_at = $2, consecutive_failures = 0, retry_after = NULL,
                  last_error = NULL, last_failed_at = NULL
            WHERE schedule_id = $1`,
          [s.schedule_id, rolled.toISOString()],
        );
        skipped += 1;
        continue;
      }

      try {
        await this.createGivingIntent(
          s.user_id,
          {
            fund: s.fund,
            amount_minor: Number(s.amount_minor),
            currency: s.currency,
            method: s.method,
            idempotency_key: `sched:${s.schedule_id}:${s.next_run_at}`,
          },
          s.schedule_id,
        );
        await this.pool.query(
          `UPDATE giving_schedules
              SET last_run_at = $2, next_run_at = $3,
                  consecutive_failures = 0, retry_after = NULL, last_error = NULL, last_failed_at = NULL
            WHERE schedule_id = $1`,
          [s.schedule_id, now.toISOString(), FinancialService.nextRun(new Date(s.next_run_at), s.frequency).toISOString()],
        );
        run += 1;
      } catch (err) {
        // A failed cycle is now VISIBLE, BOUNDED and RECOVERABLE (owner,
        // 2026-08-28). It used to be `catch { failed += 1 }`: silent to the
        // giver, silent to the church, and retried every five minutes forever.
        //
        // next_run_at deliberately does NOT move — it anchors this cycle's
        // idempotency key (`sched:{id}:{next_run_at}`), so every retry inside
        // the cycle reuses that key and can never charge twice. Backoff rides
        // the separate retry_after gate instead.
        failed += 1;
        const attempts = s.consecutive_failures + 1;
        const reason = err instanceof Error ? err.message : String(err);
        console.error(
          `[giving] schedule ${s.schedule_id} failed (attempt ${attempts}, ${s.method}): ${reason}`,
        );
        const paused = attempts >= FinancialService.SCHEDULE_MAX_ATTEMPTS;
        const backoffMs = FinancialService.SCHEDULE_BACKOFF_MIN[
          Math.min(attempts - 1, FinancialService.SCHEDULE_BACKOFF_MIN.length - 1)
        ]! * 60_000;
        await this.pool.query(
          `UPDATE giving_schedules
              SET consecutive_failures = $2,
                  last_error = $3,
                  last_failed_at = $4,
                  retry_after = $5,
                  status = CASE WHEN $6 THEN 'paused' ELSE status END,
                  paused_at = CASE WHEN $6 THEN $4::timestamptz ELSE paused_at END
            WHERE schedule_id = $1`,
          [
            s.schedule_id,
            attempts,
            reason.slice(0, 500),
            now.toISOString(),
            new Date(now.getTime() + backoffMs).toISOString(),
            paused,
          ],
        );
        // Tell the giver — once when it first fails, and again if we stop.
        // Best-effort: a notification hiccup must never break the tick.
        try {
          if (attempts === 1 || paused) {
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
              },
            });
          }
        } catch {
          /* the ledger matters more than the notice */
        }
      }
    }
    return { run, failed, skipped };
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
  async listSchedulesAdmin(opts: { status?: string | undefined; limit?: number | undefined } = {}): Promise<{ data: unknown[] }> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
    const params: unknown[] = [limit];
    let where = `WHERE s.status <> 'cancelled'`;
    if (opts.status) {
      params.push(opts.status);
      where = `WHERE s.status = $${params.length}`;
    }
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
              COALESCE(sum(t.amount_minor) FILTER (
                WHERE t.status = 'succeeded' AND t.settled_at >= date_trunc('month', now())), 0)::bigint AS month_minor,
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

  static readonly ListTransactions = z.object({
    fund: z.string().max(40).optional(),
    status: z.enum(["requires_action", "processing", "succeeded", "failed", "refunded"]).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    before: z.string().optional(), // keyset on created_at ISO
  });

  async listTransactions(
    q: z.infer<typeof FinancialService.ListTransactions>,
  ): Promise<{ data: unknown[]; next_cursor: string | null }> {
    const params: unknown[] = [];
    const where: string[] = ["TRUE"];
    if (q.fund) {
      params.push(q.fund);
      where.push(`f.code = $${params.length}`);
    }
    if (q.status) {
      params.push(q.status);
      where.push(`t.status = $${params.length}::txn_status`);
    }
    if (q.before) {
      params.push(q.before);
      where.push(`t.created_at < $${params.length}`);
    }
    params.push(q.limit + 1);
    const rows = await many<Record<string, unknown>>(
      this.pool,
      `SELECT t.transaction_id, u.full_name, t.amount_minor, t.currency, t.status,
              f.code AS fund, t.account_name, t.created_at, t.settled_at,
              COALESCE(t.provider, CASE WHEN t.stripe_payment_intent IS NOT NULL THEN 'card' END) AS method
         FROM transactions t
         LEFT JOIN funds f ON f.fund_id = t.fund_id
         LEFT JOIN users u ON u.user_id = t.user_id
        WHERE ${where.join(" AND ")}
        ORDER BY t.created_at DESC
        LIMIT $${params.length}`,
      params,
    );
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const last = page[page.length - 1];
    return {
      data: page.map((r) => ({ ...r, amount_minor: Number(r.amount_minor) })),
      next_cursor: hasMore && last ? String(last.created_at) : null,
    };
  }

  /** Recent double-entry ledger postings (always balanced, §5.6). */
  async listLedger(limit = 100): Promise<unknown[]> {
    const rows = await many<Record<string, unknown>>(
      this.pool,
      `SELECT le.entry_id, le.transaction_id, le.account, le.side::text, le.amount_minor,
              le.currency, le.created_at
         FROM ledger_entries le
        ORDER BY le.created_at DESC
        LIMIT $1`,
      [Math.min(Math.max(limit, 1), 500)],
    );
    return rows.map((r) => ({ ...r, amount_minor: Number(r.amount_minor) }));
  }

  /** Settled giving totals per month for the overview trend chart (oldest → newest). */
  async financeTrend(months = 6): Promise<{ data: { m: string; month: string; total_minor: number }[] }> {
    const n = Math.min(Math.max(months, 1), 24);
    const rows = await many<Record<string, unknown>>(
      this.pool,
      `SELECT to_char(gs.m, 'Mon') AS m, gs.m AS month,
              COALESCE(sum(t.amount_minor) FILTER (WHERE t.status = 'succeeded'), 0)::bigint AS total_minor
         FROM generate_series(
                date_trunc('month', now()) - (($1::int - 1) * interval '1 month'),
                date_trunc('month', now()),
                interval '1 month') gs(m)
         LEFT JOIN transactions t ON date_trunc('month', t.settled_at) = gs.m
        GROUP BY gs.m
        ORDER BY gs.m`,
      [n],
    );
    return {
      data: rows.map((r) => ({ m: String(r.m), month: String(r.month), total_minor: Number(r.total_minor) })),
    };
  }

  static readonly ListFinanceAudit = z.object({
    actor: z.enum(["All", "System", "Admin"]).default("All"),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  });

  /** Finance-scoped slice of the append-only audit trail (§5.10) — the money paper trail. */
  async financeAudit(
    q: z.infer<typeof FinancialService.ListFinanceAudit>,
  ): Promise<{ data: unknown[] }> {
    const params: unknown[] = [];
    const where: string[] = [
      "(a.action LIKE 'giving.%' OR a.action LIKE 'purchase.%' OR a.action LIKE 'finance.%' OR a.action LIKE 'webhook.%')",
    ];
    if (q.actor === "System") where.push("a.actor_id IS NULL");
    else if (q.actor === "Admin") where.push("a.actor_id IS NOT NULL");
    params.push(q.limit);
    const rows = await many<Record<string, unknown>>(
      this.pool,
      `SELECT a.audit_id, a.actor_id, u.full_name AS actor_name, a.action, a.entity,
              a.entity_id, a.metadata, a.occurred_at,
              CASE WHEN a.actor_id IS NULL THEN 'System' ELSE 'Admin' END AS actor_type
         FROM audit_log a LEFT JOIN users u ON u.user_id = a.actor_id
        WHERE ${where.join(" AND ")}
        ORDER BY a.audit_id DESC
        LIMIT $${params.length}`,
      params,
    );
    return { data: rows };
  }

  /** A single transaction plus its balanced ledger postings (for the detail drawer). */
  async transactionDetail(id: string): Promise<Record<string, unknown> | null> {
    const txn = await maybeOne<Record<string, unknown>>(
      this.pool,
      `SELECT t.transaction_id, u.full_name, t.amount_minor, t.currency, t.status,
              f.code AS fund, f.name AS fund_name, t.account_name, t.created_at, t.settled_at,
              COALESCE(t.provider, CASE WHEN t.stripe_payment_intent IS NOT NULL THEN 'card' END) AS method,
              t.provider_ref, t.stripe_payment_intent, t.idempotency_key
         FROM transactions t
         LEFT JOIN funds f ON f.fund_id = t.fund_id
         LEFT JOIN users u ON u.user_id = t.user_id
        WHERE t.transaction_id = $1`,
      [id],
    );
    if (!txn) return null;
    const entries = await many<Record<string, unknown>>(
      this.pool,
      `SELECT entry_id, account, side::text AS side, amount_minor, currency, created_at
         FROM ledger_entries WHERE transaction_id = $1 ORDER BY side DESC`,
      [id],
    );
    return {
      transaction: { ...txn, amount_minor: Number(txn.amount_minor) },
      ledger_entries: entries.map((e) => ({ ...e, amount_minor: Number(e.amount_minor) })),
    };
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
