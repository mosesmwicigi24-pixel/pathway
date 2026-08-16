-- Migration 168 · Discipler assignments — history table (Chat Redesign C2,
-- docs/CHAT_REDESIGN.md, docs/CHAT_REDESIGN_PLAN.md §2.5)
-- ============================================================================
-- relationship_tree(multiplier_id, disciple_id) has UNIQUE(disciple_id) and no
-- ended_at — a disciple can only ever have ONE row, ever; reassigning a
-- discipler today means overwriting/deleting that row, which destroys history
-- outright (plan §1 gap analysis). This table is the edge-with-history
-- sibling already built for pastoral (migration 164, pastor_assignments) —
-- same shape, scoped to disciple↔discipler instead of member↔pastor.
--
-- relationship_tree is NOT touched, dropped, or deprecated by this migration:
-- it stays the source for the "multiplier" growth-tree concept other modules
-- already depend on (scores, signals, growth-content — see the plan's §2.5
-- rationale for NOT retrofitting it). This is a PARALLEL table;
-- discipleship.resolveDiscipler (C2) now reads discipler_assignments FIRST,
-- falling back to relationship_tree for any edge never migrated into an
-- explicit assignment, so nothing that already depends on relationship_tree
-- breaks mid-rollout.
--
-- Backfill: every CURRENT relationship_tree row becomes an active assignment
-- below (there is at most one per disciple already, by that table's own
-- UNIQUE constraint) — matches the plan's §8 Open Question 1 conservative
-- recommendation: only an EXPLICIT, on-file discipling edge becomes a real
-- "assignment" event. The cell-leader-fallback relationship (no
-- relationship_tree row) is deliberately NOT backfilled into anything here —
-- it stays an inference, never an assignment, exactly as migration 161 left
-- it un-retyped to DISCIPLER for the same reason.

-- Up Migration

CREATE TABLE IF NOT EXISTS discipler_assignments (
  assignment_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disciple_user_id  UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  discipler_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  assigned_by       UUID REFERENCES users(user_id) ON DELETE SET NULL,
  assigned_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at          TIMESTAMPTZ,
  end_reason        VARCHAR(12) CHECK (end_reason IN ('reassigned', 'removed')),
  CHECK (disciple_user_id IS DISTINCT FROM discipler_user_id),
  CHECK (ended_at IS NULL OR end_reason IS NOT NULL)
);

-- One ACTIVE assignment per disciple — the "one active primary discipler"
-- invariant from the owner spec's data-model section.
CREATE UNIQUE INDEX IF NOT EXISTS uq_discipler_assignment_disciple_active
  ON discipler_assignments (disciple_user_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_discipler_assignment_discipler
  ON discipler_assignments (discipler_user_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_discipler_assignment_disciple_history
  ON discipler_assignments (disciple_user_id, assigned_at DESC);

-- Backfill: every current relationship_tree edge becomes an active
-- assignment, dated to when the edge was actually established (not "now") —
-- no-data-loss, matching migration 161/162's identical backfill discipline.
INSERT INTO discipler_assignments (disciple_user_id, discipler_user_id, assigned_at)
SELECT rt.disciple_id, rt.multiplier_id, rt.established_at
  FROM relationship_tree rt;

-- Down Migration

DROP TABLE IF EXISTS discipler_assignments;
