-- Migration 225 · Gifts paid straight to the paybill number
-- ============================================================================
-- Until now the only M-Pesa money the system knew about was money it ASKED
-- for: an STK prompt the app or website sent, settled when Safaricom confirmed
-- it. A member who opens M-Pesa themselves, chooses Lipa na M-Pesa → Pay Bill,
-- types the church's business number and pays, was invisible — the money
-- reached the church's till, the treasurer saw it on the M-Pesa statement,
-- and the hub, the reports and the member's own statement never heard of it.
--
-- Daraja's C2B "confirmation" callback is Safaricom telling us about every
-- payment that lands on the shortcode, prompted or not. This migration gives
-- such a payment a home:
--   · `source = 'paybill'` — a fourth origin beside app / website / admin;
--   · `bill_reference` — what the payer typed as the account number (a fund
--     code, a name, a phone, anything), kept verbatim for the office;
--   · a payment is attributable through its M-Pesa receipt (TransID) even
--     when Safaricom masks the payer's number, the way an office record is
--     attributable through being an office record;
--   · `mpesa_c2b_events` — every confirmation as received, with what was done
--     about it, so a payment the treasurer sees on the M-Pesa statement can
--     always be traced to the row it became (or to why it did not become one).
--
-- SAFETY: additive and reversible. Existing rows keep describing themselves.
-- ============================================================================

-- Up Migration

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_source_check;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_source_check
  CHECK (source IN ('app', 'website', 'admin', 'paybill'));

ALTER TABLE transactions ADD COLUMN bill_reference TEXT;

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_memberless_source;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_memberless_source
  CHECK (user_id IS NOT NULL OR source IN ('website', 'admin', 'paybill'));

-- A paybill payment is attributable through its receipt code: the M-Pesa
-- statement carries the same TransID, so the office can always find it.
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_attributable;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_attributable
  CHECK (user_id IS NOT NULL
         OR giver_phone IS NOT NULL
         OR (source = 'admin' AND office_channel IS NOT NULL)
         OR (source = 'paybill' AND receipt_code IS NOT NULL));

-- One payment, one LIVE record. A prompt's own payment can also arrive through
-- the paybill confirmation; when the prompt then settles, the paybill row is
-- reversed (refunded) and keeps the receipt code as its trace, so the index
-- must let a reversed row share the code with the live one — the same rule the
-- office M-Pesa index (below) has had since 216.
DROP INDEX IF EXISTS transactions_receipt_code_uniq;
CREATE UNIQUE INDEX transactions_receipt_code_uniq ON transactions (receipt_code)
  WHERE receipt_code IS NOT NULL AND status NOT IN ('failed', 'refunded');

CREATE TABLE mpesa_c2b_events (
  trans_id        TEXT PRIMARY KEY,                       -- Safaricom's TransID (the receipt code)
  shortcode       TEXT NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  trans_time      TIMESTAMPTZ,                            -- Safaricom's TransTime, EAT
  amount_minor    BIGINT NOT NULL,
  msisdn          TEXT,                                   -- as received (masked by Safaricom for most paybills)
  bill_reference  TEXT,
  payer_name      TEXT,
  outcome         TEXT NOT NULL CHECK (outcome IN ('recorded', 'matched_prompt', 'duplicate', 'rejected')),
  note            TEXT,
  transaction_id  UUID REFERENCES transactions(transaction_id) ON DELETE SET NULL,
  payload         JSONB NOT NULL
);
CREATE INDEX mpesa_c2b_events_transaction_idx ON mpesa_c2b_events (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX mpesa_c2b_events_received_idx ON mpesa_c2b_events (received_at DESC);

-- The last time the C2B URLs were registered with Safaricom, for the Settings
-- page: registration is a one-off per shortcode and easy to forget after a
-- domain change.
CREATE TABLE mpesa_c2b_registrations (
  registration_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shortcode        TEXT NOT NULL,
  confirmation_url TEXT NOT NULL,
  validation_url   TEXT NOT NULL,
  response         JSONB,
  registered_by    UUID REFERENCES users(user_id) ON DELETE SET NULL,
  registered_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mpesa_c2b_registrations_by_idx ON mpesa_c2b_registrations (registered_by) WHERE registered_by IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS transactions_receipt_code_uniq;
CREATE UNIQUE INDEX transactions_receipt_code_uniq ON transactions (receipt_code) WHERE receipt_code IS NOT NULL AND status <> 'failed';
DROP TABLE IF EXISTS mpesa_c2b_registrations;
DROP TABLE IF EXISTS mpesa_c2b_events;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_attributable;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_attributable
  CHECK (user_id IS NOT NULL OR giver_phone IS NOT NULL OR (source = 'admin' AND office_channel IS NOT NULL));
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_memberless_source;
-- Paybill rows have no member; rolling back is a decision to discard them.
DELETE FROM ledger_entries WHERE transaction_id IN (SELECT transaction_id FROM transactions WHERE source = 'paybill');
DELETE FROM transactions WHERE source = 'paybill';
ALTER TABLE transactions
  ADD CONSTRAINT transactions_memberless_source
  CHECK (user_id IS NOT NULL OR source IN ('website', 'admin'));
ALTER TABLE transactions DROP COLUMN IF EXISTS bill_reference;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_source_check;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_source_check
  CHECK (source IN ('app', 'website', 'admin'));
