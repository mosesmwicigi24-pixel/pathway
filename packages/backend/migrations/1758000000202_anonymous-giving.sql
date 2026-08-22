-- Migration 201 · Gifts from people who are not members
-- ============================================================================
-- `transactions.user_id` has been NOT NULL since migration 6, which encodes an
-- assumption that was true until now: every gift comes from someone with an
-- account. A visitor on nuruplace.org has no account, no cell and no level.
-- They have a phone and an intention to give.
--
-- The alternative was auto-creating a user row for every stranger who gives
-- once. That keeps this table unchanged at the cost of a membership roster
-- filling with people who are not members — the same objection that kept
-- website enquiries out of care_signals. A gift from a stranger IS a real
-- transaction that is not attributable to a member, and the ledger should be
-- able to say so.
--
-- SAFETY: this table is the money. Everything here is additive and reversible.
-- Dropping NOT NULL cannot invalidate an existing row, the new columns are
-- nullable, and `source` defaults to 'app' so every row written before today
-- keeps describing itself correctly.
-- ============================================================================

-- Up Migration

ALTER TABLE transactions ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE transactions
  ADD COLUMN source      VARCHAR(20) NOT NULL DEFAULT 'app'
    CHECK (source IN ('app', 'website', 'admin')),
  ADD COLUMN giver_name  VARCHAR(120),
  ADD COLUMN giver_phone VARCHAR(32),
  ADD COLUMN giver_email VARCHAR(255);

-- A row must be attributable to SOMEBODY. Without this, dropping NOT NULL
-- would allow a transaction belonging to no one at all — money in the ledger
-- with nothing to reconcile it against, which is worse than the constraint we
-- just relaxed.
ALTER TABLE transactions
  ADD CONSTRAINT transactions_attributable
  CHECK (user_id IS NOT NULL OR giver_phone IS NOT NULL);

-- Only a website gift may be memberless. An 'app' row with no user_id would
-- mean a member's gift lost its member, which is a bug rather than a case.
ALTER TABLE transactions
  ADD CONSTRAINT transactions_memberless_only_from_website
  CHECK (user_id IS NOT NULL OR source = 'website');

-- Reconciliation looks people up by the number that paid — "someone rang about
-- a gift from 0722…". Partial, because the column is null for every app gift.
CREATE INDEX idx_transactions_giver_phone
  ON transactions (giver_phone) WHERE giver_phone IS NOT NULL;

-- "How much came through the website this month?" is a question the treasurer
-- will ask on day one.
CREATE INDEX idx_transactions_source_created
  ON transactions (source, created_at DESC);

-- Down Migration

DROP INDEX IF EXISTS idx_transactions_source_created;
DROP INDEX IF EXISTS idx_transactions_giver_phone;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_memberless_only_from_website;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_attributable;
ALTER TABLE transactions
  DROP COLUMN IF EXISTS giver_email,
  DROP COLUMN IF EXISTS giver_phone,
  DROP COLUMN IF EXISTS giver_name,
  DROP COLUMN IF EXISTS source;
-- Restoring NOT NULL would fail if any memberless row survives, so clear those
-- first. They only exist if the website feature ran, and rolling this back is
-- a decision to discard exactly those.
DELETE FROM transactions WHERE user_id IS NULL;
ALTER TABLE transactions ALTER COLUMN user_id SET NOT NULL;
