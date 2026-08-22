-- Migration 205 · Swahili names for the giving funds
-- ============================================================================
-- nuruplace.org serves /en and /sw, and every word on the giving page is
-- translated except the one thing the giver actually chooses: the fund. A
-- Swahili speaker picks "Tithe" from a Swahili form and is thanked for a gift
-- "kwa Tithe". The page was never at fault — fund names live here, and there
-- was only ever one of them.
--
-- NULLABLE on purpose. A fund with no Swahili name falls back to its English
-- one, which is honest: a half-translated list is better than a machine
-- rendering of a name the church has not chosen. Adding a fund tomorrow does
-- not require anyone to invent a translation before it can be given to.
--
-- THE WORDS ARE THE CHURCH'S TO SETTLE. `zaka` and `sadaka` are settled Kenyan
-- church usage. `uanafunzi` for discipleship is the more common rendering, but
-- `ufuasi` is defensible and some congregations prefer it. These are a starting
-- point for the pastor to correct, not a translation to defer to:
--
--   UPDATE funds SET name_sw = 'Ufuasi' WHERE code = 'discipleship';
-- ============================================================================

-- Up Migration

ALTER TABLE funds ADD COLUMN IF NOT EXISTS name_sw VARCHAR(150);

COMMENT ON COLUMN funds.name_sw IS
  'Swahili name shown on /sw. NULL means fall back to name (English).';

-- Only where it is still unset, so a name the church has already corrected by
-- hand is never overwritten by re-running this.
UPDATE funds SET name_sw = 'Zaka'              WHERE code = 'tithe'        AND name_sw IS NULL;
UPDATE funds SET name_sw = 'Sadaka'            WHERE code = 'offering'     AND name_sw IS NULL;
UPDATE funds SET name_sw = 'Zawadi'            WHERE code = 'gift'         AND name_sw IS NULL;
UPDATE funds SET name_sw = 'Misheni'           WHERE code = 'mission'      AND name_sw IS NULL;
UPDATE funds SET name_sw = 'Uanafunzi'         WHERE code = 'discipleship' AND name_sw IS NULL;
UPDATE funds SET name_sw = 'Utoaji wa Kawaida' WHERE code = 'general'      AND name_sw IS NULL;
UPDATE funds SET name_sw = 'Manunuzi ya Media' WHERE code = 'media'        AND name_sw IS NULL;

-- Down Migration

ALTER TABLE funds DROP COLUMN IF EXISTS name_sw;
