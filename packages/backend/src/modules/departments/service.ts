// Departments (docs/PARTNERS_PROGRAMME.md §4): where members serve, what a
// department says (posts), and what it needs (needs — first-class giving
// targets with exact attribution). Owner, 2026-09-23: "Admin can post, and
// also have a place to submit departments financial needs."
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, audit, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import type { NotificationService } from "../notifications/service.js";

/** Progress of a need: gifts attributed to it directly, plus gifts made under
 *  a pledge that targets it. Exported so the Partners statement's
 *  `church_progress_percent` reads the same raised figure this page does. */
export async function needRaisedMinor(c: Queryable, needId: string): Promise<number> {
  return (await needGiving(c, needId)).raised_minor;
}

/** The need's raised figure (needRaisedMinor) and how many gifts made it —
 *  ONE predicate, so Finance → Department needs, the department page and the
 *  Partners statement can never count a need differently. */
export async function needGiving(c: Queryable, needId: string): Promise<{ raised_minor: number; gifts: number }> {
  const r = await one<{ total: string | null; gifts: number }>(
    c,
    `SELECT sum(t.amount_minor)::text AS total, count(*)::int AS gifts FROM transactions t
       LEFT JOIN pledges p ON p.pledge_id = t.pledge_id
      WHERE t.status = 'succeeded' AND (t.need_id = $1 OR p.need_id = $1)`,
    [needId],
  );
  return { raised_minor: Number(r.total ?? 0), gifts: r.gifts };
}

/** `office` = acting under departments:manage rather than as the leader; the
 *  principal's congregation (null = all) bounds what the office may touch. */
type OfficeOpts = { office?: boolean; congregationId?: string | null };

export class DepartmentsService {
  constructor(private readonly pool: Pool, private readonly notifications: NotificationService) {}

  static readonly Upsert = z.object({
    name: z.string().trim().min(2).max(80),
    purpose: z.string().trim().max(600).default(""),
    leader_user_id: z.string().uuid().nullish(),
    meets: z.string().trim().max(120).nullish(),
    image_url: z.string().url().nullish(),
    fund_code: z.string().trim().min(2).max(40).nullish(),
    gift_keys: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
    is_open_to_join: z.boolean().default(true),
  });
  static readonly Update = DepartmentsService.Upsert.partial().extend({ status: z.enum(["active", "archived"]).optional() });
  static readonly Post = z.object({ body: z.string().trim().min(1).max(2000), image_url: z.string().url().nullish() });
  static readonly Need = z.object({
    title: z.string().trim().min(3).max(120),
    why: z.string().trim().min(10).max(1500),
    target_minor: z.number().int().positive(),
    currency: z.string().length(3).default("KES"),
    deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  });

  // ── helpers ──────────────────────────────────────────────────────────

  private async congregationOf(userId: string): Promise<string | null> {
    const r = await maybeOne<{ congregation_id: string | null }>(this.pool, `SELECT congregation_id FROM users WHERE user_id = $1`, [userId]);
    return r?.congregation_id ?? null;
  }

  /** Office scope (§5.4): a congregation-attached admin acts only inside their
   *  congregation; a principal with no congregation (SuperAdmin) sees all.
   *  Same rule `adminList` applies to reads, enforced here on every write. */
  private async assertScope(departmentId: string, congregationId: string | null): Promise<void> {
    const d = await maybeOne<{ congregation_id: string }>(this.pool, `SELECT congregation_id FROM departments WHERE department_id = $1`, [departmentId]);
    if (!d) throw new ApiError("NOT_FOUND", "Department not found");
    if (congregationId && d.congregation_id !== congregationId) throw new ApiError("FORBIDDEN_SCOPE", "Department outside your congregation");
  }

  private async topGifts(userId: string): Promise<string[]> {
    const r = await maybeOne<{ top_gifts: string[] | null }>(
      this.pool, `SELECT top_gifts FROM gift_assessments WHERE user_id = $1 ORDER BY submitted_at DESC LIMIT 1`, [userId],
    );
    return r?.top_gifts ?? [];
  }

  async isLeader(userId: string, departmentId: string): Promise<boolean> {
    const r = await maybeOne(
      this.pool,
      `SELECT 1 FROM departments d
        WHERE d.department_id = $1 AND (d.leader_user_id = $2
           OR EXISTS (SELECT 1 FROM department_members m WHERE m.department_id = d.department_id AND m.user_id = $2 AND m.role = 'leader' AND m.status = 'active'))`,
      [departmentId, userId],
    );
    return r !== null;
  }

  /** Progress of a need — see `needRaisedMinor`. */
  private async needRaised(c: Queryable, needId: string): Promise<number> {
    return needRaisedMinor(c, needId);
  }

  private async shapeNeeds(c: Queryable, departmentId: string, statuses: string[]): Promise<Record<string, unknown>[]> {
    const rows = await many<{ need_id: string; title: string; why: string; target_minor: string; currency: string; deadline: string | null; status: string; created_at: string; submitted_by: string; submitted_name: string }>(
      c,
      `SELECT n.need_id, n.title, n.why, n.target_minor::text, n.currency, n.deadline::text, n.status, n.created_at::text, n.submitted_by, u.full_name AS submitted_name
         FROM department_needs n JOIN users u ON u.user_id = n.submitted_by
        WHERE n.department_id = $1 AND n.status = ANY($2::text[]) ORDER BY n.created_at DESC`,
      [departmentId, statuses],
    );
    const out: Record<string, unknown>[] = [];
    for (const n of rows) {
      const raised = await this.needRaised(c, n.need_id);
      const target = Number(n.target_minor);
      out.push({ ...n, target_minor: target, raised_minor: raised, percent: Math.min(100, Math.round((raised / target) * 100)), reached: raised >= target });
    }
    return out;
  }

  // ── member ───────────────────────────────────────────────────────────

  async list(userId: string): Promise<Record<string, unknown>[]> {
    const cong = await this.congregationOf(userId);
    const gifts = await this.topGifts(userId);
    const rows = await many<{
      department_id: string; name: string; purpose: string; meets: string | null; image_url: string | null; gift_keys: string[];
      is_open_to_join: boolean; leader_name: string | null; leader_avatar: string | null; member_count: number;
      my_status: string | null; my_role: string | null; open_needs: number; latest_post: string | null; latest_post_at: string | null;
    }>(
      this.pool,
      `SELECT d.department_id, d.name, d.purpose, d.meets, d.image_url, d.gift_keys, d.is_open_to_join,
              lu.full_name AS leader_name, lu.avatar_url AS leader_avatar,
              (SELECT count(*)::int FROM department_members m WHERE m.department_id = d.department_id AND m.status = 'active') AS member_count,
              mm.status AS my_status, mm.role AS my_role,
              (SELECT count(*)::int FROM department_needs n WHERE n.department_id = d.department_id AND n.status = 'approved') AS open_needs,
              (SELECT body FROM department_posts p WHERE p.department_id = d.department_id AND p.deleted_at IS NULL ORDER BY created_at DESC LIMIT 1) AS latest_post,
              (SELECT created_at::text FROM department_posts p WHERE p.department_id = d.department_id AND p.deleted_at IS NULL ORDER BY created_at DESC LIMIT 1) AS latest_post_at
         FROM departments d
         LEFT JOIN users lu ON lu.user_id = d.leader_user_id
         LEFT JOIN department_members mm ON mm.department_id = d.department_id AND mm.user_id = $2
        WHERE d.status = 'active' AND ($1::uuid IS NULL OR d.congregation_id = $1)
        ORDER BY d.name`,
      [cong, userId],
    );
    return rows.map((d) => {
      const matched = d.gift_keys.filter((k) => gifts.includes(k));
      return { ...d, fit: matched.length > 0, matched_gifts: matched, latest_post: d.latest_post ? d.latest_post.slice(0, 140) : null };
    });
  }

  async get(userId: string, departmentId: string): Promise<Record<string, unknown>> {
    const all = await this.list(userId);
    const head = all.find((d) => d.department_id === departmentId);
    if (!head) throw new ApiError("NOT_FOUND", "Department not found");
    const posts = await many(
      this.pool,
      `SELECT p.post_id, p.body, p.image_url, p.created_at::text, u.full_name AS author_name, u.avatar_url AS author_avatar
         FROM department_posts p JOIN users u ON u.user_id = p.author_user_id
        WHERE p.department_id = $1 AND p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 30`,
      [departmentId],
    );
    const members = await many(
      this.pool,
      `SELECT m.user_id, u.full_name, u.avatar_url, m.role FROM department_members m JOIN users u ON u.user_id = m.user_id
        WHERE m.department_id = $1 AND m.status = 'active' ORDER BY (m.role = 'leader') DESC, u.full_name LIMIT 60`,
      [departmentId],
    );
    const isLeader = await this.isLeader(userId, departmentId);
    const needs = await this.shapeNeeds(this.pool, departmentId, isLeader ? ["approved", "pending", "closed"] : ["approved"]);
    return { ...head, is_leader: isLeader, posts, members, needs };
  }

  async myDepartments(userId: string): Promise<Record<string, unknown>[]> {
    const all = await this.list(userId);
    return all.filter((d) => d.my_status === "active" || d.my_status === "requested");
  }

  async requestToServe(userId: string, departmentId: string): Promise<{ status: string }> {
    const d = await maybeOne<{ is_open_to_join: boolean; leader_user_id: string | null; name: string }>(
      this.pool, `SELECT is_open_to_join, leader_user_id, name FROM departments WHERE department_id = $1 AND status = 'active'`, [departmentId],
    );
    if (!d) throw new ApiError("NOT_FOUND", "Department not found");
    if (!d.is_open_to_join) throw new ApiError("UNPROCESSABLE", "This department is not taking new members right now");
    const row = await one<{ status: string }>(
      this.pool,
      `INSERT INTO department_members (department_id, user_id) VALUES ($1, $2)
       ON CONFLICT (department_id, user_id) DO UPDATE
         SET status = CASE WHEN department_members.status = 'active' THEN 'active' ELSE 'requested' END,
             requested_at = CASE WHEN department_members.status = 'active' THEN department_members.requested_at ELSE now() END,
             decided_by = NULL, decided_at = NULL, left_at = NULL
       RETURNING status`,
      [departmentId, userId],
    );
    await audit(this.pool, userId, "department.serve_requested", "departments", departmentId, {});
    if (row.status === "requested" && d.leader_user_id) {
      const who = await maybeOne<{ full_name: string }>(this.pool, `SELECT full_name FROM users WHERE user_id = $1`, [userId]);
      await this.notifications.schedule({ userId: d.leader_user_id, channel: "push", template: "serve_request_received", payload: { department_id: departmentId, department: d.name, name: who?.full_name ?? "A member" } });
    }
    return row;
  }

  async leave(userId: string, departmentId: string): Promise<void> {
    await this.pool.query(`UPDATE department_members SET status = 'left', left_at = now() WHERE department_id = $1 AND user_id = $2 AND status IN ('active','requested')`, [departmentId, userId]);
  }

  // ── leader or office ─────────────────────────────────────────────────

  async createPost(actorId: string, departmentId: string, input: z.infer<typeof DepartmentsService.Post>, opts: OfficeOpts = {}): Promise<Record<string, unknown>> {
    if (!opts.office && !(await this.isLeader(actorId, departmentId))) throw new ApiError("FORBIDDEN_SCOPE", "Only the department's leader can post");
    if (opts.office) await this.assertScope(departmentId, opts.congregationId ?? null);
    const d = await maybeOne<{ name: string }>(this.pool, `SELECT name FROM departments WHERE department_id = $1 AND status = 'active'`, [departmentId]);
    if (!d) throw new ApiError("NOT_FOUND", "Department not found");
    const row = await one<{ post_id: string; created_at: string }>(
      this.pool,
      `INSERT INTO department_posts (department_id, author_user_id, body, image_url) VALUES ($1, $2, $3, $4) RETURNING post_id, created_at::text`,
      [departmentId, actorId, input.body, input.image_url ?? null],
    );
    await audit(this.pool, actorId, "department.posted", "department_posts", row.post_id, { department_id: departmentId });
    // Members hear about it (push only; the post itself is in the app).
    const members = await many<{ user_id: string }>(this.pool, `SELECT user_id FROM department_members WHERE department_id = $1 AND status = 'active' AND user_id <> $2`, [departmentId, actorId]);
    for (const m of members) {
      await this.notifications.schedule({ userId: m.user_id, channel: "push", template: "department_post", payload: { department_id: departmentId, department: d.name, preview: input.body.slice(0, 90) } });
    }
    return { post_id: row.post_id, created_at: row.created_at, body: input.body, image_url: input.image_url ?? null };
  }

  async deletePost(actorId: string, departmentId: string, postId: string, opts: OfficeOpts = {}): Promise<void> {
    if (!opts.office && !(await this.isLeader(actorId, departmentId))) throw new ApiError("FORBIDDEN_SCOPE", "Only the department's leader can remove posts");
    if (opts.office) await this.assertScope(departmentId, opts.congregationId ?? null);
    await this.pool.query(`UPDATE department_posts SET deleted_at = now() WHERE post_id = $1 AND department_id = $2 AND deleted_at IS NULL`, [postId, departmentId]);
  }

  async submitNeed(actorId: string, departmentId: string, input: z.infer<typeof DepartmentsService.Need>, opts: OfficeOpts = {}): Promise<Record<string, unknown>> {
    if (!opts.office && !(await this.isLeader(actorId, departmentId))) throw new ApiError("FORBIDDEN_SCOPE", "Only the department's leader can submit a need");
    if (opts.office) await this.assertScope(departmentId, opts.congregationId ?? null);
    const d = await maybeOne<{ name: string; congregation_id: string }>(this.pool, `SELECT name, congregation_id FROM departments WHERE department_id = $1 AND status = 'active'`, [departmentId]);
    if (!d) throw new ApiError("NOT_FOUND", "Department not found");
    const row = await one<{ need_id: string; status: string; created_at: string }>(
      this.pool,
      `INSERT INTO department_needs (department_id, submitted_by, title, why, target_minor, currency, deadline)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING need_id, status, created_at::text`,
      [departmentId, actorId, input.title, input.why, input.target_minor, input.currency.toUpperCase(), input.deadline ?? null],
    );
    await audit(this.pool, actorId, "department.need_submitted", "department_needs", row.need_id, { target_minor: input.target_minor });
    return { need_id: row.need_id, status: row.status, created_at: row.created_at };
  }

  // ── office (departments:manage) ───────────────────────────────────────

  async adminList(congregationId: string | null): Promise<Record<string, unknown>[]> {
    return many(
      this.pool,
      `SELECT d.department_id, d.name, d.purpose, d.meets, d.image_url, d.fund_code, d.gift_keys, d.is_open_to_join, d.status, d.leader_user_id,
              lu.full_name AS leader_name,
              (SELECT count(*)::int FROM department_members m WHERE m.department_id = d.department_id AND m.status = 'active') AS member_count,
              (SELECT count(*)::int FROM department_members m WHERE m.department_id = d.department_id AND m.status = 'requested') AS pending_requests,
              (SELECT count(*)::int FROM department_needs n WHERE n.department_id = d.department_id AND n.status = 'pending') AS pending_needs,
              (SELECT count(*)::int FROM department_needs n WHERE n.department_id = d.department_id AND n.status = 'approved') AS open_needs,
              d.created_at::text
         FROM departments d LEFT JOIN users lu ON lu.user_id = d.leader_user_id
        WHERE ($1::uuid IS NULL OR d.congregation_id = $1) ORDER BY d.status, d.name`,
      [congregationId],
    );
  }

  async create(adminId: string, congregationId: string, input: z.infer<typeof DepartmentsService.Upsert>): Promise<Record<string, unknown>> {
    if (input.fund_code) {
      const f = await maybeOne(this.pool, `SELECT 1 FROM funds WHERE code = $1 AND is_active`, [input.fund_code]);
      if (!f) throw new ApiError("NOT_FOUND", "Unknown fund");
    }
    const row = await one<{ department_id: string }>(
      this.pool,
      `INSERT INTO departments (congregation_id, name, purpose, leader_user_id, meets, image_url, fund_code, gift_keys, is_open_to_join, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING department_id`,
      [congregationId, input.name, input.purpose, input.leader_user_id ?? null, input.meets ?? null, input.image_url ?? null, input.fund_code ?? null, input.gift_keys, input.is_open_to_join, adminId],
    );
    if (input.leader_user_id) await this.setLeaderMembership(row.department_id, input.leader_user_id, adminId);
    await audit(this.pool, adminId, "department.created", "departments", row.department_id, { name: input.name });
    return (await this.adminList(congregationId)).find((d) => d.department_id === row.department_id) ?? { department_id: row.department_id };
  }

  private async setLeaderMembership(departmentId: string, leaderId: string, adminId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO department_members (department_id, user_id, role, status, decided_by, decided_at)
       VALUES ($1, $2, 'leader', 'active', $3, now())
       ON CONFLICT (department_id, user_id) DO UPDATE SET role = 'leader', status = 'active', decided_by = $3, decided_at = now(), left_at = NULL`,
      [departmentId, leaderId, adminId],
    );
  }

  async update(adminId: string, departmentId: string, input: z.infer<typeof DepartmentsService.Update>, congregationId: string | null = null): Promise<Record<string, unknown>> {
    await this.assertScope(departmentId, congregationId);
    const d = await one<{ congregation_id: string }>(this.pool, `SELECT congregation_id FROM departments WHERE department_id = $1`, [departmentId]);
    const sets: string[] = ["updated_at = now()"]; const params: unknown[] = [];
    const push = (col: string, v: unknown): void => { params.push(v); sets.push(`${col} = $${params.length}`); };
    for (const k of ["name", "purpose", "leader_user_id", "meets", "image_url", "fund_code", "gift_keys", "is_open_to_join", "status"] as const) {
      if (input[k] !== undefined) push(k, input[k]);
    }
    params.push(departmentId);
    await this.pool.query(`UPDATE departments SET ${sets.join(", ")} WHERE department_id = $${params.length}`, params);
    if (input.leader_user_id) await this.setLeaderMembership(departmentId, input.leader_user_id, adminId);
    await audit(this.pool, adminId, "department.updated", "departments", departmentId, input as Record<string, unknown>);
    return (await this.adminList(d.congregation_id)).find((x) => x.department_id === departmentId) ?? {};
  }

  async serveRequests(status: "requested" | "active" | "declined" | "left" = "requested", congregationId: string | null = null): Promise<Record<string, unknown>[]> {
    return many(
      this.pool,
      `SELECT m.department_id, d.name AS department, m.user_id, u.full_name, u.avatar_url, u.phone_number, m.status, m.role, m.requested_at::text, m.decided_at::text
         FROM department_members m JOIN departments d ON d.department_id = m.department_id JOIN users u ON u.user_id = m.user_id
        WHERE m.status = $1 AND ($2::uuid IS NULL OR d.congregation_id = $2) ORDER BY m.requested_at ASC`,
      [status, congregationId],
    );
  }

  async decideServe(actorId: string, departmentId: string, userId: string, decision: "approve" | "decline", opts: OfficeOpts = {}): Promise<{ status: string }> {
    if (!opts.office && !(await this.isLeader(actorId, departmentId))) throw new ApiError("FORBIDDEN_SCOPE", "Only the department's leader can decide");
    if (opts.office) await this.assertScope(departmentId, opts.congregationId ?? null);
    const status = decision === "approve" ? "active" : "declined";
    const r = await this.pool.query(
      `UPDATE department_members SET status = $3, decided_by = $4, decided_at = now() WHERE department_id = $1 AND user_id = $2 AND status = 'requested'`,
      [departmentId, userId, status, actorId],
    );
    if (!r.rowCount) throw new ApiError("NOT_FOUND", "No pending request");
    const d = await one<{ name: string }>(this.pool, `SELECT name FROM departments WHERE department_id = $1`, [departmentId]);
    await audit(this.pool, actorId, `department.serve_${decision}d`, "departments", departmentId, { user_id: userId });
    await this.notifications.schedule({ userId, channel: "push", template: decision === "approve" ? "serve_request_approved" : "serve_request_declined", payload: { department_id: departmentId, department: d.name } });
    return { status };
  }

  async needs(status: "pending" | "approved" | "rejected" | "closed" = "pending", congregationId: string | null = null): Promise<Record<string, unknown>[]> {
    const rows = await many<{ need_id: string; department_id: string; department: string; title: string; why: string; target_minor: string; currency: string; deadline: string | null; status: string; created_at: string; submitted_name: string }>(
      this.pool,
      `SELECT n.need_id, n.department_id, d.name AS department, n.title, n.why, n.target_minor::text, n.currency, n.deadline::text, n.status, n.created_at::text, u.full_name AS submitted_name
         FROM department_needs n JOIN departments d ON d.department_id = n.department_id JOIN users u ON u.user_id = n.submitted_by
        WHERE n.status = $1 AND ($2::uuid IS NULL OR d.congregation_id = $2) ORDER BY n.created_at ASC`,
      [status, congregationId],
    );
    const out: Record<string, unknown>[] = [];
    for (const n of rows) {
      const raised = await this.needRaised(this.pool, n.need_id);
      out.push({ ...n, target_minor: Number(n.target_minor), raised_minor: raised });
    }
    return out;
  }

  async decideNeed(adminId: string, needId: string, decision: "approve" | "reject" | "close", note?: string | null, congregationId: string | null = null): Promise<{ status: string }> {
    const n = await maybeOne<{ status: string; department_id: string; submitted_by: string; title: string; congregation_id: string }>(
      this.pool,
      `SELECT n.status, n.department_id, n.submitted_by, n.title, d.congregation_id FROM department_needs n JOIN departments d ON d.department_id = n.department_id WHERE n.need_id = $1`,
      [needId],
    );
    if (!n) throw new ApiError("NOT_FOUND", "Need not found");
    if (congregationId && n.congregation_id !== congregationId) throw new ApiError("FORBIDDEN_SCOPE", "Department outside your congregation");
    const next = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "closed";
    if (decision !== "close" && n.status !== "pending") throw new ApiError("UNPROCESSABLE", `Need already ${n.status}`);
    if (decision === "close" && n.status !== "approved") throw new ApiError("UNPROCESSABLE", "Only an open need can be closed");
    await this.pool.query(
      `UPDATE department_needs SET status = $2, decided_by = $3, decided_at = now(), decision_note = COALESCE($4, decision_note), closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE closed_at END WHERE need_id = $1`,
      [needId, next, adminId, note ?? null],
    );
    await audit(this.pool, adminId, `department.need_${next}`, "department_needs", needId, {});
    await this.notifications.schedule({ userId: n.submitted_by, channel: "push", template: `department_need_${next}`, payload: { need_id: needId, department_id: n.department_id, title: n.title, note: note ?? null } });
    if (next === "approved") {
      // The department hears that giving is open.
      const members = await many<{ user_id: string }>(this.pool, `SELECT user_id FROM department_members WHERE department_id = $1 AND status = 'active' AND user_id <> $2`, [n.department_id, n.submitted_by]);
      for (const m of members) {
        await this.notifications.schedule({ userId: m.user_id, channel: "push", template: "department_need_open", payload: { need_id: needId, department_id: n.department_id, title: n.title } });
      }
    }
    return { status: next };
  }
}
