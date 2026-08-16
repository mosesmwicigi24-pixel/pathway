// Shared date/time helpers for the Events page family (extracted from the old
// monolithic Events.tsx per EVENTS_ARCHITECTURE §9 — one copy, not five).
// Other pages keep their local copies until they are themselves rebuilt.

/** Local YYYY-MM-DD for a Date (calendar-grid keys). */
export const localIso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "9:00 AM" (empty string for invalid dates). */
export const fmtTime = (d: Date): string =>
  Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** "Sun 7 Jun 2026". */
export const fmtDateShort = (d: Date): string =>
  Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** "7 Jun 2026 · 9:00 AM". */
export const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · ${fmtTime(d)}`;
};

/** "Today" / "Yesterday" / "n days ago" / "in n days". */
export const relTime = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days < -1) return `in ${-days} days`;
  if (days === -1) return "Tomorrow";
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
};

/** "1h 30m" between two instants. */
export function durationLabel(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** Midnight at the Sunday starting the week containing `d`. */
export const startOfWeek = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
};

/** "2026-07" month cache key. */
export const monthKey = (year: number, month: number): string => `${year}-${String(month + 1).padStart(2, "0")}`;

/** Live countdown label to an instant: "12:34" / "0:07" / "expired". */
export function countdownLabel(untilIso: string, now: number = Date.now()): string {
  const ms = new Date(untilIso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return "expired";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
