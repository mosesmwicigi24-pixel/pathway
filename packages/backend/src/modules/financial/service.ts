// Financial service (spec §1.10 Flow C, §3.5, §5.6). Giving via Stripe, an
// idempotent HMAC-verified webhook, and a balanced double-entry ledger. Money is
// always integer minor units + ISO currency — never floats — and never queued
// offline.
import type { Pool, PoolClient } from "pg";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { maybeOne, one, many, tx, audit, enqueueOutbox } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import type { PaymentGateway } from "./gateway.js";

const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

export class FinancialService {
  constructor(
    private readonly pool: Pool,
    private readonly gateway: PaymentGateway,
  ) {}

  static readonly GivingIntent = z.object({
    fund: z.enum(["tithe", "offering", "general", "media"]),
    amount_minor: z.number().int().positive(),
    currency: z.string().length(3),
    idempotency_key: z.string().min(8).max(255).optional(),
  });

  /** Create a Stripe PaymentIntent and the matching pending transaction (§1.10 C). */
  async createGivingIntent(
    userId: string,
    input: z.infer<typeof FinancialService.GivingIntent>,
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
    const intent = await this.gateway.createIntent({
      amountMinor: input.amount_minor,
      currency,
      metadata: { user_id: userId, fund: input.fund },
    });

    const txn = await one<{ transaction_id: string; status: string }>(
      this.pool,
      `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, stripe_payment_intent, idempotency_key)
       VALUES ($1, $2, $3, $4, 'processing', $5, $6)
       RETURNING transaction_id, status`,
      [userId, fund.fund_id, input.amount_minor, currency, intent.id, key],
    );
    await audit(this.pool, userId, "giving.intent_created", "transactions", txn.transaction_id, {
      amount_minor: input.amount_minor,
      currency,
      fund: input.fund,
    });
    return {
      transaction_id: txn.transaction_id,
      client_secret: intent.client_secret,
      status: txn.status,
      idempotency_key: key,
      reused: false,
    };
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
        await this.settle(c, String(event.data.object.id ?? ""));
      } else if (event.type === "payment_intent.payment_failed") {
        await c.query(
          `UPDATE transactions SET status = 'failed' WHERE stripe_payment_intent = $1 AND status <> 'succeeded'`,
          [String(event.data.object.id ?? "")],
        );
      }
      return { duplicate: false, type: event.type };
    });
  }

  /** Mark a transaction succeeded and post the balanced double-entry rows. */
  private async settle(c: PoolClient, paymentIntentId: string): Promise<void> {
    const txn = await maybeOne<{
      transaction_id: string;
      amount_minor: string;
      currency: string;
      status: string;
      fund_code: string | null;
    }>(
      c,
      `SELECT t.transaction_id, t.amount_minor, t.currency, t.status, f.code AS fund_code
         FROM transactions t LEFT JOIN funds f ON f.fund_id = t.fund_id
        WHERE t.stripe_payment_intent = $1 FOR UPDATE OF t`,
      [paymentIntentId],
    );
    if (!txn || txn.status === "succeeded") return; // unknown intent or already settled

    await c.query(`UPDATE transactions SET status = 'succeeded', settled_at = now() WHERE transaction_id = $1`, [
      txn.transaction_id,
    ]);
    // Debit cash, credit the fund — equal and opposite, same currency (§5.6).
    await c.query(
      `INSERT INTO ledger_entries (transaction_id, account, side, amount_minor, currency)
       VALUES ($1, 'cash:stripe', 'debit', $2, $3), ($1, $4, 'credit', $2, $3)`,
      [txn.transaction_id, txn.amount_minor, txn.currency, `fund:${txn.fund_code ?? "general"}`],
    );
    await enqueueOutbox(c, "giving.receipt", { transaction_id: txn.transaction_id });
  }

  /** A member's giving history (§3.3). */
  async listGiving(userId: string): Promise<unknown[]> {
    const rows = await many<Record<string, unknown>>(
      this.pool,
      `SELECT t.transaction_id, t.amount_minor, t.currency, t.status, f.code AS fund, t.created_at, t.settled_at
         FROM transactions t LEFT JOIN funds f ON f.fund_id = t.fund_id
        WHERE t.user_id = $1 ORDER BY t.created_at DESC`,
      [userId],
    );
    return rows.map((r) => ({ ...r, amount_minor: Number(r.amount_minor) }));
  }
}
