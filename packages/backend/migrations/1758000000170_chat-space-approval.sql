-- Migration 170 · Space join-approval flag (Chat Redesign C4)
-- ============================================================================
-- docs/CHAT_REDESIGN_PLAN.md §8 Open Question 4 sized this as "a small
-- chat_conversations.requires_join_approval BOOLEAN flag... a product toggle,
-- not foundational schema" and deferred it out of C1's five migrations. C1/C2
-- shipped the review PLUMBING (space_join_requests, leader/moderator accept-
-- decline — migration 163) but POST /chat/spaces/:id/join (the direct-join
-- route) never actually checked anything before inserting chat_members — a
-- space could have a full join-request queue and still be joined instantly
-- around it. This column is the switch that was missing.
--
-- Default FALSE: every existing space keeps today's behaviour (instant join)
-- until a leader opts a specific space into review. Named `requires_approval`
-- (not the plan's tentative `requires_join_approval`) — shorter, and "join"
-- is redundant once it's a column on a conversation that only spaces read.

-- Up Migration

ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN NOT NULL DEFAULT FALSE;

-- Down Migration

ALTER TABLE chat_conversations DROP COLUMN IF EXISTS requires_approval;
