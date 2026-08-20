-- Migration 198 · A Follow-up role, and its own module
-- ============================================================================
-- Owner ruling, 2026-08-17: follow-up becomes its own section of the portal —
-- a peer of Operations and Communication, not a row inside Operations — and
-- only users holding a follow-up role may see it.
--
-- WHY THIS IS NOT JUST members:view. Until now Services and Follow-up were
-- gated on members:view, on the reasoning that it is the same people seen
-- through attendance rather than through the register. That reasoning was
-- wrong for this church. Follow-up is a distinct pastoral job: it is a list of
-- names with phone numbers, missed services and what was said on the last call.
-- Everyone who may READ the member roll should not automatically be able to
-- work the call list, and — more to the point — the people who work the call
-- list are often not the people who administer members.
--
-- So: a `followUp` module, and a `follow_up_team` role that holds it and
-- nothing else. A team member sees exactly one section and cannot browse the
-- rest of the portal, which is what makes it safe to hand the role out widely.
--
-- The senior roles that already carry the whole portal keep it too — a pastor
-- discovering they cannot see their own follow-up list would be an absurdity.

-- Up Migration

INSERT INTO rbac_roles (role_key, name, description, is_system, role_type, status)
VALUES (
  'follow_up_team',
  'Follow-up Team',
  'Works the follow-up call list: who visited, who has stopped coming, and what was said. Sees the Follow-up section and nothing else.',
  FALSE,
  'staff',
  'active'
)
ON CONFLICT (role_key) DO NOTHING;

-- The new module. `view` reads the register and the call list; `edit` closes a
-- step with an outcome. Split deliberately: a leader compiling reports is not
-- necessarily the person who should be marking calls as made.
--
-- `edit` rather than a new `record` verb because capability is CHECK-constrained
-- to view/create/edit/delete/approve/export/proximity/go/manage, and widening a
-- shared enum to add one synonym is a worse trade than using the verb that is
-- already there. The database refused `record` outright, which is the constraint
-- doing its job.
-- Grant it. Written as INSERT…SELECT over a VALUES list joined to rbac_roles,
-- rather than a plain VALUES insert, because the senior roles are created by
-- SEEDS and not by migrations: on a fresh database this migration runs BEFORE
-- they exist, and naming them directly fails the foreign key. Filtering to
-- roles that are actually present means the same file works on production
-- (where they exist) and on a freshly migrated test database (where they do
-- not yet), without pretending the ordering is other than it is.
INSERT INTO rbac_role_permissions (role_key, module_id, capability)
SELECT g.role_key, 'followUp', g.capability
  FROM (VALUES
    ('follow_up_team',    'view'),
    ('follow_up_team',    'edit'),
    ('super_admin',       'view'),
    ('super_admin',       'edit'),
    ('system_admin',      'view'),
    ('system_admin',      'edit'),
    ('national_director', 'view'),
    ('national_director', 'edit'),
    ('regional_coach',    'view'),
    ('regional_coach',    'edit'),
    ('pastoral_reviewer', 'view'),
    ('pastoral_reviewer', 'edit'),
    -- A cell leader follows up their own cell; that is the job.
    ('discipler',         'view'),
    ('discipler',         'edit')
  ) AS g(role_key, capability)
  JOIN rbac_roles r ON r.role_key = g.role_key
ON CONFLICT DO NOTHING;

-- Down Migration
DELETE FROM rbac_role_permissions WHERE module_id = 'followUp';
DELETE FROM rbac_roles WHERE role_key = 'follow_up_team';
