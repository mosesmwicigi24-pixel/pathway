-- Migration 178 · Nuru Live L1 — backend module (docs/LIVE_STREAMING.md)
-- ============================================================================
-- L0 infra (MediaMTX on the VPS — RTMP ingest :1935, HLS out behind nginx
-- /live/*, fMP4 recordings to disk) is already live; this migration is the
-- backend's half: the live_streams system-of-record, live viewer presence,
-- and the RBAC extension (module `live`, capabilities `go`/`manage`).
--
-- One-live-per-path is enforced at the DATABASE layer (not just app-level) via
-- two partial unique indexes: at most one status='live' row with scope='church'
-- overall, and at most one status='live' row per cell_id. A second concurrent
-- "go live" request on the same target 23505s, which the service translates to
-- 409 CONFLICT.
-- ============================================================================

-- Up Migration

CREATE TABLE live_streams (
  stream_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope           VARCHAR(10) NOT NULL CHECK (scope IN ('church','cell')),
  cell_id         UUID REFERENCES cell_groups(cell_group_id),
  started_by      UUID NOT NULL REFERENCES users(user_id),
  title           VARCHAR(200) NOT NULL,
  kind            VARCHAR(10) NOT NULL CHECK (kind IN ('video','audio')),
  status          VARCHAR(10) NOT NULL DEFAULT 'live' CHECK (status IN ('live','ended')),
  stream_key_hash TEXT NOT NULL,                          -- sha256(hex) of the minted publish key; never store plaintext
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  viewer_peak     INT NOT NULL DEFAULT 0,
  recording_url   TEXT,                                   -- set by the recording registrar once MediaMTX's segment is matched
  CHECK (scope = 'cell' OR cell_id IS NULL),
  CHECK (scope = 'church' OR cell_id IS NOT NULL)
);
CREATE INDEX idx_live_streams_status ON live_streams (status);

-- At most one live church-wide stream at a time.
CREATE UNIQUE INDEX idx_live_streams_one_church_live
  ON live_streams (scope) WHERE status = 'live' AND scope = 'church';
-- At most one live stream per cell at a time.
CREATE UNIQUE INDEX idx_live_streams_one_cell_live
  ON live_streams (cell_id) WHERE status = 'live' AND scope = 'cell';

-- Viewer presence (heartbeat-driven), mirrors radio_listeners' shape. Feeds
-- live_streams.viewer_peak; pruned opportunistically by the heartbeat handler
-- and superseded entirely once a stream ends (ON DELETE CASCADE with the stream).
CREATE TABLE live_viewers (
  stream_id    UUID NOT NULL REFERENCES live_streams(stream_id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (stream_id, user_id)
);
CREATE INDEX idx_live_viewers_stream ON live_viewers (stream_id);

-- Extend the RBAC capability vocabulary with `go`/`manage` (a distinct pair from
-- the generic CRUD 6, same idiom as migration 85's `proximity` carve-out) so the
-- new `live` module can be granted via BOTH the role matrix (rbac_role_permissions)
-- and direct per-user grants (rbac_user_permissions) — e.g. handing one Instructor
-- `live:go` without minting them a whole role.
ALTER TABLE rbac_role_permissions
  DROP CONSTRAINT rbac_role_permissions_capability_check;
ALTER TABLE rbac_role_permissions
  ADD CONSTRAINT rbac_role_permissions_capability_check
    CHECK (capability IN ('view','create','edit','delete','approve','export','proximity','go','manage'));

ALTER TABLE rbac_user_permissions
  DROP CONSTRAINT rbac_user_permissions_capability_check;
ALTER TABLE rbac_user_permissions
  ADD CONSTRAINT rbac_user_permissions_capability_check
    CHECK (capability IN ('view','create','edit','delete','approve','export','go','manage'));

-- Seed live:go / live:manage onto the built-in staff-tier roles (idempotent; a
-- no-op on a fresh install where rbac_roles is still empty — seeds/08_rbac.sql
-- is the enduring source of truth there; this mirrors migration 85's proximity
-- seed for an ALREADY-seeded prod database being redeployed onto this migration).
--   go:     super_admin, system_admin (oversight), national_director (church-wide,
--           staff), events_coordinator (church-wide, staff), discipler (cell-scoped
--           via leader_assignments — enforced in the live module, not here).
--   manage: super_admin, system_admin, national_director (end anyone's stream).
INSERT INTO rbac_role_permissions (role_key, module_id, capability)
SELECT role_key, 'live', cap
  FROM rbac_roles, (VALUES ('go'), ('manage')) AS g(cap)
 WHERE (role_key = 'super_admin')
    OR (role_key = 'system_admin' AND cap = 'manage')
    OR (role_key = 'national_director')
    OR (role_key = 'events_coordinator' AND cap = 'go')
    OR (role_key = 'discipler' AND cap = 'go')
ON CONFLICT DO NOTHING;

-- Down Migration

DELETE FROM rbac_role_permissions WHERE module_id = 'live';

ALTER TABLE rbac_user_permissions
  DROP CONSTRAINT rbac_user_permissions_capability_check;
ALTER TABLE rbac_user_permissions
  ADD CONSTRAINT rbac_user_permissions_capability_check
    CHECK (capability IN ('view','create','edit','delete','approve','export'));

ALTER TABLE rbac_role_permissions
  DROP CONSTRAINT rbac_role_permissions_capability_check;
ALTER TABLE rbac_role_permissions
  ADD CONSTRAINT rbac_role_permissions_capability_check
    CHECK (capability IN ('view','create','edit','delete','approve','export','proximity'));

DROP TABLE IF EXISTS live_viewers;
DROP TABLE IF EXISTS live_streams;
