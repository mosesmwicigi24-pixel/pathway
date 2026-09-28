-- Giving cycles, Cycle 4 (owner request 2026-09-28): a recurring gift the
-- member controls. Additive.
--
-- 1. Why a schedule is paused (`pause_reason`): three failed prompts in a row
--    ('failures'), the member's own choice ('member', optionally until
--    `resume_on`), or its pledge being paused ('pledge' — resumed by resuming
--    the pledge). Before, all three looked the same.
-- 2. A heads-up before each prompt (`heads_up`, on by default): an M-Pesa PIN
--    prompt that arrives out of nowhere is dismissed as a scam; a push minutes
--    before says it is coming. `heads_up_cycle_at` records the cycle already
--    announced, so two scheduler runs never announce it twice.

-- Up Migration

ALTER TABLE giving_schedules
  ADD COLUMN IF NOT EXISTS pause_reason TEXT
    CHECK (pause_reason IS NULL OR pause_reason IN ('failures', 'member', 'pledge')),
  ADD COLUMN IF NOT EXISTS resume_on DATE,
  ADD COLUMN IF NOT EXISTS heads_up BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS heads_up_cycle_at TIMESTAMPTZ;

-- Existing pauses: a schedule paused after its third failure, else by its pledge.
UPDATE giving_schedules s
   SET pause_reason = CASE WHEN s.consecutive_failures >= 3 THEN 'failures'
                           WHEN EXISTS (SELECT 1 FROM pledges p WHERE p.schedule_id = s.schedule_id AND p.status = 'paused') THEN 'pledge'
                           ELSE 'member' END
 WHERE s.status = 'paused' AND s.pause_reason IS NULL;

-- The auto-resume scan: member pauses with a date.
CREATE INDEX IF NOT EXISTS idx_giving_schedules_resume_on
  ON giving_schedules (resume_on)
  WHERE status = 'paused' AND resume_on IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS idx_giving_schedules_resume_on;
ALTER TABLE giving_schedules
  DROP COLUMN IF EXISTS heads_up_cycle_at,
  DROP COLUMN IF EXISTS heads_up,
  DROP COLUMN IF EXISTS resume_on,
  DROP COLUMN IF EXISTS pause_reason;
