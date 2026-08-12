-- Migration 187 · Liturgy v2 — seven bands + scripture spine (feat/liturgy-v2)
-- ============================================================================
-- The daily liturgy composed exactly four lines (morning/midday/evening/night)
-- while the file already carried a finer seven-band clock (sunrise, morning,
-- midday, afternoon, evening, night, midnight) used only for art/charge/verse.
-- This widens composition to the full seven bands and adds a `spine` column
-- holding the day's deterministic scripture spine (a psalm + a gospel passage
-- + an epistle passage — real text, given to the composer so it prays FROM a
-- passage instead of recalling one unaided; see spineFor() in liturgy.ts) so
-- the raw material behind any composed day is reproducible and inspectable.
--
-- Backward compatibility: four of the seven band names ARE the four legacy
-- part values (morning/midday/evening/night are literally shared between
-- LiturgyPart and DayBand) — so a client that only ever reads those four
-- `part` rows keeps working unchanged; the three new rows (sunrise/afternoon/
-- midnight) are purely additive. A pre-migration row (only four parts, no
-- spine) still reads fine: LiturgyService.rowsToDay() fills any missing band
-- with the (now seven-band) fallback rather than failing, and composeFor()
-- treats ANY existing rows for a day as fully "cached" — it never force-
-- recomposes a legacy day, so old data is left exactly as it was.
--
-- The CHECK constraint on `part` is widened defensively: rather than assume
-- Postgres's auto-generated name for the original inline CHECK
-- (`liturgies_part_check`, the standard <table>_<column>_check convention),
-- we look it up by definition and drop whatever we find, then add a new,
-- explicitly-named constraint — so this migration can't silently no-op if
-- the assumption about the auto-generated name is ever wrong.
-- ============================================================================

-- Up Migration

DO $$
DECLARE
  cons_name text;
BEGIN
  SELECT con.conname INTO cons_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'liturgies'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) LIKE '%part%';
  IF cons_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE liturgies DROP CONSTRAINT %I', cons_name);
  END IF;
END $$;

ALTER TABLE liturgies
  ADD CONSTRAINT liturgies_part_check
  CHECK (part IN ('sunrise', 'morning', 'midday', 'afternoon', 'evening', 'night', 'midnight'));

ALTER TABLE liturgies
  ADD COLUMN IF NOT EXISTS spine JSONB;

-- Down Migration

ALTER TABLE liturgies
  DROP COLUMN IF EXISTS spine;

ALTER TABLE liturgies
  DROP CONSTRAINT IF EXISTS liturgies_part_check;

ALTER TABLE liturgies
  ADD CONSTRAINT liturgies_part_check
  CHECK (part IN ('morning', 'midday', 'evening', 'night'));
