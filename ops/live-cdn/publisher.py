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
"""
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

POLL_INTERVAL_SEC = 3
SYNC_INTERVAL_SEC = 2
FFMPEG_RESTART_BACKOFF_SEC = 3
RCLONE_TIMEOUT_SEC = 20

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


def sync_segments_then_playlist() -> None:
    """One sync pass: new .ts segments first, THEN the .m3u8 — a playlist
    uploaded before its segments would let a viewer's player 404 on a segment
    it just learned about. Best-effort; failures just retry next tick."""
    if not rclone_available():
        log("rclone not found on PATH; skipping sync (will retry next tick)")
        return
    if not os.path.isdir(OUT_DIR):
        return
    run_rclone(["copy", OUT_DIR, R2_REMOTE, "--include", "*.ts", "--no-traverse"], "segment copy")
    if os.path.isfile(PLAYLIST):
        run_rclone(["copyto", PLAYLIST, f"{R2_REMOTE}/index.m3u8"], "playlist copyto")


class Syncer(threading.Thread):
    """Background thread: while `live_event` is set, syncs every 2s. Runs for
    the process lifetime; `stop_event` ends it on shutdown."""

    def __init__(self, live_event: threading.Event, stop_event: threading.Event) -> None:
        super().__init__(name="live-cdn-syncer", daemon=True)
        self.live_event = live_event
        self.stop_event = stop_event

    def run(self) -> None:
        while not self.stop_event.is_set():
            if self.live_event.is_set():
                try:
                    sync_segments_then_playlist()
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


def finalize_stream() -> None:
    log("stream ended — finalizing CDN playlist (EXT-X-ENDLIST) and cleaning up")
    try:
        append_endlist_if_missing()
    except OSError as e:
        log(f"could not append EXT-X-ENDLIST: {e}")
    # One last upload — segments before the ENDLIST playlist, same ordering rule.
    if rclone_available() and os.path.isdir(OUT_DIR):
        run_rclone(["copy", OUT_DIR, R2_REMOTE, "--include", "*.ts", "--no-traverse"], "final segment copy")
        if os.path.isfile(PLAYLIST):
            run_rclone(["copyto", PLAYLIST, f"{R2_REMOTE}/index.m3u8"], "final playlist copyto")
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
    syncer = Syncer(live_event, stop_event)
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
                live_event.set()
                ffmpeg.ensure_running()
            elif is_live and was_live:
                ffmpeg.ensure_running()  # no-op unless the child died
            elif (not is_live) and was_live:
                log("church stream ended")
                was_live = False
                live_event.clear()
                ffmpeg.stop()
                finalize_stream()
            # not is_live and not was_live: idle, nothing to do this tick.
        except Exception as e:  # noqa: BLE001 — the main loop must never die
            log(f"main loop error (continuing): {e}")

        time.sleep(POLL_INTERVAL_SEC)


if __name__ == "__main__":
    main()
