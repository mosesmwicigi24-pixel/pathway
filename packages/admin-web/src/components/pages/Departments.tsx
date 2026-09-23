// Departments — the office's console for where members serve (docs/
// PARTNERS_PROGRAMME.md §4). Every department with its leader and counts, a
// create/edit form (leader, meets, fund, gift keys, open to join), and per
// department: posts on the office's behalf, its needs across every status, and
// its requests to serve. Two queues sit beside the table — "Requests" (every
// pending request to serve) and "Needs" (needs awaiting approval, and open
// needs that can be closed). Approving a need OPENS GIVING toward it: the need
// becomes its own giving target (transactions.need_id / pledges.need_id are
// written at giving time), so the "raised" figure shown here is exact and
// server-computed — this page derives nothing about money (§1.1). Archiving
// and approving a need ask first; a 422 on a decision means another admin got
// there first, so the queue is reloaded rather than retried.
//
// Visual language follows Partners.tsx / Finance.tsx (dark hero + tile strip,
// card table, right-hand drawer). Helpers are local copies, as every rebuilt
// page keeps its own.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Ban,
  Check,
  ChevronRight,
  ClipboardList,
  HandCoins,
  HandHelping,
  Loader2,
  Pencil,
  Plus,
  Search,
  Send,
  Target,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  ConfigApi,
  DepartmentsApi,
  GIFT_KEYS,
  OpsApi,
  type DepartmentNeedCreate,
  type DepartmentNeedRow,
  type DepartmentPage,
  type DepartmentRow,
  type DepartmentUpsert,
  type MemberRow,
  type NeedStatus,
  type ServeRequestRow,
} from "../../api/client";
import { useAppSelector } from "../../store/hooks";
import { errorMessage } from "../../util/error";

/* ---------- tokens (same set as Finance.tsx) ---------- */
const NAVY = "var(--nuru-navy)";
const GOLD = "var(--nuru-gold)";
const MUTED = "var(--muted-foreground)";
const BORDER = "var(--border)";
const SURFACE = "var(--secondary)";
const DISPLAY = "var(--font-display)";
const MONO = "var(--font-mono)";

/* ---------- helpers ---------- */
// The portal's money format: integer minor units → "KES 12,345" (no floats,
// no decimals — same helper Finance/Partners keep locally).
const money = (minor: number | null, currency: string | null): string =>
  `${currency ?? "KES"} ${Math.round((minor ?? 0) / 100).toLocaleString()}`;

const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
const fmtDateTime = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const initials = (n: string): string =>
  n.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
const AVATARS = [
  "linear-gradient(135deg,#0B1F33,#1E4068)",
  "linear-gradient(135deg,#C89B3C,#8B6914)",
  "linear-gradient(135deg,#16A34A,#065F46)",
  "linear-gradient(135deg,#7C3AED,#4C1D95)",
  "linear-gradient(135deg,#DC2626,#7F1D1D)",
  "linear-gradient(135deg,#0EA5E9,#075985)",
];
const titleCase = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : "—");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/* ---------- server limits (zod, backend departments/service.ts) ---------- */
const NAME_MIN = 2;
const NAME_MAX = 80;
const PURPOSE_MAX = 600;
const MEETS_MAX = 120;
const FUND_CODE_MIN = 2;
const FUND_CODE_MAX = 40;
const GIFT_KEYS_MAX = 12;
const GIFT_KEY_MAX = 40;
const POST_MAX = 2000;
const NEED_TITLE_MIN = 3;
const NEED_TITLE_MAX = 120;
const NEED_WHY_MIN = 10;
const NEED_WHY_MAX = 1500;
const NOTE_MAX = 300;

/* ---------- chips ---------- */
type Chip = { label: string; bg: string; color: string };
const CHIP_GREEN: Omit<Chip, "label"> = { bg: "#E8F6EC", color: "#0F6B33" };
const CHIP_AMBER: Omit<Chip, "label"> = { bg: "#FFF4DA", color: "#A87616" };
const CHIP_GREY: Omit<Chip, "label"> = { bg: "#EEF0F3", color: "#6B7280" };
const CHIP_VIOLET: Omit<Chip, "label"> = { bg: "#F3EAFE", color: "#7C3AED" };
const CHIP_ROSE: Omit<Chip, "label"> = { bg: "#FDECEC", color: "#B42318" };
const CHIP_NAVY: Omit<Chip, "label"> = { bg: "#E6EDF5", color: "#1E4068" };

const departmentStatusChip: Record<DepartmentRow["status"], Chip> = {
  active: { label: "Active", ...CHIP_GREEN },
  archived: { label: "Archived", ...CHIP_GREY },
};
const needStatusChip: Record<NeedStatus, Chip> = {
  pending: { label: "Awaiting approval", ...CHIP_AMBER },
  approved: { label: "Open — giving", ...CHIP_GREEN },
  rejected: { label: "Rejected", ...CHIP_ROSE },
  closed: { label: "Closed", ...CHIP_GREY },
};

/* ---------- filters / tabs ---------- */
type StatusFilter = "active" | "archived" | "all";
const STATUS_FILTERS: { label: string; value: StatusFilter }[] = [
  { label: "Active", value: "active" },
  { label: "Archived", value: "archived" },
  { label: "All", value: "all" },
];

type TabKey = "departments" | "requests" | "needs";
const TABS: { key: TabKey; label: string }[] = [
  { key: "departments", label: "Departments" },
  { key: "requests", label: "Requests" },
  { key: "needs", label: "Needs" },
];

type Fund = { code: string; name: string; is_active: boolean };
type Leader = { user_id: string; name: string };
/** One in-flight decision at a time; `key` identifies the row, `action` the verb. */
type Deciding = { key: string; action: string } | null;
const serveKey = (r: { department_id: string; user_id: string }): string => `serve:${r.department_id}:${r.user_id}`;
const needKey = (n: { need_id: string }): string => `need:${n.need_id}`;

/* ---------- tones (inline notices) ---------- */
type Tone = "ok" | "warn" | "error";
const TONE: Record<Tone, { bg: string; color: string; border: string }> = {
  ok: { bg: "#E8F6EC", color: "#0F6B33", border: "#BFE3CB" },
  warn: { bg: "#FFF4DA", color: "#A87616", border: "#F3DFA6" },
  error: { bg: "#FDECEC", color: "#B42318", border: "#F5C2C0" },
};
type Result = { tone: Tone; text: string };

/* ---------- primitives (local copies, Finance.tsx conventions) ---------- */
function Card({ children, style }: { children: ReactNode; style?: CSSProperties }): ReactElement {
  return (
    <div
      className="rounded-2xl"
      style={{ background: "var(--card)", border: `1px solid ${BORDER}`, boxShadow: "0 1px 3px rgba(11,31,51,0.05)", ...style }}
    >
      {children}
    </div>
  );
}

function Pill({ chip }: { chip: Chip }): ReactElement {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full"
      style={{ background: chip.bg, color: chip.color, padding: "3px 9px", fontSize: 11, fontWeight: 700, letterSpacing: 0.2, whiteSpace: "nowrap" }}
    >
      {chip.label}
    </span>
  );
}

function Avatar({ name, url, seed, size = 40 }: { name: string; url: string | null; seed: number; size?: number }): ReactElement {
  if (url) {
    return <img src={url} alt="" style={{ width: size, height: size, borderRadius: size * 0.3, objectFit: "cover", flexShrink: 0 }} />;
  }
  return (
    <div
      className="flex items-center justify-center"
      style={{ width: size, height: size, borderRadius: size * 0.3, background: AVATARS[seed % AVATARS.length], color: "#fff", fontSize: size * 0.34, fontWeight: 700, flexShrink: 0 }}
    >
      {initials(name)}
    </div>
  );
}

// An action button. `busy` disables it and swaps the icon for a spinner;
// `disabledTip` disables it with a reason. The span carries the title because
// a disabled <button> does not receive hover events in every browser.
function ActionButton({
  icon,
  label,
  onClick,
  busy = false,
  disabledTip,
  dark = false,
  tone = "default",
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  busy?: boolean;
  disabledTip?: string | undefined;
  dark?: boolean;
  tone?: "default" | "primary" | "danger";
}): ReactElement {
  const disabled = busy || Boolean(disabledTip);
  const palette =
    tone === "primary"
      ? { background: NAVY, color: "#fff", border: `1px solid ${NAVY}` }
      : tone === "danger"
        ? { background: "#FDECEC", color: "#B42318", border: "1px solid #F5C2C0" }
        : dark
          ? { background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)" }
          : { background: "var(--card)", color: NAVY, border: `1px solid ${BORDER}` };
  return (
    <span title={disabledTip} style={{ display: "inline-flex", cursor: disabled ? "not-allowed" : "pointer" }}>
      <button
        type="button"
        disabled={disabled}
        aria-disabled={disabled ? "true" : undefined}
        onClick={onClick}
        className="flex items-center gap-2 rounded-lg px-3"
        style={{ height: 32, ...palette, fontSize: 12, fontWeight: 600, opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? "none" : "auto", whiteSpace: "nowrap" }}
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : icon} {label}
      </button>
    </span>
  );
}

// An inline notice in one of the three tones; dismissable when onDismiss is given.
function Notice({ result, onDismiss, style }: { result: Result; onDismiss?: () => void; style?: CSSProperties }): ReactElement {
  const t = TONE[result.tone];
  return (
    <div
      role={result.tone === "error" ? "alert" : "status"}
      className="flex items-center gap-2 rounded-lg px-3 py-2"
      style={{ background: t.bg, color: t.color, border: `1px solid ${t.border}`, fontSize: 12.5, fontWeight: 600, ...style }}
    >
      {result.tone === "ok" ? <Check size={13} /> : <AlertTriangle size={13} />}
      <span style={{ flex: 1 }}>{result.text}</span>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" style={{ background: "transparent", border: "none", color: "inherit", padding: 2, display: "inline-flex" }}>
          <X size={13} />
        </button>
      ) : null}
    </div>
  );
}

// The page's one transient confirmation (auto-clears after TOAST_MS).
function Toast({ text }: { text: string }): ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        left: "50%",
        bottom: 24,
        transform: "translateX(-50%)",
        zIndex: 90,
        background: "var(--nuru-dark)",
        color: "#fff",
        padding: "10px 16px",
        borderRadius: 12,
        fontSize: 13,
        fontWeight: 600,
        boxShadow: "0 10px 30px rgba(7,22,41,0.35)",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        whiteSpace: "nowrap",
      }}
    >
      <Check size={14} /> {text}
    </div>
  );
}

const TOAST_MS = 4000;
function useToast(): [string | null, (text: string) => void] {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(text);
    timer.current = setTimeout(() => {
      timer.current = null;
      setToast(null);
    }, TOAST_MS);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return [toast, show];
}

const thStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: MUTED,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  textAlign: "left",
  padding: "10px 16px",
  borderBottom: `1px solid ${BORDER}`,
  whiteSpace: "nowrap",
};
const tdStyle: CSSProperties = { padding: "10px 16px", fontSize: 12.5, color: NAVY, verticalAlign: "middle" };
const selectStyle: CSSProperties = {
  height: 34,
  padding: "0 28px 0 12px",
  background: "var(--card)",
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  fontSize: 13,
  color: NAVY,
  appearance: "none",
};
const inputStyle: CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 10px",
  background: "var(--input-background)",
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  fontSize: 13,
  color: NAVY,
};
const textareaStyle: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "var(--input-background)",
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  fontSize: 13,
  color: NAVY,
  resize: "vertical",
  fontFamily: "inherit",
};
const fieldLabel: CSSProperties = { display: "block", fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600, marginBottom: 5 };
const secondaryButton: CSSProperties = { padding: "9px 14px", border: `1px solid ${BORDER}`, background: "var(--card)", borderRadius: 10, fontSize: 13, fontWeight: 600, color: NAVY };

/* ====================================================================== */
export function Departments(): ReactElement {
  const { permissions } = useAppSelector((s) => s.auth);
  // departments:manage gates the actions; null (not loaded yet) = no actions.
  const canManage = permissions?.includes("departments:manage") ?? false;

  const [rows, setRows] = useState<DepartmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");

  // The two queues — loaded up front so the tab badges are right on any tab.
  const [requests, setRequests] = useState<ServeRequestRow[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [pendingNeeds, setPendingNeeds] = useState<DepartmentNeedRow[]>([]);
  const [openNeeds, setOpenNeeds] = useState<DepartmentNeedRow[]>([]);
  const [needsLoading, setNeedsLoading] = useState(true);
  const [needsError, setNeedsError] = useState<string | null>(null);

  // Funds for the fund picker: undefined = loading, null = unavailable (the
  // caller lacks finance:view, or the call failed) → the form falls back to a
  // typed fund code, which the server validates.
  const [funds, setFunds] = useState<Fund[] | null | undefined>(undefined);
  const [deciding, setDeciding] = useState<Deciding>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [toast, showToast] = useToast();
  // Bumped after any change the drawer should re-read (posts, needs, requests).
  const [drawerNonce, setDrawerNonce] = useState(0);

  // `?department=<id>` so a department can be linked to; `?tab=requests|needs`.
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("department");
  const tabParam = searchParams.get("tab");
  const tab: TabKey = tabParam === "requests" || tabParam === "needs" ? tabParam : "departments";
  const setTab = useCallback(
    (t: TabKey) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (t === "departments") next.delete("tab");
          else next.set("tab", t);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const openDepartment = useCallback(
    (id: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("department", id);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const closeDepartment = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("department");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  // Out-of-order guards: only the latest request of each kind may land.
  const listSeq = useRef(0);
  const loadList = useCallback(async () => {
    const seq = ++listSeq.current;
    setLoading(true);
    try {
      const data = await DepartmentsApi.list();
      if (seq !== listSeq.current) return;
      setRows(data);
      setError(null);
    } catch (e) {
      if (seq !== listSeq.current) return;
      setError(errorMessage(e, "Could not load departments."));
    } finally {
      if (seq === listSeq.current) setLoading(false);
    }
  }, []);

  const requestsSeq = useRef(0);
  const loadRequests = useCallback(async () => {
    const seq = ++requestsSeq.current;
    setRequestsLoading(true);
    try {
      const data = await DepartmentsApi.serveRequests("requested");
      if (seq !== requestsSeq.current) return;
      setRequests(data);
      setRequestsError(null);
    } catch (e) {
      if (seq !== requestsSeq.current) return;
      setRequestsError(errorMessage(e, "Could not load requests to serve."));
    } finally {
      if (seq === requestsSeq.current) setRequestsLoading(false);
    }
  }, []);

  const needsSeq = useRef(0);
  const loadNeeds = useCallback(async () => {
    const seq = ++needsSeq.current;
    setNeedsLoading(true);
    try {
      const [pending, open] = await Promise.all([DepartmentsApi.needs("pending"), DepartmentsApi.needs("approved")]);
      if (seq !== needsSeq.current) return;
      setPendingNeeds(pending);
      setOpenNeeds(open);
      setNeedsError(null);
    } catch (e) {
      if (seq !== needsSeq.current) return;
      setNeedsError(errorMessage(e, "Could not load needs."));
    } finally {
      if (seq === needsSeq.current) setNeedsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
    void loadRequests();
    void loadNeeds();
  }, [loadList, loadRequests, loadNeeds]);
  // Reload a queue whenever it is opened — another admin may have decided meanwhile.
  useEffect(() => {
    if (tab === "requests") void loadRequests();
    if (tab === "needs") void loadNeeds();
  }, [tab, loadRequests, loadNeeds]);

  useEffect(() => {
    let alive = true;
    ConfigApi.financeConfig()
      .then((c) => {
        if (alive) setFunds(c.funds);
      })
      .catch(() => {
        if (alive) setFunds(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Everything a decision can move: the list's counts, both queues, the drawer.
  const reloadAll = useCallback(() => {
    void loadList();
    void loadRequests();
    void loadNeeds();
    setDrawerNonce((n) => n + 1);
  }, [loadList, loadRequests, loadNeeds]);

  /* ---------- actions ---------- */
  const createDepartment = useCallback(
    async (body: DepartmentUpsert) => {
      setCreating(true);
      setCreateError(null);
      try {
        const d = await DepartmentsApi.create(body);
        showToast("Department created");
        setCreateOpen(false);
        await loadList();
        if (d.department_id) openDepartment(d.department_id);
      } catch (e) {
        setCreateError(errorMessage(e, "Could not create the department."));
      } finally {
        setCreating(false);
      }
    },
    [showToast, loadList, openDepartment],
  );

  // Approve / decline a request to serve. Declining tells the member (they may
  // ask again), so it asks first; approving is the expected outcome. A 404
  // means the request was decided elsewhere — the row is stale, reload.
  const decideServe = useCallback(
    async (r: ServeRequestRow, decision: "approve" | "decline"): Promise<boolean> => {
      if (decision === "decline") {
        const ok = window.confirm(`Decline ${r.full_name}'s request to serve in ${r.department}?\n\nThey will be told, and may ask again.`);
        if (!ok) return false;
      }
      setDeciding({ key: serveKey(r), action: decision });
      try {
        await DepartmentsApi.decideServe(r.department_id, r.user_id, decision);
        setRequests((prev) => prev.filter((x) => !(x.department_id === r.department_id && x.user_id === r.user_id)));
        setRequestsError(null);
        showToast(decision === "approve" ? `${r.full_name} now serves in ${r.department}` : "Request declined");
        void loadList(); // member_count / pending_requests moved
        setDrawerNonce((n) => n + 1);
        return true;
      } catch (e) {
        if (axios.isAxiosError(e) && e.response?.status === 404) {
          setRequestsError("That request was already decided elsewhere.");
          void loadRequests();
        } else {
          setRequestsError(errorMessage(e, decision === "approve" ? "Could not approve the request." : "Could not decline the request."));
        }
        return false;
      } finally {
        setDeciding(null);
      }
    },
    [showToast, loadList, loadRequests],
  );

  // Approve / reject / close a need. Approving OPENS GIVING toward the need
  // and tells the department, and there is no undo (an approved need can only
  // be closed) — so it asks first, stating the target. Rejecting takes an
  // optional note for the submitter; closing asks because it stops giving.
  const decideNeed = useCallback(
    async (n: DepartmentNeedRow, decision: "approve" | "reject" | "close"): Promise<boolean> => {
      const target = money(n.target_minor, n.currency);
      let note: string | null = null;
      if (decision === "approve") {
        const by = n.deadline ? ` by ${fmtDate(n.deadline)}` : "";
        const ok = window.confirm(
          `Approve "${n.title}" for ${n.department}?\n\nThis opens giving toward it — ${target}${by}. The department will be told. It cannot be undone here; an open need can only be closed.`,
        );
        if (!ok) return false;
      } else if (decision === "reject") {
        const answer = window.prompt(`Reject "${n.title}" (${target}) from ${n.department}?\n\n${n.submitted_name} will be told. Add a short reason (optional):`, "");
        if (answer === null) return false;
        note = answer.trim() ? answer.trim().slice(0, NOTE_MAX) : null;
      } else {
        const ok = window.confirm(`Close "${n.title}"?\n\nGiving toward it stops. Raised so far: ${money(n.raised_minor, n.currency)} of ${target}.`);
        if (!ok) return false;
      }
      setDeciding({ key: needKey(n), action: decision });
      try {
        await DepartmentsApi.decideNeed(n.need_id, decision, note);
        setNeedsError(null);
        showToast(decision === "approve" ? "Approved — giving is open" : decision === "reject" ? "Need rejected" : "Need closed");
        reloadAll();
        return true;
      } catch (e) {
        if (axios.isAxiosError(e) && e.response?.status === 422) {
          setNeedsError(errorMessage(e, "This need was already decided."));
          void loadNeeds();
          setDrawerNonce((x) => x + 1);
        } else {
          setNeedsError(errorMessage(e, `Could not ${decision} the need.`));
        }
        return false;
      } finally {
        setDeciding(null);
      }
    },
    [showToast, reloadAll, loadNeeds],
  );

  /* ---------- derived ---------- */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!q) return true;
      return r.name.toLowerCase().includes(q) || (r.leader_name ?? "").toLowerCase().includes(q) || r.purpose.toLowerCase().includes(q);
    });
  }, [rows, search, statusFilter]);
  const filtersActive = search.trim() !== "" || statusFilter !== "active";

  // Tiles: the server's per-department counts, summed. Requests/needs sum over
  // every department (archived ones can still hold a pending row) so they foot
  // with the queues below; "Departments" counts active ones only.
  const totals = useMemo(() => {
    const active = rows.filter((r) => r.status === "active");
    return {
      departments: active.length,
      serving: active.reduce((s, r) => s + r.member_count, 0),
      requests: rows.reduce((s, r) => s + r.pending_requests, 0),
      pendingNeeds: rows.reduce((s, r) => s + r.pending_needs, 0),
      openNeeds: rows.reduce((s, r) => s + r.open_needs, 0),
    };
  }, [rows]);
  const loaded = !loading || rows.length > 0;
  const tiles = useMemo(
    () => [
      { label: "Departments", value: loaded ? String(totals.departments) : "—", hint: "active", icon: <HandHelping size={13} /> },
      { label: "Serving", value: loaded ? String(totals.serving) : "—", hint: "active members across departments", icon: <Users size={13} /> },
      { label: "Requests", value: loaded ? String(totals.requests) : "—", hint: "waiting to serve", icon: <UserPlus size={13} />, warn: totals.requests > 0 },
      { label: "Pending needs", value: loaded ? String(totals.pendingNeeds) : "—", hint: "awaiting approval", icon: <ClipboardList size={13} />, warn: totals.pendingNeeds > 0 },
      { label: "Open needs", value: loaded ? String(totals.openNeeds) : "—", hint: "giving is open", icon: <HandCoins size={13} /> },
    ],
    [loaded, totals],
  );

  const selected = selectedId ? rows.find((r) => r.department_id === selectedId) ?? null : null;
  const selectedRequests = useMemo(() => (selectedId ? requests.filter((r) => r.department_id === selectedId) : []), [requests, selectedId]);

  return (
    <div className="min-h-full" style={{ background: "var(--background)" }}>
      {/* hero */}
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px,4vw,48px) 24px" }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}>
            <span>Operations</span>
            <ChevronRight size={10} />
            <span style={{ color: "#fff", fontWeight: 600 }}>Departments</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5"
              style={{
                height: 32,
                background: "rgba(245,199,126,0.14)",
                color: "#F5C77E",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                border: "1px solid rgba(245,199,126,0.25)",
              }}
            >
              <HandHelping size={11} /> {loaded ? plural(totals.departments, "department", "departments") : "Departments"}
            </span>
            <HeroQueueButton label="Requests" count={requests.length} loading={requestsLoading} icon={<UserPlus size={11} />} onClick={() => setTab("requests")} />
            <HeroQueueButton label="Needs" count={pendingNeeds.length} loading={needsLoading} icon={<ClipboardList size={11} />} onClick={() => setTab("needs")} />
            {canManage ? <ActionButton dark icon={<Plus size={13} />} label="New department" onClick={() => setCreateOpen(true)} /> : null}
          </div>
        </div>
        <h1 style={{ fontFamily: DISPLAY, color: "#fff", fontSize: 24, lineHeight: 1.05, marginTop: 16, letterSpacing: "-0.015em" }}>Departments</h1>
        <div
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 mt-4 rounded-xl"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}
        >
          {tiles.map((t) => (
            <div key={t.label} style={{ padding: "14px 18px", borderRight: "1px solid rgba(255,255,255,0.07)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="flex items-center gap-1.5" style={{ fontSize: 10, color: t.warn ? "#F5C77E" : "rgba(232,239,245,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 6 }}>
                {t.icon} {t.label}
              </div>
              <div style={{ fontFamily: DISPLAY, fontSize: 18, color: t.warn ? "#F5C77E" : "#fff", lineHeight: 1.1 }}>{t.value}</div>
              <div style={{ fontSize: 11, color: "rgba(232,239,245,0.45)", marginTop: 4 }}>{t.hint}</div>
            </div>
          ))}
        </div>
      </div>

      {/* tab bar */}
      <div style={{ padding: "0 clamp(16px,4vw,48px)", background: "var(--background)" }}>
        <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${BORDER}`, overflowX: "auto" }}>
          {TABS.map((t) => {
            const active = tab === t.key;
            const count = t.key === "requests" ? requests.length : t.key === "needs" ? pendingNeeds.length : 0;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-current={active ? "page" : undefined}
                style={{
                  padding: "12px 16px",
                  border: "none",
                  background: "transparent",
                  color: active ? NAVY : MUTED,
                  fontSize: 14,
                  fontWeight: active ? 700 : 500,
                  borderBottom: active ? `2px solid ${GOLD}` : "2px solid transparent",
                  marginBottom: -1,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {t.label}
                {count > 0 ? (
                  <span style={{ minWidth: 18, height: 18, padding: "0 6px", borderRadius: 999, background: "#FFF4DA", color: "#A87616", fontFamily: MONO, fontSize: 11, lineHeight: "18px", textAlign: "center" }}>
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ padding: "24px clamp(16px,4vw,48px) 48px" }}>
        {tab === "departments" ? (
          <>
            {error ? <p style={{ color: "#A8281F", marginBottom: 12 }}>{error}</p> : null}
            <Card style={{ overflow: "hidden" }}>
              <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
                <div>
                  <div className="nuru-section-title">Departments</div>
                  <div style={{ fontSize: 12, color: MUTED }}>Where members serve — each with its leader, who is serving, and what it is asking for.</div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div style={{ position: "relative" }}>
                    <Search size={14} color="#6B7280" style={{ position: "absolute", left: 10, top: 10 }} />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search name, leader, purpose"
                      style={{ height: 34, padding: "0 12px 0 30px", background: "var(--input-background)", border: `1px solid ${BORDER}`, borderRadius: 10, width: 240, fontSize: 13 }}
                    />
                  </div>
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} style={selectStyle} aria-label="Status">
                    {STATUS_FILTERS.map((s) => (
                      <option key={s.value} value={s.value}>
                        Status: {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full" style={{ borderCollapse: "collapse", minWidth: 900 }}>
                  <thead>
                    <tr style={{ background: SURFACE }}>
                      <th style={thStyle}>Department</th>
                      <th style={thStyle}>Leader</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Members</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Requests</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Needs</th>
                      <th style={thStyle}>Open to join</th>
                      <th style={thStyle}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r, i) => (
                      <tr
                        key={r.department_id}
                        onClick={() => openDepartment(r.department_id)}
                        className="cursor-pointer transition-colors hover:bg-[var(--input-background)]"
                        style={{ borderTop: `1px solid ${BORDER}`, background: i % 2 === 1 ? "rgba(238,240,243,0.4)" : "transparent", opacity: r.status === "archived" ? 0.7 : 1 }}
                      >
                        <td style={tdStyle}>
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar name={r.name} url={r.image_url} seed={i} />
                            <div className="min-w-0">
                              <div style={{ fontSize: 13.5, fontWeight: 700, color: NAVY, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
                              <div style={{ fontSize: 11.5, color: MUTED, maxWidth: 360, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={r.purpose || undefined}>
                                {r.purpose || (r.meets ? `Meets ${r.meets}` : "No purpose written yet")}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{ ...tdStyle, whiteSpace: "nowrap", color: r.leader_name ? NAVY : MUTED }}>{r.leader_name ?? "No leader yet"}</td>
                        <td style={{ ...tdStyle, fontFamily: MONO, textAlign: "right" }}>{r.member_count}</td>
                        <td style={{ ...tdStyle, fontFamily: MONO, textAlign: "right", color: r.pending_requests > 0 ? "#A87616" : NAVY, fontWeight: r.pending_requests > 0 ? 700 : 400 }}>{r.pending_requests}</td>
                        <td style={{ ...tdStyle, fontFamily: MONO, textAlign: "right", whiteSpace: "nowrap" }}>
                          <span style={{ color: r.pending_needs > 0 ? "#A87616" : NAVY, fontWeight: r.pending_needs > 0 ? 700 : 400 }}>{r.pending_needs}</span>
                          <span style={{ color: MUTED }}> pending · </span>
                          <span style={{ color: r.open_needs > 0 ? "#0F6B33" : NAVY }}>{r.open_needs}</span>
                          <span style={{ color: MUTED }}> open</span>
                        </td>
                        <td style={tdStyle}>
                          <Pill chip={r.is_open_to_join ? { label: "Open", ...CHIP_GREEN } : { label: "Closed", ...CHIP_GREY }} />
                        </td>
                        <td style={tdStyle}>
                          <Pill chip={departmentStatusChip[r.status]} />
                        </td>
                      </tr>
                    ))}
                    {loading && rows.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ padding: "24px 16px", textAlign: "center", fontSize: 13, color: MUTED }}>
                          Loading departments…
                        </td>
                      </tr>
                    ) : null}
                    {!loading && filtered.length === 0 && !error ? (
                      <tr>
                        <td colSpan={7} style={{ padding: 0 }}>
                          <div className="text-center py-12" style={{ borderTop: `1px dashed ${BORDER}` }}>
                            <p style={{ fontSize: 14, color: MUTED }}>
                              {rows.length === 0
                                ? canManage
                                  ? "No departments yet — create the first one and members can ask to serve in it from the app."
                                  : "No departments yet."
                                : filtersActive
                                  ? "No departments match those filters."
                                  : "No departments."}
                            </p>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        ) : tab === "requests" ? (
          <RequestsPanel requests={requests} loading={requestsLoading} error={requestsError} canManage={canManage} deciding={deciding} onDecide={(r, d) => void decideServe(r, d)} />
        ) : (
          <NeedsPanel pending={pendingNeeds} open={openNeeds} loading={needsLoading} error={needsError} canManage={canManage} deciding={deciding} onDecide={(n, d) => void decideNeed(n, d)} />
        )}
      </div>

      {toast ? <Toast text={toast} /> : null}

      {createOpen ? (
        <DrawerShell title="New department" onClose={() => setCreateOpen(false)}>
          {createError ? <Notice result={{ tone: "error", text: createError }} onDismiss={() => setCreateError(null)} style={{ marginBottom: 14 }} /> : null}
          <DepartmentForm initial={null} funds={funds} submitting={creating} submitLabel="Create department" onSubmit={(b) => void createDepartment(b)} onCancel={() => setCreateOpen(false)} />
        </DrawerShell>
      ) : null}

      {selectedId ? (
        <DepartmentDrawer
          key={selectedId}
          departmentId={selectedId}
          row={selected}
          listLoading={loading}
          listError={error}
          requests={selectedRequests}
          funds={funds}
          canManage={canManage}
          deciding={deciding}
          nonce={drawerNonce}
          onClose={closeDepartment}
          onChanged={reloadAll}
          onListChanged={() => void loadList()}
          onDecideServe={decideServe}
          onDecideNeed={decideNeed}
          showToast={showToast}
        />
      ) : null}
    </div>
  );
}

/* ---------- hero queue button (count badge) ---------- */
function HeroQueueButton({ label, count, loading, icon, onClick }: { label: string; count: number; loading: boolean; icon: ReactNode; onClick: () => void }): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} to review`}
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5"
      style={{
        height: 32,
        background: "rgba(255,255,255,0.06)",
        color: "rgba(232,239,245,0.85)",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        border: "1px solid rgba(255,255,255,0.12)",
        cursor: "pointer",
      }}
    >
      {icon} {label}
      <span
        aria-label={`${count} pending`}
        style={{
          minWidth: 18,
          height: 18,
          padding: "0 6px",
          borderRadius: 999,
          background: count > 0 ? "#F5C77E" : "rgba(255,255,255,0.14)",
          color: count > 0 ? "#0B1F33" : "rgba(232,239,245,0.7)",
          fontFamily: MONO,
          fontSize: 11,
          lineHeight: "18px",
          textAlign: "center",
        }}
      >
        {loading && count === 0 ? "…" : count}
      </span>
    </button>
  );
}

/* ====================== DRAWER SHELL ====================== */
function DrawerShell({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }): ReactElement {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(7,22,41,0.42)" }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(680px, 100vw)",
          maxWidth: "100vw",
          background: "var(--card)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-20px 0 50px rgba(0,0,0,0.15)",
        }}
      >
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 20, color: NAVY }}>{title}</div>
          <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", color: MUTED, padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 22 }}>{children}</div>
        {footer ? <div style={{ borderTop: `1px solid ${BORDER}`, padding: 16, display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>{footer}</div> : null}
      </div>
    </div>
  );
}

function SectionTitle({ children, caption, action }: { children: ReactNode; caption?: string | undefined; action?: ReactNode }): ReactElement {
  return (
    <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
      <div style={{ fontFamily: DISPLAY, fontSize: 16, color: NAVY }}>{children}</div>
      {caption ? <span style={{ fontSize: 11, color: MUTED }}>{caption}</span> : null}
      {action ? <span style={{ marginLeft: "auto" }}>{action}</span> : null}
    </div>
  );
}

/* ====================== DEPARTMENT FORM ====================== */
// Shared by "New department" and the drawer's edit mode. Validates against the
// server's zod limits so the first submit is the one that lands; the server
// still owns the final word (unknown fund → 404, shown as the form's error).
function DepartmentForm({
  initial,
  funds,
  submitting,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: DepartmentRow | null;
  funds: Fund[] | null | undefined;
  submitting: boolean;
  submitLabel: string;
  onSubmit: (body: DepartmentUpsert) => void;
  onCancel: () => void;
}): ReactElement {
  const [name, setName] = useState(initial?.name ?? "");
  const [purpose, setPurpose] = useState(initial?.purpose ?? "");
  const [leader, setLeader] = useState<Leader | null>(
    initial?.leader_user_id ? { user_id: initial.leader_user_id, name: initial.leader_name ?? initial.leader_user_id } : null,
  );
  const [meets, setMeets] = useState(initial?.meets ?? "");
  const [imageUrl, setImageUrl] = useState(initial?.image_url ?? "");
  const [fundCode, setFundCode] = useState(initial?.fund_code ?? "");
  const [giftKeys, setGiftKeys] = useState<string[]>(initial?.gift_keys ?? []);
  const [openToJoin, setOpenToJoin] = useState(initial?.is_open_to_join ?? true);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (): void => {
    const n = name.trim();
    const p = purpose.trim();
    const m = meets.trim();
    const img = imageUrl.trim();
    const fund = fundCode.trim();
    if (n.length < NAME_MIN || n.length > NAME_MAX) return setProblem(`Name must be ${NAME_MIN}–${NAME_MAX} characters.`);
    if (p.length > PURPOSE_MAX) return setProblem(`Purpose must be at most ${PURPOSE_MAX} characters.`);
    if (m.length > MEETS_MAX) return setProblem(`"Meets" must be at most ${MEETS_MAX} characters.`);
    if (img && !/^https?:\/\/\S+$/i.test(img)) return setProblem("Image must be a full http(s) URL.");
    if (fund && (fund.length < FUND_CODE_MIN || fund.length > FUND_CODE_MAX)) return setProblem(`Fund code must be ${FUND_CODE_MIN}–${FUND_CODE_MAX} characters.`);
    setProblem(null);
    onSubmit({
      name: n,
      purpose: p,
      leader_user_id: leader?.user_id ?? null,
      meets: m || null,
      image_url: img || null,
      fund_code: fund || null,
      gift_keys: giftKeys,
      is_open_to_join: openToJoin,
    });
  };

  // Fund picker: the active funds (plus the current code if it is no longer
  // active, so editing never silently drops it); a typed code when the list
  // is unavailable.
  const fundOptions = useMemo(() => {
    if (!funds) return null;
    const active = funds.filter((f) => f.is_active);
    if (fundCode && !active.some((f) => f.code === fundCode)) {
      const known = funds.find((f) => f.code === fundCode);
      active.push(known ?? { code: fundCode, name: fundCode, is_active: false });
    }
    return active;
  }, [funds, fundCode]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      noValidate
    >
      {problem ? <Notice result={{ tone: "error", text: problem }} onDismiss={() => setProblem(null)} style={{ marginBottom: 14 }} /> : null}

      <label style={fieldLabel} htmlFor="dept-name">
        Name
      </label>
      <input id="dept-name" value={name} onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))} maxLength={NAME_MAX} placeholder="Worship, Ushering, Media…" style={inputStyle} autoFocus={!initial} />

      <label style={{ ...fieldLabel, marginTop: 12 }} htmlFor="dept-purpose">
        Purpose
      </label>
      <textarea
        id="dept-purpose"
        value={purpose}
        onChange={(e) => setPurpose(e.target.value.slice(0, PURPOSE_MAX))}
        maxLength={PURPOSE_MAX}
        rows={3}
        placeholder="What this department does, in a sentence or two — members read this in the app."
        style={textareaStyle}
      />
      <div style={{ fontSize: 11, color: MUTED, fontFamily: MONO, textAlign: "right", marginTop: 2 }}>
        {purpose.length}/{PURPOSE_MAX}
      </div>

      <label style={{ ...fieldLabel, marginTop: 8 }}>Leader</label>
      <LeaderPicker value={leader} onChange={setLeader} />
      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4 }}>The leader posts, submits needs and approves requests to serve from the app. Saving makes them an active member with the leader role.</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div>
          <label style={fieldLabel} htmlFor="dept-meets">
            Meets
          </label>
          <input id="dept-meets" value={meets} onChange={(e) => setMeets(e.target.value.slice(0, MEETS_MAX))} maxLength={MEETS_MAX} placeholder="Saturdays 2pm, main hall" style={inputStyle} />
        </div>
        <div>
          <label style={fieldLabel} htmlFor="dept-fund">
            Fund
          </label>
          {fundOptions ? (
            <select id="dept-fund" value={fundCode} onChange={(e) => setFundCode(e.target.value)} style={{ ...selectStyle, width: "100%", height: 36 }}>
              <option value="">No fund</option>
              {fundOptions.map((f) => (
                <option key={f.code} value={f.code}>
                  {f.name}
                  {f.is_active ? "" : " (inactive)"}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="dept-fund"
              value={fundCode}
              onChange={(e) => setFundCode(e.target.value.toUpperCase().slice(0, FUND_CODE_MAX))}
              maxLength={FUND_CODE_MAX}
              placeholder={funds === undefined ? "Loading funds…" : "Fund code, e.g. GENERAL"}
              disabled={funds === undefined}
              style={inputStyle}
            />
          )}
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4 }}>Gifts to this department's needs land in this fund.{funds === null ? " The fund list needs finance:view — type the fund's code; the server checks it." : ""}</div>

      <label style={{ ...fieldLabel, marginTop: 12 }} htmlFor="dept-image">
        Photo URL
      </label>
      <input id="dept-image" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" style={inputStyle} inputMode="url" />

      <label style={{ ...fieldLabel, marginTop: 12 }}>Gifts this department fits</label>
      <GiftKeysInput value={giftKeys} onChange={setGiftKeys} />
      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4 }}>Members whose top gifts match see "a good fit for you" in the app.</div>

      <label className="inline-flex items-center gap-2" style={{ marginTop: 14, fontSize: 13, color: NAVY, cursor: "pointer" }}>
        <input type="checkbox" checked={openToJoin} onChange={(e) => setOpenToJoin(e.target.checked)} />
        Open to join — members can ask to serve here
      </label>

      <div className="flex justify-end gap-2" style={{ marginTop: 18 }}>
        <button type="button" onClick={onCancel} disabled={submitting} style={secondaryButton}>
          Cancel
        </button>
        <ActionButton tone="primary" icon={<Check size={13} />} label={submitLabel} busy={submitting} onClick={submit} />
      </div>
    </form>
  );
}

/* ---------- leader picker ---------- */
// Member search (GET /admin/members?search=, members:view). When the search is
// refused or fails, a pasted member id still works — the server only needs
// leader_user_id.
function LeaderPicker({ value, onChange }: { value: Leader | null; onChange: (v: Leader | null) => void }): ReactElement {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<MemberRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [manualId, setManualId] = useState("");
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setSearching(false);
      return;
    }
    const mine = ++seq.current;
    setSearching(true);
    const t = setTimeout(() => {
      OpsApi.members({ search: q, limit: 8 })
        .then((r) => {
          if (mine !== seq.current) return;
          setHits(r.data);
          setFailed(false);
        })
        .catch(() => {
          if (mine !== seq.current) return;
          setHits([]);
          setFailed(true);
        })
        .finally(() => {
          if (mine === seq.current) setSearching(false);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  if (value) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-2 rounded-lg" style={{ padding: "6px 10px", background: "var(--input-background)", border: `1px solid ${BORDER}`, fontSize: 13, color: NAVY, fontWeight: 600 }}>
          <Avatar name={value.name} url={null} seed={0} size={22} />
          {value.name}
        </span>
        <button type="button" onClick={() => onChange(null)} style={{ ...secondaryButton, padding: "6px 10px", fontSize: 12 }}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <div style={{ position: "relative" }}>
        <Search size={14} color="#6B7280" style={{ position: "absolute", left: 10, top: 11 }} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search members by name or phone" style={{ ...inputStyle, paddingLeft: 30 }} aria-label="Search members" />
        {searching ? <Loader2 size={14} className="animate-spin" style={{ position: "absolute", right: 10, top: 11, color: MUTED }} /> : null}
      </div>
      {query.trim() && !searching && !failed ? (
        <div className="rounded-xl" style={{ marginTop: 6, border: `1px solid ${BORDER}`, background: "var(--card)", overflow: "hidden" }}>
          {hits.map((m, i) => (
            <button
              key={m.user_id}
              type="button"
              onClick={() => {
                onChange({ user_id: m.user_id, name: m.full_name });
                setQuery("");
              }}
              className="flex items-center gap-3 w-full text-left hover:bg-[var(--input-background)]"
              style={{ padding: "8px 10px", background: "transparent", border: "none", borderTop: i === 0 ? "none" : `1px solid ${BORDER}`, cursor: "pointer" }}
            >
              <Avatar name={m.full_name} url={null} seed={i} size={28} />
              <span className="min-w-0">
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: NAVY }}>{m.full_name}</span>
                <span style={{ display: "block", fontSize: 11.5, color: MUTED }}>{[m.phone_number, m.cell_name ?? "No cell yet"].filter(Boolean).join(" · ")}</span>
              </span>
            </button>
          ))}
          {hits.length === 0 ? <div style={{ padding: "10px 12px", fontSize: 12.5, color: MUTED }}>No member matches "{query.trim()}".</div> : null}
        </div>
      ) : null}
      {failed ? (
        <div style={{ marginTop: 8 }}>
          <Notice result={{ tone: "warn", text: "Member search is not available to you (it needs members:view). Paste the member's id instead." }} />
          <div className="flex gap-2" style={{ marginTop: 8 }}>
            <input value={manualId} onChange={(e) => setManualId(e.target.value.trim())} placeholder="Member id (UUID)" style={{ ...inputStyle, fontFamily: MONO, fontSize: 12 }} aria-label="Member id" />
            <ActionButton
              icon={<Check size={13} />}
              label="Use id"
              disabledTip={UUID_RE.test(manualId) ? undefined : "Enter a valid member id"}
              onClick={() => {
                onChange({ user_id: manualId, name: manualId });
                setManualId("");
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ---------- gift keys ---------- */
// The seven assessment gifts as toggles, plus any key the department wants
// (the server accepts free-form keys, ≤ 12 of ≤ 40 chars). Lower-cased so a
// typed "Music" and the app's "music" match.
function GiftKeysInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }): ReactElement {
  const [draft, setDraft] = useState("");
  const presets: readonly string[] = GIFT_KEYS;
  const custom = value.filter((k) => !presets.includes(k));
  const toggle = (k: string): void => onChange(value.includes(k) ? value.filter((x) => x !== k) : value.length < GIFT_KEYS_MAX ? [...value, k] : value);
  const add = (): void => {
    const k = draft.trim().toLowerCase().slice(0, GIFT_KEY_MAX);
    if (!k) return;
    if (!value.includes(k) && value.length < GIFT_KEYS_MAX) onChange([...value, k]);
    setDraft("");
  };
  const full = value.length >= GIFT_KEYS_MAX;
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {presets.map((k) => {
          const on = value.includes(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggle(k)}
              aria-pressed={on}
              className="rounded-full"
              style={{
                padding: "5px 11px",
                fontSize: 12,
                fontWeight: 600,
                border: `1px solid ${on ? NAVY : BORDER}`,
                background: on ? NAVY : "var(--card)",
                color: on ? "#fff" : NAVY,
                cursor: "pointer",
              }}
            >
              {titleCase(k)}
            </button>
          );
        })}
        {custom.map((k) => (
          <span key={k} className="inline-flex items-center gap-1 rounded-full" style={{ padding: "5px 6px 5px 11px", fontSize: 12, fontWeight: 600, background: "#E6EDF5", color: "#1E4068" }}>
            {titleCase(k)}
            <button type="button" onClick={() => toggle(k)} aria-label={`Remove ${k}`} style={{ background: "transparent", border: "none", color: "inherit", padding: 2, display: "inline-flex" }}>
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2" style={{ marginTop: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, GIFT_KEY_MAX))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={full ? `Up to ${GIFT_KEYS_MAX} gifts` : "Add another, e.g. music"}
          disabled={full}
          style={{ ...inputStyle, height: 32, fontSize: 12.5 }}
          aria-label="Add a gift key"
        />
        <ActionButton icon={<Plus size={13} />} label="Add" onClick={add} disabledTip={full ? `Up to ${GIFT_KEYS_MAX} gifts` : !draft.trim() ? "Type a gift first" : undefined} />
      </div>
    </div>
  );
}

/* ====================== DEPARTMENT DRAWER ====================== */
function DepartmentDrawer({
  departmentId,
  row,
  listLoading,
  listError,
  requests,
  funds,
  canManage,
  deciding,
  nonce,
  onClose,
  onChanged,
  onListChanged,
  onDecideServe,
  onDecideNeed,
  showToast,
}: {
  departmentId: string;
  /** From the list; null while the list loads or when the id is unknown. */
  row: DepartmentRow | null;
  listLoading: boolean;
  listError: string | null;
  /** This department's pending requests (from the page-level queue). */
  requests: ServeRequestRow[];
  funds: Fund[] | null | undefined;
  canManage: boolean;
  deciding: Deciding;
  /** Bumped by the page after any change this drawer should re-read. */
  nonce: number;
  onClose: () => void;
  /** Reload list + queues + this drawer (after a post, a need, a decision). */
  onChanged: () => void;
  /** Reload just the list (after an edit / archive). */
  onListChanged: () => void;
  onDecideServe: (r: ServeRequestRow, decision: "approve" | "decline") => Promise<boolean>;
  onDecideNeed: (n: DepartmentNeedRow, decision: "approve" | "reject" | "close") => Promise<boolean>;
  showToast: (text: string) => void;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [notice, setNotice] = useState<Result | null>(null);

  // Posts + active members come from the member-facing page (the only route
  // that returns posts); needs across every status come from the admin queue,
  // filtered to this department.
  const [page, setPage] = useState<DepartmentPage | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageGone, setPageGone] = useState(false); // 404: archived (or not visible)
  const [needs, setNeeds] = useState<DepartmentNeedRow[]>([]);
  const [needsError, setNeedsError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const seq = useRef(0);

  const loadDetail = useCallback(async () => {
    const mine = ++seq.current;
    setDetailLoading(true);
    const statuses: NeedStatus[] = ["pending", "approved", "rejected", "closed"];
    const [pageResult, needsResult] = await Promise.allSettled([
      DepartmentsApi.page(departmentId),
      Promise.all(statuses.map((s) => DepartmentsApi.needs(s))),
    ]);
    if (mine !== seq.current) return;
    if (pageResult.status === "fulfilled") {
      setPage(pageResult.value);
      setPageError(null);
      setPageGone(false);
    } else if (axios.isAxiosError(pageResult.reason) && pageResult.reason.response?.status === 404) {
      setPage(null);
      setPageGone(true);
      setPageError(null);
    } else {
      setPage(null);
      setPageGone(false);
      setPageError(errorMessage(pageResult.reason, "Could not load posts."));
    }
    if (needsResult.status === "fulfilled") {
      setNeeds(needsResult.value.flat().filter((n) => n.department_id === departmentId));
      setNeedsError(null);
    } else {
      setNeedsError(errorMessage(needsResult.reason, "Could not load this department's needs."));
    }
    setDetailLoading(false);
  }, [departmentId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail, nonce]);

  const save = useCallback(
    async (body: DepartmentUpsert) => {
      setSaving(true);
      setNotice(null);
      try {
        await DepartmentsApi.update(departmentId, body);
        setEditing(false);
        showToast("Department saved");
        onListChanged();
        void loadDetail(); // a new leader is now an active member
      } catch (e) {
        setNotice({ tone: "error", text: errorMessage(e, "Could not save the department.") });
      } finally {
        setSaving(false);
      }
    },
    [departmentId, showToast, onListChanged, loadDetail],
  );

  // Archive hides the department from the app (members keep their history and
  // it can be restored here) — asks first. Restore does not.
  const setStatus = useCallback(
    async (status: DepartmentRow["status"]) => {
      if (!row) return;
      if (status === "archived") {
        const ok = window.confirm(
          `Archive "${row.name}"?\n\nIt disappears from the app — members can no longer ask to serve, and nobody can post or submit needs. ${plural(row.member_count, "member keeps", "members keep")} their history. You can restore it here.`,
        );
        if (!ok) return;
      }
      setArchiving(true);
      setNotice(null);
      try {
        await DepartmentsApi.update(departmentId, { status });
        showToast(status === "archived" ? "Department archived" : "Department restored");
        onListChanged();
        void loadDetail();
      } catch (e) {
        setNotice({ tone: "error", text: errorMessage(e, status === "archived" ? "Could not archive the department." : "Could not restore the department.") });
      } finally {
        setArchiving(false);
      }
    },
    [row, departmentId, showToast, onListChanged, loadDetail],
  );

  if (!row) {
    return (
      <DrawerShell title="Department" onClose={onClose}>
        {listLoading ? (
          <p style={{ fontSize: 13, color: MUTED }}>Loading department…</p>
        ) : (
          <p style={{ fontSize: 13, color: "#A8281F" }}>{listError ?? "Department not found — it may belong to another congregation."}</p>
        )}
      </DrawerShell>
    );
  }

  const archived = row.status === "archived";
  const cellStyle: CSSProperties = { padding: 12, background: "var(--input-background)", borderRadius: 10 };
  const labelStyle: CSSProperties = { fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600, marginBottom: 6 };
  const pendingHere = needs.filter((n) => n.status === "pending").length;

  return (
    <DrawerShell
      title="Department"
      onClose={onClose}
      footer={
        <>
          {notice ? (
            <span role={notice.tone === "error" ? "alert" : "status"} className="inline-flex items-center gap-1.5" style={{ marginRight: "auto", minWidth: 0, fontSize: 12.5, fontWeight: 600, color: TONE[notice.tone].color }}>
              {notice.tone === "ok" ? <Check size={13} /> : <AlertTriangle size={13} />}
              {notice.text}
            </span>
          ) : null}
          <button onClick={onClose} style={secondaryButton}>
            Close
          </button>
          {canManage ? (
            archived ? (
              <ActionButton icon={<ArchiveRestore size={13} />} label="Restore" busy={archiving} onClick={() => void setStatus("active")} />
            ) : (
              <ActionButton tone="danger" icon={<Archive size={13} />} label="Archive" busy={archiving} onClick={() => void setStatus("archived")} />
            )
          ) : null}
        </>
      }
    >
      {/* header */}
      <div className="flex items-start gap-3">
        <Avatar name={row.name} url={row.image_url} seed={0} size={52} />
        <div className="min-w-0" style={{ flex: 1 }}>
          <div className="flex items-center gap-2 flex-wrap">
            <span style={{ fontSize: 17, color: NAVY, fontWeight: 700 }}>{row.name}</span>
            <Pill chip={departmentStatusChip[row.status]} />
            <Pill chip={row.is_open_to_join ? { label: "Open to join", ...CHIP_GREEN } : { label: "Not taking members", ...CHIP_GREY }} />
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>
            {[row.leader_name ? `Led by ${row.leader_name}` : "No leader yet", row.meets ? `Meets ${row.meets}` : null, row.fund_code ? `Fund ${row.fund_code}` : null].filter(Boolean).join(" · ")}
          </div>
          {row.purpose ? <div style={{ fontSize: 13, color: NAVY, marginTop: 8, lineHeight: 1.45 }}>{row.purpose}</div> : null}
          {row.gift_keys.length > 0 ? (
            <div className="flex flex-wrap gap-1.5" style={{ marginTop: 8 }}>
              {row.gift_keys.map((k) => (
                <Pill key={k} chip={{ label: titleCase(k), ...CHIP_NAVY }} />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
        <div style={cellStyle}>
          <div style={labelStyle}>Serving</div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: NAVY, fontWeight: 700 }}>{row.member_count}</div>
        </div>
        <div style={cellStyle}>
          <div style={labelStyle}>Requests</div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: row.pending_requests > 0 ? "#A87616" : NAVY, fontWeight: 700 }}>{row.pending_requests}</div>
        </div>
        <div style={cellStyle}>
          <div style={labelStyle}>Pending needs</div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: row.pending_needs > 0 ? "#A87616" : NAVY, fontWeight: 700 }}>{row.pending_needs}</div>
        </div>
        <div style={cellStyle}>
          <div style={labelStyle}>Open needs</div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: NAVY, fontWeight: 700 }}>{row.open_needs}</div>
        </div>
      </div>

      {/* details / edit */}
      <div style={{ marginTop: 22 }}>
        <SectionTitle
          caption={`created ${fmtDate(row.created_at)}`}
          action={canManage && !editing ? <ActionButton icon={<Pencil size={13} />} label="Edit" onClick={() => setEditing(true)} /> : undefined}
        >
          Details
        </SectionTitle>
        {editing ? (
          <div className="rounded-xl" style={{ border: `1px solid ${BORDER}`, padding: 14 }}>
            <DepartmentForm key={`${row.department_id}:${row.created_at}`} initial={row} funds={funds} submitting={saving} submitLabel="Save changes" onSubmit={(b) => void save(b)} onCancel={() => setEditing(false)} />
          </div>
        ) : (
          <div className="rounded-xl" style={{ border: `1px solid ${BORDER}`, padding: 14, fontSize: 12.5, color: NAVY, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
            <DetailLine label="Leader" value={row.leader_name ?? "—"} />
            <DetailLine label="Meets" value={row.meets ?? "—"} />
            <DetailLine label="Fund" value={row.fund_code ?? "—"} mono />
            <DetailLine label="Open to join" value={row.is_open_to_join ? "Yes" : "No"} />
            <DetailLine label="Photo" value={row.image_url ?? "—"} mono />
            <DetailLine label="Gifts" value={row.gift_keys.length ? row.gift_keys.map(titleCase).join(", ") : "—"} />
          </div>
        )}
      </div>

      {/* posts */}
      <div style={{ marginTop: 22 }}>
        <SectionTitle caption={page ? plural(page.posts.length, "post", "posts") : undefined}>Posts</SectionTitle>
        <PostsSection
          departmentId={departmentId}
          page={page}
          gone={pageGone}
          error={pageError}
          loading={detailLoading && !page}
          archived={archived}
          canManage={canManage}
          onChanged={() => {
            void loadDetail();
            onChanged();
          }}
          showToast={showToast}
        />
      </div>

      {/* members */}
      {page && page.members.length > 0 ? (
        <div style={{ marginTop: 22 }}>
          <SectionTitle caption={plural(page.members.length, "serving", "serving")}>Members</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {page.members.map((m, i) => (
              <span key={m.user_id} className="inline-flex items-center gap-2 rounded-lg" style={{ padding: "5px 10px 5px 6px", border: `1px solid ${BORDER}`, fontSize: 12.5, color: NAVY }}>
                <Avatar name={m.full_name} url={m.avatar_url} seed={i} size={22} />
                {m.full_name}
                {m.role === "leader" ? <Pill chip={{ label: "Leader", ...CHIP_VIOLET }} /> : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* needs */}
      <div style={{ marginTop: 22 }}>
        <SectionTitle caption={needs.length ? `${plural(needs.length, "need", "needs")}${pendingHere ? ` · ${pendingHere} awaiting approval` : ""}` : undefined}>Needs</SectionTitle>
        {needsError ? <Notice result={{ tone: "error", text: needsError }} style={{ marginBottom: 10 }} /> : null}
        {canManage && !archived ? (
          <NeedComposer
            departmentId={departmentId}
            onCreated={() => {
              showToast("Need submitted — it is in the queue");
              onChanged();
            }}
          />
        ) : null}
        {detailLoading && needs.length === 0 && !needsError ? (
          <p style={{ fontSize: 12.5, color: MUTED }}>Loading needs…</p>
        ) : needs.length === 0 && !needsError ? (
          <div className="rounded-xl text-center py-6" style={{ border: `1px dashed ${BORDER}`, fontSize: 12.5, color: MUTED }}>
            No needs yet — the leader submits one from the app{canManage && !archived ? ", or the office can above" : ""}.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {needs.map((n) => (
              <NeedCard key={n.need_id} need={n} canManage={canManage} deciding={deciding} onDecide={(d) => void onDecideNeed(n, d)} />
            ))}
          </div>
        )}
      </div>

      {/* requests */}
      <div style={{ marginTop: 22 }}>
        <SectionTitle caption={requests.length ? plural(requests.length, "pending", "pending") : undefined}>Requests to serve</SectionTitle>
        {requests.length === 0 ? (
          <div className="rounded-xl text-center py-6" style={{ border: `1px dashed ${BORDER}`, fontSize: 12.5, color: MUTED }}>
            Nobody is waiting to serve here.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {requests.map((r, i) => (
              <RequestCard key={`${r.department_id}:${r.user_id}`} request={r} seed={i} canManage={canManage} deciding={deciding} onDecide={(d) => void onDecideServe(r, d)} />
            ))}
          </div>
        )}
      </div>
    </DrawerShell>
  );
}

function DetailLine({ label, value, mono = false }: { label: string; value: string; mono?: boolean }): ReactElement {
  return (
    <div className="min-w-0">
      <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: mono ? MONO : undefined, fontSize: mono ? 12 : 12.5, color: NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={value}>
        {value}
      </div>
    </div>
  );
}

/* ---------- posts ---------- */
// Compose (office post → members are nudged) + the department's posts, newest
// first, each removable. An archived department cannot be posted to (server
// 404s), and its posts cannot be read (the member page is active-only).
function PostsSection({
  departmentId,
  page,
  gone,
  error,
  loading,
  archived,
  canManage,
  onChanged,
  showToast,
}: {
  departmentId: string;
  page: DepartmentPage | null;
  gone: boolean;
  error: string | null;
  loading: boolean;
  archived: boolean;
  canManage: boolean;
  onChanged: () => void;
  showToast: (text: string) => void;
}): ReactElement {
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [posting, setPosting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [notice, setNotice] = useState<Result | null>(null);

  const post = async (): Promise<void> => {
    const text = body.trim();
    const img = imageUrl.trim();
    if (!text) return setNotice({ tone: "warn", text: "Write something first." });
    if (img && !/^https?:\/\/\S+$/i.test(img)) return setNotice({ tone: "warn", text: "Image must be a full http(s) URL." });
    setPosting(true);
    setNotice(null);
    try {
      await DepartmentsApi.createPost(departmentId, { body: text, image_url: img || null });
      setBody("");
      setImageUrl("");
      showToast("Posted — members will hear about it");
      onChanged();
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e, "Could not post.") });
    } finally {
      setPosting(false);
    }
  };

  const remove = async (postId: string): Promise<void> => {
    if (!window.confirm("Remove this post?\n\nIt disappears from the app for everyone.")) return;
    setRemoving(postId);
    setNotice(null);
    try {
      await DepartmentsApi.deletePost(departmentId, postId);
      showToast("Post removed");
      onChanged();
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e, "Could not remove the post.") });
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div>
      {notice ? <Notice result={notice} onDismiss={() => setNotice(null)} style={{ marginBottom: 10 }} /> : null}
      {canManage && !archived ? (
        <div className="rounded-xl" style={{ border: `1px solid ${BORDER}`, padding: 12, marginBottom: 12 }}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, POST_MAX))}
            maxLength={POST_MAX}
            rows={3}
            placeholder="A word from the office to this department — members read it in the app and get a nudge."
            style={textareaStyle}
            aria-label="New post"
          />
          <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 8 }}>
            <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="Image URL (optional)" style={{ ...inputStyle, height: 32, fontSize: 12.5, flex: 1, minWidth: 180 }} inputMode="url" aria-label="Image URL" />
            <span style={{ fontFamily: MONO, fontSize: 11, color: body.length >= POST_MAX ? "#A87616" : MUTED, whiteSpace: "nowrap" }}>
              {body.length}/{POST_MAX}
            </span>
            <ActionButton tone="primary" icon={<Send size={13} />} label="Post" busy={posting} disabledTip={body.trim() ? undefined : "Write something first"} onClick={() => void post()} />
          </div>
        </div>
      ) : null}
      {gone ? (
        <div className="rounded-xl text-center py-6" style={{ border: `1px dashed ${BORDER}`, fontSize: 12.5, color: MUTED }}>
          {archived ? "Posts are not shown for an archived department — restore it to read them." : "Posts are not available for this department."}
        </div>
      ) : error ? (
        <Notice result={{ tone: "error", text: error }} />
      ) : loading ? (
        <p style={{ fontSize: 12.5, color: MUTED }}>Loading posts…</p>
      ) : !page || page.posts.length === 0 ? (
        <div className="rounded-xl text-center py-6" style={{ border: `1px dashed ${BORDER}`, fontSize: 12.5, color: MUTED }}>
          Nothing posted yet.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {page.posts.map((p, i) => (
            <div key={p.post_id} className="rounded-xl" style={{ border: `1px solid ${BORDER}`, padding: 12 }}>
              <div className="flex items-start gap-3">
                <Avatar name={p.author_name ?? "Office"} url={p.author_avatar ?? null} seed={i} size={30} />
                <div className="min-w-0" style={{ flex: 1 }}>
                  <div className="flex items-center gap-2 flex-wrap" style={{ fontSize: 12, color: MUTED }}>
                    <span style={{ color: NAVY, fontWeight: 600 }}>{p.author_name ?? "Office"}</span>
                    <span style={{ fontFamily: MONO }}>{fmtDateTime(p.created_at)}</span>
                    {canManage ? (
                      <span style={{ marginLeft: "auto" }}>
                        <ActionButton icon={<Trash2 size={13} />} label="Remove" busy={removing === p.post_id} disabledTip={removing && removing !== p.post_id ? "Another removal is in flight" : undefined} onClick={() => void remove(p.post_id)} />
                      </span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 13, color: NAVY, marginTop: 6, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{p.body}</div>
                  {p.image_url ? <img src={p.image_url} alt="" style={{ marginTop: 8, maxWidth: "100%", maxHeight: 260, borderRadius: 10, objectFit: "cover" }} /> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- need composer (office submits on the department's behalf) ---------- */
function NeedComposer({ departmentId, onCreated }: { departmentId: string; onCreated: () => void }): ReactElement {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("KES");
  const [deadline, setDeadline] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Result | null>(null);

  const submit = async (): Promise<void> => {
    const t = title.trim();
    const w = why.trim();
    const cur = currency.trim().toUpperCase();
    // Major units typed → integer minor units; never a float past this line.
    const major = Number(amount.replace(/,/g, ""));
    const targetMinor = Number.isFinite(major) ? Math.round(major * 100) : 0;
    if (t.length < NEED_TITLE_MIN || t.length > NEED_TITLE_MAX) return setNotice({ tone: "warn", text: `Title must be ${NEED_TITLE_MIN}–${NEED_TITLE_MAX} characters.` });
    if (w.length < NEED_WHY_MIN || w.length > NEED_WHY_MAX) return setNotice({ tone: "warn", text: `"Why" must be ${NEED_WHY_MIN}–${NEED_WHY_MAX} characters.` });
    if (!(targetMinor > 0)) return setNotice({ tone: "warn", text: "Target must be more than zero." });
    if (!/^[A-Z]{3}$/.test(cur)) return setNotice({ tone: "warn", text: "Currency is a 3-letter code, e.g. KES." });
    if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return setNotice({ tone: "warn", text: "Deadline must be a date." });
    const body: DepartmentNeedCreate = { title: t, why: w, target_minor: targetMinor, currency: cur, deadline: deadline || null };
    setSubmitting(true);
    setNotice(null);
    try {
      await DepartmentsApi.createNeed(departmentId, body);
      setTitle("");
      setWhy("");
      setAmount("");
      setDeadline("");
      setOpen(false);
      onCreated();
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e, "Could not submit the need.") });
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <div style={{ marginBottom: 12 }}>
        <ActionButton icon={<Plus size={13} />} label="Submit a need" onClick={() => setOpen(true)} />
      </div>
    );
  }
  return (
    <div className="rounded-xl" style={{ border: `1px solid ${BORDER}`, padding: 12, marginBottom: 12 }}>
      <div style={{ fontFamily: DISPLAY, fontSize: 15, color: NAVY, marginBottom: 10 }}>Submit a need</div>
      {notice ? <Notice result={notice} onDismiss={() => setNotice(null)} style={{ marginBottom: 10 }} /> : null}
      <label style={fieldLabel} htmlFor="need-title">
        Title
      </label>
      <input id="need-title" value={title} onChange={(e) => setTitle(e.target.value.slice(0, NEED_TITLE_MAX))} maxLength={NEED_TITLE_MAX} placeholder="A new sound desk" style={inputStyle} autoFocus />
      <label style={{ ...fieldLabel, marginTop: 10 }} htmlFor="need-why">
        Why
      </label>
      <textarea id="need-why" value={why} onChange={(e) => setWhy(e.target.value.slice(0, NEED_WHY_MAX))} maxLength={NEED_WHY_MAX} rows={3} placeholder="What it is for and what changes when it is met — members read this before they give." style={textareaStyle} />
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1.4fr", gap: 10, marginTop: 10 }}>
        <div>
          <label style={fieldLabel} htmlFor="need-target">
            Target
          </label>
          <input id="need-target" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="120,000" inputMode="decimal" style={{ ...inputStyle, fontFamily: MONO }} />
        </div>
        <div>
          <label style={fieldLabel} htmlFor="need-currency">
            Currency
          </label>
          <input id="need-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} maxLength={3} style={{ ...inputStyle, fontFamily: MONO }} />
        </div>
        <div>
          <label style={fieldLabel} htmlFor="need-deadline">
            Deadline (optional)
          </label>
          <input id="need-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} style={inputStyle} />
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 6 }}>It enters the queue as pending; approving it (below, or on the Needs tab) opens giving toward it.</div>
      <div className="flex justify-end gap-2" style={{ marginTop: 12 }}>
        <button type="button" onClick={() => setOpen(false)} disabled={submitting} style={secondaryButton}>
          Cancel
        </button>
        <ActionButton tone="primary" icon={<Send size={13} />} label="Submit" busy={submitting} onClick={() => void submit()} />
      </div>
    </div>
  );
}

/* ---------- need card ---------- */
// One need with its server-computed progress. Actions follow the state
// machine: pending → approve | reject; approved → close; rejected/closed: none.
function NeedCard({
  need: n,
  showDepartment = false,
  canManage,
  deciding,
  onDecide,
}: {
  need: DepartmentNeedRow;
  showDepartment?: boolean;
  canManage: boolean;
  deciding: Deciding;
  onDecide: (decision: "approve" | "reject" | "close") => void;
}): ReactElement {
  const key = needKey(n);
  const mine = deciding?.key === key;
  const otherBusy = deciding !== null && !mine;
  const ratio = n.target_minor > 0 ? Math.max(0, Math.min(1, n.raised_minor / n.target_minor)) : 0;
  const reached = n.raised_minor >= n.target_minor;
  const barColor = n.status === "closed" || n.status === "rejected" ? "#9CA3AF" : reached ? "#7C3AED" : "#16A34A";
  const tip = (action: string): string | undefined => (deciding && !(mine && deciding.action === action) ? "Another decision is in flight" : undefined);
  return (
    <div className="rounded-xl" style={{ border: `1px solid ${BORDER}`, padding: 14, background: "var(--card)", opacity: otherBusy ? 0.7 : 1 }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0" style={{ flex: 1 }}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5" style={{ fontSize: 13.5, fontWeight: 700, color: NAVY }}>
              <Target size={13} />
              {n.title}
            </span>
            <Pill chip={needStatusChip[n.status]} />
            {reached && n.status === "approved" ? <Pill chip={{ label: "Target reached", ...CHIP_VIOLET }} /> : null}
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
            {[showDepartment ? n.department : null, `Submitted by ${n.submitted_name}`, fmtDate(n.created_at), n.deadline ? `by ${fmtDate(n.deadline)}` : null].filter(Boolean).join(" · ")}
          </div>
          <div style={{ fontSize: 12.5, color: NAVY, marginTop: 6, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{n.why}</div>
        </div>
        {canManage ? (
          <div className="inline-flex gap-2 flex-wrap">
            {n.status === "pending" ? (
              <>
                <ActionButton tone="primary" icon={<Check size={13} />} label="Approve" busy={mine && deciding?.action === "approve"} disabledTip={tip("approve")} onClick={() => onDecide("approve")} />
                <ActionButton tone="danger" icon={<Ban size={13} />} label="Reject" busy={mine && deciding?.action === "reject"} disabledTip={tip("reject")} onClick={() => onDecide("reject")} />
              </>
            ) : n.status === "approved" ? (
              <ActionButton icon={<Archive size={13} />} label="Close" busy={mine && deciding?.action === "close"} disabledTip={tip("close")} onClick={() => onDecide("close")} />
            ) : null}
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="flex items-center justify-between" style={{ fontSize: 11.5, color: MUTED, marginBottom: 5 }}>
          <span style={{ fontFamily: MONO, color: NAVY }}>
            {money(n.raised_minor, n.currency)} <span style={{ color: MUTED }}>of {money(n.target_minor, n.currency)}</span>
          </span>
          <span style={{ fontFamily: MONO }}>{Math.round(ratio * 100)}%</span>
        </div>
        <div style={{ height: 8, background: "#EEF0F3", borderRadius: 999, overflow: "hidden" }} aria-hidden="true">
          <div style={{ width: `${Math.round(ratio * 100)}%`, height: "100%", background: barColor, borderRadius: 999, transition: "width 200ms" }} />
        </div>
      </div>
    </div>
  );
}

/* ---------- request card (drawer) ---------- */
function RequestCard({ request: r, seed, canManage, deciding, onDecide }: { request: ServeRequestRow; seed: number; canManage: boolean; deciding: Deciding; onDecide: (decision: "approve" | "decline") => void }): ReactElement {
  const key = serveKey(r);
  const mine = deciding?.key === key;
  const tip = (action: string): string | undefined => (deciding && !(mine && deciding.action === action) ? "Another decision is in flight" : undefined);
  return (
    <div className="flex items-center gap-3 rounded-xl flex-wrap" style={{ border: `1px solid ${BORDER}`, padding: "10px 12px", opacity: deciding && !mine ? 0.7 : 1 }}>
      <Avatar name={r.full_name} url={r.avatar_url} seed={seed} size={34} />
      <div className="min-w-0" style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>{r.full_name}</div>
        <div style={{ fontSize: 11.5, color: MUTED }}>{[r.phone_number, `asked ${fmtDateTime(r.requested_at)}`].filter(Boolean).join(" · ")}</div>
      </div>
      {canManage ? (
        <div className="inline-flex gap-2">
          <ActionButton tone="primary" icon={<Check size={13} />} label="Approve" busy={mine && deciding?.action === "approve"} disabledTip={tip("approve")} onClick={() => onDecide("approve")} />
          <ActionButton tone="danger" icon={<Ban size={13} />} label="Decline" busy={mine && deciding?.action === "decline"} disabledTip={tip("decline")} onClick={() => onDecide("decline")} />
        </div>
      ) : null}
    </div>
  );
}

/* ====================== REQUESTS TAB ====================== */
// Every pending request to serve, oldest first. Approving makes the member an
// active member of the department (they are told); declining tells them too.
function RequestsPanel({
  requests,
  loading,
  error,
  canManage,
  deciding,
  onDecide,
}: {
  requests: ServeRequestRow[];
  loading: boolean;
  error: string | null;
  canManage: boolean;
  deciding: Deciding;
  onDecide: (r: ServeRequestRow, decision: "approve" | "decline") => void;
}): ReactElement {
  const cols = canManage ? 5 : 4;
  return (
    <Card style={{ overflow: "hidden" }}>
      <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div>
          <div className="nuru-section-title">Requests to serve</div>
          <div style={{ fontSize: 12, color: MUTED }}>"I'd like to serve here" — approving adds the member to the department; either way they are told.</div>
        </div>
        <span style={{ fontSize: 12, color: MUTED, fontFamily: MONO, whiteSpace: "nowrap" }}>{loading && requests.length === 0 ? "…" : `${requests.length} pending`}</span>
      </div>
      {error ? (
        <p role="alert" style={{ color: "#A8281F", fontSize: 12.5, padding: "10px 20px 0", margin: 0 }}>
          {error}
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full" style={{ borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr style={{ background: SURFACE }}>
              <th style={thStyle}>Member</th>
              <th style={thStyle}>Department</th>
              <th style={thStyle}>Phone</th>
              <th style={thStyle}>Asked</th>
              {canManage ? <th style={{ ...thStyle, textAlign: "right" }}>Decision</th> : null}
            </tr>
          </thead>
          <tbody>
            {requests.map((r, i) => {
              const key = serveKey(r);
              const mine = deciding?.key === key;
              const otherBusy = deciding !== null && !mine;
              const tip = (action: string): string | undefined => (deciding && !(mine && deciding.action === action) ? "Another decision is in flight" : undefined);
              return (
                <tr key={key} style={{ borderTop: `1px solid ${BORDER}`, background: i % 2 === 1 ? "rgba(238,240,243,0.4)" : "transparent", opacity: otherBusy ? 0.6 : 1 }}>
                  <td style={tdStyle}>
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar name={r.full_name} url={r.avatar_url} seed={i} size={34} />
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: NAVY, whiteSpace: "nowrap" }}>{r.full_name}</div>
                    </div>
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap", fontWeight: 600 }}>{r.department}</td>
                  <td style={{ ...tdStyle, fontFamily: MONO, fontSize: 12, whiteSpace: "nowrap", color: r.phone_number ? NAVY : MUTED }}>{r.phone_number ?? "—"}</td>
                  <td style={{ ...tdStyle, fontFamily: MONO, fontSize: 12, whiteSpace: "nowrap" }}>{fmtDateTime(r.requested_at)}</td>
                  {canManage ? (
                    <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                      <div className="inline-flex gap-2">
                        <ActionButton tone="primary" icon={<Check size={13} />} label="Approve" busy={mine && deciding?.action === "approve"} disabledTip={tip("approve")} onClick={() => onDecide(r, "approve")} />
                        <ActionButton tone="danger" icon={<Ban size={13} />} label="Decline" busy={mine && deciding?.action === "decline"} disabledTip={tip("decline")} onClick={() => onDecide(r, "decline")} />
                      </div>
                    </td>
                  ) : null}
                </tr>
              );
            })}
            {loading && requests.length === 0 ? (
              <tr>
                <td colSpan={cols} style={{ padding: "24px 16px", textAlign: "center", fontSize: 13, color: MUTED }}>
                  Loading requests…
                </td>
              </tr>
            ) : null}
            {!loading && requests.length === 0 && !error ? (
              <tr>
                <td colSpan={cols} style={{ padding: 0 }}>
                  <div className="text-center py-12" style={{ borderTop: `1px dashed ${BORDER}` }}>
                    <p style={{ fontSize: 14, color: MUTED }}>Nobody is waiting — every request to serve has been decided.</p>
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ====================== NEEDS TAB ====================== */
// Needs awaiting approval (approve opens giving; reject tells the submitter)
// and open needs with their exact raised figure, closable once met or moot.
function NeedsPanel({
  pending,
  open,
  loading,
  error,
  canManage,
  deciding,
  onDecide,
}: {
  pending: DepartmentNeedRow[];
  open: DepartmentNeedRow[];
  loading: boolean;
  error: string | null;
  canManage: boolean;
  deciding: Deciding;
  onDecide: (n: DepartmentNeedRow, decision: "approve" | "reject" | "close") => void;
}): ReactElement {
  return (
    <div className="flex flex-col gap-5">
      {error ? (
        <p role="alert" style={{ color: "#A8281F", fontSize: 12.5, margin: 0 }}>
          {error}
        </p>
      ) : null}
      <Card>
        <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <div>
            <div className="nuru-section-title">Awaiting approval</div>
            <div style={{ fontSize: 12, color: MUTED }}>Approving opens giving toward the need — it becomes its own giving target and the department is told. Rejecting tells the submitter.</div>
          </div>
          <span style={{ fontSize: 12, color: MUTED, fontFamily: MONO, whiteSpace: "nowrap" }}>{loading && pending.length === 0 ? "…" : `${pending.length} pending`}</span>
        </div>
        <div style={{ padding: 16 }}>
          {loading && pending.length === 0 ? (
            <p style={{ fontSize: 13, color: MUTED, margin: 0, textAlign: "center", padding: "8px 0" }}>Loading needs…</p>
          ) : pending.length === 0 ? (
            <div className="text-center py-8" style={{ border: `1px dashed ${BORDER}`, borderRadius: 12 }}>
              <p style={{ fontSize: 14, color: MUTED, margin: 0 }}>Nothing to approve — every need has been decided.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {pending.map((n) => (
                <NeedCard key={n.need_id} need={n} showDepartment canManage={canManage} deciding={deciding} onDecide={(d) => onDecide(n, d)} />
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <div>
            <div className="nuru-section-title">Open — giving is on</div>
            <div style={{ fontSize: 12, color: MUTED }}>Raised is exact: gifts made to the need and gifts under pledges to it, nothing else. Close a need once it is met or no longer applies.</div>
          </div>
          <span style={{ fontSize: 12, color: MUTED, fontFamily: MONO, whiteSpace: "nowrap" }}>{loading && open.length === 0 ? "…" : `${open.length} open`}</span>
        </div>
        <div style={{ padding: 16 }}>
          {loading && open.length === 0 ? (
            <p style={{ fontSize: 13, color: MUTED, margin: 0, textAlign: "center", padding: "8px 0" }}>Loading needs…</p>
          ) : open.length === 0 ? (
            <div className="text-center py-8" style={{ border: `1px dashed ${BORDER}`, borderRadius: 12 }}>
              <p style={{ fontSize: 14, color: MUTED, margin: 0 }}>No open needs — approve one above to open giving.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {open.map((n) => (
                <NeedCard key={n.need_id} need={n} showDepartment canManage={canManage} deciding={deciding} onDecide={(d) => onDecide(n, d)} />
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
