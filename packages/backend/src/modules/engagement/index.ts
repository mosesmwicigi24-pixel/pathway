// Module: engagement (spec §1.5, §1.8)
// Owns: the Eᵢ pipeline (nightly recompute + incremental), the engagement_scores
// snapshot, and the multiplier cohort/member read surface (§3.3 portal).
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { EngagementService } from "./service.js";
import { PortalService } from "./portal.js";

export const engagementRouter: Router = Router();

const CohortQuery = z.object({
  band: z.enum(["thriving", "steady", "watch", "at_risk"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});

export function registerEngagement(ctx: AppContext): Router {
  const svc = new EngagementService(ctx.db.primary, ctx.db.replica);
  const portal = new PortalService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const r = engagementRouter;

  // A cell's members, lowest engagement first; Instructor+ only, scoped to the
  // caller's leader_assignments (§5.4). Cursor-paginated (§3.1).
  //
  // Two paths, one handler. The entity is a CELL — the table is `cell_groups`,
  // the path parameter has always been `cell_id`, and the portal calls them
  // cells. `/cohorts` was the pre-rename noun; it stays mounted because
  // shipped iPad and portal builds still call it, and breaking them to tidy a
  // word is not a trade worth making. "Cohort" survives elsewhere in the code
  // with its OTHER, correct meaning: a join-month retention cohort, which is
  // not this and must not be renamed with it.
  r.get(
    ["/cells/:cell_id/members", "/cohorts/:cell_id/members"],
    auth,
    requireRole("Instructor"),
    handler(async (req, res) => {
      const q = parseBody(CohortQuery, req.query);
      const opts: { band?: string; limit?: number; cursor?: string } = {};
      if (q.band) opts.band = q.band;
      if (q.limit !== undefined) opts.limit = q.limit;
      if (q.cursor) opts.cursor = q.cursor;
      res.json(await svc.cohort(requirePrincipal(req), req.params.cell_id ?? "", opts));
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

  // Relationship tree + external milestones (§3.3), scoped to the actor (§5.4).
  r.post(
    "/relationships",
    auth,
    requireRole("Instructor"),
    handler(async (req, res) => {
      const body = parseBody(PortalService.RelationshipSchema, req.body);
      res.status(201).json(await portal.addRelationship(requirePrincipal(req), body));
    }),
  );

  r.patch(
    "/members/:id/milestones",
    auth,
    requireRole("Instructor"),
    handler(async (req, res) => {
      const body = parseBody(PortalService.MilestoneSchema, req.body);
      res.json(await portal.setMilestones(requirePrincipal(req), req.params.id ?? "", body));
    }),
  );

  return r;
}
