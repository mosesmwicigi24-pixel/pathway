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
//   3. Recording stewardship (DELETE /live/recordings/:id) only soft-deletes
//      the DB row today — the on-disk fMP4 segment is never unlinked. Neither
//      the api nor worker service mounts LIVE_RECORDINGS_DIR as a volume in
//      docker-compose.prod.yml/docker-compose.vps.yml, so no in-repo process
//      can reach the file to delete it. Fix: bind-mount the MediaMTX
//      recordings dir (read-write) into the worker service in
//      docker-compose.vps.yml, then extend the sweep in service.ts to unlink
//      the file for any row with recording_deleted_at set and reachable on
//      disk.
//   4. nginx (docs/LIVE_CDN_PERSTREAM.md): GET /live/church/current is
//      unauthenticated by design (same boundary as #2's authHTTP webhook) —
//      confirm it is NOT publicly proxied (same nginx rule/exclusion already
//      needed for POST /live/auth covers this too if both are under the same
//      location block). It leaks nothing a member's own GET /live/now
//      wouldn't already show.
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requirePermission } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { LiveService } from "./service.js";
import {
  DEFAULT_POSTER_SVG,
  renderChurchSharePage,
  renderCellRestrictedPage,
  renderShareNotFoundPage,
} from "./sharePage.js";

const IdParam = z.object({ id: z.string().uuid() });
const GuestParam = z.object({ id: z.string().uuid(), userId: z.string().uuid() });

/** Every registerX in this module builds its own LiveService from ctx — see
 *  registerLive's own comment on why (fresh Router/svc per createApp() call,
 *  test isolation). registerLiveShare (below) needs the exact same
 *  construction, so it's factored out here rather than duplicated. */
function buildService(ctx: AppContext): LiveService {
  return new LiveService(
    ctx.db.primary,
    ctx.env.LIVE_RECORDINGS_DIR ?? "/opt/pathway/mediamtx/recordings",
    ctx.env.LIVE_RTMP_BASE_URL ?? "rtmp://pathway.nuruplace.org:1935",
    undefined,
    ctx.env.LIVE_CDN_BASE,
    ctx.env.LIVE_WEBRTC_BASE_URL ?? "https://pathway.nuruplace.org/webrtc",
    ctx.env.LIVE_CDN_PER_STREAM,
    ctx.env.LIVE_MEDIAMTX_API_BASE ?? "http://nuru-mediamtx:9997",
    ctx.env.APP_PUBLIC_URL,
    // docs/LIVE_SHARE.md: falls back to the JWT signing key so a missed
    // LIVE_SHARE_SECRET on deploy can never leave sharing broken/insecure —
    // it just shares a signing key with token auth instead of having its own.
    ctx.env.LIVE_SHARE_SECRET ?? ctx.env.JWT_SIGNING_KEY,
  );
}

export function registerLive(ctx: AppContext): Router {
  const svc = buildService(ctx);
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
    // Non-publish actions (read/playback/api/…) are ALWAYS allowed — and must
    // be answered BEFORE strict parsing: MediaMTX probes reads with empty
    // user/password, and any non-2xx here reads as deny (it 401'd the HLS
    // poll that drives the CDN publisher).
    //
    // L6a (docs/LIVE_INTERACTIVE.md) exception: guest WebRTC paths
    // (`guest/<streamId>/<userId>`) now gate action=read too (owner publish
    // key, or any accepted guest's own token, for that stream) — so those
    // fall through to the real service check instead of this early exit. The
    // church/cell short-circuit above is otherwise byte-identical.
    const body = req.body as { action?: unknown; path?: unknown; user?: unknown } | undefined;
    const action = body?.action;
    const path = typeof body?.path === "string" ? body.path : "";
    const isGuestPath = path.startsWith("guest/");
    if (action !== "publish" && !isGuestPath) { res.sendStatus(200); return; }

    // PRODUCTION INCIDENT (2026-07-31): this route used to run the body
    // through parseBody(), which throws ApiError("VALIDATION_FAILED") on any
    // schema mismatch and lets the terminal error handler turn that into a
    // 400. An authentication webhook must NEVER answer a request it can't
    // make sense of with a validation error — MediaMTX (and anything else
    // that can reach this route without a session) can't tell a 400 apart
    // from a server fault, a 400 leaks our internal schema shape to an
    // unauthenticated caller, and — as happened here — it silently breaks a
    // whole feature while looking like someone else's problem (MediaMTX
    // logged "failed to authenticate: server replied with code 400" and gave
    // up). Any input this route cannot parse is a DENY, exactly like a
    // credential that doesn't match: 401, never 400/500.
    const parsed = LiveService.AuthWebhook.safeParse(req.body);
    if (!parsed.success) {
      ctx.log.warn(
        {
          path,
          action,
          userSupplied: typeof body?.user === "string" && body.user.length > 0,
          issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        "live auth webhook: unparseable body, denying",
      );
      res.sendStatus(401);
      return;
    }
    const ok = await svc.authWebhook(parsed.data);
    if (!ok) {
      // info, not warn — an unmatched credential is routine (viewer probes,
      // an expired guest token, a genuinely empty MediaMTX WHIP/WHEP `user`).
      // Never log parsed.data.password or any guest_token — only shape.
      ctx.log.info(
        { path: parsed.data.path, action: parsed.data.action, userSupplied: parsed.data.user.length > 0 },
        "live auth webhook: denied",
      );
    }
    res.sendStatus(ok ? 200 : 401);
  }));

  r.post("/live/streams/:id/end", auth, handler(async (req, res) => {
    res.json(await svc.endStream(requirePrincipal(req), req.params.id ?? ""));
  }));

  r.get("/live/now", auth, handler(async (req, res) => {
    res.json(await svc.listNow(requirePrincipal(req)));
  }));

  // L1.5b (docs/LIVE_CDN_PERSTREAM.md) — deliberately UNAUTHENTICATED, same
  // trust boundary as POST /live/auth above: polled by the VPS-local CDN
  // publisher daemon (ops/live-cdn/publisher.py) over loopback to learn which
  // stream_id to write per-stream R2 objects under. Reveals only whatever a
  // member's own GET /live/now already shows (church live or not, and its
  // id) — never anything more sensitive.
  r.get("/live/church/current", handler(async (_req, res) => {
    res.json({ stream_id: await svc.currentChurchStreamId() });
  }));

  r.post("/live/streams/:id/heartbeat", auth, handler(async (req, res) => {
    res.json(await svc.heartbeat(requirePrincipal(req), req.params.id ?? ""));
  }));

  r.get("/live/recordings", auth, handler(async (req, res) => {
    const q = parseBody(LiveService.RecordingsQuery, req.query);
    res.json(await svc.listRecordings(requirePrincipal(req), q));
  }));

  // Recording stewardship (owner-managed keep/delete). No ordering hazard with
  // the DELETE .../:id route below — different HTTP method, and there is no
  // GET .../:id counterpart for "mine" to collide with.
  r.get("/live/recordings/mine", auth, handler(async (req, res) => {
    res.json(await svc.listMyRecordings(requirePrincipal(req)));
  }));

  r.delete("/live/recordings/:id", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    await svc.deleteRecording(requirePrincipal(req), id);
    res.sendStatus(204);
  }));

  // ---- L5 interactions (docs/LIVE_INTERACTIVE.md) — PINNED wire contract ----

  r.post("/live/streams/:id/reactions", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const input = parseBody(LiveService.React, req.body);
    await svc.react(requirePrincipal(req), id, input);
    res.sendStatus(204);
  }));

  r.post("/live/streams/:id/hand", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const input = parseBody(LiveService.SetHand, req.body);
    await svc.setHand(requirePrincipal(req), id, input);
    res.sendStatus(204);
  }));

  r.get("/live/streams/:id/messages", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const q = parseBody(LiveService.MessagesQuery, req.query);
    res.json(await svc.listMessages(requirePrincipal(req), id, q));
  }));

  r.post("/live/streams/:id/messages", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const input = parseBody(LiveService.SendMessage, req.body);
    res.status(201).json(await svc.sendMessage(requirePrincipal(req), id, input));
  }));

  r.get("/live/streams/:id/pulse", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await svc.pulse(requirePrincipal(req), id));
  }));

  // Literal "respond" segment MUST be registered before the ":userId" param
  // route below — otherwise Express would match "/guests/respond" as a
  // (non-uuid) :userId and 400 on parseBody instead of dispatching here.
  r.post("/live/streams/:id/guests/respond", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const input = parseBody(LiveService.GuestRespond, req.body);
    await svc.respondGuestInvite(requirePrincipal(req), id, input);
    res.sendStatus(204);
  }));

  // L6a (docs/LIVE_INTERACTIVE.md) — different HTTP method + path depth than
  // the :userId routes below, so no ordering conflict with them.
  r.get("/live/streams/:id/guests/me/ingest", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await svc.guestIngest(requirePrincipal(req), id));
  }));

  r.post("/live/streams/:id/guests/:userId", auth, handler(async (req, res) => {
    const { id, userId } = parseBody(GuestParam, req.params);
    await svc.inviteGuest(requirePrincipal(req), id, userId);
    res.sendStatus(204);
  }));

  r.delete("/live/streams/:id/guests/:userId", auth, handler(async (req, res) => {
    const { id, userId } = parseBody(GuestParam, req.params);
    await svc.removeGuest(requirePrincipal(req), id, userId);
    res.sendStatus(204);
  }));

  // ---- Share links (docs/LIVE_SHARE.md "Share a broadcast") -------------

  r.post("/live/replays/:id/share", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await svc.mintShare(requirePrincipal(req), id));
  }));

  r.delete("/live/replays/:id/share", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    await svc.revokeShare(requirePrincipal(req), id);
    res.sendStatus(204);
  }));

  // Signed, UNAUTHENTICATED media hand-off — same trust-boundary idiom as
  // POST /live/auth and GET /live/church/current above: no bearer JWT, the
  // HMAC signature (+ expiry) IS the authorization, because the public share
  // page's <video> tag has no session to present. Delegates the actual bytes
  // to nginx via X-Accel-Redirect (docs/LIVE_SHARE.md has the nginx block)
  // so Node never proxies a 30MB+ file and Range/seeking keep working.
  r.get("/live/replays/:id/media", handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const sig = parseBody(LiveService.ShareMediaSig, req.query);
    const accelPath = await svc.mediaAccelPath(id, sig);
    res.setHeader("X-Accel-Redirect", accelPath);
    res.setHeader("Content-Type", "video/mp4");
    res.status(200).end();
  }));

  return r;
}

export const liveShareRouter: Router = Router();

/**
 * Public, unauthenticated /w/{token} broadcast share page + its tiny default
 * poster asset. Mounted directly on the root app (NOT under /v1) — same
 * placement as reading-social's registerReadingSocialJoin, and for the same
 * reason: it must answer at the bare domain so it can double as a Universal
 * Link/App Link target once that native infra lands. Never returns the JSON
 * error envelope — every failure mode (unknown token, revoked, DB hiccup)
 * renders a friendly branded HTML page instead.
 */
export function registerLiveShare(ctx: AppContext): Router {
  const svc = buildService(ctx);
  const r = liveShareRouter;
  const appScheme = ctx.env.READING_INVITE_APP_SCHEME;
  const androidStoreUrl = ctx.env.READING_INVITE_ANDROID_STORE_URL ?? "";
  const iosStoreUrl = ctx.env.READING_INVITE_IOS_STORE_URL ?? "";
  const defaultPosterUrl = `${ctx.env.APP_PUBLIC_URL}/live/poster-default.svg`;

  r.get("/live/poster-default.svg", (_req, res) => {
    res.type("image/svg+xml").send(DEFAULT_POSTER_SVG);
  });

  r.get("/w/:token", async (req, res) => {
    const token = req.params.token ?? "";
    try {
      const share = await svc.getPublicShare(token);
      if (!share) {
        res.status(404).type("html").send(renderShareNotFoundPage());
        return;
      }
      const joinUrl = `${ctx.env.APP_PUBLIC_URL}/w/${token}`;
      const posterUrl = share.poster_url ?? defaultPosterUrl;

      if (share.scope === "cell") {
        res.status(200).type("html").send(
          renderCellRestrictedPage({
            joinUrl,
            title: share.title,
            cellName: share.cell_name ?? "this cell",
            posterUrl,
            streamId: share.stream_id,
            appScheme,
            androidStoreUrl,
            iosStoreUrl,
          }),
        );
        return;
      }

      res.status(200).type("html").send(
        renderChurchSharePage({
          token,
          joinUrl,
          title: share.title,
          congregationName: share.congregation_name,
          startedAt: share.started_at,
          mediaUrl: svc.publicMediaUrl(share.stream_id),
          posterUrl,
          streamId: share.stream_id,
          appScheme,
          androidStoreUrl,
          iosStoreUrl,
        }),
      );
    } catch {
      res.status(404).type("html").send(renderShareNotFoundPage());
    }
  });

  return r;
}
