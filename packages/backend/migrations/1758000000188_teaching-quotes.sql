-- Migration 188 · Teaching quotes — the church's own preaching voice (feat/sermon-quotes)
-- ============================================================================
-- A small library of short, standalone teaching lines drawn from the owner's
-- own sermons (see packages/backend/scripts/sermon-corpus/CURATION.md for the
-- source review and packages/backend/scripts/sermon-corpus/*.txt for the
-- staged raw text). Seeded by scripts/seed-teaching-quotes.ts, which extracts
-- quotable lines from the staged corpus — see teachingQuotes.ts.
--
-- This table is a pure ENHANCEMENT to the daily liturgy (liturgy.ts): the
-- liturgy composer offers a small, not-recently-used selection of these
-- quotes to the model, which weaves one in ONLY when it genuinely fits —
-- never forced, never reworded (verbatim-with-attribution or absent). A
-- liturgy composed against an empty (or missing) table must still succeed.
--
-- UNIQUE(quote_text) makes the seeder idempotent — a re-run cannot duplicate
-- a row. last_used_at/use_count are maintained by the liturgy composer
-- (never by the seeder) so the library rotates rather than looping over the
-- same handful of favourites — see selectQuoteCandidates()/markQuotesUsed()
-- in teachingQuotes.ts.
-- ============================================================================

-- Up Migration

CREATE TABLE teaching_quotes (
  quote_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_text    TEXT NOT NULL,
  attribution   VARCHAR(120) NOT NULL DEFAULT 'Pastor Moses',
  source_title  VARCHAR(255) NOT NULL,
  source_ref    VARCHAR(255) NOT NULL, -- Drive file id of the sermon this was drawn from
  theme         VARCHAR(60),           -- optional loose tag (e.g. "mindset", "purpose")
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  use_count     INT NOT NULL DEFAULT 0,
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT teaching_quotes_text_len CHECK (char_length(quote_text) BETWEEN 10 AND 400),
  UNIQUE (quote_text)
);

-- Selection is always "active quotes, oldest-used-first" (see
-- selectQuoteCandidates()) — this index serves that query directly.
CREATE INDEX idx_teaching_quotes_selection ON teaching_quotes (is_active, last_used_at);

-- Tagged lookup, when a theme is present.
CREATE INDEX idx_teaching_quotes_theme ON teaching_quotes (theme) WHERE theme IS NOT NULL;

-- Down Migration

DROP TABLE IF EXISTS teaching_quotes;
