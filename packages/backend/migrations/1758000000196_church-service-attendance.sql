-- Migration 196 · Church service attendance + attendance streaks
-- ============================================================================
-- Members scan the service QR on arrival and register their contact details
-- with the check-in, so the roster is a real attendance record (who was in the
-- room, reachable, and at what time) rather than a bare user_id join.
--
-- Distinct from `attendance_logs` (migrations 05/21), which records check-ins
-- against generic calendar EVENTS (cell gatherings, conferences, one-offs).
-- A church service is the weekly gathering the discipleship rhythm is measured
-- against, so it gets its own cadence table: services are the unit a streak is
-- counted in, and "missed" is only meaningful when the expected services are
-- enumerable. Keeping the two apart also keeps event RSVP/guest ops from
-- silently changing a member's service streak.
-- ============================================================================

-- Up Migration

CREATE TABLE church_services (
  service_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  congregation_id   UUID NOT NULL REFERENCES congregations(congregation_id) ON DELETE CASCADE,
  title             VARCHAR(255) NOT NULL,          -- "Sunday Second Service"
  service_date      DATE NOT NULL,                  -- the local calendar day it belongs to
  starts_at         TIMESTAMPTZ NOT NULL,
  ends_at           TIMESTAMPTZ,
  checkin_opens_at  TIMESTAMPTZ,                    -- null = open as soon as it exists
  checkin_closes_at TIMESTAMPTZ,                    -- null = never closes
  qr_secret         VARCHAR(255) NOT NULL,          -- HMAC seed for scan tokens (§5)
  qr_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  -- FALSE for a special/optional gathering that should not count as a "miss"
  -- against anyone's streak (e.g. an extra midweek service).
  counts_for_streak BOOLEAN NOT NULL DEFAULT TRUE,
  created_by        UUID REFERENCES users(user_id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One service of a given name per congregation per day — makes an accidental
-- double-create a conflict rather than a duplicate cadence slot that would
-- read as a "miss" for the whole congregation.
CREATE UNIQUE INDEX idx_church_services_slot
  ON church_services (congregation_id, service_date, title);

-- The streak walk and the "what's open right now" lookup both scan by
-- congregation newest-first.
CREATE INDEX idx_church_services_cadence
  ON church_services (congregation_id, starts_at DESC);

CREATE TABLE service_attendance (
  attendance_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id     UUID NOT NULL REFERENCES church_services(service_id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  -- Contact details as registered AT the check-in. Deliberately a snapshot and
  -- not a join to users: the roster must keep saying who was in the room and how
  -- to reach them on that day, even after the member later edits their profile.
  full_name      VARCHAR(255) NOT NULL,
  phone_number   VARCHAR(32)  NOT NULL,
  email          VARCHAR(255),
  attended_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),  -- time of attending the service
  method         VARCHAR(10)  NOT NULL DEFAULT 'qr',   -- 'qr' | 'manual'
  recorded_by    UUID REFERENCES users(user_id),       -- the leader, for manual
  note           TEXT,                                 -- manual check-in reason
  client_scan_id UUID UNIQUE,                          -- idempotent offline scan (§3.6)
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (user_id, service_id)
);

CREATE INDEX idx_service_attendance_service ON service_attendance (service_id);
-- The streak walk reads one member's whole attendance history in service order.
CREATE INDEX idx_service_attendance_user ON service_attendance (user_id, attended_at DESC);

-- Denormalized streak snapshot. The service layer recomputes this from the two
-- tables above on every check-in and on every read, so it is a cache and never
-- a second source of truth; it exists so leader/portal cohort queries ("who
-- broke their streak this month") stay a single indexed scan.
CREATE TABLE service_attendance_streaks (
  user_id           UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  current_streak    INT NOT NULL DEFAULT 0,   -- consecutive services attended, most recent back
  longest_streak    INT NOT NULL DEFAULT 0,
  total_attended    INT NOT NULL DEFAULT 0,
  total_missed      INT NOT NULL DEFAULT 0,   -- "failures": eligible services missed
  breaks            INT NOT NULL DEFAULT 0,   -- times an attended run was interrupted
  current_miss_run  INT NOT NULL DEFAULT 0,   -- consecutive misses right now
  last_attended_at  TIMESTAMPTZ,
  last_service_date DATE,
  status            VARCHAR(12) NOT NULL DEFAULT 'new',  -- new|active|at_risk|broken
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Whose streak is in trouble" — the at-risk cohort query the portal sorts on.
CREATE INDEX idx_service_streaks_status ON service_attendance_streaks (status, current_streak DESC);

-- Down Migration

DROP INDEX IF EXISTS idx_service_streaks_status;
DROP TABLE IF EXISTS service_attendance_streaks;
DROP INDEX IF EXISTS idx_service_attendance_user;
DROP INDEX IF EXISTS idx_service_attendance_service;
DROP TABLE IF EXISTS service_attendance;
DROP INDEX IF EXISTS idx_church_services_cadence;
DROP INDEX IF EXISTS idx_church_services_slot;
DROP TABLE IF EXISTS church_services;
