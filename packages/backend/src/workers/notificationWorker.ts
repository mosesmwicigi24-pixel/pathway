// Notification dispatch worker (spec §1.5). Drains due scheduled notifications,
// resolves the recipient (push token or email), sends via the provider, and marks
// sent/failed. Claims with FOR UPDATE OF n + SKIP LOCKED so multiple workers are
// safe; sends inside the row's tx (notif_status has no 'processing' state).
import type { Pool } from "pg";
import type { Logger } from "pino";
import { many, maybeOne, tx } from "../db/db.js";
import type { DispatchProvider } from "./dispatch.js";

export class NotificationWorker {
  constructor(
    private readonly pool: Pool,
    private readonly provider: DispatchProvider,
    private readonly log?: Logger,
    private readonly batchSize = 50,
  ) {}

  async dispatchDue(): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    await tx(this.pool, async (c) => {
      const rows = await many<{
        notification_id: string;
        user_id: string;
        channel: "push" | "email" | "sms";
        template: string;
        payload: Record<string, unknown>;
        email: string | null;
        phone_number: string | null;
      }>(
        c,
        `SELECT n.notification_id, n.user_id, n.channel, n.template, n.payload, u.email, u.phone_number
           FROM notifications n JOIN users u ON u.user_id = n.user_id
          WHERE n.status = 'scheduled' AND n.scheduled_for <= now()
          ORDER BY n.scheduled_for
          FOR UPDATE OF n SKIP LOCKED
          LIMIT $1`,
        [this.batchSize],
      );

      for (const r of rows) {
        try {
          // Each channel is addressed differently: an email address, a phone
          // number, or the most recent active push token. A member with no
          // phone on file has no SMS address, and the row below fails honestly
          // rather than being marked sent to nobody.
          const to =
            r.channel === "email"
              ? r.email
              : r.channel === "sms"
                ? r.phone_number
                : (
                  await maybeOne<{ token: string }>(
                    c,
                    `SELECT token FROM push_tokens WHERE user_id = $1 AND is_active ORDER BY updated_at DESC LIMIT 1`,
                    [r.user_id],
                  )
                  )?.token ?? null;

          if (!to) {
            await c.query(`UPDATE notifications SET status = 'failed' WHERE notification_id = $1`, [r.notification_id]);
            failed += 1;
            continue;
          }
          // A giving-receipt TEXT is claimed on its transaction before it is
          // sent — through the POOL, not `c`, so the claim commits on its own:
          // if this batch's transaction later aborts (crash mid-batch), the
          // row returns to 'scheduled' but the claim SURVIVES, and the rerun
          // lands here, loses the claim, and marks the row sent instead of
          // texting the giver twice. Also swallows duplicate rows outright,
          // should any path ever insert two for one gift.
          if (r.channel === "sms" && r.template === "giving_receipt") {
            const txnId = typeof r.payload.transaction_id === "string" ? r.payload.transaction_id : null;
            if (txnId) {
              const claimed = await maybeOne(
                this.pool,
                `UPDATE transactions SET receipt_sms_at = now(), receipt_sms_ref = COALESCE(receipt_sms_ref, 'claimed')
                  WHERE transaction_id = $1 AND receipt_sms_at IS NULL
                  RETURNING transaction_id`,
                [txnId],
              );
              if (!claimed) {
                await c.query(`UPDATE notifications SET status = 'sent', sent_at = now() WHERE notification_id = $1`, [
                  r.notification_id,
                ]);
                this.log?.info(
                  { notification_id: r.notification_id, transaction_id: txnId },
                  "giving receipt already claimed — row closed without re-sending",
                );
                sent += 1;
                continue;
              }
            }
          }
          await this.provider.send({ channel: r.channel, to, template: r.template, payload: r.payload });
          await c.query(`UPDATE notifications SET status = 'sent', sent_at = now() WHERE notification_id = $1`, [
            r.notification_id,
          ]);
          sent += 1;
        } catch (err) {
          await c.query(`UPDATE notifications SET status = 'failed' WHERE notification_id = $1`, [r.notification_id]);
          // A refusal Africa's Talking actually answered releases the receipt
          // claim — the text did NOT go, and the column must not say it did.
          // A timeout keeps it: maybe-sent, and at-most-once wins.
          if (
            r.channel === "sms" &&
            r.template === "giving_receipt" &&
            (err as { definitelyNotSent?: boolean }).definitelyNotSent &&
            typeof r.payload.transaction_id === "string"
          ) {
            await this.pool.query(
              `UPDATE transactions SET receipt_sms_at = NULL, receipt_sms_ref = NULL
                WHERE transaction_id = $1 AND receipt_sms_ref = 'claimed'`,
              [r.payload.transaction_id],
            );
          }
          failed += 1;
          this.log?.error({ err, notification_id: r.notification_id }, "notification dispatch failed");
        }
      }
    });
    return { sent, failed };
  }

  start(intervalMs = 10_000): () => void {
    const timer = setInterval(() => {
      void this.dispatchDue().catch((err) => this.log?.error({ err }, "notification drain crashed"));
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
    return () => clearInterval(timer);
  }
}
