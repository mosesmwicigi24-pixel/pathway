import { describe, expect, it, vi } from "vitest";
import { ElevenLabsNarrationProvider } from "../src/modules/growth-content/narration-provider.js";

const voice = "nPczCjzI2devNBz1zQrb";

describe("ElevenLabsNarrationProvider", () => {
  it("sends text using the configured voice and returns audio", async () => {
    const request = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }));
    const provider = new ElevenLabsNarrationProvider("test-secret", voice, "eleven_multilingual_v2", request);
    expect(await provider.synthesize("Welcome to today's reading.")).toEqual(new Uint8Array([1, 2, 3]));
    const [url, options] = request.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`);
    expect(options.headers).toMatchObject({ "xi-api-key": "test-secret" });
    expect(JSON.parse(options.body as string)).toEqual({ text: "Welcome to today's reading.", model_id: "eleven_multilingual_v2" });
  });

  it("rejects malformed configuration and blank or excessive text before making a request", async () => {
    expect(() => new ElevenLabsNarrationProvider("key", "../voice")).toThrow();
    const request = vi.fn();
    const provider = new ElevenLabsNarrationProvider("key", voice, "model", request);
    await expect(provider.synthesize("  ")).rejects.toMatchObject({ reason: "invalid_input" });
    await expect(provider.synthesize("x".repeat(5001))).rejects.toMatchObject({ reason: "invalid_input" });
    expect(request).not.toHaveBeenCalled();
  });

  it("does not leak upstream error details or accept non-audio and empty responses", async () => {
    for (const response of [
      new Response("secret upstream details", { status: 429 }),
      new Response("not audio", { headers: { "content-type": "application/json" } }),
      new Response("not audio", { headers: { "content-type": "audio/mpeg-malicious" } }),
      new Response(null, { headers: { "content-type": "audio/mpeg" } }),
    ]) {
      const provider = new ElevenLabsNarrationProvider("key", voice, "model", vi.fn().mockResolvedValue(response));
      await expect(provider.synthesize("Hello")).rejects.toThrow(/^Narration (unavailable|invalid_audio)$/);
    }
  });

  it("rejects oversized responses and handles network errors without leaking details", async () => {
    const oversized = new Response(new Uint8Array(10 * 1024 * 1024 + 1), { headers: { "content-type": "audio/mpeg" } });
    const provider = new ElevenLabsNarrationProvider("key", voice, "model", vi.fn().mockResolvedValue(oversized));
    await expect(provider.synthesize("Hello")).rejects.toMatchObject({ reason: "invalid_audio" });
    const offline = new ElevenLabsNarrationProvider("key", voice, "model", vi.fn().mockRejectedValue(new Error("private details")));
    await expect(offline.synthesize("Hello")).rejects.toThrow("Narration unavailable");
  });

  it("aborts a request that exceeds the deadline", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }));
      const provider = new ElevenLabsNarrationProvider("key", voice, "model", request as typeof fetch);
      const result = expect(provider.synthesize("Hello")).rejects.toThrow("Narration unavailable");
      await vi.advanceTimersByTimeAsync(30_000);
      await result;
    } finally {
      vi.useRealTimers();
    }
  });
});
