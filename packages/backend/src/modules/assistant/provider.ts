// Nuru AI provider abstraction. The assistant logic depends only on this
// interface, so the suite runs with no network/secret (FakeAiProvider) and the
// church can swap providers without touching the module. Default real provider is
// Google Gemini (free tier via Google AI Studio); the API key lives server-side
// only (§5.10) and is never shipped to the mobile app.
import { ApiError } from "../../http/errors.js";
import type { Env } from "../../config/env.js";

export interface AiTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AiCompletion {
  system: string;
  messages: AiTurn[];
  /** Cost/quality tier — mapped to a concrete model by providers that support
   *  it (Anthropic). "fast" = cheap batch work (nightly story narratives),
   *  "standard" = daily member-facing generation (companion chat), "deep" =
   *  the weekly Sunday Letter. Providers without tiers ignore it. */
  tier?: "fast" | "standard" | "deep";
  maxTokens?: number;
  temperature?: number;
}

export interface AiProvider {
  readonly name: string;
  complete(input: AiCompletion): Promise<string>;
}

/** Anthropic (Claude) — the preferred provider. Tiered models keep the nightly
 *  batch cheap while the weekly letter gets the strongest writer. Plain fetch
 *  (no SDK): one dependency fewer, explicit timeout, transparent errors. */
class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  constructor(
    private readonly apiKey: string,
    private readonly models: { fast: string; standard: string; deep: string },
  ) {}

  async complete(input: AiCompletion): Promise<string> {
    const model = this.models[input.tier ?? "standard"];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          system: input.system,
          messages: input.messages.map((m) => ({ role: m.role, content: m.text })),
          max_tokens: input.maxTokens ?? 600,
          temperature: input.temperature ?? 0.6,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error(`[nuru-ai] anthropic ${res.status}: ${detail.slice(0, 300)}`);
        throw new ApiError("UPSTREAM_UNAVAILABLE", "The assistant is unavailable right now");
      }
      const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const text = json.content
        ?.filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("")
        .trim();
      if (!text) throw new ApiError("UPSTREAM_UNAVAILABLE", "The assistant had nothing to say");
      return text;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError("UPSTREAM_UNAVAILABLE", "The assistant is unavailable right now");
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Google Gemini (generativelanguage REST). Maps assistant→model roles. */
class GeminiProvider implements AiProvider {
  readonly name = "gemini";
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async complete(input: AiCompletion): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const body = {
      systemInstruction: { parts: [{ text: input.system }] },
      contents: input.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.text }],
      })),
      generationConfig: { maxOutputTokens: input.maxTokens ?? 600, temperature: input.temperature ?? 0.6 },
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error(`[nuru-ai] gemini ${res.status}: ${detail.slice(0, 300)}`);
        throw new ApiError("UPSTREAM_UNAVAILABLE", "The assistant is unavailable right now");
      }
      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
      if (!text) throw new ApiError("UPSTREAM_UNAVAILABLE", "The assistant had nothing to say");
      return text;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError("UPSTREAM_UNAVAILABLE", "The assistant is unavailable right now");
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Groq (OpenAI-compatible chat completions). Genuinely free tier, very fast,
 *  hosts open models (Llama 3.3). System prompt rides as a system message. */
class GroqProvider implements AiProvider {
  readonly name = "groq";
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async complete(input: AiCompletion): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: input.system },
            ...input.messages.map((m) => ({ role: m.role, content: m.text })),
          ],
          max_tokens: input.maxTokens ?? 600,
          temperature: input.temperature ?? 0.6,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error(`[nuru-ai] groq ${res.status}: ${detail.slice(0, 300)}`);
        throw new ApiError("UPSTREAM_UNAVAILABLE", "The assistant is unavailable right now");
      }
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = json.choices?.[0]?.message?.content?.trim();
      if (!text) throw new ApiError("UPSTREAM_UNAVAILABLE", "The assistant had nothing to say");
      return text;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError("UPSTREAM_UNAVAILABLE", "The assistant is unavailable right now");
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Deterministic offline responder — used ONLY when no API key is configured
 * (local dev + the test suite). With a key set we never fall back to this, so the
 * assistant returns real model output (or a surfaced error), never canned text.
 */
export class FakeAiProvider implements AiProvider {
  readonly name = "fake";
  complete(input: AiCompletion): Promise<string> {
    // Intelligence-layer prompts get deterministic, contract-shaped outputs so
    // the letter parser + story pipeline are testable offline.
    if (/sunday letter/i.test(input.system)) {
      return Promise.resolve(
        "Scripture: Philippians 1:6\n\nDear friend, I watched your week — the lessons you finished and the quiet days too. He who began a good work in you will carry it on to completion. Keep walking; your cell is walking with you.\n— Nuru Place",
      );
    }
    if (/emotion classifier/i.test(input.system)) {
      const text = [...input.messages].reverse().find((m) => m.role === "user")?.text ?? "";
      if (/suicid|kill myself|end my life|no reason to live|want to die/i.test(text)) {
        return Promise.resolve('{"tone":"despairing","summary":"They expressed deep despair about living.","crisis":true}');
      }
      if (/(tired|weary|heavy|exhausted|struggle|struggling)/i.test(text)) {
        return Promise.resolve('{"tone":"weary","summary":"They sound stretched thin but are pressing on.","crisis":false}');
      }
      return Promise.resolve('{"tone":"thankful","summary":"They are grateful for what God is doing.","crisis":false}');
    }
    if (/flock brief/i.test(input.system)) {
      return Promise.resolve(
        "Your flock held steady this week. Celebrate: Ada Grace finished another module. Watch: one member's rhythm slipped. Reach out first: the member carrying the heaviest signal — a simple 'thinking of you, can we talk this week?' opener.",
      );
    }
    if (/pastoral memory/i.test(input.system)) {
      return Promise.resolve(
        "They are walking steadily through their current level, showing up most days, and their recent reflections carry a hunger to grow. This season they may need encouragement to keep their prayer rhythm.",
      );
    }
    const last = [...input.messages].reverse().find((m) => m.role === "user")?.text ?? "";
    const t = last.toLowerCase();
    if (/(summar|cohort|catch|recap)/.test(t)) {
      return Promise.resolve(
        "Here's the gist of your cohort: reflections are due soon, there's an open thread to weigh in on, and a couple of people asked for prayer. Want me to draft your reflection?",
      );
    }
    if (/(encourage|draft|message|write|reply)/.test(t)) {
      return Promise.resolve(
        'How about: "Thinking of you today — may you sense God\'s nearness and strength. You\'re not walking this alone." Want me to send it to someone?',
      );
    }
    if (/(pray|prayer)/.test(t)) {
      return Promise.resolve(
        "I found an active prayer request worth joining today. Tap 🙏 on the Prayer Wall to stand with them.",
      );
    }
    if (/(quiet time|plan|devotion|read|rhythm)/.test(t)) {
      return Promise.resolve(
        "Let's build a gentle rhythm: 5 minutes of stillness, today's Psalm, and one verse to carry. Shall I add a morning reminder?",
      );
    }
    return Promise.resolve("I'm here with you ✨ Tell me a little more so I can help — summarize a chat, draft an encouragement, or plan your quiet time.");
  }
}

export function buildAiProvider(env: Env): AiProvider {
  // Prefer Anthropic (Claude — tiered models power the intelligence layer),
  // then Groq (free), then Gemini. When a key is configured we use the LIVE
  // provider directly — a failure surfaces as an error (and is logged), rather
  // than silently degrading to canned text. The offline responder is used only
  // when no key is set (local dev / tests).
  if (env.ANTHROPIC_API_KEY) {
    return new AnthropicProvider(env.ANTHROPIC_API_KEY, {
      fast: env.ANTHROPIC_MODEL_FAST,
      standard: env.ANTHROPIC_MODEL,
      deep: env.ANTHROPIC_MODEL_DEEP,
    });
  }
  if (env.GROQ_API_KEY) return new GroqProvider(env.GROQ_API_KEY, env.GROQ_MODEL);
  if (env.GEMINI_API_KEY) return new GeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL);
  return new FakeAiProvider();
}
