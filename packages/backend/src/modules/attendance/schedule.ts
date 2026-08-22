// Weekly service schedules (migration 203): the rhythm behind the standing QR.
//
// A schedule is a declared rhythm — "Sunday Service, 9 am, every week" — and
// the materializer turns rhythm into rows: every active schedule gets its
// concrete church_services occurrences created up to a week ahead. The poster
// (migration 200) resolves against those rows, so the chain that used to
// depend on somebody remembering the portal on a Saturday night now depends
// on a cron.
//
// Materialization is idempotent BY THE SLOT (congregation, date, title —
// idx_church_services_slot): running it twice, or running it against a week
// where a human already created the service by hand, changes nothing. A
// hand-made service IS that week's occurrence; the schedule steps aside.
//
// All time arithmetic happens in Postgres against the congregation's OWN
// timezone column. "9 am in Nairobi" is the fact; UTC is derived at the
// moment a concrete date is known, which is the only safe order.
import { z } from "zod";
import type pg from "pg";
import { ApiError } from "../../http/errors.js";
import { one, maybeOne, many } from "../../db/db.js";
import { randomSecret } from "./service.js";

/** How far ahead rhythm becomes rows. A week means one missed cron day is harmless. */
const HORIZON_DAYS = 7;

export const createScheduleSchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    day_of_week: z.number().int().min(0).max(6), // 0 = Sunday, matching EXTRACT(DOW)
    starts_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "starts_time must be HH:MM (24h)"),
    duration_minutes: z.number().int().min(15).max(720).nullable().optional(),
    checkin_opens_minutes: z.number().int().min(0).max(720).default(45),
    checkin_closes_minutes: z.number().int().min(30).max(1440).default(240),
    counts_for_streak: z.boolean().default(true),
  })
  .strict();
export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;

export interface ScheduleRow {
  schedule_id: string;
  title: string;
  day_of_week: number;
  starts_time: string;
  duration_minutes: number | null;
  checkin_opens_minutes: number;
  checkin_closes_minutes: number;
  counts_for_streak: boolean;
  is_active: boolean;
}

const SCHEDULE_COLUMNS = `schedule_id, title, day_of_week, starts_time::text AS starts_time,
       duration_minutes, checkin_opens_minutes, checkin_closes_minutes, counts_for_streak, is_active`;

export class ServiceScheduleService {
  constructor(private readonly pool: pg.Pool) {}

  async list(congregationId: string | null): Promise<ScheduleRow[]> {
    return many<ScheduleRow>(
      this.pool,
      `SELECT ${SCHEDULE_COLUMNS} FROM service_schedules
        WHERE congregation_id = $1
        ORDER BY day_of_week, starts_time`,
      [congregationId],
    );
  }

  async create(congregationId: string, createdBy: string, input: CreateScheduleInput): Promise<ScheduleRow> {
    const existing = await maybeOne<{ schedule_id: string }>(
      this.pool,
      `SELECT schedule_id FROM service_schedules
        WHERE congregation_id = $1 AND day_of_week = $2 AND starts_time = $3 AND title = $4`,
      [congregationId, input.day_of_week, input.starts_time, input.title],
    );
    if (existing) throw new ApiError("CONFLICT", "That weekly service already exists");

    const row = await one<ScheduleRow>(
      this.pool,
      `INSERT INTO service_schedules
         (congregation_id, title, day_of_week, starts_time, duration_minutes,
          checkin_opens_minutes, checkin_closes_minutes, counts_for_streak, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING ${SCHEDULE_COLUMNS}`,
      [
        congregationId,
        input.title,
        input.day_of_week,
        input.starts_time,
        input.duration_minutes ?? null,
        input.checkin_opens_minutes,
        input.checkin_closes_minutes,
        input.counts_for_streak,
        createdBy,
      ],
    );
    // The person just declared a rhythm; the nearest occurrence should exist
    // before they blink, not at tomorrow's cron.
    await this.materialize();
    return row;
  }

  /** Off stops future materialization; occurrences already created stay. */
  async setActive(congregationId: string, scheduleId: string, active: boolean): Promise<void> {
    const row = await maybeOne<{ schedule_id: string }>(
      this.pool,
      `UPDATE service_schedules SET is_active = $3
        WHERE schedule_id = $2 AND congregation_id = $1
        RETURNING schedule_id`,
      [congregationId, scheduleId, active],
    );
    if (!row) throw new ApiError("NOT_FOUND", "Schedule not found");
  }

  /**
   * Rhythm → rows, for every active schedule, out to the horizon. One SQL
   * statement: generate the horizon's dates, keep the ones matching each
   * schedule's weekday, build local start/window stamps in the congregation's
   * timezone, and insert what the slot index doesn't already hold. Returns
   * how many rows were actually created (0 on a quiet day — that is the
   * normal, healthy result six days out of seven).
   *
   * The qr_secret is minted per occurrence in this process (not in SQL) so
   * every materialized service gets the same entropy a hand-created one does.
   */
  async materialize(): Promise<number> {
    const due = await many<{
      schedule_id: string;
      congregation_id: string;
      title: string;
      service_date: string;
      starts_at: string;
      ends_at: string | null;
      checkin_opens_at: string;
      checkin_closes_at: string;
      counts_for_streak: boolean;
      created_by: string | null;
    }>(
      this.pool,
      `WITH horizon AS (
         SELECT (current_date + offs)::date AS day FROM generate_series(0, $1) AS offs
       ),
       occurrences AS (
         SELECT s.schedule_id, s.congregation_id, s.title, h.day AS service_date,
                ((h.day::text || ' ' || s.starts_time::text)::timestamp AT TIME ZONE c.timezone) AS starts_at,
                CASE WHEN s.duration_minutes IS NULL THEN NULL
                     ELSE ((h.day::text || ' ' || s.starts_time::text)::timestamp AT TIME ZONE c.timezone)
                          + make_interval(mins => s.duration_minutes) END AS ends_at,
                ((h.day::text || ' ' || s.starts_time::text)::timestamp AT TIME ZONE c.timezone)
                  - make_interval(mins => s.checkin_opens_minutes)  AS checkin_opens_at,
                ((h.day::text || ' ' || s.starts_time::text)::timestamp AT TIME ZONE c.timezone)
                  + make_interval(mins => s.checkin_closes_minutes) AS checkin_closes_at,
                s.counts_for_streak, s.created_by
           FROM service_schedules s
           JOIN congregations c USING (congregation_id)
           JOIN horizon h ON EXTRACT(DOW FROM h.day) = s.day_of_week
          WHERE s.is_active
       )
       SELECT o.* FROM occurrences o
        WHERE o.starts_at > now()
          AND NOT EXISTS (
            SELECT 1 FROM church_services cs
             WHERE cs.congregation_id = o.congregation_id
               AND cs.service_date = o.service_date
               AND cs.title = o.title
          )
        ORDER BY o.starts_at`,
      [HORIZON_DAYS],
    );

    let created = 0;
    for (const occ of due) {
      // ON CONFLICT keeps a concurrent materializer (or a human racing the
      // cron in the portal) from erroring; the slot holds exactly one row.
      const inserted = await maybeOne<{ service_id: string }>(
        this.pool,
        `INSERT INTO church_services
           (congregation_id, title, service_date, starts_at, ends_at, checkin_opens_at,
            checkin_closes_at, qr_secret, qr_enabled, counts_for_streak, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9,$10)
         ON CONFLICT (congregation_id, service_date, title) DO NOTHING
         RETURNING service_id`,
        [
          occ.congregation_id,
          occ.title,
          occ.service_date,
          occ.starts_at,
          occ.ends_at,
          occ.checkin_opens_at,
          occ.checkin_closes_at,
          randomSecret(),
          occ.counts_for_streak,
          occ.created_by,
        ],
      );
      if (inserted) created++;
    }
    return created;
  }
}
