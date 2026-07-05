-- Migration 101 · Radio live listener presence (real listeners, not seeded)
-- ============================================================================
-- Replaces the fabricated studio listener roster with REAL presence: while a
-- member's radio player is actually playing a live program it POSTs a heartbeat
-- (POST /v1/radio/programs/:id/listening) which upserts one row here per
-- (program, user). The studio roster (GET .../listeners) and the live listener
-- COUNT then read from this table — counting only rows whose last_seen is within
-- the last 45s (a client heartbeats ~every 20s, so a 45s window survives one
-- missed beat before a listener drops off). The Icecast/provider count remains
-- the fallback when no members are heartbeating (e.g. web/desktop stream pulls).
--
-- One row per (program, user), overwritten on each heartbeat — no history/trail.
-- Rows are transient presence, not analytics; they are cleaned up by the 45s
-- read window and cascade-deleted with the program or the user.
-- ============================================================================

-- Up Migration

CREATE TABLE radio_listeners (
  program_id UUID        NOT NULL REFERENCES radio_programs(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users(user_id)     ON DELETE CASCADE,
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (program_id, user_id)
);

-- Roster/count reads scan by program then filter on the freshness window; index
-- the (program, last_seen) pair so the active-listener query stays index-only.
CREATE INDEX idx_radio_listeners_program_seen
  ON radio_listeners (program_id, last_seen DESC);

-- Down Migration

DROP INDEX IF EXISTS idx_radio_listeners_program_seen;
DROP TABLE IF EXISTS radio_listeners;
