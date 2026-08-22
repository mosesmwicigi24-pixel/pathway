-- Seed · The core funds (spec §2.6 + Contract Matrix B7 Give tab). Idempotent
-- on the unique code.
--
-- name_sw is seeded alongside name (migration 205 backfilled the boxes that
-- already existed). Both belong here: this file is what a FRESH database gets,
-- and a new install seeded English-only would serve /sw a Swahili form whose
-- fund list is in English — the exact bug 205 was written to close, reappearing
-- on every new deployment. The words are the church's to settle; see the
-- migration for how to change one.

INSERT INTO funds (code, name, is_active, name_sw) VALUES
  ('tithe',   'Tithe',   TRUE, 'Zaka'),
  ('offering', 'Offering', TRUE, 'Sadaka'),
  ('general', 'General Giving', TRUE, 'Utoaji wa Kawaida'),
  ('media',   'Media Purchases', TRUE, 'Manunuzi ya Media'),
  ('mission', 'Missions', TRUE, 'Misheni'),
  ('gift',    'Gift', TRUE, 'Zawadi')
ON CONFLICT (code) DO NOTHING;
