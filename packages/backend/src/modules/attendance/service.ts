// Church service attendance (spec §3.3, §5; Contract Matrix B2).
//
// A member arrives, opens the app, and scans the QR displayed on the sanctuary
// screen. The code carries the service id AND an HMAC of that service's
// qr_secret, so one scan both identifies the service and proves the member was
// looking at the real code — a screenshot of a generic QR can't forge
// attendance, and rotating qr_secret invalidates every code ever printed.
//
// The check-in registers the member's contact details (name, phone, email) and
// the time they attended, as a snapshot on the attendance row: the roster has to
// keep saying who was in the room and how to reach them that day even after the
// member edits their profile later.
//
// Attendance then rolls up into a streak counted in SERVICES, with breaks
// (interruptions) and failures (missed services) — see ./streak.ts for the math.
import type { Pool } from "pg";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { many, maybeOne, one, tx, enqueueOutbox, audit, recordActivityEvent, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import type { Principal } from "../../http/http.js";
import { computeAttendanceStreak, EMPTY_STREAK, type AttendanceStreak, type ServiceOutcome } from "./streak.js";

/** Clock skew we forgive on a client-supplied attended_at before clamping. */
const CLOCK_SKEW_MS = 120_000;

/** Prefix of the QR payload — lets a scanner reject unrelated codes instantly. */
const QR_PREFIX = "nuru-service";

/** The token a valid service QR encodes. Stable per service; rotate qr_secret to invalidate. */
export function serviceScanToken(qrSecret: string, serviceId: string): string {
  return createHmac("sha256", qrSecret).update(serviceId).digest("hex");
}

/**
 * The full string printed into the QR: `nuru-service:<service_id>:<token>`.
 * Carrying the id inside the code is what lets a member scan without first
 * picking a service from a list — the one scan is the whole interaction.
 */
export function serviceQrPayload(serviceId: string, qrSecret: string): string {
  return `${QR_PREFIX}:${serviceId}:${serviceScanToken(qrSecret, serviceId)}`;
}

/** Parse a scanned payload. Returns null for anything that isn't one of ours. */
export function parseServiceQrPayload(raw: string): { service_id: string; scan_token: string } | null {
  const parts = raw.trim().split(":");
  if (parts.length !== 3 || parts[0] !== QR_PREFIX) return null;
  const [, serviceId, token] = parts;
  if (!serviceId || !token) return null;
  return { service_id: serviceId, scan_token: token };
}

function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export const checkInSchema = z.object({
  client_scan_id: z.string().uuid(),
  scan_token: z.string().min(1),
  // Contact registration. Optional on the wire: the app prefills them from the
  // profile, and if it sends nothing we fall back to the profile server-side so
  // a check-in can never fail for want of a field the member already gave us.
  full_name: z.string().trim().min(1).max(255).optional(),
  phone_number: z.string().trim().min(1).max(32).optional(),
  email: z.string().trim().email().max(255).nullable().optional(),
  /** When the member actually arrived — set by the offline queue on replay. */
  attended_at: z.string().datetime({ offset: true }).optional(),
});
export type CheckInInput = z.infer<typeof checkInSchema>;

export const createServiceSchema = z.object({
  title: z.string().trim().min(1).max(255),
  service_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "service_date must be YYYY-MM-DD"),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }).nullable().optional(),
  checkin_opens_at: z.string().datetime({ offset: true }).nullable().optional(),
  checkin_closes_at: z.string().datetime({ offset: true }).nullable().optional(),
  qr_enabled: z.boolean().default(true),
  counts_for_streak: z.boolean().default(true),
});
export type CreateServiceInput = z.infer<typeof createServiceSchema>;

export interface ChurchServiceRow {
  service_id: string;
  congregation_id: string;
  title: string;
  service_date: string;
  starts_at: string;
  ends_at: string | null;
  checkin_opens_at: string | null;
  checkin_closes_at: string | null;
  qr_enabled: boolean;
  counts_for_streak: boolean;
}

export interface ChurchServiceView extends Omit<ChurchServiceRow, "congregation_id"> {
  /** True when a member could scan into it right now. */
  checkin_open: boolean;
  /** Whether the calling member is already checked in. */
  attended: boolean;
  attended_at: string | null;
}

export interface ServiceCheckInResult {
  attendance_id: string;
  duplicate: boolean;
  service_id: string;
  service_title: string;
  attended_at: string;
  full_name: string;
  phone_number: string;
  email: string | null;
  streak: AttendanceStreak;
}

export interface AttendanceHistoryEntry {
  service_id: string;
  title: string;
  service_date: string;
  starts_at: string;
  attended: boolean;
  attended_at: string | null;
}

export interface RosterEntry {
  attendance_id: string;
  user_id: string;
  full_name: string;
  phone_number: string;
  email: string | null;
  attended_at: string;
  method: string;
  note: string | null;
}

/**
 * The service projection. Takes a table prefix because the same column list is
 * used both bare (single-table SELECT, INSERT ... RETURNING) and qualified —
 * `service_id` is ambiguous once church_services is joined to service_attendance.
 */
const serviceColumns = (p = ""): string =>
  `${p}service_id, ${p}congregation_id, ${p}title, ${p}service_date::text AS service_date,
   ${p}starts_at, ${p}ends_at, ${p}checkin_opens_at, ${p}checkin_closes_at, ${p}qr_enabled, ${p}counts_for_streak`;

export class ChurchAttendanceService {
  constructor(private readonly pool: Pool) {}

  // ---------------- Member: scanning + check-in ----------------

  /**
   * Record a QR check-in. Idempotent twice over: on client_scan_id (an offline
   * replay) and on (user, service) (a second scan of the same code), both of
   * which come back `duplicate: true` with the original row rather than an error
   * — a member who scans twice should see "you're already in", never a failure.
   */
  async checkIn(principal: Principal, serviceId: string, input: CheckInInput): Promise<ServiceCheckInResult> {
    return tx(this.pool, async (c) => {
      const svc = await maybeOne<ChurchServiceRow>(
        c,
        `SELECT ${serviceColumns()} FROM church_services WHERE service_id = $1`,
        [serviceId],
      );
      if (!svc) throw new ApiError("NOT_FOUND", "Service not found");
      // A valid token for another branch's service must not check you in here.
      if (svc.congregation_id !== principal.congregationId) {
        throw new ApiError("FORBIDDEN_SCOPE", "That service belongs to another congregation");
      }
      if (!svc.qr_enabled) throw new ApiError("UNPROCESSABLE", "QR check-in is not enabled for this service");

      const now = Date.now();
      if (svc.checkin_opens_at && now < new Date(svc.checkin_opens_at).getTime()) {
        throw new ApiError("UNPROCESSABLE", "Check-in has not opened yet for this service");
      }
      if (svc.checkin_closes_at && now > new Date(svc.checkin_closes_at).getTime()) {
        throw new ApiError("UNPROCESSABLE", "Check-in has closed for this service");
      }
      if (!tokensMatch(serviceScanToken(await this.secretFor(c, serviceId), serviceId), input.scan_token)) {
        throw new ApiError("VALIDATION_FAILED", "Invalid or expired scan token");
      }

      const contact = await this.resolveContact(c, principal.userId, input);
      const attendedAt = clampAttendedAt(input.attended_at, now);

      // The offline queue may replay the same scan; that is a no-op, not a second row.
      const replay = await maybeOne<{ attendance_id: string; service_id: string }>(
        c,
        `SELECT attendance_id, service_id FROM service_attendance WHERE client_scan_id = $1`,
        [input.client_scan_id],
      );
      if (replay && replay.service_id !== serviceId) {
        throw new ApiError("VALIDATION_FAILED", "That scan id was already used for a different service");
      }

      const inserted = await maybeOne<{ attendance_id: string; attended_at: string }>(
        c,
        `INSERT INTO service_attendance
           (service_id, user_id, full_name, phone_number, email, attended_at, method, client_scan_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'qr', $7)
         ON CONFLICT (user_id, service_id) DO NOTHING
         RETURNING attendance_id, attended_at`,
        [serviceId, principal.userId, contact.full_name, contact.phone_number, contact.email, attendedAt, input.client_scan_id],
      );

      if (!inserted) {
        const existing = await one<{
          attendance_id: string;
          attended_at: string;
          full_name: string;
          phone_number: string;
          email: string | null;
        }>(
          c,
          `SELECT attendance_id, attended_at, full_name, phone_number, email
             FROM service_attendance WHERE user_id = $1 AND service_id = $2`,
          [principal.userId, serviceId],
        );
        return {
          attendance_id: existing.attendance_id,
          duplicate: true,
          service_id: serviceId,
          service_title: svc.title,
          attended_at: existing.attended_at,
          full_name: existing.full_name,
          phone_number: existing.phone_number,
          email: existing.email,
          streak: await this.recomputeStreak(c, principal.userId, principal.congregationId),
        };
      }

      // Same downstream effects as event attendance, so scores, bands and the
      // daily activity streak all see a service check-in as real engagement.
      await enqueueOutbox(c, "engagement.recompute", { user_id: principal.userId });
      await enqueueOutbox(c, "gamification.evaluate", { user_id: principal.userId });
      await recordActivityEvent(c, principal.userId, "check_in");
      await audit(c, principal.userId, "service_attendance.checked_in", "church_services", serviceId, {
        method: "qr",
      });

      return {
        attendance_id: inserted.attendance_id,
        duplicate: false,
        service_id: serviceId,
        service_title: svc.title,
        attended_at: inserted.attended_at,
        full_name: contact.full_name,
        phone_number: contact.phone_number,
        email: contact.email,
        streak: await this.recomputeStreak(c, principal.userId, principal.congregationId),
      };
    });
  }

  /**
   * Services in the member's congregation that are open for check-in right now,
   * soonest first. The scanner screen shows this so a member knows what they're
   * about to scan into (and sees "no service open yet" instead of a dead camera).
   */
  async openServices(principal: Principal): Promise<ChurchServiceView[]> {
    const rows = await many<ChurchServiceRow & { attended_at: string | null }>(
      this.pool,
      `SELECT ${serviceColumns('s.')}, a.attended_at
         FROM church_services s
         LEFT JOIN service_attendance a ON a.service_id = s.service_id AND a.user_id = $2
        WHERE s.congregation_id = $1
          AND s.qr_enabled = TRUE
          AND (s.checkin_opens_at IS NULL OR s.checkin_opens_at <= now())
          AND (s.checkin_closes_at IS NULL OR s.checkin_closes_at >= now())
        ORDER BY s.starts_at ASC
        LIMIT 20`,
      [principal.congregationId, principal.userId],
    );
    return rows.map((r) => toServiceView(r, true));
  }

  /** Upcoming + recent services for the member's congregation (context, not scanning). */
  async listServices(principal: Principal, limit = 20): Promise<ChurchServiceView[]> {
    const rows = await many<ChurchServiceRow & { attended_at: string | null }>(
      this.pool,
      `SELECT ${serviceColumns('s.')}, a.attended_at
         FROM church_services s
         LEFT JOIN service_attendance a ON a.service_id = s.service_id AND a.user_id = $2
        WHERE s.congregation_id = $1
        ORDER BY s.starts_at DESC
        LIMIT $3`,
      [principal.congregationId, principal.userId, Math.min(Math.max(limit, 1), 100)],
    );
    return rows.map((r) => toServiceView(r, checkinOpenNow(r)));
  }

  // ---------------- Member: streak, breaks, failures ----------------

  /** The member's attendance streak, recomputed from source and cached. */
  async streakFor(principal: Principal): Promise<AttendanceStreak> {
    return this.recomputeStreak(this.pool, principal.userId, principal.congregationId);
  }

  /**
   * The member's own attendance history — every eligible service since their
   * first check-in, attended or missed, newest first. This is what makes a
   * "failure" legible: the member can see exactly which Sunday they missed.
   */
  async historyFor(principal: Principal, limit = 30): Promise<AttendanceHistoryEntry[]> {
    const rows = await this.outcomes(this.pool, principal.userId, principal.congregationId);
    return rows
      .slice(-Math.min(Math.max(limit, 1), 200))
      .reverse()
      .map((r) => ({
        service_id: r.service_id,
        title: r.title,
        service_date: r.service_date,
        starts_at: r.starts_at,
        attended: r.attended,
        attended_at: r.attended_at,
      }));
  }

  // ---------------- Leader operations ----------------

  /** Create a service (the cadence slot members scan into). Leader+ only. */
  async createService(principal: Principal, input: CreateServiceInput): Promise<ChurchServiceRow> {
    const qrSecret = randomSecret();
    try {
      const row = await one<ChurchServiceRow>(
        this.pool,
        `INSERT INTO church_services
           (congregation_id, title, service_date, starts_at, ends_at, checkin_opens_at,
            checkin_closes_at, qr_secret, qr_enabled, counts_for_streak, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING ${serviceColumns()}`,
        [
          principal.congregationId,
          input.title,
          input.service_date,
          input.starts_at,
          input.ends_at ?? null,
          input.checkin_opens_at ?? null,
          input.checkin_closes_at ?? null,
          qrSecret,
          input.qr_enabled,
          input.counts_for_streak,
          principal.userId,
        ],
      );
      await audit(this.pool, principal.userId, "service.created", "church_services", row.service_id, {
        title: input.title,
      });
      return row;
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new ApiError("CONFLICT", "A service with that title already exists on that date");
      }
      throw err;
    }
  }

  /**
   * The QR payload to display on the sanctuary screen. Leader+ only — handing
   * this to a member would let them check in without being in the room.
   */
  async qrPayloadFor(principal: Principal, serviceId: string): Promise<{ service_id: string; title: string; payload: string }> {
    const row = await maybeOne<{ congregation_id: string; title: string; qr_secret: string }>(
      this.pool,
      `SELECT congregation_id, title, qr_secret FROM church_services WHERE service_id = $1`,
      [serviceId],
    );
    if (!row) throw new ApiError("NOT_FOUND", "Service not found");
    if (row.congregation_id !== principal.congregationId) {
      throw new ApiError("FORBIDDEN_SCOPE", "That service belongs to another congregation");
    }
    return { service_id: serviceId, title: row.title, payload: serviceQrPayload(serviceId, row.qr_secret) };
  }

  /** Who checked in, with the contact details they registered. Leader+ only. */
  async roster(principal: Principal, serviceId: string): Promise<RosterEntry[]> {
    const svc = await maybeOne<{ congregation_id: string }>(
      this.pool,
      `SELECT congregation_id FROM church_services WHERE service_id = $1`,
      [serviceId],
    );
    if (!svc) throw new ApiError("NOT_FOUND", "Service not found");
    if (svc.congregation_id !== principal.congregationId) {
      throw new ApiError("FORBIDDEN_SCOPE", "That service belongs to another congregation");
    }
    return many<RosterEntry>(
      this.pool,
      `SELECT attendance_id, user_id, full_name, phone_number, email, attended_at, method, note
         FROM service_attendance WHERE service_id = $1 ORDER BY attended_at ASC`,
      [serviceId],
    );
  }

  // ---------------- Internals ----------------

  /**
   * Read the HMAC seed on its own. Deliberately NOT part of `serviceColumns()`:
   * that projection flows into member-facing views, and a qr_secret that never
   * enters the row type cannot be leaked by a future field being passed through.
   */
  private async secretFor(c: Queryable, serviceId: string): Promise<string> {
    const row = await one<{ qr_secret: string }>(c, `SELECT qr_secret FROM church_services WHERE service_id = $1`, [
      serviceId,
    ]);
    return row.qr_secret;
  }

  /**
   * Contact details for the attendance snapshot: what the member typed on the
   * check-in sheet, falling back to their profile for anything they left out.
   */
  private async resolveContact(
    c: Queryable,
    userId: string,
    input: CheckInInput,
  ): Promise<{ full_name: string; phone_number: string; email: string | null }> {
    const profile = await one<{ full_name: string; phone_number: string; email: string | null }>(
      c,
      `SELECT full_name, phone_number, email FROM users WHERE user_id = $1`,
      [userId],
    );
    const fullName = input.full_name ?? profile.full_name;
    const phone = input.phone_number ?? profile.phone_number;
    if (!fullName || !phone) {
      throw new ApiError("VALIDATION_FAILED", "A name and phone number are required to register attendance");
    }
    // `email: null` in the body is an explicit "I have no email"; omitted falls back.
    const email = input.email === undefined ? profile.email : input.email;
    return { full_name: fullName, phone_number: phone, email: email ?? null };
  }

  /**
   * One member's eligible services, oldest → newest, each resolved to
   * attended/missed. Bounded at their first-ever check-in: services held before
   * a member ever showed up are not failures they own (see ./streak.ts).
   */
  private async outcomes(c: Queryable, userId: string, congregationId: string): Promise<ServiceOutcome[]> {
    return many<ServiceOutcome>(
      c,
      `SELECT s.service_id,
              s.title,
              s.service_date::text AS service_date,
              s.starts_at,
              (a.attendance_id IS NOT NULL) AS attended,
              a.attended_at
         FROM church_services s
         LEFT JOIN service_attendance a ON a.service_id = s.service_id AND a.user_id = $1
        WHERE s.congregation_id = $2
          AND s.counts_for_streak = TRUE
          AND s.starts_at <= now()
          AND s.starts_at >= COALESCE(
                (SELECT min(s2.starts_at)
                   FROM service_attendance a2
                   JOIN church_services s2 ON s2.service_id = a2.service_id
                  WHERE a2.user_id = $1 AND s2.congregation_id = $2),
                'infinity'::timestamptz)
        ORDER BY s.starts_at ASC, s.service_id ASC`,
      [userId, congregationId],
    );
  }

  /** Recompute from source and refresh the cohort-query snapshot. */
  private async recomputeStreak(c: Queryable, userId: string, congregationId: string): Promise<AttendanceStreak> {
    const streak = computeAttendanceStreak(await this.outcomes(c, userId, congregationId));
    await c.query(
      `INSERT INTO service_attendance_streaks
         (user_id, current_streak, longest_streak, total_attended, total_missed, breaks,
          current_miss_run, last_attended_at, last_service_date, status, computed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       ON CONFLICT (user_id) DO UPDATE SET
         current_streak = EXCLUDED.current_streak,
         longest_streak = GREATEST(service_attendance_streaks.longest_streak, EXCLUDED.longest_streak),
         total_attended = EXCLUDED.total_attended,
         total_missed = EXCLUDED.total_missed,
         breaks = EXCLUDED.breaks,
         current_miss_run = EXCLUDED.current_miss_run,
         last_attended_at = EXCLUDED.last_attended_at,
         last_service_date = EXCLUDED.last_service_date,
         status = EXCLUDED.status,
         computed_at = now()`,
      [
        userId,
        streak.current_streak,
        streak.longest_streak,
        streak.total_attended,
        streak.total_missed,
        streak.breaks,
        streak.current_miss_run,
        streak.last_attended_at,
        streak.last_service_date,
        streak.status,
      ],
    );
    return streak;
  }
}

function clampAttendedAt(supplied: string | undefined, nowMs: number): string {
  if (!supplied) return new Date(nowMs).toISOString();
  const t = new Date(supplied).getTime();
  // A client clock running fast must not stamp attendance into the future.
  if (Number.isNaN(t) || t > nowMs + CLOCK_SKEW_MS) return new Date(nowMs).toISOString();
  return new Date(t).toISOString();
}

function checkinOpenNow(r: ChurchServiceRow): boolean {
  if (!r.qr_enabled) return false;
  const now = Date.now();
  if (r.checkin_opens_at && now < new Date(r.checkin_opens_at).getTime()) return false;
  if (r.checkin_closes_at && now > new Date(r.checkin_closes_at).getTime()) return false;
  return true;
}

function toServiceView(r: ChurchServiceRow & { attended_at: string | null }, open: boolean): ChurchServiceView {
  return {
    service_id: r.service_id,
    title: r.title,
    service_date: r.service_date,
    starts_at: r.starts_at,
    ends_at: r.ends_at,
    checkin_opens_at: r.checkin_opens_at,
    checkin_closes_at: r.checkin_closes_at,
    qr_enabled: r.qr_enabled,
    counts_for_streak: r.counts_for_streak,
    checkin_open: open,
    attended: r.attended_at != null,
    attended_at: r.attended_at,
  };
}

/** Per-service HMAC seed. Rotating it invalidates every code already printed. */
function randomSecret(): string {
  return randomBytes(32).toString("hex");
}

export { EMPTY_STREAK };
export type { AttendanceStreak };
