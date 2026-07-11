-- Intelligence Phase 3 — the living curriculum.
--   • module_explanations: cached "explain it differently" renderings of a
--     lesson (simple English / Kiswahili / story). One cache per module+style —
--     generated once, served to everyone (content, not personal data).
--   • quiz_remediations: cached per-FAILED-ATTEMPT mini-reviews ("Review with
--     Nuru") — regenerated naturally for each new failed attempt, idempotent
--     per attempt. Teaches the missed concepts; never dumps the answer key.
-- Verse spaced-repetition needs no schema: due-ness is computed from
-- memory_verse_progress (status, best_match_pct, updated_at).

-- Up Migration
CREATE TABLE IF NOT EXISTS module_explanations (
  module_id  UUID NOT NULL REFERENCES modules(module_id) ON DELETE CASCADE,
  style      TEXT NOT NULL CHECK (style IN ('simple', 'swahili', 'story')),
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (module_id, style)
);

CREATE TABLE IF NOT EXISTS quiz_remediations (
  user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  module_id  UUID NOT NULL REFERENCES modules(module_id) ON DELETE CASCADE,
  attempt_id UUID NOT NULL REFERENCES quiz_attempts(attempt_id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, module_id, attempt_id)
);

-- Down Migration
DROP TABLE IF EXISTS quiz_remediations;
DROP TABLE IF EXISTS module_explanations;
