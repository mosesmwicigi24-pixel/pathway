-- Migration 185 · AI usage/cost observability (ai-claude-pass)
-- ============================================================================
-- Nothing recorded what the AI layer was doing or spending: every call was a
-- fire-and-forget console.error on failure and nothing at all on success. This
-- table backs a small admin-visible summary (per feature/tier/model: call
-- count, failure rate, avg latency, tokens, a rough cost estimate) instead of
-- logs nobody reads. Writes are best-effort from the app (see usage.ts
-- recorder()) — a telemetry failure must never break a completion, so this
-- table intentionally has no FKs into anything on the hot path.
-- ============================================================================

-- Up Migration

CREATE TABLE ai_usage_events (
  event_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  feature       TEXT NOT NULL,          -- call-site name, e.g. "sunday_letter"
  tier          TEXT NOT NULL,          -- fast | standard | deep
  provider      TEXT NOT NULL,          -- anthropic | gemini | groq | fake
  model         TEXT NOT NULL,
  input_tokens  INTEGER,                -- null when the provider didn't report usage
  output_tokens INTEGER,
  latency_ms    INTEGER NOT NULL,
  success       BOOLEAN NOT NULL,
  error_code    TEXT                    -- HTTP status or ApiError code on failure
);

-- The summary query groups by (feature, tier, provider, model) over a rolling
-- window ordered by occurred_at — this one index covers both the WHERE and
-- the natural scan order.
CREATE INDEX idx_ai_usage_events_occurred_at ON ai_usage_events (occurred_at DESC);
CREATE INDEX idx_ai_usage_events_feature ON ai_usage_events (feature, occurred_at DESC);

-- Down Migration

DROP TABLE IF EXISTS ai_usage_events;
