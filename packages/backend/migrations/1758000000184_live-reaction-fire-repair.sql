-- Migration 184 · Repair: 🔥 reactions were never actually allowed
-- ============================================================================
-- Migration 182 is recorded as applied in every database that has run it, but it
-- had no `-- Up Migration` marker — so node-pg-migrate executed the WHOLE file as
-- the up migration: it widened the CHECK to ('like','love','fire') and then ran
-- its own down section, narrowing it straight back to ('like','love'). The
-- migration is stamped in `pgmigrations`, so it will never re-run; the fix has to
-- be a new migration. Symptom: POST /v1/live/streams/:id/reactions with
-- emoji=fire → 500 (check constraint violation), which is exactly what
-- test/live-interactions.test.ts has been reporting.
--
-- 182 itself now carries the marker so fresh databases get the wide CHECK
-- directly; this file is idempotent, so applying both in sequence is a no-op.

-- Up Migration
ALTER TABLE live_stream_reactions DROP CONSTRAINT IF EXISTS live_stream_reactions_emoji_check;
ALTER TABLE live_stream_reactions ADD CONSTRAINT live_stream_reactions_emoji_check
  CHECK (emoji IN ('like', 'love', 'fire'));

-- Down Migration
-- Same honest, lossy reversal as 182: 'fire' rows cannot survive a narrowed CHECK.
DELETE FROM live_stream_reactions WHERE emoji = 'fire';
ALTER TABLE live_stream_reactions DROP CONSTRAINT IF EXISTS live_stream_reactions_emoji_check;
ALTER TABLE live_stream_reactions ADD CONSTRAINT live_stream_reactions_emoji_check
  CHECK (emoji IN ('like', 'love'));
