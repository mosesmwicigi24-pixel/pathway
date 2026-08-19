// Church service scheduling — the pure bits, extracted so they can be tested.
//
// The check-in window is the load-bearing calculation here. A service's scan
// token is an HMAC of its id and does not rotate, so a photograph of the
// projected code would keep working indefinitely; the window is what stops it.
// Getting this arithmetic wrong silently removes the only control there is,
// which is why it lives here with tests rather than inline in a form handler.

export type ServicePhase = "open" | "upcoming" | "closed" | "disabled";

export interface ServiceScheduleFields {
  qr_enabled: boolean;
  /** The server's own verdict on whether a scan would be accepted right now. */
  checkin_open: boolean;
  checkin_opens_at: string | null;
  starts_at: string;
}

/**
 * Where a service sits relative to `now`.
 *
 * `checkin_open` comes from the server and is authoritative for "open" — the
 * client never decides whether a scan will be accepted. The other phases are
 * presentational only: has its window not started yet, or has it been and gone.
 */
export function servicePhase(s: ServiceScheduleFields, now: number): ServicePhase {
  if (!s.qr_enabled) return "disabled";
  if (s.checkin_open) return "open";
  const opensRaw = s.checkin_opens_at ?? s.starts_at;
  const opens = new Date(opensRaw).getTime();
  // An unparseable timestamp must not read as "upcoming forever" — treat it as
  // past so it sorts out of the way rather than to the top of the list.
  if (Number.isNaN(opens)) return "closed";
  return now < opens ? "upcoming" : "closed";
}

/** Sort rank: whatever is scannable right now goes to the top of the list. */
export function phaseRank(phase: ServicePhase): number {
  return { open: 0, upcoming: 1, closed: 2, disabled: 3 }[phase];
}

/**
 * The window around a start time, in ISO-8601. Minutes are clamped to a day
 * either side: a negative or wild value would otherwise produce a window that
 * is inverted or effectively permanent, which is the failure this exists to
 * prevent.
 */
export function checkinWindow(
  startsAt: Date,
  opensBeforeMin: number,
  closesAfterMin: number,
): { opens_at: string; closes_at: string } {
  const clamp = (n: number): number => (Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 0), 1440) : 0);
  const t = startsAt.getTime();
  return {
    opens_at: new Date(t - clamp(opensBeforeMin) * 60_000).toISOString(),
    closes_at: new Date(t + clamp(closesAfterMin) * 60_000).toISOString(),
  };
}

/** Local wall-clock time of an instant — the church's own clock, not UTC. */
export function hhmm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** `YYYY-MM-DD` in the local zone (not `toISOString`, which shifts the day). */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
