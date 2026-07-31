// Calendar service (Features v2 §C). Visibility-scoped series CRUD, TZ-aware
// occurrence projection, occurrence materialization (so QR attendance keeps a
// stable event_id), RSVPs (offline-queueable), and chrono-node quick-add. All
// server-authoritative; recurrence is validated + capped (§C.4).
import { randomUUID, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import * as chrono from "chrono-node";
import { DateTime } from "luxon";
import { many, maybeOne, one, tx, recordChange, audit, enqueueOutbox, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { assertCellInScope } from "../../http/auth.js";
import type { Principal } from "../../http/http.js";
import { validateRrule, expandOccurrences, type Occurrence } from "./recurrence.js";
import { NotificationService } from "../notifications/service.js";

const MAX_RANGE_DAYS = 92;

interface SeriesRow {
  series_id: string;
  congregation_id: string;
  cell_group_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  timezone: string;
  dtstart_local: string;
  duration_min: number;
  rrule: string | null;
  visibility: "congregation" | "cell" | "leaders";
  category?: string | null;
  rsvp_enabled?: boolean;
  qr_enabled?: boolean;
  manual_checkin_enabled?: boolean;
  reminders_enabled?: boolean;
  checkin_opens_min_before?: number | null;
  is_paused?: boolean;
  status?: "draft" | "active";
  primary_image_url?: string | null;
  show_on_home?: boolean;
  is_featured?: boolean;
  video_url?: string | null;
  automation?: Record<string, unknown> | null;
  split_from?: string | null;
  created_by?: string;
  created_at?: string;
}

interface ExceptionRow {
  original_start_at: string;
  is_cancelled: boolean;
  new_start_at: string | null;
  new_end_at: string | null;
}

/** Rolling window every materialize/reconcile pass covers (EVENTS_ARCHITECTURE §2). */
const RECONCILE_WINDOW_DAYS = 90;
/**
 * How far into the PAST a default materialize pass reaches. The rolling window was
 * strictly forward ([now, now+90d]), which meant an occurrence that was never
 * materialized while it was still in the future could never be materialized at all:
 * a back-dated event (an admin recording last Sunday's service after the fact), an
 * imported/restored series, or any occurrence whose series was created after it
 * happened. Those occurrences project fine on `/calendar` (rule expansion is
 * window-driven) but have no `events` row, and every past-facing reader — the
 * command center's "recent occurrences" list, the attendance roster, the QR panel,
 * the CSV export — reads materialized rows, so they silently showed nothing.
 * Materializing backwards is safe: it is a pure `DO NOTHING` upsert, reminders are
 * scheduled per-RSVP (never by scanning `events`), and reconcile's refresh/prune
 * pass stays forward-only so history is never rewritten or retro-cancelled.
 */
const MATERIALIZE_BACKFILL_DAYS = 90;
/** Default RSVP reminder offsets (minutes before start) — today's T-24h / T-1h. */
const DEFAULT_REMINDER_OFFSETS_MIN = [1440, 60];

// The admin portal's Create-event modal posts a richer, UI-shaped payload than
// the series model: separate start_date / start_time (or a precomputed
// starts_at) rather than dtstart_local, a member-facing visibility vocabulary,
// and a few presentational fields (category, manual_checkin_enabled, …).
// Normalize it to the series schema so creation succeeds whatever client shape
// arrives, then let zod validate the normalized object. Unknown keys are dropped.
function normalizeSeriesInput(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const r = raw as Record<string, unknown>;

  const startDate = typeof r.start_date === "string" ? r.start_date.trim() : "";
  const startTime = typeof r.start_time === "string" && r.start_time.trim() ? r.start_time.trim() : "09:00";
  const dtstartLocal =
    (typeof r.dtstart_local === "string" && r.dtstart_local) ||
    (startDate ? `${startDate}T${startTime}:00` : undefined) ||
    (typeof r.starts_at === "string" && r.starts_at ? r.starts_at : undefined);

  // Map the UI's visibility words onto the DB enum (congregation | cell | leaders).
  const visAliases: Record<string, "congregation" | "cell" | "leaders"> = {
    members: "congregation",
    member: "congregation",
    public: "congregation",
    all: "congregation",
    congregation: "congregation",
    cell: "cell",
    cells: "cell",
    leaders: "leaders",
    leader: "leaders",
  };
  const visibility =
    typeof r.visibility === "string" ? (visAliases[r.visibility.toLowerCase()] ?? r.visibility) : r.visibility;

  // Open-ended rules (FREQ=WEEKLY;BYDAY=SU with no COUNT/UNTIL) are legal
  // (EVENTS_ARCHITECTURE §2): windowed expansion makes them safe, so the old
  // static "UNTIL = creation + 12 months" stamp — which silently killed every
  // portal-created series a year in — is gone.
  const out: Record<string, unknown> = {
    title: r.title,
    description: r.description,
    location: r.location,
    category: r.category,
    primary_image_url: r.primary_image_url,
    gallery_image_urls: r.gallery_image_urls,
    video_url: r.video_url,
    timezone: r.timezone,
    duration_min: r.duration_min,
    rrule: typeof r.rrule === "string" ? r.rrule.trim() || null : r.rrule,
    rsvp_enabled: r.rsvp_enabled,
    qr_enabled: r.qr_enabled,
    manual_checkin_enabled: r.manual_checkin_enabled,
    reminders_enabled: r.reminders_enabled,
    checkin_opens_min_before: r.checkin_opens_min_before,
    automation: r.automation,
  };
  if (r.cell_group_id !== undefined) out.cell_group_id = r.cell_group_id;
  if (dtstartLocal !== undefined) out.dtstart_local = dtstartLocal;
  if (visibility !== undefined) out.visibility = visibility;
  if (r.status !== undefined) out.status = r.status;
  return out;
}

interface UserScope {
  congregation_id: string;
  cell_group_id: string | null;
  role: string;
  leaderCells: string[];
  isLeader: boolean;
}

export class CalendarService {
  private readonly notifications: NotificationService;

  // No materialization horizon parameter any more: there is NO fixed horizon in
  // the read path (EVENTS_ARCHITECTURE §1/§2). Every reader materializes its own
  // window and the nightly sweep keeps a rolling 90-day window fresh.
  constructor(
    private readonly pool: Pool,
    private readonly maxInstances: number = 500,
    notifications?: NotificationService,
  ) {
    this.notifications = notifications ?? new NotificationService(pool);
  }

  private async scopeOf(c: Queryable, userId: string): Promise<UserScope> {
    const u = await one<{ congregation_id: string; cell_group_id: string | null; role: string }>(
      c,
      `SELECT congregation_id, cell_group_id, role FROM users WHERE user_id = $1`,
      [userId],
    );
    const cells = await many<{ cell_group_id: string }>(
      c,
      `SELECT cell_group_id FROM leader_assignments WHERE leader_user_id = $1`,
      [userId],
    );
    const isLeader = u.role === "Instructor" || u.role === "Admin" || u.role === "SuperAdmin";
    return { ...u, leaderCells: cells.map((r) => r.cell_group_id), isLeader };
  }

  private visibleSeries(c: Queryable, scope: UserScope): Promise<SeriesRow[]> {
    return many<SeriesRow>(
      c,
      `SELECT series_id, congregation_id, cell_group_id, title, description, location, timezone,
              to_char(dtstart_local, 'YYYY-MM-DD"T"HH24:MI:SS') AS dtstart_local,
              duration_min, rrule, visibility, category, is_paused, status, primary_image_url, show_on_home
         FROM event_series es
        WHERE es.deleted_at IS NULL AND es.is_paused = FALSE AND es.congregation_id = $1
          -- Drafts are visible only to leaders/admins ($4), never to members.
          AND (es.status = 'active' OR $4)
          AND (
            es.visibility = 'congregation'
            OR (es.visibility = 'cell' AND (es.cell_group_id = $2 OR es.cell_group_id = ANY($3::uuid[])))
            OR (es.visibility = 'leaders' AND $4 AND (es.cell_group_id IS NULL OR es.cell_group_id = $2 OR es.cell_group_id = ANY($3::uuid[])))
          )`,
      [scope.congregation_id, scope.cell_group_id, scope.leaderCells, scope.isLeader],
    );
  }

  /** Exceptions for a set of series, grouped: series_id → (original start ms → row). */
  private async exceptionsBySeries(seriesIds: string[]): Promise<Map<string, Map<number, ExceptionRow>>> {
    const out = new Map<string, Map<number, ExceptionRow>>();
    if (seriesIds.length === 0) return out;
    const rows = await many<ExceptionRow & { series_id: string }>(
      this.pool,
      `SELECT series_id, original_start_at, is_cancelled, new_start_at, new_end_at
         FROM event_exceptions WHERE series_id = ANY($1::uuid[])`,
      [seriesIds],
    );
    for (const e of rows) {
      const m = out.get(e.series_id) ?? new Map<number, ExceptionRow>();
      m.set(new Date(e.original_start_at).getTime(), e);
      out.set(e.series_id, m);
    }
    return out;
  }

  /**
   * §8 (EVENTS_ARCHITECTURE): enforce the same congregation + visibility rules
   * as visibleSeries on OCCURRENCE access. Before this, any member holding a
   * synthetic occurrence id could read/RSVP/post to any congregation's event.
   * Invisible events 404 (NOT_FOUND, not 403) so their existence never leaks.
   */
  private async assertEventVisible(c: Queryable, userId: string, eventId: string): Promise<void> {
    const ev = await maybeOne<{
      congregation_id: string;
      series_id: string | null;
      s_visibility: "congregation" | "cell" | "leaders" | null;
      s_status: string | null;
      s_cell: string | null;
      s_deleted: string | null;
    }>(
      c,
      `SELECT e.congregation_id, e.series_id,
              s.visibility AS s_visibility, s.status AS s_status,
              s.cell_group_id AS s_cell, s.deleted_at AS s_deleted
         FROM events e LEFT JOIN event_series s ON s.series_id = e.series_id
        WHERE e.event_id = $1`,
      [eventId],
    );
    if (!ev) throw new ApiError("NOT_FOUND", "Event not found");
    const scope = await this.scopeOf(c, userId);
    const invisible = (): never => {
      throw new ApiError("NOT_FOUND", "Event not found");
    };
    if (scope.congregation_id !== ev.congregation_id) invisible();
    if (!ev.series_id) return; // legacy series-less event: congregation-wide
    if (ev.s_deleted) invisible();
    if (ev.s_status === "draft" && !scope.isLeader) invisible();
    if (ev.s_visibility === "cell") {
      const cellOk =
        ev.s_cell != null && (ev.s_cell === scope.cell_group_id || scope.leaderCells.includes(ev.s_cell));
      if (!cellOk) invisible();
    } else if (ev.s_visibility === "leaders") {
      const ok =
        scope.isLeader &&
        (ev.s_cell == null || ev.s_cell === scope.cell_group_id || scope.leaderCells.includes(ev.s_cell));
      if (!ok) invisible();
    }
  }

  /** Projected occurrences in [from,to] (≤ 92 days), TZ-aware, exceptions applied. */
  async projectRange(userId: string, fromIso: string, toIso: string): Promise<unknown[]> {
    const from = new Date(fromIso);
    const to = new Date(toIso);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      throw new ApiError("VALIDATION_FAILED", "Invalid from/to range");
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
      throw new ApiError("VALIDATION_FAILED", `Range must be ≤ ${MAX_RANGE_DAYS} days`);
    }
    const scope = await this.scopeOf(this.pool, userId);
    const series = await this.visibleSeries(this.pool, scope);
    // One grouped exceptions query for every visible series (EVENTS_ARCHITECTURE
    // §2: kill the per-series N+1).
    const exBySeries = await this.exceptionsBySeries(series.map((s) => s.series_id));
    const out: unknown[] = [];
    for (const s of series) {
      const occ = expandOccurrences(s, from, to, this.maxInstances);
      const exByStart = exBySeries.get(s.series_id) ?? new Map<number, ExceptionRow>();
      for (const o of occ) {
        const ex = exByStart.get(new Date(o.start_at).getTime());
        if (ex?.is_cancelled) continue;
        const start = ex?.new_start_at ?? o.start_at;
        const end = ex?.new_end_at ?? o.end_at;
        out.push({
          occurrence_id: occurrenceId(s.series_id, o.start_at),
          series_id: s.series_id,
          title: s.title,
          description: s.description,
          location: s.location,
          visibility: s.visibility,
          category: s.category ?? null,
          status: s.status ?? "active",
          cell_group_id: s.cell_group_id,
          primary_image_url: s.primary_image_url ?? null,
          show_on_home: s.show_on_home ?? false,
          start_at: start,
          end_at: end,
          original_start_at: o.start_at,
          rescheduled: Boolean(ex && !ex.is_cancelled && ex.new_start_at),
          going: 0,
          attendees: [] as Array<{ user_id: string; full_name: string; avatar_url: string | null }>,
        });
      }
    }
    // Attach real "going" counts: materialized events carry (series_id,
    // occurrence_start) + RSVPs. One batched query keyed by series + instant
    // avoids an N+1 over the projected occurrences.
    if (out.length > 0) {
      const seriesIds = [...new Set(series.map((s) => s.series_id))];
      const counts = await many<{ series_id: string; occurrence_start: string; going: number }>(
        this.pool,
        `SELECT e.series_id, e.occurrence_start,
                count(*) FILTER (WHERE r.status = 'going')::int AS going
           FROM events e LEFT JOIN event_rsvps r ON r.event_id = e.event_id
          WHERE e.series_id = ANY($1::uuid[]) AND e.occurrence_start BETWEEN $2 AND $3
          GROUP BY e.series_id, e.occurrence_start`,
        [seriesIds, from.toISOString(), to.toISOString()],
      );
      const goingByKey = new Map(counts.map((c) => [`${c.series_id}|${new Date(c.occurrence_start).getTime()}`, c.going]));
      for (const o of out as Array<{ series_id: string; original_start_at: string; going: number }>) {
        o.going = goingByKey.get(`${o.series_id}|${new Date(o.original_start_at).getTime()}`) ?? 0;
      }

      // Attach a few attendee faces per occurrence (most-recent "going" RSVPs) so the
      // calendar cards can show "who's coming". Batched + grouped to avoid N+1.
      const faces = await many<{ series_id: string; occurrence_start: string; user_id: string; full_name: string; avatar_url: string | null }>(
        this.pool,
        `SELECT e.series_id, e.occurrence_start, u.user_id, u.full_name, u.avatar_url
           FROM events e
           JOIN event_rsvps r ON r.event_id = e.event_id AND r.status = 'going'
           JOIN users u ON u.user_id = r.user_id
          WHERE e.series_id = ANY($1::uuid[]) AND e.occurrence_start BETWEEN $2 AND $3
          ORDER BY r.updated_at DESC`,
        [seriesIds, from.toISOString(), to.toISOString()],
      );
      const facesByKey = new Map<string, Array<{ user_id: string; full_name: string; avatar_url: string | null }>>();
      for (const f of faces) {
        const key = `${f.series_id}|${new Date(f.occurrence_start).getTime()}`;
        const list = facesByKey.get(key) ?? [];
        if (list.length < 5) list.push({ user_id: f.user_id, full_name: f.full_name, avatar_url: f.avatar_url });
        facesByKey.set(key, list);
      }
      for (const o of out as Array<{ series_id: string; original_start_at: string; attendees: unknown[] }>) {
        o.attendees = facesByKey.get(`${o.series_id}|${new Date(o.original_start_at).getTime()}`) ?? [];
      }
    }
    out.sort((a, b) => String((a as { start_at: string }).start_at).localeCompare(String((b as { start_at: string }).start_at)));
    return out;
  }

  // ---------------- Events tab: series follow + cell summary ----------------

  /** Human cadence for a series from its RRULE + anchor ("Every Sunday · 9:00 AM"). */
  private cadenceLabel(s: SeriesRow): string {
    const time = DateTime.fromISO(s.dtstart_local).toFormat("h:mm a");
    if (!s.rrule) return `One-off · ${time}`;
    const up = s.rrule.toUpperCase();
    const freq = /FREQ=([A-Z]+)/.exec(up)?.[1];
    const byday = /BYDAY=([A-Z,]+)/.exec(up)?.[1];
    const DAYS: Record<string, string> = { SU: "Sunday", MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday", FR: "Friday", SA: "Saturday" };
    if (freq === "WEEKLY" && byday && !byday.includes(",")) return `Every ${DAYS[byday] ?? "week"} · ${time}`;
    if (freq === "WEEKLY") return `Weekly · ${time}`;
    if (freq === "MONTHLY") return `Monthly · ${time}`;
    if (freq === "DAILY") return `Daily · ${time}`;
    return `Recurring · ${time}`;
  }

  /**
   * The member's followable series (Events make "Series you follow"): every
   * visible series with a `following` flag, a human cadence, the next upcoming
   * occurrence, and a `new_count` of upcoming instances in the next 14 days.
   */
  async listSeries(userId: string): Promise<unknown[]> {
    const scope = await this.scopeOf(this.pool, userId);
    const series = await this.visibleSeries(this.pool, scope);
    const follows = await many<{ series_id: string }>(this.pool, `SELECT series_id FROM event_series_follows WHERE user_id = $1`, [userId]);
    const followed = new Set(follows.map((f) => f.series_id));
    const now = new Date();
    const horizon = new Date(now.getTime() + 45 * 86_400_000);
    const soon = new Date(now.getTime() + 14 * 86_400_000);
    return series
      .map((s) => {
        const occ = expandOccurrences(s, now, horizon, 8).filter((o) => new Date(o.start_at) >= now);
        const next = occ[0];
        return {
          series_id: s.series_id,
          title: s.title,
          category: s.category ?? null,
          cadence: this.cadenceLabel(s),
          next_at: next?.start_at ?? null,
          // The next occurrence as a tappable event (its id = materialized event_id).
          next_occurrence_id: next ? occurrenceId(s.series_id, next.start_at) : null,
          next_end_at: next?.end_at ?? null,
          location: s.location ?? null,
          following: followed.has(s.series_id),
          new_count: occ.filter((o) => new Date(o.start_at) <= soon).length,
        };
      })
      .sort((a, b) => Number(b.following) - Number(a.following) || (a.next_at ?? "").localeCompare(b.next_at ?? ""));
  }

  /** Follow / unfollow a series (idempotent toggle). */
  async toggleFollow(userId: string, seriesId: string): Promise<{ series_id: string; following: boolean }> {
    const series = await maybeOne<{ series_id: string }>(this.pool, `SELECT series_id FROM event_series WHERE series_id = $1 AND deleted_at IS NULL`, [seriesId]);
    if (!series) throw new ApiError("NOT_FOUND", "Series not found");
    const del = await this.pool.query(`DELETE FROM event_series_follows WHERE user_id = $1 AND series_id = $2`, [userId, seriesId]);
    if ((del.rowCount ?? 0) > 0) return { series_id: seriesId, following: false };
    await this.pool.query(
      `INSERT INTO event_series_follows (user_id, series_id, last_seen_at) VALUES ($1, $2, now()) ON CONFLICT DO NOTHING`,
      [userId, seriesId],
    );
    return { series_id: seriesId, following: true };
  }

  /**
   * "Your cell" summary for the Events tab: the member's cell, its size, a
   * this-month attendance ratio (check-ins vs the cell's expected cadence), and
   * the next cell gathering. Returns { cell: null } for members without a cell.
   * Note: this app has no separate "cohort" entity (the Cohort→Cell rename is
   * pending), so only real cell data is returned — no fabricated cohort.
   */
  async cellSummary(userId: string): Promise<unknown> {
    const me = await one<{ cell_group_id: string | null; congregation_id: string }>(
      this.pool,
      `SELECT cell_group_id, congregation_id FROM users WHERE user_id = $1`,
      [userId],
    );
    if (!me.cell_group_id) return { cell: null };
    const cell = await one<{
      name: string;
      meeting_cadence: number;
      discipler_name: string | null;
      discipler_role: string | null;
      leader_full_name: string | null;
      leader_avatar_url: string | null;
    }>(
      this.pool,
      `SELECT cg.name, cg.meeting_cadence, cg.discipler_name, cg.discipler_role,
              lu.full_name AS leader_full_name, lu.avatar_url AS leader_avatar_url
         FROM cell_groups cg
         LEFT JOIN users lu ON lu.user_id = cg.leader_user_id
        WHERE cg.cell_group_id = $1`,
      [me.cell_group_id],
    );
    const leaderName = cell.leader_full_name ?? cell.discipler_name;
    const members = await one<{ n: number }>(
      this.pool,
      `SELECT count(*)::int AS n FROM users WHERE cell_group_id = $1 AND deleted_at IS NULL`,
      [me.cell_group_id],
    );
    const attended = await one<{ n: number }>(
      this.pool,
      `SELECT count(*)::int AS n FROM attendance_logs a JOIN events e ON e.event_id = a.event_id
        WHERE a.user_id = $1 AND e.cell_group_id = $2 AND a.checked_in_at >= now() - INTERVAL '30 days'`,
      [userId, me.cell_group_id],
    );
    // Next cell gathering: expand this cell's visible series over the next 30 days.
    const scope = await this.scopeOf(this.pool, userId);
    const series = (await this.visibleSeries(this.pool, scope)).filter((s) => s.cell_group_id === me.cell_group_id);
    const now = new Date();
    const horizon = new Date(now.getTime() + 30 * 86_400_000);
    let next: { start_at: string; location: string | null } | null = null;
    for (const s of series) {
      for (const o of expandOccurrences(s, now, horizon, 4)) {
        if (new Date(o.start_at) >= now && (!next || o.start_at < next.start_at)) next = { start_at: o.start_at, location: s.location };
      }
    }
    return {
      cell: {
        cell_group_id: me.cell_group_id,
        name: cell.name,
        members: members.n,
        leader: leaderName ? { name: leaderName, role: cell.discipler_role, avatar_url: cell.leader_avatar_url } : null,
        attendance: { attended: attended.n, expected: cell.meeting_cadence },
        next: next ? { start_at: next.start_at, location: next.location } : null,
      },
    };
  }

  // ---------------- Admin: series CRUD ----------------

  // Per-series automation config (EVENTS_ARCHITECTURE §7), stored as JSONB and
  // executed by the worker crons. Validated strictly so the crons can trust it.
  static readonly Automation = z
    .object({
      // Minutes before start to remind "going" RSVPs (default [1440, 60]).
      reminder_offsets_min: z.array(z.number().int().min(5).max(20_160)).max(6).optional(),
      // Archive completed occurrences after N days (worker cron).
      auto_archive_days: z.number().int().min(1).max(365).nullable().optional(),
      // Alert leaders when "going" < threshold within offset_min of start.
      low_rsvp_alert: z
        .object({
          threshold: z.number().int().min(1).max(100_000),
          offset_min: z.number().int().min(60).max(20_160).default(2880),
        })
        .nullable()
        .optional(),
      // The QR panel arms checkin_opens_min_before automatically.
      qr_auto_ready: z.boolean().optional(),
    })
    .strict();

  // Canonical series fields. The wire payload is normalized first (see
  // normalizeSeriesInput) so both the mobile/canonical shape and the admin
  // portal's Create-event shape validate against this.
  static readonly SeriesShape = z.object({
    cell_group_id: z.string().uuid().nullable().optional(),
    title: z.string().min(1).max(255),
    description: z.string().nullable().optional(),
    location: z.string().max(255).nullable().optional(),
    category: z.string().max(24).nullable().optional(),
    // Optional cover image + a small gallery (up to 5 extra → 6 total) shown as a
    // carousel on the mobile event detail. URLs come from a Cloudinary upload or
    // a pasted link.
    primary_image_url: z.string().url().max(2048).nullable().optional(),
    gallery_image_urls: z.array(z.string().url().max(2048)).max(5).optional(),
    video_url: z.string().url().max(2048).nullable().optional(),
    timezone: z.string().min(1).max(64),
    dtstart_local: z.string().min(1), // ISO-ish wall clock
    duration_min: z.number().int().min(5).max(720),
    rrule: z.string().nullable().optional(),
    visibility: z.enum(["congregation", "cell", "leaders"]).default("cell"),
    // Ops toggles (Contract Matrix B2; EVENTS_ARCHITECTURE §3 wires them all) —
    // copied onto materialized occurrences.
    rsvp_enabled: z.boolean().default(true),
    qr_enabled: z.boolean().default(true),
    manual_checkin_enabled: z.boolean().default(true),
    reminders_enabled: z.boolean().default(true),
    checkin_opens_min_before: z.number().int().min(0).max(1440).nullable().optional(),
    // Per-series automation (§7).
    automation: CalendarService.Automation.optional(),
    // Draft series are recorded but not materialized or shown to members.
    status: z.enum(["draft", "active"]).default("active"),
  });

  static readonly CreateSeries = z.preprocess(normalizeSeriesInput, CalendarService.SeriesShape);

  async createSeries(principal: Principal, input: z.infer<typeof CalendarService.CreateSeries>): Promise<unknown> {
    if (input.rrule) validateRrule(input.rrule);
    if (!DateTime.now().setZone(input.timezone).isValid) {
      throw new ApiError("VALIDATION_FAILED", "Invalid IANA timezone");
    }
    return tx(this.pool, async (c) => {
      // Creation rights: Instructor for assigned cells; Admin+ congregation-wide.
      await this.assertCreateRight(c, principal, input.cell_group_id ?? null, input.visibility);
      const row = await one<{ series_id: string }>(
        c,
        `INSERT INTO event_series
           (congregation_id, cell_group_id, title, description, location, category, timezone, dtstart_local, duration_min, rrule, visibility, created_by,
            rsvp_enabled, qr_enabled, manual_checkin_enabled, reminders_enabled, checkin_opens_min_before, status, primary_image_url, gallery_image_urls,
            video_url, automation)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING series_id`,
        [
          principal.congregationId,
          input.cell_group_id ?? null,
          input.title,
          input.description ?? null,
          input.location ?? null,
          input.category ?? null,
          input.timezone,
          input.dtstart_local,
          input.duration_min,
          input.rrule ?? null,
          input.visibility,
          principal.userId,
          input.rsvp_enabled ?? true,
          input.qr_enabled ?? true,
          input.manual_checkin_enabled ?? true,
          input.reminders_enabled ?? true,
          input.checkin_opens_min_before ?? null,
          input.status ?? "active",
          input.primary_image_url ?? null,
          input.gallery_image_urls ?? [],
          input.video_url ?? null,
          JSON.stringify(input.automation ?? {}),
        ],
      );
      // Drafts are not materialized (no occurrences / reminders) until published.
      if ((input.status ?? "active") !== "draft") {
        await enqueueOutbox(c, "calendar.materialize", { series_id: row.series_id });
      }
      await audit(c, principal.userId, "calendar.series_created", "event_series", row.series_id, { status: input.status ?? "active" });
      return one(c, `SELECT * FROM event_series WHERE series_id = $1`, [row.series_id]);
    });
  }

  private async assertCreateRight(
    c: Queryable,
    principal: Principal,
    cellGroupId: string | null,
    visibility: string,
  ): Promise<void> {
    if (principal.role === "Admin" || principal.role === "SuperAdmin") return;
    if (principal.role === "Instructor" && visibility !== "congregation" && cellGroupId) {
      const led = await maybeOne(
        c,
        `SELECT 1 FROM leader_assignments WHERE leader_user_id = $1 AND cell_group_id = $2`,
        [principal.userId, cellGroupId],
      );
      if (led) return;
    }
    throw new ApiError("FORBIDDEN_SCOPE", "Not permitted to create events in this scope");
  }

  static readonly UpdateSeries = z.preprocess(normalizeSeriesInput, CalendarService.SeriesShape.partial());

  async updateSeries(principal: Principal, seriesId: string, input: z.infer<typeof CalendarService.UpdateSeries>): Promise<unknown> {
    if (input.rrule) validateRrule(input.rrule);
    const row = await tx(this.pool, async (c) => {
      const s = await maybeOne<{ congregation_id: string }>(c, `SELECT congregation_id FROM event_series WHERE series_id = $1 AND deleted_at IS NULL`, [seriesId]);
      if (!s) throw new ApiError("NOT_FOUND", "Series not found");
      if (s.congregation_id !== principal.congregationId && principal.role !== "SuperAdmin") {
        throw new ApiError("FORBIDDEN_SCOPE", "Series outside your congregation");
      }
      const fields: Record<string, unknown> = {
        title: input.title,
        description: input.description,
        location: input.location,
        category: input.category,
        primary_image_url: input.primary_image_url,
        gallery_image_urls: input.gallery_image_urls,
        // §3: video_url + the full ops-toggle set are now editable on a series.
        video_url: input.video_url,
        timezone: input.timezone,
        dtstart_local: input.dtstart_local,
        duration_min: input.duration_min,
        rrule: input.rrule,
        visibility: input.visibility,
        status: input.status,
        rsvp_enabled: input.rsvp_enabled,
        qr_enabled: input.qr_enabled,
        manual_checkin_enabled: input.manual_checkin_enabled,
        reminders_enabled: input.reminders_enabled,
        checkin_opens_min_before: input.checkin_opens_min_before,
        automation: input.automation === undefined ? undefined : JSON.stringify(input.automation),
      };
      const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
      if (keys.length > 0) {
        const sets = keys.map((k, i) => `${k} = $${i + 2}`);
        await c.query(`UPDATE event_series SET ${sets.join(", ")} WHERE series_id = $1`, [seriesId, ...keys.map((k) => fields[k])]);
      }
      await enqueueOutbox(c, "calendar.materialize", { series_id: seriesId });
      await audit(c, principal.userId, "calendar.series_updated", "event_series", seriesId, { fields: keys });
      return one(c, `SELECT * FROM event_series WHERE series_id = $1`, [seriesId]);
    });
    // §2: reconcile synchronously on series update — already-materialized rows
    // pick up the new title/time immediately (no stale /events/:id), and rows the
    // edited rule no longer produces are cancelled/pruned. The nightly sweep is
    // the backstop, not the primary path.
    await this.reconcileSeries(seriesId);
    return row;
  }

  static readonly Exception = z
    .object({
      original_start_at: z.string().min(1),
      is_cancelled: z.boolean().default(false),
      new_start_at: z.string().nullable().optional(),
      new_end_at: z.string().nullable().optional(),
      note: z.string().max(255).nullable().optional(),
    })
    .strict();

  async addException(principal: Principal, seriesId: string, input: z.infer<typeof CalendarService.Exception>): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const s = await maybeOne(c, `SELECT 1 FROM event_series WHERE series_id = $1 AND deleted_at IS NULL`, [seriesId]);
      if (!s) throw new ApiError("NOT_FOUND", "Series not found");
      const row = await one(
        c,
        `INSERT INTO event_exceptions (series_id, original_start_at, is_cancelled, new_start_at, new_end_at, note)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (series_id, original_start_at) DO UPDATE
           SET is_cancelled = EXCLUDED.is_cancelled, new_start_at = EXCLUDED.new_start_at,
               new_end_at = EXCLUDED.new_end_at, note = EXCLUDED.note
         RETURNING *`,
        [seriesId, input.original_start_at, input.is_cancelled, input.new_start_at ?? null, input.new_end_at ?? null, input.note ?? null],
      );
      await audit(c, principal.userId, "calendar.exception", "event_series", seriesId, {
        original: input.original_start_at,
        is_cancelled: input.is_cancelled,
        new_start_at: input.new_start_at ?? null,
      });

      // Notify members who RSVP'd "going" to the matching materialized occurrence
      // (cancellation or reschedule, Contract Matrix B2). Best-effort: notification
      // failures must not roll back the exception itself.
      const occurrence = await maybeOne<{ event_id: string; occurs_at: string }>(
        c,
        `SELECT event_id, occurs_at FROM events WHERE series_id = $1 AND occurrence_start = $2`,
        [seriesId, input.original_start_at],
      );
      if (occurrence) {
        const goers = await many<{ user_id: string }>(
          c,
          `SELECT user_id FROM event_rsvps WHERE event_id = $1 AND status = 'going'`,
          [occurrence.event_id],
        );
        const template = input.is_cancelled ? "event_cancelled" : "event_rescheduled";
        for (const g of goers) {
          try {
            await this.notifications.schedule({
              userId: g.user_id,
              channel: "push",
              template,
              payload: {
                event_id: occurrence.event_id,
                original_start_at: input.original_start_at,
                new_start_at: input.new_start_at ?? null,
                note: input.note ?? null,
              },
            });
          } catch {
            // best-effort
          }
        }
      }
      return row;
    }).then(async (row) => {
      // §2: reconcile immediately so a reschedule updates the materialized row's
      // occurs_at (no stale /events/:id) and a cancellation prunes it (the
      // notification above already went out; reconcile won't re-notify).
      await this.reconcileSeries(seriesId);
      return row;
    });
  }

  async deleteSeries(principal: Principal, seriesId: string): Promise<{ deleted: boolean }> {
    return tx(this.pool, async (c) => {
      const r = await c.query(`UPDATE event_series SET deleted_at = now() WHERE series_id = $1 AND deleted_at IS NULL`, [seriesId]);
      if (r.rowCount === 0) throw new ApiError("NOT_FOUND", "Series not found");
      await audit(c, principal.userId, "calendar.series_deleted", "event_series", seriesId, {});
      return { deleted: true };
    });
  }

  // ---------------- Materializer + reconciler (EVENTS_ARCHITECTURE §2) ----------------

  /** Full series row for expansion/materialization (active or not — callers filter). */
  private async seriesForMaterialize(seriesId: string): Promise<(SeriesRow & { is_paused: boolean; status: string }) | null> {
    return maybeOne<SeriesRow & { is_paused: boolean; status: string }>(
      this.pool,
      `SELECT series_id, congregation_id, cell_group_id, title, description, location, timezone,
              to_char(dtstart_local, 'YYYY-MM-DD"T"HH24:MI:SS') AS dtstart_local,
              duration_min, rrule, visibility, is_paused, status,
              rsvp_enabled, qr_enabled, manual_checkin_enabled, reminders_enabled, checkin_opens_min_before
         FROM event_series WHERE series_id = $1 AND deleted_at IS NULL`,
      [seriesId],
    );
  }

  /**
   * The occurrences the series SHOULD have in [from,to]: rule expansion minus
   * cancelled exceptions, with reschedules applied (occurrence_start stays the
   * original instant — the identity — while occurs_at carries the actual time).
   */
  private expectedOccurrences(
    s: SeriesRow,
    exceptions: Map<number, ExceptionRow>,
    from: Date,
    to: Date,
  ): Map<number, { original: string; actual: string }> {
    const out = new Map<number, { original: string; actual: string }>();
    for (const o of expandOccurrences(s, from, to, this.maxInstances)) {
      const ms = new Date(o.start_at).getTime();
      const ex = exceptions.get(ms);
      if (ex?.is_cancelled) continue;
      out.set(ms, { original: o.start_at, actual: ex?.new_start_at ?? o.start_at });
    }
    return out;
  }

  private opensAtFor(s: SeriesRow, actualStartIso: string): string | null {
    return s.checkin_opens_min_before == null
      ? null
      : new Date(new Date(actualStartIso).getTime() - s.checkin_opens_min_before * 60_000).toISOString();
  }

  /**
   * Realize occurrences within [from, to] into `events` (idempotent upsert,
   * DO NOTHING). Window-parameterized — there is NO fixed horizon (§2); the
   * default window is a rolling [now−90d, now+90d]: forward so upcoming
   * occurrences exist before anyone asks, backward so occurrences that were
   * never materialized while future still get a row (see
   * MATERIALIZE_BACKFILL_DAYS). Drafts and paused series are never materialized.
   */
  async materialize(seriesId: string, from?: Date, to?: Date): Promise<{ created: number }> {
    const now = Date.now();
    const windowFrom = from ?? new Date(now - MATERIALIZE_BACKFILL_DAYS * 86_400_000);
    // An explicitly-passed `from` keeps the old "…+90d" span; the default (past)
    // window still reaches 90 days past *now*, not 90 days past the backfill start.
    const windowTo = to ?? new Date(Math.max(windowFrom.getTime(), now) + RECONCILE_WINDOW_DAYS * 86_400_000);
    const s = await this.seriesForMaterialize(seriesId);
    if (!s || s.status !== "active" || s.is_paused) return { created: 0 };
    const exceptions = (await this.exceptionsBySeries([seriesId])).get(seriesId) ?? new Map<number, ExceptionRow>();
    const expected = [...this.expectedOccurrences(s, exceptions, windowFrom, windowTo).values()];
    if (expected.length === 0) return { created: 0 };
    // One batched insert — the window is now twice as wide, and a per-occurrence
    // round-trip on every reader's ensure-materialize (homeEvents, rosters) was
    // already the expensive part of this path.
    const r = await this.pool.query(
      `INSERT INTO events (event_id, congregation_id, cell_group_id, title, occurs_at, qr_secret, series_id, occurrence_start,
                           rsvp_enabled, qr_enabled, allow_manual_checkin, checkin_opens_at)
       SELECT * FROM unnest($1::varchar[], $2::uuid[], $3::uuid[], $4::varchar[], $5::timestamptz[], $6::varchar[],
                            $7::uuid[], $8::timestamptz[], $9::boolean[], $10::boolean[], $11::boolean[], $12::timestamptz[])
       ON CONFLICT (series_id, occurrence_start) DO NOTHING`,
      [
        expected.map((occ) => occurrenceId(seriesId, occ.original)),
        expected.map(() => s.congregation_id),
        expected.map(() => s.cell_group_id),
        expected.map(() => s.title),
        expected.map((occ) => occ.actual),
        expected.map(() => randomBytes(24).toString("hex")),
        expected.map(() => seriesId),
        expected.map((occ) => occ.original),
        expected.map(() => s.rsvp_enabled ?? true),
        expected.map(() => s.qr_enabled ?? true),
        expected.map(() => s.manual_checkin_enabled ?? true),
        expected.map((occ) => this.opensAtFor(s, occ.actual)),
      ],
    );
    return { created: r.rowCount ?? 0 };
  }

  /**
   * Reconcile one series' materialized rows against its current rule +
   * exceptions over a rolling [now, now+90d] window (§2):
   *  - materialize anything missing;
   *  - refresh title / actual time / toggles on rows that drifted (a series
   *    edit or a reschedule exception no longer leaves stale /events/:id data);
   *  - rows the rule no longer produces are pruned — members who had RSVP'd get
   *    an exception-style cancellation notice first (cancelled-by-exception rows
   *    were already notified by addException; rows with attendance are kept for
   *    historical integrity).
   * Runs synchronously on series update and nightly for every active series.
   */
  async reconcileSeries(
    seriesId: string,
    now: Date = new Date(),
    days: number = RECONCILE_WINDOW_DAYS,
  ): Promise<{ created: number; refreshed: number; pruned: number }> {
    const s = await this.seriesForMaterialize(seriesId);
    // Paused/draft/deleted series: leave materialized rows untouched (pause only
    // stops the forward-looking projection — migration 47's contract).
    if (!s || s.status !== "active" || s.is_paused) return { created: 0, refreshed: 0, pruned: 0 };
    const to = new Date(now.getTime() + days * 86_400_000);
    // Materialize over [now−backfill, now+days] so the nightly sweep also heals
    // series whose occurrences were never realized while they were still future
    // (back-dated creation, import/restore). The refresh + prune pass below stays
    // forward-only from `now`: past rows are history — never re-timed, never
    // pruned, and never retro-notified as "cancelled".
    const { created } = await this.materialize(seriesId, new Date(now.getTime() - MATERIALIZE_BACKFILL_DAYS * 86_400_000), to);

    const exceptions = (await this.exceptionsBySeries([seriesId])).get(seriesId) ?? new Map<number, ExceptionRow>();
    const expected = this.expectedOccurrences(s, exceptions, now, to);

    const rows = await many<{ event_id: string; occurrence_start: string }>(
      this.pool,
      `SELECT event_id, occurrence_start FROM events
        WHERE series_id = $1 AND occurrence_start >= $2 AND occurrence_start <= $3`,
      [seriesId, now.toISOString(), to.toISOString()],
    );

    let refreshed = 0;
    let pruned = 0;
    for (const row of rows) {
      const ms = new Date(row.occurrence_start).getTime();
      const exp = expected.get(ms);
      if (exp) {
        const r = await this.pool.query(
          `UPDATE events
              SET title = $2, occurs_at = $3, checkin_opens_at = $4,
                  rsvp_enabled = $5, qr_enabled = $6, allow_manual_checkin = $7
            WHERE event_id = $1
              AND (title IS DISTINCT FROM $2 OR occurs_at IS DISTINCT FROM $3::timestamptz
                   OR checkin_opens_at IS DISTINCT FROM $4::timestamptz
                   OR rsvp_enabled IS DISTINCT FROM $5 OR qr_enabled IS DISTINCT FROM $6
                   OR allow_manual_checkin IS DISTINCT FROM $7)`,
          [
            row.event_id,
            s.title,
            exp.actual,
            this.opensAtFor(s, exp.actual),
            s.rsvp_enabled ?? true,
            s.qr_enabled ?? true,
            s.manual_checkin_enabled ?? true,
          ],
        );
        refreshed += r.rowCount ?? 0;
        continue;
      }
      // Orphan: the current rule/exceptions no longer produce this instant.
      const attended = await maybeOne(this.pool, `SELECT 1 FROM attendance_logs WHERE event_id = $1 LIMIT 1`, [row.event_id]);
      if (attended) continue; // history stays
      const cancelledByException = exceptions.get(ms)?.is_cancelled === true;
      if (!cancelledByException) {
        const goers = await many<{ user_id: string }>(
          this.pool,
          `SELECT user_id FROM event_rsvps WHERE event_id = $1 AND status IN ('going','maybe')`,
          [row.event_id],
        );
        for (const g of goers) {
          try {
            await this.notifications.schedule({
              userId: g.user_id,
              channel: "push",
              template: "event_cancelled",
              payload: { event_id: row.event_id, original_start_at: row.occurrence_start, note: null },
            });
          } catch {
            // best-effort
          }
        }
      }
      await this.pool.query(`DELETE FROM events WHERE event_id = $1`, [row.event_id]);
      pruned += 1;
    }
    return { created, refreshed, pruned };
  }

  /** Nightly worker sweep: reconcile every active series over [now, now+90d]. */
  async reconcileSweep(now: Date = new Date()): Promise<{ series: number; created: number; refreshed: number; pruned: number }> {
    const list = await many<{ series_id: string }>(
      this.pool,
      `SELECT series_id FROM event_series
        WHERE deleted_at IS NULL AND status = 'active' AND is_paused = FALSE`,
    );
    const totals = { series: list.length, created: 0, refreshed: 0, pruned: 0 };
    for (const s of list) {
      const r = await this.reconcileSeries(s.series_id, now);
      totals.created += r.created;
      totals.refreshed += r.refreshed;
      totals.pruned += r.pruned;
    }
    return totals;
  }

  // ---------------- Automation crons (EVENTS_ARCHITECTURE §7) ----------------

  /** Archive completed occurrences N days after they happened (per-series opt-in). */
  async runAutoArchive(now: Date = new Date()): Promise<number> {
    const res = await this.pool.query(
      `UPDATE events e SET archived_at = now()
         FROM event_series s
        WHERE s.series_id = e.series_id AND e.archived_at IS NULL
          AND jsonb_typeof(s.automation->'auto_archive_days') = 'number'
          AND e.occurs_at < $1::timestamptz - make_interval(days => (s.automation->>'auto_archive_days')::int)`,
      [now.toISOString()],
    );
    return res.rowCount ?? 0;
  }

  /** Alert the series creator + the cell's leaders when an upcoming occurrence
   *  inside the configured window has fewer "going" RSVPs than the threshold.
   *  Idempotent per occurrence via events.low_rsvp_alerted_at. */
  async runLowRsvpAlerts(now: Date = new Date()): Promise<number> {
    const rows = await many<{
      event_id: string;
      occurs_at: string;
      title: string;
      cell_group_id: string | null;
      created_by: string;
      threshold: number;
      going: number;
    }>(
      this.pool,
      `SELECT e.event_id, e.occurs_at, s.title, s.cell_group_id, s.created_by,
              (s.automation->'low_rsvp_alert'->>'threshold')::int AS threshold,
              (SELECT count(*)::int FROM event_rsvps r WHERE r.event_id = e.event_id AND r.status = 'going') AS going
         FROM events e JOIN event_series s ON s.series_id = e.series_id
        WHERE jsonb_typeof(s.automation->'low_rsvp_alert') = 'object'
          AND s.deleted_at IS NULL AND s.status = 'active' AND s.is_paused = FALSE
          AND e.low_rsvp_alerted_at IS NULL AND e.archived_at IS NULL
          AND e.occurs_at > $1::timestamptz
          AND e.occurs_at <= $1::timestamptz
              + make_interval(mins => COALESCE((s.automation->'low_rsvp_alert'->>'offset_min')::int, 2880))`,
      [now.toISOString()],
    );
    let alerted = 0;
    for (const row of rows) {
      if (row.going >= row.threshold) continue;
      const leaders = row.cell_group_id
        ? await many<{ leader_user_id: string }>(
            this.pool,
            `SELECT leader_user_id FROM leader_assignments WHERE cell_group_id = $1`,
            [row.cell_group_id],
          )
        : [];
      const recipients = new Set<string>([row.created_by, ...leaders.map((l) => l.leader_user_id)]);
      for (const userId of recipients) {
        try {
          await this.notifications.schedule({
            userId,
            channel: "push",
            template: "event_low_rsvp",
            payload: { event_id: row.event_id, title: row.title, occurs_at: row.occurs_at, going: row.going, threshold: row.threshold },
          });
        } catch {
          // best-effort
        }
      }
      await this.pool.query(`UPDATE events SET low_rsvp_alerted_at = now() WHERE event_id = $1`, [row.event_id]);
      alerted += 1;
    }
    return alerted;
  }

  /** Resolve an occurrence id to a real `events` row, materializing it on demand
   *  if the worker hasn't yet — so RSVP + detail work the instant a member opens a
   *  projected occurrence. The occurrence id is `occurrenceId(series_id, start)`,
   *  which is exactly the materialized `event_id`. Returns true if a row now
   *  exists. A bare UUID that doesn't exist (or a fake instant) returns false →
   *  the caller surfaces NOT_FOUND. */
  private async ensureOccurrence(c: Queryable, eventId: string): Promise<boolean> {
    const exists = await maybeOne<{ event_id: string }>(c, `SELECT event_id FROM events WHERE event_id = $1`, [eventId]);
    if (exists) return true;
    const idx = eventId.indexOf(":"); // synthetic id = "<series uuid>:<ISO start>"
    if (idx < 0) return false;
    const seriesId = eventId.slice(0, idx);
    const startMs = Date.parse(eventId.slice(idx + 1));
    if (Number.isNaN(startMs)) return false;
    const s = await maybeOne<SeriesRow>(
      c,
      `SELECT series_id, congregation_id, cell_group_id, title, description, location, timezone,
              to_char(dtstart_local, 'YYYY-MM-DD"T"HH24:MI:SS') AS dtstart_local,
              duration_min, rrule, visibility,
              rsvp_enabled, qr_enabled, manual_checkin_enabled, reminders_enabled, checkin_opens_min_before
         FROM event_series WHERE series_id = $1 AND deleted_at IS NULL`,
      [seriesId],
    );
    if (!s) return false;
    // Only materialize a genuine, non-cancelled instant of this series.
    const lo = new Date(Math.min(Date.now(), startMs) - 86_400_000);
    const hi = new Date(Math.max(Date.now(), startMs) + 86_400_000);
    const match = expandOccurrences(s, lo, hi, this.maxInstances).find((o) => new Date(o.start_at).getTime() === startMs);
    if (!match) return false;
    const ex = await maybeOne<{ is_cancelled: boolean; new_start_at: string | null }>(
      c,
      `SELECT is_cancelled, new_start_at FROM event_exceptions WHERE series_id = $1 AND original_start_at = $2`,
      [seriesId, new Date(startMs).toISOString()],
    );
    if (ex?.is_cancelled) return false;
    const actualStart = ex?.new_start_at ?? match.start_at;
    await c.query(
      `INSERT INTO events (event_id, congregation_id, cell_group_id, title, occurs_at, qr_secret, series_id, occurrence_start,
                           rsvp_enabled, qr_enabled, allow_manual_checkin, checkin_opens_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (series_id, occurrence_start) DO NOTHING`,
      [eventId, s.congregation_id, s.cell_group_id, s.title, actualStart, randomBytes(24).toString("hex"),
        seriesId, match.start_at, s.rsvp_enabled ?? true, s.qr_enabled ?? true, s.manual_checkin_enabled ?? true,
        this.opensAtFor(s, actualStart)],
    );
    return true;
  }

  /** Public ensure-materialize for id-addressed readers outside this class
   *  (attendance roster, QR panel, CSV export): a synthetic occurrence id
   *  resolves to a real row before the reader queries it (§2). */
  async ensureEvent(eventId: string): Promise<void> {
    await this.ensureOccurrence(this.pool, eventId);
  }

  // ---------------- RSVP ----------------

  static readonly Rsvp = z.object({
    status: z.enum(["going", "maybe", "declined"]),
    client_mutation_id: z.string().uuid().optional(),
  });

  async setRsvp(
    userId: string,
    eventId: string,
    input: { status: "going" | "maybe" | "declined"; client_mutation_id?: string | undefined },
    c: Queryable = this.pool,
  ): Promise<{ duplicate: boolean; status: string }> {
    if (input.client_mutation_id) {
      const dup = await maybeOne<{ status: string }>(c, `SELECT status FROM event_rsvps WHERE client_mutation_id = $1`, [input.client_mutation_id]);
      if (dup) return { duplicate: true, status: dup.status };
    }
    await this.ensureOccurrence(c, eventId); // materialize a projected occurrence on first RSVP
    await this.assertEventVisible(c, userId, eventId); // §8: same scoping as visibleSeries
    const ev = await maybeOne<{ event_id: string; occurs_at: string; rsvp_enabled: boolean; reminders: boolean; automation: Record<string, unknown> | null }>(
      c,
      `SELECT e.event_id, e.occurs_at, e.rsvp_enabled,
              COALESCE(es.reminders_enabled, TRUE) AS reminders, es.automation
         FROM events e LEFT JOIN event_series es ON es.series_id = e.series_id
        WHERE e.event_id = $1`,
      [eventId],
    );
    if (!ev) throw new ApiError("NOT_FOUND", "Event not found");
    if (!ev.rsvp_enabled) throw new ApiError("UNPROCESSABLE", "RSVP is not enabled for this event");
    const row = await one<{ rsvp_id: string; status: string }>(
      c,
      `INSERT INTO event_rsvps (event_id, user_id, status, client_mutation_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (event_id, user_id) DO UPDATE
         SET status = EXCLUDED.status, client_mutation_id = COALESCE(EXCLUDED.client_mutation_id, event_rsvps.client_mutation_id), updated_at = now()
       RETURNING rsvp_id, status`,
      [eventId, userId, input.status, input.client_mutation_id ?? null],
    );
    await recordChange(c, "event_rsvps", row.rsvp_id, userId, "upsert");

    // Reminders for a future "going" RSVP (quiet-hours aware; offsets that have
    // already passed are skipped). Offsets come from the series' automation
    // config (§7) and default to today's hardcoded T-24h / T-1h.
    if (input.status === "going" && ev.reminders) {
      const startMs = new Date(ev.occurs_at).getTime();
      const configured = (ev.automation as { reminder_offsets_min?: unknown } | null)?.reminder_offsets_min;
      const offsets = (
        Array.isArray(configured) && configured.every((n) => typeof n === "number" && Number.isInteger(n) && n > 0)
          ? (configured as number[])
          : DEFAULT_REMINDER_OFFSETS_MIN
      )
        .slice()
        .sort((a, b) => b - a)
        .filter((min) => startMs - min * 60_000 > Date.now());
      for (const min of offsets) {
        await this.notifications.schedule({
          userId,
          channel: "push",
          template: min >= 1440 ? "event_reminder_24h" : "event_reminder_1h",
          payload: { event_id: eventId, occurs_at: ev.occurs_at },
          at: startMs - min * 60_000,
        });
      }
    }
    return { duplicate: false, status: row.status };
  }

  // ---------------- Event wall (attendee posts: image + caption) ----------------

  static readonly EventPost = z.object({
    post_id: z.string().uuid(),
    body: z.string().max(2000).nullable().optional(),
    image_url: z.string().url().max(500).nullable().optional(),
    client_mutation_id: z.string().uuid().optional(),
  });

  /** Posts on an occurrence's wall (author + avatar), newest first. */
  async listEventPosts(userId: string, eventId: string): Promise<{ data: unknown[] }> {
    await this.ensureOccurrence(this.pool, eventId);
    await this.assertEventVisible(this.pool, userId, eventId); // §8
    const ev = await maybeOne<{ event_id: string }>(this.pool, `SELECT event_id FROM events WHERE event_id = $1`, [eventId]);
    if (!ev) throw new ApiError("NOT_FOUND", "Event not found");
    const data = await many(
      this.pool,
      `SELECT p.post_id, p.author_user_id, u.full_name AS author_name, u.avatar_url AS author_avatar,
              p.body, p.image_url, p.created_at,
              (p.author_user_id = $2) AS mine,
              r.status AS rsvp_status,
              COALESCE(rx.cheer_count, 0)::int AS cheer_count,
              COALESCE(rx.love_count, 0)::int AS love_count,
              mine_rx.kind AS my_reaction
         FROM event_posts p
         JOIN users u ON u.user_id = p.author_user_id
         LEFT JOIN event_rsvps r ON r.event_id = p.event_id AND r.user_id = p.author_user_id
         LEFT JOIN (
           SELECT post_id,
                  count(*) FILTER (WHERE kind = 'cheer') AS cheer_count,
                  count(*) FILTER (WHERE kind = 'love')  AS love_count
             FROM event_post_reactions GROUP BY post_id
         ) rx ON rx.post_id = p.post_id
         LEFT JOIN event_post_reactions mine_rx ON mine_rx.post_id = p.post_id AND mine_rx.user_id = $2
        WHERE p.event_id = $1 AND NOT p.is_hidden
        ORDER BY p.created_at DESC
        LIMIT 100`,
      [eventId, userId],
    );
    return { data };
  }

  static readonly Reaction = z.object({
    // null clears the member's reaction (toggle off); a kind sets/switches it.
    kind: z.enum(["cheer", "love"]).nullable(),
  });

  /**
   * Set, switch, or clear the member's single reaction on a post. One row per
   * (post_id, user_id): tapping a new emoji upserts (keep the latter), tapping
   * the held emoji clears it. Returns the fresh counts + my_reaction.
   */
  async reactToPost(
    userId: string,
    eventId: string,
    postId: string,
    kind: "cheer" | "love" | null,
  ): Promise<{ cheer_count: number; love_count: number; my_reaction: "cheer" | "love" | null }> {
    await this.assertEventVisible(this.pool, userId, eventId); // §8
    const post = await maybeOne<{ post_id: string }>(
      this.pool,
      `SELECT post_id FROM event_posts WHERE post_id = $1 AND event_id = $2 AND NOT is_hidden`,
      [postId, eventId],
    );
    if (!post) throw new ApiError("NOT_FOUND", "Post not found");
    return tx(this.pool, async (c) => {
      if (kind === null) {
        await c.query(`DELETE FROM event_post_reactions WHERE post_id = $1 AND user_id = $2`, [postId, userId]);
      } else {
        await c.query(
          `INSERT INTO event_post_reactions (post_id, user_id, kind) VALUES ($1, $2, $3)
           ON CONFLICT (post_id, user_id) DO UPDATE SET kind = EXCLUDED.kind, updated_at = now()`,
          [postId, userId, kind],
        );
      }
      const counts = await one<{ cheer_count: number; love_count: number }>(
        c,
        `SELECT count(*) FILTER (WHERE kind = 'cheer')::int AS cheer_count,
                count(*) FILTER (WHERE kind = 'love')::int  AS love_count
           FROM event_post_reactions WHERE post_id = $1`,
        [postId],
      );
      return { cheer_count: counts.cheer_count, love_count: counts.love_count, my_reaction: kind };
    });
  }

  async createEventPost(
    userId: string,
    eventId: string,
    input: z.infer<typeof CalendarService.EventPost>,
  ): Promise<{ post_id: string; duplicate: boolean }> {
    if (!input.body?.trim() && !input.image_url) {
      throw new ApiError("UNPROCESSABLE", "A post needs a caption or a photo");
    }
    return tx(this.pool, async (c) => {
      if (input.client_mutation_id) {
        const dup = await maybeOne<{ post_id: string }>(c, `SELECT post_id FROM event_posts WHERE client_mutation_id = $1`, [input.client_mutation_id]);
        if (dup) return { post_id: dup.post_id, duplicate: true };
      }
      const ok = await this.ensureOccurrence(c, eventId);
      if (!ok) throw new ApiError("NOT_FOUND", "Event not found");
      await this.assertEventVisible(c, userId, eventId); // §8 — same hole as the read path
      const res = await c.query(
        `INSERT INTO event_posts (post_id, event_id, author_user_id, body, image_url, client_mutation_id)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (post_id) DO NOTHING RETURNING post_id`,
        [input.post_id, eventId, userId, input.body?.trim() || null, input.image_url ?? null, input.client_mutation_id ?? null],
      );
      if (res.rowCount === 0) return { post_id: input.post_id, duplicate: true };
      return { post_id: input.post_id, duplicate: false };
    });
  }

  /** The member's RSVPs for upcoming events ("My RSVPs", Contract Matrix B2). */
  async myRsvps(userId: string): Promise<unknown[]> {
    return many(
      this.pool,
      `SELECT r.rsvp_id, r.status::text, r.updated_at,
              e.event_id, e.title, e.occurs_at, e.cell_group_id
         FROM event_rsvps r JOIN events e ON e.event_id = r.event_id
        WHERE r.user_id = $1 AND e.occurs_at >= now() - interval '1 day'
        ORDER BY e.occurs_at ASC
        LIMIT 100`,
      [userId],
    );
  }

  async getEvent(userId: string, eventId: string): Promise<unknown> {
    await this.ensureOccurrence(this.pool, eventId); // realize a projected occurrence so detail + counts resolve
    await this.assertEventVisible(this.pool, userId, eventId); // §8: congregation + visibility scoping
    // Join the parent series for the descriptive fields + cover image / gallery
    // (the materialized `events` row only carries title + occurs_at).
    const ev = await maybeOne<{
      event_id: string;
      title: string;
      occurs_at: string;
      congregation_id: string;
      description: string | null;
      location: string | null;
      category: string | null;
      primary_image_url: string | null;
      gallery_image_urls: string[] | null;
      video_url: string | null;
      show_on_home: boolean | null;
    }>(
      this.pool,
      `SELECT e.event_id, e.title, e.occurs_at, e.congregation_id,
              s.description, s.location, s.category, s.primary_image_url, s.gallery_image_urls, s.video_url, s.show_on_home
         FROM events e
         LEFT JOIN event_series s ON s.series_id = e.series_id
        WHERE e.event_id = $1`,
      [eventId],
    );
    if (!ev) throw new ApiError("NOT_FOUND", "Event not found");
    const counts = await many<{ status: string; n: number }>(
      this.pool,
      `SELECT status, COUNT(*)::int AS n FROM event_rsvps WHERE event_id = $1 GROUP BY status`,
      [eventId],
    );
    const mine = await maybeOne<{ status: string }>(this.pool, `SELECT status FROM event_rsvps WHERE event_id = $1 AND user_id = $2`, [eventId, userId]);
    // A few attendee faces (most-recent "going" RSVPs) so the detail's "who's going"
    // rail shows the real roster, not just whoever posted to the wall.
    const faces = await many<{ user_id: string; full_name: string; avatar_url: string | null }>(
      this.pool,
      `SELECT u.user_id, u.full_name, u.avatar_url
         FROM event_rsvps r JOIN users u ON u.user_id = r.user_id
        WHERE r.event_id = $1 AND r.status = 'going'
        ORDER BY r.updated_at DESC
        LIMIT 12`,
      [eventId],
    );
    // Primary first, then the gallery — what the mobile detail carousel renders.
    const images = [ev.primary_image_url, ...(ev.gallery_image_urls ?? [])].filter((u): u is string => !!u);
    return {
      event_id: ev.event_id,
      title: ev.title,
      occurs_at: ev.occurs_at,
      description: ev.description ?? null,
      location: ev.location ?? null,
      category: ev.category ?? null,
      primary_image_url: ev.primary_image_url ?? null,
      images,
      video_url: ev.video_url ?? null,
      show_on_home: ev.show_on_home ?? false,
      rsvp_counts: Object.fromEntries(counts.map((r) => [r.status, r.n])),
      my_rsvp: mine?.status ?? null,
      attendees: faces,
    };
  }

  // ---------------- Homepage feature toggle (single featured event) ----------------

  /** Feature one event series on the mobile homepage. Exactly one may be featured
   *  PER CONGREGATION (§8 — featuring here must never un-feature another
   *  congregation's pick; partial unique index on congregation_id). Admin+ only. */
  async setSeriesFeatured(principal: Principal, seriesId: string, featured: boolean): Promise<{ is_featured: boolean }> {
    if (principal.role !== "Admin" && principal.role !== "SuperAdmin") {
      throw new ApiError("FORBIDDEN_SCOPE", "Only admins can feature events on the homepage");
    }
    return tx(this.pool, async (c) => {
      const s = await maybeOne<{ congregation_id: string }>(c, `SELECT congregation_id FROM event_series WHERE series_id = $1 AND deleted_at IS NULL`, [seriesId]);
      if (!s) throw new ApiError("NOT_FOUND", "Series not found");
      if (s.congregation_id !== principal.congregationId && principal.role !== "SuperAdmin") {
        throw new ApiError("FORBIDDEN_SCOPE", "Series outside your congregation");
      }
      if (featured) {
        await c.query(`UPDATE event_series SET is_featured = false WHERE is_featured = true AND congregation_id = $1`, [s.congregation_id]);
      }
      await c.query(`UPDATE event_series SET is_featured = $2 WHERE series_id = $1`, [seriesId, featured]);
      await audit(c, principal.userId, "calendar.series_featured", "event_series", seriesId, { featured });
      return { is_featured: featured };
    });
  }

  /** The single homepage-featured event for the mobile Home screen (or null). */
  async featuredEvent(congregationId: string): Promise<unknown | null> {
    return (
      (await maybeOne(
        this.pool,
        `SELECT series_id, title, description, location, category, primary_image_url, gallery_image_urls, dtstart_local
           FROM event_series
          WHERE is_featured = true AND deleted_at IS NULL AND congregation_id = $1
          LIMIT 1`,
        [congregationId],
      )) ?? null
    );
  }

  // ---------------- Home "Upcoming events" list (up to 5, portal-curated) ----------------

  /** Show / hide a series on the member Home "Upcoming" list. Unlike
   *  `is_featured` (single homepage hero), any number of series may be flagged
   *  at once — GET /home/events caps the response at 5 soonest occurrences
   *  regardless of how many are flagged. Admin+ only, mirroring the featured
   *  toggle's RBAC. */
  async setSeriesShowOnHome(principal: Principal, seriesId: string, show: boolean): Promise<{ show_on_home: boolean }> {
    if (principal.role !== "Admin" && principal.role !== "SuperAdmin") {
      throw new ApiError("FORBIDDEN_SCOPE", "Only admins can curate the Home events list");
    }
    return tx(this.pool, async (c) => {
      const s = await maybeOne<{ congregation_id: string }>(c, `SELECT congregation_id FROM event_series WHERE series_id = $1 AND deleted_at IS NULL`, [seriesId]);
      if (!s) throw new ApiError("NOT_FOUND", "Series not found");
      if (s.congregation_id !== principal.congregationId && principal.role !== "SuperAdmin") {
        throw new ApiError("FORBIDDEN_SCOPE", "Series outside your congregation");
      }
      await c.query(`UPDATE event_series SET show_on_home = $2 WHERE series_id = $1`, [seriesId, show]);
      await audit(c, principal.userId, "calendar.series_show_on_home", "event_series", seriesId, { show_on_home: show });
      return { show_on_home: show };
    });
  }

  /** Up to 5 soonest upcoming occurrences from series curated for the member
   *  Home screen (`show_on_home`), soonest first. Reads the materialized
   *  `events` rows (same source as RSVPs/attendance) so `my_rsvp` is a cheap
   *  join, not a re-projection. The server — never the client — caps this at 5. */
  async homeEvents(userId: string, congregationId: string): Promise<unknown[]> {
    // §2: ensure-materialize this reader's own window first (cheap DO NOTHING
    // upserts over the few curated series) — Home no longer depends on a
    // create-time horizon or on the nightly sweep having run.
    const flagged = await many<{ series_id: string }>(
      this.pool,
      `SELECT series_id FROM event_series
        WHERE show_on_home = true AND deleted_at IS NULL AND status = 'active' AND is_paused = FALSE
          AND congregation_id = $1`,
      [congregationId],
    );
    // Forward-only window on this hot path: Home renders `occurs_at >= now()`, so
    // backfilling past occurrences here would be pure work for rows it never shows.
    for (const f of flagged) await this.materialize(f.series_id, new Date());
    return many(
      this.pool,
      `SELECT e.event_id AS occurrence_id, e.series_id, e.title, s.location AS venue, e.occurs_at AS starts_at,
              s.primary_image_url,
              (SELECT r.status::text FROM event_rsvps r WHERE r.event_id = e.event_id AND r.user_id = $2) AS my_rsvp
         FROM events e
         JOIN event_series s ON s.series_id = e.series_id
        WHERE s.show_on_home = true AND s.deleted_at IS NULL AND e.congregation_id = $1
          AND e.occurs_at >= now() AND e.archived_at IS NULL
        ORDER BY e.occurs_at ASC
        LIMIT 5`,
      [congregationId, userId],
    );
  }

  // ---------------- Event Moments (community photo gallery) ----------------

  /** Recent community moments for a congregation (the mobile Events "Moments"
   *  carousel + the portal gallery). Newest first, soft-deletes excluded. */
  async listMoments(congregationId: string): Promise<unknown[]> {
    return many(
      this.pool,
      `SELECT moment_id, image_url, caption, tag, created_at
         FROM event_moments
        WHERE congregation_id = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 30`,
      [congregationId],
    );
  }

  /** Post a moment (image + caption + optional tag). Leader+ (Instructor+), scoped
   *  to the principal's congregation. */
  async createMoment(principal: Principal, input: { image_url: string; caption?: string | null | undefined; tag?: string | null | undefined }): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const row = await one<{ moment_id: string; image_url: string; caption: string | null; tag: string | null; created_at: string }>(
        c,
        `INSERT INTO event_moments (congregation_id, image_url, caption, tag, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING moment_id, image_url, caption, tag, created_at`,
        [principal.congregationId, input.image_url, input.caption ?? null, input.tag ?? null, principal.userId],
      );
      await audit(c, principal.userId, "events.moment_created", "event_moments", row.moment_id, { tag: input.tag ?? null });
      return row;
    });
  }

  /** Soft-delete a moment. Leader+; an Instructor may only delete moments in their
   *  own congregation (SuperAdmin is unrestricted). */
  async deleteMoment(principal: Principal, momentId: string): Promise<{ deleted: boolean }> {
    return tx(this.pool, async (c) => {
      const m = await maybeOne<{ congregation_id: string }>(
        c,
        `SELECT congregation_id FROM event_moments WHERE moment_id = $1 AND deleted_at IS NULL`,
        [momentId],
      );
      if (!m) throw new ApiError("NOT_FOUND", "Moment not found");
      if (m.congregation_id !== principal.congregationId && principal.role !== "SuperAdmin") {
        throw new ApiError("FORBIDDEN_SCOPE", "Moment outside your congregation");
      }
      await c.query(`UPDATE event_moments SET deleted_at = now() WHERE moment_id = $1`, [momentId]);
      await audit(c, principal.userId, "events.moment_deleted", "event_moments", momentId, {});
      return { deleted: true };
    });
  }

  // ---------------- Leader: RSVP roster (Events page) ----------------

  /**
   * The RSVP roster for one materialized occurrence (Events page). Resolves the
   * occurrence exactly like the attendance roster — by its materialized
   * `event_id` (= occurrenceId(series_id, start)) — then scope-checks the
   * occurrence's cell (Admin+ pass; an Instructor must lead that cell, else
   * 403 FORBIDDEN_SCOPE) before returning RSVPs.
   *
   * Returns each rsvp row {user_id, full_name, response, cell_name, responded_at}
   * grouped under its response bucket, plus a count per response. A "no_response"
   * bucket lists cell members (for a cell-scoped occurrence) who have no rsvp row
   * — cheap to derive from the occurrence's own cell. For congregation-wide
   * occurrences (no cell) no_response is left empty (deriving it would mean
   * scanning the whole congregation), and `no_response_scope` flags that.
   */
  async rsvpRoster(principal: Principal, eventId: string): Promise<Record<string, unknown>> {
    await this.ensureOccurrence(this.pool, eventId); // §2: roster readers ensure-materialize
    const ev = await maybeOne<{ cell_group_id: string | null }>(
      this.pool,
      `SELECT cell_group_id FROM events WHERE event_id = $1`,
      [eventId],
    );
    if (!ev) throw new ApiError("NOT_FOUND", "Event not found");
    await assertCellInScope(this.pool, principal, ev.cell_group_id ?? "");

    const rsvps = await many<{
      user_id: string;
      full_name: string;
      response: string;
      cell_name: string | null;
      responded_at: string;
    }>(
      this.pool,
      `SELECT r.user_id, u.full_name, r.status::text AS response,
              cg.name AS cell_name, r.updated_at AS responded_at
         FROM event_rsvps r
         JOIN users u ON u.user_id = r.user_id
         LEFT JOIN cell_groups cg ON cg.cell_group_id = u.cell_group_id
        WHERE r.event_id = $1
        ORDER BY u.full_name`,
      [eventId],
    );

    const buckets: Record<string, typeof rsvps> = { going: [], maybe: [], declined: [], no_response: [] };
    for (const r of rsvps) (buckets[r.response] ??= []).push(r);

    // no_response: cell members (for a cell-scoped occurrence) with no rsvp row.
    // Cheap — scoped to the occurrence's own cell. Skipped for congregation-wide.
    if (ev.cell_group_id) {
      const noResponse = await many<{ user_id: string; full_name: string; cell_name: string | null }>(
        this.pool,
        `SELECT u.user_id, u.full_name, cg.name AS cell_name
           FROM users u
           LEFT JOIN cell_groups cg ON cg.cell_group_id = u.cell_group_id
          WHERE u.cell_group_id = $1 AND u.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM event_rsvps r WHERE r.event_id = $2 AND r.user_id = u.user_id)
          ORDER BY u.full_name`,
        [ev.cell_group_id, eventId],
      );
      buckets.no_response = noResponse.map((m) => ({ ...m, response: "no_response", responded_at: "" }));
    }

    return {
      event_id: eventId,
      buckets,
      counts: {
        going: buckets.going!.length,
        maybe: buckets.maybe!.length,
        declined: buckets.declined!.length,
        no_response: buckets.no_response!.length,
      },
      no_response_scope: ev.cell_group_id ? "cell" : "none",
    };
  }

  // ---------------- Leader: series pause / resume (Events page) ----------------

  /** Pause a series so it stops projecting/materializing future occurrences (audited). */
  async pauseSeries(principal: Principal, seriesId: string): Promise<unknown> {
    return this.setPaused(principal, seriesId, true);
  }

  /** Resume a paused series, restoring normal projection (audited). */
  async resumeSeries(principal: Principal, seriesId: string): Promise<unknown> {
    return this.setPaused(principal, seriesId, false);
  }

  private async setPaused(principal: Principal, seriesId: string, paused: boolean): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const s = await maybeOne<{ congregation_id: string }>(
        c,
        `SELECT congregation_id FROM event_series WHERE series_id = $1 AND deleted_at IS NULL`,
        [seriesId],
      );
      if (!s) throw new ApiError("NOT_FOUND", "Series not found");
      if (s.congregation_id !== principal.congregationId && principal.role !== "SuperAdmin") {
        throw new ApiError("FORBIDDEN_SCOPE", "Series outside your congregation");
      }
      await c.query(`UPDATE event_series SET is_paused = $2 WHERE series_id = $1`, [seriesId, paused]);
      await audit(c, principal.userId, paused ? "calendar.series_paused" : "calendar.series_resumed", "event_series", seriesId, {});
      return one(c, `SELECT * FROM event_series WHERE series_id = $1`, [seriesId]);
    });
  }

  // ---------------- Admin series API (EVENTS_ARCHITECTURE §3) ----------------
  // The portal stops deriving series management from visible occurrences: these
  // endpoints are the console's source of truth, with real windowed next_at.

  private static readonly ADMIN_SERIES_COLS = `
    s.series_id, s.congregation_id, s.cell_group_id, cg.name AS cell_name,
    s.title, s.description, s.location, s.category,
    s.timezone, to_char(s.dtstart_local, 'YYYY-MM-DD"T"HH24:MI:SS') AS dtstart_local,
    s.duration_min, s.rrule, s.visibility, s.status, s.is_paused, s.is_featured, s.show_on_home,
    s.primary_image_url, s.gallery_image_urls, s.video_url,
    s.rsvp_enabled, s.qr_enabled, s.manual_checkin_enabled, s.reminders_enabled, s.checkin_opens_min_before,
    s.automation, s.split_from, s.created_by, s.created_at,
    (SELECT count(*)::int FROM events e WHERE e.series_id = s.series_id) AS occurrence_count,
    (SELECT count(*)::int FROM event_rsvps r JOIN events e ON e.event_id = r.event_id WHERE e.series_id = s.series_id) AS rsvp_count,
    (SELECT count(*)::int FROM attendance_logs a JOIN events e ON e.event_id = a.event_id WHERE e.series_id = s.series_id) AS attendance_count,
    (SELECT count(*)::int FROM event_series_follows f WHERE f.series_id = s.series_id) AS follow_count`;

  /** First upcoming non-cancelled occurrence of a series (windowed — never from DTSTART). */
  private nextOccurrenceOf(
    s: SeriesRow,
    exceptions: Map<number, ExceptionRow>,
    now: Date,
    horizonDays = 400,
  ): { start_at: string; end_at: string; occurrence_id: string } | null {
    const horizon = new Date(now.getTime() + horizonDays * 86_400_000);
    for (const o of expandOccurrences(s, now, horizon, this.maxInstances)) {
      const ms = new Date(o.start_at).getTime();
      const ex = exceptions.get(ms);
      if (ex?.is_cancelled) continue;
      const start = ex?.new_start_at ?? o.start_at;
      if (new Date(start) < now) continue;
      return { start_at: start, end_at: ex?.new_end_at ?? o.end_at, occurrence_id: occurrenceId(s.series_id, o.start_at) };
    }
    return null;
  }

  static readonly AdminSeriesList = z.object({
    status: z.enum(["all", "active", "draft", "paused"]).default("all"),
    q: z.string().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  });

  /** §3: the series list the Events console manages from — real windowed
   *  next_at (the maxInstances-from-DTSTART bug is gone), cadence, counts. */
  async adminListSeries(principal: Principal, q: z.infer<typeof CalendarService.AdminSeriesList>): Promise<{ data: unknown[] }> {
    const rows = await many<SeriesRow & Record<string, unknown>>(
      this.pool,
      `SELECT ${CalendarService.ADMIN_SERIES_COLS}
         FROM event_series s LEFT JOIN cell_groups cg ON cg.cell_group_id = s.cell_group_id
        WHERE s.deleted_at IS NULL AND s.congregation_id = $1
          AND ($2 = 'all'
               OR ($2 = 'draft'  AND s.status = 'draft')
               OR ($2 = 'paused' AND s.is_paused)
               OR ($2 = 'active' AND s.status = 'active' AND NOT s.is_paused))
          AND ($3::text IS NULL OR s.title ILIKE '%' || $3 || '%' OR s.location ILIKE '%' || $3 || '%' OR s.category ILIKE '%' || $3 || '%')
        ORDER BY s.created_at DESC
        LIMIT $4`,
      [principal.congregationId, q.status, q.q ?? null, q.limit],
    );
    const exBySeries = await this.exceptionsBySeries(rows.map((r) => r.series_id));
    const now = new Date();
    const data = rows.map((s) => {
      const next = this.nextOccurrenceOf(s, exBySeries.get(s.series_id) ?? new Map(), now);
      return {
        ...s,
        cadence: this.cadenceLabel(s),
        next_at: next?.start_at ?? null,
        next_occurrence_id: next?.occurrence_id ?? null,
      };
    });
    return { data };
  }

  /** §3: full command-center detail for one series. */
  async adminSeriesDetail(principal: Principal, seriesId: string): Promise<unknown> {
    const s = await maybeOne<SeriesRow & Record<string, unknown>>(
      this.pool,
      `SELECT ${CalendarService.ADMIN_SERIES_COLS}
         FROM event_series s LEFT JOIN cell_groups cg ON cg.cell_group_id = s.cell_group_id
        WHERE s.series_id = $1 AND s.deleted_at IS NULL`,
      [seriesId],
    );
    if (!s) throw new ApiError("NOT_FOUND", "Series not found");
    if (s.congregation_id !== principal.congregationId && principal.role !== "SuperAdmin") {
      throw new ApiError("FORBIDDEN_SCOPE", "Series outside your congregation");
    }
    const exceptions = await many(
      this.pool,
      `SELECT exception_id, original_start_at, is_cancelled, new_start_at, new_end_at, note
         FROM event_exceptions WHERE series_id = $1 ORDER BY original_start_at`,
      [seriesId],
    );
    const exMap = (await this.exceptionsBySeries([seriesId])).get(seriesId) ?? new Map<number, ExceptionRow>();
    const now = new Date();
    const next = this.nextOccurrenceOf(s, exMap, now);

    // Upcoming projection (≤10 within 90d) joined to whatever is materialized
    // for real RSVP/check-in counts.
    const horizon = new Date(now.getTime() + RECONCILE_WINDOW_DAYS * 86_400_000);
    const upcomingProjected = this.expectedOccurrences(s, exMap, now, horizon);
    const upcomingList = [...upcomingProjected.values()].sort((a, b) => a.actual.localeCompare(b.actual)).slice(0, 10);
    const counts = await many<{ occurrence_start: string; going: number; checked_in: number }>(
      this.pool,
      `SELECT e.occurrence_start,
              (SELECT count(*)::int FROM event_rsvps r WHERE r.event_id = e.event_id AND r.status = 'going') AS going,
              (SELECT count(*)::int FROM attendance_logs a WHERE a.event_id = e.event_id) AS checked_in
         FROM events e WHERE e.series_id = $1`,
      [seriesId],
    );
    const countsByStart = new Map(counts.map((c) => [new Date(c.occurrence_start).getTime(), c]));
    const upcoming = upcomingList.map((o) => {
      const c = countsByStart.get(new Date(o.original).getTime());
      return {
        occurrence_id: occurrenceId(seriesId, o.original),
        start_at: o.actual,
        original_start_at: o.original,
        rescheduled: o.actual !== o.original,
        going: c?.going ?? 0,
        checked_in: c?.checked_in ?? 0,
      };
    });

    const recent = await many(
      this.pool,
      `SELECT e.event_id AS occurrence_id, e.occurs_at, e.archived_at,
              (SELECT count(*)::int FROM event_rsvps r WHERE r.event_id = e.event_id AND r.status = 'going') AS going,
              (SELECT count(*)::int FROM attendance_logs a WHERE a.event_id = e.event_id) AS checked_in,
              (SELECT count(*)::int FROM event_guests g WHERE g.event_id = e.event_id) AS guests
         FROM events e
        WHERE e.series_id = $1 AND e.occurs_at < now()
        ORDER BY e.occurs_at DESC LIMIT 5`,
      [seriesId],
    );

    // Linked announcements — all three modes (§5): series-attached plus any
    // attached to one of this series' occurrences.
    const announcements = await many(
      this.pool,
      `SELECT announcement_id, title, status, sent_at, scheduled_at, archived_at,
              CASE WHEN series_id = $1 THEN 'series' ELSE 'event' END AS attachment
         FROM announcements
        WHERE deleted_at IS NULL AND (series_id = $1 OR event_occurrence_id LIKE $1 || ':%')
        ORDER BY created_at DESC LIMIT 50`,
      [seriesId],
    );

    return {
      ...s,
      cadence: this.cadenceLabel(s),
      next_at: next?.start_at ?? null,
      next_occurrence_id: next?.occurrence_id ?? null,
      upcoming,
      recent,
      exceptions,
      announcements,
    };
  }

  /** §3: the audit-log slice for a series, its occurrences, and its linked
   *  announcements. Everything is already audited — this is a filtered read. */
  async adminSeriesTimeline(principal: Principal, seriesId: string): Promise<{ data: unknown[] }> {
    const s = await maybeOne<{ congregation_id: string }>(
      this.pool,
      `SELECT congregation_id FROM event_series WHERE series_id = $1`,
      [seriesId],
    );
    if (!s) throw new ApiError("NOT_FOUND", "Series not found");
    if (s.congregation_id !== principal.congregationId && principal.role !== "SuperAdmin") {
      throw new ApiError("FORBIDDEN_SCOPE", "Series outside your congregation");
    }
    const data = await many(
      this.pool,
      `SELECT a.audit_id, a.actor_id, u.full_name AS actor_name, a.action, a.entity, a.entity_id, a.metadata, a.occurred_at
         FROM audit_log a LEFT JOIN users u ON u.user_id = a.actor_id
        WHERE (a.entity = 'event_series' AND a.entity_id = $1)
           OR (a.entity = 'events' AND a.entity_id LIKE $1 || ':%')
           OR (a.entity = 'announcements' AND a.entity_id IN (
                 SELECT announcement_id::text FROM announcements
                  WHERE series_id = $1::uuid OR event_occurrence_id LIKE $1 || ':%'))
        ORDER BY a.occurred_at DESC
        LIMIT 200`,
      [seriesId],
    );
    return { data };
  }

  static readonly AdminSearch = z.object({
    q: z.string().min(1).max(120),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  });

  /** §3: archive-wide search — series + upcoming occurrences + announcements,
   *  matched on title/location/category (ILIKE; trigram-indexed). */
  async adminSearch(principal: Principal, q: z.infer<typeof CalendarService.AdminSearch>): Promise<unknown> {
    const term = `%${q.q}%`;
    const series = await many(
      this.pool,
      `SELECT series_id, title, location, category, status, is_paused,
              to_char(dtstart_local, 'YYYY-MM-DD"T"HH24:MI:SS') AS dtstart_local, rrule
         FROM event_series
        WHERE deleted_at IS NULL AND congregation_id = $1
          AND (title ILIKE $2 OR location ILIKE $2 OR category ILIKE $2)
        ORDER BY created_at DESC LIMIT $3`,
      [principal.congregationId, term, q.limit],
    );
    const occurrences = await many(
      this.pool,
      `SELECT e.event_id AS occurrence_id, e.series_id, e.title, e.occurs_at
         FROM events e
        WHERE e.congregation_id = $1 AND e.occurs_at >= now() AND e.archived_at IS NULL
          AND e.title ILIKE $2
        ORDER BY e.occurs_at ASC LIMIT $3`,
      [principal.congregationId, term, q.limit],
    );
    const announcements = await many(
      this.pool,
      `SELECT announcement_id, title, status, sent_at, archived_at
         FROM announcements
        WHERE deleted_at IS NULL AND (congregation_id = $1 OR congregation_id IS NULL)
          AND title ILIKE $2
        ORDER BY created_at DESC LIMIT $3`,
      [principal.congregationId, term, q.limit],
    );
    return { series, occurrences, announcements };
  }

  // ---------------- Series split — "this and following" (§2) ----------------

  static readonly Split = z
    .object({
      pivot_start_at: z.string().min(1),
      changes: CalendarService.UpdateSeries.optional(),
    })
    .strict();

  /**
   * Google-style "this and following": the old series is bounded to
   * UNTIL = pivot − 1s and a new linked series (split_from) starts at the pivot
   * carrying the changes. Exceptions at/after the pivot move to the new series;
   * RSVPs on matching instants migrate; orphaned old rows are reconciled away.
   */
  async splitSeries(principal: Principal, seriesId: string, input: z.infer<typeof CalendarService.Split>): Promise<unknown> {
    const changes = input.changes ?? {};
    if (changes.rrule) validateRrule(changes.rrule);
    const pivotMs = Date.parse(input.pivot_start_at);
    if (Number.isNaN(pivotMs)) throw new ApiError("VALIDATION_FAILED", "Invalid pivot_start_at");
    const pivotIso = new Date(pivotMs).toISOString();

    const result = await tx(this.pool, async (c) => {
      const s = await maybeOne<SeriesRow & { gallery_image_urls: string[]; automation: Record<string, unknown> }>(
        c,
        `SELECT *, to_char(dtstart_local, 'YYYY-MM-DD"T"HH24:MI:SS') AS dtstart_local
           FROM event_series WHERE series_id = $1 AND deleted_at IS NULL`,
        [seriesId],
      );
      if (!s) throw new ApiError("NOT_FOUND", "Series not found");
      if (s.congregation_id !== principal.congregationId && principal.role !== "SuperAdmin") {
        throw new ApiError("FORBIDDEN_SCOPE", "Series outside your congregation");
      }
      if (!s.rrule) throw new ApiError("UNPROCESSABLE", "Only recurring series can be split");

      // Bound the old rule at pivot − 1s, expressed in the series' wall-clock
      // (our RRULE model treats DTSTART/UNTIL as floating local time). A COUNT
      // bound is replaced by the UNTIL — the pivot now defines where it ends.
      const pivotWall = DateTime.fromMillis(pivotMs, { zone: s.timezone });
      const untilStr = pivotWall.minus({ seconds: 1 }).toFormat("yyyyLLdd'T'HHmmss'Z'");
      const baseRule = s.rrule
        .split(";")
        .map((p) => p.trim())
        .filter((p) => p && !/^(UNTIL|COUNT)=/i.test(p))
        .join(";");
      const boundedOld = `${baseRule};UNTIL=${untilStr}`;
      // The new series keeps the original bound (minus any COUNT — partially
      // consumed counts don't transfer meaningfully) unless changes override it.
      const inheritedRule = s.rrule
        .split(";")
        .map((p) => p.trim())
        .filter((p) => p && !/^COUNT=/i.test(p))
        .join(";");
      const newRule = changes.rrule !== undefined ? (changes.rrule ?? null) : inheritedRule || null;
      const newDtstart = changes.dtstart_local ?? pivotWall.toFormat("yyyy-LL-dd'T'HH:mm:ss");

      await c.query(`UPDATE event_series SET rrule = $2 WHERE series_id = $1`, [seriesId, boundedOld]);

      const created = await one<{ series_id: string }>(
        c,
        `INSERT INTO event_series
           (congregation_id, cell_group_id, title, description, location, category, timezone, dtstart_local, duration_min, rrule, visibility, created_by,
            rsvp_enabled, qr_enabled, manual_checkin_enabled, reminders_enabled, checkin_opens_min_before, status,
            primary_image_url, gallery_image_urls, video_url, automation, show_on_home, split_from)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
         RETURNING series_id`,
        [
          s.congregation_id,
          changes.cell_group_id !== undefined ? changes.cell_group_id : s.cell_group_id,
          changes.title ?? s.title,
          changes.description !== undefined ? changes.description : s.description,
          changes.location !== undefined ? changes.location : s.location,
          changes.category !== undefined ? changes.category : (s.category ?? null),
          changes.timezone ?? s.timezone,
          newDtstart,
          changes.duration_min ?? s.duration_min,
          newRule,
          changes.visibility ?? s.visibility,
          principal.userId,
          changes.rsvp_enabled ?? s.rsvp_enabled ?? true,
          changes.qr_enabled ?? s.qr_enabled ?? true,
          changes.manual_checkin_enabled ?? s.manual_checkin_enabled ?? true,
          changes.reminders_enabled ?? s.reminders_enabled ?? true,
          changes.checkin_opens_min_before !== undefined ? changes.checkin_opens_min_before : (s.checkin_opens_min_before ?? null),
          changes.status ?? s.status ?? "active",
          changes.primary_image_url !== undefined ? changes.primary_image_url : (s.primary_image_url ?? null),
          changes.gallery_image_urls ?? s.gallery_image_urls ?? [],
          changes.video_url !== undefined ? changes.video_url : (s.video_url ?? null),
          JSON.stringify(changes.automation ?? s.automation ?? {}),
          s.show_on_home ?? false,
          seriesId,
        ],
      );

      // Exceptions at/after the pivot belong to the new series now.
      await c.query(
        `UPDATE event_exceptions SET series_id = $2 WHERE series_id = $1 AND original_start_at >= $3`,
        [seriesId, created.series_id, pivotIso],
      );

      await audit(c, principal.userId, "calendar.series_split", "event_series", seriesId, {
        pivot_start_at: pivotIso,
        new_series_id: created.series_id,
      });
      return created.series_id;
    });

    // Materialize the new tail, migrate RSVPs on matching instants, then
    // reconcile the old series (prunes rows past the pivot; anyone whose
    // instant has no match in the new series gets the cancellation notice).
    await this.materialize(result);
    await this.pool.query(
      `UPDATE event_rsvps r SET event_id = n.event_id
         FROM events o, events n
        WHERE r.event_id = o.event_id
          AND o.series_id = $1 AND o.occurrence_start >= $3
          AND n.series_id = $2 AND n.occurrence_start = o.occurrence_start
          AND NOT EXISTS (SELECT 1 FROM event_rsvps r2 WHERE r2.event_id = n.event_id AND r2.user_id = r.user_id)`,
      [seriesId, result, pivotIso],
    );
    await this.reconcileSeries(seriesId);
    const [oldRow, newRow] = await Promise.all([
      one(this.pool, `SELECT * FROM event_series WHERE series_id = $1`, [seriesId]),
      one(this.pool, `SELECT * FROM event_series WHERE series_id = $1`, [result]),
    ]);
    return { series: oldRow, new_series: newRow };
  }

  // ---------------- NLP quick-add (chrono-node) ----------------

  parse(text: string, timezone: string): { title: string; start_at: string | null; end_at: string | null; confidence: number } {
    const ref = DateTime.now().setZone(DateTime.now().setZone(timezone).isValid ? timezone : "UTC").toJSDate();
    const results = chrono.parse(text, ref, { forwardDate: true });
    const first = results[0];
    if (!first) return { title: text.trim(), start_at: null, end_at: null, confidence: 0 };
    const start = first.start?.date() ?? null;
    const end = first.end?.date() ?? null;
    const title = text.replace(first.text, "").replace(/\s{2,}/g, " ").trim() || text.trim();
    // Coarse confidence: more parsed components → higher.
    const known = first.start ? Object.keys((first.start as unknown as { knownValues: object }).knownValues ?? {}).length : 0;
    return {
      title,
      start_at: start ? start.toISOString() : null,
      end_at: end ? end.toISOString() : null,
      confidence: Math.min(1, known / 4),
    };
  }
}

/** Deterministic, stable occurrence/event id so attendance + RSVP key cleanly.
 *  (series_id 36 + ':' + ISO 24 = 61 chars ≤ events.event_id VARCHAR(100).) */
export function occurrenceId(seriesId: string, startIso: string): string {
  return `${seriesId}:${new Date(startIso).toISOString()}`;
}

export { randomUUID };
export type { Occurrence };
