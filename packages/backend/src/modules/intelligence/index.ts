// Module: intelligence — Phase 1 of the AI layer ("one brain, many hands").
// Member-facing: the Sunday Letter + the AI-personalization consent switch.
// Admin-facing (Admin+): manual triggers for reindex / story rebuild / letter
// run so a SuperAdmin can fire the pipeline without waiting for the crons.
// The AI provider stays server-side (§5.10); AI never gates, scores, advances,
// or touches money (§1.1, §1.9) — it only ever writes words.
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { buildAiProvider, type AiProvider } from "../assistant/provider.js";
import { NotificationService } from "../notifications/service.js";
import { ContentIndexService } from "./content.js";
import { StoryService } from "./story.js";
import { LettersService } from "./letters.js";
import { SignalsService } from "./signals.js";
import { LearningService, EXPLAIN_STYLES, type ExplainStyle } from "./learning.js";
import { LiturgyService } from "./liturgy.js";
import { CommunityService, type BlessingKind } from "./community.js";
import { EchoesService } from "./echoes.js";
import { ApiError } from "../../http/errors.js";

export const intelligenceRouter: Router = Router();

export function registerIntelligence(ctx: AppContext, providerOverride?: AiProvider): Router {
  const provider = providerOverride ?? buildAiProvider(ctx.env);
  const content = new ContentIndexService(ctx.db.primary);
  const story = new StoryService(ctx.db.primary, provider);
  const notifications = new NotificationService(ctx.db.primary);
  const letters = new LettersService(ctx.db.primary, provider, story, content, notifications);
  const signals = new SignalsService(ctx.db.primary, provider, story, notifications);
  const learning = new LearningService(ctx.db.primary, provider);
  const liturgy = new LiturgyService(ctx.db.primary, provider);
  const community = new CommunityService(ctx.db.primary, notifications);
  const echoes = new EchoesService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const r = intelligenceRouter;

  // --- Sunday Letters (member) ---
  r.get("/me/letters", auth, handler(async (req, res) => {
    res.json({ data: await letters.list(requirePrincipal(req).userId) });
  }));

  r.get("/me/letters/latest", auth, handler(async (req, res) => {
    res.json({ letter: await letters.latest(requirePrincipal(req).userId) });
  }));

  r.post("/me/letters/:id/read", auth, handler(async (req, res) => {
    res.json(await letters.markRead(requirePrincipal(req).userId, String(req.params.id ?? "")));
  }));

  // --- AI personalization consent (the covenant switch) ---
  r.get("/me/ai", auth, handler(async (req, res) => {
    const row = await ctx.db.primary.query(`SELECT ai_opt_out FROM users WHERE user_id = $1`, [
      requirePrincipal(req).userId,
    ]);
    res.json({ opt_out: row.rows[0]?.ai_opt_out === true });
  }));

  r.post("/me/ai/consent", auth, handler(async (req, res) => {
    const input = parseBody(z.object({ opt_out: z.boolean() }), req.body ?? {});
    const userId = requirePrincipal(req).userId;
    await ctx.db.primary.query(`UPDATE users SET ai_opt_out = $2, updated_at = now() WHERE user_id = $1`, [
      userId,
      input.opt_out,
    ]);
    // Opting out withdraws the written-content grounding immediately: drop the
    // story (a future rebuild recreates facts-only, narrative empty).
    if (input.opt_out) await ctx.db.primary.query(`DELETE FROM member_story WHERE user_id = $1`, [userId]);
    res.json({ opt_out: input.opt_out });
  }));

  // --- Admin triggers (Admin+; the crons call the same services) ---
  r.post("/admin/intelligence/reindex", auth, requireRole("Admin"), handler(async (_req, res) => {
    res.json(await content.reindexAll());
  }));

  r.post("/admin/intelligence/stories/rebuild", auth, requireRole("Admin"), handler(async (req, res) => {
    const input = parseBody(z.object({ user_id: z.string().uuid().optional() }), req.body ?? {});
    if (input.user_id) {
      const row = await story.rebuildFor(input.user_id);
      res.json({ rebuilt: row ? 1 : 0 });
      return;
    }
    res.json(await story.rebuildAll());
  }));

  r.post("/admin/intelligence/letters/run", auth, requireRole("Admin"), handler(async (req, res) => {
    const input = parseBody(z.object({ user_id: z.string().uuid().optional() }), req.body ?? {});
    res.json(await letters.runWeekly(input.user_id ? { userIds: [input.user_id] } : {}));
  }));

  // --- Shepherd's Pulse (Phase 2): leader-scoped signals + the Flock Brief ---
  r.get("/admin/intelligence/signals", auth, requireRole("Instructor"), handler(async (req, res) => {
    const since = Math.min(Math.max(Number(req.query.since_days ?? 14) || 14, 1), 60);
    res.json({ data: await signals.listFor(requirePrincipal(req), since) });
  }));

  r.post("/admin/intelligence/signals/:id/ack", auth, requireRole("Instructor"), handler(async (req, res) => {
    res.json(await signals.acknowledge(requirePrincipal(req), String(req.params.id ?? "")));
  }));

  r.get("/admin/intelligence/flock-brief", auth, requireRole("Instructor"), handler(async (req, res) => {
    res.json({ brief: await signals.myBrief(requirePrincipal(req).userId) });
  }));

  r.post("/admin/intelligence/signals/scan", auth, requireRole("Admin"), handler(async (_req, res) => {
    res.json(await signals.runNightly());
  }));

  r.post("/admin/intelligence/flock-brief/run", auth, requireRole("Admin"), handler(async (_req, res) => {
    res.json(await signals.composeBriefs());
  }));

  // --- Living curriculum (Phase 3) ---
  r.get("/modules/:id/explain", auth, handler(async (req, res) => {
    const style = String(req.query.style ?? "simple") as ExplainStyle;
    if (!EXPLAIN_STYLES.includes(style)) throw new ApiError("VALIDATION_FAILED", "style must be simple | swahili | story");
    res.json(await learning.explain(requirePrincipal(req).userId, String(req.params.id ?? ""), style));
  }));

  r.post("/modules/:id/quiz/remediation", auth, handler(async (req, res) => {
    res.json(await learning.remediate(requirePrincipal(req).userId, String(req.params.id ?? "")));
  }));

  r.get("/growth/memory-verses/due", auth, handler(async (req, res) => {
    res.json({ data: await learning.dueVerses(requirePrincipal(req).userId) });
  }));

  // --- The liturgy Home + community intelligence (Phase 4) ---
  r.get("/home/echo", auth, handler(async (req, res) => {
    res.json({ echo: await echoes.today(requirePrincipal(req).userId) });
  }));

  r.get("/home/liturgy", auth, handler(async (req, res) => {
    const me = await ctx.db.primary.query(`SELECT congregation_id FROM users WHERE user_id = $1`, [
      requirePrincipal(req).userId,
    ]);
    res.json(await liturgy.current(me.rows[0]?.congregation_id ?? null));
  }));

  r.get("/community/moments", auth, handler(async (req, res) => {
    res.json({ data: await community.list(requirePrincipal(req).userId) });
  }));

  r.post("/community/moments/:id/bless", auth, handler(async (req, res) => {
    const input = parseBody(z.object({ kind: z.enum(["amen", "heart", "fire"]) }), req.body ?? {});
    res.json(await community.bless(requirePrincipal(req).userId, String(req.params.id ?? ""), input.kind as BlessingKind));
  }));

  r.post("/admin/intelligence/liturgy/run", auth, requireRole("Admin"), handler(async (_req, res) => {
    res.json({ composed: await liturgy.composeAll() });
  }));

  r.post("/admin/intelligence/moments/scan", auth, requireRole("Admin"), handler(async (_req, res) => {
    res.json({ inserted: await community.scanMoments() });
  }));

  return r;
}
