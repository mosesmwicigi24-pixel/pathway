// Module: discipleship — the Discipleship Hub (read-aggregation composition layer),
// plus (Chat Redesign C2) the discipler-assignment write path. Routes: the
// student's own Hub, the discipler's roster + per-student dossier
// (Instructor+, scoped to the caller's disciple set; Admin unrestricted), and
// admin assignment/history (same scope — assertCellInScope).
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { DiscipleshipService } from "./service.js";

export function registerDiscipleship(ctx: AppContext): Router {
  const svc = new DiscipleshipService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const r = Router();

  // Student-facing: my Discipleship Hub. Any authenticated member (self). Pure GET.
  r.get(
    "/me/discipleship",
    auth,
    handler(async (req, res) => {
      res.json({ data: await svc.myHub(requirePrincipal(req).userId) });
    }),
  );

  // Discipler-facing: the leader's roster + triage across all cells + edges.
  // Instructor+; scoped to the disciple set (Admin/SuperAdmin unrestricted).
  r.get(
    "/disciples",
    auth,
    requireRole("Instructor"),
    handler(async (req, res) => {
      res.json(await svc.roster(requirePrincipal(req)));
    }),
  );

  // Discipler-facing: one student's full journey. 403 FORBIDDEN_SCOPE if the
  // student is not in the caller's disciple set.
  r.get(
    "/disciples/:id",
    auth,
    requireRole("Instructor"),
    handler(async (req, res) => {
      res.json({ data: await svc.dossier(requirePrincipal(req), req.params.id ?? "") });
    }),
  );

  // ---- Discipler assignment (write path, Chat Redesign C2) ----
  // Assign or REASSIGN a member's discipler — history-preserving (unlike the
  // pre-existing one-shot POST /relationships). Same scope as that endpoint.
  r.post(
    "/admin/discipler-assignments",
    auth,
    requireRole("Instructor"),
    handler(async (req, res) => {
      const input = parseBody(DiscipleshipService.AssignDiscipler, req.body);
      res.status(201).json(await svc.assignDiscipler(requirePrincipal(req), input));
    }),
  );

  const DisciplerHistoryQuery = z.object({ disciple_id: z.string().uuid() });
  r.get(
    "/admin/discipler-assignments",
    auth,
    requireRole("Instructor"),
    handler(async (req, res) => {
      const { disciple_id } = parseBody(DisciplerHistoryQuery, req.query);
      res.json(await svc.disciplerAssignmentHistory(requirePrincipal(req), disciple_id));
    }),
  );

  return r;
}
