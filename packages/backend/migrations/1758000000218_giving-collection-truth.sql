-- Giving cycles, Cycle 1 (owner request 2026-09-28): the truth about every
-- mobile-money prompt. Additive only.
--
-- 1. Why a payment failed. M-Pesa tells us (ResultCode 1032 = the member
--    cancelled, 1037 = the phone could not be reached, 1 = not enough in the
--    account, 2001 = wrong PIN, …) and we threw it away, so neither the member
--    nor the office could act on it. `failure_code` is our normalised word
--    (cancelled, unreachable, insufficient_funds, …); `failure_detail` keeps the
--    provider's own code and text for Reconciliation.
-- 2. Which billing cycle a scheduled charge belongs to (`schedule_cycle_at`),
--    so a retry of a cycle can prove no other attempt of that cycle succeeded
--    or is still waiting — the double-charge guard for retries.
-- 3. When the provider itself confirmed the outcome (`provider_checked_at`,
--    `verified_at`). Daraja callbacks are unsigned, so a callback is only a
--    hint: settlement waits for Safaricom's own status answer.
-- 4. A schedule's own number to prompt (`phone_number`; null = the member's
--    profile number) and the state of a retry inside the current cycle.

-- Up Migration

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS failure_code        TEXT,
  ADD COLUMN IF NOT EXISTS failure_detail      TEXT,
  ADD COLUMN IF NOT EXISTS failed_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS schedule_cycle_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_at         TIMESTAMPTZ;

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_failure_code_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_failure_code_check
  CHECK (failure_code IS NULL OR failure_code ~ '^[a-z_]{2,40}$');

-- Every attempt of one scheduled cycle, found in one probe.
CREATE INDEX IF NOT EXISTS idx_transactions_schedule_cycle
  ON transactions (schedule_id, schedule_cycle_at)
  WHERE schedule_id IS NOT NULL;
-- The mobile-money sweeper's working set: prompts still waiting on an answer.
CREATE INDEX IF NOT EXISTS idx_transactions_mm_processing
  ON transactions (created_at)
  WHERE status = 'processing' AND provider IN ('mpesa', 'airtel');

ALTER TABLE giving_schedules
  ADD COLUMN IF NOT EXISTS phone_number      TEXT,
  ADD COLUMN IF NOT EXISTS retry_cycle_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retry_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cycle_attempts    SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_failure_code TEXT;

-- A retry waiting to run is found without scanning every schedule.
CREATE INDEX IF NOT EXISTS idx_giving_schedules_retry
  ON giving_schedules (retry_at)
  WHERE status = 'active' AND retry_cycle_at IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS idx_giving_schedules_retry;
ALTER TABLE giving_schedules
  DROP COLUMN IF EXISTS last_failure_code,
  DROP COLUMN IF EXISTS cycle_attempts,
  DROP COLUMN IF EXISTS retry_at,
  DROP COLUMN IF EXISTS retry_cycle_at,
  DROP COLUMN IF EXISTS phone_number;
DROP INDEX IF EXISTS idx_transactions_mm_processing;
DROP INDEX IF EXISTS idx_transactions_schedule_cycle;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_failure_code_check;
ALTER TABLE transactions
  DROP COLUMN IF EXISTS verified_at,
  DROP COLUMN IF EXISTS provider_checked_at,
  DROP COLUMN IF EXISTS schedule_cycle_at,
  DROP COLUMN IF EXISTS failed_at,
  DROP COLUMN IF EXISTS failure_detail,
  DROP COLUMN IF EXISTS failure_code;
