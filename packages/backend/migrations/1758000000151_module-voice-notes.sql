-- Wave 2 of companion presence: a DISCIPLER'S VOICE on the lesson itself.
-- One active voice note per module per congregation — the leader re-records
-- over their previous note (upsert), members hear "a word from <leader>"
-- at the top of the lesson. Audio lives on our own /media disk via the
-- existing member voice-note upload; only the URL is stored here.

-- Up Migration
CREATE TABLE IF NOT EXISTS module_voice_notes (
  note_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id       UUID NOT NULL REFERENCES modules(module_id) ON DELETE CASCADE,
  congregation_id UUID NOT NULL REFERENCES congregations(congregation_id) ON DELETE CASCADE,
  author_user_id  UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  audio_url       TEXT NOT NULL,
  duration_sec    INT NOT NULL DEFAULT 0 CHECK (duration_sec BETWEEN 0 AND 300),
  waveform        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (module_id, congregation_id)
);

-- Down Migration
DROP TABLE IF EXISTS module_voice_notes;
