-- Migration 169 · Conversation archival (Chat Redesign C2)
-- ============================================================================
-- A generic, reusable lifecycle timestamp — deliberately its OWN column, not a
-- new `type` value. Migration 161 already split `kind` (structure) from
-- `type` (security class) into two columns because they are two different
-- jobs; archival is a THIRD, lifecycle dimension ("is this thread still the
-- CURRENT one"), so it gets its own column too rather than overloading
-- either.
--
-- First consumer: discipler reassignment (C2, docs/CHAT_REDESIGN.md "My
-- Discipler" — "reassignment does NOT merge or expose the former
-- conversation"). When a disciple's discipler changes, their OLD DISCIPLER
-- conversation with the FORMER discipler is archived — never merged into or
-- exposed via the new assignment. History is KEPT (no-data-loss, the same
-- principle blocks/removes already follow in migration 162): archived_at
-- only removes a conversation from "my CURRENT thread" resolution and the
-- ordinary inbox listing; it never deletes a row.

-- Up Migration

ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_chat_conversations_archived ON chat_conversations (archived_at) WHERE archived_at IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS idx_chat_conversations_archived;
ALTER TABLE chat_conversations DROP COLUMN IF EXISTS archived_at;
