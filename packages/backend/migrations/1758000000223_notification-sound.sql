-- Sound and vibration on notifications (owner request 2026-09-28): "a beep
-- sound / notification sound or vibrations on any message that comes in —
-- and a place you can mute it". Pushes carried no sound at all on iOS (an
-- APNs alert without `aps.sound` is silent) and one default-importance channel
-- on Android. They sound by default now; a member can mute them from the
-- app's settings, and a muted member's pushes still arrive — quietly.
-- Per-conversation mutes (migration 173) still silence a thread's pushes
-- entirely.
--
-- Additive: one column with a constant default (no table rewrite on PG ≥ 11).

-- Up Migration

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS sound_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Down Migration

ALTER TABLE notification_preferences DROP COLUMN IF EXISTS sound_enabled;
