// Events Operations Center (EVENTS_ARCHITECTURE §9) — the /events hub.
//   · Live hero: today's events + needing-attention, ALL from GET
//     /admin/events/insights (the hard-coded 74%/23/12/5/48 tiles are dead).
//   · Month / Week / Agenda / Year calendar over WINDOWED fetching
//     (useCalendarRange): infinite month navigation, mini-calendar jump,
//     jump-to-today, jump-to-date.
//   · Search: instant over the loaded window, then GET /admin/events/search
//     (debounced) for the archive.
//   · Series rail from GET /admin/events/series — real next_at; no more
//     deriving series from visible occurrences.
//   · Tabs: Operations · Announcements (studio) · Moments.
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowUpRight,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Pause,
  Play,
  Plus,
  QrCode,
  Repeat,
  Search,
  ShieldCheck,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  OpsApi,
  type AdminSeriesRow,
  type EventsInsights,
  type EventsSearchResult,
} from "../../api/client";
import { errorMessage } from "../../util/error";
import { fmtDateTime, localIso, relTime, startOfWeek } from "../../util/dates";
import { useCalendarRange } from "./useCalendarRange";
import { AgendaView, buildByDay, MiniMonth, MonthGrid, WeekStrip, YearView, type CalendarViewKind } from "./CalendarViews";
import {
  Card,
  CATEGORY_META,
  EmptyState,
  MergedTile,
  Modal,
  SectionHeader,
  Skeleton,
  StatusPill,
  toUi,
  type UiOccurrence,
} from "./kit";
import { QrPanel } from "./QrPanel";
import { AttendanceDrawer, ManualCheckinModal, RsvpDrawer } from "./AttendancePanels";
import { SeriesEditor } from "./SeriesEditor";
import { AnnouncementsStudio, AnnouncementComposer } from "./AnnouncementsStudio";
import { MomentsCard } from "./MomentsCard";
import { OccurrenceDrawer } from "./OccurrenceDrawer";

type HubTab = "operations" | "announcements" | "moments";

export function EventsHub(): ReactElement {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as HubTab | null) ?? "operations";
  const setTab = (t: HubTab): void => setParams(t === "operations" ? {} : { tab: t }, { replace: true });

  const now = useMemo(() => new Date(), []);
  const todayIso = localIso(now);

  // ── Windowed calendar state (the 60-day constant is dead) ──────────────
  const [anchor, setAnchor] = useState<{ y: number; m: number }>({ y: now.getFullYear(), m: now.getMonth() });
  const range = useCalendarRange(anchor.y, anchor.m);
  const events = useMemo(() => range.occurrences.map(toUi), [range.occurrences]);
  const byDay = useMemo(() => buildByDay(events), [events]);

  const [view, setView] = useState<CalendarViewKind>("Month");
  const [selectedIso, setSelectedIso] = useState(todayIso);
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(now));

  // ── Server data ────────────────────────────────────────────────────────
  const [insights, setInsights] = useState<EventsInsights | null>(null);
  const [insightsLoaded, setInsightsLoaded] = useState(false);
  const [series, setSeries] = useState<AdminSeriesRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadInsights = useCallback(async () => {
    try {
      setInsights(await OpsApi.eventsInsights());
    } catch {
      setInsights(null);
    } finally {
      setInsightsLoaded(true);
    }
  }, []);
  const loadSeries = useCallback(async () => {
    try {
      setSeries(await OpsApi.adminSeriesList({ status: "all" }));
    } catch (e) {
      setSeries([]);
      setError(errorMessage(e, "Could not load event series."));
    }
  }, []);
  useEffect(() => {
    void loadInsights();
    void loadSeries();
  }, [loadInsights, loadSeries]);

  const refetchAll = useCallback(async () => {
    await Promise.all([range.refetch(), loadSeries(), loadInsights()]);
  }, [range, loadSeries, loadInsights]);

  // ── Search: instant over the loaded window + debounced archive search ──
  const [query, setQuery] = useState("");
  const [serverHits, setServerHits] = useState<EventsSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setServerHits(null);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      void OpsApi.eventsSearch(q)
        .then(setServerHits)
        .catch(() => setServerHits(null))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);
  const localHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return events.filter((e) => e.title.toLowerCase().includes(q) || e.location.toLowerCase().includes(q)).slice(0, 6);
  }, [query, events]);

  // ── Panels / modals ────────────────────────────────────────────────────
  const [drawerOcc, setDrawerOcc] = useState<UiOccurrence | null>(null);
  const [dayDrawerIso, setDayDrawerIso] = useState<string | null>(null);
  const [qrScreenOcc, setQrScreenOcc] = useState<UiOccurrence | null>(null);
  const [attendanceFor, setAttendanceFor] = useState<UiOccurrence | null>(null);
  const [rsvpsFor, setRsvpsFor] = useState<UiOccurrence | null>(null);
  const [manualCheckinFor, setManualCheckinFor] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

  const todayOccurrences = useMemo(() => byDay.get(todayIso) ?? [], [byDay, todayIso]);
  const nowIso = now.toISOString();
  const upcoming = useMemo(
    () => events.filter((o) => o.startsAt >= nowIso).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, 6),
    [events, nowIso],
  );
  const showOnHomeCount = useMemo(() => (series ?? []).filter((s) => s.show_on_home).length, [series]);

  const [seriesBusy, setSeriesBusy] = useState<string | null>(null);
  const toggleSeriesPause = useCallback(
    async (s: AdminSeriesRow) => {
      setSeriesBusy(s.series_id);
      try {
        if (s.is_paused) await OpsApi.resumeSeries(s.series_id);
        else await OpsApi.pauseSeries(s.series_id);
        setNotice(s.is_paused ? "Series resumed." : "Series paused — future occurrences hidden.");
        await refetchAll();
      } catch (e) {
        setError(errorMessage(e, "Could not update series."));
      } finally {
        setSeriesBusy(null);
      }
    },
    [refetchAll],
  );

  const jumpTo = useCallback((y: number, m: number, iso?: string) => {
    setAnchor({ y, m });
    if (iso) setSelectedIso(iso);
    if (iso) setWeekStart(startOfWeek(new Date(`${iso}T00:00:00`)));
  }, []);

  const goToday = useCallback(() => {
    jumpTo(now.getFullYear(), now.getMonth(), todayIso);
  }, [jumpTo, now, todayIso]);

  const monthLabel = new Date(anchor.y, anchor.m, 1).toLocaleString("en-GB", { month: "long", year: "numeric" });

  // Needing attention (all real, from insights §6).
  const lowRsvp = insights?.upcoming.filter((u) => u.low_rsvp) ?? [];
  const followUpNeeded = insights?.recent_no_shows.reduce((s, r) => s + r.absent, 0) ?? 0;
  const noResponseTotal = insights?.upcoming.reduce((s, u) => s + (u.no_response ?? 0), 0) ?? 0;

  const dayDrawerEvents = dayDrawerIso ? byDay.get(dayDrawerIso) ?? [] : [];

  return (
    <div style={{ minWidth: 0, background: "var(--background)", minHeight: "100%" }}>
      {/* ────── Hero ────── */}
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px,4vw,48px) 24px" }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}>
            <span>Operations</span>
            <ChevronRight size={10} />
            <span style={{ color: "#fff", fontWeight: 600 }}>Events &amp; Announcements</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5" style={{ height: 32, background: "rgba(245,199,126,0.14)", color: "#F5C77E", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", border: "1px solid rgba(245,199,126,0.25)" }}>
              <ShieldCheck size={11} /> EAT timezone
            </span>
            <button onClick={() => setComposeOpen(true)} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 12, border: "1px solid rgba(255,255,255,0.15)", fontWeight: 600 }}>
              <Bell size={13} /> Announcement
            </button>
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, boxShadow: "0 6px 18px rgba(200,155,60,0.32)", border: "none" }}>
              <Plus size={13} /> Create event
            </button>
          </div>
        </div>

        {/* Real stat band — insights + the loaded window; nothing invented. */}
        <div className="grid grid-cols-2 md:grid-cols-4 mt-4 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
          {[
            { label: "Today", value: String(todayOccurrences.length), hint: "events on the calendar" },
            {
              label: "RSVP conversion",
              value: insights?.conversion.rate != null ? `${insights.conversion.rate}%` : "—",
              hint: insights ? `${insights.conversion.checked_in}/${insights.conversion.going} checked in · last 10` : "loading…",
            },
            { label: "First-time guests", value: insights ? String(insights.first_time_guests_30d) : "—", hint: "last 30 days" },
            { label: "Needs attention", value: insights ? String(lowRsvp.length + insights.recent_no_shows.filter((r) => r.absent > 0).length) : "—", hint: "low RSVPs + follow-ups" },
          ].map((item, idx) => (
            <div key={item.label} className="flex-1" style={{ padding: "14px 20px", borderRight: idx < 3 ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
              <div style={{ fontSize: 10.5, color: "rgba(232,239,245,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 6 }}>{item.label}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "#fff", lineHeight: 1.1 }}>{item.value}</div>
              <div style={{ fontSize: 11, color: "rgba(232,239,245,0.45)", marginTop: 4 }}>{item.hint}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mt-4 rounded-xl p-1" style={{ background: "rgba(255,255,255,0.06)", width: "fit-content" }}>
          {(
            [
              { k: "operations", l: "Operations" },
              { k: "announcements", l: "Announcements" },
              { k: "moments", l: "Moments" },
            ] as Array<{ k: HubTab; l: string }>
          ).map((t) => (
            <button key={t.k} onClick={() => setTab(t.k)} className="rounded-lg px-4 py-1.5" style={{ background: tab === t.k ? "var(--nuru-gold)" : "transparent", color: "#fff", fontSize: 12, fontWeight: tab === t.k ? 700 : 500, border: "none" }}>
              {t.l}
            </button>
          ))}
        </div>
      </div>

      {/* ────── Body ────── */}
      <div style={{ padding: "28px clamp(16px,4vw,48px) 48px" }}>
        <div style={{ maxWidth: 1280, marginInline: "auto" }}>
          {error ? (
            <p className="flex items-center gap-2" style={{ color: "#A8281F", marginBottom: 12, fontSize: 13 }}>
              {error}
              <button onClick={() => setError(null)} style={{ border: "none", background: "none", color: "#A8281F", cursor: "pointer" }} aria-label="Dismiss error"><X size={13} /></button>
            </p>
          ) : null}
          {notice ? (
            <p className="flex items-center gap-2" style={{ color: "#0F6B33", marginBottom: 12, fontSize: 13 }}>
              {notice}
              <button onClick={() => setNotice(null)} style={{ border: "none", background: "none", color: "#0F6B33", cursor: "pointer" }} aria-label="Dismiss notice"><X size={13} /></button>
            </p>
          ) : null}

          {tab === "announcements" ? (
            <AnnouncementsStudio seriesOptions={series ?? []} eventOptions={upcoming} onNotice={setNotice} onError={setError} />
          ) : tab === "moments" ? (
            <MomentsCard />
          ) : (
            <>
              {/* ── Insights & follow-up (REAL — GET /admin/events/insights) ── */}
              {!insightsLoaded ? (
                <Skeleton height={110} className="mb-5" />
              ) : insights ? (
                <Card className="mb-5">
                  <SectionHeader title="Insights & follow-up" subtitle="Measured across recent occurrences — who needs care next" />
                  <div className="grid gap-2.5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
                    <MergedTile
                      icon={<TrendingUp size={15} />}
                      value={insights.conversion.rate != null ? `${insights.conversion.rate}%` : "—"}
                      label="RSVP conversion"
                      hint={`${insights.conversion.checked_in}/${insights.conversion.going} · last 10 events`}
                      tintBg="var(--tint-green-bg)"
                      tintFg="var(--tint-green-fg)"
                    />
                    <MergedTile
                      icon={<AlertCircle size={15} />}
                      value={String(followUpNeeded)}
                      label="RSVP'd, absent"
                      hint="latest occurrence per series"
                      tintBg="var(--tint-rose-bg)"
                      tintFg="var(--tint-rose-fg)"
                      onClick={() => setComposeOpen(true)}
                    />
                    <MergedTile
                      icon={<UserPlus size={15} />}
                      value={String(insights.first_time_guests_30d)}
                      label="First-time guests"
                      hint="last 30 days"
                      tintBg="var(--tint-green-bg)"
                      tintFg="var(--tint-green-fg)"
                    />
                    <MergedTile
                      icon={<ShieldCheck size={15} />}
                      value={String(insights.manual_checkins_7d)}
                      label="Manual check-ins"
                      hint="last 7 days"
                      tintBg="var(--tint-gold-bg)"
                      tintFg="var(--tint-gold-fg)"
                    />
                    <MergedTile
                      icon={<TrendingUp size={15} style={{ transform: "scaleY(-1)" }} />}
                      value={String(lowRsvp.length)}
                      label="Low-RSVP upcoming"
                      hint="under their threshold"
                      tintBg="var(--tint-rose-bg)"
                      tintFg="var(--tint-rose-fg)"
                    />
                    <MergedTile
                      icon={<Users size={15} />}
                      value={String(noResponseTotal)}
                      label="No response"
                      hint="cell events · next 14 days"
                      tintBg="var(--secondary)"
                      tintFg="var(--muted-foreground)"
                      onClick={() => setComposeOpen(true)}
                    />
                  </div>

                  {/* Needing attention strip */}
                  {(lowRsvp.length > 0 || insights.recent_no_shows.some((r) => r.absent > 0)) && (
                    <div className="flex flex-col gap-1.5 mt-4 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
                      {lowRsvp.slice(0, 4).map((u) => (
                        <button
                          key={u.occurrence_id}
                          onClick={() => u.series_id && navigate(`/events/series/${u.series_id}`)}
                          className="flex items-center gap-2 rounded-lg px-3 py-2 text-left"
                          style={{ background: "#FFFBEB", border: "1px solid #F5E0A8", fontSize: 12, color: "#7A5410" }}
                        >
                          <AlertCircle size={12} style={{ flexShrink: 0 }} />
                          <span style={{ fontWeight: 700 }}>{u.title}</span>
                          <span>— {u.going} going (alert under {u.threshold}) · {fmtDateTime(u.occurs_at)}</span>
                          <ArrowUpRight size={12} style={{ marginLeft: "auto", flexShrink: 0 }} />
                        </button>
                      ))}
                      {insights.recent_no_shows.filter((r) => r.absent > 0).slice(0, 3).map((r) => (
                        <button
                          key={r.occurrence_id}
                          onClick={() => navigate(`/events/series/${r.series_id}`)}
                          className="flex items-center gap-2 rounded-lg px-3 py-2 text-left"
                          style={{ background: "#FEF2F2", border: "1px solid #FECACA", fontSize: 12, color: "#B91C1C" }}
                        >
                          <Users size={12} style={{ flexShrink: 0 }} />
                          <span style={{ fontWeight: 700 }}>{r.title}</span>
                          <span>— {r.absent} RSVP'd but absent · {relTime(r.occurs_at)}</span>
                          <ArrowUpRight size={12} style={{ marginLeft: "auto", flexShrink: 0 }} />
                        </button>
                      ))}
                    </div>
                  )}
                </Card>
              ) : (
                <Card className="mb-5">
                  <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>Insights unavailable — the events insights endpoint could not be reached.</div>
                </Card>
              )}

              {/* ── Calendar + right rail ── */}
              <div className="grid gap-5 mb-5 lg:grid-cols-[1fr_340px]" style={{ alignItems: "start" }}>
                <Card padded={false}>
                  <div className="flex items-center justify-between gap-3 flex-wrap p-5" style={{ borderBottom: "1px solid var(--border)" }}>
                    <div className="flex items-center gap-3 flex-wrap">
                      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)" }}>
                        {view === "Week" ? "This week" : view === "Year" ? String(anchor.y) : monthLabel}
                      </h2>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            if (view === "Week") {
                              const x = new Date(weekStart);
                              x.setDate(x.getDate() - 7);
                              setWeekStart(x);
                              jumpTo(x.getFullYear(), x.getMonth());
                            } else if (view === "Year") {
                              setAnchor((a) => ({ ...a, y: a.y - 1 }));
                            } else {
                              setAnchor((a) => (a.m === 0 ? { y: a.y - 1, m: 11 } : { y: a.y, m: a.m - 1 }));
                            }
                          }}
                          className="rounded-lg p-2"
                          style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none" }}
                          aria-label="Previous"
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <button
                          onClick={() => {
                            if (view === "Week") {
                              const x = new Date(weekStart);
                              x.setDate(x.getDate() + 7);
                              setWeekStart(x);
                              jumpTo(x.getFullYear(), x.getMonth());
                            } else if (view === "Year") {
                              setAnchor((a) => ({ ...a, y: a.y + 1 }));
                            } else {
                              setAnchor((a) => (a.m === 11 ? { y: a.y + 1, m: 0 } : { y: a.y, m: a.m + 1 }));
                            }
                          }}
                          className="rounded-lg p-2"
                          style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none" }}
                          aria-label="Next"
                        >
                          <ChevronRight size={14} />
                        </button>
                        <button onClick={goToday} className="rounded-lg px-3 py-1.5 ml-1" style={{ background: "var(--secondary)", color: "var(--foreground)", fontSize: 12, fontWeight: 600, border: "none" }}>
                          Today
                        </button>
                        <input
                          type="date"
                          aria-label="Jump to date"
                          onChange={(e) => {
                            const d = new Date(`${e.target.value}T00:00:00`);
                            if (!Number.isNaN(d.getTime())) jumpTo(d.getFullYear(), d.getMonth(), localIso(d));
                          }}
                          className="rounded-lg px-2 py-1.5 ml-1 outline-none"
                          style={{ background: "var(--secondary)", border: "none", fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--foreground)" }}
                        />
                        {range.loading ? <span style={{ fontSize: 11, color: "var(--muted-foreground)", marginLeft: 6 }}>Loading…</span> : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: "var(--secondary)" }}>
                      {(["Month", "Week", "Agenda", "Year"] as const).map((v) => (
                        <button
                          key={v}
                          onClick={() => setView(v)}
                          className="rounded-lg px-3 py-1.5"
                          style={{ background: view === v ? "var(--card)" : "transparent", color: "var(--foreground)", fontSize: 12, fontWeight: view === v ? 700 : 500, boxShadow: view === v ? "0 1px 3px rgba(0,0,0,0.06)" : "none", border: "none" }}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Search — instant over the loaded window, archive via /admin/events/search */}
                  <div className="px-5 pt-4">
                    <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: "var(--input-background)", border: "1px solid var(--border)" }}>
                      <Search size={14} style={{ color: "var(--muted-foreground)" }} />
                      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search events, series & announcements…" className="flex-1 bg-transparent outline-none" style={{ fontSize: 13 }} />
                      {query ? (
                        <button onClick={() => setQuery("")} style={{ border: "none", background: "none", color: "var(--muted-foreground)", cursor: "pointer" }} aria-label="Clear search">
                          <X size={13} />
                        </button>
                      ) : null}
                    </div>
                    {query.trim().length >= 2 ? (
                      <div className="rounded-xl mt-2 p-3 flex flex-col gap-2" style={{ background: "var(--secondary)", border: "1px solid var(--border)" }}>
                        {localHits.length > 0 ? (
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>In view</div>
                            {localHits.map((o) => (
                              <button key={o.id} onClick={() => { setDrawerOcc(o); setQuery(""); }} className="w-full text-left flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: "transparent", border: "none", fontSize: 12.5, color: "var(--foreground)" }}>
                                <span className="rounded-full" style={{ width: 6, height: 6, background: CATEGORY_META[o.category].color }} />
                                <span style={{ fontWeight: 600 }}>{o.title}</span>
                                <span style={{ color: "var(--muted-foreground)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{o.date} {o.time}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {serverHits ? (
                          <>
                            {serverHits.series.length > 0 ? (
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Series</div>
                                {serverHits.series.map((s) => (
                                  <button key={s.series_id} onClick={() => navigate(`/events/series/${s.series_id}`)} className="w-full text-left flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: "transparent", border: "none", fontSize: 12.5, color: "var(--foreground)" }}>
                                    <Repeat size={11} style={{ color: "var(--muted-foreground)" }} />
                                    <span style={{ fontWeight: 600 }}>{s.title}</span>
                                    {s.is_paused ? <StatusPill status="paused" /> : s.status === "draft" ? <StatusPill status="draft" /> : null}
                                    <span style={{ color: "var(--muted-foreground)", fontSize: 11 }}>{s.location ?? ""}</span>
                                  </button>
                                ))}
                              </div>
                            ) : null}
                            {serverHits.occurrences.length > 0 ? (
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Upcoming occurrences</div>
                                {serverHits.occurrences.map((o) => (
                                  <button
                                    key={o.occurrence_id}
                                    onClick={() => {
                                      const d = new Date(o.occurs_at);
                                      jumpTo(d.getFullYear(), d.getMonth(), localIso(d));
                                      setQuery("");
                                    }}
                                    className="w-full text-left flex items-center gap-2 rounded-lg px-2 py-1.5"
                                    style={{ background: "transparent", border: "none", fontSize: 12.5, color: "var(--foreground)" }}
                                  >
                                    <CalendarDays size={11} style={{ color: "var(--muted-foreground)" }} />
                                    <span style={{ fontWeight: 600 }}>{o.title}</span>
                                    <span style={{ color: "var(--muted-foreground)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{fmtDateTime(o.occurs_at)}</span>
                                  </button>
                                ))}
                              </div>
                            ) : null}
                            {serverHits.announcements.length > 0 ? (
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Announcements</div>
                                {serverHits.announcements.map((a) => (
                                  <button key={a.announcement_id} onClick={() => { setTab("announcements"); setQuery(""); }} className="w-full text-left flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: "transparent", border: "none", fontSize: 12.5, color: "var(--foreground)" }}>
                                    <Bell size={11} style={{ color: "var(--muted-foreground)" }} />
                                    <span style={{ fontWeight: 600 }}>{a.title}</span>
                                    <span style={{ color: "var(--muted-foreground)", fontSize: 11, textTransform: "capitalize" }}>{a.archived_at ? "archived" : a.status}</span>
                                  </button>
                                ))}
                              </div>
                            ) : null}
                            {serverHits.series.length === 0 && serverHits.occurrences.length === 0 && serverHits.announcements.length === 0 && localHits.length === 0 ? (
                              <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>No matches anywhere.</div>
                            ) : null}
                          </>
                        ) : searching ? (
                          <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Searching the archive…</div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="p-5">
                    {!range.anchorLoaded && view !== "Year" ? (
                      <Skeleton height={420} />
                    ) : view === "Month" ? (
                      <MonthGrid
                        month={anchor.m}
                        year={anchor.y}
                        todayIso={todayIso}
                        selectedIso={selectedIso}
                        byDay={byDay}
                        onSelectDate={(iso) => {
                          setSelectedIso(iso);
                          setDayDrawerIso(iso);
                        }}
                        onSelectOccurrence={setDrawerOcc}
                      />
                    ) : view === "Week" ? (
                      <WeekStrip selectedIso={selectedIso} weekStart={weekStart} byDay={byDay} onSelectDate={setSelectedIso} onSelectOccurrence={setDrawerOcc} />
                    ) : view === "Agenda" ? (
                      <AgendaView month={anchor.m} year={anchor.y} todayIso={todayIso} byDay={byDay} onSelectOccurrence={setDrawerOcc} onCreate={() => setShowCreate(true)} />
                    ) : (
                      <YearView year={anchor.y} todayIso={todayIso} byDay={byDay} ensureYear={range.ensureYear} onJump={(y, m, iso) => { jumpTo(y, m, iso); setView("Month"); }} />
                    )}

                    <div className="flex flex-wrap gap-x-5 gap-y-2 mt-5 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
                      {(Object.keys(CATEGORY_META) as Array<keyof typeof CATEGORY_META>).map((k) => (
                        <div key={k} className="flex items-center gap-2">
                          <span className="rounded-full" style={{ width: 8, height: 8, background: CATEGORY_META[k].color }} />
                          <span style={{ fontSize: 12, color: "var(--foreground)" }}>{CATEGORY_META[k].label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>

                {/* Right rail: mini calendar + today */}
                <div className="flex flex-col gap-5" style={{ minWidth: 0 }}>
                  <MiniMonth
                    year={anchor.y}
                    month={anchor.m}
                    todayIso={todayIso}
                    byDay={byDay}
                    onPick={(iso) => {
                      const d = new Date(`${iso}T00:00:00`);
                      jumpTo(d.getFullYear(), d.getMonth(), iso);
                      setDayDrawerIso(iso);
                    }}
                    title
                  />
                  <Card padded={false}>
                    <div className="p-5" style={{ borderBottom: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6 }}>Today's ministry flow</div>
                      <h3 style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--foreground)", marginTop: 4 }}>{now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</h3>
                      <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2, fontFamily: "var(--font-mono)" }}>{todayOccurrences.length} events</div>
                    </div>
                    <div className="p-5 flex flex-col gap-3" style={{ maxHeight: 460, overflowY: "auto" }}>
                      {todayOccurrences.length === 0 ? (
                        <EmptyState icon={<CalendarDays size={20} />} title="Nothing scheduled today" body="When events are scheduled for today they appear here as a timeline." cta="Create event" onCta={() => setShowCreate(true)} />
                      ) : (
                        todayOccurrences.map((o) => {
                          const d = new Date(o.startsAt);
                          return (
                            <button key={o.id} onClick={() => setDrawerOcc(o)} className="rounded-xl text-left flex items-stretch gap-3 p-3" style={{ background: "var(--secondary)", border: "1px solid var(--border)" }}>
                              <div className="rounded-xl flex flex-col items-center justify-center shrink-0" style={{ width: 54, background: CATEGORY_META[o.category].soft, color: CATEGORY_META[o.category].color }}>
                                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.4 }}>{d.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}</span>
                                <span style={{ fontSize: 17, fontWeight: 800, fontFamily: "var(--font-mono)", lineHeight: 1.1 }}>{d.getDate()}</span>
                                <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)" }}>{o.time.split(" ")[0]}</span>
                              </div>
                              <div className="flex-1 min-w-0 flex flex-col">
                                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.title}</span>
                                <div className="flex items-center gap-1.5 mt-0.5" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                                  <MapPin size={10} /> {o.location}
                                </div>
                                <div className="flex items-center gap-1.5 mt-auto pt-2 flex-wrap">
                                  <span onClick={(e) => { e.stopPropagation(); setQrScreenOcc(o); }} className="flex items-center gap-1 rounded-md px-2 py-1" style={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 10, fontWeight: 600, color: "var(--foreground)", cursor: "pointer" }}>
                                    <QrCode size={10} /> QR
                                  </span>
                                  <span onClick={(e) => { e.stopPropagation(); setAttendanceFor(o); }} className="flex items-center gap-1 rounded-md px-2 py-1" style={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 10, fontWeight: 600, color: "var(--foreground)", cursor: "pointer" }}>
                                    <Users size={10} /> Attendance
                                  </span>
                                  <span onClick={(e) => { e.stopPropagation(); setManualCheckinFor(o.id); }} className="flex items-center gap-1 rounded-md px-2 py-1" style={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 10, fontWeight: 600, color: "var(--foreground)", cursor: "pointer" }}>
                                    <CheckCircle2 size={10} /> Check in
                                  </span>
                                </div>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </Card>
                </div>
              </div>

              {/* ── Series rail (GET /admin/events/series — real next_at) ── */}
              <Card className="mb-5">
                <SectionHeader
                  title="Event series"
                  subtitle={series ? `${series.length} series · next occurrence computed live` : "Loading…"}
                />
                {series === null ? (
                  <Skeleton height={140} />
                ) : series.length === 0 ? (
                  <EmptyState icon={<Repeat size={20} />} title="No series yet" body="Create an event — one-off or recurring — and manage it from here." cta="Create event" onCta={() => setShowCreate(true)} />
                ) : (
                  <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                    {series.map((s) => {
                      const paused = s.is_paused;
                      const busy = seriesBusy === s.series_id;
                      const cat = (s.category ?? "special") as keyof typeof CATEGORY_META;
                      const meta = CATEGORY_META[cat] ?? CATEGORY_META.special;
                      return (
                        <div key={s.series_id} className="rounded-xl p-3 flex flex-col gap-2" style={{ background: "var(--secondary)", border: "1px solid var(--border)", minWidth: 0 }}>
                          <div className="flex items-center gap-2">
                            <span className="rounded-md shrink-0" style={{ width: 4, height: 30, background: meta.color }} />
                            <button onClick={() => navigate(`/events/series/${s.series_id}`)} className="text-left flex-1 min-w-0" style={{ background: "none", border: "none", cursor: "pointer" }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</div>
                              <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{s.cadence}</div>
                            </button>
                            {s.status === "draft" ? <StatusPill status="draft" /> : paused ? <StatusPill status="paused" /> : <StatusPill status="active" />}
                          </div>
                          <div className="flex items-center justify-between gap-2" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                            <span style={{ fontFamily: "var(--font-mono)" }}>{s.next_at ? `Next ${fmtDateTime(s.next_at)}` : "No upcoming occurrence"}</span>
                            <span>{s.rsvp_count} RSVPs · {s.attendance_count} check-ins</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => navigate(`/events/series/${s.series_id}`)} className="flex items-center gap-1 rounded-md px-2 py-1.5 flex-1 justify-center" style={{ background: "var(--card)", color: "var(--foreground)", border: "1px solid var(--border)", fontSize: 11, fontWeight: 600 }}>
                              <ArrowUpRight size={11} /> Command center
                            </button>
                            <button
                              onClick={() => void toggleSeriesPause(s)}
                              disabled={busy}
                              className="flex items-center gap-1 rounded-md px-2 py-1.5"
                              style={{ background: "var(--card)", color: "var(--foreground)", border: "1px solid var(--border)", fontSize: 11, fontWeight: 600, opacity: busy ? 0.6 : 1 }}
                            >
                              {paused ? <Play size={11} /> : <Pause size={11} />}
                              {paused ? "Resume" : "Pause"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </div>

      {/* ============== Drawers & modals ============== */}

      {drawerOcc ? (
        <OccurrenceDrawer
          occ={drawerOcc}
          onClose={() => setDrawerOcc(null)}
          onOpenCenter={() => {
            navigate(`/events/series/${drawerOcc.seriesId}`);
          }}
          onQr={() => setQrScreenOcc(drawerOcc)}
          onAttendance={() => setAttendanceFor(drawerOcc)}
          onRsvps={() => setRsvpsFor(drawerOcc)}
          onCheckin={() => setManualCheckinFor(drawerOcc.id)}
          onAnnounce={() => setComposeOpen(true)}
          onChanged={async (msg) => {
            setNotice(msg);
            setDrawerOcc(null);
            await refetchAll();
          }}
          onError={setError}
        />
      ) : null}

      {dayDrawerIso ? (
        <Modal onClose={() => setDayDrawerIso(null)} width={480}>
          <div className="px-6 py-5" style={{ borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6 }}>Day schedule</div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", marginTop: 4 }}>
              {new Date(`${dayDrawerIso}T00:00:00`).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </h2>
          </div>
          <div className="px-6 py-5 flex flex-col gap-3" style={{ overflowY: "auto" }}>
            {dayDrawerEvents.length === 0 ? (
              <EmptyState icon={<CalendarDays size={20} />} title="No events on this day" body="Create one to begin planning." cta="Create event" onCta={() => { setDayDrawerIso(null); setShowCreate(true); }} />
            ) : (
              dayDrawerEvents.map((o) => (
                <button key={o.id} onClick={() => { setDayDrawerIso(null); setDrawerOcc(o); }} className="text-left rounded-xl p-3" style={{ background: "var(--secondary)", border: "1px solid var(--border)" }}>
                  <div className="flex items-center justify-between mb-1">
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 12, color: "var(--foreground)" }}>{o.time}</span>
                    <StatusPill status={o.rescheduled ? "rescheduled" : "scheduled"} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>{o.title}</div>
                  <div className="flex items-center gap-1.5 mt-1" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                    <MapPin size={10} /> {o.location}
                  </div>
                </button>
              ))
            )}
          </div>
        </Modal>
      ) : null}

      {/* QR full screen — REAL token via GET /admin/events/:id/qr */}
      {qrScreenOcc ? (
        <Modal onClose={() => setQrScreenOcc(null)} width={640}>
          <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#15803D", letterSpacing: 0.5, textTransform: "uppercase" }}>● Live check-in</div>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)" }}>{qrScreenOcc.title}</h2>
              <div className="flex items-center gap-3 mt-1" style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                <span style={{ fontFamily: "var(--font-mono)" }}>{qrScreenOcc.date} · {qrScreenOcc.time}</span>
                <span>·</span>
                <span>{qrScreenOcc.location}</span>
              </div>
            </div>
            <button onClick={() => setQrScreenOcc(null)} className="rounded-lg p-2" style={{ background: "var(--secondary)", border: "none" }} aria-label="Close">
              <X size={16} />
            </button>
          </div>
          <div className="flex flex-col items-center p-8" style={{ background: "var(--secondary)", overflowY: "auto" }}>
            <QrPanel eventId={qrScreenOcc.id} size={300} />
            <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 12, textAlign: "center", maxWidth: 360 }}>
              Members scan this code at the entrance; the app validates the rotating token server-side, so screenshots go stale. Manual check-ins are logged separately and audited.
            </div>
            <div className="flex gap-2 mt-5 w-full" style={{ maxWidth: 420 }}>
              <button onClick={() => { setManualCheckinFor(qrScreenOcc.id); }} className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5" style={{ background: "var(--nuru-navy)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}>
                <UserPlus size={12} /> Manual check-in
              </button>
              <button onClick={() => { setAttendanceFor(qrScreenOcc); setQrScreenOcc(null); }} className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5" style={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12, fontWeight: 600, color: "var(--foreground)" }}>
                <Users size={12} /> View attendance
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {attendanceFor ? (
        <AttendanceDrawer eventId={attendanceFor.id} title={attendanceFor.title} onClose={() => setAttendanceFor(null)} onManualCheckin={() => setManualCheckinFor(attendanceFor.id)} onError={setError} />
      ) : null}

      {rsvpsFor ? (
        <RsvpDrawer eventId={rsvpsFor.id} title={rsvpsFor.title} onClose={() => setRsvpsFor(null)} onRemind={() => { setRsvpsFor(null); setComposeOpen(true); }} />
      ) : null}

      {manualCheckinFor ? (
        <ManualCheckinModal
          eventId={manualCheckinFor}
          onClose={() => setManualCheckinFor(null)}
          onDone={(name) => {
            setManualCheckinFor(null);
            setNotice(`Checked in ${name}.`);
          }}
          onError={setError}
        />
      ) : null}

      {showCreate ? (
        <SeriesEditor
          onClose={() => setShowCreate(false)}
          onSaved={async (msg) => {
            setShowCreate(false);
            setNotice(msg);
            await refetchAll();
          }}
          onError={setError}
          showOnHomeCount={showOnHomeCount}
        />
      ) : null}

      {composeOpen ? (
        <AnnouncementComposer
          seriesOptions={series ?? []}
          eventOptions={upcoming}
          onClose={() => setComposeOpen(false)}
          onSaved={(msg) => {
            setComposeOpen(false);
            setNotice(msg);
          }}
          onError={setError}
        />
      ) : null}
    </div>
  );
}
