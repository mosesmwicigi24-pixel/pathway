// Test harness for the Finance pages (Pledges … Statements): a real Redux store
// with a signed-in person (permissions, role, and an access token whose `sub`
// is their user id), a MemoryRouter at the page's URL, and a probe that shows
// where the page navigated to. Not itself a test file (no .test suffix).
import type { ReactElement } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { render, type RenderResult } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { authReducer } from "../src/store/authSlice";
import { userReducer } from "../src/store/userSlice";
import { cohortReducer } from "../src/store/cohortSlice";

const b64url = (o: unknown): string => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** An unsigned JWT-shaped token — the portal only decodes it (never verifies). */
export function fakeToken(claims: Record<string, unknown>): string {
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(claims)}.signature`;
}

export const ALL_FINANCE = ["finance:view", "finance:export", "finance:manage", "finance:approve"];

export interface PageOptions {
  /** The URL the page opens at. */
  path?: string;
  /** Effective permission keys; null = /me still loading. */
  permissions?: string[] | null;
  role?: string;
  userId?: string;
}

function LocationProbe(): ReactElement {
  const loc = useLocation();
  return <output data-testid="location">{`${loc.pathname}${loc.search}`}</output>;
}

export function renderPage(ui: ReactElement, opts: PageOptions = {}): RenderResult {
  const role = opts.role ?? "Admin";
  const store = configureStore({
    reducer: { auth: authReducer, user: userReducer, cohort: cohortReducer },
    preloadedState: {
      auth: {
        accessToken: fakeToken({ sub: opts.userId ?? "me-0001", role }),
        email: "office@nuru.test",
        role,
        status: "idle" as const,
        error: null,
        mfaToken: null,
        permissions: opts.permissions === undefined ? ALL_FINANCE : opts.permissions,
      },
    },
  });
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[opts.path ?? "/"]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                {ui}
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
}

/** An axios-shaped error the finance helpers read (status + error envelope). */
export function apiError(status: number, code: string, message: string, details?: Record<string, unknown>): Error {
  const e = new Error(message) as Error & { isAxiosError: boolean; response: unknown; toJSON: () => unknown };
  e.isAxiosError = true;
  e.response = { status, data: { error: { code, message, request_id: "req-test", ...(details ? { details } : {}) } }, headers: {}, statusText: "", config: {} };
  e.toJSON = () => ({});
  return e;
}
