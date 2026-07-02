// Radio Broadcast Studio (/radio) — the admin "Live Broadcast Studio", faithful
// to the Figma make (ZMEsnrOJCXXY7rHfTBautI). Intentionally a DARK studio theme,
// distinct from the light portal. Wire contract: docs/RADIO_STUDIO_CONTRACT.md.
//
// REAL (API-backed, server-authoritative): program list + create + select, the
// broadcast lifecycle (go-live → status=live, end → status=ended), stream health
// polling while live, the ingest URL + stream key (copy + rotate), and listener
// comments. LOCAL (client-only hardware/UI): audio-source select, mic controls,
// gain, meters, waveform, device manager, emergency controls, reactions animation.
import { useCallback, useEffect, useState, type ReactElement } from "react";
import {
  Activity, Bell, Copy, Cpu, Disc3, Flame, Gauge, HardDrive, Headphones,
  Heart, KeyRound, Laptop, Loader2, Mic, MicOff, Pause, Play, Plus,
  QrCode, RefreshCw, Radio as RadioIcon, Send, ShieldAlert, Signal,
  SlidersHorizontal, Smartphone, Square, Tablet, Trash2, Volume2,
  Wifi, X, Check, type LucideIcon,
} from "lucide-react";
import { AxiosError } from "axios";
import {
  RadioApi,
  type RadioProgram,
  type RadioComment,
  type StreamHealth,
  type CreateRadioProgramBody,
} from "../../api/client";

/* ── studio palette ── */
const BG = "#0A1120";
const PANEL = "linear-gradient(180deg, #131E33 0%, #0F1829 100%)";
const PANEL_BORDER = "rgba(255,255,255,0.08)";
const GOLD = "#E6C66E";
const GOLD_DEEP = "#C89B3C";
const RED = "#EF4444";
const GREEN = "#22C55E";
const TEXT = "#E8EEF7";
const DIM = "rgba(232,238,247,0.55)";
const DIMMER = "rgba(232,238,247,0.38)";
const MONO = "'DM Mono', monospace";
const SERIF = "'DM Serif Display', serif";

type Phase = "idle" | "countdown" | "live" | "paused";

const CATEGORIES = ["Sermon", "Worship", "Prayer", "Bible Study", "Conference"] as const;
type Category = (typeof CATEGORIES)[number];

const AUDIO_SOURCES = [
  { key: "internal", label: "Internal Microphone", icon: Mic, status: "Connected", signal: 4 },
  { key: "usb", label: "USB Microphone", icon: Mic, status: "Connected", signal: 5 },
  { key: "mixer", label: "Mixer", icon: SlidersHorizontal, status: "Disconnected", signal: 0 },
  { key: "interface", label: "Audio Interface", icon: Headphones, status: "Connected", signal: 3 },
  { key: "phone", label: "Another Phone", icon: Smartphone, status: "Standby", signal: 2 },
  { key: "computer", label: "Another Computer", icon: Laptop, status: "Standby", signal: 2 },
  { key: "tablet", label: "Tablet", icon: Tablet, status: "Standby", signal: 1 },
] as const;

function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600).toString().padStart(2, "0");
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

// A comment's author label — the admin projection only carries member_id, so we
// show a short, stable id-tag until member-name enrichment ships server-side.
function authorLabel(c: RadioComment): string {
  return `Listener ${c.member_id.slice(0, 6)}`;
}

const VIS_LABELS = { public: "Public", members: "Members Only", private: "Private" } as const;
type VisKey = keyof typeof VIS_LABELS;

export function RadioStudio(): ReactElement {
  // ── server state ──
  const [programs, setPrograms] = useState<RadioProgram[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [health, setHealth] = useState<StreamHealth | null>(null);
  const [comments, setComments] = useState<RadioComment[]>([]);
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ── broadcast phase (drives the go-live UX; mirrors program.is_live) ──
  const [phase, setPhase] = useState<Phase>("idle");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);

  // ── local hardware / UI state ──
  const [muted, setMuted] = useState(false);
  const [monitor, setMonitor] = useState(true);
  const [noise, setNoise] = useState(true);
  const [echo, setEcho] = useState(true);
  const [compressor, setCompressor] = useState(true);
  const [limiter, setLimiter] = useState(false);
  const [gain, setGain] = useState(62);
  const [source, setSource] = useState("usb");
  const [connectOpen, setConnectOpen] = useState(false);
  const [reactions, setReactions] = useState({ heart: 328, amen: 512, fire: 174 });
  const [draft, setDraft] = useState("");

  // ── broadcast form (creates a real program) ──
  const [form, setForm] = useState<{
    title: string; description: string; category: Category; speaker: string;
    location: string; tags: string; artwork_url: string; visibility: VisKey;
    scheduled_at: string; duration_min: string; repeat: string; timezone: string;
    record_broadcast: boolean; record_target: "cloud" | "local" | "both";
  }>({
    title: "", description: "", category: "Sermon", speaker: "", location: "",
    tags: "", artwork_url: "", visibility: "public", scheduled_at: "",
    duration_min: "", repeat: "none", timezone: "Africa/Nairobi",
    record_broadcast: true, record_target: "both",
  });
  const [creating, setCreating] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const selected = programs?.find((p) => p.id === selectedId) ?? null;
  const live = phase === "live";

  // waveform + meters (client-simulated hardware)
  const [bars, setBars] = useState<number[]>(() => Array.from({ length: 56 }, () => 0.08));
  const [meterL, setMeterL] = useState(0.1);
  const [meterR, setMeterR] = useState(0.1);

  // ── load programs ──
  const load = useCallback(() => {
    setLoading(true);
    setForbidden(false);
    setLoadErr(null);
    RadioApi.programs()
      .then((list) => {
        setPrograms(list);
        setSelectedId((cur) => {
          if (cur && list.some((p) => p.id === cur)) return cur;
          // Prefer a live program, else the first.
          return list.find((p) => p.is_live)?.id ?? list[0]?.id ?? null;
        });
      })
      .catch((e: unknown) => {
        const status = e instanceof AxiosError ? e.response?.status : undefined;
        if (status === 403) setForbidden(true);
        else setLoadErr("Could not load broadcasts. Please try again.");
        setPrograms(null);
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  // ── mirror the selected program's live state into the phase machine ──
  useEffect(() => {
    if (!selected) { setPhase("idle"); return; }
    setPhase((p) => {
      if (selected.is_live) return p === "paused" ? "paused" : "live";
      if (p === "countdown") return p; // mid-countdown, don't clobber
      return "idle";
    });
    if (selected.is_live && selected.live_started_at) {
      const startedMs = new Date(selected.live_started_at).getTime();
      setElapsed(Math.max(0, Math.floor((Date.now() - startedMs) / 1000)));
    }
    setRotatedKey(null);
  }, [selectedId, selected]);

  // ── load comments for the selected program ──
  useEffect(() => {
    if (!selectedId) { setComments([]); return; }
    let alive = true;
    RadioApi.comments(selectedId)
      .then((c) => { if (alive) setComments(c); })
      .catch(() => { if (alive) setComments([]); });
    return () => { alive = false; };
  }, [selectedId]);

  // ── health polling while live (every 3.5s; stop on 409/end) ──
  useEffect(() => {
    if (phase !== "live" || !selectedId) { setHealth(null); return; }
    let alive = true;
    const poll = () => {
      RadioApi.health(selectedId)
        .then((h) => { if (alive) setHealth(h); })
        .catch((e: unknown) => {
          // 409 = not live any more; clear and let the lifecycle handlers correct phase.
          const status = e instanceof AxiosError ? e.response?.status : undefined;
          if (status === 409 && alive) setHealth(null);
        });
    };
    poll();
    const t = setInterval(poll, 3500);
    return () => { alive = false; clearInterval(t); };
  }, [phase, selectedId]);

  // ── refresh comments periodically while live ──
  useEffect(() => {
    if (phase !== "live" || !selectedId) return;
    const t = setInterval(() => {
      RadioApi.comments(selectedId).then(setComments).catch(() => {});
    }, 6000);
    return () => clearInterval(t);
  }, [phase, selectedId]);

  // ── live timer (from live_started_at when available) ──
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // ── animated waveform + meters (local) ──
  useEffect(() => {
    const active = phase === "live" && !muted;
    const int = setInterval(() => {
      setBars((prev) => prev.map((_, i) => {
        if (!active) return 0.05 + Math.random() * 0.04;
        const center = 1 - Math.abs(i - prev.length / 2) / (prev.length / 2);
        return Math.min(1, 0.12 + Math.random() * 0.9 * (0.4 + center * 0.6) * (gain / 100 + 0.4));
      }));
      const base = active ? 0.35 + (gain / 100) * 0.5 : 0.06;
      setMeterL(Math.min(1, base + Math.random() * (active ? 0.35 : 0.03)));
      setMeterR(Math.min(1, base + Math.random() * (active ? 0.35 : 0.03)));
    }, 110);
    return () => clearInterval(int);
  }, [phase, muted, gain]);

  // ── reactions drift while live (local decoration) ──
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => {
      setReactions((r) => ({
        heart: r.heart + Math.round(Math.random() * 3),
        amen: r.amen + Math.round(Math.random() * 4),
        fire: r.fire + Math.round(Math.random() * 2),
      }));
    }, 2600);
    return () => clearInterval(t);
  }, [phase]);

  // ── go-live countdown → real go-live call ──
  const beginCountdown = () => { setConfirmOpen(false); setPhase("countdown"); setCount(3); };

  const goLiveNow = useCallback(async () => {
    if (!selectedId) { setPhase("idle"); return; }
    setBusy(true);
    setActionErr(null);
    try {
      const updated = await RadioApi.goLive(selectedId);
      setPrograms((ps) => (ps ? ps.map((p) => (p.id === updated.id ? updated : p)) : ps));
      setPhase("live");
      setElapsed(0);
    } catch {
      setActionErr("Could not go live. Please try again.");
      setPhase("idle");
    } finally {
      setBusy(false);
    }
  }, [selectedId]);

  useEffect(() => {
    if (phase !== "countdown") return;
    if (count <= 0) {
      // countdown finished — persist the go-live.
      void goLiveNow();
      return;
    }
    const t = setTimeout(() => setCount((c) => c - 1), 850);
    return () => clearTimeout(t);
  }, [phase, count, goLiveNow]);

  const endBroadcast = useCallback(async () => {
    if (!selectedId) { setPhase("idle"); setElapsed(0); return; }
    setBusy(true);
    setActionErr(null);
    try {
      const updated = await RadioApi.end(selectedId);
      setPrograms((ps) => (ps ? ps.map((p) => (p.id === updated.id ? updated : p)) : ps));
      setPhase("idle");
      setElapsed(0);
      setHealth(null);
    } catch {
      setActionErr("Could not end the broadcast. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [selectedId]);

  const rotateKey = useCallback(async () => {
    if (!selectedId) return;
    setBusy(true);
    setActionErr(null);
    try {
      const { stream_key } = await RadioApi.rotateKey(selectedId);
      setRotatedKey(stream_key);
      // Reflect the new key in the in-memory program too.
      setPrograms((ps) => (ps ? ps.map((p) => (p.id === selectedId ? { ...p, stream_key } : p)) : ps));
    } catch {
      setActionErr("Could not rotate the stream key.");
    } finally {
      setBusy(false);
    }
  }, [selectedId]);

  const copy = useCallback((label: string, value: string) => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
    }).catch(() => {});
  }, []);

  const submitForm = useCallback(async () => {
    if (!form.title.trim()) { setFormErr("A title is required."); return; }
    setCreating(true);
    setFormErr(null);
    const body: CreateRadioProgramBody = {
      title: form.title.trim(),
      category: form.category,
      record_broadcast: form.record_broadcast,
      record_target: form.record_target,
    };
    if (form.description.trim()) body.description = form.description.trim();
    if (form.speaker.trim()) body.speaker = form.speaker.trim();
    if (form.location.trim()) body.location = form.location.trim();
    if (form.artwork_url.trim()) body.artwork_url = form.artwork_url.trim();
    if (form.visibility) body.visibility = form.visibility;
    if (form.repeat) body.repeat = form.repeat;
    if (form.timezone.trim()) body.timezone = form.timezone.trim();
    const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
    if (tags.length) body.tags = tags;
    if (form.scheduled_at) body.scheduled_at = new Date(form.scheduled_at).toISOString();
    const dur = Number(form.duration_min);
    if (form.duration_min && Number.isFinite(dur)) body.duration_min = dur;
    try {
      const created = await RadioApi.createProgram(body);
      setPrograms((ps) => [created, ...(ps ?? [])]);
      setSelectedId(created.id);
      setForm((f) => ({ ...f, title: "", description: "", speaker: "", location: "", tags: "", artwork_url: "", scheduled_at: "", duration_min: "" }));
    } catch {
      setFormErr("Could not create the broadcast. Please try again.");
    } finally {
      setCreating(false);
    }
  }, [form]);

  // Local-only host comment (not persisted — admins can't post as a member).
  const [localSay, setLocalSay] = useState<{ id: string; text: string }[]>([]);
  const postComment = () => {
    if (!draft.trim()) return;
    setLocalSay((c) => [{ id: `local-${Date.now()}`, text: draft.trim() }, ...c]);
    setDraft("");
  };

  const category = (selected?.category ?? "Sermon") as string;

  return (
    <div className="relative overflow-hidden" style={{ minHeight: "100%", background: BG, fontFamily: "'Manrope', sans-serif", color: TEXT }}>
      <style>{`
        .rs-panel { transition: box-shadow .3s ease, transform .3s ease, border-color .3s ease; }
        .rs-panel:hover { border-color: rgba(230,198,110,0.22); box-shadow: 0 24px 50px -30px rgba(0,0,0,0.9); }
        .rs-btn { transition: transform .15s ease, filter .2s ease, background .2s ease, box-shadow .2s ease; }
        .rs-btn:hover { filter: brightness(1.08); }
        .rs-btn:active { transform: translateY(1px); }
        .rs-tnum { font-variant-numeric: tabular-nums; }
        .rs-in::placeholder { color: ${DIMMER}; }
        @keyframes rs-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .45; transform: scale(.82); } }
        @keyframes rs-pop { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: scale(1); } }
        @keyframes rs-spin { to { transform: rotate(360deg); } }
        .rs-live-dot { animation: rs-pulse 1.4s ease-in-out infinite; }
        .rs-count { animation: rs-pop .4s cubic-bezier(.22,1,.36,1); }
        .rs-spin { animation: rs-spin 1s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .rs-live-dot, .rs-count, .rs-panel, .rs-spin { animation: none !important; transition: none !important; } }
      `}</style>

      {/* ambient studio glows */}
      <div aria-hidden style={{ position: "absolute", top: -180, right: -80, width: 520, height: 520, borderRadius: "50%", background: "radial-gradient(circle, rgba(200,155,60,0.10), transparent 62%)", pointerEvents: "none" }} />
      <div aria-hidden style={{ position: "absolute", top: 120, left: -140, width: 460, height: 460, borderRadius: "50%", background: "radial-gradient(circle, rgba(59,130,246,0.07), transparent 62%)", pointerEvents: "none" }} />

      {/* ── Top studio bar ── */}
      <div className="relative flex items-center justify-between gap-4 flex-wrap" style={{ padding: "16px clamp(16px,4vw,40px)", borderBottom: `1px solid ${PANEL_BORDER}`, background: "rgba(255,255,255,0.02)", backdropFilter: "blur(6px)" }}>
        <div aria-hidden style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1.5, background: "linear-gradient(90deg, transparent, rgba(200,155,60,0.6), rgba(245,199,126,0.3), transparent)", pointerEvents: "none" }} />
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center rounded-xl" style={{ width: 40, height: 40, background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`, color: "#0A1120" }}>
            <RadioIcon size={20} />
          </div>
          <div>
            <div style={{ fontFamily: SERIF, fontSize: 18, lineHeight: 1 }}>Live Broadcast Studio</div>
            <div style={{ fontSize: 11, color: DIM, marginTop: 3 }}>Pathway Radio · The Good News Mission</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {live ? (
            <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5" style={{ background: "rgba(239,68,68,0.15)", border: `1px solid ${RED}66`, color: "#FCA5A5", fontSize: 12, fontWeight: 800, letterSpacing: "0.06em" }}>
              <span className="rs-live-dot rounded-full" style={{ width: 8, height: 8, background: RED }} /> ON AIR
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5" style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${PANEL_BORDER}`, color: DIM, fontSize: 12, fontWeight: 700 }}>
              <span className="rounded-full" style={{ width: 8, height: 8, background: DIMMER }} /> Off air
            </span>
          )}
          <button className="rs-btn flex items-center justify-center rounded-lg" style={{ width: 36, height: 36, background: "rgba(255,255,255,0.06)", border: `1px solid ${PANEL_BORDER}`, color: TEXT }}><Bell size={16} /></button>
        </div>
      </div>

      <div className="relative" style={{ padding: "22px clamp(16px,4vw,40px) 44px" }}>
        {forbidden ? (
          <StateCard icon={ShieldAlert} title="You don't have access" body="The broadcast studio is limited to admins. If you believe you should have access, ask a SuperAdmin to grant the radio permission." />
        ) : loadErr ? (
          <StateCard icon={ShieldAlert} title="Couldn't load broadcasts" body={loadErr} action={<GoldButton onClick={load}>Try again</GoldButton>} />
        ) : (
          <div className="grid gap-4 sm:gap-5 grid-cols-1 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            {/* ══════════ LEFT — main studio ══════════ */}
            <div className="flex flex-col gap-5" style={{ minWidth: 0 }}>
              {/* Program selector */}
              <Panel>
                <SectionHead icon={RadioIcon} title="Broadcast" hint={loading ? "Loading…" : `${programs?.length ?? 0} program${(programs?.length ?? 0) === 1 ? "" : "s"}`} />
                {loading ? (
                  <div className="flex items-center gap-2" style={{ fontSize: 12.5, color: DIM, padding: "6px 0" }}>
                    <Loader2 size={14} className="rs-spin" /> Loading programs…
                  </div>
                ) : (programs?.length ?? 0) === 0 ? (
                  <div style={{ fontSize: 12.5, color: DIM, padding: "6px 0" }}>No programs yet — create one with the form below.</div>
                ) : (
                  <div className="flex gap-2 flex-wrap" style={{ marginBottom: selected ? 16 : 0 }}>
                    {programs?.map((p) => {
                      const sel = p.id === selectedId;
                      return (
                        <button key={p.id} onClick={() => setSelectedId(p.id)} className="rs-btn flex items-center gap-2 rounded-xl px-3 py-2 text-left" style={{ background: sel ? "rgba(230,198,110,0.12)" : "rgba(255,255,255,0.03)", border: `1px solid ${sel ? GOLD + "66" : PANEL_BORDER}`, maxWidth: 260 }}>
                          {p.is_live && <span className="rs-live-dot rounded-full shrink-0" style={{ width: 7, height: 7, background: RED }} />}
                          <span className="truncate" style={{ fontSize: 12.5, fontWeight: 600 }}>{p.title}</span>
                          <span className="shrink-0" style={{ fontSize: 10, color: DIM }}>{statusLabel(p.status)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {selected && (
                  <div className="flex gap-4 flex-wrap" style={{ marginTop: 4 }}>
                    <div className="rounded-2xl shrink-0 flex items-center justify-center relative overflow-hidden" style={{ width: 118, height: 118, background: selected.artwork_url ? `center/cover url("${selected.artwork_url}")` : `linear-gradient(140deg, ${GOLD_DEEP}, #6E4E12)`, boxShadow: "inset 0 0 40px rgba(0,0,0,0.3)" }}>
                      {!selected.artwork_url && <RadioIcon size={40} style={{ color: "#FFF3D6" }} />}
                      <div className="absolute" style={{ inset: 0, background: "radial-gradient(circle at 30% 20%, rgba(255,255,255,0.25), transparent 55%)" }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="rounded-full px-2 py-0.5" style={{ background: "rgba(230,198,110,0.16)", color: GOLD, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>{category}</span>
                        <span style={{ fontSize: 11, color: DIM }}>{VIS_LABELS[(selected.visibility as VisKey) ?? "public"]}</span>
                      </div>
                      <div style={{ fontFamily: SERIF, fontSize: 24, lineHeight: 1.1 }}>{selected.title}</div>
                      {selected.description && (
                        <div style={{ fontSize: 12.5, color: DIM, marginTop: 6, lineHeight: 1.55, maxWidth: 460 }}>{selected.description}</div>
                      )}
                      <div className="flex items-center gap-4 mt-3 flex-wrap" style={{ fontSize: 12, color: DIM }}>
                        {selected.speaker && <span className="inline-flex items-center gap-1.5"><Mic size={13} style={{ color: GOLD }} /> {selected.speaker}</span>}
                        {selected.location && <span className="inline-flex items-center gap-1.5"><Signal size={13} style={{ color: GOLD }} /> {selected.location}</span>}
                      </div>
                    </div>
                  </div>
                )}
              </Panel>

              {/* Live status bar (only while live/paused) */}
              {(live || phase === "paused") && selected && (
                <Panel style={{ borderColor: `${RED}44`, background: "linear-gradient(180deg, rgba(239,68,68,0.08), rgba(15,24,41,0.9))" }}>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Metric label="Status" value={live ? "LIVE" : "PAUSED"} valueColor={live ? "#FCA5A5" : GOLD} dot={live ? RED : GOLD} />
                    <Metric label="Duration" value={fmtDuration(elapsed)} mono />
                    <Metric label="Listeners" value={(health?.listeners ?? selected.peak_listeners).toLocaleString()} />
                    <Metric label="Health" value={healthWord(health)} valueColor={GREEN} sub={health ? `${health.bitrate} kbps` : "—"} />
                  </div>
                </Panel>
              )}

              {/* Ingest URL + stream key (broadcaster credentials) */}
              {selected && (
                <Panel>
                  <SectionHead icon={KeyRound} title="Ingest & stream key" hint="Broadcaster only — keep secret" />
                  <div className="flex flex-col gap-2">
                    <CredRow label="Ingest URL" value={selected.ingest_url ?? "—"} onCopy={selected.ingest_url ? () => copy("Ingest URL", selected.ingest_url!) : undefined} copied={copied === "Ingest URL"} />
                    <CredRow label="Stream key" value={rotatedKey ?? selected.stream_key ?? "—"} secret onCopy={(rotatedKey ?? selected.stream_key) ? () => copy("Stream key", (rotatedKey ?? selected.stream_key)!) : undefined} copied={copied === "Stream key"} />
                    {selected.hls_url && (
                      <CredRow label="HLS playback" value={selected.hls_url} onCopy={() => copy("HLS playback", selected.hls_url!)} copied={copied === "HLS playback"} />
                    )}
                  </div>
                  <button onClick={rotateKey} disabled={busy} className="rs-btn flex items-center justify-center gap-2 rounded-xl mt-3" style={{ width: "100%", height: 38, background: "rgba(230,198,110,0.12)", color: GOLD, border: `1px solid ${GOLD}44`, fontSize: 12.5, fontWeight: 700, opacity: busy ? 0.6 : 1 }}>
                    <RefreshCw size={14} className={busy ? "rs-spin" : ""} /> Rotate stream key
                  </button>
                  {rotatedKey && <div style={{ fontSize: 11, color: GREEN, marginTop: 8, textAlign: "center" }}>New key issued — the old key stops working immediately.</div>}
                </Panel>
              )}

              {/* Waveform */}
              <Panel>
                <SectionHead icon={Activity} title="Waveform" hint={live ? "Reacting to live audio" : "Idle"} />
                <div className="flex items-center justify-center gap-[3px]" style={{ height: 120, padding: "6px 2px" }}>
                  {bars.map((b, i) => {
                    const hue = b > 0.85 ? RED : b > 0.6 ? GOLD : GOLD_DEEP;
                    return <div key={i} style={{ flex: 1, height: `${Math.max(4, b * 100)}%`, minWidth: 2, borderRadius: 3, background: `linear-gradient(180deg, ${hue}, ${hue}55)`, transition: "height .11s linear", opacity: live && !muted ? 1 : 0.4 }} />;
                  })}
                </div>
              </Panel>

              {/* Broadcast controls */}
              <Panel>
                <SectionHead icon={RadioIcon} title="Broadcast controls" hint={selected ? "One tap to go live" : "Select a program first"} />
                {actionErr && <div style={{ fontSize: 11.5, color: "#FCA5A5", marginBottom: 10, textAlign: "center" }}>{actionErr}</div>}
                <div className="flex items-center justify-center gap-3 flex-wrap" style={{ padding: "6px 0 2px" }}>
                  {!live && phase !== "paused" ? (
                    <button onClick={() => setConfirmOpen(true)} disabled={phase === "countdown" || !selected || busy} className="rs-btn flex items-center gap-2.5 rounded-2xl px-8" style={{ height: 60, background: `linear-gradient(135deg, ${RED}, #B91C1C)`, color: "#fff", fontSize: 17, fontWeight: 800, boxShadow: "0 14px 34px -12px rgba(239,68,68,0.7)", opacity: !selected || busy ? 0.5 : 1 }}>
                      <span className="rounded-full" style={{ width: 12, height: 12, background: "#fff" }} /> Start Broadcast
                    </button>
                  ) : (
                    <>
                      {live ? (
                        <button onClick={() => setPhase("paused")} className="rs-btn flex items-center gap-2 rounded-2xl px-6" style={{ height: 60, background: "rgba(230,198,110,0.14)", color: GOLD, border: `1px solid ${GOLD}55`, fontSize: 15, fontWeight: 700 }}>
                          <Pause size={20} /> Pause
                        </button>
                      ) : (
                        <button onClick={() => setPhase("live")} className="rs-btn flex items-center gap-2 rounded-2xl px-6" style={{ height: 60, background: `linear-gradient(135deg, ${GREEN}, #15803D)`, color: "#fff", fontSize: 15, fontWeight: 800 }}>
                          <Play size={20} /> Resume
                        </button>
                      )}
                      <button onClick={endBroadcast} disabled={busy} className="rs-btn flex items-center gap-2 rounded-2xl px-6" style={{ height: 60, background: "rgba(239,68,68,0.14)", color: "#FCA5A5", border: `1px solid ${RED}55`, fontSize: 15, fontWeight: 700, opacity: busy ? 0.6 : 1 }}>
                        <Square size={18} /> End Broadcast
                      </button>
                    </>
                  )}
                </div>
                {selected?.record_broadcast && (
                  <div className="flex items-center justify-center gap-1.5 mt-3" style={{ fontSize: 11, color: DIM }}>
                    <Disc3 size={12} style={{ color: RED }} className={live ? "rs-live-dot" : ""} /> Recording {live ? "in progress" : "armed"} · target: {selected.record_target ?? "cloud"}
                  </div>
                )}
              </Panel>

              {/* Audio source + meters (local hardware) */}
              <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                <Panel>
                  <SectionHead icon={Mic} title="Audio source" />
                  <div className="flex flex-col gap-1.5" style={{ maxHeight: 214, overflowY: "auto" }}>
                    {AUDIO_SOURCES.map((s) => {
                      const Icon = s.icon;
                      const sel = source === s.key;
                      const connected = s.status === "Connected";
                      return (
                        <button key={s.key} onClick={() => setSource(s.key)} className="rs-btn flex items-center gap-3 rounded-xl px-3 py-2.5 text-left" style={{ background: sel ? "rgba(230,198,110,0.12)" : "rgba(255,255,255,0.03)", border: `1px solid ${sel ? GOLD + "66" : PANEL_BORDER}` }}>
                          <span className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 32, height: 32, background: sel ? GOLD : "rgba(255,255,255,0.06)", color: sel ? "#0A1120" : DIM }}><Icon size={15} /></span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span className="block truncate" style={{ fontSize: 12.5, fontWeight: 600 }}>{s.label}</span>
                            <span style={{ fontSize: 10.5, color: connected ? GREEN : s.status === "Disconnected" ? "#FCA5A5" : DIMMER }}>{s.status}</span>
                          </span>
                          <span className="flex items-end gap-0.5 shrink-0" style={{ height: 16 }}>
                            {[1, 2, 3, 4, 5].map((n) => (
                              <span key={n} style={{ width: 3, height: `${n * 3 + 2}px`, borderRadius: 1, background: n <= s.signal ? (sel ? GOLD : GREEN) : "rgba(255,255,255,0.12)" }} />
                            ))}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </Panel>

                <Panel>
                  <SectionHead icon={Activity} title="Audio meters" />
                  <div className="flex items-end justify-center gap-6" style={{ height: 200 }}>
                    <Meter label="L" level={muted ? 0.02 : meterL} />
                    <Meter label="R" level={muted ? 0.02 : meterR} />
                  </div>
                </Panel>
              </div>

              {/* Microphone controls (local) */}
              <Panel>
                <SectionHead icon={SlidersHorizontal} title="Microphone controls" />
                <div className="flex flex-wrap gap-2 mb-4">
                  <Toggle active={muted} onClick={() => setMuted((v) => !v)} icon={muted ? MicOff : Mic} label={muted ? "Muted" : "Mute"} danger={muted} />
                  <Toggle active={monitor} onClick={() => setMonitor((v) => !v)} icon={Headphones} label="Monitor" />
                  <Toggle active={noise} onClick={() => setNoise((v) => !v)} icon={Activity} label="Noise Suppression" />
                  <Toggle active={echo} onClick={() => setEcho((v) => !v)} icon={Volume2} label="Echo Cancellation" />
                  <Toggle active={compressor} onClick={() => setCompressor((v) => !v)} icon={SlidersHorizontal} label="Compressor" />
                  <Toggle active={limiter} onClick={() => setLimiter((v) => !v)} icon={Gauge} label="Limiter" />
                </div>
                <div className="flex items-center gap-3">
                  <span style={{ fontSize: 11, color: DIM, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, width: 44 }}>Gain</span>
                  <input type="range" min={0} max={100} value={gain} onChange={(e) => setGain(Number(e.target.value))} style={{ flex: 1, accentColor: GOLD_DEEP }} />
                  <span className="rs-tnum" style={{ fontFamily: MONO, fontSize: 13, color: GOLD, width: 42, textAlign: "right" }}>{gain}%</span>
                </div>
              </Panel>

              {/* Broadcast form — create a real program */}
              <Panel>
                <SectionHead icon={Plus} title="New broadcast" hint="Create a program" />
                {formErr && <div style={{ fontSize: 11.5, color: "#FCA5A5", marginBottom: 10 }}>{formErr}</div>}
                <div className="grid gap-2.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <Field label="Title" full>
                    <input className="rs-in" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Walking in Obedience" style={inputStyle} />
                  </Field>
                  <Field label="Description" full>
                    <textarea className="rs-in" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="A short summary listeners will see…" rows={2} style={{ ...inputStyle, height: "auto", padding: "8px 12px", resize: "vertical" }} />
                  </Field>
                  <Field label="Category">
                    <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as Category }))} style={inputStyle}>
                      {CATEGORIES.map((c) => <option key={c} value={c} style={optStyle}>{c}</option>)}
                    </select>
                  </Field>
                  <Field label="Visibility">
                    <select value={form.visibility} onChange={(e) => setForm((f) => ({ ...f, visibility: e.target.value as VisKey }))} style={inputStyle}>
                      {(Object.keys(VIS_LABELS) as VisKey[]).map((v) => <option key={v} value={v} style={optStyle}>{VIS_LABELS[v]}</option>)}
                    </select>
                  </Field>
                  <Field label="Speaker">
                    <input className="rs-in" value={form.speaker} onChange={(e) => setForm((f) => ({ ...f, speaker: e.target.value }))} placeholder="Pastor…" style={inputStyle} />
                  </Field>
                  <Field label="Location">
                    <input className="rs-in" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="Nairobi, Kenya" style={inputStyle} />
                  </Field>
                  <Field label="Tags (comma-separated)" full>
                    <input className="rs-in" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="faith, james, sunday" style={inputStyle} />
                  </Field>
                  <Field label="Artwork URL" full>
                    <input className="rs-in" value={form.artwork_url} onChange={(e) => setForm((f) => ({ ...f, artwork_url: e.target.value }))} placeholder="https://…" style={inputStyle} />
                  </Field>
                  <Field label="Schedule (optional)">
                    <input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm((f) => ({ ...f, scheduled_at: e.target.value }))} style={inputStyle} />
                  </Field>
                  <Field label="Duration (min)">
                    <input type="number" min={0} value={form.duration_min} onChange={(e) => setForm((f) => ({ ...f, duration_min: e.target.value }))} placeholder="45" style={inputStyle} />
                  </Field>
                  <Field label="Repeat">
                    <select value={form.repeat} onChange={(e) => setForm((f) => ({ ...f, repeat: e.target.value }))} style={inputStyle}>
                      {["none", "daily", "weekdays", "weekly"].map((r) => <option key={r} value={r} style={optStyle}>{r}</option>)}
                    </select>
                  </Field>
                  <Field label="Timezone">
                    <input className="rs-in" value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))} placeholder="Africa/Nairobi" style={inputStyle} />
                  </Field>
                </div>
                <div className="flex items-center justify-between flex-wrap gap-2" style={{ marginTop: 12 }}>
                  <div className="flex items-center gap-3 flex-wrap">
                    <button onClick={() => setForm((f) => ({ ...f, record_broadcast: !f.record_broadcast }))} className="flex items-center gap-2" style={{ fontSize: 12.5, fontWeight: 600, color: form.record_broadcast ? GOLD : DIM, background: "none", border: "none", cursor: "pointer" }}>
                      <span className="rounded-full shrink-0" style={{ width: 40, height: 22, background: form.record_broadcast ? GOLD_DEEP : "rgba(255,255,255,0.14)", padding: 3, transition: "background .15s" }}>
                        <span className="block rounded-full" style={{ width: 16, height: 16, background: "#fff", transform: form.record_broadcast ? "translateX(18px)" : "translateX(0)", transition: "transform .15s" }} />
                      </span>
                      <Disc3 size={14} style={{ color: RED }} /> Record broadcast
                    </button>
                    {form.record_broadcast && (
                      <select value={form.record_target} onChange={(e) => setForm((f) => ({ ...f, record_target: e.target.value as "cloud" | "local" | "both" }))} style={{ ...inputStyle, width: "auto", height: 32 }}>
                        {["cloud", "local", "both"].map((t) => <option key={t} value={t} style={optStyle}>{t}</option>)}
                      </select>
                    )}
                  </div>
                  <button onClick={submitForm} disabled={creating} className="rs-btn flex items-center gap-2 rounded-xl px-5" style={{ height: 40, background: GOLD, color: "#0A1120", fontSize: 13, fontWeight: 800, opacity: creating ? 0.6 : 1 }}>
                    {creating ? <Loader2 size={15} className="rs-spin" /> : <Plus size={15} />} Create broadcast
                  </button>
                </div>
              </Panel>
            </div>

            {/* ══════════ RIGHT — engagement + system ══════════ */}
            <div className="flex flex-col gap-5" style={{ minWidth: 0 }}>
              {/* Comments & reactions (comments REAL; reactions decorative) */}
              <Panel>
                <SectionHead icon={Heart} title="Comments & reactions" hint={live ? "Live" : selected ? `${comments.length}` : "—"} />
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <ReactChip icon={Heart} color="#FB7185" value={reactions.heart} label="Hearts" />
                  <ReactChip icon={() => <span style={{ fontSize: 15 }}>🙏</span>} color={GOLD} value={reactions.amen} label="Amens" />
                  <ReactChip icon={Flame} color="#FB923C" value={reactions.fire} label="Fire" />
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <input className="rs-in" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") postComment(); }} placeholder="Say something to listeners…" style={{ flex: 1, minWidth: 0, height: 38, background: "rgba(255,255,255,0.05)", border: `1px solid ${PANEL_BORDER}`, color: TEXT, fontSize: 12.5, outline: "none", borderRadius: 12, padding: "0 12px" }} />
                  <button onClick={postComment} className="rs-btn flex items-center justify-center rounded-xl shrink-0" style={{ width: 42, height: 38, background: GOLD, color: "#0A1120" }}><Send size={16} /></button>
                </div>
                <div className="flex flex-col gap-2" style={{ maxHeight: 300, overflowY: "auto" }}>
                  {localSay.map((c) => (
                    <div key={c.id} className="rounded-xl px-3 py-2" style={{ background: "rgba(230,198,110,0.08)", border: `1px solid ${GOLD}33` }}>
                      <div className="flex items-center justify-between">
                        <span style={{ fontSize: 12, fontWeight: 700, color: GOLD }}>You (Host)</span>
                        <span style={{ fontSize: 13 }}>🎙</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: DIM, marginTop: 2, lineHeight: 1.45 }}>{c.text}</div>
                    </div>
                  ))}
                  {comments.length === 0 && localSay.length === 0 && (
                    <div style={{ fontSize: 11.5, color: DIMMER, padding: "8px 0", textAlign: "center" }}>No listener comments yet.</div>
                  )}
                  {comments.map((c) => (
                    <div key={c.id} className="rounded-xl px-3 py-2" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${PANEL_BORDER}`, opacity: c.hidden ? 0.5 : 1 }}>
                      <div className="flex items-center justify-between">
                        <span style={{ fontSize: 12, fontWeight: 700 }}>{authorLabel(c)}</span>
                        <button onClick={() => hideComment(c.id)} title={c.hidden ? "Hidden" : "Hide comment"} className="rs-btn flex items-center justify-center rounded-md shrink-0" style={{ width: 24, height: 24, background: "rgba(255,255,255,0.05)", color: c.hidden ? DIMMER : DIM }}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <div style={{ fontSize: 11.5, color: c.hidden ? DIMMER : DIM, margin: "2px 0 0", lineHeight: 1.45, textDecoration: c.hidden ? "line-through" : "none" }}>{c.body}</div>
                    </div>
                  ))}
                </div>
              </Panel>

              {/* Stream health dashboard (REAL while live) */}
              <Panel>
                <SectionHead icon={Gauge} title="Stream health" hint={live ? healthWord(health) : "Off air"} />
                <div className="grid grid-cols-2 gap-2">
                  <Health icon={Cpu} label="CPU" value={health ? `${Math.round(health.cpu)}%` : "—"} ok={!health || health.cpu < 80} />
                  <Health icon={HardDrive} label="Memory" value={health ? `${health.memory.toFixed(1)} GB` : "—"} ok={!health || health.memory < 6} />
                  <Health icon={Signal} label="Bitrate" value={health ? `${health.bitrate} kbps` : "—"} ok />
                  <Health icon={Activity} label="Latency" value={health ? `${Math.round(health.latency)} ms` : "—"} ok={!health || health.latency < 200} />
                  <Health icon={Wifi} label="Stability" value={health ? `${Math.round(health.stability)}%` : "—"} ok={!health || health.stability > 90} />
                  <Health icon={ShieldAlert} label="Dropped" value={health ? String(health.dropped) : "—"} ok={!health || health.dropped === 0} />
                </div>
                {!live && <div style={{ fontSize: 11, color: DIMMER, marginTop: 10, textAlign: "center" }}>Health metrics stream from the encoder once you go live.</div>}
              </Panel>

              {/* Device manager (local) */}
              <Panel>
                <SectionHead icon={Smartphone} title="Devices" hint="Broadcast from anywhere" />
                <div className="flex flex-col gap-2 mb-3">
                  {[
                    { name: "iPhone 16 Pro", icon: Smartphone, status: "Connected", batt: 82 },
                    { name: "MacBook Pro", icon: Laptop, status: "Connected", batt: 100 },
                    { name: "Samsung Tablet", icon: Tablet, status: "Standby", batt: 47 },
                  ].map((d) => {
                    const Icon = d.icon;
                    const on = d.status === "Connected";
                    return (
                      <div key={d.name} className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${PANEL_BORDER}` }}>
                        <span className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 32, height: 32, background: "rgba(255,255,255,0.06)", color: on ? GREEN : DIM }}><Icon size={15} /></span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="truncate" style={{ fontSize: 12.5, fontWeight: 600 }}>{d.name}</div>
                          <div style={{ fontSize: 10.5, color: on ? GREEN : DIMMER }}>{d.status} · {d.batt}% battery</div>
                        </div>
                        <span className="rounded-full" style={{ width: 8, height: 8, background: on ? GREEN : DIMMER }} />
                      </div>
                    );
                  })}
                </div>
                <button onClick={() => setConnectOpen(true)} className="rs-btn w-full flex items-center justify-center gap-2 rounded-xl py-2.5" style={{ background: "rgba(230,198,110,0.12)", color: GOLD, border: `1px solid ${GOLD}44`, fontSize: 12.5, fontWeight: 700 }}>
                  <QrCode size={15} /> Connect a device
                </button>
              </Panel>

              {/* Emergency controls (local) */}
              <Panel style={{ borderColor: `${RED}33` }}>
                <SectionHead icon={ShieldAlert} title="Emergency controls" />
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Backup stream", icon: Signal },
                    { label: "Reconnect audio", icon: RefreshCw },
                    { label: "Restart broadcast", icon: RadioIcon },
                    { label: "Notify listeners", icon: Bell },
                  ].map((b) => {
                    const Icon = b.icon;
                    return (
                      <button key={b.label} className="rs-btn flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: "rgba(239,68,68,0.08)", border: `1px solid ${RED}33`, color: "#FCA5A5", fontSize: 11.5, fontWeight: 600 }}>
                        <Icon size={14} /> {b.label}
                      </button>
                    );
                  })}
                </div>
              </Panel>
            </div>
          </div>
        )}
      </div>

      {/* ── Go-live confirm modal ── */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgba(5,9,17,0.7)", backdropFilter: "blur(4px)" }} onClick={() => setConfirmOpen(false)}>
          <div className="rounded-2xl text-center" style={{ background: PANEL, border: `1px solid ${PANEL_BORDER}`, padding: "30px 32px", width: "min(380px, calc(100vw - 32px))", boxShadow: "0 30px 80px rgba(0,0,0,0.6)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto flex items-center justify-center rounded-full mb-4" style={{ width: 60, height: 60, background: "rgba(239,68,68,0.14)", color: RED }}><RadioIcon size={28} /></div>
            <div style={{ fontFamily: SERIF, fontSize: 22 }}>Are you ready to go live?</div>
            <div style={{ fontSize: 12.5, color: DIM, marginTop: 8, lineHeight: 1.55 }}>Your broadcast will start immediately and listeners will be notified.</div>
            <div className="flex gap-2 mt-6">
              <button onClick={() => setConfirmOpen(false)} className="rs-btn flex-1 rounded-xl py-3" style={{ background: "rgba(255,255,255,0.06)", color: TEXT, fontSize: 13, fontWeight: 600 }}>Not yet</button>
              <button onClick={beginCountdown} className="rs-btn flex-1 rounded-xl py-3" style={{ background: `linear-gradient(135deg, ${RED}, #B91C1C)`, color: "#fff", fontSize: 13, fontWeight: 800 }}>Go live</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Countdown overlay ── */}
      {phase === "countdown" && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center" style={{ background: "rgba(5,9,17,0.88)", backdropFilter: "blur(6px)" }}>
          <div style={{ fontSize: 11, color: GOLD, letterSpacing: "0.3em", textTransform: "uppercase", fontWeight: 800, marginBottom: 12 }}>Going live in</div>
          <div key={count} className="rs-count" style={{ fontFamily: SERIF, fontSize: 140, lineHeight: 1, color: count === 0 ? RED : "#fff" }}>
            {count === 0 ? "LIVE" : count}
          </div>
        </div>
      )}

      {/* ── Connect device modal ── */}
      {connectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgba(5,9,17,0.7)", backdropFilter: "blur(4px)" }} onClick={() => setConnectOpen(false)}>
          <div className="rounded-2xl" style={{ background: PANEL, border: `1px solid ${PANEL_BORDER}`, padding: 28, width: "min(400px, calc(100vw - 32px))", boxShadow: "0 30px 80px rgba(0,0,0,0.6)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div style={{ fontFamily: SERIF, fontSize: 20 }}>Connect a device</div>
              <button onClick={() => setConnectOpen(false)} className="rounded-lg p-1.5" style={{ background: "rgba(255,255,255,0.06)", color: DIM }}><X size={16} /></button>
            </div>
            <div className="mx-auto flex items-center justify-center rounded-2xl mb-4" style={{ width: 150, height: 150, background: "#fff", color: "#0A1120" }}><QrCode size={112} /></div>
            <div className="text-center" style={{ fontSize: 12.5, color: DIM, marginBottom: 10 }}>Scan the QR code, or enter this code in the Pathway app:</div>
            <div className="flex items-center justify-center gap-2 mb-4">
              {["4", "8", "2", "9", "1", "7"].map((d, i) => (
                <span key={i} className="rounded-lg flex items-center justify-center" style={{ width: 38, height: 46, background: "rgba(255,255,255,0.06)", border: `1px solid ${PANEL_BORDER}`, fontFamily: MONO, fontSize: 22, fontWeight: 700, color: GOLD }}>{d}</span>
              ))}
            </div>
            <div className="flex items-center justify-center gap-4" style={{ fontSize: 12, color: DIM }}>
              <span className="inline-flex items-center gap-1.5"><Smartphone size={14} /> Phone</span>
              <span className="inline-flex items-center gap-1.5"><Laptop size={14} /> Computer</span>
              <span className="inline-flex items-center gap-1.5"><Tablet size={14} /> Tablet</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // hide a listener comment (moderation)
  function hideComment(id: string): void {
    RadioApi.hideComment(id)
      .then(() => setComments((cs) => cs.map((c) => (c.id === id ? { ...c, hidden: true } : c))))
      .catch(() => setActionErr("Could not hide the comment."));
  }
}

/* ── helpers ── */
function statusLabel(s: RadioProgram["status"]): string {
  return s === "live" ? "Live" : s === "scheduled" ? "Scheduled" : s === "ended" ? "Ended" : "Draft";
}
function healthWord(h: StreamHealth | null): string {
  if (!h) return "—";
  if (h.stability > 95 && h.dropped === 0) return "Excellent";
  if (h.stability > 85) return "Good";
  return "Fair";
}

const inputStyle: React.CSSProperties = {
  width: "100%", height: 38, background: "rgba(255,255,255,0.05)", border: `1px solid ${PANEL_BORDER}`,
  color: TEXT, fontSize: 12.5, outline: "none", borderRadius: 10, padding: "0 12px",
};
const optStyle: React.CSSProperties = { background: "#131E33", color: TEXT };

/* ── building blocks ── */
function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }): ReactElement {
  return (
    <div className="rs-panel rounded-2xl" style={{ background: PANEL, border: `1px solid ${PANEL_BORDER}`, padding: 18, boxShadow: "0 18px 40px -28px rgba(0,0,0,0.8)", ...style }}>
      {children}
    </div>
  );
}

function SectionHead({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }): ReactElement {
  return (
    <div className="flex items-center justify-between mb-3.5">
      <div className="flex items-center gap-2">
        <Icon size={15} style={{ color: GOLD }} />
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.01em" }}>{title}</span>
      </div>
      {hint && <span style={{ fontSize: 11, color: DIM }}>{hint}</span>}
    </div>
  );
}

function Metric({ label, value, sub, mono, valueColor, dot }: { label: string; value: string; sub?: string; mono?: boolean; valueColor?: string; dot?: string }): ReactElement {
  return (
    <div>
      <div className="flex items-center gap-1.5" style={{ marginBottom: 4 }}>
        {dot && <span className="rs-live-dot rounded-full" style={{ width: 7, height: 7, background: dot }} />}
        <span style={{ fontSize: 10, color: DIM, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>{label}</span>
      </div>
      <div className="rs-tnum" style={{ fontFamily: mono ? MONO : SERIF, fontSize: 22, color: valueColor ?? TEXT, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: DIMMER, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Meter({ label, level }: { label: string; level: number }): ReactElement {
  const segs = 22;
  const lit = Math.round(level * segs);
  return (
    <div className="flex flex-col items-center gap-2" style={{ height: "100%" }}>
      <div className="flex flex-col-reverse gap-[3px]" style={{ flex: 1 }}>
        {Array.from({ length: segs }).map((_, i) => {
          const on = i < lit;
          const color = i > segs * 0.85 ? RED : i > segs * 0.62 ? GOLD : GREEN;
          return <span key={i} style={{ width: 18, height: 6, borderRadius: 2, background: on ? color : "rgba(255,255,255,0.07)", boxShadow: on ? `0 0 6px ${color}88` : "none", transition: "background .1s" }} />;
        })}
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: DIM }}>{label}</span>
    </div>
  );
}

function Toggle({ active, onClick, icon: Icon, label, danger }: { active: boolean; onClick: () => void; icon: LucideIcon; label: string; danger?: boolean }): ReactElement {
  const on = active;
  const col = danger ? RED : GOLD;
  return (
    <button onClick={onClick} className="rs-btn flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: on ? (danger ? "rgba(239,68,68,0.16)" : "rgba(230,198,110,0.14)") : "rgba(255,255,255,0.04)", border: `1px solid ${on ? col + "66" : PANEL_BORDER}`, color: on ? (danger ? "#FCA5A5" : GOLD) : DIM, fontSize: 11.5, fontWeight: 600 }}>
      <Icon size={14} /> {label}
    </button>
  );
}

function ReactChip({ icon: Icon, color, value, label }: { icon: LucideIcon | (() => ReactElement); color: string; value: number; label: string }): ReactElement {
  return (
    <div className="rounded-xl flex flex-col items-center py-2.5" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${PANEL_BORDER}` }}>
      <Icon size={16} style={{ color }} />
      <span className="rs-tnum" style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, marginTop: 4 }}>{value.toLocaleString()}</span>
      <span style={{ fontSize: 9.5, color: DIM, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 1 }}>{label}</span>
    </div>
  );
}

function Health({ icon: Icon, label, value, ok }: { icon: LucideIcon; label: string; value: string; ok?: boolean }): ReactElement {
  return (
    <div className="rounded-xl px-3 py-2.5 flex items-center gap-2.5" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${PANEL_BORDER}` }}>
      <Icon size={15} style={{ color: ok ? GREEN : "#FCA5A5" }} />
      <div style={{ minWidth: 0 }}>
        <div className="rs-tnum" style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700 }}>{value}</div>
        <div style={{ fontSize: 9.5, color: DIM, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      </div>
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }): ReactElement {
  return (
    <label className="flex flex-col gap-1.5" style={{ gridColumn: full ? "1 / -1" : undefined }}>
      <span style={{ fontSize: 10.5, color: DIM, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>{label}</span>
      {children}
    </label>
  );
}

function CredRow({ label, value, secret, onCopy, copied }: { label: string; value: string; secret?: boolean; onCopy?: (() => void) | undefined; copied?: boolean }): ReactElement {
  const [reveal, setReveal] = useState(!secret);
  const shown = reveal ? value : value === "—" ? "—" : "•".repeat(Math.min(28, value.length));
  return (
    <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${PANEL_BORDER}` }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 9.5, color: DIM, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>{label}</div>
        <div className="truncate" style={{ fontFamily: MONO, fontSize: 12, color: TEXT, marginTop: 2 }}>{shown}</div>
      </div>
      {secret && value !== "—" && (
        <button onClick={() => setReveal((v) => !v)} className="rs-btn shrink-0" style={{ fontSize: 10.5, fontWeight: 700, color: GOLD, background: "none", border: "none", cursor: "pointer" }}>{reveal ? "Hide" : "Show"}</button>
      )}
      {onCopy && (
        <button onClick={onCopy} title="Copy" className="rs-btn flex items-center justify-center rounded-lg shrink-0" style={{ width: 30, height: 30, background: "rgba(255,255,255,0.05)", color: copied ? GREEN : DIM }}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      )}
    </div>
  );
}

function StateCard({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body: string; action?: React.ReactNode }): ReactElement {
  return (
    <Panel style={{ textAlign: "center", padding: 32 }}>
      <span className="mx-auto flex items-center justify-center rounded-2xl" style={{ width: 56, height: 56, background: "rgba(239,68,68,0.12)", color: "#FCA5A5" }}><Icon size={26} /></span>
      <div style={{ fontFamily: SERIF, fontSize: 22, marginTop: 14 }}>{title}</div>
      <div style={{ fontSize: 13, color: DIM, marginTop: 8, maxWidth: 460, marginLeft: "auto", marginRight: "auto", lineHeight: 1.55 }}>{body}</div>
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </Panel>
  );
}

function GoldButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }): ReactElement {
  return (
    <button onClick={onClick} className="rs-btn rounded-xl px-5 py-2.5" style={{ background: GOLD, color: "#0A1120", fontSize: 13, fontWeight: 800 }}>{children}</button>
  );
}

export default RadioStudio;
