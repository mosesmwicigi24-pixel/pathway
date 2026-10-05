-- Giving cycles, Cycle 5 (owner request 2026-09-28): a pledge collected
-- automatically starts when its collection does. Additive; no backfill.
--
-- A monthly pledge's instalments are its due days from the first one on or
-- after its creation. "Charge me automatically" promises (both apps) that the
-- first collection is on the next cycle — never today — so a pledge made on
-- its own due day (the default) had an instalment due TODAY that nothing was
-- going to collect: it read "behind" from the next morning, sent overdue
-- nudges, and every later collection settled the previous month's instalment
-- late. `starts_on` is the first day an instalment can fall due; null keeps
-- the old rule (the creation day). Existing pledges are left as they are —
-- correcting them is a separate, owner-approved data fix.

-- Up Migration

ALTER TABLE pledges ADD COLUMN IF NOT EXISTS starts_on DATE;

-- Down Migration

ALTER TABLE pledges DROP COLUMN IF EXISTS starts_on;
