-- Migration 184 · Nuru Live — public share links (docs/LIVE_SHARE.md)
-- ============================================================================
-- Root cause (prod ground truth, 2026-07-31): the clients' "Share recording"
-- sends a BARE FILE URL as plain text. nginx served it 200 with NO auth of
-- any kind — a shared link (a) forces a 30MB+ download instead of playing,
-- (b) has no title/thumbnail/preview card, (c) is world-readable by anyone
-- who ever receives or forwards it, forever, and (d) has no way back into the
-- app. This adds the columns behind a real "Share a broadcast" feature: a
-- lazily-minted, revocable, opaque token that resolves through a proper
-- server-rendered /w/{token} page instead of a raw file URL.
-- ============================================================================

-- Up Migration

ALTER TABLE live_streams
  ADD COLUMN share_token TEXT,
  ADD COLUMN share_revoked_at TIMESTAMPTZ,
  ADD COLUMN poster_url TEXT;

-- UNIQUE + the required "index on share_token" in one: a partial unique index
-- (same idiom as idx_live_streams_recording_active in migration 183) rather
-- than an inline UNIQUE column constraint, since almost every row will have
-- share_token NULL (never shared) — no sense indexing that majority case.
-- Postgres uniqueness already treats multiple NULLs as non-conflicting, so a
-- plain UNIQUE would behave identically for correctness; this is purely the
-- leaner index shape.
CREATE UNIQUE INDEX idx_live_streams_share_token ON live_streams (share_token) WHERE share_token IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS idx_live_streams_share_token;
ALTER TABLE live_streams
  DROP COLUMN IF EXISTS share_token,
  DROP COLUMN IF EXISTS share_revoked_at,
  DROP COLUMN IF EXISTS poster_url;
