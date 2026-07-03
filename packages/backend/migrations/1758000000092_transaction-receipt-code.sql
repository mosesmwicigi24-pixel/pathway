-- M-Pesa receipt code — the 10-char confirmation code (e.g. UG3J29U3OL) that
-- appears in the customer's M-Pesa SMS. It rides in the STK success callback's
-- CallbackMetadata (MpesaReceiptNumber) and is what members recognise on their
-- statement, unlike our internal CheckoutRequestID (ws_CO_…) provider_ref.
-- Purely additive + nullable: older gifts and non-mobile-money gifts stay null;
-- amounts, currency, the ledger, and settlement keys are untouched.

-- Up Migration

ALTER TABLE transactions ADD COLUMN receipt_code TEXT;

-- Down Migration

ALTER TABLE transactions DROP COLUMN IF EXISTS receipt_code;
