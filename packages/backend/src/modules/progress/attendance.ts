// Attendance (spec §3.3, §5; Contract Matrix B2). A member scans an event QR
// whose token is an HMAC of the event's qr_secret; the server validates it (so a
// screenshot of a generic code can't forge attendance) and records the check-in
// idempotently (client_scan_id / one-per-event). Leaders can record MANUAL
// check-ins (with a reason) and walk-in/first-time guests; the roster view powers
// the portal's Attendance screen (checked-in, guests, RSVP'd-but-absent).
import type { Pool } from "pg";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { many, maybeOne, one, tx, enqueueOutbox, audit, recordActivityEvent } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { assertCellInScope } from "../../http/auth.js";
import type { Principal } from "../../http/http.js";

/** The token a valid event QR encodes. Stable per event; rotate qr_secret to invalidate. */
export function eventScanToken(qrSecret: string, eventId: string): string {
  return createHmac("sha256", qrSecret).update(eventId).digest("hex");
}

/** How long an issued QR token stays valid before the panel rotates the secret
 *  (EVENTS_ARCHITECTURE §6 — time-boxed rotation; a screenshot goes stale). */
const QR_TOKEN_TTL_MIN = 30;

function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export interface CheckInResult {
  attendance_id: string;
  duplicate: boolean;
}

export class AttendanceService {
  constructor(private readonly pool: Pool) {}

  async checkIn(
    userId: string,
    eventId: string,
    input: { client_scan_id: string; scan_token: string },
  ): Promise<CheckInResult> {
    return tx(this.pool, async (c) => {
      const event = await maybeOne<{ qr_secret: string; qr_enabled: boolean; checkin_opens_at: string | null }>(
        c,
        `SELECT qr_secret, qr_enabled, checkin_opens_at FROM events WHERE event_id = $1`,
        [eventId],
      );
      if (!event) throw new ApiError("NOT_FOUND", "Event not found");
      if (!event.qr_enabled) throw new ApiError("UNPROCESSABLE", "QR check-in is not enabled for this event");
      if (event.checkin_opens_at && Date.now() < new Date(event.checkin_opens_at).getTime()) {
        throw new ApiError("UNPROCESSABLE", "Check-in has not opened yet for this event");
      }
      if (!tokensMatch(eventScanToken(event.qr_secret, eventId), input.scan_token)) {
        throw new ApiError("VALIDATION_FAILED", "Invalid or expired scan token");
      }

      // Idempotent: a replayed scan, or a second scan of the same event, is a no-op.
      const row = await maybeOne<{ attendance_id: string }>(
        c,
        `INSERT INTO attendance_logs (user_id, event_id, client_scan_id, method)
         VALUES ($1, $2, $3, 'qr')
         ON CONFLICT (user_id, event_id) DO NOTHING
         RETURNING attendance_id`,
        [userId, eventId, input.client_scan_id],
      );
      if (!row) {
        const existing = await one<{ attendance_id: string }>(
          c,
          `SELECT attendance_id FROM attendance_logs WHERE user_id = $1 AND event_id = $2`,
          [userId, eventId],
        );
        return { attendance_id: existing.attendance_id, duplicate: true };
      }

      await enqueueOutbox(c, "engagement.recompute", { user_id: userId });
      await enqueueOutbox(c, "gamification.evaluate", { user_id: userId });
      await recordActivityEvent(c, userId, "check_in"); // attendance now counts toward habit/attendance scores + streak
      await audit(c, userId, "attendance.checked_in", "events", eventId, {});
      return { attendance_id: row.attendance_id, duplicate: false };
    });
  }

  // ---------------- Leader operations (Contract Matrix B2) ----------------

  /** Load the event's cell for scope checks; a cell-less event is congregation-wide. */
  private async eventForOps(
    c: Parameters<typeof maybeOne>[0],
    eventId: string,
  ): Promise<{ cell_group_id: string | null; allow_manual_checkin: boolean }> {
    const ev = await maybeOne<{ cell_group_id: string | null; allow_manual_checkin: boolean }>(
      c,
      `SELECT cell_group_id, allow_manual_checkin FROM events WHERE event_id = $1`,
      [eventId],
    );
    if (!ev) throw new ApiError("NOT_FOUND", "Event not found");
    return ev;
  }

  static readonly ManualCheckIn = z
    .object({ user_id: z.string().uuid(), note: z.string().max(255).optional() })
    .strict();

  /**
   * Manual check-in by a leader (no QR): scoped — an Instructor must lead the
   * event's cell (congregation-wide events are Admin+); idempotent per
   * (user,event); recorded with method/recorder/reason and audited.
   */
  async manualCheckIn(
    principal: Principal,
    eventId: string,
    input: z.infer<typeof AttendanceService.ManualCheckIn>,
  ): Promise<CheckInResult> {
    return tx(this.pool, async (c) => {
      const ev = await this.eventForOps(c, eventId);
      if (!ev.allow_manual_checkin) {
        throw new ApiError("UNPROCESSABLE", "Manual check-in is not allowed for this event");
      }
      // Cell-scoped leaders only; assertCellInScope passes Admin/SuperAdmin outright.
      await assertCellInScope(c, principal, ev.cell_group_id ?? "");

      const member = await maybeOne(c, `SELECT 1 FROM users WHERE user_id = $1 AND deleted_at IS NULL`, [input.user_id]);
      if (!member) throw new ApiError("NOT_FOUND", "Member not found");

      const row = await maybeOne<{ attendance_id: string }>(
        c,
        `INSERT INTO attendance_logs (user_id, event_id, method, recorded_by, note)
         VALUES ($1, $2, 'manual', $3, $4)
         ON CONFLICT (user_id, event_id) DO NOTHING
         RETURNING attendance_id`,
        [input.user_id, eventId, principal.userId, input.note ?? null],
      );
      if (!row) {
        const existing = await one<{ attendance_id: string }>(
          c,
          `SELECT attendance_id FROM attendance_logs WHERE user_id = $1 AND event_id = $2`,
          [input.user_id, eventId],
        );
        return { attendance_id: existing.attendance_id, duplicate: true };
      }

      await enqueueOutbox(c, "engagement.recompute", { user_id: input.user_id });
      await recordActivityEvent(c, input.user_id, "check_in");
      await audit(c, principal.userId, "attendance.manual_checkin", "events", eventId, {
        user_id: input.user_id,
        note: input.note ?? null,
      });
      return { attendance_id: row.attendance_id, duplicate: false };
    });
  }

  static readonly AddGuest = z
    .object({
      guest_name: z.string().min(1).max(255),
      phone: z.string().max(32).optional(),
      first_time: z.boolean().default(true),
    })
    .strict();

  /** Record a walk-in / first-time guest (a non-member, so no user row). Audited. */
  async addGuest(
    principal: Principal,
    eventId: string,
    input: z.infer<typeof AttendanceService.AddGuest>,
  ): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const ev = await this.eventForOps(c, eventId);
      await assertCellInScope(c, principal, ev.cell_group_id ?? "");
      const row = await one(
        c,
        `INSERT INTO event_guests (event_id, guest_name, phone, first_time, recorded_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING guest_id, event_id, guest_name, phone, first_time, created_at`,
        [eventId, input.guest_name, input.phone ?? null, input.first_time ?? true, principal.userId],
      );
      await audit(c, principal.userId, "attendance.guest_added", "events", eventId, { guest_name: input.guest_name });
      return row;
    });
  }

  // ---------------- Real QR + export + insights (EVENTS_ARCHITECTURE §6) ----------------

  /**
   * The admin QR panel: issues the SAME HMAC scan token the member check-in
   * validator (checkIn above) verifies — the consoles finally render a code
   * members can actually scan. Time-boxed: once the token is older than
   * QR_TOKEN_TTL_MIN the secret rotates (invalidating screenshots) and a fresh
   * token is issued; expires_at tells the console when to auto-refresh.
   */
  async qrPanel(principal: Principal, eventId: string): Promise<Record<string, unknown>> {
    const ev = await maybeOne<{
      cell_group_id: string | null;
      qr_enabled: boolean;
      qr_secret: string;
      qr_rotated_at: string | null;
      checkin_opens_at: string | null;
      occurs_at: string;
    }>(
      this.pool,
      `SELECT cell_group_id, qr_enabled, qr_secret, qr_rotated_at, checkin_opens_at, occurs_at
         FROM events WHERE event_id = $1`,
      [eventId],
    );
    if (!ev) throw new ApiError("NOT_FOUND", "Event not found");
    await assertCellInScope(this.pool, principal, ev.cell_group_id ?? "");
    if (!ev.qr_enabled) throw new ApiError("UNPROCESSABLE", "QR check-in is not enabled for this event");

    const ttlMs = QR_TOKEN_TTL_MIN * 60_000;
    let secret = ev.qr_secret;
    let rotatedAt = ev.qr_rotated_at ? new Date(ev.qr_rotated_at) : null;
    if (!rotatedAt || Date.now() >= rotatedAt.getTime() + ttlMs) {
      secret = randomBytes(24).toString("hex");
      rotatedAt = new Date();
      await this.pool.query(`UPDATE events SET qr_secret = $2, qr_rotated_at = $3 WHERE event_id = $1`, [
        eventId,
        secret,
        rotatedAt.toISOString(),
      ]);
      await audit(this.pool, principal.userId, "attendance.qr_rotated", "events", eventId, {});
    }
    const token = eventScanToken(secret, eventId);
    return {
      event_id: eventId,
      scan_token: token,
      // What the rendered QR encodes; the member app parses event_id + token and
      // POSTs /events/{id}/attendance (the frozen member contract).
      checkin_url: `nuru://checkin?event_id=${encodeURIComponent(eventId)}&scan_token=${token}`,
      expires_at: new Date(rotatedAt.getTime() + ttlMs).toISOString(),
      checkin_opens_at: ev.checkin_opens_at,
      occurs_at: ev.occurs_at,
    };
  }

  /** §6: the export button becomes real — roster + guests + no-shows, one CSV. */
  async rosterCsv(principal: Principal, eventId: string): Promise<string> {
    const roster = (await this.roster(principal, eventId)) as {
      checked_in: Array<{ full_name: string; method: string; note: string | null; checked_in_at: string }>;
      guests: Array<{ guest_name: string; phone: string | null; first_time: boolean; created_at: string }>;
      rsvp_no_show: Array<{ full_name: string }>;
    };
    const esc = (v: unknown): string => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines: string[] = ["name,type,status,method,first_time,timestamp"];
    for (const r of roster.checked_in) {
      lines.push([esc(r.full_name), "member", "checked_in", esc(r.method), "", esc(r.checked_in_at)].join(","));
    }
    for (const g of roster.guests) {
      lines.push([esc(g.guest_name), "guest", "checked_in", "manual", String(g.first_time), esc(g.created_at)].join(","));
    }
    for (const a of roster.rsvp_no_show) {
      lines.push([esc(a.full_name), "member", "rsvp_no_show", "", "", ""].join(","));
    }
    return lines.join("\n") + "\n";
  }

  /**
   * §6: /admin/events/insights — ONLY numbers the schema actually knows:
   * RSVP→check-in conversion over the last 10 completed occurrences, first-time
   * guests (30d), manual check-ins (7d), RSVP'd-but-absent for the most recent
   * occurrence of each active series, and upcoming events with low RSVPs /
   * cell no-response counts. Nothing fabricated.
   */
  async insights(principal: Principal): Promise<Record<string, unknown>> {
    const cong = principal.congregationId;
    const conversion = await one<{ going: number; checked_in: number }>(
      this.pool,
      `WITH recent AS (
         SELECT event_id FROM events
          WHERE congregation_id = $1 AND occurs_at < now()
          ORDER BY occurs_at DESC LIMIT 10)
       SELECT (SELECT count(*)::int FROM event_rsvps r WHERE r.status = 'going' AND r.event_id IN (SELECT event_id FROM recent)) AS going,
              (SELECT count(*)::int FROM attendance_logs a WHERE a.event_id IN (SELECT event_id FROM recent)) AS checked_in`,
      [cong],
    );
    const firstTime = await one<{ n: number }>(
      this.pool,
      `SELECT count(*)::int AS n FROM event_guests g JOIN events e ON e.event_id = g.event_id
        WHERE e.congregation_id = $1 AND g.first_time AND g.created_at >= now() - interval '30 days'`,
      [cong],
    );
    const manual = await one<{ n: number }>(
      this.pool,
      `SELECT count(*)::int AS n FROM attendance_logs a JOIN events e ON e.event_id = a.event_id
        WHERE e.congregation_id = $1 AND a.method = 'manual' AND a.checked_in_at >= now() - interval '7 days'`,
      [cong],
    );
    // RSVP'd-but-absent for the most recent completed occurrence of each active series.
    const recentNoShows = await many(
      this.pool,
      `SELECT s.series_id, s.title, e.event_id AS occurrence_id, e.occurs_at,
              (SELECT count(*)::int FROM event_rsvps r
                WHERE r.event_id = e.event_id AND r.status = 'going'
                  AND NOT EXISTS (SELECT 1 FROM attendance_logs a WHERE a.event_id = r.event_id AND a.user_id = r.user_id)) AS absent
         FROM event_series s
         JOIN LATERAL (
           SELECT event_id, occurs_at FROM events e
            WHERE e.series_id = s.series_id AND e.occurs_at < now()
            ORDER BY e.occurs_at DESC LIMIT 1
         ) e ON TRUE
        WHERE s.congregation_id = $1 AND s.deleted_at IS NULL AND s.status = 'active'
        ORDER BY e.occurs_at DESC`,
      [cong],
    );
    // Upcoming 14 days: real going counts, low-RSVP flag (per-series automation
    // threshold, else 5), and cell no-response counts where derivable.
    const upcoming = await many(
      this.pool,
      `SELECT e.event_id AS occurrence_id, e.title, e.occurs_at, s.series_id,
              (SELECT count(*)::int FROM event_rsvps r WHERE r.event_id = e.event_id AND r.status = 'going') AS going,
              COALESCE((s.automation->'low_rsvp_alert'->>'threshold')::int, 5) AS threshold,
              CASE WHEN e.cell_group_id IS NOT NULL THEN
                (SELECT count(*)::int FROM users u
                  WHERE u.cell_group_id = e.cell_group_id AND u.deleted_at IS NULL
                    AND NOT EXISTS (SELECT 1 FROM event_rsvps r WHERE r.event_id = e.event_id AND r.user_id = u.user_id))
              END AS no_response
         FROM events e LEFT JOIN event_series s ON s.series_id = e.series_id
        WHERE e.congregation_id = $1 AND e.archived_at IS NULL
          AND e.occurs_at >= now() AND e.occurs_at < now() + interval '14 days'
        ORDER BY e.occurs_at ASC
        LIMIT 50`,
      [cong],
    );
    const going = conversion.going;
    const checkedIn = conversion.checked_in;
    return {
      conversion: {
        going,
        checked_in: checkedIn,
        rate: going > 0 ? Math.round((checkedIn / going) * 100) : null,
      },
      first_time_guests_30d: firstTime.n,
      manual_checkins_7d: manual.n,
      recent_no_shows: recentNoShows,
      upcoming: (upcoming as Array<{ going: number; threshold: number }>).map((u) => ({
        ...u,
        low_rsvp: u.going < u.threshold,
      })),
    };
  }

  /** The portal roster: checked-in (with method), guests, and RSVP'd-but-absent. */
  async roster(principal: Principal, eventId: string): Promise<Record<string, unknown>> {
    const ev = await this.eventForOps(this.pool, eventId);
    await assertCellInScope(this.pool, principal, ev.cell_group_id ?? "");

    const checkedIn = await many(
      this.pool,
      `SELECT al.attendance_id, al.user_id, u.full_name, al.method, al.note, al.checked_in_at
         FROM attendance_logs al JOIN users u ON u.user_id = al.user_id
        WHERE al.event_id = $1 ORDER BY al.checked_in_at`,
      [eventId],
    );
    const guests = await many(
      this.pool,
      `SELECT guest_id, guest_name, phone, first_time, created_at FROM event_guests
        WHERE event_id = $1 ORDER BY created_at`,
      [eventId],
    );
    const absent = await many(
      this.pool,
      `SELECT r.user_id, u.full_name
         FROM event_rsvps r JOIN users u ON u.user_id = r.user_id
        WHERE r.event_id = $1 AND r.status = 'going'
          AND NOT EXISTS (SELECT 1 FROM attendance_logs al WHERE al.event_id = r.event_id AND al.user_id = r.user_id)
        ORDER BY u.full_name`,
      [eventId],
    );
    return { checked_in: checkedIn, guests, rsvp_no_show: absent };
  }
}
