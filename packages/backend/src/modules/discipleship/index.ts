// Module: discipleship — the Discipleship Hub (read-aggregation composition layer).
// Three routes: the student's own Hub, and the discipler's roster + per-student
// dossier (Instructor+, scoped to the caller's disciple set; Admin unrestricted).
import { Router } from "express";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole } from "../../http/auth.js";
import { handler, requirePrincipal } from "../../http/http.js";
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

  return r;
}
