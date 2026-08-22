// Church Services — set up the gathering and put its QR on the screen.
//
// This is the operational half of attendance: Follow-up asks who came, this
// asks what they scan into. Until this page existed a service could only be
// created through the API, so nobody could actually run a Sunday.
//
// TWO THINGS SHAPE THIS PAGE.
//
// 1. THE QR IS PROJECTED, NOT VIEWED. It goes on the sanctuary screen for a
//    room of people to scan from their seats, so "Show QR" opens a full-screen
//    black-on-white presentation with no chrome — not a thumbnail in a table.
//
// 2. THE TOKEN IS STABLE, SO THE WINDOW IS THE CONTROL. A service's scan token
//    is an HMAC of its id; it does not rotate. That is deliberate (a printed
//    code has to keep working through the service) but it means a photograph of
//    the projected code would still scan on Tuesday — unless the check-in window
//    has closed. The window is therefore the security boundary, not an optional
//    extra, so the create form fills it in by default and the projection view
//    states it in words.
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import QRCode from "qrcode";
import {
  Plus, QrCode, X, CalendarDays, Clock, ShieldCheck, ShieldAlert,
  Loader2, Check, Maximize2,
} from "lucide-react";
import {
  ServicesApi, type ChurchService, type ServiceQrPayload, type ServiceSchedule,
} from "../../api/client";
import { errorMessage } from "../../util/error";
import { checkinWindow, hhmm, isoDate, phaseRank, servicePhase, type ServicePhase } from "../../util/serviceSchedule";

const NAVY = "#1d4e86";
const NAVY_INK = "#0b1f33";
const GOLD = "#c89b3c";
const GREEN = "#22c55e";
const MUTED = "#5c6b80";

const SHADOW = "0 1px 3px rgba(11,31,51,0.06), 0 1px 2px rgba(11,31,51,0.04)";
const card = (pad = 16): React.CSSProperties => ({
  background: "#fff", border: "1px solid var(--border)", borderRadius: 16, padding: pad, boxShadow: SHADOW,
});

const PHASE: Record<ServicePhase, { label: string; color: string; bg: string }> = {
  open: { label: "Open for check-in", color: "#166534", bg: "#dcfce7" },
  upcoming: { label: "Upcoming", color: "#1e40af", bg: "#dbeafe" },
  closed: { label: "Closed", color: "#475569", bg: "#f1f5f9" },
  disabled: { label: "QR off", color: "#991b1b", bg: "#fee2e2" },
};

export function Services(): ReactElement {
  const [services, setServices] = useState<ChurchService[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [projecting, setProjecting] = useState<ChurchService | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setServices(await ServicesApi.list());
      setError(null);
    } catch (e) {
      setError(errorMessage(e, "Couldn't load services."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A service crosses into and out of its check-in window while this page is
  // open on a Sunday morning; re-tick so the chip is never stale on screen.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const rows = useMemo(() => {
    const list = services ?? [];
    // Whatever is scannable right now goes to the top — that is what someone
    // opening this page mid-service is reaching for.
    return [...list].sort((a, b) => {
      return (
        phaseRank(servicePhase(a, now)) - phaseRank(servicePhase(b, now)) ||
        new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime()
      );
    });
  }, [services, now]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ margin: 0, fontSize: 22, color: NAVY_INK }}>Church services</h1>
          <p style={{ margin: "4px 0 0", color: MUTED, fontSize: 13 }}>
            Create the gathering members scan into, then put its code on the screen.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 10,
            background: NAVY, color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          <Plus size={15} /> New service
        </button>
      </header>

      {error && (
        <div style={{ ...card(12), borderColor: "#fecaca", background: "#fef2f2", color: "#991b1b", fontSize: 13 }}>
          {error}
        </div>
      )}

      {services === null ? (
        <div style={{ display: "grid", placeItems: "center", padding: 60, color: MUTED }}>
          <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
        </div>
      ) : rows.length === 0 ? (
        <section style={{ ...card(32), textAlign: "center" }}>
          <QrCode size={28} color={GOLD} />
          <h2 style={{ margin: "12px 0 4px", fontSize: 16, color: NAVY_INK }}>No services yet</h2>
          <p style={{ margin: 0, color: MUTED, fontSize: 13 }}>
            Create one and its QR code is ready to project. Members scan it on the way in.
          </p>
        </section>
      ) : (
        <section style={card(0)}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr>
                  {["Service", "Date", "Starts", "Check-in window", "Status", ""].map((h) => (
                    <th key={h} style={{
                      textAlign: "left", padding: "10px 14px", fontSize: 11, fontWeight: 700, color: MUTED,
                      textTransform: "uppercase", letterSpacing: 0.5, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const phase = servicePhase(s, now);
                  return (
                    <tr key={s.service_id}>
                      <td style={cell}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: NAVY_INK }}>{s.title}</span>
                        {!s.counts_for_streak && (
                          <span style={{ marginLeft: 6, fontSize: 11, color: MUTED }}>(not counted)</span>
                        )}
                      </td>
                      <td style={cell}><span style={{ fontSize: 13 }}>{s.service_date}</span></td>
                      <td style={cell}><span style={{ fontSize: 13, color: MUTED }}>{hhmm(s.starts_at)}</span></td>
                      <td style={cell}><Window opens={s.checkin_opens_at} closes={s.checkin_closes_at} /></td>
                      <td style={cell}>
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999,
                          color: PHASE[phase].color, background: PHASE[phase].bg, whiteSpace: "nowrap",
                        }}>{PHASE[phase].label}</span>
                      </td>
                      <td style={cell}>
                        <button
                          onClick={() => setProjecting(s)}
                          disabled={!s.qr_enabled}
                          title={s.qr_enabled ? "Show the code full screen" : "QR check-in is off for this service"}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600,
                            color: s.qr_enabled ? NAVY : MUTED, background: "#fff",
                            border: `1px solid ${s.qr_enabled ? NAVY : "var(--border)"}`, borderRadius: 999,
                            padding: "5px 12px", cursor: s.qr_enabled ? "pointer" : "not-allowed",
                          }}
                        >
                          <QrCode size={13} /> Show QR
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <WeeklyRhythm onMaterialized={() => void load()} />

      {creating && (
        <CreateServiceDialog
          onClose={() => setCreating(false)}
          onCreated={(s) => {
            setCreating(false);
            void load();
            // Straight to the code — creating a service is almost always the
            // step before showing it.
            setProjecting(s);
          }}
        />
      )}
      {projecting && <ProjectionView service={projecting} onClose={() => setProjecting(null)} />}
    </div>
  );
}

const cell: React.CSSProperties = {
  padding: "10px 14px", borderBottom: "1px solid var(--border)", verticalAlign: "middle",
};

function Window({ opens, closes }: { opens: string | null; closes: string | null }): ReactElement {
  if (!opens && !closes) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "#92400e" }}>
        <ShieldAlert size={12} /> always open
      </span>
    );
  }
  return (
    <span style={{ fontSize: 12, color: MUTED }}>
      {opens ? hhmm(opens) : "any time"} – {closes ? hhmm(closes) : "no close"}
    </span>
  );
}

// ── Create ─────────────────────────────────────────────────────────────────

function CreateServiceDialog({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (s: ChurchService) => void;
}): ReactElement {
  const today = new Date();
  const [title, setTitle] = useState("Sunday Service");
  const [date, setDate] = useState(isoDate(today));
  const [start, setStart] = useState("09:00");
  const [opensBefore, setOpensBefore] = useState(45);
  const [closesAfter, setClosesAfter] = useState(120);
  const [countsForStreak, setCountsForStreak] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      // The browser's own zone is the right one: whoever is setting this up is
      // at the church, and toISOString folds the offset in correctly.
      const startsAt = new Date(`${date}T${start}:00`);
      if (Number.isNaN(startsAt.getTime())) throw new Error("That date and time don't parse.");
      const window = checkinWindow(startsAt, opensBefore, closesAfter);
      const created = await ServicesApi.create({
        title: title.trim(),
        service_date: date,
        starts_at: startsAt.toISOString(),
        checkin_opens_at: window.opens_at,
        checkin_closes_at: window.closes_at,
        qr_enabled: true,
        counts_for_streak: countsForStreak,
      });
      onCreated(created);
    } catch (e) {
      setError(errorMessage(e, "Couldn't create the service."));
      setBusy(false);
    }
  };

  return (
    <Overlay onClose={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...card(20), width: "min(460px, 92vw)", display: "grid", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <CalendarDays size={18} color={NAVY} />
          <h2 style={{ margin: 0, fontSize: 17, color: NAVY_INK, flex: 1 }}>New service</h2>
          <button onClick={onClose} style={iconBtn} aria-label="Close"><X size={16} /></button>
        </div>

        <Field label="Name">
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={input} placeholder="Sunday Second Service" />
        </Field>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={input} />
          </Field>
          <Field label="Starts">
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={input} />
          </Field>
        </div>

        <div style={{ background: "#fffbeb", border: "1px solid #f5e0a8", borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, color: "#7a5410" }}>
            <ShieldCheck size={13} /> Check-in window
          </div>
          <p style={{ margin: 0, fontSize: 11.5, color: "#7a5410", lineHeight: 1.5 }}>
            The code doesn&apos;t change during the service, so someone could photograph
            it. The window is what stops that photo working later — keep it tight.
          </p>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
            <Field label="Opens before (min)">
              <input type="number" min={0} max={1440} value={opensBefore}
                onChange={(e) => setOpensBefore(Number(e.target.value))} style={input} />
            </Field>
            <Field label="Closes after (min)">
              <input type="number" min={0} max={1440} value={closesAfter}
                onChange={(e) => setClosesAfter(Number(e.target.value))} style={input} />
            </Field>
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 12.5, color: NAVY_INK, cursor: "pointer" }}>
          <input type="checkbox" checked={countsForStreak} onChange={(e) => setCountsForStreak(e.target.checked)}
            style={{ marginTop: 2 }} />
          <span>
            Counts toward attendance streaks
            <span style={{ display: "block", color: MUTED, fontSize: 11, marginTop: 1 }}>
              Turn off for an extra or optional gathering, so missing it isn&apos;t held against anyone.
            </span>
          </span>
        </label>

        {error && <div style={{ fontSize: 12.5, color: "#991b1b" }}>{error}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ ...ghostBtn }}>Cancel</button>
          <button
            onClick={() => void submit()}
            disabled={busy || !title.trim()}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 10,
              background: busy || !title.trim() ? "#9db4d0" : NAVY, color: "#fff", border: "none",
              fontSize: 13, fontWeight: 600, cursor: busy || !title.trim() ? "default" : "pointer",
            }}
          >
            {busy ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={14} />}
            Create &amp; show code
          </button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Projection: the code, on the sanctuary screen ──────────────────────────

function ProjectionView({ service, onClose }: { service: ChurchService; onClose: () => void }): ReactElement {
  const [qr, setQr] = useState<ServiceQrPayload | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await ServicesApi.qr(service.service_id);
        if (cancelled) return;
        setQr(payload);
        // Large and low-margin: this is read across a room, off a projector.
        const url = await QRCode.toDataURL(payload.payload, {
          width: 1200, margin: 1, errorCorrectionLevel: "M",
          color: { dark: "#0B1F33", light: "#FFFFFF" },
        });
        if (!cancelled) setDataUrl(url);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e, "Couldn't load the code."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [service.service_id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fullscreen = (): void => {
    const el = document.documentElement;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000, background: "#fff",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: 24,
    }}>
      <div style={{ position: "absolute", top: 16, right: 16, display: "flex", gap: 8 }}>
        <button onClick={fullscreen} style={iconBtn} title="Full screen"><Maximize2 size={16} /></button>
        <button onClick={onClose} style={iconBtn} aria-label="Close"><X size={16} /></button>
      </div>

      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: GOLD, textTransform: "uppercase" }}>
          Scan to check in
        </div>
        <h1 style={{ margin: "6px 0 0", fontSize: "clamp(22px, 3.4vw, 40px)", color: NAVY_INK }}>{service.title}</h1>
        <div style={{ marginTop: 4, fontSize: "clamp(12px, 1.4vw, 16px)", color: MUTED }}>
          {service.service_date} · {hhmm(service.starts_at)}
        </div>
      </div>

      {error ? (
        <div style={{ color: "#991b1b", fontSize: 14 }}>{error}</div>
      ) : dataUrl ? (
        <img
          src={dataUrl}
          alt={`Check-in QR code for ${service.title}`}
          style={{
            width: "min(62vh, 62vw)", height: "min(62vh, 62vw)",
            imageRendering: "pixelated", display: "block",
          }}
        />
      ) : (
        <div style={{ width: "min(62vh, 62vw)", height: "min(62vh, 62vw)", display: "grid", placeItems: "center", color: MUTED }}>
          <Loader2 size={26} style={{ animation: "spin 1s linear infinite" }} />
        </div>
      )}

      <div style={{ textAlign: "center", maxWidth: 620 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, color: NAVY_INK }}>
          <Clock size={14} color={GREEN} />
          {service.checkin_opens_at || service.checkin_closes_at ? (
            <span>
              Check-in {service.checkin_opens_at ? `opens ${hhmm(service.checkin_opens_at)}` : "is open"}
              {service.checkin_closes_at ? `, closes ${hhmm(service.checkin_closes_at)}` : ""}
            </span>
          ) : (
            <span style={{ color: "#92400e" }}>This code has no closing time — it will keep working after today.</span>
          )}
        </div>
        {qr && (
          <div style={{ marginTop: 8, fontSize: 10, color: "#a8b3c2", fontFamily: "var(--font-mono)", letterSpacing: 0.4 }}>
            {qr.payload.slice(0, 28)}…
          </div>
        )}
      </div>
    </div>
  );
}

// ── Bits ───────────────────────────────────────────────────────────────────

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }): ReactElement {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 900, background: "rgba(11,31,51,0.45)",
        display: "grid", placeItems: "center", padding: 20,
      }}
    >
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): ReactElement {
  return (
    <label style={{ display: "grid", gap: 5 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const input: React.CSSProperties = {
  padding: "9px 11px", borderRadius: 10, border: "1px solid var(--border)", fontSize: 13,
  background: "#fff", color: NAVY_INK, width: "100%", boxSizing: "border-box",
};
const iconBtn: React.CSSProperties = {
  display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: 999,
  background: "#fff", border: "1px solid var(--border)", color: NAVY_INK, cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  padding: "9px 16px", borderRadius: 10, background: "#fff", border: "1px solid var(--border)",
  fontSize: 13, fontWeight: 600, color: NAVY_INK, cursor: "pointer",
};


// ---------------------------------------------------------------------------
// Weekly rhythm (migration 203). A service is a date; a RHYTHM is "every
// Sunday at nine". Declaring one here means the worker materializes each
// week's service a week ahead — so the standing QR poster at the door never
// resolves to a Sunday nobody remembered to create. A hand-created service
// for the same day and title takes precedence; the rhythm steps aside.
// ---------------------------------------------------------------------------

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function WeeklyRhythm({ onMaterialized }: { onMaterialized: () => void }): ReactElement {
  const [schedules, setSchedules] = useState<ServiceSchedule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("Sunday Service");
  const [day, setDay] = useState(0);
  const [time, setTime] = useState("09:00");

  const load = useCallback(async () => {
    try {
      setSchedules(await ServicesApi.schedules());
      setError(null);
    } catch (e) {
      setError(errorMessage(e, "Couldn't load the weekly rhythm."));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const add = async (): Promise<void> => {
    setBusy(true);
    try {
      await ServicesApi.createSchedule({ title, day_of_week: day, starts_time: time });
      setAdding(false);
      await load();
      // The declare also materialized the nearest occurrence — show it above.
      onMaterialized();
    } catch (e) {
      setError(errorMessage(e, "Couldn't add the weekly service."));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (s: ServiceSchedule): Promise<void> => {
    try {
      await ServicesApi.setScheduleActive(s.schedule_id, !s.is_active);
      await load();
    } catch (e) {
      setError(errorMessage(e, "Couldn't update the schedule."));
    }
  };

  return (
    <section style={card(16)}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 style={{ margin: 0, fontSize: 15, color: NAVY_INK, display: "flex", alignItems: "center", gap: 8 }}>
            <CalendarDays size={16} color={GOLD} /> Weekly rhythm
          </h2>
          <p style={{ margin: "3px 0 0", color: MUTED, fontSize: 12.5 }}>
            Each week&apos;s service is created automatically, a week ahead — the printed door code always
            has a service to point at. A service you create by hand for the same day takes precedence.
          </p>
        </div>
        <button onClick={() => setAdding((v) => !v)} style={ghostBtn}>
          {adding ? "Cancel" : "Add weekly service"}
        </button>
      </div>

      {error && <p style={{ color: "#991b1b", fontSize: 12.5, margin: "10px 0 0" }}>{error}</p>}

      {adding && (
        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: MUTED, display: "grid", gap: 4 }}>
            TITLE
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, minWidth: 180 }} />
          </label>
          <label style={{ fontSize: 11, fontWeight: 700, color: MUTED, display: "grid", gap: 4 }}>
            DAY
            <select value={day} onChange={(e) => setDay(Number(e.target.value))}
              style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13 }}>
              {DAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 11, fontWeight: 700, color: MUTED, display: "grid", gap: 4 }}>
            STARTS
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13 }} />
          </label>
          <button onClick={() => void add()} disabled={busy || !title.trim()}
            style={{
              padding: "9px 16px", borderRadius: 10, background: busy ? "#9db4cf" : NAVY, color: "#fff",
              border: "none", fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer",
            }}>
            {busy ? "Adding…" : "Add"}
          </button>
          <span style={{ fontSize: 11.5, color: MUTED }}>
            Check-in opens 45 min before and closes 4 h after the start.
          </span>
        </div>
      )}

      {schedules !== null && schedules.length > 0 && (
        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          {schedules.map((s) => (
            <div key={s.schedule_id}
              style={{
                display: "flex", alignItems: "center", gap: 12, padding: "9px 12px", borderRadius: 10,
                border: "1px solid var(--border)", background: s.is_active ? "#fff" : "#f8fafc",
              }}>
              <Clock size={14} color={s.is_active ? NAVY : MUTED} />
              <span style={{ fontSize: 13, fontWeight: 600, color: s.is_active ? NAVY_INK : MUTED }}>{s.title}</span>
              <span style={{ fontSize: 12.5, color: MUTED }}>
                {DAY_NAMES[s.day_of_week]} · {s.starts_time.slice(0, 5)}
              </span>
              <span style={{ flex: 1 }} />
              <button onClick={() => void toggle(s)}
                title={s.is_active ? "Pause — stops future weeks; services already created stay" : "Resume weekly creation"}
                style={{
                  fontSize: 11.5, fontWeight: 700, padding: "4px 11px", borderRadius: 999, cursor: "pointer",
                  border: `1px solid ${s.is_active ? "#bbf7d0" : "var(--border)"}`,
                  background: s.is_active ? "#f0fdf4" : "#fff", color: s.is_active ? "#15803d" : MUTED,
                }}>
                {s.is_active ? "Every week" : "Paused"}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
