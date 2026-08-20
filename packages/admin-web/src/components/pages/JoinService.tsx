// The standing poster's landing page: pathway.nuruplace.org/jc/<code>.
//
// This is the ONE page in the portal a stranger is meant to reach — someone at
// the door pointing their phone's own camera at a printed QR, no app, no
// account. Everything about it follows from that:
//
//   * It resolves the code at load time (GET /v1/join/congregation/:code), so
//     the same poster means this Sunday's service this Sunday and next
//     Sunday's service next Sunday. Outside a check-in window it shows the
//     next service instead of a form — the poster is inert six days a week.
//   * It talks to the API with RAW fetch, never the portal's client. The
//     client persists sessions and bounces 401s to /login; a member checking
//     in must not leave a member token in the staff console's storage, and a
//     guest must not see a staff login screen. Tokens here live in a local
//     variable and die with the tab.
//   * A guest who types an email we already know is steered to the member
//     path with their email carried over — the join endpoint refuses to mint
//     a second identity for the same person (the 2026-08-13 audit), and the
//     door is the worst place to create one.
import { useEffect, useState, type ReactElement, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { Loader2, QrCode, CalendarDays, CheckCircle2, UserPlus, LogIn } from "lucide-react";

const NAVY = "#1d4e86";
const NAVY_INK = "#0b1f33";
const GOLD = "#c89b3c";
const MUTED = "#64748b";

const API = import.meta.env.VITE_API_BASE ?? "/v1";

interface OpenService { service_id: string; title: string; starts_at: string; scan_token: string }
type Resolution =
  | { congregation: string; open: true; service: OpenService }
  | { congregation: string; open: false; next: { title: string; starts_at: string } | null };

/** Raw fetch that surfaces the API's message instead of an HTTP code. */
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: unknown }).message)
        : "Something went wrong — please try again";
    throw new ApiFail(res.status, msg);
  }
  return body as T;
}
class ApiFail extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const input = {
  width: "100%", padding: "12px 14px", fontSize: 16, borderRadius: 10,
  border: "1px solid #d3dce6", background: "#fff", color: NAVY_INK, boxSizing: "border-box",
} as const;
const label = {
  display: "block", fontSize: 11, fontWeight: 700, color: NAVY_INK,
  margin: "14px 0 6px", letterSpacing: "0.08em", textTransform: "uppercase",
} as const;

function timeOf(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "long", hour: "numeric", minute: "2-digit", day: "numeric", month: "short",
  });
}

export function JoinService(): ReactElement {
  const { code } = useParams<{ code: string }>();
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [mode, setMode] = useState<"new" | "member">("new");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<"" | "joined" | "checked-in" | "already">("");

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    api<Resolution>(`/join/congregation/${code ?? ""}`)
      .then(setResolution)
      .catch(() => setInvalid(true));
  }, [code]);

  const svc = resolution?.open ? resolution.service : null;

  const joinAsGuest = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!svc) return;
    setBusy(true); setError("");
    try {
      await api(`/join/service/${svc.service_id}`, {
        method: "POST",
        body: JSON.stringify({
          scan_token: svc.scan_token, full_name: fullName,
          phone_number: phone, email: email.trim().toLowerCase(), password,
        }),
      });
      setDone("joined");
    } catch (err) {
      if (err instanceof ApiFail && err.status === 409) {
        // Known email → they are a member; carry the email across.
        setMode("member");
        setError("You already have an account — sign in below to check in.");
      } else {
        setError(err instanceof Error ? err.message : "Could not join — please try again");
      }
    } finally {
      setBusy(false);
    }
  };

  const checkInAsMember = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!svc) return;
    setBusy(true); setError("");
    try {
      const session = await api<{ access_token?: string; mfa_required?: boolean }>(`/auth/login`, {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      if (session.mfa_required || !session.access_token) {
        setError("Your account uses 2-step verification — please check in from the Nuru Pathway app instead.");
        return;
      }
      const result = await api<{ duplicate: boolean }>(`/services/${svc.service_id}/attendance`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ client_scan_id: crypto.randomUUID(), scan_token: svc.scan_token }),
      });
      setDone(result.duplicate ? "already" : "checked-in");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check in — please try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f2f5f9", display: "flex", justifyContent: "center", padding: "32px 16px" }}>
      <div style={{ width: "100%", maxWidth: 430 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, justifyContent: "center" }}>
          <QrCode size={22} color={GOLD} />
          <span style={{ fontWeight: 800, fontSize: 17, color: NAVY_INK }}>
            {resolution?.congregation ?? "Nuru Place"}
          </span>
        </div>

        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 8px 30px rgba(11,31,51,0.08)" }}>
          {invalid && (
            <p style={{ color: MUTED, textAlign: "center", margin: 0 }}>
              This code isn&apos;t valid. Please ask a member of the welcome team.
            </p>
          )}

          {!invalid && !resolution && (
            <div style={{ display: "flex", justifyContent: "center", padding: 20 }}>
              <Loader2 size={22} color={NAVY} style={{ animation: "spin 1s linear infinite" }} />
            </div>
          )}

          {resolution && !resolution.open && (
            <div style={{ textAlign: "center" }}>
              <CalendarDays size={30} color={NAVY} style={{ marginBottom: 10 }} />
              <h2 style={{ margin: "0 0 8px", fontSize: 18, color: NAVY_INK }}>Check-in isn&apos;t open right now</h2>
              <p style={{ color: MUTED, margin: 0, fontSize: 14, lineHeight: 1.5 }}>
                {resolution.next
                  ? <>Join us for <b>{resolution.next.title}</b> — {timeOf(resolution.next.starts_at)}. Scan this code again when you arrive.</>
                  : <>Scan this code again when you arrive for a service.</>}
              </p>
            </div>
          )}

          {svc && done && (
            <div style={{ textAlign: "center" }}>
              <CheckCircle2 size={34} color="#15803d" style={{ marginBottom: 10 }} />
              <h2 style={{ margin: "0 0 8px", fontSize: 19, color: NAVY_INK }}>
                {done === "joined" ? "Welcome — you're in!" : done === "already" ? "Already checked in ✓" : "You're checked in ✓"}
              </h2>
              <p style={{ color: MUTED, fontSize: 14, lineHeight: 1.5, margin: 0 }}>
                {done === "joined"
                  ? <>Your attendance for <b>{svc.title}</b> is recorded and your discipleship pathway is ready. Download the <b>Nuru Pathway</b> app and sign in with the email and password you just chose.</>
                  : <>Your attendance for <b>{svc.title}</b> is recorded. Karibu!</>}
              </p>
            </div>
          )}

          {svc && !done && (
            <>
              <h2 style={{ margin: "0 0 2px", fontSize: 19, color: NAVY_INK }}>{svc.title}</h2>
              <p style={{ margin: "0 0 16px", fontSize: 13, color: MUTED }}>{timeOf(svc.starts_at)}</p>

              <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                {([["new", "I'm new here", UserPlus], ["member", "I'm a member", LogIn]] as const).map(([m, text, Icon]) => (
                  <button key={m} type="button" onClick={() => { setMode(m); setError(""); }}
                    style={{
                      flex: 1, padding: "10px 8px", borderRadius: 10, fontSize: 14, fontWeight: 700,
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer",
                      border: mode === m ? `2px solid ${NAVY}` : "1px solid #d3dce6",
                      background: mode === m ? "#eef4fb" : "#fff", color: mode === m ? NAVY : MUTED,
                    }}>
                    <Icon size={16} /> {text}
                  </button>
                ))}
              </div>

              <form onSubmit={mode === "new" ? joinAsGuest : checkInAsMember}>
                {mode === "new" && (
                  <>
                    <label style={label}>Full name</label>
                    <input style={input} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required />
                    <label style={label}>Phone number</label>
                    <input style={input} value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" autoComplete="tel" placeholder="07…" required />
                  </>
                )}
                <label style={label}>Email</label>
                <input style={input} value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" required />
                <label style={label}>{mode === "new" ? "Choose a password" : "Password"}</label>
                <input style={input} value={password} onChange={(e) => setPassword(e.target.value)} type="password"
                  autoComplete={mode === "new" ? "new-password" : "current-password"} minLength={mode === "new" ? 8 : 1} required />

                {error && <p style={{ color: "#b91c1c", fontSize: 13, margin: "12px 0 0" }}>{error}</p>}

                <button type="submit" disabled={busy}
                  style={{
                    width: "100%", marginTop: 18, padding: "13px 0", borderRadius: 10, border: "none",
                    background: busy ? "#9db4cf" : NAVY, color: "#fff", fontSize: 15.5, fontWeight: 800, cursor: busy ? "default" : "pointer",
                  }}>
                  {busy ? "One moment…" : mode === "new" ? "Join & check in" : "Sign in & check in"}
                </button>
              </form>
            </>
          )}
        </div>

        <p style={{ textAlign: "center", color: MUTED, fontSize: 12, marginTop: 14 }}>
          Nuru Place Discipleship Pathway
        </p>
      </div>
    </div>
  );
}
