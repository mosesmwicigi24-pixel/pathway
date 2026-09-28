-- Giving cycles, Cycle 8 (owner request 2026-09-28): giving at scale.
-- Additive indexes only.
--
-- `transactions` had no index on user_id or fund_id: every member-scoped
-- giving read — the Give tab's history, the one-prompt-at-a-time check made
-- before every M-Pesa prompt, statements, receipts, Try again, the office's
-- per-partner totals — and every per-fund total read the WHOLE table. Fine at
-- a few thousand gifts; a sequential scan per prompt at a few hundred
-- thousand.
--
-- Plain CREATE INDEX (node-pg-migrate runs each migration in a transaction,
-- which CONCURRENTLY cannot): it holds a write lock on transactions only for
-- as long as the build takes — well under a second at today's size. Check the
-- row count before deploying if it has grown by orders of magnitude.

-- Up Migration

CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_fund_status_created ON transactions (fund_id, status, created_at);

-- Down Migration

DROP INDEX IF EXISTS idx_transactions_fund_status_created;
DROP INDEX IF EXISTS idx_transactions_user_created;
