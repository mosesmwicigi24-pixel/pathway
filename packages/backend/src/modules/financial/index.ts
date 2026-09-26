// Module: financial (spec §1.5, §1.10, §3.5, §5.6)
// Owns: giving, Stripe orchestration, the double-entry ledger, idempotent webhooks.
import express, { Router, type Request } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requirePermission } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { FinancialService } from "./service.js";
import { PartnersService } from "./partners.js";
import { NotificationService } from "../notifications/service.js";
import { invitationFor, recordShown, recordOutcome } from "./invitation.js";
import { CampaignService, CampaignInput } from "./campaigns.js";
import { buildPaymentGateway, type PaymentGateway } from "./gateway.js";
import { buildMobileMoneyProviders, type MobileMoneyProviders } from "./providers.js";
import { buildPayPalGateway, type PayPalGateway } from "./paypal.js";
import { verifyAccessToken } from "../identity/tokens.js";
import { ApiError } from "../../http/errors.js";
import { registerFinanceReports } from "./finance-reports-routes.js";

export const financialRouter: Router = Router();

/** The access token for a download route. These PDFs are opened via the OS
 *  browser/viewer (Linking.openURL), which cannot attach a bearer header, so
 *  they accept a `?token=` access JWT beside the Authorization header. */
function accessTokenOf(req: Request): string {
  const header = req.header("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  const token = bearer ?? (typeof req.query.token === "string" ? req.query.token : null);
  if (!token) throw new ApiError("AUTH_REQUIRED", "Access token required");
  return token;
}

export function registerFinancial(
  ctx: AppContext,
  gatewayOverride?: PaymentGateway,
  mobileMoneyOverride?: MobileMoneyProviders,
  paypalOverride?: PayPalGateway,
): Router {
  const gateway = gatewayOverride ?? buildPaymentGateway(ctx.env);
  const mobileMoney = mobileMoneyOverride ?? buildMobileMoneyProviders(ctx.env);
  const paypal = paypalOverride ?? buildPayPalGateway(ctx.env);
  const svc = new FinancialService(ctx.db.primary, gateway, mobileMoney, paypal);
  const partners = new PartnersService(ctx.db.primary, svc);
  const notifications = new NotificationService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const r = financialRouter;

  r.post(
    "/giving/intents",
    auth,
    handler(async (req, res) => {
      const body = parseBody(FinancialService.GivingIntent, req.body);
      res.status(201).json(await svc.createGivingIntent(requirePrincipal(req).userId, body));
    }),
  );

  // Capture a PayPal order the member approved in the PayPal flow; settles the ledger.
  r.post(
    "/giving/paypal/capture",
    auth,
    handler(async (req, res) => {
      const body = parseBody(z.object({ order_id: z.string().min(1).max(120) }), req.body);
      res.json(await svc.capturePayPal(requirePrincipal(req).userId, body.order_id));
    }),
  );

  r.get(
    "/giving/history",
    auth,
    handler(async (req, res) => {
      res.json({ data: await svc.listGiving(requirePrincipal(req).userId) });
    }),
  );

  // Full detail for one of the caller's gifts (statement drill-down).
  r.get(
    "/giving/transactions/:id",
    auth,
    handler(async (req, res) => {
      const { id } = parseBody(z.object({ id: z.string().uuid() }), req.params);
      res.json(await svc.givingDetail(requirePrincipal(req).userId, id));
    }),
  );

  // The member's statement as a downloadable PDF. Opened via the OS browser
  // (Linking.openURL), so it also accepts a `?token=` access JWT in addition to
  // the Authorization header — the browser can't attach a bearer header.
  r.get(
    "/giving/statement.pdf",
    handler(async (req, res) => {
      const claims = verifyAccessToken(ctx.env, accessTokenOf(req));
      const pdf = await svc.statementPdf(claims.sub);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="nuru-giving-statement.pdf"');
      res.send(pdf);
    }),
  );

  // The Partners statement for one year as a PDF (docs/PARTNERS_PROGRAMME.md
  // §3a): Pledged / Paid / Remaining, a block per pledge, then the pledge-tied
  // payments by month. Gifts outside a pledge are the giving statement's.
  // Same `?token=` fallback; default year = the current Nairobi year; 404 for
  // a member who has never been a partner.
  r.get(
    "/giving/partners/statement.pdf",
    handler(async (req, res) => {
      const claims = verifyAccessToken(ctx.env, accessTokenOf(req));
      const q = parseBody(z.object({ year: z.coerce.number().int().min(2000).max(2999).optional() }), req.query);
      const { year, pdf } = await partners.partnersStatementPdf(claims.sub, q.year);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="nuru-partners-statement-${year}.pdf"`);
      res.send(pdf);
    }),
  );

  // A single gift's receipt as a downloadable PDF — opened via the OS browser
  // (Linking.openURL), so it accepts a `?token=` access JWT like the statement.
  r.get(
    "/giving/transactions/:id/receipt.pdf",
    handler(async (req, res) => {
      const { id } = parseBody(z.object({ id: z.string().uuid() }), req.params);
      const claims = verifyAccessToken(ctx.env, accessTokenOf(req));
      const pdf = await svc.receiptPdf(claims.sub, id);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="nuru-giving-receipt.pdf"');
      res.send(pdf);
    }),
  );

  // ---- Recurring giving (B7): managed online-only; the scheduler charges ----
  r.post(
    "/giving/schedules",
    auth,
    handler(async (req, res) => {
      const body = parseBody(FinancialService.CreateSchedule, req.body);
      res.status(201).json(await svc.createSchedule(requirePrincipal(req).userId, body));
    }),
  );

  r.get(
    "/giving/schedules",
    auth,
    handler(async (req, res) => {
      res.json(await svc.listSchedules(requirePrincipal(req).userId));
    }),
  );

  // ── The partner invitation (phase 2) ───────────────────────────────────────
  // The client asks "may I show this?" and renders whatever comes back. Every
  // rule of restraint lives on the server (invitation.ts) so the two apps
  // cannot drift apart — and they would only ever drift towards asking more.
  r.get(
    "/giving/invitation",
    auth,
    handler(async (req, res) => {
      res.json(await invitationFor(ctx.db.primary, requirePrincipal(req).userId));
    }),
  );

  // Rendered, not merely decided. The client calls this when the invitation is
  // actually on screen, which is what the "three times, ever" rule counts.
  r.post(
    "/giving/invitation/:id/shown",
    auth,
    handler(async (req, res) => {
      const { id } = parseBody(z.object({ id: z.string().uuid() }), req.params);
      await recordShown(ctx.db.primary, requirePrincipal(req).userId, id);
      res.status(204).end();
    }),
  );

  // What they did about it. 'declined' is the permanent one — the member saying
  // don't ask again, and nothing may override it.
  r.post(
    "/giving/invitation/:id/outcome",
    auth,
    handler(async (req, res) => {
      const { id } = parseBody(z.object({ id: z.string().uuid() }), req.params);
      const { outcome } = parseBody(
        z.object({ outcome: z.enum(["dismissed", "declined", "opened", "gave"]) }),
        req.body,
      );
      await recordOutcome(ctx.db.primary, requirePrincipal(req).userId, id, outcome);
      res.status(204).end();
    }),
  );

  // A member's standing as a PARTNER — derived from their giving schedule, not
  // stored separately, so the two can never disagree. Recognition, not receipts:
  // receipts live under /giving/history and stay there.
  r.get(
    "/giving/partnership",
    auth,
    handler(async (req, res) => {
      res.json(await partners.partnership(requirePrincipal(req).userId));
    }),
  );

  // ── The Partners programme (docs/PARTNERS_PROGRAMME.md §2, §5) ──────────
  r.post("/giving/partners/join", auth, handler(async (req, res) => {
    res.status(201).json(await partners.join(requirePrincipal(req).userId));
  }));
  r.get("/giving/pledges", auth, handler(async (req, res) => {
    res.json({ data: await partners.listPledges(requirePrincipal(req).userId) });
  }));
  r.post("/giving/pledges", auth, handler(async (req, res) => {
    const input = parseBody(PartnersService.CreatePledge, req.body ?? {});
    res.status(201).json(await partners.createPledge(requirePrincipal(req).userId, input));
  }));
  r.get("/giving/pledges/:id", auth, handler(async (req, res) => {
    res.json(await partners.getPledge(requirePrincipal(req).userId, String(req.params.id)));
  }));
  r.patch("/giving/pledges/:id", auth, handler(async (req, res) => {
    const patch = parseBody(PartnersService.UpdatePledge, req.body ?? {});
    res.json(await partners.updatePledge(requirePrincipal(req).userId, String(req.params.id), patch));
  }));
  r.post("/giving/pledges/:id/claims", auth, handler(async (req, res) => {
    const input = parseBody(PartnersService.CreateClaim, req.body ?? {});
    res.status(201).json(await partners.createClaim(requirePrincipal(req).userId, String(req.params.id), input));
  }));
  r.get("/giving/pledges/:id/claims", auth, handler(async (req, res) => {
    res.json({ data: await partners.listClaims(requirePrincipal(req).userId, String(req.params.id)) });
  }));
  r.get("/giving/statements", auth, handler(async (req, res) => {
    const y = req.query.year ? Number(req.query.year) : undefined;
    res.json(await partners.statements(requirePrincipal(req).userId, Number.isFinite(y) ? y : undefined));
  }));


  r.post(
    "/giving/schedules/:id/cancel",
    auth,
    handler(async (req, res) => {
      const { id } = parseBody(z.object({ id: z.string().uuid() }), req.params);
      res.json(await svc.cancelSchedule(requirePrincipal(req).userId, id));
    }),
  );

  // A paused schedule is a standing intention, not a dead one: this re-arms it
  // from now. It deliberately does NOT charge the cycle that was missed —
  // money must never surprise anyone; covering the gap is a one-off gift.
  r.post(
    "/giving/schedules/:id/resume",
    auth,
    handler(async (req, res) => {
      const { id } = parseBody(z.object({ id: z.string().uuid() }), req.params);
      res.json(await svc.resumeSchedule(requirePrincipal(req).userId, id));
    }),
  );

  // ---- Admin finance reads (ERP, Contract Matrix B1; RBAC finance:view, §5.4) ----
  const perm = requirePermission(ctx.db.replica);
  registerFinanceReports(r, { pool: ctx.db.primary, env: ctx.env, financial: svc, partners, auth, perm });

  // Recurring giving — who is committed, and whose collection is failing. There
  // was no admin read of giving_schedules at all before this.
  // ── Campaign authoring (finance:manage) ────────────────────────────────────
  // A campaign is created as a DRAFT and reaches nobody until someone
  // deliberately puts it live. The reach read exists so "why did nobody give?"
  // can be answered with facts — it distinguishes a campaign nobody saw from
  // one people saw and declined, which look identical in the giving totals.
  const campaignsSvc = new CampaignService(ctx.db.primary);
  const congOf = (req: Parameters<typeof requirePrincipal>[0]): string => {
    const c = requirePrincipal(req).congregationId;
    if (!c) throw new ApiError("UNPROCESSABLE", "This account is not attached to a congregation");
    return c;
  };

  r.get("/admin/campaigns", auth, perm("finance", "view"), handler(async (req, res) => {
    res.json(await campaignsSvc.list(congOf(req)));
  }));

  r.post("/admin/campaigns", auth, perm("finance", "manage"), handler(async (req, res) => {
    const input = parseBody(CampaignInput, req.body);
    res.status(201).json(await campaignsSvc.create(congOf(req), requirePrincipal(req).userId, input));
  }));

  r.put("/admin/campaigns/:id", auth, perm("finance", "manage"), handler(async (req, res) => {
    const { id } = parseBody(z.object({ id: z.string().uuid() }), req.params);
    res.json(await campaignsSvc.update(congOf(req), id, parseBody(CampaignInput, req.body)));
  }));

  r.post("/admin/campaigns/:id/status", auth, perm("finance", "manage"), handler(async (req, res) => {
    const { id } = parseBody(z.object({ id: z.string().uuid() }), req.params);
    const { status } = parseBody(z.object({ status: z.enum(["live", "ended"]) }), req.body);
    res.json(await campaignsSvc.setStatus(congOf(req), id, status));
  }));

  r.get("/admin/campaigns/:id/reach", auth, perm("finance", "view"), handler(async (req, res) => {
    const { id } = parseBody(z.object({ id: z.string().uuid() }), req.params);
    res.json(await campaignsSvc.reach(congOf(req), id));
  }));

  r.get("/admin/finance/schedules", auth, perm("finance", "view"), handler(async (req, res) => {
    const q = parseBody(
      z.object({
        status: z.enum(["active", "paused", "cancelled"]).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      }),
      req.query,
    );
    res.json(await svc.listSchedulesAdmin(q));
  }));

  r.get("/admin/finance/summary", auth, perm("finance", "view"), handler(async (_req, res) => {
    res.json(await svc.financeSummary());
  }));

  r.get("/admin/finance/transactions", auth, perm("finance", "view"), handler(async (req, res) => {
    const q = parseBody(FinancialService.ListTransactions, req.query);
    res.json(await svc.listTransactions(q));
  }));

  r.get("/admin/finance/ledger", auth, perm("finance", "view"), handler(async (req, res) => {
    const q = parseBody(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    res.json({ data: await svc.listLedger(q.limit) });
  }));

  // Overview trend (settled giving per month).
  r.get("/admin/finance/trend", auth, perm("finance", "view"), handler(async (req, res) => {
    const q = parseBody(z.object({ months: z.coerce.number().int().min(1).max(24).default(6) }), req.query);
    res.json(await svc.financeTrend(q.months));
  }));

  // Finance-scoped audit trail (the money paper trail, §5.10).
  r.get("/admin/finance/audit", auth, perm("finance", "view"), handler(async (req, res) => {
    const q = parseBody(FinancialService.ListFinanceAudit, req.query);
    res.json(await svc.financeAudit(q));
  }));

  // Single transaction + its balanced ledger postings (detail drawer).
  r.get("/admin/finance/transactions/:id", auth, perm("finance", "view"), handler(async (req, res) => {
    const detail = await svc.transactionDetail(String(req.params.id));
    if (!detail) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Transaction not found" } });
      return;
    }
    res.json(detail);
  }));

  // Read-only configuration view: funds + which providers are wired (no secrets, §5.6).
  r.get("/admin/finance/config", auth, perm("finance", "view"), handler(async (_req, res) => {
    const funds = await svc.financeFunds();
    const e = ctx.env;
    const providers = [
      { key: "stripe", label: "Stripe (cards & wallets)", enabled: Boolean(e.STRIPE_SECRET_KEY) },
      { key: "mpesa", label: "M-Pesa (STK push)", enabled: Boolean(e.MPESA_CONSUMER_KEY && e.MPESA_PASSKEY && e.MPESA_SHORTCODE) || Boolean(e.MPESA_CALLBACK_SECRET) },
      { key: "airtel", label: "Airtel Money", enabled: Boolean(e.AIRTEL_CALLBACK_SECRET) },
      { key: "paypal", label: "PayPal (USD)", enabled: Boolean(e.PAYPAL_CLIENT_ID && e.PAYPAL_SECRET) },
    ];
    res.json({ funds, providers, step_up_required: true });
  }));

  // Media store (§3.3): catalogue + purchase (access granted on the webhook).
  r.get(
    "/products",
    auth,
    handler(async (_req, res) => {
      res.json({ data: await svc.listProducts() });
    }),
  );

  r.post(
    "/products/:id/purchase",
    auth,
    handler(async (req, res) => {
      res.status(201).json(await svc.createPurchase(requirePrincipal(req).userId, req.params.id ?? ""));
    }),
  );

  // Stripe webhook: no session auth — authenticity is the HMAC signature. Uses a
  // raw body parser (app.ts skips JSON for this path) so the signature verifies.
  r.post(
    "/webhooks/stripe",
    express.raw({ type: "*/*", limit: "256kb" }),
    handler(async (req, res) => {
      const signature = req.header("stripe-signature") ?? "";
      const body: Buffer | string = Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body ?? {});
      const result = await svc.handleWebhook(body, signature);
      res.json({ received: true, ...result });
    }),
  );

  // Mobile-money callbacks (B7): same trust model — no session auth, HMAC only.
  r.post(
    "/webhooks/mobilemoney/:provider",
    express.raw({ type: "*/*", limit: "256kb" }),
    handler(async (req, res) => {
      const { provider } = parseBody(z.object({ provider: z.enum(["mpesa", "airtel"]) }), req.params);
      const signature = req.header("x-mm-signature") ?? "";
      const body: Buffer | string = Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body ?? {});
      const result = await svc.handleMobileMoneyCallback(provider, body, signature);
      res.json({ received: true, ...result });
    }),
  );

  // Partners, admin side (docs/PARTNERS_PROGRAMME.md §5).
  r.get("/admin/partners", auth, perm("finance", "view"), handler(async (req, res) => {
    const q = parseBody(PartnersService.AdminListQuery, req.query ?? {});
    res.json(await partners.adminList(q));
  }));
  r.get("/admin/partners/claims", auth, perm("finance", "view"), handler(async (_req, res) => {
    res.json({ data: await partners.pendingClaims() });
  }));
  r.post("/admin/partners/claims/:id/confirm", auth, perm("finance", "manage"), handler(async (req, res) => {
    res.json(await partners.decideClaim(requirePrincipal(req).userId, String(req.params.id), "confirm", notifications));
  }));
  r.post("/admin/partners/claims/:id/reject", auth, perm("finance", "manage"), handler(async (req, res) => {
    res.json(await partners.decideClaim(requirePrincipal(req).userId, String(req.params.id), "reject", notifications));
  }));
  r.post("/admin/partners/remind-behind", auth, perm("finance", "manage"), handler(async (req, res) => {
    res.json(await partners.remindBehind(requirePrincipal(req).userId, notifications));
  }));
  r.post("/admin/partners/:userId/remind", auth, perm("finance", "manage"), handler(async (req, res) => {
    const body = parseBody(z.object({ pledge_id: z.string().uuid().nullish(), message: z.string().trim().max(200).nullish() }), req.body ?? {});
    res.json(await partners.adminRemind(requirePrincipal(req).userId, String(req.params.userId), notifications, body));
  }));
  r.get("/admin/partners/:userId", auth, perm("finance", "view"), handler(async (req, res) => {
    res.json(await partners.adminDetail(String(req.params.userId)));
  }));

  return r;
}
