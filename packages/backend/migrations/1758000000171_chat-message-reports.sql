-- Migration 171 · Member-facing message reports (Chat Redesign C4)
-- ============================================================================
-- The owner brief lists "report" as a member-facing control on every surface
-- (My Space, Chat, and implicitly the 1:1 threads) but the only report-shaped
-- thing that existed was the ADMIN-side flag/unflag on chat_messages
-- (migration 042) — there was no way for an ordinary participant to raise a
-- concern at all. This table is the member's half: who reported what, once
-- each (idempotent per reporter+message — a second tap is a no-op, not a
-- duplicate row), reusing chat_messages.is_flagged as the signal the existing
-- moderation queue already surfaces (listAllForModeration's `flagged` count)
-- rather than inventing a parallel queue.
--
-- Deliberately NOT reusing chat_messages.flag_reason for the reporter's
-- reason: that column is a single admin-authored field (moderated_by/
-- moderated_at already record ONE admin actor); a message can be reported by
-- several different participants with different reasons, so each report gets
-- its own row here instead of clobbering a shared column.

-- Up Migration

CREATE TABLE IF NOT EXISTS message_reports (
  report_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id       UUID NOT NULL REFERENCES chat_messages(message_id) ON DELETE CASCADE,
  reporter_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  reason           VARCHAR(500),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, reporter_user_id)
);
CREATE INDEX IF NOT EXISTS idx_message_reports_message ON message_reports (message_id);

-- Down Migration

DROP INDEX IF EXISTS idx_message_reports_message;
DROP TABLE IF EXISTS message_reports;
