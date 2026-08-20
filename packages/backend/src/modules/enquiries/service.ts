// Website enquiries — the church website's connection card, contact form and
// prayer request, landing where pastors can answer them (migration 197).
//
// Trust model: the intake has no session. Authenticity is an HMAC over the raw
// request body, exactly as the Stripe and mobile-money receivers do it (§3.5).
// Without that, the endpoint is an open door onto the pastoral inbox and the
// first thing through it is spam addressed to pastors.
//
// The sender is a stranger — no user_id, no congregation, no level. See the
// migration header for why that is its own table rather than a care signal.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";

/** How far out of date a signed request may be before it is a replay. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

/** `t=<unix seconds>,v1=<hex sha256>` — Stripe's shape, which this team reads daily. */
const SIGNATURE_RE = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/;

/**
 * The website's wire format. Hyphenated `kind` and camelCase keys are its
 * public payload: it is a deployed client, and renaming its fields to match our
 * columns would break it for no gain. We map here instead.
 */
const KIND_ON_THE_WIRE = {
  "connection-card": "connection_card",
  message: "message",
  prayer: "prayer",
} as const;

export class EnquiriesService {
  constructor(private readonly pool: Pool) {}

  static readonly Submission = z
    .object({
      kind: z.enum(["connection-card", "message", "prayer"]),
      name: z.string().min(1).max(120),
      phone: z.string().max(64).optional(),
      email: z.string().max(255).optional(),
      message: z.string().min(1).max(4000),
      locale: z.string().max(8).default("en"),
      wantsPrayer: z.boolean().default(false),
      planningVisit: z.boolean().default(false),
      submittedAt: z.string().datetime(),
      dedupeKey: z.string().max(64).optional(),
    })
    // Mirrors website_enquiries_reachable_chk. Enforced here too so the caller
    // gets a 400 explaining the problem rather than a 500 from a constraint.
    .refine((v) => Boolean(v.phone?.trim() ?? v.email?.trim()), {
      message: "an enquiry needs a phone number or an email address",
      path: ["phone"],
    });

  static readonly Ack = z.object({
    status: z.enum(["acknowledged", "closed"]).default("acknowledged"),
    note: z.string().max(4000).optional(),
  });

  /**
   * Verify `x-nuruplace-signature` against the raw body.
   *
   * Timestamp and body are signed together, so a captured request cannot be
   * replayed once the tolerance passes. Compared in constant time: a
   * short-circuiting `===` leaks how much of a forged signature was right,
   * which is enough to reconstruct it one byte at a time.
   */
  static verifySignature(rawBody: string, header: string | undefined, secret: string, nowMs = Date.now()): void {
    const match = SIGNATURE_RE.exec(header?.trim() ?? "");
    if (!match) {
      throw new ApiError("AUTH_REQUIRED", "Missing or malformed signature header");
    }
    const [, timestamp, given] = match as unknown as [string, string, string];
    const ageSeconds = Math.abs(nowMs / 1000 - Number(timestamp));
    if (ageSeconds > SIGNATURE_TOLERANCE_SECONDS) {
      throw new ApiError("AUTH_REQUIRED", "Signature timestamp is outside the accepted window");
    }
    const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
    const a = Buffer.from(given, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ApiError("AUTH_REQUIRED", "Signature does not match");
    }
  }

  /**
   * Store an enquiry, or recognise one we already have.
   *
   * Idempotent (§3.6): the website retries on timeout, and a visitor who sees
   * no confirmation presses send again. Both must be no-ops rather than two
   * entries a pastor answers twice. `ON CONFLICT DO NOTHING` then re-reading is
   * deliberate — a `DO UPDATE` would let a replayed request overwrite a message
   * a pastor has already acknowledged.
   */
  async receive(input: z.infer<typeof EnquiriesService.Submission>): Promise<{ enquiry_id: string; duplicate: boolean }> {
    const kind = KIND_ON_THE_WIRE[input.kind];
    const phone = input.phone?.trim() || null;
    const email = input.email?.trim() || null;

    if (input.dedupeKey) {
      const existing = await maybeOne<{ enquiry_id: string }>(
        this.pool,
        `SELECT enquiry_id FROM website_enquiries WHERE dedupe_key = $1`,
        [input.dedupeKey],
      );
      if (existing) return { enquiry_id: existing.enquiry_id, duplicate: true };
    }

    const row = await one<{ enquiry_id: string }>(
      this.pool,
      `INSERT INTO website_enquiries
         (kind, full_name, phone_number, email, message, locale,
          wants_prayer, planning_visit, submitted_at, dedupe_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING enquiry_id`,
      [
        kind,
        input.name.trim(),
        phone,
        email,
        input.message.trim(),
        input.locale,
        input.wantsPrayer,
        input.planningVisit,
        input.submittedAt,
        input.dedupeKey ?? null,
      ],
    );
    return { enquiry_id: row.enquiry_id, duplicate: false };
  }

  /** The triage queue: unanswered first by default, newest first. */
  async list(status: string | undefined, limit: number, q: Queryable = this.pool): Promise<unknown[]> {
    const capped = Math.min(Math.max(limit, 1), 200);
    if (status) {
      return many(
        q,
        `SELECT * FROM website_enquiries WHERE status = $1 ORDER BY received_at DESC LIMIT $2`,
        [status, capped],
      );
    }
    return many(q, `SELECT * FROM website_enquiries ORDER BY received_at DESC LIMIT $1`, [capped]);
  }

  /** Record who picked it up, so two pastors do not both reply. */
  async acknowledge(
    enquiryId: string,
    userId: string,
    input: z.infer<typeof EnquiriesService.Ack>,
  ): Promise<unknown> {
    const row = await maybeOne(
      this.pool,
      `UPDATE website_enquiries
          SET status = $1,
              acknowledged_by = $2,
              acknowledged_at = now(),
              note = COALESCE($3, note)
        WHERE enquiry_id = $4
      RETURNING *`,
      [input.status, userId, input.note ?? null, enquiryId],
    );
    if (!row) throw new ApiError("NOT_FOUND", "No such enquiry");
    return row;
  }
}
