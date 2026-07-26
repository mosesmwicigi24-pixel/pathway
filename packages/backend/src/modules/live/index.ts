// Module: live — Nuru Live L1 (docs/LIVE_STREAMING.md). L0 infra (MediaMTX on
// the VPS) is already deployed; this mounts the backend's /v1/live/* surface:
// key minting (RBAC + §5.4 scoping), the MediaMTX authHTTP webhook, /live/now,
// viewer heartbeat, and recordings.
//
// OPS FOLLOW-UP (not done by this module — infra, not code):
//   1. nginx: add a `location /live-recordings/ { alias <LIVE_RECORDINGS_DIR>/; }`
//      (read-only, static) so recording_url values actually resolve. Until
//      that's added, VOD playback 404s even though the DB row is correct.
//   2. mediamtx.yml: point authHTTP at this route so publish/read are gated —
//        authHTTPAddress: http://127.0.0.1:8080/v1/live/auth
//        authHTTPExclude: [] # publish AND read both go through the webhook
//      (host:port must match wherever the backend actually listens from
//      MediaMTX's container/network — 127.0.0.1:8080 assumes the same-host
//      default from L0; adjust if the backend binds elsewhere.)
import { Router } from "express";
import type { AppContext } from "../../http/context.js";
import { authenticate, requirePermission } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { LiveService } from "./service.js";

export function registerLive(ctx: AppContext): Router {
  const svc = new LiveService(
    ctx.db.primary,
    ctx.env.LIVE_RECORDINGS_DIR ?? "/opt/pathway/mediamtx/recordings",
    ctx.env.LIVE_RTMP_BASE_URL ?? "rtmp://pathway.nuruplace.org:1935",
    undefined,
    ctx.env.LIVE_CDN_BASE,
  );
  const auth = authenticate(ctx.env);
  const perm = requirePermission(ctx.db.replica);
  // A fresh Router per call — registerLive runs once per createApp() in prod,
  // but tests build a new app (and a new `svc` closed over that call's env)
  // per test; a module-level singleton here would stack every test's handlers
  // onto ONE router object, so only the very first-ever registered handler
  // (and its stale env/svc) would ever actually match a request.
  const r: Router = Router();

  r.post("/live/streams", auth, perm("live", "go"), handler(async (req, res) => {
    const input = parseBody(LiveService.CreateStream, req.body);
    res.status(201).json(await svc.createStream(requirePrincipal(req), input));
  }));

  // MediaMTX authHTTP webhook — deliberately UNAUTHENTICATED (no bearer JWT):
  // MediaMTX itself has no user session, only the stream's own publish key,
  // which is validated strictly inside the service. Reachable only from
  // localhost in prod (see OPS FOLLOW-UP above / L0 firewall).
  r.post("/live/auth", handler(async (req, res) => {
    const input = parseBody(LiveService.AuthWebhook, req.body);
    const ok = await svc.authWebhook(input);
    res.sendStatus(ok ? 200 : 401);
  }));

  r.post("/live/streams/:id/end", auth, handler(async (req, res) => {
    res.json(await svc.endStream(requirePrincipal(req), req.params.id ?? ""));
  }));

  r.get("/live/now", auth, handler(async (req, res) => {
    res.json(await svc.listNow(requirePrincipal(req)));
  }));

  r.post("/live/streams/:id/heartbeat", auth, handler(async (req, res) => {
    res.json(await svc.heartbeat(requirePrincipal(req), req.params.id ?? ""));
  }));

  r.get("/live/recordings", auth, handler(async (req, res) => {
    const q = parseBody(LiveService.RecordingsQuery, req.query);
    res.json(await svc.listRecordings(requirePrincipal(req), q));
  }));

  return r;
}
