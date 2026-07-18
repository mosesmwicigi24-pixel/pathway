-- Seed · Curriculum root (docs/CURRICULUM_ARCHITECTURE.md §2.1). Idempotent.
-- The fixed id matches the levels.curriculum_id DEFAULT set in migration 166 —
-- this must sort before 01_levels.sql so the FK target exists after a truncate.
INSERT INTO curricula (curriculum_id, slug, title)
VALUES ('c0000000-0000-4000-8000-000000000001', 'discipleship-pathway', 'Discipleship Pathway')
ON CONFLICT DO NOTHING;
