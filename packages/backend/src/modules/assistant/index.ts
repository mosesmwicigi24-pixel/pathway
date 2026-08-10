// Module: assistant — the Nuru AI companion proxy (mobile make). One member-
// facing endpoint; the provider (Gemini free tier, or the offline fake) is
// resolved from env so the key stays server-side (§5.10).
import { Router } from "express";
import type { AppContext } from "../../http/context.js";
import { authenticate } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { AssistantService } from "./service.js";
import { buildAiProvider, type AiProvider } from "./provider.js";
import { AiUsageService } from "./usage.js";
import { ChatService } from "../chat/service.js";
import { StoryService } from "../intelligence/story.js";
import { ContentIndexService } from "../intelligence/content.js";

export const assistantRouter: Router = Router();

export function registerAssistant(ctx: AppContext, providerOverride?: AiProvider): Router {
  const usage = new AiUsageService(ctx.db.primary);
  const provider = providerOverride ?? buildAiProvider(ctx.env, usage.recorder());
  // Story-aware grounding (intelligence layer): the member's own story + the
  // church's own teaching, injected so Nuru remembers who it is walking with.
  const story = new StoryService(ctx.db.primary, provider);
  const content = new ContentIndexService(ctx.db.primary);
  const svc = new AssistantService(ctx.db.primary, provider, new ChatService(ctx.db.primary), {
    forUser: (userId) => story.forCompanion(userId),
    search: (q, k) => content.search(q, k),
  });
  const auth = authenticate(ctx.env);
  const r = assistantRouter;

  r.post("/assistant/chat", auth, handler(async (req, res) => {
    const input = parseBody(AssistantService.Chat, req.body);
    res.json(await svc.chat(requirePrincipal(req).userId, input));
  }));

  // The member's persisted Nuru thread (retrieval + persistence across sessions).
  r.get("/assistant/history", auth, handler(async (req, res) => {
    res.json(await svc.history(requirePrincipal(req).userId));
  }));

  return r;
}
