import { beforeEach, describe, expect, it, vi } from "vitest";

describe("optional narration configuration", () => {
  beforeEach(() => vi.resetModules());
  const base = { DATABASE_URL: "postgres://localhost/nuru", JWT_SIGNING_KEY: "test-key" };

  it("boots with blank optional deployment values and keeps narration disabled", async () => {
    const { loadEnv } = await import("../src/config/env.js");
    const env = loadEnv({ ...base, ELEVENLABS_API_KEY: "", NARRATION_GLOBAL_DAILY_CHARACTERS: "", NARRATION_USER_DAILY_CHARACTERS: "" });
    expect(env.ELEVENLABS_API_KEY).toBeUndefined();
    expect(env.NARRATION_GLOBAL_DAILY_CHARACTERS).toBeUndefined();
    expect(env.NARRATION_ENABLED).toBe("false");
    expect(env.ELEVENLABS_VOICE_ID).toBe("nPczCjzI2devNBz1zQrb");
  });

  it("rejects invalid budgets rather than starting without a spending bound", async () => {
    const { loadEnv } = await import("../src/config/env.js");
    expect(() => loadEnv({ ...base, NARRATION_GLOBAL_DAILY_CHARACTERS: "0" })).toThrow("NARRATION_GLOBAL_DAILY_CHARACTERS");
  });
});
