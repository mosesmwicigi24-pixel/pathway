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
import type { Principal } from "../../http/http.js";

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

/** A returning phone: the continuity token says who, the scan token says where. */
export const returnByScanSchema = z
  .object({
    continuity_token: z.string().min(16).max(2000),
    scan_token: z.string().min(16).max(200),
    client_scan_id: z.string().uuid(),
  })
  .strict();

export interface JoinResult {
  user_id: string;
  congregation_id: string;
  service_id: string;
  attendance_recorded: boolean;
}

/** What the standing poster URL resolves to at the moment it is scanned. */
export type StandingCodeResolution =
  | {
      congregation: string;
      open: true;
      service: { service_id: string; title: string; starts_at: string; scan_token: string };
    }
  | { congregation: string; open: false; next: { title: string; starts_at: string } | null };

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
   * The standing poster resolves here (migration 200): /jc/<join_code> → the
   * congregation's service whose check-in window is open RIGHT NOW, with its
   * scan token. Same poster every week; the resolution is what moves.
   *
   * Handing out the scan token from an unauthenticated GET is the deliberate
   * concession the standing code makes — the owner chose a printable poster
   * over in-room-only proof (2026-08-21). Outside a window this returns no
   * token at all, so a photographed poster is inert six days out of seven,
   * and everything a leaked token enables is still rate-limited and recorded.
   *
   * When two windows overlap, the most recently opened wins: the 8am overflow
   * service's code should not swallow scans meant for the 11am main one.
   */
  async resolveStandingCode(code: string): Promise<StandingCodeResolution> {
    // Same silence for "no such code" and malformed input: this endpoint must
    // not confirm which codes exist to someone enumerating.
    if (code.length < 16 || code.length > 200) {
      throw new ApiError("VALIDATION_FAILED", "That code is not valid");
    }
    const cong = await maybeOne<{ congregation_id: string; name: string }>(
      this.pool,
      `SELECT congregation_id, name FROM congregations WHERE join_code = $1`,
      [code],
    );
    if (!cong) throw new ApiError("VALIDATION_FAILED", "That code is not valid");

    const open = await maybeOne<{
      service_id: string;
      title: string;
      starts_at: string;
      qr_secret: string;
    }>(
      this.pool,
      `SELECT service_id, title, starts_at, qr_secret
         FROM church_services
        WHERE congregation_id = $1
          AND qr_enabled = TRUE
          AND (checkin_opens_at IS NULL OR checkin_opens_at <= now())
          AND (checkin_closes_at IS NULL OR checkin_closes_at >= now())
        ORDER BY checkin_opens_at DESC NULLS LAST
        LIMIT 1`,
      [cong.congregation_id],
    );
    if (open) {
      return {
        congregation: cong.name,
        open: true,
        service: {
          service_id: open.service_id,
          title: open.title,
          starts_at: open.starts_at,
          scan_token: serviceScanToken(open.qr_secret, open.service_id),
        },
      };
    }

    // Closed. Tell the visitor when to come back — a service schedule is the
    // one thing a church wants strangers to know.
    const next = await maybeOne<{ title: string; starts_at: string }>(
      this.pool,
      `SELECT title, starts_at FROM church_services
        WHERE congregation_id = $1 AND qr_enabled = TRUE AND starts_at > now()
        ORDER BY starts_at ASC LIMIT 1`,
      [cong.congregation_id],
    );
    return { congregation: cong.name, open: false, next };
  }

  /**
   * Turn a verified continuity token's user into a Principal for checkIn().
   * Everything checkIn enforces (window, scan token, congregation, idempotent
   * replay) applies unchanged; this only answers "who is this phone".
   * One refusal message for gone and deleted alike — the fix is the same
   * either way: sign in once and the page mints a fresh token.
   */
  async principalForReturn(userId: string): Promise<{ principal: Principal; fullName: string }> {
    const row = await maybeOne<{ role: Principal["role"]; congregation_id: string | null; full_name: string }>(
      this.pool,
      `SELECT role, congregation_id, full_name FROM users
        WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    if (!row || !row.congregation_id) {
      throw new ApiError("AUTH_REQUIRED", "This device needs a fresh sign-in");
    }
    return {
      principal: { userId, role: row.role, congregationId: row.congregation_id },
      fullName: row.full_name,
    };
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
