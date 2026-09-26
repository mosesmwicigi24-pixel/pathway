// Finance ERP — the read side's routes (docs/FINANCE_ERP.md §4). Registered
// from financial/index.ts right after the permission gate is built, so they
// run BEFORE that file's older admin finance handlers: GET /admin/finance/
// ledger and /schedules here supersede the older ones (same paths, a wider
// query). GET /transactions, /transactions/:id, /trend and /audit stay on the
// older handlers, whose service methods now delegate to finance-reports.ts.
//
// Every route: authenticated + finance:view. CSV twins additionally need
// finance:export and go out through csv.ts (formula guard, exact money, a
// currency column beside every amount).
import type { Router, RequestHandler, Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import type { Env } from "../../config/env.js";
import { handler, parseBody } from "../../http/http.js";
import type { FinancialService } from "./service.js";
import type { PartnersService } from "./partners.js";
import { sendCsv, minorToMajor, type CsvCell } from "./csv.js";
import {
  FinanceReportsService, TransactionsQuery, listFinanceTransactions, LedgerQuery, listLedgerPage,
  PeriodQuery, PledgesQuery, IncomeReportQuery, ExpenseReportQuery, YearQuery, StatementsQuery, NeedsQuery, AsOfQuery,
  GiversQuery, Year, BoolParam,
} from "./finance-reports.js";

export interface FinanceReportsRouteDeps {
  pool: Pool;
  env: Env;
  financial: FinancialService;
  partners: PartnersService;
  auth: RequestHandler;
  perm: (moduleId: string, capability: string) => RequestHandler;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Anything a row carries, as a CSV cell (Dates stay Dates → ISO). */
function cell(v: unknown): CsvCell {
  if (v === null || v === undefined || v instanceof Date || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return String(v);
}

/** Money that may be negative (a deficit, an overdrawn fund), in the
 *  accounting convention "(12.50)" — exact, and read as a negative number by
 *  spreadsheets without tripping the formula guard a leading "-" would. */
function signedMajor(minor: number): string {
  return minor < 0 ? `(${minorToMajor(-minor)})` : minorToMajor(minor);
}

const today = (): string => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

export function registerFinanceReports(r: Router, deps: FinanceReportsRouteDeps): void {
  const { auth, perm } = deps;
  const svc = new FinanceReportsService(deps.pool, { financial: deps.financial, partners: deps.partners });
  const view = [auth, perm("finance", "view")];
  const exportCsv = [auth, perm("finance", "view"), perm("finance", "export")];
  const pdf = (res: Response, filename: string, body: Buffer): void => {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/[^A-Za-z0-9_.-]/g, "-")}"`);
    res.send(body);
  };

  // ── Overview ───────────────────────────────────────────────────────────
  r.get("/admin/finance/overview", ...view, handler(async (req, res) => {
    res.json(await svc.overview(parseBody(PeriodQuery, req.query)));
  }));

  // ── Transactions (the JSON register stays on GET /admin/finance/transactions) ──
  r.get("/admin/finance/transactions.csv", ...exportCsv, handler(async (req, res) => {
    const q = parseBody(TransactionsQuery, req.query);
    const { data } = await listFinanceTransactions(deps.pool, q, { all: true });
    sendCsv(
      res,
      `finance-transactions-${q.from ?? "start"}-${q.to ?? today()}.csv`,
      ["created_at", "settled_at", "transaction_id", "status", "amount", "currency", "fund", "fund_name", "channel", "source",
        "receipt_code", "name", "member_phone", "giver_phone", "pledge", "need", "office_reference", "recorded_by",
        "reversed_at", "reversal_reason", "provider_ref"],
      data.map((t) => [
        cell(t.created_at), cell(t.settled_at), t.transaction_id, t.status, minorToMajor(t.amount_minor), t.currency,
        cell(t.fund), cell(t.fund_name), cell(t.channel), cell(t.source), cell(t.receipt_code), cell(t.display_name),
        cell(t.member_phone), cell(t.giver_phone), cell(t.pledge_title), cell(t.need_title), cell(t.office_reference),
        cell(t.recorded_by_name), cell(t.reversed_at), cell(t.reversal_reason), cell(t.provider_ref),
      ]),
    );
  }));

  // ── Pledges ────────────────────────────────────────────────────────────
  r.get("/admin/finance/pledges", ...view, handler(async (req, res) => {
    res.json(await svc.pledges(parseBody(PledgesQuery, req.query)));
  }));
  r.get("/admin/finance/pledges.csv", ...exportCsv, handler(async (req, res) => {
    const out = await svc.pledges(parseBody(PledgesQuery, req.query), new Date(), { all: true });
    sendCsv(
      res,
      `finance-pledges-${out.year}.csv`,
      ["pledge_id", "member", "phone", "title", "shape", "amount", "target", "currency", "status", "standing", "year",
        "pledged_year", "paid_year", "remaining_year", "paid_total", "kept", "due_count", "next_due", "overdue_since", "pays_to"],
      out.data.map((p) => [
        cell(p.pledge_id), cell(p.member_name), cell(p.member_phone), cell(p.title), cell(p.shape),
        p.amount_minor == null ? null : minorToMajor(Number(p.amount_minor)),
        p.target_minor == null ? null : minorToMajor(Number(p.target_minor)),
        cell(p.currency), cell(p.status), cell(p.standing), cell(p.year),
        minorToMajor(Number(p.pledged_year_minor)), minorToMajor(Number(p.paid_year_minor)), minorToMajor(Number(p.remaining_year_minor)),
        minorToMajor(Number(p.paid_total_minor)), cell(p.kept), cell(p.due_count), cell(p.next_due), cell(p.overdue_since),
        cell((p.pays_to as { code: string } | null)?.code ?? null),
      ]),
    );
  }));

  // ── Funds (POST/PATCH are the books side) ───────────────────────────────
  r.get("/admin/finance/funds", ...view, handler(async (req, res) => {
    res.json(await svc.funds(parseBody(PeriodQuery, req.query)));
  }));

  // ── Ledger + trial balance ─────────────────────────────────────────────
  // Supersedes the older GET /admin/finance/ledger (?limit only) in index.ts:
  // same rows, now with journal postings, filters, a cursor and totals.
  r.get("/admin/finance/ledger", ...view, handler(async (req, res) => {
    res.json(await listLedgerPage(deps.pool, parseBody(LedgerQuery, req.query)));
  }));
  r.get("/admin/finance/ledger.csv", ...exportCsv, handler(async (req, res) => {
    const q = parseBody(LedgerQuery, req.query);
    const { data } = await listLedgerPage(deps.pool, q, { all: true });
    sendCsv(
      res,
      `finance-ledger-${q.from ?? "start"}-${q.to ?? today()}.csv`,
      ["posted_on", "created_at", "entry_id", "kind", "account", "side", "amount", "currency", "transaction_id", "receipt_code",
        "member", "transaction_status", "journal_id", "journal_kind", "memo"],
      data.map((l) => [
        cell(l.posted_on), cell(l.created_at), cell(l.entry_id), cell(l.kind), cell(l.account), cell(l.side),
        minorToMajor(Number(l.amount_minor)), cell(l.currency), cell(l.transaction_id), cell(l.receipt_code),
        cell(l.member_name), cell(l.transaction_status), cell(l.journal_id), cell(l.journal_kind), cell(l.memo),
      ]),
    );
  }));
  r.get("/admin/finance/trial-balance", ...view, handler(async (req, res) => {
    res.json(await svc.trialBalance(parseBody(PeriodQuery, req.query)));
  }));

  // ── Reconciliation ─────────────────────────────────────────────────────
  r.get("/admin/finance/reconciliation", ...view, handler(async (req, res) => {
    res.json(await svc.reconciliation(parseBody(PeriodQuery, req.query)));
  }));

  // ── Reports ────────────────────────────────────────────────────────────
  const matrixCsv = (res: Response, name: string, out: Record<string, unknown>): void => {
    const currencies = out.currencies as { currency: string; rows: { key: string; label: string; months: number[]; total_minor: number }[]; totals: { months: number[]; total_minor: number } }[];
    const rows: CsvCell[][] = [];
    for (const c of currencies) {
      for (const row of c.rows) rows.push([c.currency, row.key, row.label, ...row.months.map(minorToMajor), minorToMajor(row.total_minor)]);
      rows.push([c.currency, "TOTAL", "Total", ...c.totals.months.map(minorToMajor), minorToMajor(c.totals.total_minor)]);
    }
    sendCsv(res, `finance-${name}-${String(out.by)}-${String(out.year)}.csv`, ["currency", "key", "label", ...MONTHS, "total"], rows);
  };
  r.get("/admin/finance/reports/income", ...view, handler(async (req, res) => {
    res.json(await svc.reportIncome(parseBody(IncomeReportQuery, req.query)));
  }));
  r.get("/admin/finance/reports/income.csv", ...exportCsv, handler(async (req, res) => {
    matrixCsv(res, "income", await svc.reportIncome(parseBody(IncomeReportQuery, req.query)));
  }));
  r.get("/admin/finance/reports/expenses", ...view, handler(async (req, res) => {
    res.json(await svc.reportExpenses(parseBody(ExpenseReportQuery, req.query)));
  }));
  r.get("/admin/finance/reports/expenses.csv", ...exportCsv, handler(async (req, res) => {
    matrixCsv(res, "expenses", await svc.reportExpenses(parseBody(ExpenseReportQuery, req.query)));
  }));
  r.get("/admin/finance/reports/pledges", ...view, handler(async (req, res) => {
    res.json(await svc.reportPledges(parseBody(YearQuery, req.query)));
  }));
  r.get("/admin/finance/reports/pledges.csv", ...exportCsv, handler(async (req, res) => {
    const out = await svc.reportPledges(parseBody(YearQuery, req.query));
    const currencies = out.currencies as { currency: string; months: { month: number; pledged_minor: number; paid_minor: number; kept: number; missed: number; behind_partners: number }[]; totals: { pledged_minor: number; paid_minor: number; kept: number; missed: number; behind_partners: number } }[];
    const rows: CsvCell[][] = [];
    for (const c of currencies) {
      for (const m of c.months) rows.push([c.currency, m.month, minorToMajor(m.pledged_minor), minorToMajor(m.paid_minor), m.kept, m.missed, m.behind_partners]);
      rows.push([c.currency, "TOTAL", minorToMajor(c.totals.pledged_minor), minorToMajor(c.totals.paid_minor), c.totals.kept, c.totals.missed, c.totals.behind_partners]);
    }
    sendCsv(res, `finance-pledges-report-${String(out.year)}.csv`, ["currency", "month", "pledged", "paid", "kept", "missed", "behind_partners"], rows);
  }));
  r.get("/admin/finance/reports/financial-position", ...view, handler(async (req, res) => {
    res.json(await svc.financialPosition(parseBody(AsOfQuery, req.query)));
  }));
  r.get("/admin/finance/reports/financial-position.csv", ...exportCsv, handler(async (req, res) => {
    const out = await svc.financialPosition(parseBody(AsOfQuery, req.query));
    type Line = { account: string; label: string; balance_minor: number };
    const currencies = out.currencies as { currency: string; assets: Line[]; funds: Line[]; other: Line[]; totals: { assets_minor: number; funds_minor: number; other_minor: number } }[];
    const rows: CsvCell[][] = [];
    for (const c of currencies) {
      for (const [section, lines] of [["assets", c.assets], ["funds", c.funds], ["other", c.other]] as const) {
        for (const l of lines) rows.push([c.currency, section, l.account, l.label, signedMajor(l.balance_minor)]);
      }
      rows.push([c.currency, "total", "assets", "Total assets", signedMajor(c.totals.assets_minor)]);
      rows.push([c.currency, "total", "funds", "Total funds", signedMajor(c.totals.funds_minor)]);
      rows.push([c.currency, "total", "other", "Total other", signedMajor(c.totals.other_minor)]);
    }
    sendCsv(res, `finance-financial-position-${String(out.as_of)}.csv`, ["currency", "section", "account", "label", "balance"], rows);
  }));
  r.get("/admin/finance/reports/income-expenditure", ...view, handler(async (req, res) => {
    res.json(await svc.incomeExpenditure(parseBody(PeriodQuery, req.query)));
  }));
  r.get("/admin/finance/reports/income-expenditure.csv", ...exportCsv, handler(async (req, res) => {
    const out = await svc.incomeExpenditure(parseBody(PeriodQuery, req.query));
    type Line = { key: string; label: string; amount_minor: number };
    const currencies = out.currencies as { currency: string; income: Line[]; other_income: Line[]; expenses: Line[]; totals: { gifts_minor: number; other_income_minor: number; income_minor: number; expenses_minor: number; surplus_minor: number } }[];
    const rows: CsvCell[][] = [];
    for (const c of currencies) {
      for (const [section, lines] of [["income", c.income], ["other_income", c.other_income], ["expenses", c.expenses]] as const) {
        for (const l of lines) rows.push([c.currency, section, l.key, l.label, signedMajor(l.amount_minor)]);
      }
      rows.push([c.currency, "total", "gifts", "Gifts", signedMajor(c.totals.gifts_minor)]);
      rows.push([c.currency, "total", "other_income", "Other income", signedMajor(c.totals.other_income_minor)]);
      rows.push([c.currency, "total", "income", "Total income", signedMajor(c.totals.income_minor)]);
      rows.push([c.currency, "total", "expenses", "Total expenditure", signedMajor(c.totals.expenses_minor)]);
      rows.push([c.currency, "total", "surplus", "Surplus (deficit)", signedMajor(c.totals.surplus_minor)]);
    }
    const p = out.period as { from: string; to: string };
    sendCsv(res, `finance-income-expenditure-${p.from}-${p.to}.csv`, ["currency", "section", "key", "label", "amount"], rows);
  }));

  // ── Statements ─────────────────────────────────────────────────────────
  r.get("/admin/finance/statements", ...view, handler(async (req, res) => {
    res.json(await svc.statements(parseBody(StatementsQuery, req.query)));
  }));
  r.get("/admin/finance/statements.csv", ...exportCsv, handler(async (req, res) => {
    const out = await svc.statements(parseBody(StatementsQuery, req.query), new Date(), { all: true });
    const funds = [...new Set(out.data.flatMap((g) => g.by_fund.map((f) => f.code)))].sort();
    const rows: CsvCell[][] = [];
    for (const g of out.data) {
      for (const t of g.totals) {
        rows.push([
          g.full_name, g.phone, g.email, t.currency, t.count, minorToMajor(t.amount_minor),
          minorToMajor(g.pledge_paid.find((p) => p.currency === t.currency)?.amount_minor ?? 0),
          ...funds.map((code) => minorToMajor(g.by_fund.find((f) => f.code === code && f.currency === t.currency)?.amount_minor ?? 0)),
        ]);
      }
    }
    sendCsv(res, `finance-statements-${out.year}.csv`, ["member", "phone", "email", "currency", "gifts", "total", "pledge_paid", ...funds], rows);
  }));
  const PdfQuery = z.object({ year: Year.optional() });
  r.get("/admin/finance/statements/:userId/giving.pdf", ...view, handler(async (req, res) => {
    const { year } = parseBody(PdfQuery, req.query);
    const userId = String(req.params.userId);
    const out = await svc.givingPdf(userId, year);
    pdf(res, `nuru-giving-statement-${out.year}-${userId.slice(0, 8)}.pdf`, out.pdf);
  }));
  r.get("/admin/finance/statements/:userId/partners.pdf", ...view, handler(async (req, res) => {
    const { year } = parseBody(PdfQuery, req.query);
    const userId = String(req.params.userId);
    const out = await svc.partnersPdf(userId, year);
    pdf(res, `nuru-partners-statement-${out.year}-${userId.slice(0, 8)}.pdf`, out.pdf);
  }));

  // ── Giver search for "Record a gift" (no members:view needed) ───────────
  r.get("/admin/finance/givers", ...view, handler(async (req, res) => {
    res.json(await svc.giverSearch(parseBody(GiversQuery, req.query)));
  }));

  // ── Department needs, for Finance (approval stays in Departments) ───────
  r.get("/admin/finance/needs", ...view, handler(async (req, res) => {
    res.json(await svc.needs(parseBody(NeedsQuery, req.query)));
  }));

  // ── Settings (read-only; env var NAMES only) ────────────────────────────
  r.get("/admin/finance/settings", ...view, handler(async (_req, res) => {
    res.json(await svc.settings(deps.env));
  }));

  // ── Recurring gifts: supersedes the older handler to add ?attention= ────
  r.get("/admin/finance/schedules", ...view, handler(async (req, res) => {
    const q = parseBody(
      z.object({
        status: z.enum(["active", "paused", "cancelled"]).optional(),
        attention: BoolParam.optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      }),
      req.query,
    );
    res.json(await deps.financial.listSchedulesAdmin(q));
  }));
}
