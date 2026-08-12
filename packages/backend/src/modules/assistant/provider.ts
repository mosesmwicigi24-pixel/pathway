// Nuru AI provider abstraction. The assistant logic depends only on this
// interface, so the suite runs with no network/secret (FakeAiProvider) and the
// church can swap providers without touching the module. Default real provider
// is Anthropic (Claude) — see buildAiProvider() below; Groq and Gemini stay
// wired as real-model fallbacks. The API key lives server-side only (§5.10)
// and is never shipped to any client.
import { ApiError } from "../../http/errors.js";
import type { Env } from "../../config/env.js";

export interface AiTurn {
  role: "user" | "assistant";
  text: string;
}

/** One AI call's outcome, for cost/latency observability (see usage.ts).
 *  Recording must NEVER throw or block the caller — every implementation is
 *  fire-and-forget best-effort. */
export interface AiUsageEvent {
  feature: string;
  tier: "fast" | "standard" | "deep";
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  success: boolean;
  errorCode?: string;
}
export type AiUsageRecorder = (event: AiUsageEvent) => void;

export interface AiCompletion {
  system: string;
  messages: AiTurn[];
  /** Cost/quality tier — mapped to a concrete model by providers that support
   *  it (Anthropic). "fast" = cheap/high-volume mechanical work (classification,
   *  nightly batch narratives), "standard" = interactive member-facing
   *  generation, "deep" = pastoral writing a human actually reads closely
   *  (Sunday Letter, Flock Brief, the daily liturgy). Providers without tiers
   *  ignore it. */
  tier?: "fast" | "standard" | "deep";
  maxTokens?: number;
  /** Anthropic only: thinking/output depth (low..high). Omit to use the
   *  model's default. Use "low" for latency-sensitive interactive calls — do
   *  NOT set this on fast-tier (Haiku) calls, which don't support it. */
  effort?: "low" | "medium" | "high";
  /** A short, stable name identifying the call site (e.g. "sunday_letter",
   *  "assistant_chat") — the only thing that makes per-feature cost/latency
   *  observable (see usage.ts). Optional so future callers keep compiling;
   *  every call site in this codebase sets it. */
  feature?: string;
  /** @deprecated Not sent to Anthropic (Claude Opus 5 / Sonnet 5 and the
   *  4.6+ family reject non-default sampling parameters with a 400 — see the
   *  AnthropicProvider class doc). Gemini and Groq still honor it. Kept only
   *  so call sites tuned for those fallbacks don't need to change; new code
   *  should tune tone via the prompt instead. */
  temperature?: number;
}

export interface AiProvider {
  readonly name: string;
  complete(input: AiCompletion): Promise<string>;
}

/** Marks a caught failure as transient (429 rate-limited, 5xx, 529 overloaded,
 *  or a network/abort error) so withRetry() backs off instead of failing fast.
 *  A non-retryable failure (4xx other than 429, or a parsed-but-empty reply)
 *  is thrown as a plain ApiError instead and skips retry entirely. */
class RetryableUpstreamError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** 2 retries, exponential backoff + jitter (~400-600ms, ~800-1000ms) — the
 *  same shape the Anthropic SDK defaults to (max_retries=2); we're on raw
 *  fetch, so we replicate it by hand for every provider. */
async function withRetry<T>(attempt: () => Promise<T>): Promise<T> {
  const MAX_RETRIES = 2;
  let lastErr: unknown;
  for (let n = 0; n <= MAX_RETRIES; n++) {
    try {
      return await attempt();
    } catch (err) {
      lastErr = err;
      if (n === MAX_RETRIES || !(err instanceof RetryableUpstreamError)) throw err;
      const backoffMs = 400 * 2 ** n + Math.random() * 200;
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

/** Telemetry must never break a completion — every recorder call is wrapped. */
function recordSafely(recordUsage: AiUsageRecorder | undefined, event: AiUsageEvent): void {
  if (!recordUsage) return;
  try {
    recordUsage(event);
  } catch {
    /* non-fatal */
  }
}

/** Shared timing + retry + usage-recording wrapper so the three real
 *  providers don't each hand-roll the same bookkeeping. `attempt()` does the
 *  actual HTTP call and throws RetryableUpstreamError for transient failures,
 *  ApiError for terminal ones. */
async function observedComplete(
  input: AiCompletion,
  providerName: string,
  model: string,
  recordUsage: AiUsageRecorder | undefined,
  attempt: () => Promise<{ text: string; inputTokens: number | null; outputTokens: number | null }>,
): Promise<string> {
  const tier = input.tier ?? "standard";
  const feature = input.feature ?? "unspecified";
  const started = Date.now();
  try {
    const { text, inputTokens, outputTokens } = await withRetry(attempt);
    recordSafely(recordUsage, {
      feature,
      tier,
      provider: providerName,
      model,
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - started,
      success: true,
    });
    return text;
  } catch (err) {
    recordSafely(recordUsage, {
      feature,
      tier,
      provider: providerName,
      model,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
      success: false,
      errorCode: err instanceof RetryableUpstreamError ? String(err.status || "network") : err instanceof ApiError ? err.code : "unknown",
    });
    if (err instanceof ApiError) throw err;
    throw new ApiError("UPSTREAM_UNAVAILABLE", "The assistant is unavailable right now");
  }
}

/** Anthropic (Claude) — the preferred provider. Tiered models keep high-volume
 *  mechanical work cheap while pastoral writing a member actually reads gets
 *  the strongest writer. Plain fetch (no SDK): one dependency fewer, explicit
 *  timeout, transparent errors.
 *
 *  IMPORTANT: Claude Opus 5, Claude Sonnet 5, and the rest of the 4.6+ family
 *  reject non-default `temperature`/`top_p`/`top_k` with a 400 ("Sampling
 *  parameters removed... prompting is the recommended way to guide model
 *  behavior" — Anthropic's documented, current-model behavior). We therefore
 *  never send `temperature` here, regardless of what a caller passes — tone
 *  and consistency are tuned via the system prompt instead. Thinking is ALSO
 *  on by default on these models, and `max_tokens` is a hard cap on thinking
 *  + response text combined, so every call site's maxTokens leaves headroom. */
export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  constructor(
    private readonly apiKey: string,
    private readonly models: { fast: string; standard: string; deep: string },
    private readonly recordUsage?: AiUsageRecorder,
  ) {}

  async complete(input: AiCompletion): Promise<string> {
    const model = this.models[input.tier ?? "standard"];
    return observedComplete(input, this.name, model, this.recordUsage, async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45_000);
      try {
        const body: Record<string, unknown> = {
          model,
          system: input.system,
          messages: input.messages.map((m) => ({ role: m.role, content: m.text })),
          max_tokens: input.maxTokens ?? 600,
          // NO temperature/top_p/top_k — see class doc above.
        };
        if (input.effort) body.output_config = { effort: input.effort };
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          console.error(`[nuru-ai] anthropic ${res.status}: ${detail.slice(0, 300)}`);
          if (res.status === 429 || res.status === 529 || res.status >= 500) {
            throw new RetryableUpstreamError(res.status, `anthropic ${res.status}`);
          }
          throw new ApiError("UPSTREAM_UNAVAILABLE", "The assistant is unavailable right now");
        }
        const json = (await res.json()) as {
          content?: Array<{ type: string; text?: string }>;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        const text = json.content
          ?.filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("")
          .trim();
        if (!text) throw new ApiError("UPSTREAM_UNAVAILABLE", "The assistant had nothing to say");
        return { text, inputTokens: json.usage?.input_tokens ?? null, outputTokens: json.usage?.output_tokens ?? null };
      } catch (err) {
        if (err instanceof RetryableUpstreamError || err instanceof ApiError) throw err;
        // Network/abort errors are transient too — let the retry loop see them.
        throw new RetryableUpstreamError(0, err instanceof Error ? err.message : "network error");
      } finally {
        clearTimeout(timeout);
      }
    });
  }
}

/** Google Gemini (generativelanguage REST). Maps assistant→model roles.
 *  Fallback only — see buildAiProvider(). */
class GeminiProvider implements AiProvider {
  readonly name = "gemini";
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly recordUsage?: AiUsageRecorder,
  ) {}

  async complete(input: AiCompletion): Promise<string> {
    return observedComplete(input, this.name, this.model, this.recordUsage, async () => {
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
          if (res.status === 429 || res.status >= 500) throw new RetryableUpstreamError(res.status, `gemini ${res.status}`);
          throw new ApiError("UPSTREAM_UNAVAILABLE", "The assistant is unavailable right now");
        }
        const json = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        };
        const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
        if (!text) throw new ApiError("UPSTREAM_UNAVAILABLE", "The assistant had nothing to say");
        return {
          text,
          inputTokens: json.usageMetadata?.promptTokenCount ?? null,
          outputTokens: json.usageMetadata?.candidatesTokenCount ?? null,
        };
      } catch (err) {
        if (err instanceof RetryableUpstreamError || err instanceof ApiError) throw err;
        throw new RetryableUpstreamError(0, err instanceof Error ? err.message : "network error");
      } finally {
        clearTimeout(timeout);
      }
    });
  }
}

/** Groq (OpenAI-compatible chat completions). Genuinely free tier, very fast,
 *  hosts open models (Llama 3.3). System prompt rides as a system message.
 *  Fallback only — see buildAiProvider(). */
class GroqProvider implements AiProvider {
  readonly name = "groq";
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly recordUsage?: AiUsageRecorder,
  ) {}

  async complete(input: AiCompletion): Promise<string> {
    return observedComplete(input, this.name, this.model, this.recordUsage, async () => {
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
          if (res.status === 429 || res.status >= 500) throw new RetryableUpstreamError(res.status, `groq ${res.status}`);
          throw new ApiError("UPSTREAM_UNAVAILABLE", "The assistant is unavailable right now");
        }
        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const text = json.choices?.[0]?.message?.content?.trim();
        if (!text) throw new ApiError("UPSTREAM_UNAVAILABLE", "The assistant had nothing to say");
        return { text, inputTokens: json.usage?.prompt_tokens ?? null, outputTokens: json.usage?.completion_tokens ?? null };
      } catch (err) {
        if (err instanceof RetryableUpstreamError || err instanceof ApiError) throw err;
        throw new RetryableUpstreamError(0, err instanceof Error ? err.message : "network error");
      } finally {
        clearTimeout(timeout);
      }
    });
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
        JSON.stringify({
          title: "The week you kept showing up",
          salutation: "Dear Ada,",
          theme: "dawn",
          scripture_ref: "Philippians 1:6",
          body:
            "I watched your week — the lessons you finished and the quiet days too. He who began a good work in you will carry it on to completion. Keep walking; your cell is walking with you. There is nothing about this week he missed, and nothing about the next one he won't be present for either.",
          highlights: ["You finished a lesson this week", "You showed up in prayer"],
          share_line: "Grace showed up again this week — even in the ordinary days.",
        }),
      );
    }
    if (/rendering an existing lesson/i.test(input.system)) {
      if (/Kiswahili/i.test(input.system)) return Promise.resolve("Somo hili kwa ufupi: Mungu ni mwaminifu, na Neno lake ni taa ya miguu yetu. Endelea kutembea naye kila siku.");
      if (/parable/i.test(input.system)) return Promise.resolve("Once, in a busy Kayole market, a trader learned that faithfulness in small things opens greater doors. The lesson: God honors steady obedience (Luke 16:10).");
      return Promise.resolve("Here is the lesson in simple words: God keeps His promises. When we trust Him daily, our faith grows strong. (Hebrews 10:23)");
    }
    if (/daily liturgy/i.test(input.system)) {
      return Promise.resolve(JSON.stringify({
        sunrise: { line: "Before the world has your attention, give the first word of this day to the God who is already awake with you. His mercies are new this morning — meet him here, before the noise, before anyone else asks anything of you.", scripture: "Lamentations 3:22-23" },
        morning: { line: "Whatever your hands find to do this morning, do it as worship, not as burden — he sees the ordinary work and calls it holy.", scripture: "Colossians 3:23" },
        midday: { line: "Pause one breath — the Lord is near, even in the middle of the noise.", scripture: "Philippians 4:5" },
        afternoon: { line: "Tired is not the same as finished. Keep going — he sees the faithfulness nobody else is watching.", scripture: "Galatians 6:9" },
        evening: { line: "Look back over today with honesty, not judgment. Where did you see him? Name it and thank him — where you failed, he already forgave; let the day close in peace, not shame.", scripture: "Psalm 139:23-24" },
        night: { line: "Lie down in peace tonight — the One who keeps you does not slumber, does not grow tired of loving what he made.", scripture: "Psalm 121:3-4" },
        midnight: { line: "If you're awake at this hour, you are not alone in it — the quietest hour is not too quiet for God to hear.", scripture: "Psalm 63:6" },
      }));
    }
    if (/quiz coach/i.test(input.system)) {
      return Promise.resolve("Failing a quiz is part of learning — well done for coming back. Look again at what the lesson says about God's covenant faithfulness; the answer lives there. You are ready — try again.");
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
    if (/draft.{0,20}(check.?in|outreach)/i.test(input.system)) {
      return Promise.resolve(
        "Hey! I noticed things have been a bit quiet on your end this week — no pressure at all, just wanted to check in and see how you're doing. Would love to catch up when you have a moment. Praying for you 🙏",
      );
    }
    if (/pastoral memory/i.test(input.system)) {
      return Promise.resolve(
        "They are walking steadily through their current level, showing up most days, and their recent reflections carry a hunger to grow. This season they may need encouragement to keep their prayer rhythm.",
      );
    }
    if (/compose a short, honest personal prayer/i.test(input.system)) {
      const seeded = [...input.messages].reverse().find((m) => m.role === "user")?.text ?? "";
      if (/^my seed points/i.test(seeded.trim())) {
        return Promise.resolve(
          "Lord, thank You for walking with me this week. I bring You what's on my heart — the people and the worries I carry — and I ask for Your peace over each one. Give me strength for what's ahead, and help me trust You more each day. Amen.",
        );
      }
      return Promise.resolve(
        "Lord, I come to You just as I am today. Quiet my heart, and help me hear You. Thank You for Your faithfulness, even when I don't notice it. Lead me gently through this day. Amen.",
      );
    }
    if (/into concise prayer points/i.test(input.system)) {
      return Promise.resolve(
        "Thank God for steady growth this season\nPray for strength in family relationships\nAsk for wisdom in the week ahead\nPray for the cell group's unity",
      );
    }
    if (/search keywords|expand.{0,20}query/i.test(input.system)) {
      const text = [...input.messages].reverse().find((m) => m.role === "user")?.text ?? "";
      const words = text.toLowerCase().match(/[a-z']{4,}/g) ?? [];
      return Promise.resolve(words.slice(0, 6).join(" ") || "faith grace hope");
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

export function buildAiProvider(env: Env, recordUsage?: AiUsageRecorder): AiProvider {
  // Prefer Anthropic (Claude — tiered models power the intelligence layer),
  // then Groq (free), then Gemini. When a key is configured we use the LIVE
  // provider directly — a failure surfaces as an error (and is logged), rather
  // than silently degrading to canned text. The offline responder is used only
  // when no key is set (local dev / tests).
  if (env.ANTHROPIC_API_KEY) {
    return new AnthropicProvider(
      env.ANTHROPIC_API_KEY,
      { fast: env.ANTHROPIC_MODEL_FAST, standard: env.ANTHROPIC_MODEL, deep: env.ANTHROPIC_MODEL_DEEP },
      recordUsage,
    );
  }
  if (env.GROQ_API_KEY) return new GroqProvider(env.GROQ_API_KEY, env.GROQ_MODEL, recordUsage);
  if (env.GEMINI_API_KEY) return new GeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL, recordUsage);
  return new FakeAiProvider();
}
