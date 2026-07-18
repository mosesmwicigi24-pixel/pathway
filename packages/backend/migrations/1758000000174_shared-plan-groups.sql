-- Reading & Social R1 · Shared plan groups (docs/READING_SOCIAL_REDESIGN.md
-- §3 "Read with a Friend", docs/READING_SOCIAL_PLAN.md §2.1)
-- ============================================================================
-- A bounded, invite-only group of members walking ONE reading_plans row
-- together. Deliberately NOT a second progress table: joining a group
-- enrolls the member in the underlying plan via the existing, unmodified
-- GrowthContentService.startPlan() (growth-content/service.ts) writing to
-- reading_plan_progress (migration 029) exactly as it does today for a solo
-- reader. "Per-participant progress" is answered in R1's service layer by
-- joining shared_plan_group_members to reading_plan_progress on
-- (user_id, plan_id = group.plan_id) — one source of truth, never duplicated.
--
-- No moderator/co-leader tier (unlike chat's space_roles, migration 163) —
-- these are small, invite-only friend circles, not public spaces with
-- strangers to moderate; created_by is the sole owner. See
-- docs/READING_SOCIAL_PLAN.md Open Question 4.
--
-- chat_members-style lifecycle (status, not row deletion) so "who joined"
-- history survives a member leaving, and archived_at is a soft "ended" state
-- on the group itself so "active shared plans" is a plain WHERE clause.
-- ============================================================================

-- Up Migration

CREATE TABLE IF NOT EXISTS shared_plan_groups (
  group_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     UUID NOT NULL REFERENCES reading_plans(plan_id) ON DELETE CASCADE,
  created_by  UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  name        VARCHAR(120),                 -- optional custom label; NULL = client derives one from members
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ                    -- soft "ended" state; NULL = active
);
CREATE INDEX IF NOT EXISTS idx_shared_plan_groups_plan ON shared_plan_groups (plan_id);
CREATE INDEX IF NOT EXISTS idx_shared_plan_groups_created_by ON shared_plan_groups (created_by);

CREATE TABLE IF NOT EXISTS shared_plan_group_members (
  group_id  UUID NOT NULL REFERENCES shared_plan_groups(group_id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  status    VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','left','removed')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at   TIMESTAMPTZ,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_spg_members_user_active
  ON shared_plan_group_members (user_id) WHERE status = 'active';

-- Down Migration

DROP INDEX IF EXISTS idx_spg_members_user_active;
DROP TABLE IF EXISTS shared_plan_group_members;

DROP INDEX IF EXISTS idx_shared_plan_groups_created_by;
DROP INDEX IF EXISTS idx_shared_plan_groups_plan;
DROP TABLE IF EXISTS shared_plan_groups;
