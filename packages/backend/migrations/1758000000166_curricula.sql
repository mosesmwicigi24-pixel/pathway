-- Migration 166 · Curriculum root (docs/CURRICULUM_ARCHITECTURE.md §2.1)
-- ============================================================================
-- Additive root above levels so future curricula are possible without re-keying
-- the world: one seeded 'discipleship-pathway' row; levels.curriculum_id
-- defaults to it. level_number REMAINS the PK and every existing FK is
-- untouched — nothing else is re-keyed.
-- ============================================================================

-- Up Migration

CREATE TABLE curricula (
  curriculum_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          VARCHAR(80)  NOT NULL UNIQUE,
  title         VARCHAR(255) NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Fixed id so the levels.curriculum_id DEFAULT can name it forever.
INSERT INTO curricula (curriculum_id, slug, title)
VALUES ('c0000000-0000-4000-8000-000000000001', 'discipleship-pathway', 'Discipleship Pathway');

ALTER TABLE levels
  ADD COLUMN curriculum_id UUID NOT NULL
    DEFAULT 'c0000000-0000-4000-8000-000000000001'
    REFERENCES curricula(curriculum_id);

-- Down Migration

ALTER TABLE levels DROP COLUMN IF EXISTS curriculum_id;
DROP TABLE IF EXISTS curricula;
