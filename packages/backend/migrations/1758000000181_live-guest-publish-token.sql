-- Migration 181 · Nuru Live L6a — guest WebRTC publish token (docs/LIVE_INTERACTIVE.md)
-- ============================================================================
-- L6 guests now get real sub-second video via MediaMTX WebRTC (WHIP publish /
-- WHEP read) on path `guest/<streamId>/<userId>`. A guest's publish/read
-- credential is a random per-(stream,user) token minted the moment they
-- ACCEPT an invite and cleared the moment they leave 'accepted' (declined,
-- removed, or swept to 'ended' at stream end) — never outlives the grant it
-- was minted for, same per-stream-only lifetime as the guest row itself.
-- ============================================================================

-- Up Migration

ALTER TABLE live_stream_guests ADD COLUMN guest_token VARCHAR(64);

-- Down Migration

ALTER TABLE live_stream_guests DROP COLUMN guest_token;
