// Memory-verse mastery milestones. The count of mastered verses is
// server-authoritative (§1.1) — we only decide, locally, when to *celebrate* a
// freshly-crossed milestone so the confetti fires once per crossing (not on every
// re-render or app launch). The highest celebrated milestone is persisted in
// AsyncStorage; a milestone only fires if it's higher than the last one stored.
import AsyncStorage from "@react-native-async-storage/async-storage";

export const VERSE_MILESTONES = [1, 10, 25, 50, 75, 100] as const;
const STORE_KEY = "nuru.verseMilestone.celebrated";

/** Highest milestone the member has reached at this mastered count (0 = none). */
export function highestMilestone(count: number): number {
  let reached = 0;
  for (const m of VERSE_MILESTONES) if (count >= m) reached = m;
  return reached;
}

/** The next milestone still ahead of the member, or null once all are reached. */
export function nextMilestone(count: number): number | null {
  for (const m of VERSE_MILESTONES) if (count < m) return m;
  return null;
}

/** If the member has crossed into a new milestone since last time, return it (and
 *  persist it so it won't fire again); otherwise null. Best-effort on storage. */
export async function milestoneToCelebrate(masteredCount: number): Promise<number | null> {
  const reached = highestMilestone(masteredCount);
  if (reached === 0) return null;
  const raw = await AsyncStorage.getItem(STORE_KEY).catch(() => null);
  const last = raw ? Number.parseInt(raw, 10) || 0 : 0;
  if (reached <= last) return null;
  await AsyncStorage.setItem(STORE_KEY, String(reached)).catch(() => undefined);
  return reached;
}
