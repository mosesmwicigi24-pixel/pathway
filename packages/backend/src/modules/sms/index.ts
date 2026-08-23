// Module: SMS center — bulk campaigns, groups, delivery reports.
//
// Admin routes are Admin+ and congregation-scoped. The one public route is the
// delivery-report webhook: Africa's Talking calling back with what finally
// happened to a message. They do not sign their callbacks, so that route
// trusts nothing but a matching at_message_id, is rate-limited, and can write
// exactly two facts (delivered / failed+reason) onto rows we created.
import { Router, urlencoded } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { rateLimit, type RateLimitStore } from "../../http/rateLimit.js";
import { buildSmsProvider, AfricasTalkingSmsProvider } from "../announcements/africastalking.js";
import { SmsCampaignService, audienceSchema, campaignSchema, type SmsBulkSender } from "./service.js";

const IdParam = z.object({ id: z.string().uuid() });
const PreviewBody = z.object({ audience: audienceSchema, body: z.string().min(1).max(612) });
const GroupBody = z.object({ name: z.string().trim().min(1).max(80) });
const MembersBody = z.object({ user_ids: z.array(z.string().uuid()).min(1).max(500) });

/** Fresh Router per registration — the singleton lesson from announcements. */
export function registerSms(ctx: AppContext, rl: RateLimitStore, svc?: SmsCampaignService): Router {
  const r = Router();
  const provider = ctx.smsProvider ?? buildSmsProvider(ctx.env, ctx.log);
  // Bulk needs sendBatch/balance — the real Africa's Talking class has them;
  // a bare MessageProvider (or nothing) means campaigns refuse to send, which
  // the routes surface honestly rather than pretending.
  const bulk: SmsBulkSender | undefined =
    provider instanceof AfricasTalkingSmsProvider
      ? provider
      : provider && typeof (provider as Partial<SmsBulkSender>).sendBatch === "function"
        ? (provider as unknown as SmsBulkSender)
        : undefined;
  const service = svc ?? new SmsCampaignService(ctx.db.primary, bulk);
  const auth = authenticate(ctx.env);
  const adminOnly = [auth, requireRole("Admin")] as const;
  const cong = (req: Parameters<typeof requirePrincipal>[0]): string => {
    const c = requirePrincipal(req).congregationId;
    if (!c) throw Object.assign(new Error("No congregation"), { status: 403 });
    return c;
  };

  // -------- overview: is SMS live, whose money is left --------
  r.get("/admin/sms/overview", ...adminOnly, handler(async (_req, res) => {
    res.json({
      configured: Boolean(bulk),
      sender_id: ctx.env.AFRICASTALKING_SENDER_ID ?? null,
      balance: bulk ? await bulk.balance() : null,
    });
  }));

  // -------- groups --------
  r.get("/admin/sms/groups", ...adminOnly, handler(async (req, res) => {
    res.json({ data: await service.listGroups(cong(req)) });
  }));
  r.post("/admin/sms/groups", ...adminOnly, handler(async (req, res) => {
    const { name } = parseBody(GroupBody, req.body);
    res.status(201).json(await service.createGroup(cong(req), requirePrincipal(req).userId, name));
  }));
  r.get("/admin/sms/groups/:id/members", ...adminOnly, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json({ data: await service.groupMembers(cong(req), id) });
  }));
  r.post("/admin/sms/groups/:id/members", ...adminOnly, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const { user_ids } = parseBody(MembersBody, req.body);
    res.json(await service.addGroupMembers(cong(req), id, user_ids));
  }));
  r.delete("/admin/sms/groups/:id/members/:userId", ...adminOnly, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const userId = z.string().uuid().parse(req.params.userId);
    await service.removeGroupMember(cong(req), id, userId);
    res.json({ removed: true });
  }));
  r.delete("/admin/sms/groups/:id", ...adminOnly, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    await service.deleteGroup(cong(req), id);
    res.json({ deleted: true });
  }));

  // -------- compose-time truth --------
  r.post("/admin/sms/preview", ...adminOnly, handler(async (req, res) => {
    const { audience, body } = parseBody(PreviewBody, req.body);
    res.json(await service.preview(cong(req), audience, body));
  }));

  // -------- campaigns --------
  r.get("/admin/sms/campaigns", ...adminOnly, handler(async (req, res) => {
    res.json({ data: await service.listCampaigns(cong(req)) });
  }));
  r.post("/admin/sms/campaigns", ...adminOnly, handler(async (req, res) => {
    const input = parseBody(campaignSchema, req.body);
    res.status(201).json(await service.createDraft(cong(req), requirePrincipal(req).userId, input));
  }));
  r.get("/admin/sms/campaigns/:id", ...adminOnly, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await service.report(cong(req), id));
  }));
  r.post("/admin/sms/campaigns/:id/send", ...adminOnly, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await service.send(cong(req), requirePrincipal(req).userId, id));
  }));
  r.post("/admin/sms/campaigns/:id/retry", ...adminOnly, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await service.retry(cong(req), requirePrincipal(req).userId, id));
  }));

  // -------- the delivery-report webhook --------
  //
  // Africa's Talking POSTs x-www-form-urlencoded, unsigned. Their retrier
  // treats any non-2xx as "try again", so unknown ids get a 200 with
  // matched:false — we log, they stop. The callback URL is configured in the
  // AT dashboard (SMS → callbacks) and must point here.
  r.post(
    "/webhooks/at/delivery",
    urlencoded({ extended: false, limit: "10kb" }),
    rateLimit({ store: rl, name: "at-dlr", capacity: 300, refillPerSec: 10 }),
    handler(async (req, res) => {
      const b = req.body as Record<string, unknown>;
      const id = typeof b.id === "string" ? b.id : "";
      const status = typeof b.status === "string" ? b.status : "";
      const failureReason = typeof b.failureReason === "string" && b.failureReason ? b.failureReason : null;
      if (!id || !status) {
        res.status(400).json({ error: { code: "VALIDATION_FAILED", message: "id and status are required" } });
        return;
      }
      const matched = await service.recordDeliveryReport(id, status, failureReason);
      if (!matched) ctx.log.warn({ at_message_id: id, status }, "delivery report for a message we did not send");
      res.json({ matched });
    }),
  );

  return r;
}
