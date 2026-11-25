import { describe, expect, it, vi } from "vitest";
import { NarrationService, narrationVersion, type NarrationDependencies } from "../src/modules/growth-content/narration-service.js";

const version = narrationVersion(["A day"]);

function setup(locked = false) {
  const cache = new Map<string, Uint8Array>();
  const deps: NarrationDependencies = {
    authorizedDays: vi.fn().mockResolvedValue([{ day_number: 1, locked, title: "A day", segments: [] }]),
    passage: vi.fn(),
    synthesize: vi.fn().mockResolvedValue(new Uint8Array([1, 2])),
    cache: { get: vi.fn(async (key) => cache.get(key) ?? null), put: vi.fn(async (key, value) => { cache.set(key, value); }) },
    exclusive: async (_key, operation) => operation(),
    reserve: vi.fn().mockResolvedValue(true), voiceId: "voice", modelId: "model",
  };
  return { deps, service: new NarrationService(deps) };
}

describe("narration service", () => {
  it("rechecks access on cache hits and bills only for an uncached paragraph", async () => {
    const { deps, service } = setup();
    expect(await service.audio("member", "plan", 1, "word", 0, version)).toEqual(new Uint8Array([1, 2]));
    expect(await service.audio("member", "plan", 1, "word", 0, version)).toEqual(new Uint8Array([1, 2]));
    expect(deps.authorizedDays).toHaveBeenCalledTimes(2);
    expect(deps.reserve).toHaveBeenCalledTimes(1);
    expect(deps.synthesize).toHaveBeenCalledTimes(1);
    vi.mocked(deps.authorizedDays).mockResolvedValue([{ day_number: 1, locked: true, title: "A day", segments: [] }]);
    await expect(service.audio("member", "plan", 1, "word", 0, version)).rejects.toThrow("Narration source locked");
  });

  it("rejects invalid indexes and quota failures before contacting the provider", async () => {
    const { deps, service } = setup();
    await expect(service.audio("member", "plan", 1, "word", -1, version)).rejects.toMatchObject({ reason: "invalid_index" });
    await expect(service.audio("member", "plan", 1, "word", 0, "old")).rejects.toMatchObject({ reason: "stale" });
    vi.mocked(deps.reserve).mockResolvedValue(false);
    await expect(service.audio("member", "plan", 1, "word", 0, version)).rejects.toMatchObject({ reason: "quota" });
    expect(deps.synthesize).not.toHaveBeenCalled();
  });

  it("fails closed when the quota store is unavailable", async () => {
    const { deps, service } = setup();
    vi.mocked(deps.reserve).mockRejectedValue(new Error("quota unavailable"));
    await expect(service.audio("member", "plan", 1, "word", 0, version)).rejects.toThrow("quota unavailable");
    expect(deps.synthesize).not.toHaveBeenCalled();
  });
});
