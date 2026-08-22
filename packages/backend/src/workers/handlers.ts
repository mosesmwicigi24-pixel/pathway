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

  /**
   * Welcome by text whoever just walked in and checked in.
   *
   * TRANSACTIONAL, so — like the giving receipt — it is not gated on the opt-in
   * `sms_enabled` preference: it acknowledges something the person did seconds
   * ago at the door, which is not the broadcast traffic that preference exists
   * to govern. The row is written directly for that reason.
   *
   * Whether the copy mentions the app is decided HERE rather than in the copy,
   * because it is a fact about the person's devices and needs a query. An
   * active push token is the honest signal: it means a build of the app is
   * installed and signed in as them. Absent one, the check-in came through the
   * web join page and the invitation is the useful half of the message.
   */
  handlers.set("attendance.welcome", async (p) => {
    const userId = String(p.user_id ?? "");
    if (!userId) return;
    if (!sms) return; // nothing bound to send with — see the warning in sendMemberlessReceipt

    const who = await maybeOne<{
      full_name: string;
      phone_number: string | null;
      congregation: string | null;
      has_app: boolean;
    }>(
      ctx.db.primary,
      `SELECT u.full_name,
              u.phone_number,
              c.name AS congregation,
              EXISTS (
                SELECT 1 FROM push_tokens pt
                 WHERE pt.user_id = u.user_id AND pt.is_active = TRUE
              ) AS has_app
         FROM users u
         LEFT JOIN congregations c ON c.congregation_id = u.congregation_id
        WHERE u.user_id = $1 AND u.deleted_at IS NULL`,
      [userId],
    );
    // No number on file means no way to welcome them, and no row to leave
    // looking like a delivery failure.
    if (!who?.phone_number) return;

    // One welcome a day, whatever the outbox does. Two things make this matter
    // and neither is hypothetical: the outbox is at-least-once so a redelivery
    // would text somebody twice, and a Sunday with an 8am and an 11am service
    // is two genuine check-ins for anyone who serves at both. Being welcomed to
    // church twice before lunch reads as a broken system, and it is billed as
    // two.
    const already = await maybeOne<{ notification_id: string }>(
      ctx.db.primary,
      `SELECT notification_id FROM notifications
        WHERE user_id = $1 AND channel = 'sms' AND template = 'check_in_welcome'
          AND scheduled_for > now() - interval '20 hours'
        LIMIT 1`,
      [userId],
    );
    if (already) return;

    await ctx.db.primary.query(
      `INSERT INTO notifications (user_id, channel, template, payload, status, scheduled_for)
       VALUES ($1, 'sms', 'check_in_welcome', $2, 'scheduled', now())`,
      [
        userId,
        JSON.stringify({
          member_name: who.full_name,
          congregation: who.congregation,
          has_app: who.has_app,
          app_url: ctx.env.APP_PUBLIC_URL,
          service_id: p.service_id == null ? null : String(p.service_id),
        }),
      ],
    );
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

    const receiptPayload = {
        transaction_id: transactionId,
        amount_minor: Number(txn.amount_minor), // integer minor units — never a float
        currency: txn.currency,
        fund: txn.fund ?? "General Fund",
        member_name: who?.full_name ?? null,
        congregation: who?.congregation ?? "Nuru Place Church",
      date: txn.settled_at ?? txn.created_at,
      receipt_code: txn.receipt_code,
    };

    await notifications.schedule({ userId, channel: "email", template: "giving_receipt", payload: receiptPayload });

    // …and a text, to the number that paid.
    //
    // TRANSACTIONAL, so it is not gated on the opt-in sms_enabled preference:
    // this acknowledges something the member just did, exactly as a payment
    // provider sends a receipt whatever your marketing preferences say. That
    // preference governs BROADCAST sms — announcements and nudges.
    //
    // schedule() would consult it, so the row is written directly, and only
    // when there is a number to send to and a provider bound to send it. A
    // member with no phone on file gets the email and nothing else, rather than
    // a row that fails at dispatch and reads like a delivery problem.
    const contact = await maybeOne<{ phone_number: string | null }>(
      ctx.db.primary,
      `SELECT phone_number FROM users WHERE user_id = $1`,
      [userId],
    );
    if (sms && contact?.phone_number) {
      await ctx.db.primary.query(
        `INSERT INTO notifications (user_id, channel, template, payload, status, scheduled_for)
         VALUES ($1, 'sms', 'giving_receipt', $2, 'scheduled', now())`,
        [userId, JSON.stringify(receiptPayload)],
      );
    }
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
