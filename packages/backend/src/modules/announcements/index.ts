// Module: announcements (Design Contract Matrix B5)
// Admin composes/schedules multi-channel announcements; members fetch their
// in-app banners and post open receipts. All admin routes are Admin+.
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal, requirePlacement } from "../../http/http.js";
import { buildEmailProvider } from "../identity/email.js";
import { AnnouncementService } from "./service.js";

const IdParam = z.object({ id: z.string().uuid() });

export const announcementsRouter: Router = Router();

export function registerAnnouncements(ctx: AppContext, svc?: AnnouncementService): Router {
  // EVENTS_ARCHITECTURE §5: the email channel rides the real SMTP EmailProvider
  // (same infra as password reset; logging fallback when SMTP env is absent so
  // dev/tests run offline). SMS/WhatsApp deliberately have NO provider bound —
  // their deliveries record suppressed(no_provider), never a fabricated send.
  const service = svc ?? new AnnouncementService(ctx.db.primary, { email: buildEmailProvider(ctx.env, ctx.log) });
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
  const r = announcementsRouter;

  // ---- Admin ----
  r.get("/admin/announcements", ...adminOnly, handler(async (req, res) => {
    const q = parseBody(AnnouncementService.List, req.query);
    res.json(await service.list(q, scopeOf(req)));
  }));

  r.post("/admin/announcements", ...adminOnly, handler(async (req, res) => {
    const input = parseBody(AnnouncementService.Compose, req.body);
    res.status(201).json(await service.create(requirePrincipal(req).userId, input));
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
