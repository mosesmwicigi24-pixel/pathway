-- Migration 160 · Event series "Show on Home" curation flag
-- ============================================================================
-- Home's calendar grid is being replaced by a portal-curated LIST of up to 5
-- upcoming events. `show_on_home` marks a series as eligible for that list —
-- unlike `is_featured` (migration 52, single-row homepage hero, partial unique
-- index), any number of series may be flagged at once; the server caps the
-- Home response at 5 soonest occurrences regardless of how many are flagged
-- (GET /home/events).
-- ============================================================================

-- Up Migration

ALTER TABLE event_series
  ADD COLUMN IF NOT EXISTS show_on_home BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_event_series_show_on_home
  ON event_series (show_on_home)
  WHERE show_on_home = true AND deleted_at IS NULL;

-- Down Migration

DROP INDEX IF EXISTS idx_event_series_show_on_home;
ALTER TABLE event_series
  DROP COLUMN IF EXISTS show_on_home;
