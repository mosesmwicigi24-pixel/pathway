-- Migration 163 · Space membership lifecycle — join requests, delegated
-- roles, removal/suspension (Chat Redesign C1)
-- ============================================================================
-- Today space membership is binary: a chat_members row exists or it doesn't.
-- `/chat/spaces/:id/join` inserts one immediately with no review, and cell
-- rooms auto-join their own members on first read with no review at all — that
-- part is correct per the spec ("space membership DERIVED from active cell
-- membership") and stays exactly as it is. What is missing: (a) leader-
-- reviewed join requests for members NOT automatically entitled to a space,
-- (b) delegable moderator/co-leader roles beyond the room's original leader,
-- and (c) removed/suspended members who keep their history instead of a
-- vanished row.
--
--   space_join_requests — the pending ask, same shape as connection_requests
--     (one pending request per user+space via partial unique index).
--   space_roles — ADDITIVE role grants, the same pattern as rbac_user_roles
--     (migration 035): a space's ORIGINAL leader is already knowable
--     (cell_groups.leader_user_id for a cell room, chat_conversations.
--     created_by for a topical space), so it is not duplicated here — this
--     table only holds DELEGATED grants (co-leader, moderator) layered on top.
--   chat_members gains a lifecycle — `status` (active/removed/suspended) in
--     place of DELETE — so "removed/suspended" and "join/leave history" (both
--     explicit spec asks) are answerable without a second membership table.
--     Every existing row backfills to 'active': nobody in today's data has
--     ever been removed, because the capability did not exist before now.

-- Up Migration

CREATE TABLE IF NOT EXISTS space_join_requests (
  request_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(conversation_id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  status          VARCHAR(10) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','accepted','declined','withdrawn')),
  message         VARCHAR(500),
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by      UUID REFERENCES users(user_id) ON DELETE SET NULL,
  decided_at      TIMESTAMPTZ,
  decision_note   VARCHAR(500)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_space_join_requests_pending
  ON space_join_requests (conversation_id, user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_space_join_requests_convo ON space_join_requests (conversation_id, status);

CREATE TABLE IF NOT EXISTS space_roles (
  conversation_id UUID NOT NULL REFERENCES chat_conversations(conversation_id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role            VARCHAR(10) NOT NULL CHECK (role IN ('leader','moderator')),
  granted_by      UUID REFERENCES users(user_id) ON DELETE SET NULL,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id, role)
);

ALTER TABLE chat_members
  ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','removed','suspended')),
  ADD COLUMN IF NOT EXISTS status_changed_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_chat_members_status ON chat_members (conversation_id, status);

-- Down Migration

DROP INDEX IF EXISTS idx_chat_members_status;
ALTER TABLE chat_members
  DROP COLUMN IF EXISTS status_changed_at,
  DROP COLUMN IF EXISTS status_changed_by,
  DROP COLUMN IF EXISTS status;
DROP TABLE IF EXISTS space_roles;
DROP INDEX IF EXISTS idx_space_join_requests_convo;
DROP INDEX IF EXISTS uq_space_join_requests_pending;
DROP TABLE IF EXISTS space_join_requests;
