-- Migration 211 · A recurring gift that fails must say so (owner, 2026-08-28).
--
-- runDueSchedules caught every failure with a bare `catch { failed += 1 }`:
-- nothing logged, nothing recorded, nobody told. A partner whose M-Pesa push
-- kept failing was invisible to themselves AND to the church, while the
-- scheduler retried them every five minutes forever. These columns make the
-- failure visible, bounded, and recoverable.
--
-- SAFETY: `next_run_at` remains the CYCLE anchor — the per-cycle idempotency
-- key is `sched:{schedule_id}:{next_run_at}`, so retries inside a cycle reuse
-- the same key and can never double-charge. Backoff therefore rides a SEPARATE
-- `retry_after` gate; next_run_at only ever advances on success.

-- Up Migration
ALTER TABLE giving_schedules ADD COLUMN IF NOT EXISTS consecutive_failures INT NOT NULL DEFAULT 0;
ALTER TABLE giving_schedules ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE giving_schedules ADD COLUMN IF NOT EXISTS last_failed_at TIMESTAMPTZ;
-- When the next ATTEMPT of the current cycle may run (backoff). Null = now.
ALTER TABLE giving_schedules ADD COLUMN IF NOT EXISTS retry_after TIMESTAMPTZ;
ALTER TABLE giving_schedules ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;

-- 'paused' joins the status vocabulary: a schedule stopped by repeated failure
-- is NOT cancelled — the member's intent stands and one tap resumes it.
ALTER TABLE giving_schedules DROP CONSTRAINT IF EXISTS giving_schedules_status_check;
ALTER TABLE giving_schedules ADD CONSTRAINT giving_schedules_status_check
  CHECK (status IN ('active', 'paused', 'cancelled'));

-- The due index must respect the backoff gate, or a backed-off schedule is
-- still scanned every tick.
DROP INDEX IF EXISTS idx_giving_schedules_due;
CREATE INDEX idx_giving_schedules_due
  ON giving_schedules (next_run_at)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_giving_schedules_attention
  ON giving_schedules (status, consecutive_failures DESC)
  WHERE consecutive_failures > 0;

-- Down Migration
DROP INDEX IF EXISTS idx_giving_schedules_attention;
ALTER TABLE giving_schedules DROP CONSTRAINT IF EXISTS giving_schedules_status_check;
ALTER TABLE giving_schedules ADD CONSTRAINT giving_schedules_status_check
  CHECK (status IN ('active', 'cancelled'));
ALTER TABLE giving_schedules DROP COLUMN IF EXISTS paused_at;
ALTER TABLE giving_schedules DROP COLUMN IF EXISTS retry_after;
ALTER TABLE giving_schedules DROP COLUMN IF EXISTS last_failed_at;
ALTER TABLE giving_schedules DROP COLUMN IF EXISTS last_error;
ALTER TABLE giving_schedules DROP COLUMN IF EXISTS consecutive_failures;
