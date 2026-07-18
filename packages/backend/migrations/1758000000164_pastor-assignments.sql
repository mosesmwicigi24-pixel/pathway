-- Migration 164 · Pastor assignments — "Talk with My Pastor" (Chat Redesign C1)
-- ============================================================================
-- No pastoral concept exists anywhere in the schema today. This is the first
-- one: a scalable primary/campus/cell pastor model, explicitly NOT a
-- hard-coded user id (the owner spec calls this out by name — "no hard-coded
-- user id"). Shaped like relationship_tree (an edge with a timestamp) but
-- keeps HISTORY — reassignment ENDS the old row (`ended_at`) instead of
-- overwriting it, unlike relationship_tree's current UNIQUE(disciple_id) which
-- can only ever hold one row per disciple. The discipler side of this same
-- history gap is tracked as a C2 item in docs/CHAT_REDESIGN_PLAN.md rather
-- than duplicated here.
--
-- A row with member_user_id NULL is a CONGREGATION-WIDE default: "unassigned →
-- configured default pastoral account," modeled here rather than in a new
-- config table, since it is the same shape (an edge, a kind, a timestamp) just
-- scoped to a congregation instead of a person. Resolution order (implemented
-- in C2):
--   1. the member's own active row (assignment_kind IN primary/campus/cell)
--   2. the congregation's active default row (member_user_id IS NULL)
--   3. a documented last-resort fallback — not modeled in SQL, a query-time
--      decision; see the Pastoral-fallback open question in
--      docs/CHAT_REDESIGN_PLAN.md.
--
-- No rows are inserted here — "no pastoral threads auto-created" extends to no
-- pastor auto-assigned; a real person configures the first default in C2/C3.

-- Up Migration

CREATE TABLE IF NOT EXISTS pastor_assignments (
  assignment_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_user_id  UUID REFERENCES users(user_id) ON DELETE CASCADE,
  congregation_id UUID REFERENCES congregations(congregation_id) ON DELETE CASCADE,
  pastor_user_id  UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  assignment_kind VARCHAR(12) NOT NULL DEFAULT 'primary'
                     CHECK (assignment_kind IN ('primary','campus','cell','default')),
  assigned_by     UUID REFERENCES users(user_id) ON DELETE SET NULL,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  CHECK (member_user_id IS DISTINCT FROM pastor_user_id),
  -- Either a personal assignment (member_user_id set, kind is NOT 'default')
  -- or a congregation default (member_user_id NULL, kind IS 'default' and a
  -- congregation is named) — never neither, never both.
  CHECK (
    (member_user_id IS NOT NULL AND assignment_kind <> 'default')
    OR (member_user_id IS NULL AND assignment_kind = 'default' AND congregation_id IS NOT NULL)
  )
);

-- One ACTIVE personal assignment per member.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pastor_assignment_member_active
  ON pastor_assignments (member_user_id) WHERE ended_at IS NULL AND member_user_id IS NOT NULL;
-- One ACTIVE default per congregation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pastor_assignment_default_active
  ON pastor_assignments (congregation_id) WHERE ended_at IS NULL AND member_user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_pastor_assignment_pastor ON pastor_assignments (pastor_user_id) WHERE ended_at IS NULL;

-- Down Migration

DROP INDEX IF EXISTS idx_pastor_assignment_pastor;
DROP INDEX IF EXISTS uq_pastor_assignment_default_active;
DROP INDEX IF EXISTS uq_pastor_assignment_member_active;
DROP TABLE IF EXISTS pastor_assignments;
