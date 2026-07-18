// Series editor (EVENTS_ARCHITECTURE §9 "Editing") — grouped sections
// (General · Schedule & Recurrence · Registration & Attendance · Media ·
// Announcements · Automations · Publishing · Advanced) with Google-style
// recurrence editing:
//   · INTERVAL ("every N days/weeks/months", server cap 4)
//   · end conditions (never / until a date / after N occurrences)
//   · edit-scope chooser — "Only this occurrence" (exceptions path),
//     "This and following" (POST /split), "Entire series" (PUT).
// Every toggle writes a real column or the automation JSONB — nothing cosmetic.
import { useEffect, useMemo, useState, type ReactElement } from "react";
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  Home,
  MapPin,
  QrCode,
  Repeat,
  Star,
  ShieldCheck,
  Users,
  Video,
  X,
} from "lucide-react";
import {
  AdminApi,
  OpsApi,
  type AdminSeriesDetail,
  type EngagementCellRow,
  type SeriesAutomation,
} from "../../api/client";
import { errorMessage } from "../../util/error";
import { fmtDateTime } from "../../util/dates";
import { CATEGORY_META, Field, ImagesField, Modal, SectionDivider, Toggle, type EventCategory } from "./kit";

/* ------------------------------------------------------------------ */
/* Recurrence model                                                    */
/* ------------------------------------------------------------------ */

type Freq = "once" | "DAILY" | "WEEKLY" | "MONTHLY";
type EndKind = "never" | "until" | "count";
const WEEKDAY_RRULE = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

interface RecurrenceState {
  freq: Freq;
  interval: number; // 1..4 (server cap)
  days: Set<number>; // weekly BYDAY
  end: EndKind;
  untilDate: string; // YYYY-MM-DD
  count: number;
}

function parseRrule(rrule: string | null): RecurrenceState {
  const base: RecurrenceState = { freq: "once", interval: 1, days: new Set([0]), end: "never", untilDate: "", count: 12 };
  if (!rrule) return base;
  const up = rrule.toUpperCase();
  const freq = /FREQ=(DAILY|WEEKLY|MONTHLY)/.exec(up)?.[1] as Exclude<Freq, "once"> | undefined;
  if (!freq) return base;
  base.freq = freq;
  const interval = /INTERVAL=(\d+)/.exec(up)?.[1];
  if (interval) base.interval = Math.min(4, Math.max(1, parseInt(interval, 10)));
  const byday = /BYDAY=([A-Z,]+)/.exec(up)?.[1];
  if (byday) {
    const days = new Set<number>();
    for (const d of byday.split(",")) {
      const i = WEEKDAY_RRULE.indexOf(d as (typeof WEEKDAY_RRULE)[number]);
      if (i >= 0) days.add(i);
    }
    if (days.size > 0) base.days = days;
  }
  const until = /UNTIL=(\d{4})(\d{2})(\d{2})/.exec(up);
  if (until) {
    base.end = "until";
    base.untilDate = `${until[1]}-${until[2]}-${until[3]}`;
  }
  const count = /COUNT=(\d+)/.exec(up)?.[1];
  if (count) {
    base.end = "count";
    base.count = parseInt(count, 10);
  }
  return base;
}

function buildRrule(r: RecurrenceState): string | null {
  if (r.freq === "once") return null;
  const parts: string[] = [`FREQ=${r.freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.freq === "WEEKLY" && r.days.size > 0) {
    parts.push(`BYDAY=${[...r.days].sort((a, b) => a - b).map((i) => WEEKDAY_RRULE[i]).join(",")}`);
  }
  // UNTIL is floating local wall-clock in this backend's RRULE model (see
  // splitSeries) — end-of-day so the last day is inclusive.
  if (r.end === "until" && r.untilDate) parts.push(`UNTIL=${r.untilDate.replace(/-/g, "")}T235959Z`);
  if (r.end === "count") parts.push(`COUNT=${Math.min(260, Math.max(1, r.count))}`);
  return parts.join(";");
}

function cadencePreview(r: RecurrenceState, time: string): string {
  if (r.freq === "once") return `One-off · ${time}`;
  const every = r.interval > 1 ? `Every ${r.interval} ` : "Every ";
  const unit = r.freq === "DAILY" ? (r.interval > 1 ? "days" : "day") : r.freq === "WEEKLY" ? (r.interval > 1 ? "weeks" : "week") : r.interval > 1 ? "months" : "month";
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const onDays = r.freq === "WEEKLY" && r.days.size > 0 ? ` on ${[...r.days].sort((a, b) => a - b).map((i) => DAYS[i]).join(", ")}` : "";
  const end = r.end === "until" && r.untilDate ? ` · until ${r.untilDate}` : r.end === "count" ? ` · ${r.count} times` : "";
  return `${every}${unit}${onDays} · ${time}${end}`;
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

type EditScope = "series" | "following" | "occurrence";

const DURATIONS: Array<{ v: number; l: string }> = [
  { v: 30, l: "30 min" },
  { v: 45, l: "45 min" },
  { v: 60, l: "1 hour" },
  { v: 90, l: "1h 30m" },
  { v: 120, l: "2 hours" },
  { v: 150, l: "2h 30m" },
  { v: 180, l: "3 hours" },
  { v: 240, l: "4 hours" },
  { v: 360, l: "6 hours" },
  { v: 480, l: "8 hours" },
];

const REMINDER_PRESETS: Array<{ v: number; l: string }> = [
  { v: 10, l: "10 min" },
  { v: 60, l: "1 h" },
  { v: 180, l: "3 h" },
  { v: 1440, l: "24 h" },
  { v: 2880, l: "48 h" },
];

export function SeriesEditor({
  editing,
  occurrence,
  onClose,
  onSaved,
  onError,
  showOnHomeCount = 0,
}: {
  /** Full admin series detail when editing; omit to create. */
  editing?: AdminSeriesDetail | null;
  /** Occurrence context (enables the "Only this occurrence" scope). */
  occurrence?: { occurrence_id: string; original_start_at: string; start_at: string } | null;
  onClose: () => void;
  onSaved: (message: string, seriesId?: string) => void;
  onError: (m: string) => void;
  /** Series flagged "Show on Home" elsewhere — powers the ">5 flagged" hint. */
  showOnHomeCount?: number;
}): ReactElement {
  const isEdit = !!editing;

  // ---- General ----
  const [title, setTitle] = useState(editing?.title ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [category, setCategory] = useState<EventCategory>((editing?.category as EventCategory | null) ?? "worship");
  const [location, setLocation] = useState(editing?.location ?? "");
  const [visibility, setVisibility] = useState<"congregation" | "cell" | "leaders">(editing?.visibility ?? "congregation");
  const [cellGroupId, setCellGroupId] = useState<string>(editing?.cell_group_id ?? "");
  const [cells, setCells] = useState<EngagementCellRow[]>([]);

  // ---- Schedule & Recurrence ----
  const initialDt = editing?.dtstart_local ?? "";
  const [startDate, setStartDate] = useState(initialDt ? initialDt.slice(0, 10) : "");
  const [startTime, setStartTime] = useState(initialDt ? initialDt.slice(11, 16) : "09:00");
  const [durationMin, setDurationMin] = useState(editing?.duration_min ?? 90);
  const [rec, setRec] = useState<RecurrenceState>(() => parseRrule(editing?.rrule ?? null));

  // ---- Registration & Attendance (ops toggles — all editable, §3) ----
  const [rsvp, setRsvp] = useState(editing?.rsvp_enabled ?? true);
  const [qr, setQr] = useState(editing?.qr_enabled ?? true);
  const [manual, setManual] = useState(editing?.manual_checkin_enabled ?? true);
  const [checkinOpensMin, setCheckinOpensMin] = useState<string>(editing?.checkin_opens_min_before != null ? String(editing.checkin_opens_min_before) : "");

  // ---- Media ----
  const [primaryImage, setPrimaryImage] = useState(editing?.primary_image_url ?? "");
  const [gallery, setGallery] = useState<string[]>(editing?.gallery_image_urls ?? []);
  const [videoUrl, setVideoUrl] = useState(editing?.video_url ?? "");

  // ---- Automations (§7 — written to the automation JSONB) ----
  const a0 = (editing?.automation ?? {}) as SeriesAutomation;
  const [remindersEnabled, setRemindersEnabled] = useState(editing?.reminders_enabled ?? true);
  const [reminderOffsets, setReminderOffsets] = useState<Set<number>>(() => new Set(a0.reminder_offsets_min ?? [1440, 60]));
  const [autoArchiveOn, setAutoArchiveOn] = useState(a0.auto_archive_days != null);
  const [autoArchiveDays, setAutoArchiveDays] = useState<number>(a0.auto_archive_days ?? 30);
  const [lowRsvpOn, setLowRsvpOn] = useState(a0.low_rsvp_alert != null);
  const [lowRsvpThreshold, setLowRsvpThreshold] = useState<number>(a0.low_rsvp_alert?.threshold ?? 5);
  const [lowRsvpOffset, setLowRsvpOffset] = useState<number>(a0.low_rsvp_alert?.offset_min ?? 2880);
  const [qrAutoReady, setQrAutoReady] = useState(a0.qr_auto_ready ?? false);

  // ---- Publishing ----
  const [isDraft, setIsDraft] = useState((editing?.status ?? "active") === "draft");
  const [featured, setFeatured] = useState(editing?.is_featured ?? false);
  const [showOnHome, setShowOnHome] = useState(editing?.show_on_home ?? false);

  // ---- Scope (edit-only, recurring-only) ----
  const canScope = isEdit && !!editing?.rrule;
  const [scope, setScope] = useState<EditScope>("series");
  const pivotOptions = useMemo(() => editing?.upcoming ?? [], [editing]);
  const [pivot, setPivot] = useState<string>(occurrence?.original_start_at ?? pivotOptions[0]?.original_start_at ?? "");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void AdminApi.engagementReport()
      .then((r) => setCells(r.cells))
      .catch(() => setCells([]));
  }, []);

  const otherShowOnHomeCount = showOnHomeCount - (editing?.show_on_home ? 1 : 0);

  function buildAutomation(): SeriesAutomation {
    const auto: SeriesAutomation = {};
    const offsets = [...reminderOffsets].sort((x, y) => y - x);
    if (offsets.length > 0) auto.reminder_offsets_min = offsets;
    auto.auto_archive_days = autoArchiveOn ? Math.min(365, Math.max(1, autoArchiveDays)) : null;
    auto.low_rsvp_alert = lowRsvpOn ? { threshold: Math.max(1, lowRsvpThreshold), offset_min: lowRsvpOffset } : null;
    if (qrAutoReady) auto.qr_auto_ready = true;
    return auto;
  }

  /** The full series payload the backend's normalized SeriesShape accepts. */
  function buildPayload(): Record<string, unknown> {
    const opensMin = checkinOpensMin.trim() === "" ? null : Math.min(1440, Math.max(0, parseInt(checkinOpensMin, 10) || 0));
    return {
      title: title.trim(),
      description: description.trim() || null,
      location: location.trim() || null,
      category,
      timezone: editing?.timezone ?? "Africa/Nairobi",
      dtstart_local: `${startDate}T${startTime || "09:00"}:00`,
      duration_min: durationMin,
      rrule: buildRrule(rec),
      visibility,
      cell_group_id: visibility === "cell" && cellGroupId ? cellGroupId : null,
      rsvp_enabled: rsvp,
      qr_enabled: qr,
      manual_checkin_enabled: manual,
      reminders_enabled: remindersEnabled,
      checkin_opens_min_before: opensMin,
      primary_image_url: primaryImage.trim() || null,
      gallery_image_urls: gallery.filter(Boolean),
      video_url: videoUrl.trim() || null,
      automation: buildAutomation(),
      status: isDraft ? "draft" : "active",
    };
  }

  /** Only fields that differ from the loaded series — for the split path. */
  function buildChanges(): Record<string, unknown> {
    if (!editing) return buildPayload();
    const full = buildPayload();
    const baseline: Record<string, unknown> = {
      title: editing.title,
      description: editing.description,
      location: editing.location,
      category: editing.category,
      timezone: editing.timezone,
      dtstart_local: editing.dtstart_local,
      duration_min: editing.duration_min,
      rrule: editing.rrule,
      visibility: editing.visibility,
      cell_group_id: editing.cell_group_id,
      rsvp_enabled: editing.rsvp_enabled,
      qr_enabled: editing.qr_enabled,
      manual_checkin_enabled: editing.manual_checkin_enabled,
      reminders_enabled: editing.reminders_enabled,
      checkin_opens_min_before: editing.checkin_opens_min_before,
      primary_image_url: editing.primary_image_url,
      gallery_image_urls: editing.gallery_image_urls ?? [],
      video_url: editing.video_url,
      automation: editing.automation ?? {},
      status: editing.status,
    };
    const changes: Record<string, unknown> = {};
    for (const k of Object.keys(full)) {
      if (JSON.stringify(full[k] ?? null) !== JSON.stringify(baseline[k] ?? null)) changes[k] = full[k];
    }
    return changes;
  }

  async function syncFlags(seriesId: string): Promise<void> {
    if (featured !== (editing?.is_featured ?? false)) {
      if (featured) await OpsApi.setSeriesHomepage(seriesId);
      else await OpsApi.clearSeriesHomepage(seriesId);
    }
    if (showOnHome !== (editing?.show_on_home ?? false)) {
      await OpsApi.setSeriesShowOnHome(seriesId, showOnHome);
    }
  }

  async function save(): Promise<void> {
    setErr(null);
    if (!title.trim()) return setErr("Event title is required.");
    if (!startDate.trim()) return setErr("Start date is required.");
    if (visibility === "cell" && !cellGroupId) return setErr("Pick the cell this event belongs to.");
    if (rec.freq === "WEEKLY" && rec.days.size === 0) return setErr("Pick at least one weekday for a weekly event.");
    if (rec.end === "until" && !rec.untilDate) return setErr("Pick the end date, or switch the series to never end.");
    setBusy(true);
    try {
      if (!isEdit) {
        const created = (await OpsApi.createSeries(buildPayload())) as { series_id?: string };
        if (created?.series_id) await syncFlags(created.series_id);
        onSaved(isDraft ? "Draft saved — publish it when ready." : "Event created. Occurrences are being generated.", created?.series_id);
        return;
      }
      const seriesId = editing!.series_id;
      if (canScope && scope === "occurrence" && occurrence) {
        // Exceptions path — only the schedule applies to a single occurrence.
        const newStart = new Date(`${startDate}T${startTime || "09:00"}:00`);
        if (Number.isNaN(newStart.getTime())) return setErr("Invalid date or time.");
        const newEnd = new Date(newStart.getTime() + durationMin * 60_000);
        await OpsApi.addEventException(seriesId, {
          original_start_at: occurrence.original_start_at,
          new_start_at: newStart.toISOString(),
          new_end_at: newEnd.toISOString(),
        });
        onSaved("Occurrence rescheduled — the rest of the series is unchanged.", seriesId);
        return;
      }
      if (canScope && scope === "following") {
        if (!pivot) return setErr("Pick the occurrence the change starts from.");
        const res = await OpsApi.splitSeries(seriesId, { pivot_start_at: pivot, changes: buildChanges() });
        await syncFlags(res.new_series.series_id).catch(() => undefined);
        onSaved("Series split — changes apply from the selected occurrence onward.", res.new_series.series_id);
        return;
      }
      await OpsApi.updateSeries(seriesId, buildPayload());
      await syncFlags(seriesId);
      onSaved("Series updated.", seriesId);
    } catch (e) {
      const msg = errorMessage(e, isEdit ? "Could not update the event." : "Could not create the event.");
      setErr(msg);
      onError(msg);
    } finally {
      setBusy(false);
    }
  }

  const input = { background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13 } as const;
  const chip = (active: boolean): Record<string, string | number> => ({
    background: active ? "var(--nuru-navy)" : "var(--input-background)",
    color: active ? "#fff" : "var(--foreground)",
    border: "1px solid",
    borderColor: active ? "var(--nuru-navy)" : "var(--border)",
    fontSize: 12,
    fontWeight: active ? 700 : 500,
  });

  return (
    <Modal onClose={onClose} width={760}>
      <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--nuru-gold)", letterSpacing: 0.5, textTransform: "uppercase" }}>{isEdit ? "Edit series" : "New event"}</div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)" }}>{isEdit ? editing!.title : "Create event"}</h2>
        </div>
        <button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", border: "none" }} aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <div className="px-6 py-5 flex flex-col gap-5" style={{ overflowY: "auto" }}>
        {/* ── General ── */}
        <SectionDivider label="General" />
        <Field label="Event title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sunday Worship Service" className="w-full rounded-xl px-4 py-2.5 outline-none" style={input} />
        </Field>
        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What members should know about this gathering…" className="w-full rounded-xl px-3 py-2.5 outline-none resize-none" style={{ ...input, lineHeight: 1.5 }} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Category">
            <select value={category} onChange={(e) => setCategory(e.target.value as EventCategory)} className="w-full rounded-xl px-3 py-2.5 outline-none" style={input}>
              {(Object.keys(CATEGORY_META) as EventCategory[]).map((k) => (
                <option key={k} value={k}>{CATEGORY_META[k].label}</option>
              ))}
            </select>
          </Field>
          <Field label="Venue">
            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={input}>
              <MapPin size={14} style={{ color: "var(--muted-foreground)" }} />
              <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Main Sanctuary" className="flex-1 bg-transparent outline-none" style={{ fontSize: 13 }} />
            </div>
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Visibility">
            <select value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)} className="w-full rounded-xl px-3 py-2.5 outline-none" style={input}>
              <option value="congregation">Whole congregation</option>
              <option value="cell">One cell</option>
              <option value="leaders">Leaders only</option>
            </select>
          </Field>
          {visibility === "cell" ? (
            <Field label="Cell">
              <select value={cellGroupId} onChange={(e) => setCellGroupId(e.target.value)} className="w-full rounded-xl px-3 py-2.5 outline-none" style={input}>
                <option value="">Choose a cell…</option>
                {cells.map((c) => (
                  <option key={c.cell_group_id} value={c.cell_group_id}>{c.name}</option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>

        {/* ── Schedule & Recurrence ── */}
        <SectionDivider label="Schedule & recurrence" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Start date">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ ...input, fontFamily: "var(--font-mono)" }} />
          </Field>
          <Field label="Start time">
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ ...input, fontFamily: "var(--font-mono)" }} />
          </Field>
          <Field label="Duration">
            <select value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} className="w-full rounded-xl px-3 py-2.5 outline-none" style={input}>
              {DURATIONS.map((d) => (
                <option key={d.v} value={d.v}>{d.l}</option>
              ))}
            </select>
          </Field>
          <Field label="Timezone" hint="East Africa Time">
            <div className="rounded-xl px-3 py-2.5" style={{ ...input, color: "var(--muted-foreground)" }}>{editing?.timezone ?? "Africa/Nairobi"}</div>
          </Field>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(
            [
              { k: "once", l: "One-time" },
              { k: "DAILY", l: "Daily" },
              { k: "WEEKLY", l: "Weekly" },
              { k: "MONTHLY", l: "Monthly" },
            ] as Array<{ k: Freq; l: string }>
          ).map((f) => (
            <button key={f.k} onClick={() => setRec((r) => ({ ...r, freq: f.k }))} className="rounded-xl py-2" style={chip(rec.freq === f.k)}>
              <Repeat size={11} className="inline mr-1" /> {f.l}
            </button>
          ))}
        </div>
        {rec.freq !== "once" ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label={`Repeat every`}>
                <div className="flex items-center gap-2">
                  <select value={rec.interval} onChange={(e) => setRec((r) => ({ ...r, interval: Number(e.target.value) }))} className="rounded-xl px-3 py-2.5 outline-none" style={input}>
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <span style={{ fontSize: 13, color: "var(--foreground)" }}>
                    {rec.freq === "DAILY" ? "day(s)" : rec.freq === "WEEKLY" ? "week(s)" : "month(s)"}
                  </span>
                </div>
              </Field>
              <Field label="Ends">
                <div className="flex items-center gap-2 flex-wrap">
                  {(
                    [
                      { k: "never", l: "Never" },
                      { k: "until", l: "On date" },
                      { k: "count", l: "After" },
                    ] as Array<{ k: EndKind; l: string }>
                  ).map((e2) => (
                    <button key={e2.k} onClick={() => setRec((r) => ({ ...r, end: e2.k }))} className="rounded-lg px-3 py-2" style={chip(rec.end === e2.k)}>
                      {e2.l}
                    </button>
                  ))}
                  {rec.end === "until" ? (
                    <input type="date" value={rec.untilDate} onChange={(e) => setRec((r) => ({ ...r, untilDate: e.target.value }))} className="rounded-lg px-2 py-2 outline-none" style={{ ...input, fontFamily: "var(--font-mono)", fontSize: 12 }} />
                  ) : null}
                  {rec.end === "count" ? (
                    <span className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={1}
                        max={260}
                        value={rec.count}
                        onChange={(e) => setRec((r) => ({ ...r, count: parseInt(e.target.value, 10) || 1 }))}
                        className="rounded-lg px-2 py-2 outline-none"
                        style={{ ...input, width: 72, fontFamily: "var(--font-mono)", fontSize: 12 }}
                      />
                      <span style={{ fontSize: 12, color: "var(--foreground)" }}>occurrences</span>
                    </span>
                  ) : null}
                </div>
              </Field>
            </div>
            {rec.freq === "WEEKLY" ? (
              <div className="grid grid-cols-7 gap-2">
                {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => {
                  const active = rec.days.has(i);
                  return (
                    <button
                      key={i}
                      onClick={() =>
                        setRec((r) => {
                          const days = new Set(r.days);
                          if (days.has(i)) days.delete(i);
                          else days.add(i);
                          return { ...r, days };
                        })
                      }
                      className="rounded-lg py-2"
                      style={{ background: active ? "var(--nuru-gold)" : "var(--input-background)", color: active ? "#fff" : "var(--foreground)", fontSize: 12, fontWeight: 700, border: "1px solid", borderColor: active ? "var(--nuru-gold)" : "var(--border)" }}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </>
        ) : null}
        <div className="rounded-xl px-3 py-2.5 flex items-center gap-2" style={{ background: "var(--secondary)", fontSize: 12, color: "var(--foreground)" }}>
          <CalendarDays size={13} style={{ color: "var(--nuru-gold)" }} />
          <span style={{ fontWeight: 600 }}>{cadencePreview(rec, startTime || "09:00")}</span>
        </div>

        {/* ── Registration & Attendance ── */}
        <SectionDivider label="Registration & attendance" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Toggle label="Enable RSVP" on={rsvp} onChange={setRsvp} icon={<Users size={13} />} />
          <Toggle label="Enable QR check-in" on={qr} onChange={setQr} icon={<QrCode size={13} />} />
          <Toggle label="Allow manual check-in" on={manual} onChange={setManual} icon={<CheckCircle2 size={13} />} />
          <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "var(--input-background)", border: "1px solid var(--border)" }}>
            <ShieldCheck size={13} style={{ color: "var(--muted-foreground)" }} />
            <span style={{ fontSize: 13, color: "var(--foreground)", flex: 1 }}>Check-in opens</span>
            <input
              type="number"
              min={0}
              max={1440}
              value={checkinOpensMin}
              onChange={(e) => setCheckinOpensMin(e.target.value)}
              placeholder="—"
              className="rounded-lg px-2 py-1.5 outline-none"
              style={{ ...input, width: 72, fontFamily: "var(--font-mono)", fontSize: 12, background: "var(--card)" }}
            />
            <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>min before</span>
          </div>
        </div>

        {/* ── Media ── */}
        <SectionDivider label="Media" />
        <ImagesField folder="events" primary={primaryImage} gallery={gallery} onPrimary={setPrimaryImage} onGallery={setGallery} />
        <Field label="Video URL" hint="Optional — a highlight or livestream link shown on the mobile event detail.">
          <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={input}>
            <Video size={14} style={{ color: "var(--muted-foreground)" }} />
            <input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://…" className="flex-1 bg-transparent outline-none" style={{ fontSize: 13 }} />
          </div>
        </Field>

        {/* ── Announcements ── */}
        <SectionDivider label="Announcements" />
        {isEdit ? (
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>
            {editing!.announcements.length > 0
              ? `${editing!.announcements.length} announcement${editing!.announcements.length === 1 ? "" : "s"} linked to this series — manage them from the command center.`
              : "No linked announcements yet. Compose one from the command center and attach it to this series."}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>After creating the event you can attach announcements to the series or to a single occurrence from the Announcements studio.</div>
        )}

        {/* ── Automations (§7) ── */}
        <SectionDivider label="Automations" />
        <Toggle label="Send RSVP reminders" on={remindersEnabled} onChange={setRemindersEnabled} icon={<Bell size={13} />} />
        {remindersEnabled ? (
          <Field label="Reminder times (before start)" hint="Sent to members who RSVP'd going. Quiet hours are respected.">
            <div className="flex items-center gap-2 flex-wrap">
              {REMINDER_PRESETS.map((p) => {
                const on = reminderOffsets.has(p.v);
                return (
                  <button
                    key={p.v}
                    onClick={() =>
                      setReminderOffsets((prev) => {
                        const next = new Set(prev);
                        if (next.has(p.v)) next.delete(p.v);
                        else if (next.size < 6) next.add(p.v);
                        return next;
                      })
                    }
                    className="rounded-full px-3 py-1.5"
                    style={chip(on)}
                  >
                    {p.l}
                  </button>
                );
              })}
            </div>
          </Field>
        ) : null}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="flex flex-col gap-2">
            <Toggle label="Auto-archive completed occurrences" on={autoArchiveOn} onChange={setAutoArchiveOn} icon={<CalendarDays size={13} />} />
            {autoArchiveOn ? (
              <div className="flex items-center gap-2 pl-1">
                <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>after</span>
                <input type="number" min={1} max={365} value={autoArchiveDays} onChange={(e) => setAutoArchiveDays(parseInt(e.target.value, 10) || 1)} className="rounded-lg px-2 py-1.5 outline-none" style={{ ...input, width: 72, fontFamily: "var(--font-mono)", fontSize: 12 }} />
                <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>days</span>
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Toggle label="Alert leaders on low RSVPs" on={lowRsvpOn} onChange={setLowRsvpOn} icon={<Users size={13} />} />
            {lowRsvpOn ? (
              <div className="flex items-center gap-2 pl-1 flex-wrap">
                <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>going &lt;</span>
                <input type="number" min={1} value={lowRsvpThreshold} onChange={(e) => setLowRsvpThreshold(parseInt(e.target.value, 10) || 1)} className="rounded-lg px-2 py-1.5 outline-none" style={{ ...input, width: 64, fontFamily: "var(--font-mono)", fontSize: 12 }} />
                <select value={lowRsvpOffset} onChange={(e) => setLowRsvpOffset(Number(e.target.value))} className="rounded-lg px-2 py-1.5 outline-none" style={{ ...input, fontSize: 12 }}>
                  <option value={1440}>24 h before</option>
                  <option value={2880}>48 h before</option>
                  <option value={4320}>72 h before</option>
                </select>
              </div>
            ) : null}
          </div>
        </div>
        <Toggle label="Arm the QR panel automatically at check-in open" on={qrAutoReady} onChange={setQrAutoReady} icon={<QrCode size={13} />} />

        {/* ── Publishing ── */}
        <SectionDivider label="Publishing" />
        <div className="flex flex-col gap-2">
          <Toggle label="Draft — hidden from members until published" on={isDraft} onChange={setIsDraft} icon={<ShieldCheck size={13} />} />
          <Toggle label="Feature on mobile — Home banner + the Events tab hero" on={featured} onChange={setFeatured} icon={<Star size={13} />} />
          <Toggle label="Show on Home — Upcoming events list" on={showOnHome} onChange={setShowOnHome} icon={<Home size={13} />} />
          {showOnHome && otherShowOnHomeCount >= 5 ? (
            <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", paddingLeft: 2 }}>
              {otherShowOnHomeCount + 1} events are flagged — Home shows the soonest 5.
            </div>
          ) : null}
        </div>

        {/* ── Advanced ── */}
        {isEdit ? (
          <>
            <SectionDivider label="Advanced" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <DetailLine label="Series id" value={editing!.series_id} mono />
              <DetailLine label="Created" value={fmtDateTime(editing!.created_at)} mono />
              {editing!.split_from ? <DetailLine label="Split from" value={editing!.split_from} mono /> : null}
              <DetailLine label="Occurrences materialized" value={String(editing!.occurrence_count)} mono />
            </div>
          </>
        ) : null}
      </div>

      {/* ── Footer: scope chooser + actions ── */}
      {err ? (
        <div className="mx-6 mb-1 rounded-lg" role="alert" style={{ background: "#FDECEC", color: "#A8281F", fontSize: 12.5, padding: "9px 12px", border: "1px solid #F5C6C2" }}>{err}</div>
      ) : null}
      <div className="px-6 py-4 flex flex-col gap-3" style={{ background: "var(--secondary)", borderTop: "1px solid var(--border)" }}>
        {canScope ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5 }}>Apply to</span>
            {occurrence ? (
              <ScopeChip active={scope === "occurrence"} onClick={() => setScope("occurrence")} label="Only this occurrence" />
            ) : null}
            <ScopeChip active={scope === "following"} onClick={() => setScope("following")} label="This and following" />
            <ScopeChip active={scope === "series"} onClick={() => setScope("series")} label="Entire series" />
            {scope === "following" ? (
              <select value={pivot} onChange={(e) => setPivot(e.target.value)} className="rounded-lg px-2 py-1.5 outline-none" style={{ ...input, fontSize: 12, background: "var(--card)" }}>
                {pivotOptions.length === 0 ? <option value="">No upcoming occurrences</option> : null}
                {pivotOptions.map((o) => (
                  <option key={o.occurrence_id} value={o.original_start_at}>from {fmtDateTime(o.original_start_at)}</option>
                ))}
              </select>
            ) : null}
            {scope === "occurrence" ? (
              <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>Only the new date/time apply to this occurrence.</span>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2.5" style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", background: "transparent", border: "none" }}>Cancel</button>
          <button onClick={() => void save()} disabled={busy} className="flex items-center gap-2 rounded-xl px-5 py-2.5" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 700, border: "none", opacity: busy ? 0.6 : 1 }}>
            <CheckCircle2 size={14} /> {busy ? "Saving…" : isEdit ? (scope === "following" ? "Split & save" : "Save changes") : isDraft ? "Save draft" : "Create event"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ScopeChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }): ReactElement {
  return (
    <button
      onClick={onClick}
      className="rounded-lg px-3 py-1.5"
      style={{
        background: active ? "var(--nuru-navy)" : "var(--card)",
        color: active ? "#fff" : "var(--foreground)",
        border: "1px solid",
        borderColor: active ? "var(--nuru-navy)" : "var(--border)",
        fontSize: 12,
        fontWeight: active ? 700 : 500,
      }}
    >
      {label}
    </button>
  );
}

function DetailLine({ label, value, mono }: { label: string; value: string; mono?: boolean }): ReactElement {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 12, color: "var(--foreground)", marginTop: 2, fontFamily: mono ? "var(--font-mono)" : undefined, wordBreak: "break-all" }}>{value}</div>
    </div>
  );
}

export type { EditScope };
