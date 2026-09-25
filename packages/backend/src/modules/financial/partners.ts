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
import { many, maybeOne, one, audit, tx, enqueueOutbox, type Queryable } from "../../db/db.js";
import type { NotificationService } from "../notifications/service.js";
import { ApiError } from "../../http/errors.js";
import type { FinancialService } from "./service.js";
import { givingTiers } from "./tiers.js";
import { methodLabel, PLEDGE_PAYS_TO_CODE, PLEDGE_PAYS_TO_JOINS, PLEDGE_PAYS_TO_NAME } from "./constants.js";
import {
  NAIROBI_OFFSET_MS, nairobiDate, keptInYear, pledgedInYear, statementSummary,
  statementImpact, statementMonths, statementFaithfulness, allocateInstalments,
  type StatementPledgeInput, type StatementImpact, type StatementMonth, type StatementFaithfulness, type LedgerPaymentInput,
} from "./partnerStatementMath.js";
import { renderPartnersStatementPdf, type PartnersStatementPledgeBlock, type PartnersStatementCommitment, type StatementGroup } from "./statementPdf.js";
import { needRaisedMinor } from "../departments/service.js";

export type PledgeShape = "monthly" | "total";
export type PledgeLabel = "on_track" | "behind" | "fulfilled" | "paused";
export type PledgeStatus = "active" | "paused" | "fulfilled" | "cancelled";

interface PledgeRow {
  pledge_id: string; user_id: string; shape: PledgeShape;
  amount_minor: string | null; target_minor: string | null; currency: string;
  due_day: number | null; due_on: string | null; until_on: string | null;
  fund_id: string | null; fund_code: string | null; fund_name: string | null;
  campaign_id: string | null; campaign_title: string | null; need_id: string | null;
  status: PledgeStatus;
  schedule_id: string | null; reminders_enabled: boolean;
  /** The member's own name for the pledge (migration 215); null = derived. */
  title: string | null;
  note: string | null;
  created_at: string; fulfilled_at: string | null; cancelled_at: string | null;
  /** Where its money is booked (constants.ts PLEDGE_PAYS_TO_* — the rule
   *  FinancialService.pledgeFundCode routes by); null only when no fund is
   *  active at all. */
  pays_to_code: string | null; pays_to_name: string | null;
}

/** What the member may point a pledge at (GET /giving/partnership). */
export interface PledgeOption {
  key: string;
  title: string;
  kind: "general" | "fund" | "campaign" | "need";
  fund?: string;
  campaign_id?: string;
  need_id?: string;
}

// Module-level (not a private static) so `pledgeTitleFor` below can share it.
// `reminderCandidates` string-replaces into this: keep "FROM pledges p" and
// "p.note, p.created_at::text" verbatim.
const PLEDGE_SELECT = `
    SELECT p.pledge_id, p.user_id, p.shape, p.amount_minor::text, p.target_minor::text, p.currency,
           p.due_day, p.due_on::text, p.until_on::text, p.fund_id, f.code AS fund_code, f.name AS fund_name,
           p.campaign_id, c.title AS campaign_title, p.need_id, p.status, p.schedule_id, p.reminders_enabled, p.title,
           p.note, p.created_at::text, p.fulfilled_at::text, p.cancelled_at::text,
           ${PLEDGE_PAYS_TO_CODE} AS pays_to_code, ${PLEDGE_PAYS_TO_NAME} AS pays_to_name
      FROM pledges p
      LEFT JOIN funds f ON f.fund_id = p.fund_id
      LEFT JOIN campaigns c ON c.campaign_id = p.campaign_id${PLEDGE_PAYS_TO_JOINS}`;

/** `PartnersService.title` as a SQL expression, for reads that join a pledge
 *  onto something else (a transaction, a claim) and want its title in the same
 *  query: the member's own name → the campaign's title → the fund's name →
 *  "A department need" → "General partnership"; NULL when there is no pledge (the
 *  pledge alias is LEFT JOINed and absent). Pass the aliases the caller's
 *  FROM clause uses for the pledges row, its fund and its campaign. */
export function pledgeTitleSql(a: { pledge: string; fund: string; campaign: string }): string {
  return `COALESCE(${a.pledge}.title, ${a.campaign}.title, ${a.fund}.name,
                   CASE WHEN ${a.pledge}.pledge_id IS NULL THEN NULL
                        WHEN ${a.pledge}.need_id IS NOT NULL THEN 'A department need'
                        ELSE 'General partnership' END)`;
}

/** The title a pledge shows — the member's own name, else the derived one.
 *  Used by the giving intent so the receipt-side of a "Pay" carries the same
 *  words the pledge card does. Null when the pledge does not exist. */
export async function pledgeTitleFor(q: Queryable, pledgeId: string): Promise<string | null> {
  const row = await maybeOne<PledgeRow>(q, `${PLEDGE_SELECT} WHERE p.pledge_id = $1`, [pledgeId]);
  return row ? PartnersService.title(row) : null;
}

export interface PledgeProgress {
  paid_minor: number;
  period_paid_minor: number | null;
  label: PledgeLabel;
  next_due: string | null;   // YYYY-MM-DD
  overdue_since: string | null;
}

/** What progressDetail knows beyond the wire `progress`: what the next due
 *  date asks for (`owed_minor` — the uncovered part of the earliest
 *  incomplete instalment; a total pledge's target − paid) and the arrears as
 *  of today — Σ uncovered of every incomplete instalment due on or before
 *  today (the catch-up amount), how many of those are overdue (their day has
 *  ended) and since when. */
interface ProgressDetail {
  progress: PledgeProgress;
  owed_minor: number | null;
  arrears: { owed_by_today_minor: number; overdue_count: number; overdue_since: string | null };
}
const NO_ARREARS: ProgressDetail["arrears"] = { owed_by_today_minor: 0, overdue_count: 0, overdue_since: null };

/** Start of a Nairobi calendar date, as an instant. (`nairobiDate` — the
 *  inverse — lives in partnerStatementMath.ts so there is ONE church calendar.) */
function nairobiStart(ymd: string): Date {
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() - NAIROBI_OFFSET_MS);
}
/** The Nairobi calendar date `days` after `ymd`. */
function addDays(ymd: string, days: number): string {
  return nairobiDate(new Date(nairobiStart(ymd).getTime() + days * 86_400_000));
}

/** One row of a statement's `payments[]`: a succeeded gift in the year,
 *  pledge-tied or not. The Give statement lists them all; the Partners view
 *  keeps only the rows with a `pledge_id` (docs/PARTNERS_PROGRAMME.md §3a). */
export interface StatementPayment {
  transaction_id: string;
  amount_minor: number;
  currency: string;
  /** When the gift was made (timestamptz text). */
  at: string;
  receipt_code: string | null;
  /** The fund the gift landed in — code and display name. */
  fund: string;
  fund_name: string;
  /** card | mpesa | airtel | paypal | manual — provider 'stripe' reads as 'card'. */
  method: string;
  pledge_id: string | null;
  /** The pledge's title under the words its card shows; null off-pledge. */
  pledge_title: string | null;
}

/** One pledge on the year's statement: its terms, plus what the §3a rule
 *  says it pledged and received in that year. */
export interface PartnerStatementPledge {
  pledge_id: string;
  title: string;
  shape: PledgeShape;
  amount_minor: number | null;
  target_minor: number | null;
  currency: string;
  status: PledgeStatus;
  due_day: number | null;
  due_on: string | null;
  created_at: string;
  pledged_minor: number;
  paid_minor: number;
  /** Monthly: its due dates elapsed through today whose instalment was paid
   *  in full (on time or late) — a month paid in two instalments counts once;
   *  = its kept_on_time + late in the per-due-date evaluation the strip reads.
   *  Total: 0. */
  kept: number;
  /** Monthly: due dates in the year elapsed through today; total: 0. */
  due_count: number;
  /** max(pledged_minor − paid_minor, 0) — what is left of this year's promise. */
  remaining_year_minor: number;
  /** A pledge toward a department need: floor(raised ÷ target × 100), capped
   *  at 100, on the raised figure the department page shows (every gift to
   *  the need, church-wide). Null for any other pledge. */
  church_progress_percent: number | null;
  /** Where this pledge's money is booked — the same `pays_to` every pledge
   *  object carries (PartnersService.paysTo). */
  pays_to: { code: string; name: string } | null;
}

/** A pledge-tied payment still in flight (processing / requires_action),
 *  made in the last 48 hours — shown as "pending", never counted. */
export interface StatementPending {
  transaction_id: string;
  amount_minor: number;
  currency: string;
  /** When the payment was started (timestamptz text). */
  at: string;
  status: "processing" | "requires_action";
  method: string;
  receipt_code: string | null;
  pledge_id: string;
  pledge_title: string;
}

/** The church-wide "since you began" line — exactly `since_you_began` from
 *  GET /giving/partnership (FinancialService.partnership). */
export interface PartnerStatementSeason {
  from: string;
  levels_completed: number;
  modules_completed: number;
  plans_finished: number;
}

/** GET /giving/statements: the giving statement for one year plus the partner
 *  view. Σ pledges[].pledged_minor = pledged_minor; Σ pledges[].paid_minor =
 *  paid_minor — the numbers foot by construction. */
export interface PartnerStatement {
  years: number[];
  year: number;
  /** Every succeeded gift in the year, pledge-tied or not. */
  total_minor: number;
  currency: string;
  pledged_minor: number;
  paid_minor: number;
  remaining_minor: number;
  by_pledge: { pledge_id: string | null; title: string; total_minor: number }[];
  by_fund: { code: string; name: string; total_minor: number }[];
  pledges: PartnerStatementPledge[];
  payments: StatementPayment[];
  /** Statement v2 (§3d): the year's pledge money in disciples carried. */
  impact: StatementImpact;
  /** Twelve months, January first — monthly pledges only. */
  months: StatementMonth[];
  faithfulness: StatementFaithfulness;
  /** Null only for a member who is not a partner. */
  season: PartnerStatementSeason | null;
  /** Pledge-tied payments of the year still in flight (processing /
   *  requires_action), started in the 48 hours before `now`, newest first.
   *  NOT counted in paid, pledged, months, faithfulness or impact. */
  pending: StatementPending[];
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** The church-calendar parts of an instant (or a bare YYYY-MM-DD, taken as
 *  the day it names). Formatting is done by hand from these so a PDF reads
 *  the same on every server, whatever its locale data or zone. */
function churchParts(v: string | Date): { y: number; m: number; d: number } {
  const ymd = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : nairobiDate(new Date(v));
  return { y: Number(ymd.slice(0, 4)), m: Number(ymd.slice(5, 7)), d: Number(ymd.slice(8, 10)) };
}
function monthName(m: number, short = false): string {
  const name = MONTH_NAMES[m - 1] ?? "";
  return short ? name.slice(0, 3) : name;
}

/** The month strip as one line of text (the Partners PDF, page 1): each
 *  month's short name and its mark — kept ✓ · late "late" · missed ✗ ·
 *  upcoming · · none – — three spaces apart, January first. */
export function monthStripLabel(months: StatementMonth[]): string {
  const mark: Record<StatementMonth["status"], string> = { kept: "✓", late: "late", missed: "✗", upcoming: "·", none: "–" };
  return months.map((x) => `${monthName(x.month, true)} ${mark[x.status]}`).join("   ");
}

export class PartnersService {
  /** `financial` is needed for creating pledges with a schedule and for the
   *  portal payload; the reminder scanner constructs this without it. */
  constructor(private readonly pool: Pool, private readonly financial?: FinancialService) {}

  private get fin(): FinancialService {
    if (!this.financial) throw new Error("PartnersService: FinancialService required for this call");
    return this.financial;
  }

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
      /** The member's own name for the pledge; absent/null = the derived title. */
      title: z.string().trim().min(2).max(60).nullish(),
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
    /** null clears the custom name (the derived title returns). */
    title: z.string().trim().min(2).max(60).nullable().optional(),
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

  private async pledgeRows(c: Queryable, where: string, params: unknown[]): Promise<PledgeRow[]> {
    return many<PledgeRow>(c, `${PLEDGE_SELECT} ${where} ORDER BY p.created_at DESC`, params);
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

  /** Every succeeded payment toward pledges matching `where` (on the joined
   *  pledges row `p` / transaction `t`), over the whole history, in payment
   *  order — what the instalment ledger reads. Scheduled charges and
   *  confirmed claims are transactions like any other gift. */
  private async pledgeHistoryWhere(where: string, params: unknown[]): Promise<LedgerPaymentInput[]> {
    const rows = await many<{ transaction_id: string; pledge_id: string; amount_minor: string; at: string }>(
      this.pool,
      `SELECT t.transaction_id, t.pledge_id, t.amount_minor::text, t.created_at::text AS at
         FROM transactions t JOIN pledges p ON p.pledge_id = t.pledge_id
        WHERE ${where} AND t.status = 'succeeded'
        ORDER BY t.created_at, t.transaction_id`,
      params,
    );
    return rows.map((r) => ({ transaction_id: r.transaction_id, pledge_id: r.pledge_id, amount_minor: Number(r.amount_minor), at: r.at }));
  }

  /** A pledge's progress, plus what its next due date asks for: `owed_minor`
   *  = monthly — the uncovered part of its earliest incomplete instalment;
   *  total — target − paid; null when nothing is asked (paused, cancelled,
   *  fulfilled). The DUE list, the reminders and the office's reminder all
   *  ask for exactly this.
   *
   *  A MONTHLY pledge reads ONE instalment ledger (partnerStatementMath
   *  allocateInstalments, owner-delegated 2026-09-25) — the same one its
   *  statement reads: next_due = its earliest incomplete instalment (overdue,
   *  today or ahead); behind = any instalment missed (overdue_since = the
   *  earliest); period_paid_minor = what is allocated to the instalment due in
   *  the current calendar month (0 when none falls this month) — so right
   *  after paying this month the card reads full, and a late payment that
   *  settles last month does not also fill this one. A total pledge is
   *  unchanged. Paused / cancelled read "paused" with nothing due (pause
   *  history is not recorded — a known limit: past due dates of a pledge that
   *  was paused for a while are still evaluated once it is active again). */
  private async progressDetail(p: PledgeRow, now: Date = new Date()): Promise<ProgressDetail> {
    const today = nairobiDate(now);
    if (p.shape === "monthly") {
      const history = await this.pledgeHistoryWhere(`t.pledge_id = $1`, [p.pledge_id]);
      const paid = history.reduce((a, x) => a + x.amount_minor, 0);
      if (p.status === "paused" || p.status === "cancelled") {
        return { progress: { paid_minor: paid, period_paid_minor: null, label: "paused", next_due: null, overdue_since: null }, owed_minor: null, arrears: NO_ARREARS };
      }
      const ledger = allocateInstalments(PartnersService.statementInput(p), history, today);
      const thisMonth = ledger.find((i) => i.due.slice(0, 7) === today.slice(0, 7));
      const periodPaid = thisMonth?.covered_minor ?? 0;
      if (p.until_on && today > p.until_on) {
        return { progress: { paid_minor: paid, period_paid_minor: periodPaid, label: "fulfilled", next_due: null, overdue_since: null }, owed_minor: null, arrears: NO_ARREARS };
      }
      const next = ledger.find((i) => i.completed_on === null) ?? null;
      const missed = ledger.find((i) => i.status === "missed") ?? null;
      // Everything owed by today: every incomplete instalment due on or before
      // it (the oldest may be part-covered — the ledger fills oldest-first).
      const owedByToday = ledger.filter((i) => i.completed_on === null && i.due <= today);
      const overdue = owedByToday.filter((i) => i.due < today);
      return {
        arrears: {
          owed_by_today_minor: owedByToday.reduce((a, i) => a + (i.amount_minor - i.covered_minor), 0),
          overdue_count: overdue.length,
          overdue_since: overdue[0]?.due ?? null,
        },
        progress: {
          paid_minor: paid,
          period_paid_minor: periodPaid,
          label: missed ? "behind" : "on_track",
          next_due: next?.due ?? null,
          overdue_since: missed?.due ?? null,
        },
        owed_minor: next ? next.amount_minor - next.covered_minor : null,
      };
    }

    const paid = await this.paidBetween(p.pledge_id, null, null);
    if (p.status === "paused" || p.status === "cancelled") {
      return { progress: { paid_minor: paid, period_paid_minor: null, label: "paused", next_due: null, overdue_since: null }, owed_minor: null, arrears: NO_ARREARS };
    }
    const target = Number(p.target_minor ?? 0);
    if (p.status === "fulfilled" || paid >= target) {
      return { progress: { paid_minor: paid, period_paid_minor: null, label: "fulfilled", next_due: null, overdue_since: null }, owed_minor: null, arrears: NO_ARREARS };
    }
    // A total pledge is one instalment: the rest of the target, due on due_on.
    const behind = p.due_on !== null && today > p.due_on;
    const owed = Math.max(0, target - paid);
    return {
      progress: { paid_minor: paid, period_paid_minor: null, label: behind ? "behind" : "on_track", next_due: p.due_on, overdue_since: behind ? p.due_on : null },
      owed_minor: owed,
      arrears: {
        owed_by_today_minor: p.due_on !== null && p.due_on <= today ? owed : 0,
        overdue_count: behind ? 1 : 0,
        overdue_since: behind ? p.due_on : null,
      },
    };
  }

  async progress(p: PledgeRow, now: Date = new Date()): Promise<PledgeProgress> {
    return (await this.progressDetail(p, now)).progress;
  }

  private async shape(p: PledgeRow, now = new Date()): Promise<Record<string, unknown>> {
    return this.shapeRow(p, await this.progress(p, now));
  }

  /** The wire `Pledge` for a row whose progress is already known. */
  private shapeRow(p: PledgeRow, progress: PledgeProgress): Record<string, unknown> {
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
      custom_title: p.title,
      pays_to: PartnersService.paysTo(p),
    };
  }

  /** Where this pledge's money is booked — `{code, name}` of the fund
   *  FinancialService.pledgeFundCode routes it to (one SQL rule, read in the
   *  same query as the pledge: no extra round trip). Null only when no fund
   *  is active at all (a gift toward it would be refused). */
  static paysTo(p: PledgeRow): { code: string; name: string } | null {
    return p.pays_to_code ? { code: p.pays_to_code, name: p.pays_to_name ?? p.pays_to_code } : null;
  }

  /** The member's own name when they gave one, else derived from the target. */
  static title(p: PledgeRow): string {
    if (p.title) return p.title;
    if (p.campaign_title) return p.campaign_title;
    if (p.fund_name) return p.fund_name;
    if (p.need_id) return "A department need";
    return "General partnership";
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
      `INSERT INTO pledges (user_id, shape, amount_minor, target_minor, currency, due_day, due_on, until_on, fund_id, campaign_id, need_id, note, reminders_enabled, title)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING pledge_id`,
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
        input.title ?? null,
      ],
    );
    await audit(this.pool, userId, "pledge.created", "pledges", row.pledge_id, { shape: input.shape });

    // "Charge me automatically": a schedule bound to this pledge. Its fund is
    // the pledge's own (server-authoritative, one rule with gifts and claims).
    if (input.auto_schedule && input.shape === "monthly" && input.amount_minor) {
      const fundCode = await this.fin.pledgeFundCode(row.pledge_id);
      await this.fin.createSchedule(userId, {
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
    if (patch.title !== undefined) push("title", patch.title); // null clears the custom name
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

  /** Everything a member may point a new pledge at, in the order the picker
   *  shows it: general partnership, then active funds by name, then the
   *  campaigns live today in their congregation (the same predicate the
   *  invitation engine uses), then that congregation's approved department
   *  needs. Keys are stable and client-parseable: `fund:<code>`,
   *  `campaign:<id>`, `need:<id>`. */
  async pledgeOptions(userId: string, now = new Date()): Promise<PledgeOption[]> {
    const who = await one<{ congregation_id: string }>(this.pool, `SELECT congregation_id FROM users WHERE user_id = $1`, [userId]);
    const today = nairobiDate(now);
    const funds = await many<{ code: string; name: string }>(this.pool, `SELECT code, name FROM funds WHERE is_active ORDER BY name, code`, []);
    const campaigns = await many<{ campaign_id: string; title: string }>(
      this.pool,
      `SELECT campaign_id, title FROM campaigns
        WHERE congregation_id = $1 AND status = 'live'
          AND starts_on <= $2::date AND ends_on >= $2::date
        ORDER BY ends_on, title`,
      [who.congregation_id, today],
    );
    const needs = await many<{ need_id: string; title: string }>(
      this.pool,
      `SELECT n.need_id, n.title FROM department_needs n
         JOIN departments d ON d.department_id = n.department_id
        WHERE n.status = 'approved' AND d.status = 'active' AND d.congregation_id = $1
        ORDER BY n.created_at DESC`,
      [who.congregation_id],
    );
    return [
      { key: "general", title: "General partnership", kind: "general" },
      ...funds.map((f): PledgeOption => ({ key: `fund:${f.code}`, title: f.name, kind: "fund", fund: f.code })),
      ...campaigns.map((c): PledgeOption => ({ key: `campaign:${c.campaign_id}`, title: c.title, kind: "campaign", campaign_id: c.campaign_id })),
      ...needs.map((n): PledgeOption => ({ key: `need:${n.need_id}`, title: n.title, kind: "need", need_id: n.need_id })),
    ];
  }

  async partnership(userId: string, now = new Date()): Promise<Record<string, unknown>> {
    const base = (await this.fin.partnership(userId)) as Record<string, unknown>;
    const membership = await this.membership(userId);
    const pledgeOptions = await this.pledgeOptions(userId, now);
    // The pledges (as listPledges shapes them) and, from the same progress,
    // the DUE rows: an active pledge is due when its next instalment is
    // overdue, due today, or due within DUE_WINDOW_DAYS — asking for what is
    // still owed on it (a partial payment reduces it), so a pledge the member
    // has just paid leaves the list. A total pledge keeps its own rule: due
    // until fulfilled, for target − paid.
    const today = nairobiDate(now);
    const window = addDays(today, PartnersService.DUE_WINDOW_DAYS);
    const inFlight = await this.inFlightByPledge(userId, now);
    const pledges: Record<string, unknown>[] = [];
    const due: Record<string, unknown>[] = [];
    for (const r of await this.pledgeRows(this.pool, `WHERE p.user_id = $1 AND p.status <> 'cancelled'`, [userId])) {
      const { progress: pr, owed_minor, arrears } = await this.progressDetail(r, now);
      const shaped = this.shapeRow(r, pr);
      pledges.push(shaped);
      if (r.status !== "active" || !pr.next_due) continue;
      // Overdue or due today → the row asks for the whole catch-up (every
      // incomplete instalment due by today, so one payment brings the member
      // level); otherwise the next instalment, within the week, as before.
      const dueNow = pr.next_due <= today;
      if (r.shape === "monthly" && !dueNow && pr.next_due > window) continue;
      due.push({
        kind: "pledge", id: r.pledge_id, title: shaped.title, currency: r.currency,
        amount_minor: dueNow ? arrears.owed_by_today_minor : owed_minor,
        due_on: pr.next_due,
        action: "pay", overdue: arrears.overdue_count > 0,
        overdue_count: arrears.overdue_count,
        overdue_since: arrears.overdue_since,
        pays_to: shaped.pays_to,
        // A payment toward it still in its checkout window: clients show
        // "Processing" instead of Pay while this covers amount_minor.
        pending_minor: inFlight.get(r.pledge_id) ?? 0,
      });
    }
    const committedMonthly = pledges
      .filter((p) => p.shape === "monthly" && p.status === "active")
      .reduce((a, p) => a + Number(p.amount_minor ?? 0), 0);
    const rhythmMonthly = (() => {
      const r = base.rhythm as { frequency?: string; amount_minor?: number } | undefined;
      if (!r || !r.amount_minor) return 0;
      return r.frequency === "weekly" ? r.amount_minor * 4 : r.amount_minor;
    })();
    const monthly = committedMonthly || rhythmMonthly;
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
      pledge_options: pledgeOptions,
    };
  }

  // ── statements ────────────────────────────────────────────────────────

  /** The giving statement for one year with the partner view on top of it
   *  (docs/PARTNERS_PROGRAMME.md §3a): every succeeded gift (`payments`, by
   *  pledge and by fund) as before, plus Pledged / Paid / Remaining and a row
   *  per pledge — computed here by the same pure rule both apps implement
   *  (partnerStatementMath.ts), so no client ever has to derive them. `now`
   *  is injectable for tests: "due dates elapsed" reads the church's today. */
  async statements(userId: string, year?: number, now: Date = new Date()): Promise<PartnerStatement> {
    const years = await many<{ y: number }>(
      this.pool,
      `SELECT DISTINCT extract(year from created_at AT TIME ZONE 'Africa/Nairobi')::int AS y
         FROM transactions WHERE user_id = $1 AND status = 'succeeded' ORDER BY y DESC`,
      [userId],
    );
    const ys = years.map((r) => r.y);
    const y = year ?? ys[0] ?? Number(nairobiDate(now).slice(0, 4));
    const rows = await many<{ transaction_id: string; amount_minor: string; currency: string; at: string; receipt_code: string | null; fund: string; fund_name: string; provider: string | null; pledge_id: string | null; pledge_title: string | null }>(
      this.pool,
      `SELECT t.transaction_id, t.amount_minor::text, t.currency, t.created_at::text AS at, t.receipt_code, f.code AS fund, f.name AS fund_name,
              t.provider, t.pledge_id, ${pledgeTitleSql({ pledge: "p", fund: "pf", campaign: "c" })} AS pledge_title
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
    // `provider` is 'stripe' for cards; the wire says 'card' — one rule with
    // listGiving and givingDetail.
    const payments: StatementPayment[] = rows.map((r) => {
      const provider = r.provider ?? "stripe";
      return {
        transaction_id: r.transaction_id, amount_minor: Number(r.amount_minor), currency: r.currency, at: r.at,
        receipt_code: r.receipt_code, fund: r.fund, fund_name: r.fund_name,
        method: provider === "stripe" ? "card" : provider,
        pledge_id: r.pledge_id, pledge_title: r.pledge_title,
      };
    });
    const byPledge = new Map<string, { pledge_id: string | null; title: string; total_minor: number }>();
    const byFund = new Map<string, { code: string; name: string; total_minor: number }>();
    let total = 0;
    for (const r of payments) {
      total += r.amount_minor;
      const pk = r.pledge_id ?? "none";
      const pe = byPledge.get(pk) ?? { pledge_id: r.pledge_id, title: r.pledge_title ?? "Gifts outside a pledge", total_minor: 0 };
      pe.total_minor += r.amount_minor; byPledge.set(pk, pe);
      const fe = byFund.get(r.fund) ?? { code: r.fund, name: r.fund_name, total_minor: 0 };
      fe.total_minor += r.amount_minor; byFund.set(r.fund, fe);
    }

    // The pledges this year's statement is about: every one not cancelled
    // (the rule reads them all — a paused or fulfilled pledge still counts),
    // plus any cancelled pledge that still received a payment this year, so
    // every pledge-tied payment has a row and Σ pledges[].paid_minor foots to
    // paid_minor exactly. Newest first, like the pledge list.
    const paidPledgeIds = [...new Set(payments.flatMap((x) => (x.pledge_id ? [x.pledge_id] : [])))];
    const pledgeRows = await this.pledgeRows(
      this.pool,
      `WHERE p.user_id = $1 AND (p.status <> 'cancelled' OR p.pledge_id = ANY($2::uuid[]))`,
      [userId, paidPledgeIds],
    );
    const today = nairobiDate(now);
    const inputs = pledgeRows.map(PartnersService.statementInput);
    const needPercent = await this.needProgressPercents(pledgeRows);
    // The instalment ledger reads each pledge's succeeded payments over its
    // WHOLE history: a payment in one year can settle or pre-pay an
    // instalment in another. (`payments` above are only this year's gifts.)
    const history = await this.pledgeHistoryWhere(`p.user_id = $1`, [userId]);
    const pledges: PartnerStatementPledge[] = pledgeRows.map((p, i) => {
      const input = inputs[i]!;
      const { kept, due_count } = keptInYear(input, history, y, today);
      const pledged = pledgedInYear(input, y);
      const paid = payments.filter((x) => x.pledge_id === p.pledge_id).reduce((a, x) => a + x.amount_minor, 0);
      return {
        pledge_id: p.pledge_id,
        title: PartnersService.title(p),
        shape: p.shape,
        amount_minor: input.amount_minor,
        target_minor: input.target_minor,
        currency: p.currency,
        status: p.status,
        due_day: p.due_day,
        due_on: p.due_on,
        created_at: p.created_at,
        pledged_minor: pledged,
        paid_minor: paid,
        kept,
        due_count,
        remaining_year_minor: Math.max(pledged - paid, 0),
        church_progress_percent: p.need_id ? (needPercent.get(p.need_id) ?? null) : null,
        pays_to: PartnersService.paysTo(p),
      };
    });
    const summary = statementSummary(y, inputs, payments);
    const months = statementMonths(y, inputs, history, today);
    return {
      years: ys,
      year: y,
      total_minor: total,
      currency: payments[0]?.currency ?? "KES",
      pledged_minor: summary.pledged_minor,
      paid_minor: summary.paid_minor,
      remaining_minor: summary.remaining_minor,
      by_pledge: [...byPledge.values()],
      by_fund: [...byFund.values()],
      pledges,
      payments,
      impact: statementImpact(summary.paid_minor),
      months,
      faithfulness: statementFaithfulness(y, inputs, history, today),
      season: await this.season(userId),
      pending: await this.pendingPledgePayments(userId, y, now),
    };
  }

  /** The year's pledge-tied payments still in flight — status processing or
   *  requires_action (txn_status's non-final values), started within the 48
   *  hours before `now` — newest first. A payment the member just made shows
   *  as pending until its callback lands; one stuck longer than two days is
   *  not "pending" any more, it is abandoned, and is left out. */
  private async pendingPledgePayments(userId: string, year: number, now: Date): Promise<StatementPending[]> {
    const rows = await many<{ transaction_id: string; amount_minor: string; currency: string; at: string; status: "processing" | "requires_action"; provider: string | null; receipt_code: string | null; pledge_id: string; pledge_title: string }>(
      this.pool,
      `SELECT t.transaction_id, t.amount_minor::text, t.currency, t.created_at::text AS at, t.status::text AS status,
              t.provider, t.receipt_code, t.pledge_id, ${pledgeTitleSql({ pledge: "p", fund: "pf", campaign: "c" })} AS pledge_title
         FROM transactions t
         JOIN pledges p ON p.pledge_id = t.pledge_id
         LEFT JOIN funds pf ON pf.fund_id = p.fund_id
         LEFT JOIN campaigns c ON c.campaign_id = p.campaign_id
        WHERE t.user_id = $1 AND t.status IN ('processing', 'requires_action')
          AND extract(year from t.created_at AT TIME ZONE 'Africa/Nairobi') = $2
          AND t.created_at >= $3::timestamptz - interval '48 hours'
        ORDER BY t.created_at DESC`,
      [userId, year, now.toISOString()],
    );
    return rows.map((r) => {
      const provider = r.provider ?? "stripe";
      return {
        transaction_id: r.transaction_id, amount_minor: Number(r.amount_minor), currency: r.currency, at: r.at,
        status: r.status, method: provider === "stripe" ? "card" : provider, receipt_code: r.receipt_code,
        pledge_id: r.pledge_id, pledge_title: r.pledge_title,
      };
    });
  }

  /** The statement's season. A partner with a recurring gift: exactly
   *  `since_you_began` from the partnership payload. A partner without one
   *  (programme membership, pledges only): from the earliest of their
   *  membership's joined_at and any schedule they ever started, with the same
   *  church-wide counts (FinancialService.churchSince). Null only for a member
   *  who is not a partner — /giving/partnership's `is_partner` (an
   *  active/paused recurring gift, or an active membership). pg hands dates
   *  back as Date; the wire (like /giving/partnership's JSON) is ISO text. */
  private async season(userId: string): Promise<PartnerStatementSeason | null> {
    const base = await this.fin.partnership(userId);
    const s = base.since_you_began as { from: Date | string; levels_completed: number; modules_completed: number; plans_finished: number } | null | undefined;
    if (s) {
      return {
        from: s.from instanceof Date ? s.from.toISOString() : new Date(s.from).toISOString(),
        levels_completed: s.levels_completed,
        modules_completed: s.modules_completed,
        plans_finished: s.plans_finished,
      };
    }
    const membership = await this.membership(userId);
    if (!(Boolean(base.is_partner) || membership?.status === "active")) return null;
    const began = await one<{ since: Date | null }>(
      this.pool,
      `SELECT LEAST((SELECT joined_at FROM partner_memberships WHERE user_id = $1),
                    (SELECT min(created_at) FROM giving_schedules WHERE user_id = $1)) AS since`,
      [userId],
    );
    // An active membership always has a joined_at, so this is unreachable;
    // if the data ever says otherwise, say nothing rather than invent a date.
    if (!began.since) return null;
    const church = await this.fin.churchSince(began.since);
    return {
      from: new Date(began.since).toISOString(),
      levels_completed: church.levels,
      modules_completed: church.modules,
      plans_finished: church.plans,
    };
  }

  /** need_id → floor(raised ÷ target × 100), capped at 100, for the needs
   *  these pledges point at. Raised is the department page's own figure
   *  (needRaisedMinor), so the two screens can never disagree about it. A
   *  need with no positive target has no percent (absent → null). */
  private async needProgressPercents(rows: PledgeRow[]): Promise<Map<string, number>> {
    const ids = [...new Set(rows.flatMap((r) => (r.need_id ? [r.need_id] : [])))];
    const out = new Map<string, number>();
    if (ids.length === 0) return out;
    const needs = await many<{ need_id: string; target_minor: string }>(
      this.pool,
      `SELECT need_id, target_minor::text FROM department_needs WHERE need_id = ANY($1::uuid[])`,
      [ids],
    );
    for (const n of needs) {
      const target = Number(n.target_minor);
      if (!(target > 0)) continue;
      const raised = await needRaisedMinor(this.pool, n.need_id);
      out.set(n.need_id, Math.min(100, Math.floor((raised * 100) / target)));
    }
    return out;
  }

  /** A pledge row as the statement rule reads it (numbers, not text). */
  private static statementInput(p: PledgeRow): StatementPledgeInput {
    return {
      pledge_id: p.pledge_id,
      shape: p.shape,
      amount_minor: p.amount_minor === null ? null : Number(p.amount_minor),
      target_minor: p.target_minor === null ? null : Number(p.target_minor),
      status: p.status,
      due_day: p.due_day,
      due_on: p.due_on,
      created_at: p.created_at,
    };
  }

  /** Has this member EVER been a partner, in any sense the product has used:
   *  a programme membership (any status), a pledge (any status), or a
   *  recurring gift (phase 1's meaning — active, paused or cancelled)? */
  private async everPartnered(userId: string): Promise<boolean> {
    const r = await one<{ member: boolean; pledged: boolean; scheduled: boolean }>(
      this.pool,
      `SELECT EXISTS (SELECT 1 FROM partner_memberships WHERE user_id = $1) AS member,
              EXISTS (SELECT 1 FROM pledges WHERE user_id = $1) AS pledged,
              EXISTS (SELECT 1 FROM giving_schedules WHERE user_id = $1) AS scheduled`,
      [userId],
    );
    return r.member || r.pledged || r.scheduled;
  }

  /** The Partners statement for `year` as a two-page PDF
   *  (docs/PARTNERS_PROGRAMME.md §3a, §3d). Page 1: the thank-you, the three
   *  figures (disciples carried — or progress toward the first, never "0
   *  disciples"; kept N of M; given toward pledges), the month strip and the
   *  commitments with what remains this year. Page 2: the ledger — the
   *  summary, one block per pledge, the pledge-tied payments by month. Gifts
   *  outside a pledge are not on it — the giving statement has them.
   *  Default year = the current Nairobi year. NOT_FOUND for a member who has
   *  never been a partner (everPartnered): there is nothing to state, and the
   *  route answers 404 rather than an empty page. */
  async partnersStatementPdf(userId: string, year?: number, now: Date = new Date()): Promise<{ year: number; pdf: Buffer }> {
    if (!(await this.everPartnered(userId))) throw new ApiError("NOT_FOUND", "Not a partner");
    const y = year ?? Number(nairobiDate(now).slice(0, 4));
    const me = await maybeOne<{ full_name: string; congregation: string | null }>(
      this.pool,
      `SELECT u.full_name, c.name AS congregation FROM users u LEFT JOIN congregations c ON c.congregation_id = u.congregation_id WHERE u.user_id = $1`,
      [userId],
    );
    const standing = await this.partnership(userId, now);
    const st = await this.statements(userId, y, now);

    const money = (minor: number, currency: string): string =>
      `${currency === "KES" ? "KSh" : currency} ${(minor / 100).toLocaleString("en-US")}`;
    const ordinal = (n: number): string => {
      const s = ["th", "st", "nd", "rd"] as const;
      const v = n % 100;
      return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
    };
    // "15 Dec" inside the statement year, "15 Jan 2027" outside it.
    const dayLabel = (v: string): string => {
      const { y: yy, m, d } = churchParts(v);
      return yy === y ? `${d} ${monthName(m, true)}` : `${d} ${monthName(m, true)} ${yy}`;
    };
    const cap = (s: string): string => (s[0]?.toUpperCase() ?? "") + s.slice(1);

    // "Partner since Mar 2026": the programme membership's join date, else the
    // recurring gift's start — the same words both apps print.
    const membership = standing.membership as { joined_at: string } | null;
    const sinceAt = (membership?.joined_at ?? standing.since ?? null) as string | Date | null;
    const tier = standing.tier as { name: string } | null;

    const termsLabel = (p: PartnerStatementPledge): string => p.shape === "monthly"
      ? `${money(p.amount_minor ?? 0, p.currency)} monthly · due on the ${ordinal(p.due_day ?? 1)}`
      : `${money(p.target_minor ?? 0, p.currency)} by ${p.due_on ? dayLabel(p.due_on) : "-"}`;
    const pledges: PartnersStatementPledgeBlock[] = st.pledges.map((p) => ({
      title: p.title,
      termsLabel: termsLabel(p),
      statusLabel: cap(p.status),
      paidLabel: `Paid this year ${money(p.paid_minor, p.currency)}`,
      keptLabel: p.shape === "monthly" ? (p.due_count > 0 ? `${p.kept} of ${p.due_count} kept` : "Nothing due yet this year") : null,
    }));

    // Pledge-tied payments only, by month, January first — a year reads top-down.
    const tied = st.payments.filter((x) => x.pledge_id !== null);
    const byMonth = new Map<string, StatementPayment[]>();
    for (const x of tied) {
      const k = nairobiDate(new Date(x.at)).slice(0, 7); // YYYY-MM
      (byMonth.get(k) ?? byMonth.set(k, []).get(k)!).push(x);
    }
    const groups: StatementGroup[] = [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, recs]) => {
        const asc = [...recs].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
        const first = churchParts(asc[0]!.at);
        return {
          label: `${monthName(first.m).toUpperCase()} ${first.y}`,
          totalLabel: money(asc.reduce((s, r) => s + r.amount_minor, 0), asc[0]!.currency),
          rows: asc.map((r) => {
            const ref = (r.receipt_code ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
            return `${dayLabel(r.at)}  ${r.pledge_title ?? "Pledge"}  ${methodLabel(r.method)}${ref ? `  Ref ${ref}` : ""}  ${money(r.amount_minor, r.currency)}`;
          }),
        };
      });

    // Page 1 (§3d): what the partnership did. Never "0 disciples" — below the
    // first, progress toward it; the costing is tiers.ts's, rounded down.
    const im = st.impact;
    const impactLabel = im.disciples_carried >= 1
      ? `Carries ${im.disciples_carried === 1 ? "one disciple" : `${im.disciples_carried} disciples`} through a level${im.toward_next_minor > 0 ? ` · ${money(im.toward_next_minor, st.currency)} toward the next` : ""}`
      : `${money(im.toward_next_minor, st.currency)} of ${(im.per_disciple_minor / 100).toLocaleString("en-US")} toward carrying one disciple through a level`;
    // One definition of kept (§3d): paid in full, on time or late — say how
    // many were late. Foots with page 2's per-pledge "N of M kept".
    const fa = st.faithfulness;
    const keptLabel = fa.due_count > 0
      ? `Kept ${fa.kept_on_time + fa.late} of ${fa.due_count}${fa.late > 0 ? ` · ${fa.late} late` : ""}`
      : st.months.some((x) => x.status === "upcoming") ? "Nothing due yet this year" : `No monthly instalments in ${y}`;
    const firstName = (me?.full_name ?? "").trim().split(/\s+/)[0] ?? "";
    const commitments: PartnersStatementCommitment[] = st.pledges
      .filter((p) => p.status !== "cancelled")
      .map((p) => ({
        title: p.title,
        termsLabel: termsLabel(p),
        remainingLabel: `Remaining this year ${money(p.remaining_year_minor, p.currency)}`,
        churchLabel: p.church_progress_percent === null ? null : `The church is ${p.church_progress_percent}% of the way there`,
      }));

    const gen = churchParts(now);
    const pdf = renderPartnersStatementPdf({
      thanksLabel: firstName ? `Thank you, ${firstName}.` : "Thank you.",
      impactLabel,
      keptLabel,
      givenLabel: `Given ${money(st.paid_minor, st.currency)} toward pledges`,
      stripLabel: monthStripLabel(st.months),
      commitments,
      year: y,
      congregation: me?.congregation ?? "Nuru Place Church",
      member: me?.full_name ?? "",
      sinceLabel: sinceAt ? `Partner since ${monthName(churchParts(sinceAt).m, true)} ${churchParts(sinceAt).y}` : null,
      tierName: tier?.name ?? null,
      pledgedLabel: money(st.pledged_minor, st.currency),
      paidLabel: money(st.paid_minor, st.currency),
      remainingLabel: money(st.remaining_minor, st.currency),
      pledges,
      groups,
      totalLabel: money(st.paid_minor, st.currency),
      count: tied.length,
      generatedAt: `${gen.d} ${monthName(gen.m)} ${gen.y}`,
    });
    return { year: y, pdf };
  }


  // ── phase 2: reminders ────────────────────────────────────────────────

  static readonly DUE_SOON_DAYS = 3;
  /** A monthly pledge shows in the DUE list this many days before its next
   *  instalment (and whenever it is due today or overdue). */
  static readonly DUE_WINDOW_DAYS = 7;
  /** A pledge payment still processing / requiring action counts as "in
   *  flight" on the DUE row for this long — the STK push / checkout window.
   *  Deliberately far shorter than the statement's 48 h `pending[]`, so an
   *  abandoned checkout never stops the member paying another way. */
  static readonly IN_FLIGHT_MINUTES = 15;

  /** pledge_id → Σ amount of the member's pledge payments still processing
   *  or requiring action, started within IN_FLIGHT_MINUTES before `now`. One
   *  query for all their pledges. */
  private async inFlightByPledge(userId: string, now: Date): Promise<Map<string, number>> {
    const rows = await many<{ pledge_id: string; total: string }>(
      this.pool,
      `SELECT t.pledge_id, sum(t.amount_minor)::text AS total
         FROM transactions t JOIN pledges p ON p.pledge_id = t.pledge_id
        WHERE p.user_id = $1 AND t.status IN ('processing', 'requires_action')
          AND t.created_at > $2::timestamptz - make_interval(mins => $3)
          AND t.created_at <= $2::timestamptz
        GROUP BY t.pledge_id`,
      [userId, now.toISOString(), PartnersService.IN_FLIGHT_MINUTES],
    );
    return new Map(rows.map((r) => [r.pledge_id, Number(r.total)]));
  }
  static readonly FOLLOW_UP_HOURS = 12;
  static readonly FOLLOW_UPS = 3;

  /** Every open pledge whose owner still wants reminders, with progress and
   *  what its next due date asks for. For a monthly pledge both come from its
   *  instalment ledger: "due soon" is about the earliest INCOMPLETE
   *  instalment, and follow-ups last only while that same instalment stays
   *  incomplete — once it is completed (on time, late, or by a spill-over)
   *  next_due moves on and nothing more is sent for it. */
  async reminderCandidates(now = new Date()): Promise<Array<{ row: PledgeRow; progress: PledgeProgress; owed_minor: number | null; timezone: string }>> {
    const rows = await many<PledgeRow & { timezone: string | null }>(
      this.pool,
      `${PLEDGE_SELECT.replace("FROM pledges p", "FROM pledges p JOIN users u ON u.user_id = p.user_id LEFT JOIN partner_memberships pm ON pm.user_id = p.user_id")}
        WHERE p.status = 'active' AND p.reminders_enabled AND COALESCE(pm.reminders_enabled, TRUE)`.replace("p.note, p.created_at::text", "p.note, u.timezone, p.created_at::text"),
      [],
    );
    const out: Array<{ row: PledgeRow; progress: PledgeProgress; owed_minor: number | null; timezone: string }> = [];
    for (const r of rows) {
      const d = await this.progressDetail(r, now);
      out.push({ row: r, progress: d.progress, owed_minor: d.owed_minor, timezone: r.timezone ?? "Africa/Nairobi" });
    }
    return out;
  }

  private async lastReminderAt(pledgeId: string): Promise<Date | null> {
    const r = await maybeOne<{ sent_at: string }>(this.pool, `SELECT max(sent_at)::text AS sent_at FROM pledge_reminders WHERE pledge_id = $1`, [pledgeId]);
    return r?.sent_at ? new Date(r.sent_at) : null;
  }

  private async autoSent(pledgeId: string, dueOn: string, sequence: number): Promise<boolean> {
    const r = await maybeOne(this.pool, `SELECT 1 FROM pledge_reminders WHERE pledge_id = $1 AND due_on = $2 AND sequence = $3 AND kind = 'auto'`, [pledgeId, dueOn, sequence]);
    return r !== null;
  }

  /** Fan one reminder out on every channel; the notification service applies
   *  the member's preferences, quiet hours and daily cap per channel. */
  private async fanOut(notifications: NotificationService, userId: string, template: string, payload: Record<string, unknown>, timezone: string): Promise<string[]> {
    const sent: string[] = [];
    for (const channel of ["push", "sms", "email"] as const) {
      const r = await notifications.schedule({ userId, channel, template, payload, timezone });
      if (r.status !== "suppressed") sent.push(channel);
    }
    return sent;
  }

  /** One pass: due-soon notices and overdue follow-ups. Idempotent. */
  async sendDueReminders(notifications: NotificationService, now = new Date()): Promise<{ due_soon: number; follow_ups: number }> {
    let dueSoon = 0, followUps = 0;
    const today = nairobiDate(now);
    for (const { row, progress, owed_minor, timezone } of await this.reminderCandidates(now)) {
      if (!progress.next_due || progress.label === "fulfilled" || progress.label === "paused") continue;
      const dueOn = progress.next_due;
      // What is still owed on that due date (a partial payment reduces it).
      const amount = owed_minor ?? 0;
      const payload = { pledge_id: row.pledge_id, title: PartnersService.title(row), amount_minor: amount, currency: row.currency, due_on: dueOn };

      if (!progress.overdue_since) {
        // Due soon: once, within the window before the due date.
        const daysAway = Math.round((nairobiStart(dueOn).getTime() - nairobiStart(today).getTime()) / 86_400_000);
        if (daysAway < 0 || daysAway > PartnersService.DUE_SOON_DAYS) continue;
        if (await this.autoSent(row.pledge_id, dueOn, 0)) continue;
        const channels = await this.fanOut(notifications, row.user_id, "pledge_due_soon", { ...payload, days_away: daysAway }, timezone);
        await this.pool.query(`INSERT INTO pledge_reminders (pledge_id, due_on, sequence, kind, channel, sent_at) VALUES ($1, $2, 0, 'auto', $3, $4) ON CONFLICT DO NOTHING`, [row.pledge_id, dueOn, channels.join(",") || "none", now.toISOString()]);
        dueSoon += 1;
        continue;
      }

      // Overdue: follow-ups at +12 h, +24 h, +36 h after the due day ends, then silence.
      const dueEnd = nairobiStart(dueOn).getTime() + 86_400_000;
      for (let seq = 1; seq <= PartnersService.FOLLOW_UPS; seq++) {
        const at = dueEnd + seq * PartnersService.FOLLOW_UP_HOURS * 3_600_000;
        if (now.getTime() < at) break;
        if (await this.autoSent(row.pledge_id, dueOn, seq)) continue;
        const last = await this.lastReminderAt(row.pledge_id);
        if (last && now.getTime() - last.getTime() < PartnersService.FOLLOW_UP_HOURS * 3_600_000) break; // spacing against ANY reminder
        const channels = await this.fanOut(notifications, row.user_id, "pledge_overdue", { ...payload, sequence: seq, of: PartnersService.FOLLOW_UPS }, timezone);
        await this.pool.query(`INSERT INTO pledge_reminders (pledge_id, due_on, sequence, kind, channel, sent_at) VALUES ($1, $2, $3, 'auto', $4, $5) ON CONFLICT DO NOTHING`, [row.pledge_id, dueOn, seq, channels.join(",") || "none", now.toISOString()]);
        followUps += 1;
        break; // one step per pass; the next pass sends the next step
      }
    }
    return { due_soon: dueSoon, follow_ups: followUps };
  }

  /** Total pledges that reached their target flip to fulfilled, once, with a thank-you. */
  async fulfilCompleted(notifications: NotificationService, now = new Date()): Promise<number> {
    const rows = await this.pledgeRows(this.pool, `WHERE p.status = 'active' AND p.shape = 'total'`, []);
    let n = 0;
    for (const r of rows) {
      const pr = await this.progress(r, now);
      if (pr.label !== "fulfilled") continue;
      const done = await this.pool.query(`UPDATE pledges SET status = 'fulfilled', fulfilled_at = now(), updated_at = now() WHERE pledge_id = $1 AND status = 'active'`, [r.pledge_id]);
      if (!done.rowCount) continue;
      await this.fanOut(notifications, r.user_id, "pledge_fulfilled", { pledge_id: r.pledge_id, title: PartnersService.title(r), target_minor: Number(r.target_minor), currency: r.currency }, "Africa/Nairobi");
      await audit(this.pool, r.user_id, "pledge.fulfilled", "pledges", r.pledge_id, {});
      n += 1;
    }
    return n;
  }

  /** The office reminds one partner (optionally one pledge). Spaced 12 h from ANY reminder. */
  async adminRemind(adminId: string, userId: string, notifications: NotificationService, opts: { pledge_id?: string | null | undefined; message?: string | null | undefined } = {}, now = new Date()): Promise<{ reminded: number; skipped: number }> {
    const where = opts.pledge_id ? `WHERE p.user_id = $1 AND p.pledge_id = $2 AND p.status = 'active'` : `WHERE p.user_id = $1 AND p.status = 'active'`;
    const rows = await this.pledgeRows(this.pool, where, opts.pledge_id ? [userId, opts.pledge_id] : [userId]);
    if (rows.length === 0) throw new ApiError("NOT_FOUND", "No open pledge to remind about");
    let reminded = 0, skipped = 0;
    for (const r of rows) {
      const last = await this.lastReminderAt(r.pledge_id);
      if (last && now.getTime() - last.getTime() < PartnersService.FOLLOW_UP_HOURS * 3_600_000) { skipped += 1; continue; }
      const { progress: pr, owed_minor } = await this.progressDetail(r, now);
      const payload = { pledge_id: r.pledge_id, title: PartnersService.title(r), amount_minor: owed_minor ?? 0, currency: r.currency, due_on: pr.next_due, message: opts.message ?? null };
      const channels = await this.fanOut(notifications, r.user_id, "pledge_reminder_manual", payload, "Africa/Nairobi");
      await this.pool.query(`INSERT INTO pledge_reminders (pledge_id, due_on, sequence, kind, channel, sent_by, sent_at) VALUES ($1, $2, 0, 'manual', $3, $4, $5)`, [r.pledge_id, pr.next_due ?? nairobiDate(now), channels.join(",") || "none", adminId, now.toISOString()]);
      await audit(this.pool, adminId, "pledge.reminded", "pledges", r.pledge_id, { manual: true });
      reminded += 1;
    }
    return { reminded, skipped };
  }

  /** Everyone with a pledge that is behind. */
  async remindBehind(adminId: string, notifications: NotificationService, now = new Date()): Promise<{ partners: number; reminded: number; skipped: number }> {
    const list = await this.adminList({ status: "behind", sort: "behind" }, now);
    let reminded = 0, skipped = 0;
    for (const d of list.data as { user_id: string }[]) {
      const r = await this.adminRemind(adminId, d.user_id, notifications, {}, now).catch(() => ({ reminded: 0, skipped: 0 }));
      reminded += r.reminded; skipped += r.skipped;
    }
    return { partners: (list.data as unknown[]).length, reminded, skipped };
  }

  // ── phase 2: "I paid another way" ─────────────────────────────────────

  static readonly CreateClaim = z.object({
    amount_minor: z.number().int().positive(),
    currency: z.string().length(3).default("KES"),
    paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().trim().max(300).nullish(),
  });

  async createClaim(userId: string, pledgeId: string, input: z.infer<typeof PartnersService.CreateClaim>): Promise<Record<string, unknown>> {
    const [p] = await this.pledgeRows(this.pool, `WHERE p.pledge_id = $1 AND p.user_id = $2 AND p.status IN ('active','paused')`, [pledgeId, userId]);
    if (!p) throw new ApiError("NOT_FOUND", "Pledge not found");
    const row = await one<{ claim_id: string; status: string; created_at: string }>(
      this.pool,
      `INSERT INTO pledge_claims (pledge_id, user_id, amount_minor, currency, paid_on, note)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING claim_id, status, created_at::text`,
      [pledgeId, userId, input.amount_minor, input.currency.toUpperCase(), input.paid_on, input.note ?? null],
    );
    await audit(this.pool, userId, "pledge.claim_created", "pledge_claims", row.claim_id, { amount_minor: input.amount_minor });
    return { claim_id: row.claim_id, pledge_id: pledgeId, status: row.status, amount_minor: input.amount_minor, currency: input.currency.toUpperCase(), paid_on: input.paid_on, note: input.note ?? null, created_at: row.created_at };
  }

  async listClaims(userId: string, pledgeId: string): Promise<Record<string, unknown>[]> {
    return many(
      this.pool,
      `SELECT c.claim_id, c.pledge_id, c.amount_minor::text, c.currency, c.paid_on::text, c.note, c.status, c.decided_at::text, c.transaction_id, c.created_at::text
         FROM pledge_claims c WHERE c.pledge_id = $1 AND c.user_id = $2 ORDER BY c.created_at DESC`,
      [pledgeId, userId],
    );
  }

  async pendingClaims(): Promise<Record<string, unknown>[]> {
    return many(
      this.pool,
      `SELECT c.claim_id, c.pledge_id, c.user_id, u.full_name, c.amount_minor::text, c.currency, c.paid_on::text, c.note, c.status, c.created_at::text,
              ${pledgeTitleSql({ pledge: "p", fund: "f", campaign: "cm" })} AS pledge_title
         FROM pledge_claims c
         JOIN users u ON u.user_id = c.user_id
         JOIN pledges p ON p.pledge_id = c.pledge_id
         LEFT JOIN funds f ON f.fund_id = p.fund_id
         LEFT JOIN campaigns cm ON cm.campaign_id = p.campaign_id
        WHERE c.status = 'pending' ORDER BY c.created_at ASC`,
      [],
    );
  }

  /** Confirm → a real, succeeded, manual transaction attributed to the pledge,
   *  posted to the ledger like any other gift (debit cash:manual, credit the
   *  fund), with a receipt. Reject → the member is told. */
  async decideClaim(adminId: string, claimId: string, decision: "confirm" | "reject", notifications: NotificationService): Promise<Record<string, unknown>> {
    return tx(this.pool, async (c) => {
      const claim = await maybeOne<{ claim_id: string; pledge_id: string; user_id: string; amount_minor: string; currency: string; paid_on: string; status: string }>(
        c, `SELECT claim_id, pledge_id, user_id, amount_minor::text, currency, paid_on::text, status FROM pledge_claims WHERE claim_id = $1 FOR UPDATE`, [claimId],
      );
      if (!claim) throw new ApiError("NOT_FOUND", "Claim not found");
      if (claim.status !== "pending") throw new ApiError("UNPROCESSABLE", `Claim already ${claim.status}`);
      const [p] = await this.pledgeRows(c, `WHERE p.pledge_id = $1`, [claim.pledge_id]);
      if (!p) throw new ApiError("NOT_FOUND", "Pledge not found");

      if (decision === "reject") {
        await c.query(`UPDATE pledge_claims SET status = 'rejected', decided_by = $2, decided_at = now() WHERE claim_id = $1`, [claimId, adminId]);
        await audit(c, adminId, "pledge.claim_rejected", "pledge_claims", claimId, {});
        await notifications.schedule({ userId: claim.user_id, channel: "push", template: "pledge_claim_rejected", payload: { pledge_id: p.pledge_id, title: PartnersService.title(p), amount_minor: Number(claim.amount_minor), currency: claim.currency } });
        return { claim_id: claimId, status: "rejected" };
      }

      // The fund the money went to: one rule with gifts and pledge schedules
      // (FinancialService.pledgeFundCode) — the pledge's own, its campaign's,
      // its need's department's, or the programme default.
      const fundCode = await this.fin.pledgeFundCode(p.pledge_id);
      const fund = await one<{ fund_id: string; code: string }>(c, `SELECT fund_id, code FROM funds WHERE code = $1`, [fundCode]);

      const txn = await one<{ transaction_id: string }>(
        c,
        `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, provider_ref, idempotency_key, pledge_id, settled_at, created_at)
         VALUES ($1, $2, $3, $4, 'succeeded', 'manual', $5, $6, $7, now(), $8::date + interval '12 hours')
         RETURNING transaction_id`,
        [claim.user_id, fund.fund_id, claim.amount_minor, claim.currency, `claim:${claimId}`, `claim:${claimId}`, claim.pledge_id, claim.paid_on],
      );
      await c.query(
        `INSERT INTO ledger_entries (transaction_id, account, side, amount_minor, currency)
         VALUES ($1, 'cash:manual', 'debit', $2, $3), ($1, $4, 'credit', $2, $3)`,
        [txn.transaction_id, claim.amount_minor, claim.currency, `fund:${fund.code}`],
      );
      await c.query(`UPDATE pledge_claims SET status = 'confirmed', decided_by = $2, decided_at = now(), transaction_id = $3 WHERE claim_id = $1`, [claimId, adminId, txn.transaction_id]);
      await audit(c, adminId, "pledge.claim_confirmed", "pledge_claims", claimId, { transaction_id: txn.transaction_id });
      await enqueueOutbox(c, "giving.receipt", { transaction_id: txn.transaction_id, user_id: claim.user_id });
      await notifications.schedule({ userId: claim.user_id, channel: "push", template: "pledge_claim_confirmed", payload: { pledge_id: p.pledge_id, title: PartnersService.title(p), amount_minor: Number(claim.amount_minor), currency: claim.currency } });
      return { claim_id: claimId, status: "confirmed", transaction_id: txn.transaction_id };
    });
  }

  // ── admin ─────────────────────────────────────────────────────────────

  static readonly AdminListQuery = z.object({
    q: z.string().trim().max(80).optional(),
    status: z.enum(["all", "active", "paused", "behind", "left"]).default("all"),
    sort: z.enum(["recent", "committed", "behind"]).default("recent"),
  });

  /** `now` is injectable so the office reads the same clock as the member's
   *  view (and tests can pin it); routes pass none. "behind" is each pledge's
   *  progress label — for a monthly pledge, any instalment missed in its
   *  ledger, so a late payment that completes the missed one clears it. */
  async adminList(query: z.infer<typeof PartnersService.AdminListQuery>, now: Date = new Date()): Promise<Record<string, unknown>> {
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
    const year = Number(nairobiDate(now).slice(0, 4));
    const data: Record<string, unknown>[] = [];
    for (const u of rows) {
      const p = (await this.partnership(u.user_id, now)) as { pledges: Record<string, unknown>[]; committed_monthly_minor: number; tier: unknown; membership: { status: string; joined_at: string } | null; due: Record<string, unknown>[] };
      const given = await one<{ total: string | null; last_at: string | null }>(
        this.pool,
        `SELECT sum(amount_minor) FILTER (WHERE extract(year from created_at AT TIME ZONE 'Africa/Nairobi') = $2)::text AS total,
                max(created_at)::text AS last_at
           FROM transactions WHERE user_id = $1 AND status = 'succeeded'`,
        [u.user_id, year],
      );
      const behind = p.pledges.some((x) => (x.progress as PledgeProgress).label === "behind");
      // The earliest date anything is due — every active pledge's next due
      // date (not only those inside the member's DUE window) and the
      // recurring gift's next run.
      const nextDue = [
        ...p.pledges.filter((x) => x.status === "active").map((x) => (x.progress as PledgeProgress).next_due),
        ...p.due.map((d) => d.due_on as string | null),
      ].filter((d): d is string => typeof d === "string").sort()[0] ?? null;
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

  async adminDetail(userId: string, now: Date = new Date()): Promise<Record<string, unknown>> {
    const list = await this.adminList({ status: "all", sort: "recent" }, now);
    const member = (list.data as Record<string, unknown>[]).find((d) => d.user_id === userId);
    if (!member) throw new ApiError("NOT_FOUND", "Not a partner");
    const p = await this.partnership(userId, now);
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
      `SELECT r.pledge_id, r.due_on::text, r.sequence, r.kind, r.channel, r.sent_at::text, r.sent_by, s.full_name AS sent_by_name
         FROM pledge_reminders r JOIN pledges p ON p.pledge_id = r.pledge_id LEFT JOIN users s ON s.user_id = r.sent_by
        WHERE p.user_id = $1 ORDER BY r.sent_at DESC LIMIT 100`,
      [userId],
    );
    return { member, pledges: p.pledges, schedules, payments, reminders };
  }
}
