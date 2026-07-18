-- Migration 172 · Conversation mutes (Chat Redesign C4, docs/CHAT_REDESIGN.md
-- "Talk with My Pastor" §"⋮ menu — ... mute, archive, ..." + "Chat" §"Controls:
-- accept/decline, remove connection, block, report, mute, archive, ...")
-- ============================================================================
-- Per-PARTICIPANT, per-conversation — never a conversation-wide setting: my
-- muting a thread never silences it for the other side. `muted_until` NULL
-- means "muted forever" (until explicitly unmuted); a timestamp means "muted
-- through this instant" — the server treats it as active whenever
-- `muted_until IS NULL OR muted_until > now()`, and past-dated/expired rows
-- are left in place rather than swept (cheap, correct, self-expiring reads;
-- a fresh PUT simply overwrites the row via ON CONFLICT). One row per
-- (conversation, user) — PK enforces "at most one mute state", muting again
-- just updates `muted_until`.
--
-- Deliberately NOT a `chat_members` column: chat_members rows don't exist for
-- every conversation a user can act on (e.g. before the lazy space auto-join
-- in access()), and a mute is a purely notification-suppression concern, not
-- a membership fact — keeping it a separate table means the mute check never
-- has to reason about membership lifecycle (removed/suspended) at all.

-- Up Migration

CREATE TABLE IF NOT EXISTS conversation_mutes (
  conversation_id UUID NOT NULL REFERENCES chat_conversations(conversation_id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  muted_until     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_conversation_mutes_user ON conversation_mutes (user_id);

-- Down Migration

DROP INDEX IF EXISTS idx_conversation_mutes_user;
DROP TABLE IF EXISTS conversation_mutes;
