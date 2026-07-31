-- Widen the live reaction emoji set: 🔥 joins like/love (docs/LIVE_INTERACTIVE.md,
-- owner viewer-redesign ask). Forward-only: 180's CHECK is already applied.
ALTER TABLE live_stream_reactions DROP CONSTRAINT live_stream_reactions_emoji_check;
ALTER TABLE live_stream_reactions ADD CONSTRAINT live_stream_reactions_emoji_check
  CHECK (emoji IN ('like', 'love', 'fire'));

-- Down Migration
-- Narrowing the set again would leave any already-recorded 'fire' reactions in
-- violation of the restored CHECK, so drop those rows first. That is lossy by
-- nature — but a down migration that cannot run is worse than one that is
-- honest about what reversing costs (CI's `down all -> up all` gate proved the
-- point: this file having NO down section broke the reversibility check on
-- every commit after it landed).
DELETE FROM live_stream_reactions WHERE emoji = 'fire';
ALTER TABLE live_stream_reactions DROP CONSTRAINT live_stream_reactions_emoji_check;
ALTER TABLE live_stream_reactions ADD CONSTRAINT live_stream_reactions_emoji_check
  CHECK (emoji IN ('like', 'love'));
