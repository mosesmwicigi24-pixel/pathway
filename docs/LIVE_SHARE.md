# Nuru Live — "Share a broadcast" (public share links)

## The bug (prod ground truth, 2026-07-31 — proved by curl against prod, not re-derived here)

The clients' existing "Share recording" sends a **bare file URL** as plain
text, e.g. `https://pathway.nuruplace.org/live-recordings/church/2026-07-31_16-51-02-584559.mp4`.
nginx serves it `Content-Type: video/mp4`, `content-length: 33884851`,
`accept-ranges: bytes`, **HTTP 200 with NO authentication of any kind** —
fetched successfully from a laptop as an anonymous stranger.

Consequences:

1. WhatsApp/browsers **download** the file instead of playing it (the "it
   starts to download the video" complaint) — no player, no preview.
2. No title, no thumbnail, no preview card.
3. **World-readable by anyone who ever receives or forwards it, forever.**
4. No way back into the app.
5. `location /live-recordings/ { alias <dir>/; }` is **scope-blind** — today
   only `scope='church'` streams have recordings, so nothing private leaks
   *yet*, but the very next `cell`-scoped broadcast that records becomes
   world-readable too. This is a class of bug, not a one-off.

## The fix

A real "Share a broadcast" feature: a lazily-minted, revocable, opaque
`share_token` on `live_streams`, resolved through a proper server-rendered
`GET /w/{token}` page — never a raw file URL again. The raw
`/live-recordings/` static path is closed entirely; all video bytes now flow
through a short-lived HMAC-signed URL that nginx serves via
`X-Accel-Redirect`.

### New columns (migration `1758000000184_live-share-links.sql`)

`live_streams.share_token TEXT` (nullable, minted lazily), `share_revoked_at
TIMESTAMPTZ`, `poster_url TEXT`. A partial unique index
(`idx_live_streams_share_token`, `WHERE share_token IS NOT NULL`) gives both
the uniqueness and the lookup index in one — most rows never get shared, so
there's no reason to index that majority case.

### API (`packages/backend/src/modules/live/index.ts`, `service.ts`)

- `POST /v1/live/replays/{id}/share` (authenticated) — mints or returns the
  active share token. Same entitlement rule as watching the broadcast
  (`assertVisible`: church always allowed; cell requires membership,
  Admin/SuperAdmin, or a `live:manage` holder). 404 if the broadcast has no
  (non-deleted) recording. Idempotent while the token is active; a revoked
  token is replaced with a fresh one, not resurrected. Returns
  `{ url, title, started_at, expires_at }` — `url =
  "<APP_PUBLIC_URL>/w/<token>"`; `expires_at` is always `null` (**the share
  link itself never expires — only revoke kills it**).
- `DELETE /v1/live/replays/{id}/share` — revokes (idempotent, silent no-op if
  never shared / already revoked).
- `GET /v1/live/replays/{id}/media?t=<sig>&e=<expiry>` — **unauthenticated**,
  same trust-boundary idiom as the existing `POST /live/auth` webhook and
  `GET /live/church/current`: no bearer JWT, the HMAC signature *is* the
  authorization (the public page has no session to present). `t =
  base64url(HMAC-SHA256(streamId + "." + e))`, keyed by
  `LIVE_SHARE_SECRET` (falls back to `JWT_SIGNING_KEY` if unset — see below).
  Only ever serves `scope='church'` recordings (defense in depth — nothing in
  this codebase mints a signed URL for a cell recording, but the endpoint
  refuses to serve one anyway). On success, sets `X-Accel-Redirect` and ends
  the response with no body — **Node never touches the file bytes**.

### The public page (`GET /w/{token}`, `packages/backend/src/modules/live/sharePage.ts`)

Mounted at the domain root (`app.use(registerLiveShare(ctx))` in
`src/http/app.ts`), **not** under `/v1` — same placement as the existing
`/join/{token}` Reading & Social page, and it deliberately shares that page's
visual family (same navy/gold/paper palette, same card layout, same
"attempt `nuru://` then fall back to the store" script) so the two read as
one product.

- **Unknown / revoked token, or a recording that's been deleted**: a
  branded 404 page (`renderShareNotFoundPage`) — never a stack trace, never
  the JSON error envelope.
- **`scope='cell'` broadcasts — the actual privacy fix**: renders "This
  broadcast is for members of `<cell>`" with an "Open in Nuru" CTA and **no
  video, no `og:video` tag, no media URL of any kind**
  (`renderCellRestrictedPage` doesn't even accept a `mediaUrl` parameter —
  there is no code path that could leak one by mistake).
- **`scope='church'` broadcasts**: a real inline `<video controls playsinline
  preload="metadata" poster=...>` pointed at a **freshly re-minted** signed
  media URL (the page re-mints it on every load — see "why re-mint" below),
  full Open Graph + Twitter Card meta (`og:title`, `og:description`,
  `og:image`, `og:video`/`og:video:url`/`og:video:secure_url`/`og:video:type`,
  `og:type=video.other`, `twitter:card=player` +
  `twitter:player:stream`), and the same "Open in the Nuru app" deep-link
  button (`nuru://live/replay/{streamId}`) with store fallback.

**Why re-mint on every load, when the link never expires:** the *share link*
(`/w/{token}`) is permanent until revoked, but the *embedded media URL*
inside it is deliberately short-lived (default 6h). Re-minting on every
render means a page a browser/crawler cached for days still gets a fresh,
valid media URL each time a human actually opens it — the TTL only bounds
how long one particular page-load's `<video src>` stays fetchable, it never
makes the shareable link itself expire.

### nginx — the exact change to apply in prod

**Trap already documented in this repo: the live file is
`/etc/nginx/sites-enabled/pathway.nuruplace.org`, a real copy, NOT a
symlink.** Edit that file directly.

Replace the existing public alias:

```nginx
location /live-recordings/ {
    alias /opt/pathway/mediamtx/recordings/;
}
```

with:

```nginx
# Nuru Live share links (docs/LIVE_SHARE.md) — recordings are no longer
# world-readable. All playback goes through the signed
# GET /v1/live/replays/{id}/media route, which X-Accel-Redirects here.
location /live-recordings/ {
    return 404;
}

location /internal-live-recordings/ {
    internal;
    alias /opt/pathway/mediamtx/recordings/;
    # Range requests (seeking) and Content-Type are handled by nginx's normal
    # static-file serving — no extra config needed for either.
}
```

Then `nginx -t && systemctl reload nginx`.

### Env

- `LIVE_SHARE_SECRET` (optional) — HMAC key for the signed media URL. Falls
  back to `JWT_SIGNING_KEY` (always present) if unset, so a missed env entry
  on deploy can never leave sharing broken or, worse, silently unsigned. Set
  a dedicated value in prod when convenient; not required to ship.
- `APP_PUBLIC_URL` (already set, `https://pathway.nuruplace.org`) doubles as
  the share link's public base — no new `PUBLIC_WEB_BASE` var was
  introduced; it would just be a second name for a value that already
  exists.

## What I deliberately left out (read before applying the nginx change)

1. **Existing in-app "watch recording" playback breaks the moment the nginx
   change above is applied**, for BOTH church and cell recordings. Today the
   iOS/Android/web clients play `recording_url` (e.g.
   `/live-recordings/church/xxx.mp4`, returned by `GET /live/recordings` and
   `GET /live/recordings/mine`) directly against the now-closed public path.
   This PR only threads a signed URL through the NEW public share page — it
   does not add an equivalent signed `media_url` to the existing
   authenticated recordings-list endpoints, and does not touch any client.
   **Do not apply the nginx change until in-app recording playback has a
   replacement.** The clean fix is additive and small: extend
   `GET /live/recordings` / `/live/recordings/mine` with a signed
   `media_url` field (reusing `LiveService`'s existing `mediaUrl`/HMAC
   machinery in `service.ts`, minus the `scope==='church'` restriction since
   that check only exists to protect the *public, unauthenticated* endpoint
   — an authenticated in-app request is already scope-checked by the
   listing query itself) — then update iOS/Android/web to consume it. That's
   a cross-surface follow-up (per this repo's coordinated-dev doctrine), not
   done here since this task was scoped to the backend only.
2. **Poster thumbnails are not generated.** The backend runtime image
   (`packages/backend/Dockerfile`, `node:20-bookworm-slim`) does not install
   ffmpeg, and this feature deliberately does not add it silently —
   bundling a native binary into the production image is an infra decision
   for the operator to make on purpose (image size, CVE surface), not
   something to sneak into a feature PR. `recordings.ts`'
   `generatePosterUrl()` is wired into the registrar
   (`service.ts tryRegisterRecording`) as best-effort and always returns
   `null` today; every share page falls back to a static branded SVG
   (`sharePage.ts DEFAULT_POSTER_SVG`, served at `GET /live/poster-default.svg`).
   Follow-up: add ffmpeg (or an image-processing dependency) to the image,
   deliberately, and replace `generatePosterUrl`'s body with a real frame
   extraction. Known limitation of the interim SVG fallback: some
   link-preview crawlers (notably Facebook's) don't rasterize SVG
   `og:image` values.
3. **On-disk deletion of shared/revoked recordings** is unchanged from the
   existing recording-stewardship follow-up already documented in
   `src/modules/live/index.ts` (neither the `api` nor `worker` container
   mounts the MediaMTX recordings dir) — out of scope here.
4. **Universal Links / App Links** for `/w/{token}` (so a tap intercepts
   before the browser even loads the page) need AASA/`assetlinks.json`
   hosting, same gap already tracked for `/join/{token}` in
   `docs/READING_SOCIAL_PLAN.md` — not built here either; the page still
   works today via the `nuru://` custom scheme + store fallback.
