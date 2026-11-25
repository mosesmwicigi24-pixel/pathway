import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import Redis from "ioredis";
import { RedisNarrationQuota } from "../src/modules/growth-content/narration-quota.js";
import { withNarrationLock } from "../src/modules/growth-content/narration-lock.js";
import { NarrationService, narrationVersion } from "../src/modules/growth-content/narration-service.js";

// The app does not require Redis for its ordinary tests; exercise the real
// atomic scripts when the optional redis-server binary is available.
describe.skipIf(spawnSync("redis-server", ["--version"], { stdio: "ignore" }).status !== 0)("distributed narration quota", () => {
  let dir: string;
  let server: ChildProcess;
  let redis: Redis;
  beforeAll(async () => {
    // macOS limits Unix-domain socket names to 103 bytes; its normal TMPDIR
    // is already long enough to exceed that limit after adding our suffix.
    dir = await mkdtemp(join("/tmp", "nuru-redis-"));
    const socket = join(dir, "redis.sock");
    server = spawn("redis-server", ["--port", "0", "--unixsocket", socket, "--save", "", "--appendonly", "no"], { stdio: "ignore" });
    redis = new Redis(socket, { retryStrategy: (attempt) => attempt <= 30 ? 20 : null });
    redis.on("error", () => { /* startup retries; the end event reports failure */ });
    await new Promise<void>((resolve, reject) => {
      redis.once("ready", resolve);
      redis.once("end", () => reject(new Error("Redis did not start")));
      server.once("error", reject);
    });
  });
  afterAll(async () => {
    if (redis) redis.disconnect();
    if (server) server.kill();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("atomically enforces both budgets under concurrent requests", async () => {
    const quota = new RedisNarrationQuota(redis, 100, 50);
    const results = await Promise.all(Array.from({ length: 20 }, () => quota.reserve("member-a", 10)));
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(await quota.reserve("member-b", 50)).toBe(true);
    expect(await quota.reserve("member-c", 1)).toBe(false);
  });

  it("rejects invalid reservations without changing budgets", async () => {
    const quota = new RedisNarrationQuota(redis, 100, 50);
    await expect(quota.reserve("member", 0)).rejects.toThrow("Invalid narration quota request");
    await expect(quota.reserve("", 10)).rejects.toThrow("Invalid narration quota request");
    expect(() => new RedisNarrationQuota(redis, 0, 50)).toThrow();
  });

  it("serializes cache misses and releases the lock on failure", async () => {
    let active = 0;
    let peak = 0;
    const operation = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
    };
    await Promise.all([withNarrationLock(redis, "audio", operation), withNarrationLock(redis, "audio", operation)]);
    expect(peak).toBe(1);
    await expect(withNarrationLock(redis, "audio", async () => { throw new Error("failure"); })).rejects.toThrow("failure");
    await expect(withNarrationLock(redis, "audio", async () => "ok")).resolves.toBe("ok");
  });

  it("generates identical simultaneous requests only once", async () => {
    let generations = 0;
    let cached: Uint8Array | null = null;
    const service = new NarrationService({
      voiceId: "voice", modelId: "model",
      authorizedDays: async () => [{ day_number: 1, locked: false, title: "One", segments: [] }],
      passage: async () => "",
      synthesize: async () => { generations++; await new Promise((resolve) => setTimeout(resolve, 20)); return new Uint8Array([1]); },
      cache: { get: async () => cached, put: async (_key, value) => { cached = value; } },
      exclusive: (key, op) => withNarrationLock(redis, key, op),
      reserve: async () => true,
    });
    const version = narrationVersion(["One"]);
    const results = await Promise.all(Array.from({ length: 4 }, (_, i) => service.audio(`user-${i}`, "plan", 1, "word", 0, version)));
    expect(results).toHaveLength(4);
    expect(generations).toBe(1);
  });
});
