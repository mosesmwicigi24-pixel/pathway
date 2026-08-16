-- Migration 165 · Broadcast reply policy (Chat Redesign C1)
-- ============================================================================
-- chat.broadcast() today has exactly one reply behaviour, hard-coded: every
-- recipient's copy lands in an ordinary 1:1 DM with the sender, and any reply
-- they type is a normal message in that thread. The owner spec wants that
-- CONFIGURABLE per broadcast: none / an official response inbox / ordinary
-- chat (today's behaviour) / a linked response thread — and is explicit that
-- replies never route to Talk with My Pastor unless configured to.
--
-- Column only, C1. The default ('ordinary_chat') IS today's actual behaviour,
-- so every existing chat_broadcasts row keeps behaving exactly as it already
-- does; nothing downstream reads this column until C2 wires the four modes
-- into ChatService#broadcast.

-- Up Migration

ALTER TABLE chat_broadcasts
  ADD COLUMN IF NOT EXISTS reply_policy VARCHAR(20) NOT NULL DEFAULT 'ordinary_chat'
    CHECK (reply_policy IN ('none','official_inbox','ordinary_chat','linked_thread'));

-- Down Migration

ALTER TABLE chat_broadcasts DROP COLUMN IF EXISTS reply_policy;
