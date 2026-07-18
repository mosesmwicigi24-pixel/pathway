// Event Command Center (EVENTS_ARCHITECTURE §9) — the full drawer-to-page
// upgrade at /events/series/:id, backed by the admin series API (§3):
//   · hero — status / cover / category / venue (maps link) / next occurrence /
//     cadence, straight from GET /admin/events/series/:id
//   · attendance block — RSVP counts + conversion, live check-ins (30s poll),
//     guests, first-timers, no-shows, per selected occurrence
//   · REAL QR panel (GET /admin/events/:id/qr) with expiry countdown
//   · linked announcements (all three modes, from the series detail)
//   · timeline — GET .../timeline rendered as a vertical activity feed
//   · quick actions — edit (scope-aware) / pause / split / cancel occurrence /
//     reschedule / delete / export CSV (a real download).
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  Eye,
  MapPin,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Star,
  Trash2,
  UserCheck,
  Users,
  Video,
} from "lucide-react";
import {
  AnnouncementsApi,
  OpsApi,
  type AdminSeriesDetail,
  type EventRoster,
  type RsvpRoster,
  type SeriesTimelineEntry,
} from "../../api/client";
import { errorMessage } from "../../util/error";
import { durationLabel, fmtDateTime, fmtTime, relTime } from "../../util/dates";
import {
  announcementStatusLabel,
  Card,
  CATEGORY_META,
  EmptyState,
  Metric,
  SectionHeader,
  Skeleton,
  StatusPill,
  timelineLabel,
  type EventCategory,
  type UiOccurrence,
} from "./kit";
import { QrPanel } from "./QrPanel";
import { AttendanceDrawer, ManualCheckinModal, RsvpDrawer } from "./AttendancePanels";
import { SeriesEditor } from "./SeriesEditor";
import { AnnouncementComposer, AnnouncementDrawer } from "./AnnouncementsStudio";
import { OccurrenceDrawer } from "./OccurrenceDrawer";

export function SeriesCommandCenter(): ReactElement {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<AdminSeriesDetail | null>(null);
  const [timeline, setTimeline] = useState<SeriesTimelineEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Selected upcoming occurrence (defaults to the next one).
  const [selectedOccId, setSelectedOccId] = useState<string | null>(null);
  const [roster, setRoster] = useState<EventRoster | null>(null);
  const [rsvps, setRsvps] = useState<RsvpRoster | null>(null);

  const [showEditor, setShowEditor] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [rsvpsOpen, setRsvpsOpen] = useState(false);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [occDrawer, setOccDrawer] = useState<UiOccurrence | null>(null);
  const [announcementId, setAnnouncementId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const d = await OpsApi.adminSeriesDetail(id);
      setDetail(d);
      setNotFound(false);
      setSelectedOccId((cur) => cur ?? d.next_occurrence_id ?? d.upcoming[0]?.occurrence_id ?? null);
    } catch (e) {
      setNotFound(true);
      setError(errorMessage(e, "Could not load this series."));
    }
    try {
      setTimeline(await OpsApi.adminSeriesTimeline(id));
    } catch {
      setTimeline([]);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live attendance for the selected occurrence — 30s poll (§9 "check-ins live").
  useEffect(() => {
    if (!selectedOccId) {
      setRoster(null);
      setRsvps(null);
      return;
    }
    let alive = true;
    const tick = (): void => {
      void OpsApi.roster(selectedOccId).then((r) => { if (alive) setRoster(r); }).catch(() => {});
      void OpsApi.rsvpRoster(selectedOccId).then((r) => { if (alive) setRsvps(r); }).catch(() => {});
    };
    tick();
    const t = window.setInterval(tick, 30_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [selectedOccId]);

  const category: EventCategory = (detail?.category as EventCategory | null) ?? "special";
  const meta = CATEGORY_META[category] ?? CATEGORY_META.special;

  const selectedOcc = useMemo(() => detail?.upcoming.find((u) => u.occurrence_id === selectedOccId) ?? null, [detail, selectedOccId]);

  /** UiOccurrence for the selected upcoming row (drives the occurrence drawer). */
  const selectedUi = useMemo<UiOccurrence | null>(() => {
    if (!detail || !selectedOcc) return null;
    const start = new Date(selectedOcc.start_at);
    const end = new Date(start.getTime() + detail.duration_min * 60_000);
    return {
      id: selectedOcc.occurrence_id,
      seriesId: detail.series_id,
      originalStartAt: selectedOcc.original_start_at,
      title: detail.title,
      category,
      iso: selectedOcc.start_at.slice(0, 10),
      startsAt: selectedOcc.start_at,
      endsAt: end.toISOString(),
      date: start.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
      time: fmtTime(start),
      endTime: fmtTime(end),
      duration: durationLabel(start, end),
      location: detail.location ?? "Location TBC",
      cellGroupId: detail.cell_group_id,
      visibility: detail.visibility,
      showOnHome: detail.show_on_home,
      rescheduled: selectedOcc.rescheduled,
    };
  }, [detail, selectedOcc, category]);

  // Conversion across the recent completed occurrences of THIS series.
  const seriesConversion = useMemo(() => {
    if (!detail || detail.recent.length === 0) return null;
    const going = detail.recent.reduce((s, r) => s + r.going, 0);
    const checked = detail.recent.reduce((s, r) => s + r.checked_in, 0);
    return { going, checked, rate: going > 0 ? Math.round((checked / going) * 100) : null };
  }, [detail]);

  const firstTimers = useMemo(() => (roster?.guests ?? []).filter((g) => g.first_time).length, [roster]);

  async function runAction(key: string, fn: () => Promise<unknown>, msg: string, fallback: string): Promise<void> {
    setBusyAction(key);
    try {
      await fn();
      setNotice(msg);
      await load();
    } catch (e) {
      setError(errorMessage(e, fallback));
    } finally {
      setBusyAction(null);
    }
  }

  async function exportCsv(): Promise<void> {
    if (!selectedOccId) {
      setError("Pick an occurrence to export.");
      return;
    }
    setBusyAction("csv");
    try {
      await OpsApi.downloadAttendanceCsv(selectedOccId);
      setNotice("Attendance CSV downloaded.");
    } catch (e) {
      setError(errorMessage(e, "Could not export the attendance CSV."));
    } finally {
      setBusyAction(null);
    }
  }

  function deleteSeries(): void {
    if (!detail) return;
    if (!window.confirm(`Delete "${detail.title}" and all its occurrences? This cannot be undone.`)) return;
    void OpsApi.deleteSeries(detail.series_id)
      .then(() => navigate("/events"))
      .catch((e) => setError(errorMessage(e, "Could not delete the series.")));
  }

  const heroBtn = (primary?: boolean): Record<string, string | number> => ({
    height: 32,
    background: primary ? "var(--nuru-gold)" : "rgba(255,255,255,0.08)",
    color: "#fff",
    fontSize: 12,
    fontWeight: 600,
    border: primary ? "none" : "1px solid rgba(255,255,255,0.15)",
  });

  if (notFound && !detail) {
    return (
      <div style={{ padding: "48px clamp(16px,4vw,48px)" }}>
        <EmptyState icon={<CalendarDays size={20} />} title="Series not found" body={error ?? "It may have been deleted, or belongs to another congregation."} cta="Back to events" onCta={() => navigate("/events")} />
      </div>
    );
  }

  return (
    <div style={{ minWidth: 0, background: "var(--background)", minHeight: "100%" }}>
      {/* ────── Hero ────── */}
      <div
        style={{
          background: detail?.primary_image_url
            ? `linear-gradient(rgba(9,22,34,0.82), rgba(9,22,34,0.92)), url(${detail.primary_image_url}) center/cover`
            : "var(--nuru-dark)",
          padding: "22px clamp(16px,4vw,48px) 26px",
        }}
      >
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}>
            <button onClick={() => navigate("/events")} className="flex items-center gap-1" style={{ background: "none", border: "none", color: "rgba(232,239,245,0.7)", cursor: "pointer", fontSize: 11 }}>
              <ArrowLeft size={11} /> Events
            </button>
            <ChevronRight size={10} />
            <span style={{ color: "#fff", fontWeight: 600 }}>Command center</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setComposeOpen(true)} className="flex items-center gap-2 rounded-lg px-3" style={heroBtn()}>
              <Bell size={13} /> Announce
            </button>
            <button
              onClick={() => detail && void runAction(
                "pause",
                () => (detail.is_paused ? OpsApi.resumeSeries(detail.series_id) : OpsApi.pauseSeries(detail.series_id)),
                detail.is_paused ? "Series resumed." : "Series paused — future occurrences hidden.",
                "Could not update series.",
              )}
              disabled={busyAction === "pause"}
              className="flex items-center gap-2 rounded-lg px-3"
              style={heroBtn()}
            >
              {detail?.is_paused ? <Play size={13} /> : <Pause size={13} />}
              {detail?.is_paused ? "Resume" : "Pause"}
            </button>
            <button onClick={() => void exportCsv()} disabled={busyAction === "csv"} className="flex items-center gap-2 rounded-lg px-3" style={heroBtn()}>
              <Download size={13} /> {busyAction === "csv" ? "Exporting…" : "Export CSV"}
            </button>
            <button onClick={() => setShowEditor(true)} className="flex items-center gap-2 rounded-lg px-3" style={heroBtn(true)}>
              <Pencil size={13} /> Edit series
            </button>
          </div>
        </div>

        {detail ? (
          <div className="mt-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="rounded-full px-2.5 py-0.5" style={{ background: meta.soft, color: meta.color, fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>{meta.label}</span>
              {detail.status === "draft" ? <StatusPill status="draft" /> : detail.is_paused ? <StatusPill status="paused" /> : <StatusPill status="active" />}
              {detail.is_featured ? (
                <span className="flex items-center gap-1 rounded-full px-2.5 py-0.5" style={{ background: "rgba(245,199,126,0.18)", color: "#F5C77E", fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>
                  <Star size={9} /> Featured
                </span>
              ) : null}
              {detail.split_from ? (
                <span className="rounded-full px-2.5 py-0.5" style={{ background: "rgba(255,255,255,0.1)", color: "rgba(232,239,245,0.8)", fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>Split series</span>
              ) : null}
            </div>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(24px, 4vw, 34px)", color: "#fff", lineHeight: 1.15, marginTop: 8 }}>{detail.title}</h1>
            {detail.description ? <p style={{ fontSize: 13, color: "rgba(232,239,245,0.75)", marginTop: 6, maxWidth: 640, lineHeight: 1.5 }}>{detail.description}</p> : null}
            <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap mt-3" style={{ fontSize: 12, color: "rgba(232,239,245,0.75)" }}>
              <span className="flex items-center gap-1.5"><Repeat size={12} /> {detail.cadence}</span>
              <span className="flex items-center gap-1.5">
                <Clock size={12} />
                {detail.next_at ? `Next ${fmtDateTime(detail.next_at)}` : "No upcoming occurrence"}
              </span>
              {detail.location ? (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(detail.location)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5"
                  style={{ color: "#F5C77E", textDecoration: "underline", textUnderlineOffset: 2 }}
                >
                  <MapPin size={12} /> {detail.location}
                </a>
              ) : null}
              {detail.cell_name ? <span className="flex items-center gap-1.5"><Users size={12} /> {detail.cell_name}</span> : null}
              <span className="flex items-center gap-1.5"><Eye size={12} /> {detail.visibility}</span>
              <span className="flex items-center gap-1.5"><UserCheck size={12} /> {detail.follow_count} following</span>
            </div>
          </div>
        ) : (
          <div className="mt-4"><Skeleton height={90} /></div>
        )}
      </div>

      {/* ────── Body ────── */}
      <div style={{ padding: "28px clamp(16px,4vw,48px) 48px" }}>
        <div style={{ maxWidth: 1280, marginInline: "auto" }}>
          {error ? <p style={{ color: "#A8281F", marginBottom: 12, fontSize: 13 }}>{error}</p> : null}
          {notice ? <p style={{ color: "#0F6B33", marginBottom: 12, fontSize: 13 }}>{notice}</p> : null}

          {!detail ? (
            <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
              <div className="flex flex-col gap-5"><Skeleton height={220} /><Skeleton height={180} /><Skeleton height={240} /></div>
              <div className="flex flex-col gap-5"><Skeleton height={320} /><Skeleton height={160} /></div>
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[1fr_340px]" style={{ alignItems: "start" }}>
              {/* ── Left column ── */}
              <div className="flex flex-col gap-5" style={{ minWidth: 0 }}>
                {/* Attendance block */}
                <Card>
                  <SectionHeader
                    title="Attendance"
                    subtitle={selectedOcc ? `Occurrence · ${fmtDateTime(selectedOcc.start_at)}${selectedOcc.rescheduled ? " (rescheduled)" : ""}` : "No upcoming occurrence in the next 90 days"}
                    action={
                      detail.upcoming.length > 0 ? (
                        <select
                          value={selectedOccId ?? ""}
                          onChange={(e) => setSelectedOccId(e.target.value || null)}
                          className="rounded-lg px-2 py-1.5 outline-none"
                          style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 12, fontFamily: "var(--font-mono)" }}
                        >
                          {detail.upcoming.map((u) => (
                            <option key={u.occurrence_id} value={u.occurrence_id}>{fmtDateTime(u.start_at)}</option>
                          ))}
                        </select>
                      ) : undefined
                    }
                  />
                  {selectedOcc ? (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                        <Metric label="Going" value={String(rsvps?.counts.going ?? selectedOcc.going)} color="#15803D" />
                        <Metric label="Maybe" value={String(rsvps?.counts.maybe ?? 0)} color="#B45309" />
                        <Metric label="Declined" value={String(rsvps?.counts.declined ?? 0)} color="#B91C1C" />
                        <Metric label="Checked in" value={String(roster?.checked_in.length ?? selectedOcc.checked_in)} color="var(--nuru-navy)" />
                        <Metric label="Guests" value={String(roster?.guests.length ?? 0)} color="var(--nuru-gold)" />
                        <Metric label="First-timers" value={String(firstTimers)} color="#6366F1" />
                      </div>
                      <div className="flex items-center gap-2 flex-wrap mt-3">
                        <ActionChip icon={<Users size={12} />} label="Full roster" onClick={() => setAttendanceOpen(true)} />
                        <ActionChip icon={<UserCheck size={12} />} label="RSVP list" onClick={() => setRsvpsOpen(true)} />
                        <ActionChip icon={<CheckCircle2 size={12} />} label="Manual check-in" onClick={() => setCheckinOpen(true)} />
                        <ActionChip icon={<Pencil size={12} />} label="Reschedule / cancel" onClick={() => selectedUi && setOccDrawer(selectedUi)} />
                        <ActionChip icon={<Download size={12} />} label="Export CSV" onClick={() => void exportCsv()} />
                        <span style={{ fontSize: 10.5, color: "var(--muted-foreground)", marginLeft: "auto" }}>Live · refreshes every 30s</span>
                      </div>
                    </>
                  ) : (
                    <EmptyState icon={<CalendarDays size={20} />} title="Nothing upcoming" body={detail.is_paused ? "The series is paused — resume it to project future occurrences." : "This series has no occurrence in the next 90 days."} />
                  )}
                  {seriesConversion ? (
                    <div className="mt-4 pt-3 flex items-center gap-2 flex-wrap" style={{ borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--muted-foreground)" }}>
                      <span style={{ fontWeight: 700, color: "var(--foreground)" }}>
                        {seriesConversion.rate != null ? `${seriesConversion.rate}% RSVP → attended` : "No RSVP data yet"}
                      </span>
                      <span>· {seriesConversion.checked} check-ins over the last {detail.recent.length} occurrence{detail.recent.length === 1 ? "" : "s"}</span>
                    </div>
                  ) : null}
                </Card>

                {/* Recent occurrences */}
                <Card padded={false}>
                  <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
                    <span style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--foreground)" }}>Recent occurrences</span>
                  </div>
                  {detail.recent.length === 0 ? (
                    <div className="px-5 py-6" style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>No completed occurrences yet.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full" style={{ borderCollapse: "collapse", minWidth: 480 }}>
                        <thead>
                          <tr style={{ background: "var(--secondary)" }}>
                            {["When", "Going", "Checked in", "Guests", ""].map((h) => (
                              <th key={h} style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6, textAlign: "left", padding: "10px 16px" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {detail.recent.map((r) => (
                            <tr key={r.occurrence_id} style={{ borderTop: "1px solid var(--border)" }}>
                              <td style={{ padding: "10px 16px", fontSize: 12.5, fontWeight: 600, color: "var(--nuru-navy)", whiteSpace: "nowrap" }}>{fmtDateTime(r.occurs_at)}{r.archived_at ? " · archived" : ""}</td>
                              <td style={{ padding: "10px 16px", fontSize: 13, color: "var(--foreground)" }}>{r.going}</td>
                              <td style={{ padding: "10px 16px", fontSize: 13, fontWeight: 700, color: "#0F6B33" }}>{r.checked_in}</td>
                              <td style={{ padding: "10px 16px", fontSize: 13, color: "var(--foreground)" }}>{r.guests}</td>
                              <td style={{ padding: "10px 16px" }}>
                                <button
                                  onClick={() => void OpsApi.downloadAttendanceCsv(r.occurrence_id).catch((e) => setError(errorMessage(e, "Could not export CSV.")))}
                                  className="flex items-center gap-1 rounded-md px-2 py-1"
                                  style={{ background: "var(--secondary)", border: "none", fontSize: 11, fontWeight: 600, color: "var(--foreground)", cursor: "pointer" }}
                                >
                                  <Download size={10} /> CSV
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>

                {/* Linked announcements — all three modes (§5) */}
                <Card>
                  <SectionHeader
                    title="Linked announcements"
                    subtitle="Attached to this series or one of its occurrences"
                    action={
                      <button onClick={() => setComposeOpen(true)} className="flex items-center gap-1 rounded-lg px-3 py-1.5" style={{ background: "var(--nuru-navy)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}>
                        <Plus size={12} /> Compose
                      </button>
                    }
                  />
                  {detail.announcements.length === 0 ? (
                    <EmptyState icon={<Bell size={20} />} title="Nothing linked yet" body="Announcements attached to this series or its occurrences show up here." cta="Compose" onCta={() => setComposeOpen(true)} />
                  ) : (
                    <div className="flex flex-col">
                      {detail.announcements.map((a, i) => (
                        <button key={a.announcement_id} onClick={() => setAnnouncementId(a.announcement_id)} className="text-left flex items-center gap-3 py-2.5" style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)", background: "none" }}>
                          <Bell size={13} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />
                          <div className="flex-1 min-w-0">
                            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</div>
                            <div style={{ fontSize: 11, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>{fmtDateTime(a.sent_at ?? a.scheduled_at)}</div>
                          </div>
                          <span className="rounded-md px-2 py-0.5" style={{ background: a.attachment === "series" ? "#E4E5FB" : "#DBE7FE", color: a.attachment === "series" ? "#4F46E5" : "#1D4ED8", fontSize: 10, fontWeight: 700 }}>{a.attachment}</span>
                          <StatusPill status={announcementStatusLabel({ status: a.status, archived_at: a.archived_at })} />
                        </button>
                      ))}
                    </div>
                  )}
                </Card>

                {/* Timeline (§3) */}
                <Card>
                  <SectionHeader title="Timeline" subtitle="Everything that happened to this series, its occurrences and announcements" />
                  {timeline === null ? (
                    <Skeleton height={160} />
                  ) : timeline.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>No recorded activity yet.</div>
                  ) : (
                    <div style={{ position: "relative", paddingLeft: 18 }}>
                      <div style={{ position: "absolute", left: 5, top: 6, bottom: 6, width: 2, background: "var(--border)" }} />
                      <div className="flex flex-col gap-3">
                        {timeline.slice(0, 40).map((t) => (
                          <div key={t.audit_id} style={{ position: "relative" }}>
                            <span style={{ position: "absolute", left: -17.5, top: 5, width: 9, height: 9, borderRadius: 5, background: dotColor(t.action), border: "2px solid var(--card)" }} />
                            <div style={{ fontSize: 12.5, color: "var(--foreground)" }}>
                              <span style={{ fontWeight: 700 }}>{timelineLabel(t.action)}</span>
                              {t.actor_name ? <span style={{ color: "var(--muted-foreground)" }}> · {t.actor_name}</span> : null}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>{fmtDateTime(t.occurred_at)} · {relTime(t.occurred_at)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              </div>

              {/* ── Right column ── */}
              <div className="flex flex-col gap-5" style={{ minWidth: 0 }}>
                {/* QR panel — REAL token */}
                <Card padded={false}>
                  <div className="px-5 py-4" style={{ background: "var(--nuru-navy)", color: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
                    <div className="flex items-center justify-between mb-1">
                      <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: "rgba(232,239,245,0.7)" }}>Check-in QR</span>
                      {detail.qr_enabled && selectedOcc ? (
                        <span className="rounded-full px-2 py-0.5" style={{ background: "rgba(22,163,74,0.25)", color: "#7FE0A0", fontSize: 10, fontWeight: 700, letterSpacing: 0.5 }}>● LIVE TOKEN</span>
                      ) : null}
                    </div>
                    <h3 style={{ fontFamily: "var(--font-display)", fontSize: 16, lineHeight: 1.2 }}>{selectedOcc ? fmtDateTime(selectedOcc.start_at) : "No occurrence selected"}</h3>
                  </div>
                  <div className="p-5 flex flex-col items-center">
                    {!detail.qr_enabled ? (
                      <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", textAlign: "center", padding: "12px 0" }}>
                        QR check-in is disabled for this series. Enable it in the editor's Registration section.
                      </div>
                    ) : selectedOccId ? (
                      <QrPanel eventId={selectedOccId} size={200} />
                    ) : (
                      <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", textAlign: "center", padding: "12px 0" }}>No upcoming occurrence to arm.</div>
                    )}
                  </div>
                </Card>

                {/* Ops & automation summary (all real columns) */}
                <Card>
                  <SectionHeader title="Operations" />
                  <div className="flex flex-col gap-1.5" style={{ fontSize: 12.5 }}>
                    <OpsRow on={detail.rsvp_enabled} label="RSVP" />
                    <OpsRow on={detail.qr_enabled} label="QR check-in" />
                    <OpsRow on={detail.manual_checkin_enabled} label="Manual check-in" />
                    <OpsRow on={detail.reminders_enabled} label="Reminders" detail={detail.reminders_enabled ? offsetsLabel(detail.automation?.reminder_offsets_min) : undefined} />
                    <OpsRow on={detail.checkin_opens_min_before != null} label="Check-in window" detail={detail.checkin_opens_min_before != null ? `opens ${detail.checkin_opens_min_before} min before` : undefined} />
                    <OpsRow on={detail.automation?.auto_archive_days != null} label="Auto-archive" detail={detail.automation?.auto_archive_days != null ? `after ${detail.automation.auto_archive_days} days` : undefined} />
                    <OpsRow on={detail.automation?.low_rsvp_alert != null} label="Low-RSVP alert" detail={detail.automation?.low_rsvp_alert ? `going < ${detail.automation.low_rsvp_alert.threshold}` : undefined} />
                    <OpsRow on={detail.automation?.qr_auto_ready === true} label="QR auto-ready" />
                  </div>
                  <button onClick={() => setShowEditor(true)} className="w-full mt-4 rounded-xl py-2.5 flex items-center justify-center gap-1.5" style={{ background: "var(--secondary)", border: "1px solid var(--border)", fontSize: 12, fontWeight: 600, color: "var(--foreground)" }}>
                    <Pencil size={12} /> Edit operations & automations
                  </button>
                </Card>

                {/* Media */}
                {(detail.primary_image_url || (detail.gallery_image_urls?.length ?? 0) > 0 || detail.video_url) ? (
                  <Card>
                    <SectionHeader title="Media" />
                    {detail.primary_image_url ? (
                      <img src={detail.primary_image_url} alt="cover" className="w-full rounded-xl mb-2" style={{ maxHeight: 160, objectFit: "cover", border: "1px solid var(--border)" }} />
                    ) : null}
                    {(detail.gallery_image_urls?.length ?? 0) > 0 ? (
                      <div className="flex gap-2 flex-wrap mb-2">
                        {detail.gallery_image_urls!.map((u, i) => (
                          <img key={`${u}-${i}`} src={u} alt={`gallery ${i + 1}`} style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover", border: "1px solid var(--border)" }} />
                        ))}
                      </div>
                    ) : null}
                    {detail.video_url ? (
                      <a href={detail.video_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "var(--secondary)", fontSize: 12, color: "var(--nuru-navy)", fontWeight: 600, textDecoration: "none" }}>
                        <Video size={13} /> Watch video
                      </a>
                    ) : null}
                  </Card>
                ) : null}

                {/* Exceptions */}
                {detail.exceptions.length > 0 ? (
                  <Card>
                    <SectionHeader title="Exceptions" subtitle="Per-occurrence overrides" />
                    <div className="flex flex-col gap-2">
                      {detail.exceptions.map((x) => (
                        <div key={x.exception_id} className="rounded-lg px-3 py-2" style={{ background: "var(--secondary)", fontSize: 12 }}>
                          <div style={{ fontWeight: 700, color: x.is_cancelled ? "#B91C1C" : "#9A3412" }}>
                            {x.is_cancelled ? "Cancelled" : "Rescheduled"} · <span style={{ fontFamily: "var(--font-mono)" }}>{fmtDateTime(x.original_start_at)}</span>
                          </div>
                          {!x.is_cancelled && x.new_start_at ? (
                            <div style={{ color: "var(--muted-foreground)", fontFamily: "var(--font-mono)", fontSize: 11 }}>→ {fmtDateTime(x.new_start_at)}</div>
                          ) : null}
                          {x.note ? <div style={{ color: "var(--muted-foreground)", fontSize: 11, marginTop: 2 }}>{x.note}</div> : null}
                        </div>
                      ))}
                    </div>
                  </Card>
                ) : null}

                {/* Danger zone */}
                <Card>
                  <SectionHeader title="Danger zone" />
                  <button onClick={deleteSeries} className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5" style={{ background: "#FEE2E2", color: "#B91C1C", fontSize: 12, fontWeight: 700, border: "1px solid #FECACA" }}>
                    <Trash2 size={13} /> Delete series & occurrences
                  </button>
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ============== Modals & drawers ============== */}
      {showEditor && detail ? (
        <SeriesEditor
          editing={detail}
          occurrence={selectedOcc ? { occurrence_id: selectedOcc.occurrence_id, original_start_at: selectedOcc.original_start_at, start_at: selectedOcc.start_at } : null}
          onClose={() => setShowEditor(false)}
          onSaved={async (msg, newSeriesId) => {
            setShowEditor(false);
            setNotice(msg);
            if (newSeriesId && newSeriesId !== detail.series_id) {
              navigate(`/events/series/${newSeriesId}`);
              return;
            }
            await load();
          }}
          onError={setError}
        />
      ) : null}

      {composeOpen && detail ? (
        <AnnouncementComposer
          seriesOptions={[detail]}
          eventOptions={[]}
          initialAttachment={{ series_id: detail.series_id }}
          onClose={() => setComposeOpen(false)}
          onSaved={async (msg) => {
            setComposeOpen(false);
            setNotice(msg);
            await load();
          }}
          onError={setError}
        />
      ) : null}

      {attendanceOpen && selectedOccId && detail ? (
        <AttendanceDrawer eventId={selectedOccId} title={detail.title} onClose={() => setAttendanceOpen(false)} onManualCheckin={() => setCheckinOpen(true)} onError={setError} />
      ) : null}

      {rsvpsOpen && selectedOccId && detail ? (
        <RsvpDrawer eventId={selectedOccId} title={detail.title} onClose={() => setRsvpsOpen(false)} onRemind={() => { setRsvpsOpen(false); setComposeOpen(true); }} />
      ) : null}

      {checkinOpen && selectedOccId ? (
        <ManualCheckinModal
          eventId={selectedOccId}
          onClose={() => setCheckinOpen(false)}
          onDone={(name) => {
            setCheckinOpen(false);
            setNotice(`Checked in ${name}.`);
          }}
          onError={setError}
        />
      ) : null}

      {occDrawer ? (
        <OccurrenceDrawer
          occ={occDrawer}
          onClose={() => setOccDrawer(null)}
          onOpenCenter={() => setOccDrawer(null)}
          onQr={() => setOccDrawer(null)}
          onAttendance={() => { setOccDrawer(null); setAttendanceOpen(true); }}
          onRsvps={() => { setOccDrawer(null); setRsvpsOpen(true); }}
          onCheckin={() => { setOccDrawer(null); setCheckinOpen(true); }}
          onAnnounce={() => { setOccDrawer(null); setComposeOpen(true); }}
          onChanged={async (msg) => {
            setOccDrawer(null);
            setNotice(msg);
            await load();
          }}
          onError={setError}
        />
      ) : null}

      {announcementId ? (
        <HubAnnouncementDrawerLoader
          announcementId={announcementId}
          onClose={() => setAnnouncementId(null)}
          onChanged={async (msg) => {
            setAnnouncementId(null);
            setNotice(msg);
            await load();
          }}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

/** Loads the row then renders the shared announcement drawer (the command
 *  center only has the slim linked-announcement shape). */
function HubAnnouncementDrawerLoader({
  announcementId,
  onClose,
  onChanged,
  onError,
}: {
  announcementId: string;
  onClose: () => void;
  onChanged: (message: string) => Promise<void> | void;
  onError: (m: string) => void;
}): ReactElement | null {
  const [row, setRow] = useState<Awaited<ReturnType<typeof AnnouncementsApi.get>> | null>(null);
  useEffect(() => {
    void AnnouncementsApi.get(announcementId).then(setRow).catch(() => {
      onError("Could not load the announcement.");
      onClose();
    });
    // (fetch keyed on the id only; the callbacks are stable enough per open)
  }, [announcementId]);
  if (!row) return null;
  return (
    <AnnouncementDrawer
      row={row}
      onClose={onClose}
      onChanged={(m) => void onChanged(m)}
      onEdit={() => onClose()}
      onError={onError}
    />
  );
}

function ActionChip({ icon, label, onClick }: { icon: ReactElement; label: string; onClick: () => void }): ReactElement {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 rounded-lg px-3 py-2" style={{ background: "var(--secondary)", border: "1px solid var(--border)", fontSize: 12, fontWeight: 600, color: "var(--foreground)" }}>
      {icon}
      {label}
    </button>
  );
}

function OpsRow({ on, label, detail }: { on: boolean; label: string; detail?: string | undefined }): ReactElement {
  return (
    <div className="flex items-center gap-2">
      <span className="rounded-full shrink-0" style={{ width: 8, height: 8, background: on ? "#16A34A" : "#D1D5DB" }} />
      <span style={{ color: "var(--foreground)", fontWeight: 600 }}>{label}</span>
      <span style={{ color: "var(--muted-foreground)", marginLeft: "auto", fontSize: 11.5 }}>{detail ?? (on ? "on" : "off")}</span>
    </div>
  );
}

function offsetsLabel(offsets: number[] | undefined): string {
  const list = offsets && offsets.length > 0 ? offsets : [1440, 60];
  return list
    .map((m) => (m % 1440 === 0 ? `${m / 1440}d` : m % 60 === 0 ? `${m / 60}h` : `${m}m`))
    .join(" · ") + " before";
}

function dotColor(action: string): string {
  if (action.startsWith("announcement.")) return "#6366F1";
  if (action.startsWith("attendance.")) return "#16A34A";
  if (action.includes("cancel") || action.includes("delete")) return "#B91C1C";
  return "var(--nuru-gold)";
}
