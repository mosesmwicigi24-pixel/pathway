-- Migration 180 · Nuru Live L5 interactions (docs/LIVE_INTERACTIVE.md)
-- ============================================================================
-- Makes a live broadcast two-way: reactions (like/love), raise-hand, live
-- chat, and (L6 scaffolding — video comes later) temporary on-stream guests.
-- All four tables hang off live_streams(stream_id) ON DELETE CASCADE, mirroring
-- live_viewers' idiom from migration 178.
-- ============================================================================

-- Up Migration

-- Append-only reaction events. Rate-limited to >=1s/user by the service layer
-- (an atomic INSERT ... WHERE NOT EXISTS guards the race, not a UNIQUE index —
-- multiple reactions per user ARE allowed, just not faster than 1/second).
CREATE TABLE live_stream_reactions (
  reaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id   UUID NOT NULL REFERENCES live_streams(stream_id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  emoji       VARCHAR(10) NOT NULL CHECK (emoji IN ('like', 'love')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_live_stream_reactions_stream ON live_stream_reactions (stream_id, occurred_at DESC);
CREATE INDEX idx_live_stream_reactions_stream_user ON live_stream_reactions (stream_id, user_id, occurred_at DESC);

-- One hand state per (stream, user) — idempotent upsert. "Currently raised"
-- is computed at read time as raised_at IS NOT NULL AND (lowered_at IS NULL OR
-- raised_at > lowered_at), so repeated raise/lower calls just move whichever
-- timestamp changed, never insert a duplicate row.
CREATE TABLE live_stream_hands (
  stream_id  UUID NOT NULL REFERENCES live_streams(stream_id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  raised_at  TIMESTAMPTZ,
  lowered_at TIMESTAMPTZ,
  PRIMARY KEY (stream_id, user_id)
);

-- Live chat. message_id is the client-visible cursor key alongside sent_at;
-- GET .../messages?since=<iso> polls ascending, capped at 200/poll.
CREATE TABLE live_stream_messages (
  message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id  UUID NOT NULL REFERENCES live_streams(stream_id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  body       VARCHAR(500) NOT NULL,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_live_stream_messages_stream_sent ON live_stream_messages (stream_id, sent_at ASC);

-- L6 scaffolding (video is a later phase against this same contract): per-
-- stream, per-user guest invite state machine. invited -> accepted|declined
-- -> removed|ended (stream end sweeps every invited/accepted row to 'ended').
CREATE TABLE live_stream_guests (
  stream_id    UUID NOT NULL REFERENCES live_streams(stream_id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  status       VARCHAR(10) NOT NULL DEFAULT 'invited'
                 CHECK (status IN ('invited', 'accepted', 'declined', 'removed', 'ended')),
  invited_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  PRIMARY KEY (stream_id, user_id)
);
CREATE INDEX idx_live_stream_guests_stream_status ON live_stream_guests (stream_id, status);

-- Down Migration

DROP TABLE IF EXISTS live_stream_guests;
DROP TABLE IF EXISTS live_stream_messages;
DROP TABLE IF EXISTS live_stream_hands;
DROP TABLE IF EXISTS live_stream_reactions;
