-- Migration 197 · Scan-to-join, and follow-up cadences
-- ============================================================================
-- Two things the church asked for on top of #427's attendance:
--
--   1. A visitor who scans the projected code should leave the service already
--      a member — account, pathway, and their attendance recorded, without
--      anyone typing their details in afterwards.
--   2. Follow-up should carry a CADENCE: a defined sequence of touches after
--      someone first visits or stops coming. Some steps are sent by the system,
--      some are a leader picking up the phone and then recording that they did.
--
-- ON LETTING A SCAN CREATE AN ACCOUNT. The owner chose this deliberately over a
-- pending-approval flow, having been shown the risk: the code is projected in a
-- public room, so anyone who photographs it could self-register. Three things
-- bound that without slowing a real visitor down, and they are enforced in the
-- service layer rather than left as intentions:
--   * a join only works while that service's check-in window is OPEN, so a
--     photographed code is dead by Monday;
--   * joins are rate-limited per service;
--   * every join records the service it came through (joined_via_service_id),
--     so an unusual burst is visible in one query rather than invisible.
--
-- The QR payload also has to change. #427 encodes `nuru-service:<id>:<token>`,
-- which is not a URL — a visitor pointing their phone's own camera at it sees
-- plain text and nothing happens, so scan-to-join would only ever work for
-- people who already had the app. The payload becomes an https:// link that
-- opens the app when installed and a join page when not. Old-format codes are
-- still parsed, so app builds already in members' hands keep working.

-- Up Migration

-- ── Where a member came from ────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS joined_via_service_id UUID
  REFERENCES church_services(service_id) ON DELETE SET NULL;
COMMENT ON COLUMN users.joined_via_service_id IS
  'The service whose QR this member joined through, when they self-registered by scanning. NULL for every other route in. Kept so a burst of joins on one service is one query away.';
CREATE INDEX IF NOT EXISTS idx_users_joined_via_service ON users(joined_via_service_id)
  WHERE joined_via_service_id IS NOT NULL;

-- ── Cadence definitions ─────────────────────────────────────────────────────
-- A named sequence, per congregation, triggered by something happening to a
-- member. Kept as data rather than code so a pastor can change the rhythm
-- without a deploy.
CREATE TABLE IF NOT EXISTS follow_up_cadences (
  cadence_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  congregation_id UUID NOT NULL REFERENCES congregations(congregation_id) ON DELETE CASCADE,
  name            VARCHAR(120) NOT NULL,
  trigger         TEXT NOT NULL CHECK (trigger IN ('first_visit', 'missed_services', 'joined_online')),
  -- For 'missed_services': how many consecutive misses arm the cadence.
  trigger_threshold INT NOT NULL DEFAULT 1 CHECK (trigger_threshold BETWEEN 1 AND 52),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (congregation_id, name)
);

-- ── The steps within a cadence ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS follow_up_cadence_steps (
  step_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cadence_id   UUID NOT NULL REFERENCES follow_up_cadences(cadence_id) ON DELETE CASCADE,
  -- Days after the trigger. 0 = same day.
  offset_days  INT NOT NULL CHECK (offset_days BETWEEN 0 AND 365),
  -- 'automated' steps are dispatched by the worker; 'human' steps wait for a
  -- leader to do the thing and record it. The owner wanted both in one rhythm.
  kind         TEXT NOT NULL CHECK (kind IN ('automated', 'human')),
  -- automated: which channel. human: what the leader is being asked to do.
  channel      TEXT CHECK (channel IN ('push', 'sms', 'email')),
  action       VARCHAR(120) NOT NULL,
  message      TEXT,
  sequence     INT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cadence_id, sequence),
  -- An automated step without a channel has no way to be sent; a human step
  -- with one implies an automation that will never happen. Both are the kind of
  -- half-configured row that looks fine until nobody is contacted.
  CHECK ((kind = 'automated' AND channel IS NOT NULL) OR (kind = 'human' AND channel IS NULL))
);

-- ── A cadence running for one member ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS follow_up_runs (
  run_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cadence_id   UUID NOT NULL REFERENCES follow_up_cadences(cadence_id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  -- What set it off, so the register can say "after the 17 Aug service".
  service_id   UUID REFERENCES church_services(service_id) ON DELETE SET NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Closed when the member returns, or when a leader stops it by hand.
  closed_at    TIMESTAMPTZ,
  closed_reason TEXT CHECK (closed_reason IN ('returned', 'completed', 'stopped_by_leader')),
  UNIQUE (cadence_id, user_id, started_at)
);
CREATE INDEX IF NOT EXISTS idx_follow_up_runs_open ON follow_up_runs(user_id)
  WHERE closed_at IS NULL;

-- ── What actually happened on each step ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS follow_up_step_events (
  event_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL REFERENCES follow_up_runs(run_id) ON DELETE CASCADE,
  step_id     UUID NOT NULL REFERENCES follow_up_cadence_steps(step_id) ON DELETE CASCADE,
  due_at      TIMESTAMPTZ NOT NULL,
  -- A human step is done when a leader says so and names themselves; an
  -- automated one when the worker dispatched it.
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  outcome      TEXT CHECK (outcome IN ('reached', 'no_answer', 'wrong_number', 'sent', 'failed', 'skipped')),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, step_id)
);
-- The Follow-Up tab's core question: who is due, oldest first.
CREATE INDEX IF NOT EXISTS idx_follow_up_due ON follow_up_step_events(due_at)
  WHERE completed_at IS NULL;

-- ── Cascade paths ───────────────────────────────────────────────────────────
-- Every single-column FK with ON DELETE CASCADE or SET NULL needs an index on
-- the referencing side, or deleting one parent row seq-scans the child table.
-- Migration 191 indexed 63 such paths across the schema and left a test behind;
-- that test caught these four the moment they were written, which is what a
-- guard is for. The two `created_by`/`completed_by` columns matter most: they
-- point at users, and retiring a member should not scan the follow-up history.
CREATE INDEX IF NOT EXISTS idx_follow_up_cadences_created_by
  ON follow_up_cadences(created_by);
CREATE INDEX IF NOT EXISTS idx_follow_up_runs_service
  ON follow_up_runs(service_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_step_events_completed_by
  ON follow_up_step_events(completed_by);
CREATE INDEX IF NOT EXISTS idx_follow_up_step_events_step
  ON follow_up_step_events(step_id);

-- Down Migration
DROP TABLE IF EXISTS follow_up_step_events;
DROP TABLE IF EXISTS follow_up_runs;
DROP TABLE IF EXISTS follow_up_cadence_steps;
DROP TABLE IF EXISTS follow_up_cadences;
DROP INDEX IF EXISTS idx_users_joined_via_service;
ALTER TABLE users DROP COLUMN IF EXISTS joined_via_service_id;
