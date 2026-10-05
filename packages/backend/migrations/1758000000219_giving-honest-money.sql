-- Giving cycles, Cycle 2 (owner request 2026-09-28): honest money on paper and
-- on the calendar. Additive, plus one deterministic backfill.
--
-- 1. `fee_cover_minor`: the part of a gift the member added to cover the
--    M-Pesa fee ("cover the fee"). The apps folded it into the amount and the
--    receipt printed "Fee: KSh 0". amount_minor stays what was actually
--    charged (the ledger is unchanged); this only lets the receipt and the
--    office say how much of it was the fee cover.
-- 2. `anchor_day`: the day of the month a monthly gift belongs to. The next
--    cycle was computed with setUTCMonth on a UTC instant, so a gift set up on
--    the 31st jumped to the 3rd of March, and one set up at 01:00 EAT on the
--    1st (22:00 UTC on the last day) crept back a day every month. The anchor
--    is kept and clamped to short months (31 → 28/29 → 31), in EAT.
--    Backfilled from the day each monthly gift was set up, EAT.

-- Up Migration

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS fee_cover_minor BIGINT
  CHECK (fee_cover_minor IS NULL OR fee_cover_minor >= 0);

ALTER TABLE giving_schedules ADD COLUMN IF NOT EXISTS anchor_day SMALLINT
  CHECK (anchor_day IS NULL OR anchor_day BETWEEN 1 AND 31);

UPDATE giving_schedules
   SET anchor_day = EXTRACT(DAY FROM created_at AT TIME ZONE 'Africa/Nairobi')::smallint
 WHERE frequency = 'monthly' AND anchor_day IS NULL;

-- Down Migration

ALTER TABLE giving_schedules DROP COLUMN IF EXISTS anchor_day;
ALTER TABLE transactions DROP COLUMN IF EXISTS fee_cover_minor;
