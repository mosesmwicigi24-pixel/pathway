// Module: thoughts — Selah, My Thoughts (Prayer Room tab 3). Member-scoped
// rich-text journal; there is deliberately no leader/admin read route (§5.4 —
// "Only you can see it", owner spec 2026-07-18).
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { ThoughtsService } from "./service.js";

const IdParam = z.object({ id: z.string().uuid() });

export const thoughtsRouter: Router = Router();

export function registerThoughts(ctx: AppContext): Router {
  const svc = new ThoughtsService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const r = thoughtsRouter;

  r.get("/me/thoughts", auth, handler(async (req, res) => {
    res.json(await svc.list(requirePrincipal(req).userId));
  }));

  r.get("/me/thoughts/:id", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await svc.getById(requirePrincipal(req).userId, id));
  }));

  r.put("/me/thoughts", auth, handler(async (req, res) => {
    const input = parseBody(ThoughtsService.ThoughtUpsert, req.body);
    res.json(await svc.upsert(requirePrincipal(req).userId, input));
  }));

  r.delete("/me/thoughts/:id", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await svc.delete(requirePrincipal(req).userId, id));
  }));

  return r;
}
