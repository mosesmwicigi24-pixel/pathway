-- Migration 183 · Nuru Live — recording stewardship (owner-managed keep/delete)
-- ============================================================================
-- live_streams already carries at most one recording_url per stream (1:1) — a
-- "recording" IS the stream, identified by the same stream_id. This adds a
-- soft-delete marker scoped to just the recording (the stream row and its
-- interaction history are untouched): once set, the recording is hidden from
-- every listing/replay surface, but the row survives for audit history and to
-- keep the worker sweep's `recording_url IS NULL` registration guard from
-- re-registering a deleted recording.
-- ============================================================================

-- Up Migration

ALTER TABLE live_streams ADD COLUMN recording_deleted_at TIMESTAMPTZ;

-- Speeds "recordings I can see" scans (both /live/recordings and the new
-- /live/recordings/mine) — partial index since most rows have no recording at
-- all yet, and NULL (not deleted) is overwhelmingly the common case.
CREATE INDEX idx_live_streams_recording_active
  ON live_streams (started_by, ended_at DESC)
  WHERE recording_url IS NOT NULL AND recording_deleted_at IS NULL;

-- Down Migration

DROP INDEX IF EXISTS idx_live_streams_recording_active;
ALTER TABLE live_streams DROP COLUMN IF EXISTS recording_deleted_at;
