// Axios client for the portal. Injects the gateway-issued JWT (§1.3). Base URL is
// the versioned API surface (§3.1). The portal is online-only (§1.3).
import axios from "axios";
import type { AxiosError, InternalAxiosRequestConfig } from "axios";

let accessToken: string | null = null;
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

let refreshHandler: (() => Promise<string | null>) | null = null;
export function setRefreshHandler(fn: (() => Promise<string | null>) | null): void {
  refreshHandler = fn;
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE ?? "https://api.nuruplace.org/v1",
  timeout: 15_000,
});

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// Rotate the access token once on a 401 and replay the request.
api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    if (error.response?.status === 401 && refreshHandler && original && !original._retry) {
      original._retry = true;
      const token = await refreshHandler();
      if (token) {
        setAccessToken(token);
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  },
);

export interface CohortMember {
  user_id: string;
  full_name?: string;
  h_score: number;
  c_score: number;
  a_score: number;
  e_score: number;
  band: string;
}

export interface ReviewItem {
  review_id: string;
  user_id: string;
  full_name?: string;
  level_number: number;
  reflection_text: string;
  submitted_at: string;
}

export const PortalApi = {
  async cohort(
    cellId: string,
    opts: { order?: "asc" | "desc"; band?: string } = {},
  ): Promise<CohortMember[]> {
    const { data } = await api.get<{ data: CohortMember[] }>(`/cohorts/${cellId}/members`, { params: opts });
    return data.data;
  },
  async reviews(): Promise<ReviewItem[]> {
    const { data } = await api.get<{ data: ReviewItem[] }>("/reviews");
    return data.data;
  },
  async decideReview(
    reviewId: string,
    decision: "approve" | "reject",
    feedbackNotes?: string,
  ): Promise<{ state: string; leveled_up: boolean }> {
    const { data } = await api.post<{ state: string; leveled_up: boolean }>(
      `/reviews/${reviewId}/decision`,
      { decision, ...(feedbackNotes ? { feedback_notes: feedbackNotes } : {}) },
    );
    return data;
  },
};
