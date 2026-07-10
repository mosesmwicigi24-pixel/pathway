// Module: radio — Radio Broadcast Studio + Virtual Audio Mixer (docs/RADIO_STUDIO_CONTRACT.md).
// Admin (/admin/radio/*, RBAC radio:view|create|edit|delete) drives the DARK studio
// surfaces on web + iPad; member (/radio/*, auth only) feeds the mobile player next.
// Admin sees ingest secrets; member DTOs omit stream_key/ingest_url/ingest_provider.
// Static admin paths are registered before any param routes so they win in matching.
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requirePermission } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { RadioService } from "./service.js";
import { buildStreamProvider, type StreamProvider } from "./provider.js";
import { buildMixerControl, type MixerControl } from "./mixercontrol.js";

export const radioRouter: Router = Router();
const idOf = (req: { params: Record<string, string | undefined> }, k = "id"): string => req.params[k] ?? "";

export function registerRadio(
  ctx: AppContext,
  providerOverride?: StreamProvider,
  mixerOverride?: MixerControl,
): Router {
  const provider = providerOverride ?? buildStreamProvider(ctx.env);
  const mixer = mixerOverride ?? buildMixerControl(ctx.env);
  const svc = new RadioService(
    ctx.db.primary,
    provider,
    mixer,
    ctx.env.LIQUIDSOAP_MEDIA_DIR ?? "/var/www/pathway-media",
  );
  const auth = authenticate(ctx.env);
  const perm = requirePermission(ctx.db.replica);
  const r = radioRouter;

  // ===== Admin — LIVE MIX control (liquidsoap; static, before param routes) ==
  r.post("/admin/radio/mixer/live/levels", auth, perm("radio", "edit"), handler(async (req, res) => {
    const input = parseBody(RadioService.MixerLiveLevels, req.body);
    res.json(await svc.setLiveLevels(input));
  }));
  r.post("/admin/radio/mixer/live/eq", auth, perm("radio", "edit"), handler(async (req, res) => {
    const input = parseBody(RadioService.MixerLiveEq, req.body);
    res.json(await svc.setLiveEq(input));
  }));
  r.post("/admin/radio/mixer/live/jingle", auth, perm("radio", "edit"), handler(async (req, res) => {
    const { jingle_id } = parseBody(RadioService.MixerLiveJingle, req.body);
    res.json(await svc.fireLiveJingle(jingle_id));
  }));
  r.post("/admin/radio/mixer/live/scene", auth, perm("radio", "edit"), handler(async (req, res) => {
    const { scene_id } = parseBody(RadioService.MixerLiveScene, req.body);
    res.json(await svc.applyLiveScene(scene_id));
  }));
  r.get("/admin/radio/mixer/live/status", auth, perm("radio", "view"), handler(async (_req, res) => {
    res.json(await svc.liveMixStatus());
  }));

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

  // ===== Admin — Audio library (tracks) (static, before program param routes) =
  r.get("/admin/radio/tracks", auth, perm("radio", "view"), handler(async (req, res) => {
    const { kind } = parseBody(RadioService.TrackListQuery, req.query);
    res.json(await svc.listTracks(kind));
  }));
  r.post("/admin/radio/tracks", auth, perm("radio", "create"), handler(async (req, res) => {
    const input = parseBody(RadioService.TrackBody, req.body);
    res.status(201).json(await svc.createTrack(requirePrincipal(req).userId, input));
  }));
  r.delete("/admin/radio/tracks/:id", auth, perm("radio", "delete"), handler(async (req, res) => {
    res.json(await svc.removeTrack(idOf(req)));
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

  // Pre-save overlap check: "does this slot collide with another session?" —
  // the consoles call it while the author picks a time and show the conflict.
  r.get("/admin/radio/schedule/conflicts", auth, perm("radio", "view"), handler(async (req, res) => {
    const q = parseBody(
      z.object({
        scheduled_at: z.string().datetime(),
        duration_min: z.coerce.number().int().min(1).max(24 * 60).optional(),
        exclude_id: z.string().uuid().optional(),
      }),
      req.query,
    );
    res.json({
      conflicts: await svc.scheduleConflicts(new Date(q.scheduled_at), q.duration_min ?? null, q.exclude_id ?? null),
    });
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

  // Session playlist (static suffix, before the bare /:id).
  r.get("/admin/radio/programs/:id/tracks", auth, perm("radio", "view"), handler(async (req, res) => {
    res.json(await svc.listPlaylistAdmin(idOf(req)));
  }));
  r.post("/admin/radio/programs/:id/tracks", auth, perm("radio", "edit"), handler(async (req, res) => {
    const input = parseBody(RadioService.AddPlaylistItem, req.body);
    res.status(201).json(await svc.addPlaylistItem(idOf(req), input));
  }));
  r.put("/admin/radio/programs/:id/tracks/order", auth, perm("radio", "edit"), handler(async (req, res) => {
    const input = parseBody(RadioService.ReorderPlaylist, req.body);
    res.json(await svc.reorderPlaylist(idOf(req), input));
  }));
  r.delete("/admin/radio/programs/:id/tracks/:itemId", auth, perm("radio", "edit"), handler(async (req, res) => {
    res.json(await svc.removePlaylistItem(idOf(req), idOf(req, "itemId")));
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
  // Live listener presence — the member player heartbeats while it is actually
  // playing (~every 20s); the studio roster + count read from these rows.
  r.post("/radio/programs/:id/listening", auth, handler(async (req, res) => {
    res.json(await svc.heartbeat(idOf(req), requirePrincipal(req).userId));
  }));
  r.get("/radio/programs/:id/listeners", auth, handler(async (req, res) => {
    res.json(await svc.listeners(idOf(req)));
  }));
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
