-- Migration 200 · The standing join code: one printed QR per congregation
-- ============================================================================
-- The owner's ask (2026-08-21): a QR he can PRINT ONCE — "consistent, but when
-- scanned on one date it fills the details of that person on that day".
--
-- The per-service QR (#427/#429) cannot be printed: its token dies with the
-- service's check-in window, by design. So the stable thing cannot be a service
-- credential — it has to be an ADDRESS. This column is that address: an opaque
-- code the poster URL carries (/jc/<join_code>), which the server resolves AT
-- SCAN TIME to whichever of the congregation's services has an open check-in
-- window. The poster never changes; what it points at changes every Sunday.
--
-- What this deliberately does NOT weaken: the window. A photographed poster
-- resolves to nothing outside check-in hours, exactly like a photographed
-- projection. What it DOES concede — stated to the owner, accepted by the
-- owner — is that during an open window the poster URL works from anywhere,
-- not only from inside the room. The bounds that held for scan-to-join hold
-- here: the window, the per-service join rate limits, and the recorded
-- joined_via_service_id on every account created through it.
--
-- The code is random and long enough that enumeration is not a survey of our
-- congregations. Rotating it (a manual UPDATE, or a future admin control)
-- invalidates every poster ever printed — which is the recovery story if one
-- leaks somewhere we mind.

-- Up Migration

ALTER TABLE congregations ADD COLUMN join_code TEXT;

-- 64 hex chars of entropy per congregation. Two uuids rather than pgcrypto's
-- gen_random_bytes, so this migration adds no extension dependency.
UPDATE congregations
   SET join_code = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

ALTER TABLE congregations ALTER COLUMN join_code SET NOT NULL;

-- New congregations mint their own code on insert; nobody has to remember to.
ALTER TABLE congregations
  ALTER COLUMN join_code
  SET DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

CREATE UNIQUE INDEX congregations_join_code_key ON congregations (join_code);

-- Down Migration

DROP INDEX congregations_join_code_key;
ALTER TABLE congregations DROP COLUMN join_code;
