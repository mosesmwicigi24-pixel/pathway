// Server-only provider. This module deliberately does not expose an HTTP route:
// callers must first enforce content access and usage limits.
export class NarrationProviderError extends Error {
  constructor(readonly reason: "invalid_input" | "unavailable" | "invalid_audio") {
    super(`Narration ${reason}`);
  }
}

export class ElevenLabsNarrationProvider {
  constructor(
    private readonly apiKey: string,
    private readonly voiceId: string,
    private readonly modelId = "eleven_multilingual_v2",
    private readonly request: typeof fetch = fetch,
  ) {
    if (!apiKey.trim() || !/^[A-Za-z0-9_-]{1,100}$/.test(voiceId) || !/^[A-Za-z0-9_-]{1,100}$/.test(modelId)) {
      throw new NarrationProviderError("invalid_input");
    }
  }

  async synthesize(text: string): Promise<Uint8Array> {
    if (!text.trim() || text.length > 5000) throw new NarrationProviderError("invalid_input");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await this.request(`https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`, {
        method: "POST",
        // Do not forward the provider credential through an HTTP redirect.
        redirect: "error",
        headers: { "xi-api-key": this.apiKey, "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: this.modelId }),
        signal: controller.signal,
      });
      if (!response.ok) {
        controller.abort();
        throw new NarrationProviderError("unavailable");
      }
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "audio/mpeg" || !response.body) {
        controller.abort();
        throw new NarrationProviderError("invalid_audio");
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 10 * 1024 * 1024) {
            controller.abort();
            throw new NarrationProviderError("invalid_audio");
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      if (!size) throw new NarrationProviderError("invalid_audio");
      const audio = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        audio.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return audio;
    } catch (error) {
      if (error instanceof NarrationProviderError) throw error;
      throw new NarrationProviderError("unavailable");
    } finally {
      clearTimeout(timeout);
    }
  }
}
