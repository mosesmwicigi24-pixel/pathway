// Module: ekklesia — the congregation's intercessory watch (Prayer Room's
// fifth segment, the Home card, and the invitations across the app).
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { NotificationService } from "../notifications/service.js";
import { EkklesiaService } from "./service.js";

const Id = z.string().uuid();

export function registerEkklesia(ctx: AppContext): Router {
  const r = Router();
  const auth = authenticate(ctx.env);
  const svc = new EkklesiaService(ctx.db.primary, new NotificationService(ctx.db.primary));

  // The watch: group, counts, requests (bodies for intercessors only).
  r.get("/ekklesia", auth, handler(async (req, res) => {
    const status = req.query.status === "answered" ? "answered" : "active";
    res.json(await svc.overview(requirePrincipal(req).userId, status));
  }));
  // Home card + the invitations on other pages.
  r.get("/ekklesia/summary", auth, handler(async (req, res) => {
    res.json(await svc.summary(requirePrincipal(req).userId));
  }));
  r.post("/ekklesia/join", auth, handler(async (req, res) => {
    res.json(await svc.join(requirePrincipal(req).userId));
  }));
  r.post("/ekklesia/leave", auth, handler(async (req, res) => {
    res.json(await svc.leave(requirePrincipal(req).userId));
  }));
  r.post("/ekklesia/members/:userId/role", auth, handler(async (req, res) => {
    const { role } = parseBody(EkklesiaService.MemberRole, req.body);
    res.json(await svc.setMemberRole(requirePrincipal(req).userId, Id.parse(req.params.userId), role));
  }));

  r.post("/ekklesia/requests", auth, handler(async (req, res) => {
    res.status(201).json(await svc.createRequest(requirePrincipal(req).userId, parseBody(EkklesiaService.Request, req.body)));
  }));
  r.get("/ekklesia/requests/:id", auth, handler(async (req, res) => {
    res.json(await svc.getRequest(requirePrincipal(req).userId, Id.parse(req.params.id)));
  }));
  r.delete("/ekklesia/requests/:id", auth, handler(async (req, res) => {
    res.json(await svc.remove(requirePrincipal(req).userId, Id.parse(req.params.id)));
  }));
  r.post("/ekklesia/requests/:id/intercede", auth, handler(async (req, res) => {
    res.json(await svc.intercede(requirePrincipal(req).userId, Id.parse(req.params.id)));
  }));
  r.post("/ekklesia/requests/:id/updates", auth, handler(async (req, res) => {
    res.status(201).json(await svc.addUpdate(requirePrincipal(req).userId, Id.parse(req.params.id), parseBody(EkklesiaService.Update, req.body)));
  }));
  r.post("/ekklesia/requests/:id/answered", auth, handler(async (req, res) => {
    res.json(await svc.setAnswered(requirePrincipal(req).userId, Id.parse(req.params.id), parseBody(EkklesiaService.Answered, req.body)));
  }));
  r.post("/ekklesia/requests/:id/pinned", auth, handler(async (req, res) => {
    const { pinned } = parseBody(EkklesiaService.Pinned, req.body);
    res.json(await svc.setPinned(requirePrincipal(req).userId, Id.parse(req.params.id), pinned));
  }));
  return r;
}
