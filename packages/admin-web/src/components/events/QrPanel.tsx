// Real QR panel (EVENTS_ARCHITECTURE §6). Renders the ACTUAL HMAC scan token
// from GET /admin/events/:id/qr — the same token the member check-in validator
// verifies — as a scannable QR (qrcode npm package). Shows the expires_at
// countdown and auto-refreshes when the server rotates the secret. The old
// QrPlaceholder (procedural noise + fake "rotates every 30s" copy) is dead.
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import QRCode from "qrcode";
import { RefreshCw, ShieldCheck, Clock } from "lucide-react";
import { OpsApi, type EventQrPanel } from "../../api/client";
import { errorMessage } from "../../util/error";
import { countdownLabel, fmtDateTime } from "../../util/dates";

export function QrPanel({ eventId, size = 220 }: { eventId: string; size?: number }): ReactElement {
  const [panel, setPanel] = useState<EventQrPanel | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const refreshTimer = useRef<number | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const p = await OpsApi.eventQr(eventId);
      setPanel(p);
      setErr(null);
      const url = await QRCode.toDataURL(p.checkin_url, { width: 640, margin: 1, color: { dark: "#0B1F33", light: "#FFFFFF" } });
      setDataUrl(url);
    } catch (e) {
      setErr(errorMessage(e, "Could not load the QR code."));
    } finally {
      setBusy(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Tick the countdown every second; auto-refresh once the token expires.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (!panel) return;
    const ms = new Date(panel.expires_at).getTime() - Date.now();
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => void load(), Math.max(1000, ms + 500));
    return () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, [panel, load]);

  if (err) {
    return (
      <div className="rounded-2xl p-4 flex flex-col items-center gap-2" style={{ background: "var(--secondary)", border: "1px solid var(--border)" }}>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", textAlign: "center" }}>{err}</div>
        <button onClick={() => void load()} className="flex items-center gap-1 rounded-md px-3 py-1.5" style={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12, fontWeight: 600, color: "var(--foreground)" }}>
          <RefreshCw size={12} /> Retry
        </button>
      </div>
    );
  }

  const expired = panel ? new Date(panel.expires_at).getTime() <= now : false;
  const opensAt = panel?.checkin_opens_at ? new Date(panel.checkin_opens_at).getTime() : null;
  const notOpenYet = opensAt !== null && opensAt > now;

  return (
    <div className="flex flex-col items-center">
      <div className="rounded-2xl p-4" style={{ background: "#fff", border: "1px solid var(--border)" }}>
        {dataUrl ? (
          <img src={dataUrl} alt="Event check-in QR code" style={{ width: size, height: size, display: "block", opacity: expired ? 0.35 : 1 }} />
        ) : (
          <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)", fontSize: 12 }}>
            {busy ? "Generating…" : "—"}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 mt-3 flex-wrap justify-center">
        <span className="flex items-center gap-1" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
          <Clock size={11} style={{ color: "var(--nuru-gold)" }} />
          {panel ? (expired ? "Refreshing…" : `Rotates in ${countdownLabel(panel.expires_at, now)}`) : "Loading token…"}
        </span>
        <button onClick={() => void load()} disabled={busy} className="flex items-center gap-1 rounded-md px-2 py-1" style={{ background: "var(--secondary)", fontSize: 11, color: "var(--foreground)", border: "none", opacity: busy ? 0.6 : 1 }}>
          <RefreshCw size={10} /> Refresh
        </button>
      </div>
      {panel ? (
        <code className="mt-2" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted-foreground)", letterSpacing: 0.5, wordBreak: "break-all", maxWidth: size + 32, textAlign: "center" }}>
          {panel.scan_token.slice(0, 16)}…
        </code>
      ) : null}
      {notOpenYet && panel?.checkin_opens_at ? (
        <div className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 mt-2" style={{ background: "#FFFBEB", border: "1px solid #F5E0A8", fontSize: 11, color: "#7A5410" }}>
          <ShieldCheck size={11} /> Check-in opens {fmtDateTime(panel.checkin_opens_at)}
        </div>
      ) : null}
    </div>
  );
}
