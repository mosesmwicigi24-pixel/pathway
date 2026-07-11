-- Intelligence Phase 2 — the Shepherd's Pulse.
--   • signals: per-member care signals. Deterministic DRIFT rules (rhythm
--     collapse vs the member's own baseline) + AI EMOTION reads of consented
--     written content + CRISIS flags. day_date + UNIQUE(user,kind,day) makes
--     the nightly scan idempotent and anti-spams escalation (one/day).
--   • flock_briefs: the leader's weekly AI-composed brief over their people
--     (UNIQUE leader+week ⇒ replay-safe weekly job).
-- Privacy: signals carry a one-line summary + coarse tone, never the member's
-- full text; leaders already see reflections via the review queue (§5.4), so
-- no new exposure is created — only attention.

-- Up Migration
CREATE TABLE IF NOT EXISTS signals (
  signal_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('drift_risk', 'emotion', 'crisis')),
  severity        TEXT NOT NULL CHECK (severity IN ('info', 'watch', 'urgent')),
  summary         TEXT NOT NULL,
  detail          JSONB NOT NULL DEFAULT '{}',
  source          TEXT,             -- 'rhythm' | 'reflection' | 'talk'
  day_date        DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Africa/Nairobi')::date),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_by UUID REFERENCES users(user_id),
  acknowledged_at TIMESTAMPTZ,
  UNIQUE (user_id, kind, day_date)
);
CREATE INDEX IF NOT EXISTS idx_signals_recent ON signals (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_user ON signals (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS flock_briefs (
  brief_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  leader_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  week_of        DATE NOT NULL,
  body           TEXT NOT NULL,
  detail         JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (leader_user_id, week_of)
);
CREATE INDEX IF NOT EXISTS idx_flock_briefs_leader ON flock_briefs (leader_user_id, week_of DESC);

-- Down Migration
DROP TABLE IF EXISTS flock_briefs;
DROP TABLE IF EXISTS signals;
