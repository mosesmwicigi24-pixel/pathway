// Attendance streak math — pure, no database. Covers the rules that make
// "breaks" and "failures" different numbers from each other.
import { describe, it, expect } from "vitest";
import { computeAttendanceStreak, type ServiceOutcome } from "../src/modules/attendance/streak.js";

/** Build a chronological cadence from a string: A = attended, x = missed. */
function cadence(pattern: string): ServiceOutcome[] {
  return [...pattern].map((ch, i) => ({
    service_id: `s${i}`,
    title: `Service ${i}`,
    service_date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    starts_at: `2026-01-${String(i + 1).padStart(2, "0")}T09:00:00.000Z`,
    attended: ch === "A",
    attended_at: ch === "A" ? `2026-01-${String(i + 1).padStart(2, "0")}T09:05:00.000Z` : null,
  }));
}

describe("attendance streak", () => {
  it("is `new` with zeroes when the member has never attended", () => {
    const s = computeAttendanceStreak(cadence("xxxx"));
    expect(s.status).toBe("new");
    expect(s).toMatchObject({ current_streak: 0, total_attended: 0, total_missed: 0, breaks: 0 });
  });

  it("counts an unbroken run", () => {
    const s = computeAttendanceStreak(cadence("AAAA"));
    expect(s).toMatchObject({
      current_streak: 4,
      longest_streak: 4,
      total_attended: 4,
      total_missed: 0,
      breaks: 0,
      status: "active",
    });
  });

  it("ignores services held before the member's first check-in", () => {
    // Three services missed before they ever showed up are not their failures.
    const s = computeAttendanceStreak(cadence("xxxAA"));
    expect(s).toMatchObject({ current_streak: 2, total_attended: 2, total_missed: 0, breaks: 0 });
  });

  it("counts one break per interruption, but one failure per missed service", () => {
    // Two Sundays away in a row is ONE break and TWO failures.
    const s = computeAttendanceStreak(cadence("AAxxAA"));
    expect(s).toMatchObject({
      current_streak: 2,
      longest_streak: 2,
      total_attended: 4,
      total_missed: 2,
      breaks: 1,
      current_miss_run: 0,
      status: "active",
    });
  });

  it("separates repeated interruptions", () => {
    const s = computeAttendanceStreak(cadence("AxAxAxA"));
    expect(s).toMatchObject({ breaks: 3, total_missed: 3, total_attended: 4, current_streak: 1 });
  });

  it("keeps the longest run after the current one is broken", () => {
    const s = computeAttendanceStreak(cadence("AAAAAxA"));
    expect(s).toMatchObject({ longest_streak: 5, current_streak: 1, breaks: 1 });
  });

  it("is `at_risk` after one miss and `broken` after two", () => {
    expect(computeAttendanceStreak(cadence("AAAx")).status).toBe("at_risk");
    expect(computeAttendanceStreak(cadence("AAAx")).current_miss_run).toBe(1);
    expect(computeAttendanceStreak(cadence("AAAxx")).status).toBe("broken");
    expect(computeAttendanceStreak(cadence("AAAxx")).current_miss_run).toBe(2);
  });

  it("reports the last attended service, not the last service", () => {
    const s = computeAttendanceStreak(cadence("AAx"));
    expect(s.last_service_date).toBe("2026-01-02");
    expect(s.last_attended_at).toBe("2026-01-02T09:05:00.000Z");
  });

  it("handles an empty cadence", () => {
    expect(computeAttendanceStreak([])).toMatchObject({ status: "new", current_streak: 0 });
  });
});
