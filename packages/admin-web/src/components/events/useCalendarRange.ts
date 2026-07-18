// useCalendarRange — windowed calendar fetching (EVENTS_ARCHITECTURE §4).
// The 60-day mount-time constant is DEAD: occurrences are fetched BY VISIBLE
// RANGE, one month per request (well under the server's 92-day cap), cached
// per month, with ±1 month prefetch around the anchor and a year loader that
// fills the cache in ≤92-day quarter chunks. Infinite month navigation and
// jump-to-date both just move the anchor.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OpsApi, type CalendarOccurrence } from "../../api/client";
import { monthKey } from "../../util/dates";

interface MonthCache {
  [key: string]: CalendarOccurrence[]; // "YYYY-MM" → occurrences starting in that month
}

export interface CalendarRange {
  /** All occurrences across loaded months, deduped, unsorted. */
  occurrences: CalendarOccurrence[];
  /** True while any month fetch is in flight. */
  loading: boolean;
  /** True once the anchor month itself has loaded at least once. */
  anchorLoaded: boolean;
  error: string | null;
  /** Ensure a month (0-based) is cached; used by year view cells etc. */
  ensureMonth: (year: number, month: number) => void;
  /** Ensure all 12 months of a year are cached (fetched as 4 quarter requests). */
  ensureYear: (year: number) => void;
  /** Drop the cache and refetch the anchor window (after create/edit/delete). */
  refetch: () => Promise<void>;
}

/** Local-midnight first instant of a month. */
const monthStart = (y: number, m: number): Date => new Date(y, m, 1, 0, 0, 0, 0);

/** Normalize a possibly-overflowing (year, month) pair (m = −1 → Dec of y−1). */
const norm = (y: number, m: number): { y: number; m: number } => {
  const d = new Date(y, m, 1);
  return { y: d.getFullYear(), m: d.getMonth() };
};

/**
 * @param anchorYear / anchorMonth — the month the calendar is showing. The hook
 * fetches it plus ±1 month (prefetch); navigating just changes the anchor.
 */
export function useCalendarRange(anchorYear: number, anchorMonth: number): CalendarRange {
  const [cache, setCache] = useState<MonthCache>({});
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Months already requested (in flight or done) — survives re-renders without
  // retriggering; reset on refetch via the generation counter.
  const requested = useRef(new Set<string>());
  const generation = useRef(0);

  const fetchMonths = useCallback(async (rawMonths: Array<{ y: number; m: number }>): Promise<void> => {
    const gen = generation.current;
    const months = rawMonths.map(({ y, m }) => norm(y, m));
    const toFetch = months.filter(({ y, m }) => !requested.current.has(monthKey(y, m)));
    if (toFetch.length === 0) return;
    for (const { y, m } of toFetch) requested.current.add(monthKey(y, m));
    setPending((p) => p + toFetch.length);
    await Promise.all(
      toFetch.map(async ({ y, m }) => {
        try {
          const from = monthStart(y, m);
          const to = monthStart(y, m + 1);
          const rows = await OpsApi.calendar(from.toISOString(), to.toISOString());
          if (generation.current !== gen) return; // refetch() invalidated us
          setCache((prev) => ({ ...prev, [monthKey(y, m)]: rows }));
          setError(null);
        } catch (e) {
          if (generation.current !== gen) return;
          requested.current.delete(monthKey(y, m)); // allow retry on next nav
          setError(e instanceof Error ? e.message : "Could not load calendar.");
        } finally {
          setPending((p) => p - 1);
        }
      }),
    );
  }, []);

  /** A quarter (3 months ≤ 92 days) in ONE request, split into month buckets. */
  const fetchQuarter = useCallback(async (y: number, mStart: number): Promise<void> => {
    const gen = generation.current;
    const keys = [0, 1, 2].map((i) => monthKey(y, mStart + i));
    if (keys.every((k) => requested.current.has(k))) return;
    for (const k of keys) requested.current.add(k);
    setPending((p) => p + 1);
    try {
      const rows = await OpsApi.calendar(monthStart(y, mStart).toISOString(), monthStart(y, mStart + 3).toISOString());
      if (generation.current !== gen) return;
      const buckets: MonthCache = { [keys[0]!]: [], [keys[1]!]: [], [keys[2]!]: [] };
      for (const occ of rows) {
        const d = new Date(occ.start_at);
        const k = monthKey(d.getFullYear(), d.getMonth());
        (buckets[k] ??= []).push(occ);
      }
      setCache((prev) => ({ ...prev, ...buckets }));
      setError(null);
    } catch (e) {
      if (generation.current !== gen) return;
      for (const k of keys) requested.current.delete(k);
      setError(e instanceof Error ? e.message : "Could not load calendar.");
    } finally {
      setPending((p) => p - 1);
    }
  }, []);

  // Anchor month ±1 prefetch — refires on every navigation, cached months no-op.
  useEffect(() => {
    void fetchMonths([
      { y: anchorYear, m: anchorMonth - 1 },
      { y: anchorYear, m: anchorMonth },
      { y: anchorYear, m: anchorMonth + 1 },
    ]);
  }, [anchorYear, anchorMonth, fetchMonths]);

  const ensureMonth = useCallback(
    (year: number, month: number): void => {
      void fetchMonths([{ y: year, m: month }]);
    },
    [fetchMonths],
  );

  const ensureYear = useCallback(
    (year: number): void => {
      void Promise.all([0, 3, 6, 9].map((m) => fetchQuarter(year, m)));
    },
    [fetchQuarter],
  );

  const refetch = useCallback(async (): Promise<void> => {
    generation.current += 1;
    requested.current = new Set();
    setCache({});
    await fetchMonths([
      { y: anchorYear, m: anchorMonth - 1 },
      { y: anchorYear, m: anchorMonth },
      { y: anchorYear, m: anchorMonth + 1 },
    ]);
  }, [anchorYear, anchorMonth, fetchMonths]);

  const occurrences = useMemo(() => {
    const seen = new Set<string>();
    const all: CalendarOccurrence[] = [];
    for (const rows of Object.values(cache)) {
      for (const occ of rows) {
        if (!seen.has(occ.occurrence_id)) {
          seen.add(occ.occurrence_id);
          all.push(occ);
        }
      }
    }
    return all;
  }, [cache]);

  const anchor = norm(anchorYear, anchorMonth);
  const anchorLoaded = monthKey(anchor.y, anchor.m) in cache;

  return { occurrences, loading: pending > 0, anchorLoaded, error, ensureMonth, ensureYear, refetch };
}
