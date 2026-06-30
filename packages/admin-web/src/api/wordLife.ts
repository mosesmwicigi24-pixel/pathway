// Per-member "Word & Reading life" for the Member Profile page. Kept in its own
// file (reusing the shared axios instance) rather than threaded through client.ts.
// Mirrors the backend wordlife module: how this member reads and practises the
// Word. Prayer is pastoral-private (§5.4) and is never part of this payload.
import { api } from "./client";

export interface MemberWordLife {
  user_id: string;
  generated_at: string;
  word_score: { score: number; band: string; components: Record<string, number> };
  memorization: {
    verses_engaged: number;
    verses_mastered: number;
    verses_learning: number;
    avg_match_pct: number;
    last_practiced_at: string | null;
  };
  reading: {
    plans_active: number;
    plans_completed: number;
    days_read: number;
    last_read_at: string | null;
  };
  rhythm: { word_days_30: number; word_events_30: number; last_word_at: string | null };
  quiz: { attempts: number; passed: number; avg_score: number };
  insight: { profile: string; headline: string };
}

export const WordLifeApi = {
  forMember: (userId: string) =>
    api.get<MemberWordLife>(`/admin/members/${userId}/word-life`).then((r) => r.data),
};
