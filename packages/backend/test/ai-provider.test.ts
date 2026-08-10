// AnthropicProvider — the live Claude path. This is the one provider that
// talks to a model family (Sonnet 5 / Opus 5, and the rest of the 4.6+
// family) that returns HTTP 400 for a non-default `temperature`/`top_p`/
// `top_k`. Before this test existed, every "standard"/"deep" tier call sent
// `temperature` and would have 400'd in production the moment a real
// ANTHROPIC_API_KEY was configured — only the "fast" tier (Haiku, which
// tolerates the parameter) had ever been verified live. These tests pin the
// request shape so that regression can't come back silently.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AnthropicProvider, type AiUsageEvent } from "../src/modules/assistant/provider.js";

function anthropicResponse(text: string, usage = { input_tokens: 12, output_tokens: 34 }) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: "text", text }], usage }),
    text: async () => "",
  };
}

describe("AnthropicProvider", () => {
  const models = { fast: "claude-haiku-4-5-20251001", standard: "claude-sonnet-5", deep: "claude-opus-5" };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("never sends temperature/top_p/top_k — Sonnet 5 / Opus 5 400 on non-default sampling params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(anthropicResponse("hello"));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new AnthropicProvider("test-key", models);
    await provider.complete({
      system: "sys",
      messages: [{ role: "user", text: "hi" }],
      tier: "deep",
      temperature: 0.7, // a caller tuned for Groq/Gemini — must be dropped for Anthropic
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("top_k");
    expect(body.model).toBe("claude-opus-5");
  });

  it("passes output_config.effort through when the caller sets it, and omits it otherwise", async () => {
    const fetchMock = vi.fn().mockResolvedValue(anthropicResponse("hi"));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AnthropicProvider("test-key", models);

    await provider.complete({ system: "s", messages: [{ role: "user", text: "hi" }], tier: "standard", effort: "low" });
    const body1 = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body1.output_config).toEqual({ effort: "low" });

    fetchMock.mockClear();
    await provider.complete({ system: "s", messages: [{ role: "user", text: "hi" }], tier: "fast" });
    const body2 = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body2).not.toHaveProperty("output_config");
  });

  it("retries on 429 and succeeds on the next attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "rate limited" })
      .mockResolvedValueOnce(anthropicResponse("recovered"));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AnthropicProvider("test-key", models);

    const promise = provider.complete({ system: "s", messages: [{ role: "user", text: "hi" }] });
    await vi.runAllTimersAsync();
    const text = await promise;

    expect(text).toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a plain 400 (our bug, not a transient failure) and surfaces UPSTREAM_UNAVAILABLE", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "bad request" });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AnthropicProvider("test-key", models);

    await expect(provider.complete({ system: "s", messages: [{ role: "user", text: "hi" }] })).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after exhausting retries on repeated 529 overloaded errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 529, text: async () => "overloaded" });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AnthropicProvider("test-key", models);

    const promise = provider.complete({ system: "s", messages: [{ role: "user", text: "hi" }] });
    const assertion = expect(promise).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("records a usage event with token counts and latency on success, without throwing on a bad recorder", async () => {
    const fetchMock = vi.fn().mockResolvedValue(anthropicResponse("hi", { input_tokens: 100, output_tokens: 50 }));
    vi.stubGlobal("fetch", fetchMock);
    const events: AiUsageEvent[] = [];
    const provider = new AnthropicProvider("test-key", models, (e) => {
      events.push(e);
      throw new Error("a broken recorder must never break the completion");
    });

    const text = await provider.complete({
      system: "s",
      messages: [{ role: "user", text: "hi" }],
      tier: "fast",
      feature: "unit_test",
    });

    expect(text).toBe("hi");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      feature: "unit_test",
      tier: "fast",
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      inputTokens: 100,
      outputTokens: 50,
      success: true,
    });
    expect(events[0]?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("records a failure event (with an error code) when every retry is exhausted", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" });
    vi.stubGlobal("fetch", fetchMock);
    const events: AiUsageEvent[] = [];
    const provider = new AnthropicProvider("test-key", models, (e) => events.push(e));

    const promise = provider.complete({ system: "s", messages: [{ role: "user", text: "hi" }], feature: "unit_test" });
    const assertion = expect(promise).rejects.toBeTruthy();
    await vi.runAllTimersAsync();
    await assertion;

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ feature: "unit_test", success: false });
    expect(events[0]?.errorCode).toBeTruthy();
  });
});
