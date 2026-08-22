// Outbox topic → handler registry (spec §1.6). Each handler is idempotent so an
// at-least-once redelivery is safe. New asynchronous side effects (notifications,
// media renders) register here as their modules land.
import type { AppContext } from "../http/context.js";
import { maybeOne } from "../db/db.js";
import { CertificateService } from "../modules/certificates/service.js";
import { buildObjectStore } from "../modules/certificates/objectStore.js";
import { EngagementService } from "../modules/engagement/service.js";
import { NotificationService } from "../modules/notifications/service.js";
import { MediaService } from "../modules/media/service.js";
import { VideoService } from "../modules/media/video.js";
import { buildVideoPipeline } from "../modules/media/pipeline.js";
import { CalendarService } from "../modules/calendar/service.js";
import { GamificationService } from "../modules/gamification/service.js";
import type { OutboxHandler } from "./outbox.js";
import { CadenceService } from "../modules/attendance/cadence.js";
import { buildSmsProvider } from "../modules/announcements/africastalking.js";

export function buildOutboxHandlers(ctx: AppContext): Map<string, OutboxHandler> {
  // Cert PDFs render to the shared object store (disk under MEDIA_STORAGE_DIR by
  // default) so GET /media/certificates/{code} can serve them; swap → S3/Cloudinary
  // in production.
  const certs = new CertificateService(
    ctx.db.primary,
    ctx.env.CERT_SIGNING_KEY ?? ctx.env.JWT_SIGNING_KEY,
    ctx.objectStore ?? buildObjectStore(ctx.env),
  );
  const engagement = new EngagementService(ctx.db.primary);
  const notifications = new NotificationService(ctx.db.primary);
  const cadence = new CadenceService(ctx.db.primary, notifications, ctx.log);
  const video = new VideoService(ctx.db.primary, new MediaService(ctx.env.CLOUDINARY_URL), buildVideoPipeline(ctx.env));
  // Undefined unless Africa's Talking is configured. Used for the one message
  // the notifications system structurally cannot send: a receipt to a giver who
  // has no account (see sendMemberlessReceipt below).
  const sms = ctx.smsProvider ?? buildSmsProvider(ctx.env);

  const handlers = new Map<string, OutboxHandler>();

  // Features v2 §V.3: transcode a completed upload (idempotent on asset+content_hash).
  handlers.set("media.transcode", async (p) => {
    await video.transcodeAsset({ media_asset_id: String(p.media_asset_id), content_hash: String(p.content_hash) });
  });

  // Features v2 §C.3 / EVENTS_ARCHITECTURE §2: materialize a series' occurrences
  // into events over the rolling default window (idempotent upsert).
  const calendar = new CalendarService(ctx.db.primary, ctx.env.CAL_MAX_INSTANCES);
  handlers.set("calendar.materialize", async (p) => {
    await calendar.materialize(String(p.series_id));
  });

  // Features v2 §G.3: re-evaluate the badge catalog against a member's verified
  // stats on a high-signal event; award notification + the award itself.
  const gamification = new GamificationService(ctx.db.primary);
  handlers.set("gamification.evaluate", async (p) => {
    await gamification.evaluateForUser(String(p.user_id));
  });
  handlers.set("notification.badge_awarded", async (p) => {
    await notifications.schedule({
      userId: String(p.user_id ?? ""),
      channel: "push",
      template: "badge_awarded",
      payload: p,
    });
  });

  // The discipler-usher advancement enqueues this (§2.4 single advancement
  // writer); issue the level credential.
  handlers.set("certificate.issue", async (p) => {
    await certs.issue(String(p.user_id), p.level_number == null ? null : Number(p.level_number));
  });

  // A member's first-ever service attendance arms the first-visit cadence.
  // Enqueued from inside the check-in transaction rather than run there, so a
  // follow-up rhythm can never fail somebody's check-in — the scan at the door
  // matters more than the sequence that follows it.
  handlers.set("follow_up.arm", async (p) => {
    await cadence.arm(String(p.congregation_id), String(p.user_id), p.trigger as never, {
      serviceId: p.service_id == null ? null : String(p.service_id),
    });
  });

  // High-signal events trigger a single-member engagement refresh (§1.8).
  handlers.set("engagement.recompute", async (p) => {
    await engagement.recomputeOne(String(p.user_id));
  });

  // Member-facing nudges (§1.5), quiet-hours + daily-cap aware.
  handlers.set("notification.level_completed", async (p) => {
    await notifications.schedule({
      userId: String(p.user_id),
      channel: "push",
      template: "level_completed",
      payload: p,
    });
  });
  // Bug fix (giving receipts were silently discarded — buildDispatchProvider
  // never had an email provider wired up, see dispatch.ts): the outbox
  // payload only carries ids, on purpose (§1.6 outbox rows should be small
  // and re-derivable) — enrich it here with everything the receipt email
  // needs to render, straight from the ledger, so dispatch.ts can stay a
  // dumb renderer with no DB access of its own.
  handlers.set("giving.receipt", async (p) => {
    const transactionId = String(p.transaction_id ?? "");
    const userId = String(p.user_id ?? "");
    if (!transactionId) return; // malformed payload — nothing to receipt

    // No user means a website gift (migration 202): a stranger with a phone and
    // no account. `notifications` rows are keyed to a user_id, so nothing in
    // that system can reach them — this used to `return` here, and the giver
    // got Safaricom's SMS and nothing whatever from the church. Text them
    // instead, on the number that paid.
    if (!userId) {
      await sendMemberlessReceipt(transactionId);
      return;
    }

    const txn = await maybeOne<{
      amount_minor: string;
      currency: string;
      fund: string | null;
      created_at: string;
      settled_at: string | null;
      receipt_code: string | null;
    }>(
      ctx.db.primary,
      `SELECT t.amount_minor, t.currency, f.name AS fund, t.created_at, t.settled_at, t.receipt_code
         FROM transactions t LEFT JOIN funds f ON f.fund_id = t.fund_id
        WHERE t.transaction_id = $1 AND t.user_id = $2`,
      [transactionId, userId],
    );
    if (!txn) return; // transaction gone/reassigned since enqueue — idempotent no-op

    const who = await maybeOne<{ full_name: string; congregation: string | null }>(
      ctx.db.primary,
      `SELECT u.full_name, c.name AS congregation
         FROM users u LEFT JOIN congregations c ON c.congregation_id = u.congregation_id
        WHERE u.user_id = $1`,
      [userId],
    );

    await notifications.schedule({
      userId,
      channel: "email",
      template: "giving_receipt",
      payload: {
        transaction_id: transactionId,
        amount_minor: Number(txn.amount_minor), // integer minor units — never a float
        currency: txn.currency,
        fund: txn.fund ?? "General Fund",
        member_name: who?.full_name ?? null,
        congregation: who?.congregation ?? "Nuru Place Church",
        date: txn.settled_at ?? txn.created_at,
        receipt_code: txn.receipt_code,
      },
    });
  });

  /**
   * Thank a giver who has no account, by SMS to the number that paid.
   *
   * Only for settled website gifts. A `processing` row means the giver has not
   * confirmed on their handset yet, and thanking someone for money they have
   * not sent is worse than saying nothing.
   *
   * Idempotent by the outbox's own dedupe? No — the outbox is at-least-once, so
   * a redelivery COULD text someone twice. That is bounded by the outbox's
   * attempt cap and is the right trade here: a duplicate thank-you is a small
   * embarrassment, while a swallowed one leaves a giver unacknowledged. If it
   * ever matters, the fix is a `receipt_sent_at` column rather than silence.
   */
  async function sendMemberlessReceipt(transactionId: string): Promise<void> {
    if (!sms) {
      // Loud, because the alternative is a giver who is never thanked and
      // nobody knowing. Not an error: the church may simply not have wired SMS.
      ctx.log.warn(
        { transaction_id: transactionId },
        "website gift settled but no SMS provider is configured — the giver was not thanked. " +
          "Set AFRICASTALKING_API_KEY and AFRICASTALKING_USERNAME.",
      );
      return;
    }

    const gift = await maybeOne<{
      amount_minor: string;
      currency: string;
      fund: string | null;
      giver_name: string | null;
      giver_phone: string | null;
      receipt_code: string | null;
      status: string;
    }>(
      ctx.db.primary,
      `SELECT t.amount_minor, t.currency, f.name AS fund, t.giver_name, t.giver_phone,
              t.receipt_code, t.status
         FROM transactions t LEFT JOIN funds f ON f.fund_id = t.fund_id
        WHERE t.transaction_id = $1 AND t.source = 'website'`,
      [transactionId],
    );
    if (!gift || gift.status !== "succeeded" || !gift.giver_phone) return;

    // Integer minor units to a human figure — never a float multiply.
    const major = (Number(gift.amount_minor) / 100).toLocaleString("en-KE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const firstName = gift.giver_name?.trim().split(/\s+/)[0];
    const body =
      `${firstName ? `${firstName}, thank` : "Thank"} you for your gift of ` +
      `${gift.currency} ${major} to ${gift.fund ?? "the church"}. ` +
      `${gift.receipt_code ? `M-Pesa ref ${gift.receipt_code}. ` : ""}` +
      `God bless you. — The Good News Mission`;

    try {
      await sms.send({ to: gift.giver_phone, title: "Thank you", body });
    } catch (err) {
      // Rethrow so the outbox retries. Swallowing here would mark the job done
      // and lose the receipt permanently on one transient network blip.
      ctx.log.error({ err, transaction_id: transactionId }, "giving receipt SMS failed");
      throw err;
    }
  }

  return handlers;
}
