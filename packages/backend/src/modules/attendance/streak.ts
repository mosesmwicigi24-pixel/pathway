// Church-service attendance streak math — pure, so the rules are unit-testable
// without a database (same split as gamification's `streakFromDates`).
//
// The cadence unit is a SERVICE, not a day: a member who attends every Sunday
// has an unbroken streak even though six days pass between check-ins. That
// means "missed" is only computable because the congregation's services are
// enumerable — every streak-eligible service in the window is either attended
// or a failure.
//
// ANCHORING. The window starts at the member's FIRST attended service. Services
// held before someone ever showed up are not failures they own — without this a
// member who joins a ten-year-old congregation would open the app to hundreds
// of "missed" services. A member who has never attended is `new`, with zeroes
// across the board rather than a wall of failures.

/** One eligible service in the congregation's cadence, resolved for one member. */
export interface ServiceOutcome {
  service_id: string;
  title: string;
  service_date: string;
  starts_at: string;
  attended: boolean;
  attended_at: string | null;
}

/**
 * `new`      — never checked in to a service yet (nothing to break).
 * `active`   — attended the most recent eligible service.
 * `at_risk`  — missed exactly the last one; the run is interrupted but recent.
 * `broken`   — missed the last two or more in a row.
 */
export type StreakStatus = "new" | "active" | "at_risk" | "broken";

export interface AttendanceStreak {
  /** Consecutive services attended, counting back from the most recent one. */
  current_streak: number;
  /** Best run ever achieved inside the window. */
  longest_streak: number;
  total_attended: number;
  /** "Failures": eligible services missed since the member's first check-in. */
  total_missed: number;
  /** "Breaks": times a run of attendance was interrupted by a miss. */
  breaks: number;
  /** Consecutive services missed right now (0 while the streak is alive). */
  current_miss_run: number;
  last_attended_at: string | null;
  last_service_date: string | null;
  status: StreakStatus;
}

export const EMPTY_STREAK: AttendanceStreak = {
  current_streak: 0,
  longest_streak: 0,
  total_attended: 0,
  total_missed: 0,
  breaks: 0,
  current_miss_run: 0,
  last_attended_at: null,
  last_service_date: null,
  status: "new",
};

/**
 * Walk one member's eligible services oldest → newest and fold them into a
 * streak. `services` must already be filtered to streak-eligible services that
 * have STARTED (a service still in the future is neither attended nor missed).
 *
 * A "break" is counted once per interruption, not once per missed service: two
 * Sundays away in a row is one break and two failures.
 */
export function computeAttendanceStreak(services: readonly ServiceOutcome[]): AttendanceStreak {
  const firstAttended = services.findIndex((s) => s.attended);
  if (firstAttended === -1) return { ...EMPTY_STREAK };

  const window = services.slice(firstAttended);

  let current = 0;
  let longest = 0;
  let attended = 0;
  let missed = 0;
  let breaks = 0;
  let missRun = 0;
  let lastAttendedAt: string | null = null;
  let lastServiceDate: string | null = null;

  for (const s of window) {
    if (s.attended) {
      current += 1;
      missRun = 0;
      attended += 1;
      if (current > longest) longest = current;
      lastAttendedAt = s.attended_at ?? s.starts_at;
      lastServiceDate = s.service_date;
    } else {
      missed += 1;
      // Only the FIRST miss of a run interrupts a streak; the rest extend the gap.
      if (missRun === 0) breaks += 1;
      missRun += 1;
      current = 0;
    }
  }

  return {
    current_streak: current,
    longest_streak: longest,
    total_attended: attended,
    total_missed: missed,
    breaks,
    current_miss_run: missRun,
    last_attended_at: lastAttendedAt,
    last_service_date: lastServiceDate,
    status: statusFor(current, missRun),
  };
}

function statusFor(current: number, missRun: number): StreakStatus {
  if (current > 0) return "active";
  if (missRun >= 2) return "broken";
  if (missRun === 1) return "at_risk";
  return "new";
}
