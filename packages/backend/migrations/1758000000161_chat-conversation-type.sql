-- Migration 161 · Conversation TYPE — the redesign's foundational column
-- (Chat Redesign C1 — docs/CHAT_REDESIGN_PLAN.md, docs/CHAT_REDESIGN.md)
-- ============================================================================
-- The owner spec requires six explicit conversation types — SPACE / DIRECT /
-- DISCIPLER / PASTORAL / BROADCAST / BROADCAST_RESPONSE — and is emphatic that
-- security must never be inferred from a title. `kind` (dm/group/space) stays
-- exactly as it is: it still describes the STRUCTURE (who is in the room, how
-- membership works). `type` is new and describes the PRIVACY/SECURITY CLASS.
-- No application code reads `type` yet — this migration only adds the column
-- and backfills it, so C2 can start consuming it without a second migration.
--
-- Backfill rules (see docs/CHAT_REDESIGN_PLAN.md § Migration strategy):
--   kind = 'space'                                    → SPACE
--   kind = 'group' (a cell room)                       → SPACE (cell rooms ARE
--                                                        spaces in the new
--                                                        model — their auto
--                                                        membership from
--                                                        cell_group_id already
--                                                        matches "derived space
--                                                        membership")
--   kind = 'dm' AND ever carried a message stamped
--     chat_messages.broadcast_id                        → BROADCAST_RESPONSE
--                                                        (this mirrors the
--                                                        EXISTING isBroadcastThread()
--                                                        runtime check in
--                                                        chat/service.ts —
--                                                        this migration
--                                                        materializes that same
--                                                        rule, it does not
--                                                        invent a new one)
--   kind = 'dm' between a CURRENT relationship_tree
--     edge (multiplier_id ↔ disciple_id), no broadcast   → DISCIPLER (the one
--                                                        already-explicit
--                                                        discipling relationship
--                                                        on file; a cell-leader
--                                                        DM with no
--                                                        relationship_tree edge
--                                                        is NOT retyped — see
--                                                        the open question in
--                                                        the plan doc)
--   every remaining kind = 'dm'                          → DIRECT
--
-- No PASTORAL rows are created here — the owner spec is explicit ("no pastoral
-- threads auto-created"), and there is no pastoral concept in the schema yet
-- (that lands in migration 164). No bare BROADCAST rows are created either:
-- chat_broadcasts stays the source of truth for the sent object; whether it is
-- ever ALSO materialized as its own chat_conversations row is a C2/C3 product
-- decision, not a backfill of existing data.

-- Up Migration

ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS type VARCHAR(20)
    CHECK (type IN ('SPACE','DIRECT','DISCIPLER','PASTORAL','BROADCAST','BROADCAST_RESPONSE'));

-- Structural rooms (cell groups + topical spaces) → SPACE.
UPDATE chat_conversations
   SET type = 'SPACE'
 WHERE kind IN ('space', 'group') AND type IS NULL;

-- DM that ever delivered a broadcast copy → BROADCAST_RESPONSE. Checked before
-- DISCIPLER: a broadcast landing in an otherwise-discipling DM does not make
-- that thread stop being a discipling relationship in real life, but for THIS
-- backfill the broadcast shield (SuperAdmin + recipient only, no ordinary
-- consent semantics) is the more conservative default where the two would
-- otherwise conflict — see docs/CHAT_REDESIGN_PLAN.md § Migration strategy.
UPDATE chat_conversations cv
   SET type = 'BROADCAST_RESPONSE'
  FROM (
    SELECT DISTINCT conversation_id FROM chat_messages WHERE broadcast_id IS NOT NULL
  ) bm
 WHERE cv.conversation_id = bm.conversation_id
   AND cv.kind = 'dm' AND cv.type IS NULL;

-- DM between an explicit, on-file discipling edge → DISCIPLER.
UPDATE chat_conversations cv
   SET type = 'DISCIPLER'
  FROM chat_members a
  JOIN chat_members b
    ON b.conversation_id = a.conversation_id AND b.user_id <> a.user_id
  JOIN relationship_tree rt
    ON (rt.multiplier_id = a.user_id AND rt.disciple_id = b.user_id)
    OR (rt.multiplier_id = b.user_id AND rt.disciple_id = a.user_id)
 WHERE cv.conversation_id = a.conversation_id
   AND cv.kind = 'dm' AND cv.type IS NULL;

-- Everything else that is a plain DM → DIRECT.
UPDATE chat_conversations SET type = 'DIRECT' WHERE kind = 'dm' AND type IS NULL;

-- Belt-and-braces: any future `kind` value this migration didn't anticipate
-- must not silently leave `type` NULL.
UPDATE chat_conversations SET type = 'DIRECT' WHERE type IS NULL;

ALTER TABLE chat_conversations ALTER COLUMN type SET NOT NULL;
ALTER TABLE chat_conversations ALTER COLUMN type SET DEFAULT 'DIRECT';

CREATE INDEX IF NOT EXISTS idx_chat_conversations_type ON chat_conversations (type);

-- Down Migration

DROP INDEX IF EXISTS idx_chat_conversations_type;
ALTER TABLE chat_conversations ALTER COLUMN type DROP DEFAULT;
ALTER TABLE chat_conversations ALTER COLUMN type DROP NOT NULL;
ALTER TABLE chat_conversations DROP COLUMN IF EXISTS type;
