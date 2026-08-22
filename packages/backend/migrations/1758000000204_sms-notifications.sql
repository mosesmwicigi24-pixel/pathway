-- Migration 204 · Make the SMS toggle the app already shows mean something
-- ============================================================================
-- `notification_preferences.sms_enabled` has existed since migration 90, and
-- identity/service.ts reads and writes it as part of the iOS contract — so
-- members have had an SMS switch in the app this whole time.
--
-- It does nothing. `notif_channel` is ENUM('push','email'), so no code can
-- schedule a notification on the SMS channel at all; the switch has never been
-- connected to anything. This adds the missing value, and the pipeline changes
-- that go with it are in the same commit.
--
-- WHY `ALTER TYPE ... ADD VALUE` IS SAFE HERE, WHEN MIGRATION 43 SAID IT IS NOT
--
-- 43 chose CHECK-text over extending an enum, recording that "a value added in
-- a txn cannot also be USED in the same txn on some setups" under
-- node-pg-migrate's per-migration transaction. That constraint is about USING
-- the value, not adding it — migration 22 adds two values to `review_state` for
-- exactly this reason and is fine.
--
-- This adds 'sms' and writes no row with it. The first notification on that
-- channel is inserted by application code long after this has committed.
--
-- NOT REVERSIBLE, and the down migration says so rather than pretending:
-- PostgreSQL cannot drop an enum value. Same as migration 22.
-- ============================================================================

-- Up Migration

ALTER TYPE notif_channel ADD VALUE IF NOT EXISTS 'sms';

-- Down Migration

-- Nothing to undo. The 'sms' value is intentionally left in place — PostgreSQL
-- cannot drop one, and a rolled-back deployment that still held scheduled sms
-- rows would be unable to read its own notifications table without it.
-- `sms_enabled` is NOT dropped here either: it belongs to migration 90 and
-- predates this change.
SELECT 1;
