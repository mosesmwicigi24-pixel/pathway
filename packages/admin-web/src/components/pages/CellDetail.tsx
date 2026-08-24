// Cell Detail — rebuilt to the make, wired to live data: the cell summary from
// AdminApi.engagementReport (by cell_group_id) + its roster from OpsApi.members
// filtered to the cell. Band breakdown is computed from the real roster; the
// member table shows the engagement metrics we actually track (score, band,
// last active, level). Mock sub-scores / next-session / activity are omitted.
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronRight, ChevronDown, CircleAlert, Clock3, Send, Users, MessageSquareText, Crown, CalendarClock } from "lucide-react";
import { AdminApi, OpsApi, type EngagementCellRow, type MemberRow, type AdminSeriesRow } from "../../api/client";
import { errorMessage } from "../../util/error";

const BANDS = ["thriving", "steady", "watch", "at_risk"] as const;
type BandKey = (typeof BANDS)[number];
const bandMeta: Record<BandKey, { label: string; dot: string; bg: string; color: string }> = {
  thriving: { label: "Thriving", dot: "#16A34A", bg: "#F0FDF4", color: "#15803D" },
  steady: { label: "Steady", dot: "#0EA5E9", bg: "#E0F2FE", color: "#0369A1" },
  watch: { label: "Watch", dot: "#F59E0B", bg: "#FFFBEB", color: "#B45309" },
  at_risk: { label: "At-risk", dot: "#DC2626", bg: "#FEF2F2", color: "#B91C1C" },
};
const initials = (name: string): string => name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
const pct = (v: number | null): number => Math.round((v ?? 0) * 100);
const daysAgo = (iso: string | null): number | null => { if (!iso) return null; const t = new Date(iso).getTime(); if (Number.isNaN(t)) return null; return Math.max(0, Math.floor((Date.now() - t) / 86400000)); };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
/** Next calendar date falling on `weekday` (0=Sunday), as a wall-clock dtstart_local. */
const nextDtstartLocal = (weekday: number, time: string): string => {
  const d = new Date();
  d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7 || 7));
  const pad2 = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${time}:00`;
};
/** Weekday (0=Sunday) and HH:MM out of a series' wall-clock dtstart_local. */
const rhythmFromSeries = (s: AdminSeriesRow): { day: number; time: string } => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s.dtstart_local);
  if (!m) return { day: 0, time: "14:00" };
  return { day: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay(), time: `${m[4]}:${m[5]}` };
};

export function CellDetail(): ReactElement {
  const navigate = useNavigate();
  const { cellId } = useParams<{ cellId: string }>();
  const [cell, setCell] = useState<EngagementCellRow | null>(null);
  const [roster, setRoster] = useState<MemberRow[]>([]);
  const [allMembers, setAllMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortAsc, setSortAsc] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Shepherding: leader pick + the cell's real weekly series (the rhythm the
  // member app derives "Meets" / "Next session" from — typed text is only a fallback).
  const [leaderSel, setLeaderSel] = useState<string>("");
  const [leaderBusy, setLeaderBusy] = useState(false);
  const [leaderMsg, setLeaderMsg] = useState<string | null>(null);
  const [rhythmSeries, setRhythmSeries] = useState<AdminSeriesRow | null>(null);
  const [rhythmDay, setRhythmDay] = useState(0);
  const [rhythmTime, setRhythmTime] = useState("14:00");
  const [rhythmLocation, setRhythmLocation] = useState("");
  const [rhythmBusy, setRhythmBusy] = useState(false);
  const [rhythmMsg, setRhythmMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!cellId) { setLoading(false); return; }
    let alive = true;
    void (async () => {
      try {
        const [report, mem, series] = await Promise.all([
          AdminApi.engagementReport(),
          OpsApi.members({}),
          OpsApi.adminSeriesList({ status: "all" }),
        ]);
        if (!alive) return;
        const row = report.cells.find((c) => c.cell_group_id === cellId) ?? null;
        setCell(row);
        setLeaderSel(row?.leader_user_id ?? "");
        setRoster(mem.data.filter((m) => m.cell_group_id === cellId));
        setAllMembers(mem.data);
        const s = series.find((x) => x.cell_group_id === cellId && x.status === "active" && !x.is_paused)
          ?? series.find((x) => x.cell_group_id === cellId) ?? null;
        setRhythmSeries(s);
        if (s) {
          const r = rhythmFromSeries(s);
          setRhythmDay(r.day);
          setRhythmTime(r.time);
          setRhythmLocation(s.location ?? "");
        } else if (row?.room) {
          setRhythmLocation(row.room);
        }
      } catch (e) { if (alive) setError(errorMessage(e, "Could not load the cell.")); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [cellId]);

  const saveLeader = async (): Promise<void> => {
    if (!cellId) return;
    setLeaderBusy(true); setLeaderMsg(null);
    try {
      const updated = await AdminApi.updateCell(cellId, { leader_user_id: leaderSel || null });
      setCell((prev) => prev ? { ...prev, leader_user_id: updated.leader_user_id ?? null, leader_full_name: updated.leader_full_name ?? null } : prev);
      setLeaderMsg(leaderSel ? "Leader set — their app now sees this cell." : "Leader cleared.");
    } catch (e) { setLeaderMsg(errorMessage(e, "Could not save the leader.")); }
    finally { setLeaderBusy(false); }
  };

  const saveRhythm = async (): Promise<void> => {
    if (!cellId || !cell) return;
    setRhythmBusy(true); setRhythmMsg(null);
    try {
      const body = {
        dtstart_local: nextDtstartLocal(rhythmDay, rhythmTime),
        rrule: "FREQ=WEEKLY",
        location: rhythmLocation.trim() || null,
        timezone: rhythmSeries?.timezone ?? "Africa/Nairobi",
      };
      if (rhythmSeries) {
        await OpsApi.updateSeries(rhythmSeries.series_id, body);
        setRhythmSeries({ ...rhythmSeries, ...body });
      } else {
        const created = await OpsApi.createSeries({
          ...body,
          cell_group_id: cellId,
          title: `${cell.name} — cell meeting`,
          duration_min: 90,
          visibility: "cell",
        }) as AdminSeriesRow;
        setRhythmSeries(created);
      }
      setRhythmMsg(`Saved — the app now shows "${WEEKDAYS[rhythmDay]}s".`);
    } catch (e) { setRhythmMsg(errorMessage(e, "Could not save the rhythm.")); }
    finally { setRhythmBusy(false); }
  };

  const sorted = useMemo(() => [...roster].sort((a, b) => sortAsc ? (a.e_score ?? 0) - (b.e_score ?? 0) : (b.e_score ?? 0) - (a.e_score ?? 0)), [roster, sortAsc]);
  const bandCounts = useMemo(() => {
    const c: Record<BandKey, number> = { thriving: 0, steady: 0, watch: 0, at_risk: 0 };
    for (const m of roster) { const b = (m.band ?? "") as BandKey; if (b in c) c[b] += 1; }
    return c;
  }, [roster]);

  if (loading) return <div style={{ minHeight: "100%", background: "var(--background)", display: "grid", placeItems: "center", color: "var(--muted-foreground)" }}>Loading cell…</div>;
  if (!cell) {
    return (
      <main className="flex min-h-full flex-col items-center justify-center gap-4 p-12 text-center" style={{ background: "var(--background)" }}>
        <h2 className="type-section">Cell not found</h2>
        <p style={{ fontSize: 14, color: "var(--muted-foreground)" }}>{error ?? "We couldn't find that cell."}</p>
        <button onClick={() => navigate("/cell-engagement")} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 14, fontWeight: 800, border: "none" }}><ArrowLeft size={15} /> Back to Cell Engagement</button>
      </main>
    );
  }

  const avg = pct(cell.avg_engagement);
  const watch = bandCounts.watch;

  return (
    <main className="min-h-full" style={{ background: "var(--background)" }}>
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px,4vw,48px) 26px" }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}>
            <button onClick={() => navigate("/cell-engagement")} style={{ color: "rgba(232,239,245,0.55)", background: "none", border: "none" }}>Cell Engagement</button>
            <ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>{cell.name}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => navigate("/cell-engagement")} className="inline-flex items-center gap-1.5 rounded-lg px-3" style={{ height: 32, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 12, fontWeight: 600, border: "1px solid rgba(255,255,255,0.15)" }}><ArrowLeft size={13} /> All cells</button>
            <button onClick={() => navigate("/reflection-queue")} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}><Send size={13} /> Message cell</button>
          </div>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl" style={{ background: "rgba(245,199,126,0.18)", color: "#F5C77E", fontSize: 14, fontWeight: 800 }}>{initials(cell.name)}</span>
          <div>
            <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, color: "#fff", fontSize: "clamp(20px,3vw,28px)", lineHeight: 1.1 }}>{cell.name}</h1>
            <p style={{ fontSize: 11.5, color: "rgba(232,239,245,0.7)", marginTop: 4 }}>{cell.members} members · {cell.at_risk} at-risk</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 mt-5 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
          {[
            { label: "Members", value: String(cell.members), hint: "in this cell" },
            { label: "Avg engagement", value: `${avg}%`, hint: "this cell" },
            { label: "At-risk", value: String(cell.at_risk), hint: "need pastoral call" },
            { label: "On watch", value: String(watch), hint: "send a nudge" },
          ].map((item, idx) => (
            <div key={item.label} style={{ padding: "14px 20px", borderRight: idx < 3 ? "1px solid rgba(255,255,255,0.07)" : "none", borderBottom: idx < 2 ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
              <div style={{ fontSize: 9.5, color: "rgba(232,239,245,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 5 }}>{item.label}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 19, color: "#fff", lineHeight: 1.1 }}>{item.value}</div>
              <div style={{ fontSize: 10.5, color: "rgba(232,239,245,0.45)", marginTop: 4 }}>{item.hint}</div>
            </div>
          ))}
        </div>
      </div>

      <section style={{ padding: "24px clamp(16px,4vw,48px) 48px" }}>
        {/* Shepherding — the two upstream facts every member surface derives from:
            who leads this cell (synced into leader_assignments) and when it
            actually meets (a real weekly series, not typed text). */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="rounded-3xl p-6" style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 1px 2px rgba(11,31,51,0.04)" }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
              <Crown size={14} style={{ color: "var(--nuru-gold)" }} />
              <div className="nuru-eyebrow nuru-eyebrow-gold">Cell leader</div>
            </div>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--nuru-navy)", marginBottom: 4 }}>
              {cell.leader_full_name ?? (cell.discipler_name ? `${cell.discipler_name} (typed only — not linked to an account)` : "Not set")}
            </h3>
            <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 14 }}>
              Linking a real account lets their app see this cell's roster, turnout, and who's been missing.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <select value={leaderSel} onChange={(e) => setLeaderSel(e.target.value)} className="rounded-xl px-3 py-2.5" style={{ border: "1px solid var(--border)", background: "var(--card)", fontSize: 13, color: "var(--foreground)", minWidth: 220 }}>
                <option value="">— No linked leader —</option>
                <optgroup label="In this cell">
                  {roster.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
                </optgroup>
                <optgroup label="Everyone else">
                  {allMembers.filter((m) => m.cell_group_id !== cellId).map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
                </optgroup>
              </select>
              <button onClick={() => { void saveLeader(); }} disabled={leaderBusy || leaderSel === (cell.leader_user_id ?? "")} className="rounded-xl px-4 py-2.5" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 700, border: "none", opacity: leaderBusy || leaderSel === (cell.leader_user_id ?? "") ? 0.5 : 1 }}>
                {leaderBusy ? "Saving…" : "Save leader"}
              </button>
            </div>
            {leaderMsg ? <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 10 }}>{leaderMsg}</p> : null}
          </div>

          <div className="rounded-3xl p-6" style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 1px 2px rgba(11,31,51,0.04)" }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
              <CalendarClock size={14} style={{ color: "var(--nuru-gold)" }} />
              <div className="nuru-eyebrow nuru-eyebrow-gold">Weekly rhythm</div>
            </div>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--nuru-navy)", marginBottom: 4 }}>
              {rhythmSeries ? `${WEEKDAYS[rhythmFromSeries(rhythmSeries).day]}s · ${rhythmFromSeries(rhythmSeries).time}` : "No real schedule yet"}
            </h3>
            <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 14 }}>
              {rhythmSeries
                ? "The member app derives “Meets” and the next session from this series — cancellations and reschedules flow through."
                : cell.meets
                  ? `Members currently see the typed text “${cell.meets}”, which goes stale. Set the real weekly gathering instead.`
                  : "Set the real weekly gathering so the app can announce it (with RSVP and check-in)."}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <select value={rhythmDay} onChange={(e) => setRhythmDay(Number(e.target.value))} className="rounded-xl px-3 py-2.5" style={{ border: "1px solid var(--border)", background: "var(--card)", fontSize: 13, color: "var(--foreground)" }}>
                {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}s</option>)}
              </select>
              <input type="time" value={rhythmTime} onChange={(e) => setRhythmTime(e.target.value)} className="rounded-xl px-3 py-2" style={{ border: "1px solid var(--border)", background: "var(--card)", fontSize: 13, color: "var(--foreground)" }} />
              <input type="text" value={rhythmLocation} onChange={(e) => setRhythmLocation(e.target.value)} placeholder="Where (e.g. Nuru Place)" className="rounded-xl px-3 py-2.5" style={{ border: "1px solid var(--border)", background: "var(--card)", fontSize: 13, color: "var(--foreground)", minWidth: 170 }} />
              <button onClick={() => { void saveRhythm(); }} disabled={rhythmBusy} className="rounded-xl px-4 py-2.5" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 700, border: "none", opacity: rhythmBusy ? 0.5 : 1 }}>
                {rhythmBusy ? "Saving…" : rhythmSeries ? "Update rhythm" : "Create rhythm"}
              </button>
            </div>
            {rhythmMsg ? <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 10 }}>{rhythmMsg}</p> : null}
          </div>
        </div>

        {/* Band breakdown + KPI tiles — clean white cards, one soft shadow each */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <div className="rounded-3xl p-6" style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 1px 2px rgba(11,31,51,0.04)" }}>
            <div className="nuru-eyebrow nuru-eyebrow-gold" style={{ marginBottom: 4 }}>Health mix</div>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--nuru-navy)", marginBottom: 16 }}>Engagement bands</h3>
            <div className="flex h-3 overflow-hidden rounded-full mb-4" style={{ background: "rgba(0,0,0,0.05)" }}>
              {BANDS.map((b) => roster.length && bandCounts[b] > 0 ? <div key={b} style={{ width: `${(bandCounts[b] / roster.length) * 100}%`, background: bandMeta[b].dot }} title={`${bandMeta[b].label}: ${bandCounts[b]}`} /> : null)}
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {BANDS.map((b) => (
                <div key={b} className="flex items-center justify-between rounded-xl px-3 py-2" style={{ border: "1px solid var(--border)" }}>
                  <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12, fontWeight: 400, color: "var(--nuru-navy)" }}><span className="h-2 w-2 rounded-full" style={{ background: bandMeta[b].dot }} /> {bandMeta[b].label}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--nuru-navy)" }}>{bandCounts[b]}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="lg:col-span-2 grid grid-cols-2 gap-4">
            {[
              { label: "Members", value: cell.members, Icon: Users, tint: "tint-navy-bg", fg: "var(--tint-navy-fg)", sub: "in this cell" },
              { label: "At-risk", value: cell.at_risk, Icon: CircleAlert, tint: "tint-rose-bg", fg: "var(--tint-rose-fg)", sub: "need pastoral call" },
              { label: "Watch list", value: watch, Icon: Clock3, tint: "tint-amber-bg", fg: "var(--tint-amber-fg)", sub: "send nudge" },
              { label: "Avg engagement", value: `${avg}%`, Icon: MessageSquareText, tint: "tint-green-bg", fg: "var(--tint-green-fg)", sub: "this cell" },
            ].map(({ label, value, Icon, tint, fg, sub }) => (
              <div key={label} className="rounded-2xl" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "14px 16px", boxShadow: "0 1px 2px rgba(11,31,51,0.04)" }}>
                <span className="flex items-center justify-center rounded-lg" style={{ width: 34, height: 34, background: `var(--${tint})`, color: fg }}><Icon size={15} /></span>
                <div className="nuru-eyebrow" style={{ marginTop: 12, marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 600, color: "var(--nuru-navy)", lineHeight: 1 }}>{value}</div>
                <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 6 }}>{sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Member table — navy header, aligned columns, clean white body + soft shadow */}
        <div className="overflow-hidden rounded-[28px]" style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 1px 2px rgba(11,31,51,0.04)" }}>
          <div className="flex items-center justify-between gap-6 px-6 py-5" style={{ background: "var(--nuru-navy)", color: "#fff" }}>
            <div><p className="type-table-header" style={{ color: "rgba(255,255,255,0.55)" }}>{cell.name}</p><h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 18, lineHeight: 1.2, marginTop: 4 }}>Member engagement</h2></div>
            <button onClick={() => setSortAsc((v) => !v)} className="inline-flex items-center gap-1.5 rounded-2xl px-4 py-2.5" style={{ border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.1)", fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>{sortAsc ? "Lowest first" : "Highest first"} <ChevronDown size={14} /></button>
          </div>
          <div className="overflow-x-auto"><table className="w-full border-collapse">
            <thead><tr style={{ background: "var(--secondary)", textAlign: "left" }}>
              {["Member", "Level", "Engagement", "Band", "Last active", "Action"].map((h) => <th key={h} className="px-5 py-3.5" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted-foreground)" }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {sorted.map((m) => { const score = pct(m.e_score); const band = (m.band ?? "steady") as BandKey; const bm = bandMeta[band] ?? bandMeta.steady; const da = daysAgo(m.last_activity); return (
                <tr key={m.user_id} onClick={() => navigate(`/member-profile?id=${m.user_id}`)} className="cursor-pointer transition hover:bg-secondary/60" style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="px-5 py-4"><div className="flex items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--nuru-navy)", fontSize: 12, fontWeight: 600, color: "#fff" }}>{initials(m.full_name)}</div><div><p style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)", whiteSpace: "nowrap" }}>{m.full_name}</p><p style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{m.email ?? m.phone_number}</p></div></div></td>
                  <td className="px-5 py-4" style={{ fontSize: 13, fontWeight: 500, color: "var(--nuru-navy)" }}>L{m.current_level ?? "—"}</td>
                  <td className="px-5 py-4">
                    <div style={{ minWidth: 120 }}>
                      <div className="mb-1" style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground)" }}>{score}%</div>
                      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "rgba(0,0,0,0.06)" }}><div className="h-full rounded-full" style={{ width: `${score}%`, background: bm.dot }} /></div>
                    </div>
                  </td>
                  <td className="px-5 py-4"><span className="inline-flex rounded-full px-3 py-1" style={{ fontSize: 12, fontWeight: 500, background: bm.bg, color: bm.color }}>{bm.label}</span></td>
                  <td className="px-5 py-4"><span style={{ fontSize: 14, fontWeight: da != null && da >= 7 ? 600 : 400, color: da != null && da >= 7 ? "#B91C1C" : "var(--foreground)" }}>{da == null ? "—" : `${da}d`}</span></td>
                  <td className="px-5 py-4"><button onClick={(e) => { e.stopPropagation(); navigate(`/member-profile?id=${m.user_id}`); }} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2" style={{ border: "1px solid var(--border)", background: "var(--card)", fontSize: 12, fontWeight: 500, color: "var(--nuru-navy)" }}>View <ChevronRight size={14} style={{ color: "var(--muted-foreground)" }} /></button></td>
                </tr>
              ); })}
              {sorted.length === 0 ? <tr><td colSpan={6} className="px-5 py-8 text-center" style={{ fontSize: 13, color: "var(--muted-foreground)" }}>No members loaded for this cell.</td></tr> : null}
            </tbody>
          </table></div>
        </div>
      </section>
    </main>
  );
}
