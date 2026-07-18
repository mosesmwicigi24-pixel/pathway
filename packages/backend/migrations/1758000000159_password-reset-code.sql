-- Code-first password reset: alongside the long link token, mint a short
-- human-typeable code (8 chars, unambiguous alphabet, normalized upper/no-dash
-- before hashing) that a member can key into the mobile app instead of copying
-- a 64-char hex string on a phone keyboard. Same row, same TTL, same
-- single-use semantics as the existing token_hash — this just adds a second
-- credential that redeems it. Nullable so pre-existing/in-flight rows (token
-- only) keep working unchanged through their TTL.
-- Up Migration
ALTER TABLE password_resets ADD COLUMN code_hash VARCHAR(64);

CREATE UNIQUE INDEX idx_password_resets_code ON password_resets(code_hash) WHERE code_hash IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS idx_password_resets_code;
ALTER TABLE password_resets DROP COLUMN IF EXISTS code_hash;
