// Module: activity (member-facing usage telemetry).
// Captures app-area dwell time (parity gap #3) batched from the mobile/iPad
// client. Auth required; the principal's own user_id is always used — the body
// carries no user id. Best-effort: malformed rows are clamped/skipped in the
// service, the endpoint returns { accepted } and never 500s on bad telemetry.
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { ActivityService } from "./service.js";

const ScreensBody = z.object({
  events: z
    .array(
      z.object({
        screen: z.string().min(1).max(40),
        duration_ms: z.number().int().min(0).max(86_400_000),
        occurred_at: z.string().datetime({ offset: true }),
        client_event_id: z.string().uuid(),
      }),
    )
    .min(1)
    .max(200),
});

export const activityRouter: Router = Router();

export function registerActivity(ctx: AppContext): Router {
  const svc = new ActivityService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const r = activityRouter;

  // ---- Member: batch-submit app-area dwell events (idempotent replay) ----
  r.post("/me/activity/screens", auth, handler(async (req, res) => {
    const { events } = parseBody(ScreensBody, req.body);
    const accepted = await svc.recordScreens(requirePrincipal(req).userId, events);
    res.json({ accepted });
  }));

  return r;
}
