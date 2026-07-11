-- Intelligence layer, Phase 1 (the "Member Story" brain + Sunday Letters + content grounding).
-- Design notes:
--   • content_chunks is the retrieval index over OUR OWN teaching (curriculum
--     modules, reading-plan segments, devotionals). Retrieval is Postgres FTS
--     (tsvector) — no new extension, works in embedded-postgres tests, and at
--     this corpus size (~thousands of chunks) ranks well. The service hides the
--     mechanism behind an interface so a vector index can replace it later
--     without touching callers.
--   • member_story is ONE row per member: deterministic SQL-aggregated `facts`
--     plus a short AI-composed `narrative`. Rebuilt nightly; every AI feature
--     reads from here (one brain, many hands).
--   • pastoral_letters is the weekly "Sunday Letter" — UNIQUE (user_id, week_of)
--     makes the weekly job idempotent and replay-safe.
--   • users.ai_opt_out is the personalization covenant switch: when TRUE the
--     member's WRITTEN content (reflections, posts) is never sent to a model and
--     no letters/narratives are generated for them. Behavioral aggregates
--     (counts, scores) still power the deterministic UI exactly as today.

ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_opt_out BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS content_chunks (
  chunk_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('module', 'plan_segment', 'devotional')),
  source_id   UUID NOT NULL,
  seq         INT  NOT NULL DEFAULT 0,
  title       TEXT NOT NULL,
  ref         TEXT,                -- human citation, e.g. 'Level 2 · Module 4' / 'Plan: Rooted · Day 3'
  body        TEXT NOT NULL,
  tsv         tsvector GENERATED ALWAYS AS (
                to_tsvector('english', coalesce(title, '') || ' ' || coalesce(ref, '') || ' ' || body)
              ) STORED,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_kind, source_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_content_chunks_tsv ON content_chunks USING GIN (tsv);

CREATE TABLE IF NOT EXISTS member_story (
  user_id   UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  facts     JSONB NOT NULL,
  narrative TEXT  NOT NULL DEFAULT '',
  built_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pastoral_letters (
  letter_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  week_of       DATE NOT NULL,     -- the Sunday (EAT) this letter belongs to
  body          TEXT NOT NULL,
  scripture_ref TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at       TIMESTAMPTZ,
  UNIQUE (user_id, week_of)
);
CREATE INDEX IF NOT EXISTS idx_pastoral_letters_user ON pastoral_letters (user_id, week_of DESC);
