-- Up Migration
--
-- The Finance ERP (migration 216) gates recording money on finance:manage —
-- office gifts and their reversal, expenses, funds, budgets, claims, partner
-- reminders and campaigns. The seeded finance_officer role ('finance', 'full')
-- predates that capability, so a Finance Officer could approve but not record.
-- Owner approved adding it on 2026-09-26; production was granted directly the
-- same day (audit_log role.permissions_set), so this is a no-op there and
-- brings every other database — dev, CI, a restore — to the same state. The
-- maker-checker rule still stops one person approving their own expense.
INSERT INTO rbac_role_permissions (role_key, module_id, capability)
SELECT role_key, 'finance', 'manage'
  FROM rbac_roles
 WHERE role_key = 'finance_officer'
ON CONFLICT DO NOTHING;

-- Down Migration
DELETE FROM rbac_role_permissions
 WHERE role_key = 'finance_officer' AND module_id = 'finance' AND capability = 'manage';
