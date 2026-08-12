-- Migration 186 · Sunday Letter v2 (feat/sunday-letter-v2)
-- ============================================================================
-- The Sunday Letter stored only `body` + `scripture_ref` — no name, title,
-- image, or theme. This widens the contract to a fully-composed personal
-- letter: a title worth opening (also becomes the push text — see
-- dispatch.ts pushCopy(), which already prefers an explicit payload.title),
-- a salutation carrying the member's real first name, a `theme` drawn from a
-- small fixed vocabulary (see LETTER_THEMES in prompts.ts) that both apps map
-- to a bundled illustration — never a third-party URL — and `highlights`
-- (JSONB: { moments: string[], next_step: {...}|null, share_line: string|null })
-- holding the 2-3 true observations from the member's real week, a single
-- deterministic (server-computed, not AI-invented) next step, and one
-- shareable line.
--
-- Existing rows predate all five columns and stay NULL — every reader
-- (LettersService.rowFromDb) applies the same null-safe defaults a fresh
-- letter would never actually need, so old letters still render.
-- ============================================================================

-- Up Migration

ALTER TABLE pastoral_letters
  ADD COLUMN IF NOT EXISTS title       TEXT,
  ADD COLUMN IF NOT EXISTS salutation  TEXT,
  ADD COLUMN IF NOT EXISTS theme       TEXT,
  ADD COLUMN IF NOT EXISTS image_key   TEXT,
  ADD COLUMN IF NOT EXISTS highlights  JSONB;

-- Down Migration

ALTER TABLE pastoral_letters
  DROP COLUMN IF EXISTS title,
  DROP COLUMN IF EXISTS salutation,
  DROP COLUMN IF EXISTS theme,
  DROP COLUMN IF EXISTS image_key,
  DROP COLUMN IF EXISTS highlights;
