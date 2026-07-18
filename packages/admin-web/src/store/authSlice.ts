// Auth state for the portal. The session (access + refresh tokens) is persisted in
// localStorage by the api client and mirrored into Redux, so a reload restores the
// session and the access token is silently refreshed — no more surprise sign-offs.
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { startAuthentication } from "@simplewebauthn/browser";
import { PortalApi, WebAuthnApi, setSession, clearSession, getAccessToken } from "../api/client";
import { errorMessage } from "../util/error";
import { decodeRole } from "../util/jwt";
import { markPasswordLogin, clearPasswordLoginMarker, isCeremonyCancelled } from "../lib/passkeys";

export const devLogin = createAsyncThunk<
  { accessToken: string; email: string; role: string | null },
  string,
  { rejectValue: string }
>("auth/devLogin", async (email, { rejectWithValue }) => {
  try {
    const session = await PortalApi.devLogin(email);
    setSession(session.access_token, session.refresh_token); // persisted; auto-refreshes
    return { accessToken: session.access_token, email, role: decodeRole(session.access_token) };
  } catch (e) {
    return rejectWithValue(errorMessage(e, "Login failed — check the email is seeded (pnpm db:seed:dev)."));
  }
});

// Resolves to a session, OR a `mfaToken` challenge when the account has 2FA on
// (then the UI collects a code and dispatches completeMfa).
export const login = createAsyncThunk<
  { accessToken: string; email: string; role: string | null } | { mfaToken: string; email: string },
  { email: string; password: string },
  { rejectValue: string }
>("auth/login", async ({ email, password }, { rejectWithValue }) => {
  try {
    const res = await PortalApi.login(email, password);
    if ("mfa_required" in res) return { mfaToken: res.mfa_token, email };
    setSession(res.access_token, res.refresh_token);
    markPasswordLogin(); // the shell may offer the one-time "add a passkey" nudge
    return { accessToken: res.access_token, email, role: decodeRole(res.access_token) };
  } catch (e) {
    return rejectWithValue(errorMessage(e, "Invalid email or password."));
  }
});

export const completeMfa = createAsyncThunk<
  { accessToken: string; email: string; role: string | null },
  { mfaToken: string; email: string; code: string },
  { rejectValue: string }
>("auth/completeMfa", async ({ mfaToken, email, code }, { rejectWithValue }) => {
  try {
    const session = await PortalApi.loginCompleteMfa(mfaToken, code);
    setSession(session.access_token, session.refresh_token);
    markPasswordLogin(); // password+TOTP entry — still a candidate for the passkey nudge
    return { accessToken: session.access_token, email, role: decodeRole(session.access_token) };
  } catch (e) {
    return rejectWithValue(errorMessage(e, "That code didn't match. Try again or use a recovery code."));
  }
});

// Passkey sign-in (Touch ID / Face ID / Windows Hello): options → platform
// authenticator ceremony → verify. The server enforces the same staff-only
// scope gate as password login and, with userVerification required, skips the
// TOTP step. A user backing out of the ceremony rejects with "" — the UI
// treats that as a quiet reset, not an error.
export const passkeyLogin = createAsyncThunk<
  { accessToken: string; email: string; role: string | null },
  { email: string },
  { rejectValue: string }
>("auth/passkeyLogin", async ({ email }, { rejectWithValue }) => {
  let assertion: unknown;
  try {
    const options = await WebAuthnApi.loginOptions(email);
    assertion = await startAuthentication({ optionsJSON: options as never });
  } catch (e) {
    if (isCeremonyCancelled(e)) return rejectWithValue("");
    return rejectWithValue(errorMessage(e, "Passkey sign-in didn't work — use your password instead."));
  }
  try {
    const session = await WebAuthnApi.loginVerify(assertion);
    setSession(session.access_token, session.refresh_token);
    clearPasswordLoginMarker(); // they're already using a passkey — never nudge
    return { accessToken: session.access_token, email, role: decodeRole(session.access_token) };
  } catch (e) {
    return rejectWithValue(errorMessage(e, "Passkey sign-in didn't work — use your password instead."));
  }
});

export interface AuthState {
  accessToken: string | null;
  email: string | null;
  role: string | null;
  status: "idle" | "loading" | "error";
  error: string | null;
  /** Set when password sign-in returns a 2FA challenge; cleared once completed. */
  mfaToken: string | null;
  /** The caller's effective RBAC permission keys ("module:capability"), from
   *  GET /me (Layout hydrates this on every mount with a session). null =
   *  not loaded yet — the sidebar/route guard fail OPEN while null (never
   *  flash-hide/redirect before the real answer arrives); the server enforces
   *  every route regardless of what the UI shows. */
  permissions: string[] | null;
}

// Restore the session from the persisted access token on reload, so a refresh
// doesn't bounce to /login. An expired access token is fine — the first request
// silently refreshes it via the stored refresh token.
const bootAccess = getAccessToken();
const initialState: AuthState = {
  accessToken: bootAccess,
  email: null,
  role: bootAccess ? decodeRole(bootAccess) : null,
  status: "idle",
  error: null,
  mfaToken: null,
  permissions: null,
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    logout(state) {
      state.accessToken = null;
      state.email = null;
      state.role = null;
      state.mfaToken = null;
      state.permissions = null;
      clearSession();
    },
    cancelMfa(state) {
      state.mfaToken = null;
      state.status = "idle";
      state.error = null;
    },
    /** Hydrated from GET /me (Layout) — the caller's effective permission keys. */
    setPermissions(state, action: { payload: string[] | null }) {
      state.permissions = action.payload;
    },
  },
  extraReducers: (b) => {
    b.addCase(devLogin.pending, (s) => {
      s.status = "loading";
      s.error = null;
    })
      .addCase(devLogin.fulfilled, (s, a) => {
        s.status = "idle";
        s.accessToken = a.payload.accessToken;
        s.email = a.payload.email;
        s.role = a.payload.role;
      })
      .addCase(devLogin.rejected, (s, a) => {
        s.status = "error";
        s.error = a.payload ?? "Login failed";
      })
      .addCase(login.pending, (s) => {
        s.status = "loading";
        s.error = null;
      })
      .addCase(login.fulfilled, (s, a) => {
        s.status = "idle";
        if ("mfaToken" in a.payload) {
          s.mfaToken = a.payload.mfaToken; // hold for the code step
          s.email = a.payload.email;
        } else {
          s.accessToken = a.payload.accessToken;
          s.email = a.payload.email;
          s.role = a.payload.role;
        }
      })
      .addCase(login.rejected, (s, a) => {
        s.status = "error";
        s.error = a.payload ?? "Login failed";
      })
      .addCase(completeMfa.pending, (s) => {
        s.status = "loading";
        s.error = null;
      })
      .addCase(completeMfa.fulfilled, (s, a) => {
        s.status = "idle";
        s.mfaToken = null;
        s.accessToken = a.payload.accessToken;
        s.email = a.payload.email;
        s.role = a.payload.role;
      })
      .addCase(completeMfa.rejected, (s, a) => {
        s.status = "error";
        s.error = a.payload ?? "Verification failed";
      })
      .addCase(passkeyLogin.pending, (s) => {
        s.status = "loading";
        s.error = null;
      })
      .addCase(passkeyLogin.fulfilled, (s, a) => {
        s.status = "idle";
        s.accessToken = a.payload.accessToken;
        s.email = a.payload.email;
        s.role = a.payload.role;
      })
      .addCase(passkeyLogin.rejected, (s, a) => {
        // "" = the user cancelled the ceremony — reset quietly, no error banner.
        if (a.payload === "") {
          s.status = "idle";
          s.error = null;
          return;
        }
        s.status = "error";
        s.error = a.payload ?? "Passkey sign-in failed";
      });
  },
});

export const { logout, cancelMfa, setPermissions } = authSlice.actions;
export const authReducer = authSlice.reducer;
