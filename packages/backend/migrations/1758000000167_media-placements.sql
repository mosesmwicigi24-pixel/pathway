-- Migration 167 · Media placements (docs/CURRICULUM_ARCHITECTURE.md §2.2)
-- ============================================================================
-- One asset, many placements. The level is always inferred from the module —
-- never stored twice. modules.media_asset_id STAYS as a derived cache of each
-- module's primary (lowest-position) placement, maintained by placement CRUD,
-- which keeps the member /modules/:id read path byte-identical. Placements are
-- authoritative; the column is a mirror.
-- ============================================================================

-- Up Migration

CREATE TABLE media_placements (
  placement_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_asset_id UUID NOT NULL REFERENCES media_assets(media_asset_id),
  module_id      UUID NOT NULL REFERENCES modules(module_id),
  position       INT  NOT NULL DEFAULT 0,      -- order within the module
  required       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (media_asset_id, module_id)
);

CREATE INDEX idx_media_placements_module ON media_placements (module_id, position);
CREATE INDEX idx_media_placements_asset  ON media_placements (media_asset_id);

-- Asset title lives on the ASSET only (the library's reverse-write of
-- modules.title is removed in this phase — title has one owner). Seed it from
-- the currently-attached module so nothing changes on screen.
ALTER TABLE media_assets ADD COLUMN title VARCHAR(255);
UPDATE media_assets ma SET title = m.title
  FROM modules m
 WHERE m.media_asset_id = ma.media_asset_id AND ma.title IS NULL;

-- Backfill: every current single-FK attachment becomes a placement row.
INSERT INTO media_placements (media_asset_id, module_id, position, required)
SELECT m.media_asset_id, m.module_id, 0, TRUE
  FROM modules m
 WHERE m.media_asset_id IS NOT NULL
ON CONFLICT (media_asset_id, module_id) DO NOTHING;

-- Down Migration

ALTER TABLE media_assets DROP COLUMN IF EXISTS title;
DROP TABLE IF EXISTS media_placements;
