// Module: growth (Design Contract Matrix B6)
// Spiritual-gifts assessment, prayer journal and verse library. Everything
// here is member-scoped — there are deliberately no admin/leader read routes
// for prayers (§5.4 pastoral privacy).
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { GrowthService } from "./service.js";
import { buildAiProvider, type AiProvider } from "../assistant/provider.js";

const IdParam = z.object({ id: z.string().uuid() });
const PlanDayParams = z.object({
  planId: z.string().uuid(),
  dayNumber: z.coerce.number().int().min(1),
});

export const growthRouter: Router = Router();

export function registerGrowth(ctx: AppContext, providerOverride?: AiProvider): Router {
  const svc = new GrowthService(ctx.db.primary, providerOverride ?? buildAiProvider(ctx.env));
  const auth = authenticate(ctx.env);
  const r = growthRouter;

  // ---- Spiritual gifts ----
  r.get("/gifts/questions", auth, handler(async (req, res) => {
    res.json(await svc.giftQuestions(requirePrincipal(req).userId));
  }));

  r.post("/gifts/assessments", auth, handler(async (req, res) => {
    const input = parseBody(GrowthService.GiftsSubmission, req.body);
    res.status(201).json(await svc.submitGifts(requirePrincipal(req).userId, input));
  }));

  r.get("/me/gifts", auth, handler(async (req, res) => {
    res.json(await svc.myGifts(requirePrincipal(req).userId));
  }));

  // ---- Prayer journal ----
  r.get("/me/prayers", auth, handler(async (req, res) => {
    res.json(await svc.myPrayers(requirePrincipal(req).userId));
  }));

  r.put("/me/prayers", auth, handler(async (req, res) => {
    const input = parseBody(GrowthService.PrayerUpsert, req.body);
    res.json(await svc.upsertPrayer(requirePrincipal(req).userId, input));
  }));

  r.delete("/me/prayers/:id", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await svc.deletePrayer(requirePrincipal(req).userId, id));
  }));

  // ---- Verse library ----
  r.get("/me/verses", auth, handler(async (req, res) => {
    res.json(await svc.myVerses(requirePrincipal(req).userId));
  }));

  r.put("/me/verses", auth, handler(async (req, res) => {
    const input = parseBody(GrowthService.VerseSave, req.body);
    res.json(await svc.saveVerse(requirePrincipal(req).userId, input));
  }));

  r.delete("/me/verses/:id", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await svc.deleteVerse(requirePrincipal(req).userId, id));
  }));

  // ---- Plan-day reflections (iOS contract — do not rename fields) ----
  r.post("/growth/plans/:planId/days/:dayNumber/reflection", auth, handler(async (req, res) => {
    const { planId, dayNumber } = parseBody(PlanDayParams, req.params);
    const input = parseBody(GrowthService.PlanDayReflection, req.body);
    res.status(201).json(await svc.upsertPlanDayReflection(requirePrincipal(req).userId, planId, dayNumber, input));
  }));

  r.get("/growth/plans/:planId/days/:dayNumber/reflection", auth, handler(async (req, res) => {
    const { planId, dayNumber } = parseBody(PlanDayParams, req.params);
    res.json(await svc.getPlanDayReflection(requirePrincipal(req).userId, planId, dayNumber));
  }));

  // ---- Talk it Over — the shared plan-day conversation ----
  r.get("/growth/plans/:planId/days/:dayNumber/talk", auth, handler(async (req, res) => {
    const { planId, dayNumber } = parseBody(PlanDayParams, req.params);
    res.json(await svc.listTalk(requirePrincipal(req).userId, planId, dayNumber));
  }));

  r.post("/growth/plans/:planId/days/:dayNumber/talk", auth, handler(async (req, res) => {
    const { planId, dayNumber } = parseBody(PlanDayParams, req.params);
    const input = parseBody(GrowthService.TalkPost, req.body);
    res.status(201).json(await svc.postTalk(requirePrincipal(req).userId, planId, dayNumber, input));
  }));

  // AI compose help — returns a SUGGESTION for the member to edit; never posts.
  r.post("/growth/plans/:planId/days/:dayNumber/talk/assist", auth, handler(async (req, res) => {
    const { planId, dayNumber } = parseBody(PlanDayParams, req.params);
    const input = parseBody(GrowthService.TalkAssist, req.body);
    res.json(await svc.assistTalk(planId, dayNumber, input));
  }));

  r.post("/growth/talk/:id/like", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await svc.toggleTalkLike(requirePrincipal(req).userId, id));
  }));

  return r;
}
