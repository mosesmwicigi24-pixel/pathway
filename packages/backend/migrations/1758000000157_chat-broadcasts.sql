-- Give a broadcast an identity.
--
-- chat.broadcast already fans ONE message out to every member as an individual
-- DM from the sender, so replies are private 1:1 threads that land back in the
-- sender's inbox — the semantics we want. What it lacks is a NOUN: the delivered
-- copies are indistinguishable from hand-typed DMs, so there is no way to ask
-- "who did this broadcast reach, and who answered it?" That is the whole of the
-- Broadcast tab, so the parent row is the primitive it was missing.
--
--   • chat_broadcasts        — the sent thing itself: body, audience, who, when,
--                              and the recipient count AS DELIVERED (not
--                              recomputed later, which is how the old replay path
--                              reported a number that never happened).
--   • chat_messages.broadcast_id — stamps each delivered copy back to its parent.
--                              Nullable + ON DELETE SET NULL: an ordinary DM has
--                              no broadcast, and deleting the parent record must
--                              never delete a member's conversation.
--
-- Responses need no column: a response is any message in a stamped copy's
-- conversation, authored by the recipient, after the copy landed.
--
-- audience: 'congregation' is the existing Instructor+ behaviour; 'all' is the
-- SuperAdmin reach across every congregation — including the ~1/3 of members who
-- have no congregation at all, who a congregation-scoped fan-out silently misses.

-- Up Migration
CREATE TABLE IF NOT EXISTS chat_broadcasts (
  broadcast_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  body               TEXT NOT NULL,
  msg_type           VARCHAR(8) NOT NULL DEFAULT 'text' CHECK (msg_type IN ('text','voice','image','file','video')),
  attachment_url     TEXT,
  audience           VARCHAR(12) NOT NULL CHECK (audience IN ('congregation','all')),
  -- The congregation it was scoped to, for an 'all' broadcast this is NULL.
  congregation_id    UUID REFERENCES congregations(congregation_id) ON DELETE SET NULL,
  -- How many members it actually reached, recorded at send time.
  recipient_count    INT NOT NULL DEFAULT 0,
  client_mutation_id UUID UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_broadcasts_sender ON chat_broadcasts (sender_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_broadcasts_recent ON chat_broadcasts (created_at DESC);

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS broadcast_id UUID
  REFERENCES chat_broadcasts(broadcast_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_broadcast ON chat_messages (broadcast_id)
  WHERE broadcast_id IS NOT NULL;

-- Down Migration
DROP INDEX IF EXISTS idx_chat_messages_broadcast;
ALTER TABLE chat_messages DROP COLUMN IF EXISTS broadcast_id;
DROP INDEX IF EXISTS idx_chat_broadcasts_recent;
DROP INDEX IF EXISTS idx_chat_broadcasts_sender;
DROP TABLE IF EXISTS chat_broadcasts;
