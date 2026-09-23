// Partners — the Partners programme console (docs/PARTNERS_PROGRAMME.md §5–§6,
// phase 1). Who has joined, what each partner has committed, whether they are
// behind, and — per partner — their pledges with server-computed progress, the
// schedules charging them, the payments attributed to each pledge and the
// reminder log. READ-ONLY in this phase: the phase-2 actions (send reminder,
// confirm a claim) render disabled so the surface is complete but never calls
// an endpoint that does not exist yet. Money is integer minor units + ISO
// currency; every progress value and every "behind" flag comes from the server
// — this page derives nothing about money or standing on its own (§1.1).
//
// Visual language follows Finance.tsx (dark hero + tile strip, card table,
// right-hand drawer) and Members.tsx (avatar + name + cell row, dashed empty
// state). Helpers are local copies, as every rebuilt page keeps its own.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  BellOff,
  CalendarClock,
  ChevronRight,
  HandHeart,
  Receipt,
  Repeat,
  Search,
  Send,
  Target,
  Users,
  Wallet,
  X,
} from "lucide-react";
import {
  PartnersApi,
  type AdminScheduleRow,
  type PartnerDetail,
  type PartnerPledge,
  type PartnerRow,
  type PartnerSort,
  type PartnerStatusFilter,
  type PartnersSummary,
} from "../../api/client";
import { useAppSelector } from "../../store/hooks";
import { errorMessage } from "../../util/error";

/* ---------- tokens (same set as Finance.tsx) ---------- */
const NAVY = "var(--nuru-navy)";
const MUTED = "var(--muted-foreground)";
const BORDER = "var(--border)";
const SURFACE = "var(--secondary)";
const DISPLAY = "var(--font-display)";
const MONO = "var(--font-mono)";

/* ---------- helpers ---------- */
// The portal's money format: integer minor units → "KES 12,345" (no floats,
// no decimals — same helper Finance/Dashboard keep locally).
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
const shortRef = (id: string): string => (id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id);
const titleCase = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : "—");

/* ---------- chips ---------- */
type Chip = { label: string; bg: string; color: string };
const CHIP_GREEN: Omit<Chip, "label"> = { bg: "#E8F6EC", color: "#0F6B33" };
const CHIP_AMBER: Omit<Chip, "label"> = { bg: "#FFF4DA", color: "#A87616" };
const CHIP_GREY: Omit<Chip, "label"> = { bg: "#EEF0F3", color: "#6B7280" };
const CHIP_VIOLET: Omit<Chip, "label"> = { bg: "#F3EAFE", color: "#7C3AED" };
const CHIP_ROSE: Omit<Chip, "label"> = { bg: "#FDECEC", color: "#B42318" };

// Row standing: "behind" (server flag) wins in the warning tone; otherwise the
// membership status. A partner who has left is shown, not hidden — the office
// still needs their statement.
function rowChip(r: PartnerRow): Chip {
  if (r.behind) return { label: "Behind", ...CHIP_AMBER };
  switch (r.membership?.status) {
    case "active":
      return { label: "Active", ...CHIP_GREEN };
    case "paused":
      return { label: "Paused", ...CHIP_GREY };
    case "left":
      return { label: "Left", ...CHIP_ROSE };
    default:
      return { label: "—", ...CHIP_GREY };
  }
}

// Server progress labels (§1): on track · behind · fulfilled · paused.
function progressChip(label: string): Chip {
  const k = label.trim().toLowerCase();
  if (k === "behind") return { label: "Behind", ...CHIP_AMBER };
  if (k === "fulfilled") return { label: "Fulfilled", ...CHIP_VIOLET };
  if (k === "paused") return { label: "Paused", ...CHIP_GREY };
  if (k === "on track" || k === "on_track") return { label: "On track", ...CHIP_GREEN };
  return { label: titleCase(label), ...CHIP_GREY };
}

const pledgeStatusChip: Record<PartnerPledge["status"], Chip> = {
  active: { label: "Active", ...CHIP_GREEN },
  paused: { label: "Paused", ...CHIP_GREY },
  fulfilled: { label: "Fulfilled", ...CHIP_VIOLET },
  cancelled: { label: "Cancelled", ...CHIP_ROSE },
};

const scheduleStatusChip: Record<string, Chip> = {
  active: { label: "Active", ...CHIP_GREEN },
  paused: { label: "Paused", ...CHIP_AMBER },
  cancelled: { label: "Cancelled", ...CHIP_GREY },
};

/* ---------- filters ---------- */
const STATUS_FILTERS: { label: string; value: PartnerStatusFilter }[] = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Paused", value: "paused" },
  { label: "Behind", value: "behind" },
  { label: "Left", value: "left" },
];
const SORTS: { label: string; value: PartnerSort }[] = [
  { label: "Recent", value: "recent" },
  { label: "Committed", value: "committed" },
  { label: "Behind first", value: "behind" },
];

const PHASE2_TIP = "Coming in phase 2 — reminders are sent by the notification worker for now.";

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

// A disabled action with a tooltip. The span carries the title because a
// disabled <button> does not receive hover events in every browser.
function DisabledAction({ icon, label, tip, dark = false }: { icon: ReactNode; label: string; tip: string; dark?: boolean }): ReactElement {
  return (
    <span title={tip} style={{ display: "inline-flex", cursor: "not-allowed" }}>
      <button
        type="button"
        disabled
        aria-disabled="true"
        className="flex items-center gap-2 rounded-lg px-3"
        style={{
          height: 32,
          background: dark ? "rgba(255,255,255,0.08)" : "var(--card)",
          color: dark ? "#fff" : NAVY,
          border: dark ? "1px solid rgba(255,255,255,0.15)" : `1px solid ${BORDER}`,
          fontSize: 12,
          fontWeight: 600,
          opacity: 0.5,
          pointerEvents: "none",
        }}
      >
        {icon} {label}
      </button>
    </span>
  );
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

/* ====================================================================== */
export function Partners(): ReactElement {
  const { permissions } = useAppSelector((s) => s.auth);
  // finance:manage gates the actions; null (not loaded yet) = no actions.
  const canManage = permissions?.includes("finance:manage") ?? false;

  const [rows, setRows] = useState<PartnerRow[]>([]);
  const [summary, setSummary] = useState<PartnersSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // filters — all three are server-side (§5: ?q=&status=&sort=)
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<PartnerStatusFilter>("all");
  const [sort, setSort] = useState<PartnerSort>("recent");

  // detail drawer — `?partner=<user_id>` so a partner can be linked to.
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("partner");
  const [detail, setDetail] = useState<PartnerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Out-of-order guard: only the latest request may land.
  const listSeq = useRef(0);
  const loadList = useCallback(async () => {
    const seq = ++listSeq.current;
    setLoading(true);
    try {
      const q: { q?: string; status?: PartnerStatusFilter; sort?: PartnerSort } = { sort };
      if (debouncedSearch) q.q = debouncedSearch;
      if (status !== "all") q.status = status;
      const r = await PartnersApi.list(q);
      if (seq !== listSeq.current) return;
      setRows(r.data);
      setSummary(r.summary);
      setError(null);
    } catch (e) {
      if (seq !== listSeq.current) return;
      setError(errorMessage(e, "Could not load partners."));
    } finally {
      if (seq === listSeq.current) setLoading(false);
    }
  }, [debouncedSearch, status, sort]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    let live = true;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    PartnersApi.detail(selectedId)
      .then((d) => {
        if (live) setDetail(d);
      })
      .catch((e) => {
        if (live) setDetailError(errorMessage(e, "Could not load this partner."));
      })
      .finally(() => {
        if (live) setDetailLoading(false);
      });
    return () => {
      live = false;
    };
  }, [selectedId]);

  const openPartner = useCallback(
    (userId: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("partner", userId);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const closePartner = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("partner");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const filtersActive = debouncedSearch !== "" || status !== "all";

  const tiles = useMemo(
    () => [
      { label: "Partners", value: summary ? String(summary.partners) : "—", hint: "in the programme", icon: <Users size={13} /> },
      { label: "Active pledges", value: summary ? String(summary.active_pledges) : "—", hint: "monthly + total", icon: <Target size={13} /> },
      { label: "Committed / month", value: summary ? money(summary.committed_monthly_minor, null) : "—", hint: "across monthly pledges", icon: <Wallet size={13} /> },
      { label: "Behind", value: summary ? String(summary.behind) : "—", hint: "partners past due", icon: <AlertTriangle size={13} />, warn: summary ? summary.behind > 0 : false },
      { label: "Given this year", value: summary ? money(summary.given_year_minor, null) : "—", hint: "attributed to pledges", icon: <Receipt size={13} /> },
    ],
    [summary],
  );

  return (
    <div className="min-h-full" style={{ background: "var(--background)" }}>
      {/* hero */}
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px,4vw,48px) 24px" }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}>
            <span>Operations</span>
            <ChevronRight size={10} />
            <span style={{ color: "#fff", fontWeight: 600 }}>Partners</span>
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
              <HandHeart size={11} /> {summary ? `${summary.partners} ${summary.partners === 1 ? "partner" : "partners"}` : "Partners programme"}
            </span>
            {canManage ? <DisabledAction dark icon={<Send size={13} />} label="Remind everyone behind" tip={PHASE2_TIP} /> : null}
          </div>
        </div>
        <h1 style={{ fontFamily: DISPLAY, color: "#fff", fontSize: 24, lineHeight: 1.05, marginTop: 16, letterSpacing: "-0.015em" }}>Partners</h1>
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

      <div style={{ padding: "24px clamp(16px,4vw,48px) 48px" }}>
        {error ? <p style={{ color: "#A8281F", marginBottom: 12 }}>{error}</p> : null}

        <Card style={{ overflow: "hidden" }}>
          <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
            <div>
              <div className="nuru-section-title">Partners</div>
              <div style={{ fontSize: 12, color: MUTED }}>Everyone who joined the programme, what they committed, and whether they are behind.</div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div style={{ position: "relative" }}>
                <Search size={14} color="#6B7280" style={{ position: "absolute", left: 10, top: 10 }} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, phone, email, cell"
                  style={{ height: 34, padding: "0 12px 0 30px", background: "var(--input-background)", border: `1px solid ${BORDER}`, borderRadius: 10, width: 260, fontSize: 13 }}
                />
              </div>
              <select value={status} onChange={(e) => setStatus(e.target.value as PartnerStatusFilter)} style={selectStyle} aria-label="Status">
                {STATUS_FILTERS.map((s) => (
                  <option key={s.value} value={s.value}>
                    Status: {s.label}
                  </option>
                ))}
              </select>
              <select value={sort} onChange={(e) => setSort(e.target.value as PartnerSort)} style={selectStyle} aria-label="Sort">
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    Sort: {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full" style={{ borderCollapse: "collapse", minWidth: 960 }}>
              <thead>
                <tr style={{ background: SURFACE }}>
                  <th style={thStyle}>Member</th>
                  <th style={thStyle}>Tier</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Committed / month</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Pledges</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Given this year</th>
                  <th style={thStyle}>Last gift</th>
                  <th style={thStyle}>Next due</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const chip = rowChip(r);
                  return (
                    <tr
                      key={r.user_id}
                      onClick={() => openPartner(r.user_id)}
                      className="cursor-pointer transition-colors hover:bg-[var(--input-background)]"
                      style={{ borderTop: `1px solid ${BORDER}`, background: i % 2 === 1 ? "rgba(238,240,243,0.4)" : "transparent" }}
                    >
                      <td style={tdStyle}>
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar name={r.full_name} url={r.avatar_url} seed={i} />
                          <div className="min-w-0">
                            <div style={{ fontSize: 13.5, fontWeight: 700, color: NAVY, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.full_name}</div>
                            <div style={{ fontSize: 11.5, color: MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.cell_name ?? "No cell yet"}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                        {r.tier ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span style={{ fontWeight: 600 }}>{r.tier.name}</span>
                            <span style={{ fontSize: 11, color: MUTED, fontFamily: MONO }}>{money(r.tier.monthly_minor, null)}</span>
                          </span>
                        ) : (
                          <span style={{ color: MUTED }}>—</span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: MONO, fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }}>{money(r.committed_monthly_minor, null)}</td>
                      <td style={{ ...tdStyle, fontFamily: MONO, textAlign: "right" }}>{r.pledges_active}</td>
                      <td style={{ ...tdStyle, fontFamily: MONO, textAlign: "right", whiteSpace: "nowrap" }}>{money(r.given_year_minor, null)}</td>
                      <td style={{ ...tdStyle, fontFamily: MONO, fontSize: 12, whiteSpace: "nowrap" }}>{fmtDate(r.last_gift_at)}</td>
                      <td style={{ ...tdStyle, fontFamily: MONO, fontSize: 12, whiteSpace: "nowrap", color: r.behind ? "#A87616" : NAVY }}>{fmtDate(r.next_due_on)}</td>
                      <td style={tdStyle}>
                        <Pill chip={chip} />
                      </td>
                    </tr>
                  );
                })}
                {loading && rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: "24px 16px", textAlign: "center", fontSize: 13, color: MUTED }}>
                      Loading partners…
                    </td>
                  </tr>
                ) : null}
                {!loading && rows.length === 0 && !error ? (
                  <tr>
                    <td colSpan={8} style={{ padding: 0 }}>
                      <div className="text-center py-12" style={{ borderTop: `1px dashed ${BORDER}` }}>
                        <p style={{ fontSize: 14, color: MUTED }}>
                          {filtersActive ? "No partners match those filters." : "No partners yet — members join from Give → Partners in the app."}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {selectedId ? (
        <PartnerDrawer detail={detail} loading={detailLoading} error={detailError} canManage={canManage} onClose={closePartner} />
      ) : null}
    </div>
  );
}

/* ====================== DRAWER ====================== */
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
          width: "min(640px, 100vw)",
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
        {footer ? <div style={{ borderTop: `1px solid ${BORDER}`, padding: 16, display: "flex", gap: 8, justifyContent: "flex-end" }}>{footer}</div> : null}
      </div>
    </div>
  );
}

function SectionTitle({ children, caption }: { children: ReactNode; caption?: string }): ReactElement {
  return (
    <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
      <div style={{ fontFamily: DISPLAY, fontSize: 16, color: NAVY }}>{children}</div>
      {caption ? <span style={{ marginLeft: "auto", fontSize: 11, color: MUTED }}>{caption}</span> : null}
    </div>
  );
}

function PartnerDrawer({
  detail,
  loading,
  error,
  canManage,
  onClose,
}: {
  detail: PartnerDetail | null;
  loading: boolean;
  error: string | null;
  canManage: boolean;
  onClose: () => void;
}): ReactElement {
  const cellStyle: CSSProperties = { padding: 12, background: "var(--input-background)", borderRadius: 10 };
  const labelStyle: CSSProperties = { fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600, marginBottom: 6 };

  if (loading || (!detail && !error)) {
    return (
      <DrawerShell title="Partner" onClose={onClose}>
        <p style={{ fontSize: 13, color: MUTED }}>Loading partner…</p>
      </DrawerShell>
    );
  }
  if (!detail) {
    return (
      <DrawerShell title="Partner" onClose={onClose}>
        <p style={{ fontSize: 13, color: "#A8281F" }}>{error}</p>
      </DrawerShell>
    );
  }

  const m = detail.member;
  const chip = rowChip(m);
  // Pledge label lookup for the payments + reminders tables.
  const pledgeLabel = new Map<string, string>(detail.pledges.map((p) => [p.pledge_id, pledgeShortLabel(p)]));
  // Dominant currency for the row-level minor amounts (they carry none).
  const currency = detail.pledges[0]?.currency ?? detail.payments[0]?.currency ?? null;

  return (
    <DrawerShell
      title="Partner"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} style={{ padding: "9px 14px", border: `1px solid ${BORDER}`, background: "var(--card)", borderRadius: 10, fontSize: 13, fontWeight: 600, color: NAVY }}>
            Close
          </button>
          {canManage ? <DisabledAction icon={<Send size={13} />} label="Send reminder" tip={PHASE2_TIP} /> : null}
        </>
      }
    >
      {/* member header */}
      <div className="flex items-start gap-3">
        <Avatar name={m.full_name} url={m.avatar_url} seed={0} size={52} />
        <div className="min-w-0" style={{ flex: 1 }}>
          <div className="flex items-center gap-2 flex-wrap">
            <span style={{ fontSize: 17, color: NAVY, fontWeight: 700 }}>{m.full_name}</span>
            <Pill chip={chip} />
            {m.tier ? <Pill chip={{ label: `${m.tier.name} · ${money(m.tier.monthly_minor, currency)}/mo`, bg: "#FDF5E5", color: "#8A6B1F" }} /> : null}
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>{[m.cell_name ?? "No cell yet", m.phone, m.email].filter(Boolean).join(" · ")}</div>
        </div>
      </div>

      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <div style={cellStyle}>
          <div style={labelStyle}>Partner since</div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: NAVY }}>{fmtDate(m.membership?.joined_at ?? null)}</div>
        </div>
        <div style={cellStyle}>
          <div style={labelStyle}>Committed / month</div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: NAVY, fontWeight: 700 }}>{money(m.committed_monthly_minor, currency)}</div>
        </div>
        <div style={cellStyle}>
          <div style={labelStyle}>Given this year</div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: NAVY, fontWeight: 700 }}>{money(m.given_year_minor, currency)}</div>
        </div>
        <div style={cellStyle}>
          <div style={labelStyle}>Active pledges</div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: NAVY }}>{m.pledges_active}</div>
        </div>
        <div style={cellStyle}>
          <div style={labelStyle}>Last gift</div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: NAVY }}>{fmtDate(m.last_gift_at)}</div>
        </div>
        <div style={cellStyle}>
          <div style={labelStyle}>Next due</div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: m.behind ? "#A87616" : NAVY }}>{fmtDate(m.next_due_on)}</div>
        </div>
      </div>

      {/* pledges */}
      <div style={{ marginTop: 22 }}>
        <SectionTitle caption={`${detail.pledges.length} ${detail.pledges.length === 1 ? "pledge" : "pledges"}`}>Pledges</SectionTitle>
        {detail.pledges.length === 0 ? (
          <div className="rounded-xl text-center py-6" style={{ border: `1px dashed ${BORDER}`, fontSize: 12.5, color: MUTED }}>
            Joined the programme without a pledge yet.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {detail.pledges.map((p) => (
              <PledgeCard key={p.pledge_id} pledge={p} />
            ))}
          </div>
        )}
      </div>

      {/* schedules */}
      <div style={{ marginTop: 22 }}>
        <SectionTitle caption="giving_schedules">Schedules</SectionTitle>
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, overflow: "hidden", overflowX: "auto" }}>
          <table className="w-full" style={{ borderCollapse: "collapse", minWidth: 560 }}>
            <thead>
              <tr style={{ background: SURFACE }}>
                {["Fund", "Amount", "Frequency", "Method", "Status", "Next run", "Failures"].map((h) => (
                  <th key={h} style={{ ...thStyle, padding: "8px 12px" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.schedules.map((s) => (
                <ScheduleRow key={s.schedule_id} s={s} />
              ))}
              {detail.schedules.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: "16px 12px", textAlign: "center", fontSize: 12.5, color: MUTED }}>
                    No recurring schedule — gifts are made by hand.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* payments */}
      <div style={{ marginTop: 22 }}>
        <SectionTitle caption={`${detail.payments.length} ${detail.payments.length === 1 ? "payment" : "payments"}`}>Payments</SectionTitle>
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, overflow: "hidden", overflowX: "auto" }}>
          <table className="w-full" style={{ borderCollapse: "collapse", minWidth: 560 }}>
            <thead>
              <tr style={{ background: SURFACE }}>
                {["Date", "Fund", "Amount", "Pledge", "Receipt"].map((h) => (
                  <th key={h} style={{ ...thStyle, padding: "8px 12px", textAlign: h === "Amount" ? "right" : "left" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.payments.map((t) => (
                <tr key={t.transaction_id} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td style={{ padding: "8px 12px", fontSize: 12, fontFamily: MONO, color: NAVY, whiteSpace: "nowrap" }}>{fmtDate(t.at)}</td>
                  <td style={{ padding: "8px 12px", fontSize: 12.5, color: NAVY }}>{t.fund || "—"}</td>
                  <td style={{ padding: "8px 12px", fontSize: 12.5, fontFamily: MONO, color: NAVY, fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }}>{money(t.amount_minor, t.currency)}</td>
                  <td style={{ padding: "8px 12px", fontSize: 12, color: t.pledge_id ? NAVY : MUTED }}>{t.pledge_id ? pledgeLabel.get(t.pledge_id) ?? shortRef(t.pledge_id) : "Unattributed"}</td>
                  <td style={{ padding: "8px 12px", fontSize: 12, fontFamily: MONO, color: NAVY, whiteSpace: "nowrap" }}>{t.receipt_code ?? "—"}</td>
                </tr>
              ))}
              {detail.payments.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: "16px 12px", textAlign: "center", fontSize: 12.5, color: MUTED }}>
                    No payments attributed to a pledge yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* reminders */}
      <div style={{ marginTop: 22 }}>
        <SectionTitle caption="§3 — 3 days before, then 12 h apart">Reminders sent</SectionTitle>
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, overflow: "hidden", overflowX: "auto" }}>
          <table className="w-full" style={{ borderCollapse: "collapse", minWidth: 560 }}>
            <thead>
              <tr style={{ background: SURFACE }}>
                {["Due", "Pledge", "#", "Channel", "Sent", "By"].map((h) => (
                  <th key={h} style={{ ...thStyle, padding: "8px 12px" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.reminders.map((r) => (
                <tr key={`${r.pledge_id}:${r.due_on}:${r.sequence}`} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td style={{ padding: "8px 12px", fontSize: 12, fontFamily: MONO, color: NAVY, whiteSpace: "nowrap" }}>{fmtDate(r.due_on)}</td>
                  <td style={{ padding: "8px 12px", fontSize: 12, color: NAVY }}>{pledgeLabel.get(r.pledge_id) ?? shortRef(r.pledge_id)}</td>
                  <td style={{ padding: "8px 12px", fontSize: 12, fontFamily: MONO, color: NAVY }}>{r.sequence}</td>
                  <td style={{ padding: "8px 12px", fontSize: 12, color: NAVY }}>{titleCase(r.channel)}</td>
                  <td style={{ padding: "8px 12px", fontSize: 12, fontFamily: MONO, color: NAVY, whiteSpace: "nowrap" }}>{fmtDateTime(r.sent_at)}</td>
                  <td style={{ padding: "8px 12px", fontSize: 12, color: r.sent_by ? NAVY : MUTED }}>{r.sent_by ?? "Automatic"}</td>
                </tr>
              ))}
              {detail.reminders.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: "16px 12px", textAlign: "center", fontSize: 12.5, color: MUTED }}>
                    No reminders sent.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </DrawerShell>
  );
}

/* ---------- pledge card ---------- */
function pledgeTarget(p: PartnerPledge): string {
  if (p.fund) return p.fund.name;
  if (p.campaign) return p.campaign.title;
  return "General partnership";
}
function pledgeShortLabel(p: PartnerPledge): string {
  return `${p.shape === "monthly" ? "Monthly" : "Total"} · ${pledgeTarget(p)}`;
}

function PledgeCard({ pledge: p }: { pledge: PartnerPledge }): ReactElement {
  // Progress (§1): monthly = paid this period vs amount; total = paid vs target.
  // Both numbers come from the server; the bar only draws the ratio.
  const denom = p.shape === "monthly" ? p.amount_minor : p.target_minor;
  const paid = p.shape === "monthly" ? p.progress.period_paid_minor : p.progress.paid_minor;
  const ratio = denom && denom > 0 ? Math.max(0, Math.min(1, paid / denom)) : 0;
  const prog = progressChip(p.progress.label);
  const barColor = prog.label === "Behind" ? "#C89B3C" : prog.label === "Fulfilled" ? "#7C3AED" : "#16A34A";
  const status = pledgeStatusChip[p.status];
  const nextDue = p.progress.next_due ?? (p.shape === "total" ? p.due_on : null);
  const terms =
    p.shape === "monthly"
      ? `${money(p.amount_minor, p.currency)} every month${p.due_day ? ` · due day ${p.due_day}` : ""}`
      : `${money(p.target_minor, p.currency)} by ${fmtDate(p.due_on)}`;

  return (
    <div className="rounded-xl" style={{ border: `1px solid ${BORDER}`, padding: 14, background: "var(--card)" }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5" style={{ fontSize: 13.5, fontWeight: 700, color: NAVY }}>
              {p.shape === "monthly" ? <Repeat size={13} /> : <Target size={13} />}
              {p.shape === "monthly" ? "Monthly pledge" : "Total pledge"}
            </span>
            <Pill chip={status} />
            <Pill chip={prog} />
          </div>
          <div style={{ fontSize: 12.5, color: NAVY, marginTop: 4 }}>{terms}</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{pledgeTarget(p)}</div>
        </div>
        <div className="flex flex-col items-end gap-1" style={{ fontSize: 11.5, color: MUTED }}>
          <span className="inline-flex items-center gap-1" style={{ color: p.reminders_enabled ? NAVY : MUTED }}>
            {p.reminders_enabled ? <Bell size={12} /> : <BellOff size={12} />}
            {p.reminders_enabled ? "Reminders on" : "Reminders off"}
          </span>
          {p.schedule_id ? (
            <span className="inline-flex items-center gap-1" style={{ color: "#0F6B33" }}>
              <Repeat size={12} /> Auto-charged
            </span>
          ) : null}
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="flex items-center justify-between" style={{ fontSize: 11.5, color: MUTED, marginBottom: 5 }}>
          <span style={{ fontFamily: MONO, color: NAVY }}>
            {money(paid, p.currency)} <span style={{ color: MUTED }}>of {money(denom, p.currency)}</span>
            {p.shape === "monthly" ? " this month" : ""}
          </span>
          <span style={{ fontFamily: MONO }}>{Math.round(ratio * 100)}%</span>
        </div>
        <div style={{ height: 8, background: "#EEF0F3", borderRadius: 999, overflow: "hidden" }} aria-hidden="true">
          <div style={{ width: `${Math.round(ratio * 100)}%`, height: "100%", background: barColor, borderRadius: 999, transition: "width 200ms" }} />
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap" style={{ marginTop: 10, fontSize: 11.5, color: MUTED }}>
        <span className="inline-flex items-center gap-1">
          <CalendarClock size={12} /> Next due <span style={{ fontFamily: MONO, color: prog.label === "Behind" ? "#A87616" : NAVY }}>{fmtDate(nextDue)}</span>
        </span>
        <span>
          All time <span style={{ fontFamily: MONO, color: NAVY }}>{money(p.progress.paid_minor, p.currency)}</span>
        </span>
        <span>
          Since <span style={{ fontFamily: MONO, color: NAVY }}>{fmtDate(p.created_at)}</span>
        </span>
      </div>
    </div>
  );
}

function ScheduleRow({ s }: { s: AdminScheduleRow }): ReactElement {
  const chip = scheduleStatusChip[s.status] ?? { label: titleCase(s.status), ...CHIP_GREY };
  return (
    <tr style={{ borderTop: `1px solid ${BORDER}`, background: s.needs_attention ? "rgba(255,244,218,0.45)" : "transparent" }}>
      <td style={{ padding: "8px 12px", fontSize: 12.5, color: NAVY, fontWeight: 600 }}>{s.fund}</td>
      <td style={{ padding: "8px 12px", fontSize: 12.5, fontFamily: MONO, color: NAVY, whiteSpace: "nowrap" }}>{money(s.amount_minor, s.currency)}</td>
      <td style={{ padding: "8px 12px", fontSize: 12, color: NAVY }}>{titleCase(s.frequency)}</td>
      <td style={{ padding: "8px 12px", fontSize: 12, color: NAVY }}>{s.method ? titleCase(s.method) : "—"}</td>
      <td style={{ padding: "8px 12px" }}>
        <Pill chip={chip} />
      </td>
      <td style={{ padding: "8px 12px", fontSize: 12, fontFamily: MONO, color: NAVY, whiteSpace: "nowrap" }}>{fmtDateTime(s.next_run_at)}</td>
      <td style={{ padding: "8px 12px", fontSize: 12, fontFamily: MONO, color: s.consecutive_failures > 0 ? "#B42318" : NAVY }} title={s.last_error ?? undefined}>
        {s.consecutive_failures}
      </td>
    </tr>
  );
}
