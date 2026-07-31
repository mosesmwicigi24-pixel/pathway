-- Widen the live reaction emoji set: 🔥 joins like/love (docs/LIVE_INTERACTIVE.md,
-- owner viewer-redesign ask). Forward-only: 180's CHECK is already applied.
ALTER TABLE live_stream_reactions DROP CONSTRAINT live_stream_reactions_emoji_check;
ALTER TABLE live_stream_reactions ADD CONSTRAINT live_stream_reactions_emoji_check
  CHECK (emoji IN ('like', 'love', 'fire'));
