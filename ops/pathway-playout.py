#!/usr/bin/env python3
"""Nuru Pathway radio playout engine v2 — liquidsoap live mixer.

v1 streamed a live program's playlist to Icecast with ffmpeg. v2 runs a real
MIXER per live program via liquidsoap: playlist bed + jingle request queue +
live-mic harbor input, each behind an interactive gain (mic/bed/jingle/master)
controllable over liquidsoap's telnet server (port 1234) — which the backend's
/admin/radio/mixer/live/* endpoints drive. Falls back to the v1 ffmpeg path if
liquidsoap is missing. One liquidsoap mix at a time (first live program);
additional simultaneous live programs stream via ffmpeg.

Playlist edits mid-broadcast are picked up live (m3u reload_mode=watch).
Runs as systemd `pathway-playout` on the VPS host (root). Stdlib only.
"""
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.parse

POLL_SEC = 10
ICECAST = "127.0.0.1:8300"
HARBOR_PORT = 8005          # butt/Mixxx connect here (user "source", mount /mic)
TELNET_PORT = 1234          # liquidsoap control (backend mixer/live endpoints)
MEDIA_DIR = "/var/www/pathway-media"
MEDIA_PREFIX = "/media/"
RUN_DIR = "/run/pathway-playout"
PW_FILE = "/root/.icecast_source_pw"
PSQL = [
    "docker", "exec", "pathway-postgres-1",
    "psql", "-U", "nuru", "-d", "nuru", "-tA",
]

SQL_LIVE = (
    "SELECT json_build_object('id',p.id,'loop',p.loop_mode,'hls',p.hls_url,"
    "'title',p.title,'audio',p.audio_url,'tracks',COALESCE((SELECT json_agg(t.audio_url "
    "ORDER BY pt.position) FROM radio_program_tracks pt JOIN radio_tracks t "
    "ON t.id=pt.track_id WHERE pt.program_id=p.id),'[]'::json)) "
    "FROM radio_programs p WHERE p.is_live = true ORDER BY p.live_started_at ASC NULLS LAST;"
)

HAVE_LIQ = shutil.which("liquidsoap") is not None

# The live-mix script. Gains are interactive floats the backend sets via telnet
# (`var.set mic = 0.8`); jingles arrive on a request.queue (`jingles.push <path>`).
LIQ_TEMPLATE = """\
settings.init.allow_root := true
settings.log.stdout := true
settings.server.telnet := true
settings.server.telnet.bind_addr := "0.0.0.0"
settings.server.telnet.port := {telnet_port}
settings.harbor.bind_addrs := ["0.0.0.0"]

mic_g = interactive.float("mic", 1.0)
bed_g = interactive.float("bed", 0.8)
jin_g = interactive.float("jingle", 1.0)
mas_g = interactive.float("master", 0.9)

# 3-band peaking EQ per bus (gains in dB, -12..+12, driven by the Mixer UI).
eq_mic_low = interactive.float("eq_mic_low", 0.)
eq_mic_mid = interactive.float("eq_mic_mid", 0.)
eq_mic_high = interactive.float("eq_mic_high", 0.)
eq_bed_low = interactive.float("eq_bed_low", 0.)
eq_bed_mid = interactive.float("eq_bed_mid", 0.)
eq_bed_high = interactive.float("eq_bed_high", 0.)
eq_master_low = interactive.float("eq_master_low", 0.)
eq_master_mid = interactive.float("eq_master_mid", 0.)
eq_master_high = interactive.float("eq_master_high", 0.)

def eq3(low, mid, high, s) =
  s = filter.iir.eq.peak(frequency=100., q=0.7, gain=low, s)
  s = filter.iir.eq.peak(frequency=1200., q=1.0, gain=mid, s)
  filter.iir.eq.peak(frequency=8000., q=0.8, gain=high, s)
end

{bed_def}

jq = request.queue(id="jingles")

mic = input.harbor("mic", port={harbor_port}, password="{password}")
# Voice chain: EQ then a gentle broadcast compressor (evens the presenter out).
mic = eq3(eq_mic_low, eq_mic_mid, eq_mic_high, mic)
mic = compress(attack=5., release=80., ratio=3., threshold=-18., mic)

bed = eq3(eq_bed_low, eq_bed_mid, eq_bed_high, bed)
# Loudness-normalize the bed so tracks mastered at different levels don't jump
# in volume when the playlist advances (the "music suddenly got louder" bug).
# up=8s: quiet passages swell back SLOWLY (no pumping under a voice-over);
# down=0.1s: loud entrances still duck instantly; gain_max=4 caps the boost.
bed = normalize(target=-16., up=8., down=0.1, gain_max=4., gain_min=-8., bed)

mix = add(normalize=false,
  [amplify(bed_g, bed), amplify(jin_g, jq), amplify(mic_g, mic)])

mix = eq3(eq_master_low, eq_master_mid, eq_master_high, mix)
full = mksafe(amplify(mas_g, mix))

output.icecast(%mp3(bitrate=128),
  host="127.0.0.1", port={icecast_port}, password="{password}",
  mount="{mount}", name={title}, full)

# Presenter monitor: the FULL on-air chain minus the mic — bed fader + EQ,
# jingle fader, master EQ + master gain — so preset/fader moves (e.g. Voice
# Over Music ducking the bed) are heard in-ear exactly as on air. Own voice
# comes via the mic's hardware sidetone, never through this feed.
mon_mix = add(normalize=false, [amplify(bed_g, bed), amplify(jin_g, jq)])
mon_mix = eq3(eq_master_low, eq_master_mid, eq_master_high, mon_mix)
monitor = mksafe(amplify(mas_g, mon_mix))
output.icecast(%mp3(bitrate=128),
  host="127.0.0.1", port={icecast_port}, password="{password}",
  mount="{monitor_mount}", name="Monitor (on-air)", monitor)

# Cue feed: PRE-FADER bed + jingles — music always clear in-ear regardless of
# on-air ducking (DJ-style cue/PFL). The broadcaster picks On-air vs Cue.
cue = mksafe(add(normalize=false, [bed, jq]))
output.icecast(%mp3(bitrate=128),
  host="127.0.0.1", port={icecast_port}, password="{password}",
  mount="{cue_mount}", name="Monitor (cue)", cue)
"""


procs = {}   # program_id -> {"proc", "sig", "kind": "liq"|"ffmpeg", "died_at"}


def log(msg):
    print(msg, flush=True)


def psql(sql):
    out = subprocess.run(PSQL + ["-c", sql], capture_output=True, text=True, timeout=30)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip()[:300])
    return [l for l in out.stdout.splitlines() if l.strip()]


def live_programs():
    rows = []
    for line in psql(SQL_LIVE):
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            log(f"bad row: {line[:120]}")
    return rows


def mount_for(prog):
    hls = prog.get("hls") or ""
    path = urllib.parse.urlparse(hls).path
    if "/listen/" in path:
        return "/" + path.split("/listen/", 1)[1]
    mount = "/s_" + hashlib.sha256(prog["id"].encode()).hexdigest()[:8] + ".mp3"
    try:
        psql(
            "UPDATE radio_programs SET hls_url = "
            f"'https://pathway.nuruplace.org/listen{mount}', updated_at = now() "
            f"WHERE id = '{prog['id']}';"
        )
        log(f"self-healed hls_url for {prog['id'][:8]} -> /listen{mount}")
    except Exception as e:  # noqa: BLE001
        log(f"hls self-heal failed: {e}")
    return mount


def local_or_url(u):
    path = urllib.parse.urlparse(u).path
    if path.startswith(MEDIA_PREFIX):
        cand = os.path.join(MEDIA_DIR, path[len(MEDIA_PREFIX):])
        if os.path.isfile(cand):
            return cand
    return u


def sources_for(prog):
    tracks = [t for t in (prog.get("tracks") or []) if t]
    if not tracks and prog.get("audio"):
        tracks = [prog["audio"]]
    return [local_or_url(t) for t in tracks]


def liq_escape(s):
    return s.replace("\\", "\\\\").replace('"', '\\"')


def write_liq(prog, pw):
    pid = prog["id"]
    os.makedirs(RUN_DIR, exist_ok=True)
    srcs = sources_for(prog)
    loop = prog.get("loop") or "none"
    if loop == "repeat_one" and srcs:
        srcs = srcs[:1]
    if srcs:
        m3u = os.path.join(RUN_DIR, f"{pid}.m3u")
        with open(m3u, "w") as f:
            f.write("\n".join(srcs) + "\n")
        loop_flag = "false" if loop == "none" else "true"
        bed_def = (
            f'bed = playlist(mode="normal", loop={loop_flag}, '
            f'reload_mode="watch", "{liq_escape(m3u)}")\n'
            "bed = mksafe(bed)"
        )
    else:
        # Mic-only session: silent bed, the harbor mic carries the broadcast.
        bed_def = "bed = blank()"
    liq = LIQ_TEMPLATE.format(
        telnet_port=TELNET_PORT,
        harbor_port=HARBOR_PORT,
        password=pw,
        icecast_port=8300,
        mount=mount_for(prog),
        monitor_mount=mount_for(prog).replace("/s_", "/mon_"),
        cue_mount=mount_for(prog).replace("/s_", "/cue_"),
        title=json.dumps(prog.get("title") or "Nuru Radio"),
        bed_def=bed_def,
    )
    path = os.path.join(RUN_DIR, f"{pid}.liq")
    with open(path, "w") as f:
        f.write(liq)
    os.chmod(path, 0o600)  # embeds the source password
    return path


def start_liq(prog, pw):
    path = write_liq(prog, pw)
    log(f"playout START liq {prog['id'][:8]} mount={mount_for(prog)} loop={prog.get('loop')} items={len(sources_for(prog))}")
    return subprocess.Popen(["liquidsoap", path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def start_ffmpeg(prog, pw):
    srcs = sources_for(prog)
    if not srcs:
        return None
    loop = prog.get("loop") or "none"
    if loop == "repeat_one":
        srcs = srcs[:1]
    os.makedirs(RUN_DIR, exist_ok=True)
    lst = os.path.join(RUN_DIR, f"{prog['id']}.txt")
    with open(lst, "w") as f:
        for s in srcs:
            f.write("file '" + s.replace("'", "'\\''") + "'\n")
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-re"]
    if loop in ("loop_all", "repeat_one"):
        cmd += ["-stream_loop", "-1"]
    cmd += ["-f", "concat", "-safe", "0", "-i", lst, "-vn", "-c:a", "libmp3lame",
            "-b:a", "128k", "-ar", "44100", "-ac", "2", "-content_type", "audio/mpeg",
            "-f", "mp3", f"icecast://source:{pw}@{ICECAST}{mount_for(prog)}"]
    log(f"playout START ffmpeg {prog['id'][:8]}")
    return subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def sig_of(prog, kind):
    # liquidsoap restarts only on loop-mode / bed-presence changes (track edits
    # flow through the watched m3u); ffmpeg restarts on any playlist change.
    if kind == "liq":
        return json.dumps({"l": prog.get("loop"), "has": bool(sources_for(prog))})
    return json.dumps({"t": prog.get("tracks"), "l": prog.get("loop"), "a": prog.get("audio")})


def rewrite_m3u(prog):
    srcs = sources_for(prog)
    loop = prog.get("loop") or "none"
    if loop == "repeat_one" and srcs:
        srcs = srcs[:1]
    if not srcs:
        return
    m3u = os.path.join(RUN_DIR, f"{prog['id']}.m3u")
    want = "\n".join(srcs) + "\n"
    try:
        cur = open(m3u).read()
    except OSError:
        cur = ""
    if cur != want:
        with open(m3u, "w") as f:
            f.write(want)
        log(f"playlist updated for {prog['id'][:8]} ({len(srcs)} items)")


def stop(pid):
    ent = procs.pop(pid, None)
    if ent and ent["proc"] and ent["proc"].poll() is None:
        log(f"playout STOP {ent['kind']} {pid[:8]}")
        ent["proc"].terminate()
        try:
            ent["proc"].wait(timeout=6)
        except subprocess.TimeoutExpired:
            ent["proc"].kill()


def main():
    with open(PW_FILE) as f:
        pw = f.read().strip()
    log(f"pathway-playout v2 up (liquidsoap={'yes' if HAVE_LIQ else 'NO — ffmpeg fallback'})")
    while True:
        try:
            live = {p["id"]: p for p in live_programs()}
        except Exception as e:  # noqa: BLE001
            log(f"db poll failed: {e}")
            time.sleep(POLL_SEC)
            continue
        for pid in list(procs):
            if pid not in live:
                stop(pid)
        liq_taken = any(e["kind"] == "liq" for e in procs.values())
        for pid, prog in live.items():
            ent = procs.get(pid)
            kind = "liq" if HAVE_LIQ and (not liq_taken or (ent and ent["kind"] == "liq")) else "ffmpeg"
            want = sig_of(prog, kind)
            if ent and (ent["sig"] != want or ent["kind"] != kind):
                stop(pid)
                ent = None
            if ent and ent["kind"] == "liq":
                rewrite_m3u(prog)  # live playlist edits, no restart
            if ent and ent["proc"].poll() is not None:
                if ent["kind"] == "ffmpeg" and (prog.get("loop") or "none") == "none":
                    continue  # ffmpeg 'none' finishing is normal
                if time.time() - ent.get("died_at", 0) < 15:
                    continue
                procs.pop(pid, None)
                ent = None
            if not ent:
                proc = start_liq(prog, pw) if kind == "liq" else start_ffmpeg(prog, pw)
                if proc is not None:
                    procs[pid] = {"proc": proc, "sig": want, "kind": kind, "died_at": time.time()}
                    if kind == "liq":
                        liq_taken = True
        time.sleep(POLL_SEC)


def shutdown(*_):
    for pid in list(procs):
        stop(pid)
    sys.exit(0)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    main()
