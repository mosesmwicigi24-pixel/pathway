// Departments — member and office routes (docs/PARTNERS_PROGRAMME.md §4).
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requirePermission } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { NotificationService } from "../notifications/service.js";
import { DepartmentsService } from "./service.js";

export function registerDepartments(ctx: AppContext): Router {
  const r = Router();
  const auth = authenticate(ctx.env);
  const perm = requirePermission(ctx.db.replica);
  const svc = new DepartmentsService(ctx.db.primary, new NotificationService(ctx.db.primary));
  const Id = z.string().uuid();

  // ── member ──
  r.get("/departments", auth, handler(async (req, res) => {
    res.json({ data: await svc.list(requirePrincipal(req).userId) });
  }));
  r.get("/me/departments", auth, handler(async (req, res) => {
    res.json({ data: await svc.myDepartments(requirePrincipal(req).userId) });
  }));
  r.get("/departments/:id", auth, handler(async (req, res) => {
    res.json(await svc.get(requirePrincipal(req).userId, Id.parse(req.params.id)));
  }));
  r.post("/departments/:id/serve", auth, handler(async (req, res) => {
    res.status(201).json(await svc.requestToServe(requirePrincipal(req).userId, Id.parse(req.params.id)));
  }));
  r.delete("/departments/:id/serve", auth, handler(async (req, res) => {
    await svc.leave(requirePrincipal(req).userId, Id.parse(req.params.id));
    res.status(204).end();
  }));
  // Leader-only (checked in the service): posts, needs, serve decisions.
  r.post("/departments/:id/posts", auth, handler(async (req, res) => {
    res.status(201).json(await svc.createPost(requirePrincipal(req).userId, Id.parse(req.params.id), parseBody(DepartmentsService.Post, req.body ?? {})));
  }));
  r.delete("/departments/:id/posts/:postId", auth, handler(async (req, res) => {
    await svc.deletePost(requirePrincipal(req).userId, Id.parse(req.params.id), Id.parse(req.params.postId));
    res.status(204).end();
  }));
  r.post("/departments/:id/needs", auth, handler(async (req, res) => {
    res.status(201).json(await svc.submitNeed(requirePrincipal(req).userId, Id.parse(req.params.id), parseBody(DepartmentsService.Need, req.body ?? {})));
  }));
  r.post("/departments/:id/serve-requests/:userId/:decision", auth, handler(async (req, res) => {
    const decision = z.enum(["approve", "decline"]).parse(req.params.decision);
    res.json(await svc.decideServe(requirePrincipal(req).userId, Id.parse(req.params.id), Id.parse(req.params.userId), decision));
  }));

  // ── office ──
  r.get("/admin/departments", auth, perm("departments", "view"), handler(async (req, res) => {
    res.json({ data: await svc.adminList(requirePrincipal(req).congregationId ?? null) });
  }));
  r.post("/admin/departments", auth, perm("departments", "manage"), handler(async (req, res) => {
    const p = requirePrincipal(req);
    const cong = p.congregationId ?? (await ctx.db.primary.query(`SELECT congregation_id FROM congregations WHERE is_default LIMIT 1`)).rows[0]?.congregation_id;
    res.status(201).json(await svc.create(p.userId, String(cong), parseBody(DepartmentsService.Upsert, req.body ?? {})));
  }));
  r.patch("/admin/departments/:id", auth, perm("departments", "manage"), handler(async (req, res) => {
    const patch = parseBody(DepartmentsService.Update, req.body ?? {});
    const p = requirePrincipal(req);
    res.json(await svc.update(p.userId, Id.parse(req.params.id), patch, p.congregationId ?? null));
  }));
  r.post("/admin/departments/:id/posts", auth, perm("departments", "manage"), handler(async (req, res) => {
    const p = requirePrincipal(req);
    res.status(201).json(await svc.createPost(p.userId, Id.parse(req.params.id), parseBody(DepartmentsService.Post, req.body ?? {}), { office: true, congregationId: p.congregationId ?? null }));
  }));
  r.delete("/admin/departments/:id/posts/:postId", auth, perm("departments", "manage"), handler(async (req, res) => {
    const p = requirePrincipal(req);
    await svc.deletePost(p.userId, Id.parse(req.params.id), Id.parse(req.params.postId), { office: true, congregationId: p.congregationId ?? null });
    res.status(204).end();
  }));
  r.post("/admin/departments/:id/needs", auth, perm("departments", "manage"), handler(async (req, res) => {
    const p = requirePrincipal(req);
    res.status(201).json(await svc.submitNeed(p.userId, Id.parse(req.params.id), parseBody(DepartmentsService.Need, req.body ?? {}), { office: true, congregationId: p.congregationId ?? null }));
  }));
  r.get("/admin/departments/serve-requests", auth, perm("departments", "view"), handler(async (req, res) => {
    const status = z.enum(["requested", "active", "declined", "left"]).default("requested").parse(req.query.status ?? "requested");
    res.json({ data: await svc.serveRequests(status, requirePrincipal(req).congregationId ?? null) });
  }));
  r.post("/admin/departments/:id/serve-requests/:userId/:decision", auth, perm("departments", "manage"), handler(async (req, res) => {
    const decision = z.enum(["approve", "decline"]).parse(req.params.decision);
    const p = requirePrincipal(req);
    res.json(await svc.decideServe(p.userId, Id.parse(req.params.id), Id.parse(req.params.userId), decision, { office: true, congregationId: p.congregationId ?? null }));
  }));
  r.get("/admin/departments/needs", auth, perm("departments", "view"), handler(async (req, res) => {
    const status = z.enum(["pending", "approved", "rejected", "closed"]).default("pending").parse(req.query.status ?? "pending");
    res.json({ data: await svc.needs(status, requirePrincipal(req).congregationId ?? null) });
  }));
  r.post("/admin/departments/needs/:needId/:decision", auth, perm("departments", "manage"), handler(async (req, res) => {
    const decision = z.enum(["approve", "reject", "close"]).parse(req.params.decision);
    const body = parseBody(z.object({ note: z.string().trim().max(300).nullish() }), req.body ?? {});
    const p = requirePrincipal(req);
    res.json(await svc.decideNeed(p.userId, Id.parse(req.params.needId), decision, body.note ?? null, p.congregationId ?? null));
  }));
  return r;
}
