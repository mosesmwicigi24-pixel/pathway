// Axios client that injects the JWT (spec §1.3). Base URL is the versioned API
// surface (§3.1). The access token is held by the OS secure enclave in the real
// app (§5.7) and pushed in here via setAccessToken — never persisted in JS state.
// The offline mutation queue (LocalStore) — not this client — is the system of
// record for in-flight writes.
import axios, { type AxiosInstance } from "axios";
import type {
  MeResponse,
  PendingMutation,
  SyncPullResponse,
  SyncPushResponse,
  TokenPair,
} from "@nuru/shared";

let accessToken: string | null = null;
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export const api: AxiosInstance = axios.create({
  baseURL: "https://api.nuruplace.org/v1",
  timeout: 15_000,
});

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

/** Typed façade over the §3.3 surface the mobile client uses. */
export const NuruApi = {
  async oauth(provider: "kingschat" | "google" | "apple", code: string): Promise<TokenPair> {
    const { data } = await api.post<TokenPair>(`/auth/oauth/${provider}`, { code });
    return data;
  },
  async refresh(refreshToken: string): Promise<TokenPair> {
    const { data } = await api.post<TokenPair>("/auth/token/refresh", { refresh_token: refreshToken });
    return data;
  },
  async me(): Promise<MeResponse> {
    const { data } = await api.get<MeResponse>("/me");
    return data;
  },
  async levels(): Promise<{ data: unknown[] }> {
    const { data } = await api.get<{ data: unknown[] }>("/levels");
    return data;
  },
  async modulesForLevel(n: number): Promise<{ data: unknown[] }> {
    const { data } = await api.get<{ data: unknown[] }>(`/levels/${n}/modules`);
    return data;
  },
  async quiz(moduleId: string): Promise<unknown> {
    const { data } = await api.get(`/modules/${moduleId}/quiz`);
    return data;
  },
  async giving(body: { fund: string; amount_minor: number; currency: string; idempotency_key: string }): Promise<unknown> {
    const { data } = await api.post("/giving/intents", body);
    return data;
  },
  // --- sync ---
  async pull(body: { device_id?: string; cursors: Record<string, number> }): Promise<SyncPullResponse> {
    const { data } = await api.post<SyncPullResponse>("/sync/pull", body);
    return data;
  },
  async push(body: { device_id?: string; mutations: PendingMutation[] }): Promise<SyncPushResponse> {
    const { data } = await api.post<SyncPushResponse>("/sync/push", body);
    return data;
  },
};
