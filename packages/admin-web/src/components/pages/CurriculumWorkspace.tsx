// Levels & Modules Workspace (docs/CURRICULUM_ARCHITECTURE.md §5.2) — replaces
// Level Detail. Left: the levels→modules tree (search, expand/collapse, add,
// drag-reorder, publish/unpublish/archive row menus, exam chip + level actions).
// Right: the SECTIONED module editor — Overview · Content · Media · Quiz ·
// Resources · Reflection · Publishing are sections, not pages. The level node's
// Final Assessment mounts the exam editor with settings + the exam publish gate.
// Deep link: /curriculum/workspace?level=N&module=ID.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactElement, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ChevronRight, ChevronDown, Plus, Eye, Pencil, BookOpen, X, Lock, Unlock, FileText,
  ClipboardList, AlertTriangle, Target, Tag, Hash, Video, Award, Check, Clock,
  Bold, Italic, Strikethrough, Heading1, Heading2, Heading3, List, ListOrdered,
  Quote, Code2, Link as LinkIcon, Image as ImageIcon, Table as TableIcon, Minus,
  SeparatorHorizontal, Trash2, MoreHorizontal, GripVertical, Search, Layers,
  History, MessageSquare, ArrowUp, ArrowDown, Link2, ExternalLink, ShieldCheck,
  CheckCircle2, Send, Loader2, Play,
} from "lucide-react";
import axios from "axios";
import {
  CurriculumApi, MediaApi,
  type AdminLevel, type AdminModuleSummary, type AdminModule, type EvaluationKind,
  type ModulePlacementRow, type ModuleVersion, type MediaAssetRow,
} from "../../api/client";
import { errorMessage } from "../../util/error";
import { MarkdownPreview } from "../MarkdownPreview";
import { LevelModal, type LevelFormData, type LevelStatus } from "../curriculum/LevelModal";
import { ModuleQuizBuilder, type QuizSettings } from "../curriculum/ModuleQuizBuilder";
import { splitSections, sectionLabel, addSection, renameSection, deleteSection } from "../../lib/sections";

const statusPill: Record<string, { bg: string; color: string }> = {
  published: { bg: "#E8F6EE", color: "#0F6B33" },
  draft: { bg: "#EEF1F8", color: "#1F3A6B" },
  archived: { bg: "#F3F4F6", color: "#94A3B8" },
};
const beToLabel: Record<string, LevelStatus> = { published: "Published", draft: "Draft", in_review: "In Review" };
const labelToBe: Record<LevelStatus, string> = { Published: "published", Draft: "draft", "In Review": "in_review" };
const EVAL_OPTS: { v: EvaluationKind; l: string }[] = [
  { v: "none", l: "— none —" }, { v: "quiz", l: "Quiz" }, { v: "reflection", l: "Reflection" }, { v: "exit_exam", l: "Exit exam" },
];
const fieldLabel: CSSProperties = { fontSize: 10.5, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 6 };
const fieldInput: CSSProperties = { width: "100%", height: 42, borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--input-background)", fontSize: 13, padding: "0 14px", color: "var(--foreground)", outline: "none" };
const areaInput: CSSProperties = { width: "100%", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--input-background)", fontSize: 13, padding: "10px 14px", color: "var(--foreground)", outline: "none", resize: "vertical", lineHeight: 1.6, fontFamily: "var(--font-sans)" };
const secToMin = (sec: number | null): number => (sec == null ? 0 : Math.round(sec / 60));
const minToSec = (min: string): number | null => {
  const n = Math.max(0, Math.round(Number(min)));
  return Number.isFinite(n) && n > 0 ? n * 60 : null;
};
const dur = (s: number | null): string => { if (!s) return "—"; const m = Math.floor(s / 60), ss = s % 60; return `${m}:${String(ss).padStart(2, "0")}`; };

type SectionKey = "overview" | "content" | "media" | "quiz" | "resources" | "reflection" | "publishing";
const SECTIONS: { key: SectionKey; label: string; icon: typeof BookOpen }[] = [
  { key: "overview", label: "Overview", icon: BookOpen },
  { key: "content", label: "Content", icon: FileText },
  { key: "media", label: "Media", icon: Video },
  { key: "quiz", label: "Quiz", icon: ClipboardList },
  { key: "resources", label: "Resources", icon: Link2 },
  { key: "reflection", label: "Reflection", icon: MessageSquare },
  { key: "publishing", label: "Publishing", icon: Send },
];

type Selection = { kind: "module"; id: string; level: number } | { kind: "exam"; level: number } | null;

export function CurriculumWorkspace(): ReactElement {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [levels, setLevels] = useState<AdminLevel[]>([]);
  const [modsByLevel, setModsByLevel] = useState<Record<number, AdminModuleSummary[]>>({});
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [treeSearch, setTreeSearch] = useState("");
  const [selected, setSelected] = useState<Selection>(null);
  const [section, setSection] = useState<SectionKey>("overview");

  const [mod, setMod] = useState<AdminModule | null>(null);
  const [draft, setDraft] = useState<AdminModule | null>(null);
  const [dirty, setDirty] = useState(false);
  const [mdView, setMdView] = useState<"write" | "preview">("write");

  const [levelModal, setLevelModal] = useState<{ mode: "add" | "edit"; level?: AdminLevel } | null>(null);
  const [savingLevel, setSavingLevel] = useState(false);
  const [addingTo, setAddingTo] = useState<number | null>(null);
  const [newModTitle, setNewModTitle] = useState("");
  const [rowMenu, setRowMenu] = useState<{ mod: AdminModuleSummary; x: number; y: number } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  // Media section (placements, §2.2 — level always inferred from the module).
  const [placements, setPlacements] = useState<ModulePlacementRow[]>([]);
  const [placementsBusy, setPlacementsBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Publishing section (immutable version history).
  const [versions, setVersions] = useState<ModuleVersion[] | null>(null);

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const bootRef = useRef(false);

  const loadLevels = useCallback(async () => {
    try { setLevels(await CurriculumApi.levels()); }
    catch (e) { setError(errorMessage(e, "Could not load levels.")); }
  }, []);
  const loadMods = useCallback(async (levelNo: number) => {
    try { const ms = await CurriculumApi.modules(levelNo); setModsByLevel((p) => ({ ...p, [levelNo]: ms })); return ms; }
    catch { return []; }
  }, []);

  useEffect(() => { void loadLevels(); }, [loadLevels]);

  // Deep-link boot: ?level=N expands (and selects its first module unless
  // ?module=ID picks one); ?module alone still resolves once mods load.
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    const levelParam = searchParams.get("level");
    const moduleParam = searchParams.get("module");
    const levelNo = levelParam ? parseInt(levelParam, 10) : NaN;
    if (!Number.isFinite(levelNo)) return;
    setExpanded((p) => new Set([...p, levelNo]));
    void loadMods(levelNo).then((ms) => {
      if (moduleParam && ms.some((m) => m.module_id === moduleParam)) {
        setSelected({ kind: "module", id: moduleParam, level: levelNo });
      } else if (ms[0]) {
        setSelected({ kind: "module", id: ms[0].module_id, level: levelNo });
      } else {
        setSelected({ kind: "exam", level: levelNo });
      }
    });
    // searchParams is only read once on boot by design.
  }, []);

  // Keep the URL shareable: reflect the selection into ?level&module.
  useEffect(() => {
    if (!selected) return;
    const q: Record<string, string> = { level: String(selected.level) };
    if (selected.kind === "module") q.module = selected.id;
    setSearchParams(q, { replace: true });
  }, [selected, setSearchParams]);

  // Load the full module + its placements when a module is selected.
  useEffect(() => {
    if (selected?.kind !== "module") { setMod(null); setDraft(null); setPlacements([]); setVersions(null); return; }
    const id = selected.id;
    setVersions(null);
    void CurriculumApi.module(id)
      .then((m) => { setMod(m); setDraft(m); setDirty(false); setMdView("write"); })
      .catch((e) => setError(errorMessage(e, "Could not load module.")));
    void CurriculumApi.modulePlacements(id).then(setPlacements).catch(() => setPlacements([]));
  }, [selected?.kind === "module" ? selected.id : null]); // re-run only when the selected MODULE id changes

  // Version history loads lazily when Publishing opens.
  useEffect(() => {
    if (section !== "publishing" || selected?.kind !== "module" || versions !== null) return;
    void CurriculumApi.versions(selected.id).then(setVersions).catch(() => setVersions([]));
  }, [section, selected, versions]);

  function setField<K extends keyof AdminModule>(key: K, val: AdminModule[K]): void {
    setDraft((d) => (d ? { ...d, [key]: val } : d));
    setDirty(true);
  }
  function toggleExpand(n: number): void {
    setExpanded((prev) => { const s = new Set(prev); if (s.has(n)) s.delete(n); else { s.add(n); if (!modsByLevel[n]) void loadMods(n); } return s; });
  }
  const expandAll = (): void => { setExpanded(new Set(levels.map((l) => l.level_number))); for (const l of levels) if (!modsByLevel[l.level_number]) void loadMods(l.level_number); };
  const collapseAll = (): void => setExpanded(new Set());

  function selectModule(m: AdminModuleSummary): void {
    setSelected({ kind: "module", id: m.module_id, level: m.level_number });
    setSection("overview");
    setNotice(null); setError(null);
  }

  // ── Markdown helpers (Content section) ──
  function wrap(before: string, after = before, ph = "text"): void {
    const ta = contentRef.current; if (!ta || !draft) return;
    const s = ta.selectionStart, e = ta.selectionEnd, v = draft.lesson_content, sel = v.slice(s, e) || ph;
    setField("lesson_content", v.slice(0, s) + before + sel + after + v.slice(e));
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(s + before.length, s + before.length + sel.length); });
  }
  function prefix(p: string): void {
    const ta = contentRef.current; if (!ta || !draft) return;
    const s = ta.selectionStart, e = ta.selectionEnd, v = draft.lesson_content, ls = v.lastIndexOf("\n", s - 1) + 1;
    const block = v.slice(ls, e) || "list item";
    const replaced = block.split("\n").map((l) => p + l).join("\n");
    setField("lesson_content", v.slice(0, ls) + replaced + v.slice(e));
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(ls, ls + replaced.length); });
  }
  function insert(text: string): void {
    const ta = contentRef.current; if (!ta || !draft) return;
    const s = ta.selectionStart, v = draft.lesson_content;
    setField("lesson_content", v.slice(0, s) + text + v.slice(s));
    requestAnimationFrame(() => { ta.focus(); const pos = s + text.length; ta.setSelectionRange(pos, pos); });
  }

  async function saveModule(): Promise<void> {
    if (!draft || !mod) return;
    setError(null); setNotice(null);
    const verses = draft.key_verses ?? [];
    try {
      const updated = await CurriculumApi.updateModule(mod.module_id, {
        title: draft.title, summary: draft.summary, lesson_content: draft.lesson_content,
        evaluation_kind: draft.evaluation_kind, quiz_pass_mark: Number(draft.quiz_pass_mark),
        estimated_minutes: draft.estimated_minutes, video_url: draft.video_url || null,
        video_duration_sec: draft.video_duration_sec, audio_url: draft.audio_url || null,
        audio_duration_sec: draft.audio_duration_sec,
        key_verses: verses.length ? verses : null, max_attempts: draft.max_attempts,
        difficulty: draft.difficulty, objectives: draft.objectives || null, tags: draft.tags || null,
        visibility: draft.visibility, required: draft.required,
        expected_row_version: mod.row_version,
      }) as AdminModule;
      setMod(updated); setDraft(updated); setDirty(false); setNotice("Saved.");
      void loadMods(updated.level_number);
    } catch (e) { setError(errorMessage(e, "Save failed — the module may have changed elsewhere (reload).")); }
  }

  // Per-module quiz settings (Quiz section) — persisted via updateModule.
  function moduleQuizSettings(m: AdminModule): QuizSettings {
    return {
      passMark: Math.round(Number(m.quiz_pass_mark) || 70),
      shuffleQuestions: m.quiz_shuffle ?? false,
      showAnswersAfterSubmit: m.quiz_show_answers ?? false,
      showScoreAfterSubmit: m.quiz_show_score ?? true,
      timeLimitMinutes: m.time_limit_sec != null ? Math.round(m.time_limit_sec / 60) : null,
    };
  }
  async function saveModuleQuizSettings(m: AdminModule, s: QuizSettings): Promise<void> {
    const updated = await CurriculumApi.updateModule(m.module_id, {
      quiz_pass_mark: s.passMark,
      quiz_shuffle: s.shuffleQuestions,
      quiz_show_answers: s.showAnswersAfterSubmit,
      quiz_show_score: s.showScoreAfterSubmit,
      time_limit_sec: s.timeLimitMinutes != null ? s.timeLimitMinutes * 60 : null,
      expected_row_version: m.row_version,
    }) as AdminModule;
    setMod(updated); setDraft(updated);
    void loadMods(updated.level_number);
  }

  async function togglePublish(target?: AdminModuleSummary): Promise<void> {
    const id = target?.module_id ?? mod?.module_id;
    const currentStatus = target?.status ?? mod?.status;
    if (!id || !currentStatus) return;
    try {
      const updated = currentStatus === "published" ? await CurriculumApi.unpublish(id) : await CurriculumApi.publish(id);
      if (mod?.module_id === id) { setMod(updated); setDraft(updated); }
      setNotice(updated.status === "published" ? "Published." : "Unpublished.");
      void loadMods(updated.level_number);
    } catch (e) { setError(errorMessage(e, "Publish rejected by validation (quiz needs questions / contiguous sequence).")); }
  }
  async function archiveModule(target?: AdminModuleSummary): Promise<void> {
    const id = target?.module_id ?? mod?.module_id;
    const levelNo = target?.level_number ?? mod?.level_number;
    if (!id || levelNo == null) return;
    try {
      await CurriculumApi.archive(id);
      setNotice("Module archived.");
      void loadMods(levelNo);
      if (mod?.module_id === id) setSelected(null);
    } catch (e) { setError(errorMessage(e, "Archive failed.")); }
  }
  async function addModule(levelNo: number): Promise<void> {
    if (!newModTitle.trim()) return;
    try {
      const created = await CurriculumApi.createModule({ level_number: levelNo, title: newModTitle.trim(), lesson_content: "Draft content — edit here.", evaluation_kind: "none" }) as AdminModule;
      setNewModTitle(""); setAddingTo(null);
      await loadMods(levelNo);
      setSelected({ kind: "module", id: created.module_id, level: levelNo });
      setSection("overview");
    } catch (e) { setError(errorMessage(e, "Could not add module.")); }
  }
  async function handleSaveLevel(data: LevelFormData): Promise<void> {
    setSavingLevel(true); setError(null);
    try {
      if (levelModal?.mode === "add") {
        // createLevel accepts the pass mark at birth (§2.5) — edits do not.
        await CurriculumApi.createLevel({ title: data.title, theme: data.theme, required_exam_pass_mark: data.passMark, duration: data.duration, status: labelToBe[data.status], locked: data.locked, color: data.color });
      } else if (levelModal?.level) {
        const prev = levelModal.level;
        // ONE editor per entity: updateLevel carries level metadata ONLY; the
        // pass mark routes through updateExam when it actually changed.
        await CurriculumApi.updateLevel(prev.level_number, { title: data.title, theme: data.theme, duration: data.duration, status: labelToBe[data.status], locked: data.locked, color: data.color });
        const prevMark = Math.round(Number(prev.required_exam_pass_mark) || 0);
        if (data.passMark !== prevMark) {
          await CurriculumApi.updateExam(prev.level_number, { required_exam_pass_mark: data.passMark });
        }
      }
      setLevelModal(null); await loadLevels();
    } catch (e) { setError(errorMessage(e, "Save failed.")); }
    finally { setSavingLevel(false); }
  }
  async function setLevelStatus(n: number, status: LevelStatus): Promise<void> {
    try { await CurriculumApi.updateLevel(n, { status: labelToBe[status] }); await loadLevels(); }
    catch (e) { setError(errorMessage(e, "Update failed.")); }
  }
  async function toggleLock(l: AdminLevel): Promise<void> {
    try { await CurriculumApi.updateLevel(l.level_number, { locked: !l.locked }); await loadLevels(); }
    catch (e) { setError(errorMessage(e, "Update failed.")); }
  }

  // Drag-reorder → the existing reorder endpoint (server renumbers the level).
  function onDropModule(e: DragEvent, target: AdminModuleSummary): void {
    e.preventDefault();
    const id = dragId; setDragId(null);
    if (!id || id === target.module_id) return;
    void CurriculumApi.reorder(id, target.module_sequence_number)
      .then((ms) => setModsByLevel((p) => ({ ...p, [target.level_number]: ms })))
      .catch((err) => setError(errorMessage(err, "Reorder failed.")));
  }

  // ── Placements (Media section) ──
  const reloadPlacements = useCallback(async (moduleId: string) => {
    try { setPlacements(await CurriculumApi.modulePlacements(moduleId)); } catch { /* keep last */ }
  }, []);
  async function placeAsset(asset: MediaAssetRow): Promise<void> {
    if (selected?.kind !== "module") return;
    setPlacementsBusy(true); setError(null);
    try {
      await MediaApi.addPlacement(asset.media_asset_id, { module_id: selected.id, position: placements.length });
      setNotice("Video placed in this module.");
      await reloadPlacements(selected.id);
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 409) setError("That video is already placed in this module.");
      else setError(errorMessage(e, "Could not place the video."));
    } finally { setPlacementsBusy(false); }
  }
  async function removePlacement(p: ModulePlacementRow): Promise<void> {
    if (selected?.kind !== "module") return;
    setPlacementsBusy(true); setError(null);
    try {
      await MediaApi.removePlacement(p.placement_id);
      setNotice("Placement removed — the asset stays in the library.");
      await reloadPlacements(selected.id);
    } catch (e) { setError(errorMessage(e, "Could not remove the placement.")); }
    finally { setPlacementsBusy(false); }
  }
  // The placement API is create/delete only — required/position edits re-place
  // the row (remove + add with the new values); the mirror column follows.
  async function toggleRequired(p: ModulePlacementRow): Promise<void> {
    if (selected?.kind !== "module") return;
    setPlacementsBusy(true); setError(null);
    try {
      await MediaApi.removePlacement(p.placement_id);
      await MediaApi.addPlacement(p.media_asset_id, { module_id: selected.id, position: p.position, required: !p.required });
      await reloadPlacements(selected.id);
    } catch (e) { setError(errorMessage(e, "Could not update the placement.")); }
    finally { setPlacementsBusy(false); }
  }
  async function movePlacement(index: number, dir: -1 | 1): Promise<void> {
    if (selected?.kind !== "module") return;
    const next = [...placements];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    const a = next[index]!, b = next[j]!;
    next[index] = b; next[j] = a;
    setPlacementsBusy(true); setError(null);
    try {
      // Renumber the whole (tiny) list so ordering is stable from here on.
      for (let i = 0; i < next.length; i++) {
        const row = next[i]!;
        await MediaApi.removePlacement(row.placement_id);
        const created = await MediaApi.addPlacement(row.media_asset_id, { module_id: selected.id, position: i, required: row.required });
        row.placement_id = created.placement_id;
        row.position = created.position;
      }
      await reloadPlacements(selected.id);
    } catch (e) {
      setError(errorMessage(e, "Could not reorder the placements."));
      await reloadPlacements(selected.id);
    } finally { setPlacementsBusy(false); }
  }

  async function revertVersion(versionNumber: number): Promise<void> {
    if (selected?.kind !== "module") return;
    try {
      const updated = await CurriculumApi.revert(selected.id, versionNumber);
      setMod(updated); setDraft(updated); setDirty(false); setVersions(null);
      setNotice(`Reverted to version ${versionNumber}.`);
      void loadMods(updated.level_number);
    } catch (e) { setError(errorMessage(e, "Revert failed.")); }
  }

  const selectedLevel = useMemo(() => {
    const n = selected?.kind === "module" ? mod?.level_number : selected?.level;
    return n != null ? levels.find((l) => l.level_number === n) ?? null : null;
  }, [selected, mod, levels]);
  const allModulesCount = Object.values(modsByLevel).reduce((s, m) => s + m.length, 0);
  const publishedCount = Object.values(modsByLevel).flat().filter((m) => m.status === "published").length;
  const verses = draft ? (draft.key_verses ?? []) : [];

  const tools: { Icon: typeof Bold; title: string; act: () => void; group?: boolean }[] = [
    { Icon: Heading1, title: "H1", act: () => prefix("# ") },
    { Icon: Heading2, title: "H2", act: () => prefix("## ") },
    { Icon: Heading3, title: "H3", act: () => prefix("### ") },
    { Icon: Bold, title: "Bold", act: () => wrap("**", "**", "bold"), group: true },
    { Icon: Italic, title: "Italic", act: () => wrap("_", "_", "italic") },
    { Icon: Strikethrough, title: "Strikethrough", act: () => wrap("~~", "~~", "strike") },
    { Icon: Code2, title: "Code", act: () => wrap("`", "`", "code") },
    { Icon: Quote, title: "Quote", act: () => prefix("> "), group: true },
    { Icon: List, title: "Bullets", act: () => prefix("- ") },
    { Icon: ListOrdered, title: "Numbered", act: () => prefix("1. ") },
    { Icon: LinkIcon, title: "Link", act: () => wrap("[", "](https://)", "link"), group: true },
    { Icon: ImageIcon, title: "Image", act: () => insert("![alt](https://)") },
    { Icon: TableIcon, title: "Table", act: () => insert("\n| A | B |\n| --- | --- |\n| 1 | 2 |\n") },
    { Icon: Minus, title: "Divider", act: () => insert("\n---\n") },
    { Icon: SeparatorHorizontal, title: "Add section", act: () => draft && setField("lesson_content", addSection(draft.lesson_content)), group: true },
  ];
  const sections = draft ? splitSections(draft.lesson_content) : [];
  const pageCount = Math.max(1, sections.length);

  // Tree search: filter modules by title; keep levels whose title matches too.
  const q = treeSearch.trim().toLowerCase();
  const treeLevels = levels.filter((l) => {
    if (!q) return true;
    if (l.title.toLowerCase().includes(q)) return true;
    return (modsByLevel[l.level_number] ?? []).some((m) => m.title.toLowerCase().includes(q));
  });
  const modsFor = (levelNo: number): AdminModuleSummary[] => {
    const ms = modsByLevel[levelNo] ?? [];
    if (!q) return ms;
    const level = levels.find((l) => l.level_number === levelNo);
    if (level?.title.toLowerCase().includes(q)) return ms;
    return ms.filter((m) => m.title.toLowerCase().includes(q));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--background)" }}>
      {/* Header band */}
      <div style={{ background: "var(--nuru-dark)", padding: "16px clamp(16px,3vw,36px)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexShrink: 0, flexWrap: "wrap" }}>
        <div>
          <div className="flex items-center gap-1.5" style={{ fontSize: 10.5, color: "rgba(232,239,245,0.45)", marginBottom: 5 }}>
            <button onClick={() => navigate("/curriculum")} style={{ color: "rgba(232,239,245,0.45)", background: "none", border: "none", cursor: "pointer" }}>Curriculum</button>
            <ChevronRight size={10} /><span style={{ color: "rgba(232,239,245,0.7)" }}>Workspace</span>
          </div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "#fff", lineHeight: 1.1, letterSpacing: "-0.01em" }}>Levels &amp; Modules</h1>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {[
            { label: "Levels", val: levels.length, accent: "#c89b3c" },
            { label: "Modules", val: allModulesCount, accent: "#22c55e" },
            { label: "Published", val: publishedCount, accent: "#22c55e" },
          ].map((s) => (
            <div key={s.label} style={{ minWidth: 84, padding: "6px 16px", borderRadius: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)", borderTop: `2px solid ${s.accent}` }}>
              <div className="flex items-center gap-1.5 justify-center">
                <span style={{ width: 6, height: 6, borderRadius: 99, background: s.accent }} />
                <span style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "#fff", lineHeight: 1.1 }}>{s.val}</span>
              </div>
              <div style={{ textAlign: "center", fontSize: 10, color: "rgba(232,239,245,0.45)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginTop: 1 }}>{s.label}</div>
            </div>
          ))}
          <button onClick={() => setLevelModal({ mode: "add" })} className="flex items-center gap-2 rounded-xl px-4" style={{ height: 40, background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 700, boxShadow: "0 6px 18px rgba(200,155,60,0.30)", border: "none", flexShrink: 0, cursor: "pointer" }}><Plus size={14} /> New level</button>
        </div>
      </div>

      <div className="r-split" style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* ── LEFT — tree ── */}
        <div className="r-split-rail" style={{ width: 290, flexShrink: 0, background: "var(--card)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            <div className="flex items-center gap-2 rounded-lg px-2.5" style={{ height: 34, background: "var(--input-background)", border: "1px solid var(--border)" }}>
              <Search size={12} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />
              <input value={treeSearch} onChange={(e) => { setTreeSearch(e.target.value); if (e.target.value.trim()) expandAll(); }} placeholder="Search levels & modules…" className="bg-transparent outline-none flex-1" style={{ fontSize: 12, color: "var(--foreground)" }} />
              {treeSearch ? <button onClick={() => setTreeSearch("")} style={{ background: "none", border: "none", color: "var(--muted-foreground)", cursor: "pointer", display: "flex" }}><X size={11} /></button> : null}
            </div>
            <div className="flex items-center justify-between mt-2">
              <p style={{ fontSize: 10.5, color: "var(--muted-foreground)", fontWeight: 600 }}>{levels.length} levels · {allModulesCount} loaded</p>
              <div className="flex items-center gap-1">
                <button onClick={expandAll} title="Expand all" style={{ fontSize: 10, fontWeight: 700, color: "var(--nuru-gold)", background: "none", border: "none", cursor: "pointer" }}>Expand</button>
                <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>·</span>
                <button onClick={collapseAll} title="Collapse all" style={{ fontSize: 10, fontWeight: 700, color: "var(--nuru-gold)", background: "none", border: "none", cursor: "pointer" }}>Collapse</button>
              </div>
            </div>
          </div>
          <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto" }}>
            {treeLevels.map((level) => {
              const mods = modsFor(level.level_number);
              const allMods = modsByLevel[level.level_number] ?? [];
              const pub = allMods.filter((m) => m.status === "published").length;
              const isOpen = expanded.has(level.level_number);
              const examPublished = (level.exam_status ?? "review") === "published";
              const uiStatus = beToLabel[level.status] ?? "Draft";
              const examSelected = selected?.kind === "exam" && selected.level === level.level_number;
              return (
                <div key={level.level_number}>
                  <div onClick={() => toggleExpand(level.level_number)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 12px", background: `linear-gradient(90deg, ${level.color}18 0%, transparent 80%)`, borderLeft: `4px solid ${level.color}`, borderBottom: "1px solid var(--border)", cursor: "pointer", userSelect: "none" }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: level.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "#fff", flexShrink: 0, boxShadow: `0 2px 6px ${level.color}44` }}>L{level.level_number}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--nuru-navy)", lineHeight: 1.25, display: "flex", alignItems: "center", gap: 5 }}>{level.title}{level.locked ? <Lock size={9} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} /> : null}</div>
                      <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 1 }}>{pub} published · {allMods.length - pub} draft</div>
                    </div>
                    {/* Exam status chip in the level header (§5.2). */}
                    <span title={examPublished ? "Exit exam published" : "Exit exam in review"} className="rounded-full px-1.5 py-0.5 shrink-0" style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.04em", background: examPublished ? "#E8F6EE" : "#FDF5E5", color: examPublished ? "#0F6B33" : "#8A6B1F" }}>EXAM</span>
                    <button onClick={(e) => { e.stopPropagation(); setLevelModal({ mode: "edit", level }); }} title="Edit level" style={{ width: 22, height: 22, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)" }}><Pencil size={10} /></button>
                    {isOpen ? <ChevronDown size={12} style={{ color: "var(--muted-foreground)" }} /> : <ChevronRight size={12} style={{ color: "var(--muted-foreground)" }} />}
                  </div>
                  {isOpen ? (
                    <div>
                      {/* Level actions row: Review / Publish / Unlock (§5.2). */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px 6px 18px", borderBottom: "1px solid var(--border)", background: "var(--secondary)", flexWrap: "wrap" }}>
                        {uiStatus === "Draft" && !level.locked ? <button onClick={() => void setLevelStatus(level.level_number, "In Review")} className="flex items-center gap-1 rounded-md px-2" style={{ height: 22, background: "var(--nuru-gold)", color: "#fff", fontSize: 10, fontWeight: 700, border: "none", cursor: "pointer" }}><Eye size={9} /> Review</button> : null}
                        {uiStatus === "In Review" ? <button onClick={() => void setLevelStatus(level.level_number, "Published")} className="flex items-center gap-1 rounded-md px-2" style={{ height: 22, background: "#0F6B33", color: "#fff", fontSize: 10, fontWeight: 700, border: "none", cursor: "pointer" }}><CheckCircle2 size={9} /> Publish</button> : null}
                        {level.locked ? <button onClick={() => void toggleLock(level)} className="flex items-center gap-1 rounded-md px-2" style={{ height: 22, border: "1px solid var(--border)", background: "var(--card)", color: "var(--muted-foreground)", fontSize: 10, fontWeight: 700, cursor: "pointer" }}><Unlock size={9} /> Unlock</button>
                          : <button onClick={() => void toggleLock(level)} className="flex items-center gap-1 rounded-md px-2" style={{ height: 22, border: "1px solid var(--border)", background: "var(--card)", color: "var(--muted-foreground)", fontSize: 10, fontWeight: 700, cursor: "pointer" }}><Lock size={9} /> Lock</button>}
                        <span style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 700, color: "var(--muted-foreground)" }}>{uiStatus}</span>
                      </div>
                      {mods.map((m) => {
                        const sel = selected?.kind === "module" && m.module_id === selected.id;
                        const sp = statusPill[m.status] ?? statusPill.draft!;
                        return (
                          <div
                            key={m.module_id}
                            onClick={() => selectModule(m)}
                            draggable
                            onDragStart={() => setDragId(m.module_id)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => onDropModule(e, m)}
                            onDragEnd={() => setDragId(null)}
                            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 8px 8px 12px", background: sel ? `${level.color}10` : dragId === m.module_id ? "var(--secondary)" : "transparent", borderLeft: sel ? `4px solid ${level.color}` : "4px solid transparent", borderBottom: "1px solid var(--border)", cursor: "pointer", opacity: dragId === m.module_id ? 0.55 : 1 }}
                          >
                            <GripVertical size={10} style={{ color: "var(--muted-foreground)", flexShrink: 0, cursor: "grab" }} />
                            <span style={{ fontSize: 9.5, fontWeight: 800, minWidth: 22, textAlign: "center", padding: "2px 5px", borderRadius: 5, background: sel ? level.color : "var(--secondary)", color: sel ? "#fff" : "var(--muted-foreground)", flexShrink: 0 }}>{m.module_sequence_number}</span>
                            <span style={{ flex: 1, fontSize: 12.5, fontWeight: sel ? 700 : 500, color: sel ? "var(--nuru-navy)" : "var(--foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.title}</span>
                            <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 999, ...sp, flexShrink: 0, letterSpacing: "0.04em" }}>{m.status.toUpperCase()}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setRowMenu({ mod: m, x: r.right, y: r.bottom + 4 }); }}
                              title="Module actions"
                              style={{ width: 22, height: 22, borderRadius: 6, border: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, color: "var(--muted-foreground)" }}
                            ><MoreHorizontal size={12} /></button>
                          </div>
                        );
                      })}
                      {/* Final Assessment node — the level's exit exam (§5.2). */}
                      <div onClick={() => { setSelected({ kind: "exam", level: level.level_number }); setNotice(null); setError(null); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 8px 8px 18px", background: examSelected ? `${level.color}10` : "transparent", borderLeft: examSelected ? `4px solid ${level.color}` : "4px solid transparent", borderBottom: "1px solid var(--border)", cursor: "pointer" }}>
                        <Award size={12} style={{ color: examSelected ? level.color : "var(--nuru-gold)", flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: 12, fontWeight: examSelected ? 700 : 600, color: "var(--nuru-navy)" }}>Final Assessment</span>
                        <span className="rounded-full px-1.5 py-0.5" style={{ fontSize: 8.5, fontWeight: 800, background: examPublished ? "#E8F6EE" : "#FDF5E5", color: examPublished ? "#0F6B33" : "#8A6B1F" }}>{examPublished ? "LIVE" : "REVIEW"}</span>
                      </div>
                      {addingTo === level.level_number ? (
                        <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", background: "var(--secondary)" }}>
                          <input autoFocus value={newModTitle} onChange={(e) => setNewModTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void addModule(level.level_number); if (e.key === "Escape") { setAddingTo(null); setNewModTitle(""); } }} placeholder="Module title…" style={{ width: "100%", height: 32, borderRadius: 8, border: `1.5px solid ${level.color}55`, background: "var(--card)", fontSize: 12.5, padding: "0 10px", color: "var(--foreground)", outline: "none" }} />
                          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                            <button onClick={() => void addModule(level.level_number)} disabled={!newModTitle.trim()} style={{ flex: 1, height: 28, borderRadius: 7, border: "none", background: newModTitle.trim() ? level.color : "var(--muted)", color: newModTitle.trim() ? "#fff" : "var(--muted-foreground)", fontSize: 11.5, fontWeight: 700, cursor: newModTitle.trim() ? "pointer" : "not-allowed" }}>Create</button>
                            <button onClick={() => { setAddingTo(null); setNewModTitle(""); }} style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={11} /></button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => setAddingTo(level.level_number)} style={{ width: "100%", padding: "7px 18px", textAlign: "left", display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, color: level.color, background: "transparent", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer" }}><Plus size={11} /> New module</button>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {treeLevels.length === 0 ? <p style={{ padding: "18px 14px", fontSize: 12, color: "var(--muted-foreground)" }}>Nothing matches "{treeSearch}".</p> : null}
            <div style={{ height: 24 }} />
          </div>
        </div>

        {/* ── RIGHT — editor ── */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--background)" }}>
          {selected?.kind === "exam" ? (
            <ExamPane
              key={selected.level}
              level={levels.find((l) => l.level_number === selected.level) ?? null}
              modules={modsByLevel[selected.level] ?? []}
              onReload={() => { void loadLevels(); void loadMods(selected.level); }}
              onError={setError}
              error={error}
              navigateToBuilder={() => navigate(`/quiz-builder?level=${selected.level}`)}
            />
          ) : !draft || selected?.kind !== "module" ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--muted-foreground)", gap: 8 }}>
              <Layers size={36} style={{ opacity: 0.25 }} />
              <p style={{ fontSize: 14, fontWeight: 600 }}>Select a module to begin editing</p>
              <p style={{ fontSize: 12 }}>Pick from the tree — or open a level's Final Assessment</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
              {/* Sticky header + section nav */}
              <div style={{ flexShrink: 0, background: "var(--card)", borderBottom: "1px solid var(--border)", padding: "12px 24px 0" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", paddingBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    {selectedLevel ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: `${selectedLevel.color}18`, color: selectedLevel.color, border: `1px solid ${selectedLevel.color}30` }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: selectedLevel.color }} /> L{selectedLevel.level_number} · {selectedLevel.title}</span> : null}
                    <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--nuru-navy)", lineHeight: 1.1 }}>Module {draft.module_sequence_number} — {draft.title || "Untitled"}</h2>
                    <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 10px", borderRadius: 999, ...(statusPill[draft.status] ?? statusPill.draft!), letterSpacing: "0.04em" }}>{draft.status.toUpperCase()}</span>
                    {dirty ? <span style={{ fontSize: 11, color: "var(--nuru-gold)", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}><AlertTriangle size={11} /> unsaved</span> : null}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <button onClick={() => void saveModule()} disabled={!dirty} style={{ height: 34, padding: "0 18px", borderRadius: 10, border: "none", background: dirty ? "var(--nuru-navy)" : "var(--muted)", color: dirty ? "#fff" : "var(--muted-foreground)", fontSize: 12.5, fontWeight: 700, cursor: dirty ? "pointer" : "default" }}>Save</button>
                    <button onClick={() => void togglePublish()} style={{ height: 34, padding: "0 14px", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--card)", fontSize: 12.5, fontWeight: 600, color: "var(--nuru-navy)", cursor: "pointer" }}>{draft.status === "published" ? "Unpublish" : "Publish"}</button>
                  </div>
                </div>
                {/* Section nav — sections, not pages */}
                <div style={{ display: "flex", gap: 2, overflowX: "auto" }} className="no-scrollbar">
                  {SECTIONS.map(({ key, label, icon: Icon }) => {
                    const active = section === key;
                    return (
                      <button key={key} onClick={() => setSection(key)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 13px", border: "none", background: "transparent", color: active ? "var(--nuru-navy)" : "var(--muted-foreground)", fontSize: 12, fontWeight: active ? 700 : 500, cursor: "pointer", borderBottom: active ? `2.5px solid ${selectedLevel?.color ?? "var(--nuru-gold)"}` : "2.5px solid transparent", whiteSpace: "nowrap" }}>
                        <Icon size={12} /> {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {notice ? <div style={{ padding: "8px 24px", color: "#0F6B33", fontSize: 12.5, background: "#F3FAF5", borderBottom: "1px solid var(--border)" }}>{notice}</div> : null}
              {error ? <div style={{ padding: "8px 24px", color: "#A8281F", fontSize: 12.5, background: "#FDF4F4", borderBottom: "1px solid var(--border)" }}>{error}</div> : null}

              <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto" }}>
                <div style={{ padding: "22px 26px 48px", maxWidth: section === "quiz" ? 1040 : 860 }}>

                  {/* ── OVERVIEW ── */}
                  {section === "overview" ? (
                    <>
                      <Card icon={<BookOpen size={13} />} title="Basics">
                        <div style={{ marginBottom: 16 }}>
                          <label style={fieldLabel}>Title</label>
                          <input value={draft.title} onChange={(e) => setField("title", e.target.value)} placeholder="e.g. Understanding Salvation" style={{ ...fieldInput, fontSize: 14, fontWeight: 500 }} />
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 16 }}>
                          <div>
                            <label style={fieldLabel}>Difficulty</label>
                            <select value={draft.difficulty} onChange={(e) => setField("difficulty", e.target.value as AdminModule["difficulty"])} style={{ ...fieldInput, fontWeight: 600 }}>
                              <option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option>
                            </select>
                          </div>
                          <div>
                            <label style={fieldLabel}>Estimated minutes</label>
                            <input type="number" min={1} value={draft.estimated_minutes ?? 0} onChange={(e) => setField("estimated_minutes", Number(e.target.value))} style={fieldInput} />
                          </div>
                        </div>
                        <div>
                          <label style={fieldLabel}>Summary</label>
                          <textarea value={draft.summary ?? ""} onChange={(e) => setField("summary", e.target.value)} rows={2} placeholder="One or two lines describing this module…" style={areaInput} />
                        </div>
                      </Card>

                      <Card icon={<Target size={13} />} title="Learning objectives" hint="one per line">
                        <textarea value={draft.objectives ?? ""} onChange={(e) => setField("objectives", e.target.value)} rows={3} placeholder={"Define new birth\nExplain repentance"} style={areaInput} />
                      </Card>

                      <Card icon={<BookOpen size={13} />} title="Key scripture" hint="one per line">
                        <textarea value={verses.join("\n")} onChange={(e) => setField("key_verses", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} rows={3} placeholder={"John 3:3\nEphesians 2:8-9"} style={areaInput} />
                      </Card>

                      <Card icon={<Tag size={13} />} title="Tags" hint="comma-separated" last>
                        <input value={draft.tags ?? ""} onChange={(e) => setField("tags", e.target.value)} placeholder="salvation, grace, faith" style={fieldInput} />
                        {(draft.tags ?? "").trim() ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                            {(draft.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean).map((t) => (
                              <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "var(--nuru-navy)", background: "var(--secondary)", borderRadius: 999, padding: "3px 10px" }}><Hash size={10} style={{ color: "var(--nuru-gold)" }} /> {t}</span>
                            ))}
                          </div>
                        ) : null}
                      </Card>
                    </>
                  ) : null}

                  {/* ── CONTENT ── */}
                  {section === "content" ? (
                    <>
                      <div className="flex items-center justify-between mb-3">
                        <SectionHead icon={<FileText size={14} />} label="Lesson content · Markdown" tight />
                        <button onClick={() => setMdView((v) => (v === "preview" ? "write" : "preview"))} style={{ height: 32, padding: "0 12px", borderRadius: 10, border: "1px solid var(--border)", background: mdView === "preview" ? "var(--nuru-navy)" : "var(--card)", fontSize: 12, fontWeight: 600, color: mdView === "preview" ? "#fff" : "var(--nuru-navy)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}><Eye size={12} /> Preview</button>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap", padding: "6px 10px", borderRadius: "10px 10px 0 0", border: "1.5px solid var(--border)", borderBottom: "1px solid var(--border)", background: "var(--secondary)", opacity: mdView === "preview" ? 0.5 : 1, pointerEvents: mdView === "preview" ? "none" : "auto" }}>
                        {tools.map(({ Icon, title, act, group }) => (
                          <span key={title} style={{ display: "inline-flex", alignItems: "center" }}>
                            {group ? <span style={{ width: 1, height: 18, background: "var(--border)", margin: "0 4px" }} /> : null}
                            <button title={title} onClick={act} style={{ width: 28, height: 26, borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: "var(--nuru-navy)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={14} /></button>
                          </span>
                        ))}
                        <div style={{ flex: 1, minWidth: 8 }} />
                        <span title="How the reader splits this lesson into sections" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: "rgba(200,155,60,0.12)", color: "var(--nuru-gold)", border: "1px solid rgba(200,155,60,0.3)" }}><SeparatorHorizontal size={10} /> {pageCount} section{pageCount === 1 ? "" : "s"}</span>
                        <span style={{ fontSize: 10.5, color: "var(--muted-foreground)", marginLeft: 6 }}>{draft.lesson_content.length} chars</span>
                      </div>
                      {mdView === "write" ? (
                        <textarea ref={contentRef} value={draft.lesson_content} onChange={(e) => setField("lesson_content", e.target.value)} rows={16} placeholder={"## Section heading\n\nWrite the lesson here…"} style={{ width: "100%", borderRadius: "0 0 10px 10px", border: "1.5px solid var(--border)", borderTop: "none", background: "var(--input-background)", fontSize: 13, padding: "12px 14px", color: "var(--foreground)", outline: "none", resize: "vertical", lineHeight: 1.7, fontFamily: "var(--font-mono), monospace" }} />
                      ) : (
                        <div style={{ minHeight: 320, borderRadius: "0 0 10px 10px", border: "1.5px solid var(--border)", borderTop: "none", background: "var(--card)", padding: "16px 18px" }}>
                          {draft.lesson_content.trim() ? <MarkdownPreview content={draft.lesson_content} /> : <p style={{ color: "var(--muted-foreground)" }}>Nothing to preview yet.</p>}
                        </div>
                      )}

                      {/* Sections outline — titled teaching sections over the page-break markers. */}
                      <div style={{ marginTop: 18, borderRadius: 12, border: "1.5px solid var(--border)", background: "var(--card)", overflow: "hidden" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", borderBottom: "1px solid var(--border)", background: "var(--secondary)" }}>
                          <SeparatorHorizontal size={13} style={{ color: "var(--nuru-gold)" }} />
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--nuru-navy)" }}>Sections outline</span>
                          <span style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>{sections.length} section{sections.length === 1 ? "" : "s"} · how the reader paginates</span>
                        </div>
                        {sections.length === 0 ? (
                          <div style={{ padding: "16px 14px", fontSize: 12.5, color: "var(--muted-foreground)" }}>No sections yet. Add one to start structuring the lesson.</div>
                        ) : (
                          <div>
                            {sections.map((sec, i) => (
                              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border)" }}>
                                <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 6, background: "var(--secondary)", color: "var(--nuru-navy)", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                                <input
                                  value={sec.title ?? ""}
                                  placeholder={sectionLabel(null, i)}
                                  onChange={(e) => setField("lesson_content", renameSection(draft.lesson_content, i, e.target.value))}
                                  style={{ flex: 1, minWidth: 0, height: 32, borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--input-background)", fontSize: 12.5, padding: "0 10px", color: "var(--foreground)", outline: "none" }}
                                />
                                <button
                                  title="Delete section"
                                  onClick={() => setField("lesson_content", deleteSection(draft.lesson_content, i))}
                                  style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 8, border: "1px solid #FECACA", background: "#FFF5F5", color: "#DC2626", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                                ><Trash2 size={13} /></button>
                              </div>
                            ))}
                          </div>
                        )}
                        <button
                          onClick={() => setField("lesson_content", addSection(draft.lesson_content))}
                          style={{ width: "100%", padding: "10px 14px", textAlign: "left", display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700, color: "var(--nuru-gold)", background: "transparent", border: "none", cursor: "pointer" }}
                        ><Plus size={13} /> Add section</button>
                      </div>
                    </>
                  ) : null}

                  {/* ── MEDIA — the module's placements (§2.2) ── */}
                  {section === "media" ? (
                    <>
                      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                        <SectionHead icon={<Video size={14} />} label="Media placements" tight />
                        <button onClick={() => setPickerOpen(true)} disabled={placementsBusy} className="flex items-center gap-1.5 rounded-lg px-3" style={{ height: 34, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer", opacity: placementsBusy ? 0.6 : 1 }}><Plus size={13} /> Add from library</button>
                      </div>
                      <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 14 }}>
                        Videos placed in this module — <strong>Level {draft.level_number}</strong> is inferred from the module, never asked. The same asset may be placed in many modules; removing a placement never deletes the asset.
                      </p>
                      {placements.length === 0 ? (
                        <div className="rounded-xl" style={{ border: "1.5px dashed var(--border)", padding: "28px 16px", textAlign: "center" }}>
                          <Video size={26} style={{ color: "var(--muted-foreground)", opacity: 0.4, margin: "0 auto 8px" }} />
                          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>No videos placed yet</p>
                          <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 3 }}>Pick from the Video Library — uploads and external links both work.</p>
                        </div>
                      ) : (
                        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--card)" }}>
                          {placements.map((p, i) => (
                            <div key={p.placement_id} className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: i < placements.length - 1 ? "1px solid var(--border)" : "none", opacity: placementsBusy ? 0.6 : 1 }}>
                              <div className="rounded-lg overflow-hidden flex items-center justify-center shrink-0" style={{ width: 72, height: 44, background: "#0b1f33" }}>
                                {p.thumbnail_url ? <img src={p.thumbnail_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Play size={14} color="#fff" fill="#fff" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title ?? p.caption ?? p.media_asset_id.slice(0, 8)}</div>
                                <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 1 }}>{dur(p.duration_sec)} · {p.video_source} · {p.status}{i === 0 ? " · primary" : ""}</div>
                              </div>
                              <button onClick={() => void toggleRequired(p)} disabled={placementsBusy} title={p.required ? "Required to complete the module" : "Optional viewing"} className="rounded-full px-2.5 py-1 shrink-0" style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", background: p.required ? "#E8F6EE" : "var(--secondary)", color: p.required ? "#0F6B33" : "var(--muted-foreground)", border: "none", cursor: "pointer" }}>
                                {p.required ? "REQUIRED" : "OPTIONAL"}
                              </button>
                              <div className="flex flex-col gap-0.5 shrink-0">
                                <button onClick={() => void movePlacement(i, -1)} disabled={placementsBusy || i === 0} style={{ width: 22, height: 18, borderRadius: 5, border: "1px solid var(--border)", background: "var(--card)", color: i === 0 ? "var(--border)" : "var(--muted-foreground)", cursor: i === 0 ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><ArrowUp size={10} /></button>
                                <button onClick={() => void movePlacement(i, 1)} disabled={placementsBusy || i === placements.length - 1} style={{ width: 22, height: 18, borderRadius: 5, border: "1px solid var(--border)", background: "var(--card)", color: i === placements.length - 1 ? "var(--border)" : "var(--muted-foreground)", cursor: i === placements.length - 1 ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><ArrowDown size={10} /></button>
                              </div>
                              <button onClick={() => void removePlacement(p)} disabled={placementsBusy} title="Remove placement (keeps the asset)" className="rounded-lg p-1.5 shrink-0" style={{ color: "#DC2626", background: "#FFF5F5", border: "1px solid #FECACA", cursor: "pointer" }}><Trash2 size={13} /></button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-3" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                        <ShieldCheck size={12} style={{ color: "#16A34A" }} /> Members see a placed video only when this module is unlocked for them (§1.9 — any-placement gating).
                      </div>
                    </>
                  ) : null}

                  {/* ── QUIZ ── */}
                  {section === "quiz" ? (
                    <>
                      <Card icon={<ClipboardList size={13} />} title="Evaluation & gating">
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18 }}>
                          <div>
                            <label style={fieldLabel}>Evaluation kind</label>
                            <select value={draft.evaluation_kind} onChange={(e) => setField("evaluation_kind", e.target.value as EvaluationKind)} style={{ ...fieldInput, fontWeight: 600 }}>
                              {EVAL_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                            </select>
                          </div>
                          <div>
                            <label style={fieldLabel}>Pass mark (%)</label>
                            <input type="number" min={0} max={100} value={Number(draft.quiz_pass_mark)} disabled={draft.evaluation_kind !== "quiz"} onChange={(e) => setField("quiz_pass_mark", String(Number(e.target.value)) as unknown as AdminModule["quiz_pass_mark"])} style={{ ...fieldInput, background: draft.evaluation_kind !== "quiz" ? "var(--secondary)" : "var(--input-background)", color: draft.evaluation_kind !== "quiz" ? "var(--muted-foreground)" : "var(--foreground)" }} />
                          </div>
                          <div>
                            <label style={fieldLabel}>Attempts allowed</label>
                            <input type="number" min={1} max={50} value={draft.max_attempts ?? 3} disabled={draft.evaluation_kind !== "quiz"} onChange={(e) => setField("max_attempts", Number(e.target.value))} style={{ ...fieldInput, background: draft.evaluation_kind !== "quiz" ? "var(--secondary)" : "var(--input-background)", color: draft.evaluation_kind !== "quiz" ? "var(--muted-foreground)" : "var(--foreground)" }} />
                          </div>
                        </div>
                        {dirty ? <p style={{ fontSize: 11, color: "var(--nuru-gold)", fontWeight: 600, marginTop: 10, display: "flex", alignItems: "center", gap: 5 }}><AlertTriangle size={11} /> Evaluation changes save with the module (Save above).</p> : null}
                      </Card>
                      {mod && draft.evaluation_kind !== "quiz" && draft.evaluation_kind !== "exit_exam" ? (
                        <div className="flex items-start" style={{ gap: 10, marginBottom: 16, padding: "12px 14px", borderRadius: 10, background: "rgba(217,119,6,0.06)", border: "1px solid rgba(217,119,6,0.2)", color: "#8A6B1F", fontSize: 12.5 }}>
                          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                          <span>This module's evaluation kind is <strong>{draft.evaluation_kind}</strong>. Set it to <strong>Quiz</strong> above for these questions to be served and graded.</span>
                        </div>
                      ) : null}
                      {mod ? (
                        <ModuleQuizBuilder
                          key={mod.module_id}
                          moduleId={mod.module_id}
                          accent={selectedLevel?.color ?? "var(--nuru-gold)"}
                          settings={moduleQuizSettings(mod)}
                          onSaveSettings={(s) => saveModuleQuizSettings(mod, s)}
                          settingsLabel="Quiz settings"
                        />
                      ) : null}
                    </>
                  ) : null}

                  {/* ── RESOURCES — direct lesson media links (URLs, not placements) ── */}
                  {section === "resources" ? (
                    <>
                      <SectionHead icon={<Link2 size={14} />} label="Lesson media links" />
                      <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 16, marginTop: -8 }}>
                        Direct URLs served with the lesson. For gated Video Library placements use the <button onClick={() => setSection("media")} style={{ color: "var(--nuru-gold)", background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: 0 }}>Media section</button>.
                      </p>
                      <Card icon={<Video size={13} />} title="Video link">
                        <div style={{ marginBottom: 14 }}>
                          <label style={fieldLabel}>Lesson video URL</label>
                          <input value={draft.video_url ?? ""} onChange={(e) => setField("video_url", e.target.value || null)} placeholder="https://…" style={fieldInput} />
                        </div>
                        <label style={fieldLabel}>Video length (minutes) — reader "watch" label</label>
                        <input type="number" min={0} value={secToMin(draft.video_duration_sec)} onChange={(e) => setField("video_duration_sec", minToSec(e.target.value))} placeholder="0" style={fieldInput} />
                      </Card>
                      <Card icon={<Play size={13} />} title="Audio link" last>
                        <div style={{ marginBottom: 14 }}>
                          <label style={fieldLabel}>Lesson audio URL — admin-controlled; served to members</label>
                          <input value={draft.audio_url ?? ""} onChange={(e) => setField("audio_url", e.target.value || null)} placeholder="https://…" style={fieldInput} />
                        </div>
                        <label style={fieldLabel}>Audio length (minutes) — reader "listen" label</label>
                        <input type="number" min={0} value={secToMin(draft.audio_duration_sec)} onChange={(e) => setField("audio_duration_sec", minToSec(e.target.value))} placeholder="0" style={fieldInput} />
                      </Card>
                    </>
                  ) : null}

                  {/* ── REFLECTION ── */}
                  {section === "reflection" ? (
                    <>
                      <SectionHead icon={<MessageSquare size={14} />} label="Reflection" />
                      {draft.evaluation_kind === "reflection" ? (
                        <div className="rounded-xl" style={{ border: "1px solid #BBE5C9", background: "#F3FAF5", padding: "16px 18px" }}>
                          <div className="flex items-center gap-2 mb-2"><CheckCircle2 size={15} style={{ color: "#16A34A" }} /><span style={{ fontSize: 13.5, fontWeight: 700, color: "#0F5132" }}>This module collects a written reflection</span></div>
                          <p style={{ fontSize: 12.5, color: "#0F5132", lineHeight: 1.6 }}>Members write a reflection after the lesson; a shepherd reviews it in the Reflection Queue. Approving records the decision only — level advancement rides the discipler-usher path (§2.4, one advancement writer).</p>
                          <button onClick={() => navigate("/reflection-queue")} className="flex items-center gap-1.5 rounded-lg px-3 mt-3" style={{ height: 34, background: "#16A34A", color: "#fff", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer" }}><MessageSquare size={12} /> Open Reflection Queue</button>
                        </div>
                      ) : (
                        <div className="rounded-xl" style={{ border: "1px solid var(--border)", background: "var(--card)", padding: "16px 18px" }}>
                          <p style={{ fontSize: 13, color: "var(--foreground)", lineHeight: 1.6 }}>This module doesn't collect a reflection — its evaluation kind is <strong>{draft.evaluation_kind}</strong>.</p>
                          <button onClick={() => { setField("evaluation_kind", "reflection"); }} className="flex items-center gap-1.5 rounded-lg px-3 mt-3" style={{ height: 34, background: "var(--nuru-navy)", color: "#fff", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer" }}><MessageSquare size={12} /> Make this a reflection module</button>
                          <p style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 8 }}>Takes effect when you Save.</p>
                        </div>
                      )}
                    </>
                  ) : null}

                  {/* ── PUBLISHING ── */}
                  {section === "publishing" ? (
                    <>
                      <Card icon={<Send size={13} />} title="Status & lifecycle">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span style={{ fontSize: 10, fontWeight: 800, padding: "4px 12px", borderRadius: 999, ...(statusPill[draft.status] ?? statusPill.draft!), letterSpacing: "0.04em" }}>{draft.status.toUpperCase()}</span>
                          <button onClick={() => void togglePublish()} style={{ height: 36, padding: "0 18px", borderRadius: 10, border: "none", background: draft.status === "published" ? "var(--secondary)" : "#0F6B33", color: draft.status === "published" ? "var(--nuru-navy)" : "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{draft.status === "published" ? "Unpublish" : "Publish"}</button>
                          <button onClick={() => void archiveModule()} style={{ height: 36, padding: "0 14px", borderRadius: 10, border: "1px solid #FECACA", background: "#FFF5F5", fontSize: 12, fontWeight: 600, color: "#DC2626", cursor: "pointer" }}>Archive module</button>
                        </div>
                        <p style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 10, lineHeight: 1.5 }}>Publishing is validated server-side: a quiz module needs at least one active question; sequences stay contiguous.</p>
                      </Card>

                      <Card icon={<Eye size={13} />} title="Visibility & gating">
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 4 }}>
                          <div>
                            <label style={fieldLabel}>Visibility</label>
                            <select value={draft.visibility} onChange={(e) => setField("visibility", e.target.value as AdminModule["visibility"])} style={{ ...fieldInput, fontWeight: 600 }}>
                              <option value="members">Members</option><option value="leaders">Leaders only</option><option value="public">Public</option>
                            </select>
                          </div>
                          <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 4 }}>
                            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                              <span onClick={() => setField("required", !draft.required)} style={{ width: 36, height: 20, borderRadius: 999, background: draft.required ? "var(--nuru-teal)" : "var(--switch-background)", position: "relative", flexShrink: 0, transition: "background 0.15s" }}>
                                <span style={{ position: "absolute", top: 2, left: draft.required ? 18 : 2, width: 16, height: 16, borderRadius: 999, background: "#fff", transition: "left 0.15s" }} />
                              </span>
                              <span style={{ fontSize: 12.5, color: "var(--foreground)", fontWeight: 500 }}>Required to advance</span>
                            </label>
                          </div>
                        </div>
                        {dirty ? <p style={{ fontSize: 11, color: "var(--nuru-gold)", fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}><AlertTriangle size={11} /> Saves with the module (Save above).</p> : null}
                      </Card>

                      <Card icon={<History size={13} />} title="Version history" hint={`current v${draft.current_version}`} last>
                        {versions === null ? (
                          <p style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>Loading versions…</p>
                        ) : versions.length === 0 ? (
                          <p style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>No saved versions yet — versions are snapshotted on every save.</p>
                        ) : (
                          <div>
                            {versions.map((v, i) => (
                              <div key={v.version_id} className="flex items-center gap-3 py-2.5" style={{ borderBottom: i < versions.length - 1 ? "1px solid var(--border)" : "none" }}>
                                <span className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 30, height: 30, background: "var(--secondary)", color: "var(--nuru-navy)", fontSize: 11, fontWeight: 800 }}>v{v.version_number}</span>
                                <div className="flex-1 min-w-0">
                                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--foreground)" }}>{v.edited_by_name ?? "Unknown editor"}</div>
                                  <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{new Date(v.created_at).toLocaleString()}</div>
                                </div>
                                {v.version_number !== draft.current_version ? (
                                  <button onClick={() => void revertVersion(v.version_number)} className="flex items-center gap-1 rounded-lg px-2.5 shrink-0" style={{ height: 28, fontSize: 11, fontWeight: 700, color: "var(--nuru-navy)", background: "var(--secondary)", border: "1px solid var(--border)", cursor: "pointer" }}><History size={11} /> Revert</button>
                                ) : (
                                  <span className="rounded-full px-2 py-0.5 shrink-0" style={{ fontSize: 9.5, fontWeight: 800, background: "#E8F6EE", color: "#0F6B33" }}>CURRENT</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </Card>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Module row menu (publish/unpublish · archive) */}
      {rowMenu ? (
        <div className="fixed inset-0 z-50" onClick={() => setRowMenu(null)}>
          <div className="rounded-xl overflow-hidden" onClick={(e) => e.stopPropagation()} style={{ position: "fixed", top: Math.min(rowMenu.y, window.innerHeight - 120), left: Math.max(8, Math.min(rowMenu.x, window.innerWidth - 8) - 190), width: 190, background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 16px 48px rgba(0,0,0,0.22)" }}>
            <button onClick={() => { const m = rowMenu.mod; setRowMenu(null); void togglePublish(m); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-left" style={{ background: "transparent", border: "none", fontSize: 12.5, fontWeight: 600, color: "var(--foreground)", cursor: "pointer" }}>
              {rowMenu.mod.status === "published" ? <><Eye size={13} /> Unpublish</> : <><CheckCircle2 size={13} /> Publish</>}
            </button>
            <button onClick={() => { const m = rowMenu.mod; setRowMenu(null); void archiveModule(m); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-left" style={{ background: "transparent", border: "none", borderTop: "1px solid var(--border)", fontSize: 12.5, fontWeight: 600, color: "#DC2626", cursor: "pointer" }}>
              <Trash2 size={13} /> Archive
            </button>
          </div>
        </div>
      ) : null}

      {/* Library picker — attach an asset to the selected module */}
      {pickerOpen && selected?.kind === "module" && draft ? (
        <LibraryPicker
          levelNumber={draft.level_number}
          placedAssetIds={new Set(placements.map((p) => p.media_asset_id))}
          onPick={(a) => { setPickerOpen(false); void placeAsset(a); }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}

      {levelModal ? (
        <LevelModal
          mode={levelModal.mode}
          levelNumber={levelModal.level?.level_number ?? levels.length + 1}
          saving={savingLevel}
          {...(levelModal.level ? { initialData: { title: levelModal.level.title, theme: levelModal.level.theme ?? "", passMark: Math.round(Number(levelModal.level.required_exam_pass_mark) || 0), duration: levelModal.level.duration ?? "8 weeks", status: beToLabel[levelModal.level.status] ?? "Draft", locked: levelModal.level.locked, color: levelModal.level.color } } : {})}
          onSave={(d) => void handleSaveLevel(d)}
          onClose={() => setLevelModal(null)}
        />
      ) : null}
    </div>
  );
}

/* ── Final Assessment pane (level node) — exam settings + question bank ── */
function examSettings(lvl: AdminLevel): QuizSettings {
  return {
    passMark: Math.round(Number(lvl.required_exam_pass_mark) || 80),
    shuffleQuestions: lvl.exam_shuffle ?? false,
    showAnswersAfterSubmit: lvl.exam_show_answers ?? false,
    showScoreAfterSubmit: lvl.exam_show_score ?? true,
    timeLimitMinutes: null, // level exams carry no client-set time limit
  };
}

function ExamPane({ level, modules, onReload, onError, error, navigateToBuilder }: {
  level: AdminLevel | null;
  modules: AdminModuleSummary[];
  onReload: () => void;
  onError: (m: string | null) => void;
  error: string | null;
  navigateToBuilder: () => void;
}): ReactElement {
  const [creating, setCreating] = useState(false);
  const [toggling, setToggling] = useState(false);
  const exam = modules.find((m) => m.evaluation_kind === "exit_exam") ?? null;

  if (!level) return <div style={{ padding: 40, textAlign: "center", color: "var(--muted-foreground)", fontSize: 13 }}>Loading…</div>;
  const published = (level.exam_status ?? "review") === "published";

  async function createExam(): Promise<void> {
    if (!level) return;
    setCreating(true); onError(null);
    try {
      await CurriculumApi.createModule({
        level_number: level.level_number,
        title: `Level ${level.level_number} Review`,
        lesson_content: "Level exit exam.",
        evaluation_kind: "exit_exam",
      });
      onReload();
    } catch (e) { onError(errorMessage(e, "Could not create the level exam.")); }
    finally { setCreating(false); }
  }
  async function setExamStatus(next: "review" | "published"): Promise<void> {
    if (!level) return;
    setToggling(true); onError(null);
    try {
      await CurriculumApi.updateExam(level.level_number, {
        required_exam_pass_mark: Math.round(Number(level.required_exam_pass_mark) || 80),
        exam_status: next,
      });
      onReload();
    } catch (e) { onError(errorMessage(e, "Could not update the exam's publish state.")); }
    finally { setToggling(false); }
  }
  async function saveSettings(s: QuizSettings, activeCount: number): Promise<void> {
    if (!level) return;
    await CurriculumApi.updateExam(level.level_number, {
      required_exam_pass_mark: s.passMark,
      exam_question_count: activeCount || null,
      exam_shuffle: s.shuffleQuestions,
      exam_show_answers: s.showAnswersAfterSubmit,
      exam_show_score: s.showScoreAfterSubmit,
    });
    onReload();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Exam banner — status surfaced here, not hidden in the builder (§5.2). */}
      <div style={{ padding: "10px 24px", background: `${level.color}10`, borderBottom: `2px solid ${level.color}30`, display: "flex", alignItems: "center", gap: 12, flexShrink: 0, flexWrap: "wrap" }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, background: level.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}><Award size={15} /></div>
        <div>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--nuru-navy)" }}>Level {level.level_number} — Final Assessment</span>
          <span style={{ fontSize: 11, color: "var(--muted-foreground)", marginLeft: 8 }}>{level.title}</span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: published ? "#E8F6EE" : "#FDF5E5", color: published ? "#0F6B33" : "#8A6B1F" }}>
            {published ? <Check size={11} strokeWidth={3} /> : <Clock size={11} />}
            {published ? "Published" : "In Review"}
          </span>
          <button
            onClick={() => void setExamStatus(published ? "review" : "published")}
            disabled={toggling || !exam}
            title={exam ? undefined : "Create the exam first"}
            style={{ height: 30, padding: "0 14px", borderRadius: 8, border: "none", cursor: toggling || !exam ? "not-allowed" : "pointer", opacity: toggling || !exam ? 0.55 : 1, fontSize: 11.5, fontWeight: 700, background: published ? "#F1EEE7" : "var(--nuru-gold)", color: published ? "#6B5E45" : "#fff" }}
          >
            {toggling ? "Saving…" : published ? "Move to review" : "Publish exam"}
          </button>
          <button onClick={navigateToBuilder} title="Open the full-screen exam builder" style={{ height: 30, padding: "0 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--nuru-navy)", fontSize: 11.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}><ExternalLink size={11} /> Full screen</button>
        </div>
      </div>

      {error ? <div style={{ padding: "8px 24px", color: "#A8281F", fontSize: 12.5, background: "#FDF4F4", borderBottom: "1px solid var(--border)" }}>{error}</div> : null}

      <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        {!exam ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 40 }}>
            <div className="nuru-card" style={{ padding: 32, maxWidth: 440, textAlign: "center" }}>
              <div style={{ width: 52, height: 52, borderRadius: 16, margin: "0 auto 12px", background: "rgba(200,155,60,0.12)", color: "var(--nuru-gold)", display: "grid", placeItems: "center" }}><Award size={22} /></div>
              <h3 className="type-section" style={{ fontSize: 18 }}>No exam for this level yet</h3>
              <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 6 }}>Create the level's final assessment to start adding questions.</p>
              <button onClick={() => void createExam()} disabled={creating} className="flex items-center gap-2" style={{ margin: "16px auto 0", height: 40, padding: "0 18px", borderRadius: 10, background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer", opacity: creating ? 0.6 : 1 }}>{creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create level exam</button>
            </div>
          </div>
        ) : (
          <div style={{ maxWidth: 1040 }}>
            <ModuleQuizBuilder
              key={exam.module_id}
              moduleId={exam.module_id}
              accent={level.color}
              settings={examSettings(level)}
              onSaveSettings={saveSettings}
              settingsLabel="Exam settings"
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Library picker modal — choose a Video Library asset to place ── */
function LibraryPicker({ levelNumber, placedAssetIds, onPick, onClose }: {
  levelNumber: number;
  placedAssetIds: Set<string>;
  onPick: (a: MediaAssetRow) => void;
  onClose: () => void;
}): ReactElement {
  const [assets, setAssets] = useState<MediaAssetRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      void MediaApi.list(query.trim() ? { q: query.trim() } : {})
        .then((r) => setAssets(r.data.filter((a) => a.status !== "failed")))
        .catch(() => setAssets([]))
        .finally(() => setLoading(false));
    }, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(11,31,51,0.55)" }} onClick={onClose}>
      <div className="rounded-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()} style={{ background: "var(--card)", width: 620, maxWidth: "92vw", maxHeight: "84vh", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div className="px-5 py-4 flex items-start justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <div className="flex items-center gap-2" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--nuru-gold)" }}><Video size={12} /> PLACE A VIDEO</div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--foreground)", marginTop: 2 }}>Pick from the Video Library</h2>
            <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 3 }}>Placing into <strong>Level {levelNumber}</strong> (inferred from this module). The asset stays in the library and may be placed in other modules too.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none", cursor: "pointer" }}><X size={15} /></button>
        </div>
        <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 rounded-xl px-3" style={{ height: 38, background: "var(--input-background)", border: "1px solid var(--border)" }}>
            <Search size={13} style={{ color: "var(--muted-foreground)" }} />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, module, or caption…" className="bg-transparent outline-none flex-1" style={{ fontSize: 13 }} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p style={{ padding: "22px 20px", fontSize: 12.5, color: "var(--muted-foreground)" }}>Loading library…</p>
          ) : assets.length === 0 ? (
            <p style={{ padding: "22px 20px", fontSize: 12.5, color: "var(--muted-foreground)" }}>No assets match.</p>
          ) : assets.map((a, i) => {
            const already = placedAssetIds.has(a.media_asset_id);
            const title = a.title ?? a.caption ?? a.attached_module_title ?? a.media_asset_id.slice(0, 8);
            return (
              <button
                key={a.media_asset_id}
                onClick={() => { if (!already) onPick(a); }}
                disabled={already}
                className="w-full flex items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[var(--secondary)]"
                style={{ background: "transparent", border: "none", borderTop: i === 0 ? "none" : "1px solid var(--border)", cursor: already ? "not-allowed" : "pointer", opacity: already ? 0.5 : 1 }}
              >
                <div className="rounded-lg overflow-hidden flex items-center justify-center shrink-0" style={{ width: 64, height: 40, background: "#0b1f33" }}>
                  {a.thumbnail_url ? <img src={a.thumbnail_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Play size={12} color="#fff" fill="#fff" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{String(title)}</div>
                  <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 1 }}>
                    {dur(a.duration_sec)} · {a.video_source} · {a.status}
                    {(a.placements ?? []).length > 0 ? ` · placed in ${(a.placements ?? []).length} module${(a.placements ?? []).length === 1 ? "" : "s"}` : " · unplaced"}
                  </div>
                </div>
                {already ? <span className="rounded-full px-2 py-0.5 shrink-0" style={{ fontSize: 9.5, fontWeight: 800, background: "#E8F6EE", color: "#0F6B33" }}>PLACED HERE</span> : <Plus size={14} style={{ color: "var(--nuru-gold)", flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Shared bits ── */
function SectionHead({ icon, label, tight }: { icon: ReactElement; label: string; tight?: boolean }): ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: tight ? 0 : 16 }}>
      <span style={{ width: 26, height: 26, borderRadius: 8, background: "var(--secondary)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--nuru-navy)" }}>{icon}</span>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--nuru-navy)" }}>{label}</div>
    </div>
  );
}

function Card({ icon, title, hint, last, children }: { icon: ReactElement; title: string; hint?: string; last?: boolean; children: ReactNode }): ReactElement {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1.5px solid var(--border)", background: "var(--card)", marginBottom: last ? 0 : 16 }}>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2.5 px-4 py-3 text-left" style={{ background: "var(--secondary)", border: "none", cursor: "pointer", borderBottom: open ? "1px solid var(--border)" : "none" }}>
        <span style={{ width: 24, height: 24, borderRadius: 7, background: "var(--card)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--nuru-navy)", border: "1px solid var(--border)" }}>{icon}</span>
        <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: "var(--nuru-navy)" }}>{title}</span>
        {hint ? <span style={{ fontSize: 10.5, color: "var(--muted-foreground)", fontWeight: 600 }}>{hint}</span> : null}
        {open ? <ChevronDown size={13} style={{ color: "var(--muted-foreground)" }} /> : <ChevronRight size={13} style={{ color: "var(--muted-foreground)" }} />}
      </button>
      {open ? <div style={{ padding: "16px 18px" }}>{children}</div> : null}
    </div>
  );
}
