// Finance ERP — the read side (docs/FINANCE_ERP.md §2a, §4). One realistic
// small church year, seeded straight into the tables the write side fills
// (transactions with balanced legs, office gifts, a reversal, expenses with
// journals, transfers, pledges in every standing, a claim, a need, a
// campaign), then read back through the HTTP routes and the service:
//   · every figure is per currency — KES and USD are never added;
//   · totals are over the whole filtered set, whatever the page size;
//   · keyset paging returns every row exactly once;
//   · the pledge register IS the member statement's per-pledge arithmetic;
//   · fund balances = Σ(credits − debits) over transaction AND journal legs;
//   · the trial balance and the statement of financial position balance;
//   · each reconciliation exception is detected exactly once;
//   · month buckets are the church's (EAT) months, not UTC's.
// Most of the year is 2025 so the numbers are fixed; a handful of rows are
// "now" (the current month, stale checkouts) and are asserted relatively.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { agent, bearer, testEnv } from "./helpers/app.js";
import { FinancialService } from "../src/modules/financial/service.js";
import { PartnersService } from "../src/modules/financial/partners.js";
import { FinanceReportsService } from "../src/modules/financial/finance-reports.js";
import type { PaymentGateway } from "../src/modules/financial/gateway.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

class FakeGateway implements PaymentGateway {
  async createIntent(): Promise<{ id: string; client_secret: string }> {
    return { id: `pi_${randomUUID()}`, client_secret: "secret" };
  }
  verifyWebhook(): never {
    throw new Error("not used");
  }
}

const q = (text: string, params: unknown[] = []) => testPool().query(text, params);
/** An instant given as a church (EAT) wall-clock time. */
const eat = (ymd: string, hm = "12:00"): string => new Date(`${ymd}T${hm}:00+03:00`).toISOString();
const plusSeconds = (iso: string, s: number): string => new Date(new Date(iso).getTime() + s * 1000).toISOString();
const pdfParser = (res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void): void => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};

interface Ids {
  cong: string;
  admin: string; viewer: string; exporter: string; noperm: string;
  amina: string; baraka: string; chen: string; dalia: string; faith: string; evil: string;
  pAmina: string; pBaraka: string; pDalia: string; pFaith: string;
  need: string; need2: string; campaign: string;
  tx: Record<string, string>;
  officeMpesa: string;
  memberless: boolean;
}

let ids: Ids;
let adminTok: string, viewerTok: string, exporterTok: string, nopermTok: string;
let financial: FinancialService;
let partners: PartnersService;
let reports: FinanceReportsService;

const fundId = async (code: string): Promise<string> => (await q(`SELECT fund_id FROM funds WHERE code = $1`, [code])).rows[0].fund_id;

const OFFICE_CASH: Record<string, string> = { onhand: "cash:onhand", bank: "cash:bank", cheque: "cash:cheque", mpesa: "cash:mpesa", other: "cash:other" };

interface GiftOpts {
  user?: string | null;
  fund?: string | null;
  amount: number;
  currency?: string;
  status?: "succeeded" | "failed" | "processing" | "requires_action" | "refunded";
  provider?: "mpesa" | "airtel" | "stripe" | "paypal" | "manual";
  source?: "app" | "website" | "admin";
  at: string;
  settledAt?: string;
  legsAt?: string;
  receipt?: string | null;
  providerRef?: string | null;
  stripePi?: string | null;
  officeChannel?: string | null;
  officeRef?: string | null;
  recordedBy?: string | null;
  pledge?: string | null;
  need?: string | null;
  giverName?: string | null;
  giverPhone?: string | null;
  creditAccount?: string;
  legs?: "balanced" | "none" | { debit: number; credit: number };
  reversed?: { at: string; by: string; reason: string; legs: boolean };
}

/** A transaction with its postings, as the settlement / office paths write them. */
async function gift(o: GiftOpts): Promise<string> {
  const status = o.status ?? "succeeded";
  const provider = o.provider ?? "mpesa";
  const settled = status === "succeeded" || status === "refunded" ? (o.settledAt ?? o.at) : null;
  const fid = o.fund ? await fundId(o.fund) : null;
  const row = await q(
    `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, provider_ref, stripe_payment_intent,
                               idempotency_key, created_at, settled_at, source, receipt_code, office_channel, office_reference,
                               recorded_by, pledge_id, need_id, giver_name, giver_phone, reversed_at, reversed_by, reversal_reason)
     VALUES ($1,$2,$3,$4,$5::txn_status,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     RETURNING transaction_id`,
    [
      o.user ?? null, fid, o.amount, o.currency ?? "KES", status, o.officeChannel ? "manual" : provider,
      o.providerRef ?? null, o.stripePi ?? null, randomUUID(), o.at, settled, o.source ?? (o.officeChannel ? "admin" : "app"),
      o.receipt ?? null, o.officeChannel ?? null, o.officeRef ?? null, o.recordedBy ?? null, o.pledge ?? null, o.need ?? null,
      o.giverName ?? null, o.giverPhone ?? null, o.reversed?.at ?? null, o.reversed?.by ?? null, o.reversed?.reason ?? null,
    ],
  );
  const id: string = row.rows[0].transaction_id;
  const legs = o.legs ?? (settled ? "balanced" : "none");
  if (legs !== "none") {
    const cash = o.officeChannel ? OFFICE_CASH[o.officeChannel]! : `cash:${provider}`;
    const credit = o.creditAccount ?? `fund:${o.fund}`;
    const at = o.legsAt ?? settled ?? o.at;
    const d = legs === "balanced" ? o.amount : legs.debit;
    const c = legs === "balanced" ? o.amount : legs.credit;
    await q(
      `INSERT INTO ledger_entries (transaction_id, account, side, amount_minor, currency, created_at)
       VALUES ($1, $2, 'debit', $3, $5, $6), ($1, $4, 'credit', $7, $5, $6)`,
      [id, cash, d, credit, o.currency ?? "KES", at, c],
    );
    if (o.reversed?.legs) {
      // The reversing pair, dated at the gift it corrects (§2a).
      await q(
        `INSERT INTO ledger_entries (transaction_id, account, side, amount_minor, currency, created_at)
         VALUES ($1, $2, 'debit', $3, $5, $6), ($1, $4, 'credit', $3, $5, $6)`,
        [id, credit, o.amount, cash, o.currency ?? "KES", at],
      );
    }
  }
  return id;
}

let journalKinds = "";
let hasReversalOf = false;

/** A journal and its legs, dated 12:00 EAT on `on` (§2a). */
async function journal(kind: string, on: string, legs: [string, "debit" | "credit", number][], opts: { memo?: string; reversalOf?: string; currency?: string } = {}): Promise<string> {
  const cols = hasReversalOf ? `, reversal_of` : ``;
  const vals = hasReversalOf ? `, $6` : ``;
  const params: unknown[] = [kind, opts.memo ?? null, on, ids?.admin ?? null, eat(on)];
  if (hasReversalOf) params.push(opts.reversalOf ?? null);
  const j = (await q(
    `INSERT INTO journals (kind, memo, occurred_on, created_by, created_at${cols}) VALUES ($1, $2, $3::date, $4, $5${vals}) RETURNING journal_id`,
    params,
  )).rows[0].journal_id as string;
  for (const [account, side, amount] of legs) {
    await q(
      `INSERT INTO ledger_entries (journal_id, account, side, amount_minor, currency, created_at) VALUES ($1, $2, $3::ledger_side, $4, $5, $6)`,
      [j, account, side, amount, opts.currency ?? "KES", eat(on)],
    );
  }
  return j;
}
const supports = (kind: string): boolean => journalKinds.includes(`'${kind}'`);

async function category(code: string): Promise<string> {
  // resetDb truncates the migration-seeded categories; put back the ones used.
  await q(`INSERT INTO expense_categories (code, name, sort) VALUES ($1, $2, 1) ON CONFLICT (code) DO NOTHING`, [code, code.replace(/-/g, " ")]);
  return (await q(`SELECT category_id FROM expense_categories WHERE code = $1`, [code])).rows[0].category_id;
}

async function expense(o: { fund: string; cat: string; amount: number; spent: string; channel: string; status: "recorded" | "approved" | "void"; approved?: boolean; payee?: string }): Promise<string> {
  let journalId: string | null = null;
  let voidJournal: string | null = null;
  const cash = OFFICE_CASH[o.channel]!;
  if (o.status === "approved" || (o.status === "void" && o.approved)) {
    journalId = await journal("expense", o.spent, [[`fund:${o.fund}`, "debit", o.amount], [cash, "credit", o.amount]], { memo: o.payee ?? "Expense" });
  }
  if (o.status === "void" && o.approved) {
    voidJournal = await journal("expense_void", o.spent, [[cash, "debit", o.amount], [`fund:${o.fund}`, "credit", o.amount]], { memo: "Voided" });
  }
  const row = await q(
    `INSERT INTO expenses (fund_id, category_id, payee, amount_minor, currency, spent_on, channel, status, recorded_by, approved_by, approved_at,
                           voided_by, voided_at, void_reason, journal_id, void_journal_id)
     VALUES ($1, $2, $3, $4, 'KES', $5::date, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING expense_id`,
    [
      await fundId(o.fund), await category(o.cat), o.payee ?? "Payee Ltd", o.amount, o.spent, o.channel, o.status, ids.admin,
      journalId ? ids.exporter : null, journalId ? eat(o.spent) : null,
      o.status === "void" ? ids.admin : null, o.status === "void" ? eat(o.spent, "15:00") : null, o.status === "void" ? "Entered twice" : null,
      journalId, voidJournal,
    ],
  );
  return row.rows[0].expense_id;
}

async function pledge(o: { user: string; shape: "monthly" | "total"; amount?: number; target?: number; dueDay?: number; dueOn?: string; fund?: string; need?: string; status: string; created: string }): Promise<string> {
  const row = await q(
    `INSERT INTO pledges (user_id, shape, amount_minor, target_minor, currency, due_day, due_on, fund_id, need_id, status, created_at, fulfilled_at)
     VALUES ($1, $2, $3, $4, 'KES', $5, $6::date, $7, $8, $9, $10, $11) RETURNING pledge_id`,
    [o.user, o.shape, o.amount ?? null, o.target ?? null, o.dueDay ?? null, o.dueOn ?? null, o.fund ? await fundId(o.fund) : null, o.need ?? null,
      o.status, o.created, o.status === "fulfilled" ? eat("2025-06-02") : null],
  );
  return row.rows[0].pledge_id;
}

const grant = (userId: string, cap: string) => q(`INSERT INTO rbac_user_permissions (user_id, module_id, capability) VALUES ($1, 'finance', $2)`, [userId, cap]);

/** The clean books: a realistic year with every posting balanced. */
async function seedYear(): Promise<void> {
  await resetDb();
  journalKinds = (await q(`SELECT string_agg(pg_get_constraintdef(oid), ' ') AS d FROM pg_constraint WHERE conrelid = 'journals'::regclass AND contype = 'c'`)).rows[0].d ?? "";
  hasReversalOf = ((await q(`SELECT 1 FROM information_schema.columns WHERE table_name = 'journals' AND column_name = 'reversal_of'`)).rowCount ?? 0) > 0;
  const memberlessAllowed = !((await q(`SELECT 1 FROM pg_constraint WHERE conname = 'transactions_memberless_only_from_website'`)).rowCount ?? 0);

  const cong = await createCongregation();
  const mk = async (fullName: string, phone: string, role: "Student" | "Admin" = "Student", email: string | null = null) =>
    (await createUser({ congregationId: cong, fullName, phone, role, email })).user_id;
  ids = {
    cong,
    admin: await mk("Office Admin", "+254700000001", "Admin"),
    viewer: await mk("Finance Viewer", "+254700000002"),
    exporter: await mk("Finance Exporter", "+254700000003"),
    noperm: await mk("No Permission", "+254700000004"),
    amina: await mk("Amina Wanjiru", "+254711000001", "Student", "amina@example.org"),
    baraka: await mk("Baraka Otieno", "+254711000002"),
    chen: await mk("Chen Li", "+254711000003"),
    dalia: await mk("Dalia Mwende", "+254711000004"),
    faith: await mk("Faith Njeri", "+254711000005"),
    evil: await mk(`=HYPERLINK("http://x")`, "+254711000006"),
    pAmina: "", pBaraka: "", pDalia: "", pFaith: "", need: "", need2: "", campaign: "",
    tx: {}, officeMpesa: "", memberless: memberlessAllowed,
  };
  await grant(ids.viewer, "view");
  await grant(ids.exporter, "view");
  await grant(ids.exporter, "export");

  // Department + needs (the need is a pledge target and a direct gift target).
  const dept = (await q(`INSERT INTO departments (congregation_id, name, fund_code) VALUES ($1, 'Missions Team', 'mission') RETURNING department_id`, [cong])).rows[0].department_id;
  ids.need = (await q(
    `INSERT INTO department_needs (department_id, submitted_by, title, why, target_minor, currency, status, decided_by, decided_at, created_at)
     VALUES ($1, $2, 'Outreach van', 'Reach the villages', 200000, 'KES', 'approved', $2, $3, $4) RETURNING need_id`,
    [dept, ids.admin, eat("2025-04-02"), eat("2025-04-01")],
  )).rows[0].need_id;
  ids.need2 = (await q(
    `INSERT INTO department_needs (department_id, submitted_by, title, why, target_minor, currency, status, created_at)
     VALUES ($1, $2, 'Sound desk', 'Clearer Sundays', 100000, 'KES', 'pending', $3) RETURNING need_id`,
    [dept, ids.admin, eat("2025-08-01")],
  )).rows[0].need_id;

  // Partners and pledges in every standing.
  for (const u of [ids.amina, ids.baraka, ids.dalia, ids.faith]) {
    await q(`INSERT INTO partner_memberships (user_id, joined_at) VALUES ($1, $2)`, [u, eat("2025-01-01", "08:00")]);
  }
  const nextYear2 = Number(new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 4)) + 2;
  ids.pAmina = await pledge({ user: ids.amina, shape: "monthly", amount: 50000, dueDay: 5, fund: "mission", status: "active", created: eat("2025-01-01", "08:00") });
  ids.pBaraka = await pledge({ user: ids.baraka, shape: "total", target: 300000, dueOn: "2025-06-30", fund: "general", status: "fulfilled", created: eat("2025-02-01") });
  ids.pDalia = await pledge({ user: ids.dalia, shape: "monthly", amount: 20000, dueDay: 10, need: ids.need, status: "paused", created: eat("2025-05-01") });
  ids.pFaith = await pledge({ user: ids.faith, shape: "total", target: 1000000, dueOn: `${nextYear2}-12-31`, fund: "mission", status: "active", created: eat("2025-07-01") });

  const t = ids.tx;
  t.T1 = await gift({ user: ids.amina, fund: "tithe", amount: 100000, provider: "mpesa", at: eat("2025-01-05", "09:00"), settledAt: plusSeconds(eat("2025-01-05", "09:00"), 20), receipt: "QAA0000001", providerRef: "ws_CO_1" });
  t.T2 = await gift({ user: ids.amina, fund: "mission", amount: 50000, provider: "mpesa", at: eat("2025-01-05", "10:00"), receipt: "QAA0000002", providerRef: "ws_CO_2", pledge: ids.pAmina });
  t.T3 = await gift({ user: ids.amina, fund: "mission", amount: 50000, provider: "mpesa", at: eat("2025-02-05", "10:00"), receipt: "QAA0000003", providerRef: "ws_CO_3", pledge: ids.pAmina });
  t.T4 = await gift({ user: ids.amina, fund: "mission", amount: 50000, provider: "mpesa", at: eat("2025-03-20", "10:00"), receipt: "QAA0000004", providerRef: "ws_CO_4", pledge: ids.pAmina });
  t.T5 = await gift({ user: ids.baraka, fund: "general", amount: 200000, at: eat("2025-03-10"), officeChannel: "onhand", receipt: "OR-2025-00001", recordedBy: ids.admin, pledge: ids.pBaraka });
  // A confirmed "I paid another way" claim: provider manual, no office channel.
  t.T6 = await gift({ user: ids.baraka, fund: "general", amount: 100000, provider: "manual", at: eat("2025-06-01"), settledAt: eat("2025-06-02", "09:00"), providerRef: "claim:1", pledge: ids.pBaraka });
  t.T7 = await gift({ user: ids.chen, fund: "general", amount: 5000, currency: "USD", provider: "paypal", at: eat("2025-02-14", "15:00"), providerRef: "PP-1" });
  t.T8 = await gift({ user: ids.chen, fund: "tithe", amount: 1999, currency: "USD", provider: "stripe", at: eat("2025-04-02", "11:00"), settledAt: plusSeconds(eat("2025-04-02", "11:00"), 20), stripePi: "pi_usd_1" });
  t.T9 = await gift({ user: ids.evil, fund: "offering", amount: 123456, at: eat("2025-04-15"), officeChannel: "onhand", receipt: "OR-2025-00002", recordedBy: ids.admin });
  t.T10 = await gift({
    user: ids.amina, fund: "tithe", amount: 70000, at: eat("2025-04-20"), officeChannel: "cheque", officeRef: "CHQ-001", receipt: "OR-2025-00003",
    recordedBy: ids.admin, status: "refunded", reversed: { at: eat("2025-04-22"), by: ids.admin, reason: "Cheque bounced", legs: true },
  });
  t.T11 = await gift({ user: ids.baraka, fund: "offering", amount: 30000, at: eat("2025-05-05"), officeChannel: "mpesa", officeRef: "QOFF000001", receipt: "OR-2025-00004", recordedBy: ids.admin });
  ids.officeMpesa = t.T11;
  t.T12 = await gift({ user: ids.chen, fund: null, amount: 50000, provider: "stripe", at: eat("2025-03-03", "14:00"), stripePi: "pi_media_1", creditAccount: "sales:media" });
  t.T13 = await gift({ user: null, fund: "general", amount: 25000, provider: "mpesa", source: "website", at: eat("2025-06-10"), receipt: "QWEB000001", providerRef: "ws_web_1", giverName: "Walk Visitor", giverPhone: "+254711999000" });
  // The month boundary: 23:30 EAT on 31 March is March; 00:30 EAT on 1 April is
  // April in the church's calendar even though it is still 31 March in UTC.
  t.T14a = await gift({ user: ids.amina, fund: "gift", amount: 11100, provider: "stripe", at: eat("2025-03-31", "23:30"), stripePi: "pi_mar" });
  t.T14b = await gift({ user: ids.amina, fund: "gift", amount: 22200, provider: "mpesa", at: eat("2025-04-01", "00:30"), receipt: "QAPR000001", providerRef: "ws_apr" });
  t.T15 = await gift({ user: ids.amina, fund: "tithe", amount: 40000, provider: "mpesa", at: eat("2024-04-10"), receipt: "QLY0000001", providerRef: "ws_ly" });
  t.T16 = await gift({ user: ids.chen, fund: "tithe", amount: 10000, provider: "mpesa", status: "failed", at: eat("2025-04-05"), providerRef: "ws_failed" });
  t.T17 = await gift({ user: ids.amina, fund: "mission", amount: 60000, provider: "mpesa", at: eat("2025-07-15"), receipt: "QCMP000001", providerRef: "ws_cmp" });
  t.T18 = await gift({ user: ids.chen, fund: "mission", amount: 1000, currency: "USD", provider: "stripe", at: eat("2025-07-20"), stripePi: "pi_usd_mission" });
  t.T19 = await gift({ user: ids.faith, fund: "mission", amount: 100000, at: eat("2025-08-01"), officeChannel: "bank", officeRef: "BNK-7781", receipt: "OR-2025-00005", recordedBy: ids.admin, pledge: ids.pFaith });
  t.T20 = await gift({ user: ids.dalia, fund: "mission", amount: 20000, provider: "mpesa", at: eat("2025-05-10", "10:00"), receipt: "QDAL000001", providerRef: "ws_dal", pledge: ids.pDalia });
  t.T21 = await gift({ user: ids.chen, fund: "mission", amount: 25000, provider: "mpesa", at: eat("2025-09-01"), receipt: "QNED000001", providerRef: "ws_need", need: ids.need });
  if (ids.memberless) {
    t.T22 = await gift({ user: null, fund: "offering", amount: 15000, at: eat("2025-09-07"), officeChannel: "onhand", receipt: "OR-2025-00006", recordedBy: ids.admin, giverName: "Walk-in Giver" });
  }
  // This month (relative to now) and checkouts in flight.
  t.T23 = await gift({ user: ids.amina, fund: "tithe", amount: 5000, provider: "mpesa", at: new Date().toISOString(), receipt: "QNOW000001", providerRef: "ws_now" });
  t.T24 = await gift({ user: ids.chen, fund: "general", amount: 700, currency: "USD", provider: "stripe", at: new Date().toISOString(), stripePi: "pi_now_usd" });
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  t.T25 = await gift({ user: ids.chen, fund: "tithe", amount: 3000, provider: "mpesa", status: "processing", at: ago(2 * 3_600_000), providerRef: "ws_stale" });
  t.T26 = await gift({ user: ids.chen, fund: "tithe", amount: 3100, provider: "mpesa", status: "processing", at: ago(5 * 60_000), providerRef: "ws_fresh" });
  t.T27 = await gift({ user: ids.chen, fund: "tithe", amount: 3200, provider: "stripe", status: "processing", at: ago(2 * 3_600_000), stripePi: "pi_fresh" });
  t.T28 = await gift({ user: ids.chen, fund: "tithe", amount: 3300, provider: "stripe", status: "requires_action", at: ago(30 * 3_600_000), stripePi: "pi_old" });

  // Expenses in every state (maker-checker), a transfer, an opening balance,
  // and a transfer that was reversed.
  await expense({ fund: "general", cat: "rent", amount: 150000, spent: "2025-02-28", channel: "bank", status: "approved", payee: "Landlord" });
  await expense({ fund: "tithe", cat: "utilities", amount: 30000, spent: "2025-04-10", channel: "onhand", status: "approved", payee: "Kenya Power" });
  await expense({ fund: "offering", cat: "events", amount: 20000, spent: "2025-05-15", channel: "onhand", status: "recorded", payee: "Caterer" });
  await expense({ fund: "offering", cat: "welfare-benevolence", amount: 10000, spent: "2025-03-12", channel: "onhand", status: "void", approved: true, payee: "Relief" });
  await expense({ fund: "general", cat: "other", amount: 5000, spent: "2025-03-15", channel: "onhand", status: "void", approved: false, payee: "Duplicate" });
  const tj = await journal("transfer", "2025-06-15", [["fund:tithe", "debit", 40000], ["fund:mission", "credit", 40000]], { memo: "Missions support" });
  await q(
    `INSERT INTO fund_transfers (from_fund_id, to_fund_id, amount_minor, currency, occurred_on, memo, created_by, journal_id)
     VALUES ($1, $2, 40000, 'KES', '2025-06-15', 'Missions support', $3, $4)`,
    [await fundId("tithe"), await fundId("mission"), ids.admin, tj],
  );
  await journal(supports("opening") ? "opening" : "transfer", "2025-01-01", [["cash:bank", "debit", 500000], ["fund:general", "credit", 500000]], { memo: "Opening balance" });
  const x2 = await journal("transfer", "2025-07-01", [["fund:offering", "debit", 5000], ["fund:gift", "credit", 5000]], { memo: "Gift fund seed" });
  // A reversal names its original (the books side's CHECK); the stand-in, on a
  // schema without the kind, is a plain mirror posting.
  await journal(supports("reversal") ? "reversal" : "transfer", "2025-07-01", [["fund:gift", "debit", 5000], ["fund:offering", "credit", 5000]], { memo: "Reversed", ...(supports("reversal") ? { reversalOf: x2 } : {}) });

  // A claim waiting, a failing recurring gift and a cancelled one.
  await q(`INSERT INTO pledge_claims (pledge_id, user_id, amount_minor, currency, paid_on, status) VALUES ($1, $2, 50000, 'KES', '2025-07-05', 'pending')`, [ids.pAmina, ids.amina]);
  await q(
    `INSERT INTO giving_schedules (user_id, fund_id, amount_minor, currency, frequency, method, status, next_run_at, idempotency_key, consecutive_failures, last_error)
     VALUES ($1, $2, 100000, 'KES', 'monthly', 'mpesa', 'active', now() + interval '1 day', 'sched-chen', 2, 'Insufficient funds'),
            ($3, $2, 50000, 'KES', 'monthly', 'mpesa', 'cancelled', now() + interval '1 day', 'sched-amina', 0, NULL)`,
    [ids.chen, await fundId("tithe"), ids.amina],
  );
  // A campaign on the mission fund for July 2025.
  ids.campaign = (await q(
    `INSERT INTO campaigns (congregation_id, title, blurb, fund_id, goal_minor, currency, starts_on, ends_on, status)
     VALUES ($1, 'July missions', 'Go', $2, 500000, 'KES', '2025-07-01', '2025-07-31', 'ended') RETURNING campaign_id`,
    [cong, await fundId("mission")],
  )).rows[0].campaign_id;
  // The audit trail: every finance prefix, plus two actions outside it.
  for (const [action, actor] of [
    ["giving.intent_created", ids.amina], ["purchase.intent_created", ids.chen], ["finance.gift_recorded", ids.admin],
    ["webhook.received", null], ["pledge.claim_created", ids.amina], ["department.need_approved", ids.admin],
    ["expense.approved", ids.exporter], ["budget.approved", ids.admin], ["journal.reversed", ids.admin], ["fund.created", ids.admin],
    ["user.onboarded", ids.admin], ["department.created", ids.admin],
  ] as const) {
    await q(`INSERT INTO audit_log (actor_id, action, entity, entity_id, occurred_at) VALUES ($1, $2, 'test', NULL, $3)`, [actor, action, eat("2025-05-01")]);
  }

  adminTok = bearer({ sub: ids.admin, role: "Admin", cong } as never);
  viewerTok = bearer({ sub: ids.viewer, role: "Student", cong } as never);
  exporterTok = bearer({ sub: ids.exporter, role: "Student", cong } as never);
  nopermTok = bearer({ sub: ids.noperm, role: "Student", cong } as never);
  financial = new FinancialService(testPool(), new FakeGateway());
  partners = new PartnersService(testPool(), financial);
  reports = new FinanceReportsService(testPool(), { financial, partners });
}

/** The deliberately broken rows — one per integrity exception. */
async function seedBroken(): Promise<Record<string, string>> {
  const b: Record<string, string> = {};
  b.noLedger = await gift({ user: ids.chen, fund: "tithe", amount: 7000, provider: "mpesa", at: eat("2025-09-10"), receipt: "QBRK000001", providerRef: "ws_b1", legs: "none" });
  b.unbalanced = await gift({ user: ids.amina, fund: "tithe", amount: 9000, provider: "stripe", at: eat("2025-09-11"), stripePi: "pi_unbal", legs: { debit: 9000, credit: 8000 } });
  b.refunded = await gift({ user: ids.baraka, fund: "offering", amount: 6000, at: eat("2025-09-12"), officeChannel: "onhand", receipt: "OR-2025-00099", recordedBy: ids.admin, status: "refunded" });
  b.dupFirst = await gift({ user: ids.chen, fund: "tithe", amount: 4000, provider: "mpesa", at: eat("2025-09-13"), receipt: "QDUP000001", providerRef: "ws_d1" });
  b.dupSecond = await gift({ user: ids.chen, fund: "tithe", amount: 4000, provider: "mpesa", at: eat("2025-09-14"), receipt: "qdup000001 ", providerRef: "ws_d2" });
  // The office recorded QOFF000001 by hand (T11); the same payment then settled online.
  b.online = await gift({ user: ids.baraka, fund: "offering", amount: 30000, provider: "mpesa", at: eat("2025-05-06"), receipt: "QOFF000001", providerRef: "ws_off" });
  b.journal = await journal("expense", "2025-09-15", [["fund:general", "debit", 3000]], { memo: "Half-posted" });
  return b;
}

const get = (path: string, tok: string = adminTok, env?: Record<string, string>) => agent(env as never).get(`/v1${path}`).set("Authorization", tok);
const sumBy = <T>(xs: T[], f: (x: T) => number): number => xs.reduce((a, x) => a + f(x), 0);

afterAll(async () => {
  await closeTestPool();
});

describe("finance reports — the clean books of a small church year", () => {
  beforeAll(async () => {
    await seedYear();
  }, 120_000);

  it("overview: per-currency income / expenses / net for April 2025 — never KES + USD", async () => {
    const res = await get("/admin/finance/overview?from=2025-04-01&to=2025-04-30");
    expect(res.status).toBe(200);
    const o = res.body;
    expect(o.period).toEqual({ from: "2025-04-01", to: "2025-04-30", mtd_from: "2025-04-01", ytd_from: "2025-01-01", last_year_from: "2024-04-01", last_year_to: "2024-04-30" });
    expect(o.currencies).toEqual(["KES", "USD"]);
    const kes = o.income.find((r: any) => r.currency === "KES");
    const usd = o.income.find((r: any) => r.currency === "USD");
    // 22,200 (00:30 EAT on 1 April) + 123,456 office cash; the reversed cheque and the failed M-Pesa are out.
    expect(kes).toEqual({ currency: "KES", period_minor: 145656, period_count: 2, mtd_minor: 145656, ytd_minor: 656756, same_period_last_year_minor: 40000 });
    expect(usd).toEqual({ currency: "USD", period_minor: 1999, period_count: 1, mtd_minor: 1999, ytd_minor: 6999, same_period_last_year_minor: 0 });
    expect(o.expenses).toEqual([
      { currency: "KES", period_minor: 30000, period_count: 1, ytd_minor: 180000 },
      { currency: "USD", period_minor: 0, period_count: 0, ytd_minor: 0 },
    ]);
    expect(o.net).toEqual([
      { currency: "KES", period_minor: 115656, ytd_minor: 476756 },
      { currency: "USD", period_minor: 1999, ytd_minor: 6999 },
    ]);
    // Active pledges' remaining this year: Amina 450,000; Faith's total is due in a later year.
    expect(o.outstanding_pledges.find((r: any) => r.currency === "KES")).toEqual({ currency: "KES", remaining_year_minor: 450000, pledges: 2 });
    expect(o.counts).toEqual({
      processing: 4, failed_in_period: 1, pending_claims: 1, expenses_awaiting_approval: 1,
      failing_schedules: 1, stale_processing: 2, integrity_issues: 0,
    });
    expect(o.alerts.map((a: any) => a.kind).sort()).toEqual(["expenses_awaiting_approval", "failing_schedules", "partners_behind", "pending_claims", "stale_processing"]);
    expect(o.alerts.find((a: any) => a.kind === "pending_claims")).toEqual({ kind: "pending_claims", count: 1, link: "/finance/claims" });
    // Channels: the cheque was received and reversed on the same (economic) day.
    const ch = (account: string, currency = "KES") => o.channels.find((c: any) => c.account === account && c.currency === currency);
    expect(ch("cash:cheque")).toMatchObject({ channel: "cheque", count: 1, received_minor: 70000, reversed_minor: 70000, net_minor: 0 });
    expect(ch("cash:onhand")).toMatchObject({ received_minor: 123456, net_minor: 123456 });
    expect(ch("cash:mpesa")).toMatchObject({ received_minor: 22200 });
    expect(ch("cash:stripe", "USD")).toMatchObject({ channel: "card", received_minor: 1999 });
    expect(ch("cash:manual")).toMatchObject({ received_minor: 0, count: 0 });
    // 12 months ending April 2025, per currency.
    const sk = o.series.find((s: any) => s.currency === "KES").months;
    expect(sk).toHaveLength(12);
    expect(sk[0].month).toBe("2024-05");
    expect(sk[11]).toEqual({ month: "2025-04", income_minor: 145656, expenses_minor: 30000 });
    expect(sk.find((m: any) => m.month === "2025-03")).toEqual({ month: "2025-03", income_minor: 311100, expenses_minor: 0 });
    expect(sk.find((m: any) => m.month === "2025-02")).toEqual({ month: "2025-02", income_minor: 50000, expenses_minor: 150000 });
    // Every money array is per currency.
    for (const k of ["income", "expenses", "net", "outstanding_pledges"]) {
      for (const r of o[k]) expect(typeof r.currency).toBe("string");
    }
  });

  it("overview: partners and behind are the Partners page's own figures", async () => {
    const o = (await get("/admin/finance/overview?from=2025-04-01&to=2025-04-30")).body;
    const list = (await partners.adminList({ status: "all", sort: "recent" })) as { summary: { partners: number; behind: number } };
    expect(o.partners).toEqual({ count: list.summary.partners, behind: list.summary.behind });
    expect(o.partners).toEqual({ count: 5, behind: 1 });
  });

  it("overview: fund balances are the top funds by KES balance, from transaction AND journal legs", async () => {
    const o = (await get("/admin/finance/overview?from=2025-04-01&to=2025-04-30")).body;
    expect(o.fund_balances.length).toBeLessThanOrEqual(6);
    const kes = o.fund_balances.map((f: any) => f.balances.find((b: any) => b.currency === "KES")?.balance_minor ?? 0);
    expect([...kes].sort((a: number, b: number) => b - a)).toEqual(kes);
  });

  it("transactions: filters (dates, channel, source, pledged, need, q incl. office_reference) and totals over the filtered set", async () => {
    const t = ids.tx;
    const march = (await get("/admin/finance/transactions?from=2025-03-01&to=2025-03-31&limit=200")).body;
    const marchIds = march.data.map((r: any) => r.transaction_id);
    expect(marchIds).toContain(t.T14a);
    expect(marchIds).not.toContain(t.T14b);
    const april = (await get("/admin/finance/transactions?from=2025-04-01&to=2025-04-30&limit=200")).body;
    expect(april.data.map((r: any) => r.transaction_id)).toContain(t.T14b);
    // Totals: succeeded amount; count = every row (the refunded cheque and the failed M-Pesa count).
    expect(april.totals).toEqual([
      { currency: "KES", amount_minor: 145656, count: 4 },
      { currency: "USD", amount_minor: 1999, count: 1 },
    ]);
    const idsOf = async (qs: string) => (await get(`/admin/finance/transactions?${qs}&limit=200`)).body.data.map((r: any) => r.transaction_id).sort();
    expect(await idsOf("pledged=yes")).toEqual([t.T2, t.T3, t.T4, t.T5, t.T6, t.T19, t.T20].sort());
    expect(await idsOf("need=yes")).toEqual([t.T21]);
    expect(await idsOf("channel=cheque")).toEqual([t.T10]);
    expect(await idsOf("channel=manual")).toEqual([t.T6]);
    expect(await idsOf("channel=stripe&from=2025-03-01&to=2025-03-31")).toEqual([t.T12, t.T14a].sort());
    expect(await idsOf("source=website")).toEqual([t.T13]);
    expect(await idsOf("q=QOFF000001")).toEqual([t.T11]);
    expect(await idsOf("q=walk%20visitor")).toEqual([t.T13]);
    expect(await idsOf("q=OR-2025-00002")).toEqual([t.T9]);
    expect(await idsOf("fund=gift")).toEqual([t.T14a, t.T14b].sort());
    // Row shape: office + reversal fields, names, channel.
    const cheque = (await get("/admin/finance/transactions?channel=cheque")).body.data[0];
    expect(cheque).toMatchObject({
      transaction_id: t.T10, status: "refunded", channel: "cheque", source: "admin", method: "manual",
      office_channel: "cheque", office_reference: "CHQ-001", receipt_code: "OR-2025-00003",
      recorded_by: ids.admin, recorded_by_name: "Office Admin", reversed_by_name: "Office Admin", reversal_reason: "Cheque bounced",
      full_name: "Amina Wanjiru", display_name: "Amina Wanjiru", amount_minor: 70000, currency: "KES", fund: "tithe", fund_name: "Tithe",
    });
    const pledged = (await get(`/admin/finance/transactions?q=QAA0000002`)).body.data[0];
    expect(pledged).toMatchObject({ pledge_id: ids.pAmina, pledge_title: "Missions", channel: "mpesa", source: "app" });
    const web = (await get(`/admin/finance/transactions?source=website`)).body.data[0];
    expect(web).toMatchObject({ user_id: null, full_name: null, display_name: "Walk Visitor" });
    if (ids.memberless) {
      const walkIn = (await get(`/admin/finance/transactions?q=OR-2025-00006`)).body.data[0];
      expect(walkIn).toMatchObject({ user_id: null, source: "admin", display_name: "Walk-in Giver", channel: "onhand" });
    }
  });

  it("transactions: keyset paging returns every row exactly once, and totals do not depend on the page size", async () => {
    const all = (await get("/admin/finance/transactions?limit=200")).body;
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: any = (await get(`/admin/finance/transactions?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)).body;
      expect(page.totals).toEqual(all.totals);
      seen.push(...page.data.map((r: any) => r.transaction_id));
      cursor = page.next_cursor;
      pages += 1;
    } while (cursor && pages < 100);
    expect(seen).toHaveLength(all.data.length);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual(all.data.map((r: any) => r.transaction_id));
    // The earlier `before` parameter still pages (a created_at, or a cursor fed back).
    const first = (await get("/admin/finance/transactions?limit=2")).body;
    const viaBefore = (await get(`/admin/finance/transactions?limit=2&before=${encodeURIComponent(first.next_cursor)}`)).body;
    expect(viaBefore.data[0].transaction_id).toBe(all.data[2].transaction_id);
    const byDate = (await get(`/admin/finance/transactions?limit=200&before=2025-01-06T00:00:00Z`)).body;
    expect(byDate.data.every((r: any) => new Date(r.created_at) < new Date("2025-01-06T00:00:00Z"))).toBe(true);
    expect((await get("/admin/finance/transactions?cursor=not-a-cursor")).status).toBe(400);
  });

  it("transactions detail: office + reversal fields, who recorded / reversed it, and EVERY leg", async () => {
    const res = await get(`/admin/finance/transactions/${ids.tx.T10}`);
    expect(res.status).toBe(200);
    expect(res.body.transaction).toMatchObject({ office_channel: "cheque", reversal_reason: "Cheque bounced", recorded_by_name: "Office Admin", reversed_by_name: "Office Admin" });
    const legs = res.body.ledger_entries;
    expect(legs).toHaveLength(4);
    expect(legs.filter((l: any) => l.is_reversal)).toHaveLength(2);
    expect(sumBy(legs.filter((l: any) => l.side === "debit"), (l: any) => l.amount_minor)).toBe(sumBy(legs.filter((l: any) => l.side === "credit"), (l: any) => l.amount_minor));
    expect((await get(`/admin/finance/transactions/${randomUUID()}`)).status).toBe(404);
    expect((await get(`/admin/finance/transactions/not-a-uuid`)).status).toBe(404);
  });

  it("transactions CSV: header, formula guard, exact money with its currency — and finance:export", async () => {
    const res = await get("/admin/finance/transactions.csv?from=2025-04-01&to=2025-04-30");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment");
    const text: string = res.text;
    expect(text.startsWith("﻿created_at,settled_at,transaction_id,status,amount,currency,fund,")).toBe(true);
    expect(text).toContain(`"'=HYPERLINK(""http://x"")"`); // the member's name, neutralised
    const evil = text.split("\r\n").find((l) => l.includes(ids.tx.T9))!;
    expect(evil).toContain(",1234.56,KES,offering,");
    const usd = text.split("\r\n").find((l) => l.includes(ids.tx.T8))!;
    expect(usd).toContain(",19.99,USD,");
    expect(text.split("\r\n").filter((l) => l.length > 0)).toHaveLength(1 + 5); // header + every April row
    // finance:view alone is not enough for a CSV; finance:export is.
    expect((await get("/admin/finance/transactions.csv", viewerTok)).status).toBe(403);
    expect((await get("/admin/finance/transactions.csv", exporterTok)).status).toBe(200);
    for (const p of ["/admin/finance/pledges.csv", "/admin/finance/ledger.csv", "/admin/finance/reports/income.csv", "/admin/finance/statements.csv", "/admin/finance/reports/financial-position.csv"]) {
      expect((await get(p, viewerTok)).status).toBe(403);
    }
  });

  it("permissions: no finance:view → 403 everywhere; finance:view reads; no token → 401", async () => {
    for (const p of ["/admin/finance/overview", "/admin/finance/pledges", "/admin/finance/funds", "/admin/finance/ledger", "/admin/finance/trial-balance",
      "/admin/finance/reconciliation", "/admin/finance/reports/income", "/admin/finance/statements", "/admin/finance/needs", "/admin/finance/settings"]) {
      expect((await get(p, nopermTok)).status, p).toBe(403);
      expect((await get(p, viewerTok)).status, p).toBe(200);
    }
    expect((await agent().get("/v1/admin/finance/overview")).status).toBe(401);
  });

  it("pledge register = the member statement's per-pledge numbers, row for row", async () => {
    const now = new Date();
    const reg = await reports.pledges({ year: 2025, limit: 200 }, now);
    for (const uid of [ids.amina, ids.baraka, ids.dalia, ids.faith]) {
      const st = await partners.statements(uid, 2025, now);
      for (const p of st.pledges) {
        const row = reg.data.find((r) => r.pledge_id === p.pledge_id)!;
        expect(row, p.pledge_id).toBeTruthy();
        expect({ pledged: row.pledged_year_minor, paid: row.paid_year_minor, remaining: row.remaining_year_minor, kept: row.kept, due: row.due_count })
          .toEqual({ pledged: p.pledged_minor, paid: p.paid_minor, remaining: p.remaining_year_minor, kept: p.kept, due: p.due_count });
      }
    }
    const byId = (id: string) => reg.data.find((r) => r.pledge_id === id)!;
    expect(byId(ids.pAmina)).toMatchObject({ standing: "behind", pledged_year_minor: 600000, paid_year_minor: 150000, remaining_year_minor: 450000, kept: 3, due_count: 12, member_name: "Amina Wanjiru" });
    expect(byId(ids.pBaraka)).toMatchObject({ standing: "fulfilled", pledged_year_minor: 300000, paid_year_minor: 300000, remaining_year_minor: 0 });
    expect(byId(ids.pDalia)).toMatchObject({ standing: "paused", pledged_year_minor: 160000, paid_year_minor: 20000, kept: 1, due_count: 8 });
    expect(byId(ids.pFaith)).toMatchObject({ standing: "on_track", pledged_year_minor: 0, paid_year_minor: 100000, remaining_year_minor: 0 });
    expect(byId(ids.pAmina).overdue_since).toBe("2025-04-05");
    expect(reg.totals).toEqual([{ currency: "KES", amount_minor: 1060000, count: 4, pledged_minor: 1060000, paid_minor: 570000, remaining_minor: 590000 }]);
    // Standings as the partner card shows them — and the same through the route.
    const behind = (await get("/admin/finance/pledges?year=2025&standing=behind")).body;
    expect(behind.data.map((r: any) => r.pledge_id)).toEqual([ids.pAmina]);
    expect((await get("/admin/finance/pledges?year=2025&status=paused")).body.data.map((r: any) => r.pledge_id)).toEqual([ids.pDalia]);
    expect((await get("/admin/finance/pledges?year=2025&shape=total")).body.data).toHaveLength(2);
    expect((await get("/admin/finance/pledges?year=2025&q=dalia")).body.data.map((r: any) => r.pledge_id)).toEqual([ids.pDalia]);
    // Paging: every pledge once, totals whole.
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: any = (await get(`/admin/finance/pledges?year=2025&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)).body;
      expect(page.totals).toEqual(reg.totals);
      seen.push(...page.data.map((r: any) => r.pledge_id));
      cursor = page.next_cursor;
    } while (cursor);
    expect(seen.sort()).toEqual([ids.pAmina, ids.pBaraka, ids.pDalia, ids.pFaith].sort());
    const csv = await get("/admin/finance/pledges.csv?year=2025", exporterTok);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain(",500.00,,KES,active,behind,2025,6000.00,1500.00,4500.00,");
  });

  it("funds: balance = Σ(credits − debits) on fund:<code> over transaction AND journal legs; income, expenses, transfers", async () => {
    const res = await get("/admin/finance/funds?from=2025-01-01&to=2025-12-31");
    expect(res.status).toBe(200);
    const truth = (await q(
      `SELECT substr(account, 6) AS code, currency, sum(CASE WHEN side = 'credit' THEN amount_minor ELSE -amount_minor END)::bigint AS bal
         FROM ledger_entries WHERE account LIKE 'fund:%' GROUP BY 1, 2`,
    )).rows;
    for (const f of res.body.data) {
      for (const b of f.balances) {
        expect(b.balance_minor, `${f.code} ${b.currency}`).toBe(Number(truth.find((r: any) => r.code === f.code && r.currency === b.currency)!.bal));
      }
    }
    expect(sumBy(truth, (r: any) => 1)).toBe(sumBy(res.body.data, (f: any) => f.balances.length));
    const fund = (code: string) => res.body.data.find((f: any) => f.code === code);
    // The gift fund: 11,100 + 22,200, and a transfer that was reversed nets to nothing.
    expect(fund("gift").balances).toEqual([{ currency: "KES", balance_minor: 33300 }]);
    expect(fund("general").expenses_ytd).toEqual([{ currency: "KES", amount_minor: 150000 }]);
    expect(fund("offering").expenses_ytd).toEqual([]); // the approved-then-voided one and the recorded one are not spend
    expect(fund("mission").transfers_in_ytd).toEqual([{ currency: "KES", amount_minor: 40000 }]);
    expect(fund("tithe").transfers_out_ytd).toEqual([{ currency: "KES", amount_minor: 40000 }]);
    // Giving to the tithe fund in 2025 (ledger): 100,000 + USD 1,999; the reversed cheque nets out.
    expect(fund("tithe").income).toEqual([
      { currency: "KES", period_minor: 100000, ytd_minor: 100000 },
      { currency: "USD", period_minor: 1999, ytd_minor: 1999 },
    ]);
    expect(res.body.data.every((f: any) => "is_active" in f && "description" in f && "sort" in f)).toBe(true);
    expect(res.body.next_cursor).toBeNull();
  });

  it("summary's month_minor (the Dashboard card) foots with this month's fund income on Funds", async () => {
    const summary = (await get("/admin/finance/summary")).body.funds as { code: string; currency: string | null; month_minor: number }[];
    const funds = (await get("/admin/finance/funds")).body.data;
    const nonZero = summary.filter((s) => s.month_minor > 0);
    expect(nonZero.map((s) => `${s.code}:${s.currency}`).sort()).toEqual(["general:USD", "tithe:KES"]);
    for (const s of nonZero) {
      const inc = funds.find((f: any) => f.code === s.code).income.find((i: any) => i.currency === s.currency);
      expect(inc.period_minor, `${s.code} ${s.currency}`).toBe(s.month_minor);
    }
  });

  it("ledger: journal postings included, filters, month boundary in EAT, paging, totals", async () => {
    const all = (await get("/admin/finance/ledger?limit=500")).body;
    const count = Number((await q(`SELECT count(*) FROM ledger_entries`)).rows[0].count);
    expect(all.data).toHaveLength(count);
    expect(all.totals.every((t: any) => t.debit_minor === t.credit_minor && t.amount_minor === 0)).toBe(true);
    const journals = (await get("/admin/finance/ledger?kind=journal&limit=500")).body.data;
    expect(journals.length).toBeGreaterThan(0);
    expect(journals.every((l: any) => l.kind === "journal" && l.transaction_id === null && l.journal_id && l.journal_kind)).toBe(true);
    const tx = (await get("/admin/finance/ledger?kind=transaction&account=cash:&limit=500")).body.data;
    expect(tx.every((l: any) => l.account.startsWith("cash:") && l.kind === "transaction")).toBe(true);
    // 00:30 EAT on 1 April posts on 1 April; 23:30 EAT on 31 March posts on 31 March.
    const apr1 = (await get("/admin/finance/ledger?from=2025-04-01&to=2025-04-01&account=cash:mpesa")).body.data;
    expect(apr1.map((l: any) => l.transaction_id)).toEqual([ids.tx.T14b]);
    expect(apr1[0].posted_on).toBe("2025-04-01");
    const mar31 = (await get("/admin/finance/ledger?from=2025-03-31&to=2025-03-31&account=fund:gift")).body.data;
    expect(mar31.map((l: any) => l.transaction_id)).toEqual([ids.tx.T14a]);
    // Owner info.
    const cheque = (await get(`/admin/finance/ledger?account=cash:cheque`)).body.data;
    expect(cheque[0]).toMatchObject({ receipt_code: "OR-2025-00003", member_name: "Amina Wanjiru", transaction_status: "refunded" });
    // Paging: each posting once.
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: any = (await get(`/admin/finance/ledger?limit=7${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)).body;
      expect(page.totals).toEqual(all.totals);
      seen.push(...page.data.map((r: any) => r.entry_id));
      cursor = page.next_cursor;
    } while (cursor);
    expect(seen).toEqual(all.data.map((r: any) => r.entry_id));
    const csv = await get("/admin/finance/ledger.csv?account=cash:onhand", exporterTok);
    expect(csv.status).toBe(200);
    expect(csv.text.split("\r\n")[0]).toBe("﻿posted_on,created_at,entry_id,kind,account,side,amount,currency,transaction_id,receipt_code,member,transaction_status,journal_id,journal_kind,memo");
    expect(csv.text).toContain(",1234.56,KES,");
  });

  it("trial balance: balanced in every currency; balances on each account's normal side", async () => {
    const tb = (await get("/admin/finance/trial-balance")).body;
    expect(tb.balanced).toBe(true);
    for (const t of tb.totals) expect(t.debit_minor).toBe(t.credit_minor);
    const row = (a: string, c = "KES") => tb.data.find((r: any) => r.account === a && r.currency === c);
    expect(row("cash:cheque")).toMatchObject({ debit_minor: 70000, credit_minor: 70000, balance_minor: 0, normal_side: "debit" });
    expect(row("fund:gift")).toMatchObject({ balance_minor: 33300, normal_side: "credit" });
    expect(row("sales:media")).toMatchObject({ balance_minor: 50000, normal_side: "credit" });
    const april = (await get("/admin/finance/trial-balance?from=2025-04-01&to=2025-04-30")).body;
    expect(april.balanced).toBe(true);
    expect(april.data.find((r: any) => r.account === "fund:gift")).toMatchObject({ credit_minor: 22200 });
  });

  it("reconciliation (clean): settlement per EAT day per channel; only stale + failed exceptions; integrity balanced", async () => {
    const r = (await get("/admin/finance/reconciliation?from=2025-04-01&to=2025-04-30")).body;
    expect(r.exception_counts).toEqual({ stale_processing: 2, failed: 1, succeeded_without_ledger: 0, unbalanced_transaction: 0, refunded_without_reversal: 0, duplicate_receipt: 0, unbalanced_journal: 0 });
    expect(r.exceptions.filter((e: any) => e.kind === "stale_processing").map((e: any) => e.transaction_id).sort()).toEqual([ids.tx.T25, ids.tx.T28].sort());
    expect(r.exceptions.find((e: any) => e.kind === "failed").transaction_id).toBe(ids.tx.T16);
    expect(r.integrity.every((i: any) => i.balanced)).toBe(true);
    const day = (d: string, account: string) => r.settlement.find((s: any) => s.day === d && s.account === account);
    expect(day("2025-04-01", "cash:mpesa")).toMatchObject({ channel: "mpesa", count: 1, received_minor: 22200, amount_minor: 22200 });
    expect(day("2025-04-20", "cash:cheque")).toMatchObject({ count: 1, received_minor: 70000, reversed_count: 1, reversed_minor: 70000, amount_minor: 0 });
    expect(r.settlement.find((s: any) => s.day === "2025-03-31")).toBeUndefined();
    // Settlement sums to the Overview's channels.
    const o = (await get("/admin/finance/overview?from=2025-04-01&to=2025-04-30")).body;
    for (const c of o.channels.filter((x: any) => x.count > 0)) {
      expect(sumBy(r.settlement.filter((s: any) => s.account === c.account && s.currency === c.currency), (s: any) => s.amount_minor)).toBe(c.net_minor);
    }
  });

  it("reports: income matrices by fund / channel / source sum to their totals, per currency; EAT months", async () => {
    const truth = (await q(
      `SELECT currency, sum(amount_minor)::bigint AS total FROM transactions
        WHERE status = 'succeeded' AND created_at >= '2025-01-01T00:00:00+03:00' AND created_at < '2026-01-01T00:00:00+03:00'
        GROUP BY currency`,
    )).rows;
    for (const by of ["fund", "channel", "source"]) {
      const m = (await get(`/admin/finance/reports/income?year=2025&by=${by}`)).body;
      expect(m).toMatchObject({ report: "income", year: 2025, by });
      for (const c of m.currencies) {
        for (const row of c.rows) expect(sumBy(row.months, (v: number) => v)).toBe(row.total_minor);
        for (let i = 0; i < 12; i++) expect(sumBy(c.rows, (row: any) => row.months[i])).toBe(c.totals.months[i]);
        expect(sumBy(c.totals.months, (v: number) => v)).toBe(c.totals.total_minor);
        expect(c.totals.total_minor, `${by} ${c.currency}`).toBe(Number(truth.find((t: any) => t.currency === c.currency)?.total ?? 0));
      }
    }
    const byFund = (await get("/admin/finance/reports/income?year=2025&by=fund")).body;
    const gift = byFund.currencies.find((c: any) => c.currency === "KES").rows.find((r: any) => r.key === "gift");
    expect(gift.months[2]).toBe(11100); // March
    expect(gift.months[3]).toBe(22200); // April — 00:30 EAT on 1 April
    expect(byFund.currencies.find((c: any) => c.currency === "KES").rows.find((r: any) => r.key === "none")).toMatchObject({ label: "No fund (media sales)", total_minor: 50000 });
    const byChannel = (await get("/admin/finance/reports/income?year=2025&by=channel")).body;
    expect(byChannel.currencies[0].rows.find((r: any) => r.key === "manual").total_minor).toBe(100000);
    expect(byChannel.currencies[0].rows.find((r: any) => r.key === "cheque")).toBeUndefined(); // reversed
    const csv = await get("/admin/finance/reports/income.csv?year=2025&by=fund", exporterTok);
    expect(csv.status).toBe(200);
    const lines = csv.text.split("\r\n");
    expect(lines[0]).toBe("﻿currency,key,label,jan,feb,mar,apr,may,jun,jul,aug,sep,oct,nov,dec,total");
    expect(lines).toContain("KES,gift,Gift,0.00,0.00,111.00,222.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00,333.00");
  });

  it("reports: expenses are APPROVED only, by category and by fund", async () => {
    const m = (await get("/admin/finance/reports/expenses?year=2025&by=category")).body;
    const kes = m.currencies.find((c: any) => c.currency === "KES");
    expect(kes.rows.map((r: any) => [r.key, r.total_minor])).toEqual([["rent", 150000], ["utilities", 30000]]);
    expect(kes.totals.total_minor).toBe(180000);
    expect(kes.rows.find((r: any) => r.key === "rent").months[1]).toBe(150000);
    const byFund = (await get("/admin/finance/reports/expenses?year=2025&by=fund")).body.currencies[0];
    expect(byFund.rows.map((r: any) => [r.key, r.total_minor])).toEqual([["general", 150000], ["tithe", 30000]]);
  });

  it("reports: pledges per month from the instalment ledger — sums equal the register", async () => {
    const now = new Date();
    const r = await reports.reportPledges({ year: 2025 }, now);
    const kes = (r.currencies as any[]).find((c) => c.currency === "KES");
    expect(kes.months.map((m: any) => m.pledged_minor)).toEqual([50000, 50000, 50000, 50000, 70000, 370000, 70000, 70000, 70000, 70000, 70000, 70000]);
    expect(kes.months.map((m: any) => m.paid_minor)).toEqual([50000, 50000, 250000, 0, 20000, 100000, 0, 100000, 0, 0, 0, 0]);
    expect(kes.months.map((m: any) => m.kept)).toEqual([1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
    expect(kes.months.map((m: any) => m.missed)).toEqual([0, 0, 0, 1, 1, 2, 2, 2, 2, 2, 2, 2]);
    expect(kes.months.map((m: any) => m.behind_partners)).toEqual([0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const reg = await reports.pledges({ year: 2025, limit: 200 }, now);
    const t = reg.totals.find((x) => x.currency === "KES")!;
    expect(kes.totals).toEqual({ pledged_minor: t.pledged_minor, paid_minor: t.paid_minor, kept: 4, missed: 16, behind_partners: 1 });
    const csv = await get("/admin/finance/reports/pledges.csv?year=2025", exporterTok);
    expect(csv.text).toContain("KES,TOTAL,10600.00,5700.00,4,16,1");
  });

  it("statements: givers of the year with per-currency totals that foot, keyset paged; CSV", async () => {
    const res = (await get("/admin/finance/statements?year=2025&limit=200")).body;
    const truth = (await q(
      `SELECT t.currency, sum(t.amount_minor)::bigint AS total, count(*)::int AS n FROM transactions t
         JOIN funds f ON f.fund_id = t.fund_id
        WHERE t.status = 'succeeded' AND t.user_id IS NOT NULL
          AND t.created_at >= '2025-01-01T00:00:00+03:00' AND t.created_at < '2026-01-01T00:00:00+03:00'
        GROUP BY t.currency ORDER BY t.currency`,
    )).rows;
    expect(res.totals).toEqual(truth.map((r: any) => ({ currency: r.currency, amount_minor: Number(r.total), count: r.n })));
    expect(res.totals).toEqual([{ currency: "KES", amount_minor: 941756, count: 14 }, { currency: "USD", amount_minor: 7999, count: 3 }]);
    expect(res.data.map((g: any) => g.full_name)).toEqual([`=HYPERLINK("http://x")`, "Amina Wanjiru", "Baraka Otieno", "Chen Li", "Dalia Mwende", "Faith Njeri"]);
    const amina = res.data.find((g: any) => g.user_id === ids.amina);
    const st = await partners.statements(ids.amina, 2025);
    expect(amina.totals).toEqual([{ currency: "KES", amount_minor: st.total_minor, count: st.payments.length }]);
    expect(amina.pledge_paid).toEqual([{ currency: "KES", amount_minor: 150000 }]);
    const chen = res.data.find((g: any) => g.user_id === ids.chen);
    expect(chen.totals).toEqual([{ currency: "KES", amount_minor: 25000, count: 1 }, { currency: "USD", amount_minor: 7999, count: 3 }]);
    // Paging.
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: any = (await get(`/admin/finance/statements?year=2025&limit=4${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)).body;
      expect(page.totals).toEqual(res.totals);
      seen.push(...page.data.map((g: any) => g.user_id));
      cursor = page.next_cursor;
    } while (cursor);
    expect(seen).toEqual(res.data.map((g: any) => g.user_id));
    expect((await get("/admin/finance/statements?year=2025&q=baraka")).body.data.map((g: any) => g.user_id)).toEqual([ids.baraka]);
    const csv = await get("/admin/finance/statements.csv?year=2025", exporterTok);
    expect(csv.status).toBe(200);
    expect(csv.text.split("\r\n")[0]).toBe("﻿member,phone,email,currency,gifts,total,pledge_paid,general,gift,mission,offering,tithe");
    expect(csv.text).toContain("Chen Li,'+254711000003,,USD,3,79.99,0.00,50.00,0.00,10.00,0.00,19.99");
  });

  it("statement PDFs: the member's own renderers, for the office; 404 when there is nothing", async () => {
    const giving = await get(`/admin/finance/statements/${ids.amina}/giving.pdf?year=2025`).buffer(true).parse(pdfParser);
    expect(giving.status).toBe(200);
    expect(giving.headers["content-type"]).toBe("application/pdf");
    expect(giving.headers["content-disposition"]).toContain("attachment");
    expect((giving.body as Buffer).subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect((giving.body as Buffer).toString("latin1")).toContain("Year 2025");
    const part = await get(`/admin/finance/statements/${ids.amina}/partners.pdf?year=2025`).buffer(true).parse(pdfParser);
    expect(part.status).toBe(200);
    expect((part.body as Buffer).subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect((await get(`/admin/finance/statements/${ids.amina}/giving.pdf?year=2023`)).status).toBe(404);
    expect((await get(`/admin/finance/statements/${ids.evil}/partners.pdf?year=2025`)).status).toBe(404);
    expect((await get(`/admin/finance/statements/${randomUUID()}/giving.pdf?year=2025`)).status).toBe(404);
    expect((await get(`/admin/finance/statements/${ids.amina}/giving.pdf?year=2025`, nopermTok)).status).toBe(403);
  });

  it("audit: the finance prefixes only, narrowed by action_prefix / actor / dates, keyset paged", async () => {
    const all = (await get("/admin/finance/audit?limit=200")).body;
    const actions = all.data.map((r: any) => r.action).sort();
    expect(actions).toEqual([
      "budget.approved", "department.need_approved", "expense.approved", "finance.gift_recorded", "fund.created",
      "giving.intent_created", "journal.reversed", "pledge.claim_created", "purchase.intent_created", "webhook.received",
    ]);
    expect((await get("/admin/finance/audit?action_prefix=expense.")).body.data.map((r: any) => r.action)).toEqual(["expense.approved"]);
    expect((await get("/admin/finance/audit?action_prefix=department.need")).body.data.map((r: any) => r.action)).toEqual(["department.need_approved"]);
    expect((await get("/admin/finance/audit?action_prefix=user.")).status).toBe(400);
    expect((await get("/admin/finance/audit?actor=System")).body.data.map((r: any) => r.action)).toEqual(["webhook.received"]);
    expect((await get(`/admin/finance/audit?actor=${ids.exporter}`)).body.data.map((r: any) => r.action)).toEqual(["expense.approved"]);
    expect((await get("/admin/finance/audit?from=2025-06-01")).body.data).toHaveLength(0);
    const p1 = (await get("/admin/finance/audit?limit=4")).body;
    const p2 = (await get(`/admin/finance/audit?limit=4&cursor=${p1.next_cursor}`)).body;
    expect(p1.data).toHaveLength(4);
    expect(p2.data[0].audit_id).toBeLessThan(p1.data[3].audit_id);
    expect(typeof p1.data[0].audit_id).toBe("number");
  });

  it("settings: providers by env var NAME only — never a value; receipt counter; tiers; policy", async () => {
    const secrets = { STRIPE_SECRET_KEY: "sk_live_SECRET_VALUE_1", MPESA_CONSUMER_KEY: "ck-secret-2", MPESA_PASSKEY: "passkey-secret-3", MPESA_SHORTCODE: "174379", PAYPAL_CLIENT_ID: "pp-id-secret-4", PAYPAL_SECRET: "pp-secret-5" };
    await q(`INSERT INTO receipt_counters (year, next) VALUES ($1, 42)`, [Number(new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 4))]);
    // The financial router is module-level and keeps the FIRST app's env in
    // this file, so the configured case is read through the service with the
    // secrets set; the route is checked for shape and the unconfigured case.
    const body = await reports.settings({ ...testEnv(), ...secrets } as never);
    const text = JSON.stringify(body);
    for (const v of Object.values(secrets)) expect(text).not.toContain(v);
    const res = { body: body as any };
    const p = (k: string) => res.body.providers.find((x: any) => x.key === k);
    expect(p("stripe")).toMatchObject({ configured: true, env: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] });
    expect(p("mpesa").configured).toBe(true);
    expect(p("airtel").configured).toBe(false);
    expect(p("paypal").configured).toBe(true);
    expect(res.body.receipt_counter.next).toBe(42);
    expect(res.body.receipt_counter.next_receipt).toMatch(/^OR-\d{4}-00042$/);
    expect(res.body.giving_tiers.map((t: any) => t.amount_minor)).toEqual([170000, 500000, 1000000]);
    expect(res.body.reminder_policy).toMatchObject({ due_soon_days: 3, follow_ups: 3, follow_up_hours: 12 });
    const bare = await get("/admin/finance/settings");
    expect(bare.status).toBe(200);
    expect(bare.body.providers.every((x: any) => x.configured === false)).toBe(true);
    expect(bare.body.receipt_counter.next).toBe(42);
  });

  it("trend: one series per currency, EAT months by created_at; `data` is the KES series", async () => {
    const res = (await get("/admin/finance/trend?months=3")).body;
    expect(res.currency).toBe("KES");
    expect(res.data).toHaveLength(3);
    expect(res.series.map((s: any) => s.currency)).toEqual(["KES", "USD"]);
    expect(res.data).toEqual(res.series[0].points);
    expect(res.data[2].total_minor).toBe(5000);
    expect(res.series[1].points[2].total_minor).toBe(700);
    expect(res.data[2].month).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
  });

  it("campaigns: raised counts the campaign's currency inside its window — never after ends_on", async () => {
    const res = await get("/admin/campaigns");
    expect(res.status).toBe(200);
    const c = res.body.data.find((x: any) => x.campaign_id === ids.campaign);
    // 60,000 on 15 July; not the USD gift, not the bank gift on 1 August, not the September need gift.
    expect(c.raised_minor).toBe(60000);
  });

  it("recurring gifts: status and attention filters", async () => {
    const att = (await get("/admin/finance/schedules?attention=true")).body.data;
    expect(att.map((s: any) => s.user_id)).toEqual([ids.chen]);
    expect(att[0].needs_attention).toBe(true);
    expect((await get("/admin/finance/schedules?status=cancelled")).body.data.map((s: any) => s.user_id)).toEqual([ids.amina]);
    expect((await get("/admin/finance/schedules?status=cancelled&attention=true")).body.data).toHaveLength(0);
    expect((await get("/admin/finance/schedules")).body.data).toHaveLength(1);
  });

  it("department needs for Finance: raised is the departments' own figure; finance:view is enough", async () => {
    const res = await get("/admin/finance/needs?status=all", viewerTok);
    expect(res.status).toBe(200);
    const need = res.body.data.find((n: any) => n.need_id === ids.need);
    const truth = (await q(
      `SELECT sum(t.amount_minor)::bigint AS s, count(*)::int AS n FROM transactions t LEFT JOIN pledges p ON p.pledge_id = t.pledge_id
        WHERE t.status = 'succeeded' AND (t.need_id = $1 OR p.need_id = $1)`,
      [ids.need],
    )).rows[0];
    expect(need).toMatchObject({ raised_minor: Number(truth.s), gifts_count: truth.n, target_minor: 200000, fund_code: "mission", department_name: "Missions Team", status: "approved" });
    expect(need.raised_minor).toBe(45000);
    expect(res.body.totals).toEqual([{ currency: "KES", amount_minor: 45000, count: 2, target_minor: 300000, raised_minor: 45000 }]);
    expect((await get("/admin/finance/needs", viewerTok)).body.data.map((n: any) => n.need_id)).toEqual([ids.need]);
    expect((await get("/admin/finance/needs?status=pending&limit=1", viewerTok)).body.data.map((n: any) => n.need_id)).toEqual([ids.need2]);
    expect((await get("/admin/departments/needs", viewerTok)).status).toBe(403);
  });

  it("statement of financial position: balanced; its funds are the Funds page's balances", async () => {
    const pos = (await get("/admin/finance/reports/financial-position")).body;
    expect(pos.balanced).toBe(true);
    const funds = (await get("/admin/finance/funds")).body.data;
    for (const c of pos.currencies) {
      expect(c.totals.assets_minor).toBe(c.totals.funds_minor + c.totals.other_minor);
      for (const f of c.funds) {
        const bal = funds.find((x: any) => x.code === f.code).balances.find((b: any) => b.currency === c.currency);
        expect(f.balance_minor, `${f.code} ${c.currency}`).toBe(bal.balance_minor);
      }
    }
    const kes = pos.currencies.find((c: any) => c.currency === "KES");
    expect(kes.other).toEqual([{ account: "sales:media", label: "Media sales", balance_minor: 50000 }]);
    expect(kes.assets.find((a: any) => a.account === "cash:cheque").balance_minor).toBe(0);
    expect(kes.assets.find((a: any) => a.account === "cash:bank")).toMatchObject({ label: "Bank", balance_minor: 500000 + 100000 - 150000 });
    // As of a day before the opening balance, nothing.
    const before = (await get("/admin/finance/reports/financial-position?as_of=2024-01-01")).body;
    expect(before.currencies.find((c: any) => c.currency === "KES").totals).toEqual({ assets_minor: 0, funds_minor: 0, other_minor: 0 });
    const csv = await get("/admin/finance/reports/financial-position.csv", exporterTok);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("KES,other,sales:media,Media sales,500.00");
  });

  it("income & expenditure: gifts net of reversals = Σ succeeded gifts in range; expenses = approved; transfers and openings excluded", async () => {
    const ie = (await get("/admin/finance/reports/income-expenditure?from=2025-01-01&to=2025-12-31")).body;
    const gifts = (await q(
      `SELECT currency, sum(amount_minor)::bigint AS s FROM transactions
        WHERE status = 'succeeded' AND fund_id IS NOT NULL
          AND created_at >= '2025-01-01T00:00:00+03:00' AND created_at < '2026-01-01T00:00:00+03:00'
        GROUP BY currency`,
    )).rows;
    const expenses = Number((await q(`SELECT sum(amount_minor) AS s FROM expenses WHERE status = 'approved' AND spent_on BETWEEN '2025-01-01' AND '2025-12-31'`)).rows[0].s);
    const kes = ie.currencies.find((c: any) => c.currency === "KES");
    expect(kes.totals.gifts_minor).toBe(Number(gifts.find((g: any) => g.currency === "KES").s));
    expect(kes.totals.other_income_minor).toBe(50000);
    expect(kes.totals.income_minor).toBe(kes.totals.gifts_minor + 50000);
    expect(kes.totals.expenses_minor).toBe(expenses);
    expect(kes.totals.expenses_minor).toBe(180000);
    expect(kes.totals.surplus_minor).toBe(kes.totals.income_minor - 180000);
    expect(kes.expenses.map((e: any) => [e.key, e.amount_minor])).toEqual([["rent", 150000], ["utilities", 30000]]);
    // The opening balance credited fund:general 500,000 by journal — not income.
    expect(kes.income.find((l: any) => l.key === "general").amount_minor).toBe(200000 + 100000 + 25000);
    const usd = ie.currencies.find((c: any) => c.currency === "USD");
    expect(usd.totals.gifts_minor).toBe(Number(gifts.find((g: any) => g.currency === "USD").s));
    // A month: April — the reversed cheque nets to nothing on its own day.
    const apr = (await get("/admin/finance/reports/income-expenditure?from=2025-04-01&to=2025-04-30")).body.currencies[0];
    expect(apr.totals).toEqual({ gifts_minor: 145656, other_income_minor: 0, income_minor: 145656, expenses_minor: 30000, surplus_minor: 115656 });
    const csv = await get("/admin/finance/reports/income-expenditure.csv?from=2025-04-01&to=2025-04-30", exporterTok);
    expect(csv.text).toContain("KES,total,surplus,Surplus (deficit),1156.56");
    const deficit = await get("/admin/finance/reports/income-expenditure.csv?from=2025-02-01&to=2025-02-28", exporterTok);
    expect(deficit.text).toContain("KES,total,surplus,Surplus (deficit),(1000.00)");
  });

  // Last in this block: it adds two members and a cancelled pledge.
  it("giver search: name (prefix first, accent-insensitive), email or phone digits; open pledges only; finance:view is enough", async () => {
    await createUser({ congregationId: ids.cong, fullName: "Ali Baraka", phone: "+254799000111" });
    await createUser({ congregationId: ids.cong, fullName: "Zoë Wairimu", phone: "+254799000222" });
    await pledge({ user: ids.amina, shape: "monthly", amount: 1000, dueDay: 1, fund: "tithe", status: "cancelled", created: eat("2025-02-01") });

    const res = await get("/admin/finance/givers?q=bara", viewerTok);
    expect(res.status).toBe(200);
    expect(res.body.data.map((g: any) => g.full_name)).toEqual(["Baraka Otieno", "Ali Baraka"]);
    expect(res.body.data[0]).toMatchObject({ user_id: ids.baraka, phone: "+254711000002", congregation_name: "Test Branch" });
    expect(res.body.data[0].open_pledges).toEqual([]); // fulfilled is not open
    // "0711 000 001" finds +254711000001 — digits only, trunk 0 dropped.
    const byPhone = (await get(`/admin/finance/givers?q=${encodeURIComponent("0711 000 001")}`, viewerTok)).body.data;
    expect(byPhone.map((g: any) => g.user_id)).toEqual([ids.amina]);
    // Cancelled is not open; the active pledge is, under its card's words.
    expect(byPhone[0].open_pledges).toEqual([
      { pledge_id: ids.pAmina, title: "Missions", currency: "KES", shape: "monthly", status: "active", amount_minor: 50000, target_minor: null, pays_to: { code: "mission", name: "Missions" } },
    ]);
    expect((await get("/admin/finance/givers?q=amina@example", viewerTok)).body.data.map((g: any) => g.user_id)).toEqual([ids.amina]);
    const dalia = (await get("/admin/finance/givers?q=DALIA", viewerTok)).body.data[0];
    expect(dalia.open_pledges.map((p: any) => [p.pledge_id, p.status, p.title])).toEqual([[ids.pDalia, "paused", "A department need"]]);
    expect((await get("/admin/finance/givers?q=zoe", viewerTok)).body.data.map((g: any) => g.full_name)).toEqual(["Zoë Wairimu"]);
    expect((await get(`/admin/finance/givers?q=${encodeURIComponent("Zoë")}`, viewerTok)).body.data.map((g: any) => g.full_name)).toEqual(["Zoë Wairimu"]);
    expect((await get("/admin/finance/givers?q=a", viewerTok)).status).toBe(400);
    expect((await get("/admin/finance/givers?q=%20a%20", viewerTok)).status).toBe(400);
    expect((await get("/admin/finance/givers?q=amina&limit=21", viewerTok)).status).toBe(400);
    expect((await get("/admin/finance/givers?q=amina", nopermTok)).status).toBe(403);
  });
});

describe("finance reports — the deliberately broken rows", () => {
  let broken: Record<string, string>;
  beforeAll(async () => {
    await seedYear();
    broken = await seedBroken();
  }, 120_000);

  it("reconciliation detects each exception kind exactly once (duplicate_receipt: once per code, once per double-entered office row)", async () => {
    const r = (await get("/admin/finance/reconciliation?from=2025-01-01&to=2025-12-31")).body;
    expect(r.exception_counts).toEqual({
      stale_processing: 2, failed: 1, succeeded_without_ledger: 1, unbalanced_transaction: 1,
      refunded_without_reversal: 1, duplicate_receipt: 2, unbalanced_journal: 1,
    });
    const of = (kind: string) => r.exceptions.filter((e: any) => e.kind === kind);
    expect(of("succeeded_without_ledger").map((e: any) => e.transaction_id)).toEqual([broken.noLedger]);
    expect(of("unbalanced_transaction").map((e: any) => e.transaction_id)).toEqual([broken.unbalanced]);
    expect(of("unbalanced_transaction")[0]).toMatchObject({ amount_minor: 1000, currency: "KES" });
    expect(of("refunded_without_reversal").map((e: any) => e.transaction_id)).toEqual([broken.refunded]);
    expect(of("unbalanced_journal").map((e: any) => e.journal_id)).toEqual([broken.journal]);
    const dup = of("duplicate_receipt");
    expect(dup.map((e: any) => e.transaction_id).sort()).toEqual([broken.dupSecond, ids.officeMpesa].sort());
    const office = dup.find((e: any) => e.transaction_id === ids.officeMpesa);
    expect(office.detail).toContain("OR-2025-00004");
    expect(office.detail).toContain("QOFF000001");
    expect(office.detail).toContain(broken.online);
    expect(r.integrity.find((i: any) => i.currency === "KES").balanced).toBe(false);
  });

  it("the Overview counts the integrity issues and alerts on them; the trial balance and the position do not balance", async () => {
    const o = (await get("/admin/finance/overview?from=2025-04-01&to=2025-04-30")).body;
    expect(o.counts.integrity_issues).toBe(6);
    expect(o.alerts.find((a: any) => a.kind === "integrity_issues")).toEqual({ kind: "integrity_issues", count: 6, link: "/finance/reconciliation?tab=integrity" });
    expect((await get("/admin/finance/trial-balance")).body.balanced).toBe(false);
    expect((await get("/admin/finance/reports/financial-position")).body.balanced).toBe(false);
  });
});
