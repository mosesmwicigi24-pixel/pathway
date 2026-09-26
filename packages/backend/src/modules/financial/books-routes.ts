// Finance books routes (docs/FINANCE_ERP.md §4 writes, §6 permissions). Every
// route: authenticate → the capability the spec names → a thin handler over
// FinanceBooks. finance:view reads; finance:manage records, reverses, edits;
// finance:approve approves and posts journals (transfers, opening balances,
// journal reversals); finance:export downloads CSV. Admin/SuperAdmin pass every
// gate (the requirePermission bridge).
import type { NextFunction, Request, Response, Router } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import type { authenticate, requirePermission } from "../../http/auth.js";
import { PERM_MODULES, CAPABILITIES } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { ApiError } from "../../http/errors.js";
import { many, type Queryable } from "../../db/db.js";
import type { FinancialService } from "./service.js";
import { FinanceBooks } from "./books.js";
import { sendCsv } from "./csv.js";

export interface FinanceBooksDeps {
  /** Writes (and the reads that must see them) go to the primary. */
  pool: Pool;
  /** Permission lookups — the same pool requirePermission is bound to. */
  read: Queryable;
  auth: ReturnType<typeof authenticate>;
  perm: ReturnType<typeof requirePermission>;
  fin: FinancialService;
}

/** Pass when the caller holds ANY of the given (module, capability) grants —
 *  through an active role or a direct grant; Admin/SuperAdmin always pass. */
function requireAnyPermission(q: Queryable, grants: Array<[string, string]>) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const p = req.principal;
    if (!p) return next(new ApiError("AUTH_REQUIRED", "Authentication required"));
    if (p.role === "SuperAdmin" || p.role === "Admin") return next();
    try {
      const rows = await many<{ ok: number }>(
        q,
        `SELECT 1 AS ok
           FROM unnest($2::text[], $3::text[]) AS g(module_id, capability)
          WHERE EXISTS (SELECT 1 FROM rbac_user_roles ur
                          JOIN rbac_roles r ON r.role_key = ur.role_key AND r.status = 'active'
                          JOIN rbac_role_permissions rp ON rp.role_key = ur.role_key
                         WHERE ur.user_id = $1 AND rp.module_id = g.module_id AND rp.capability = g.capability)
             OR EXISTS (SELECT 1 FROM rbac_user_permissions up
                         WHERE up.user_id = $1 AND up.module_id = g.module_id AND up.capability = g.capability)
          LIMIT 1`,
        [p.userId, grants.map((g) => g[0]), grants.map((g) => g[1])],
      );
      if (rows.length > 0) return next();
      next(new ApiError("FORBIDDEN_SCOPE", "Missing permission for this action"));
    } catch (err) {
      next(err);
    }
  };
}

const idParam = z.object({ id: z.string().uuid() });

export function registerFinanceBooks(r: Router, deps: FinanceBooksDeps): FinanceBooks {
  const books = new FinanceBooks(deps.pool, deps.fin);
  const { auth, perm } = deps;
  const F = "/admin/finance";
  const view = perm("finance", "view");
  const manage = perm("finance", "manage");
  const approve = perm("finance", "approve");
  const exportCsv = perm("finance", "export");
  const me = (req: Request): string => requirePrincipal(req).userId;
  const id = (req: Request): string => parseBody(idParam, req.params).id;

  // ── office gifts ──
  r.post(`${F}/gifts`, auth, manage, handler(async (req, res) => {
    const out = await books.recordGift(me(req), parseBody(FinanceBooks.GiftInput, req.body ?? {}));
    res.status(out.reused ? 200 : 201).json(out);
  }));
  r.post(`${F}/transactions/:id/reverse`, auth, manage, handler(async (req, res) => {
    const { reason } = parseBody(FinanceBooks.ReverseInput, req.body ?? {});
    res.json(await books.reverseTransaction(me(req), id(req), reason));
  }));

  // ── funds ──
  r.post(`${F}/funds`, auth, manage, handler(async (req, res) => {
    res.status(201).json(await books.createFund(me(req), parseBody(FinanceBooks.FundInput, req.body ?? {})));
  }));
  r.patch(`${F}/funds/:code`, auth, manage, handler(async (req, res) => {
    const { code } = parseBody(z.object({ code: z.string().min(1).max(40) }), req.params);
    res.json(await books.updateFund(me(req), code, parseBody(FinanceBooks.FundPatch, req.body ?? {})));
  }));

  // ── journals: transfers, opening balances, the register, reversal ──
  r.post(`${F}/transfers`, auth, approve, handler(async (req, res) => {
    const out = await books.postTransfer(me(req), parseBody(FinanceBooks.TransferInput, req.body ?? {}));
    res.status(out.reused ? 200 : 201).json(out);
  }));
  r.post(`${F}/opening-balances`, auth, approve, handler(async (req, res) => {
    const out = await books.postOpeningBalance(me(req), parseBody(FinanceBooks.OpeningInput, req.body ?? {}));
    res.status(out.reused ? 200 : 201).json(out);
  }));
  r.get(`${F}/journals`, auth, view, handler(async (req, res) => {
    res.json(await books.listJournals(parseBody(FinanceBooks.JournalQuery, req.query)));
  }));
  r.get(`${F}/journals/:id`, auth, view, handler(async (req, res) => {
    res.json(await books.journalView(deps.pool, id(req)));
  }));
  r.post(`${F}/journals/:id/reverse`, auth, approve, handler(async (req, res) => {
    res.status(201).json(await books.reverseJournal(me(req), id(req), parseBody(FinanceBooks.JournalReverseInput, req.body ?? {})));
  }));

  // ── expenses (maker-checker) ──
  r.get(`${F}/expenses`, auth, view, handler(async (req, res) => {
    res.json(await books.listExpenses(parseBody(FinanceBooks.ExpenseQuery, req.query)));
  }));
  r.get(`${F}/expenses.csv`, auth, exportCsv, handler(async (req, res) => {
    const { cursor: _c, limit: _l, ...filters } = parseBody(FinanceBooks.ExpenseQuery, req.query);
    const { header, rows } = await books.expensesCsvRows(filters);
    sendCsv(res, "nuru-expenses.csv", header, rows);
  }));
  r.post(`${F}/expenses`, auth, manage, handler(async (req, res) => {
    res.status(201).json(await books.recordExpense(me(req), parseBody(FinanceBooks.ExpenseInput, req.body ?? {})));
  }));
  r.get(`${F}/expenses/:id`, auth, view, handler(async (req, res) => {
    res.json(await books.getExpense(deps.pool, id(req)));
  }));
  r.patch(`${F}/expenses/:id`, auth, manage, handler(async (req, res) => {
    res.json(await books.updateExpense(me(req), id(req), parseBody(FinanceBooks.ExpensePatch, req.body ?? {})));
  }));
  r.post(`${F}/expenses/:id/approve`, auth, approve, handler(async (req, res) => {
    res.json(await books.approveExpense(requirePrincipal(req), id(req)));
  }));
  r.post(`${F}/expenses/:id/void`, auth, manage, handler(async (req, res) => {
    const { reason } = parseBody(FinanceBooks.ReverseInput, req.body ?? {});
    res.json(await books.voidExpense(me(req), id(req), reason));
  }));

  // ── expense categories ──
  r.get(`${F}/expense-categories`, auth, view, handler(async (_req, res) => {
    res.json({ data: await books.listCategories() });
  }));
  r.post(`${F}/expense-categories`, auth, manage, handler(async (req, res) => {
    res.status(201).json(await books.createCategory(me(req), parseBody(FinanceBooks.CategoryInput, req.body ?? {})));
  }));
  r.patch(`${F}/expense-categories/:id`, auth, manage, handler(async (req, res) => {
    res.json(await books.updateCategory(me(req), id(req), parseBody(FinanceBooks.CategoryPatch, req.body ?? {})));
  }));

  // ── budgets ──
  r.get(`${F}/budgets`, auth, view, handler(async (_req, res) => {
    res.json({ data: await books.listBudgets() });
  }));
  r.post(`${F}/budgets`, auth, manage, handler(async (req, res) => {
    res.status(201).json(await books.createBudget(me(req), parseBody(FinanceBooks.BudgetInput, req.body ?? {})));
  }));
  r.get(`${F}/budgets/:id`, auth, view, handler(async (req, res) => {
    res.json(await books.getBudget(deps.pool, id(req)));
  }));
  r.patch(`${F}/budgets/:id`, auth, manage, handler(async (req, res) => {
    res.json(await books.updateBudget(me(req), id(req), parseBody(FinanceBooks.BudgetPatch, req.body ?? {})));
  }));
  r.put(`${F}/budgets/:id/lines`, auth, manage, handler(async (req, res) => {
    res.json(await books.replaceBudgetLines(me(req), id(req), parseBody(FinanceBooks.BudgetLinesInput, req.body ?? {})));
  }));
  r.post(`${F}/budgets/:id/approve`, auth, approve, handler(async (req, res) => {
    res.json(await books.approveBudget(me(req), id(req)));
  }));
  r.get(`${F}/budgets/:id/actuals`, auth, view, handler(async (req, res) => {
    res.json(await books.budgetActuals(id(req)));
  }));

  // ── the RBAC catalog, for role and user-permission editors ──
  // Gate: whoever edits roles (rolesAdmin:view), a user's direct grants
  // (users:view) or reads Finance → Settings' roles help (finance:view). The
  // lists are the server's own constants — nothing tenant-specific.
  r.get(
    "/admin/permissions/catalog",
    auth,
    requireAnyPermission(deps.read, [["rolesAdmin", "view"], ["users", "view"], ["finance", "view"]]),
    handler(async (_req, res) => {
      res.json({ modules: [...PERM_MODULES], capabilities: [...CAPABILITIES] });
    }),
  );

  return books;
}
