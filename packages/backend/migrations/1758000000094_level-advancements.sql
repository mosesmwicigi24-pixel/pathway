-- Migration 94 · Level advancements — the discipler "usher" gate (§1.9 rule 2/3)
-- ============================================================================
-- THE RULE: "Modules a member earns alone; LEVELS require a human discipler to
-- usher them in." Passing a level exam no longer advances current_level by
-- itself — it records a PENDING advancement for the level the member just
-- cleared. A discipler (Instructor+, cell-scoped §5.4) reviews the queue and
-- USHERS the member, which is the ONLY thing that flips current_level to N+1.
--
-- One advancement per (user, level): UNIQUE(user_id, level_number) makes the
-- exam-pass upsert idempotent (a re-pass while pending is a no-op) and lets the
-- usher be idempotent too (already 'ushered' → nothing to advance).
-- ============================================================================

-- Up Migration

CREATE TABLE level_advancements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  level_number    INT  NOT NULL,
  exam_attempt_id UUID REFERENCES level_exam_attempts(exam_attempt_id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ushered')),
  reviewed_by     UUID REFERENCES users(user_id),
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at     TIMESTAMPTZ,
  UNIQUE (user_id, level_number)
);

-- The discipler queue reads pending rows; index the hot path.
CREATE INDEX idx_level_advancements_pending
  ON level_advancements (level_number, created_at)
  WHERE status = 'pending';

-- Down Migration

DROP INDEX IF EXISTS idx_level_advancements_pending;
DROP TABLE IF EXISTS level_advancements;
