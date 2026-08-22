// Module: announcements (Design Contract Matrix B5)
// Admin composes/schedules multi-channel announcements; members fetch their
// in-app banners and post open receipts. All admin routes are Admin+.
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal, requirePlacement } from "../../http/http.js";
import { buildEmailProvider } from "../identity/email.js";
import { buildSmsProvider } from "./africastalking.js";
import { AnnouncementService } from "./service.js";

const IdParam = z.object({ id: z.string().uuid() });

/**
 * A FRESH Router per registration, deliberately unlike the module-level
 * singletons most modules export.
 *
 * With a singleton, every createApp() re-registers these handlers onto the same
 * object and the FIRST registration permanently wins — so a second app built
 * with different env is served by the first app's closures, which still hold
 * the first env. That is not hypothetical here: /admin/announcements/channels
 * reports whether an SMS provider is bound, read from ctx.env, and under a
 * singleton it answered "no provider" for an app that had one.
 *
 * Nothing outside this file imported the old exported router.
 */

export function registerAnnouncements(ctx: AppContext, svc?: AnnouncementService): Router {
  // EVENTS_ARCHITECTURE §5: the email channel rides the real SMTP EmailProvider
  // (same infra as password reset; logging fallback when SMTP env is absent so
  // dev/tests run offline). SMS/WhatsApp deliberately have NO provider bound —
  // their deliveries record suppressed(no_provider), never a fabricated send.
  // SMS is bound when Africa's Talking is configured, and left unbound when it
  // is not — the service records suppressed(no_provider) in that case, which is
  // honest, rather than a fake provider swallowing the message.
  // Built once and reused: constructing it twice made two HTTP clients and two
  // sets of credentials for one channel.
  const smsProvider = buildSmsProvider(ctx.env, ctx.log);
  const service =
    svc ??
    new AnnouncementService(ctx.db.primary, {
      email: buildEmailProvider(ctx.env, ctx.log),
      ...(smsProvider ? { sms: smsProvider } : {}),
    });
  const auth = authenticate(ctx.env);
  const adminOnly = [auth, requireRole("Admin")] as const;
  // Admin reads/writes are scoped to the caller's congregation (§5 multi-tenant
  // fix; legacy NULL-congregation rows stay visible). SuperAdmin sees all.
  // An UNPLACED non-SuperAdmin cannot fall through to the "sees all" arm —
  // in this service's queries an absent scope means everything, and "no
  // congregation" must never widen into "every congregation". They get the
  // named placement refusal instead.
  const scopeOf = (req: Parameters<typeof requirePrincipal>[0]): string | undefined => {
    const p = requirePrincipal(req);
    return p.role === "SuperAdmin" ? undefined : requirePlacement(p);
  };
  const r = Router();

  // ---- Admin ----
  r.get("/admin/announcements", ...adminOnly, handler(async (req, res) => {
    const q = parseBody(AnnouncementService.List, req.query);
    res.json(await service.list(q, scopeOf(req)));
  }));

  r.post("/admin/announcements", ...adminOnly, handler(async (req, res) => {
    const input = parseBody(AnnouncementService.Compose, req.body);
    res.status(201).json(await service.create(requirePrincipal(req).userId, input));
  }));

  // Registered BEFORE /admin/announcements/:id — Express matches in order, so
  // with :id first the literal path "channels" is read as an announcement id
  // and every request 400s on an invalid uuid.
  // Which channels can actually deliver right now.
  //
  // The composer used to hardcode `available: false` for SMS and WhatsApp with
  // the note "awaiting provider" — true when it was written, and it would have
  // stayed on screen after Africa's Talking was wired, because nothing told the
  // portal otherwise. Availability is a property of the deployment, so the
  // deployment reports it.
  r.get("/admin/announcements/channels", ...adminOnly, handler(async (_req, res) => {
    const smsBound = Boolean(smsProvider);
    res.json({
      channels: [
        { key: "push", available: true },
        { key: "email", available: true },
        { key: "banner", available: true },
        {
          key: "sms",
          available: smsBound,
          ...(smsBound ? { note: "costs the church per message" } : { note: "awaiting provider" }),
        },
        { key: "whatsapp", available: false, note: "awaiting provider" },
      ],
    });
  }));

  r.get("/admin/announcements/:id", ...adminOnly, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await service.get(id, scopeOf(req)));
  }));

  r.put("/admin/announcements/:id", ...adminOnly, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const input = parseBody(AnnouncementService.Compose, req.body);
    res.json(await service.update(requirePrincipal(req).userId, id, input));
  }));

  // What pressing send would actually cost, per channel. Read-only, and
  // deliberately its own call rather than folded into the detail route: an
  // admin should be able to ask "how many?" without any risk of sending.
  r.get("/admin/announcements/:id/reach", ...adminOnly, handler(async (req, res) => {
    res.json(await service.reach(String(req.params.id)));
  }));

  r.post("/admin/announcements/:id/send", ...adminOnly, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await service.send(requirePrincipal(req).userId, id));
  }));

  r.post("/admin/announcements/:id/cancel", ...adminOnly, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await service.cancel(requirePrincipal(req).userId, id));
  }));

  // Hard-stop delete (soft, any status) — Edit/Delete on the portal.
  r.delete("/admin/announcements/:id", ...adminOnly, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await service.remove(requirePrincipal(req).userId, id));
  }));

  // §5 lifecycle: duplicate (also "resend" / "use as template"), archive, restore.
  r.post("/admin/announcements/:id/duplicate", ...adminOnly, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.status(201).json(await service.duplicate(requirePrincipal(req).userId, id));
  }));
  r.post("/admin/announcements/:id/archive", ...adminOnly, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await service.setArchived(requirePrincipal(req).userId, id, true));
  }));
  r.post("/admin/announcements/:id/restore", ...adminOnly, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await service.setArchived(requirePrincipal(req).userId, id, false));
  }));

  // Feature / unfeature on the mobile homepage (single featured).
  r.post("/admin/announcements/:id/homepage", ...adminOnly, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await service.setFeatured(requirePrincipal(req).userId, id, true));
  }));
  r.delete("/admin/announcements/:id/homepage", ...adminOnly, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await service.setFeatured(requirePrincipal(req).userId, id, false));
  }));

  // Attach / clear a video on an announcement (from the Video Library).
  r.post("/admin/announcements/:id/video", ...adminOnly, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const { url } = parseBody(z.object({ url: z.string().url().max(2048) }), req.body ?? {});
    res.json(await service.setVideo(requirePrincipal(req).userId, id, url));
  }));
  r.delete("/admin/announcements/:id/video", ...adminOnly, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await service.setVideo(requirePrincipal(req).userId, id, null));
  }));

  // ---- Member ----
  r.get("/me/announcements", auth, handler(async (req, res) => {
    res.json(await service.myAnnouncements(requirePrincipal(req).userId));
  }));

  // The single homepage-featured announcement for the mobile Home screen —
  // per-congregation (§8); wire shape unchanged.
  r.get("/home/featured-announcement", auth, handler(async (req, res) => {
    res.json({ data: await service.featured(requirePrincipal(req).congregationId) });
  }));

  r.get("/announcements/:id", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await service.memberDetail(requirePrincipal(req).userId, id));
  }));

  r.post("/announcements/:id/open", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await service.markOpened(requirePrincipal(req).userId, id));
  }));

  return r;
}
