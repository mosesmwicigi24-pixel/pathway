-- Migration 206 · A durable record that the giver was actually texted
-- ============================================================================
-- The 21:54 gift on 2026-08-22: outbox job `done`, zero attempts, and the
-- receipt SMS never arrived. Investigating it exposed the gap this closes —
-- `done` proves only that the handler RAN. It returns `done` when the provider
-- is unbound, when the gift is not settled, when there is no phone, and when
-- Africa's Talking genuinely accepted the message. Four different worlds, one
-- indistinguishable outbox row, and the only evidence was container logs that
-- rotate away.
--
-- So the send now leaves a trace on the transaction itself:
--
--   receipt_sms_at   when Africa's Talking accepted the receipt
--   receipt_sms_ref  their message id, quotable in a support ticket
--
-- NULL means "never accepted", loudly and permanently. "Was this giver
-- thanked?" becomes a query instead of a log hunt.
--
-- This doubles as the idempotency the handler never had: the outbox is
-- at-least-once, and the old code accepted a duplicate text as a tolerable
-- cost. Now a redelivery sees receipt_sms_at IS NOT NULL and stops.
-- ============================================================================

-- Up Migration

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS receipt_sms_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS receipt_sms_ref VARCHAR(100);

COMMENT ON COLUMN transactions.receipt_sms_at IS
  'When the thank-you SMS was ACCEPTED by the provider. NULL = never sent.';
COMMENT ON COLUMN transactions.receipt_sms_ref IS
  'Provider message id for the thank-you SMS — quotable to Africa''s Talking support.';

-- Down Migration

ALTER TABLE transactions
  DROP COLUMN IF EXISTS receipt_sms_at,
  DROP COLUMN IF EXISTS receipt_sms_ref;
