-- Migration 170 · Events & Announcements re-architecture (docs/EVENTS_ARCHITECTURE.md)
-- ============================================================================
-- Backend phase of the canonical events model:
--   §2  series split lineage (split_from) — Google-style "this and following".
--   §3  the dead manual-checkin toggle becomes a real series column, copied onto
--       occurrences at materialization; trigram indexes back /admin/events/search.
--   §5  announcements become first-class: multi-tenant congregation_id
--       (backfilled from the creator's congregation; NULL = legacy global),
--       series/event attachment (three modes), archive/restore distinct from
--       delete, and an honest suppress_reason on deliveries (no_provider /
--       opted_out / no_email) instead of fabricated "delivered" stats.
--   §6  time-boxed QR rotation marker on occurrences.
--   §7  per-series automation JSONB (reminder offsets, auto-archive, low-RSVP
--       alert, qr_auto_ready) + the markers its crons need.
--   §8  featured event/announcement become per-congregation (the old partial
--       unique indexes enforced ONE global pick; featuring in congregation B
--       un-featured congregation A's choice).
-- All additive; the member wire contract is unchanged (§11).
-- ============================================================================

-- Up Migration

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- §2/§3/§7 — series lineage, wired ops toggle, automation.
ALTER TABLE event_series
  ADD COLUMN IF NOT EXISTS split_from             UUID REFERENCES event_series(series_id),
  ADD COLUMN IF NOT EXISTS manual_checkin_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS automation             JSONB NOT NULL DEFAULT '{}'::jsonb;

-- §8 — one featured event PER CONGREGATION (was: one globally).
DROP INDEX IF EXISTS uq_event_series_featured;
CREATE UNIQUE INDEX uq_event_series_featured
  ON event_series (congregation_id) WHERE is_featured = true;

-- §3 — archive search (ILIKE + trigram).
CREATE INDEX IF NOT EXISTS idx_event_series_title_trgm
  ON event_series USING gin (title gin_trgm_ops);

-- §6/§7 — QR rotation timestamp, occurrence auto-archive, low-RSVP alert marker.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS qr_rotated_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS low_rsvp_alerted_at TIMESTAMPTZ;

-- §5 — announcements lifecycle columns.
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS congregation_id     UUID REFERENCES congregations(congregation_id),
  ADD COLUMN IF NOT EXISTS series_id           UUID REFERENCES event_series(series_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_occurrence_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS archived_at         TIMESTAMPTZ;

-- Backfill tenancy from the creator's congregation (created_by is NOT NULL).
-- Rows whose creator vanished stay NULL and are read as "legacy global".
UPDATE announcements a
   SET congregation_id = u.congregation_id
  FROM users u
 WHERE u.user_id = a.created_by AND a.congregation_id IS NULL;

-- §8 — one featured announcement PER CONGREGATION (was: one globally).
DROP INDEX IF EXISTS uq_announcements_featured;
CREATE UNIQUE INDEX uq_announcements_featured
  ON announcements (congregation_id) WHERE is_featured = true;

CREATE INDEX IF NOT EXISTS idx_announcements_cong
  ON announcements (congregation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcements_series
  ON announcements (series_id) WHERE series_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_announcements_title_trgm
  ON announcements USING gin (title gin_trgm_ops);

-- §5 — honest channel accounting: WHY a delivery was suppressed.
ALTER TABLE announcement_deliveries
  ADD COLUMN IF NOT EXISTS suppress_reason VARCHAR(40);

-- §8 note: the `events` RBAC module + capabilities already exist (migration 35 +
-- seeds/08_rbac.sql seed events:view/create/edit/delete/approve/export onto the
-- coordinator/director roles) — no new permission rows are needed here.

-- Down Migration

ALTER TABLE announcement_deliveries DROP COLUMN IF EXISTS suppress_reason;

DROP INDEX IF EXISTS idx_announcements_title_trgm;
DROP INDEX IF EXISTS idx_announcements_series;
DROP INDEX IF EXISTS idx_announcements_cong;
DROP INDEX IF EXISTS uq_announcements_featured;
CREATE UNIQUE INDEX uq_announcements_featured
  ON announcements ((is_featured)) WHERE is_featured = true;

ALTER TABLE announcements
  DROP COLUMN IF EXISTS archived_at,
  DROP COLUMN IF EXISTS event_occurrence_id,
  DROP COLUMN IF EXISTS series_id,
  DROP COLUMN IF EXISTS congregation_id;

ALTER TABLE events
  DROP COLUMN IF EXISTS low_rsvp_alerted_at,
  DROP COLUMN IF EXISTS archived_at,
  DROP COLUMN IF EXISTS qr_rotated_at;

DROP INDEX IF EXISTS idx_event_series_title_trgm;
DROP INDEX IF EXISTS uq_event_series_featured;
CREATE UNIQUE INDEX uq_event_series_featured
  ON event_series ((is_featured)) WHERE is_featured = true;

ALTER TABLE event_series
  DROP COLUMN IF EXISTS automation,
  DROP COLUMN IF EXISTS manual_checkin_enabled,
  DROP COLUMN IF EXISTS split_from;
