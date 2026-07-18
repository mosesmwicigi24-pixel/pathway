// Dashboard — "The Pulse". Recomposed around movement, not stock: a momentum
// hero (every number carries a delta or context line), a LIVE NOW strip (radio
// on-air / next broadcast + next gathering + urgent care signals), a unified
// NEEDS YOU action queue ranked across the whole app, THE FLOCK (stacked band
// bar + attendance sparkline), a PULSE OF THE WORD content row (each domain
// appears exactly once — one giving tile, no vanity chips), and an aggregated
// activity feed (consecutive same-kind audit events collapse into one row).
// Every zone fetches independently, renders a skeleton while loading, and a
// quiet dash on failure — a broken endpoint never breaks the page.
import { useEffect, useMemo, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity as ActivityIcon, AlertTriangle, ArrowRight, Award, BookMarked, BookOpen,
  CalendarDays, CheckCircle2, ChevronRight, ClipboardCheck, Coins, DoorOpen, Eye,
  Film, HeartPulse, Radio as RadioIcon, ShieldCheck, Sparkles, UserPlus, Users,
  type LucideIcon,
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AdminApi, ConfigApi, CurriculumApi, GrowthAdminApi, MeApi, MediaApi, OpsApi, RadioApi,
  type AdminLevel, type AuditRow, type CalendarOccurrence, type ConsentRow,
  type EngagementReport, type FundSummary, type LevelReviewRow, type MemberIntelligence,
  type OverviewKpis, type PlanRow, type PulseSignal, type RadioProgram,
  type AttendanceTrendPoint, type RecentEventRow,
} from "../../api/client";

// On-brand band colors (iPad palette): bright LED green for thriving, luminous
// brand navy for steady, gold for watch, luminous red for at-risk.
const BAND_META: { key: string; name: string; color: string }[] = [
  { key: "thriving", name: "Thriving", color: "#22c55e" },
  { key: "steady", name: "Steady", color: "#1d4e86" },
  { key: "watch", name: "Watch", color: "#c89b3c" },
  { key: "at_risk", name: "At risk", color: "#f0405f" },
];

// ── Small helpers ───────────────────────────────────────────────────────────
function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24); if (d === 1) return "Yesterday";
  return `${d} d ago`;
}
function untilLabel(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return "now";
  const min = Math.round(ms / 60000);
  if (min < 60) return `in ${Math.max(1, min)} min`;
  const h = Math.round(ms / 3600000);
  if (h < 48) return `in ${h} h`;
  return `in ${Math.round(h / 24)} d`;
}
function daysSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}
function humanize(action: string): string {
  const s = action.replace(/[._]/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const money = (minor: number, currency: string | null): string =>
  `${currency ?? "KES"} ${Math.round(minor / 100).toLocaleString()}`;
const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ── Per-endpoint zone state: each zone loads independently; a failed zone
//    renders a quiet dash and never breaks the page. ──────────────────────────
type Zone<T> = { s: "loading" } | { s: "ready"; d: T } | { s: "error" };
function useZone<T>(fetcher: () => Promise<T>): Zone<T> {
  const [zone, setZone] = useState<Zone<T>>({ s: "loading" });
  useEffect(() => {
    let alive = true;
    fetcher()
      .then((d) => { if (alive) setZone({ s: "ready", d }); })
      .catch(() => { if (alive) setZone({ s: "error" }); });
    return () => { alive = false; };
    // Fetchers are stable one-shot loads; run once on mount by design.
  }, []);
  return zone;
}

function Skel({ w, h = 12, dark = false }: { w: number | string; h?: number; dark?: boolean }): ReactElement {
  return (
    <span
      className="animate-pulse inline-block rounded-md"
      style={{ width: w, height: h, background: dark ? "rgba(255,255,255,0.14)" : "rgba(11,31,51,0.08)" }}
    />
  );
}

function PulseDot({ color, animate = true }: { color: string; animate?: boolean }): ReactElement {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: 8, height: 8 }}>
      {animate ? (
        <span className="animate-ping absolute inline-flex rounded-full" style={{ width: 8, height: 8, background: color, opacity: 0.55 }} />
      ) : null}
      <span className="relative inline-flex rounded-full" style={{ width: 8, height: 8, background: color }} />
    </span>
  );
}

// Icon + tint per audit action kind (varied icons for the aggregated feed).
function actionMeta(action: string): { icon: LucideIcon; bg: string; fg: string } {
  const a = action.toLowerCase();
  if (a.includes("enrol")) return { icon: UserPlus, bg: "var(--tint-navy-bg)", fg: "var(--tint-navy-fg)" };
  if (a.includes("certificate")) return { icon: Award, bg: "var(--tint-green-bg)", fg: "var(--tint-green-fg)" };
  if (a.includes("reflection") || a.includes("review")) return { icon: ClipboardCheck, bg: "var(--tint-rose-bg)", fg: "var(--tint-rose-fg)" };
  if (a.includes("module") || a.includes("level") || a.includes("quiz") || a.includes("publish")) return { icon: BookOpen, bg: "var(--tint-gold-bg)", fg: "var(--tint-gold-fg)" };
  if (a.includes("event") || a.includes("series") || a.includes("moment")) return { icon: CalendarDays, bg: "var(--tint-amber-bg)", fg: "var(--tint-amber-fg)" };
  if (a.includes("radio") || a.includes("broadcast") || a.includes("mixer")) return { icon: RadioIcon, bg: "var(--tint-violet-bg)", fg: "var(--tint-violet-fg)" };
  if (a.includes("cell")) return { icon: Users, bg: "var(--tint-violet-bg)", fg: "var(--tint-violet-fg)" };
  if (a.includes("member") || a.includes("user") || a.includes("password")) return { icon: UserPlus, bg: "var(--tint-navy-bg)", fg: "var(--tint-navy-fg)" };
  return { icon: ActivityIcon, bg: "var(--tint-navy-bg)", fg: "var(--tint-navy-fg)" };
}

type NeedTone = "red" | "orange" | "yellow";
const TONE_COLOR: Record<NeedTone, string> = { red: "#f0405f", orange: "#e08a1e", yellow: "#c89b3c" };
interface NeedRow { key: string; tone: NeedTone; icon: LucideIcon; label: string; hint: string; route: string }

interface ActivityGroup { id: number; action: string; count: number; actors: string[]; entity: string | null; latest: string }

const CARD: CSSProperties = {
  background: "#fff", border: "1px solid var(--border)", boxShadow: "0 6px 18px rgba(10,37,64,0.06)",
};

export function Dashboard(): ReactElement {
  const navigate = useNavigate();

  // ── Independent zone fetches (all fire in parallel on mount) ──────────────
  const overview = useZone<OverviewKpis>(() => AdminApi.overview());
  const intel = useZone<MemberIntelligence>(() => AdminApi.intelligence());
  const attendance = useZone<{ trend: AttendanceTrendPoint[]; recent_events: RecentEventRow[] }>(() => AdminApi.attendanceReport(8));
  const engagement = useZone<EngagementReport>(() => AdminApi.engagementReport());
  const signals = useZone<PulseSignal[]>(() => AdminApi.pulseSignals(14));
  const levelReviews = useZone<LevelReviewRow[]>(() => CurriculumApi.levelReviews());
  const media = useZone<{ stuck: number }>(() => MediaApi.list().then((r) => ({ stuck: r.stuck })));
  const consents = useZone<ConsentRow[]>(() => AdminApi.consentsReport());
  const levels = useZone<AdminLevel[]>(() => CurriculumApi.levels());
  const plans = useZone<PlanRow[]>(() => GrowthAdminApi.plans());
  const finance = useZone<FundSummary[]>(() => ConfigApi.financeSummary().then((r) => r.funds));
  const calendar = useZone<CalendarOccurrence[]>(() => {
    const now = new Date();
    const in60 = new Date(now.getTime() + 60 * 24 * 3600 * 1000);
    return OpsApi.calendar(now.toISOString(), in60.toISOString());
  });
  const audit = useZone<AuditRow[]>(() => ConfigApi.audit({}).then((r) => r.data));
  const radio = useZone<RadioProgram[]>(() => RadioApi.programs());
  const me = useZone<string>(() => MeApi.me().then((r) => r.profile.full_name.trim().split(/\s+/)[0] ?? ""));

  // ── Radio: live listeners + now-playing poll (only while a program is live) ─
  const livePrograms = radio.s === "ready" ? radio.d.filter((p) => p.is_live) : [];
  const liveProgram = livePrograms[0] ?? null;
  const liveProgramId = liveProgram?.id ?? null;
  const [liveListeners, setLiveListeners] = useState<number | null>(null);
  const [nowPlaying, setNowPlaying] = useState<string | null>(null);
  useEffect(() => {
    if (!liveProgramId) { setLiveListeners(null); setNowPlaying(null); return; }
    let alive = true;
    const tick = (): void => {
      void RadioApi.listeners(liveProgramId).then((r) => { if (alive) setLiveListeners(r.count); }).catch(() => {});
      void RadioApi.health(liveProgramId).then((h) => { if (alive) setNowPlaying(h.now_playing ?? null); }).catch(() => {});
    };
    tick();
    const t = window.setInterval(tick, 30_000);
    return () => { alive = false; window.clearInterval(t); };
  }, [liveProgramId]);

  const nextProgram = useMemo<RadioProgram | null>(() => {
    if (radio.s !== "ready") return null;
    const now = Date.now();
    const upcoming = radio.d
      .filter((p) => !p.is_live && p.status === "scheduled" && p.scheduled_at && new Date(p.scheduled_at).getTime() > now)
      .sort((a, b) => new Date(a.scheduled_at ?? 0).getTime() - new Date(b.scheduled_at ?? 0).getTime());
    return upcoming[0] ?? null;
  }, [radio]);

  const lastBroadcast = useMemo<RadioProgram | null>(() => {
    if (radio.s !== "ready") return null;
    const ended = radio.d
      .filter((p) => p.status === "ended")
      .sort((a, b) => new Date(b.live_ended_at ?? b.updated_at).getTime() - new Date(a.live_ended_at ?? a.updated_at).getTime());
    return ended[0] ?? null;
  }, [radio]);

  // ── Care signals (unacknowledged only) ────────────────────────────────────
  const urgentSignals = signals.s === "ready" ? signals.d.filter((x) => x.severity === "urgent" && !x.acknowledged_at) : [];
  const watchSignals = signals.s === "ready" ? signals.d.filter((x) => x.severity === "watch" && !x.acknowledged_at) : [];

  // ── Attendance direction (last 2 trend points) ────────────────────────────
  const attDir = useMemo<{ last: number; pct: number | null; up: boolean } | null>(() => {
    if (attendance.s !== "ready") return null;
    const t = attendance.d.trend;
    const last = t[t.length - 1];
    if (!last) return { last: 0, pct: null, up: true };
    const prev = t[t.length - 2];
    if (!prev || prev.check_ins === 0) return { last: last.check_ins, pct: null, up: true };
    const diff = last.check_ins - prev.check_ins;
    return { last: last.check_ins, pct: Math.round((diff / prev.check_ins) * 100), up: diff >= 0 };
  }, [attendance]);

  const sparkData = useMemo(
    () =>
      attendance.s === "ready"
        ? attendance.d.trend.map((t) => ({
            wk: new Date(`${t.week_start}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
            checkins: t.check_ins,
          }))
        : [],
    [attendance],
  );

  // ── New members this month (intelligence retention cohorts; "Mon YYYY") ───
  const monthCohortLabel = new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" });
  const joinedThisMonth =
    intel.s === "ready" ? intel.d.retention?.cohorts.find((c) => c.cohort === monthCohortLabel)?.joined ?? null : null;

  // ── Hero momentum KPIs — every number gets a delta or context line ────────
  const heroStats: { label: string; value: ReactNode; hint: ReactNode }[] = [
    (() => {
      if (intel.s === "loading") return { label: "Active this week", value: <Skel w={46} h={20} dark />, hint: <Skel w={100} h={10} dark /> };
      if (intel.s === "error") return { label: "Active this week", value: "—", hint: "intelligence unavailable" };
      const k = intel.d.kpis;
      const p = k.total_members > 0 ? Math.round((k.active_7d / k.total_members) * 100) : 0;
      return { label: "Active this week", value: String(k.active_7d), hint: `${p}% of ${k.total_members} members` };
    })(),
    (() => {
      if (attendance.s === "loading") return { label: "Attendance", value: <Skel w={46} h={20} dark />, hint: <Skel w={100} h={10} dark /> };
      if (attendance.s === "error" || !attDir) return { label: "Attendance", value: "—", hint: "report unavailable" };
      if (attDir.pct === null) return { label: "Attendance", value: String(attDir.last), hint: "check-ins this week" };
      return {
        label: "Attendance",
        value: (
          <span className="inline-flex items-baseline gap-2">
            {String(attDir.last)}
            <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "Manrope, sans-serif", color: attDir.up ? "#3be066" : "#ff6b81" }}>
              {attDir.up ? "▲" : "▼"} {Math.abs(attDir.pct)}%
            </span>
          </span>
        ),
        hint: "check-ins vs last week",
      };
    })(),
    (() => {
      if (overview.s === "loading") return { label: "Reflections (wk.)", value: <Skel w={46} h={20} dark />, hint: <Skel w={100} h={10} dark /> };
      if (overview.s === "error") return { label: "Reflections (wk.)", value: "—", hint: "report unavailable" };
      return { label: "Reflections (wk.)", value: String(overview.d.reflections_this_week), hint: `${overview.d.pending_reviews} awaiting review` };
    })(),
    (() => {
      if (overview.s === "loading") return { label: "New members", value: <Skel w={46} h={20} dark />, hint: <Skel w={100} h={10} dark /> };
      if (overview.s === "ready" && typeof overview.d.new_members_14d === "number") {
        const cur = overview.d.new_members_14d;
        const prev = overview.d.new_members_prev_14d;
        const hint = prev > 0
          ? `last 14 days · ${cur >= prev ? "▲" : "▼"} vs ${prev} prior`
          : "joined in the last 14 days";
        return { label: "New members", value: String(cur), hint };
      }
      if (joinedThisMonth !== null) {
        return { label: "New members", value: String(joinedThisMonth), hint: `joined in ${new Date().toLocaleDateString("en-US", { month: "long" })}` };
      }
      return { label: "New members", value: "—", hint: "not tracked yet" };
    })(),
  ];

  // ── NEEDS YOU — unified ranked action queue (only non-zero rows render) ───
  const needSources: Array<Zone<unknown>> = [overview, signals, levelReviews, media, consents];
  const needsLoading = needSources.some((z) => z.s === "loading");
  const needsAllFailed = needSources.every((z) => z.s === "error");
  const needRows: NeedRow[] = [];
  if (urgentSignals.length > 0) {
    const first = urgentSignals[0];
    needRows.push({
      key: "urgent", tone: "red", icon: HeartPulse,
      label: `${urgentSignals.length} urgent care signal${urgentSignals.length === 1 ? "" : "s"}`,
      hint: first ? truncate(`${first.member_name} — ${first.summary}`, 72) : "open the flock brief",
      route: "/flock-brief",
    });
  }
  if (levelReviews.s === "ready" && levelReviews.d.length > 0) {
    const oldest = Math.max(...levelReviews.d.map((r) => daysSince(r.created_at)));
    needRows.push({
      key: "usher", tone: "orange", icon: DoorOpen,
      label: `${levelReviews.d.length} member${levelReviews.d.length === 1 ? "" : "s"} awaiting ushering`,
      hint: `exam passed · oldest waiting ${oldest} d`,
      route: "/level-reviews",
    });
  }
  if (overview.s === "ready" && overview.d.pending_reviews > 0) {
    needRows.push({
      key: "reflections", tone: "orange", icon: ClipboardCheck,
      label: `${overview.d.pending_reviews} reflection${overview.d.pending_reviews === 1 ? "" : "s"} to review`,
      hint: overview.d.reviews_overdue > 0 ? `${overview.d.reviews_overdue} overdue by 3+ days` : "none overdue yet",
      route: "/reflection-queue",
    });
  }
  if (watchSignals.length > 0) {
    needRows.push({
      key: "watch", tone: "yellow", icon: Eye,
      label: `${watchSignals.length} watch signal${watchSignals.length === 1 ? "" : "s"}`,
      hint: "drift worth a look this week", route: "/flock-brief",
    });
  }
  if (media.s === "ready" && media.d.stuck > 0) {
    needRows.push({
      key: "media", tone: "yellow", icon: Film,
      label: `${media.d.stuck} video${media.d.stuck === 1 ? "" : "s"} stuck encoding`,
      hint: "stalled in the media pipeline", route: "/video-library",
    });
  }
  if (overview.s === "ready" && overview.d.members_at_risk > 0) {
    needRows.push({
      key: "at-risk", tone: "yellow", icon: AlertTriangle,
      label: `${overview.d.members_at_risk} member${overview.d.members_at_risk === 1 ? "" : "s"} at risk`,
      hint: "low attendance + missed reflections", route: "/members",
    });
  }
  if (consents.s === "ready" && consents.d.length > 0) {
    needRows.push({
      key: "consents", tone: "yellow", icon: ShieldCheck,
      label: `${consents.d.length} guardian consent${consents.d.length === 1 ? "" : "s"} to renew`,
      hint: "minors needing renewed consent", route: "/members",
    });
  }

  // ── The Flock — band distribution ─────────────────────────────────────────
  const distribution = engagement.s === "ready"
    ? BAND_META.map((b) => ({ ...b, value: engagement.d.bands[b.key] ?? 0 }))
    : [];
  const totalLearners = distribution.reduce((s, d) => s + d.value, 0);

  // ── Pulse of the Word — content tiles (each domain exactly once) ──────────
  const levelsInReview = levels.s === "ready" ? levels.d.filter((l) => l.status === "in_review").length : null;
  const activePlans = plans.s === "ready" ? plans.d.filter((p) => p.is_active).length : null;
  const monthGivingMinor = finance.s === "ready" ? finance.d.reduce((s, f) => s + f.month_minor, 0) : null;
  const givingCurrency = finance.s === "ready"
    ? finance.d.find((f) => f.month_minor > 0)?.currency ?? finance.d[0]?.currency ?? null
    : null;

  // ── Aggregated activity: collapse consecutive same-kind audit events ──────
  const activityGroups = useMemo<ActivityGroup[]>(() => {
    if (audit.s !== "ready") return [];
    const groups: ActivityGroup[] = [];
    for (const row of audit.d) {
      const prev = groups[groups.length - 1];
      if (prev && prev.action === row.action) {
        prev.count += 1;
        if (row.actor_name && !prev.actors.includes(row.actor_name)) prev.actors.push(row.actor_name);
      } else {
        if (groups.length >= 6) break;
        groups.push({
          id: row.audit_id, action: row.action, count: 1,
          actors: row.actor_name ? [row.actor_name] : [],
          entity: row.entity, latest: row.created_at,
        });
      }
    }
    return groups.slice(0, 6);
  }, [audit]);

  const upcoming = calendar.s === "ready" ? calendar.d.slice(0, 5) : [];
  const nextEvent = calendar.s === "ready" ? calendar.d[0] ?? null : null;

  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = me.s === "ready" ? me.d : "";

  const eyebrowLight: CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(232,239,245,0.55)",
  };

  return (
    <div style={{ minHeight: "100%", background: "var(--background)" }}>
      {/* ── Hero — momentum, not stock ── */}
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px, 4vw, 48px) 24px" }}>
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}>
            <span>Nuru Pathway</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Dashboard</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5" style={{ height: 32, background: "rgba(245,199,126,0.14)", color: "#F5C77E", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", border: "1px solid rgba(245,199,126,0.25)" }}>
              <Sparkles size={11} /> {today}
            </span>
            <button onClick={() => navigate("/reflection-queue")} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 12, fontWeight: 600, border: "1px solid rgba(255,255,255,0.15)" }}>
              <ClipboardCheck size={13} /> Review queue
            </button>
            <button onClick={() => navigate("/curriculum")} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 12, fontWeight: 600, border: "1px solid rgba(255,255,255,0.15)" }}>
              <BookOpen size={13} /> Curriculum
            </button>
            <button onClick={() => navigate("/members")} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}>
              Members <ArrowRight size={12} />
            </button>
          </div>
        </div>

        <h1 style={{ fontFamily: "var(--font-display)", color: "#fff", fontSize: 24, lineHeight: 1, letterSpacing: "-0.015em" }}>
          {firstName ? `${greeting}, ${firstName}` : greeting}
        </h1>

        <div className="grid grid-cols-2 md:grid-cols-4 mt-4 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
          {heroStats.map((item, idx) => (
            <div key={item.label} style={{ padding: "14px 20px", borderRight: idx < 3 ? "1px solid rgba(255,255,255,0.07)" : "none", borderBottom: idx < 2 ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
              <div style={{ fontSize: 10.5, color: "rgba(232,239,245,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 6 }}>{item.label}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "#fff", lineHeight: 1.1 }}>{item.value}</div>
              <div style={{ fontSize: 11, color: "rgba(232,239,245,0.45)", marginTop: 4 }}>{item.hint}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ padding: "24px clamp(16px, 4vw, 48px) 48px" }}>

        {/* ── LIVE NOW strip — the heartbeat ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 rounded-2xl mb-5" style={{ background: "var(--nuru-navy-gradient)", border: "1px solid rgba(255,255,255,0.1)", overflow: "hidden" }}>
          {/* Radio */}
          <div onClick={() => navigate("/radio")} className="cursor-pointer" style={{ padding: "16px 20px" }}>
            {radio.s === "loading" ? (
              <div className="flex flex-col gap-2"><Skel w={70} h={10} dark /><Skel w={160} h={15} dark /><Skel w={120} h={10} dark /></div>
            ) : radio.s === "error" ? (
              <div className="flex flex-col gap-2">
                <span style={eyebrowLight}>Nuru Radio</span>
                <span style={{ color: "rgba(232,239,245,0.5)", fontSize: 14 }}>—</span>
              </div>
            ) : liveProgram ? (
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2">
                  <PulseDot color="#f0405f" />
                  <span style={{ ...eyebrowLight, color: "#ff8296" }}>On air</span>
                </span>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 17, color: "#fff", lineHeight: 1.2 }}>{truncate(liveProgram.title, 44)}</span>
                <span style={{ fontSize: 11.5, color: "rgba(232,239,245,0.65)" }}>
                  {(liveListeners ?? liveProgram.peak_listeners)} listening now{nowPlaying ? ` · ♪ ${truncate(nowPlaying, 34)}` : ""}
                </span>
              </div>
            ) : nextProgram && nextProgram.scheduled_at ? (
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2">
                  <PulseDot color="#e0b85e" animate={false} />
                  <span style={eyebrowLight}>Next broadcast</span>
                </span>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 17, color: "#fff", lineHeight: 1.2 }}>{truncate(nextProgram.title, 44)}</span>
                <span style={{ fontSize: 11.5, color: "rgba(232,239,245,0.65)" }}>
                  {untilLabel(nextProgram.scheduled_at)}{nextProgram.speaker ? ` · ${nextProgram.speaker}` : ""}
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2">
                  <PulseDot color="rgba(232,239,245,0.35)" animate={false} />
                  <span style={eyebrowLight}>Nuru Radio</span>
                </span>
                <span style={{ fontSize: 13, color: "rgba(232,239,245,0.6)" }}>Off air — nothing scheduled</span>
              </div>
            )}
          </div>

          {/* Next gathering */}
          <div onClick={() => navigate("/events")} className="cursor-pointer border-t md:border-t-0 md:border-l" style={{ padding: "16px 20px", borderColor: "rgba(255,255,255,0.1)" }}>
            {calendar.s === "loading" ? (
              <div className="flex flex-col gap-2"><Skel w={80} h={10} dark /><Skel w={150} h={15} dark /><Skel w={110} h={10} dark /></div>
            ) : nextEvent ? (
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2">
                  <CalendarDays size={11} style={{ color: "#F5C77E" }} />
                  <span style={eyebrowLight}>Next gathering</span>
                </span>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 17, color: "#fff", lineHeight: 1.2 }}>{truncate(nextEvent.title, 44)}</span>
                <span style={{ fontSize: 11.5, color: "rgba(232,239,245,0.65)" }}>
                  {untilLabel(nextEvent.start_at)}{nextEvent.location ? ` · ${truncate(nextEvent.location, 26)}` : ""}
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2">
                  <CalendarDays size={11} style={{ color: "rgba(232,239,245,0.4)" }} />
                  <span style={eyebrowLight}>Next gathering</span>
                </span>
                <span style={{ fontSize: 13, color: "rgba(232,239,245,0.6)" }}>{calendar.s === "error" ? "—" : "No events in the next 60 days"}</span>
              </div>
            )}
          </div>

          {/* Urgent care signals */}
          <div onClick={() => navigate("/flock-brief")} className="cursor-pointer border-t md:border-t-0 md:border-l" style={{ padding: "16px 20px", borderColor: "rgba(255,255,255,0.1)" }}>
            {signals.s === "loading" ? (
              <div className="flex flex-col gap-2"><Skel w={80} h={10} dark /><Skel w={140} h={15} dark /><Skel w={120} h={10} dark /></div>
            ) : signals.s === "error" ? (
              <div className="flex flex-col gap-1.5">
                <span style={eyebrowLight}>Care signals</span>
                <span style={{ color: "rgba(232,239,245,0.5)", fontSize: 14 }}>—</span>
              </div>
            ) : urgentSignals.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2">
                  <PulseDot color="#f0405f" />
                  <span style={{ ...eyebrowLight, color: "#ff8296" }}>Care signals</span>
                </span>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 17, color: "#fff", lineHeight: 1.2 }}>
                  {urgentSignals.length} urgent — see the flock brief
                </span>
                <span style={{ fontSize: 11.5, color: "rgba(232,239,245,0.65)" }}>
                  {urgentSignals[0] ? truncate(urgentSignals[0].member_name, 40) : ""}{urgentSignals.length > 1 ? ` +${urgentSignals.length - 1} more` : ""}
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2">
                  <PulseDot color="#22c55e" animate={false} />
                  <span style={eyebrowLight}>Care signals</span>
                </span>
                <span style={{ fontSize: 13, color: "rgba(232,239,245,0.6)" }}>All quiet — no urgent signals this fortnight</span>
              </div>
            )}
          </div>
        </div>

        {/* ── NEEDS YOU | THE FLOCK ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
          {/* Needs you — unified ranked queue */}
          <div className="rounded-2xl" style={{ ...CARD, padding: "18px 20px" }}>
            <div className="flex items-center justify-between mb-3">
              <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--nuru-navy)" }}>Needs you</h2>
              <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>across the whole pathway</span>
            </div>
            {needsLoading ? (
              <div className="flex flex-col gap-4 py-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skel w={32} h={32} /><div className="flex flex-col gap-1.5 flex-1"><Skel w="70%" h={13} /><Skel w="45%" h={10} /></div>
                  </div>
                ))}
              </div>
            ) : needsAllFailed ? (
              <p style={{ fontSize: 13, color: "var(--muted-foreground)", padding: "16px 0", textAlign: "center" }}>—</p>
            ) : needRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8">
                <CheckCircle2 size={26} style={{ color: "#22c55e" }} />
                <p style={{ fontSize: 13, color: "#166534", fontWeight: 600, textAlign: "center" }}>
                  Flock is tended — nothing needs you right now.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col">
                {needRows.map((r, i) => {
                  const Icon = r.icon;
                  const tone = TONE_COLOR[r.tone];
                  return (
                    <li key={r.key}>
                      <button onClick={() => navigate(r.route)} className="flex items-center gap-3 w-full py-2.5 text-left" style={{ background: "none", border: "none", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                        <span className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 32, height: 32, background: `${tone}16`, color: tone }}><Icon size={15} /></span>
                        <span className="flex-1 min-w-0">
                          <span style={{ display: "block", fontSize: 13, color: "var(--nuru-navy)", fontWeight: 600, lineHeight: 1.3 }}>{r.label}</span>
                          <span style={{ display: "block", fontSize: 11, color: "var(--muted-foreground)", marginTop: 1 }}>{r.hint}</span>
                        </span>
                        <ChevronRight size={13} style={{ color: "var(--muted-foreground)" }} className="shrink-0" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* The Flock — band bar + attendance sparkline */}
          <div className="lg:col-span-2 rounded-2xl" style={{ ...CARD, padding: "18px 20px" }}>
            <div className="flex items-center justify-between mb-3">
              <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--nuru-navy)" }}>The Flock</h2>
              <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                {engagement.s === "ready" ? `${totalLearners} learners` : engagement.s === "loading" ? <Skel w={60} h={10} /> : "—"}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
              {/* Health distribution */}
              <div className="md:col-span-3 flex flex-col justify-center gap-3">
                {engagement.s === "loading" ? (
                  <div className="flex flex-col gap-3"><Skel w="100%" h={26} /><Skel w="80%" h={11} /></div>
                ) : engagement.s === "error" ? (
                  <p style={{ fontSize: 13, color: "var(--muted-foreground)" }}>—</p>
                ) : totalLearners === 0 ? (
                  <p style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>No engagement scores yet.</p>
                ) : (
                  <>
                    <div className="flex w-full rounded-lg overflow-hidden" style={{ height: 26 }}>
                      {distribution.filter((d) => d.value > 0).map((d) => (
                        <div key={d.key} title={`${d.name}: ${d.value}`} style={{ width: `${(d.value / totalLearners) * 100}%`, minWidth: 10, background: d.color }} />
                      ))}
                    </div>
                    <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap">
                      {distribution.map((d) => {
                        const p = totalLearners ? Math.round((d.value / totalLearners) * 100) : 0;
                        return (
                          <span key={d.key} className="flex items-center gap-1.5" style={{ fontSize: 11.5, color: "var(--nuru-navy)" }}>
                            <span style={{ width: 8, height: 8, borderRadius: 99, background: d.color }} />
                            <span style={{ fontWeight: 600 }}>{d.name}</span>
                            <span style={{ color: "var(--muted-foreground)" }}>{d.value} · {p}%</span>
                          </span>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
              {/* Attendance sparkline */}
              <div className="md:col-span-2">
                <div className="flex items-center justify-between mb-1">
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--nuru-navy)" }}>Attendance · 8 wks</span>
                  {attDir && attDir.pct !== null ? (
                    <span style={{ fontSize: 11, fontWeight: 700, color: attDir.up ? "#166534" : "#f0405f" }}>
                      {attDir.up ? "▲" : "▼"} {Math.abs(attDir.pct)}%
                    </span>
                  ) : null}
                </div>
                {attendance.s === "loading" ? (
                  <Skel w="100%" h={90} />
                ) : attendance.s === "error" || sparkData.length === 0 ? (
                  <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", paddingTop: 20 }}>{attendance.s === "error" ? "—" : "No check-ins recorded yet."}</p>
                ) : (
                  <div style={{ height: 96 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={sparkData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                        <defs>
                          <linearGradient id="attGold" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#C89B3C" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#C89B3C" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="wk" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} interval="preserveStartEnd" />
                        <YAxis hide />
                        <Tooltip cursor={{ stroke: "rgba(11,31,51,0.15)" }} contentStyle={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                        <Area type="monotone" dataKey="checkins" name="Check-ins" stroke="#C89B3C" strokeWidth={2} fill="url(#attGold)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── PULSE OF THE WORD — content row, each domain exactly once ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mb-5">
          {/* Curriculum */}
          <div onClick={() => navigate("/curriculum")} className="rounded-2xl cursor-pointer flex flex-col gap-2" style={{ ...CARD, padding: "14px 16px" }}>
            <span className="flex items-center justify-center rounded-lg" style={{ width: 30, height: 30, background: "var(--tint-gold-bg)", color: "var(--tint-gold-fg)" }}><BookOpen size={14} /></span>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--nuru-navy)", lineHeight: 1 }}>
              {overview.s === "loading" ? <Skel w={36} h={18} /> : overview.s === "error" ? "—" : overview.d.modules_published}
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--nuru-navy)" }}>Modules published</span>
            <span style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>
              {levelsInReview === null ? (levels.s === "loading" ? <Skel w={60} h={9} /> : "—") : `${levelsInReview} level${levelsInReview === 1 ? "" : "s"} in review`}
            </span>
          </div>
          {/* Last broadcast */}
          <div onClick={() => navigate("/radio")} className="rounded-2xl cursor-pointer flex flex-col gap-2" style={{ ...CARD, padding: "14px 16px" }}>
            <span className="flex items-center justify-center rounded-lg" style={{ width: 30, height: 30, background: "var(--tint-navy-bg)", color: "var(--tint-navy-fg)" }}><RadioIcon size={14} /></span>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--nuru-navy)", lineHeight: 1 }}>
              {radio.s === "loading" ? <Skel w={36} h={18} /> : lastBroadcast ? lastBroadcast.peak_listeners : "—"}
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--nuru-navy)" }}>Peak listeners</span>
            <span style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>
              {radio.s === "loading" ? <Skel w={70} h={9} /> : lastBroadcast ? truncate(lastBroadcast.title, 26) : "no broadcasts yet"}
            </span>
          </div>
          {/* Plans */}
          <div onClick={() => navigate("/content-studio")} className="rounded-2xl cursor-pointer flex flex-col gap-2" style={{ ...CARD, padding: "14px 16px" }}>
            <span className="flex items-center justify-center rounded-lg" style={{ width: 30, height: 30, background: "var(--tint-violet-bg)", color: "var(--tint-violet-fg)" }}><BookMarked size={14} /></span>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--nuru-navy)", lineHeight: 1 }}>
              {plans.s === "loading" ? <Skel w={36} h={18} /> : activePlans === null ? "—" : activePlans}
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--nuru-navy)" }}>Reading plans live</span>
            <span style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>
              {plans.s === "loading" ? <Skel w={60} h={9} /> : plans.s === "error" ? "—" : `${plans.d.length} in the library`}
            </span>
          </div>
          {/* Certificates */}
          <div onClick={() => navigate("/certificates")} className="rounded-2xl cursor-pointer flex flex-col gap-2" style={{ ...CARD, padding: "14px 16px" }}>
            <span className="flex items-center justify-center rounded-lg" style={{ width: 30, height: 30, background: "var(--tint-green-bg)", color: "var(--tint-green-fg)" }}><Award size={14} /></span>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--nuru-navy)", lineHeight: 1 }}>
              {overview.s === "loading" ? <Skel w={36} h={18} /> : overview.s === "error" ? "—" : overview.d.certificates_this_month}
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--nuru-navy)" }}>Certificates</span>
            <span style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>issued this month</span>
          </div>
          {/* Giving — the ONLY finance mention on this page */}
          <div onClick={() => navigate("/finance")} className="rounded-2xl cursor-pointer flex flex-col gap-2" style={{ ...CARD, padding: "14px 16px" }}>
            <span className="flex items-center justify-center rounded-lg" style={{ width: 30, height: 30, background: "var(--tint-amber-bg)", color: "var(--tint-amber-fg)" }}><Coins size={14} /></span>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 19, color: "var(--nuru-navy)", lineHeight: 1.15 }}>
              {finance.s === "loading" ? <Skel w={60} h={18} /> : monthGivingMinor === null ? "—" : money(monthGivingMinor, givingCurrency)}
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--nuru-navy)" }}>Giving this month</span>
            <span style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>
              {finance.s === "ready" ? `across ${finance.d.filter((f) => f.month_minor > 0).length || finance.d.length} fund${finance.d.length === 1 ? "" : "s"}` : finance.s === "loading" ? <Skel w={60} h={9} /> : "—"}
            </span>
          </div>
        </div>

        {/* ── Recent activity (aggregated) | Upcoming events ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 rounded-2xl" style={{ ...CARD, padding: "18px 20px" }}>
            <div className="flex items-center justify-between mb-3">
              <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--nuru-navy)" }}>Recent activity</h2>
              <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>same-kind events collapsed</span>
            </div>
            {audit.s === "loading" ? (
              <div className="flex flex-col gap-4 py-2">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skel w={32} h={32} /><div className="flex flex-col gap-1.5 flex-1"><Skel w="55%" h={13} /><Skel w="35%" h={10} /></div>
                  </div>
                ))}
              </div>
            ) : audit.s === "error" ? (
              <p style={{ fontSize: 13, color: "var(--muted-foreground)", padding: "12px 0", textAlign: "center" }}>—</p>
            ) : activityGroups.length === 0 ? (
              <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", padding: "8px 0" }}>No recent activity recorded.</p>
            ) : (
              <ul className="flex flex-col">
                {activityGroups.map((g, i) => {
                  const meta = actionMeta(g.action);
                  const Icon = meta.icon;
                  const firstActor = g.actors[0];
                  const who = firstActor
                    ? `${firstActor}${g.actors.length > 1 ? ` +${g.actors.length - 1} other${g.actors.length === 2 ? "" : "s"}` : ""}`
                    : g.entity ?? "system";
                  return (
                    <li key={g.id} className="flex items-start gap-3 py-3" style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                      <div className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 32, height: 32, background: meta.bg, color: meta.fg }}><Icon size={15} /></div>
                      <div className="flex-1 min-w-0">
                        <div style={{ fontSize: 13, color: "var(--nuru-navy)", fontWeight: 600, lineHeight: 1.35 }}>
                          {g.count > 1 ? `${g.count} × ${humanize(g.action)}` : humanize(g.action)}
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 2 }}>{who}</div>
                      </div>
                      <span style={{ fontSize: 11, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>{relTime(g.latest)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="rounded-2xl" style={{ ...CARD, padding: "18px 20px" }}>
            <div className="flex items-center justify-between mb-3">
              <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--nuru-navy)" }}>Upcoming events</h2>
              <button onClick={() => navigate("/events")} style={{ fontSize: 12, color: "var(--nuru-gold)", fontWeight: 600, background: "none", border: "none" }}>Calendar</button>
            </div>
            {calendar.s === "loading" ? (
              <div className="flex flex-col gap-4 py-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skel w={46} h={46} /><div className="flex flex-col gap-1.5 flex-1"><Skel w="65%" h={13} /><Skel w="40%" h={10} /></div>
                  </div>
                ))}
              </div>
            ) : calendar.s === "error" ? (
              <p style={{ fontSize: 13, color: "var(--muted-foreground)", padding: "12px 0", textAlign: "center" }}>—</p>
            ) : upcoming.length === 0 ? (
              <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", padding: "8px 0" }}>No events scheduled in the next 60 days.</p>
            ) : (
              <ul className="flex flex-col">
                {upcoming.map((e, i) => {
                  const d = new Date(e.start_at);
                  const wk = d.toLocaleDateString("en-US", { weekday: "short" });
                  const day = d.toLocaleDateString("en-US", { day: "numeric" });
                  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                  return (
                    <li key={e.occurrence_id} onClick={() => navigate("/events")} className="flex items-center gap-3 py-3 cursor-pointer" style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                      <div className="flex flex-col items-center justify-center rounded-lg shrink-0" style={{ width: 46, height: 46, background: "#FDF5E5", color: "#8A6B1F" }}>
                        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{wk}</span>
                        <span style={{ fontFamily: "var(--font-display)", fontSize: 17, lineHeight: 1 }}>{day}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div style={{ fontSize: 13, color: "var(--nuru-navy)", fontWeight: 600 }}>{e.title}</div>
                        <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 1 }}>{time}{e.location ? ` · ${e.location}` : ""}</div>
                      </div>
                      <ChevronRight size={14} style={{ color: "var(--muted-foreground)" }} />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
