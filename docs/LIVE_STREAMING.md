# Nuru Live — self-hosted live video & audio (the "Go Live" epic)

Owner spec (2026-07-20): go live with video OR audio at zero licensing cost,
HIGH quality (use the full camera power of an iPhone 17 Pro Max / S24 Ultra),
watchable on every install (iOS + Android), every stream SAVES a copy into the
database, "Go Live" visible only to members granted the permission, and two
independent scopes: the CHURCH can go live (homepage) and each CELL can go
live on its own. Tab bar becomes: Home · Pathway · Plans · You (Events+Chat+
Profile combined) · Live (the Live tab appears for authorized broadcasters;
everyone else watches through Home / cell surfaces).

## Architecture (all free/self-hosted, rides the existing VPS)

```
 Phone (broadcaster)                    VPS (pathway.nuruplace.org)                Phones (viewers)
┌────────────────────┐   RTMPS 1935   ┌──────────────────────────────┐   HLS    ┌──────────────────┐
│ iOS: HaishinKit    │ ─────────────▶ │ MediaMTX (docker, MIT)       │ ───────▶ │ iOS: AVPlayer    │
│ Android: RootEnc.  │  key from API  │  · ingest RTMP/SRT           │ /live/*  │ Android: media3  │
│ HW H.264/HEVC      │                │  · HLS out (nginx-proxied)   │          │ (already shipped)│
│ 1080p target       │                │  · records fMP4 → disk       │          └──────────────────┘
└────────────────────┘                │  · runOnRecordSegmentComplete│
                                      └───────────┬──────────────────┘
                                                  │ webhook/scan
                                      ┌───────────▼──────────────────┐
                                      │ @nuru/backend live module    │
                                      │  · mint stream keys (RBAC)   │
                                      │  · live_streams table        │
                                      │  · register recording → VOD  │
                                      └──────────────────────────────┘
```

- **MediaMTX**: one container, path templates `church` and `cell/{cellId}`;
  `publish` guarded by a per-stream key the backend mints; `read` open on the
  LAN side only — viewers get HLS through nginx (`/live/…/index.m3u8`) which
  the backend authorizes (signed short-lived query token, same idiom as media
  signed URLs §4.5).
- **Quality**: broadcaster publishes ONE ladder-free high-quality rendition
  (1080p, HEVC where the device supports hardware encode, else H.264,
  6–8 Mbps video / 128 kbps AAC). No server transcode (keeps CPU near zero on
  the VPS); HLS just re-muxes. Audio-only mode = same pipeline, no video
  track, 128 kbps AAC — the radio aesthetic.
- **Recording**: MediaMTX records fMP4 segments per stream; on stream end the
  backend's registrar concatenates/renames to a single MP4 under the existing
  media disk, inserts a `live_recordings` row + a `media_assets`-style entry,
  and the stream's `ended_at`/`recording_url` are set. VOD plays through the
  same signed-URL door as other media.
- **Latency**: standard HLS (~6–12 s) — right for worship services;
  LL-HLS flag can come later without client changes.

## Data & API (server-authoritative; §5.4 scoping)

- `live_streams` (stream_id, scope 'church'|'cell', cell_id null-able,
  started_by, title, kind 'video'|'audio', status live|ended, started_at,
  ended_at, viewer_peak, recording_url null-able).
- RBAC: new permission module **live** with caps `go` (broadcast) and
  `manage` (end anyone's, grant). SuperAdmin/Admin bridge as usual. Cell
  leaders may be granted `live:go` scoped by their leader_assignments (cell
  streams only); church-wide go-live needs the unscoped grant.
- Routes: POST /live/streams (mint key + rtmp url; RBAC + scope checks),
  POST /live/streams/{id}/end, GET /live/now (what's live that I may watch:
  church + MY cell), GET /live/streams/{id}/watch (signed HLS url),
  GET /live/recordings?scope=…, MediaMTX auth webhook POST /live/auth
  (validates publish keys server-side — the key never grants more than its
  one stream).
- Push: on church go-live, notify all members; on cell go-live, notify that
  cell (existing notifications rails).

## Phases

- **L0 infra**: MediaMTX container on the VPS (ports 1935 RTMP in via
  firewall, HLS bound to localhost → nginx `/live/`), recordings dir on the
  media disk, auth webhook wired to the backend. Deliverable: OBS test
  publish plays at https://pathway.nuruplace.org/live/church/index.m3u8.
- **L1 backend**: live module (tables, RBAC caps, key mint, auth webhook,
  /live/now, watch URLs, recording registrar + end-of-stream sweep). Tests.
- **L2 viewers**: both apps — Home "LIVE now" banner card (red pulse) when
  church is live; cell screen live card; full-screen player (AVPlayer /
  media3), viewer count heartbeat, recording list ("Replays") on the same
  surfaces. THIS ships before broadcast UI so the first real stream has an
  audience.
- **L3 broadcasters**: Go Live UI in both apps (HaishinKit / RootEncoder):
  camera preview, video/audio toggle, title, scope picker (church if
  unscoped grant; your cell if cell-scoped), quality auto (1080p→720p on
  thermal/bandwidth pressure), elegant "You're live · 00:12 · N watching"
  HUD, End confirm. Permission-gated visibility everywhere.
- **L4 tab restructure**: Home · Pathway · Plans · You · Live. "You" fuses
  Events+Chat+Profile (Chat inbox as the tab's heart, Events and Profile as
  its top cards/segments — detailed design at implementation). The Live tab
  (broadcasters only) hosts Go Live + my past streams; non-broadcasters keep
  4 tabs and watch via Home/cell surfaces.

## Cost & load honesty

Zero licensing. The real ceiling is VPS bandwidth: 60 viewers × 6 Mbps
≈ 360 Mbps peak — fine on Hostinger's port for tonight's church size; if the
congregation grows past ~150 concurrent viewers, add a $6 companion VPS as an
HLS edge (rsync/proxy_cache) — still no per-minute vendor.

## Hard-won operational facts (do not re-derive)

- **MediaMTX v1.19.3 requires HTTP Basic auth for WHIP/WHEP credentials —
  `?user=&pass=` query params are silently ignored.** Confirmed by direct
  experiment against prod (2026-07-31): a WHIP/WHEP client presenting
  credentials via query-param reaches our `POST /live/auth` webhook with an
  EMPTY `user`/`password` regardless of what was in the URL; the same client
  switched to an `Authorization: Basic base64(user:pass)` header reaches the
  webhook with the real values. This cost us the entire L6a guest-video
  feature in production before it was diagnosed — every guest WHIP publish
  attempt authenticated as an empty user and was denied. **Any WebRTC
  (WHIP/WHEP) client integration MUST send credentials via HTTP Basic auth,
  never query params.** RTMP publish (the church/cell broadcaster path) is
  unaffected — MediaMTX forwards RTMP username/password to the auth webhook
  correctly either way.
- **The auth webhook (`POST /live/auth`) must always answer with a decision
  (200 allow / 401 deny), never a validation error.** Because MediaMTX itself
  has no session and treats any non-2xx as "deny, and log it as an auth
  failure, not a bug," a malformed/empty body must resolve to 401, not
  400/500. `LiveService.AuthWebhook` accepts an absent/empty `user` on purpose
  (see the fact above) and the route (`packages/backend/src/modules/live/
  index.ts`) turns any remaining zod failure into a logged 401 instead of
  letting it become a 400 through the normal `parseBody`/error-middleware
  path. See `docs/LIVE_INTERACTIVE.md`'s L6a section for the guest-specific
  allow/deny rules this feeds into.
