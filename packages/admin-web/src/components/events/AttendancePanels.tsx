// Attendance panels: roster drawer (with a REAL CSV export), RSVP drawer, and
// the manual check-in / add-guest modal. All wired to the live endpoints —
// EVENTS_ARCHITECTURE §6.
import { useEffect, useState, type ReactElement } from "react";
import { CheckCircle2, Download, Search, ShieldCheck, UserPlus, X } from "lucide-react";
import {
  OpsApi,
  type EventRoster,
  type MemberRow,
  type RsvpRoster,
  type RsvpRosterRow,
} from "../../api/client";
import { errorMessage } from "../../util/error";
import { fmtTime } from "../../util/dates";
import { Drawer, Field, Modal, StatusPill } from "./kit";

/* ------------------------------------------------------------------ */
/* Attendance drawer (real roster + real CSV export)                   */
/* ------------------------------------------------------------------ */

export function AttendanceDrawer({
  eventId,
  title,
  onClose,
  onManualCheckin,
  onError,
}: {
  eventId: string;
  title: string;
  onClose: () => void;
  onManualCheckin: () => void;
  onError: (m: string) => void;
}): ReactElement {
  const [roster, setRoster] = useState<EventRoster | null>(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    void OpsApi.roster(eventId).then(setRoster).catch(() => setRoster(null));
  }, [eventId]);

  const checkedIn = roster?.checked_in ?? [];
  const guests = roster?.guests ?? [];
  const total = checkedIn.length + guests.length;

  async function exportCsv(): Promise<void> {
    setExporting(true);
    try {
      await OpsApi.downloadAttendanceCsv(eventId);
    } catch (e) {
      onError(errorMessage(e, "Could not export the attendance CSV."));
    } finally {
      setExporting(false);
    }
  }

  return (
    <Drawer onClose={onClose} width={560}>
      <div className="px-6 py-5" style={{ borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6 }}>Attendance list · {title}</div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", marginTop: 4 }}>{total} checked in</h2>
      </div>
      <div className="px-6 py-3">
        <div className="grid" style={{ gridTemplateColumns: "1.3fr 0.7fr 0.7fr 0.8fr", fontSize: 10, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>
          <span>Member</span>
          <span>Check-in</span>
          <span>Method</span>
          <span>Status</span>
        </div>
        {checkedIn.length === 0 && guests.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", padding: "16px 0" }}>No check-ins recorded yet.</div>
        ) : (
          <>
            {checkedIn.map((c) => (
              <div key={c.attendance_id} className="grid items-center py-2.5" style={{ gridTemplateColumns: "1.3fr 0.7fr 0.7fr 0.8fr", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
                <span style={{ fontWeight: 600, color: "var(--foreground)" }}>{c.full_name}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted-foreground)" }}>{fmtTime(new Date(c.checked_in_at))}</span>
                <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{c.method}</span>
                <StatusPill status={c.method.toLowerCase() === "manual" ? "Manual" : "Verified"} />
              </div>
            ))}
            {guests.map((g) => (
              <div key={g.guest_id} className="grid items-center py-2.5" style={{ gridTemplateColumns: "1.3fr 0.7fr 0.7fr 0.8fr", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
                <span style={{ fontWeight: 600, color: "var(--foreground)" }}>{g.guest_name}{g.first_time ? " · first-time" : ""}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted-foreground)" }}>{fmtTime(new Date(g.created_at))}</span>
                <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>Guest</span>
                <StatusPill status="Guest" />
              </div>
            ))}
          </>
        )}
        {(roster?.rsvp_no_show.length ?? 0) > 0 ? (
          <div className="mt-3">
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>RSVP'd but absent ({roster!.rsvp_no_show.length})</div>
            <div className="flex flex-wrap gap-1.5">
              {roster!.rsvp_no_show.map((a) => (
                <span key={a.user_id} className="rounded-full px-2.5 py-1" style={{ background: "#FEF2F2", color: "#B91C1C", fontSize: 11, fontWeight: 600 }}>{a.full_name}</span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="px-6 py-4 flex gap-2" style={{ borderTop: "1px solid var(--border)", background: "var(--secondary)" }}>
        <button onClick={onManualCheckin} className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5" style={{ background: "var(--nuru-navy)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}>
          <UserPlus size={12} /> Manual check-in
        </button>
        <button
          onClick={() => void exportCsv()}
          disabled={exporting}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5"
          style={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12, fontWeight: 600, color: "var(--foreground)", opacity: exporting ? 0.6 : 1 }}
        >
          <Download size={12} /> {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* RSVP drawer                                                         */
/* ------------------------------------------------------------------ */

export function RsvpDrawer({
  eventId,
  title,
  onClose,
  onRemind,
}: {
  eventId: string;
  title: string;
  onClose: () => void;
  onRemind: () => void;
}): ReactElement {
  const [roster, setRoster] = useState<RsvpRoster | null>(null);
  const [filter, setFilter] = useState<"going" | "maybe" | "declined" | "no_response">("going");
  useEffect(() => {
    void OpsApi.rsvpRoster(eventId).then(setRoster).catch(() => setRoster(null));
  }, [eventId]);

  const META: Record<string, { label: string; fg: string; bg: string }> = {
    going: { label: "Going", fg: "#0F6B33", bg: "#E8F6EE" },
    maybe: { label: "Maybe", fg: "#B45309", bg: "#FFF7E6" },
    declined: { label: "Not going", fg: "#B91C1C", bg: "#FEF2F2" },
    no_response: { label: "No response", fg: "#6B7280", bg: "#F3F4F6" },
  };

  return (
    <Drawer onClose={onClose} width={520}>
      <div className="px-6 py-5" style={{ borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6 }}>RSVP list · {title}</div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", marginTop: 4 }}>RSVP responses</h2>
      </div>
      {!roster ? (
        <div className="px-6 py-10" style={{ textAlign: "center", color: "var(--muted-foreground)", fontSize: 13 }}>Loading RSVPs…</div>
      ) : (
        (() => {
          const tabs = (["going", "maybe", "declined", "no_response"] as const).filter((k) => k !== "no_response" || roster.no_response_scope === "cell");
          const rows: RsvpRosterRow[] = roster.buckets[filter] ?? [];
          return (
            <>
              <div className="px-6 pt-4 flex items-center gap-2 flex-wrap">
                {tabs.map((k) => (
                  <button key={k} onClick={() => setFilter(k)} className="rounded-full px-3 py-1.5" style={{ fontSize: 12, fontWeight: 700, border: "1px solid var(--border)", background: filter === k ? META[k]!.bg : "var(--input-background)", color: filter === k ? META[k]!.fg : "var(--muted-foreground)" }}>
                    {META[k]!.label} · {roster.counts[k]}
                  </button>
                ))}
              </div>
              <div className="px-6 py-3 flex flex-col gap-1.5" style={{ maxHeight: 420, overflowY: "auto" }}>
                {rows.length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--muted-foreground)", padding: "16px 0", textAlign: "center" }}>No members in “{META[filter]!.label}”.</p>
                ) : (
                  rows.map((m) => (
                    <div key={m.user_id} className="flex items-center justify-between rounded-xl px-3 py-2.5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--nuru-navy)" }}>{m.full_name}</div>
                        <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{m.cell_name ?? "—"}</div>
                      </div>
                      <span className="rounded-full px-2.5 py-1 shrink-0" style={{ fontSize: 10.5, fontWeight: 700, background: META[m.response]?.bg ?? "#F3F4F6", color: META[m.response]?.fg ?? "#6B7280" }}>
                        {m.responded_at ? new Date(m.responded_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : META[m.response]?.label ?? "—"}
                      </span>
                    </div>
                  ))
                )}
                {roster.no_response_scope !== "cell" && (
                  <p style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 6 }}>A no-response list is only available for cell-scoped events.</p>
                )}
              </div>
              <div className="px-6 py-4" style={{ borderTop: "1px solid var(--border)" }}>
                <button onClick={onRemind} className="w-full rounded-xl" style={{ height: 42, background: "var(--nuru-navy)", color: "#fff", fontSize: 13, fontWeight: 700, border: "none" }}>
                  Send reminder announcement
                </button>
              </div>
            </>
          );
        })()
      )}
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* Manual check-in modal (member search / walk-in guest)               */
/* ------------------------------------------------------------------ */

export function ManualCheckinModal({ eventId, onClose, onDone, onError }: { eventId: string; onClose: () => void; onDone: (name: string) => void; onError: (m: string) => void }): ReactElement {
  const [tab, setTab] = useState<"member" | "guest">("member");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [firstTime, setFirstTime] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      if (query.trim()) void OpsApi.members({ search: query.trim() }).then((r) => setResults(r.data.slice(0, 8))).catch(() => setResults([]));
      else setResults([]);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  async function checkIn(m: MemberRow): Promise<void> {
    setBusy(true);
    try {
      await OpsApi.manualCheckIn(eventId, { user_id: m.user_id, ...(note.trim() ? { note: note.trim() } : {}) });
      onDone(m.full_name);
    } catch (e) {
      onError(errorMessage(e, "Check-in failed."));
    } finally {
      setBusy(false);
    }
  }
  async function addGuest(): Promise<void> {
    if (!guestName.trim()) return;
    setBusy(true);
    try {
      await OpsApi.addGuest(eventId, { guest_name: guestName.trim(), ...(guestPhone.trim() ? { phone: guestPhone.trim() } : {}), first_time: firstTime });
      onDone(guestName.trim());
    } catch (e) {
      onError(errorMessage(e, "Could not add guest."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} width={480}>
      <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20 }}>Manual check-in</h2>
        <button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", border: "none" }} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div className="px-6 pt-4">
        <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: "var(--secondary)", width: "fit-content" }}>
          {(["member", "guest"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className="rounded-lg px-3 py-1.5" style={{ background: tab === t ? "var(--card)" : "transparent", color: "var(--foreground)", fontSize: 12, fontWeight: tab === t ? 700 : 500, border: "none", textTransform: "capitalize" }}>
              {t}
            </button>
          ))}
        </div>
      </div>
      {tab === "member" ? (
        <div className="px-6 py-5 flex flex-col gap-4" style={{ overflowY: "auto" }}>
          <Field label="Search member">
            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: "var(--input-background)", border: "1px solid var(--border)" }}>
              <Search size={14} style={{ color: "var(--muted-foreground)" }} />
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search member name…" className="flex-1 bg-transparent outline-none" style={{ fontSize: 13 }} />
            </div>
          </Field>
          <div className="flex flex-col gap-1.5" style={{ maxHeight: 240, overflowY: "auto" }}>
            {results.map((m) => (
              <button key={m.user_id} onClick={() => void checkIn(m)} disabled={busy} className="flex items-center gap-3 rounded-lg px-3 py-2 text-left" style={{ border: "1px solid var(--border)", background: "var(--card)" }}>
                <div className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 30, height: 30, background: "var(--nuru-navy)", color: "#fff", fontSize: 11, fontWeight: 700 }}>
                  {m.full_name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--nuru-navy)" }}>{m.full_name}</div>
                  <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{m.cell_name ?? "—"} · L{m.current_level ?? "—"}</div>
                </div>
                <CheckCircle2 size={16} style={{ color: "var(--nuru-gold)" }} />
              </button>
            ))}
            {query.trim() && results.length === 0 ? <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", padding: "8px 4px" }}>No matches.</p> : null}
          </div>
          <Field label="Note (optional)">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. QR scan failed" className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13 }} />
          </Field>
          <div className="rounded-xl p-3 flex items-start gap-2" style={{ background: "#FFFBEB", border: "1px solid #F5E0A8" }}>
            <ShieldCheck size={13} style={{ color: "#A87616", marginTop: 2 }} />
            <div style={{ fontSize: 11, color: "#7A5410" }}>Manual check-ins are audited and visible in the attendance log.</div>
          </div>
        </div>
      ) : (
        <div className="px-6 py-5 flex flex-col gap-4">
          <Field label="Guest name *">
            <input autoFocus value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Visitor name" className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13 }} />
          </Field>
          <Field label="Phone">
            <input value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder="+254 …" className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13 }} />
          </Field>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <span onClick={() => setFirstTime((v) => !v)} style={{ width: 36, height: 20, borderRadius: 999, background: firstTime ? "#16A34A" : "var(--switch-background)", position: "relative", flexShrink: 0 }}>
              <span style={{ position: "absolute", top: 2, left: firstTime ? 18 : 2, width: 16, height: 16, borderRadius: 999, background: "#fff", transition: "left 0.15s" }} />
            </span>
            <span style={{ fontSize: 13, color: "var(--foreground)", fontWeight: 500 }}>First-time visitor</span>
          </label>
        </div>
      )}
      <div className="px-6 py-4 flex items-center justify-end gap-2" style={{ background: "var(--secondary)", borderTop: "1px solid var(--border)" }}>
        <button onClick={onClose} className="rounded-xl px-4 py-2.5" style={{ fontSize: 13, fontWeight: 600, background: "transparent", border: "none", color: "var(--foreground)" }}>Cancel</button>
        {tab === "guest" && (
          <button onClick={() => void addGuest()} disabled={busy || !guestName.trim()} className="flex items-center gap-2 rounded-xl px-4 py-2.5" style={{ background: !guestName.trim() ? "var(--muted)" : "var(--nuru-navy)", color: !guestName.trim() ? "var(--muted-foreground)" : "#fff", fontSize: 13, fontWeight: 600, border: "none" }}>
            <UserPlus size={14} /> Add guest
          </button>
        )}
      </div>
    </Modal>
  );
}
