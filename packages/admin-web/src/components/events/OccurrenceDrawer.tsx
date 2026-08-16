// Occurrence quick drawer — opened from any calendar surface. Live roster
// metrics, quick actions, and the per-occurrence exception paths (cancel /
// reschedule). The full series workspace is the Command Center page.
// RSVP'd members are notified automatically by the server when an occurrence
// is cancelled or rescheduled (calendar addException) — no fake toggles here.
import { useEffect, useState, type ReactElement } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Bell,
  CalendarDays,
  CheckCircle2,
  Clock,
  Eye,
  MapPin,
  QrCode,
  RefreshCw,
  Send,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { OpsApi, type EventRoster } from "../../api/client";
import { errorMessage } from "../../util/error";
import { CATEGORY_META, Drawer, Field, Metric, Modal, StatusPill, type UiOccurrence } from "./kit";

export function OccurrenceDrawer({
  occ,
  onClose,
  onOpenCenter,
  onQr,
  onAttendance,
  onRsvps,
  onCheckin,
  onAnnounce,
  onChanged,
  onError,
}: {
  occ: UiOccurrence;
  onClose: () => void;
  onOpenCenter: () => void;
  onQr: () => void;
  onAttendance: () => void;
  onRsvps: () => void;
  onCheckin: () => void;
  onAnnounce: () => void;
  onChanged: (message: string) => void;
  onError: (m: string) => void;
}): ReactElement {
  const [roster, setRoster] = useState<EventRoster | null>(null);
  const [showCancel, setShowCancel] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [reschedDate, setReschedDate] = useState("");
  const [reschedTime, setReschedTime] = useState("");
  const [reschedReason, setReschedReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void OpsApi.roster(occ.id).then(setRoster).catch(() => setRoster(null));
  }, [occ.id]);

  async function cancelOccurrence(): Promise<void> {
    setBusy(true);
    try {
      await OpsApi.addEventException(occ.seriesId, {
        original_start_at: occ.originalStartAt,
        is_cancelled: true,
        ...(cancelReason.trim() ? { note: cancelReason.trim() } : {}),
      });
      onChanged("Occurrence cancelled — RSVP'd members are notified.");
    } catch (e) {
      onError(errorMessage(e, "Could not cancel occurrence."));
    } finally {
      setBusy(false);
    }
  }

  async function rescheduleOccurrence(): Promise<void> {
    if (!reschedDate || !reschedTime) {
      onError("Enter a new date and start time to reschedule.");
      return;
    }
    const newStart = new Date(`${reschedDate}T${reschedTime}`);
    if (Number.isNaN(newStart.getTime())) {
      onError("Invalid date or time.");
      return;
    }
    const durationMs = new Date(occ.endsAt).getTime() - new Date(occ.startsAt).getTime();
    const newEnd = new Date(newStart.getTime() + (Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 3_600_000));
    setBusy(true);
    try {
      await OpsApi.addEventException(occ.seriesId, {
        original_start_at: occ.originalStartAt,
        new_start_at: newStart.toISOString(),
        new_end_at: newEnd.toISOString(),
        ...(reschedReason.trim() ? { note: reschedReason.trim() } : {}),
      });
      onChanged("Occurrence rescheduled — RSVP'd members are notified.");
    } catch (e) {
      onError(errorMessage(e, "Could not reschedule occurrence."));
    } finally {
      setBusy(false);
    }
  }

  const action = (icon: ReactElement, label: string, onClick: () => void, opts?: { primary?: boolean; danger?: boolean }): ReactElement => (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-xl px-3 py-2.5"
      style={{
        background: opts?.primary ? "var(--nuru-gold)" : opts?.danger ? "#FEE2E2" : "var(--secondary)",
        color: opts?.primary ? "#fff" : opts?.danger ? "#B91C1C" : "var(--foreground)",
        fontSize: 12,
        fontWeight: 600,
        border: "1px solid",
        borderColor: opts?.primary ? "var(--nuru-gold)" : opts?.danger ? "#FECACA" : "var(--border)",
      }}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <>
      <Drawer onClose={onClose} width={520}>
        <div className="px-6 py-5" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between mb-2">
            <span style={{ fontSize: 10, fontWeight: 700, color: CATEGORY_META[occ.category].color, letterSpacing: 0.5, textTransform: "uppercase" }}>{CATEGORY_META[occ.category].label} occurrence</span>
            <StatusPill status={occ.rescheduled ? "rescheduled" : "scheduled"} />
          </div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--foreground)", lineHeight: 1.2 }}>{occ.title}</h2>
          <div className="flex flex-col gap-1 mt-3" style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
            <span className="flex items-center gap-2">
              <CalendarDays size={12} />
              <span style={{ fontFamily: "var(--font-mono)" }}>{occ.date}</span>
            </span>
            <span className="flex items-center gap-2">
              <Clock size={12} />
              <span style={{ fontFamily: "var(--font-mono)" }}>{occ.time} – {occ.endTime}</span> · {occ.duration}
            </span>
            <span className="flex items-center gap-2">
              <MapPin size={12} />
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(occ.location)}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--nuru-navy)", textDecoration: "underline", textUnderlineOffset: 2 }}
              >
                {occ.location}
              </a>
            </span>
            <span className="flex items-center gap-2">
              <Eye size={12} /> Visibility: {occ.visibility}
            </span>
          </div>
        </div>

        <div className="px-6 py-5">
          <div className="grid grid-cols-3 gap-2 mb-5">
            <Metric label="Checked in" value={String(roster?.checked_in.length ?? 0)} color="#15803D" />
            <Metric label="Guests" value={String(roster?.guests.length ?? 0)} color="var(--nuru-navy)" />
            <Metric label="No-shows" value={String(roster?.rsvp_no_show.length ?? 0)} color="#B91C1C" />
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            {action(<ArrowUpRight size={13} />, "Open command center", onOpenCenter, { primary: true })}
            {action(<QrCode size={13} />, "Show QR", onQr)}
            {action(<Users size={13} />, "View attendance", onAttendance)}
            {action(<UserCheck size={13} />, "View RSVPs", onRsvps)}
            {action(<CheckCircle2 size={13} />, "Manual check-in", onCheckin)}
            {action(<Send size={13} />, "Send announcement", onAnnounce)}
            {action(<RefreshCw size={13} />, "Reschedule", () => setShowReschedule(true))}
            {action(<X size={13} />, "Cancel occurrence", () => setShowCancel(true), { danger: true })}
          </div>

          <div className="rounded-xl mt-2 p-3 flex items-start gap-2" style={{ background: "#FFFBEB", border: "1px solid #F5E0A8" }}>
            <Bell size={13} style={{ color: "#A87616", marginTop: 2, flexShrink: 0 }} />
            <div style={{ fontSize: 11, color: "#7A5410" }}>Cancelling or rescheduling this occurrence affects only this date — RSVP'd members are notified automatically. Series-wide edits live in the command center.</div>
          </div>
        </div>
      </Drawer>

      {showCancel ? (
        <Modal onClose={() => setShowCancel(false)} width={460}>
          <div className="px-6 py-5">
            <div className="flex items-start gap-3">
              <div className="rounded-lg p-2" style={{ background: "#FEE2E2", color: "#B91C1C" }}>
                <AlertCircle size={18} />
              </div>
              <div>
                <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--foreground)" }}>Cancel this occurrence?</h2>
                <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 4 }}>Only this date is cancelled; the rest of the series continues. Members who RSVP'd going receive a cancellation notice.</p>
              </div>
            </div>
            <div className="mt-5">
              <Field label="Reason (shared with members)">
                <textarea value={cancelReason} onChange={(ev) => setCancelReason(ev.target.value)} rows={2} className="w-full rounded-xl px-3 py-2.5 outline-none resize-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13 }} />
              </Field>
            </div>
          </div>
          <div className="px-6 py-4 flex items-center justify-end gap-2" style={{ background: "var(--secondary)", borderTop: "1px solid var(--border)" }}>
            <button onClick={() => setShowCancel(false)} className="rounded-xl px-4 py-2.5" style={{ fontSize: 13, fontWeight: 600, background: "transparent", border: "none", color: "var(--foreground)" }}>Keep event</button>
            <button onClick={() => void cancelOccurrence()} disabled={busy} className="rounded-xl px-4 py-2.5" style={{ background: "#B91C1C", color: "#fff", fontSize: 13, fontWeight: 600, border: "none", opacity: busy ? 0.6 : 1 }}>
              {busy ? "Cancelling…" : "Cancel occurrence"}
            </button>
          </div>
        </Modal>
      ) : null}

      {showReschedule ? (
        <Modal onClose={() => setShowReschedule(false)} width={520}>
          <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20 }}>Reschedule this occurrence</h2>
            <button onClick={() => setShowReschedule(false)} className="rounded-lg p-2" style={{ background: "var(--secondary)", border: "none" }} aria-label="Close">
              <X size={16} />
            </button>
          </div>
          <div className="px-6 py-5 flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="New date">
                <input type="date" value={reschedDate} onChange={(ev) => setReschedDate(ev.target.value)} className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13, fontFamily: "var(--font-mono)" }} />
              </Field>
              <Field label="New start time">
                <input type="time" value={reschedTime} onChange={(ev) => setReschedTime(ev.target.value)} className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13, fontFamily: "var(--font-mono)" }} />
              </Field>
              <Field label="Duration" hint="kept from the series">
                <div className="rounded-xl px-3 py-2.5" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13, color: "var(--muted-foreground)" }}>{occ.duration}</div>
              </Field>
            </div>
            <Field label="Reason (shared with members)">
              <input value={reschedReason} onChange={(ev) => setReschedReason(ev.target.value)} className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13 }} />
            </Field>
            <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>Applies to this occurrence only. To move the whole series (or everything from a date onward), edit the series in the command center.</div>
          </div>
          <div className="px-6 py-4 flex items-center justify-end gap-2" style={{ background: "var(--secondary)", borderTop: "1px solid var(--border)" }}>
            <button onClick={() => setShowReschedule(false)} className="rounded-xl px-4 py-2.5" style={{ fontSize: 13, fontWeight: 600, background: "transparent", border: "none", color: "var(--foreground)" }}>Cancel</button>
            <button onClick={() => void rescheduleOccurrence()} disabled={busy} className="rounded-xl px-4 py-2.5" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 700, border: "none", opacity: busy ? 0.6 : 1 }}>
              {busy ? "Rescheduling…" : "Reschedule"}
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
