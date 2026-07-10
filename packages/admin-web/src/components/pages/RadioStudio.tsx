// Radio Broadcast Studio (/radio) — the admin "Live Broadcast Studio", an exact
// visual match of the Figma make (ZMEsnrOJCXXY7rHfTBautI) with the make's fake
// state replaced by the real backend wiring. Intentionally a DARK studio theme,
// distinct from the light portal. Wire contract: docs/RADIO_STUDIO_CONTRACT.md.
//
// REAL (API-backed, server-authoritative): program list + create + edit + select,
// the broadcast lifecycle (go-live → status=live, end → status=ended), stream
// health polling while live, ingest URL + stream key (copy + rotate), listener
// comments (+ hide moderation) with real author names/avatars, aggregate reaction
// totals (heart/amen/fire across ALL members — polled with the comments cadence,
// admin taps POST /react and take the server's totals), the audio library
// (tracks CRUD + upload), session
// playlists (add/remove/reorder/loop via PATCH), scheduled playout (PATCH
// scheduled_at/repeat), and the quick broadcast settings (PATCH visibility /
// record_broadcast). ALSO REAL (browser hardware ⇄ server): the Listen panel
// (live mount playback — broadcast / on-air monitor / cue, derived from
// hls_url), the audio-source device picker + level meters (getUserMedia → Web
// Audio), and GO ON MIC (MediaRecorder → /v1/admin/radio/mic-bridge WebSocket
// → the on-air harbor). LOCAL (client-only UI): waveform decoration, device
// manager, emergency buttons, playlist live preview (with Media Session
// lock-screen metadata/controls so audio survives screen-lock).
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import {
  Activity, ArrowDown, ArrowUp, Bell, CalendarClock, Check, ChevronDown, Copy, Cpu, Disc3, Gauge,
  HardDrive, Headphones, Heart, ImagePlus, KeyRound, Laptop, ListMusic, Loader2, Mic, MicOff,
  Music, Pause, Pencil, Play, Plus, QrCode, RefreshCw, Radio as RadioIcon, Repeat, Repeat1,
  Send, ShieldAlert, Signal, SlidersHorizontal, Smartphone, Square, Tablet, Trash2, Upload,
  Volume2, Wifi, X, type LucideIcon,
} from "lucide-react";
import { AxiosError } from "axios";
import {
  RadioApi,
  OpsApi,
  uploadToCloudinary,
  getAccessToken,
  type RadioProgram,
  type RadioComment,
  type RadioReactionCounts,
  type RadioListener,
  type StreamHealth,
  type CreateRadioProgramBody,
  type UpdateRadioProgramBody,
  type RadioTrack,
  type RadioTrackKind,
  type RadioPlaylistItem,
  type RadioLoopMode,
  type CreateRadioTrackBody,
  type RadioScheduleConflict,
} from "../../api/client";

/* ── studio palette (Figma make) ── */
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

/* ── audio upload constraints (mirror the server: 70 MB, MP3/WAV/AAC/ALAC) ── */
const AUDIO_ACCEPT = ".mp3,.wav,.m4a,.aac,audio/mpeg,audio/wav,audio/mp4,audio/aac";
function validAudio(file: File): string | null {
  if (file.size > 250 * 1024 * 1024) return `${file.name} is over the 250 MB limit`;
  if (!/\.(mp3|wav|m4a|aac|alac)$/i.test(file.name)) return "Only MP3, WAV, AAC or ALAC (.m4a) audio is allowed";
  return null;
}

type Phase = "idle" | "countdown" | "live" | "paused";

const CATEGORIES = ["Sermon", "Worship", "Prayer", "Bible Study", "Conference"] as const;
type Category = (typeof CATEGORIES)[number];

/* Track-kind chrome exactly as the make: MUSIC green, PREACHING gold, AUDIO blue. */
const KIND_META: Record<RadioTrackKind, { label: string; color: string }> = {
  music: { label: "Music", color: "#7BE3A3" },
  preaching: { label: "Preaching", color: "#E6C66E" },
  audio: { label: "Audio", color: "#7FB5FF" },
};
const TRACK_KINDS = ["music", "preaching", "audio"] as const;

const LOOP_MODES: RadioLoopMode[] = ["none", "loop_all", "repeat_one"];
const LOOP_LABEL: Record<RadioLoopMode, string> = { none: "Loop", loop_all: "Loop all", repeat_one: "Repeat one" };

const REPEAT_OPTIONS = ["none", "daily", "weekdays", "weekly"] as const;
const REPEAT_LABEL: Record<string, string> = { none: "Once", daily: "Daily", weekdays: "Weekdays", weekly: "Weekly" };

/* Client-side roster/devices — decorative studio chrome from the make. */
// Two-letter initials for a listener's avatar fallback (no photo).
function listenerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return "?";
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? first;
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}
const SEED_DEVICES = [
  { name: "iPhone 16 Pro", icon: Smartphone, status: "Connected", batt: 82 },
  { name: "MacBook Pro", icon: Laptop, status: "Connected", batt: 100 },
  { name: "Samsung Tablet", icon: Tablet, status: "Standby", batt: 47 },
] as const;

/* ── formatting helpers ── */
function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600).toString().padStart(2, "0");
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

// Short human label for a scheduled_at ISO string (falls back gracefully).
function fmtSchedule(iso: string | null | undefined): string {
  if (!iso) return "Not scheduled";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Not scheduled";
  return d.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

// HH:MM chip for the scheduled-playout list.
function fmtTimeChip(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// mm:ss (or h:mm:ss) label for an audio duration in seconds.
function fmtClock(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return null;
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = (s % 60).toString().padStart(2, "0");
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

// Human-readable byte size ("31.2 MB").
function fmtBytes(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null;
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) { n /= 1024; u++; }
  return `${n >= 100 || u === 0 ? Math.round(n) : n.toFixed(1)} ${units[u]}`;
}

// ISO → value for <input type="datetime-local"> in the user's local time.
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// "18:00" → next occurrence of that wall-clock time as an ISO instant.
function nextOccurrenceIso(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

// Filename without its extension → default track title.
function baseName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

// Best-effort filename from a stored audio URL (edit-mode prefill).
function urlFileName(url: string): string {
  try {
    const path = new URL(url, window.location.origin).pathname;
    const last = path.split("/").pop() ?? "";
    return decodeURIComponent(last) || "Attached audio";
  } catch {
    return "Attached audio";
  }
}

// Fuzzy-match the encoder's icy now-playing metadata ("Artist — Title" or bare
// title) against a library track: case-insensitive containment either way on
// the track title, with the audio_url basename (extension stripped) as a
// fallback key. No match → no highlight; we never guess.
function trackMatchesNowPlaying(nowPlaying: string, track: RadioTrack): boolean {
  const np = nowPlaying.trim().toLowerCase();
  if (!np) return false;
  const title = track.title.trim().toLowerCase();
  if (title && (np.includes(title) || title.includes(np))) return true;
  const file = urlFileName(track.audio_url);
  if (file === "Attached audio") return false; // urlFileName's failure fallback
  const base = baseName(file).trim().toLowerCase();
  return base.length > 0 && (np.includes(base) || base.includes(np));
}

// Recording target label ("saving to Cloud + Local").
function fmtTarget(target: RadioProgram["record_target"]): string {
  if (target === "both") return "Cloud + Local";
  if (target === "local") return "Local";
  return "Cloud";
}

// A comment's real author name (users LEFT JOIN server-side) — the bare
// "Listener" fallback only when the member is gone/null.
function authorLabel(c: RadioComment): string {
  return c.author_name ?? "Listener";
}

function statusLabel(s: RadioProgram["status"]): string {
  return s === "live" ? "Live" : s === "scheduled" ? "Scheduled" : s === "ended" ? "Ended" : "Draft";
}
function healthWord(h: StreamHealth | null): string {
  if (!h) return "—";
  if (h.stability > 95 && h.dropped === 0) return "Excellent";
  if (h.stability > 85) return "Good";
  return "Fair";
}

// Server error envelope ({error:{code,message}}) → human message, else fallback.
// Used so a go-live 409 CONFLICT surfaces the server's message (it names the
// session that is currently live) instead of a generic failure line.
function apiErrMessage(e: unknown, fallback: string): string {
  if (e instanceof AxiosError) {
    const data = e.response?.data as { error?: { message?: string } } | undefined;
    const msg = data?.error?.message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return fallback;
}

// Read an audio file's duration client-side (best-effort) for upload hints.
function probeAudioDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const el = document.createElement("audio");
      el.preload = "metadata";
      el.onloadedmetadata = () => {
        const d = Number.isFinite(el.duration) ? Math.round(el.duration) : undefined;
        URL.revokeObjectURL(url);
        resolve(d && d > 0 ? d : undefined);
      };
      el.onerror = () => { URL.revokeObjectURL(url); resolve(undefined); };
      el.src = url;
    } catch { resolve(undefined); }
  });
}

// ── Media Session (lock-screen / media-key) integration ──
// Registers now-playing metadata + transport handlers so browser audio keeps
// playing when the screen locks on iPad/mobile Safari and can be controlled
// from the lock screen / media keys. No-op where the API is unsupported.
// Note: nothing in this page listens to `visibilitychange` — audio must keep
// playing when the tab is backgrounded or the screen locks.
function setMediaSession(
  audio: HTMLAudioElement,
  title: string,
  artist: string,
  artworkUrl?: string | null,
  skip?: { next?: () => void; prev?: () => void },
): void {
  if (!("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  try {
    ms.metadata = new MediaMetadata({
      title,
      artist,
      album: "Nuru Radio",
      artwork: artworkUrl ? [{ src: artworkUrl, sizes: "512x512" }] : [],
    });
    ms.setActionHandler("play", () => { void audio.play().catch(() => {}); });
    ms.setActionHandler("pause", () => { audio.pause(); });
    ms.setActionHandler("nexttrack", skip?.next ?? null);
    ms.setActionHandler("previoustrack", skip?.prev ?? null);
    ms.playbackState = "playing";
  } catch {
    // Some browsers throw on unrecognized actions — metadata is best-effort.
  }
}

// Mirror the element's play/pause state onto the lock-screen controls.
function setMediaPlaybackState(state: "none" | "paused" | "playing"): void {
  if (!("mediaSession" in navigator)) return;
  try { navigator.mediaSession.playbackState = state; } catch { /* best-effort */ }
}

// Drop metadata + handlers when playback fully stops (preview stopped).
function clearMediaSession(): void {
  if (!("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  try {
    ms.metadata = null;
    ms.playbackState = "none";
    ms.setActionHandler("play", null);
    ms.setActionHandler("pause", null);
    ms.setActionHandler("nexttrack", null);
    ms.setActionHandler("previoustrack", null);
  } catch { /* best-effort */ }
}

const VIS_LABELS = { public: "Public", members: "Members Only", private: "Private" } as const;
type VisKey = keyof typeof VIS_LABELS;
/* Figma pill order: Public · Private · Members Only. */
const VIS_ORDER: VisKey[] = ["public", "private", "members"];

const hiddenInput: React.CSSProperties = {
  position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
  overflow: "hidden", clip: "rect(0 0 0 0)", border: 0,
};

type BroadcastFormState = {
  title: string; description: string; category: Category; speaker: string;
  location: string; tags: string; artwork_url: string; visibility: VisKey;
  scheduled_at: string; duration_min: string; repeat: string; timezone: string;
  audio_url: string; audio_duration_sec: number | null; auto_go_live: boolean;
  audio_filename: string; record_broadcast: boolean; record_target: "cloud" | "local" | "both";
};
function blankForm(): BroadcastFormState {
  return {
    title: "", description: "", category: "Sermon", speaker: "", location: "",
    tags: "", artwork_url: "", visibility: "public", scheduled_at: "",
    duration_min: "", repeat: "none", timezone: "Africa/Nairobi",
    audio_url: "", audio_duration_sec: null, auto_go_live: true, audio_filename: "",
    record_broadcast: true, record_target: "both",
  };
}

export function RadioStudio(): ReactElement {
  // ── server state ──
  const [programs, setPrograms] = useState<RadioProgram[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [health, setHealth] = useState<StreamHealth | null>(null);
  const [comments, setComments] = useState<RadioComment[]>([]);
  // Real live listener roster + count (server presence; polled while selected).
  const [listeners, setListeners] = useState<RadioListener[]>([]);
  const [listenerRosterCount, setListenerRosterCount] = useState<number>(0);
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const [credsOpen, setCredsOpen] = useState(false); // ingest/stream-key disclosure — collapsed on mount (secrets panel)
  const [copied, setCopied] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ── broadcast phase (drives the go-live UX; mirrors program.is_live) ──
  const [phase, setPhase] = useState<Phase>("idle");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);

  // ── local UI state (mic/meters hardware is REAL — see useMicEngine below) ──
  const [connectOpen, setConnectOpen] = useState(false);
  const [killArmed, setKillArmed] = useState(false);
  // TRUE aggregate reaction totals across ALL members (server-authoritative;
  // GET /admin/radio/programs/:id/reactions, polled with the comments cadence).
  const [reactions, setReactions] = useState<RadioReactionCounts>({ heart: 0, amen: 0, fire: 0 });
  const [draft, setDraft] = useState("");
  const [previewTitle, setPreviewTitle] = useState<string | null>(null);

  // ── broadcast form (creates a real program; edit mode PATCHes it) ──
  const [form, setForm] = useState<BroadcastFormState>(blankForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [uploadingArtwork, setUploadingArtwork] = useState(false);
  const [artworkErr, setArtworkErr] = useState<string | null>(null);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [audioErr, setAudioErr] = useState<string | null>(null);
  // Schedule-overlap advisory for the slot in the form (never blocks saving).
  const [conflicts, setConflicts] = useState<RadioScheduleConflict[]>([]);
  const conflictSeq = useRef(0);
  const formRef = useRef<HTMLDivElement>(null);
  // Attach audio / artwork to an already-created (selected) program.
  const [attachingAudio, setAttachingAudio] = useState(false);
  const [attachErr, setAttachErr] = useState<string | null>(null);
  const [cardArtBusy, setCardArtBusy] = useState(false);

  // ── scheduled playout form (PATCHes scheduled_at/repeat on a program) ──
  const [schSession, setSchSession] = useState("");
  const [schTime, setSchTime] = useState("18:00");
  const [schRepeat, setSchRepeat] = useState("none");
  const [scheduling, setScheduling] = useState(false);

  const selected = programs?.find((p) => p.id === selectedId) ?? null;
  const live = phase === "live";

  // REAL mic engine — device picker, capture graph, meters, mic-bridge WS.
  // The bridge's harbor exists only while a session is live on the frequency.
  const anyLive = programs?.some((p) => p.is_live) ?? false;
  const mic = useMicEngine(anyLive);

  // waveform (client-simulated decoration; the L/R meters are REAL — useMicEngine)
  const [bars, setBars] = useState<number[]>(() => Array.from({ length: 56 }, () => 0.08));

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

  // Silent refresh (no loading flash) — used when the Sessions panel mutates programs.
  const refresh = useCallback(() => {
    RadioApi.programs()
      .then((list) => {
        setPrograms(list);
        setSelectedId((cur) => {
          if (cur && list.some((p) => p.id === cur)) return cur;
          return list.find((p) => p.is_live)?.id ?? list[0]?.id ?? null;
        });
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    const h = (): void => refresh();
    window.addEventListener("rs:programs-changed", h);
    return () => window.removeEventListener("rs:programs-changed", h);
  }, [refresh]);

  // ── auto-air freshness: every 30s (matching the worker's tick) nudge every
  // panel to silently re-fetch the program list, so a session the worker flips
  // live — or defers past an overlap — shows up without a manual reload. The
  // event fans out to this component's refresh() plus the Sessions/library
  // panels; it only refreshes list/selected DISPLAY state, never form state.
  useEffect(() => {
    const t = setInterval(() => window.dispatchEvent(new CustomEvent("rs:programs-changed")), 30_000);
    return () => clearInterval(t);
  }, []);

  // ── schedule-overlap check (advisory) — whenever the form's scheduled_at is
  // set/changed (or duration changes while scheduled), debounce ~500ms then ask
  // the server for overlapping sessions. exclude_id = the session being edited.
  // A sequence counter drops stale responses so rapid edits can't race.
  useEffect(() => {
    const seq = ++conflictSeq.current;
    if (!form.scheduled_at) { setConflicts([]); return; }
    const at = new Date(form.scheduled_at);
    if (Number.isNaN(at.getTime())) { setConflicts([]); return; }
    const dur = Number(form.duration_min);
    const durationMin = form.duration_min && Number.isFinite(dur) && dur > 0 ? dur : null;
    const excludeId = editingId ?? undefined;
    const t = setTimeout(() => {
      RadioApi.scheduleConflicts(at.toISOString(), durationMin, excludeId)
        .then((res) => { if (conflictSeq.current === seq) setConflicts(res.conflicts); })
        .catch(() => { if (conflictSeq.current === seq) setConflicts([]); });
    }, 500);
    return () => clearTimeout(t);
  }, [form.scheduled_at, form.duration_min, editingId]);

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

  // ── load comments + true reaction totals for the selected program ──
  useEffect(() => {
    if (!selectedId) { setComments([]); setReactions({ heart: 0, amen: 0, fire: 0 }); return; }
    let alive = true;
    RadioApi.comments(selectedId)
      .then((c) => { if (alive) setComments(c); })
      .catch(() => { if (alive) setComments([]); });
    RadioApi.reactions(selectedId)
      .then((r) => { if (alive) setReactions(r); })
      .catch(() => { if (alive) setReactions({ heart: 0, amen: 0, fire: 0 }); });
    return () => { alive = false; };
  }, [selectedId]);

  // ── health polling while live (every 3.5s; stop on 409/end) ──
  useEffect(() => {
    if (phase !== "live" || !selectedId) { setHealth(null); return; }
    let alive = true;
    const poll = (): void => {
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

  // ── refresh comments + reaction totals periodically while live ──
  useEffect(() => {
    if (phase !== "live" || !selectedId) return;
    const t = setInterval(() => {
      RadioApi.comments(selectedId).then(setComments).catch(() => {});
      RadioApi.reactions(selectedId).then(setReactions).catch(() => {});
    }, 6000);
    return () => clearInterval(t);
  }, [phase, selectedId]);

  // ── real listener roster + count (poll every 15s while a program is selected) ──
  // These are the actual members whose player heartbeated within the last 45s.
  useEffect(() => {
    if (!selectedId) { setListeners([]); setListenerRosterCount(0); return; }
    let alive = true;
    const poll = (): void => {
      RadioApi.listeners(selectedId)
        .then((r) => { if (alive) { setListeners(r.listeners); setListenerRosterCount(r.count); } })
        .catch(() => { if (alive) { setListeners([]); setListenerRosterCount(0); } });
    };
    poll();
    const t = setInterval(poll, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [selectedId]);

  // ── live timer (from live_started_at when available) ──
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // ── animated waveform (decorative; reacts to the real mute/boost) ──
  useEffect(() => {
    const active = phase === "live" && !mic.muted;
    const int = setInterval(() => {
      setBars((prev) => prev.map((_, i) => {
        if (!active) return 0.05 + Math.random() * 0.04;
        const center = 1 - Math.abs(i - prev.length / 2) / (prev.length / 2);
        return Math.min(1, 0.12 + Math.random() * 0.9 * (0.4 + center * 0.6) * (mic.gainPct / 100 + 0.4));
      }));
    }, 110);
    return () => clearInterval(int);
  }, [phase, mic.muted, mic.gainPct]);

  // ── disarm the emergency-kill confirm once the broadcast is no longer live ──
  useEffect(() => {
    if (phase === "idle" || phase === "countdown") setKillArmed(false);
  }, [phase]);

  // ── the admin's own reaction — POST /radio/programs/:id/react (idempotent per
  // client_event_id) and adopt the server's fresh totals; never a local +1.
  const sendReaction = useCallback((kind: keyof RadioReactionCounts): void => {
    if (!selectedId) return;
    RadioApi.react(selectedId, kind).then(setReactions).catch(() => {});
  }, [selectedId]);

  // ── go-live countdown → real go-live call ──
  const beginCountdown = (): void => { setConfirmOpen(false); setPhase("countdown"); setCount(3); };

  const goLiveNow = useCallback(async () => {
    if (!selectedId) { setPhase("idle"); return; }
    setBusy(true);
    setActionErr(null);
    try {
      const updated = await RadioApi.goLive(selectedId);
      setPrograms((ps) => (ps ? ps.map((p) => (p.id === updated.id ? updated : p)) : ps));
      setPhase("live");
      setElapsed(0);
      window.dispatchEvent(new CustomEvent("rs:programs-changed"));
    } catch (e: unknown) {
      // 409 CONFLICT = another session is live — the server message names it.
      setActionErr(apiErrMessage(e, "Could not go live. Please try again."));
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
      window.dispatchEvent(new CustomEvent("rs:programs-changed"));
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

  // Quick PATCH on the selected program (visibility pills, record toggle, artwork).
  const quickPatch = useCallback(async (body: UpdateRadioProgramBody) => {
    if (!selectedId) return;
    setActionErr(null);
    try {
      const updated = await RadioApi.updateProgram(selectedId, body);
      setPrograms((ps) => (ps ? ps.map((p) => (p.id === updated.id ? updated : p)) : ps));
    } catch {
      setActionErr("Could not update the broadcast settings.");
    }
  }, [selectedId]);

  // ── broadcast form: shared body builder + create/save ──
  const buildBody = useCallback((): CreateRadioProgramBody => {
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
    if (form.audio_url.trim()) body.audio_url = form.audio_url.trim();
    if (form.audio_duration_sec != null) body.audio_duration_sec = form.audio_duration_sec;
    body.auto_go_live = form.auto_go_live;
    return body;
  }, [form]);

  const submitForm = useCallback(async () => {
    if (!form.title.trim()) { setFormErr("A title is required."); return; }
    setCreating(true);
    setFormErr(null);
    const body = buildBody();
    try {
      if (editingId) {
        const updated = await RadioApi.updateProgram(editingId, body);
        setPrograms((ps) => (ps ? ps.map((p) => (p.id === updated.id ? updated : p)) : ps));
        setEditingId(null);
      } else {
        const created = await RadioApi.createProgram(body);
        setPrograms((ps) => [created, ...(ps ?? [])]);
        setSelectedId(created.id);
      }
      setForm(blankForm());
      // Keep the Sessions/library panels in sync with the new/edited program.
      window.dispatchEvent(new CustomEvent("rs:programs-changed"));
    } catch {
      setFormErr(editingId ? "Could not save the session. Please try again." : "Could not create the broadcast. Please try again.");
    } finally {
      setCreating(false);
    }
  }, [form, buildBody, editingId]);

  // Prefill the form with a session and switch it into edit mode. Also selects
  // the session so the studio panels follow — reachable from ANY session card,
  // not just the selected panel (iPad parity).
  const beginEditProgram = useCallback((p: RadioProgram) => {
    setSelectedId(p.id);
    setFormErr(null);
    setArtworkErr(null);
    setAudioErr(null);
    setEditingId(p.id);
    setForm({
      title: p.title,
      description: p.description ?? "",
      category: p.category,
      speaker: p.speaker ?? "",
      location: p.location ?? "",
      tags: p.tags.join(", "),
      artwork_url: p.artwork_url ?? "",
      visibility: p.visibility,
      scheduled_at: isoToLocalInput(p.scheduled_at),
      duration_min: p.duration_min != null ? String(p.duration_min) : "",
      repeat: p.repeat ?? "none",
      timezone: p.timezone ?? "Africa/Nairobi",
      audio_url: p.audio_url ?? "",
      audio_duration_sec: p.audio_duration_sec,
      audio_filename: p.audio_url ? urlFileName(p.audio_url) : "",
      auto_go_live: p.auto_go_live,
      record_broadcast: p.record_broadcast,
      record_target: p.record_target ?? "both",
    });
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Edit the currently selected session (kept for the selected-panel button).
  const beginEdit = useCallback(() => {
    if (selected) beginEditProgram(selected);
  }, [selected, beginEditProgram]);

  // Reset to create mode and jump to the form — the header "New session" CTA.
  const startCreate = useCallback(() => {
    setEditingId(null);
    setForm(blankForm());
    setFormErr(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setForm(blankForm());
    setFormErr(null);
  }, []);

  // Upload an artwork image (bytes go direct to Cloudinary) → fills artwork_url.
  const uploadArtwork = useCallback(async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      setArtworkErr("Image is larger than 10 MB. Please choose a smaller image.");
      return;
    }
    setUploadingArtwork(true);
    setArtworkErr(null);
    try {
      const sign = await OpsApi.signAdminImage("announcements");
      const { secure_url } = await uploadToCloudinary(sign, file);
      setForm((f) => ({ ...f, artwork_url: secure_url }));
    } catch {
      setArtworkErr("Upload failed — paste an image URL instead.");
    } finally {
      setUploadingArtwork(false);
    }
  }, []);

  // Replace the SELECTED program's artwork straight from the broadcast card.
  const uploadCardArtwork = useCallback(async (file: File) => {
    if (!selectedId || file.size > 10 * 1024 * 1024) return;
    setCardArtBusy(true);
    try {
      const sign = await OpsApi.signAdminImage("announcements");
      const { secure_url } = await uploadToCloudinary(sign, file);
      await quickPatch({ artwork_url: secure_url });
    } catch {
      setActionErr("Could not update the artwork.");
    } finally {
      setCardArtBusy(false);
    }
  }, [selectedId, quickPatch]);

  // Upload a broadcast audio recording (self-hosted disk) → fills form.audio_url.
  const uploadFormAudio = useCallback(async (file: File) => {
    const invalid = validAudio(file);
    if (invalid) {
      setAudioErr(invalid);
      return;
    }
    setUploadingAudio(true);
    setAudioErr(null);
    try {
      const durationSec = await probeAudioDuration(file);
      const res = await RadioApi.uploadAudio(file, durationSec);
      setForm((f) => ({
        ...f,
        audio_url: res.url,
        audio_duration_sec: res.duration_sec ?? durationSec ?? null,
        audio_filename: file.name,
      }));
    } catch {
      setAudioErr("Audio upload failed. Please try again.");
    } finally {
      setUploadingAudio(false);
    }
  }, []);

  // Attach audio to the already-created (selected) program → PATCH + refresh.
  const attachAudio = useCallback(async (file: File) => {
    if (!selectedId) return;
    const invalid = validAudio(file);
    if (invalid) {
      setAttachErr(invalid);
      return;
    }
    setAttachingAudio(true);
    setAttachErr(null);
    try {
      const durationSec = await probeAudioDuration(file);
      const res = await RadioApi.uploadAudio(file, durationSec);
      const body: UpdateRadioProgramBody = { audio_url: res.url };
      const d = res.duration_sec ?? durationSec;
      if (d != null) body.audio_duration_sec = d;
      const updated = await RadioApi.updateProgram(selectedId, body);
      setPrograms((ps) => (ps ? ps.map((p) => (p.id === updated.id ? updated : p)) : ps));
      // Session cards show the attach state too — keep them in sync.
      window.dispatchEvent(new CustomEvent("rs:programs-changed"));
    } catch {
      setAttachErr("Could not attach audio. Please try again.");
    } finally {
      setAttachingAudio(false);
    }
  }, [selectedId]);

  // Scheduled playout — PATCH scheduled_at/repeat on the chosen session.
  const scheduleSession = useCallback(async () => {
    if (!schSession) return;
    setScheduling(true);
    setActionErr(null);
    try {
      const updated = await RadioApi.updateProgram(schSession, {
        scheduled_at: nextOccurrenceIso(schTime),
        repeat: schRepeat,
      });
      setPrograms((ps) => (ps ? ps.map((p) => (p.id === updated.id ? updated : p)) : ps));
    } catch {
      setActionErr("Could not schedule the session.");
    } finally {
      setScheduling(false);
    }
  }, [schSession, schTime, schRepeat]);

  // Local-only host comment (not persisted — admins can't post as a member).
  const [localSay, setLocalSay] = useState<{ id: string; text: string }[]>([]);
  const postComment = (): void => {
    if (!draft.trim()) return;
    setLocalSay((c) => [{ id: `local-${Date.now()}`, text: draft.trim() }, ...c]);
    setDraft("");
  };

  const category = (selected?.category ?? "Sermon") as string;
  // Prefer the REAL active-listener count (members heartbeating right now) over
  // the Icecast/peak fallback, so the studio shows who's genuinely on air.
  const listenerCount = listenerRosterCount > 0 ? listenerRosterCount : (health?.listeners ?? selected?.peak_listeners ?? 0);
  const scheduledPrograms = (programs ?? [])
    .filter((p) => p.scheduled_at)
    .sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""));

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
        @keyframes rs-reveal { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
        .rs-live-dot { animation: rs-pulse 1.4s ease-in-out infinite; }
        .rs-count { animation: rs-pop .4s cubic-bezier(.22,1,.36,1); }
        .rs-spin { animation: rs-spin 1s linear infinite; }
        .rs-reveal { animation: rs-reveal .2s ease; }
        @media (prefers-reduced-motion: reduce) { .rs-live-dot, .rs-count, .rs-panel, .rs-spin, .rs-reveal { animation: none !important; transition: none !important; } }
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
          <button onClick={startCreate} className="rs-btn flex items-center gap-1.5 rounded-full px-3.5" style={{ height: 34, background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`, color: "#0A1120", fontSize: 12, fontWeight: 800, border: "none" }}>
            <Plus size={14} /> New session
          </button>
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
              {/* Broadcast card (program selector + selected session) */}
              <Panel>
                <SectionHead icon={RadioIcon} title="Broadcast" hint={loading ? "Loading…" : `${programs?.length ?? 0} program${(programs?.length ?? 0) === 1 ? "" : "s"}`} />
                {loading ? (
                  <div className="flex items-center gap-2" style={{ fontSize: 12.5, color: DIM, padding: "6px 0" }}>
                    <Loader2 size={14} className="rs-spin" /> Loading programs…
                  </div>
                ) : (programs?.length ?? 0) === 0 ? (
                  <div style={{ fontSize: 12.5, color: DIM, padding: "6px 0" }}>No programs yet — create one with the Broadcast information form below.</div>
                ) : (
                  <div className="flex gap-2 flex-wrap" style={{ marginBottom: selected ? 16 : 0 }}>
                    {programs?.map((p) => {
                      const sel = p.id === selectedId;
                      return (
                        <button key={p.id} onClick={() => setSelectedId(p.id)} className="rs-btn flex items-center gap-2 rounded-xl px-3 py-2 text-left" style={{ background: sel ? "rgba(230,198,110,0.12)" : "rgba(255,255,255,0.03)", border: `1px solid ${sel ? GOLD + "66" : PANEL_BORDER}`, maxWidth: 260 }}>
                          {p.is_live && <span className="rs-live-dot rounded-full shrink-0" style={{ width: 7, height: 7, background: RED }} />}
                          <span className="truncate" style={{ fontSize: 12.5, fontWeight: 600 }}>{p.title}</span>
                          <span className="shrink-0" style={{ fontSize: 10, fontWeight: 700, color: p.status === "live" ? "#FCA5A5" : p.status === "scheduled" ? GOLD : p.status === "ended" ? DIMMER : DIM }}>{statusLabel(p.status)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {selected && (
                  <div className="flex gap-4 flex-wrap" style={{ marginTop: 4 }}>
                    <div className="rounded-2xl shrink-0 flex items-center justify-center relative overflow-hidden" style={{ width: 118, height: 118, background: selected.artwork_url ? `center/cover url("${selected.artwork_url}")` : `linear-gradient(140deg, ${GOLD_DEEP}, #6E4E12)`, boxShadow: "inset 0 0 40px rgba(0,0,0,0.3)" }}>
                      {!selected.artwork_url && <RadioIcon size={40} style={{ color: "#FFF3D6" }} />}
                      <div className="absolute" style={{ inset: 0, background: "radial-gradient(circle at 30% 20%, rgba(255,255,255,0.25), transparent 55%)", pointerEvents: "none" }} />
                      {/* artwork upload straight on the card */}
                      <label className="rs-btn absolute flex items-center justify-center rounded-lg" title="Update artwork" style={{ right: 6, bottom: 6, width: 28, height: 28, background: "rgba(10,17,32,0.72)", color: GOLD, border: `1px solid ${GOLD}44`, cursor: cardArtBusy ? "default" : "pointer" }}>
                        {cardArtBusy ? <Loader2 size={13} className="rs-spin" /> : <ImagePlus size={13} />}
                        <input type="file" accept="image/*" disabled={cardArtBusy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadCardArtwork(f); }} style={hiddenInput} />
                      </label>
                    </div>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="rounded-full px-2 py-0.5" style={{ background: "rgba(230,198,110,0.16)", color: GOLD, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>{category}</span>
                        <span style={{ fontSize: 11, color: DIM }}>{VIS_LABELS[selected.visibility] ?? "Public"}</span>
                      </div>
                      <div style={{ fontFamily: SERIF, fontSize: 24, lineHeight: 1.1 }}>{selected.title}</div>
                      {selected.description && (
                        <div style={{ fontSize: 12.5, color: DIM, marginTop: 6, lineHeight: 1.55, maxWidth: 460 }}>{selected.description}</div>
                      )}
                      <div className="flex items-center gap-4 mt-3 flex-wrap" style={{ fontSize: 12, color: DIM }}>
                        {selected.speaker && <span className="inline-flex items-center gap-1.5"><Mic size={13} style={{ color: GOLD }} /> {selected.speaker}</span>}
                        {selected.location && <span className="inline-flex items-center gap-1.5"><Signal size={13} style={{ color: GOLD }} /> {selected.location}</span>}
                      </div>
                      {/* Session actions right on the broadcast card — edit + attach/replace audio */}
                      <div className="flex items-center gap-2 mt-3 flex-wrap">
                        <button onClick={beginEdit} className="rs-btn flex items-center gap-1.5 rounded-lg px-2.5" style={{ height: 28, background: "rgba(230,198,110,0.12)", color: GOLD, border: `1px solid ${GOLD}44`, fontSize: 11, fontWeight: 700 }}>
                          <Pencil size={12} /> Edit session
                        </button>
                        <label className="rs-btn flex items-center gap-1.5 rounded-lg px-2.5" style={{ height: 28, background: "rgba(230,198,110,0.12)", color: GOLD, border: `1px solid ${GOLD}44`, fontSize: 11, fontWeight: 700, cursor: attachingAudio ? "default" : "pointer", opacity: attachingAudio ? 0.6 : 1 }}>
                          {attachingAudio ? <Loader2 size={12} className="rs-spin" /> : <Music size={12} />}
                          {attachingAudio ? "Uploading…" : selected.audio_url ? "Replace audio" : "Attach audio"}
                          <input type="file" accept={AUDIO_ACCEPT} disabled={attachingAudio} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void attachAudio(f); }} style={hiddenInput} />
                        </label>
                        {selected.audio_url && (
                          <span className="inline-flex items-center gap-1" style={{ fontSize: 11, color: DIM }}>
                            <Check size={12} style={{ color: GREEN }} /> {fmtClock(selected.audio_duration_sec) ?? "Audio attached"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </Panel>

              {/* Session audio + schedule + auto-air (selected program) */}
              {selected && (
                <Panel>
                  <div className="flex items-center justify-between mb-3.5">
                    <div className="flex items-center gap-2">
                      <Music size={15} style={{ color: GOLD }} />
                      <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.01em" }}>Session audio & schedule</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span style={{ fontSize: 11, color: DIM }}>{selected.audio_url ? (fmtClock(selected.audio_duration_sec) ?? "Attached") : "No audio"}</span>
                      {selected.audio_url && (
                        <label className="rs-btn flex items-center gap-1.5 rounded-lg px-2.5" style={{ height: 28, background: "rgba(230,198,110,0.12)", color: GOLD, border: `1px solid ${GOLD}44`, fontSize: 11, fontWeight: 700, cursor: attachingAudio ? "default" : "pointer", opacity: attachingAudio ? 0.6 : 1 }}>
                          {attachingAudio ? <Loader2 size={12} className="rs-spin" /> : <Music size={12} />}
                          {attachingAudio ? "Uploading…" : "Replace audio"}
                          <input type="file" accept={AUDIO_ACCEPT} disabled={attachingAudio} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void attachAudio(f); }} style={hiddenInput} />
                        </label>
                      )}
                      <button onClick={beginEdit} className="rs-btn flex items-center gap-1.5 rounded-lg px-2.5" style={{ height: 28, background: "rgba(230,198,110,0.12)", color: GOLD, border: `1px solid ${GOLD}44`, fontSize: 11, fontWeight: 700 }}>
                        <Pencil size={12} /> Edit
                      </button>
                    </div>
                  </div>

                  {selected.audio_url ? (
                    <div className="rounded-xl px-3 py-3 mb-3" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${PANEL_BORDER}` }}>
                      <div className="flex items-center gap-2 mb-2" style={{ fontSize: 11.5, color: DIM, fontWeight: 600 }}>
                        <Music size={13} style={{ color: GOLD }} /> Session audio
                        {fmtClock(selected.audio_duration_sec) && <span style={{ color: DIMMER }}>· {fmtClock(selected.audio_duration_sec)}</span>}
                      </div>
                      <audio
                        controls
                        playsInline
                        src={selected.audio_url}
                        onPlay={(e) => setMediaSession(e.currentTarget, selected.title, selected.speaker ?? "Nuru Radio", selected.artwork_url)}
                        onPause={() => setMediaPlaybackState("paused")}
                        style={{ width: "100%", height: 36 }}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 flex-wrap rounded-xl px-3 py-3 mb-3" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${PANEL_BORDER}` }}>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>No audio attached</div>
                        <div style={{ fontSize: 11, color: DIM, marginTop: 2 }}>Attach a recording to broadcast when this session goes live.</div>
                      </div>
                      <label className="rs-btn flex items-center gap-2 rounded-xl px-3.5 shrink-0" style={{ height: 36, background: "rgba(230,198,110,0.12)", color: GOLD, border: `1px solid ${GOLD}44`, fontSize: 12, fontWeight: 700, cursor: attachingAudio ? "default" : "pointer", opacity: attachingAudio ? 0.6 : 1 }}>
                        {attachingAudio ? <Loader2 size={14} className="rs-spin" /> : <Music size={14} />}
                        {attachingAudio ? "Uploading…" : "Attach audio"}
                        <input type="file" accept={AUDIO_ACCEPT} disabled={attachingAudio} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void attachAudio(f); }} style={hiddenInput} />
                      </label>
                    </div>
                  )}
                  {attachErr && <div style={{ fontSize: 11, color: "#FCA5A5", marginBottom: 8 }}>{attachErr}</div>}

                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="inline-flex items-center gap-2 flex-wrap" style={{ fontSize: 12, color: DIM }}>
                      <CalendarClock size={14} style={{ color: GOLD }} />
                      <span>
                        {fmtSchedule(selected.scheduled_at)}
                        {selected.duration_min != null ? ` · ${selected.duration_min} min` : ""}
                        {` · ${REPEAT_LABEL[selected.repeat ?? "none"] ?? selected.repeat ?? "Once"}`}
                      </span>
                      {selected.timezone && <span style={{ color: DIMMER }}>· {selected.timezone}</span>}
                    </div>
                    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ fontSize: 11, fontWeight: 700, background: selected.auto_go_live ? "rgba(34,197,94,0.14)" : "rgba(255,255,255,0.06)", border: `1px solid ${selected.auto_go_live ? GREEN + "55" : PANEL_BORDER}`, color: selected.auto_go_live ? "#86EFAC" : DIM }}>
                      <span className="rounded-full" style={{ width: 7, height: 7, background: selected.auto_go_live ? GREEN : DIMMER }} />
                      Auto-air: {selected.auto_go_live ? "On" : "Off"}
                    </span>
                  </div>
                  {selected.scheduled_at && selected.auto_go_live && !selected.is_live && (
                    <div style={{ fontSize: 11, color: DIM, marginTop: 8, lineHeight: 1.45 }}>
                      Airs automatically at {fmtSchedule(selected.scheduled_at)}.
                    </div>
                  )}
                </Panel>
              )}

              {/* Live status bar (only while live/paused) */}
              {(live || phase === "paused") && selected && (
                <Panel style={{ borderColor: `${RED}44`, background: "linear-gradient(180deg, rgba(239,68,68,0.08), rgba(15,24,41,0.9))" }}>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Metric label="Status" value={live ? "LIVE" : "PAUSED"} valueColor={live ? "#FCA5A5" : GOLD} dot={live ? RED : GOLD} />
                    <Metric label="Duration" value={fmtDuration(elapsed)} mono />
                    <Metric label="Listeners" value={listenerCount.toLocaleString()} />
                    <Metric label="Health" value={healthWord(health)} valueColor={GREEN} sub={health ? `${health.bitrate} kbps` : "—"} />
                  </div>
                  {/* Icy now-playing metadata from the encoder (server health poll) */}
                  {health?.now_playing && (
                    <div className="flex items-center gap-2 rounded-lg px-3 py-2 mt-3" style={{ background: "rgba(230,198,110,0.10)", border: `1px solid ${GOLD}33` }}>
                      <span className="rs-live-dot rounded-full shrink-0" style={{ width: 7, height: 7, background: GOLD }} />
                      <span className="truncate" style={{ fontSize: 11.5, fontWeight: 600, color: GOLD }}>♪ Now playing: {health.now_playing}</span>
                    </div>
                  )}
                </Panel>
              )}

              {/* Waveform */}
              <Panel>
                <SectionHead icon={Activity} title="Waveform" hint={previewTitle ? `On air · ${previewTitle}` : live ? "Reacting to live audio" : "Idle"} />
                <div className="flex items-center justify-center gap-[3px]" style={{ height: 120, padding: "6px 2px" }}>
                  {bars.map((b, i) => {
                    const hue = b > 0.85 ? RED : b > 0.6 ? GOLD : GOLD_DEEP;
                    return <div key={i} style={{ flex: 1, height: `${Math.max(4, b * 100)}%`, minWidth: 2, borderRadius: 3, background: `linear-gradient(180deg, ${hue}, ${hue}55)`, transition: "height .11s linear", opacity: live && !mic.muted ? 1 : 0.4 }} />;
                  })}
                </div>
              </Panel>

              {/* Broadcast controls */}
              <Panel>
                <SectionHead icon={RadioIcon} title="Broadcast controls" hint={selected ? "Manual override — take live now" : "Select a session first"} />
                {actionErr && <div style={{ fontSize: 11.5, color: "#FCA5A5", marginBottom: 10, textAlign: "center" }}>{actionErr}</div>}
                <div className="flex items-center justify-center gap-3 flex-wrap" style={{ padding: "6px 0 2px" }}>
                  {!live && phase !== "paused" ? (
                    <button onClick={() => setConfirmOpen(true)} disabled={phase === "countdown" || !selected || busy} className="rs-btn flex items-center gap-2.5 rounded-2xl px-8" style={{ height: 60, background: `linear-gradient(135deg, ${RED}, #B91C1C)`, color: "#fff", fontSize: 17, fontWeight: 800, boxShadow: "0 14px 34px -12px rgba(239,68,68,0.7)", opacity: !selected || busy ? 0.5 : 1 }}>
                      <span className="rounded-full" style={{ width: 12, height: 12, background: "#fff" }} /> Take live now
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
                      <button onClick={() => void endBroadcast()} disabled={busy} className="rs-btn flex items-center gap-2 rounded-2xl px-6" style={{ height: 60, background: "rgba(239,68,68,0.14)", color: "#FCA5A5", border: `1px solid ${RED}55`, fontSize: 15, fontWeight: 700, opacity: busy ? 0.6 : 1 }}>
                        <Square size={18} /> End Broadcast
                      </button>
                    </>
                  )}
                </div>
                {selected?.record_broadcast && (
                  <div className="flex items-center justify-center gap-1.5 mt-3" style={{ fontSize: 11, color: DIM }}>
                    <Disc3 size={12} style={{ color: RED }} className={live ? "rs-live-dot" : ""} /> Recording {live ? "in progress" : "armed"} · saving to {fmtTarget(selected.record_target)}
                  </div>
                )}
              </Panel>

              {/* Listen — REAL live mount playback (broadcast / monitor / cue) */}
              <ListenPanel program={selected} micOnAir={mic.onAir} />

              {/* Audio source + meters — REAL hardware (getUserMedia → Web Audio) */}
              <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                <Panel>
                  <SectionHead icon={Mic} title="Audio source" hint={mic.onAir ? "Live capture" : mic.ready ? "Monitoring" : "Off"} />
                  {!mic.supported ? (
                    <div style={{ fontSize: 12, color: DIM, lineHeight: 1.55, padding: "6px 0" }}>
                      This browser can't capture audio — use a current Chrome, Edge or Safari over HTTPS.
                    </div>
                  ) : (
                    <>
                      {!mic.ready && (
                        <button onClick={mic.enable} className="rs-btn w-full flex items-center justify-center gap-2 rounded-xl mb-3" style={{ height: 40, background: "rgba(230,198,110,0.12)", color: GOLD, border: `1px dashed ${GOLD}66`, fontSize: 12.5, fontWeight: 700 }}>
                          <Mic size={15} /> Enable microphone
                        </button>
                      )}
                      <select
                        value={mic.deviceId ?? ""}
                        onChange={(e) => mic.pickDevice(e.target.value || null)}
                        aria-label="Microphone device"
                        style={inputStyle}
                      >
                        <option value="" style={optStyle}>System default microphone</option>
                        {mic.devices.map((d, i) => (
                          <option key={d.deviceId} value={d.deviceId} style={optStyle}>{d.label || `Microphone ${i + 1}`}</option>
                        ))}
                      </select>
                      <div style={{ fontSize: 11, color: DIM, marginTop: 8, lineHeight: 1.5 }}>
                        Any mic or audio interface your computer recognizes appears here — including DAWs routed through a loopback device (BlackHole, Loopback, VB-Cable). New devices appear the moment the OS sees them.
                      </div>
                    </>
                  )}
                </Panel>

                <Panel>
                  <SectionHead icon={Activity} title="Audio meters" hint={mic.ready ? "Live input" : "Idle"} />
                  <div className="flex items-end justify-center gap-6" style={{ height: 200 }}>
                    <Meter label="L" level={Math.max(0.02, mic.meter)} />
                    <Meter label="R" level={Math.max(0.02, mic.meter)} />
                  </div>
                </Panel>
              </div>

              {/* Microphone — REAL capture → mic-bridge WebSocket → on-air harbor */}
              <Panel>
                <div className="flex items-center justify-between mb-3.5 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal size={15} style={{ color: GOLD }} />
                    <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.01em" }}>Microphone</span>
                  </div>
                  {mic.onAir ? (
                    <span className="inline-flex items-center gap-2 rounded-full px-3 py-1" style={{ background: "rgba(239,68,68,0.15)", border: `1px solid ${RED}66`, color: "#FCA5A5", fontSize: 11, fontWeight: 800, letterSpacing: "0.06em" }}>
                      <span className="rs-live-dot rounded-full" style={{ width: 7, height: 7, background: RED }} /> ON AIR
                      <span className="rs-tnum" style={{ fontFamily: MONO, fontWeight: 700 }}>{fmtDuration(mic.elapsed)}</span>
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: DIM }}>{mic.connecting ? "Connecting…" : "Off mic"}</span>
                  )}
                </div>

                {mic.micErr && <div className="rs-reveal" style={{ fontSize: 11.5, color: "#FCA5A5", marginBottom: 10 }}>{mic.micErr}</div>}

                <div className="flex items-center gap-3 mb-4 flex-wrap">
                  {mic.onAir || mic.connecting ? (
                    <button onClick={mic.offMic} className="rs-btn flex items-center gap-2 rounded-2xl px-6" style={{ height: 48, background: `linear-gradient(135deg, ${RED}, #B91C1C)`, color: "#fff", fontSize: 14, fontWeight: 800, border: "none", boxShadow: "0 12px 28px -12px rgba(239,68,68,0.7)" }}>
                      <MicOff size={17} /> Off mic
                    </button>
                  ) : (
                    <button onClick={mic.goOnMic} disabled={!selected?.is_live || !mic.supported} className="rs-btn flex items-center gap-2 rounded-2xl px-6" style={{ height: 48, background: `linear-gradient(135deg, ${GREEN}, #15803D)`, color: "#fff", fontSize: 14, fontWeight: 800, border: "none", opacity: selected?.is_live && mic.supported ? 1 : 0.45, cursor: selected?.is_live && mic.supported ? "pointer" : "default" }}>
                      <Mic size={17} /> Go on mic
                    </button>
                  )}
                  {!selected?.is_live && <span style={{ fontSize: 11, color: DIM }}>Take a session live to go on mic.</span>}
                </div>

                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <Toggle active={mic.muted} onClick={mic.toggleMute} icon={mic.muted ? MicOff : Mic} label={mic.muted ? "Muted" : "Mute"} danger={mic.muted} />
                  <div className="flex flex-wrap gap-2" style={mic.onAir || mic.connecting ? { opacity: 0.45, pointerEvents: "none" } : undefined}>
                    <Toggle active={mic.noise} onClick={() => mic.toggleFlag("noise")} icon={Activity} label="Noise Suppression" />
                    <Toggle active={mic.echo} onClick={() => mic.toggleFlag("echo")} icon={Volume2} label="Echo Cancellation" />
                    <Toggle active={mic.agc} onClick={() => mic.toggleFlag("agc")} icon={Gauge} label="Auto Gain" />
                  </div>
                  {(mic.onAir || mic.connecting) && <span style={{ fontSize: 10.5, color: DIMMER }}>Input processing locks while on air.</span>}
                </div>

                <div className="flex items-center gap-3">
                  <span style={{ fontSize: 11, color: DIM, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, width: 44 }}>Boost</span>
                  <input type="range" min={0} max={100} value={mic.gainPct} onChange={(e) => mic.changeGain(Number(e.target.value))} aria-label="Mic boost" style={{ flex: 1, accentColor: GOLD_DEEP }} />
                  <span className="rs-tnum" style={{ fontFamily: MONO, fontSize: 13, color: GOLD, width: 64, textAlign: "right" }}>+{(20 * Math.log10(boostToGain(mic.gainPct))).toFixed(1)} dB</span>
                </div>
                <div style={{ fontSize: 11, color: DIM, marginTop: 10, lineHeight: 1.5 }}>
                  Compression and limiting run in the server-side mixer — your mic is sent clean.
                </div>
              </Panel>

              {/* Audio library — real track catalog (upload & tag) */}
              <AudioLibraryPanel />

              {/* Sessions — real program playlists (order, loop, live preview) */}
              <SessionsPanel
                onPreview={setPreviewTitle}
                onEdit={beginEditProgram}
                liveProgramId={live && selected ? selected.id : null}
                nowPlaying={live ? health?.now_playing ?? null : null}
              />

              {/* Scheduled playout — real schedule (PATCH scheduled_at/repeat) */}
              <Panel>
                <SectionHead icon={CalendarClock} title="Scheduled playout" hint="Sessions by air-time" />
                <div className="flex gap-2 mb-3 flex-wrap">
                  <select value={schSession} onChange={(e) => setSchSession(e.target.value)} className="rounded-lg px-2.5" style={{ flex: 1, minWidth: 130, height: 38, background: "rgba(255,255,255,0.05)", border: `1px solid ${PANEL_BORDER}`, color: TEXT, fontSize: 12 }}>
                    <option value="" style={optStyle}>Choose session…</option>
                    {(programs ?? []).map((p) => <option key={p.id} value={p.id} style={optStyle}>{p.title}</option>)}
                  </select>
                  <input type="time" value={schTime} onChange={(e) => setSchTime(e.target.value)} className="rounded-lg px-2.5" style={{ height: 38, background: "rgba(255,255,255,0.05)", border: `1px solid ${PANEL_BORDER}`, color: TEXT, fontSize: 12 }} />
                  <select value={schRepeat} onChange={(e) => setSchRepeat(e.target.value)} className="rounded-lg px-2.5" style={{ height: 38, background: "rgba(255,255,255,0.05)", border: `1px solid ${PANEL_BORDER}`, color: TEXT, fontSize: 12 }}>
                    {REPEAT_OPTIONS.map((r) => <option key={r} value={r} style={optStyle}>{REPEAT_LABEL[r]}</option>)}
                  </select>
                  <button onClick={() => void scheduleSession()} disabled={!schSession || scheduling} className="rs-btn flex items-center gap-1.5 rounded-lg px-3.5" style={{ height: 38, background: GOLD, color: "#0A1120", fontSize: 12, fontWeight: 800, opacity: !schSession || scheduling ? 0.55 : 1 }}>
                    {scheduling ? <Loader2 size={14} className="rs-spin" /> : <CalendarClock size={14} />} Schedule
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  {scheduledPrograms.length === 0 && <div style={{ fontSize: 11.5, color: DIMMER, textAlign: "center", padding: 12 }}>No scheduled sessions yet.</div>}
                  {scheduledPrograms.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${PANEL_BORDER}` }}>
                      <span className="rs-tnum flex items-center justify-center rounded-lg shrink-0" style={{ width: 52, height: 34, background: "rgba(230,198,110,0.12)", color: GOLD, fontFamily: MONO, fontSize: 13, fontWeight: 700 }}>{fmtTimeChip(p.scheduled_at ?? "")}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="truncate flex items-center gap-1.5" style={{ fontSize: 12, fontWeight: 600 }}>
                          {p.title}
                          {p.loop_mode !== "none" && <Repeat size={11} style={{ color: "#7BE3A3" }} />}
                        </div>
                        <div style={{ fontSize: 10.5, color: DIM }}>{fmtSchedule(p.scheduled_at)} · {REPEAT_LABEL[p.repeat ?? "none"] ?? p.repeat} · {p.auto_go_live ? "auto-air" : "manual"}</div>
                      </div>
                      <span className="shrink-0" style={{ fontSize: 10, color: DIM }}>{statusLabel(p.status)}</span>
                    </div>
                  ))}
                </div>
              </Panel>

              {/* Broadcast information — create a real program / edit the selected one */}
              <div ref={formRef}>
              <Panel>
                <SectionHead icon={editingId ? Pencil : Plus} title={editingId ? "Edit session" : "Broadcast information"} hint={editingId ? "Saves to the selected session" : "Create a new session"} />
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
                  <Field label="Artwork" full>
                    <div className="flex items-center gap-3 flex-wrap">
                      {form.artwork_url && (
                        <span className="rounded-lg shrink-0 overflow-hidden" style={{ width: 52, height: 52, border: `1px solid ${PANEL_BORDER}`, background: `center/cover no-repeat url("${form.artwork_url}")` }} aria-label="Artwork preview" />
                      )}
                      <label className="rs-btn flex items-center gap-2 rounded-xl px-3.5 shrink-0" style={{ height: 38, background: "rgba(230,198,110,0.12)", color: GOLD, border: `1px solid ${GOLD}44`, fontSize: 12.5, fontWeight: 700, cursor: uploadingArtwork ? "default" : "pointer", opacity: uploadingArtwork ? 0.6 : 1 }}>
                        {uploadingArtwork ? <Loader2 size={14} className="rs-spin" /> : <ImagePlus size={14} />}
                        {uploadingArtwork ? "Uploading…" : form.artwork_url ? "Replace image" : "Upload image"}
                        <input type="file" accept="image/*" disabled={uploadingArtwork} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadArtwork(f); }} style={hiddenInput} />
                      </label>
                      <input className="rs-in" value={form.artwork_url} onChange={(e) => setForm((f) => ({ ...f, artwork_url: e.target.value }))} placeholder="…or paste a URL" style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
                    </div>
                    {artworkErr && <span style={{ fontSize: 11, color: "#FCA5A5", marginTop: 6 }}>{artworkErr}</span>}
                  </Field>

                  {/* Audio recording (uploaded broadcast audio; optional) */}
                  <Field label="Audio recording" full>
                    <div className="flex items-center gap-3 flex-wrap">
                      <label className="rs-btn flex items-center gap-2 rounded-xl px-3.5 shrink-0" style={{ height: 38, background: "rgba(230,198,110,0.12)", color: GOLD, border: `1px solid ${GOLD}44`, fontSize: 12.5, fontWeight: 700, cursor: uploadingAudio ? "default" : "pointer", opacity: uploadingAudio ? 0.6 : 1 }}>
                        {uploadingAudio ? <Loader2 size={14} className="rs-spin" /> : <Music size={14} />}
                        {uploadingAudio ? "Uploading…" : form.audio_url ? "Replace audio" : "Upload audio"}
                        <input type="file" accept={AUDIO_ACCEPT} disabled={uploadingAudio} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadFormAudio(f); }} style={hiddenInput} />
                      </label>
                      {form.audio_url ? (
                        <span className="inline-flex items-center gap-1.5 truncate" style={{ fontSize: 11.5, color: DIM, minWidth: 0 }}>
                          <Check size={13} style={{ color: GREEN }} />
                          <span className="truncate">{form.audio_filename || "Audio attached"}</span>
                          {fmtClock(form.audio_duration_sec) && <span style={{ color: DIMMER }}>· {fmtClock(form.audio_duration_sec)}</span>}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: DIMMER }}>Optional — plays when the session goes live.</span>
                      )}
                    </div>
                    {form.audio_url && (
                      <audio controls src={form.audio_url} style={{ width: "100%", marginTop: 8, height: 34 }} />
                    )}
                    {audioErr && <span style={{ fontSize: 11, color: "#FCA5A5", marginTop: 6 }}>{audioErr}</span>}
                  </Field>

                  {/* ── Schedule ── */}
                  <div style={{ gridColumn: "1 / -1", marginTop: 4 }}>
                    <div className="flex items-center gap-2" style={{ marginBottom: 2 }}>
                      <CalendarClock size={14} style={{ color: GOLD }} />
                      <span style={{ fontSize: 12, fontWeight: 700 }}>Schedule</span>
                    </div>
                  </div>
                  <Field label="Scheduled at (optional)">
                    <input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm((f) => ({ ...f, scheduled_at: e.target.value }))} style={inputStyle} />
                  </Field>
                  <Field label="Duration (min)">
                    <input type="number" min={0} value={form.duration_min} onChange={(e) => setForm((f) => ({ ...f, duration_min: e.target.value }))} placeholder="45" style={inputStyle} />
                  </Field>
                  <Field label="Repeat">
                    <select value={form.repeat} onChange={(e) => setForm((f) => ({ ...f, repeat: e.target.value }))} style={inputStyle}>
                      {REPEAT_OPTIONS.map((r) => <option key={r} value={r} style={optStyle}>{REPEAT_LABEL[r]}</option>)}
                    </select>
                  </Field>
                  <Field label="Timezone">
                    <input className="rs-in" value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))} placeholder="Africa/Nairobi" style={inputStyle} />
                  </Field>

                  {/* Schedule-overlap advisory (non-blocking — saving is allowed;
                      the auto-air worker airs overlapping sessions sequentially) */}
                  {conflicts.length > 0 && (
                    <div className="rs-reveal rounded-xl px-3 py-2.5" style={{ gridColumn: "1 / -1", background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.45)" }}>
                      {conflicts.slice(0, 3).map((c) => (
                        <div key={c.id} style={{ fontSize: 11.5, fontWeight: 600, color: "#FCD34D", lineHeight: 1.6 }}>
                          ⚠ Overlaps «{c.title}» — {fmtSchedule(c.scheduled_at)} · {c.duration_min ?? 60} min
                        </div>
                      ))}
                      {conflicts.length > 3 && (
                        <div style={{ fontSize: 11, color: "#FCD34D", opacity: 0.8, lineHeight: 1.6 }}>…and {conflicts.length - 3} more</div>
                      )}
                      <div style={{ fontSize: 11, color: "rgba(253,230,138,0.75)", marginTop: 4, lineHeight: 1.5 }}>
                        Only one session can be live; this one will start automatically when the frequency frees.
                      </div>
                    </div>
                  )}

                  {/* Auto-air toggle (auto_go_live) */}
                  <div style={{ gridColumn: "1 / -1", marginTop: 2 }}>
                    <div className="flex items-start gap-2.5 rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${PANEL_BORDER}` }}>
                      <button type="button" onClick={() => setForm((f) => ({ ...f, auto_go_live: !f.auto_go_live }))} className="shrink-0" aria-pressed={form.auto_go_live} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: 1 }}>
                        <span className="rounded-full block shrink-0" style={{ width: 40, height: 22, background: form.auto_go_live ? GOLD_DEEP : "rgba(255,255,255,0.14)", padding: 3, transition: "background .15s" }}>
                          <span className="block rounded-full" style={{ width: 16, height: 16, background: "#fff", transform: form.auto_go_live ? "translateX(18px)" : "translateX(0)", transition: "transform .15s" }} />
                        </span>
                      </button>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: form.auto_go_live ? GOLD : TEXT }}>Auto-air at scheduled time</div>
                        <div style={{ fontSize: 11, color: DIM, marginTop: 2, lineHeight: 1.45 }}>When on, this session goes live automatically at the scheduled time.</div>
                      </div>
                    </div>
                  </div>
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
                  <div className="flex items-center gap-2">
                    {editingId && (
                      <button onClick={cancelEdit} className="rs-btn rounded-xl px-4" style={{ height: 40, background: "rgba(255,255,255,0.06)", color: TEXT, fontSize: 12.5, fontWeight: 600, border: `1px solid ${PANEL_BORDER}` }}>
                        Cancel
                      </button>
                    )}
                    <button onClick={() => void submitForm()} disabled={creating} className="rs-btn flex items-center gap-2 rounded-xl px-5" style={{ height: 40, background: GOLD, color: "#0A1120", fontSize: 13, fontWeight: 800, opacity: creating ? 0.6 : 1 }}>
                      {creating ? <Loader2 size={15} className="rs-spin" /> : editingId ? <Check size={15} /> : <Plus size={15} />} {editingId ? "Save changes" : "Create broadcast"}
                    </button>
                  </div>
                </div>
              </Panel>
              </div>

              {/* Ingest URL + stream key (broadcaster credentials) — collapsed disclosure by default */}
              {selected && (
                <Panel>
                  <button
                    onClick={() => setCredsOpen((o) => !o)}
                    aria-expanded={credsOpen}
                    className="rs-btn flex items-center justify-between gap-2"
                    style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", color: TEXT, textAlign: "left" }}
                  >
                    <span className="flex items-center gap-2">
                      <KeyRound size={15} style={{ color: GOLD }} />
                      <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.01em" }}>Ingest & stream key</span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span style={{ fontSize: 11, color: DIM }}>Broadcaster only — keep secret</span>
                      <ChevronDown size={15} style={{ color: DIM, transform: credsOpen ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform .2s ease" }} />
                    </span>
                  </button>
                  {credsOpen && (
                    <div className="rs-reveal" style={{ marginTop: 14 }}>
                      <div style={{ fontSize: 11, color: DIM, marginBottom: 12, lineHeight: 1.45 }}>
                        Live-mic streaming (advanced) — not needed for uploaded-audio sessions.
                      </div>
                      <div className="flex flex-col gap-2">
                        <CredRow label="Ingest URL" value={selected.ingest_url ?? "—"} onCopy={selected.ingest_url ? () => copy("Ingest URL", selected.ingest_url!) : undefined} copied={copied === "Ingest URL"} />
                        <CredRow label="Stream key" value={rotatedKey ?? selected.stream_key ?? "—"} secret onCopy={(rotatedKey ?? selected.stream_key) ? () => copy("Stream key", (rotatedKey ?? selected.stream_key)!) : undefined} copied={copied === "Stream key"} />
                        {selected.hls_url && (
                          <CredRow label="HLS playback" value={selected.hls_url} onCopy={() => copy("HLS playback", selected.hls_url!)} copied={copied === "HLS playback"} />
                        )}
                      </div>
                      <button onClick={() => void rotateKey()} disabled={busy} className="rs-btn flex items-center justify-center gap-2 rounded-xl mt-3" style={{ width: "100%", height: 38, background: "rgba(230,198,110,0.12)", color: GOLD, border: `1px solid ${GOLD}44`, fontSize: 12.5, fontWeight: 700, opacity: busy ? 0.6 : 1 }}>
                        <RefreshCw size={14} className={busy ? "rs-spin" : ""} /> Rotate stream key
                      </button>
                      {rotatedKey && <div style={{ fontSize: 11, color: GREEN, marginTop: 8, textAlign: "center" }}>New key issued — the old key stops working immediately.</div>}
                    </div>
                  )}
                </Panel>
              )}
            </div>

            {/* ══════════ RIGHT — engagement + system ══════════ */}
            <div className="flex flex-col gap-5" style={{ minWidth: 0 }}>
              {/* Live listeners — roster is studio chrome; the count is real */}
              <Panel>
                <SectionHead icon={Smartphone} title="Live listeners" hint={live ? `${listenerCount.toLocaleString()} on air` : "Off air"} />
                <div className="flex flex-col gap-2" style={{ maxHeight: 220, overflowY: "auto" }}>
                  {listeners.length === 0 ? (
                    <div style={{ fontSize: 12, color: DIM, padding: "10px 4px" }}>
                      {live ? "No one listening yet." : "Off air — no listeners."}
                    </div>
                  ) : listeners.map((p) => (
                    <div key={p.user_id} className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${PANEL_BORDER}` }}>
                      {p.avatar_url ? (
                        <img src={p.avatar_url} alt="" className="rounded-full shrink-0" style={{ width: 30, height: 30, objectFit: "cover" }} />
                      ) : (
                        <span className="flex items-center justify-center rounded-full shrink-0" style={{ width: 30, height: 30, background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`, color: "#0A1120", fontSize: 11, fontWeight: 800 }}>{listenerInitials(p.name)}</span>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="truncate" style={{ fontSize: 12.5, fontWeight: 600 }}>{p.name}</div>
                      </div>
                      <span className="inline-flex items-center gap-1 shrink-0" style={{ fontSize: 9.5, fontWeight: 700, color: GREEN }}>
                        <span className="rounded-full rs-live-dot" style={{ width: 6, height: 6, background: GREEN }} /> Listening
                      </span>
                    </div>
                  ))}
                </div>
              </Panel>

              {/* Comments & reactions (both REAL — authors from the users join,
                  totals from GET .../reactions across ALL members) */}
              <Panel>
                <SectionHead icon={Heart} title="Comments & reactions" hint={live ? "Live" : selected ? `${comments.length}` : "—"} />
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <ReactChip icon={() => <span style={{ fontSize: 15 }}>❤️</span>} color="#FB7185" value={reactions.heart} label="Hearts" onClick={() => sendReaction("heart")} />
                  <ReactChip icon={() => <span style={{ fontSize: 15 }}>🙏</span>} color={GOLD} value={reactions.amen} label="Amens" onClick={() => sendReaction("amen")} />
                  <ReactChip icon={() => <span style={{ fontSize: 15 }}>🔥</span>} color="#FB923C" value={reactions.fire} label="Fire" onClick={() => sendReaction("fire")} />
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <input className="rs-in" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") postComment(); }} placeholder="Say something to listeners…" style={{ flex: 1, minWidth: 0, height: 38, background: "rgba(255,255,255,0.05)", border: `1px solid ${PANEL_BORDER}`, color: TEXT, fontSize: 12.5, outline: "none", borderRadius: 12, padding: "0 12px" }} />
                  <button onClick={postComment} className="rs-btn flex items-center justify-center rounded-xl shrink-0" style={{ width: 42, height: 38, background: GOLD, color: "#0A1120" }}><Send size={16} /></button>
                </div>
                <div className="flex flex-col gap-2" style={{ maxHeight: 260, overflowY: "auto" }}>
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
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
                          {c.author_avatar_url ? (
                            <img src={c.author_avatar_url} alt="" className="rounded-full shrink-0" style={{ width: 22, height: 22, objectFit: "cover" }} />
                          ) : (
                            <span className="flex items-center justify-center rounded-full shrink-0" style={{ width: 22, height: 22, background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`, color: "#0A1120", fontSize: 8.5, fontWeight: 800 }}>{listenerInitials(c.author_name ?? "")}</span>
                          )}
                          <span className="truncate" style={{ fontSize: 12, fontWeight: 700 }}>{authorLabel(c)}</span>
                        </div>
                        <button onClick={() => hideComment(c.id)} title={c.hidden ? "Hidden" : "Hide comment"} className="rs-btn flex items-center justify-center rounded-md shrink-0" style={{ width: 24, height: 24, background: "rgba(255,255,255,0.05)", color: c.hidden ? DIMMER : DIM }}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <div style={{ fontSize: 11.5, color: c.hidden ? DIMMER : DIM, margin: "2px 0 0", lineHeight: 1.45, textDecoration: c.hidden ? "line-through" : "none" }}>{c.body}</div>
                    </div>
                  ))}
                </div>
              </Panel>

              {/* Stream health (REAL while live) */}
              <Panel>
                <SectionHead icon={Gauge} title="Stream health" hint={live ? healthWord(health) : "Off air"} />
                <div className="grid grid-cols-2 gap-2">
                  <Health icon={Cpu} label="CPU" value={health ? `${Math.round(health.cpu)}%` : "—"} ok={!health || health.cpu < 80} />
                  <Health icon={HardDrive} label="Memory" value={health ? `${health.memory.toFixed(1)} GB` : "—"} ok={!health || health.memory < 6} />
                  <Health icon={Wifi} label="Stability" value={health ? `${Math.round(health.stability)}%` : "—"} ok={!health || health.stability > 90} />
                  <Health icon={Activity} label="Latency" value={health ? `${Math.round(health.latency)} ms` : "—"} ok={!health || health.latency < 200} />
                  <Health icon={Signal} label="Bitrate" value={health ? `${health.bitrate} kbps` : "—"} ok />
                  <Health icon={ShieldAlert} label="Dropped" value={health ? String(health.dropped) : "—"} ok={!health || health.dropped === 0} />
                </div>
                {!live && <div style={{ fontSize: 11, color: DIMMER, marginTop: 10, textAlign: "center" }}>Health metrics stream from the encoder once you go live.</div>}
              </Panel>

              {/* Device manager (local) */}
              <Panel>
                <SectionHead icon={Smartphone} title="Devices" hint="Broadcast from anywhere" />
                <div className="flex flex-col gap-2 mb-3">
                  {SEED_DEVICES.map((d) => {
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
                {/* Real kill switch — ends the live broadcast immediately (server-authoritative) */}
                {killArmed ? (
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => { setKillArmed(false); void endBroadcast(); }} className="rs-btn flex-1 flex items-center justify-center gap-2 rounded-xl" style={{ height: 42, background: `linear-gradient(135deg, ${RED}, #B91C1C)`, color: "#fff", fontSize: 12, fontWeight: 800, border: "none" }}>
                      <Square size={14} /> Kill now — drops all listeners
                    </button>
                    <button onClick={() => setKillArmed(false)} className="rs-btn rounded-xl px-4" style={{ height: 42, background: "rgba(255,255,255,0.06)", color: TEXT, fontSize: 12, fontWeight: 600, border: `1px solid ${PANEL_BORDER}` }}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setKillArmed(true)} disabled={!(live || phase === "paused")} className="rs-btn w-full flex items-center justify-center gap-2 rounded-xl mt-3" style={{ height: 42, background: "rgba(239,68,68,0.14)", color: "#FCA5A5", border: `1px solid ${RED}55`, fontSize: 12.5, fontWeight: 800, opacity: live || phase === "paused" ? 1 : 0.45, cursor: live || phase === "paused" ? "pointer" : "default" }}>
                    <ShieldAlert size={14} /> Kill broadcast
                  </button>
                )}
              </Panel>

              {/* Visibility + recording quick settings — PATCH the selected session */}
              <Panel>
                <SectionHead icon={Upload} title="Broadcast settings" hint={selected ? "Selected session" : "No session selected"} />
                <div style={{ fontSize: 11, color: DIM, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 8 }}>Visibility</div>
                <div className="flex gap-2 mb-4 flex-wrap">
                  {VIS_ORDER.map((v) => {
                    const on = selected?.visibility === v;
                    return (
                      <button key={v} onClick={() => void quickPatch({ visibility: v })} disabled={!selected} className="rs-btn rounded-lg px-3 py-1.5" style={{ fontSize: 11.5, fontWeight: 700, background: on ? GOLD : "rgba(255,255,255,0.05)", color: on ? "#0A1120" : DIM, border: `1px solid ${on ? GOLD : PANEL_BORDER}`, opacity: selected ? 1 : 0.5 }}>{VIS_LABELS[v]}</button>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${PANEL_BORDER}`, opacity: selected ? 1 : 0.5 }}>
                  <span className="flex items-center gap-2" style={{ fontSize: 12.5, fontWeight: 600 }}><Disc3 size={15} style={{ color: RED }} /> Record broadcast</span>
                  <button onClick={() => { if (selected) void quickPatch({ record_broadcast: !selected.record_broadcast }); }} disabled={!selected} className="rounded-full shrink-0" style={{ width: 42, height: 24, background: selected?.record_broadcast ? GOLD_DEEP : "rgba(255,255,255,0.14)", padding: 3, transition: "background .15s", border: "none", cursor: selected ? "pointer" : "default" }}>
                    <span className="block rounded-full" style={{ width: 18, height: 18, background: "#fff", transform: selected?.record_broadcast ? "translateX(18px)" : "translateX(0)", transition: "transform .15s" }} />
                  </button>
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
const inputStyle: React.CSSProperties = {
  width: "100%", height: 38, background: "rgba(255,255,255,0.05)", border: `1px solid ${PANEL_BORDER}`,
  color: TEXT, fontSize: 12.5, outline: "none", borderRadius: 10, padding: "0 12px",
};
const optStyle: React.CSSProperties = { background: "#131E33", color: TEXT };

/* ── building blocks (Figma make) ── */
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

function ReactChip({ icon: Icon, color, value, label, onClick }: { icon: LucideIcon | (() => ReactElement); color: string; value: number; label: string; onClick?: () => void }): ReactElement {
  return (
    <button type="button" onClick={onClick} className="rs-btn rounded-xl flex flex-col items-center py-2.5" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${PANEL_BORDER}`, color: TEXT, fontFamily: "inherit", cursor: onClick ? "pointer" : "default" }}>
      <Icon size={16} style={{ color }} />
      <span className="rs-tnum" style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, marginTop: 4 }}>{value.toLocaleString()}</span>
      <span style={{ fontSize: 9.5, color: DIM, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 1 }}>{label}</span>
    </button>
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

/* ═══════════════════ Audio library + Sessions (REAL) ═══════════════════ */

// ── Audio library panel — reusable track catalog + upload, Figma-styled ──
function AudioLibraryPanel(): ReactElement {
  const [tracks, setTracks] = useState<RadioTrack[] | null>(null);
  const [uploadKind, setUploadKind] = useState<RadioTrackKind>("music");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sessions, setSessions] = useState<RadioProgram[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    RadioApi.tracks()
      .then((list) => setTracks(list))
      .catch(() => { setTracks(null); setErr("Could not load the audio library."); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadSessions = useCallback(() => {
    RadioApi.programs().then(setSessions).catch(() => setSessions([]));
  }, []);
  useEffect(() => { loadSessions(); }, [loadSessions]);
  useEffect(() => {
    const h = (): void => loadSessions();
    window.addEventListener("rs:programs-changed", h);
    return () => window.removeEventListener("rs:programs-changed", h);
  }, [loadSessions]);

  const upload = useCallback(async (file: File) => {
    const invalid = validAudio(file);
    if (invalid) { setErr(invalid); return; }
    setUploading(true);
    setErr(null);
    try {
      const durationSec = await probeAudioDuration(file);
      const res = await RadioApi.uploadAudio(file, durationSec);
      const body: CreateRadioTrackBody = { title: baseName(file.name), kind: uploadKind, audio_url: res.url, size_bytes: file.size };
      const d = res.duration_sec ?? durationSec;
      if (d != null) body.duration_sec = d;
      await RadioApi.createTrack(body);
      load();
    } catch {
      setErr("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }, [uploadKind, load]);

  const remove = useCallback(async (id: string) => {
    try {
      await RadioApi.deleteTrack(id);
      setTracks((ts) => (ts ? ts.filter((t) => t.id !== id) : ts));
    } catch {
      setErr("Could not delete the track.");
    }
  }, []);

  const addToSession = useCallback(async (programId: string, track: RadioTrack) => {
    setNote(null);
    try {
      await RadioApi.addToPlaylist(programId, track.id);
      const s = sessions.find((p) => p.id === programId);
      setNote(`Added "${track.title}" to ${s?.title ?? "session"}.`);
      window.dispatchEvent(new CustomEvent("rs:playlist-changed", { detail: { programId } }));
      setTimeout(() => setNote((n) => (n && n.startsWith("Added") ? null : n)), 2600);
    } catch {
      setErr("Could not add the track to that session.");
    }
  }, [sessions]);

  const count = tracks?.length ?? 0;

  return (
    <Panel>
      <SectionHead icon={Music} title="Audio library" hint={loading ? "Loading…" : `${count} track${count === 1 ? "" : "s"}`} />

      {/* Upload-kind picker + dashed upload — exactly the make's row */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <div className="flex gap-1 rounded-lg p-1" style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${PANEL_BORDER}` }}>
          {TRACK_KINDS.map((k) => (
            <button key={k} onClick={() => setUploadKind(k)} className="rs-btn rounded-md px-2.5 py-1" style={{ fontSize: 10.5, fontWeight: 700, background: uploadKind === k ? KIND_META[k].color : "transparent", color: uploadKind === k ? "#0A1120" : DIM }}>{KIND_META[k].label}</button>
          ))}
        </div>
        <label className="rs-btn flex items-center justify-center gap-2 rounded-lg px-3 cursor-pointer" style={{ flex: 1, minWidth: 150, height: 34, background: "rgba(230,198,110,0.12)", color: GOLD, border: `1px dashed ${GOLD}66`, fontSize: 12, fontWeight: 700, opacity: uploading ? 0.6 : 1 }}>
          {uploading ? <Loader2 size={14} className="rs-spin" /> : <Upload size={14} />}
          {uploading ? "Uploading…" : `Upload ${KIND_META[uploadKind].label.toLowerCase()}`}
          <input type="file" accept={AUDIO_ACCEPT} multiple={false} disabled={uploading} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
        </label>
      </div>

      {err && <div style={{ fontSize: 11, color: "#FCA5A5", marginBottom: 8 }}>{err}</div>}
      {note && <div style={{ fontSize: 11, color: GREEN, marginBottom: 8 }}>{note}</div>}

      {/* Track rows */}
      <div className="flex flex-col gap-2" style={{ maxHeight: 240, overflowY: "auto" }}>
        {loading ? (
          <div className="flex items-center gap-2" style={{ fontSize: 12, color: DIM, padding: "6px 0" }}>
            <Loader2 size={14} className="rs-spin" /> Loading tracks…
          </div>
        ) : count === 0 ? (
          <div style={{ fontSize: 12, color: DIMMER, padding: "10px 0", textAlign: "center" }}>No tracks yet — upload one above.</div>
        ) : (
          tracks?.map((t) => {
            const meta = KIND_META[t.kind];
            const dur = fmtClock(t.duration_sec);
            const size = fmtBytes(t.size_bytes);
            return (
              <div key={t.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${PANEL_BORDER}` }}>
                <span className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 32, height: 32, background: `${meta.color}22`, color: meta.color }}><Music size={15} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="truncate" style={{ fontSize: 12, fontWeight: 600 }}>{t.title}</div>
                  <div className="flex items-center gap-2" style={{ marginTop: 2 }}>
                    <span className="rounded-full px-1.5" style={{ fontSize: 9, fontWeight: 800, background: `${meta.color}22`, color: meta.color, textTransform: "uppercase", letterSpacing: "0.04em" }}>{meta.label}</span>
                    <span className="rs-tnum" style={{ fontSize: 10.5, color: DIM, fontFamily: MONO }}>{dur ?? "—:—"}{size ? ` · ${size}` : ""}</span>
                  </div>
                </div>
                {sessions.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => { const v = e.target.value; if (v) void addToSession(v, t); }}
                    title="Add to session"
                    className="rs-btn rounded-lg shrink-0"
                    style={{ height: 30, background: "rgba(255,255,255,0.05)", border: `1px solid ${PANEL_BORDER}`, color: GOLD, fontSize: 11, fontWeight: 700, padding: "0 6px" }}
                  >
                    <option value="" style={optStyle}>+ Session</option>
                    {sessions.map((s) => <option key={s.id} value={s.id} style={optStyle}>{s.title}</option>)}
                  </select>
                )}
                <button onClick={() => void remove(t.id)} title="Delete track" className="rs-btn flex items-center justify-center rounded-lg shrink-0" style={{ width: 26, height: 26, background: "rgba(255,255,255,0.05)", color: DIM }}>
                  <X size={12} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </Panel>
  );
}

// ── Sessions panel — program playlists + loop + live preview, Figma-styled ──
// `liveProgramId`/`nowPlaying` come from the parent's health poll of the REAL
// broadcast: for the session that IS the live program, the playlist row whose
// track fuzzily matches the icy now-playing metadata gets a gold ON AIR mark.
function SessionsPanel({ onPreview, onEdit, liveProgramId, nowPlaying }: {
  onPreview: (title: string | null) => void;
  onEdit: (p: RadioProgram) => void;
  liveProgramId: string | null;
  nowPlaying: string | null;
}): ReactElement {
  const [sessions, setSessions] = useState<RadioProgram[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [playlists, setPlaylists] = useState<Record<string, RadioPlaylistItem[]>>({});
  const [library, setLibrary] = useState<RadioTrack[]>([]);
  const [attachingId, setAttachingId] = useState<string | null>(null);

  // Client-side live preview.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [previewProgram, setPreviewProgram] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    RadioApi.programs()
      .then((list) => setSessions(list))
      .catch(() => { setSessions(null); setErr("Could not load sessions."); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { RadioApi.tracks().then(setLibrary).catch(() => setLibrary([])); }, []);

  // Silent refresh when programs change elsewhere (form create/edit, attach,
  // go-live/end from the main console) so the cards never go stale.
  useEffect(() => {
    const h = (): void => { RadioApi.programs().then((list) => setSessions(list)).catch(() => {}); };
    window.addEventListener("rs:programs-changed", h);
    return () => window.removeEventListener("rs:programs-changed", h);
  }, []);

  const loadPlaylist = useCallback((programId: string) => {
    RadioApi.playlist(programId)
      // Coerce at the single write point: everything stored in `playlists` MUST
      // be an array — a non-array here once white-screened the whole studio.
      .then((items) => setPlaylists((p) => ({ ...p, [programId]: Array.isArray(items) ? items : [] })))
      .catch(() => {});
  }, []);

  // Load each session's playlist once loaded.
  useEffect(() => {
    if (!sessions) return;
    sessions.forEach((s) => loadPlaylist(s.id));
  }, [sessions, loadPlaylist]);

  // Refresh a session's playlist when the library panel adds a track to it.
  useEffect(() => {
    const onChanged = (e: Event): void => {
      const detail = (e as CustomEvent<{ programId: string }>).detail;
      if (detail?.programId) loadPlaylist(detail.programId);
    };
    window.addEventListener("rs:playlist-changed", onChanged);
    return () => window.removeEventListener("rs:playlist-changed", onChanged);
  }, [loadPlaylist]);

  const create = useCallback(async () => {
    if (!name.trim()) return;
    setCreating(true);
    setErr(null);
    try {
      const created = await RadioApi.createProgram({ title: name.trim(), category: "Sermon" });
      setSessions((s) => [created, ...(s ?? [])]);
      setPlaylists((p) => ({ ...p, [created.id]: [] }));
      setName("");
      window.dispatchEvent(new CustomEvent("rs:programs-changed"));
    } catch {
      setErr("Could not create the session.");
    } finally {
      setCreating(false);
    }
  }, [name]);

  const stopPreview = useCallback(() => {
    const el = audioRef.current;
    if (el) { el.pause(); el.removeAttribute("src"); el.load(); }
    clearMediaSession();
    setPreviewProgram(null);
    setPreviewIndex(0);
    onPreview(null);
  }, [onPreview]);

  const removeSession = useCallback(async (id: string) => {
    try {
      await RadioApi.deleteProgram(id);
      setSessions((s) => (s ? s.filter((p) => p.id !== id) : s));
      if (previewProgram === id) stopPreview();
      window.dispatchEvent(new CustomEvent("rs:programs-changed"));
    } catch {
      setErr("Could not delete the session.");
    }
  }, [previewProgram, stopPreview]);

  // Attach/replace a session's broadcast audio straight from its card
  // (upload → PATCH audio_url/audio_duration_sec → refresh everywhere).
  const attachSessionAudio = useCallback(async (programId: string, file: File) => {
    const invalid = validAudio(file);
    if (invalid) { setErr(invalid); return; }
    setAttachingId(programId);
    setErr(null);
    try {
      const durationSec = await probeAudioDuration(file);
      const res = await RadioApi.uploadAudio(file, durationSec);
      const body: UpdateRadioProgramBody = { audio_url: res.url };
      const d = res.duration_sec ?? durationSec;
      if (d != null) body.audio_duration_sec = d;
      const updated = await RadioApi.updateProgram(programId, body);
      setSessions((s) => (s ? s.map((p) => (p.id === updated.id ? updated : p)) : s));
      window.dispatchEvent(new CustomEvent("rs:programs-changed"));
    } catch {
      setErr("Could not attach audio. Please try again.");
    } finally {
      setAttachingId(null);
    }
  }, []);

  const cycleLoop = useCallback(async (program: RadioProgram) => {
    const idx = LOOP_MODES.indexOf(program.loop_mode);
    const nextMode = LOOP_MODES[(idx + 1) % LOOP_MODES.length]!;
    // optimistic
    setSessions((s) => (s ? s.map((p) => (p.id === program.id ? { ...p, loop_mode: nextMode } : p)) : s));
    try {
      const updated = await RadioApi.setLoop(program.id, nextMode);
      setSessions((s) => (s ? s.map((p) => (p.id === updated.id ? updated : p)) : s));
    } catch {
      setSessions((s) => (s ? s.map((p) => (p.id === program.id ? { ...p, loop_mode: program.loop_mode } : p)) : s));
      setErr("Could not change the loop mode.");
    }
  }, []);

  const addTrack = useCallback(async (programId: string, trackId: string) => {
    try {
      await RadioApi.addToPlaylist(programId, trackId);
      loadPlaylist(programId);
    } catch {
      setErr("Could not add the track.");
    }
  }, [loadPlaylist]);

  const removeItem = useCallback(async (programId: string, itemId: string) => {
    try {
      await RadioApi.removeFromPlaylist(programId, itemId);
      loadPlaylist(programId);
    } catch {
      setErr("Could not remove the track.");
    }
  }, [loadPlaylist]);

  // Reorder derives from the SAME `items` array the rows render from (passed by
  // the caller), so it can never act on a missing/stale playlists[] entry. The
  // reorder endpoint returns {ok:true} — NOT the playlist — so after saving we
  // re-fetch to reconcile instead of storing the response (storing that object
  // as a "playlist" is what used to crash the route with `.map is not a
  // function`). Everything is wrapped so a playlist mutation can only ever
  // surface the inline error, never the router error boundary.
  const reorder = useCallback(async (programId: string, items: RadioPlaylistItem[], from: number, to: number) => {
    try {
      if (!Array.isArray(items) || items.length === 0) { loadPlaylist(programId); return; }
      if (from < 0 || from >= items.length || to < 0 || to >= items.length) return;
      const next = items.slice();
      const [moved] = next.splice(from, 1);
      if (!moved) return;
      next.splice(to, 0, moved);
      setPlaylists((p) => ({ ...p, [programId]: next })); // optimistic
      await RadioApi.reorderPlaylist(programId, next.map((i) => i.id));
      loadPlaylist(programId); // reconcile with the server's order
    } catch {
      setPlaylists((p) => ({ ...p, [programId]: items })); // revert optimistic
      setErr("Could not reorder the playlist.");
    }
  }, [loadPlaylist]);

  // ── Live preview (client-side player honoring loop_mode) ──
  const playAt = useCallback((programId: string, index: number) => {
    const items = playlists[programId];
    const item = items?.[index];
    const el = audioRef.current;
    if (!item || !el) return;
    setPreviewProgram(programId);
    setPreviewIndex(index);
    onPreview(item.track.title);
    el.src = item.track.audio_url;
    void el.play().catch(() => {});
  }, [playlists, onPreview]);

  const playLive = useCallback(async (program: RadioProgram) => {
    const items = playlists[program.id];
    if (!items || items.length === 0) { setErr("This session has no tracks to play."); return; }
    setErr(null);
    // Server-authoritative go-live (best effort — preview runs regardless).
    // A 409 CONFLICT (another session already live) surfaces the server message,
    // which names the live session, in the panel's inline error.
    RadioApi.goLive(program.id)
      .then((updated) => {
        setSessions((s) => (s ? s.map((p) => (p.id === updated.id ? updated : p)) : s));
        window.dispatchEvent(new CustomEvent("rs:programs-changed"));
      })
      .catch((e: unknown) => setErr(apiErrMessage(e, "Could not go live. Please try again.")));
    playAt(program.id, 0);
  }, [playlists, playAt]);

  // Advance on `ended`, honoring the current session's loop_mode.
  const onEnded = useCallback(() => {
    if (!previewProgram) return;
    const program = sessions?.find((p) => p.id === previewProgram);
    const items = playlists[previewProgram];
    if (!program || !items || items.length === 0) { stopPreview(); return; }
    const mode = program.loop_mode;
    if (mode === "repeat_one") { playAt(previewProgram, previewIndex); return; }
    const next = previewIndex + 1;
    if (next < items.length) { playAt(previewProgram, next); return; }
    if (mode === "loop_all") { playAt(previewProgram, 0); return; }
    stopPreview();
  }, [previewProgram, previewIndex, sessions, playlists, playAt, stopPreview]);

  // Lock-screen metadata + next/prev transport for the active preview track
  // (Media Session API) so playback survives screen-lock on iPad/mobile Safari.
  useEffect(() => {
    const el = audioRef.current;
    if (!previewProgram || !el) return;
    const items = playlists[previewProgram];
    const item = items?.[previewIndex];
    if (!items || !item) return;
    const program = sessions?.find((p) => p.id === previewProgram);
    const n = items.length;
    setMediaSession(el, item.track.title, program?.title ?? "Nuru Radio", program?.artwork_url, {
      next: () => playAt(previewProgram, (previewIndex + 1) % n),
      prev: () => playAt(previewProgram, (previewIndex - 1 + n) % n),
    });
  }, [previewProgram, previewIndex, playlists, sessions, playAt]);

  const count = sessions?.length ?? 0;
  const airing = sessions?.find((s) => s.is_live) ?? null;
  const previewItem = previewProgram ? playlists[previewProgram]?.[previewIndex] : undefined;

  return (
    <Panel>
      {/* hidden preview element */}
      <audio
        ref={audioRef}
        onEnded={onEnded}
        playsInline
        onPlay={() => setMediaPlaybackState("playing")}
        onPause={() => setMediaPlaybackState(audioRef.current?.src ? "paused" : "none")}
        style={{ display: "none" }}
      />

      <SectionHead icon={ListMusic} title="Sessions" hint={loading ? "Loading…" : airing ? `On air: ${airing.title}` : `${count} session${count === 1 ? "" : "s"}`} />

      {/* Create session */}
      <div className="flex gap-2 mb-3">
        <input
          className="rs-in rounded-lg px-3"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
          placeholder="New session name (e.g. Sunrise Devotion)"
          style={{ flex: 1, minWidth: 0, height: 36, background: "rgba(255,255,255,0.05)", border: `1px solid ${PANEL_BORDER}`, color: TEXT, fontSize: 12, outline: "none" }}
        />
        <button onClick={() => void create()} disabled={creating || !name.trim()} className="rs-btn flex items-center gap-1.5 rounded-lg px-3" style={{ height: 36, background: GOLD, color: "#0A1120", fontSize: 12, fontWeight: 800, opacity: creating || !name.trim() ? 0.55 : 1 }}>
          {creating ? <Loader2 size={14} className="rs-spin" /> : <Plus size={14} />} Create
        </button>
      </div>

      {err && <div style={{ fontSize: 11, color: "#FCA5A5", marginBottom: 8 }}>{err}</div>}
      {previewItem && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 mb-3" style={{ background: "rgba(239,68,68,0.08)", border: `1px solid ${RED}44` }}>
          <Disc3 size={13} className="rs-live-dot" style={{ color: RED }} />
          <span className="truncate" style={{ fontSize: 11.5, color: "#FCA5A5" }}>On air preview: {previewItem.track.title}</span>
          <button onClick={stopPreview} className="rs-btn ml-auto flex items-center justify-center rounded-md shrink-0" style={{ width: 24, height: 24, background: "rgba(255,255,255,0.06)", color: DIM }}><Square size={12} /></button>
        </div>
      )}

      {/* Session cards */}
      <div className="flex flex-col gap-3" style={{ maxHeight: 480, overflowY: "auto" }}>
        {loading ? (
          <div className="flex items-center gap-2" style={{ fontSize: 12, color: DIM, padding: "6px 0" }}>
            <Loader2 size={14} className="rs-spin" /> Loading sessions…
          </div>
        ) : count === 0 ? (
          <div style={{ fontSize: 12, color: DIMMER, padding: "10px 0", textAlign: "center" }}>No sessions yet — create one above.</div>
        ) : (
          sessions?.map((s) => {
            const items = playlists[s.id] ?? [];
            const active = s.is_live || previewProgram === s.id;
            // The row actually airing on the REAL broadcast — only for the live
            // program, only when the icy metadata matches a track (never guess).
            const onAirIdx = liveProgramId === s.id && nowPlaying
              ? items.findIndex((it) => trackMatchesNowPlaying(nowPlaying, it.track))
              : -1;
            const LoopIcon = s.loop_mode === "repeat_one" ? Repeat1 : Repeat;
            const loopOn = s.loop_mode !== "none";
            return (
              <div key={s.id} className="rounded-xl" style={{ background: active ? "rgba(239,68,68,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${active ? RED + "44" : PANEL_BORDER}`, padding: 12 }}>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 28, height: 28, background: active ? RED : "rgba(230,198,110,0.14)", color: active ? "#fff" : GOLD }}>
                    {active ? <Disc3 size={14} className="rs-live-dot" /> : <ListMusic size={14} />}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="truncate" style={{ fontSize: 12.5, fontWeight: 700 }}>{s.title}</div>
                    <div style={{ fontSize: 10, color: DIM }}>{items.length} item{items.length === 1 ? "" : "s"}{s.audio_url ? ` · audio ${fmtClock(s.audio_duration_sec) ?? "✓"}` : ""}{s.is_live ? " · ON AIR" : previewProgram === s.id ? " · PREVIEW" : ""}</div>
                  </div>
                  <button onClick={() => onEdit(s)} title="Edit session" className="rs-btn flex items-center justify-center rounded-lg shrink-0" style={{ width: 26, height: 26, background: "rgba(230,198,110,0.10)", color: GOLD, border: `1px solid ${GOLD}33` }}>
                    <Pencil size={12} />
                  </button>
                  <label title={s.audio_url ? "Replace session audio" : "Attach session audio"} className="rs-btn flex items-center gap-1 rounded-lg px-2 py-1 shrink-0" style={{ fontSize: 10, fontWeight: 700, background: "rgba(230,198,110,0.10)", color: GOLD, border: `1px solid ${GOLD}33`, cursor: attachingId === s.id ? "default" : "pointer", opacity: attachingId === s.id ? 0.6 : 1 }}>
                    {attachingId === s.id ? <Loader2 size={11} className="rs-spin" /> : <Music size={11} />}
                    {attachingId === s.id ? "Uploading…" : s.audio_url ? "Replace audio" : "Attach audio"}
                    <input type="file" accept={AUDIO_ACCEPT} disabled={attachingId === s.id} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void attachSessionAudio(s.id, f); }} style={hiddenInput} />
                  </label>
                  <button onClick={() => void cycleLoop(s)} title={`Loop: ${LOOP_LABEL[s.loop_mode]}`} className="rs-btn flex items-center gap-1 rounded-lg px-2 py-1 shrink-0" style={{ fontSize: 10, fontWeight: 700, background: loopOn ? "rgba(123,227,163,0.16)" : "rgba(255,255,255,0.05)", color: loopOn ? "#7BE3A3" : DIM, border: `1px solid ${loopOn ? "#7BE3A366" : PANEL_BORDER}` }}>
                    <LoopIcon size={11} /> {LOOP_LABEL[s.loop_mode]}
                  </button>
                  {previewProgram === s.id ? (
                    <button onClick={stopPreview} className="rs-btn flex items-center gap-1 rounded-lg px-2.5 py-1 shrink-0" style={{ fontSize: 10.5, fontWeight: 700, background: RED, color: "#fff", border: `1px solid ${RED}` }}>
                      <Square size={11} /> Stop
                    </button>
                  ) : (
                    <button onClick={() => void playLive(s)} disabled={items.length === 0} className="rs-btn flex items-center gap-1 rounded-lg px-2.5 py-1 shrink-0" style={{ fontSize: 10.5, fontWeight: 700, background: "rgba(230,198,110,0.14)", color: GOLD, border: `1px solid ${GOLD}44`, opacity: items.length === 0 ? 0.4 : 1 }}>
                      <Play size={11} /> Play live
                    </button>
                  )}
                  <button onClick={() => void removeSession(s.id)} title="Delete session" className="rs-btn flex items-center justify-center rounded-lg shrink-0" style={{ width: 26, height: 26, background: "rgba(255,255,255,0.05)", color: DIM }}><X size={12} /></button>
                </div>

                {/* ordered items — "after this, play this" */}
                <div className="flex flex-col gap-1">
                  {items.length === 0 && <div style={{ fontSize: 11, color: DIMMER, padding: "6px 0" }}>Empty — add tracks from the library above.</div>}
                  {items.map((it, idx) => {
                    const meta = KIND_META[it.track.kind];
                    const nowIdx = previewProgram === s.id && previewIndex === idx;
                    const onAir = idx === onAirIdx;
                    return (
                      <div key={it.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: nowIdx ? "rgba(239,68,68,0.12)" : onAir ? "rgba(230,198,110,0.12)" : "rgba(255,255,255,0.03)", border: `1px solid ${nowIdx ? RED + "44" : onAir ? GOLD + "55" : "transparent"}` }}>
                        <span className="rs-tnum flex items-center justify-center rounded shrink-0" style={{ width: 18, height: 18, background: "rgba(255,255,255,0.08)", fontSize: 10, fontWeight: 700, color: nowIdx ? "#FCA5A5" : onAir ? GOLD : DIM }}>{idx + 1}</span>
                        <span className="rounded-full shrink-0" style={{ width: 6, height: 6, background: meta.color }} />
                        <span className="truncate" style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: nowIdx || onAir ? 700 : 500 }}>{it.track.title}</span>
                        {onAir && (
                          <span className="inline-flex items-center gap-1 shrink-0" style={{ fontSize: 9, fontWeight: 800, color: GOLD, letterSpacing: "0.06em" }}>
                            <span className="rs-live-dot rounded-full" style={{ width: 6, height: 6, background: GOLD }} /> ON AIR
                          </span>
                        )}
                        {nowIdx && <span className="shrink-0" style={{ fontSize: 9, fontWeight: 800, color: "#FCA5A5" }}>NOW</span>}
                        <span className="rs-tnum shrink-0" style={{ fontFamily: MONO, fontSize: 10.5, color: onAir ? GOLD : DIM, minWidth: 34, textAlign: "right" }}>{fmtClock(it.track.duration_sec) ?? "—"}</span>
                        <button onClick={() => void reorder(s.id, items, idx, idx - 1)} disabled={idx === 0} title="Move up" className="rs-btn shrink-0" style={{ background: "none", border: "none", color: DIM, opacity: idx === 0 ? 0.3 : 1, cursor: idx === 0 ? "default" : "pointer", padding: 0 }}><ArrowUp size={13} /></button>
                        <button onClick={() => void reorder(s.id, items, idx, idx + 1)} disabled={idx === items.length - 1} title="Move down" className="rs-btn shrink-0" style={{ background: "none", border: "none", color: DIM, opacity: idx === items.length - 1 ? 0.3 : 1, cursor: idx === items.length - 1 ? "default" : "pointer", padding: 0 }}><ArrowDown size={13} /></button>
                        <button onClick={() => void removeItem(s.id, it.id)} title="Remove from session" className="rs-btn shrink-0" style={{ background: "none", border: "none", color: DIM, cursor: "pointer", padding: 0 }}><X size={12} /></button>
                      </div>
                    );
                  })}
                </div>

                {/* append next piece */}
                <AddTrackSelect tracks={library} onPick={(trackId) => void addTrack(s.id, trackId)} />
              </div>
            );
          })
        )}
      </div>
    </Panel>
  );
}

// The make's dashed "+ Add track to this session…" select, fed by the real library.
function AddTrackSelect({ tracks, onPick }: { tracks: RadioTrack[]; onPick: (trackId: string) => void }): ReactElement {
  return (
    <select
      value=""
      onChange={(e) => { const v = e.target.value; if (v) onPick(v); }}
      className="rs-btn w-full rounded-lg mt-2"
      style={{ height: 32, background: "rgba(255,255,255,0.05)", border: `1px dashed ${PANEL_BORDER}`, color: GOLD, fontSize: 11.5, fontWeight: 700, padding: "0 8px" }}
    >
      <option value="" style={optStyle}>+ Add track to this session…</option>
      {tracks.map((t) => <option key={t.id} value={t.id} style={optStyle}>{KIND_META[t.kind].label} · {t.title}</option>)}
    </select>
  );
}

/* ═══════════ REAL live listen + mic capture (Web Audio / mic bridge) ═══════════ */

// Persisted studio hardware/listen preferences.
const MIC_DEVICE_KEY = "rs.mic.device";
const MIC_GAIN_KEY = "rs.mic.gain";
const LISTEN_VOL_KEY = "rs.listen.volume";

function lsRead(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsReadNum(key: string, fallback: number): number {
  const raw = lsRead(key);
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
function lsWrite(key: string, value: string | null): void {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage unavailable (private mode) */ }
}

// 0–100 boost display → 1.0–8.0 linear gain (≈ 0 to +18 dB).
function boostToGain(pct: number): number {
  return 1 + (Math.min(100, Math.max(0, pct)) / 100) * 7;
}

// Friendly messages for the mic bridge's application close codes.
const MIC_CLOSE_MSG: Record<number, string> = {
  4001: "Session expired — reload the page and sign in again.",
  4003: "You don't have permission to use the studio mic.",
  4004: "The mic bridge isn't configured on the server.",
  4008: "No live session — take one live first.",
  4409: "Someone is already on mic (maybe the iPad).",
};

type MicPhase = "idle" | "ready" | "connecting" | "live";

interface MicEngine {
  supported: boolean;
  devices: MediaDeviceInfo[];
  deviceId: string | null;
  pickDevice: (id: string | null) => void;
  ready: boolean;
  connecting: boolean;
  onAir: boolean;
  elapsed: number;
  meter: number;
  muted: boolean;
  toggleMute: () => void;
  noise: boolean;
  echo: boolean;
  agc: boolean;
  toggleFlag: (k: "noise" | "echo" | "agc") => void;
  gainPct: number;
  changeGain: (pct: number) => void;
  micErr: string | null;
  enable: () => void;
  goOnMic: () => void;
  offMic: () => void;
}

// Real microphone engine: device enumeration + getUserMedia capture with
// broadcast constraints, a Web Audio boost/meter graph, and the MediaRecorder →
// mic-bridge WebSocket transport. The capture path is
//   source → gain (boost) → analyser (meter) → MediaStreamDestination,
// and the recorder records the DESTINATION stream — so boost applies live and
// device hot-swaps never interrupt an on-air recorder.
function useMicEngine(canGoLive: boolean): MicEngine {
  const supported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof MediaRecorder !== "undefined" &&
    typeof AudioContext !== "undefined";

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(() => lsRead(MIC_DEVICE_KEY));
  const [phase, setPhase] = useState<MicPhase>("idle");
  const [muted, setMuted] = useState(false);
  // Broadcast default: all input processing OFF — the raw signal goes out.
  const [noise, setNoise] = useState(false);
  const [echo, setEcho] = useState(false);
  const [agc, setAgc] = useState(false);
  const [gainPct, setGainPct] = useState<number>(() => Math.min(100, Math.max(0, lsReadNum(MIC_GAIN_KEY, 30))));
  const [meter, setMeter] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [micErr, setMicErr] = useState<string | null>(null);

  // Refs mirror whatever the stable callbacks need (no stale closures).
  const phaseRef = useRef<MicPhase>("idle");
  const deviceIdRef = useRef<string | null>(deviceId);
  const flagsRef = useRef({ noise: false, echo: false, agc: false });
  const gainPctRef = useRef(gainPct);
  const mutedRef = useRef(false);

  // Web Audio graph.
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const rafRef = useRef(0);

  // Transport.
  const wsRef = useRef<WebSocket | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const queueRef = useRef<ArrayBuffer[]>([]);
  const ackedRef = useRef(false);
  const stoppingRef = useRef(false);
  const reconnectedRef = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectRef = useRef<(() => void) | null>(null);
  const acquireRef = useRef<((id: string | null, n: boolean, e: boolean, a: boolean) => Promise<boolean>) | null>(null);

  const setPhaseBoth = useCallback((p: MicPhase): void => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  // ~30 fps RMS meter off the analyser (post-boost; keeps running while muted).
  const startMeter = useCallback((): void => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    cancelAnimationFrame(rafRef.current);
    const data = new Uint8Array(analyser.fftSize);
    let last = 0;
    const tick = (t: number): void => {
      rafRef.current = requestAnimationFrame(tick);
      if (t - last < 33) return;
      last = t;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = ((data[i] ?? 128) - 128) / 128;
        sum += v * v;
      }
      setMeter(Math.min(1, Math.sqrt(sum / data.length) * 2.8));
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  // Acquire (or re-acquire) the input stream with explicit constraints and plug
  // it into the persistent gain→analyser→destination tail.
  const acquire = useCallback(async (id: string | null, n: boolean, e: boolean, a: boolean): Promise<boolean> => {
    if (!supported) return false;
    setMicErr(null);
    try {
      const base: MediaTrackConstraints = {
        echoCancellation: e,
        noiseSuppression: n,
        autoGainControl: a,
        channelCount: 1,
        sampleRate: 48000,
      };
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: id ? { ...base, deviceId: { exact: id } } : base });
      } catch (err) {
        if (!id) throw err;
        // Chosen device vanished — auto-fallback to the system default.
        stream = await navigator.mediaDevices.getUserMedia({ audio: base });
        deviceIdRef.current = null;
        setDeviceId(null);
        lsWrite(MIC_DEVICE_KEY, null);
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      let ctx = ctxRef.current;
      if (!ctx) {
        ctx = new AudioContext();
        ctxRef.current = ctx;
        const g = ctx.createGain();
        const an = ctx.createAnalyser();
        an.fftSize = 1024;
        an.smoothingTimeConstant = 0.5;
        const dest = ctx.createMediaStreamDestination();
        g.connect(an);
        if (!mutedRef.current) an.connect(dest);
        gainNodeRef.current = g;
        analyserRef.current = an;
        destRef.current = dest;
      }
      void ctx.resume().catch(() => {});
      srcRef.current?.disconnect();
      const src = ctx.createMediaStreamSource(stream);
      src.connect(gainNodeRef.current!);
      srcRef.current = src;
      gainNodeRef.current!.gain.value = boostToGain(gainPctRef.current);
      // If the device is unplugged mid-run, fall back to the default input
      // without dropping the destination stream (the recorder keeps rolling).
      const track = stream.getAudioTracks()[0];
      track?.addEventListener("ended", () => {
        if (stoppingRef.current || streamRef.current !== stream) return;
        const f = flagsRef.current;
        void acquireRef.current?.(null, f.noise, f.echo, f.agc);
      });
      startMeter();
      if (phaseRef.current === "idle") setPhaseBoth("ready");
      return true;
    } catch {
      setMicErr("Could not access the microphone — check the browser's mic permission.");
      return false;
    }
  }, [supported, startMeter, setPhaseBoth]);
  useEffect(() => { acquireRef.current = acquire; });

  const refreshDevices = useCallback(async (): Promise<void> => {
    if (!supported) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const inputs = all.filter((d) => d.kind === "audioinput" && d.deviceId);
      setDevices(inputs);
      const cur = deviceIdRef.current;
      if (cur && !inputs.some((d) => d.deviceId === cur)) {
        deviceIdRef.current = null;
        setDeviceId(null);
        lsWrite(MIC_DEVICE_KEY, null);
      }
    } catch { /* enumeration unavailable */ }
  }, [supported]);

  // Plug-and-play: re-enumerate the moment the OS sees a device come or go.
  useEffect(() => {
    void refreshDevices();
    if (!supported) return;
    const h = (): void => { void refreshDevices(); };
    navigator.mediaDevices.addEventListener("devicechange", h);
    return () => navigator.mediaDevices.removeEventListener("devicechange", h);
  }, [refreshDevices, supported]);

  // First user gesture: unlock permission + device labels, start monitoring.
  const enable = useCallback((): void => {
    const f = flagsRef.current;
    void acquire(deviceIdRef.current, f.noise, f.echo, f.agc).then((ok) => {
      if (ok) void refreshDevices(); // labels are only revealed post-permission
    });
  }, [acquire, refreshDevices]);

  const pickDevice = useCallback((id: string | null): void => {
    deviceIdRef.current = id;
    setDeviceId(id);
    lsWrite(MIC_DEVICE_KEY, id);
    if (phaseRef.current !== "idle") {
      const f = flagsRef.current;
      void acquire(id, f.noise, f.echo, f.agc); // hot-swap — safe even on air
    }
  }, [acquire]);

  // Noise/echo/AGC need a re-acquire to apply; they lock while on air.
  const toggleFlag = useCallback((k: "noise" | "echo" | "agc"): void => {
    if (phaseRef.current === "live" || phaseRef.current === "connecting") return;
    const f = { ...flagsRef.current, [k]: !flagsRef.current[k] };
    flagsRef.current = f;
    setNoise(f.noise);
    setEcho(f.echo);
    setAgc(f.agc);
    if (phaseRef.current === "ready") void acquire(deviceIdRef.current, f.noise, f.echo, f.agc);
  }, [acquire]);

  // Mute detaches the analyser→destination hop: the broadcast goes silent but
  // the meter (fed upstream of the destination) keeps showing the live input.
  const toggleMute = useCallback((): void => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    const an = analyserRef.current;
    const dest = destRef.current;
    if (!an || !dest) return;
    try {
      if (next) an.disconnect(dest);
      else an.connect(dest);
    } catch { /* already in the requested state */ }
  }, []);

  // Boost applies live — including on air (the recorder sits after the gain).
  const changeGain = useCallback((pct: number): void => {
    gainPctRef.current = pct;
    setGainPct(pct);
    lsWrite(MIC_GAIN_KEY, String(pct));
    const g = gainNodeRef.current;
    if (g) g.gain.value = boostToGain(pct);
  }, []);

  const stopRecorder = useCallback((): void => {
    const rec = recRef.current;
    recRef.current = null;
    if (rec && rec.state !== "inactive") {
      try { rec.stop(); } catch { /* already stopped */ }
    }
  }, []);

  // Open the mic-bridge WebSocket + a fresh MediaRecorder over the destination
  // stream. Encoded frames queue until the server's {ok:true} ack, then flush.
  const connectAndRecord = useCallback((): void => {
    const dest = destRef.current;
    if (!dest) return;
    const token = getAccessToken(); // read at connect time — post any refresh
    if (!token) {
      setMicErr("Session expired — reload the page and sign in again.");
      setPhaseBoth("ready");
      return;
    }
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/mp4";
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${window.location.host}/v1/admin/radio/mic-bridge?token=${encodeURIComponent(token)}&ct=${encodeURIComponent(mime)}`,
    );
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    ackedRef.current = false;
    queueRef.current = [];
    setPhaseBoth("connecting");

    ws.onmessage = (ev: MessageEvent): void => {
      if (typeof ev.data !== "string" || wsRef.current !== ws) return;
      try {
        const msg = JSON.parse(ev.data) as { ok?: boolean };
        if (msg.ok) {
          ackedRef.current = true;
          for (const buf of queueRef.current) ws.send(buf);
          queueRef.current = [];
          setMicErr(null);
          setPhaseBoth("live");
        }
      } catch { /* non-JSON frame — ignore */ }
    };

    ws.onclose = (ev: CloseEvent): void => {
      if (wsRef.current !== ws) return; // superseded / user-stopped
      wsRef.current = null;
      stopRecorder();
      if (stoppingRef.current) return;
      const friendly = MIC_CLOSE_MSG[ev.code];
      if (friendly) {
        setMicErr(friendly);
        setPhaseBoth("ready");
        return;
      }
      // Unexpected drop — rebuild the recorder + socket once after 2s (the
      // capture graph is still alive; a MediaRecorder can't resume, so rebuild).
      if (!reconnectedRef.current) {
        reconnectedRef.current = true;
        setMicErr("Mic link dropped — reconnecting…");
        setPhaseBoth("connecting");
        reconnectTimer.current = setTimeout(() => {
          reconnectTimer.current = null;
          if (!stoppingRef.current && streamRef.current) connectRef.current?.();
          else setPhaseBoth(streamRef.current ? "ready" : "idle");
        }, 2000);
      } else {
        setMicErr("The mic link was lost. Go on mic again to continue.");
        setPhaseBoth("ready");
      }
    };

    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(dest.stream, { mimeType: mime, audioBitsPerSecond: 128_000 });
    } catch {
      setMicErr("This browser can't encode mic audio for the bridge.");
      wsRef.current = null;
      try { ws.close(1000); } catch { /* noop */ }
      setPhaseBoth("ready");
      return;
    }
    recRef.current = rec;
    rec.ondataavailable = (e: BlobEvent): void => {
      if (!e.data || e.data.size === 0) return;
      void e.data.arrayBuffer().then((buf) => {
        const sock = wsRef.current;
        if (ackedRef.current && sock && sock.readyState === WebSocket.OPEN) sock.send(buf);
        else if (!ackedRef.current) queueRef.current.push(buf);
      });
    };
    rec.start(250);
  }, [setPhaseBoth, stopRecorder]);
  useEffect(() => { connectRef.current = connectAndRecord; });

  const goOnMic = useCallback((): void => {
    if (!supported || !canGoLive) return;
    if (phaseRef.current === "live" || phaseRef.current === "connecting") return;
    setMicErr(null);
    stoppingRef.current = false;
    reconnectedRef.current = false;
    setElapsed(0);
    if (streamRef.current) {
      connectAndRecord();
    } else {
      const f = flagsRef.current;
      void acquire(deviceIdRef.current, f.noise, f.echo, f.agc).then((ok) => {
        if (!ok) return;
        void refreshDevices();
        connectAndRecord();
      });
    }
  }, [supported, canGoLive, acquire, refreshDevices, connectAndRecord]);

  const offMic = useCallback((): void => {
    stoppingRef.current = true;
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    stopRecorder();
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      try { ws.close(1000); } catch { /* already closed */ }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    srcRef.current?.disconnect();
    srcRef.current = null;
    cancelAnimationFrame(rafRef.current);
    setMeter(0);
    setPhaseBoth("idle");
  }, [stopRecorder, setPhaseBoth]);

  // On-air elapsed readout.
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // The live session ended under us — release the mic (the harbor is gone).
  useEffect(() => {
    if (!canGoLive && (phaseRef.current === "live" || phaseRef.current === "connecting")) {
      offMic();
      setMicErr("The live session ended — mic is off.");
    }
  }, [canGoLive, offMic]);

  // Full teardown on unmount.
  useEffect(() => () => {
    stoppingRef.current = true;
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") { try { rec.stop(); } catch { /* noop */ } }
    try { wsRef.current?.close(1000); } catch { /* noop */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    cancelAnimationFrame(rafRef.current);
    void ctxRef.current?.close().catch(() => {});
  }, []);

  return {
    supported,
    devices,
    deviceId,
    pickDevice,
    ready: phase !== "idle",
    connecting: phase === "connecting",
    onAir: phase === "live",
    elapsed,
    meter,
    muted,
    toggleMute,
    noise,
    echo,
    agc,
    toggleFlag,
    gainPct,
    changeGain,
    micErr,
    enable,
    goOnMic,
    offMic,
  };
}

/* ── Listen panel — REAL playback of the live mounts ── */

type ListenFeed = "broadcast" | "monitor" | "cue";
const LISTEN_FEEDS: ListenFeed[] = ["broadcast", "monitor", "cue"];
const FEED_META: Record<ListenFeed, { label: string; caption: string }> = {
  broadcast: { label: "Broadcast", caption: "Exactly what listeners hear (~6 s behind)." },
  monitor: { label: "Monitor", caption: "Full on-air mix minus the mic — follows presets/ducking." },
  cue: { label: "Cue", caption: "Pre-fader music, always full." },
};

// Live mounts derive from the program's hls_url ("…/listen/s_<id>.mp3"):
// broadcast = as-is · monitor = "mon_<id>" · cue = "cue_<id>". The mounts only
// exist while the session is live.
function liveFeedUrl(hlsUrl: string, feed: ListenFeed): string {
  if (feed === "broadcast") return hlsUrl;
  const prefix = feed === "monitor" ? "mon_" : "cue_";
  return hlsUrl.replace(/\/s_([^/]*)$/, `/${prefix}$1`);
}

function ListenPanel({ program, micOnAir }: { program: RadioProgram | null; micOnAir: boolean }): ReactElement {
  const [feed, setFeed] = useState<ListenFeed>("broadcast");
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState<number>(() => Math.min(1, Math.max(0, lsReadNum(LISTEN_VOL_KEY, 0.9))));
  const [note, setNote] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const intentRef = useRef(false);
  const retriesRef = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUrlRef = useRef<string | null>(null);
  const playingProgramRef = useRef<string | null>(null);
  const feedRef = useRef<ListenFeed>("broadcast");
  useEffect(() => { feedRef.current = feed; }, [feed]);

  // One shared audio element for all three feeds; chips swap `src` live.
  const getAudio = useCallback((): HTMLAudioElement => {
    let el = audioRef.current;
    if (!el) {
      el = new Audio();
      el.preload = "none";
      audioRef.current = el;
    }
    return el;
  }, []);

  const stop = useCallback((keepNote?: boolean): void => {
    intentRef.current = false;
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    const el = audioRef.current;
    if (el) { el.pause(); el.removeAttribute("src"); el.load(); }
    setPlaying(false);
    setUnavailable(false);
    if (!keepNote) setNote(null);
    clearMediaSession();
  }, []);

  // Auto-retry lite: on error/ended while intent is "playing", retry after 2s
  // up to 3 times, then show the inline "stream unavailable" note.
  useEffect(() => {
    const el = getAudio();
    const onFail = (): void => {
      if (!intentRef.current || retryTimer.current) return;
      if (retriesRef.current < 3) {
        retriesRef.current += 1;
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          const url = lastUrlRef.current;
          if (!intentRef.current || !url) return;
          el.src = url;
          void el.play().catch(() => onFail());
        }, 2000);
      } else {
        intentRef.current = false;
        setPlaying(false);
        setUnavailable(true);
        setMediaPlaybackState("none");
      }
    };
    const onPlaying = (): void => { retriesRef.current = 0; setUnavailable(false); };
    el.addEventListener("error", onFail);
    el.addEventListener("ended", onFail);
    el.addEventListener("playing", onPlaying);
    return () => {
      el.removeEventListener("error", onFail);
      el.removeEventListener("ended", onFail);
      el.removeEventListener("playing", onPlaying);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      el.pause();
      el.removeAttribute("src");
    };
  }, [getAudio]);

  const start = useCallback((f: ListenFeed): void => {
    if (!program?.is_live || !program.hls_url) return;
    // Feedback guard: BROADCAST/MONITOR contain (or accompany) the mic.
    if (micOnAir && f !== "cue") {
      setNote("Paused to prevent feedback — use CUE while on mic.");
      return;
    }
    const el = getAudio();
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    const url = liveFeedUrl(program.hls_url, f);
    lastUrlRef.current = url;
    playingProgramRef.current = program.id;
    intentRef.current = true;
    retriesRef.current = 0;
    setFeed(f);
    setPlaying(true);
    setUnavailable(false);
    setNote(null);
    el.volume = volume;
    el.src = url;
    setMediaSession(el, `${program.title} — ${FEED_META[f].label}`, "Nuru Radio", program.artwork_url);
    void el.play().catch(() => {
      // Some failures reject without an `error` event — nudge the retry path.
      el.dispatchEvent(new Event("error"));
    });
  }, [program, micOnAir, volume, getAudio]);

  // Mic went on air — kill the feedback-prone feeds (CUE stays allowed).
  useEffect(() => {
    if (micOnAir && intentRef.current && feedRef.current !== "cue") {
      stop(true);
      setNote("Paused to prevent feedback — use CUE while on mic.");
    }
  }, [micOnAir, stop]);

  // Selected program switched or went off air — the old mount is gone; stop.
  const liveKey = program?.is_live && program.hls_url ? program.id : null;
  useEffect(() => {
    if (intentRef.current && playingProgramRef.current !== liveKey) stop();
  }, [liveKey, stop]);

  const changeVolume = useCallback((v: number): void => {
    const clamped = Math.min(1, Math.max(0, v));
    setVolume(clamped);
    lsWrite(LISTEN_VOL_KEY, String(clamped));
    const el = audioRef.current;
    if (el) el.volume = clamped;
  }, []);

  const canListen = !!(program?.is_live && program.hls_url);

  return (
    <Panel>
      <SectionHead icon={Headphones} title="Listen" hint={canListen ? (playing ? `Playing · ${FEED_META[feed].label}` : "Live feeds") : "Off air"} />
      <div style={!canListen ? { opacity: 0.5, pointerEvents: "none" } : undefined}>
        <div className="flex gap-2 flex-wrap mb-2">
          {LISTEN_FEEDS.map((f) => {
            const on = feed === f;
            const blocked = micOnAir && f !== "cue";
            return (
              <button
                key={f}
                onClick={() => {
                  if (playing) start(f);
                  else if (blocked) setNote("Use CUE while on mic — the other feeds would feed back.");
                  else { setFeed(f); setNote(null); }
                }}
                className="rs-btn rounded-lg px-3 py-1.5"
                style={{ fontSize: 11.5, fontWeight: 700, background: on ? GOLD : "rgba(255,255,255,0.05)", color: on ? "#0A1120" : blocked ? DIMMER : DIM, border: `1px solid ${on ? GOLD : PANEL_BORDER}` }}
              >
                {FEED_META[f].label}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: DIM, marginBottom: 12, lineHeight: 1.5 }}>{FEED_META[feed].caption}</div>

        {note && <div className="rs-reveal" style={{ fontSize: 11.5, color: GOLD, marginBottom: 10 }}>{note}</div>}
        {unavailable && <div className="rs-reveal" style={{ fontSize: 11.5, color: "#FCA5A5", marginBottom: 10 }}>Stream unavailable — check that the session is on air, then press play again.</div>}

        <div className="flex items-center gap-3 flex-wrap">
          {playing ? (
            <button onClick={() => stop()} className="rs-btn flex items-center gap-2 rounded-xl px-4" style={{ height: 40, background: "rgba(239,68,68,0.14)", color: "#FCA5A5", border: `1px solid ${RED}55`, fontSize: 12.5, fontWeight: 700 }}>
              <Square size={14} /> Stop
            </button>
          ) : (
            <button onClick={() => start(feed)} disabled={!canListen} className="rs-btn flex items-center gap-2 rounded-xl px-4" style={{ height: 40, background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`, color: "#0A1120", fontSize: 12.5, fontWeight: 800, border: "none" }}>
              <Play size={14} /> Play
            </button>
          )}
          <div className="flex items-center gap-2" style={{ flex: 1, minWidth: 150 }}>
            <Volume2 size={14} style={{ color: DIM }} />
            <input type="range" min={0} max={100} value={Math.round(volume * 100)} onChange={(e) => changeVolume(Number(e.target.value) / 100)} aria-label="Listen volume" style={{ flex: 1, accentColor: GOLD_DEEP }} />
            <span className="rs-tnum" style={{ fontFamily: MONO, fontSize: 11.5, color: DIM, width: 34, textAlign: "right" }}>{Math.round(volume * 100)}%</span>
          </div>
        </div>
      </div>
      {!canListen && <div style={{ fontSize: 11, color: DIM, marginTop: 10 }}>Take a session live to listen.</div>}
    </Panel>
  );
}

export default RadioStudio;
