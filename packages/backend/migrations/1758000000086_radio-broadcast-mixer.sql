-- Migration 86 · Radio Broadcast Studio + Virtual Audio Mixer
-- ============================================================================
-- Backend for the DARK studio surfaces (web + iPad) per docs/RADIO_STUDIO_CONTRACT.md.
--
-- Model:
--   * radio_programs — the broadcastable unit. Admins CRUD + go-live/end; the
--     provider ingest credentials (ingest_provider/ingest_url/stream_key/hls_url)
--     are provisioned on create. stream_key/ingest_* are SECRETS — surfaced only on
--     the admin surface, NEVER to members (module enforces the public projection).
--   * radio_reactions / radio_comments — member interactions, idempotent per a
--     client-supplied client_event_id (§2.1/§3.6): a replay is a no-op that returns
--     the same result. Both cascade with the parent program.
--   * mixer_scenes / mixer_jingles — persisted mixer presets + soundboard entries.
--     Channels live inline as a jsonb array (client-authored strip layout).
--
-- FK convention: users(user_id) (NOT users(id)). Enums as VARCHAR + CHECK.
-- ============================================================================

-- Up Migration

CREATE TABLE radio_programs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL,
  description       TEXT,
  category          TEXT NOT NULL
                      CHECK (category IN ('Sermon','Worship','Prayer','Bible Study','Conference')),
  speaker           TEXT,
  location          TEXT,
  artwork_url       TEXT,
  tags              TEXT[] NOT NULL DEFAULT '{}',
  visibility        TEXT NOT NULL DEFAULT 'public'
                      CHECK (visibility IN ('public','members','private')),
  scheduled_at      TIMESTAMPTZ,
  duration_min      INT,
  repeat            TEXT DEFAULT 'none',
  timezone          TEXT,
  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','scheduled','live','ended')),
  is_live           BOOLEAN NOT NULL DEFAULT false,
  live_started_at   TIMESTAMPTZ,
  live_ended_at     TIMESTAMPTZ,
  record_broadcast  BOOLEAN NOT NULL DEFAULT false,
  record_target     TEXT CHECK (record_target IN ('cloud','local','both')),
  peak_listeners    INT NOT NULL DEFAULT 0,
  ingest_provider   TEXT,
  ingest_url        TEXT,
  stream_key        TEXT,
  hls_url           TEXT,
  created_by        UUID REFERENCES users(user_id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_radio_programs_status ON radio_programs (status);
CREATE INDEX idx_radio_programs_scheduled_at ON radio_programs (scheduled_at);
CREATE INDEX idx_radio_programs_is_live ON radio_programs (is_live) WHERE is_live;

-- Member reactions. client_event_id makes react idempotent across offline replays.
CREATE TABLE radio_reactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id      UUID NOT NULL REFERENCES radio_programs(id) ON DELETE CASCADE,
  member_id       UUID NOT NULL REFERENCES users(user_id),
  kind            TEXT NOT NULL CHECK (kind IN ('heart','amen','fire')),
  client_event_id TEXT UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_radio_reactions_program ON radio_reactions (program_id);

-- Member comments. Idempotent per client_event_id; moderators hide (soft) rows.
CREATE TABLE radio_comments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id      UUID NOT NULL REFERENCES radio_programs(id) ON DELETE CASCADE,
  member_id       UUID NOT NULL REFERENCES users(user_id),
  body            TEXT NOT NULL,
  hidden          BOOLEAN NOT NULL DEFAULT false,
  client_event_id TEXT UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_radio_comments_program ON radio_comments (program_id, created_at DESC);

-- Persisted mixer scene presets (Preaching / Worship / Prayer / Interview …).
CREATE TABLE mixer_scenes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  hint        TEXT,
  channels    JSONB NOT NULL DEFAULT '[]',
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_by  UUID REFERENCES users(user_id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Jingle soundboard entries.
CREATE TABLE mixer_jingles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label       TEXT NOT NULL,
  color       TEXT,
  audio_url   TEXT,
  sort        INT NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES users(user_id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE IF EXISTS mixer_jingles;
DROP TABLE IF EXISTS mixer_scenes;
DROP TABLE IF EXISTS radio_comments;
DROP TABLE IF EXISTS radio_reactions;
DROP TABLE IF EXISTS radio_programs;
