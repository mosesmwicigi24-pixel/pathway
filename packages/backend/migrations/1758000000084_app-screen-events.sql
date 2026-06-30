-- App-area dwell time capture (parity gap #3). Best-effort behavioural telemetry:
-- the mobile/iPad client batches per-screen dwell durations and posts them to
-- POST /me/activity/screens. Idempotent on client_event_id so offline replays of
-- the same batch never double-count. Analytics aggregates these into
-- engagement.area_dwell (top areas by total time, last 30 days). Non-sensitive
-- usage signal; no content gating implications (§1.9 unaffected).

-- Up Migration

CREATE TABLE app_screen_events (
  event_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  screen          VARCHAR(40) NOT NULL,
  duration_ms     INT NOT NULL,
  occurred_at     TIMESTAMPTZ NOT NULL,
  client_event_id UUID,
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_event_id)
);

CREATE INDEX app_screen_events_occurred_at_idx ON app_screen_events (occurred_at);
CREATE INDEX app_screen_events_screen_idx ON app_screen_events (screen);

-- Down Migration

DROP TABLE IF EXISTS app_screen_events;
