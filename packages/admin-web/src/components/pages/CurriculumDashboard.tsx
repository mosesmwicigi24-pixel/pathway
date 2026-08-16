// Curriculum Dashboard — the health/attention/activity workspace of the two-page
// CMS (docs/CURRICULUM_ARCHITECTURE.md §5.1). Replaces Curriculum Levels + CMS
// Curriculum. ONE stats call (GET /admin/curriculum/summary) drives the health
// grid, the clickable pipeline, the level summary cards; the completeness report
// (validate) ranks Needs Attention; activity is classified SERVER-side. Every
// count is a link; level cards carry ONE Open button into the workspace.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from "recharts";
import {
  Plus, ChevronRight, ChevronDown, BookOpen, Users, Award, Sparkles, TrendingUp,
  GraduationCap, Flame, ArrowRight, CheckCircle2, PenLine, Video, Eye, Send,
  Zap, AlertTriangle, Info, ShieldCheck, HelpCircle, Link2, Upload,
  RotateCcw, ClipboardCheck, MessageSquare, UserCheck, Clock, Lock, Activity as ActivityIcon,
  Layers, BarChart3, type LucideIcon,
} from "lucide-react";
import {
  CurriculumApi, AdminApi,
  type CurriculumSummary, type CurriculumLevelCard, type CurriculumValidationIssue,
  type CurriculumActivityRow, type CurriculumActivityKind,
} from "../../api/client";
import { errorMessage } from "../../util/error";
import { LevelModal, type LevelFormData, type LevelStatus } from "../curriculum/LevelModal";

// Brand per-level accent — mirrors the iPad's CL.palette (bright green · gold ·
// teal · violet · pink · amber · navy). The API color wins unless it's the
// historical off-brand sky-blue.
const LEVEL_PALETTE = ["#22c55e", "#c89b3c", "#0e8c8c", "#7c3aed", "#ec4899", "#e08a1e", "#0b1f33"];
const OFF_BRAND_BLUE = /^#?0ea5e9$/i;
function levelColor(levelNumber: number, apiColor?: string): string {
  if (apiColor && !OFF_BRAND_BLUE.test(apiColor.trim())) return apiColor;
  const i = ((levelNumber - 1) % LEVEL_PALETTE.length + LEVEL_PALETTE.length) % LEVEL_PALETTE.length;
  return LEVEL_PALETTE[i]!;
}

const statusPill: Record<string, { bg: string; color: string; label: string }> = {
  published: { bg: "#E8F6EE", color: "#0F6B33", label: "Published" },
  draft: { bg: "#EEF1F8", color: "#1F3A6B", label: "Draft" },
  in_review: { bg: "#FDF5E5", color: "#8A6B1F", label: "In Review" },
};
const labelToBe: Record<LevelStatus, string> = { Published: "published", Draft: "draft", "In Review": "in_review" };

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  const m = Math.floor(s / 60); if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); return d === 1 ? "Yesterday" : `${d}d ago`;
}
const humanize = (a: string): string => { const s = a.replace(/[._]/g, " ").trim(); return s.charAt(0).toUpperCase() + s.slice(1); };

type PipelineKey = "drafts" | "in_review" | "locked" | "live";
const pipelineMatches = (key: PipelineKey, l: CurriculumLevelCard): boolean =>
  key === "drafts" ? l.status === "draft"
  : key === "in_review" ? l.status === "in_review"
  : key === "locked" ? l.locked
  : l.status === "published";

// Classified activity groups (§3) — server-tagged kinds, portal labels/icons.
const kindMeta: Record<CurriculumActivityKind, { label: string; icon: LucideIcon; tint: string }> = {
  published: { label: "Recently Published", icon: CheckCircle2, tint: "#16A34A" },
  edited: { label: "Recently Edited", icon: PenLine, tint: "#c89b3c" },
  review: { label: "Pending Review", icon: Eye, tint: "#8A6B1F" },
  video: { label: "Videos", icon: Video, tint: "#0e8c8c" },
  quiz: { label: "Quiz", icon: HelpCircle, tint: "#7c3aed" },
  module: { label: "Modules", icon: BookOpen, tint: "#1F3A6B" },
  milestone: { label: "Milestones", icon: Award, tint: "#e08a1e" },
};
const KIND_ORDER: CurriculumActivityKind[] = ["published", "edited", "review", "video", "quiz", "module", "milestone"];

const severityMeta: Record<CurriculumValidationIssue["severity"], { icon: LucideIcon; bg: string; color: string; label: string }> = {
  error: { icon: AlertTriangle, bg: "#FDECEC", color: "#A8281F", label: "Error" },
  warning: { icon: AlertTriangle, bg: "#FDF5E5", color: "#8A6B1F", label: "Warning" },
  info: { icon: Info, bg: "#EEF1F8", color: "#1F3A6B", label: "Info" },
};

interface Trend { [k: string]: string | number }

export function CurriculumDashboard(): ReactElement {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<CurriculumSummary | null>(null);
  const [issues, setIssues] = useState<CurriculumValidationIssue[]>([]);
  const [activity, setActivity] = useState<CurriculumActivityRow[]>([]);
  const [activityKind, setActivityKind] = useState<"all" | CurriculumActivityKind>("all");
  const [pipelineFilter, setPipelineFilter] = useState<PipelineKey | null>(null);
  const [openAnalytics, setOpenAnalytics] = useState<Set<string>>(new Set());
  const [trend, setTrend] = useState<Trend[] | null>(null); // lazy — fetched on expand
  const [addLevel, setAddLevel] = useState(false);
  const [savingLevel, setSavingLevel] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsRef = useRef<HTMLDivElement>(null);

  const loadAll = useCallback(async () => {
    try {
      const [s, v, a] = await Promise.all([
        CurriculumApi.curriculumSummary(),
        CurriculumApi.curriculumValidate(),
        CurriculumApi.curriculumActivity(40),
      ]);
      setSummary(s); setIssues(v); setActivity(a); setError(null);
    } catch (e) { setError(errorMessage(e, "Could not load the curriculum dashboard.")); }
  }, []);
  useEffect(() => { void loadAll(); }, [loadAll]);

  // "Validate Curriculum" quick action: re-run the report and scroll to it.
  const runValidate = useCallback(async () => {
    setValidating(true);
    try { setIssues(await CurriculumApi.curriculumValidate()); setError(null); }
    catch (e) { setError(errorMessage(e, "Validation failed.")); }
    finally {
      setValidating(false);
      needsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const toggleAnalytics = useCallback((key: string): void => {
    setOpenAnalytics((prev) => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key); else s.add(key);
      return s;
    });
    if (key === "trend" && trend == null) {
      void AdminApi.levelsReport().then((r) => setTrend(r.trend)).catch(() => setTrend([]));
    }
  }, [trend]);

  const levels = useMemo(
    () => (summary?.levels ?? []).map((l) => ({ ...l, color: levelColor(l.level_number, l.color) })),
    [summary],
  );
  const visibleLevels = pipelineFilter ? levels.filter((l) => pipelineMatches(pipelineFilter, l)) : levels;
  const t = summary?.totals ?? null;
  const pipeline = summary?.pipeline ?? { drafts: 0, in_review: 0, locked: 0, live: 0 };

  const openWorkspace = useCallback((level?: number, moduleId?: string | null): void => {
    const q = new URLSearchParams();
    if (level != null) q.set("level", String(level));
    if (moduleId) q.set("module", moduleId);
    const qs = q.toString();
    navigate(`/curriculum/workspace${qs ? `?${qs}` : ""}`);
  }, [navigate]);

  async function handleCreateLevel(data: LevelFormData): Promise<void> {
    setSavingLevel(true); setError(null);
    try {
      // createLevel still accepts the pass mark at birth; EDITS route it
      // through updateExam only (§2.5 — one editor per entity).
      await CurriculumApi.createLevel({
        title: data.title, theme: data.theme, required_exam_pass_mark: data.passMark,
        duration: data.duration, status: labelToBe[data.status], locked: data.locked, color: data.color,
      });
      setAddLevel(false);
      await loadAll();
    } catch (e) { setError(errorMessage(e, "Could not create the level.")); }
    finally { setSavingLevel(false); }
  }

  // ── Curriculum Health grid — every §3 count, each a link ──
  const scrollToNeeds = (): void => { needsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const health: { label: string; value: number | string; sub?: string; tone: string; onClick: () => void }[] = t ? [
    { label: "Levels live", value: t.levels.published, sub: `of ${t.levels.total}`, tone: "#16A34A", onClick: () => setPipelineFilter((c) => (c === "live" ? null : "live")) },
    { label: "Levels in review", value: t.levels.in_review, tone: "#8A6B1F", onClick: () => setPipelineFilter((c) => (c === "in_review" ? null : "in_review")) },
    { label: "Level drafts", value: t.levels.draft, tone: "#1F3A6B", onClick: () => setPipelineFilter((c) => (c === "drafts" ? null : "drafts")) },
    { label: "Modules published", value: t.modules.published, sub: `of ${t.modules.total}`, tone: "#16A34A", onClick: () => openWorkspace() },
    { label: "Module drafts", value: t.modules.draft, tone: "#1F3A6B", onClick: () => openWorkspace() },
    { label: "Modules archived", value: t.modules.archived, tone: "#94A3B8", onClick: () => openWorkspace() },
    { label: "Missing video", value: t.modules_missing_video, tone: "#e08a1e", onClick: () => navigate("/video-library") },
    { label: "Missing quiz", value: t.modules_missing_quiz, tone: "#A8281F", onClick: scrollToNeeds },
    { label: "Missing content", value: t.modules_missing_content, tone: "#A8281F", onClick: scrollToNeeds },
    { label: "Active learners", value: t.learners_active, tone: "#22c55e", onClick: () => navigate("/members") },
    { label: "Avg completion", value: `${t.avg_completion_pct}%`, tone: "#0e8c8c", onClick: () => toggleAnalytics("completion") },
    { label: "Avg quiz score", value: t.avg_quiz_score == null ? "—" : `${t.avg_quiz_score}%`, tone: "#7c3aed", onClick: () => navigate("/quiz-builder") },
    { label: "Certificates", value: t.certificates_issued, tone: "#c89b3c", onClick: () => navigate("/certificates") },
    { label: "Badges", value: t.badges_configured, tone: "#7c3aed", onClick: () => navigate("/badges") },
    { label: "Reflection queue", value: t.reflection_queue, tone: "#0e8c8c", onClick: () => navigate("/reflection-queue") },
    { label: "Reviews waiting", value: t.level_reviews_waiting, tone: "#8A6B1F", onClick: () => navigate("/level-reviews") },
    { label: "Assets attached", value: t.video_assets.attached, sub: `of ${t.video_assets.total}`, tone: "#16A34A", onClick: () => navigate("/video-library") },
    { label: "Assets unattached", value: t.video_assets.unattached, tone: "#94A3B8", onClick: () => navigate("/video-library") },
  ] : [];

  // ── Activity, grouped by the server's classification ──
  const activityCounts = useMemo(() => {
    const counts = new Map<CurriculumActivityKind, number>();
    for (const row of activity) counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);
    return counts;
  }, [activity]);
  const shownActivity = activityKind === "all" ? activity : activity.filter((a) => a.kind === activityKind);

  // ── Analytics data (reused recharts pieces from the two retired pages) ──
  const pieData = useMemo(() => levels.map((l) => ({ name: `L${l.level_number}`, value: l.learners, color: l.color })), [levels]);
  const barData = useMemo(() => levels.map((l) => ({ name: `L${l.level_number}`, completion: l.completion_pct, color: l.color })), [levels]);
  const moduleData = useMemo(() => levels.map((l) => ({ name: `L${l.level_number}`, modules: l.modules_total, done: l.modules_published })), [levels]);
  const monthRolls = useMemo(() => (trend ?? []).slice(-6).map((p) => {
    const seg = levels.map((l) => ({ level: l.level_number, color: l.color, value: Number(p[`L${l.level_number}`] ?? 0) }));
    return { month: String(p.month ?? ""), total: seg.reduce((s, x) => s + x.value, 0), seg };
  }), [trend, levels]);
  const peakMonth = Math.max(1, ...monthRolls.map((m) => m.total));

  const pipelineTiles: { key: PipelineKey; label: string; value: number; hint: string; tint: string; Icon: LucideIcon }[] = [
    { key: "drafts", label: "Drafts", value: pipeline.drafts, hint: "in authoring", tint: "tint-amber", Icon: PenLine },
    { key: "in_review", label: "In review", value: pipeline.in_review, hint: "awaiting approval", tint: "tint-blue", Icon: Eye },
    { key: "locked", label: "Locked", value: pipeline.locked, hint: "not yet open", tint: "tint-violet", Icon: Send },
    { key: "live", label: "Live", value: pipeline.live, hint: "across pathway", tint: "tint-green", Icon: Award },
  ];

  return (
    <div style={{ minHeight: "100%", background: "var(--background)" }}>
      {/* ── Hero ── */}
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px, 4vw, 48px) 24px" }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}>
            <span>Nuru Pathway</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Curriculum Dashboard</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5" style={{ height: 32, background: "rgba(245,199,126,0.14)", color: "#F5C77E", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", border: "1px solid rgba(245,199,126,0.25)" }}>
              <Sparkles size={11} /> {levels.length}-level pathway
            </span>
            <button onClick={() => openWorkspace()} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 12, fontWeight: 600, border: "1px solid rgba(255,255,255,0.15)" }}><Layers size={13} /> Levels &amp; Modules</button>
            <button onClick={() => setAddLevel(true)} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none", boxShadow: "0 6px 18px rgba(200,155,60,0.32)" }}><Plus size={13} /> New Level</button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 mt-4 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
          {[
            { label: "Active learners", value: (t?.learners_active ?? 0).toLocaleString(), icon: Users, sub: "enrolled across the pathway", tone: "#22c55e" },
            { label: "Modules live", value: String(t?.modules.published ?? 0), icon: BookOpen, sub: `of ${t?.modules.total ?? 0} modules`, tone: "#c89b3c" },
            { label: "Avg completion", value: `${t?.avg_completion_pct ?? 0}%`, icon: TrendingUp, sub: "one formula, one source", tone: "#0e8c8c" },
            { label: "Certificates", value: String(t?.certificates_issued ?? 0), icon: Award, sub: `${t?.badges_configured ?? 0} badges configured`, tone: "#7c3aed" },
          ].map((k, idx) => {
            const Icon = k.icon;
            return (
              <div key={k.label} style={{ padding: "16px 22px", borderRight: idx < 3 ? "1px solid rgba(255,255,255,0.07)" : "none", borderBottom: idx < 2 ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
                <div className="flex items-center justify-between mb-2">
                  <div style={{ fontSize: 10.5, color: "rgba(232,239,245,0.55)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>{k.label}</div>
                  <Icon size={14} style={{ color: k.tone }} />
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "#fff", lineHeight: 1.1 }}>{k.value}</div>
                <div style={{ fontSize: 11.5, color: "rgba(232,239,245,0.55)", marginTop: 4 }}>{k.sub}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ padding: "24px clamp(16px, 4vw, 48px) 48px" }}>
        {error ? <p style={{ color: "#A8281F", fontSize: 13, marginBottom: 12 }}>{error}</p> : null}

        {/* Curriculum Health — the §3 summary grid; every count is a link */}
        <div className="rounded-2xl mb-5" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "16px 18px" }}>
          <div className="flex items-center gap-2 mb-3"><ShieldCheck size={14} style={{ color: "var(--nuru-gold)" }} /><span className="nuru-section-title">Curriculum health</span><span className="nuru-eyebrow nuru-eyebrow-gold">one stats source</span></div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {health.map((h) => (
              <button key={h.label} onClick={h.onClick} className="rounded-xl text-left transition-colors hover:bg-[var(--secondary)]" style={{ border: "1px solid var(--border)", background: "var(--card)", padding: "10px 12px", cursor: "pointer" }}>
                <div className="flex items-baseline gap-1.5">
                  <span style={{ fontFamily: "var(--font-display)", fontSize: 20, color: h.tone, lineHeight: 1 }}>{h.value}</span>
                  {h.sub ? <span style={{ fontSize: 10, color: "var(--muted-foreground)", fontWeight: 600 }}>{h.sub}</span> : null}
                </div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted-foreground)", marginTop: 3, letterSpacing: "0.02em" }}>{h.label}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Pipeline — clickable tiles filter the level cards below */}
        <div className="rounded-2xl mb-5" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "16px 18px" }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><span className="nuru-section-title">Curriculum pipeline</span><span className="nuru-eyebrow nuru-eyebrow-gold">live</span></div>
            {pipelineFilter ? (
              <button onClick={() => setPipelineFilter(null)} className="flex items-center gap-1" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--nuru-gold)", background: "none", border: "none", cursor: "pointer" }}><RotateCcw size={11} /> Clear filter</button>
            ) : null}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {pipelineTiles.map(({ key, label, value, hint, tint, Icon }) => {
              const active = pipelineFilter === key;
              return (
                <button key={key} onClick={() => setPipelineFilter((c) => (c === key ? null : key))} className="rounded-xl flex items-center gap-3 text-left transition-all" style={{ border: active ? "2px solid var(--nuru-gold)" : "1px solid var(--border)", padding: active ? "11px 13px" : "12px 14px", background: active ? "rgba(200,155,60,0.06)" : "var(--secondary)", cursor: "pointer" }}>
                  <div className={`flex items-center justify-center rounded-lg ${tint}`} style={{ width: 36, height: 36 }}><Icon size={16} /></div>
                  <div className="min-w-0">
                    <div className="nuru-eyebrow" style={{ marginBottom: 2 }}>{label}</div>
                    <div className="flex items-baseline gap-2"><span style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--nuru-navy)", lineHeight: 1 }}>{value}</span><span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{active ? "filtering ↓" : hint}</span></div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Quick actions — grouped by workflow: Create · Manage · Utilities */}
        <div className="rounded-2xl mb-5" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "16px 18px" }}>
          <div className="flex items-center gap-2 mb-3"><Zap size={14} style={{ color: "var(--nuru-gold)" }} /><span className="nuru-section-title">Quick actions</span></div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {([
              {
                group: "Create",
                items: [
                  { label: "New Level", Icon: Plus, tint: "tint-green", fn: () => setAddLevel(true) },
                  { label: "New Module", Icon: BookOpen, tint: "tint-blue", fn: () => openWorkspace() },
                  { label: "New Quiz", Icon: HelpCircle, tint: "tint-violet", fn: () => navigate("/quiz-builder") },
                  { label: "Upload Video", Icon: Upload, tint: "tint-amber", fn: () => navigate("/video-library") },
                  { label: "Register External", Icon: Link2, tint: "tint-blue", fn: () => navigate("/video-library") },
                ],
              },
              {
                group: "Manage",
                items: [
                  { label: "Reflection Queue", Icon: MessageSquare, tint: "tint-green", fn: () => navigate("/reflection-queue") },
                  { label: "Reviews", Icon: UserCheck, tint: "tint-amber", fn: () => navigate("/level-reviews") },
                  { label: "Learners", Icon: Users, tint: "tint-blue", fn: () => navigate("/members") },
                  { label: "Certificates", Icon: Award, tint: "tint-violet", fn: () => navigate("/certificates") },
                ],
              },
              {
                group: "Utilities",
                items: [
                  { label: validating ? "Validating…" : "Validate Curriculum", Icon: ClipboardCheck, tint: "tint-violet", fn: () => void runValidate() },
                  { label: "Refresh", Icon: RotateCcw, tint: "tint-blue", fn: () => void loadAll() },
                ],
              },
            ] as { group: string; items: { label: string; Icon: LucideIcon; tint: string; fn: () => void }[] }[]).map(({ group, items }) => (
              <div key={group} className="rounded-xl" style={{ border: "1px solid var(--border)", background: "var(--secondary)", padding: "10px 12px" }}>
                <div className="nuru-eyebrow mb-2">{group}</div>
                <div className="flex flex-wrap gap-2">
                  {items.map(({ label, Icon, tint, fn }) => (
                    <button key={label} onClick={fn} className="flex items-center gap-1.5 rounded-lg px-2.5 transition-colors hover:bg-[var(--card)]" style={{ height: 34, border: "1px solid var(--border)", background: "var(--card)", cursor: "pointer" }}>
                      <span className={`flex items-center justify-center rounded-md ${tint}`} style={{ width: 22, height: 22 }}><Icon size={12} /></span>
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--nuru-navy)" }}>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Needs attention — validation report, ranked (errors → warnings → info) */}
        <div ref={needsRef} className="rounded-2xl mb-5" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "16px 18px", scrollMarginTop: 16 }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} style={{ color: issues.some((i) => i.severity === "error") ? "#A8281F" : "var(--nuru-gold)" }} />
              <span className="nuru-section-title">Needs attention</span>
              <span className="nuru-eyebrow">{issues.length} issue{issues.length === 1 ? "" : "s"}</span>
            </div>
            <button onClick={() => void runValidate()} disabled={validating} className="flex items-center gap-1.5 rounded-lg px-3" style={{ height: 30, fontSize: 11.5, fontWeight: 600, color: "var(--nuru-navy)", background: "var(--secondary)", border: "1px solid var(--border)", cursor: validating ? "wait" : "pointer" }}><ClipboardCheck size={12} /> {validating ? "Validating…" : "Re-validate"}</button>
          </div>
          {issues.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-xl" style={{ background: "#F3FAF5", border: "1px solid #BBE5C9", padding: "12px 14px" }}>
              <CheckCircle2 size={16} style={{ color: "#16A34A" }} />
              <span style={{ fontSize: 13, color: "#0F5132", fontWeight: 600 }}>All clear — every published level and module passes the completeness checks.</span>
            </div>
          ) : (
            <div className="flex flex-col">
              {issues.map((i, idx) => {
                const sm = severityMeta[i.severity];
                const SevIcon = sm.icon;
                return (
                  <div key={`${i.code}-${i.level_number}-${i.module_id ?? "l"}-${idx}`} className="flex items-center gap-3 py-2.5" style={{ borderBottom: idx < issues.length - 1 ? "1px solid var(--border)" : "none" }}>
                    <span className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 30, height: 30, background: sm.bg, color: sm.color }}><SevIcon size={14} /></span>
                    <span className="rounded-full px-2 py-0.5 shrink-0" style={{ fontSize: 9.5, fontWeight: 800, background: sm.bg, color: sm.color, letterSpacing: "0.05em" }}>{sm.label.toUpperCase()}</span>
                    <span className="rounded-md px-1.5 py-0.5 shrink-0" style={{ fontSize: 10, fontWeight: 800, background: "var(--secondary)", color: "var(--nuru-navy)" }}>L{i.level_number}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--foreground)", lineHeight: 1.4 }}>{i.message}</span>
                    <button onClick={() => openWorkspace(i.level_number, i.module_id)} className="flex items-center gap-1 rounded-lg px-2.5 shrink-0" style={{ height: 28, fontSize: 11, fontWeight: 700, color: "#fff", background: "var(--nuru-navy)", border: "none", cursor: "pointer" }}>Open <ArrowRight size={11} /></button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Activity — classified server-side, grouped, not a flat feed */}
        <div className="rounded-2xl mb-5" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "16px 18px" }}>
          <div className="flex items-center gap-2 mb-3"><ActivityIcon size={14} style={{ color: "var(--nuru-navy)" }} /><span className="nuru-section-title">Activity</span></div>
          <div className="flex items-center gap-1.5 flex-wrap mb-3">
            <KindChip active={activityKind === "all"} label="All" count={activity.length} onClick={() => setActivityKind("all")} />
            {KIND_ORDER.filter((k) => (activityCounts.get(k) ?? 0) > 0).map((k) => (
              <KindChip key={k} active={activityKind === k} label={kindMeta[k].label} count={activityCounts.get(k) ?? 0} onClick={() => setActivityKind(k)} />
            ))}
          </div>
          {shownActivity.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>No curriculum activity recorded yet.</p>
          ) : (
            <div className="flex flex-col">
              {shownActivity.slice(0, 12).map((row, i, arr) => {
                const km = kindMeta[row.kind];
                const KIcon = km.icon;
                return (
                  <div key={row.audit_id} className="flex items-start gap-3 py-2.5" style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                    <span className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 30, height: 30, background: `${km.tint}18`, color: km.tint }}><KIcon size={14} /></span>
                    <div className="flex-1 min-w-0">
                      <p style={{ fontSize: 12.5, color: "var(--nuru-navy)", lineHeight: 1.4 }}>
                        {row.actor_name ? <span style={{ fontWeight: 700 }}>{row.actor_name}</span> : null}{" "}
                        <span style={{ color: "var(--muted-foreground)" }}>{humanize(row.action)}</span>
                      </p>
                      <span style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>{km.label} · {relTime(row.occurred_at)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Analytics — expandable, collapsed by default (no chart wall) */}
        <div className="rounded-2xl mb-6" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "16px 18px" }}>
          <div className="flex items-center gap-2 mb-2"><BarChart3 size={14} style={{ color: "var(--nuru-gold)" }} /><span className="nuru-section-title">Analytics</span><span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>expand a section</span></div>

          <AnalyticsSection id="learners" title="Learners by level" icon={GraduationCap} open={openAnalytics.has("learners")} onToggle={toggleAnalytics}>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={88} paddingAngle={2} stroke="#fff" strokeWidth={2}>
                    {pieData.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-3 gap-y-2 mt-2">
              {levels.map((l) => (
                <div key={l.level_number} className="flex items-center gap-2 min-w-0">
                  <span style={{ width: 8, height: 8, background: l.color, borderRadius: 99, flexShrink: 0 }} />
                  <span style={{ fontSize: 11.5, color: "var(--foreground)", fontWeight: 600 }}>L{l.level_number}</span>
                  <span style={{ fontSize: 11, color: "var(--muted-foreground)", marginLeft: "auto" }}>{l.learners}</span>
                </div>
              ))}
            </div>
          </AnalyticsSection>

          <AnalyticsSection id="completion" title="Completion by level" icon={TrendingUp} open={openAnalytics.has("completion")} onToggle={toggleAnalytics}>
            <div style={{ height: 230 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip cursor={{ fill: "rgba(11,31,51,0.04)" }} contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 12 }} />
                  <Bar dataKey="completion" radius={[8, 8, 0, 0]}>
                    {barData.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </AnalyticsSection>

          <AnalyticsSection id="trend" title="Enrolment trend (6 months)" icon={Flame} open={openAnalytics.has("trend")} onToggle={toggleAnalytics}>
            {trend == null ? (
              <p style={{ fontSize: 12, color: "var(--muted-foreground)", padding: "12px 0" }}>Loading trend…</p>
            ) : monthRolls.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--muted-foreground)", padding: "12px 0" }}>No enrolment trend recorded yet.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {monthRolls.map((m) => (
                  <div key={m.month} className="flex items-center gap-3">
                    <span style={{ width: 58, flexShrink: 0, fontSize: 11.5, fontWeight: 600, color: "var(--nuru-navy)" }}>{m.month}</span>
                    <div className="flex-1 rounded-full overflow-hidden" style={{ height: 16, background: "rgba(107,114,128,0.08)" }}>
                      <div className="flex h-full" style={{ width: `${(m.total / peakMonth) * 100}%` }}>
                        {m.seg.filter((s) => s.value > 0).map((s) => (
                          <div key={s.level} style={{ width: `${(s.value / m.total) * 100}%`, background: s.color, minWidth: 2 }} />
                        ))}
                      </div>
                    </div>
                    <span style={{ width: 26, flexShrink: 0, textAlign: "right", fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: m.total > 0 ? "var(--nuru-navy)" : "var(--muted-foreground)" }}>{m.total}</span>
                  </div>
                ))}
              </div>
            )}
          </AnalyticsSection>

          <AnalyticsSection id="modules" title="Module distribution" icon={BookOpen} open={openAnalytics.has("modules")} onToggle={toggleAnalytics} last>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={moduleData} barCategoryGap={8}>
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10.5, fill: "var(--muted-foreground)" }} />
                  <YAxis hide />
                  <Tooltip cursor={{ fill: "rgba(11,31,51,0.04)" }} />
                  <Bar dataKey="modules" name="All modules" fill="#F4E4BD" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="done" name="Published" fill="#22c55e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </AnalyticsSection>
        </div>

        {/* Level summary cards — ONE Open button; everything else lives inside */}
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", letterSpacing: "-0.01em" }}>The levels</h2>
            <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 2 }}>
              {pipelineFilter ? `Filtered to ${pipelineTiles.find((p) => p.key === pipelineFilter)?.label.toLowerCase()} — ${visibleLevels.length} of ${levels.length} levels.` : "Open a level to edit its modules, media, quiz and publishing."}
            </p>
          </div>
          <button onClick={() => openWorkspace()} className="flex items-center gap-1.5" style={{ fontSize: 12, fontWeight: 600, color: "var(--nuru-gold)", background: "none", border: "none", cursor: "pointer" }}>Open workspace <ArrowRight size={12} /></button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {visibleLevels.map((l) => <LevelCard key={l.level_number} level={l} onOpen={() => openWorkspace(l.level_number)} />)}
          {visibleLevels.length === 0 ? (
            <div className="rounded-2xl" style={{ gridColumn: "1 / -1", background: "var(--card)", border: "1px dashed var(--border)", padding: "26px 16px", textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>
              No levels match this pipeline stage.
            </div>
          ) : null}
        </div>
      </div>

      {addLevel ? (
        <LevelModal
          mode="add"
          levelNumber={levels.length + 1}
          saving={savingLevel}
          onSave={(d) => void handleCreateLevel(d)}
          onClose={() => setAddLevel(false)}
        />
      ) : null}
    </div>
  );
}

function KindChip({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }): ReactElement {
  return (
    <button onClick={onClick} className="rounded-lg px-2.5" style={{ height: 30, fontSize: 11.5, fontWeight: 600, background: active ? "var(--nuru-navy)" : "var(--card)", color: active ? "#fff" : "var(--muted-foreground)", border: active ? "none" : "1px solid var(--border)", cursor: "pointer" }}>
      {label} <span style={{ opacity: 0.7 }}>· {count}</span>
    </button>
  );
}

function AnalyticsSection({ id, title, icon: Icon, open, onToggle, last, children }: {
  id: string; title: string; icon: LucideIcon; open: boolean; onToggle: (id: string) => void; last?: boolean; children: ReactNode;
}): ReactElement {
  return (
    <div style={{ borderBottom: last ? "none" : "1px solid var(--border)" }}>
      <button onClick={() => onToggle(id)} className="w-full flex items-center gap-2.5 py-3 text-left" style={{ background: "none", border: "none", cursor: "pointer" }}>
        <span className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 28, height: 28, background: "var(--secondary)", color: "var(--nuru-navy)" }}><Icon size={14} /></span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "var(--nuru-navy)" }}>{title}</span>
        {open ? <ChevronDown size={14} style={{ color: "var(--muted-foreground)" }} /> : <ChevronRight size={14} style={{ color: "var(--muted-foreground)" }} />}
      </button>
      {open ? <div style={{ paddingBottom: 16 }}>{children}</div> : null}
    </div>
  );
}

function LevelCard({ level: l, onOpen }: { level: CurriculumLevelCard; onOpen: () => void }): ReactElement {
  const sp = statusPill[l.status] ?? statusPill.draft!;
  const quizLine = !l.quiz.exam_exists
    ? { text: "No exit exam", tone: "#A8281F" }
    : l.quiz.exam_published
      ? { text: `Exam published · ${l.quiz.question_count} Q`, tone: "#0F6B33" }
      : { text: `Exam in review · ${l.quiz.question_count} Q`, tone: "#8A6B1F" };
  const validation = l.validation.status === "errors"
    ? { text: `${l.validation.errors} error${l.validation.errors === 1 ? "" : "s"}`, bg: "#FDECEC", color: "#A8281F", Icon: AlertTriangle }
    : l.validation.status === "warnings"
      ? { text: `${l.validation.warnings} warning${l.validation.warnings === 1 ? "" : "s"}`, bg: "#FDF5E5", color: "#8A6B1F", Icon: AlertTriangle }
      : { text: "Valid", bg: "#E8F6EE", color: "#0F6B33", Icon: CheckCircle2 };
  const VIcon = validation.Icon;
  return (
    <div className="rounded-2xl overflow-hidden transition-all hover:-translate-y-0.5" style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 1px 2px rgba(11,31,51,0.03)" }}>
      {/* Header band */}
      <div className="flex items-center justify-between" style={{ background: `linear-gradient(120deg, ${l.color} 0%, ${l.color}cc 100%)`, padding: "10px 14px", color: "#fff" }}>
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center rounded-lg" style={{ width: 26, height: 26, background: "rgba(255,255,255,0.2)" }}>
            {l.locked ? <Lock size={12} /> : <span style={{ fontFamily: "var(--font-display)", fontSize: 13 }}>{l.level_number}</span>}
          </div>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em" }}>LEVEL {l.level_number}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {l.duration ? <span className="rounded-full" style={{ background: "rgba(255,255,255,0.2)", fontSize: 10, fontWeight: 700, padding: "3px 9px" }}>{l.duration}</span> : null}
          <span className="rounded-full" style={{ background: sp.bg, color: sp.color, fontSize: 9.5, fontWeight: 800, padding: "3px 9px", letterSpacing: "0.04em" }}>{sp.label}</span>
        </div>
      </div>
      <div style={{ padding: "13px 15px 15px" }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: 17, color: "var(--foreground)", letterSpacing: "-0.01em", lineHeight: 1.2 }}>{l.title}</h3>
        <p style={{ fontSize: 11.5, color: "var(--muted-foreground)", lineHeight: 1.45, marginTop: 3, minHeight: 17, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.theme || "Discipleship pathway level."}</p>

        {/* Stat grid */}
        <div className="grid grid-cols-3 gap-2 mt-3">
          {[
            { lbl: "Published", v: String(l.modules_published), I: BookOpen },
            { lbl: "Drafts", v: String(l.modules_draft), I: PenLine },
            { lbl: "Videos", v: String(l.videos_attached), I: Video },
            { lbl: "Learners", v: String(l.learners), I: Users },
            { lbl: "Certs", v: String(l.certificates), I: Award },
            { lbl: "Est. time", v: l.estimated_minutes > 0 ? `${l.estimated_minutes}m` : "—", I: Clock },
          ].map((m) => {
            const I = m.I;
            return (
              <div key={m.lbl} className="rounded-lg text-center" style={{ background: `${l.color}10`, padding: "6px 4px" }}>
                <I size={10} style={{ color: l.color, margin: "0 auto" }} />
                <div style={{ fontFamily: "var(--font-display)", fontSize: 14, color: "var(--foreground)", marginTop: 1 }}>{m.v}</div>
                <div style={{ fontSize: 9, color: "var(--muted-foreground)", fontWeight: 600 }}>{m.lbl}</div>
              </div>
            );
          })}
        </div>

        {/* Quiz status */}
        <div className="flex items-center gap-1.5 mt-3" style={{ fontSize: 11, fontWeight: 600, color: quizLine.tone }}>
          <HelpCircle size={11} /> {quizLine.text}
        </div>

        {/* Completion */}
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span style={{ fontSize: 10.5, color: "var(--muted-foreground)", fontWeight: 600 }}>Completion</span>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: l.color }}>{l.completion_pct}%</span>
          </div>
          <div style={{ height: 5, background: "var(--input-background)", borderRadius: 99, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${l.completion_pct}%`, background: `linear-gradient(90deg, ${l.color}, ${l.color}cc)`, borderRadius: 99 }} />
          </div>
        </div>

        {/* Footer: validation badge · last updated · Open */}
        <div className="flex items-center gap-2 mt-3.5 pt-3" style={{ borderTop: "1px dashed var(--border)" }}>
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 shrink-0" style={{ background: validation.bg, color: validation.color, fontSize: 10, fontWeight: 700 }}><VIcon size={10} /> {validation.text}</span>
          <span style={{ flex: 1, fontSize: 10.5, color: "var(--muted-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.last_updated ? `Updated ${relTime(l.last_updated)}` : "Never edited"}</span>
          <button onClick={onOpen} className="flex items-center gap-1 rounded-lg px-3 shrink-0" style={{ height: 30, background: l.color, color: "#fff", fontSize: 11.5, fontWeight: 700, border: "none", cursor: "pointer", boxShadow: `0 4px 12px ${l.color}33` }}>
        Open <ArrowRight size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}
