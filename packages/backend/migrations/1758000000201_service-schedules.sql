-- Migration 201 · Weekly service schedules: the poster must never point at nothing
-- ============================================================================
-- The standing join QR (migration 200) resolves per-day to an OPEN service —
-- which means it resolves to nothing if nobody remembered to create this
-- Sunday's service in the portal. A weekly gathering is a rhythm, not a series
-- of one-off decisions; this table records the rhythm and the worker
-- materializes it into concrete church_services rows a week ahead
-- (idempotent against idx_church_services_slot, so a hand-created service and
-- a materialized one can never double up: same congregation, date and title
-- is one row, whoever made it).
--
-- Times are LOCAL (TIME + the congregation's own timezone column), because
-- "9 am Sunday" is a fact about Nairobi, not about UTC — and it must survive
-- any future DST-observing congregation without a migration.

-- Up Migration

CREATE TABLE service_schedules (
  schedule_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  congregation_id        UUID NOT NULL REFERENCES congregations(congregation_id) ON DELETE CASCADE,
  title                  TEXT NOT NULL,
  -- 0 = Sunday … 6 = Saturday, matching EXTRACT(DOW) so the materializer
  -- never translates between two numbering conventions.
  day_of_week            INT  NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  starts_time            TIME NOT NULL,
  duration_minutes       INT CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 15 AND 720),
  -- Check-in window, expressed relative to the start so the schedule carries
  -- the whole shape of the gathering. Defaults mirror the owner's own hand-
  -- created service: opens 45 minutes before, closes 4 hours after.
  checkin_opens_minutes  INT NOT NULL DEFAULT 45  CHECK (checkin_opens_minutes  BETWEEN 0 AND 720),
  checkin_closes_minutes INT NOT NULL DEFAULT 240 CHECK (checkin_closes_minutes BETWEEN 30 AND 1440),
  counts_for_streak      BOOLEAN NOT NULL DEFAULT TRUE,
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_by             UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (congregation_id, day_of_week, starts_time, title)
);

-- Full index, not partial: it serves both the materializer's active-only scan
-- and the FK-coverage rule (a CASCADE delete of a congregation must not seq-scan).
CREATE INDEX idx_service_schedules_congregation ON service_schedules (congregation_id);
-- created_by is ON DELETE SET NULL; deleting a user walks this FK too.
CREATE INDEX idx_service_schedules_created_by ON service_schedules (created_by);

-- Seed: derive each congregation's rhythm from its LATEST hand-created
-- service, so the week after this deploys behaves exactly like the week the
-- owner set up by hand. A congregation with no services yet gets no schedule
-- — a rhythm is declared by a person, not invented by a migration.
INSERT INTO service_schedules
  (congregation_id, title, day_of_week, starts_time, checkin_opens_minutes, checkin_closes_minutes,
   counts_for_streak, created_by)
SELECT DISTINCT ON (s.congregation_id)
  s.congregation_id,
  s.title,
  EXTRACT(DOW FROM (s.starts_at AT TIME ZONE c.timezone))::int,
  (s.starts_at AT TIME ZONE c.timezone)::time,
  COALESCE(EXTRACT(EPOCH FROM (s.starts_at - s.checkin_opens_at))::int / 60, 45),
  COALESCE(EXTRACT(EPOCH FROM (s.checkin_closes_at - s.starts_at))::int / 60, 240),
  s.counts_for_streak,
  s.created_by
FROM church_services s
JOIN congregations c USING (congregation_id)
ORDER BY s.congregation_id, s.starts_at DESC;

-- Down Migration

DROP TABLE service_schedules;
