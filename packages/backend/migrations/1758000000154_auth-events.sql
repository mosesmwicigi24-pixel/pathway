-- True login telemetry (leadership brief §3 gap): until now "activity" was
-- inferred from content actions; this records the actual front door.

-- Up Migration
CREATE TABLE auth_events (
  event_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  kind      TEXT NOT NULL CHECK (kind IN ('login','mfa_login')),
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auth_events_user_at_idx ON auth_events (user_id, at DESC);
CREATE INDEX auth_events_at_idx ON auth_events (at DESC);

-- Down Migration
DROP TABLE IF EXISTS auth_events;
