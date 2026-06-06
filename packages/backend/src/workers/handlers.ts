// Outbox topic → handler registry (spec §1.6). Each handler is idempotent so an
// at-least-once redelivery is safe. New asynchronous side effects (notifications,
// media renders) register here as their modules land.
import type { AppContext } from "../http/context.js";
import { CertificateService } from "../modules/certificates/service.js";
import { EngagementService } from "../modules/engagement/service.js";
import type { OutboxHandler } from "./outbox.js";

export function buildOutboxHandlers(ctx: AppContext): Map<string, OutboxHandler> {
  const certs = new CertificateService(ctx.db.primary, ctx.env.CERT_SIGNING_KEY ?? ctx.env.JWT_SIGNING_KEY);
  const engagement = new EngagementService(ctx.db.primary);

  const handlers = new Map<string, OutboxHandler>();

  // Flow B: an approved reflection enqueues this; issue the level credential.
  handlers.set("certificate.issue", async (p) => {
    await certs.issue(String(p.user_id), p.level_number == null ? null : Number(p.level_number));
  });

  // High-signal events trigger a single-member engagement refresh (§1.8).
  handlers.set("engagement.recompute", async (p) => {
    await engagement.recomputeOne(String(p.user_id));
  });

  return handlers;
}
