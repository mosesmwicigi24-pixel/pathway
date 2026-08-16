// AI cost/usage observability. Before this, nobody could see what the AI
// layer was doing or spending — every call was a fire-and-forget console.error
// on failure and nothing at all on success. This is deliberately cheap: one
// best-effort INSERT per call (never blocks, never throws into the caller —
// see recorder()), and one admin-visible aggregate endpoint rather than a pile
// of logs nobody reads.
import type { Pool } from "pg";
import { many } from "../../db/db.js";
import { background } from "../../db/background.js";
import type { AiUsageEvent, AiUsageRecorder } from "./provider.js";

/** Rough $/1M-token list prices (Anthropic first-party, cached at write time)
 *  — for a ballpark cost estimate only, not a billing reconciliation. Unknown
 *  models/providers fall back to $0 so the total never silently overstates. */
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
};

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICE_PER_MTOK[model];
  if (!price) return 0;
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}

export interface AiUsageSummaryRow {
  feature: string;
  tier: string;
  provider: string;
  model: string;
  calls: number;
  failures: number;
  avg_latency_ms: number;
  total_input_tokens: number;
  total_output_tokens: number;
  estimated_cost_usd: number;
}

export class AiUsageService {
  constructor(private readonly pool: Pool) {}

  /** A closure suitable for AnthropicProvider/GeminiProvider/GroqProvider's
   *  optional recordUsage — fire-and-forget, swallows its own errors so a
   *  telemetry hiccup can never surface to (or slow down) the member/leader
   *  waiting on the actual completion. Tracked via background() so shutdown and
   *  the test harness can drain it instead of racing it (db/background.ts). */
  recorder(): AiUsageRecorder {
    return (event: AiUsageEvent) => {
      background(
        this.pool.query(
          `INSERT INTO ai_usage_events
             (feature, tier, provider, model, input_tokens, output_tokens, latency_ms, success, error_code)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            event.feature,
            event.tier,
            event.provider,
            event.model,
            event.inputTokens,
            event.outputTokens,
            event.latencyMs,
            event.success,
            event.errorCode ?? null,
          ],
        ),
      );
    };
  }

  /** Aggregated, admin-visible view — grouped by feature so the owner can see
   *  "what is the AI actually doing" at a glance, not raw event rows. */
  async summary(days = 30): Promise<{ since_days: number; total_calls: number; total_estimated_cost_usd: number; rows: AiUsageSummaryRow[] }> {
    const rows = await many<{
      feature: string;
      tier: string;
      provider: string;
      model: string;
      calls: string;
      failures: string;
      avg_latency_ms: string | null;
      total_input_tokens: string | null;
      total_output_tokens: string | null;
    }>(
      this.pool,
      `SELECT feature, tier, provider, model,
              count(*)::text AS calls,
              count(*) FILTER (WHERE NOT success)::text AS failures,
              round(avg(latency_ms))::text AS avg_latency_ms,
              sum(coalesce(input_tokens, 0))::text AS total_input_tokens,
              sum(coalesce(output_tokens, 0))::text AS total_output_tokens
         FROM ai_usage_events
        WHERE occurred_at >= now() - make_interval(days => $1)
        GROUP BY feature, tier, provider, model
        ORDER BY count(*) DESC`,
      [Math.min(Math.max(days, 1), 365)],
    );
    const summaryRows: AiUsageSummaryRow[] = rows.map((r) => {
      const inputTokens = Number(r.total_input_tokens ?? 0);
      const outputTokens = Number(r.total_output_tokens ?? 0);
      return {
        feature: r.feature,
        tier: r.tier,
        provider: r.provider,
        model: r.model,
        calls: Number(r.calls),
        failures: Number(r.failures),
        avg_latency_ms: Number(r.avg_latency_ms ?? 0),
        total_input_tokens: inputTokens,
        total_output_tokens: outputTokens,
        estimated_cost_usd: Math.round(estimateCostUsd(r.model, inputTokens, outputTokens) * 10_000) / 10_000,
      };
    });
    return {
      since_days: days,
      total_calls: summaryRows.reduce((n, r) => n + r.calls, 0),
      total_estimated_cost_usd: Math.round(summaryRows.reduce((n, r) => n + r.estimated_cost_usd, 0) * 10_000) / 10_000,
      rows: summaryRows,
    };
  }
}
