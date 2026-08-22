// Follow-up cadences: what happens after someone first visits, or stops coming.
//
// A cadence is a named sequence of touches. Some steps the system sends; some a
// leader performs and then records. The owner asked for both in one rhythm,
// which is the right shape — a text message and a phone call are not
// alternatives, they are different parts of the same pastoral effort, and the
// value is in seeing them on one timeline.
//
// Three verbs, and the whole engine is these:
//
//   arm()      something happened to a member; start the sequence and lay out
//              every step's due date up front.
//   advance()  the worker's tick: find automated steps that have come due, hand
//              them to the notification service, record that it happened.
//   close()    the member came back (or a leader stopped it). Nothing further
//              fires, and the reason is kept.
//
// Everything is idempotent. A cadence that double-arms sends a grieving family
// two "we missed you" messages, and the second one is worse than none.
import type pg from "pg";
import { many, maybeOne, one, tx, audit } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import type { NotificationService } from "../notifications/service.js";
import type { Logger } from "pino";
import { z } from "zod";

export type CadenceTrigger = "first_visit" | "missed_services" | "joined_online";

export interface CadenceStep {
  step_id: string;
  offset_days: number;
  kind: "automated" | "human";
  channel: "push" | "email" | null;
  action: string;
  message: string | null;
  sequence: number;
}

export interface DueStep {
  event_id: string;
  run_id: string;
  step_id: string;
  user_id: string;
  full_name: string;
  phone_number: string | null;
  action: string;
  due_at: string;
  cadence_name: string;
  service_title: string | null;
  days_overdue: number;
}

export class CadenceService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly notifications?: NotificationService,
    private readonly log?: Logger,
  ) {}

  /**
   * Start a cadence for a member, laying out every step's due date at arming
   * time rather than computing them as we go.
   *
   * Doing it up front is what lets the portal answer "who is due this week"
   * with one indexed query instead of replaying rules per member — and it means
   * a pastor can SEE the plan for someone the moment it starts, which is the
   * point of showing a cadence at all.
   *
   * Returns null when the member already has this cadence running: re-arming is
   * the failure mode that sends someone the same message twice.
   */
  async arm(
    congregationId: string,
    userId: string,
    trigger: CadenceTrigger,
    opts: { serviceId?: string | null; at?: number } = {},
  ): Promise<{ run_id: string; steps: number } | null> {
    return tx(this.pool, async (c) => {
      const cadence = await maybeOne<{ cadence_id: string; name: string }>(
        c,
        `SELECT cadence_id, name FROM follow_up_cadences
          WHERE congregation_id = $1 AND trigger = $2 AND is_active
          ORDER BY created_at LIMIT 1`,
        [congregationId, trigger],
      );
      if (!cadence) return null; // no cadence configured for this trigger — not an error

      const alreadyRunning = await maybeOne<{ run_id: string }>(
        c,
        `SELECT run_id FROM follow_up_runs
          WHERE cadence_id = $1 AND user_id = $2 AND closed_at IS NULL`,
        [cadence.cadence_id, userId],
      );
      if (alreadyRunning) return null;

      const steps = await many<CadenceStep>(
        c,
        `SELECT step_id, offset_days, kind, channel, action, message, sequence
           FROM follow_up_cadence_steps WHERE cadence_id = $1 ORDER BY sequence`,
        [cadence.cadence_id],
      );
      if (steps.length === 0) return null; // a cadence with no steps does nothing

      const startedAt = new Date(opts.at ?? Date.now());
      const run = await one<{ run_id: string }>(
        c,
        `INSERT INTO follow_up_runs (cadence_id, user_id, service_id, started_at)
         VALUES ($1, $2, $3, $4) RETURNING run_id`,
        [cadence.cadence_id, userId, opts.serviceId ?? null, startedAt.toISOString()],
      );

      for (const step of steps) {
        const due = new Date(startedAt.getTime() + step.offset_days * 86_400_000);
        await c.query(
          `INSERT INTO follow_up_step_events (run_id, step_id, due_at)
           VALUES ($1, $2, $3) ON CONFLICT (run_id, step_id) DO NOTHING`,
          [run.run_id, step.step_id, due.toISOString()],
        );
      }

      await audit(c, userId, "follow_up.armed", "follow_up_runs", run.run_id, {
        cadence: cadence.name,
        trigger,
        steps: steps.length,
      });
      return { run_id: run.run_id, steps: steps.length };
    });
  }

  /**
   * The worker's tick: dispatch every automated step that has come due.
   *
   * Human steps are deliberately left alone — they become the leader's due list.
   * A system that "completed" a phone call because a timer expired would be
   * lying to the person reading the follow-up register.
   *
   * Each step is marked before its message is handed off, and the update is
   * conditional on it still being incomplete, so two workers racing the same row
   * cannot both send. Better a message occasionally missed than a bereaved
   * family texted twice.
   */
  async advance(now: number = Date.now()): Promise<{ dispatched: number; failed: number }> {
    const due = await many<{
      event_id: string;
      run_id: string;
      user_id: string;
      channel: "push" | "email";
      action: string;
      message: string | null;
      cadence_name: string;
    }>(
      this.pool,
      `SELECT e.event_id, e.run_id, r.user_id, s.channel, s.action, s.message, c.name AS cadence_name
         FROM follow_up_step_events e
         JOIN follow_up_cadence_steps s ON s.step_id = e.step_id
         JOIN follow_up_runs r          ON r.run_id  = e.run_id
         JOIN follow_up_cadences c      ON c.cadence_id = r.cadence_id
        WHERE e.completed_at IS NULL
          AND e.due_at <= $1
          AND s.kind = 'automated'
          AND r.closed_at IS NULL
        ORDER BY e.due_at
        LIMIT 200`,
      [new Date(now).toISOString()],
    );

    let dispatched = 0;
    let failed = 0;
    for (const step of due) {
      // Claim it first. If another worker already did, rowCount is 0 and we skip
      // — no second message.
      const claimed = await this.pool.query(
        `UPDATE follow_up_step_events
            SET completed_at = now(), outcome = 'sent'
          WHERE event_id = $1 AND completed_at IS NULL`,
        [step.event_id],
      );
      if (claimed.rowCount === 0) continue;

      try {
        await this.notifications?.schedule({
          userId: step.user_id,
          channel: step.channel,
          template: "follow_up_step",
          payload: {
            action: step.action,
            message: step.message ?? step.action,
            cadence: step.cadence_name,
          },
        });
        dispatched += 1;
      } catch (e) {
        // Record the failure rather than silently dropping it: a follow-up that
        // never reached anyone must be visible in the register, not absent.
        failed += 1;
        await this.pool.query(
          `UPDATE follow_up_step_events SET outcome = 'failed' WHERE event_id = $1`,
          [step.event_id],
        );
        this.log?.warn({ err: e, event_id: step.event_id }, "follow-up step could not be dispatched");
      }
    }
    return { dispatched, failed };
  }

  /**
   * Close every open run for a member. Called when they attend again — the
   * reason a "we missed you" cadence exists is to stop when it has worked.
   */
  async closeOpenRuns(
    userId: string,
    reason: "returned" | "completed" | "stopped_by_leader",
  ): Promise<number> {
    const res = await this.pool.query(
      `UPDATE follow_up_runs
          SET closed_at = now(), closed_reason = $2
        WHERE user_id = $1 AND closed_at IS NULL`,
      [userId, reason],
    );
    return res.rowCount ?? 0;
  }

  /** The leader's list: human steps that are due, oldest first. */
  async dueForLeaders(congregationId: string | null, limit = 100): Promise<DueStep[]> {
    return many<DueStep>(
      this.pool,
      `SELECT e.event_id, e.run_id, e.step_id, r.user_id,
              u.full_name, u.phone_number, s.action, e.due_at,
              c.name AS cadence_name, sv.title AS service_title,
              GREATEST(0, EXTRACT(DAY FROM now() - e.due_at))::int AS days_overdue
         FROM follow_up_step_events e
         JOIN follow_up_cadence_steps s ON s.step_id = e.step_id
         JOIN follow_up_runs r          ON r.run_id  = e.run_id
         JOIN follow_up_cadences c      ON c.cadence_id = r.cadence_id
         JOIN users u                   ON u.user_id = r.user_id
         LEFT JOIN church_services sv    ON sv.service_id = r.service_id
        WHERE s.kind = 'human'
          AND e.completed_at IS NULL
          AND e.due_at <= now()
          AND r.closed_at IS NULL
          AND u.deleted_at IS NULL
          AND c.congregation_id = $1
        ORDER BY e.due_at
        LIMIT $2`,
      [congregationId, limit],
    );
  }

  /** Every cadence for the congregation, with its steps and how many runs are open. */
  async listCadences(congregationId: string | null): Promise<unknown[]> {
    const cadences = await many<{
      cadence_id: string; name: string; trigger: string; trigger_threshold: number;
      is_active: boolean; created_at: string; open_runs: number;
    }>(
      this.pool,
      `SELECT c.cadence_id, c.name, c.trigger, c.trigger_threshold, c.is_active, c.created_at,
              (SELECT count(*)::int FROM follow_up_runs r
                WHERE r.cadence_id = c.cadence_id AND r.closed_at IS NULL) AS open_runs
         FROM follow_up_cadences c
        WHERE c.congregation_id = $1
        ORDER BY c.created_at`,
      [congregationId],
    );
    const out: unknown[] = [];
    for (const c of cadences) {
      const steps = await many<CadenceStep>(
        this.pool,
        `SELECT step_id, offset_days, kind, channel, action, message, sequence
           FROM follow_up_cadence_steps WHERE cadence_id = $1 ORDER BY sequence`,
        [c.cadence_id],
      );
      out.push({ ...c, steps });
    }
    return out;
  }

  /** Create a cadence with its steps in one transaction. */
  async createCadence(
    congregationId: string,
    createdBy: string,
    input: z.infer<typeof createCadenceSchema>,
  ): Promise<{ cadence_id: string }> {
    return tx(this.pool, async (c) => {
      const existing = await maybeOne<{ cadence_id: string }>(
        c,
        `SELECT cadence_id FROM follow_up_cadences WHERE congregation_id = $1 AND name = $2`,
        [congregationId, input.name],
      );
      if (existing) throw new ApiError("CONFLICT", "A cadence with that name already exists");

      const cadence = await one<{ cadence_id: string }>(
        c,
        `INSERT INTO follow_up_cadences (congregation_id, name, trigger, trigger_threshold, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING cadence_id`,
        [congregationId, input.name, input.trigger, input.trigger_threshold ?? 1, createdBy],
      );
      let seq = 1;
      for (const step of input.steps) {
        await c.query(
          `INSERT INTO follow_up_cadence_steps
             (cadence_id, offset_days, kind, channel, action, message, sequence)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [cadence.cadence_id, step.offset_days, step.kind,
           step.kind === "automated" ? step.channel : null,
           step.action, step.message ?? null, seq++],
        );
      }
      await audit(c, createdBy, "follow_up.cadence_created", "follow_up_cadences", cadence.cadence_id, {
        name: input.name, trigger: input.trigger, steps: input.steps.length,
      });
      return { cadence_id: cadence.cadence_id };
    });
  }

  /**
   * Switch a cadence on or off. Off stops NEW runs from arming; runs already in
   * flight finish naturally — turning a rhythm off must not silently abandon the
   * people already inside it.
   */
  async setActive(congregationId: string, cadenceId: string, active: boolean): Promise<void> {
    const res = await this.pool.query(
      `UPDATE follow_up_cadences SET is_active = $3, updated_at = now()
        WHERE cadence_id = $1 AND congregation_id = $2`,
      [cadenceId, congregationId, active],
    );
    if (res.rowCount === 0) throw new ApiError("NOT_FOUND", "No such cadence in this congregation");
  }

  /**
   * Arm the missed_services cadences: the daily sweep behind "contact absentees
   * within the week" (the Follow-up department's second rule).
   *
   * Nothing else arms this trigger — check-in arms first_visit, but absence is
   * the ABSENCE of an event, so somebody has to go looking for it. Counts a
   * member's consecutive misses as the number of streak-eligible services since
   * the one they last attended. Members who have NEVER attended are deliberately
   * excluded: they are the register's "never attended" column, a different
   * pastoral situation from someone who was coming and stopped.
   *
   * Idempotent by construction — arm() refuses while a run is open, and a member
   * who returns has their runs closed by check-in, so coming back and lapsing
   * again correctly starts a fresh sequence.
   */
  async armAbsentees(now: number = Date.now()): Promise<{ armed: number }> {
    const due = await many<{ congregation_id: string; user_id: string; misses: number; threshold: number }>(
      this.pool,
      `WITH latest_attended AS (
         SELECT sa.user_id, max(cs.service_date) AS last_date
           FROM service_attendance sa
           JOIN church_services cs ON cs.service_id = sa.service_id
          WHERE cs.counts_for_streak
          GROUP BY sa.user_id
       ),
       misses AS (
         SELECT u.user_id, u.congregation_id,
                (SELECT count(*)::int FROM church_services cs
                  WHERE cs.congregation_id = u.congregation_id
                    AND cs.counts_for_streak
                    AND cs.service_date > la.last_date
                    AND cs.service_date <= $1::date) AS n
           FROM users u
           JOIN latest_attended la ON la.user_id = u.user_id
          WHERE u.deleted_at IS NULL AND u.role = 'Student'
       )
       SELECT m.congregation_id, m.user_id, m.n AS misses, c.trigger_threshold AS threshold
         FROM misses m
         JOIN follow_up_cadences c
           ON c.congregation_id = m.congregation_id
          AND c.trigger = 'missed_services'
          AND c.is_active
        WHERE m.n >= c.trigger_threshold`,
      [new Date(now).toISOString().slice(0, 10)],
    );
    let armed = 0;
    for (const row of due) {
      const r = await this.arm(row.congregation_id, row.user_id, "missed_services", { at: now });
      if (r) armed += 1;
    }
    return { armed };
  }

  /**
   * A leader records that they did the thing. The outcome matters as much as the
   * completion — "no answer" is a different pastoral fact from "reached", and a
   * register that only stores "done" cannot tell you which.
   */
  async recordContact(
    eventId: string,
    leaderId: string,
    outcome: "reached" | "no_answer" | "wrong_number" | "skipped",
    note?: string,
  ): Promise<void> {
    const res = await this.pool.query(
      `UPDATE follow_up_step_events
          SET completed_at = now(), completed_by = $2, outcome = $3, note = $4
        WHERE event_id = $1 AND completed_at IS NULL`,
      [eventId, leaderId, outcome, note ?? null],
    );
    if (res.rowCount === 0) {
      throw new ApiError("NOT_FOUND", "That follow-up step is not open, or does not exist");
    }
  }
}

/**
 * What a leader records after a human step. The outcome is required — "no
 * answer" and "reached" are different pastoral facts, and a register that
 * collapses them cannot tell anyone who still needs reaching.
 */
export const recordContactSchema = z
  .object({
    outcome: z.enum(["reached", "no_answer", "wrong_number", "skipped"]),
    note: z.string().max(1000).optional(),
  })
  .strict();

/**
 * Creating a cadence. The kind/channel pairing is validated here as well as by
 * the DB CHECK, so a misconfigured step comes back as a named 400 instead of a
 * constraint violation surfacing as a 500.
 */
export const createCadenceSchema = z
  .object({
    name: z.string().min(1).max(120),
    trigger: z.enum(["first_visit", "missed_services", "joined_online"]),
    trigger_threshold: z.number().int().min(1).max(52).optional(),
    steps: z
      .array(
        z
          .object({
            offset_days: z.number().int().min(0).max(365),
            kind: z.enum(["automated", "human"]),
            channel: z.enum(["push", "email"]).optional(),
            action: z.string().min(1).max(120),
            message: z.string().max(1000).optional(),
          })
          .refine((s) => (s.kind === "automated" ? s.channel != null : s.channel == null), {
            message: "automated steps need a channel; human steps must not have one",
          }),
      )
      .min(1)
      .max(20),
  })
  .strict();
