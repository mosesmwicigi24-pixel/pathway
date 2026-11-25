import express from "express";
import supertest from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AppContext } from "../src/http/context.js";
import { ApiError } from "../src/http/errors.js";
import { signAccessToken } from "../src/modules/identity/tokens.js";
import { registerPlanNarration } from "../src/modules/growth-content/narration-router.js";
import { NarrationService, type NarrationDependencies } from "../src/modules/growth-content/narration-service.js";

const env = { JWT_SIGNING_KEY: "test-secret", JWT_ACCESS_TTL: 900 } as AppContext["env"];
const context = { env } as AppContext;
const id = "4c5fbfa1-d7e7-4d8f-8a89-a2970a95c904";
const path = `/growth/plans/${id}/days/1/narration/word`;
const token = signAccessToken(env, { sub: id, role: "Student", cong: null });

function app(locked = false) {
  const synthesize = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
  const deps: NarrationDependencies = {
    authorizedDays: async () => [{ day_number: 1, locked, title: "A day", segments: [] }],
    passage: vi.fn(), synthesize,
    cache: { get: async () => null, put: async () => {} },
    exclusive: async (_key, fn) => fn(), reserve: async () => true,
    voiceId: "voice", modelId: "model",
  };
  const server = express();
  server.use(registerPlanNarration(context, new NarrationService(deps)));
  server.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ApiError) res.status(error.status).json(error.toBody("test"));
    else res.status(500).end();
  });
  return { request: supertest(server), synthesize };
}

describe("protected narration routes", () => {
  it("fails closed when the provider, Redis or daily budgets are not configured", async () => {
    const server = express();
    server.use(registerPlanNarration(context));
    server.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (error instanceof ApiError) res.status(error.status).json(error.toBody("test"));
      else res.status(500).end();
    });
    const response = await supertest(server).get(path).set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("remains disabled even with credentials present until explicitly enabled", async () => {
    const server = express();
    const disabled = { ...context, redis: {}, env: { ...env, NARRATION_ENABLED: "false", ELEVENLABS_API_KEY: "test-key",
      NARRATION_GLOBAL_DAILY_CHARACTERS: 10000, NARRATION_USER_DAILY_CHARACTERS: 1000 } } as unknown as AppContext;
    server.use(registerPlanNarration(disabled));
    server.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (error instanceof ApiError) res.status(error.status).json(error.toBody("test")); else res.status(500).end();
    });
    const response = await supertest(server).get(path).set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(503);
  });

  it("requires authentication, and only POST may synthesize authorized content", async () => {
    const { request, synthesize } = app();
    expect((await request.get(path)).status).toBe(401);
    const manifest = await request.get(path).set("Authorization", `Bearer ${token}`);
    expect(manifest.status).toBe(200);
    expect(manifest.body.words).toEqual(["A day"]);
    expect(manifest.headers["cache-control"]).toBe("private, no-store");
    const audioPath = `${path}/${manifest.body.version}/0/audio`;
    expect((await request.get(audioPath).set("Authorization", `Bearer ${token}`)).status).toBe(404);
    const audio = await request.post(audioPath).set("Authorization", `Bearer ${token}`);
    expect(audio.status).toBe(200);
    expect(audio.headers["content-type"]).toMatch(/^audio\/mpeg/);
    expect(synthesize).toHaveBeenCalledWith("A day");
  });

  it("never generates locked or stale content", async () => {
    const { request, synthesize } = app(true);
    const response = await request.post(`${path}/${"a".repeat(64)}/0/audio`).set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("GATE_LOCKED");
    expect(synthesize).not.toHaveBeenCalled();
  });
});
