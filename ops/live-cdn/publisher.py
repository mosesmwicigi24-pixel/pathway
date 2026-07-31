#!/usr/bin/env python3
"""Nuru Live L1.5 CDN publisher (docs/LIVE_STREAMING.md) — mirrors the CHURCH
HLS output to a Cloudflare R2 bucket so viewer fan-out rides R2's edge instead
of the VPS's own uplink (the L1 ceiling was ~60 viewers at 6 Mbps). Cell
streams are NOT mirrored — small audiences don't have a fan-out problem.

State machine (poll every 3s against the local MediaMTX HLS endpoint):
  IDLE  -- GET http://127.0.0.1:8888/church/index.m3u8?cookieCheck=1;
           200 -> church is live -> LIVE. 404 -> stay IDLE.
  LIVE  -- run a child `ffmpeg -c copy` remuxing that HLS endpoint into a
           short local playlist (out/church/), restarting it (3s backoff) if
           it dies while the source is still live; in parallel, every 2s,
           rclone-copy new .ts segments to R2 THEN the .m3u8 playlist
           (segments-before-playlist — a playlist must never point at a
           segment R2 doesn't have yet).
  ENDING-- the poll 404s: kill ffmpeg, append EXT-X-ENDLIST to the local
           playlist if missing, upload it one last time, wipe the local out
           dir, return to IDLE.

Defensive by design: a missing ffmpeg/rclone binary, or an unreachable R2, is
logged and retried on the next tick — this process never crash-loops. Stdlib
only (no pip install on the VPS). Runs as systemd nuru-live-cdn.service
(root), started/managed per ops/live-cdn/README.md.

L1.5b per-stream CDN paths (docs/LIVE_CDN_PERSTREAM.md) — fixes a flicker bug:
every broadcast used to share the exact same R2 object path
(live-cdn/church/index.m3u8), so a brand-new stream's first seconds could
serve the PREVIOUS stream's manifest/segments off R2's edge cache. This
publisher now mirrors to BOTH the legacy static path (unconditionally — older
app builds in the field, and any deploy where the backend's
LIVE_CDN_PER_STREAM flag is still off, depend on it) AND a per-stream path
live-cdn/church/<stream_id>/, once it has resolved the live stream's id by
polling the backend's GET /v1/live/church/current (unauthenticated,
loopback-only — see that route's own doc comment in
packages/backend/src/modules/live/index.ts). If that lookup ever fails
(backend momentarily unreachable, or this daemon predates the backend route
existing), the per-stream upload is skipped for that broadcast and ONLY the
legacy path is written — never a hard failure.
"""
import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

# --- config -----------------------------------------------------------------

SOURCE_URL = "http://127.0.0.1:8888/church/index.m3u8?cookieCheck=1"
OUT_DIR = "/opt/pathway/live-cdn/out/church"
PLAYLIST = os.path.join(OUT_DIR, "index.m3u8")
SEGMENT_PATTERN = os.path.join(OUT_DIR, "seg_%05d.ts")
R2_REMOTE = "r2:nuru-live/live-cdn/church"

# host:port must match wherever the backend actually listens from this VPS's
# network — same assumption/caveat as MediaMTX's own authHTTPAddress
# (packages/backend/src/modules/live/index.ts OPS FOLLOW-UP #2); adjust both
# together if that ever changes.
BACKEND_CURRENT_STREAM_URL = "http://127.0.0.1:8080/v1/live/church/current"

POLL_INTERVAL_SEC = 3
SYNC_INTERVAL_SEC = 2
FFMPEG_RESTART_BACKOFF_SEC = 3
RCLONE_TIMEOUT_SEC = 20
BACKEND_LOOKUP_TIMEOUT_SEC = 5

FFMPEG_CMD = [
    "ffmpeg", "-loglevel", "warning",
    "-i", SOURCE_URL,
    "-c", "copy",
    "-f", "hls",
    "-hls_time", "2",
    "-hls_list_size", "6",
    "-hls_flags", "delete_segments+independent_segments",
    "-hls_segment_filename", SEGMENT_PATTERN,
    PLAYLIST,
]

# --- logging (terse, timestamped, stdout -> journald under systemd) --------


def log(msg: str) -> None:
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    print(f"{ts} [live-cdn] {msg}", flush=True)


# --- source polling -----------------------------------------------------


def source_is_live() -> bool:
    """200 -> church HLS is live; 404 -> not; anything else (connection
    refused, timeout, 5xx) is treated as "not live" but logged — MediaMTX
    being briefly unreachable must never crash this process."""
    try:
        with urllib.request.urlopen(SOURCE_URL, timeout=5) as resp:
            return resp.status == 200
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return False
        log(f"poll: unexpected HTTP {e.code} from MediaMTX — treating as not-live")
        return False
    except Exception as e:  # noqa: BLE001 — deliberately broad; must never crash
        log(f"poll: MediaMTX unreachable ({e}) — treating as not-live")
        return False


def fetch_current_stream_id() -> "str | None":
    """L1.5b: resolve the live church stream's id from the backend so this
    broadcast's segments/playlist can also be mirrored to a per-stream R2
    path. Called once per IDLE->LIVE transition (a stream's id never changes
    mid-broadcast). Any failure — backend down, non-200, bad JSON, no stream
    actually live server-side — returns None and is logged, never raised:
    the caller falls back to legacy-path-only for that broadcast."""
    try:
        with urllib.request.urlopen(BACKEND_CURRENT_STREAM_URL, timeout=BACKEND_LOOKUP_TIMEOUT_SEC) as resp:
            if resp.status != 200:
                log(f"current-stream lookup: unexpected HTTP {resp.status} — per-stream CDN path skipped for this broadcast")
                return None
            body = json.loads(resp.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001 — must never crash the main loop
        log(f"current-stream lookup failed ({e}) — per-stream CDN path skipped for this broadcast")
        return None
    stream_id = body.get("stream_id") if isinstance(body, dict) else None
    return stream_id if isinstance(stream_id, str) and stream_id else None


# --- ffmpeg child process management ---------------------------------------


class FfmpegRunner:
    """Owns the remux child process. `ensure_running` is idempotent — call it
    every tick while the source is live; it only actually restarts once the
    process has died AND the backoff window has elapsed."""

    def __init__(self) -> None:
        self.proc: "subprocess.Popen[bytes] | None" = None
        self.last_start = 0.0

    def is_alive(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def ensure_running(self) -> None:
        if self.is_alive():
            return
        if self.proc is not None:
            log(f"ffmpeg exited (code={self.proc.returncode}) while source is still live")
        if time.time() - self.last_start < FFMPEG_RESTART_BACKOFF_SEC:
            return  # next poll tick (also ~3s) retries — natural backoff, no busy loop
        self._start()

    def _start(self) -> None:
        try:
            os.makedirs(OUT_DIR, exist_ok=True)
        except OSError as e:
            log(f"cannot create {OUT_DIR}: {e} — will retry next tick")
            return
        self.last_start = time.time()
        try:
            log("starting ffmpeg remux (church HLS -> local CDN staging dir)")
            self.proc = subprocess.Popen(FFMPEG_CMD)
        except FileNotFoundError:
            log("ffmpeg not found on PATH — cannot remux; will retry next tick")
            self.proc = None
        except Exception as e:  # noqa: BLE001
            log(f"failed to start ffmpeg: {e} — will retry next tick")
            self.proc = None

    def stop(self) -> None:
        if self.proc is None or self.proc.poll() is not None:
            self.proc = None
            return
        log("stopping ffmpeg (source ended)")
        try:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=5)
        except Exception as e:  # noqa: BLE001
            log(f"error stopping ffmpeg: {e}")
        self.proc = None


# --- rclone sync (segments, then playlist) ----------------------------------


def rclone_available() -> bool:
    return shutil.which("rclone") is not None


def run_rclone(args: list, label: str) -> bool:
    try:
        result = subprocess.run(
            ["rclone", *args],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            timeout=RCLONE_TIMEOUT_SEC, text=True,
        )
    except FileNotFoundError:
        log(f"rclone not found on PATH — skipping {label} (will retry)")
        return False
    except subprocess.TimeoutExpired:
        log(f"rclone {label} timed out after {RCLONE_TIMEOUT_SEC}s — will retry")
        return False
    except Exception as e:  # noqa: BLE001
        log(f"rclone {label} raised {e} — will retry")
        return False
    if result.returncode != 0:
        out = (result.stdout or "").strip().replace("\n", " ")[:300]
        log(f"rclone {label} failed (exit {result.returncode}): {out}")
        return False
    return True


def per_stream_remote(stream_id: str) -> str:
    return f"{R2_REMOTE}/{stream_id}"


def sync_one_remote(remote: str, label: str) -> None:
    """Segments first, THEN the .m3u8 — a playlist uploaded before its
    segments would let a viewer's player 404 on a segment it just learned
    about. Applied independently per remote (legacy and per-stream each get
    their own consistent segments-then-playlist ordering)."""
    run_rclone(["copy", OUT_DIR, remote, "--include", "*.ts", "--no-traverse"], f"{label} segment copy")
    if os.path.isfile(PLAYLIST):
        run_rclone(["copyto", PLAYLIST, f"{remote}/index.m3u8"], f"{label} playlist copyto")


def sync_segments_then_playlist(stream_id: "str | None") -> None:
    """One sync pass, mirrored to up to two R2 destinations. Best-effort;
    failures just retry next tick.

    L1.5b (docs/LIVE_CDN_PERSTREAM.md): the legacy static path is ALWAYS
    written — older app builds in the field, and any deploy where the
    backend's LIVE_CDN_PER_STREAM flag is still off, depend on it existing
    regardless of backend/daemon deploy order. The per-stream path is
    additive and only written once `stream_id` has been resolved for this
    broadcast (see fetch_current_stream_id)."""
    if not rclone_available():
        log("rclone not found on PATH; skipping sync (will retry next tick)")
        return
    if not os.path.isdir(OUT_DIR):
        return
    sync_one_remote(R2_REMOTE, "legacy")
    if stream_id:
        sync_one_remote(per_stream_remote(stream_id), f"per-stream({stream_id})")


class StreamState:
    """Shared between the main thread (sets stream_id once per IDLE->LIVE
    transition) and the Syncer thread (reads it every sync tick). Plain
    attribute get/set on a str-or-None is atomic under the GIL for this
    single-writer/single-reader use — no lock needed."""

    def __init__(self) -> None:
        self.stream_id: "str | None" = None


class Syncer(threading.Thread):
    """Background thread: while `live_event` is set, syncs every 2s. Runs for
    the process lifetime; `stop_event` ends it on shutdown."""

    def __init__(self, live_event: threading.Event, stop_event: threading.Event, state: StreamState) -> None:
        super().__init__(name="live-cdn-syncer", daemon=True)
        self.live_event = live_event
        self.stop_event = stop_event
        self.state = state

    def run(self) -> None:
        while not self.stop_event.is_set():
            if self.live_event.is_set():
                try:
                    sync_segments_then_playlist(self.state.stream_id)
                except Exception as e:  # noqa: BLE001 — a sync-thread crash must not kill the daemon
                    log(f"sync thread error: {e}")
            self.stop_event.wait(SYNC_INTERVAL_SEC)


# --- end-of-stream finalization ---------------------------------------------


def append_endlist_if_missing() -> None:
    if not os.path.isfile(PLAYLIST):
        return
    with open(PLAYLIST, "r", encoding="utf-8") as f:
        content = f.read()
    if "#EXT-X-ENDLIST" in content:
        return
    if not content.endswith("\n"):
        content += "\n"
    content += "#EXT-X-ENDLIST\n"
    with open(PLAYLIST, "w", encoding="utf-8") as f:
        f.write(content)


def clean_out_dir() -> None:
    if not os.path.isdir(OUT_DIR):
        return
    for name in os.listdir(OUT_DIR):
        path = os.path.join(OUT_DIR, name)
        try:
            if os.path.isdir(path):
                shutil.rmtree(path, ignore_errors=True)
            else:
                os.remove(path)
        except FileNotFoundError:
            pass
        except OSError as e:
            log(f"cleanup: could not remove {path}: {e}")


def finalize_stream(stream_id: "str | None") -> None:
    log("stream ended — finalizing CDN playlist (EXT-X-ENDLIST) and cleaning up")
    try:
        append_endlist_if_missing()
    except OSError as e:
        log(f"could not append EXT-X-ENDLIST: {e}")
    # One last upload to both remotes — segments before the ENDLIST playlist,
    # same ordering rule as the live sync loop.
    if rclone_available() and os.path.isdir(OUT_DIR):
        sync_one_remote(R2_REMOTE, "final legacy")
        if stream_id:
            sync_one_remote(per_stream_remote(stream_id), f"final per-stream({stream_id})")
    else:
        log("rclone unavailable — could not upload the final ENDLIST playlist")
    clean_out_dir()


# --- main loop ---------------------------------------------------------


def main() -> None:
    try:
        os.makedirs(OUT_DIR, exist_ok=True)
    except OSError as e:
        log(f"warning: could not create {OUT_DIR} at startup: {e} (will retry per-tick)")

    log(f"nuru-live-cdn publisher starting; polling {SOURCE_URL} every {POLL_INTERVAL_SEC}s")

    ffmpeg = FfmpegRunner()
    live_event = threading.Event()
    stop_event = threading.Event()
    state = StreamState()
    syncer = Syncer(live_event, stop_event, state)
    syncer.start()

    def handle_signal(signum: int, _frame: object) -> None:
        log(f"received signal {signum}; shutting down")
        stop_event.set()
        ffmpeg.stop()
        sys.exit(0)

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    was_live = False
    while True:
        try:
            is_live = source_is_live()
            if is_live and not was_live:
                log("church stream detected LIVE")
                was_live = True
                state.stream_id = fetch_current_stream_id()
                if state.stream_id:
                    log(f"resolved stream_id={state.stream_id} — mirroring to the per-stream CDN path too")
                else:
                    log("could not resolve stream_id from the backend — only the legacy CDN path will be updated for this broadcast")
                live_event.set()
                ffmpeg.ensure_running()
            elif is_live and was_live:
                ffmpeg.ensure_running()  # no-op unless the child died
            elif (not is_live) and was_live:
                log("church stream ended")
                was_live = False
                live_event.clear()
                ffmpeg.stop()
                finalize_stream(state.stream_id)
                state.stream_id = None
            # not is_live and not was_live: idle, nothing to do this tick.
        except Exception as e:  # noqa: BLE001 — the main loop must never die
            log(f"main loop error (continuing): {e}")

        time.sleep(POLL_INTERVAL_SEC)


if __name__ == "__main__":
    main()
