-- Seed · The starting expense categories (docs/FINANCE_ERP.md §3). Idempotent
-- on the unique code.
--
-- Migration 216 inserts these same rows, so a migrated database already has
-- them; this file is what a database that is seeded after being emptied gets
-- (the test suite truncates every table between tests and re-applies seeds/).
-- Keep the two lists identical. Categories are renamed or deactivated in the
-- portal (Finance → Settings), never deleted.

INSERT INTO expense_categories (code, name, sort) VALUES
  ('staff-honoraria',      'Staff & honoraria',      10),
  ('utilities',            'Utilities',              20),
  ('rent',                 'Rent',                   30),
  ('outreach-missions',    'Outreach & missions',    40),
  ('worship-media',        'Worship & media',        50),
  ('facilities-repairs',   'Facilities & repairs',   60),
  ('welfare-benevolence',  'Welfare & benevolence',  70),
  ('events',               'Events',                 80),
  ('administration',       'Administration',         90),
  ('other',                'Other',                  100)
ON CONFLICT (code) DO NOTHING;
