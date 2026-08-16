-- Migration 162 · Chat connections — consent-gated DMs (Chat Redesign C1)
-- ============================================================================
-- Today `/chat/dms` opens a DM unsolicited: the only checks are same-
-- congregation membership and minor-safety (D-M6). The owner spec requires an
-- explicit ask/accept handshake before two members can chat 1:1 — "no
-- unsolicited DMs." This migration adds the two tables that make that
-- possible. Nothing reads them yet (schema-only, C1); wiring `/chat/dms` to
-- require an accepted connection is a C2 service-layer change.
--
--   connection_requests — the PENDING handshake. One row per ask; resolved
--     into either a user_connections row (accepted) or left declined/
--     cancelled for history. Canonical unordered-pair columns (user_a < user_b)
--     so "one pending request per pair" is a plain partial unique index, not
--     app-level locking.
--   user_connections — the RESULT: accepted / blocked / removed. One row per
--     pair, again canonically ordered. `blocked_by` is directional (Ann can
--     block Ben without Ben's row disappearing from Ann's own history) — see
--     the Blocking-symmetry open question in docs/CHAT_REDESIGN_PLAN.md.
--
-- Migration strategy for EXISTING data: every current kind='dm' conversation
-- typed DIRECT by migration 161, with exactly two members, is grandfathered as
-- an ACCEPTED connection dated to the conversation's created_at. Consent is
-- prospective, not retroactive — members already mid-conversation lose
-- nothing and are not asked to re-consent (§ "Migration (no data loss)" in
-- docs/CHAT_REDESIGN.md). BROADCAST_RESPONSE-typed dm rows are deliberately
-- EXCLUDED: a broadcast recipient never consented to an ongoing relationship
-- with the sender, and the new permission model special-cases broadcast/
-- pastoral/discipler threads to bypass the connection gate entirely — they are
-- governed by their own relationship, not a peer connection.

-- Up Migration

CREATE TABLE IF NOT EXISTS connection_requests (
  request_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a              UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  user_b              UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  requester_id        UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  status              VARCHAR(10) NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','accepted','declined','cancelled')),
  message             VARCHAR(500),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at          TIMESTAMPTZ,
  decided_by          UUID REFERENCES users(user_id) ON DELETE SET NULL,
  client_mutation_id  UUID UNIQUE,
  CHECK (user_a < user_b),
  CHECK (requester_id IN (user_a, user_b))
);
-- One LIVE ask per pair — a second ask while one is pending is a 409 CONFLICT
-- at the service layer (C2); this index makes that true under a race, not just
-- under application discipline.
CREATE UNIQUE INDEX IF NOT EXISTS uq_connection_requests_pending
  ON connection_requests (user_a, user_b) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_connection_requests_user_a ON connection_requests (user_a, status);
CREATE INDEX IF NOT EXISTS idx_connection_requests_user_b ON connection_requests (user_b, status);

CREATE TABLE IF NOT EXISTS user_connections (
  user_a         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  user_b         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  status         VARCHAR(10) NOT NULL DEFAULT 'accepted'
                    CHECK (status IN ('accepted','blocked','removed')),
  blocked_by     UUID REFERENCES users(user_id) ON DELETE SET NULL,
  established_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b),
  CHECK (status = 'blocked' OR blocked_by IS NULL),
  CHECK (blocked_by IS NULL OR blocked_by IN (user_a, user_b))
);
CREATE INDEX IF NOT EXISTS idx_user_connections_user_b ON user_connections (user_b);

-- Backfill: grandfather every existing peer DM as an accepted connection.
-- LEAST/GREATEST normalizes to (user_a, user_b) regardless of chat_members
-- insertion order.
INSERT INTO user_connections (user_a, user_b, status, established_at, updated_at)
SELECT LEAST(a.user_id, b.user_id), GREATEST(a.user_id, b.user_id), 'accepted', cv.created_at, cv.created_at
  FROM chat_conversations cv
  JOIN chat_members a ON a.conversation_id = cv.conversation_id
  JOIN chat_members b ON b.conversation_id = cv.conversation_id AND b.user_id > a.user_id
 WHERE cv.kind = 'dm' AND cv.type = 'DIRECT'
   AND (SELECT count(*) FROM chat_members m WHERE m.conversation_id = cv.conversation_id) = 2
ON CONFLICT (user_a, user_b) DO NOTHING;

-- Down Migration

DROP INDEX IF EXISTS idx_user_connections_user_b;
DROP TABLE IF EXISTS user_connections;
DROP INDEX IF EXISTS idx_connection_requests_user_b;
DROP INDEX IF EXISTS idx_connection_requests_user_a;
DROP INDEX IF EXISTS uq_connection_requests_pending;
DROP TABLE IF EXISTS connection_requests;
