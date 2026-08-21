// The standing poster's landing page: pathway.nuruplace.org/jc/<code>.
//
// This is the ONE page in the portal a stranger is meant to reach — someone at
// the door pointing their phone's camera at a printed QR. The owner's brief
// (2026-08-21) is precise: no form on arrival. An INVITATION — "welcome to the
// Sunday service on this date" — one button, ENTER, and confetti when it lands.
// The details Follow-up needs (name, phone, email, date, time, service, how
// they came) are captured server-side at the moment of entry, not typed into
// a bureaucratic screen at the door.
//
// How that squares with needing details at all:
//   * A REMEMBERED phone (localStorage continuity token, minted by the
//     backend at first entry) goes invitation → Enter → confetti. One tap.
//     The server fills their details from their own record — "scanned on
//     another day, it fills the details of that user on that day".
//   * A NEW phone gets one warm details step after Enter — once, ever, and it
//     doubles as their account creation. Next Sunday they are one tap.
//   * Outside a check-in window the poster shows the next service instead of
//     a button — inert six days a week, same as ever.
//
// It talks to the API with RAW fetch, never the portal's client: the client
// persists staff sessions and bounces 401s to /login. The only thing this page
// ever stores is the single-purpose continuity token (attendance-only, see
// tokens.ts) plus a first name for the greeting.
import { useEffect, useRef, useState, type ReactElement, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { Loader2, CalendarDays, UserPlus, LogIn } from "lucide-react";

const NAVY_INK = "#0b1f33";
const NAVY = "#1d4e86";
const GOLD = "#c89b3c";
const CREAM = "#f5efdf";
const MUTED = "#94a7bc";

const API = import.meta.env.VITE_API_BASE ?? "/v1";
const STORE_KEY = "nuru.checkin";

interface OpenService { service_id: string; title: string; starts_at: string; scan_token: string }
type Resolution =
  | { congregation: string; open: true; service: OpenService }
  | { congregation: string; open: false; next: { title: string; starts_at: string } | null };

interface Remembered { continuity_token: string; first_name: string }

function remembered(): Remembered | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Remembered) : null;
  } catch {
    return null;
  }
}
function remember(token: string | undefined, fullName: string | undefined): void {
  // Tolerate an API older than this bundle (the minutes of a rolling deploy,
  // or a cached bundle ahead of the server): no token simply means this phone
  // is not remembered yet. The check-in already SUCCEEDED — nothing about the
  // celebration may depend on the memory working.
  if (!token) return;
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ continuity_token: token, first_name: (fullName ?? "").trim().split(/\s+/)[0] ?? "" }),
    );
  } catch {
    /* private mode — they'll get the details step again next week, no worse */
  }
}
function forget(): void {
  try { localStorage.removeItem(STORE_KEY); } catch { /* nothing to forget */ }
}

/** Raw fetch that surfaces the API's message instead of an HTTP code. */
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The API's shape is { error: { code, message } } — see http/errors.ts.
    const err = (body as { error?: { message?: unknown } }).error;
    const msg =
      err && typeof err.message === "string" ? err.message : "Something went wrong — please try again";
    throw new ApiFail(res.status, msg);
  }
  return body as T;
}
class ApiFail extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/**
 * Confetti, hand-rolled. ~180 gold/cream/white slips launched from the bottom
 * corners; gravity, drag and spin; the canvas removes itself when the last
 * slip leaves the screen. No dependency — this page loads on a stranger's
 * phone on church wifi, and every kilobyte is somebody's Sunday data bundle.
 */
function fireConfetti(canvas: HTMLCanvasElement): void {
  const ctx2d = canvas.getContext("2d");
  if (!ctx2d) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  ctx2d.scale(dpr, dpr);
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  const COLORS = [GOLD, CREAM, "#ffffff", "#e0b95c", NAVY];
  interface Slip { x: number; y: number; vx: number; vy: number; w: number; h: number; rot: number; vr: number; color: string }
  const slips: Slip[] = [];
  for (let i = 0; i < 180; i++) {
    const fromLeft = i % 2 === 0;
    slips.push({
      x: fromLeft ? -10 : W + 10,
      y: H * (0.55 + Math.random() * 0.4),
      vx: (fromLeft ? 1 : -1) * (4 + Math.random() * 7),
      vy: -(9 + Math.random() * 8),
      w: 5 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: COLORS[i % COLORS.length]!,
    });
  }
  let alive = true;
  const step = (): void => {
    if (!alive) return;
    ctx2d.clearRect(0, 0, W, H);
    let visible = 0;
    for (const s of slips) {
      s.vy += 0.25; // gravity
      s.vx *= 0.99; // drag
      s.x += s.vx;
      s.y += s.vy;
      s.rot += s.vr;
      if (s.y < H + 30) visible++;
      ctx2d.save();
      ctx2d.translate(s.x, s.y);
      ctx2d.rotate(s.rot);
      ctx2d.fillStyle = s.color;
      ctx2d.fillRect(-s.w / 2, -s.h / 2, s.w, s.h);
      ctx2d.restore();
    }
    if (visible > 0) requestAnimationFrame(step);
    else { alive = false; ctx2d.clearRect(0, 0, W, H); }
  };
  requestAnimationFrame(step);
}

const inputStyle = {
  width: "100%", padding: "13px 14px", fontSize: 16, borderRadius: 12,
  border: "1px solid rgba(200,155,60,0.45)", background: "rgba(255,255,255,0.06)",
  color: "#fff", boxSizing: "border-box", outline: "none",
} as const;
const labelStyle = {
  display: "block", fontSize: 11, fontWeight: 700, color: GOLD,
  margin: "14px 0 6px", letterSpacing: "0.12em", textTransform: "uppercase",
} as const;

function dateOf(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}
function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

type Stage = "loading" | "invalid" | "closed" | "invitation" | "details" | "celebrate";

export function JoinService(): ReactElement {
  const { code } = useParams<{ code: string }>();
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [mode, setMode] = useState<"new" | "member">("new");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [greetName, setGreetName] = useState("");
  const [wasNew, setWasNew] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    api<Resolution>(`/join/congregation/${code ?? ""}`)
      .then((r) => {
        setResolution(r);
        setStage(r.open ? "invitation" : "closed");
      })
      .catch(() => setStage("invalid"));
  }, [code]);

  useEffect(() => {
    if (stage === "celebrate" && canvasRef.current) fireConfetti(canvasRef.current);
  }, [stage]);

  const svc = resolution?.open ? resolution.service : null;

  const celebrate = (name: string | undefined, newHere: boolean): void => {
    setGreetName((name ?? "").trim().split(/\s+/)[0] ?? "");
    setWasNew(newHere);
    setStage("celebrate");
  };

  /** ENTER: a remembered phone is one tap; a new phone gets the details step. */
  const enter = async (): Promise<void> => {
    if (!svc) return;
    const known = remembered();
    if (!known) { setStage("details"); return; }
    setBusy(true); setError("");
    try {
      const result = await api<{ duplicate: boolean; full_name: string; continuity_token: string }>(
        `/join/service/${svc.service_id}/return`,
        {
          method: "POST",
          body: JSON.stringify({
            continuity_token: known.continuity_token,
            scan_token: svc.scan_token,
            client_scan_id: crypto.randomUUID(),
          }),
        },
      );
      remember(result.continuity_token, result.full_name);
      celebrate(result.full_name, false);
    } catch (err) {
      if (err instanceof ApiFail && err.status === 401) {
        // Token expired or account changed: forget it and fall back to the
        // details step — the one path that always works.
        forget();
        setStage("details");
      } else {
        setError(err instanceof Error ? err.message : "Could not check in — please try again");
      }
    } finally {
      setBusy(false);
    }
  };

  const joinAsGuest = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!svc) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ continuity_token: string; full_name: string }>(
        `/join/service/${svc.service_id}`,
        {
          method: "POST",
          body: JSON.stringify({
            scan_token: svc.scan_token, full_name: fullName,
            phone_number: phone, email: email.trim().toLowerCase(), password,
          }),
        },
      );
      remember(result.continuity_token, result.full_name);
      celebrate(result.full_name, true);
    } catch (err) {
      if (err instanceof ApiFail && err.status === 409) {
        setMode("member");
        setError("You already have an account — sign in once and this phone will remember you.");
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
      const result = await api<{ duplicate: boolean; continuity_token: string }>(
        `/services/${svc.service_id}/attendance`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ client_scan_id: crypto.randomUUID(), scan_token: svc.scan_token }),
        },
      );
      remember(result.continuity_token, fullName || email);
      celebrate(fullName || "", false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check in — please try again");
    } finally {
      setBusy(false);
    }
  };

  const congregation = resolution?.congregation ?? "Nuru Place";

  return (
    <div style={{
      minHeight: "100vh", background: `radial-gradient(120% 90% at 50% 0%, #14304f 0%, ${NAVY_INK} 60%)`,
      display: "flex", justifyContent: "center", padding: "0 18px",
    }}>
      {stage === "celebrate" && (
        <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 10 }} />
      )}

      <div style={{ width: "100%", maxWidth: 440, display: "flex", flexDirection: "column", justifyContent: "center", minHeight: "100vh", padding: "40px 0", textAlign: "center" }}>

        {stage === "loading" && <Loader2 size={26} color={GOLD} style={{ margin: "0 auto", animation: "spin 1s linear infinite" }} />}

        {stage === "invalid" && (
          <p style={{ color: MUTED, fontSize: 15 }}>This code isn&apos;t valid. Please ask a member of the welcome team.</p>
        )}

        {stage === "closed" && resolution && !resolution.open && (
          <>
            <CalendarDays size={30} color={GOLD} style={{ margin: "0 auto 14px" }} />
            <div style={{ color: GOLD, fontSize: 12, fontWeight: 700, letterSpacing: "0.3em", textTransform: "uppercase" }}>{congregation}</div>
            <h1 style={{ color: "#fff", fontSize: 26, fontFamily: "Georgia, 'Times New Roman', serif", fontWeight: 600, margin: "12px 0" }}>
              You&apos;re always welcome here
            </h1>
            <p style={{ color: MUTED, fontSize: 15, lineHeight: 1.6, margin: 0 }}>
              {resolution.next
                ? <>Join us for <b style={{ color: CREAM }}>{resolution.next.title}</b><br />{dateOf(resolution.next.starts_at)} · {timeOf(resolution.next.starts_at)}.<br />Scan this code again when you arrive.</>
                : <>Scan this code again when you arrive for a service.</>}
            </p>
          </>
        )}

        {stage === "invitation" && svc && (
          <>
            <div style={{ color: GOLD, fontSize: 12, fontWeight: 700, letterSpacing: "0.3em", textTransform: "uppercase" }}>{congregation}</div>
            <h1 style={{ color: "#fff", fontSize: 34, fontFamily: "Georgia, 'Times New Roman', serif", fontWeight: 600, margin: "16px 0 6px", lineHeight: 1.2 }}>
              {remembered()?.first_name ? <>Karibu back,<br />{remembered()!.first_name}</> : <>You are warmly<br />invited</>}
            </h1>
            <p style={{ color: CREAM, fontSize: 17, margin: "10px 0 4px" }}>{svc.title}</p>
            <p style={{ color: MUTED, fontSize: 14, margin: 0 }}>{dateOf(svc.starts_at)} · {timeOf(svc.starts_at)}</p>
            {error && <p style={{ color: "#f2b8b5", fontSize: 13, margin: "16px 0 0" }}>{error}</p>}
            <button type="button" onClick={() => { void enter(); }} disabled={busy}
              style={{
                margin: "34px auto 0", width: "100%", maxWidth: 320, padding: "16px 0", borderRadius: 999,
                border: "none", background: busy ? "#8a733e" : GOLD, color: NAVY_INK, fontSize: 18, fontWeight: 800,
                letterSpacing: "0.06em", cursor: busy ? "default" : "pointer", boxShadow: "0 10px 30px rgba(200,155,60,0.35)",
              }}>
              {busy ? "One moment…" : "Enter"}
            </button>
          </>
        )}

        {stage === "details" && svc && (
          <div style={{ textAlign: "left" }}>
            <div style={{ color: GOLD, fontSize: 12, fontWeight: 700, letterSpacing: "0.3em", textTransform: "uppercase", textAlign: "center" }}>{congregation}</div>
            <h2 style={{ color: "#fff", fontSize: 24, fontFamily: "Georgia, 'Times New Roman', serif", fontWeight: 600, margin: "14px 0 4px", textAlign: "center" }}>
              So we can welcome you properly
            </h2>
            <p style={{ color: MUTED, fontSize: 13.5, textAlign: "center", margin: "0 0 10px" }}>
              Once, ever — after today this phone remembers you.
            </p>

            <div style={{ display: "flex", gap: 8, margin: "16px 0 4px" }}>
              {([["new", "I'm new here", UserPlus], ["member", "I'm a member", LogIn]] as const).map(([m, text, Icon]) => (
                <button key={m} type="button" onClick={() => { setMode(m); setError(""); }}
                  style={{
                    flex: 1, padding: "11px 8px", borderRadius: 12, fontSize: 14, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer",
                    border: mode === m ? `1.5px solid ${GOLD}` : "1px solid rgba(148,167,188,0.35)",
                    background: mode === m ? "rgba(200,155,60,0.14)" : "transparent",
                    color: mode === m ? CREAM : MUTED,
                  }}>
                  <Icon size={16} /> {text}
                </button>
              ))}
            </div>

            <form onSubmit={mode === "new" ? joinAsGuest : checkInAsMember}>
              {mode === "new" && (
                <>
                  <label style={labelStyle}>Full name</label>
                  <input style={inputStyle} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required />
                  <label style={labelStyle}>Phone number</label>
                  <input style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" autoComplete="tel" placeholder="07…" required />
                </>
              )}
              <label style={labelStyle}>Email</label>
              <input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" required />
              <label style={labelStyle}>{mode === "new" ? "Choose a password" : "Password"}</label>
              <input style={inputStyle} value={password} onChange={(e) => setPassword(e.target.value)} type="password"
                autoComplete={mode === "new" ? "new-password" : "current-password"} minLength={mode === "new" ? 8 : 1} required />

              {error && <p style={{ color: "#f2b8b5", fontSize: 13, margin: "12px 0 0" }}>{error}</p>}

              <button type="submit" disabled={busy}
                style={{
                  width: "100%", marginTop: 22, padding: "15px 0", borderRadius: 999, border: "none",
                  background: busy ? "#8a733e" : GOLD, color: NAVY_INK, fontSize: 16.5, fontWeight: 800, cursor: busy ? "default" : "pointer",
                }}>
                {busy ? "One moment…" : "Enter"}
              </button>
            </form>
          </div>
        )}

        {stage === "celebrate" && svc && (
          <>
            <div style={{ color: GOLD, fontSize: 12, fontWeight: 700, letterSpacing: "0.3em", textTransform: "uppercase" }}>{congregation}</div>
            <h1 style={{ color: "#fff", fontSize: 36, fontFamily: "Georgia, 'Times New Roman', serif", fontWeight: 600, margin: "18px 0 8px", lineHeight: 1.15 }}>
              {greetName ? <>Karibu,<br />{greetName}!</> : <>Karibu!</>}
            </h1>
            <p style={{ color: CREAM, fontSize: 16, margin: "6px 0" }}>You&apos;re in — {svc.title}.</p>
            <p style={{ color: MUTED, fontSize: 14, lineHeight: 1.6, margin: "10px 0 0" }}>
              {wasNew
                ? <>So glad you&apos;re here. Your discipleship pathway is ready — download the <b style={{ color: CREAM }}>Nuru Pathway</b> app and sign in with the email and password you just chose.</>
                : <>Good to have you home. Enjoy the service.</>}
            </p>
          </>
        )}

        <p style={{ color: "rgba(148,167,188,0.55)", fontSize: 11.5, marginTop: 40 }}>
          Nuru Place Discipleship Pathway
        </p>
      </div>
    </div>
  );
}
