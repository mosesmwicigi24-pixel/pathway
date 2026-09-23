// The Partners programme: memberships, pledges, progress, statements.
// Spec: docs/PARTNERS_PROGRAMME.md (§1, §2, §5). Owner, 2026-09-23.
//
// Design rules this file keeps:
//   · Joining needs no money. A partner is a member who said yes.
//   · A pledge is a promise; a payment is a transactions row with pledge_id.
//     Attribution is written when the gift is made (service.ts); here we only
//     READ it. Progress is computed every time, never stored.
//   · Dates are the church's day (Africa/Nairobi, UTC+3, no DST).
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, audit, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import type { FinancialService } from "./service.js";
import { givingTiers } from "./tiers.js";

const TZ_OFFSET_MS = 3 * 60 * 60 * 1000; // Africa/Nairobi
const DEFAULT_PLEDGE_FUND = "discipleship"; // the programme carries disciples

export type PledgeShape = "monthly" | "total";
export type PledgeLabel = "on_track" | "behind" | "fulfilled" | "paused";

interface PledgeRow {
  pledge_id: string; user_id: string; shape: PledgeShape;
  amount_minor: string | null; target_minor: string | null; currency: string;
  due_day: number | null; due_on: string | null; until_on: string | null;
  fund_id: string | null; fund_code: string | null; fund_name: string | null;
  campaign_id: string | null; campaign_title: string | null; need_id: string | null;
  status: "active" | "paused" | "fulfilled" | "cancelled";
  schedule_id: string | null; reminders_enabled: boolean; note: string | null;
  created_at: string; fulfilled_at: string | null; cancelled_at: string | null;
}

export interface PledgeProgress {
  paid_minor: number;
  period_paid_minor: number | null;
  label: PledgeLabel;
  next_due: string | null;   // YYYY-MM-DD
  overdue_since: string | null;
}

/** Nairobi calendar date (YYYY-MM-DD) of an instant. */
function nairobiDate(d: Date): string {
  return new Date(d.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
}
/** Start of a Nairobi calendar date, as an instant. */
function nairobiStart(ymd: string): Date {
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() - TZ_OFFSET_MS);
}
function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
/** The due date (YYYY-MM-DD) with `dueDay` in the month `months` after/before `ref`. */
function dueDateInMonth(ref: string, dueDay: number, months: number): string {
  const y = Number(ref.slice(0, 4));
  const m = Number(ref.slice(5, 7));
  const total = (y * 12 + (m - 1)) + months;
  return ymd(Math.floor(total / 12), (total % 12) + 1, dueDay);
}

export class PartnersService {
  constructor(private readonly pool: Pool, private readonly financial: FinancialService) {}

  static readonly CreatePledge = z
    .object({
      shape: z.enum(["monthly", "total"]),
      amount_minor: z.number().int().positive().optional(),
      target_minor: z.number().int().positive().optional(),
      currency: z.string().length(3).default("KES"),
      due_day: z.number().int().min(1).max(28).optional(),
      due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      until_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
      fund: z.string().min(2).max(40).nullish(),
      campaign_id: z.string().uuid().nullish(),
      need_id: z.string().uuid().nullish(),
      note: z.string().trim().max(200).nullish(),
      reminders_enabled: z.boolean().default(true),
      auto_schedule: z
        .object({ method: z.enum(["mpesa", "airtel"]), frequency: z.enum(["weekly", "monthly"]).default("monthly") })
        .nullish(),
    })
    .superRefine((v, ctx) => {
      if (v.shape === "monthly" && !v.amount_minor) ctx.addIssue({ code: "custom", message: "A monthly pledge needs amount_minor", path: ["amount_minor"] });
      if (v.shape === "total" && (!v.target_minor || !v.due_on)) ctx.addIssue({ code: "custom", message: "A total pledge needs target_minor and due_on", path: ["target_minor"] });
      if ([v.fund, v.campaign_id, v.need_id].filter(Boolean).length > 1) ctx.addIssue({ code: "custom", message: "A pledge points at one target at most", path: ["fund"] });
    });

  static readonly UpdatePledge = z.object({
    status: z.enum(["active", "paused", "cancelled"]).optional(),
    amount_minor: z.number().int().positive().optional(),
    target_minor: z.number().int().positive().optional(),
    due_day: z.number().int().min(1).max(28).optional(),
    due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    reminders_enabled: z.boolean().optional(),
    note: z.string().trim().max(200).nullish(),
  });

  // ── membership ────────────────────────────────────────────────────────

  async join(userId: string): Promise<{ status: string; joined_at: string; reminders_enabled: boolean }> {
    const row = await one<{ status: string; joined_at: string; reminders_enabled: boolean }>(
      this.pool,
      `INSERT INTO partner_memberships (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE
         SET status = 'active', left_at = NULL, paused_at = NULL, updated_at = now()
       RETURNING status, joined_at::text AS joined_at, reminders_enabled`,
      [userId],
    );
    await audit(this.pool, userId, "partners.joined", "partner_memberships", userId, {});
    return row;
  }

  async membership(userId: string): Promise<{ status: string; joined_at: string; reminders_enabled: boolean } | null> {
    return maybeOne(
      this.pool,
      `SELECT status, joined_at::text AS joined_at, reminders_enabled FROM partner_memberships WHERE user_id = $1`,
      [userId],
    );
  }

  // ── pledges ───────────────────────────────────────────────────────────

  private static readonly PLEDGE_SELECT = `
    SELECT p.pledge_id, p.user_id, p.shape, p.amount_minor::text, p.target_minor::text, p.currency,
           p.due_day, p.due_on::text, p.until_on::text, p.fund_id, f.code AS fund_code, f.name AS fund_name,
           p.campaign_id, c.title AS campaign_title, p.need_id, p.status, p.schedule_id, p.reminders_enabled,
           p.note, p.created_at::text, p.fulfilled_at::text, p.cancelled_at::text
      FROM pledges p
      LEFT JOIN funds f ON f.fund_id = p.fund_id
      LEFT JOIN campaigns c ON c.campaign_id = p.campaign_id`;

  private async pledgeRows(c: Queryable, where: string, params: unknown[]): Promise<PledgeRow[]> {
    return many<PledgeRow>(c, `${PartnersService.PLEDGE_SELECT} ${where} ORDER BY p.created_at DESC`, params);
  }

  /** Sum of succeeded payments attributed to a pledge, optionally inside a window. */
  private async paidBetween(pledgeId: string, from: Date | null, to: Date | null): Promise<number> {
    const r = await one<{ total: string | null }>(
      this.pool,
      `SELECT sum(amount_minor)::text AS total FROM transactions
        WHERE pledge_id = $1 AND status = 'succeeded'
          AND ($2::timestamptz IS NULL OR created_at >= $2)
          AND ($3::timestamptz IS NULL OR created_at < $3)`,
      [pledgeId, from?.toISOString() ?? null, to?.toISOString() ?? null],
    );
    return Number(r.total ?? 0);
  }

  async progress(p: PledgeRow, now: Date = new Date()): Promise<PledgeProgress> {
    const paid = await this.paidBetween(p.pledge_id, null, null);
    const today = nairobiDate(now);
    if (p.status === "paused") return { paid_minor: paid, period_paid_minor: null, label: "paused", next_due: null, overdue_since: null };
    if (p.status === "cancelled") return { paid_minor: paid, period_paid_minor: null, label: "paused", next_due: null, overdue_since: null };

    if (p.shape === "total") {
      const target = Number(p.target_minor ?? 0);
      if (p.status === "fulfilled" || paid >= target) {
        return { paid_minor: paid, period_paid_minor: null, label: "fulfilled", next_due: null, overdue_since: null };
      }
      const behind = p.due_on !== null && today > p.due_on;
      return { paid_minor: paid, period_paid_minor: null, label: behind ? "behind" : "on_track", next_due: p.due_on, overdue_since: behind ? p.due_on : null };
    }

    // monthly: the due date this period is the next due_day at or after today.
    const amount = Number(p.amount_minor ?? 0);
    const dueDay = p.due_day ?? 1;
    const createdOn = nairobiDate(new Date(p.created_at));
    let due = dueDateInMonth(today, dueDay, 0);
    if (due < today) due = dueDateInMonth(today, dueDay, 1);
    const periodStart = nairobiStart(dueDateInMonth(due, dueDay, -1));
    const periodPaid = await this.paidBetween(p.pledge_id, periodStart, null);
    // The previous period is "behind" only if its due date has passed unpaid
    // and the pledge already existed then.
    const prevDue = dueDateInMonth(due, dueDay, -1);
    let behindSince: string | null = null;
    if (prevDue >= createdOn && prevDue < today) {
      const prevPaid = await this.paidBetween(p.pledge_id, nairobiStart(dueDateInMonth(prevDue, dueDay, -1)), nairobiStart(due));
      if (prevPaid < amount) behindSince = prevDue;
    }
    if (p.until_on && today > p.until_on) {
      return { paid_minor: paid, period_paid_minor: periodPaid, label: "fulfilled", next_due: null, overdue_since: null };
    }
    return {
      paid_minor: paid,
      period_paid_minor: periodPaid,
      label: behindSince ? "behind" : "on_track",
      next_due: behindSince ?? due,
      overdue_since: behindSince,
    };
  }

  private async shape(p: PledgeRow, now = new Date()): Promise<Record<string, unknown>> {
    const progress = await this.progress(p, now);
    return {
      pledge_id: p.pledge_id,
      shape: p.shape,
      amount_minor: p.amount_minor === null ? null : Number(p.amount_minor),
      target_minor: p.target_minor === null ? null : Number(p.target_minor),
      currency: p.currency,
      due_day: p.due_day,
      due_on: p.due_on,
      until_on: p.until_on,
      fund: p.fund_code ? { code: p.fund_code, name: p.fund_name } : null,
      campaign: p.campaign_id ? { campaign_id: p.campaign_id, title: p.campaign_title } : null,
      need_id: p.need_id,
      status: p.status,
      progress,
      schedule_id: p.schedule_id,
      reminders_enabled: p.reminders_enabled,
      note: p.note,
      created_at: p.created_at,
      fulfilled_at: p.fulfilled_at,
      cancelled_at: p.cancelled_at,
      title: PartnersService.title(p),
    };
  }

  static title(p: PledgeRow): string {
    if (p.campaign_title) return p.campaign_title;
    if (p.fund_name) return p.fund_name;
    if (p.need_id) return "A department need";
    return "Partnership";
  }

  async listPledges(userId: string, now = new Date()): Promise<Record<string, unknown>[]> {
    const rows = await this.pledgeRows(this.pool, `WHERE p.user_id = $1 AND p.status <> 'cancelled'`, [userId]);
    const out: Record<string, unknown>[] = [];
    for (const r of rows) out.push(await this.shape(r, now));
    return out;
  }

  async createPledge(userId: string, input: z.infer<typeof PartnersService.CreatePledge>): Promise<Record<string, unknown>> {
    // Joining is implicit: a pledge from someone outside the programme brings them in.
    await this.join(userId);

    let fundId: string | null = null;
    if (input.fund) {
      const f = await maybeOne<{ fund_id: string }>(this.pool, `SELECT fund_id FROM funds WHERE code = $1 AND is_active`, [input.fund]);
      if (!f) throw new ApiError("NOT_FOUND", "Unknown fund");
      fundId = f.fund_id;
    }
    if (input.campaign_id) {
      const c = await maybeOne<{ campaign_id: string }>(this.pool, `SELECT campaign_id FROM campaigns WHERE campaign_id = $1 AND status <> 'archived'`, [input.campaign_id]);
      if (!c) throw new ApiError("NOT_FOUND", "Unknown campaign");
    }
    const dueDay = input.shape === "monthly" ? (input.due_day ?? Number(nairobiDate(new Date()).slice(8, 10)) ) : null;
    const row = await one<{ pledge_id: string }>(
      this.pool,
      `INSERT INTO pledges (user_id, shape, amount_minor, target_minor, currency, due_day, due_on, until_on, fund_id, campaign_id, need_id, note, reminders_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING pledge_id`,
      [
        userId, input.shape,
        input.shape === "monthly" ? input.amount_minor : null,
        input.shape === "total" ? input.target_minor : null,
        input.currency.toUpperCase(),
        Math.min(dueDay ?? 1, 28),
        input.shape === "total" ? input.due_on : null,
        input.until_on ?? null,
        fundId, input.campaign_id ?? null, input.need_id ?? null,
        input.note ?? null, input.reminders_enabled,
      ],
    );
    await audit(this.pool, userId, "pledge.created", "pledges", row.pledge_id, { shape: input.shape });

    // "Charge me automatically": a schedule bound to this pledge.
    if (input.auto_schedule && input.shape === "monthly" && input.amount_minor) {
      const fundCode = input.fund ?? (await this.campaignFundCode(input.campaign_id ?? null)) ?? DEFAULT_PLEDGE_FUND;
      await this.financial.createSchedule(userId, {
        fund: fundCode,
        amount_minor: input.amount_minor,
        currency: input.currency.toUpperCase(),
        frequency: input.auto_schedule.frequency,
        method: input.auto_schedule.method,
        idempotency_key: `pledge:${row.pledge_id}`,
        pledge_id: row.pledge_id,
      });
    }
    const [created] = await this.pledgeRows(this.pool, `WHERE p.pledge_id = $1`, [row.pledge_id]);
    return this.shape(created!);
  }

  private async campaignFundCode(campaignId: string | null): Promise<string | null> {
    if (!campaignId) return null;
    const r = await maybeOne<{ code: string }>(
      this.pool, `SELECT f.code FROM campaigns c JOIN funds f ON f.fund_id = c.fund_id WHERE c.campaign_id = $1`, [campaignId],
    );
    return r?.code ?? null;
  }

  async getPledge(userId: string, pledgeId: string): Promise<Record<string, unknown>> {
    const [p] = await this.pledgeRows(this.pool, `WHERE p.pledge_id = $1 AND p.user_id = $2`, [pledgeId, userId]);
    if (!p) throw new ApiError("NOT_FOUND", "Pledge not found");
    const payments = await many<{ transaction_id: string; amount_minor: string; currency: string; at: string; receipt_code: string | null; status: string; fund: string }>(
      this.pool,
      `SELECT t.transaction_id, t.amount_minor::text, t.currency, t.created_at::text AS at, t.receipt_code, t.status::text AS status, f.code AS fund
         FROM transactions t JOIN funds f ON f.fund_id = t.fund_id
        WHERE t.pledge_id = $1 AND t.status IN ('succeeded','processing') ORDER BY t.created_at DESC`,
      [pledgeId],
    );
    const reminders = await many<{ due_on: string; sequence: number; channel: string; sent_at: string }>(
      this.pool,
      `SELECT due_on::text, sequence, channel, sent_at::text FROM pledge_reminders WHERE pledge_id = $1 ORDER BY sent_at DESC LIMIT 20`,
      [pledgeId],
    );
    return {
      ...(await this.shape(p)),
      payments: payments.map((x) => ({ ...x, amount_minor: Number(x.amount_minor) })),
      reminders,
    };
  }

  async updatePledge(userId: string, pledgeId: string, patch: z.infer<typeof PartnersService.UpdatePledge>): Promise<Record<string, unknown>> {
    const [p] = await this.pledgeRows(this.pool, `WHERE p.pledge_id = $1 AND p.user_id = $2`, [pledgeId, userId]);
    if (!p) throw new ApiError("NOT_FOUND", "Pledge not found");
    if (p.status === "cancelled") throw new ApiError("UNPROCESSABLE", "A cancelled pledge cannot change");
    const sets: string[] = ["updated_at = now()"]; const params: unknown[] = [];
    const push = (sql: string, v: unknown) => { params.push(v); sets.push(`${sql} = $${params.length}`); };
    if (patch.amount_minor !== undefined) push("amount_minor", patch.amount_minor);
    if (patch.target_minor !== undefined) push("target_minor", patch.target_minor);
    if (patch.due_day !== undefined) push("due_day", patch.due_day);
    if (patch.due_on !== undefined) push("due_on", patch.due_on);
    if (patch.reminders_enabled !== undefined) push("reminders_enabled", patch.reminders_enabled);
    if (patch.note !== undefined) push("note", patch.note);
    if (patch.status === "cancelled") { push("status", "cancelled"); sets.push("cancelled_at = now()"); }
    else if (patch.status === "paused") { push("status", "paused"); }
    else if (patch.status === "active") { push("status", "active"); }
    params.push(pledgeId);
    await this.pool.query(`UPDATE pledges SET ${sets.join(", ")} WHERE pledge_id = $${params.length}`, params);

    // A bound schedule follows the pledge: cancelled → cancelled, paused ↔ active.
    if (p.schedule_id && patch.status) {
      if (patch.status === "cancelled") {
        await this.pool.query(`UPDATE giving_schedules SET status = 'cancelled', cancelled_at = now() WHERE schedule_id = $1 AND status <> 'cancelled'`, [p.schedule_id]);
      } else if (patch.status === "paused") {
        await this.pool.query(`UPDATE giving_schedules SET status = 'paused', paused_at = now() WHERE schedule_id = $1 AND status = 'active'`, [p.schedule_id]);
      } else if (patch.status === "active") {
        await this.pool.query(`UPDATE giving_schedules SET status = 'active', paused_at = NULL, consecutive_failures = 0 WHERE schedule_id = $1 AND status = 'paused'`, [p.schedule_id]);
      }
    }
    await audit(this.pool, userId, "pledge.updated", "pledges", pledgeId, patch as Record<string, unknown>);
    const [after] = await this.pledgeRows(this.pool, `WHERE p.pledge_id = $1`, [pledgeId]);
    return this.shape(after!);
  }

  // ── the portal payload ────────────────────────────────────────────────

  /** Tier from the monthly commitment: the highest tier the amount reaches. */
  static tierFor(monthlyMinor: number, currency = "KES"): { name: string; monthly_minor: number; disciples_per_year: number } | null {
    const tiers = givingTiers(currency).filter((t) => monthlyMinor >= t.amount_minor);
    const top = tiers[tiers.length - 1];
    if (!top) return null;
    return { name: top.meaning, monthly_minor: top.amount_minor, disciples_per_year: top.disciples_per_year };
  }

  async partnership(userId: string, now = new Date()): Promise<Record<string, unknown>> {
    const base = (await this.financial.partnership(userId)) as Record<string, unknown>;
    const membership = await this.membership(userId);
    const pledges = await this.listPledges(userId, now);
    const committedMonthly = pledges
      .filter((p) => p.shape === "monthly" && p.status === "active")
      .reduce((a, p) => a + Number(p.amount_minor ?? 0), 0);
    const rhythmMonthly = (() => {
      const r = base.rhythm as { frequency?: string; amount_minor?: number } | undefined;
      if (!r || !r.amount_minor) return 0;
      return r.frequency === "weekly" ? r.amount_minor * 4 : r.amount_minor;
    })();
    const monthly = committedMonthly || rhythmMonthly;
    const due: Record<string, unknown>[] = [];
    for (const p of pledges) {
      const pr = p.progress as PledgeProgress;
      if (pr.next_due && (p.status === "active")) {
        due.push({ kind: "pledge", id: p.pledge_id, title: p.title, amount_minor: p.shape === "monthly" ? p.amount_minor : Math.max(0, Number(p.target_minor) - pr.paid_minor), currency: p.currency, due_on: pr.next_due, action: "pay", overdue: pr.overdue_since !== null });
      }
    }
    const rhythm = base.rhythm as { next_run_at?: string | null; amount_minor?: number } | undefined;
    if (base.is_partner && rhythm?.next_run_at && !pledges.some((p) => p.schedule_id === base.schedule_id)) {
      due.push({ kind: "schedule", id: base.schedule_id, title: "Your recurring gift", amount_minor: rhythm.amount_minor, currency: base.currency, due_on: nairobiDate(new Date(rhythm.next_run_at)), action: (base.trouble as { paused?: boolean } | null)?.paused ? "resume" : "pay", overdue: false });
    }
    due.sort((a, b) => String(a.due_on).localeCompare(String(b.due_on)));
    return {
      ...base,
      is_partner: Boolean(base.is_partner) || membership?.status === "active",
      membership,
      tier: PartnersService.tierFor(monthly, String(base.currency ?? "KES")),
      committed_monthly_minor: monthly,
      pledges,
      due,
    };
  }

  // ── statements ────────────────────────────────────────────────────────

  async statements(userId: string, year?: number): Promise<Record<string, unknown>> {
    const years = await many<{ y: number }>(
      this.pool,
      `SELECT DISTINCT extract(year from created_at AT TIME ZONE 'Africa/Nairobi')::int AS y
         FROM transactions WHERE user_id = $1 AND status = 'succeeded' ORDER BY y DESC`,
      [userId],
    );
    const ys = years.map((r) => r.y);
    const y = year ?? ys[0] ?? Number(nairobiDate(new Date()).slice(0, 4));
    const rows = await many<{ transaction_id: string; amount_minor: string; currency: string; at: string; receipt_code: string | null; fund: string; fund_name: string; pledge_id: string | null; pledge_title: string | null }>(
      this.pool,
      `SELECT t.transaction_id, t.amount_minor::text, t.currency, t.created_at::text AS at, t.receipt_code, f.code AS fund, f.name AS fund_name,
              t.pledge_id, COALESCE(c.title, pf.name, CASE WHEN p.pledge_id IS NULL THEN NULL ELSE 'Partnership' END) AS pledge_title
         FROM transactions t
         JOIN funds f ON f.fund_id = t.fund_id
         LEFT JOIN pledges p ON p.pledge_id = t.pledge_id
         LEFT JOIN funds pf ON pf.fund_id = p.fund_id
         LEFT JOIN campaigns c ON c.campaign_id = p.campaign_id
        WHERE t.user_id = $1 AND t.status = 'succeeded'
          AND extract(year from t.created_at AT TIME ZONE 'Africa/Nairobi') = $2
        ORDER BY t.created_at DESC`,
      [userId, y],
    );
    const byPledge = new Map<string, { pledge_id: string | null; title: string; total_minor: number }>();
    const byFund = new Map<string, { code: string; name: string; total_minor: number }>();
    let total = 0;
    for (const r of rows) {
      const amt = Number(r.amount_minor); total += amt;
      const pk = r.pledge_id ?? "none";
      const pe = byPledge.get(pk) ?? { pledge_id: r.pledge_id, title: r.pledge_title ?? "Gifts outside a pledge", total_minor: 0 };
      pe.total_minor += amt; byPledge.set(pk, pe);
      const fe = byFund.get(r.fund) ?? { code: r.fund, name: r.fund_name, total_minor: 0 };
      fe.total_minor += amt; byFund.set(r.fund, fe);
    }
    return {
      years: ys,
      year: y,
      total_minor: total,
      currency: rows[0]?.currency ?? "KES",
      by_pledge: [...byPledge.values()],
      by_fund: [...byFund.values()],
      payments: rows.map((r) => ({ transaction_id: r.transaction_id, amount_minor: Number(r.amount_minor), currency: r.currency, at: r.at, receipt_code: r.receipt_code, fund: r.fund, pledge_id: r.pledge_id, pledge_title: r.pledge_title })),
    };
  }

  // ── admin ─────────────────────────────────────────────────────────────

  static readonly AdminListQuery = z.object({
    q: z.string().trim().max(80).optional(),
    status: z.enum(["all", "active", "paused", "behind", "left"]).default("all"),
    sort: z.enum(["recent", "committed", "behind"]).default("recent"),
  });

  async adminList(query: z.infer<typeof PartnersService.AdminListQuery>): Promise<Record<string, unknown>> {
    const rows = await many<{ user_id: string; full_name: string; avatar_url: string | null; phone_number: string | null; email: string | null; cell_name: string | null; m_status: string | null; joined_at: string | null }>(
      this.pool,
      `SELECT u.user_id, u.full_name, u.avatar_url, u.phone_number, u.email, cg.name AS cell_name,
              pm.status AS m_status, pm.joined_at::text
         FROM users u
         LEFT JOIN partner_memberships pm ON pm.user_id = u.user_id
         LEFT JOIN cell_groups cg ON cg.cell_group_id = u.cell_group_id
        WHERE u.deleted_at IS NULL
          AND (pm.user_id IS NOT NULL
               OR EXISTS (SELECT 1 FROM pledges p WHERE p.user_id = u.user_id)
               OR EXISTS (SELECT 1 FROM giving_schedules s WHERE s.user_id = u.user_id AND s.status IN ('active','paused')))
          AND ($1::text IS NULL OR u.full_name ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%')`,
      [query.q ?? null],
    );
    const year = Number(nairobiDate(new Date()).slice(0, 4));
    const data: Record<string, unknown>[] = [];
    for (const u of rows) {
      const p = (await this.partnership(u.user_id)) as { pledges: Record<string, unknown>[]; committed_monthly_minor: number; tier: unknown; membership: { status: string; joined_at: string } | null; due: Record<string, unknown>[] };
      const given = await one<{ total: string | null; last_at: string | null }>(
        this.pool,
        `SELECT sum(amount_minor) FILTER (WHERE extract(year from created_at AT TIME ZONE 'Africa/Nairobi') = $2)::text AS total,
                max(created_at)::text AS last_at
           FROM transactions WHERE user_id = $1 AND status = 'succeeded'`,
        [u.user_id, year],
      );
      const behind = p.pledges.some((x) => (x.progress as PledgeProgress).label === "behind");
      const nextDue = p.due[0]?.due_on ?? null;
      const status = p.membership?.status ?? (p.pledges.length ? "active" : "schedule_only");
      data.push({
        user_id: u.user_id, full_name: u.full_name, avatar_url: u.avatar_url, phone: u.phone_number, email: u.email, cell_name: u.cell_name,
        membership: p.membership, tier: p.tier,
        pledges_active: p.pledges.filter((x) => x.status === "active").length,
        committed_monthly_minor: p.committed_monthly_minor,
        given_year_minor: Number(given.total ?? 0), last_gift_at: given.last_at,
        behind, next_due_on: nextDue, status,
      });
    }
    let filtered = data;
    if (query.status === "behind") filtered = data.filter((d) => d.behind);
    else if (query.status !== "all") filtered = data.filter((d) => d.status === query.status);
    filtered.sort((a, b) => {
      if (query.sort === "committed") return Number(b.committed_monthly_minor) - Number(a.committed_monthly_minor);
      if (query.sort === "behind") return Number(b.behind) - Number(a.behind);
      return String((b.membership as { joined_at?: string } | null)?.joined_at ?? "").localeCompare(String((a.membership as { joined_at?: string } | null)?.joined_at ?? ""));
    });
    return {
      data: filtered,
      summary: {
        partners: data.length,
        active_pledges: data.reduce((a, d) => a + Number(d.pledges_active), 0),
        committed_monthly_minor: data.reduce((a, d) => a + Number(d.committed_monthly_minor), 0),
        behind: data.filter((d) => d.behind).length,
        given_year_minor: data.reduce((a, d) => a + Number(d.given_year_minor), 0),
      },
    };
  }

  async adminDetail(userId: string): Promise<Record<string, unknown>> {
    const list = await this.adminList({ status: "all", sort: "recent" });
    const member = (list.data as Record<string, unknown>[]).find((d) => d.user_id === userId);
    if (!member) throw new ApiError("NOT_FOUND", "Not a partner");
    const p = await this.partnership(userId);
    const schedules = await many(
      this.pool,
      `SELECT s.schedule_id, s.status, s.frequency, s.method, s.amount_minor::text, s.currency, s.next_run_at::text, s.last_run_at::text, s.consecutive_failures, s.pledge_id, f.code AS fund
         FROM giving_schedules s JOIN funds f ON f.fund_id = s.fund_id WHERE s.user_id = $1 ORDER BY s.created_at DESC`,
      [userId],
    );
    const payments = await many(
      this.pool,
      `SELECT t.transaction_id, t.amount_minor::text, t.currency, t.created_at::text AS at, f.code AS fund, t.pledge_id, t.receipt_code, t.status::text AS status
         FROM transactions t JOIN funds f ON f.fund_id = t.fund_id
        WHERE t.user_id = $1 AND t.status IN ('succeeded','processing','failed') ORDER BY t.created_at DESC LIMIT 200`,
      [userId],
    );
    const reminders = await many(
      this.pool,
      `SELECT r.pledge_id, r.due_on::text, r.sequence, r.channel, r.sent_at::text, r.sent_by
         FROM pledge_reminders r JOIN pledges p ON p.pledge_id = r.pledge_id WHERE p.user_id = $1 ORDER BY r.sent_at DESC LIMIT 100`,
      [userId],
    );
    return { member, pledges: p.pledges, schedules, payments, reminders };
  }
}
