# Nuru Live L1.5b — per-stream CDN paths (flicker fix)

## The bug

For `scope=church`, `GET /live/now` served `hls_url` as a **static** CDN
path: `{LIVE_CDN_BASE}/live-cdn/church/index.m3u8` — the exact same object
path for every broadcast, forever. The VPS publisher daemon
(`ops/live-cdn/publisher.py`, systemd `nuru-live-cdn`) overwrites that object
each time a new church stream starts, but R2's edge cache can keep serving
the **previous** stream's manifest/segments for the first several seconds of
a new one — a visible flicker/stale-content glitch at the start of every
broadcast, worse the longer R2 had cached the old objects.

## The fix

Scope the CDN object path by `stream_id`:
`{LIVE_CDN_BASE}/live-cdn/church/<stream_id>/index.m3u8`. A brand-new
broadcast gets a brand-new object path no cache has ever seen, so there is
nothing stale to serve. `hls_fallback_url` (the direct origin URL) is
unchanged either way.

## Pieces that changed

1. **Backend** (`packages/backend/src/modules/live/service.ts`,
   `src/config/env.ts`, `src/modules/live/index.ts`): new env flag
   `LIVE_CDN_PER_STREAM` (default `false`/off). When on (and `LIVE_CDN_BASE`
   is set), church-scope `hls_url` becomes the per-stream path instead of the
   legacy static one. `hls_fallback_url` is untouched. A new unauthenticated,
   loopback-trust route `GET /live/church/current` → `{ stream_id: string |
   null }` was added — same trust boundary as the existing MediaMTX authHTTP
   webhook (`POST /live/auth`) — purely so the VPS daemon (below) can learn
   which stream_id to write per-stream objects under. It reveals nothing a
   member's own `GET /live/now` wouldn't already show.
2. **VPS publisher daemon** (`ops/live-cdn/publisher.py`, lives in this repo,
   deployed by an operator copying the file onto the VPS — see
   `ops/live-cdn/README.md`): now mirrors every broadcast's segments/playlist
   to **both** the legacy static R2 path (unconditionally) **and** the
   per-stream path (once it has resolved the live stream's id by polling the
   backend's new `GET /v1/live/church/current` route on its own
   IDLE→LIVE transition). If that lookup fails for any reason, only the
   legacy path gets written for that broadcast — the daemon never hard-fails.

## Required rollout order — READ BEFORE FLIPPING THE FLAG

`LIVE_CDN_PER_STREAM` defaults to **off** specifically so the backend code
in this PR can deploy safely on its own, independent of when the VPS operator
gets around to redeploying the daemon. The two sides must land in this order:

1. **Deploy the backend** with this change. `LIVE_CDN_PER_STREAM` stays
   unset/off in prod env — `hls_url` keeps returning the legacy static path
   exactly as before. Nothing observable changes yet. (`GET
   /live/church/current` exists and works regardless of the flag — it's cheap
   and harmless to ship live immediately.)
2. **Redeploy the VPS publisher daemon** — copy the updated
   `ops/live-cdn/publisher.py` onto the box (`ops/live-cdn/README.md` §
   Install) and restart `nuru-live-cdn`. Verify with a live test stream that
   the journal logs `resolved stream_id=... — mirroring to the per-stream CDN
   path too`, and that `rclone ls r2:nuru-live/live-cdn/church/<stream_id>`
   shows objects. At this point BOTH paths are being written; the backend is
   still serving the legacy one, so playback is unaffected either way.
3. **Only then set `LIVE_CDN_PER_STREAM=1`** in the backend's env and restart
   it. Confirm `GET /v1/live/now` now returns
   `hls_url: "<LIVE_CDN_BASE>/live-cdn/church/<stream_id>/index.m3u8"` for a
   live church stream, and that URL actually serves (curl -sI → 200).

Flipping step 3 before step 2 has landed on the VPS makes every church
viewer's `hls_url` 404, because nothing is writing the per-stream object yet
— that is exactly the failure mode this flag exists to prevent by keeping the
two deploys decoupled.

## Rollback

Unset `LIVE_CDN_PER_STREAM` (or set it back to `0`/`false`) and restart the
backend — `hls_url` reverts to the legacy static path immediately, which the
daemon has continued writing the whole time (step 2 never stopped writing
it), so there is no playback gap either direction.

## Verify (prod)

```bash
# Backend route exists and reflects the live church stream (or null):
curl -s https://pathway.nuruplace.org/v1/live/church/current

# Daemon is writing both paths for a live test stream:
rclone ls r2:nuru-live/live-cdn/church            # legacy — always present
rclone ls r2:nuru-live/live-cdn/church/<stream_id> # per-stream — present once the daemon resolves it

# With LIVE_CDN_PER_STREAM=1, /live/now serves the per-stream URL:
curl -s https://pathway.nuruplace.org/v1/live/now -H "Authorization: Bearer <token>" | jq '.data[] | select(.scope=="church")'
```
