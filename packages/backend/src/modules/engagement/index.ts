// Module: engagement (spec §1.5, §1.8)
// Owns: the Eᵢ pipeline (nightly recompute + incremental), the engagement_scores
// snapshot, and the multiplier cohort/member read surface (§3.3 portal).
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { EngagementService } from "./service.js";

export const engagementRouter: Router = Router();

const CohortQuery = z.object({
  order: z.enum(["asc", "desc"]).optional(),
  band: z.enum(["thriving", "steady", "watch", "at_risk"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export function registerEngagement(ctx: AppContext): Router {
  const svc = new EngagementService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const r = engagementRouter;

  // Cohort table: members of a cell, lowest engagement first; Instructor+ only,
  // scoped to the caller's leader_assignments (§5.4).
  r.get(
    "/cohorts/:cell_id/members",
    auth,
    requireRole("Instructor"),
    handler(async (req, res) => {
      const q = parseBody(CohortQuery, req.query);
      const opts: { order?: "asc" | "desc"; band?: string; limit?: number } = {};
      if (q.order) opts.order = q.order;
      if (q.band) opts.band = q.band;
      if (q.limit !== undefined) opts.limit = q.limit;
      res.json({ data: await svc.cohort(requirePrincipal(req), req.params.cell_id ?? "", opts) });
    }),
  );

  r.get(
    "/members/:id/engagement",
    auth,
    requireRole("Instructor"),
    handler(async (req, res) => {
      res.json(await svc.member(requirePrincipal(req), req.params.id ?? ""));
    }),
  );

  return r;
}
