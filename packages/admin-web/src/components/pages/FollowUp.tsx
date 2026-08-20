// Follow-up — the administration side of church attendance.
//
// The check-in flow in the member apps answers "was this person here?". This
// page answers the questions a pastoral team acts on: who came, who didn't, who
// is slipping, and who to call before next Sunday.
//
// THE ABSENTEE LIST IS THE POINT. A roster of who attended is easy and half the
// story; the list nobody has today is the one of people who did NOT come, with a
// phone number beside each name. So the default tab is Members ordered by
// longest current absence — the ordering IS the queue — and the Absent tab is a
// per-service call sheet.
//
// Numbers here are computed by the same streak walk the member app shows
// (backend attendance/streak.ts), so a leader and a member never see two
// different figures for the same person.
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import {
  Users, CalendarDays, PhoneCall, ScanLine, Flame, AlertTriangle, CircleSlash,
  Download, Loader2, type LucideIcon,
} from "lucide-react";
import {
  FollowUpApi,
  type Absentee,
  type AttendanceYearOverview,
  type FollowUpDueStep,
  type FollowUpMember,
  type FollowUpOutcome,
  type ServiceAttendanceSummary,
  type ServiceScanLogEntry,
} from "../../api/client";

const NAVY = "#1d4e86";
const NAVY_INK = "#0b1f33";
const GOLD = "#c89b3c";
const GREEN = "#22c55e";
const AMBER = "#d97706";
const RED = "#dc2626";
const MUTED = "#5c6b80";

const SHADOW = "0 1px 3px rgba(11,31,51,0.06), 0 1px 2px rgba(11,31,51,0.04)";
const card = (pad = 16): React.CSSProperties => ({
  background: "#fff", border: "1px solid var(--border)", borderRadius: 16, padding: pad, boxShadow: SHADOW,
});

const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";

/** Status → how it reads and what colour it carries. */
const STATUS: Record<FollowUpMember["status"], { label: string; color: string; bg: string }> = {
  active: { label: "Attending", color: "#166534", bg: "#dcfce7" },
  at_risk: { label: "Missed last", color: "#92400e", bg: "#fef3c7" },
  broken: { label: "Slipping", color: "#991b1b", bg: "#fee2e2" },
  new: { label: "Never attended", color: "#475569", bg: "#f1f5f9" },
};

type Tab = "due" | "members" | "scans" | "services" | "absent";

export function FollowUp(): ReactElement {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [tab, setTab] = useState<Tab>("due");

  const [overview, setOverview] = useState<AttendanceYearOverview | null>(null);
  const [members, setMembers] = useState<FollowUpMember[] | null>(null);
  const [scans, setScans] = useState<ServiceScanLogEntry[] | null>(null);
  const [services, setServices] = useState<ServiceAttendanceSummary[] | null>(null);
  const [absent, setAbsent] = useState<{ service: ServiceAttendanceSummary; absentees: Absentee[] } | null>(null);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [dueSteps, setDueSteps] = useState<FollowUpDueStep[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [due, o, m, sc, sv] = await Promise.all([
        FollowUpApi.due(200),
        FollowUpApi.overview(year),
        FollowUpApi.members({ year }),
        FollowUpApi.scans({ limit: 200 }),
        FollowUpApi.services(year),
      ]);
      setDueSteps(due);
      setOverview(o);
      setMembers(m);
      setScans(sc);
      setServices(sv);
      // Default the absentee view to the most recent service — the one a team
      // is actually following up on this week.
      setSelectedService((prev) => prev ?? sv[0]?.service_id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load follow-up.");
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedService) return;
    let cancelled = false;
    void FollowUpApi.absentees(selectedService)
      .then((r) => {
        if (!cancelled) setAbsent(r);
      })
      .catch(() => {
        if (!cancelled) setAbsent(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedService]);

  const shownMembers = useMemo(() => {
    let rows = members ?? [];
    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          r.full_name.toLowerCase().includes(q) ||
          (r.phone_number ?? "").includes(q) ||
          (r.email ?? "").toLowerCase().includes(q),
      );
    }
    return rows;
  }, [members, statusFilter, search]);

  if (loading && !overview) {
    return (
      <div style={{ display: "grid", placeItems: "center", padding: 80, color: MUTED }}>
        <Loader2 size={22} style={{ animation: "spin 1s linear infinite" }} />
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ margin: 0, fontSize: 22, color: NAVY_INK }}>Follow-up</h1>
          <p style={{ margin: "4px 0 0", color: MUTED, fontSize: 13 }}>
            Who came, who didn&apos;t, and who to call. Every scan is logged with the
            details the member registered at the door.
          </p>
        </div>
        <YearPicker year={year} thisYear={thisYear} onChange={setYear} />
      </header>

      {error && (
        <div style={{ ...card(12), borderColor: "#fecaca", background: "#fef2f2", color: "#991b1b", fontSize: 13 }}>
          {error}
        </div>
      )}

      {overview && (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <Stat icon={CalendarDays} label="Sundays held" value={overview.sundays_held}
            hint={`${overview.services_held} services in all`} color={NAVY} />
          <Stat icon={ScanLine} label="Service check-ins" value={overview.total_check_ins}
            hint={`${overview.members_attended} of ${overview.members} members`} color={GOLD} />
          <Stat icon={CalendarDays} label="Event check-ins" value={overview.total_event_check_ins}
            hint="cell gatherings & one-offs" color={NAVY} />
          <Stat icon={AlertTriangle} label="Missed last service" value={overview.members_at_risk}
            hint="one absence" color={AMBER} />
          <Stat icon={CircleSlash} label="Slipping" value={overview.members_broken}
            hint="two or more in a row" color={RED} />
          <Stat icon={Users} label="Never attended" value={overview.members_never_attended}
            hint="on the roll, not yet seen" color={MUTED} />
        </div>
      )}

      <nav style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {([
          ["due", "To call", (dueSteps ?? []).length],
          ["members", "Members", (members ?? []).length],
          ["absent", "Absent", absent?.absentees.length ?? 0],
          ["scans", "Scan log", (scans ?? []).length],
          ["services", "Services", (services ?? []).length],
        ] as const).map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: "8px 14px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer",
              border: `1px solid ${tab === key ? NAVY : "var(--border)"}`,
              background: tab === key ? NAVY : "#fff",
              color: tab === key ? "#fff" : NAVY_INK,
            }}
          >
            {label} <span style={{ opacity: 0.65 }}>{count}</span>
          </button>
        ))}
      </nav>

      {tab === "due" && (
        <DueTab
          rows={dueSteps ?? []}
          onRecorded={() => void load()}
        />
      )}

      {tab === "members" && (
        <MembersTab
          rows={shownMembers}
          statusFilter={statusFilter}
          onStatus={setStatusFilter}
          search={search}
          onSearch={setSearch}
        />
      )}
      {tab === "absent" && (
        <AbsentTab
          services={services ?? []}
          selected={selectedService}
          onSelect={setSelectedService}
          report={absent}
        />
      )}
      {tab === "scans" && <ScanLogTab rows={scans ?? []} />}
      {tab === "services" && <ServicesTab rows={services ?? []} onOpenAbsentees={(id) => { setSelectedService(id); setTab("absent"); }} />}
    </div>
  );
}

// ── Members: the follow-up queue, worst first ───────────────────────────────

function MembersTab(props: {
  rows: FollowUpMember[];
  statusFilter: string;
  onStatus: (s: string) => void;
  search: string;
  onSearch: (s: string) => void;
}): ReactElement {
  const { rows, statusFilter, onStatus, search, onSearch } = props;
  return (
    <section style={card(0)}>
      <div style={{ display: "flex", gap: 8, padding: 12, borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search name, phone or email…"
          style={{ flex: 1, minWidth: 200, padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", fontSize: 13 }}
        />
        <select
          value={statusFilter}
          onChange={(e) => onStatus(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", fontSize: 13 }}
        >
          <option value="">All statuses</option>
          <option value="broken">Slipping</option>
          <option value="at_risk">Missed last</option>
          <option value="active">Attending</option>
          <option value="new">Never attended</option>
        </select>
        <CsvButton
          rows={rows}
          filename="follow-up-members.csv"
          columns={[
            ["Name", (r) => r.full_name],
            ["Phone", (r) => r.phone_number ?? ""],
            ["Email", (r) => r.email ?? ""],
            ["Status", (r) => STATUS[r.status].label],
            ["Services attended", (r) => String(r.attended_this_year)],
            ["Services missed", (r) => String(r.missed_this_year)],
            ["Events attended", (r) => String(r.events_attended_this_year)],
            ["Current streak", (r) => String(r.current_streak)],
            ["Consecutive misses", (r) => String(r.current_miss_run)],
            ["Last attended", (r) => r.last_attended_at ?? ""],
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <Empty text="Nobody matches those filters." />
      ) : (
        <Table
          head={["Member", "Contact", "Services", "Missed", "Events", "Streak", "Last seen", "Status"]}
          rows={rows.map((r) => ({
            key: r.user_id,
            cells: [
              <NameCell key="n" name={r.full_name} sub={r.registered_name && r.registered_name !== r.full_name
                ? `registered as ${r.registered_name}` : null} />,
              <ContactCell key="c" phone={r.registered_phone ?? r.phone_number} email={r.registered_email ?? r.email} />,
              <strong key="a" style={{ color: NAVY_INK }}>{r.attended_this_year}</strong>,
              <span key="m" style={{ color: r.missed_this_year > 0 ? RED : MUTED }}>{r.missed_this_year}</span>,
              <span key="e" style={{ color: MUTED }}>{r.events_attended_this_year}</span>,
              <StreakCell key="s" current={r.current_streak} longest={r.longest_streak} missRun={r.current_miss_run} />,
              <span key="l" style={{ color: MUTED, fontSize: 12 }}>{r.last_attended_at ? shortDate(r.last_attended_at) : "—"}</span>,
              <Pill key="p" {...STATUS[r.status]} />,
            ],
          }))}
        />
      )}
    </section>
  );
}

// ── Absent: the per-service call sheet ─────────────────────────────────────

function AbsentTab(props: {
  services: ServiceAttendanceSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
  report: { service: ServiceAttendanceSummary; absentees: Absentee[] } | null;
}): ReactElement {
  const { services, selected, onSelect, report } = props;
  if (services.length === 0) return <Empty text="No services have been held yet this year." boxed />;

  return (
    <section style={card(0)}>
      <div style={{ display: "flex", gap: 8, padding: 12, borderBottom: "1px solid var(--border)", flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={selected ?? ""}
          onChange={(e) => onSelect(e.target.value)}
          style={{ flex: 1, minWidth: 220, padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", fontSize: 13 }}
        >
          {services.map((s) => (
            <option key={s.service_id} value={s.service_id}>
              {s.title} · {s.service_date}
            </option>
          ))}
        </select>
        {report && (
          <>
            <span style={{ fontSize: 13, color: MUTED }}>
              <strong style={{ color: NAVY_INK }}>{report.service.attended}</strong> attended ·{" "}
              <strong style={{ color: RED }}>{report.service.absent}</strong> absent
            </span>
            <CsvButton
              rows={report.absentees}
              filename={`absentees-${report.service.service_date}.csv`}
              columns={[
                ["Name", (r) => r.full_name],
                ["Phone", (r) => r.phone_number ?? ""],
                ["Email", (r) => r.email ?? ""],
                ["Consecutive misses", (r) => String(r.current_miss_run)],
                ["Last attended", (r) => r.last_attended_at ?? ""],
                ["Never attended", (r) => (r.never_attended ? "yes" : "no")],
              ]}
            />
          </>
        )}
      </div>
      {!report ? (
        <Empty text="Loading…" />
      ) : report.absentees.length === 0 ? (
        <Empty text="Everyone on the roll checked in. 🎉" />
      ) : (
        <Table
          head={["Member", "Contact", "Missed in a row", "Last seen", ""]}
          rows={report.absentees.map((a) => ({
            key: a.user_id,
            cells: [
              <NameCell key="n" name={a.full_name} sub={a.never_attended ? "never attended" : null} />,
              <ContactCell key="c" phone={a.phone_number} email={a.email} />,
              <span key="m" style={{ fontWeight: 700, color: a.current_miss_run >= 2 ? RED : AMBER }}>
                {a.current_miss_run}
              </span>,
              <span key="l" style={{ color: MUTED, fontSize: 12 }}>{a.last_attended_at ? shortDate(a.last_attended_at) : "—"}</span>,
              a.phone_number ? (
                <a key="t" href={`tel:${a.phone_number}`} style={{
                  display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600,
                  color: NAVY, textDecoration: "none", border: `1px solid ${NAVY}`, borderRadius: 999, padding: "4px 10px",
                }}>
                  <PhoneCall size={12} /> Call
                </a>
              ) : (
                <span key="t" style={{ color: MUTED, fontSize: 12 }}>no number</span>
              ),
            ],
          }))}
        />
      )}
    </section>
  );
}

// ── Scan log ────────────────────────────────────────────────────────────────

function ScanLogTab({ rows }: { rows: ServiceScanLogEntry[] }): ReactElement {
  if (rows.length === 0) return <Empty text="No check-ins recorded yet." boxed />;
  return (
    <section style={card(0)}>
      <div style={{ padding: 12, borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
        <CsvButton
          rows={rows}
          filename="attendance-scans.csv"
          columns={[
            ["Date", (r) => r.service_date],
            ["Time", (r) => shortTime(r.attended_at)],
            ["Service", (r) => r.service_title],
            ["Name", (r) => r.full_name],
            ["Phone", (r) => r.phone_number],
            ["Email", (r) => r.email ?? ""],
            ["Method", (r) => r.method],
          ]}
        />
      </div>
      <Table
        head={["Date", "Service", "Member", "Contact", "Checked in", "Method"]}
        rows={rows.map((r) => ({
          key: r.attendance_id,
          cells: [
            <span key="d" style={{ fontSize: 13, color: NAVY_INK }}>{r.service_date}</span>,
            <span key="s" style={{ fontSize: 13 }}>{r.service_title}</span>,
            <NameCell key="n" name={r.full_name} sub={null} />,
            <ContactCell key="c" phone={r.phone_number} email={r.email} />,
            <span key="t" style={{ color: MUTED, fontSize: 12 }}>{shortTime(r.attended_at)}</span>,
            <span key="m" style={{ fontSize: 12, color: MUTED, textTransform: "uppercase" }}>{r.method}</span>,
          ],
        }))}
      />
    </section>
  );
}

// ── Services ───────────────────────────────────────────────────────────────

function ServicesTab({ rows, onOpenAbsentees }: {
  rows: ServiceAttendanceSummary[];
  onOpenAbsentees: (serviceId: string) => void;
}): ReactElement {
  if (rows.length === 0) return <Empty text="No services have been held yet this year." boxed />;
  return (
    <section style={card(0)}>
      <Table
        head={["Service", "Date", "Attended", "Absent", "Turnout", ""]}
        rows={rows.map((s) => ({
          key: s.service_id,
          cells: [
            <span key="t" style={{ fontSize: 13, fontWeight: 600, color: NAVY_INK }}>
              {s.title}
              {!s.counts_for_streak && (
                <span style={{ marginLeft: 6, fontSize: 11, color: MUTED }}>(not counted)</span>
              )}
            </span>,
            <span key="d" style={{ fontSize: 13 }}>{s.service_date}</span>,
            <strong key="a" style={{ color: GREEN }}>{s.attended}</strong>,
            <strong key="x" style={{ color: s.absent > 0 ? RED : MUTED }}>{s.absent}</strong>,
            <Turnout key="r" rate={s.attendance_rate} />,
            <button key="b" onClick={() => onOpenAbsentees(s.service_id)} style={{
              fontSize: 12, fontWeight: 600, color: NAVY, background: "none",
              border: `1px solid ${NAVY}`, borderRadius: 999, padding: "4px 10px", cursor: "pointer",
            }}>
              Who missed
            </button>,
          ],
        }))}
      />
    </section>
  );
}

// ── Small pieces ───────────────────────────────────────────────────────────

function Stat({ icon: Icon, label, value, hint, color }: {
  icon: LucideIcon; label: string; value: number; hint: string; color: string;
}): ReactElement {
  return (
    <div style={card(14)}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color, marginBottom: 6 }}>
        <Icon size={15} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase" }}>{label}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: NAVY_INK, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>{hint}</div>
    </div>
  );
}

function YearPicker({ year, thisYear, onChange }: { year: number; thisYear: number; onChange: (y: number) => void }): ReactElement {
  const years = [thisYear, thisYear - 1, thisYear - 2];
  return (
    <select
      value={year}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", fontSize: 13, background: "#fff" }}
    >
      {years.map((y) => <option key={y} value={y}>{y}</option>)}
    </select>
  );
}

function NameCell({ name, sub }: { name: string; sub: string | null }): ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{
        width: 30, height: 30, borderRadius: 99, display: "grid", placeItems: "center", flexShrink: 0,
        fontSize: 11, fontWeight: 700, color: "#fff", background: NAVY_INK,
      }}>{initials(name)}</span>
      <span>
        <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: NAVY_INK }}>{name}</span>
        {sub && <span style={{ display: "block", fontSize: 11, color: MUTED }}>{sub}</span>}
      </span>
    </div>
  );
}

function ContactCell({ phone, email }: { phone: string | null; email: string | null }): ReactElement {
  return (
    <span style={{ fontSize: 12, color: MUTED, lineHeight: 1.5 }}>
      {phone ? <span style={{ display: "block", color: NAVY_INK }}>{phone}</span> : null}
      {email ? <span style={{ display: "block" }}>{email}</span> : null}
      {!phone && !email ? "—" : null}
    </span>
  );
}

function StreakCell({ current, longest, missRun }: { current: number; longest: number; missRun: number }): ReactElement {
  if (missRun > 0) {
    return <span style={{ fontSize: 12, color: RED }}>{missRun} missed in a row</span>;
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, color: NAVY_INK }}>
      <Flame size={13} color={GOLD} />
      <strong>{current}</strong>
      {longest > current && <span style={{ fontSize: 11, color: MUTED }}>best {longest}</span>}
    </span>
  );
}

function Turnout({ rate }: { rate: number | null }): ReactElement {
  if (rate === null) return <span style={{ color: MUTED, fontSize: 12 }}>—</span>;
  const pct = Math.round(rate * 100);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 56, height: 6, borderRadius: 99, background: "#eef2f7", overflow: "hidden" }}>
        <span style={{ display: "block", width: `${pct}%`, height: "100%", background: pct >= 50 ? GREEN : AMBER }} />
      </span>
      <span style={{ fontSize: 12, color: MUTED }}>{pct}%</span>
    </span>
  );
}

function Pill({ label, color, bg }: { label: string; color: string; bg: string }): ReactElement {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, color, background: bg, whiteSpace: "nowrap",
    }}>{label}</span>
  );
}

function Table({ head, rows }: {
  head: string[];
  rows: { key: string; cells: React.ReactNode[] }[];
}): ReactElement {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} style={{
                textAlign: "left", padding: "10px 14px", fontSize: 11, fontWeight: 700, color: MUTED,
                textTransform: "uppercase", letterSpacing: 0.5, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              {r.cells.map((c, i) => (
                <td key={i} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", verticalAlign: "middle" }}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ text, boxed = false }: { text: string; boxed?: boolean }): ReactElement {
  const inner = <div style={{ padding: 32, textAlign: "center", color: MUTED, fontSize: 13 }}>{text}</div>;
  return boxed ? <section style={card(0)}>{inner}</section> : inner;
}

/**
 * Export what's on screen. A pastoral team works the call list off a phone or a
 * printout, not this table — and until WhatsApp is wired up, a CSV of names and
 * numbers is the handover.
 */
function CsvButton<T>({ rows, filename, columns }: {
  rows: T[];
  filename: string;
  columns: [string, (row: T) => string][];
}): ReactElement {
  const download = (): void => {
    const esc = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const body = [
      columns.map(([h]) => esc(h)).join(","),
      ...rows.map((r) => columns.map(([, get]) => esc(get(r))).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <button onClick={download} disabled={rows.length === 0} style={{
      display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600,
      color: rows.length ? NAVY : MUTED, background: "#fff", cursor: rows.length ? "pointer" : "default",
      border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px",
    }}>
      <Download size={13} /> CSV
    </button>
  );
}

const shortDate = (iso: string): string => iso.slice(0, 10);
const shortTime = (iso: string): string => iso.slice(11, 16);

/**
 * The call list: human cadence steps that have come due.
 *
 * This tab exists because the register was answering "who is missing" and
 * leaving "so who is ringing them, and did anyone?" to memory. Every row is one
 * person and one action, and closing it demands an OUTCOME — "no answer" and
 * "reached" are different pastoral facts, and a list that only records "done"
 * cannot say who still needs reaching.
 *
 * Ordered oldest-first and never paginated away: a name that scrolls off the
 * bottom is a person nobody calls.
 */
function DueTab(props: { rows: FollowUpDueStep[]; onRecorded: () => void }): ReactElement {
  const { rows, onRecorded } = props;
  const [busy, setBusy] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState<string | null>(null);

  async function record(eventId: string, outcome: FollowUpOutcome): Promise<void> {
    setBusy(eventId);
    setFailed(null);
    try {
      await FollowUpApi.recordContact(eventId, outcome, note.trim() || undefined);
      setNoteFor(null);
      setNote("");
      onRecorded();
    } catch (e) {
      // Surfaced, not swallowed: a leader who thinks they logged a call and
      // did not is worse off than one who knows it failed.
      setFailed(e instanceof Error ? e.message : "Could not record that.");
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: MUTED, background: "#fff", borderRadius: 12, boxShadow: SHADOW }}>
        <PhoneCall size={20} style={{ opacity: 0.4 }} />
        <p style={{ margin: "10px 0 0", fontSize: 14 }}>No one is waiting to be called.</p>
        <p style={{ margin: "4px 0 0", fontSize: 12.5 }}>
          Steps appear here when a cadence reaches a day that asks for a person, not a message.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {failed && (
        <div style={{ padding: "10px 12px", borderRadius: 8, background: "#fef2f2", color: RED, fontSize: 13 }}>{failed}</div>
      )}
      {rows.map((r) => {
        const overdue = r.days_overdue > 0;
        return (
          <div
            key={r.event_id}
            style={{
              background: "#fff", borderRadius: 12, boxShadow: SHADOW, padding: 14,
              // Overdue is a coloured edge rather than a red row: the list is
              // read every day, and a wall of red stops meaning anything.
              borderLeft: `3px solid ${overdue ? (r.days_overdue > 6 ? RED : AMBER) : GREEN}`,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: NAVY_INK }}>{r.full_name}</div>
                <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>
                  {r.action} · {r.cadence_name}
                  {r.service_title ? ` · after ${r.service_title}` : ""}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                {r.phone_number ? (
                  // The number is the point of the row. A tel: link means one
                  // tap on a phone and one click on a desk.
                  <a href={`tel:${r.phone_number}`} style={{ fontSize: 14, color: NAVY, fontWeight: 600, textDecoration: "none" }}>
                    {r.phone_number}
                  </a>
                ) : (
                  <span style={{ fontSize: 12.5, color: RED }}>No phone number on file</span>
                )}
                <div style={{ fontSize: 11.5, color: overdue ? (r.days_overdue > 6 ? RED : AMBER) : MUTED, marginTop: 2 }}>
                  {overdue ? `${r.days_overdue} day${r.days_overdue === 1 ? "" : "s"} overdue` : "Due today"}
                </div>
              </div>
            </div>

            {noteFor === r.event_id && (
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What was said? (optional)"
                style={{
                  width: "100%", marginTop: 10, padding: "8px 10px", fontSize: 13,
                  border: "1px solid var(--border)", borderRadius: 8,
                }}
              />
            )}

            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              {([
                ["reached", "Reached", GREEN],
                ["no_answer", "No answer", AMBER],
                ["wrong_number", "Wrong number", RED],
                ["skipped", "Skip", MUTED],
              ] as const).map(([outcome, label, colour]) => (
                <button
                  key={outcome}
                  disabled={busy === r.event_id}
                  onClick={() => {
                    if (noteFor !== r.event_id) { setNoteFor(r.event_id); setNote(""); }
                    void record(r.event_id, outcome);
                  }}
                  style={{
                    padding: "6px 12px", fontSize: 12.5, fontWeight: 600, borderRadius: 999,
                    border: `1px solid ${colour}`, background: "#fff", color: colour,
                    cursor: busy === r.event_id ? "wait" : "pointer",
                    opacity: busy === r.event_id ? 0.5 : 1,
                  }}
                >
                  {busy === r.event_id ? <Loader2 size={12} /> : label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
