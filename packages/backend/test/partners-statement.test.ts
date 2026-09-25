// The Partners statement — separate from the Give statement (owner,
// 2026-09-25: "Have the statement separate for partners and give statements
// separate"). Two halves:
//   · the §3a rule as pure functions (partnerStatementMath.ts), pinned by the
//     same cases Android's PartnerStatementMathTest pins, so the server and
//     both apps can never disagree on Pledged / Paid / Remaining;
//   · the wire: GET /giving/statements gains the three totals and pledges[],
//     GET /giving/history rows name their pledge, and the new
//     GET /giving/partners/statement.pdf carries pledge-tied money only.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { agent, bearer, testEnv } from "./helpers/app.js";
import { signAccessToken } from "../src/modules/identity/tokens.js";
import { FinancialService } from "../src/modules/financial/service.js";
import { PartnersService } from "../src/modules/financial/partners.js";
import { DepartmentsService } from "../src/modules/departments/service.js";
import { NotificationService } from "../src/modules/notifications/service.js";
import {
  dueDatesInYear, keptInYear, partnerDate, pledgePayments, pledgedInYear, statementSummary,
  type StatementPledgeInput,
} from "../src/modules/financial/partnerStatementMath.js";
import type { PaymentGateway } from "../src/modules/financial/gateway.js";

// ── the rule, pure ────────────────────────────────────────────────────────

const monthly = (o: Partial<StatementPledgeInput> = {}): StatementPledgeInput =>
  ({ pledge_id: "m1", shape: "monthly", amount_minor: 200_000, target_minor: null, status: "active", due_day: 5, due_on: null, created_at: null, ...o });
const total = (o: Partial<StatementPledgeInput> = {}): StatementPledgeInput =>
  ({ pledge_id: "t1", shape: "total", amount_minor: null, target_minor: 5_000_000, status: "active", due_day: null, due_on: "2026-12-15", created_at: null, ...o });
const pay = (amount_minor: number, pledge_id: string | null) => ({ amount_minor, pledge_id });

describe("partner statement rule (§3a, pure)", () => {
  it("a monthly pledge created mid-year is owed only from its creation", () => {
    // Created 15 March, due on the 5th: April..December = 9 due dates.
    const s = statementSummary(2026, [monthly({ created_at: "2026-03-15T10:00:00Z" })], []);
    expect(s.pledged_minor).toBe(9 * 200_000);
  });

  it("a monthly pledge created on or before its due day counts that month", () => {
    expect(dueDatesInYear(2026, 5, "2026-03-05")).toBe(10); // March..December
    expect(dueDatesInYear(2026, 5, "2026-03-06")).toBe(9);  // April..December
  });

  it("a monthly pledge created in an earlier year is owed the whole year", () => {
    expect(statementSummary(2026, [monthly({ created_at: "2025-11-20T10:00:00Z" })], []).pledged_minor).toBe(12 * 200_000);
  });

  it("a monthly pledge with no created_at falls back to the whole year", () => {
    expect(statementSummary(2026, [monthly()], []).pledged_minor).toBe(12 * 200_000);
  });

  it("a monthly pledge created next year contributes nothing to this year", () => {
    expect(statementSummary(2026, [monthly({ created_at: "2027-01-02T10:00:00Z" })], []).pledged_minor).toBe(0);
  });

  it("a total pledge counts in the year its due date falls — due next year, nothing this year", () => {
    expect(statementSummary(2026, [total({ due_on: "2026-12-15" })], []).pledged_minor).toBe(5_000_000);
    expect(statementSummary(2026, [total({ due_on: "2027-01-31" })], []).pledged_minor).toBe(0);
    expect(statementSummary(2027, [total({ due_on: "2027-01-31" })], []).pledged_minor).toBe(5_000_000);
    expect(pledgedInYear(total({ due_on: null }), 2026)).toBe(0);
  });

  it("cancelled pledges are ignored; paused and fulfilled are not", () => {
    const pledges = [
      monthly({ pledge_id: "c", status: "cancelled" }),
      total({ pledge_id: "tc", due_on: "2026-06-01", status: "cancelled" }),
      monthly({ pledge_id: "p", status: "paused" }),
      total({ pledge_id: "f", due_on: "2026-06-01", status: "fulfilled" }),
    ];
    expect(statementSummary(2026, pledges, []).pledged_minor).toBe(12 * 200_000 + 5_000_000);
  });

  it("paid sums only payments that carry a pledge id", () => {
    const payments = [pay(150_000, "m1"), pay(50_000, "t1"), pay(999_999, null), pay(1, "")];
    expect(statementSummary(2026, [monthly()], payments).paid_minor).toBe(200_000);
    expect(pledgePayments(payments).map((x) => x.pledge_id)).toEqual(["m1", "t1"]);
  });

  it("remaining is pledged minus paid, never below zero", () => {
    const pl = [monthly({ created_at: "2026-10-01T00:00:00Z" })]; // Oct, Nov, Dec = 600,000
    expect(statementSummary(2026, pl, [pay(200_000, "m1")]).remaining_minor).toBe(400_000);
    expect(statementSummary(2026, pl, [pay(900_000, "m1")]).remaining_minor).toBe(0);
    expect(statementSummary(2026, pl, [pay(900_000, "m1")])).toEqual({ pledged_minor: 600_000, paid_minor: 900_000, remaining_minor: 0 });
  });

  it("kept counts this pledge's instalments completed in the year — on time or late, a split month once; due_count counts the resolved ones", () => {
    // One definition of kept (owner-delegated 2026-09-25): the pledge's
    // instalment ledger — its payments over its whole history fill its
    // instalments oldest-first — not a count of payments. due_count = kept +
    // late + missed; an instalment due today and unpaid waits for its day to end.
    const pl = monthly({ created_at: "2026-01-10T00:00:00Z" }); // first due 5 Feb
    const at = (amount: number, pledge: string | null, on: string) => ({ ...pay(amount, pledge), at: on });
    const payments = [
      at(200_000, "m1", "2026-02-05"),                                   // Feb: on time → kept
      at(100_000, "m1", "2026-03-02"), at(100_000, "m1", "2026-03-04"),  // Mar: two instalments → kept ONCE
      at(200_000, "m1", "2026-04-09"),                                   // Apr: late → still kept
      at(150_000, "m1", "2026-05-05"),                                   // May: part → not kept
      at(200_000, "other", "2026-06-05"), at(200_000, null, "2026-07-05"), // not this pledge's
    ];
    // 20 Sep: Feb, Mar kept, Apr late (all kept); May part-paid and Jun–Sep
    // unpaid → missed. Resolved: Feb..Sep = 8.
    expect(keptInYear(pl, payments, 2026, "2026-09-20")).toEqual({ kept: 3, due_count: 8 });
    // On 4 Feb — before the first due date, nothing paid yet — nothing is resolved.
    expect(keptInYear(pl, payments.filter((x) => x.at <= "2026-02-04"), 2026, "2026-02-04")).toEqual({ kept: 0, due_count: 0 });
    // A year gone by has all its due dates (from its creation on: created 10
    // Jan, due on the 5th → Feb..Dec = 11); a year still ahead has none.
    expect(keptInYear(monthly({ created_at: "2025-01-10T00:00:00Z" }), [], 2025, "2026-09-20").due_count).toBe(11);
    expect(keptInYear(monthly({ created_at: "2024-11-20T00:00:00Z" }), [], 2025, "2026-09-20").due_count).toBe(12);
    expect(keptInYear(pl, [], 2027, "2026-09-20").due_count).toBe(0);
    // A total pledge has no instalments: nothing due, nothing kept.
    expect(keptInYear(total(), [{ ...pay(1, "t1"), at: "2026-03-01" }], 2026, "2026-09-20")).toEqual({ kept: 0, due_count: 0 });
  });

  it("dates are the church's day: late on the 4th UTC is the 5th in Nairobi; a bare date passes through", () => {
    expect(partnerDate("2026-03-04T21:30:00Z")).toBe("2026-03-05");
    expect(dueDatesInYear(2026, 5, partnerDate("2026-03-04T21:30:00Z"))).toBe(10);
    expect(partnerDate("2026-03-15 10:00:00+00")).toBe("2026-03-15"); // Postgres timestamptz text
    expect(partnerDate("2026-12-15")).toBe("2026-12-15");
    expect(partnerDate(null)).toBeNull();
    expect(partnerDate("not a date")).toBeNull();
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

describe("the Partners statement on the wire", () => {
  let cong: string; let user: string; let other: string;
  let financial: FinancialService; let partners: PartnersService;
  // The church's 20 September 2026 — every fixture is pinned to 2026 so the
  // numbers never move with the calendar.
  const now = new Date("2026-09-20T09:00:00Z");

  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation("Nairobi Central");
    user = (await createUser({ congregationId: cong, fullName: "Amina Wanjiru" })).user_id;
    other = (await createUser({ congregationId: cong })).user_id;
    financial = new FinancialService(testPool(), new FakeGateway());
    partners = new PartnersService(testPool(), financial);
  });
  afterAll(async () => { await closeTestPool(); });

  /** A succeeded gift by `user`, backdated to `at`, with a receipt code. */
  async function settled(input: Record<string, unknown>, at: string, receipt: string): Promise<string> {
    const r = (await financial.createGivingIntent(user, { currency: "KES", method: "card", ...input } as never)) as { transaction_id: string };
    await testPool().query(
      `UPDATE transactions SET status = 'succeeded', settled_at = $2, created_at = $2, receipt_code = $3 WHERE transaction_id = $1`,
      [r.transaction_id, at, receipt],
    );
    return r.transaction_id;
  }

  /** GET a download route, buffering the body whatever its content type. */
  async function download(path: string, headers: Record<string, string> = {}): Promise<{ status: number; type: string; disposition: string; buf: Buffer }> {
    const res = await agent().get(path).set(headers).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    return {
      status: res.status,
      type: String(res.headers["content-type"] ?? ""),
      disposition: String(res.headers["content-disposition"] ?? ""),
      buf: res.body as Buffer,
    };
  }

  it("a partner's year: the §3a numbers, a row per pledge that foots, payments naming their pledge, a partner-only PDF, and history rows that name their pledge", async () => {
    // A monthly fund pledge created 15 March (due on the 5th), a total pledge
    // due next year, two instalments and a plain tithe.
    const monthlyPledge = await partners.createPledge(user, { shape: "monthly", amount_minor: 200_000, currency: "KES", due_day: 5, fund: "mission", title: "Kenya trip", reminders_enabled: true });
    await testPool().query(`UPDATE pledges SET created_at = '2026-03-15 10:00:00+00' WHERE pledge_id = $1`, [monthlyPledge.pledge_id]);
    await testPool().query(`UPDATE partner_memberships SET joined_at = '2026-03-15 10:00:00+00' WHERE user_id = $1`, [user]);
    const totalPledge = await partners.createPledge(user, { shape: "total", target_minor: 5_000_000, currency: "KES", due_on: "2027-01-15", reminders_enabled: true });
    const p1 = await settled({ fund: "tithe", amount_minor: 200_000, pledge_id: monthlyPledge.pledge_id }, "2026-04-05 09:00:00+00", "PLG00001");
    const p2 = await settled({ fund: "tithe", amount_minor: 200_000, pledge_id: monthlyPledge.pledge_id }, "2026-05-05 09:00:00+00", "PLG00002");
    const tithe = await settled({ fund: "tithe", amount_minor: 30_000 }, "2026-04-12 09:00:00+00", "TITHE0001");

    // ── GET /giving/statements?year=2026 ──
    const st = await partners.statements(user, 2026, now);
    expect(st.year).toBe(2026);
    expect(st.years).toEqual([2026]);
    expect(st.currency).toBe("KES");
    expect(st.total_minor).toBe(430_000);        // the whole year's giving, tithe included (unchanged)
    expect(st.pledged_minor).toBe(9 * 200_000);  // Apr..Dec from 15 Mar; the total pledge is due next year
    expect(st.paid_minor).toBe(400_000);         // the two instalments — never the tithe
    expect(st.remaining_minor).toBe(1_400_000);
    // by_pledge / by_fund as before.
    expect(st.by_pledge.find((x) => x.pledge_id === null)).toEqual({ pledge_id: null, title: "Gifts outside a pledge", total_minor: 30_000 });
    expect(st.by_pledge.find((x) => x.pledge_id === monthlyPledge.pledge_id)?.total_minor).toBe(400_000);
    expect(st.by_fund.map((f) => [f.code, f.total_minor]).sort()).toEqual([["mission", 400_000], ["tithe", 30_000]]);
    // pledges[]: both, newest first; every field; the numbers foot.
    expect(st.pledges.map((p) => p.pledge_id)).toEqual([totalPledge.pledge_id, monthlyPledge.pledge_id]);
    const m = st.pledges.find((p) => p.pledge_id === monthlyPledge.pledge_id)!;
    expect(m).toMatchObject({
      title: "Kenya trip", shape: "monthly", amount_minor: 200_000, target_minor: null, currency: "KES", status: "active",
      due_day: 5, due_on: null, pledged_minor: 1_800_000, paid_minor: 400_000, kept: 2, due_count: 6, // Apr..Sep elapsed by 20 Sep
    });
    expect(m.created_at).toMatch(/^2026-03-15/);
    expect(st.pledges.find((p) => p.pledge_id === totalPledge.pledge_id)).toMatchObject({
      title: "General partnership", shape: "total", amount_minor: null, target_minor: 5_000_000, status: "active",
      due_day: 1, // createPledge stores 1 for a total pledge; the wire passes the row through, as Pledge does
      due_on: "2027-01-15", pledged_minor: 0, paid_minor: 0, kept: 0, due_count: 0,
    });
    expect(st.pledges.reduce((a, p) => a + p.pledged_minor, 0)).toBe(st.pledged_minor);
    expect(st.pledges.reduce((a, p) => a + p.paid_minor, 0)).toBe(st.paid_minor);
    // payments[]: every gift of the year, newest first (the Give statement reads
    // them all), each saying which pledge, which fund, how it was paid.
    expect(st.payments.map((x) => x.transaction_id)).toEqual([p2, tithe, p1]);
    expect(st.payments.find((x) => x.transaction_id === p1)).toMatchObject({
      amount_minor: 200_000, currency: "KES", receipt_code: "PLG00001", fund: "mission", fund_name: "Missions", method: "card",
      pledge_id: monthlyPledge.pledge_id, pledge_title: "Kenya trip",
    });
    expect(st.payments.find((x) => x.transaction_id === tithe)).toMatchObject({
      amount_minor: 30_000, receipt_code: "TITHE0001", fund: "tithe", fund_name: "Tithe", method: "card", pledge_id: null, pledge_title: null,
    });
    // The partner view is the pledge-tied subset: the tithe is not in it.
    expect(pledgePayments(st.payments).map((x) => x.transaction_id).sort()).toEqual([p1, p2].sort());

    // ── the partner-only PDF ──
    const { year, pdf } = await partners.partnersStatementPdf(user, 2026, now);
    expect(year).toBe(2026);
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    const body = pdf.toString("latin1");
    expect(body).toContain("Partners statement · 2026");
    expect(body).toContain("Nairobi Central");
    expect(body).toContain("Amina Wanjiru");
    expect(body).toContain("Partner since Mar 2026 · carries one disciple through a level, every year"); // KSh 2,000/month reaches the 1,700 tier
    expect(body).toContain("Pledged     KSh 18,000");
    expect(body).toContain("Paid        KSh 4,000");
    expect(body).toContain("Remaining   KSh 14,000");
    expect(body).toContain("Kenya trip");
    expect(body).toContain("KSh 2,000 monthly · due on the 5th   -   Active");
    expect(body).toContain("Paid this year KSh 4,000   -   2 of 6 kept");
    expect(body).toContain("KSh 50,000 by 15 Jan 2027   -   Active");
    expect(body).toContain("Paid this year KSh 0");
    expect(body).toContain("APRIL 2026   KSh 2,000");
    expect(body).toContain("MAY 2026   KSh 2,000");
    expect(body).toContain("5 Apr  Kenya trip  Card  Ref PLG00001  KSh 2,000");
    expect(body).toContain("5 May  Kenya trip  Card  Ref PLG00002  KSh 2,000");
    expect(body).toContain("Year total: KSh 4,000");
    expect(body).toContain("Generated 20 September 2026 · Nuru Place");
    expect(body).toContain("%%EOF");
    // Gifts outside a pledge are NOT on it.
    expect(body).not.toContain("TITHE0001");
    expect(body).not.toContain("Tithe");
    expect(body).not.toContain("KSh 300");

    // ── the route: bearer OR ?token=, the filename carries the year ──
    const token = signAccessToken(testEnv(), { sub: user, role: "Student", cong });
    const viaQuery = await download(`/v1/giving/partners/statement.pdf?year=2026&token=${token}`);
    expect(viaQuery.status).toBe(200);
    expect(viaQuery.type).toContain("application/pdf");
    expect(viaQuery.disposition).toBe('attachment; filename="nuru-partners-statement-2026.pdf"');
    expect(viaQuery.buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(viaQuery.buf.toString("latin1")).toContain("Kenya trip");
    const viaHeader = await download("/v1/giving/partners/statement.pdf?year=2026", { Authorization: bearer({ sub: user, role: "Student", cong }) });
    expect(viaHeader.status).toBe(200);
    expect(viaHeader.type).toContain("application/pdf");
    // No token at all → 401; a bad year → 400.
    expect((await download("/v1/giving/partners/statement.pdf?year=2026")).status).toBe(401);
    expect((await download(`/v1/giving/partners/statement.pdf?year=abc&token=${token}`)).status).toBe(400);
    // Default year: the current Nairobi year is in the filename.
    const thisYear = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 4);
    expect((await download(`/v1/giving/partners/statement.pdf?token=${token}`)).disposition).toBe(`attachment; filename="nuru-partners-statement-${thisYear}.pdf"`);

    // ── never a partner → 404 NOT_FOUND, on the service and on the route ──
    await expect(partners.partnersStatementPdf(other, 2026, now)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const stranger = await download(`/v1/giving/partners/statement.pdf?year=2026&token=${signAccessToken(testEnv(), { sub: other, role: "Student", cong })}`);
    expect(stranger.status).toBe(404);
    expect(JSON.parse(stranger.buf.toString("utf8")).error.code).toBe("NOT_FOUND");
    // The giving statement itself is untouched by all this.
    const giving = await download(`/v1/giving/statement.pdf?token=${token}`);
    expect(giving.status).toBe(200);
    expect(giving.disposition).toBe('attachment; filename="nuru-giving-statement.pdf"');
    expect(giving.buf.toString("latin1")).toContain("GIVING STATEMENT");

    // ── GET /giving/history rows name their pledge ──
    const history = (await financial.listGiving(user)) as { transaction_id: string; pledge_id: string | null; pledge_title: string | null; method: string }[];
    expect(history.find((r) => r.transaction_id === p1)).toMatchObject({ pledge_id: monthlyPledge.pledge_id, pledge_title: "Kenya trip", method: "card" });
    expect(history.find((r) => r.transaction_id === tithe)).toMatchObject({ pledge_id: null, pledge_title: null, need_id: null });
    // Nothing removed: every field that was there before is still there.
    expect(Object.keys(history[0]!).sort()).toEqual([
      "account_name", "amount_minor", "created_at", "currency", "fund", "method", "need_id", "pledge_id", "pledge_title",
      "provider_ref", "receipt_code", "settled_at", "status", "transaction_id",
    ]);
  });

  it("a cancelled pledge paid this year stays on the statement with nothing pledged; a need pledge is named as its card is, everywhere; joining without pledging is a statement, not a 404", async () => {
    // Paid in February, cancelled since: its money still counts as paid, its
    // promise no longer counts as pledged — and it keeps its row so the sums foot.
    const old = await partners.createPledge(user, { shape: "monthly", amount_minor: 100_000, currency: "KES", due_day: 1, title: "Old promise", reminders_enabled: true });
    await testPool().query(`UPDATE pledges SET created_at = '2026-01-10 08:00:00+00' WHERE pledge_id = $1`, [old.pledge_id]); // first due 1 Feb
    await settled({ fund: "tithe", amount_minor: 100_000, pledge_id: old.pledge_id }, "2026-02-01 09:00:00+00", "OLD00001");
    await partners.updatePledge(user, String(old.pledge_id), { status: "cancelled" });
    // A pledge toward an approved department need, due this year.
    const admin = (await createUser({ congregationId: cong })).user_id;
    const leader = (await createUser({ congregationId: cong })).user_id;
    const departments = new DepartmentsService(testPool(), new NotificationService(testPool()));
    const dept = await departments.create(admin, cong, { name: "Building", purpose: "The roof", leader_user_id: leader, gift_keys: [], fund_code: "general", is_open_to_join: true });
    const roof = await departments.submitNeed(leader, String(dept.department_id), { title: "Roof sheets", why: "The rains are coming and the hall leaks.", target_minor: 300_000, currency: "KES" });
    await departments.decideNeed(admin, String(roof.need_id), "approve");
    const need = await partners.createPledge(user, { shape: "total", target_minor: 300_000, currency: "KES", due_on: "2026-11-30", need_id: String(roof.need_id), reminders_enabled: true });
    const needGift = await settled({ fund: "tithe", amount_minor: 50_000, pledge_id: need.pledge_id }, "2026-06-10 09:00:00+00", "NEED0001");

    const st = await partners.statements(user, 2026, now);
    expect(st.pledged_minor).toBe(300_000);
    expect(st.paid_minor).toBe(150_000);
    expect(st.remaining_minor).toBe(150_000);
    // Kept counts instalments kept, not payments: the cancelled pledge's 1 Feb
    // instalment was paid on the day (kept) and Mar..Sep went unpaid (its
    // ledger is still read through today — cancellation does not rewrite it);
    // a total pledge has no instalments, so 0 and 0 whatever it received.
    expect(st.pledges.find((p) => p.pledge_id === old.pledge_id)).toMatchObject({ title: "Old promise", status: "cancelled", pledged_minor: 0, paid_minor: 100_000, kept: 1, due_count: 8 });
    expect(st.pledges.find((p) => p.pledge_id === need.pledge_id)).toMatchObject({ title: "A department need", status: "active", pledged_minor: 300_000, paid_minor: 50_000, kept: 0, due_count: 0 });
    expect(st.pledges.reduce((a, p) => a + p.pledged_minor, 0)).toBe(st.pledged_minor);
    expect(st.pledges.reduce((a, p) => a + p.paid_minor, 0)).toBe(st.paid_minor);
    expect(st.payments.find((x) => x.transaction_id === needGift)?.pledge_title).toBe("A department need");
    // The same words on the history row and in the office's claims queue — one SQL rule.
    const history = (await financial.listGiving(user)) as { transaction_id: string; pledge_title: string | null }[];
    expect(history.find((r) => r.transaction_id === needGift)?.pledge_title).toBe("A department need");
    await partners.createClaim(user, String(need.pledge_id), { amount_minor: 500, currency: "KES", paid_on: "2026-09-01" });
    expect((await partners.pendingClaims())[0]!.pledge_title).toBe("A department need");
    // The PDF shows both blocks.
    const body = (await partners.partnersStatementPdf(user, 2026, now)).pdf.toString("latin1");
    expect(body).toContain("Old promise");
    expect(body).toContain("-   Cancelled");
    expect(body).toContain("KSh 3,000 by 30 Nov   -   Active");
    expect(body).toContain("Pledged     KSh 3,000");
    expect(body).toContain("Paid        KSh 1,500");
    expect(body).toContain("Remaining   KSh 1,500");
    expect(body).toContain("FEBRUARY 2026   KSh 1,000");
    expect(body).toContain("JUNE 2026   KSh 500");

    // Joined, never pledged: a statement with nothing on it — not a 404.
    await partners.join(other);
    const empty = (await partners.partnersStatementPdf(other, 2026, now)).pdf.toString("latin1");
    expect(empty).toContain("No pledges in 2026.");
    expect(empty).toContain("No pledge payments in 2026.");
    expect(empty).toContain("Pledged     KSh 0");
    // A recurring gift alone (phase 1's partner) is a partner too — even cancelled since.
    const third = (await createUser({ congregationId: cong })).user_id;
    const sched = await financial.createSchedule(third, { fund: "tithe", amount_minor: 5_000, currency: "KES", frequency: "monthly", method: "card" });
    await financial.cancelSchedule(third, String(sched.schedule_id));
    expect((await partners.partnersStatementPdf(third, 2026, now)).pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });
});
