import { createHash } from "node:crypto";
import { narrationBlocks, type NarrationDay } from "./narration-source.js";
import { narrationScript } from "./narration-script.js";

export interface NarrationDependencies {
  // This must load the viewer's actual gated plan detail on EVERY call,
  // including cache hits. It must never use a client-provided plan body.
  authorizedDays(userId: string, planId: string): Promise<NarrationDay[]>;
  passage(reference: string): Promise<string>;
  synthesize(text: string): Promise<Uint8Array>;
  cache: { get(key: string): Promise<Uint8Array | null>; put(key: string, value: Uint8Array): Promise<void> };
  exclusive<T>(key: string, operation: () => Promise<T>): Promise<T>;
  // A distributed, atomic quota is mandatory; fail closed if unavailable.
  reserve(userId: string, characters: number): Promise<boolean>;
  voiceId: string;
  modelId: string;
}

export function narrationVersion(script: string[]): string {
  return createHash("sha256").update(JSON.stringify(script)).digest("hex");
}

export class NarrationServiceError extends Error {
  constructor(readonly reason: "invalid_index" | "too_large" | "quota" | "stale") { super(`Narration ${reason}`); }
}

export class NarrationService {
  constructor(private readonly deps: NarrationDependencies) {}

  async script(userId: string, planId: string, dayNumber: number, part: "word" | "respond"): Promise<string[]> {
    const days = await this.deps.authorizedDays(userId, planId);
    const blocks = narrationBlocks(days, dayNumber, part);
    const script = await narrationScript(blocks, this.deps.passage);
    if (script.length === 0 || script.length > 100) throw new NarrationServiceError("too_large");
    return script;
  }

  async audio(userId: string, planId: string, dayNumber: number, part: "word" | "respond", index: number, version: string): Promise<Uint8Array> {
    const script = await this.script(userId, planId, dayNumber, part);
    if (version !== narrationVersion(script)) throw new NarrationServiceError("stale");
    if (!Number.isSafeInteger(index) || index < 0 || index >= script.length) throw new NarrationServiceError("invalid_index");
    const text = script[index];
    if (!text) throw new NarrationServiceError("invalid_index");
    // The key contains no member identity or raw text, and changes when the
    // content, model or voice changes. It must never bypass authorization.
    const digest = createHash("sha256").update(JSON.stringify([this.deps.voiceId, this.deps.modelId, text])).digest("hex");
    const key = `plan-narration:v1:${digest}`;
    const cached = await this.deps.cache.get(key);
    if (cached?.byteLength) return cached;
    return this.deps.exclusive(key, async () => {
      const afterLock = await this.deps.cache.get(key);
      if (afterLock?.byteLength) return afterLock;
      if (!await this.deps.reserve(userId, text.length)) throw new NarrationServiceError("quota");
      const audio = await this.deps.synthesize(text);
      if (!audio.byteLength) throw new Error("Narration returned empty audio");
      await this.deps.cache.put(key, audio);
      return audio;
    });
  }
}
