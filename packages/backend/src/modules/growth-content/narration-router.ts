import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate } from "../../http/auth.js";
import { ApiError } from "../../http/errors.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { buildScriptureProvider, ScriptureService } from "../curriculum/scripture.js";
import { GrowthContentService } from "./service.js";
import { ElevenLabsNarrationProvider } from "./narration-provider.js";
import { RedisNarrationQuota } from "./narration-quota.js";
import { withNarrationLock } from "./narration-lock.js";
import { NarrationService, NarrationServiceError, narrationVersion } from "./narration-service.js";
import { NarrationSourceError } from "./narration-source.js";

const Params = z.object({ id: z.string().uuid(), day: z.coerce.number().int().min(1).max(366), part: z.enum(["word", "respond"]) });
const Index = z.object({ index: z.coerce.number().int().min(0).max(99), version: z.string().regex(/^[a-f0-9]{64}$/) });
const Day = z.object({
  day_number: z.number().int(), locked: z.boolean(), title: z.string().nullable(),
  segments: z.array(z.object({ sort: z.number(), kind: z.string(), title: z.string(), reference: z.string().nullable(), content: z.string().nullable() })),
});

export function registerPlanNarration(ctx: AppContext, injected?: NarrationService): Router {
  const router = Router();
  const auth = authenticate(ctx.env);
  const { ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL_ID,
    NARRATION_GLOBAL_DAILY_CHARACTERS, NARRATION_USER_DAILY_CHARACTERS } = ctx.env;
  const redis = ctx.redis;
  let service: NarrationService | undefined = injected;
  if (!service && redis && ELEVENLABS_API_KEY && NARRATION_GLOBAL_DAILY_CHARACTERS && NARRATION_USER_DAILY_CHARACTERS) {
    const quota = new RedisNarrationQuota(redis, NARRATION_GLOBAL_DAILY_CHARACTERS, NARRATION_USER_DAILY_CHARACTERS);
    const provider = new ElevenLabsNarrationProvider(ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL_ID);
    const scripture = new ScriptureService(buildScriptureProvider(ctx.env), ctx.env.YOUVERSION_LANGUAGE_RANGES, redis);
    const growth = new GrowthContentService(ctx.db.primary);
    service = new NarrationService({
      voiceId: ELEVENLABS_VOICE_ID, modelId: ELEVENLABS_MODEL_ID,
      authorizedDays: async (userId, planId) => z.object({ days: z.array(Day) }).parse(await growth.planDetail(userId, planId)).days,
      passage: async (reference) => (await scripture.passage(reference)).text,
      synthesize: (text) => provider.synthesize(text),
      reserve: (userId, count) => quota.reserve(userId, count),
      exclusive: (key, operation) => withNarrationLock(redis, key, operation),
      cache: {
        get: (key) => redis.getBuffer(key),
        put: async (key, bytes) => { await redis.set(key, Buffer.from(bytes), "EX", 7 * 86400); },
      },
    });
  }
  function configured(): NarrationService {
    if (!service) throw new ApiError("UPSTREAM_UNAVAILABLE", "Plan narration is unavailable");
    return service;
  }
  async function execute<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof NarrationSourceError) {
        if (error.reason === "locked") throw new ApiError("GATE_LOCKED", "This day is locked");
        throw new ApiError("NOT_FOUND", "Reading unavailable");
      }
      if (error instanceof NarrationServiceError && error.reason === "invalid_index") throw new ApiError("NOT_FOUND", "Paragraph unavailable");
      if (error instanceof NarrationServiceError && error.reason === "stale") throw new ApiError("VERSION_STALE", "This reading has changed");
      if (error instanceof NarrationServiceError && error.reason === "quota") throw new ApiError("RATE_LIMITED", "Narration is unavailable right now");
      throw new ApiError("UPSTREAM_UNAVAILABLE", "Plan narration is unavailable");
    }
  }
  const path = "/growth/plans/:id/days/:day/narration/:part";
  router.get(path, auth, handler(async (req, res) => {
    const p = parseBody(Params, req.params);
    const words = await execute(() => configured().script(requirePrincipal(req).userId, p.id, p.day, p.part));
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ words, version: narrationVersion(words) });
  }));
  router.post(`${path}/:version/:index/audio`, auth, handler(async (req, res) => {
    const p = parseBody(Params, req.params);
    const { index, version } = parseBody(Index, req.params);
    const bytes = await execute(() => configured().audio(requirePrincipal(req).userId, p.id, p.day, p.part, index, version));
    res.setHeader("Cache-Control", "private, no-store");
    res.type("audio/mpeg").send(Buffer.from(bytes));
  }));
  return router;
}
