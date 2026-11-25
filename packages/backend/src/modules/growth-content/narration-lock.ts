import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

/** Coalesce concurrent cache misses across processes, with bounded waiting.
 * The lock is longer than the provider timeout and is removed only by its owner. */
export async function withNarrationLock<T>(redis: Redis, key: string, operation: () => Promise<T>): Promise<T> {
  const lock = `${key}:lock`;
  const owner = randomUUID();
  const deadline = Date.now() + 35_000;
  do {
    if (await redis.set(lock, owner, "PX", 45_000, "NX") === "OK") {
      try { return await operation(); } finally { await redis.eval(RELEASE, 1, lock, owner); }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
  throw new Error("Narration generation busy");
}
