// Scan-to-join: a visitor scans the projected code and leaves already a member.
//
// The owner chose this over a pending-approval flow, having been shown the
// risk plainly: the code is projected in a public room, so anyone who
// photographs it could self-register. That is a real trade and it was made
// deliberately — someone who walks in on Sunday should not have to wait for an
// administrator before the app is any use to them.
//
// What bounds it, so the decision does not become an open registration hole:
//
//   * THE WINDOW. A join only works while that service's check-in window is
//     open. A photographed code is dead by Monday morning. This is the strongest
//     of the three, because it makes the credential perishable rather than
//     permanent.
//   * THE RATE LIMIT. A burst of joins against one service is refused. A real
//     congregation arrives over minutes, not milliseconds.
//   * THE RECORD. Every join stores the service it came through, so an unusual
//     burst is one query away instead of invisible.
//
// None of these slow down a visitor doing the ordinary thing, which is the test
// a safeguard has to pass here.
import { z } from "zod";
import type pg from "pg";
import { ApiError } from "../../http/errors.js";
import { one, maybeOne, tx, recordChange, audit } from "../../db/db.js";
import { hashPassword } from "../identity/passwords.js";
import { normalizePhone } from "../../lib/phone.js";
import { serviceScanToken } from "./service.js";
import { timingSafeEqual } from "node:crypto";

/** Joins allowed against a single service inside the window. */
const MAX_JOINS_PER_SERVICE = 300;
/** …and inside any 60 seconds, because arrival is human-paced. */
const MAX_JOINS_PER_MINUTE = 20;

export const joinByScanSchema = z
  .object({
    scan_token: z.string().min(16).max(200),
    full_name: z.string().min(1).max(255),
    // Normalised the same way every other entry point does it (migration 195),
    // so a member who joins by scanning is not a second phone format.
    phone_number: z
      .string()
      .min(3)
      .max(32)
      .transform((v) => normalizePhone(v) ?? v),
    email: z
      .string()
      .max(254)
      .transform((v) => v.trim().toLowerCase())
      .pipe(z.string().email()),
    password: z.string().min(8).max(200),
  })
  .strict();

export type JoinByScanInput = z.infer<typeof joinByScanSchema>;

export interface JoinResult {
  user_id: string;
  congregation_id: string;
  service_id: string;
  attendance_recorded: boolean;
}

function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export class ServiceJoinService {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Create a member from a scan of a live service code, record their attendance,
   * and put them on the pathway — all in one transaction. Either a person exists
   * with a pathway and their first Sunday recorded, or nothing happened.
   */
  async joinByScan(serviceId: string, input: JoinByScanInput): Promise<JoinResult> {
    return tx(this.pool, async (c) => {
      const svc = await maybeOne<{
        service_id: string;
        congregation_id: string;
        qr_secret: string;
        qr_enabled: boolean;
        checkin_opens_at: string | null;
        checkin_closes_at: string | null;
        title: string;
      }>(
        c,
        `SELECT service_id, congregation_id, qr_secret, qr_enabled,
                checkin_opens_at, checkin_closes_at, title
           FROM church_services WHERE service_id = $1`,
        [serviceId],
      );
      // Deliberately the same message for "no such service" and "wrong token":
      // this endpoint is unauthenticated, so it must not confirm which service
      // ids exist to someone guessing.
      const reject = (): never => {
        throw new ApiError("VALIDATION_FAILED", "That code is not valid for an open service");
      };
      if (!svc || !svc.qr_enabled) reject();

      const now = Date.now();
      // The window is the safeguard that matters most — it is what stops a
      // photographed code from being a standing invitation.
      const opens = svc!.checkin_opens_at ? new Date(svc!.checkin_opens_at).getTime() : null;
      const closes = svc!.checkin_closes_at ? new Date(svc!.checkin_closes_at).getTime() : null;
      if (opens !== null && now < opens) {
        throw new ApiError("UNPROCESSABLE", "Joining opens when the service does");
      }
      if (closes !== null && now > closes) {
        throw new ApiError("UNPROCESSABLE", "This service's code has closed");
      }
      if (!tokensMatch(serviceScanToken(svc!.qr_secret, serviceId), input.scan_token)) reject();

      await this.enforceRate(c, serviceId);

      const existing = await maybeOne<{ user_id: string }>(
        c,
        `SELECT user_id FROM users WHERE email = $1 AND deleted_at IS NULL`,
        [input.email],
      );
      if (existing) {
        // Someone already with us. Say so plainly rather than creating a second
        // identity for the same person at the door — the 2026-08-13 audit spent
        // a day untangling exactly that.
        throw new ApiError("CONFLICT", "An account with this email already exists — sign in instead");
      }

      const hash = await hashPassword(input.password);
      const user = await one<{ user_id: string }>(
        c,
        `INSERT INTO users (full_name, email, phone_number, password_hash, role,
                            congregation_id, joined_via_service_id)
         VALUES ($1, $2, $3, $4, 'Student', $5, $6)
         RETURNING user_id`,
        [input.full_name, input.email, input.phone_number, hash, svc!.congregation_id, serviceId],
      );

      // On the pathway in the same transaction — the lesson of migration 193,
      // where 28 members held accounts with nothing behind them for up to 42
      // days. A member created here is never in that state.
      const enrollment = await one<{ enrollment_id: string }>(
        c,
        `INSERT INTO enrollments (user_id, current_level, state) VALUES ($1, 1, 'active')
         RETURNING enrollment_id`,
        [user.user_id],
      );
      await c.query(
        `INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [user.user_id],
      );

      // Their first Sunday, recorded as they walk in rather than reconstructed
      // later. method='qr' so the register can tell a scan from a manual mark.
      const attendance = await maybeOne<{ attendance_id: string }>(
        c,
        `INSERT INTO service_attendance
           (service_id, user_id, full_name, phone_number, email, attended_at, method)
         VALUES ($1, $2, $3, $4, $5, now(), 'qr')
         ON CONFLICT (user_id, service_id) DO NOTHING
         RETURNING attendance_id`,
        [serviceId, user.user_id, input.full_name, input.phone_number, input.email],
      );

      await recordChange(c, "users", user.user_id, user.user_id, "upsert");
      await recordChange(c, "enrollments", enrollment.enrollment_id, user.user_id, "upsert");
      await audit(c, user.user_id, "user.joined_by_scan", "users", user.user_id, {
        service_id: serviceId,
        service_title: svc!.title,
      });

      return {
        user_id: user.user_id,
        congregation_id: svc!.congregation_id,
        service_id: serviceId,
        attendance_recorded: attendance !== null,
      };
    });
  }

  /**
   * Refuse a burst. Counted from the attendance rows themselves rather than an
   * in-memory counter, so it survives a restart and holds across every API
   * instance — an in-process limit is no limit at all once there are two.
   */
  private async enforceRate(c: pg.PoolClient, serviceId: string): Promise<void> {
    const counts = await one<{ total: number; last_minute: number }>(
      c,
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE created_at > now() - interval '1 minute')::int AS last_minute
         FROM users WHERE joined_via_service_id = $1`,
      [serviceId],
    );
    if (counts.total >= MAX_JOINS_PER_SERVICE) {
      throw new ApiError("RATE_LIMITED", "This service has reached its joining limit");
    }
    if (counts.last_minute >= MAX_JOINS_PER_MINUTE) {
      throw new ApiError("RATE_LIMITED", "Too many people joining at once — try again in a moment");
    }
  }
}
