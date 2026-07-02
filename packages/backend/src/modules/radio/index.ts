// Module: radio — Radio Broadcast Studio + Virtual Audio Mixer (docs/RADIO_STUDIO_CONTRACT.md).
// Admin (/admin/radio/*, RBAC radio:view|create|edit|delete) drives the DARK studio
// surfaces on web + iPad; member (/radio/*, auth only) feeds the mobile player next.
// Admin sees ingest secrets; member DTOs omit stream_key/ingest_url/ingest_provider.
// Static admin paths are registered before any param routes so they win in matching.
import { Router } from "express";
import type { AppContext } from "../../http/context.js";
import { authenticate, requirePermission } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { RadioService } from "./service.js";
import { buildStreamProvider, type StreamProvider } from "./provider.js";

export const radioRouter: Router = Router();
const idOf = (req: { params: Record<string, string | undefined> }, k = "id"): string => req.params[k] ?? "";

export function registerRadio(ctx: AppContext, providerOverride?: StreamProvider): Router {
  const provider = providerOverride ?? buildStreamProvider(ctx.env);
  const svc = new RadioService(ctx.db.primary, provider);
  const auth = authenticate(ctx.env);
  const perm = requirePermission(ctx.db.replica);
  const r = radioRouter;

  // ===== Admin — Mixer (static, before /admin/radio/programs/:id) ===========
  r.get("/admin/radio/mixer/scenes", auth, perm("radio", "view"), handler(async (_req, res) => {
    res.json(await svc.listScenes());
  }));
  r.post("/admin/radio/mixer/scenes", auth, perm("radio", "create"), handler(async (req, res) => {
    const input = parseBody(RadioService.SceneBody, req.body);
    res.status(201).json(await svc.createScene(requirePrincipal(req).userId, input));
  }));
  r.patch("/admin/radio/mixer/scenes/:id", auth, perm("radio", "edit"), handler(async (req, res) => {
    const input = parseBody(RadioService.SceneUpdate, req.body);
    res.json(await svc.updateScene(idOf(req), input));
  }));
  r.delete("/admin/radio/mixer/scenes/:id", auth, perm("radio", "delete"), handler(async (req, res) => {
    res.json(await svc.removeScene(idOf(req)));
  }));

  r.get("/admin/radio/mixer/jingles", auth, perm("radio", "view"), handler(async (_req, res) => {
    res.json(await svc.listJingles());
  }));
  r.post("/admin/radio/mixer/jingles", auth, perm("radio", "create"), handler(async (req, res) => {
    const input = parseBody(RadioService.JingleBody, req.body);
    res.status(201).json(await svc.createJingle(requirePrincipal(req).userId, input));
  }));
  r.delete("/admin/radio/mixer/jingles/:id", auth, perm("radio", "delete"), handler(async (req, res) => {
    res.json(await svc.removeJingle(idOf(req)));
  }));

  // ===== Admin — comment moderation (static, before program param routes) ====
  r.delete("/admin/radio/comments/:cid", auth, perm("radio", "edit"), handler(async (req, res) => {
    res.json(await svc.hideComment(idOf(req, "cid")));
  }));

  // ===== Admin — Programs ===================================================
  r.get("/admin/radio/programs", auth, perm("radio", "view"), handler(async (req, res) => {
    const { status } = parseBody(RadioService.ListQuery, req.query);
    res.json(await svc.listAdmin(status));
  }));
  r.post("/admin/radio/programs", auth, perm("radio", "create"), handler(async (req, res) => {
    const input = parseBody(RadioService.CreateProgram, req.body);
    res.status(201).json(await svc.create(requirePrincipal(req).userId, input));
  }));

  // Program sub-actions (static suffix, before the bare /:id).
  r.post("/admin/radio/programs/:id/go-live", auth, perm("radio", "edit"), handler(async (req, res) => {
    res.json(await svc.goLive(idOf(req)));
  }));
  r.post("/admin/radio/programs/:id/end", auth, perm("radio", "edit"), handler(async (req, res) => {
    res.json(await svc.end(idOf(req)));
  }));
  r.post("/admin/radio/programs/:id/rotate-key", auth, perm("radio", "edit"), handler(async (req, res) => {
    res.json(await svc.rotateKey(idOf(req)));
  }));
  r.get("/admin/radio/programs/:id/health", auth, perm("radio", "view"), handler(async (req, res) => {
    res.json(await svc.health(idOf(req)));
  }));
  r.get("/admin/radio/programs/:id/comments", auth, perm("radio", "view"), handler(async (req, res) => {
    res.json(await svc.listCommentsAdmin(idOf(req)));
  }));

  r.get("/admin/radio/programs/:id", auth, perm("radio", "view"), handler(async (req, res) => {
    res.json(await svc.getAdmin(idOf(req)));
  }));
  r.patch("/admin/radio/programs/:id", auth, perm("radio", "edit"), handler(async (req, res) => {
    const input = parseBody(RadioService.UpdateProgram, req.body);
    res.json(await svc.update(idOf(req), input));
  }));
  r.delete("/admin/radio/programs/:id", auth, perm("radio", "delete"), handler(async (req, res) => {
    res.json(await svc.remove(idOf(req)));
  }));

  // ===== Member (auth only) — static before param routes ====================
  r.get("/radio/now-playing", auth, handler(async (_req, res) => {
    res.json(await svc.nowPlaying());
  }));
  r.get("/radio/programs", auth, handler(async (_req, res) => {
    res.json(await svc.listPublic());
  }));

  // Program sub-actions before the bare /:id.
  r.post("/radio/programs/:id/react", auth, handler(async (req, res) => {
    const input = parseBody(RadioService.React, req.body);
    res.json(await svc.react(idOf(req), requirePrincipal(req).userId, input));
  }));
  r.get("/radio/programs/:id/comments", auth, handler(async (req, res) => {
    res.json(await svc.listComments(idOf(req)));
  }));
  r.post("/radio/programs/:id/comments", auth, handler(async (req, res) => {
    const input = parseBody(RadioService.Comment, req.body);
    res.status(201).json(await svc.addComment(idOf(req), requirePrincipal(req).userId, input));
  }));

  r.get("/radio/programs/:id", auth, handler(async (req, res) => {
    res.json(await svc.getPublic(idOf(req)));
  }));

  return r;
}
