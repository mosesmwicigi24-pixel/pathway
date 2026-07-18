// Module: pastoral — "Talk with My Pastor" (Chat Redesign C2). Member-facing
// create-or-open, pastor-facing inbox (password-gated, §5.3), and Admin
// assignment CRUD.
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole, requirePasswordStepUp } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { PastoralService } from "./service.js";

export function registerPastoral(ctx: AppContext): Router {
  const svc = new PastoralService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const r = Router();

  // Member-facing: create-or-open MY thread with my CURRENT pastor. No
  // step-up here — this is the owner's own conversation, not oversight into
  // someone else's (§5.3 step-up guards the PASTOR side reading the inbox
  // below, not this route).
  r.post(
    "/chat/pastoral",
    auth,
    handler(async (req, res) => {
      res.status(201).json(await svc.openMyThread(requirePrincipal(req).userId));
    }),
  );

  // Pastor-facing: every thread I'm the pastor of (or every PASTORAL thread,
  // for a SuperAdmin's oversight/fallback reach). Password-gated (§5.3) — the
  // same posture as Broadcast: reading private pastoral answers needs a
  // fresh password confirmation, not just a valid session.
  r.get(
    "/chat/pastoral/inbox",
    auth,
    requirePasswordStepUp(),
    handler(async (req, res) => {
      const p = requirePrincipal(req);
      res.json(await svc.inbox(p.userId, p.role));
    }),
  );

  // Admin: name (or rename) a member's pastor, or a congregation's default.
  r.post(
    "/admin/pastor-assignments",
    auth,
    requireRole("Admin"),
    handler(async (req, res) => {
      const input = parseBody(PastoralService.AssignPastor, req.body);
      res.status(201).json(await svc.assign(requirePrincipal(req).userId, input));
    }),
  );

  const HistoryQuery = z.object({ member_id: z.string().uuid() });
  r.get(
    "/admin/pastor-assignments",
    auth,
    requireRole("Admin"),
    handler(async (req, res) => {
      const { member_id } = parseBody(HistoryQuery, req.query);
      res.json(await svc.history(member_id));
    }),
  );

  return r;
}
