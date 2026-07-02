-- Migration 88 · Radio Audio Library + Session Playlists + loop modes
-- ============================================================================
-- Extends docs/RADIO_STUDIO_CONTRACT.md:
--   * radio_tracks — a reusable audio library (music/preaching/audio), each row
--     an uploaded asset (audio_url from POST /admin/media/audio/upload). Members
--     DO get audio_url on tracks (that's the point — the player plays them).
--   * radio_program_tracks — an ordered playlist joining a program to tracks so a
--     session can play a sequence. Cascades on program/track delete.
--   * radio_programs.loop_mode — none | loop_all | repeat_one for the session player.
-- ============================================================================

-- Up Migration

CREATE TABLE radio_tracks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'audio' CHECK (kind IN ('music','preaching','audio')),
  audio_url    TEXT NOT NULL,
  duration_sec INT,
  size_bytes   BIGINT,
  created_by   UUID REFERENCES users(user_id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_radio_tracks_kind ON radio_tracks (kind);
CREATE INDEX idx_radio_tracks_created ON radio_tracks (created_at DESC);

CREATE TABLE radio_program_tracks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES radio_programs(id) ON DELETE CASCADE,
  track_id   UUID NOT NULL REFERENCES radio_tracks(id) ON DELETE CASCADE,
  position   INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_radio_program_tracks_pos ON radio_program_tracks (program_id, position);

ALTER TABLE radio_programs
  ADD COLUMN loop_mode TEXT NOT NULL DEFAULT 'none'
    CHECK (loop_mode IN ('none','loop_all','repeat_one'));

-- Down Migration

ALTER TABLE radio_programs DROP COLUMN IF EXISTS loop_mode;

DROP TABLE IF EXISTS radio_program_tracks;
DROP TABLE IF EXISTS radio_tracks;
