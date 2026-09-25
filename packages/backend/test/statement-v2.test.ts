// Statement v2 (docs/PARTNERS_PROGRAMME.md §3d, owner-delegated 2026-09-25):
// the Partners statement leads with what the partnership did, and the giving
// statement stays complete but stops interleaving. Two halves:
//   · pure: ONE instalment ledger per monthly pledge (allocateInstalments —
//     whole-history payments fill instalments oldest-first) that the month
//     strip, the faithfulness counts and every pledge's "N of M kept" read,
//     so they foot; and the impact in disciples carried (tiers.ts costing,
//     rounded down);
//   · the wire: GET /giving/statements gains impact / months / faithfulness /
//     season and, per pledge, remaining_year_minor + church_progress_percent;
//     the Partners PDF is two pages (impact, then the ledger); the giving PDF
//     separates pledge money into its own PARTNER PLEDGES section and foots.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createEnrollment, createUser } from "./helpers/factories.js";
import { FinancialService } from "../src/modules/financial/service.js";
import { PartnersService, monthStripLabel } from "../src/modules/financial/partners.js";
import { DepartmentsService } from "../src/modules/departments/service.js";
import { NotificationService } from "../src/modules/notifications/service.js";
import { COST_PER_DISCIPLE_MINOR } from "../src/modules/financial/tiers.js";
import {
  allocateInstalments, instalmentFaithfulness, instalmentsInYear, keptInYear, monthStatus, pledgedInYear,
  statementFaithfulness, statementImpact, statementMonths,
  type LedgerPaymentInput, type StatementPledgeInput,
} from "../src/modules/financial/partnerStatementMath.js";
import type { PaymentGateway } from "../src/modules/financial/gateway.js";

// ── the instalment ledger, pure ───────────────────────────────────────────

const monthly = (o: Partial<StatementPledgeInput> = {}): StatementPledgeInput =>
  ({ pledge_id: "m1", shape: "monthly", amount_minor: 200_000, target_minor: null, status: "active", due_day: 5, due_on: null, created_at: null, ...o });
const total = (o: Partial<StatementPledgeInput> = {}): StatementPledgeInput =>
  ({ pledge_id: "t1", shape: "total", amount_minor: null, target_minor: 5_000_000, status: "active", due_day: null, due_on: "2026-12-15", created_at: null, ...o });
const pay = (amount_minor: number, pledge_id: string | null, at: string, transaction_id?: string): LedgerPaymentInput =>
  ({ amount_minor, pledge_id, at, ...(transaction_id ? { transaction_id } : {}) });
const statuses = (ms: { status: string }[]): string[] => ms.map((m) => m.status);
// The church's 20 September 2026 — "today" unless a test says otherwise.
const today = "2026-09-20";

describe("the instalment ledger (allocateInstalments, pure)", () => {
  it("an early payment pre-pays the next month", () => {
    const p = monthly({ amount_minor: 100_000, due_day: 20, created_at: "2026-09-01" });
    const ledger = allocateInstalments(p, [pay(200_000, "m1", "2026-09-18T07:00:00Z")], today);
    expect(ledger).toEqual([
      { due: "2026-09-20", amount_minor: 100_000, covered_minor: 100_000, completed_on: "2026-09-18", status: "kept" },
      { due: "2026-10-20", amount_minor: 100_000, covered_minor: 100_000, completed_on: "2026-09-18", status: "kept" }, // pre-paid
      { due: "2026-11-20", amount_minor: 100_000, covered_minor: 0, completed_on: null, status: "upcoming" },          // the earliest incomplete
    ]);
    // Pre-paid counts once resolved: Sep and Oct kept, of 2.
    expect(keptInYear(p, [pay(200_000, "m1", "2026-09-18T07:00:00Z")], 2026, today)).toEqual({ kept: 2, due_count: 2 });
  });

  it("a late payment settles the missed month, not the current one", () => {
    const p = monthly({ amount_minor: 100_000, due_day: 5, created_at: "2026-08-01" });
    const ledger = allocateInstalments(p, [pay(100_000, "m1", "2026-09-10T07:00:00Z")], today);
    expect(ledger).toEqual([
      { due: "2026-08-05", amount_minor: 100_000, covered_minor: 100_000, completed_on: "2026-09-10", status: "late" },
      { due: "2026-09-05", amount_minor: 100_000, covered_minor: 0, completed_on: null, status: "missed" },
    ]);
  });

  it("one payment covering two instalments completes both — late ones stay late, a future one is pre-paid", () => {
    const p = monthly({ amount_minor: 100_000, due_day: 5, created_at: "2026-07-01" });
    const late = allocateInstalments(p, [pay(200_000, "m1", "2026-08-20T07:00:00Z")], today);
    expect(late.map((i) => [i.due, i.status, i.completed_on])).toEqual([
      ["2026-07-05", "late", "2026-08-20"], ["2026-08-05", "late", "2026-08-20"], ["2026-09-05", "missed", null],
    ]);
    expect(keptInYear(p, [pay(200_000, "m1", "2026-08-20T07:00:00Z")], 2026, today)).toEqual({ kept: 2, due_count: 3 });
    const early = allocateInstalments(p, [pay(200_000, "m1", "2026-07-03T07:00:00Z")], today);
    expect(statuses(early)).toEqual(["kept", "kept", "missed"]);
  });

  it("partial then top-up: covered accumulates; the top-up's date decides kept or late; a partial alone leaves it incomplete", () => {
    const p = monthly({ amount_minor: 100_000, due_day: 5, created_at: "2026-08-10" }); // first due 5 Sep
    const onTime = allocateInstalments(p, [pay(60_000, "m1", "2026-09-03"), pay(40_000, "m1", "2026-09-05")], today);
    expect(onTime[0]).toEqual({ due: "2026-09-05", amount_minor: 100_000, covered_minor: 100_000, completed_on: "2026-09-05", status: "kept" });
    const topUpLate = allocateInstalments(p, [pay(60_000, "m1", "2026-09-03"), pay(40_000, "m1", "2026-09-08")], today);
    expect(topUpLate[0]).toMatchObject({ covered_minor: 100_000, completed_on: "2026-09-08", status: "late" });
    const partial = allocateInstalments(p, [pay(60_000, "m1", "2026-09-03")], today);
    expect(partial[0]).toEqual({ due: "2026-09-05", amount_minor: 100_000, covered_minor: 60_000, completed_on: null, status: "missed" });
  });

  it("an overpayment spills into future instalments", () => {
    const p = monthly({ amount_minor: 100_000, due_day: 20, created_at: "2026-09-01" });
    const pays = [pay(250_000, "m1", "2026-09-20T06:00:00Z")];
    expect(allocateInstalments(p, pays, today).map((i) => [i.due, i.covered_minor, i.status])).toEqual([
      ["2026-09-20", 100_000, "kept"], ["2026-10-20", 100_000, "kept"], ["2026-11-20", 50_000, "upcoming"],
    ]);
    // The strip shows what the ledger allocated to each month, not the cash of the month.
    expect(statementMonths(2026, [p], pays, today).slice(8)).toEqual([
      { month: 9, status: "kept", due_minor: 100_000, paid_minor: 100_000 },
      { month: 10, status: "kept", due_minor: 100_000, paid_minor: 100_000 },
      { month: 11, status: "upcoming", due_minor: 100_000, paid_minor: 50_000 },
      { month: 12, status: "upcoming", due_minor: 100_000, paid_minor: 0 },
    ]);
  });

  it("a December payment pre-paying January counts in next year's evaluation", () => {
    const p = monthly({ amount_minor: 100_000, due_day: 5, created_at: "2026-11-10" }); // first due 5 Dec
    const pays = [pay(200_000, "m1", "2026-12-03T07:00:00Z")];
    const dec10 = "2026-12-10";
    expect(keptInYear(p, pays, 2026, dec10)).toEqual({ kept: 1, due_count: 1 });
    expect(keptInYear(p, pays, 2027, dec10)).toEqual({ kept: 1, due_count: 1 });
    expect(statementMonths(2027, [p], pays, dec10).slice(0, 2)).toEqual([
      { month: 1, status: "kept", due_minor: 100_000, paid_minor: 100_000 },
      { month: 2, status: "upcoming", due_minor: 100_000, paid_minor: 0 },
    ]);
    expect(statementFaithfulness(2027, [p], pays, dec10)).toEqual({ kept_on_time: 1, late: 0, missed: 0, due_count: 1 });
  });

  it("a scheduled charge and a confirmed claim are payments like any other; payment order, not input order, fills the ledger", () => {
    const p = monthly({ amount_minor: 100_000, due_day: 5, created_at: "2026-07-20" }); // first due 5 Aug
    const pays = [
      pay(100_000, "m1", "2026-09-04 12:00:00+00", "claim:0001"), // office-confirmed "I paid another way"
      pay(100_000, "m1", "2026-08-05 06:00:00+00", "sched:0001"), // the pledge's scheduled charge
      pay(100_000, "someone-else", "2026-08-01", "t-other"),
    ];
    expect(allocateInstalments(p, pays, today).map((i) => [i.due, i.status, i.completed_on])).toEqual([
      ["2026-08-05", "kept", "2026-08-05"], ["2026-09-05", "kept", "2026-09-04"], ["2026-10-05", "upcoming", null],
    ]);
  });

  it("an instalment due today and unpaid is 'due' and not in due_count until its day ends", () => {
    const p = monthly({ amount_minor: 100_000, due_day: 20, created_at: "2026-09-01" });
    expect(allocateInstalments(p, [], today)[0]).toEqual({ due: "2026-09-20", amount_minor: 100_000, covered_minor: 0, completed_on: null, status: "due" });
    expect(keptInYear(p, [], 2026, today)).toEqual({ kept: 0, due_count: 0 });
    expect(statementFaithfulness(2026, [p], [], today)).toEqual({ kept_on_time: 0, late: 0, missed: 0, due_count: 0 });
    expect(statementMonths(2026, [p], [], today)[8]!.status).toBe("upcoming");
    expect(keptInYear(p, [], 2026, "2026-09-21")).toEqual({ kept: 0, due_count: 1 }); // the day after: missed
    expect(keptInYear(p, [pay(100_000, "m1", "2026-09-20T05:00:00Z")], 2026, today)).toEqual({ kept: 1, due_count: 1 }); // paid on the day
  });

  it("the first instalment is on or after creation; dates are the church's day", () => {
    expect(allocateInstalments(monthly({ created_at: "2026-03-05" }), [], today)[0]!.due).toBe("2026-03-05");
    expect(allocateInstalments(monthly({ created_at: "2026-03-06" }), [], today)[0]!.due).toBe("2026-04-05");
    expect(allocateInstalments(monthly({ created_at: "2026-03-04T21:30:00Z" }), [], today)[0]!.due).toBe("2026-03-05"); // 5 Mar in Nairobi
    const p = monthly({ amount_minor: 100_000, created_at: "2026-08-10" });
    expect(allocateInstalments(p, [pay(100_000, "m1", "2026-09-05T20:59:59Z")], today)[0]!.status).toBe("kept"); // 23:59 EAT on the 5th
    expect(allocateInstalments(p, [pay(100_000, "m1", "2026-09-05T22:00:00Z")], today)[0]!.status).toBe("late"); // 01:00 EAT on the 6th
    expect(allocateInstalments(monthly({ due_day: 31, created_at: "2026-08-10" }), [], today)[0]!.due).toBe("2026-08-28"); // clamped 1..28
    expect(allocateInstalments(total(), [pay(1, "t1", "2026-03-01")], today)).toEqual([]);
  });
});

describe("the month strip and faithfulness (§3d, pure, from the ledger)", () => {
  it("two monthly pledges in one month: each fills its own ledger; the month takes the worst", () => {
    const pl = [
      monthly({ pledge_id: "a", amount_minor: 100_000, due_day: 5, created_at: "2026-03-25" }),
      monthly({ pledge_id: "b", amount_minor: 50_000, due_day: 20, created_at: "2026-03-25" }),
    ];
    // Each paid on its own day → April kept; due 150,000, allocated 150,000.
    expect(statementMonths(2026, pl, [pay(100_000, "a", "2026-04-05"), pay(50_000, "b", "2026-04-20")], today)[3])
      .toEqual({ month: 4, status: "kept", due_minor: 150_000, paid_minor: 150_000 });
    // Both on the 15th: a's instalment late, b's on time → late.
    expect(statementMonths(2026, pl, [pay(100_000, "a", "2026-04-15"), pay(50_000, "b", "2026-04-15")], today)[3]!.status).toBe("late");
    // Money paid to a never covers b (a's surplus pre-pays a's May): April missed, 100,000 allocated.
    expect(statementMonths(2026, pl, [pay(150_000, "a", "2026-04-04")], today)[3]).toEqual({ month: 4, status: "missed", due_minor: 150_000, paid_minor: 100_000 });
    // Mid-month, a's 5th covered and b's 20th ahead → upcoming; a unpaid by the 10th → missed.
    const sep = [monthly({ pledge_id: "a", amount_minor: 100_000, due_day: 5, created_at: "2026-08-25" }), monthly({ pledge_id: "b", amount_minor: 50_000, due_day: 20, created_at: "2026-08-25" })];
    expect(statementMonths(2026, sep, [pay(100_000, "a", "2026-09-04")], "2026-09-10")[8]!.status).toBe("upcoming");
    expect(statementMonths(2026, sep, [], "2026-09-10")[8]!.status).toBe("missed");
    expect(monthStatus([])).toBe("none");
  });

  it("total pledges, cancelled pledges and gifts outside a pledge never drive the strip; a paused pledge still does", () => {
    const pl = [total({ due_on: "2026-06-30" }), monthly({ pledge_id: "gone", status: "cancelled", created_at: "2025-01-01" })];
    const pays = [pay(5_000_000, "t1", "2026-06-10"), pay(200_000, "gone", "2026-06-05"), pay(999, null, "2026-06-05")];
    const ms = statementMonths(2026, pl, pays, today);
    expect(ms.every((m) => m.status === "none" && m.due_minor === 0 && m.paid_minor === 0)).toBe(true);
    expect(statementFaithfulness(2026, pl, pays, today)).toEqual({ kept_on_time: 0, late: 0, missed: 0, due_count: 0 });
    expect(statementMonths(2026, [monthly({ status: "paused", created_at: "2025-01-01" })], [], today)[0]!.status).toBe("missed");
  });

  it("one definition of kept: per pledge kept = its on-time + late instalments; across pledges Σ kept = kept_on_time + late and Σ due_count = due_count", () => {
    const pl = [
      monthly({ pledge_id: "a", amount_minor: 200_000, due_day: 5, created_at: "2026-03-15" }),
      monthly({ pledge_id: "b", amount_minor: 50_000, due_day: 20, created_at: "2026-06-01" }),
      monthly({ pledge_id: "gone", status: "cancelled", created_at: "2025-01-01" }),
    ];
    const payments = [
      pay(120_000, "a", "2026-04-01"), pay(80_000, "a", "2026-04-04"), // a, Apr: two payments → kept ONCE
      pay(200_000, "a", "2026-05-09"),                                 // a, May: late
      pay(50_000, "b", "2026-06-18"),                                  // b, Jun: on time
      pay(50_000, "b", "2026-07-25"),                                  // b, Jul: late
      pay(50_000, "b", "2026-08-20"),                                  // b, Aug: on its due day
      pay(200_000, "gone", "2026-02-05"),                              // cancelled: never on the strip
    ];                                                                 // b, Sep: due TODAY, unpaid
    const a = keptInYear(pl[0]!, payments, 2026, today);
    const b = keptInYear(pl[1]!, payments, 2026, today);
    expect(a).toEqual({ kept: 2, due_count: 6 }); // Apr, May late; Jun–Sep missed
    expect(b).toEqual({ kept: 3, due_count: 3 }); // Jun, Jul late, Aug; Sep due today — not counted yet
    for (const p of [pl[0]!, pl[1]!]) {
      const f = instalmentFaithfulness(instalmentsInYear(p, payments, 2026, today));
      expect(keptInYear(p, payments, 2026, today)).toEqual({ kept: f.kept_on_time + f.late, due_count: f.due_count });
    }
    const f = statementFaithfulness(2026, pl, payments, today);
    expect(f).toEqual({ kept_on_time: 3, late: 2, missed: 4, due_count: 9 });
    expect(a.kept + b.kept).toBe(f.kept_on_time + f.late);
    expect(a.due_count + b.due_count).toBe(f.due_count);
    expect(statuses(statementMonths(2026, pl, payments, today))).toEqual(["none", "none", "none", "kept", "late", "missed", "missed", "missed", "missed", "upcoming", "upcoming", "upcoming"]);
    // b pays September AND October on the 19th: both kept — the pre-paid one counts as kept now.
    const prepaid = [...payments, pay(100_000, "b", "2026-09-19")];
    expect(keptInYear(pl[1]!, prepaid, 2026, today)).toEqual({ kept: 5, due_count: 5 });
    expect(statementFaithfulness(2026, pl, prepaid, today)).toEqual({ kept_on_time: 5, late: 2, missed: 4, due_count: 11 });
  });

  it("Σ due over the strip is the §3a Pledged of the monthly pledges", () => {
    const pl = [monthly({ created_at: "2026-03-15T10:00:00Z" })];
    const pays = [pay(200_000, "m1", "2026-04-05"), pay(200_000, "m1", "2026-05-10")];
    expect(statementMonths(2026, pl, pays, today).reduce((a, m) => a + m.due_minor, 0)).toBe(pledgedInYear(pl[0]!, 2026));
  });

  it("a year gone by has no upcoming month; a year ahead has nothing late or missed", () => {
    const pl = [monthly({ created_at: "2024-06-01" })];
    expect(statuses(statementMonths(2025, pl, [], today)).every((s) => s === "missed")).toBe(true);
    expect(statuses(statementMonths(2027, pl, [], today)).every((s) => s === "upcoming")).toBe(true);
  });

  it("the strip as text: short month names with ✓ / late / ✗ / · / –, three spaces apart", () => {
    const ms = statementMonths(2026, [monthly({ created_at: "2026-03-15T10:00:00Z" })], [pay(200_000, "m1", "2026-04-05"), pay(200_000, "m1", "2026-05-10")], today);
    expect(monthStripLabel(ms)).toBe("Jan –   Feb –   Mar –   Apr ✓   May late   Jun ✗   Jul ✗   Aug ✗   Sep ✗   Oct ·   Nov ·   Dec ·");
  });
});

describe("impact (§3d, pure)", () => {
  it("per_disciple is the tiers.ts costing; carried rounds down; toward_next is the remainder", () => {
    expect(COST_PER_DISCIPLE_MINOR).toBe(2_000_000);
    expect(statementImpact(0)).toEqual({ paid_minor: 0, per_disciple_minor: 2_000_000, disciples_carried: 0, toward_next_minor: 0 });
    expect(statementImpact(950_000)).toEqual({ paid_minor: 950_000, per_disciple_minor: 2_000_000, disciples_carried: 0, toward_next_minor: 950_000 });
    expect(statementImpact(1_999_999).disciples_carried).toBe(0); // never rounds up
    expect(statementImpact(2_000_000)).toEqual({ paid_minor: 2_000_000, per_disciple_minor: 2_000_000, disciples_carried: 1, toward_next_minor: 0 });
    expect(statementImpact(4_500_000)).toEqual({ paid_minor: 4_500_000, per_disciple_minor: 2_000_000, disciples_carried: 2, toward_next_minor: 500_000 });
  });
});

// ── the wire ──────────────────────────────────────────────────────────────

class FakeGateway implements PaymentGateway {
  private n = 0;
  async createIntent(): Promise<{ id: string; client_secret: string }> {
    this.n += 1;
    return { id: `pi_test_${this.n}`, client_secret: `cs_${this.n}` };
  }
  verifyWebhook(): never { throw new Error("not used in these tests"); }
}

/** The text of a PDF made by statementPdf.ts, one array of lines per page:
 *  each `T*`-ended run of `(…) Tj` strings, Helvetica/WinAnsi decoded and the
 *  ZapfDingbats marks mapped back to ✓ / ✗. */
function pdfPages(pdf: Buffer): string[][] {
  const winAnsi: Record<number, string> = { 0x96: "–", 0x97: "—", 0x85: "…" };
  const zapf: Record<string, string> = { "3": "✓", "4": "✔", "7": "✗", "8": "✘" };
  const pages: string[][] = [];
  for (const stream of pdf.toString("latin1").matchAll(/stream\n([\s\S]*?)\nendstream/g)) {
    const lines: string[] = [];
    let font = "F1";
    let cur = "";
    for (const t of stream[1]!.matchAll(/\/(F\d) \d+ Tf|\(((?:\\.|[^\\)])*)\) Tj|T\*/g)) {
      if (t[1]) font = t[1];
      else if (t[0] === "T*") { lines.push(cur); cur = ""; }
      else {
        const raw = t[2]!.replace(/\\(.)/g, "$1");
        cur += [...raw].map((c) => (font === "F2" ? (zapf[c] ?? "?") : (winAnsi[c.charCodeAt(0)] ?? c))).join("");
      }
    }
    pages.push(lines);
  }
  return pages;
}

describe("statement v2 on the wire", () => {
  let cong: string; let user: string; let other: string;
  let financial: FinancialService; let partners: PartnersService;
  const now = new Date("2026-09-20T09:00:00Z"); // the church's 20 September 2026

  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation("Nairobi Central");
    user = (await createUser({ congregationId: cong, fullName: "Amina Wanjiru" })).user_id;
    other = (await createUser({ congregationId: cong })).user_id;
    financial = new FinancialService(testPool(), new FakeGateway());
    partners = new PartnersService(testPool(), financial);
  });
  afterAll(async () => { await closeTestPool(); });

  /** A succeeded gift by `who`, backdated to `at`, with a receipt code. */
  async function settled(who: string, input: Record<string, unknown>, at: string, receipt: string): Promise<string> {
    const r = (await financial.createGivingIntent(who, { currency: "KES", method: "card", ...input } as never)) as { transaction_id: string };
    await testPool().query(
      `UPDATE transactions SET status = 'succeeded', settled_at = $2, created_at = $2, receipt_code = $3 WHERE transaction_id = $1`,
      [r.transaction_id, at, receipt],
    );
    return r.transaction_id;
  }

  /** A department with an approved need of `target` (minor units). */
  async function approvedNeed(target: number): Promise<string> {
    const admin = (await createUser({ congregationId: cong })).user_id;
    const leader = (await createUser({ congregationId: cong })).user_id;
    const departments = new DepartmentsService(testPool(), new NotificationService(testPool()));
    const dept = await departments.create(admin, cong, { name: "Building", purpose: "The roof", leader_user_id: leader, gift_keys: [], fund_code: "general", is_open_to_join: true });
    const need = await departments.submitNeed(leader, String(dept.department_id), { title: "Roof sheets", why: "The rains are coming and the hall leaks.", target_minor: target, currency: "KES" });
    await departments.decideNeed(admin, String(need.need_id), "approve");
    return String(need.need_id);
  }

  it("a partner's year: months, faithfulness, impact (carried 0), season, remaining per pledge — and a two-page PDF led by impact", async () => {
    // A recurring gift makes her a partner with a season; the church finished
    // one level since she began (church-wide, not hers).
    const sched = await financial.createSchedule(user, { fund: "tithe", amount_minor: 5_000, currency: "KES", frequency: "monthly", method: "card" });
    await testPool().query(`UPDATE giving_schedules SET created_at = '2026-03-15 10:00:00+00' WHERE schedule_id = $1`, [sched.schedule_id]);
    const enr = await createEnrollment(other);
    await testPool().query(`UPDATE enrollments SET completed_at = '2026-06-01 10:00:00+00' WHERE enrollment_id = $1`, [enr]);

    // Kenya trip: KSh 2,000 a month due on the 5th, created 15 March.
    const kenya = await partners.createPledge(user, { shape: "monthly", amount_minor: 200_000, currency: "KES", due_day: 5, fund: "mission", title: "Kenya trip", reminders_enabled: true });
    await testPool().query(`UPDATE pledges SET created_at = '2026-03-15 10:00:00+00' WHERE pledge_id = $1`, [kenya.pledge_id]);
    await testPool().query(`UPDATE partner_memberships SET joined_at = '2026-03-15 10:00:00+00' WHERE user_id = $1`, [user]);
    // A total pledge, overpaid in June — its money never touches the strip.
    const gift = await partners.createPledge(user, { shape: "total", target_minor: 30_000, currency: "KES", due_on: "2026-11-30", title: "Choir robes", reminders_enabled: true });
    await settled(user, { fund: "tithe", amount_minor: 200_000, pledge_id: kenya.pledge_id }, "2026-04-05 06:00:00+00", "PLG00001");
    await settled(user, { fund: "tithe", amount_minor: 200_000, pledge_id: kenya.pledge_id }, "2026-05-10 06:00:00+00", "PLG00002");
    await settled(user, { fund: "tithe", amount_minor: 50_000, pledge_id: gift.pledge_id }, "2026-06-10 06:00:00+00", "ROBE0001");
    await settled(user, { fund: "tithe", amount_minor: 100_000, pledge_id: kenya.pledge_id }, "2026-07-03 06:00:00+00", "PLG00003");
    await settled(user, { fund: "tithe", amount_minor: 200_000, pledge_id: kenya.pledge_id }, "2026-08-01 06:00:00+00", "PLG00004");
    await settled(user, { fund: "tithe", amount_minor: 200_000, pledge_id: kenya.pledge_id }, "2026-09-05 22:00:00+00", "PLG00005"); // 6 Sep in Nairobi
    await settled(user, { fund: "tithe", amount_minor: 30_000 }, "2026-04-12 09:00:00+00", "TITHE0001");

    const st = await partners.statements(user, 2026, now);
    // The §3a numbers are unchanged by v2.
    expect(st.paid_minor).toBe(950_000);
    expect(st.pledged_minor).toBe(9 * 200_000 + 30_000);
    // The ledger (payments fill instalments oldest-first): Apr kept (5 Apr);
    // May late (10 May); June completed late on 1 Aug (3 Jul's 1,000 + half
    // of 1 Aug's); July completed late on 6 Sep (1 Aug's rest + half of the
    // payment made 5 Sep 22:00 UTC — 6 Sep in Nairobi); August only half
    // covered → missed; September missed; Oct–Dec upcoming. The robes money
    // is a total pledge's and never touches the strip.
    expect(statuses(st.months)).toEqual(["none", "none", "none", "kept", "late", "late", "late", "missed", "missed", "upcoming", "upcoming", "upcoming"]);
    expect(st.months[5]).toEqual({ month: 6, status: "late", due_minor: 200_000, paid_minor: 200_000 });
    expect(st.months[6]).toEqual({ month: 7, status: "late", due_minor: 200_000, paid_minor: 200_000 });
    expect(st.months[7]).toEqual({ month: 8, status: "missed", due_minor: 200_000, paid_minor: 100_000 });
    expect(st.months[8]).toEqual({ month: 9, status: "missed", due_minor: 200_000, paid_minor: 0 });
    expect(st.faithfulness).toEqual({ kept_on_time: 1, late: 3, missed: 2, due_count: 6 });
    // Reconciles with the per-pledge figures: the strip's due months are the
    // pledge's elapsed due dates, and Σ due = its pledged_minor.
    const k = st.pledges.find((p) => p.pledge_id === kenya.pledge_id)!;
    expect(st.faithfulness.due_count).toBe(k.due_count);
    expect(st.months.reduce((a, m) => a + m.due_minor, 0)).toBe(k.pledged_minor);
    // impact: KSh 9,500 paid toward pledges — below the first disciple.
    expect(st.impact).toEqual({ paid_minor: 950_000, per_disciple_minor: COST_PER_DISCIPLE_MINOR, disciples_carried: 0, toward_next_minor: 950_000 });
    // season: exactly /giving/partnership's since_you_began (ISO `from`).
    expect(st.season).toEqual({ from: "2026-03-15T10:00:00.000Z", levels_completed: 1, modules_completed: 0, plans_finished: 0 });
    const since = (await financial.partnership(user)).since_you_began as { from: Date } & Record<string, unknown>;
    expect(st.season).toEqual({ ...since, from: new Date(since.from).toISOString() });
    expect(JSON.parse(JSON.stringify({ s: since })).s).toEqual(st.season); // the same on the wire
    // Per pledge: remaining this year, never below zero; no need → no church percent.
    expect(k).toMatchObject({ pledged_minor: 1_800_000, paid_minor: 900_000, remaining_year_minor: 900_000, church_progress_percent: null });
    // One definition of kept: Apr, then May, Jun, Jul late — not the 5 payments.
    expect(k).toMatchObject({ kept: 4, due_count: 6 });
    expect(k.kept).toBe(st.faithfulness.kept_on_time + st.faithfulness.late);
    expect(st.pledges.find((p) => p.pledge_id === gift.pledge_id)).toMatchObject({ pledged_minor: 30_000, paid_minor: 50_000, remaining_year_minor: 0, church_progress_percent: null });

    // ── the Partners PDF: two pages, impact first, then the ledger ──
    const { pdf } = await partners.partnersStatementPdf(user, 2026, now);
    const raw = pdf.toString("latin1");
    expect(raw).toMatch(/\/Type\/Pages\/Kids\[\d+ 0 R \d+ 0 R\]\/Count 2>>/);
    expect(raw.match(/\/Type\/Page\b/g)).toHaveLength(2);
    expect(raw).toContain("/BaseFont/ZapfDingbats");
    const [one, two] = pdfPages(pdf);
    expect(pdfPages(pdf)).toHaveLength(2);
    expect(one).toEqual([
      "Thank you, Amina.",
      "Partner since Mar 2026 · carries one disciple through a level, every year",
      "Partners statement · 2026 · Nairobi Central",
      "",
      "   KSh 9,500 of 20,000 toward carrying one disciple through a level",
      "   Kept 4 of 6 · 3 late",
      "   Given KSh 9,500 toward pledges",
      "",
      "YOUR YEAR",
      "   Jan –   Feb –   Mar –   Apr ✓   May late   Jun late   Jul late   Aug ✗   Sep ✗   Oct ·   Nov ·   Dec ·",
      "   ✓ kept on time    late: paid after the due date    ✗ missed    · upcoming    – nothing due",
      "",
      "COMMITMENTS",
      "   Choir robes",
      "      KSh 300 by 30 Nov   -   Remaining this year KSh 0",
      "   Kenya trip",
      "      KSh 2,000 monthly · due on the 5th   -   Remaining this year KSh 9,000",
    ]);
    expect(one!.join("\n")).not.toMatch(/\b0 disciples/);
    // Page 2 is the ledger as it was.
    expect(two![0]).toBe("Partners statement · 2026");
    expect(two).toContain("   Pledged     KSh 18,300");
    expect(two).toContain("   Paid        KSh 9,500");
    expect(two).toContain("   Remaining   KSh 8,800");
    expect(two).toContain("   5 Apr  Kenya trip  Card  Ref PLG00001  KSh 2,000");
    expect(two).toContain("   6 Sep  Kenya trip  Card  Ref PLG00005  KSh 2,000");
    // Page 2's per-pledge "N of M kept" is the same count as page 1's.
    expect(two).toContain("      Paid this year KSh 9,000   -   4 of 6 kept");
    expect(two).toContain("Year total: KSh 9,500   (6 payments)");
    // Gifts outside a pledge are on neither page.
    expect(raw).not.toContain("TITHE0001");
  });

  it("carried ≥ 1: the figure is whole disciples, rounded down, with what is toward the next; exactly one reads 'one disciple'", async () => {
    await partners.join(user);
    const big = await partners.createPledge(user, { shape: "total", target_minor: 5_000_000, currency: "KES", due_on: "2026-12-31", title: "Building", reminders_enabled: true });
    await settled(user, { fund: "tithe", amount_minor: 4_500_000, pledge_id: big.pledge_id }, "2026-02-01 09:00:00+00", "BIG00001");
    const st = await partners.statements(user, 2026, now);
    expect(st.impact).toEqual({ paid_minor: 4_500_000, per_disciple_minor: 2_000_000, disciples_carried: 2, toward_next_minor: 500_000 });
    // No monthly pledge: the strip is all none, nothing is due, kept 0 of 0.
    expect(st.months.every((m) => m.status === "none")).toBe(true);
    expect(st.faithfulness).toEqual({ kept_on_time: 0, late: 0, missed: 0, due_count: 0 });
    const [one] = pdfPages((await partners.partnersStatementPdf(user, 2026, now)).pdf);
    expect(one).toContain("   Carries 2 disciples through a level · KSh 5,000 toward the next");
    expect(one).toContain("   No monthly instalments in 2026");
    expect(one).toContain("   Given KSh 45,000 toward pledges");
    expect(one).toContain("   Jan –   Feb –   Mar –   Apr –   May –   Jun –   Jul –   Aug –   Sep –   Oct –   Nov –   Dec –");

    await testPool().query(`UPDATE transactions SET amount_minor = 2000000 WHERE receipt_code = 'BIG00001'`);
    expect((await partners.statements(user, 2026, now)).impact).toMatchObject({ disciples_carried: 1, toward_next_minor: 0 });
    expect(pdfPages((await partners.partnersStatementPdf(user, 2026, now)).pdf)[0]).toContain("   Carries one disciple through a level");
  });

  it("season from the join date for a pledge-only partner; from an earlier schedule when there is one; null once not a partner", async () => {
    await partners.join(user);
    await testPool().query(`UPDATE partner_memberships SET joined_at = '2026-02-01 08:00:00+00' WHERE user_id = $1`, [user]);
    await partners.createPledge(user, { shape: "monthly", amount_minor: 100_000, currency: "KES", due_day: 5, reminders_enabled: true });
    // Church-wide levels finished: one before she joined, one after.
    for (const at of ["2026-01-15 10:00:00+00", "2026-05-01 10:00:00+00"]) {
      const e = await createEnrollment((await createUser({ congregationId: cong })).user_id);
      await testPool().query(`UPDATE enrollments SET completed_at = $2 WHERE enrollment_id = $1`, [e, at]);
    }
    // No recurring gift: /giving/partnership has no since_you_began …
    expect((await financial.partnership(user)).since_you_began).toBeNull();
    // … but she is a partner, so the statement's season runs from her join date.
    expect((await partners.statements(user, 2026, now)).season).toEqual({ from: "2026-02-01T08:00:00.000Z", levels_completed: 1, modules_completed: 0, plans_finished: 0 });
    // A recurring gift she started (and stopped) earlier moves the start back.
    const sched = await financial.createSchedule(user, { fund: "tithe", amount_minor: 5_000, currency: "KES", frequency: "monthly", method: "card" });
    await testPool().query(`UPDATE giving_schedules SET created_at = '2026-01-10 08:00:00+00' WHERE schedule_id = $1`, [sched.schedule_id]);
    await financial.cancelSchedule(user, String(sched.schedule_id));
    expect((await partners.statements(user, 2026, now)).season).toEqual({ from: "2026-01-10T08:00:00.000Z", levels_completed: 2, modules_completed: 0, plans_finished: 0 });
    // Left the programme, no recurring gift: not a partner — null.
    await testPool().query(`UPDATE partner_memberships SET status = 'left', left_at = now() WHERE user_id = $1`, [user]);
    expect((await partners.statements(user, 2026, now)).season).toBeNull();
  });

  it("pledge-level kept == month-level kept_on_time + late, on the wire: a two-instalment month counts once, a late month is kept, and the PDF's two pages agree", async () => {
    await partners.join(user);
    const kenya = await partners.createPledge(user, { shape: "monthly", amount_minor: 200_000, currency: "KES", due_day: 5, fund: "mission", title: "Kenya trip", reminders_enabled: true });
    const choir = await partners.createPledge(user, { shape: "monthly", amount_minor: 50_000, currency: "KES", due_day: 20, title: "Choir", reminders_enabled: true });
    await testPool().query(`UPDATE pledges SET created_at = '2026-03-15 10:00:00+00' WHERE pledge_id = $1`, [kenya.pledge_id]);
    await testPool().query(`UPDATE pledges SET created_at = '2026-06-01 10:00:00+00' WHERE pledge_id = $1`, [choir.pledge_id]);
    // Kenya: April in two instalments (on time), May late, Jun–Sep nothing.
    await settled(user, { fund: "tithe", amount_minor: 120_000, pledge_id: kenya.pledge_id }, "2026-04-01 06:00:00+00", "KEN00001");
    await settled(user, { fund: "tithe", amount_minor: 80_000, pledge_id: kenya.pledge_id }, "2026-04-04 06:00:00+00", "KEN00002");
    await settled(user, { fund: "tithe", amount_minor: 200_000, pledge_id: kenya.pledge_id }, "2026-05-09 06:00:00+00", "KEN00003");
    // Choir: June on time, July late, August on its day; September is due
    // today (20 Sep) and unpaid — not counted until the day ends.
    await settled(user, { fund: "tithe", amount_minor: 50_000, pledge_id: choir.pledge_id }, "2026-06-18 06:00:00+00", "CHO00001");
    await settled(user, { fund: "tithe", amount_minor: 50_000, pledge_id: choir.pledge_id }, "2026-07-25 06:00:00+00", "CHO00002");
    await settled(user, { fund: "tithe", amount_minor: 50_000, pledge_id: choir.pledge_id }, "2026-08-20 06:00:00+00", "CHO00003");

    const st = await partners.statements(user, 2026, now);
    const k = st.pledges.find((p) => p.pledge_id === kenya.pledge_id)!;
    const c = st.pledges.find((p) => p.pledge_id === choir.pledge_id)!;
    expect(k).toMatchObject({ kept: 2, due_count: 6 }); // 3 payments, 2 instalments kept
    expect(c).toMatchObject({ kept: 3, due_count: 3 });
    expect(st.faithfulness).toEqual({ kept_on_time: 3, late: 2, missed: 4, due_count: 9 });
    expect(k.kept + c.kept).toBe(st.faithfulness.kept_on_time + st.faithfulness.late);
    expect(k.due_count + c.due_count).toBe(st.faithfulness.due_count);
    expect(statuses(st.months)).toEqual(["none", "none", "none", "kept", "late", "missed", "missed", "missed", "missed", "upcoming", "upcoming", "upcoming"]);
    expect(st.months[3]).toEqual({ month: 4, status: "kept", due_minor: 200_000, paid_minor: 200_000 });

    const [one, two] = pdfPages((await partners.partnersStatementPdf(user, 2026, now)).pdf);
    expect(one).toContain("   Kept 5 of 9 · 2 late");
    expect(two).toContain("      Paid this year KSh 4,000   -   2 of 6 kept");
    expect(two).toContain("      Paid this year KSh 1,500   -   3 of 3 kept");
  });

  it("church_progress_percent: a need pledge reads the need's church-wide raised figure, floored and capped at 100; other pledges null", async () => {
    const needId = await approvedNeed(300_000);
    const need = await partners.createPledge(user, { shape: "total", target_minor: 300_000, currency: "KES", due_on: "2026-11-30", need_id: needId, reminders_enabled: true });
    const plain = await partners.createPledge(user, { shape: "monthly", amount_minor: 10_000, currency: "KES", due_day: 1, reminders_enabled: true });
    await settled(user, { fund: "tithe", amount_minor: 50_000, pledge_id: need.pledge_id }, "2026-06-10 09:00:00+00", "NEED0001");
    // 50,000 of 300,000 = 16.67% → 16 (floor; never rounded up).
    let st = await partners.statements(user, 2026, now);
    expect(st.pledges.find((p) => p.pledge_id === need.pledge_id)).toMatchObject({ pledged_minor: 300_000, paid_minor: 50_000, remaining_year_minor: 250_000, church_progress_percent: 16 });
    expect(st.pledges.find((p) => p.pledge_id === plain.pledge_id)?.church_progress_percent).toBeNull();
    // Someone else gives straight to the need: church-wide, so it moves too — 70,000 → 23.
    const direct = await settled(other, { fund: "tithe", amount_minor: 20_000, need_id: needId }, "2026-07-01 09:00:00+00", "NEED0002");
    // Their history row names the need (the apps' "Repeat last gift" skips need gifts).
    expect(((await financial.listGiving(other)) as { transaction_id: string; need_id: string | null }[]).find((r) => r.transaction_id === direct)?.need_id).toBe(needId);
    st = await partners.statements(user, 2026, now);
    expect(st.pledges.find((p) => p.pledge_id === need.pledge_id)?.church_progress_percent).toBe(23);
    // The same raised figure the department page shows for the need.
    const departments = new DepartmentsService(testPool(), new NotificationService(testPool()));
    const approved = await departments.needs("approved");
    const row = (approved as { need_id: string; raised_minor: number; target_minor: number }[]).find((n) => n.need_id === needId)!;
    expect(row.raised_minor).toBe(70_000);
    expect(Math.floor((row.raised_minor * 100) / row.target_minor)).toBe(23);
    // Over-raised: capped at 100.
    await settled(other, { fund: "tithe", amount_minor: 400_000, need_id: needId }, "2026-07-02 09:00:00+00", "NEED0003");
    st = await partners.statements(user, 2026, now);
    expect(st.pledges.find((p) => p.pledge_id === need.pledge_id)?.church_progress_percent).toBe(100);
    // The PDF's commitments carry it.
    const [one] = pdfPages((await partners.partnersStatementPdf(user, 2026, now)).pdf);
    expect(one).toContain("      KSh 3,000 by 30 Nov   -   Remaining this year KSh 2,500   -   The church is 100% of the way there");
  });

  it("a member who never partnered: season null, strip all none, impact zero", async () => {
    const st = await partners.statements(other, 2026, now);
    expect(st.season).toBeNull();
    expect(st.months).toHaveLength(12);
    expect(st.months.every((m) => m.status === "none")).toBe(true);
    expect(st.faithfulness).toEqual({ kept_on_time: 0, late: 0, missed: 0, due_count: 0 });
    expect(st.impact).toEqual({ paid_minor: 0, per_disciple_minor: 2_000_000, disciples_carried: 0, toward_next_minor: 0 });
    expect(st.pledges).toEqual([]);
  });

  it("the giving PDF: gifts outside a pledge by day, then PARTNER PLEDGES with titles and a subtotal — and the header foots", async () => {
    const kenya = await partners.createPledge(user, { shape: "monthly", amount_minor: 200_000, currency: "KES", due_day: 5, fund: "mission", title: "Kenya trip", reminders_enabled: true });
    await settled(user, { fund: "tithe", amount_minor: 200_000, pledge_id: kenya.pledge_id }, "2026-04-05 09:00:00+00", "PLG00001");
    await settled(user, { fund: "tithe", amount_minor: 200_000, pledge_id: kenya.pledge_id }, "2026-05-05 09:00:00+00", "PLG00002");
    await settled(user, { fund: "tithe", amount_minor: 30_000 }, "2026-04-12 09:00:00+00", "TITHE0001");
    await settled(user, { fund: "offering", amount_minor: 15_000 }, "2026-04-12 10:00:00+00", "OFFER0001");
    // A gift still processing: listed, never counted.
    await financial.createGivingIntent(user, { fund: "tithe", amount_minor: 7_000, currency: "KES", method: "card" } as never);

    const pdf = await financial.statementPdf(user);
    const pages = pdfPages(pdf);
    expect(pages).toHaveLength(1);
    const lines = pages[0]!;
    expect(lines[0]).toBe("NURU PATHWAY - GIVING STATEMENT");
    expect(lines).toContain("Gifts KSh 450 · Partner pledges KSh 4,000 · Total KSh 4,450");
    expect(lines).toContain("3 gifts · 2 pledge payments");
    const section = lines.indexOf("PARTNER PLEDGES   KSh 4,000");
    expect(section).toBeGreaterThan(0);
    // Before the section: gifts only — no pledge row, no pledge title.
    const giftPart = lines.slice(0, section).join("\n");
    expect(giftPart).toContain("Ref TITHE0001");
    expect(giftPart).toContain("Ref OFFER0001");
    expect(giftPart).toContain("PROCESSING");
    expect(giftPart).not.toContain("PLG0000");
    expect(giftPart).not.toContain("Kenya trip");
    // The section: every pledge-tied payment, tagged with its pledge, landed fund shown.
    const pledgePart = lines.slice(section + 1).filter((l) => l.startsWith("   "));
    expect(pledgePart).toHaveLength(2);
    expect(pledgePart.every((l) => l.includes("Kenya trip pledge  Mission  KSh 2,000  Card  SUCCEEDED"))).toBe(true);
    expect(pledgePart.map((l) => l.slice(-12))).toEqual(["Ref PLG00002", "Ref PLG00001"]); // newest first
    expect(lines[lines.length - 1]).toBe("Total KSh 4,450");

    // Footing: Σ day-group totals = Gifts; + the PARTNER PLEDGES subtotal = Total
    // = every settled gift the member made (the old "Total given").
    const ksh = (s: string): number => Math.round(Number(s.replace(/,/g, "")) * 100);
    const dayTotals = lines.flatMap((l) => {
      const m = /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}, \d{4} {3}KSh ([\d,.]+)$/.exec(l);
      return m ? [ksh(m[1]!)] : [];
    });
    const [, gifts, pledgesY, totalT] = /^Gifts KSh ([\d,.]+) · Partner pledges KSh ([\d,.]+) · Total KSh ([\d,.]+)$/.exec(lines.find((l) => l.startsWith("Gifts "))!)!.map((x, i) => (i === 0 ? 0 : ksh(x)));
    expect(dayTotals.reduce((a, x) => a + x, 0)).toBe(gifts);
    expect(ksh(/PARTNER PLEDGES {3}KSh ([\d,.]+)$/.exec(lines[section]!)![1]!)).toBe(pledgesY);
    expect(gifts! + pledgesY!).toBe(totalT);
    const history = (await financial.listGiving(user)) as { amount_minor: number; status: string }[];
    expect(history.filter((r) => r.status === "succeeded").reduce((a, r) => a + r.amount_minor, 0)).toBe(totalT);
    expect(totalT).toBe(445_000);
  });

  it("the giving PDF for a member with no pledge money reads just 'Total given' with no PARTNER PLEDGES section; a long history flows onto more pages instead of being cut off", async () => {
    for (let i = 0; i < 60; i++) {
      const day = String((i % 28) + 1).padStart(2, "0");
      const month = String(Math.floor(i / 28) + 1).padStart(2, "0");
      await settled(user, { fund: "tithe", amount_minor: 1_000 }, `2026-${month}-${day} 09:00:00+00`, `T${String(i).padStart(7, "0")}`);
    }
    const pdf = await financial.statementPdf(user);
    const raw = pdf.toString("latin1");
    const pages = pdfPages(pdf);
    expect(pages.length).toBeGreaterThan(1);
    expect(raw).toContain(`/Count ${pages.length}>>`);
    const all = pages.flat();
    expect(all).toContain("Total given KSh 600");
    expect(all).toContain("60 gifts");
    expect(all.some((l) => l.includes("Partner pledges") || l.includes("pledge payment"))).toBe(false);
    expect(all.some((l) => l.startsWith("PARTNER PLEDGES"))).toBe(false);
    // Every one of the 60 gifts is printed, and the closing total is on the last page.
    expect(all.filter((l) => /Ref T\d{7}$/.test(l))).toHaveLength(60);
    expect(pages[pages.length - 1]!.at(-1)).toBe("Total KSh 600");
  });
});
