// Passkey helpers shared by Login (sign-in), Profile (enrollment/management)
// and the shell's one-time enrollment nudge.
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { WebAuthnApi, type PasskeyCredential } from "../api/client";

export function passkeySupported(): boolean {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

/** "Mac · Chrome"-style auto label for a newly enrolled passkey. */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua)
    ? "Windows"
    : /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Mac/.test(ua)
        ? "Mac"
        : /Android/.test(ua)
          ? "Android"
          : /Linux/.test(ua)
            ? "Linux"
            : "Device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  return `${os} · ${browser}`;
}

/** True when the user backed out of the ceremony (not an actual failure) —
 *  callers reset quietly instead of showing an error. */
export function isCeremonyCancelled(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name;
  return name === "NotAllowedError" || name === "AbortError";
}

/** Full enrollment ceremony: options → platform authenticator → verify+store. */
export async function enrollPasskey(): Promise<PasskeyCredential> {
  const options = await WebAuthnApi.registerOptions();
  const attestation = await startRegistration({ optionsJSON: options as never });
  return WebAuthnApi.registerVerify(attestation, deviceLabel());
}

// ---- One-time enrollment nudge ("Skip the password next time") ----
// Shown once, right after a PASSWORD login on a WebAuthn-capable browser with
// zero registered passkeys. Password logins stamp a sessionStorage marker; the
// shell checks it, and a dismissal is remembered permanently in localStorage.
const NUDGE_DISMISSED_KEY = "nuru.portal.passkeyNudgeDismissed";
const PW_LOGIN_MARKER_KEY = "nuru.portal.pwLogin";

export function markPasswordLogin(): void {
  try {
    sessionStorage.setItem(PW_LOGIN_MARKER_KEY, "1");
  } catch {
    /* storage unavailable */
  }
}

export function clearPasswordLoginMarker(): void {
  try {
    sessionStorage.removeItem(PW_LOGIN_MARKER_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function dismissPasskeyNudge(): void {
  try {
    localStorage.setItem(NUDGE_DISMISSED_KEY, "1");
  } catch {
    /* storage unavailable */
  }
  clearPasswordLoginMarker();
}

/** Cheap local checks only — the caller still confirms zero credentials. */
export function passkeyNudgeCandidate(): boolean {
  try {
    return (
      passkeySupported() &&
      sessionStorage.getItem(PW_LOGIN_MARKER_KEY) === "1" &&
      localStorage.getItem(NUDGE_DISMISSED_KEY) !== "1"
    );
  } catch {
    return false;
  }
}
