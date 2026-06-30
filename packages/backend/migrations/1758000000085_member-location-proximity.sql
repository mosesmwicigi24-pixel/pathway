-- Migration 84 · Location → Proximity → Cell-pairing foundation (parity gap #4)
-- ============================================================================
-- Privacy-first, data-minimizing backend for opt-in coarse-location matching, per
-- the signed-off design in docs/LOCATION_PROXIMITY_DESIGN.md (§8, signed 2026-06-30).
--
-- NON-NEGOTIABLE invariants enforced here and in the module code:
--   * COARSE ONLY. We store a 6-char geohash (~1.2 km cell) computed server-side
--     from approximate lat/lng; the raw coordinates are DISCARDED and never
--     persisted — note there is NO lat/lng column on member_location.
--   * One row per member, overwritten on update (no movement history / trail).
--   * Cleared on opt-out, on guardian-consent revocation, or on account deletion
--     (ON DELETE CASCADE).
--   * Minors (users.is_minor) may only have location collected while an ACTIVE
--     `location_sharing` guardian consent exists; their pairing suggestions are
--     visible to Admin only (enforced in the module, not the schema).
--
-- Consent model: the existing guardian_consents table (migration 18) had no
-- consent-kind column — it modeled a single general onboarding consent. We add a
-- `consent_type` discriminator (default 'onboarding' to preserve every existing
-- row) so `location_sharing` is a DISTINCT, separately grantable + revocable
-- guardian consent, per design §8a. A real revoke path is wired in the module.
-- ============================================================================

-- Up Migration

-- Coarse last-known area per opted-in member. Geohash6 only — never coordinates.
CREATE TABLE member_location (
  user_id    UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  geohash6   VARCHAR(12) NOT NULL,                  -- 6-char geohash (~1.2 km); coarse, no point
  consent_at TIMESTAMPTZ NOT NULL,                  -- when this member first opted in
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()     -- last coarse-location refresh
);
-- Clustering reads scan by geohash prefix; index the coarse bucket.
CREATE INDEX idx_member_location_geohash ON member_location (geohash6);

-- Distinguish consent kinds on the existing guardian-consent table. Existing rows
-- are the general onboarding consent; new location consents use 'location_sharing'.
ALTER TABLE guardian_consents
  ADD COLUMN consent_type VARCHAR(30) NOT NULL DEFAULT 'onboarding'
    CHECK (consent_type IN ('onboarding', 'location_sharing'));

-- The active-consent partial index should now be per (user, type): a member can
-- hold one active onboarding consent AND one active location_sharing consent.
DROP INDEX IF EXISTS idx_guardian_consent_user;
CREATE INDEX idx_guardian_consent_user
  ON guardian_consents (user_id, consent_type) WHERE revoked_at IS NULL;

-- Extend the RBAC capability vocabulary with the proximity capability so a role
-- can hold the distinct `members:proximity` permission (gating the suggestions
-- view) without conflating it with generic members:view.
ALTER TABLE rbac_role_permissions
  DROP CONSTRAINT rbac_role_permissions_capability_check;
ALTER TABLE rbac_role_permissions
  ADD CONSTRAINT rbac_role_permissions_capability_check
    CHECK (capability IN ('view','create','edit','delete','approve','export','proximity'));

-- Seed members:proximity onto the admin-tier roles (idempotent). Adults visible to
-- coach-tier; the minors-Admin-only rule is enforced in the module by coarse role.
INSERT INTO rbac_role_permissions (role_key, module_id, capability)
SELECT role_key, 'members', 'proximity'
  FROM rbac_roles
 WHERE role_key IN ('super_admin', 'system_admin', 'national_director', 'regional_coach')
ON CONFLICT DO NOTHING;

-- Down Migration

DELETE FROM rbac_role_permissions WHERE module_id = 'members' AND capability = 'proximity';
ALTER TABLE rbac_role_permissions
  DROP CONSTRAINT rbac_role_permissions_capability_check;
ALTER TABLE rbac_role_permissions
  ADD CONSTRAINT rbac_role_permissions_capability_check
    CHECK (capability IN ('view','create','edit','delete','approve','export'));

DROP INDEX IF EXISTS idx_guardian_consent_user;
CREATE INDEX idx_guardian_consent_user ON guardian_consents (user_id) WHERE revoked_at IS NULL;
ALTER TABLE guardian_consents DROP COLUMN IF EXISTS consent_type;

DROP TABLE IF EXISTS member_location;
