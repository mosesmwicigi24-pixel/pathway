# Nuru Live L1.5 — CDN publisher (Cloudflare R2 fan-out)

Mirrors the CHURCH-scope MediaMTX HLS output to a public Cloudflare R2 bucket
so viewer fan-out rides R2's edge instead of the VPS's own uplink. Cell
streams are untouched — they keep the direct low-latency URL always; only
church-scope viewership can spike past what one VPS uplink can serve.

Once this is live and `LIVE_CDN_BASE` is set on the backend, `GET /live/now`
returns an absolute R2 URL as `hls_url` for the church row (plus
`hls_fallback_url`, the direct relative URL, for clients to fail over to if
the CDN copy briefly 404s — e.g. right at stream start before the publisher
has caught up).

Files in this directory (all copied onto the VPS by the operator — nothing
here runs in CI or in the repo's own containers):

- `publisher.py` — the daemon. Polls MediaMTX's local HLS endpoint every 3s;
  while the church stream is live it remuxes via `ffmpeg -c copy` into a
  short local playlist and mirrors it to R2 via `rclone` every 2s (segments
  uploaded before the playlist, always). Python 3 stdlib only.
- `nuru-live-cdn.service` — the systemd unit that runs it as root.

## One-time prerequisites

1. **rclone must already be installed and configured with an R2 remote named
   `r2`** pointing at the `nuru-live` bucket. If rclone isn't already on the
   box:

   ```bash
   curl https://rclone.org/install.sh | sudo bash
   ```

   Then configure the remote (needs an R2 API token — Cloudflare dashboard →
   R2 → "Manage R2 API tokens" → create one scoped to the `nuru-live`
   bucket, Object Read & Write):

   ```bash
   rclone config create r2 s3 \
     provider=Cloudflare \
     access_key_id=<R2_ACCESS_KEY_ID> \
     secret_access_key=<R2_SECRET_ACCESS_KEY> \
     endpoint=https://<ACCOUNT_ID>.r2.cloudflarestorage.com \
     acl=private
   ```

   Verify: `rclone lsd r2:nuru-live` should list (or, on a brand-new bucket,
   simply not error).

2. **The `nuru-live` R2 bucket must exist and serve `live-cdn/*` publicly.**
   Cloudflare dashboard → R2 → create bucket `nuru-live` → enable the bucket's
   free public **r2.dev** subdomain (Settings → Public Access → Allow Access).
   Note the resulting `https://pub-xxxxxxxx.r2.dev` URL — that's the value for
   the backend's `LIVE_CDN_BASE` env var (no trailing slash). A custom domain
   works too if preferred; either way `LIVE_CDN_BASE` must be the public base
   that serves `<base>/live-cdn/church/index.m3u8`.

3. **ffmpeg must be installed** (it already is on this VPS for the radio
   playout engine — `ffmpeg -version` to confirm).

## Install

```bash
# 1. Local staging directory the publisher writes to before rclone picks it up.
sudo mkdir -p /opt/pathway/live-cdn/out/church

# 2. Copy the daemon + unit onto the box (from a checkout of this repo, or scp).
sudo cp ops/live-cdn/publisher.py /opt/pathway/live-cdn/publisher.py
sudo chmod +x /opt/pathway/live-cdn/publisher.py
sudo cp ops/live-cdn/nuru-live-cdn.service /etc/systemd/system/nuru-live-cdn.service

# 3. Enable + start.
sudo systemctl daemon-reload
sudo systemctl enable --now nuru-live-cdn

# 4. Backend: set LIVE_CDN_BASE in the backend's env (e.g. /opt/pathway/.env
#    or wherever the backend container/service reads its environment from)
#    to the r2.dev (or custom domain) base from prerequisite #2, then restart
#    the backend so it picks up the new env var.
#    LIVE_CDN_BASE=https://pub-xxxxxxxx.r2.dev
```

## Verify

```bash
# Service is up and the last few log lines look sane:
sudo systemctl status nuru-live-cdn
sudo journalctl -u nuru-live-cdn -n 50 --no-pager

# Start a church-scope test stream (or wait for a real one), then within a
# few seconds you should see in the journal:
#   ... church stream detected LIVE
#   ... starting ffmpeg remux (church HLS -> local CDN staging dir)

# Confirm segments are landing locally:
ls -la /opt/pathway/live-cdn/out/church/

# Confirm they're reaching R2:
rclone ls r2:nuru-live/live-cdn/church

# Confirm the public URL actually serves the playlist:
curl -sI https://pub-xxxxxxxx.r2.dev/live-cdn/church/index.m3u8   # expect 200

# Confirm the backend is actually switching hls_url for the church row:
curl -s https://pathway.nuruplace.org/v1/live/now -H "Authorization: Bearer <token>" | jq
#   -> church row's hls_url should be the pub-xxxxxxxx.r2.dev URL, with
#      hls_fallback_url set to the direct /live/church/index.m3u8 path.

# End the stream and confirm the journal shows finalization, and that the R2
# playlist ends with EXT-X-ENDLIST:
sudo journalctl -u nuru-live-cdn -n 20 --no-pager   # "... finalizing CDN playlist"
curl -s https://pub-xxxxxxxx.r2.dev/live-cdn/church/index.m3u8 | tail -3
```

## R2 storage hygiene (segments accumulate otherwise)

`hls_flags delete_segments` prunes old segments from the *local* staging dir
automatically, but R2 itself has no such pruning — every `.ts` this daemon
ever uploaded stays in the bucket until something removes it. Add an R2
lifecycle rule so stale segments/playlists self-expire instead of growing the
bucket forever:

Cloudflare dashboard → R2 → `nuru-live` bucket → Lifecycle rules → add rule:

- **Prefix**: `live-cdn/`
- **Action**: Delete object
- **Condition**: age since upload > **1 day**

This is safe because the publisher re-uploads the whole live playlist/segment
window continuously while a stream is live and does a final upload at
stream-end — a 1-day expiry only ever removes objects from streams that ended
at least a day ago, never anything currently referenced by a live playlist.

## Troubleshooting

- **"rclone not found on PATH — skipping sync"** in the logs: rclone isn't
  installed, or the systemd unit's `PATH` doesn't include it. `which rclone`
  as root; if it resolves, the unit should see it too (systemd units inherit
  a standard `PATH` by default) — otherwise set `Environment=PATH=...` in the
  unit or symlink rclone into `/usr/local/bin`.
- **"ffmpeg not found on PATH"**: `apt install ffmpeg` (already present if
  radio playout is running on this box).
- **Segments upload but the playlist 404s on the public URL**: check the R2
  bucket's public-access setting is actually enabled (prerequisite #2) — a
  private bucket serves `rclone ls` fine but the public r2.dev URL 404s/403s.
- **Publisher never sees the stream as live**: confirm MediaMTX's HLS is
  actually reachable locally with `curl -sI 'http://127.0.0.1:8888/church/index.m3u8?cookieCheck=1'`
  while a church stream is running — should be 200. If that 404s, the issue
  is upstream of this daemon (MediaMTX/backend), not the publisher.
