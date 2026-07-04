-- Migration 99 · Member → portal-user elevation + per-user permission grants
-- ============================================================================
-- An admin can elevate a member (a Student — one email/identity) into a
-- privileged portal user WITHOUT a separate registration. Two mechanisms:
--
--   1. users.is_staff — the elevation marker. The member keeps role='Student'
--      (their member-app experience is unchanged) but gains admin-console access
--      and appears on the System ▸ Users screen. The login scope gate lets them
--      into the console when STAFF_ROLES.has(role) OR is_staff (§5.4).
--
--   2. rbac_user_permissions — direct per-user (module_id, capability) grants
--      layered ON TOP of role grants. Effective permission for a user is the
--      UNION of (role grants via rbac_role_permissions) and (direct grants here).
--      This lets an admin hand an individual a precise capability without minting
--      a whole role. Same 16 fixed modules × 6 capabilities as the role matrix.
--
-- Forward-only; fully reversible Down (CI runs `node-pg-migrate down 0`).
-- ============================================================================

-- Up Migration

ALTER TABLE users
  ADD COLUMN is_staff BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE rbac_user_permissions (
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  module_id   VARCHAR(40) NOT NULL,                    -- one of the 16 fixed module ids
  capability  VARCHAR(12) NOT NULL CHECK (capability IN ('view','create','edit','delete','approve','export')),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by  UUID REFERENCES users(user_id),
  PRIMARY KEY (user_id, module_id, capability)
);
CREATE INDEX idx_rbac_user_permissions_user ON rbac_user_permissions (user_id);

-- Down Migration

DROP TABLE IF EXISTS rbac_user_permissions;
ALTER TABLE users DROP COLUMN IF EXISTS is_staff;
