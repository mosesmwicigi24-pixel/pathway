// Follow-up — the administration side of church attendance.
//
// Check-in (./service.ts) answers "was this member here?". Follow-up answers the
// questions a pastoral team actually acts on: who came, who didn't, who is
// slipping, and who should be contacted before next Sunday.
//
// Everything here is READ-ONLY and congregation-scoped. The unit of measurement
// is the same as the member-facing streak (see ./streak.ts) — a SERVICE, not a
// day — so a leader and a member never see two different numbers for the same
// person.
//
// ABSENTEES ARE THE POINT. A roster of who attended is easy and half the story;
// the list this module exists to produce is the one nobody has today — the
// members who did NOT come, with a phone number next to each name, ready to be
// called or (later) messaged on WhatsApp.
import type { Pool } from "pg";
import { many, maybeOne, one } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import type { Principal } from "../../http/http.js";
import { computeAttendanceStreak, type ServiceOutcome } from "./streak.js";

/** One member's standing in the congregation's attendance record. */
export interface FollowUpMember {
  user_id: string;
  full_name: string;
  phone_number: string | null;
  email: string | null;
  /** Contact details as registered at their most recent scan, when they differ. */
  registered_name: string | null;
  registered_phone: string | null;
  registered_email: string | null;
  /** The scan itself: when they were last in the room. */
  last_attended_at: string | null;
  last_service_title: string | null;
  /** Year-to-date, over streak-eligible services in the congregation. */
  attended_this_year: number;
  missed_this_year: number;
  /**
   * Check-ins to generic calendar EVENTS this year (attendance_logs) — cell
   * gatherings, conferences, one-offs. Reported beside service attendance
   * because "how many did you attend this year" means both, but deliberately
   * NOT folded into the streak: events have no fixed cadence, so there is no
   * denominator to miss against and a run of them would be meaningless.
   */
  events_attended_this_year: number;
  /** Consecutive services attended right now, and the best run this year. */
  current_streak: number;
  longest_streak: number;
  /** Consecutive services missed right now — the number that triggers follow-up. */
  current_miss_run: number;
  breaks: number;
  status: "new" | "active" | "at_risk" | "broken";
  /** True when the member has never checked in to any service. */
  never_attended: boolean;
}

/** One line of the per-service log: a scan, with everything captured at it. */
export interface ServiceScanLog {
  attendance_id: string;
  user_id: string;
  full_name: string;
  phone_number: string;
  email: string | null;
  attended_at: string;
  method: string;
  service_id: string;
  service_title: string;
  service_date: string;
}

/** Congregation totals for one service — the end-of-day number a pastor asks for. */
export interface ServiceAttendanceSummary {
  service_id: string;
  title: string;
  service_date: string;
  starts_at: string;
  counts_for_streak: boolean;
  /** Members on the roll at the time of the report. */
  expected: number;
  attended: number;
  absent: number;
  /** attended / expected, 0..1, rounded to 3dp. Null when there is nobody on the roll. */
  attendance_rate: number | null;
}

/** A member who missed a specific service — the call list. */
export interface Absentee {
  user_id: string;
  full_name: string;
  phone_number: string | null;
  email: string | null;
  last_attended_at: string | null;
  /** Consecutive services missed including this one. */
  current_miss_run: number;
  /** How long they had been coming before they stopped. */
  streak_lost: number;
  never_attended: boolean;
}

export interface YearOverview {
  year: number;
  /** Streak-eligible services held so far this year. */
  services_held: number;
  /** Of those, the ones on a Sunday — "how many Sundays" in the ask. */
  sundays_held: number;
  members: number;
  /** Distinct members who attended at least one service this year. */
  members_attended: number;
  /** On the roll but not seen once this year. */
  members_never_attended: number;
  /** Members whose most recent eligible service was a miss. */
  members_at_risk: number;
  /** Members who have missed two or more in a row. */
  members_broken: number;
  total_check_ins: number;
  /** Event check-ins this year — counted, but never part of the streak. */
  total_event_check_ins: number;
}

/** The window every year-to-date figure is measured over. */
function yearBounds(year: number): { from: string; to: string } {
  return { from: `${year}-01-01T00:00:00.000Z`, to: `${year + 1}-01-01T00:00:00.000Z` };
}

export class FollowUpService {
  constructor(private readonly pool: Pool) {}

  /**
   * Every member on the roll with their attendance standing, worst first —
   * longest current absence at the top, because that ordering IS the follow-up
   * queue. Members who have never attended sort in among them by how long the
   * congregation has been meeting without them.
   */
  async members(
    principal: Principal,
    year: number,
    opts: { status?: string | undefined; limit?: number | undefined } = {},
  ): Promise<FollowUpMember[]> {
    const { from, to } = yearBounds(year);
    const limit = Math.min(Math.max(opts.limit ?? 500, 1), 2000);

    // The congregation's eligible services this year, oldest first. One query,
    // then the per-member walk is done in memory — a congregation holds tens of
    // services a year, not thousands, so this stays small and keeps the streak
    // maths identical to the member-facing path.
    const services = await many<{ service_id: string; title: string; service_date: string; starts_at: string }>(
      this.pool,
      `SELECT service_id, title, service_date::text AS service_date, starts_at
         FROM church_services
        WHERE congregation_id = $1
          AND counts_for_streak = TRUE
          AND starts_at >= $2 AND starts_at < $3
          AND starts_at <= now()
        ORDER BY starts_at ASC, service_id ASC`,
      [principal.congregationId, from, to],
    );

    const roll = await many<{
      user_id: string;
      full_name: string;
      phone_number: string | null;
      email: string | null;
    }>(
      this.pool,
      `SELECT user_id, full_name, phone_number, email
         FROM users
        WHERE congregation_id = $1 AND deleted_at IS NULL
        ORDER BY full_name ASC
        LIMIT $2`,
      [principal.congregationId, limit],
    );
    if (roll.length === 0) return [];

    // Every check-in this year for those members, plus the details they
    // registered at the scan (which may differ from the profile).
    const scans = await many<{
      user_id: string;
      service_id: string;
      attended_at: string;
      full_name: string;
      phone_number: string;
      email: string | null;
      service_title: string;
    }>(
      this.pool,
      `SELECT a.user_id, a.service_id, a.attended_at, a.full_name, a.phone_number, a.email,
              s.title AS service_title
         FROM service_attendance a
         JOIN church_services s ON s.service_id = a.service_id
        WHERE s.congregation_id = $1 AND s.starts_at >= $2 AND s.starts_at < $3
        ORDER BY a.attended_at ASC`,
      [principal.congregationId, from, to],
    );

    const eventCounts = new Map<string, number>();
    for (const row of await many<{ user_id: string; n: number }>(
      this.pool,
      `SELECT a.user_id, count(*)::int AS n
         FROM attendance_logs a
         JOIN events e ON e.event_id = a.event_id
        WHERE e.congregation_id = $1 AND a.checked_in_at >= $2 AND a.checked_in_at < $3
        GROUP BY a.user_id`,
      [principal.congregationId, from, to],
    )) {
      eventCounts.set(row.user_id, row.n);
    }

    const byUser = new Map<string, typeof scans>();
    for (const scan of scans) {
      const list = byUser.get(scan.user_id) ?? [];
      list.push(scan);
      byUser.set(scan.user_id, list);
    }

    const rows: FollowUpMember[] = roll.map((m) => {
      const mine = byUser.get(m.user_id) ?? [];
      const attendedIds = new Set(mine.map((s) => s.service_id));
      const outcomes: ServiceOutcome[] = services.map((s) => ({
        service_id: s.service_id,
        title: s.title,
        service_date: s.service_date,
        starts_at: s.starts_at,
        attended: attendedIds.has(s.service_id),
        attended_at: mine.find((x) => x.service_id === s.service_id)?.attended_at ?? null,
      }));
      const streak = computeAttendanceStreak(outcomes);
      const last = mine[mine.length - 1];

      // Misses only count from a member's first check-in; before that the
      // congregation was meeting without them, which is a different problem
      // from someone who came and then stopped.
      const attended = attendedIds.size;
      const missed = streak.total_missed;

      return {
        user_id: m.user_id,
        full_name: m.full_name,
        phone_number: m.phone_number,
        email: m.email,
        registered_name: last?.full_name ?? null,
        registered_phone: last?.phone_number ?? null,
        registered_email: last?.email ?? null,
        last_attended_at: last?.attended_at ?? null,
        last_service_title: last?.service_title ?? null,
        attended_this_year: attended,
        missed_this_year: missed,
        events_attended_this_year: eventCounts.get(m.user_id) ?? 0,
        current_streak: streak.current_streak,
        longest_streak: streak.longest_streak,
        current_miss_run: streak.current_miss_run,
        breaks: streak.breaks,
        status: streak.status,
        never_attended: attended === 0,
      };
    });

    const wanted = opts.status;
    const filtered = wanted ? rows.filter((r) => r.status === wanted) : rows;

    // Worst first: longest current absence, then never-attended, then name.
    return filtered.sort(
      (a, b) =>
        b.current_miss_run - a.current_miss_run ||
        Number(b.never_attended) - Number(a.never_attended) ||
        a.full_name.localeCompare(b.full_name),
    );
  }

  /**
   * The scan log — every check-in, newest first, with the details captured at
   * the moment of the scan. This is the raw record the roster and the reports
   * are both derived from.
   */
  async scanLog(
    principal: Principal,
    opts: { serviceId?: string | undefined; limit?: number | undefined } = {},
  ): Promise<ServiceScanLog[]> {
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
    const params: unknown[] = [principal.congregationId];
    let filter = "";
    if (opts.serviceId) {
      params.push(opts.serviceId);
      filter = `AND a.service_id = $${params.length}`;
    }
    params.push(limit);
    return many<ServiceScanLog>(
      this.pool,
      `SELECT a.attendance_id, a.user_id, a.full_name, a.phone_number, a.email,
              a.attended_at, a.method, a.service_id,
              s.title AS service_title, s.service_date::text AS service_date
         FROM service_attendance a
         JOIN church_services s ON s.service_id = a.service_id
        WHERE s.congregation_id = $1 ${filter}
        ORDER BY a.attended_at DESC
        LIMIT $${params.length}`,
      params,
    );
  }

  /** Per-service totals, newest first — the end-of-day report for each gathering. */
  async serviceSummaries(principal: Principal, year: number): Promise<ServiceAttendanceSummary[]> {
    const { from, to } = yearBounds(year);
    const expected = await one<{ n: number }>(
      this.pool,
      `SELECT count(*)::int AS n FROM users WHERE congregation_id = $1 AND deleted_at IS NULL`,
      [principal.congregationId],
    );
    const rows = await many<{
      service_id: string;
      title: string;
      service_date: string;
      starts_at: string;
      counts_for_streak: boolean;
      attended: number;
    }>(
      this.pool,
      `SELECT s.service_id, s.title, s.service_date::text AS service_date, s.starts_at,
              s.counts_for_streak,
              count(a.attendance_id)::int AS attended
         FROM church_services s
         LEFT JOIN service_attendance a ON a.service_id = s.service_id
        WHERE s.congregation_id = $1 AND s.starts_at >= $2 AND s.starts_at < $3 AND s.starts_at <= now()
        GROUP BY s.service_id, s.title, s.service_date, s.starts_at, s.counts_for_streak
        ORDER BY s.starts_at DESC`,
      [principal.congregationId, from, to],
    );
    return rows.map((r) => ({
      service_id: r.service_id,
      title: r.title,
      service_date: r.service_date,
      starts_at: r.starts_at,
      counts_for_streak: r.counts_for_streak,
      expected: expected.n,
      attended: r.attended,
      absent: Math.max(expected.n - r.attended, 0),
      attendance_rate: expected.n > 0 ? Math.round((r.attended / expected.n) * 1000) / 1000 : null,
    }));
  }

  /**
   * Who missed a given service — the call list, worst first. Members who have
   * never attended are included but flagged, because "welcome them" and "win
   * them back" are different conversations.
   */
  async absentees(principal: Principal, serviceId: string): Promise<{ service: ServiceAttendanceSummary; absentees: Absentee[] }> {
    const svc = await maybeOne<{
      service_id: string;
      congregation_id: string;
      title: string;
      service_date: string;
      starts_at: string;
      counts_for_streak: boolean;
    }>(
      this.pool,
      `SELECT service_id, congregation_id, title, service_date::text AS service_date, starts_at, counts_for_streak
         FROM church_services WHERE service_id = $1`,
      [serviceId],
    );
    if (!svc) throw new ApiError("NOT_FOUND", "Service not found");
    if (svc.congregation_id !== principal.congregationId) {
      throw new ApiError("FORBIDDEN_SCOPE", "That service belongs to another congregation");
    }

    const year = Number(svc.service_date.slice(0, 4));
    const standing = await this.members(principal, year);
    const attended = new Set(
      (
        await many<{ user_id: string }>(this.pool, `SELECT user_id FROM service_attendance WHERE service_id = $1`, [
          serviceId,
        ])
      ).map((r) => r.user_id),
    );

    const absentees: Absentee[] = standing
      .filter((m) => !attended.has(m.user_id))
      .map((m) => ({
        user_id: m.user_id,
        full_name: m.full_name,
        phone_number: m.phone_number,
        email: m.email,
        last_attended_at: m.last_attended_at,
        current_miss_run: m.current_miss_run,
        // What they were on before the gap — the size of what's being lost.
        streak_lost: m.current_miss_run > 0 ? m.longest_streak : 0,
        never_attended: m.never_attended,
      }));

    const expected = standing.length;
    const present = attended.size;
    return {
      service: {
        service_id: svc.service_id,
        title: svc.title,
        service_date: svc.service_date,
        starts_at: svc.starts_at,
        counts_for_streak: svc.counts_for_streak,
        expected,
        attended: present,
        absent: Math.max(expected - present, 0),
        attendance_rate: expected > 0 ? Math.round((present / expected) * 1000) / 1000 : null,
      },
      absentees,
    };
  }

  /** The one-screen year figure: services held, who's engaged, who's slipping. */
  async yearOverview(principal: Principal, year: number): Promise<YearOverview> {
    const { from, to } = yearBounds(year);
    const held = await one<{ services: number; sundays: number; check_ins: number }>(
      this.pool,
      `SELECT
         count(DISTINCT s.service_id)::int AS services,
         count(DISTINCT s.service_id) FILTER (WHERE EXTRACT(DOW FROM s.service_date) = 0)::int AS sundays,
         count(a.attendance_id)::int AS check_ins
       FROM church_services s
       LEFT JOIN service_attendance a ON a.service_id = s.service_id
      WHERE s.congregation_id = $1 AND s.counts_for_streak = TRUE
        AND s.starts_at >= $2 AND s.starts_at < $3 AND s.starts_at <= now()`,
      [principal.congregationId, from, to],
    );
    const events = await one<{ n: number }>(
      this.pool,
      `SELECT count(*)::int AS n
         FROM attendance_logs a
         JOIN events e ON e.event_id = a.event_id
        WHERE e.congregation_id = $1 AND a.checked_in_at >= $2 AND a.checked_in_at < $3`,
      [principal.congregationId, from, to],
    );
    const standing = await this.members(principal, year);
    return {
      year,
      services_held: held.services,
      sundays_held: held.sundays,
      members: standing.length,
      members_attended: standing.filter((m) => !m.never_attended).length,
      members_never_attended: standing.filter((m) => m.never_attended).length,
      members_at_risk: standing.filter((m) => m.status === "at_risk").length,
      members_broken: standing.filter((m) => m.status === "broken").length,
      total_check_ins: held.check_ins,
      total_event_check_ins: events.n,
    };
  }
}
