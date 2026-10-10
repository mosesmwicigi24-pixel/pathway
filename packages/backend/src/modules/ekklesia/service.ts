// Ekklesia — the congregation's intercessory watch. The church ran it as a
// WhatsApp group ("Ekklesia Intercessory · Pray for the Body of Christ"): a
// request is posted, the intercessors pray it, someone writes back when God
// moves. This module gives that life a home in the Prayer Room, with the
// three things a chat could never keep straight — who is actually standing
// (membership), who prayed today (intercessions, one row per day), and what
// became of the need (updates, answered).
//
// Rules the server keeps (§1.1, §5.4): scope is the congregation; anyone in
// it may bring a request; only an intercessor (a joined member) reads the
// body or intercedes; leaders (appointed, or the church's Instructors and
// Admins) pin, close and tidy. Every write is idempotent (§3.6).
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, recordActivityEvent, tx, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import type { NotificationService } from "../notifications/service.js";

/** The church's day, not the server's (same clock as the rhythm). */
const TODAY = "(now() AT TIME ZONE 'Africa/Nairobi')::date";
const LEADER_ROLES = ["Instructor", "Admin", "SuperAdmin"];

type Membership = { role: "intercessor" | "leader"; status: "active" | "left"; joined_at: string };

export interface EkklesiaRequestRow {
  request_id: string;
  author_user_id: string;
  author_name: string;
  author_avatar: string | null;
  title: string;
  body: string;
  for_whom: string | null;
  urgency: "normal" | "urgent";
  is_answered: boolean;
  answered_at: string | null;
  answered_note: string | null;
  is_pinned: boolean;
  created_at: string;
  mine: boolean;
  intercessor_count: number;
  prayer_count: number;
  i_prayed_today: boolean;
  my_prayer_days: number;
  update_count: number;
  last_update_at: string | null;
}

const REQUEST_SELECT = `
  SELECT r.request_id, r.author_user_id, u.full_name AS author_name, u.avatar_url AS author_avatar,
         r.title, r.body, r.for_whom, r.urgency, r.is_answered, r.answered_at, r.answered_note,
         r.is_pinned, r.created_at,
         (r.author_user_id = $1) AS mine,
         (SELECT count(DISTINCT i.user_id)::int FROM ekklesia_intercessions i WHERE i.request_id = r.request_id) AS intercessor_count,
         (SELECT count(*)::int FROM ekklesia_intercessions i WHERE i.request_id = r.request_id) AS prayer_count,
         COALESCE((SELECT bool_or(i.user_id = $1 AND i.prayed_on = ${TODAY})
                     FROM ekklesia_intercessions i WHERE i.request_id = r.request_id), false) AS i_prayed_today,
         (SELECT count(*)::int FROM ekklesia_intercessions i WHERE i.request_id = r.request_id AND i.user_id = $1) AS my_prayer_days,
         (SELECT count(*)::int FROM ekklesia_updates x WHERE x.request_id = r.request_id) AS update_count,
         (SELECT max(x.created_at) FROM ekklesia_updates x WHERE x.request_id = r.request_id) AS last_update_at
    FROM ekklesia_requests r
    JOIN users u ON u.user_id = r.author_user_id`;

export class EkklesiaService {
  constructor(
    private readonly pool: Pool,
    private readonly notifications: NotificationService,
  ) {}

  static readonly Request = z.object({
    request_id: z.string().uuid(),
    title: z.string().min(1).max(160),
    body: z.string().min(1).max(4000),
    for_whom: z.string().max(120).nullable().optional(),
    urgency: z.enum(["normal", "urgent"]).default("normal"),
    client_mutation_id: z.string().uuid().optional(),
  });
  static readonly Update = z.object({
    update_id: z.string().uuid(),
    body: z.string().min(1).max(2000),
    kind: z.enum(["update", "testimony"]).default("update"),
    client_mutation_id: z.string().uuid().optional(),
  });
  static readonly Answered = z.object({ answered: z.boolean(), note: z.string().max(1000).nullable().optional() });
  static readonly Pinned = z.object({ pinned: z.boolean() });
  static readonly MemberRole = z.object({ role: z.enum(["intercessor", "leader"]) });

  // ── scope helpers ───────────────────────────────────────────────────────

  private async congregationOf(c: Queryable, userId: string): Promise<string> {
    const u = await maybeOne<{ congregation_id: string | null }>(c, `SELECT congregation_id FROM users WHERE user_id = $1`, [userId]);
    if (!u?.congregation_id) throw new ApiError("FORBIDDEN_SCOPE", "You are not in a congregation yet");
    return u.congregation_id;
  }

  private async ensureGroup(c: Queryable, cong: string): Promise<void> {
    await c.query(`INSERT INTO ekklesia_groups (congregation_id) VALUES ($1) ON CONFLICT DO NOTHING`, [cong]);
  }

  private async membership(c: Queryable, userId: string, cong: string): Promise<Membership | null> {
    const m = await maybeOne<Membership>(
      c,
      `SELECT role, status, joined_at FROM ekklesia_members WHERE congregation_id = $1 AND user_id = $2`,
      [cong, userId],
    );
    return m && m.status === "active" ? m : null;
  }

  /** Leaders: an appointed Ekklesia leader, or the church's own leadership. */
  private async isLeader(c: Queryable, userId: string, cong: string): Promise<boolean> {
    const row = await one<{ leader: boolean }>(
      c,
      `SELECT (EXISTS (SELECT 1 FROM ekklesia_members m WHERE m.congregation_id = $1 AND m.user_id = $2 AND m.status = 'active' AND m.role = 'leader')
               OR EXISTS (SELECT 1 FROM users u WHERE u.user_id = $2 AND u.role::text = ANY($3::text[]))) AS leader`,
      [cong, userId, LEADER_ROLES],
    );
    return row.leader;
  }

  /** The request must be on my congregation's watch (visibility, §5.4). */
  private async access(c: Queryable, userId: string, requestId: string): Promise<{ cong: string; author_user_id: string }> {
    const cong = await this.congregationOf(c, userId);
    const r = await maybeOne<{ author_user_id: string }>(
      c,
      `SELECT author_user_id FROM ekklesia_requests WHERE request_id = $1 AND congregation_id = $2 AND NOT is_hidden`,
      [requestId, cong],
    );
    if (!r) throw new ApiError("NOT_FOUND", "Request not found");
    return { cong, author_user_id: r.author_user_id };
  }

  private async groupBlock(c: Queryable, userId: string, cong: string): Promise<Record<string, unknown>> {
    await this.ensureGroup(c, cong);
    const g = await one<Record<string, unknown>>(
      c,
      `SELECT g.name, g.mission,
              (SELECT count(*)::int FROM ekklesia_members m WHERE m.congregation_id = g.congregation_id AND m.status = 'active') AS member_count,
              (SELECT count(*)::int FROM ekklesia_requests r WHERE r.congregation_id = g.congregation_id AND NOT r.is_hidden AND NOT r.is_answered) AS active_count,
              (SELECT count(*)::int FROM ekklesia_requests r WHERE r.congregation_id = g.congregation_id AND NOT r.is_hidden AND NOT r.is_answered AND r.urgency = 'urgent') AS urgent_count,
              (SELECT count(*)::int FROM ekklesia_requests r WHERE r.congregation_id = g.congregation_id AND NOT r.is_hidden AND r.is_answered) AS answered_count,
              (SELECT count(*)::int FROM ekklesia_intercessions i JOIN ekklesia_requests r ON r.request_id = i.request_id
                WHERE r.congregation_id = g.congregation_id AND i.prayed_on = ${TODAY}) AS prayers_today,
              (SELECT count(*)::int FROM ekklesia_intercessions i WHERE i.user_id = $1 AND i.prayed_on = ${TODAY}) AS my_prayers_today,
              (SELECT count(*)::int FROM ekklesia_intercessions i WHERE i.user_id = $1) AS my_prayers_total,
              (SELECT count(DISTINCT i.prayed_on)::int FROM ekklesia_intercessions i WHERE i.user_id = $1) AS my_days,
              COALESCE((
                SELECT json_agg(json_build_object('user_id', f.user_id, 'name', f.full_name, 'avatar', f.avatar_url, 'role', f.role) ORDER BY f.lead DESC, f.joined_at)
                  FROM (SELECT m.user_id, u.full_name, u.avatar_url, m.role, (m.role = 'leader') AS lead, m.joined_at
                          FROM ekklesia_members m JOIN users u ON u.user_id = m.user_id
                         WHERE m.congregation_id = g.congregation_id AND m.status = 'active'
                         ORDER BY (m.role = 'leader') DESC, m.joined_at
                         LIMIT 8) f
              ), '[]'::json) AS faces
         FROM ekklesia_groups g WHERE g.congregation_id = $2`,
      [userId, cong],
    );
    const m = await this.membership(c, userId, cong);
    const needsMe = m
      ? (await one<{ n: number }>(
          c,
          `SELECT count(*)::int AS n FROM ekklesia_requests r
            WHERE r.congregation_id = $2 AND NOT r.is_hidden AND NOT r.is_answered
              AND NOT EXISTS (SELECT 1 FROM ekklesia_intercessions i
                               WHERE i.request_id = r.request_id AND i.user_id = $1 AND i.prayed_on = ${TODAY})`,
          [userId, cong],
        )).n
      : 0;
    return {
      ...g,
      is_member: m !== null,
      my_role: m?.role ?? null,
      joined_at: m?.joined_at ?? null,
      is_leader: await this.isLeader(c, userId, cong),
      needs_me_today: needsMe,
    };
  }

  // ── reads ───────────────────────────────────────────────────────────────

  /** The Ekklesia tab: the watch itself, and its requests (bodies for members only). */
  async overview(userId: string, status: "active" | "answered" = "active"): Promise<{ group: unknown; requests: EkklesiaRequestRow[]; preview: unknown[] }> {
    return tx(this.pool, async (c) => {
      const cong = await this.congregationOf(c, userId);
      const group = await this.groupBlock(c, userId, cong);
      const member = group.is_member === true;
      const rows = await many<EkklesiaRequestRow>(
        c,
        `${REQUEST_SELECT}
          WHERE r.congregation_id = $2 AND NOT r.is_hidden AND r.is_answered = $3
          ORDER BY r.is_pinned DESC, (r.urgency = 'urgent') DESC, r.created_at DESC
          LIMIT 100`,
        [userId, cong, status === "answered"],
      );
      if (member) return { group, requests: rows, preview: [] };
      // Not yet an intercessor: the watch is visible, the needs are not. A
      // glimpse of what waits is the invitation; the body stays with the watch.
      const preview = rows.slice(0, 3).map((r) => ({
        request_id: r.request_id, title: r.title, urgency: r.urgency,
        intercessor_count: r.intercessor_count, created_at: r.created_at,
      }));
      return { group, requests: [], preview };
    });
  }

  /** Home card + the invitations on other pages: small, cheap, honest. */
  async summary(userId: string): Promise<Record<string, unknown>> {
    return tx(this.pool, async (c) => {
      const cong = await this.congregationOf(c, userId);
      const g = await this.groupBlock(c, userId, cong);
      const latest = await many<{ request_id: string; title: string; for_whom: string | null; urgency: string; intercessor_count: number; created_at: string }>(
        c,
        `SELECT r.request_id, r.title, r.for_whom, r.urgency, r.created_at,
                (SELECT count(DISTINCT i.user_id)::int FROM ekklesia_intercessions i WHERE i.request_id = r.request_id) AS intercessor_count
           FROM ekklesia_requests r
          WHERE r.congregation_id = $1 AND NOT r.is_hidden AND NOT r.is_answered
          ORDER BY r.is_pinned DESC, (r.urgency = 'urgent') DESC, r.created_at DESC
          LIMIT 3`,
        [cong],
      );
      // for_whom names a person — only intercessors see it off the tab.
      const member = g.is_member === true;
      return {
        name: g.name, mission: g.mission,
        is_member: member, my_role: g.my_role, is_leader: g.is_leader,
        member_count: g.member_count, active_count: g.active_count, urgent_count: g.urgent_count,
        answered_count: g.answered_count, prayers_today: g.prayers_today,
        needs_me_today: g.needs_me_today, my_prayers_today: g.my_prayers_today, my_days: g.my_days,
        faces: g.faces,
        latest: latest.map((r) => (member ? r : { ...r, for_whom: null })),
      };
    });
  }

  /** One request, its updates, and the intercessors standing on it. Members only. */
  async getRequest(userId: string, requestId: string): Promise<{ request: EkklesiaRequestRow; updates: unknown[]; intercessors: unknown[] }> {
    return tx(this.pool, async (c) => {
      const { cong, author_user_id } = await this.access(c, userId, requestId);
      const m = await this.membership(c, userId, cong);
      if (!m && author_user_id !== userId && !(await this.isLeader(c, userId, cong))) {
        throw new ApiError("FORBIDDEN_SCOPE", "Join Ekklesia to read the watch's requests", { join: true });
      }
      const request = await one<EkklesiaRequestRow>(c, `${REQUEST_SELECT} WHERE r.request_id = $2`, [userId, requestId]);
      const updates = await many(
        c,
        `SELECT x.update_id, x.author_user_id, u.full_name AS author_name, u.avatar_url AS author_avatar,
                x.kind, x.body, x.created_at, (x.author_user_id = $1) AS mine
           FROM ekklesia_updates x JOIN users u ON u.user_id = x.author_user_id
          WHERE x.request_id = $2 ORDER BY x.created_at`,
        [userId, requestId],
      );
      const intercessors = await many(
        c,
        `SELECT i.user_id, u.full_name AS name, u.avatar_url AS avatar,
                count(*)::int AS days, max(i.prayed_on) AS last_prayed_on, (i.user_id = $1) AS me
           FROM ekklesia_intercessions i JOIN users u ON u.user_id = i.user_id
          WHERE i.request_id = $2
          GROUP BY i.user_id, u.full_name, u.avatar_url
          ORDER BY max(i.prayed_at) DESC
          LIMIT 24`,
        [userId, requestId],
      );
      return { request, updates, intercessors };
    });
  }

  // ── membership ──────────────────────────────────────────────────────────

  async join(userId: string): Promise<{ joined: boolean; member_count: number; first_time: boolean }> {
    return tx(this.pool, async (c) => {
      const cong = await this.congregationOf(c, userId);
      await this.ensureGroup(c, cong);
      // "first_time" counts the row, not the status: a member who left and
      // returns is welcomed back, not welcomed for the first time.
      const before = await maybeOne(c, `SELECT 1 FROM ekklesia_members WHERE congregation_id = $1 AND user_id = $2`, [cong, userId]);
      await c.query(
        `INSERT INTO ekklesia_members (congregation_id, user_id) VALUES ($1, $2)
         ON CONFLICT (congregation_id, user_id) DO UPDATE
           SET status = 'active', left_at = NULL,
               joined_at = CASE WHEN ekklesia_members.status = 'left' THEN now() ELSE ekklesia_members.joined_at END`,
        [cong, userId],
      );
      const { n } = await one<{ n: number }>(c, `SELECT count(*)::int AS n FROM ekklesia_members WHERE congregation_id = $1 AND status = 'active'`, [cong]);
      return { joined: true, member_count: n, first_time: before === null };
    });
  }

  async leave(userId: string): Promise<{ left: boolean; member_count: number }> {
    return tx(this.pool, async (c) => {
      const cong = await this.congregationOf(c, userId);
      await c.query(
        `UPDATE ekklesia_members SET status = 'left', left_at = now() WHERE congregation_id = $1 AND user_id = $2 AND status = 'active'`,
        [cong, userId],
      );
      const { n } = await one<{ n: number }>(c, `SELECT count(*)::int AS n FROM ekklesia_members WHERE congregation_id = $1 AND status = 'active'`, [cong]);
      return { left: true, member_count: n };
    });
  }

  /** Leaders appoint (or stand down) other leaders. */
  async setMemberRole(actorId: string, targetUserId: string, role: "intercessor" | "leader"): Promise<{ user_id: string; role: string }> {
    return tx(this.pool, async (c) => {
      const cong = await this.congregationOf(c, actorId);
      if (!(await this.isLeader(c, actorId, cong))) throw new ApiError("FORBIDDEN_SCOPE", "Only a leader can appoint leaders");
      const row = await maybeOne<{ user_id: string; role: string }>(
        c,
        `UPDATE ekklesia_members SET role = $3 WHERE congregation_id = $1 AND user_id = $2 AND status = 'active' RETURNING user_id, role`,
        [cong, targetUserId, role],
      );
      if (!row) throw new ApiError("NOT_FOUND", "That member is not on the watch");
      return row;
    });
  }

  // ── requests ────────────────────────────────────────────────────────────

  /** Anyone in the congregation may bring a need to the watch. */
  async createRequest(userId: string, input: z.infer<typeof EkklesiaService.Request>): Promise<{ request_id: string; duplicate: boolean; notified: number }> {
    const created = await tx(this.pool, async (c) => {
      const cong = await this.congregationOf(c, userId);
      await this.ensureGroup(c, cong);
      if (input.client_mutation_id) {
        const dup = await maybeOne<{ request_id: string }>(c, `SELECT request_id FROM ekklesia_requests WHERE client_mutation_id = $1`, [input.client_mutation_id]);
        if (dup) return { request_id: dup.request_id, duplicate: true, cong };
      }
      const res = await c.query(
        `INSERT INTO ekklesia_requests (request_id, congregation_id, author_user_id, title, body, for_whom, urgency, client_mutation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (request_id) DO NOTHING RETURNING request_id`,
        [input.request_id, cong, userId, input.title.trim(), input.body.trim(), input.for_whom?.trim() || null, input.urgency, input.client_mutation_id ?? null],
      );
      if (res.rowCount === 0) return { request_id: input.request_id, duplicate: true, cong };
      // Bringing a need to the watch is itself an act of prayer.
      await recordActivityEvent(c, userId, "prayer", { oncePerDayTz: "Africa/Nairobi" });
      return { request_id: input.request_id, duplicate: false, cong };
    });
    if (created.duplicate) return { request_id: created.request_id, duplicate: true, notified: 0 };
    const notified = await this.notifyWatch(created.cong, created.request_id, userId, input);
    return { request_id: created.request_id, duplicate: false, notified };
  }

  /** Tell every intercessor (not the author) once. Best-effort, deduplicated. */
  private async notifyWatch(cong: string, requestId: string, authorId: string, input: z.infer<typeof EkklesiaService.Request>): Promise<number> {
    const members = await many<{ user_id: string }>(
      this.pool,
      `SELECT m.user_id FROM ekklesia_members m
        WHERE m.congregation_id = $1 AND m.status = 'active' AND m.user_id <> $2
          AND NOT EXISTS (SELECT 1 FROM ekklesia_request_notices n WHERE n.request_id = $3 AND n.user_id = m.user_id)`,
      [cong, authorId, requestId],
    );
    const who = input.for_whom?.trim();
    const title = input.urgency === "urgent" ? "Ekklesia · urgent" : "Ekklesia · a need for the watch";
    const body = who ? `${who}: ${input.title.trim()}` : input.title.trim();
    let n = 0;
    for (const m of members) {
      const ins = await this.pool.query(`INSERT INTO ekklesia_request_notices (request_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [requestId, m.user_id]);
      if ((ins.rowCount ?? 0) === 0) continue;
      n += 1;
      try {
        await this.notifications.schedule({
          userId: m.user_id, channel: "push", template: "ekklesia_request",
          payload: { request_id: requestId, urgency: input.urgency, title, body },
        });
      } catch { /* best-effort — the request stands regardless */ }
    }
    return n;
  }

  /** "I interceded today." One row per day; a second tap today changes nothing. */
  async intercede(userId: string, requestId: string): Promise<{ prayed_today: boolean; first_today: boolean; prayer_count: number; intercessor_count: number; my_prayer_days: number }> {
    return tx(this.pool, async (c) => {
      const { cong } = await this.access(c, userId, requestId);
      if (!(await this.membership(c, userId, cong))) throw new ApiError("FORBIDDEN_SCOPE", "Join Ekklesia to intercede", { join: true });
      const ins = await c.query(
        `INSERT INTO ekklesia_intercessions (request_id, user_id, prayed_on) VALUES ($1, $2, ${TODAY}) ON CONFLICT DO NOTHING`,
        [requestId, userId],
      );
      const first = (ins.rowCount ?? 0) > 0;
      if (first) await recordActivityEvent(c, userId, "prayer", { oncePerDayTz: "Africa/Nairobi" });
      const t = await one<{ prayer_count: number; intercessor_count: number; my_prayer_days: number }>(
        c,
        `SELECT count(*)::int AS prayer_count, count(DISTINCT user_id)::int AS intercessor_count,
                (count(*) FILTER (WHERE user_id = $2))::int AS my_prayer_days
           FROM ekklesia_intercessions WHERE request_id = $1`,
        [requestId, userId],
      );
      return { prayed_today: true, first_today: first, ...t };
    });
  }

  /** The requester, or any intercessor, writes back to the watch. */
  async addUpdate(userId: string, requestId: string, input: z.infer<typeof EkklesiaService.Update>): Promise<{ update_id: string; duplicate: boolean }> {
    return tx(this.pool, async (c) => {
      const { cong, author_user_id } = await this.access(c, userId, requestId);
      if (author_user_id !== userId && !(await this.membership(c, userId, cong)) && !(await this.isLeader(c, userId, cong))) {
        throw new ApiError("FORBIDDEN_SCOPE", "Join Ekklesia to write to the watch", { join: true });
      }
      if (input.client_mutation_id) {
        const dup = await maybeOne<{ update_id: string }>(c, `SELECT update_id FROM ekklesia_updates WHERE client_mutation_id = $1`, [input.client_mutation_id]);
        if (dup) return { update_id: dup.update_id, duplicate: true };
      }
      const res = await c.query(
        `INSERT INTO ekklesia_updates (update_id, request_id, author_user_id, kind, body, client_mutation_id)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (update_id) DO NOTHING RETURNING update_id`,
        [input.update_id, requestId, userId, input.kind, input.body.trim(), input.client_mutation_id ?? null],
      );
      if (res.rowCount === 0) return { update_id: input.update_id, duplicate: true };
      await c.query(`UPDATE ekklesia_requests SET updated_at = now() WHERE request_id = $1`, [requestId]);
      return { update_id: input.update_id, duplicate: false };
    });
  }

  /** The requester or a leader closes the need as answered (with a word of testimony). */
  async setAnswered(userId: string, requestId: string, input: z.infer<typeof EkklesiaService.Answered>): Promise<{ is_answered: boolean; answered_at: string | null }> {
    return tx(this.pool, async (c) => {
      const { cong, author_user_id } = await this.access(c, userId, requestId);
      if (author_user_id !== userId && !(await this.isLeader(c, userId, cong))) throw new ApiError("FORBIDDEN_SCOPE", "Only the one who brought it, or a leader, can close a request");
      return one<{ is_answered: boolean; answered_at: string | null }>(
        c,
        `UPDATE ekklesia_requests
            SET is_answered = $2, answered_at = CASE WHEN $2 THEN now() ELSE NULL END,
                answered_note = CASE WHEN $2 THEN $3 ELSE NULL END, is_pinned = CASE WHEN $2 THEN FALSE ELSE is_pinned END,
                updated_at = now()
          WHERE request_id = $1 RETURNING is_answered, answered_at`,
        [requestId, input.answered, input.note?.trim() || null],
      );
    });
  }

  async setPinned(userId: string, requestId: string, pinned: boolean): Promise<{ is_pinned: boolean }> {
    return tx(this.pool, async (c) => {
      const { cong } = await this.access(c, userId, requestId);
      if (!(await this.isLeader(c, userId, cong))) throw new ApiError("FORBIDDEN_SCOPE", "Only a leader can pin a request");
      return one<{ is_pinned: boolean }>(c, `UPDATE ekklesia_requests SET is_pinned = $2, updated_at = now() WHERE request_id = $1 RETURNING is_pinned`, [requestId, pinned]);
    });
  }

  /** The requester withdraws it, or a leader takes it down. */
  async remove(userId: string, requestId: string): Promise<{ deleted: boolean }> {
    return tx(this.pool, async (c) => {
      const { cong, author_user_id } = await this.access(c, userId, requestId);
      if (author_user_id !== userId && !(await this.isLeader(c, userId, cong))) throw new ApiError("FORBIDDEN_SCOPE", "Only the one who brought it, or a leader, can remove a request");
      await c.query(`DELETE FROM ekklesia_requests WHERE request_id = $1`, [requestId]);
      return { deleted: true };
    });
  }

  /** For the Home rail: how many active needs this intercessor has not yet prayed today. */
  async needsMeToday(userId: string): Promise<{ is_member: boolean; count: number; urgent: number }> {
    const row = await maybeOne<{ count: number; urgent: number }>(
      this.pool,
      `SELECT count(*)::int AS count, (count(*) FILTER (WHERE r.urgency = 'urgent'))::int AS urgent
         FROM ekklesia_requests r
         JOIN ekklesia_members m ON m.congregation_id = r.congregation_id AND m.user_id = $1 AND m.status = 'active'
        WHERE NOT r.is_hidden AND NOT r.is_answered
          AND NOT EXISTS (SELECT 1 FROM ekklesia_intercessions i WHERE i.request_id = r.request_id AND i.user_id = $1 AND i.prayed_on = ${TODAY})`,
      [userId],
    );
    const member = await maybeOne(this.pool, `SELECT 1 FROM ekklesia_members WHERE user_id = $1 AND status = 'active'`, [userId]);
    return { is_member: member !== null, count: row?.count ?? 0, urgent: row?.urgent ?? 0 };
  }
}
