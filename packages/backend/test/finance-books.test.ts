// Finance books — the write side of the Finance ERP (docs/FINANCE_ERP.md §2,
// §2a, §4, §6), against the real migrated schema.
//
//   · Every posting is balanced, and the whole ledger is — Σ debit = Σ credit
//     per currency — after EVERY operation in this file (w() + afterEach).
//   · Office gifts: member / pledge / need / walk-in / anonymous; gapless OR-
//     receipts (a rolled-back attempt and concurrent recorders leave no gap);
//     M-Pesa codes live in office_reference and are never recorded twice;
//     idempotent replays; reversal restates the gift's own day.
//   · Journals: transfers (negative guard), opening balances, reversal once.
//   · Expenses: maker-checker, approval posts at spent_on, void mirrors it.
//   · Budgets: draft → lines → approve; budget vs actual with known numbers.
//   · Permissions: view / manage / approve / export, and the RBAC catalog.
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import supertest from "supertest";
import type { Express } from "express";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { makeApp, bearer } from "./helpers/app.js";
import { FinancialService } from "../src/modules/financial/service.js";
import { PartnersService } from "../src/modules/financial/partners.js";
import { FinanceBooks } from "../src/modules/financial/books.js";
import { DepartmentsService } from "../src/modules/departments/service.js";
import { NotificationService } from "../src/modules/notifications/service.js";
import { FakeMobileMoneyProvider } from "../src/modules/financial/providers.js";
import { nairobiDate } from "../src/modules/financial/partnerStatementMath.js";
import { PERM_MODULES, CAPABILITIES } from "../src/http/auth.js";
import type { PaymentGateway } from "../src/modules/financial/gateway.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

class FakeGateway implements PaymentGateway {
  private n = 0;
  async createIntent(): Promise<{ id: string; client_secret: string }> {
    this.n += 1;
    return { id: `pi_books_${this.n}`, client_secret: `cs_${this.n}` };
  }
  verifyWebhook(): never { throw new Error("not used"); }
}

// ── dates (the church's calendar) ─────────────────────────────────────────
const today = (): string => nairobiDate(new Date());
const daysAgo = (n: number): string => nairobiDate(new Date(Date.now() - n * 86_400_000));
const thisYear = (): number => Number(today().slice(0, 4));
/** The 15th of last month (Nairobi) — always inside the 366-day window. */
const lastMonth15 = (): string => {
  const [y, m] = today().split("-").map(Number) as [number, number];
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}-15`;
};
/** 12:00 Nairobi on a day, as the ISO instant the API returns. */
const noon = (day: string): string => `${day}T09:00:00.000Z`;

// ── the ledger invariant ──────────────────────────────────────────────────
async function invariant(): Promise<void> {
  const perCurrency = await testPool().query<{ currency: string; d: string; c: string }>(
    `SELECT currency, sum(amount_minor) FILTER (WHERE side = 'debit')::text AS d, sum(amount_minor) FILTER (WHERE side = 'credit')::text AS c
       FROM ledger_entries GROUP BY currency`,
  );
  for (const r of perCurrency.rows) expect(r.d ?? "0", `Σ debit = Σ credit in ${r.currency}`).toBe(r.c ?? "0");
  const perPosting = await testPool().query(
    `SELECT COALESCE(transaction_id, journal_id) AS owner, currency
       FROM ledger_entries GROUP BY 1, 2
      HAVING sum(CASE WHEN side = 'debit' THEN amount_minor ELSE -amount_minor END) <> 0`,
  );
  expect(perPosting.rows, "every transaction / journal balances on its own").toEqual([]);
}

/** credits − debits on an account (a fund's balance), optionally up to an instant. */
async function fundBal(code: string, currency = "KES", upTo: string | null = null): Promise<number> {
  const r = await testPool().query<{ b: string }>(
    `SELECT COALESCE(sum(CASE WHEN side = 'credit' THEN amount_minor ELSE -amount_minor END), 0)::text AS b
       FROM ledger_entries WHERE account = $1 AND currency = $2 AND ($3::timestamptz IS NULL OR created_at <= $3)`,
    [`fund:${code}`, currency, upTo],
  );
  return Number(r.rows[0]!.b);
}
/** debits − credits on a cash account. */
async function cashBal(account: string, currency = "KES"): Promise<number> {
  const r = await testPool().query<{ b: string }>(
    `SELECT COALESCE(sum(CASE WHEN side = 'debit' THEN amount_minor ELSE -amount_minor END), 0)::text AS b
       FROM ledger_entries WHERE account = $1 AND currency = $2`,
    [account, currency],
  );
  return Number(r.rows[0]!.b);
}
/** The first column of the first row, as a number (count(*), sums). */
const count = async (sql: string, params: unknown[] = []): Promise<number> =>
  Number(Object.values((await testPool().query(sql, params)).rows[0] as Record<string, unknown>)[0]);

let app: Express;
beforeAll(() => { app = makeApp() as unknown as Express; });
afterAll(async () => { await closeTestPool(); });
afterEach(async () => { await invariant(); });

interface Who { id: string; role: "Student" | "Instructor" | "Admin" | "SuperAdmin"; }
let cong: string;
let superAdmin: Who; let admin: Who; let viewer: Who; let manager: Who; let approver: Who; let checker: Who;
let exporter: Who; let rolesViewer: Who; let usersViewer: Who; let nobody: Who; let member: Who; let member2: Who;

async function grant(userId: string, ...perms: string[]): Promise<void> {
  for (const p of perms) {
    const [m, c] = p.split(":");
    await testPool().query(`INSERT INTO rbac_user_permissions (user_id, module_id, capability) VALUES ($1, $2, $3)`, [userId, m, c]);
  }
}
async function person(role: Who["role"], name: string, ...perms: string[]): Promise<Who> {
  const u = await createUser({ congregationId: cong, role, fullName: name, email: `${name.toLowerCase().replace(/\W+/g, ".")}@books.test` });
  await grant(u.user_id, ...perms);
  return { id: u.user_id, role };
}

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  superAdmin = await person("SuperAdmin", "Sara Super");
  admin = await person("Admin", "Adam Admin");
  viewer = await person("Instructor", "Vera Viewer", "finance:view");
  manager = await person("Instructor", "Mona Manager", "finance:view", "finance:manage");
  approver = await person("Instructor", "Abel Approver", "finance:view", "finance:approve");
  checker = await person("Instructor", "Cleo Checker", "finance:view", "finance:manage", "finance:approve");
  exporter = await person("Instructor", "Eli Exporter", "finance:view", "finance:export");
  rolesViewer = await person("Instructor", "Rhoda Roles", "rolesAdmin:view");
  usersViewer = await person("Instructor", "Uri Users", "users:view");
  nobody = await person("Instructor", "Nora Nobody");
  member = { id: (await createUser({ congregationId: cong, fullName: "Grace Wanjiru", phone: "+254711000001" })).user_id, role: "Student" };
  member2 = { id: (await createUser({ congregationId: cong, fullName: "Peter Otieno", phone: "+254711000002" })).user_id, role: "Student" };
});

// ── HTTP helpers — every write re-checks the ledger invariant ──────────────
const auth = (who: Who): string => bearer({ sub: who.id, role: who.role, cong });
async function w(p: supertest.Test): Promise<supertest.Response> {
  const res = await p;
  await invariant();
  return res;
}
const post = (who: Who, path: string, body: unknown = {}) => w(supertest(app).post(`/v1${path}`).set("Authorization", auth(who)).send(body as object));
const patch = (who: Who, path: string, body: unknown = {}) => w(supertest(app).patch(`/v1${path}`).set("Authorization", auth(who)).send(body as object));
const put = (who: Who, path: string, body: unknown = {}) => w(supertest(app).put(`/v1${path}`).set("Authorization", auth(who)).send(body as object));
const get = (who: Who, path: string) => supertest(app).get(`/v1${path}`).set("Authorization", auth(who));

let keyN = 0;
const key = (): string => `books-test-key-${++keyN}-${Date.now()}`;
const gift = (over: Record<string, unknown> = {}) => ({
  idempotency_key: key(), user_id: member.id, fund: "tithe", amount_minor: 100_000, currency: "KES",
  channel: "onhand", received_on: today(), ...over,
});

// ═══════════════════════════════════════════════════════════════════════════
describe("office gifts", () => {
  it("records a member's cash gift: one transaction, a gapless OR- receipt, balanced legs at received_on 12:00 EAT, the member's receipt queued, audited", async () => {
    const day = daysAgo(3);
    const res = await post(superAdmin, "/admin/finance/gifts", gift({ received_on: day, note: "Envelope 12" }));
    expect(res.status).toBe(201);
    const g = res.body;
    expect(g).toMatchObject({
      status: "succeeded", provider: "manual", source: "admin", reused: false,
      receipt_code: `OR-${thisYear()}-00001`, amount_minor: 100_000, currency: "KES",
      fund: { code: "tithe", name: "Tithe" }, channel: "onhand", reference: null,
      received_on: day, created_at: noon(day), settled_at: noon(day),
      user_id: member.id, member_name: "Grace Wanjiru", anonymous: false, pledge: null, need: null,
      note: "Envelope 12", recorded_by: superAdmin.id, recorded_by_name: "Sara Super",
      reversed_at: null, reversal_reason: null,
    });
    expect(g.ledger.map((l: any) => [l.side, l.account, l.amount_minor, l.currency, l.created_at])).toEqual([
      ["debit", "cash:onhand", 100_000, "KES", noon(day)],
      ["credit", "fund:tithe", 100_000, "KES", noon(day)],
    ]);
    const outbox = await testPool().query(`SELECT payload FROM outbox WHERE topic = 'giving.receipt'`);
    expect(outbox.rows.map((r) => r.payload)).toEqual([{ transaction_id: g.transaction_id, user_id: member.id }]);
    const a = await testPool().query(`SELECT actor_id, metadata FROM audit_log WHERE action = 'finance.gift_recorded' AND entity_id = $1`, [g.transaction_id]);
    expect(a.rows[0].actor_id).toBe(superAdmin.id);
    expect(a.rows[0].metadata).toMatchObject({ receipt_code: g.receipt_code, fund: "tithe", channel: "onhand", giver: "member" });
    // The member sees it on their own statement, on the day it was received.
    const partners = new PartnersService(testPool(), new FinancialService(testPool(), new FakeGateway()));
    const st = await partners.statements(member.id, Number(day.slice(0, 4)));
    expect((st.payments as any[]).map((p) => [p.transaction_id, p.method, p.receipt_code])).toEqual([[g.transaction_id, "manual", g.receipt_code]]);
  });

  it("bank, cheque and M-Pesa need their reference; channel 'other' posts to cash:manual; every office receipt is an OR- number", async () => {
    expect((await post(superAdmin, "/admin/finance/gifts", gift({ channel: "bank" }))).status).toBe(400);
    expect((await post(superAdmin, "/admin/finance/gifts", gift({ channel: "cheque", reference: "  " }))).status).toBe(400);
    expect((await post(superAdmin, "/admin/finance/gifts", gift({ channel: "mpesa" }))).status).toBe(400);
    const bad = await post(superAdmin, "/admin/finance/gifts", gift({ channel: "mpesa", reference: "ABC" }));
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("INVALID_REFERENCE");
    const cheque = await post(superAdmin, "/admin/finance/gifts", gift({ channel: "cheque", reference: "000123" }));
    const mpesa = await post(superAdmin, "/admin/finance/gifts", gift({ channel: "mpesa", reference: " qgh12abc3d " }));
    const other = await post(superAdmin, "/admin/finance/gifts", gift({ channel: "other", reference: "Airtel 7781" }));
    expect([cheque.status, mpesa.status, other.status]).toEqual([201, 201, 201]);
    expect(mpesa.body.reference).toBe("QGH12ABC3D");
    expect(mpesa.body.receipt_code).toBe(`OR-${thisYear()}-00002`);
    expect(cheque.body.ledger[0].account).toBe("cash:cheque");
    expect(mpesa.body.ledger[0].account).toBe("cash:mpesa");
    expect(other.body.ledger[0].account).toBe("cash:manual");
    expect(await cashBal("cash:mpesa")).toBe(100_000);
  });

  it("dates: received_on after today or more than 366 days ago is INVALID_DATE; a non-date is a 400", async () => {
    const future = await post(superAdmin, "/admin/finance/gifts", gift({ received_on: nairobiDate(new Date(Date.now() + 2 * 86_400_000)) }));
    expect([future.status, future.body.error.code]).toEqual([422, "INVALID_DATE"]);
    const old = await post(superAdmin, "/admin/finance/gifts", gift({ received_on: daysAgo(367) }));
    expect([old.status, old.body.error.code]).toEqual([422, "INVALID_DATE"]);
    expect((await post(superAdmin, "/admin/finance/gifts", gift({ received_on: daysAgo(366) }))).status).toBe(201);
    expect((await post(superAdmin, "/admin/finance/gifts", gift({ received_on: "2026-02-30" }))).status).toBe(400);
    expect((await post(superAdmin, "/admin/finance/gifts", gift({ amount_minor: 0 }))).status).toBe(400);
    expect((await post(superAdmin, "/admin/finance/gifts", gift({ amount_minor: 1_000_000_001 }))).status).toBe(400);
    expect((await post(superAdmin, "/admin/finance/gifts", gift({ currency: "EUR" }))).status).toBe(400);
    expect((await post(superAdmin, "/admin/finance/gifts", gift({ fund: "no-such-fund" }))).status).toBe(422);
  });

  it("walk-in (name only, phone only, both) and anonymous gifts are recorded memberless; no receipt is queued; ambiguous givers are refused", async () => {
    const byName = await post(manager, "/admin/finance/gifts", gift({ user_id: null, giver_name: "Visitor from Nakuru" }));
    const byPhone = await post(manager, "/admin/finance/gifts", gift({ user_id: null, giver_phone: "+254722000111" }));
    const both = await post(manager, "/admin/finance/gifts", gift({ user_id: null, giver_name: "Mama Njeri", giver_phone: "+254722000222" }));
    const anon = await post(manager, "/admin/finance/gifts", gift({ user_id: null, anonymous: true, channel: "onhand", fund: "offering", amount_minor: 45_050 }));
    for (const r of [byName, byPhone, both, anon]) expect(r.status).toBe(201);
    expect(byName.body).toMatchObject({ user_id: null, giver_name: "Visitor from Nakuru", giver_phone: null, anonymous: false, source: "admin", recorded_by: manager.id });
    expect(byPhone.body).toMatchObject({ user_id: null, giver_name: null, giver_phone: "+254722000111", anonymous: false });
    expect(anon.body).toMatchObject({ user_id: null, giver_name: null, giver_phone: null, anonymous: true, channel: "onhand" });
    expect(await count(`SELECT count(*) FROM outbox WHERE topic = 'giving.receipt'`)).toBe(0);
    // exactly one giver mode
    expect((await post(manager, "/admin/finance/gifts", gift({ giver_name: "Also me" }))).status).toBe(400);
    expect((await post(manager, "/admin/finance/gifts", gift({ user_id: null }))).status).toBe(400);
    expect((await post(manager, "/admin/finance/gifts", gift({ anonymous: true }))).status).toBe(400);
    expect((await post(manager, "/admin/finance/gifts", gift({ user_id: null, anonymous: true, giver_name: "Named anon" }))).status).toBe(400);
    expect((await post(manager, "/admin/finance/gifts", gift({ user_id: "00000000-0000-4000-8000-000000000000" }))).status).toBe(422);
  });

  it("the database still refuses an app row with no member, and an office row with no channel (migration 216's checks)", async () => {
    const fund = (await testPool().query(`SELECT fund_id FROM funds WHERE code = 'tithe'`)).rows[0].fund_id;
    await expect(testPool().query(
      `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, idempotency_key, source, giver_phone)
       VALUES (NULL, $1, 100, 'KES', 'succeeded', 'db-check-app', 'app', '+254700000009')`, [fund],
    )).rejects.toMatchObject({ code: "23514", constraint: "transactions_memberless_source" });
    await expect(testPool().query(
      `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, idempotency_key, source)
       VALUES (NULL, $1, 100, 'KES', 'succeeded', 'db-check-admin', 'admin')`, [fund],
    )).rejects.toMatchObject({ code: "23514", constraint: "transactions_attributable" });
    // …while the website row of migration 202 is still fine.
    await testPool().query(
      `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, idempotency_key, source, giver_phone)
       VALUES (NULL, $1, 100, 'KES', 'processing', 'db-check-web', 'website', '+254700000010')`, [fund],
    );
  });

  it("an idempotent replay returns the booked transaction (200, reused) and posts nothing; a key owned by another payment is a 409", async () => {
    const body = gift({ amount_minor: 70_000 });
    const first = await post(superAdmin, "/admin/finance/gifts", body);
    expect(first.status).toBe(201);
    const legs = await count(`SELECT count(*) FROM ledger_entries`);
    const again = await post(superAdmin, "/admin/finance/gifts", { ...body, amount_minor: 99_999, fund: "offering" });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ transaction_id: first.body.transaction_id, reused: true, receipt_code: first.body.receipt_code, amount_minor: 70_000, fund: { code: "tithe" } });
    expect(await count(`SELECT count(*) FROM ledger_entries`)).toBe(legs);
    expect((await testPool().query(`SELECT next FROM receipt_counters WHERE year = $1`, [thisYear()])).rows[0].next).toBe(2);
    // A member's app gift owns its key.
    const fin = new FinancialService(testPool(), new FakeGateway());
    await fin.createGivingIntent(member.id, { fund: "tithe", amount_minor: 1_000, currency: "KES", method: "card", idempotency_key: "member-owned-key-1" } as never);
    const clash = await post(superAdmin, "/admin/finance/gifts", gift({ idempotency_key: "member-owned-key-1" }));
    expect([clash.status, clash.body.error.code]).toEqual([409, "CONFLICT"]);
  });

  it("office receipts are sequential and gapless — a rolled-back attempt gives its number back, and concurrent recorders never share or skip one", async () => {
    const year = thisYear();
    expect((await post(superAdmin, "/admin/finance/gifts", gift())).body.receipt_code).toBe(`OR-${year}-00001`);
    // Fail an attempt AFTER it took a number: a trigger that refuses one amount.
    await testPool().query(`CREATE OR REPLACE FUNCTION books_test_refuse() RETURNS trigger AS $$
      BEGIN IF NEW.amount_minor = 1313 THEN RAISE EXCEPTION 'books test: refused'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await testPool().query(`CREATE TRIGGER books_test_refuse BEFORE INSERT ON transactions FOR EACH ROW EXECUTE FUNCTION books_test_refuse()`);
    try {
      const failed = await post(superAdmin, "/admin/finance/gifts", gift({ amount_minor: 1313 }));
      expect(failed.status).toBe(500);
    } finally {
      await testPool().query(`DROP TRIGGER IF EXISTS books_test_refuse ON transactions`);
      await testPool().query(`DROP FUNCTION IF EXISTS books_test_refuse()`);
    }
    expect((await post(superAdmin, "/admin/finance/gifts", gift())).body.receipt_code).toBe(`OR-${year}-00002`);
    // Three recorders at once.
    const together = await Promise.all([1, 2, 3].map(() => supertest(app).post("/v1/admin/finance/gifts").set("Authorization", auth(superAdmin)).send(gift())));
    expect(together.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(together.map((r) => r.body.receipt_code).sort()).toEqual([3, 4, 5].map((n) => `OR-${year}-0000${n}`));
    const all = await testPool().query(`SELECT receipt_code FROM transactions WHERE source = 'admin' ORDER BY receipt_code`);
    expect(all.rows.map((r) => r.receipt_code)).toEqual([1, 2, 3, 4, 5].map((n) => `OR-${year}-0000${n}`));
    expect((await testPool().query(`SELECT next FROM receipt_counters WHERE year = $1`, [year])).rows[0].next).toBe(6);
  });

  it("an M-Pesa code is recorded once: a live office entry or a settled online payment with it is a 409 naming the row; a reversed entry frees it", async () => {
    const first = await post(superAdmin, "/admin/finance/gifts", gift({ channel: "mpesa", reference: "QAB1234567" }));
    expect(first.status).toBe(201);
    const dup = await post(superAdmin, "/admin/finance/gifts", gift({ channel: "mpesa", reference: "qab1234567", user_id: member2.id }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE_RECEIPT");
    expect(dup.body.error.details.transaction_id).toBe(first.body.transaction_id);
    expect(dup.body.error.message).toContain(first.body.transaction_id);
    // Online: a member's STK payment that settled with receipt QXY7654321.
    const mpesa = new FakeMobileMoneyProvider("mpesa");
    const fin = new FinancialService(testPool(), new FakeGateway(), { mpesa, airtel: new FakeMobileMoneyProvider("airtel") });
    const intent = await fin.createGivingIntent(member2.id, { fund: "tithe", amount_minor: 5_000, currency: "KES", method: "mpesa", phone_number: "+254711000002" } as never);
    const cb = JSON.stringify({ event_id: "evt-online-1", ref: intent.provider_ref, status: "succeeded", receipt: "QXY7654321" });
    await fin.handleMobileMoneyCallback("mpesa", cb, mpesa.sign(cb));
    await invariant();
    const online = await post(superAdmin, "/admin/finance/gifts", gift({ channel: "mpesa", reference: "QXY7654321" }));
    expect([online.status, online.body.error.code, online.body.error.details.transaction_id]).toEqual([409, "DUPLICATE_RECEIPT", intent.transaction_id]);
    // Reverse the office entry → the corrected one can be recorded.
    expect((await post(superAdmin, `/admin/finance/transactions/${first.body.transaction_id}/reverse`, { reason: "Wrong member" })).status).toBe(200);
    const corrected = await post(superAdmin, "/admin/finance/gifts", gift({ channel: "mpesa", reference: "QAB1234567", user_id: member2.id }));
    expect(corrected.status).toBe(201);
    expect(corrected.body.reference).toBe("QAB1234567");
    // The live-entry index is the backstop behind the check (case-blind).
    const other = await post(superAdmin, "/admin/finance/gifts", gift({ channel: "mpesa", reference: "QCD7654321" }));
    await expect(testPool().query(`UPDATE transactions SET office_reference = 'qab1234567' WHERE transaction_id = $1`, [other.body.transaction_id]))
      .rejects.toMatchObject({ code: "23505", constraint: "transactions_office_mpesa_ref_uniq" });
  });

  it("a pledge payment lands in the pledge's fund (the form's fund is ignored), shows on the member's statement and clears the instalment; reversal re-opens it", async () => {
    const fin = new FinancialService(testPool(), new FakeGateway());
    const partners = new PartnersService(testPool(), fin);
    const books = new FinanceBooks(testPool(), fin);
    const now = new Date("2026-09-14T09:00:00Z");
    const pledge = await partners.createPledge(member.id, { shape: "monthly", amount_minor: 250_000, currency: "KES", due_day: 10, fund: "mission", reminders_enabled: true } as never);
    await testPool().query(`UPDATE pledges SET created_at = '2026-09-02 08:00:00+00' WHERE pledge_id = $1`, [pledge.pledge_id]);
    const dueBefore = (await partners.partnership(member.id, now)).due as any[];
    expect(dueBefore.map((d) => [d.id, d.amount_minor, d.due_on])).toEqual([[pledge.pledge_id, 250_000, "2026-09-10"]]);

    const g = await books.recordGift(superAdmin.id, FinanceBooks.GiftInput.parse(gift({ fund: "tithe", pledge_id: pledge.pledge_id, amount_minor: 250_000, received_on: "2026-09-12" })), now);
    await invariant();
    expect(g.fund).toEqual({ code: "mission", name: "Missions" });
    expect(g.pledge).toMatchObject({ pledge_id: pledge.pledge_id });
    expect((g.ledger as any[])[1].account).toBe("fund:mission");
    const dueAfter = (await partners.partnership(member.id, now)).due as any[];
    expect(dueAfter).toEqual([]);
    const st = await partners.statements(member.id, 2026, now);
    expect(st.paid_minor).toBe(250_000);
    expect((st.pledges as any[]).find((p) => p.pledge_id === pledge.pledge_id).paid_minor).toBe(250_000);

    // Reverse: the gift leaves the statement and the instalment is owed again.
    const rev = await books.reverseTransaction(superAdmin.id, String(g.transaction_id), "Posted to the wrong member");
    await invariant();
    expect(rev.status).toBe("refunded");
    expect((await partners.partnership(member.id, now)).due as any[]).toHaveLength(1);
    const st2 = await partners.statements(member.id, 2026, now);
    expect(st2.paid_minor).toBe(0);
    expect((st2.payments as any[]).find((p) => p.transaction_id === g.transaction_id)).toBeUndefined();
    // Pledge rules: another member's pledge, a closed pledge, the wrong currency.
    await expect(books.recordGift(superAdmin.id, FinanceBooks.GiftInput.parse(gift({ user_id: member2.id, pledge_id: pledge.pledge_id, received_on: "2026-09-12" })), now)).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    await expect(books.recordGift(superAdmin.id, FinanceBooks.GiftInput.parse(gift({ pledge_id: pledge.pledge_id, currency: "USD", received_on: "2026-09-12" })), now)).rejects.toMatchObject({ code: "CURRENCY_MISMATCH" });
    await expect(books.recordGift(superAdmin.id, FinanceBooks.GiftInput.parse(gift({ user_id: null, giver_name: "Walk In", pledge_id: pledge.pledge_id, received_on: "2026-09-12" })), now)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await testPool().query(`UPDATE pledges SET status = 'cancelled' WHERE pledge_id = $1`, [pledge.pledge_id]);
    await expect(books.recordGift(superAdmin.id, FinanceBooks.GiftInput.parse(gift({ pledge_id: pledge.pledge_id, received_on: "2026-09-12" })), now)).rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });

  it("reversing the gift that fulfilled a total pledge puts the pledge back to active", async () => {
    const fin = new FinancialService(testPool(), new FakeGateway());
    const partners = new PartnersService(testPool(), fin);
    const pledge = await partners.createPledge(member.id, { shape: "total", target_minor: 300_000, currency: "KES", due_on: "2099-12-31", fund: "mission", reminders_enabled: true } as never);
    const g = await post(superAdmin, "/admin/finance/gifts", gift({ pledge_id: pledge.pledge_id, amount_minor: 300_000 }));
    expect(g.status).toBe(201);
    expect(await partners.fulfilCompleted(new NotificationService(testPool()))).toBe(1);
    expect((await testPool().query(`SELECT status FROM pledges WHERE pledge_id = $1`, [pledge.pledge_id])).rows[0].status).toBe("fulfilled");
    await post(superAdmin, `/admin/finance/transactions/${g.body.transaction_id}/reverse`, { reason: "Cheque bounced" });
    const p = (await testPool().query(`SELECT status, fulfilled_at FROM pledges WHERE pledge_id = $1`, [pledge.pledge_id])).rows[0];
    expect(p).toEqual({ status: "active", fulfilled_at: null });
    expect(await count(`SELECT count(*) FROM audit_log WHERE action = 'pledge.reopened' AND entity_id = $1`, [pledge.pledge_id])).toBe(1);
  });

  it("a need gift lands in the department's fund and counts toward the need; the need's currency must match", async () => {
    const notifications = new NotificationService(testPool());
    const departments = new DepartmentsService(testPool(), notifications);
    const d = await departments.create(admin.id, cong, { name: "Building", purpose: "The roof", leader_user_id: member2.id, gift_keys: [], fund_code: "general", is_open_to_join: true });
    const n = await departments.submitNeed(member2.id, String(d.department_id), { title: "Roof sheets", why: "The rains are coming and the hall leaks.", target_minor: 500_000, currency: "KES" });
    const pending = await post(superAdmin, "/admin/finance/gifts", gift({ user_id: null, giver_name: "Harambee guest", need_id: n.need_id }));
    expect(pending.status).toBe(422);
    await departments.decideNeed(admin.id, String(n.need_id), "approve");
    const g = await post(superAdmin, "/admin/finance/gifts", gift({ user_id: null, giver_name: "Harambee guest", need_id: n.need_id, fund: "tithe", amount_minor: 120_000 }));
    expect(g.status).toBe(201);
    expect(g.body.fund.code).toBe("general");
    expect(g.body.need).toEqual({ need_id: n.need_id, title: "Roof sheets" });
    const detail = await departments.get(member2.id, String(d.department_id));
    expect((detail.needs as any[])[0].raised_minor).toBe(120_000);
    const usd = await post(superAdmin, "/admin/finance/gifts", gift({ need_id: n.need_id, currency: "USD" }));
    expect([usd.status, usd.body.error.code]).toEqual([422, "CURRENCY_MISMATCH"]);
  });

  it("reversal: mirror legs restating the gift's day (received 10 days ago → both pairs at that noon, reversed_at now), fund back to its prior balance, once only", async () => {
    const day = daysAgo(10);
    const before = await fundBal("offering");
    const g = await post(checker, "/admin/finance/gifts", gift({ fund: "offering", received_on: day, amount_minor: 80_000 }));
    expect(await fundBal("offering")).toBe(before + 80_000);
    const t0 = Date.now();
    const rev = await post(manager, `/admin/finance/transactions/${g.body.transaction_id}/reverse`, { reason: "  Counted twice  " });
    expect(rev.status).toBe(200);
    expect(rev.body).toMatchObject({ status: "refunded", reversed_by: manager.id, reversed_by_name: "Mona Manager", reversal_reason: "Counted twice", receipt_code: g.body.receipt_code });
    expect(Date.parse(rev.body.reversed_at)).toBeGreaterThanOrEqual(t0 - 2_000);
    expect(rev.body.ledger.map((l: any) => [l.side, l.account, l.created_at])).toEqual([
      ["debit", "cash:onhand", noon(day)], ["credit", "fund:offering", noon(day)],
      ["debit", "fund:offering", noon(day)], ["credit", "cash:onhand", noon(day)],
    ]);
    expect(await fundBal("offering")).toBe(before);
    expect(await fundBal("offering", "KES", noon(day))).toBe(before);
    expect(await cashBal("cash:onhand")).toBe(0);
    const twice = await post(manager, `/admin/finance/transactions/${g.body.transaction_id}/reverse`, { reason: "Again please" });
    expect([twice.status, twice.body.error.code]).toEqual([422, "ALREADY_REVERSED"]);
    expect((await post(manager, `/admin/finance/transactions/${g.body.transaction_id}/reverse`, { reason: "x" })).status).toBe(400);
    const a = await testPool().query(`SELECT metadata FROM audit_log WHERE action = 'finance.gift_reversed' AND entity_id = $1`, [g.body.transaction_id]);
    expect(a.rows[0].metadata).toMatchObject({ amount_minor: 80_000, fund: "offering", reason: "Counted twice" });
    // A replay of the original key now reports the reversed row.
    const replay = await post(checker, "/admin/finance/gifts", { ...gift(), idempotency_key: (await testPool().query(`SELECT idempotency_key FROM transactions WHERE transaction_id = $1`, [g.body.transaction_id])).rows[0].idempotency_key });
    expect([replay.status, replay.body.status, replay.body.reused]).toEqual([200, "refunded", true]);
  });

  it("a provider payment (M-Pesa STK) is not reversible here; a confirmed manual claim is", async () => {
    const mpesa = new FakeMobileMoneyProvider("mpesa");
    const fin = new FinancialService(testPool(), new FakeGateway(), { mpesa, airtel: new FakeMobileMoneyProvider("airtel") });
    const intent = await fin.createGivingIntent(member.id, { fund: "tithe", amount_minor: 5_000, currency: "KES", method: "mpesa" } as never);
    const cb = JSON.stringify({ event_id: "evt-stk-1", ref: intent.provider_ref, status: "succeeded", receipt: "QRS1112223" });
    await fin.handleMobileMoneyCallback("mpesa", cb, mpesa.sign(cb));
    const stk = await post(superAdmin, `/admin/finance/transactions/${intent.transaction_id}/reverse`, { reason: "Member asked" });
    expect([stk.status, stk.body.error.code]).toEqual([422, "NOT_REVERSIBLE"]);
    expect((await post(superAdmin, `/admin/finance/transactions/00000000-0000-4000-8000-000000000000/reverse`, { reason: "Nothing here" })).status).toBe(404);
    // A confirmed "I paid another way" claim (provider manual, source app).
    const partners = new PartnersService(testPool(), fin);
    const pledge = await partners.createPledge(member.id, { shape: "monthly", amount_minor: 20_000, currency: "KES", due_day: 5, fund: "mission", reminders_enabled: true } as never);
    const claim = await partners.createClaim(member.id, String(pledge.pledge_id), { amount_minor: 20_000, currency: "KES", paid_on: daysAgo(2) });
    const decided = await partners.decideClaim(admin.id, String(claim.claim_id), "confirm", new NotificationService(testPool()));
    await invariant();
    const rev = await post(superAdmin, `/admin/finance/transactions/${decided.transaction_id}/reverse`, { reason: "Money never arrived" });
    expect(rev.status).toBe(200);
    expect(rev.body).toMatchObject({ status: "refunded", source: "app", channel: null, receipt_code: null });
    expect(rev.body.ledger.map((l: any) => `${l.side}:${l.account}`)).toEqual(["debit:cash:manual", "credit:fund:mission", "debit:fund:mission", "credit:cash:manual"]);
    // Mirror legs carry the original legs' timestamp exactly.
    const stamps = await testPool().query(`SELECT DISTINCT created_at FROM ledger_entries WHERE transaction_id = $1`, [decided.transaction_id]);
    expect(stamps.rowCount).toBe(1);
  });

  it("the STK callback settles even when its receipt code is already on another transaction (savepoint), and still captures a fresh one", async () => {
    const mpesa = new FakeMobileMoneyProvider("mpesa");
    const fin = new FinancialService(testPool(), new FakeGateway(), { mpesa, airtel: new FakeMobileMoneyProvider("airtel") });
    const one = await fin.createGivingIntent(member.id, { fund: "tithe", amount_minor: 1_000, currency: "KES", method: "mpesa" } as never);
    const cb1 = JSON.stringify({ event_id: "evt-a", ref: one.provider_ref, status: "succeeded", receipt: "ABC1234567" });
    await fin.handleMobileMoneyCallback("mpesa", cb1, mpesa.sign(cb1));
    const two = await fin.createGivingIntent(member2.id, { fund: "tithe", amount_minor: 2_000, currency: "KES", method: "mpesa" } as never);
    const cb2 = JSON.stringify({ event_id: "evt-b", ref: two.provider_ref, status: "succeeded", receipt: "ABC1234567" });
    await expect(fin.handleMobileMoneyCallback("mpesa", cb2, mpesa.sign(cb2))).resolves.toMatchObject({ duplicate: false, status: "succeeded" });
    const row = (await testPool().query(`SELECT status, receipt_code FROM transactions WHERE transaction_id = $1`, [two.transaction_id])).rows[0];
    expect(row).toEqual({ status: "succeeded", receipt_code: null });
    expect(await count(`SELECT count(*) FROM ledger_entries WHERE transaction_id = $1`, [two.transaction_id])).toBe(2);
    expect(await count(`SELECT count(*) FROM processed_webhooks WHERE event_id = 'evt-b'`)).toBe(1);
    const three = await fin.createGivingIntent(member2.id, { fund: "tithe", amount_minor: 3_000, currency: "KES", method: "mpesa" } as never);
    const cb3 = JSON.stringify({ event_id: "evt-c", ref: three.provider_ref, status: "succeeded", receipt: "ZZZ9999999" });
    await fin.handleMobileMoneyCallback("mpesa", cb3, mpesa.sign(cb3));
    expect((await testPool().query(`SELECT receipt_code FROM transactions WHERE transaction_id = $1`, [three.transaction_id])).rows[0].receipt_code).toBe("ZZZ9999999");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("funds", () => {
  it("create, rename, describe, reorder, deactivate — never delete; duplicate codes and bad slugs are refused; the code is permanent", async () => {
    const c = await post(manager, "/admin/finance/funds", { code: "building-2027", name: "Building Fund", name_sw: "Mfuko wa Ujenzi", description: "The new hall", sort: 5 });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ code: "building-2027", name: "Building Fund", name_sw: "Mfuko wa Ujenzi", description: "The new hall", sort: 5, is_active: true });
    expect((await post(manager, "/admin/finance/funds", { code: "building-2027", name: "Again" })).status).toBe(409);
    for (const code of ["Building", "1fund", "a", "has space", "x".repeat(41)]) {
      expect((await post(manager, "/admin/finance/funds", { code, name: "Bad" })).status, code).toBe(400);
    }
    const u = await patch(manager, "/admin/finance/funds/building-2027", { name: "Hall Fund", description: null, sort: 1 });
    expect(u.body).toMatchObject({ code: "building-2027", name: "Hall Fund", description: null, sort: 1, name_sw: "Mfuko wa Ujenzi" });
    expect((await patch(manager, "/admin/finance/funds/building-2027", { code: "renamed" })).status).toBe(400);
    expect((await patch(manager, "/admin/finance/funds/building-2027", {})).status).toBe(400);
    expect((await patch(manager, "/admin/finance/funds/nope", { name: "Nope" })).status).toBe(404);
    const g = await post(manager, "/admin/finance/gifts", gift({ fund: "building-2027" }));
    expect(g.body.ledger[1].account).toBe("fund:building-2027");
    expect((await patch(manager, "/admin/finance/funds/building-2027", { is_active: false })).body.is_active).toBe(false);
    expect((await post(manager, "/admin/finance/gifts", gift({ fund: "building-2027" }))).status).toBe(422);
    expect(await count(`SELECT count(*) FROM funds WHERE code = 'building-2027'`)).toBe(1);
    const audits = await testPool().query(`SELECT action FROM audit_log WHERE action LIKE 'fund.%' ORDER BY audit_id`);
    expect(audits.rows.map((r) => r.action)).toEqual(["fund.created", "fund.updated", "fund.updated"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("journals — transfers, opening balances, reversal", () => {
  it("a transfer is one balanced journal at occurred_on noon; the from-fund may not go negative unless allowed; idempotent; guarded", async () => {
    await post(superAdmin, "/admin/finance/gifts", gift({ fund: "tithe", amount_minor: 1_000_000 }));
    const day = daysAgo(1);
    const t = await post(approver, "/admin/finance/transfers", { from_fund: "tithe", to_fund: "mission", amount_minor: 400_000, currency: "KES", occurred_on: day, memo: "Missions share", idempotency_key: "transfer-key-1" });
    expect(t.status).toBe(201);
    expect(t.body).toMatchObject({ from_fund: { code: "tithe" }, to_fund: { code: "mission" }, amount_minor: 400_000, currency: "KES", occurred_on: day, memo: "Missions share", from_balance_after_minor: 600_000, reused: false, reversed_by_journal_id: null });
    expect(t.body.ledger.map((l: any) => [l.side, l.account, l.created_at])).toEqual([["debit", "fund:tithe", noon(day)], ["credit", "fund:mission", noon(day)]]);
    expect([await fundBal("tithe"), await fundBal("mission")]).toEqual([600_000, 400_000]);
    const ft = await testPool().query(`SELECT j.kind, j.ref_id, j.occurred_on::text FROM journals j WHERE j.journal_id = $1`, [t.body.journal_id]);
    expect(ft.rows[0]).toEqual({ kind: "transfer", ref_id: t.body.transfer_id, occurred_on: day });
    const replay = await post(approver, "/admin/finance/transfers", { from_fund: "tithe", to_fund: "mission", amount_minor: 400_000, currency: "KES", occurred_on: day, memo: "Missions share", idempotency_key: "transfer-key-1" });
    expect([replay.status, replay.body.reused, replay.body.transfer_id]).toEqual([200, true, t.body.transfer_id]);
    expect(await fundBal("tithe")).toBe(600_000);
    const tooMuch = await post(approver, "/admin/finance/transfers", { from_fund: "tithe", to_fund: "general", amount_minor: 700_000, currency: "KES", occurred_on: today(), memo: "Too much" });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error.details).toMatchObject({ reason: "NEGATIVE_BALANCE", balance_minor: 600_000, balance_after_minor: -100_000 });
    const allowed = await post(approver, "/admin/finance/transfers", { from_fund: "tithe", to_fund: "general", amount_minor: 700_000, currency: "KES", occurred_on: today(), memo: "Bridge loan", allow_negative: true });
    expect([allowed.status, allowed.body.from_balance_after_minor]).toEqual([201, -100_000]);
    // USD balances are their own: tithe has none.
    expect((await post(approver, "/admin/finance/transfers", { from_fund: "tithe", to_fund: "general", amount_minor: 1, currency: "USD", occurred_on: today(), memo: "USD" })).status).toBe(422);
    expect((await post(approver, "/admin/finance/transfers", { from_fund: "tithe", to_fund: "tithe", amount_minor: 1, currency: "KES", occurred_on: today(), memo: "Same" })).status).toBe(400);
    const future = await post(approver, "/admin/finance/transfers", { from_fund: "tithe", to_fund: "general", amount_minor: 1, currency: "KES", occurred_on: nairobiDate(new Date(Date.now() + 3 * 86_400_000)), memo: "Later", allow_negative: true });
    expect([future.status, future.body.error.code]).toEqual([422, "INVALID_DATE"]);
    await testPool().query(`UPDATE funds SET is_active = FALSE WHERE code = 'gift'`);
    expect((await post(approver, "/admin/finance/transfers", { from_fund: "tithe", to_fund: "gift", amount_minor: 1, currency: "KES", occurred_on: today(), memo: "Into inactive", allow_negative: true })).status).toBe(422);
    expect((await post(approver, "/admin/finance/transfers", { from_fund: "gift", to_fund: "tithe", amount_minor: 1, currency: "KES", occurred_on: today(), memo: "Out of inactive", allow_negative: true })).status).toBe(201);
    expect(await count(`SELECT count(*) FROM audit_log WHERE action = 'journal.transfer_posted'`)).toBe(3);
  });

  it("an opening balance posts cash → fund at as_of noon (idempotent); reversing it restores both; once only; expense journals and reversals refuse", async () => {
    const asOf = daysAgo(400);
    const body = { idempotency_key: "opening-bank-general", channel: "bank", fund: "general", amount_minor: 5_000_000_00, currency: "KES", as_of: asOf, memo: "Bank balance at go-live" };
    const o = await post(approver, "/admin/finance/opening-balances", body);
    expect(o.status).toBe(201);
    expect(o.body).toMatchObject({ kind: "opening", memo: "Bank balance at go-live", occurred_on: asOf, created_by: approver.id, created_by_name: "Abel Approver", reversal_of: null, reversed_by_journal_id: null, reused: false, totals: [{ currency: "KES", amount_minor: 5_000_000_00 }] });
    expect(o.body.legs.map((l: any) => [l.side, l.account, l.created_at])).toEqual([["debit", "cash:bank", noon(asOf)], ["credit", "fund:general", noon(asOf)]]);
    expect([await fundBal("general"), await cashBal("cash:bank")]).toEqual([5_000_000_00, 5_000_000_00]);
    const replay = await post(approver, "/admin/finance/opening-balances", body);
    expect([replay.status, replay.body.reused, replay.body.journal_id]).toEqual([200, true, o.body.journal_id]);
    expect((await post(approver, "/admin/finance/opening-balances", { ...body, idempotency_key: "opening-too-old", as_of: daysAgo(3661) })).body.error.code).toBe("INVALID_DATE");
    expect((await post(approver, "/admin/finance/opening-balances", { ...body, idempotency_key: "transfer-key-x", fund: "nope" })).status).toBe(422);

    const r = await post(approver, `/admin/finance/journals/${o.body.journal_id}/reverse`, { reason: "Wrong statement month" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ kind: "reversal", reversal_of: o.body.journal_id, memo: "Wrong statement month", occurred_on: asOf });
    expect(r.body.legs.map((l: any) => [l.side, l.account, l.created_at])).toEqual([["debit", "fund:general", noon(asOf)], ["credit", "cash:bank", noon(asOf)]]);
    expect([await fundBal("general"), await cashBal("cash:bank")]).toEqual([0, 0]);
    const orig = await get(approver, `/admin/finance/journals/${o.body.journal_id}`);
    expect(orig.body.reversed_by_journal_id).toBe(r.body.journal_id);
    const twice = await post(approver, `/admin/finance/journals/${o.body.journal_id}/reverse`, { reason: "And again" });
    expect([twice.status, twice.body.error.code]).toEqual([422, "ALREADY_REVERSED"]);
    const ofReversal = await post(approver, `/admin/finance/journals/${r.body.journal_id}/reverse`, { reason: "Undo the undo" });
    expect([ofReversal.status, ofReversal.body.error.code]).toEqual([422, "NOT_REVERSIBLE"]);
    // An expense journal is undone by voiding its expense.
    const e = await post(manager, "/admin/finance/expenses", { fund: "general", category: "utilities", payee: "Kenya Power", amount_minor: 10_000, currency: "KES", spent_on: today(), channel: "mpesa" });
    const ok = await post(approver, `/admin/finance/expenses/${e.body.expense_id}/approve`);
    const viaJournal = await post(approver, `/admin/finance/journals/${ok.body.journal_id}/reverse`, { reason: "Not like this" });
    expect([viaJournal.status, viaJournal.body.error.code]).toEqual([422, "USE_EXPENSE_VOID"]);
    // The database backs "once": a second reversal row cannot exist.
    await expect(testPool().query(
      `INSERT INTO journals (kind, occurred_on, reversal_of) VALUES ('reversal', $1, $2)`, [asOf, o.body.journal_id],
    )).rejects.toMatchObject({ code: "23505", constraint: "journals_one_reversal" });
    expect(await count(`SELECT count(*) FROM audit_log WHERE action IN ('journal.opening_posted', 'journal.reversed')`)).toBe(2);
  });

  it("reversing a transfer takes the money back out of the receiving fund — refused if that goes negative unless allowed", async () => {
    await post(superAdmin, "/admin/finance/gifts", gift({ fund: "tithe", amount_minor: 500_000 }));
    const t = await post(approver, "/admin/finance/transfers", { from_fund: "tithe", to_fund: "mission", amount_minor: 300_000, currency: "KES", occurred_on: today(), memo: "Share" });
    await post(approver, "/admin/finance/transfers", { from_fund: "mission", to_fund: "general", amount_minor: 250_000, currency: "KES", occurred_on: today(), memo: "Onward" });
    const refused = await post(approver, `/admin/finance/journals/${t.body.journal_id}/reverse`, { reason: "Wrong fund" });
    expect(refused.status).toBe(422);
    expect(refused.body.error.details).toMatchObject({ reason: "NEGATIVE_BALANCE", fund: "mission", balance_minor: 50_000, balance_after_minor: -250_000 });
    const done = await post(approver, `/admin/finance/journals/${t.body.journal_id}/reverse`, { reason: "Wrong fund", allow_negative: true });
    expect(done.status).toBe(201);
    expect([await fundBal("tithe"), await fundBal("mission"), await fundBal("general")]).toEqual([500_000, -250_000, 250_000]);
    const view = await get(approver, `/admin/finance/journals/${t.body.journal_id}`);
    expect(view.body.reversed_by_journal_id).toBe(done.body.journal_id);
  });

  it("the journal register pages newest first with legs and whole-set totals per currency", async () => {
    await post(approver, "/admin/finance/opening-balances", { idempotency_key: "opening-cash-box", channel: "onhand", fund: "general", amount_minor: 1_000, currency: "KES", as_of: daysAgo(30), memo: "Cash box" });
    await post(approver, "/admin/finance/opening-balances", { idempotency_key: "opening-usd-account", channel: "bank", fund: "general", amount_minor: 2_000, currency: "USD", as_of: daysAgo(20), memo: "USD account" });
    await post(approver, "/admin/finance/transfers", { from_fund: "general", to_fund: "mission", amount_minor: 500, currency: "KES", occurred_on: daysAgo(10), memo: "Share" });
    const p1 = await get(viewer, "/admin/finance/journals?limit=2");
    expect(p1.status).toBe(200);
    expect(p1.body.data.map((j: any) => j.kind)).toEqual(["transfer", "opening"]);
    expect(p1.body.totals).toEqual([{ currency: "KES", amount_minor: 1_500, count: 2 }, { currency: "USD", amount_minor: 2_000, count: 1 }]);
    const p2 = await get(viewer, `/admin/finance/journals?limit=2&cursor=${p1.body.next_cursor}`);
    expect(p2.body.data.map((j: any) => [j.kind, j.occurred_on])).toEqual([["opening", daysAgo(30)]]);
    expect(p2.body.next_cursor).toBeNull();
    const only = await get(viewer, `/admin/finance/journals?kind=opening&from=${daysAgo(25)}`);
    expect(only.body.data.map((j: any) => j.memo)).toEqual(["USD account"]);
    expect((await get(viewer, "/admin/finance/journals?kind=bogus")).status).toBe(400);
    expect((await get(viewer, "/admin/finance/journals?cursor=garbage")).status).toBe(400);
    expect((await get(viewer, "/admin/finance/journals/00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("expenses — maker-checker", () => {
  const expense = (over: Record<string, unknown> = {}) => ({
    fund: "general", category: "utilities", payee: "Nairobi Water", description: "September bill", amount_minor: 35_000, currency: "KES",
    spent_on: lastMonth15(), channel: "bank", reference: "TRF-889", ...over,
  });

  it("recording posts nothing; the maker (recorder OR editor) cannot approve; a different approver posts at spent_on noon — last month's bill lands last month", async () => {
    const e = await post(manager, "/admin/finance/expenses", expense());
    expect(e.status).toBe(201);
    expect(e.body).toMatchObject({ status: "recorded", fund: { code: "general" }, category: { code: "utilities" }, payee: "Nairobi Water", amount_minor: 35_000, spent_on: lastMonth15(), channel: "bank", recorded_by: manager.id, recorded_by_name: "Mona Manager", journal_id: null });
    expect(await count(`SELECT count(*) FROM ledger_entries`)).toBe(0);
    // manage without approve: 403 FORBIDDEN_SCOPE
    const noCap = await post(manager, `/admin/finance/expenses/${e.body.expense_id}/approve`);
    expect([noCap.status, noCap.body.error.code]).toEqual([403, "FORBIDDEN_SCOPE"]);
    // checker edits it → checker is a maker now → SAME_PERSON
    const edited = await patch(checker, `/admin/finance/expenses/${e.body.expense_id}`, { amount_minor: 36_000, description: null });
    expect(edited.body).toMatchObject({ amount_minor: 36_000, description: null, status: "recorded" });
    const same = await post(checker, `/admin/finance/expenses/${e.body.expense_id}/approve`);
    expect([same.status, same.body.error.code]).toEqual([403, "SAME_PERSON"]);
    const ok = await post(approver, `/admin/finance/expenses/${e.body.expense_id}/approve`);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: "approved", approved_by: approver.id, approved_by_name: "Abel Approver" });
    const j = await get(viewer, `/admin/finance/journals/${ok.body.journal_id}`);
    expect(j.body).toMatchObject({ kind: "expense", occurred_on: lastMonth15(), ref_id: e.body.expense_id, memo: "Nairobi Water" });
    expect(j.body.legs.map((l: any) => [l.side, l.account, l.amount_minor, l.created_at])).toEqual([
      ["debit", "fund:general", 36_000, noon(lastMonth15())], ["credit", "cash:bank", 36_000, noon(lastMonth15())],
    ]);
    expect([await fundBal("general"), await cashBal("cash:bank")]).toEqual([-36_000, -36_000]);
    expect((await post(approver, `/admin/finance/expenses/${e.body.expense_id}/approve`)).status).toBe(422);
    expect((await patch(checker, `/admin/finance/expenses/${e.body.expense_id}`, { payee: "Too late" })).status).toBe(422);
  });

  it("an Admin cannot approve their own expense; a SuperAdmin may", async () => {
    const mine = await post(admin, "/admin/finance/expenses", expense());
    const own = await post(admin, `/admin/finance/expenses/${mine.body.expense_id}/approve`);
    expect([own.status, own.body.error.code]).toEqual([403, "SAME_PERSON"]);
    const sup = await post(superAdmin, "/admin/finance/expenses", expense({ payee: "Hall cleaners" }));
    expect((await post(superAdmin, `/admin/finance/expenses/${sup.body.expense_id}/approve`)).body.status).toBe("approved");
  });

  it("voiding an approved expense mirrors its journal at the approval legs' timestamp; voiding a recorded one posts nothing; void once", async () => {
    const a = await post(manager, "/admin/finance/expenses", expense({ amount_minor: 50_000 }));
    await post(approver, `/admin/finance/expenses/${a.body.expense_id}/approve`);
    expect(await fundBal("general")).toBe(-50_000);
    const v = await post(manager, `/admin/finance/expenses/${a.body.expense_id}/void`, { reason: "Duplicate invoice" });
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ status: "void", voided_by: manager.id, void_reason: "Duplicate invoice" });
    const vj = await get(viewer, `/admin/finance/journals/${v.body.void_journal_id}`);
    expect(vj.body).toMatchObject({ kind: "expense_void", occurred_on: lastMonth15(), ref_id: a.body.expense_id });
    expect(vj.body.legs.map((l: any) => [l.side, l.account, l.created_at])).toEqual([["debit", "cash:bank", noon(lastMonth15())], ["credit", "fund:general", noon(lastMonth15())]]);
    expect([await fundBal("general"), await cashBal("cash:bank")]).toEqual([0, 0]);
    const again = await post(manager, `/admin/finance/expenses/${a.body.expense_id}/void`, { reason: "Once more" });
    expect(again.status).toBe(422);
    const r = await post(manager, "/admin/finance/expenses", expense({ payee: "Printer ink" }));
    const legs = await count(`SELECT count(*) FROM ledger_entries`);
    const rv = await post(manager, `/admin/finance/expenses/${r.body.expense_id}/void`, { reason: "Entered by mistake" });
    expect(rv.body).toMatchObject({ status: "void", void_journal_id: null, journal_id: null });
    expect(await count(`SELECT count(*) FROM ledger_entries`)).toBe(legs);
    expect((await post(approver, `/admin/finance/expenses/${r.body.expense_id}/approve`)).status).toBe(422);
    const acts = await testPool().query(`SELECT action FROM audit_log WHERE entity = 'expenses' AND entity_id = $1 ORDER BY audit_id`, [a.body.expense_id]);
    expect(acts.rows.map((x) => x.action)).toEqual(["expense.recorded", "expense.approved", "expense.voided"]);
  });

  it("validation: dates, inactive fund or category, unknown fields", async () => {
    expect((await post(manager, "/admin/finance/expenses", expense({ spent_on: nairobiDate(new Date(Date.now() + 86_400_000)) }))).body.error.code).toBe("INVALID_DATE");
    expect((await post(manager, "/admin/finance/expenses", expense({ spent_on: daysAgo(400) }))).body.error.code).toBe("INVALID_DATE");
    expect((await post(manager, "/admin/finance/expenses", expense({ payee: "x" }))).status).toBe(400);
    expect((await post(manager, "/admin/finance/expenses", expense({ category: "nope" }))).status).toBe(422);
    await testPool().query(`UPDATE expense_categories SET is_active = FALSE WHERE code = 'rent'`);
    expect((await post(manager, "/admin/finance/expenses", expense({ category: "rent" }))).status).toBe(422);
    const e = await post(manager, "/admin/finance/expenses", expense());
    expect((await patch(manager, `/admin/finance/expenses/${e.body.expense_id}`, { status: "approved" })).status).toBe(400);
    expect((await patch(manager, `/admin/finance/expenses/${e.body.expense_id}`, { spent_on: daysAgo(500) })).body.error.code).toBe("INVALID_DATE");
    expect((await get(viewer, "/admin/finance/expenses/00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });

  it("the register filters, pages, and totals the WHOLE filtered set per currency (and per status); the CSV is its twin", async () => {
    const mk = async (over: Record<string, unknown>) => (await post(manager, "/admin/finance/expenses", expense(over))).body;
    const a = await mk({ payee: "Kenya Power", amount_minor: 10_000, spent_on: daysAgo(3) });
    const b = await mk({ payee: "Nairobi Water", amount_minor: 20_000, spent_on: daysAgo(2) });
    await mk({ payee: "=HYPERLINK(\"http://evil\")", amount_minor: 30_000, spent_on: daysAgo(1), category: "events" });
    await mk({ payee: "US vendor", amount_minor: 4_000, currency: "USD", spent_on: daysAgo(1) });
    await post(approver, `/admin/finance/expenses/${a.expense_id}/approve`);
    await post(manager, `/admin/finance/expenses/${b.expense_id}/void`, { reason: "Wrong month" });
    const all = await get(viewer, "/admin/finance/expenses?limit=2");
    expect(all.body.data).toHaveLength(2);
    expect(all.body.totals).toEqual([{ currency: "KES", amount_minor: 60_000, count: 3 }, { currency: "USD", amount_minor: 4_000, count: 1 }]);
    expect(all.body.totals_by_status).toEqual(expect.arrayContaining([
      { status: "approved", currency: "KES", amount_minor: 10_000, count: 1 },
      { status: "void", currency: "KES", amount_minor: 20_000, count: 1 },
      { status: "recorded", currency: "KES", amount_minor: 30_000, count: 1 },
    ]));
    const page2 = await get(viewer, `/admin/finance/expenses?limit=2&cursor=${all.body.next_cursor}`);
    const seen = [...all.body.data, ...page2.body.data].map((x: any) => x.expense_id);
    expect(new Set(seen).size).toBe(4);
    const live = await get(viewer, "/admin/finance/expenses?status=recorded,approved");
    expect(live.body.totals).toEqual([{ currency: "KES", amount_minor: 40_000, count: 2 }, { currency: "USD", amount_minor: 4_000, count: 1 }]);
    const byQ = await get(viewer, "/admin/finance/expenses?q=power");
    expect(byQ.body.data.map((x: any) => x.payee)).toEqual(["Kenya Power"]);
    const byCat = await get(viewer, `/admin/finance/expenses?category=events&from=${daysAgo(1)}&to=${today()}`);
    expect(byCat.body.data).toHaveLength(1);
    expect((await get(viewer, "/admin/finance/expenses?status=paid")).status).toBe(400);
    // CSV: export capability, header row, neutralised formula, exact money.
    expect((await get(viewer, "/admin/finance/expenses.csv")).status).toBe(403);
    const csv = await get(exporter, "/admin/finance/expenses.csv?status=recorded");
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    const lines = csv.text.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("expense_id,spent_on,payee,category,fund,description,amount,currency,channel,reference,status,recorded_by,recorded_at,approved_by,approved_at,voided_by,voided_at,void_reason");
    expect(lines).toHaveLength(3);
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv.text).toContain(",300.00,KES,");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("expense categories", () => {
  it("list, add (unique slug), rename, reorder, deactivate", async () => {
    const list = await get(viewer, "/admin/finance/expense-categories");
    expect(list.status).toBe(200);
    expect(list.body.data.map((k: any) => k.code).slice(0, 3)).toEqual(["staff-honoraria", "utilities", "rent"]);
    const c = await post(manager, "/admin/finance/expense-categories", { code: "youth-camp", name: "Youth camp", sort: 15 });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ code: "youth-camp", name: "Youth camp", sort: 15, is_active: true });
    expect((await post(manager, "/admin/finance/expense-categories", { code: "youth-camp", name: "Again" })).status).toBe(409);
    expect((await post(manager, "/admin/finance/expense-categories", { code: "Youth", name: "Bad" })).status).toBe(400);
    const u = await patch(manager, `/admin/finance/expense-categories/${c.body.category_id}`, { name: "Youth camps", is_active: false });
    expect(u.body).toMatchObject({ name: "Youth camps", is_active: false, code: "youth-camp" });
    expect((await patch(manager, `/admin/finance/expense-categories/${c.body.category_id}`, { code: "x-y" })).status).toBe(400);
    expect((await patch(manager, "/admin/finance/expense-categories/00000000-0000-4000-8000-000000000000", { name: "Nope" })).status).toBe(404);
    expect((await get(viewer, "/admin/finance/expense-categories")).body.data.find((k: any) => k.code === "youth-camp").sort).toBe(15);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("budgets", () => {
  const months = (m: Record<number, number>): number[] => Array.from({ length: 12 }, (_, i) => m[i + 1] ?? 0);

  it("draft → lines (validated, order kept) → approve → read-only", async () => {
    const b = await post(manager, "/admin/finance/budgets", { year: 2027, name: "Budget 2027" });
    expect(b.status).toBe(201);
    expect(b.body).toMatchObject({ year: 2027, name: "Budget 2027", status: "draft", currency: "KES", line_count: 0, lines: [] });
    expect((await post(manager, "/admin/finance/budgets", { year: 2027, name: "Again" })).status).toBe(409);
    const id = b.body.budget_id;
    const bad = [
      [{ kind: "income", label: "No fund", monthly_minor: months({}) }],
      [{ kind: "income", fund: "tithe", category: "utilities", label: "Both", monthly_minor: months({}) }],
      [{ kind: "expense", label: "No category", monthly_minor: months({}) }],
      [{ kind: "income", fund: "tithe", label: "Short", monthly_minor: [1, 2, 3] }],
      [{ kind: "income", fund: "tithe", label: "Negative", monthly_minor: months({ 1: -5 }) }],
      [{ kind: "income", fund: "tithe", label: "A", monthly_minor: months({}) }, { kind: "income", fund: "tithe", label: "B", monthly_minor: months({}) }],
      [{ kind: "expense", category: "utilities", label: "Church", monthly_minor: months({}) }, { kind: "expense", category: "utilities", fund: "general", label: "General", monthly_minor: months({}) }],
    ];
    for (const lines of bad) expect((await put(manager, `/admin/finance/budgets/${id}/lines`, { lines })).status, JSON.stringify(lines)).toBe(400);
    expect((await put(manager, `/admin/finance/budgets/${id}/lines`, { lines: [{ kind: "income", fund: "nope", label: "Unknown", monthly_minor: months({}) }] })).status).toBe(422);
    const lines = [
      { kind: "expense", category: "utilities", fund: "general", label: "Utilities — general", monthly_minor: months({ 1: 10_000, 2: 10_000 }) },
      { kind: "income", fund: "tithe", label: "Tithes", monthly_minor: months({ 1: 100_000, 12: 150_000 }) },
      { kind: "expense", category: "utilities", fund: "mission", label: "Utilities — mission", monthly_minor: months({ 3: 5_000 }) },
    ];
    const set = await put(manager, `/admin/finance/budgets/${id}/lines`, { lines });
    expect(set.status).toBe(200);
    expect(set.body.lines.map((l: any) => [l.kind, l.label, l.total_minor])).toEqual([
      ["income", "Tithes", 250_000], ["expense", "Utilities — general", 20_000], ["expense", "Utilities — mission", 5_000],
    ]);
    expect(set.body).toMatchObject({ line_count: 3, income_total_minor: 250_000, expense_total_minor: 25_000 });
    expect((await patch(manager, `/admin/finance/budgets/${id}`, { name: "Budget 2027 (v2)" })).body.name).toBe("Budget 2027 (v2)");
    expect((await post(manager, `/admin/finance/budgets/${id}/approve`)).status).toBe(403);
    const ok = await post(approver, `/admin/finance/budgets/${id}/approve`);
    expect(ok.body).toMatchObject({ status: "approved", approved_by: approver.id });
    expect((await put(manager, `/admin/finance/budgets/${id}/lines`, { lines })).status).toBe(422);
    expect((await patch(manager, `/admin/finance/budgets/${id}`, { name: "Changed" })).status).toBe(422);
    expect((await post(approver, `/admin/finance/budgets/${id}/approve`)).status).toBe(422);
    const empty = await post(manager, "/admin/finance/budgets", { year: 2028, name: "Budget 2028" });
    expect((await post(approver, `/admin/finance/budgets/${empty.body.budget_id}/approve`)).status).toBe(422);
    expect((await get(viewer, "/admin/finance/budgets")).body.data.map((x: any) => x.year)).toEqual([2028, 2027]);
    const acts = await testPool().query(`SELECT action FROM audit_log WHERE entity = 'budgets' AND entity_id = $1 ORDER BY audit_id`, [id]);
    expect(acts.rows.map((x) => x.action)).toEqual(["budget.created", "budget.lines_replaced", "budget.updated", "budget.approved"]);
  });

  it("budget vs actual with known numbers — succeeded KES gifts by month, approved KES expenses by spent_on month, unbudgeted money shown, USD / reversed / void / unapproved left out", async () => {
    const fin = new FinancialService(testPool(), new FakeGateway());
    const books = new FinanceBooks(testPool(), fin);
    const now = new Date("2026-09-20T09:00:00Z");
    const give = async (over: Record<string, unknown>) => {
      const g = await books.recordGift(superAdmin.id, FinanceBooks.GiftInput.parse(gift(over)), now);
      await invariant();
      return g;
    };
    await give({ fund: "tithe", amount_minor: 50_000, received_on: "2026-03-10" });
    await give({ fund: "tithe", amount_minor: 20_000, received_on: "2026-03-20" });
    await give({ fund: "offering", amount_minor: 30_000, received_on: "2026-04-05" });           // unbudgeted income
    await give({ fund: "tithe", amount_minor: 9_999, currency: "USD", received_on: "2026-03-11" }); // USD: outside budgets
    const reversed = await give({ fund: "tithe", amount_minor: 7_777, received_on: "2026-03-12" });
    await books.reverseTransaction(superAdmin.id, String(reversed.transaction_id), "Counted twice");
    const spend = async (over: Record<string, unknown>, approve = true) => {
      const e = await books.recordExpense(manager.id, FinanceBooks.ExpenseInput.parse({ fund: "general", category: "utilities", payee: "Kenya Power", amount_minor: 15_000, currency: "KES", spent_on: "2026-03-15", channel: "bank", ...over }), now);
      if (approve) await books.approveExpense({ userId: approver.id, role: "Instructor" }, String(e.expense_id));
      await invariant();
      return e;
    };
    await spend({});
    await spend({ amount_minor: 9_999 }, false);                                   // recorded only
    const voided = await spend({ amount_minor: 4_444 });
    await books.voidExpense(manager.id, String(voided.expense_id), "Duplicate invoice");
    await spend({ category: "rent", payee: "Landlord", amount_minor: 40_000, spent_on: "2026-04-01" }); // unbudgeted expense
    await spend({ fund: "mission", payee: "Mission house power", amount_minor: 2_500, spent_on: "2026-03-18" }); // utilities, but a fund-scoped line below excludes it

    const b = await books.createBudget(manager.id, { year: 2026, name: "Budget 2026" });
    await books.replaceBudgetLines(manager.id, String(b.budget_id), FinanceBooks.BudgetLinesInput.parse({
      lines: [
        { kind: "income", fund: "tithe", label: "Tithes", monthly_minor: months({ 3: 60_000, 4: 60_000 }) },
        { kind: "expense", category: "utilities", fund: "general", label: "Utilities", monthly_minor: months({ 3: 10_000 }) },
      ],
    }));
    const act = await get(viewer, `/admin/finance/budgets/${b.budget_id}/actuals`);
    expect(act.status).toBe(200);
    expect(act.body.months[0]).toBe("2026-01");
    const [tithes, utilities] = act.body.lines;
    expect(tithes).toMatchObject({ kind: "income", label: "Tithes", actual_total_minor: 70_000, budget_total_minor: 120_000, variance_total_minor: -50_000 });
    expect([tithes.actual_minor[2], tithes.variance_minor[2], tithes.actual_minor[3], tithes.variance_minor[3]]).toEqual([70_000, 10_000, 0, -60_000]);
    expect(utilities).toMatchObject({ kind: "expense", actual_total_minor: 15_000, budget_total_minor: 10_000, variance_total_minor: 5_000 });
    expect(utilities.actual_minor[2]).toBe(15_000);
    const [inc, exp] = act.body.totals;
    expect(inc).toMatchObject({ kind: "income", budget_total_minor: 120_000, actual_total_minor: 70_000, unbudgeted_total_minor: 30_000 });
    expect(inc.unbudgeted_minor[3]).toBe(30_000);
    expect(exp).toMatchObject({ kind: "expense", budget_total_minor: 10_000, actual_total_minor: 15_000, unbudgeted_total_minor: 42_500 });
    expect([exp.unbudgeted_minor[2], exp.unbudgeted_minor[3]]).toEqual([2_500, 40_000]);
    // actual + unbudgeted foots to the year's KES total of that kind.
    const kesIncome = await count(`SELECT COALESCE(sum(amount_minor), 0) FROM transactions WHERE status = 'succeeded' AND currency = 'KES' AND created_at >= '2026-01-01T00:00:00+03:00' AND created_at < '2027-01-01T00:00:00+03:00'`);
    expect(inc.actual_total_minor + inc.unbudgeted_total_minor).toBe(kesIncome);
    const kesSpend = await count(`SELECT COALESCE(sum(amount_minor), 0) FROM expenses WHERE status = 'approved' AND currency = 'KES' AND spent_on BETWEEN '2026-01-01' AND '2026-12-31'`);
    expect(exp.actual_total_minor + exp.unbudgeted_total_minor).toBe(kesSpend);
    expect((await get(viewer, "/admin/finance/budgets/00000000-0000-4000-8000-000000000000/actuals")).status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("permissions (§6)", () => {
  const X = "00000000-0000-4000-8000-000000000000";
  const writes: Array<[string, string, unknown]> = [
    ["post", "/admin/finance/gifts", {}],
    ["post", `/admin/finance/transactions/${X}/reverse`, { reason: "Because" }],
    ["post", "/admin/finance/funds", {}],
    ["patch", "/admin/finance/funds/tithe", { name: "Tithes" }],
    ["post", "/admin/finance/transfers", {}],
    ["post", "/admin/finance/opening-balances", {}],
    ["post", `/admin/finance/journals/${X}/reverse`, { reason: "Because" }],
    ["post", "/admin/finance/expenses", {}],
    ["patch", `/admin/finance/expenses/${X}`, { payee: "Someone" }],
    ["post", `/admin/finance/expenses/${X}/approve`, {}],
    ["post", `/admin/finance/expenses/${X}/void`, { reason: "Because" }],
    ["post", "/admin/finance/expense-categories", {}],
    ["patch", `/admin/finance/expense-categories/${X}`, { name: "Nope" }],
    ["post", "/admin/finance/budgets", {}],
    ["patch", `/admin/finance/budgets/${X}`, { name: "Nope" }],
    ["put", `/admin/finance/budgets/${X}/lines`, { lines: [] }],
    ["post", `/admin/finance/budgets/${X}/approve`, {}],
  ];
  const call = (who: Who, [m, p, body]: [string, string, unknown]) =>
    (supertest(app) as any)[m](`/v1${p}`).set("Authorization", auth(who)).send(body);
  const approveOnly = new Set(["/admin/finance/transfers", "/admin/finance/opening-balances", `/admin/finance/journals/${X}/reverse`, `/admin/finance/expenses/${X}/approve`, `/admin/finance/budgets/${X}/approve`]);

  it("finance:view reads everything and writes nothing", async () => {
    for (const wr of writes) {
      const res = await call(viewer, wr);
      expect([res.status, res.body.error?.code], `${wr[0]} ${wr[1]}`).toEqual([403, "FORBIDDEN_SCOPE"]);
    }
    for (const path of ["/admin/finance/expenses", "/admin/finance/expense-categories", "/admin/finance/budgets", "/admin/finance/journals"]) {
      expect((await get(viewer, path)).status, path).toBe(200);
    }
  });

  it("finance:manage without approve cannot approve, transfer, open balances or reverse journals — and can do the rest", async () => {
    for (const wr of writes) {
      const res = await call(manager, wr);
      if (approveOnly.has(wr[1])) expect(res.status, `${wr[0]} ${wr[1]}`).toBe(403);
      else expect(res.status, `${wr[0]} ${wr[1]}`).not.toBe(403);
    }
    // …and approve without manage cannot record.
    expect((await call(approver, ["post", "/admin/finance/gifts", gift()])).status).toBe(403);
    expect((await call(approver, ["post", "/admin/finance/expenses", {}])).status).toBe(403);
  });

  it("a member (no grants) is refused every books route, reads included", async () => {
    const student: Who = member;
    expect((await get(student, "/admin/finance/expenses")).status).toBe(403);
    expect((await call(student, ["post", "/admin/finance/gifts", gift()])).status).toBe(403);
    expect((await supertest(app).get("/v1/admin/finance/expenses")).status).toBe(401);
  });

  it("the RBAC catalog is the server's own lists, for role editors, user editors and finance viewers only", async () => {
    const res = await get(superAdmin, "/admin/permissions/catalog");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ modules: [...PERM_MODULES], capabilities: [...CAPABILITIES] });
    expect(res.body.modules).toEqual(expect.arrayContaining(["finance", "live", "departments", "website", "followUp"]));
    expect(res.body.capabilities).toEqual(expect.arrayContaining(["go", "manage", "approve", "export"]));
    for (const who of [admin, rolesViewer, usersViewer, viewer]) expect((await get(who, "/admin/permissions/catalog")).status).toBe(200);
    expect((await get(nobody, "/admin/permissions/catalog")).status).toBe(403);
    expect((await get(member, "/admin/permissions/catalog")).status).toBe(403);
  });
});
