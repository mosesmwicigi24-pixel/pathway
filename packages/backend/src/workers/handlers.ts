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
    if (!transactionId || !userId) return; // malformed payload — nothing to receipt

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

  return handlers;
}
