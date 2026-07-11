// Module: proximity — opt-in coarse-location ingest, guardian location consent,
// and the RBAC-gated admin pairing-suggestions view (parity gap #4, Phase 1).
// Privacy-first; see service.ts + docs/LOCATION_PROXIMITY_DESIGN.md. Backend only.
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requirePermission } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { ProximityService } from "./service.js";

export const proximityRouter: Router = Router();
const idOf = (req: { params: Record<string, string | undefined> }, k = "id"): string => req.params[k] ?? "";

export function registerProximity(ctx: AppContext): Router {
  const svc = new ProximityService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const perm = requirePermission(ctx.db.replica);
  const r = proximityRouter;

  // ===== Member-facing (opt-in coarse location) =====
  // Send approximate coordinates; the server stores ONLY a coarse geohash and
  // discards the lat/lng. Minors require an active guardian location consent.
  r.post("/me/location", auth, handler(async (req, res) => {
    const input = parseBody(ProximityService.LocationIngest, req.body);
    res.json(await svc.ingest(requirePrincipal(req).userId, input));
  }));
  // Opt out — erase the stored coarse location immediately.
  r.delete("/me/location", auth, handler(async (req, res) => {
    res.json(await svc.optOut(requirePrincipal(req).userId));
  }));

  // ===== Guardian location-sharing consent for a minor (audited) =====
  // Granting/revoking is an admin/guardian-flow action gated by members:proximity.
  // Revoke also deletes the minor's stored location.
  r.post("/admin/members/:id/location-consent", auth, perm("members", "proximity"), handler(async (req, res) => {
    const input = parseBody(ProximityService.LocationConsent, req.body);
    res.status(201).json(await svc.grantLocationConsent(idOf(req), requirePrincipal(req).userId, input));
  }));
  r.delete("/admin/members/:id/location-consent", auth, perm("members", "proximity"), handler(async (req, res) => {
    res.json(await svc.revokeLocationConsent(idOf(req), requirePrincipal(req).userId));
  }));

  // ===== Admin suggestions (RBAC-gated, coarse only) =====
  // Adults to coach-tier (members:proximity); minors only to the coarse Admin role.
  const RadiusQuery = z.object({
    radius_km: z.coerce.number().min(1).max(50).optional(),
    group_by: z.enum(["radius", "city", "country"]).optional(),
  });
  r.get("/admin/members/proximity", auth, perm("members", "proximity"), handler(async (req, res) => {
    const { radius_km, group_by } = parseBody(RadiusQuery, req.query);
    const principal = requirePrincipal(req);
    const includeMinors = principal.role === "Admin" || principal.role === "SuperAdmin";
    res.json(await svc.suggestions({ radiusKm: radius_km ?? 10, includeMinors, groupBy: group_by }));
  }));

  return r;
}
