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

export const intelligenceRouter: Router = Router();

export function registerIntelligence(ctx: AppContext, providerOverride?: AiProvider): Router {
  const provider = providerOverride ?? buildAiProvider(ctx.env);
  const content = new ContentIndexService(ctx.db.primary);
  const story = new StoryService(ctx.db.primary, provider);
  const letters = new LettersService(ctx.db.primary, provider, story, content, new NotificationService(ctx.db.primary));
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

  return r;
}
