-- Migration 87 · Radio uploaded session audio + auto-air scheduling
-- ============================================================================
-- ADDENDUM to docs/RADIO_STUDIO_CONTRACT.md (2026-07-02):
--   * audio_url / audio_duration_sec — a radio_program can carry an uploaded
--     broadcast recording (self-hosted /media/<uuid>.<ext>), played when the
--     session goes live. Members DO get audio_url (still never stream_key).
--   * auto_go_live — when true, the worker's auto-air sweep airs the program at
--     scheduled_at and auto-ends it after duration_min.
--   * (status, scheduled_at) index backs the scheduler sweep.
-- ============================================================================

-- Up Migration

ALTER TABLE radio_programs
  ADD COLUMN audio_url          TEXT,
  ADD COLUMN audio_duration_sec INT,
  ADD COLUMN auto_go_live       BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX idx_radio_programs_sched ON radio_programs (status, scheduled_at);

-- Down Migration

DROP INDEX IF EXISTS idx_radio_programs_sched;

ALTER TABLE radio_programs
  DROP COLUMN IF EXISTS audio_url,
  DROP COLUMN IF EXISTS audio_duration_sec,
  DROP COLUMN IF EXISTS auto_go_live;
