-- Seed 08 · RBAC roles + permission matrix (Final Pathway make systemData).
-- Idempotent. The 11 built-in roles and their per-module access levels mirror the
-- web client's roleProfiles exactly; access levels expand to capabilities via the
-- levelCaps mapping (read/contribute/manage/full). Absence of a row = denied.

-- ── Roles ──
INSERT INTO rbac_roles (role_key, name, role_type, description, is_system) VALUES
  ('super_admin',        'Super Admin',             'system', 'Unrestricted access to every area, including system settings, users, roles and finance.', TRUE),
  ('system_admin',       'System Administrator',    'system', 'Manages users, roles, countries, languages and activity logs. No giving or pastoral content.', TRUE),
  ('national_director',  'National Director',       'staff',  'Country-level oversight of cells, disciplers, curriculum rollout and analytics.', TRUE),
  ('regional_coach',     'Regional Coach',          'staff',  'Coaches disciplers across a region; monitors cell engagement and supports multiplication.', TRUE),
  ('curriculum_editor',  'Curriculum Editor',       'staff',  'Authors and publishes levels, modules, quizzes and the video library.', TRUE),
  ('pastoral_reviewer',  'Pastoral Reviewer',       'staff',  'Reviews reflections, approves milestones and issues certificates and badges.', TRUE),
  ('events_coordinator', 'Events Coordinator',      'staff',  'Schedules gatherings, manages RSVPs and records attendance check-ins.', TRUE),
  ('finance_officer',    'Finance Officer',         'staff',  'Manages giving, expenses and financial reports only.', TRUE),
  ('discipler',          'Discipler (Cell Leader)', 'field',  'Leads a cell — disciples members, marks attendance and tracks engagement.', TRUE),
  ('mentor',             'Mentor',                  'field',  'One-to-one accompaniment of assigned disciples; views their progress and reflections.', TRUE),
  ('member',             'Member (Disciple)',       'field',  'A disciple on the pathway; owns their lessons, quizzes, reflections and certificates.', TRUE),
  -- Follow-up is its own job (migration 198): a list of names, phone numbers and
  -- what was said on the last call. Holds followUp and nothing else, so it is
  -- safe to give to whoever actually rings round on a Monday.
  ('follow_up_team',     'Follow-up Team',          'field',  'Works the follow-up call list: who visited, who has stopped coming, and what was said. Sees the Follow-up section and nothing else.', FALSE),
  -- Runs nuruplace.org from the portal. Same principle as follow_up_team:
  -- without it the only way to let someone edit the church website was to make
  -- them an administrator of members, finance and curriculum too.
  ('website',            'Website',                 'staff',  'Runs nuruplace.org from the portal: enquiries from the contact form, and the announcements, events and media the public site shows. No access to members, finance or curriculum.', TRUE)
ON CONFLICT (role_key) DO UPDATE
  SET name = EXCLUDED.name, role_type = EXCLUDED.role_type,
      description = EXCLUDED.description, is_system = EXCLUDED.is_system;

-- ── Permission matrix ──
-- super_admin: full on every module.
INSERT INTO rbac_role_permissions (role_key, module_id, capability)
SELECT 'super_admin', m.module_id, c.capability
  FROM (VALUES
    ('dashboard'),('levels'),('cms'),('quiz'),('videos'),('cells'),('members'),
    ('reflections'),('events'),('finance'),('certificates'),('badges'),
    ('users'),('rolesAdmin'),('countries'),('languages'),('followUp'),('website')
  ) AS m(module_id)
  CROSS JOIN (VALUES ('view'),('create'),('edit'),('delete'),('approve'),('export')) AS c(capability)
ON CONFLICT DO NOTHING;

-- Other roles: (role, module, access level) → capabilities via levelCaps.
INSERT INTO rbac_role_permissions (role_key, module_id, capability)
SELECT p.role_key, p.module_id, lc.capability
  FROM (VALUES
    ('read','view'),('read','export'),
    ('contribute','view'),('contribute','create'),('contribute','edit'),('contribute','export'),
    ('manage','view'),('manage','create'),('manage','edit'),('manage','delete'),('manage','export'),
    ('full','view'),('full','create'),('full','edit'),('full','delete'),('full','approve'),('full','export')
  ) AS lc(level, capability)
  JOIN (VALUES
    -- website: full on its own module, absent from every other — that narrowness
    -- IS the feature, so it must not quietly acquire rows here later.
    ('website','website','full'),
    -- system_admin
    ('system_admin','dashboard','read'),
    ('system_admin','users','full'),('system_admin','rolesAdmin','full'),
    ('system_admin','countries','full'),('system_admin','languages','full'),
    -- national_director
    ('national_director','dashboard','read'),
    ('national_director','levels','read'),('national_director','cms','read'),
    ('national_director','quiz','read'),('national_director','videos','read'),
    ('national_director','cells','manage'),('national_director','members','manage'),
    ('national_director','reflections','read'),('national_director','events','manage'),
    ('national_director','finance','read'),('national_director','certificates','manage'),
    ('national_director','badges','manage'),('national_director','users','read'),
    ('national_director','rolesAdmin','read'),('national_director','countries','read'),
    ('national_director','languages','read'),
    -- regional_coach
    ('regional_coach','dashboard','read'),
    ('regional_coach','cells','manage'),('regional_coach','members','contribute'),
    ('regional_coach','reflections','read'),('regional_coach','events','read'),
    ('regional_coach','certificates','read'),('regional_coach','badges','read'),
    -- curriculum_editor
    ('curriculum_editor','dashboard','read'),
    ('curriculum_editor','levels','full'),('curriculum_editor','cms','full'),
    ('curriculum_editor','quiz','full'),('curriculum_editor','videos','manage'),
    -- pastoral_reviewer
    ('pastoral_reviewer','dashboard','read'),
    ('pastoral_reviewer','reflections','full'),('pastoral_reviewer','certificates','full'),
    ('pastoral_reviewer','badges','manage'),('pastoral_reviewer','members','read'),
    ('pastoral_reviewer','cells','read'),
    -- events_coordinator
    ('events_coordinator','dashboard','read'),
    ('events_coordinator','events','full'),('events_coordinator','members','read'),
    ('events_coordinator','cells','read'),
    -- finance_officer
    ('finance_officer','dashboard','read'),
    ('finance_officer','finance','full'),('finance_officer','certificates','read'),
    -- discipler
    ('discipler','dashboard','read'),
    ('discipler','cms','read'),('discipler','videos','read'),
    ('discipler','cells','contribute'),('discipler','members','contribute'),
    ('discipler','reflections','read'),('discipler','events','read'),
    ('discipler','certificates','read'),('discipler','badges','read'),
    -- mentor
    ('mentor','dashboard','read'),
    ('mentor','members','read'),('mentor','reflections','read'),('mentor','cells','read')
  ) AS p(role_key, module_id, level) ON p.level = lc.level
ON CONFLICT DO NOTHING;

-- ── Proximity (parity gap #4) ──
-- The distinct `members:proximity` capability gates the coarse-location pairing
-- suggestions view. Granted to admin/coach tier; the minors-Admin-only rule is
-- enforced in the module by coarse role, not by this grant.
INSERT INTO rbac_role_permissions (role_key, module_id, capability)
SELECT role_key, 'members', 'proximity'
  FROM rbac_roles
 WHERE role_key IN ('super_admin', 'system_admin', 'national_director', 'regional_coach')
ON CONFLICT DO NOTHING;

-- ── Live streaming (Nuru Live phase L1, docs/LIVE_STREAMING.md) ──
-- `go` mints/starts a broadcast; `manage` ends anyone's stream. Church-wide
-- "go" additionally requires the caller to be staff (checked in the live
-- module, not here); cell-scoped "go" additionally requires the target cell
-- be in the caller's leader_assignments (also checked in the live module) —
-- discipler's grant below is meaningful only in combination with that scoping.
INSERT INTO rbac_role_permissions (role_key, module_id, capability)
SELECT role_key, 'live', cap
  FROM rbac_roles, (VALUES ('go'), ('manage')) AS g(cap)
 WHERE (role_key = 'super_admin')
    OR (role_key = 'system_admin' AND cap = 'manage')
    OR (role_key = 'national_director')
    OR (role_key = 'events_coordinator' AND cap = 'go')
    OR (role_key = 'discipler' AND cap = 'go')
ON CONFLICT DO NOTHING;

-- ── Follow-up (migration 198) ──
-- view reads the register and the call list; edit closes a step with an outcome.
-- Separate verbs because a leader compiling reports is not necessarily the
-- person who should be marking calls as made.
INSERT INTO rbac_role_permissions (role_key, module_id, capability)
SELECT g.role_key, 'followUp', g.capability
  FROM (VALUES
    ('follow_up_team',    'view'), ('follow_up_team',    'edit'),
    ('system_admin',      'view'), ('system_admin',      'edit'),
    ('national_director', 'view'), ('national_director', 'edit'),
    ('regional_coach',    'view'), ('regional_coach',    'edit'),
    ('pastoral_reviewer', 'view'), ('pastoral_reviewer', 'edit'),
    ('discipler',         'view'), ('discipler',         'edit')
  ) AS g(role_key, capability)
  JOIN rbac_roles r ON r.role_key = g.role_key
ON CONFLICT DO NOTHING;
