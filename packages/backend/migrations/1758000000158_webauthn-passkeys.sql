-- Passkey / WebAuthn sign-in (§5.3 strong auth). Credentials are the public keys
-- a platform authenticator (Touch ID / Face ID / Windows Hello) registered for a
-- user; challenges are the single-use server-side nonces both ceremonies sign.

-- Up Migration
CREATE TABLE webauthn_credentials (
  credential_id TEXT PRIMARY KEY,                -- base64url, exactly as sent on the wire
  user_id       UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  public_key    TEXT NOT NULL,                   -- base64url-encoded COSE public key
  sign_count    BIGINT NOT NULL DEFAULT 0,       -- authenticator counter (clone detection)
  transports    TEXT[] NOT NULL DEFAULT '{}',
  device_label  TEXT,                            -- "Mac · Chrome" — shown in Profile ▸ Passkeys
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ
);
CREATE INDEX webauthn_credentials_user_idx ON webauthn_credentials (user_id);

-- Single-use challenges (5-minute TTL). Deleted on use; expired rows are swept
-- opportunistically whenever new options are issued. user_id is NULL for the
-- anti-enumeration decoy issued to unknown emails on login/options.
CREATE TABLE webauthn_challenges (
  challenge  TEXT PRIMARY KEY,
  user_id    UUID REFERENCES users(user_id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('register','login')),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX webauthn_challenges_expiry_idx ON webauthn_challenges (expires_at);

-- Down Migration
DROP TABLE IF EXISTS webauthn_challenges;
DROP TABLE IF EXISTS webauthn_credentials;
