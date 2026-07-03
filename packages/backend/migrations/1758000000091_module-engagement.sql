-- Module engagement — per (user, module) accumulated reading/audio/video seconds
-- plus the last page the reader was on. Heartbeat deltas are clamped server-side
-- (each ≤ 600s — a heartbeat can never claim more than 10 minutes) before being
-- accumulated; the §1.9 gating check is enforced at the API layer, so a member
-- can never write engagement for content they cannot open.

-- Up Migration

CREATE TABLE module_engagement (
  user_id         UUID NOT NULL REFERENCES users(user_id),
  module_id       UUID NOT NULL REFERENCES modules(module_id),
  reading_seconds INT NOT NULL DEFAULT 0,
  audio_seconds   INT NOT NULL DEFAULT 0,
  video_seconds   INT NOT NULL DEFAULT 0,
  last_page       INT NOT NULL DEFAULT 1 CHECK (last_page >= 1),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, module_id)
);

-- Down Migration

DROP TABLE IF EXISTS module_engagement;
