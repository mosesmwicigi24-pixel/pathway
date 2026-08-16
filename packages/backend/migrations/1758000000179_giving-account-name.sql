-- "Named giving" (owner spec, 2026-07): on the CUSTOM giving sheet the member
-- may optionally name their gift (e.g. "Tithe", "Building Fund", a loved one's
-- name) — like an M-Pesa Paybill account name. A sanitized, truncated version
-- rides the M-Pesa STK push AccountReference (see providers.ts) so the
-- church's M-Pesa statement shows it; the as-entered name persists here for
-- receipts/statements/portal Finance. Purely additive + nullable: older gifts
-- and non-mobile-money gifts stay null; amounts, currency, the ledger, and
-- settlement keys are untouched.

-- Up Migration

ALTER TABLE transactions ADD COLUMN account_name TEXT;

-- Down Migration

ALTER TABLE transactions DROP COLUMN IF EXISTS account_name;
