-- Member notification preferences gain an SMS channel toggle (default OFF —
-- push/email stay the historical defaults from 1758000000007).

-- Up Migration

ALTER TABLE notification_preferences
  ADD COLUMN sms_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Down Migration

ALTER TABLE notification_preferences DROP COLUMN IF EXISTS sms_enabled;
