-- Migration 226 · Expenses belong to a department and carry a payment voucher
-- ============================================================================
-- Owner, 2026-10-31: an expense is usually spent FOR a department (camera
-- stands for Worship & media), often against one of its approved needs, and
-- the office must be able to hand anyone a printable record of it "for
-- accountability". Until now an expense knew its fund and category only, and
-- the portal showed it on screen with nothing to print or forward.
--
--   · `department_id` — which department the money was spent for (optional:
--     rent and utilities belong to no department);
--   · `need_id` — the approved department need it was spent against
--     (optional), so a need shows what was raised AND what was spent;
--   · `voucher_no` — PV-YYYY-NNNNN, gapless per year like the office's OR-
--     receipts, issued when the expense is recorded. A void expense keeps its
--     number (the voucher prints VOID), so the sequence never has holes an
--     auditor must explain.
--
-- Existing expenses are numbered in the order they were recorded, per year,
-- and the counters continue from there.

-- Up Migration
ALTER TABLE expenses
  ADD COLUMN department_id UUID REFERENCES departments(department_id) ON DELETE SET NULL,
  ADD COLUMN need_id       UUID REFERENCES department_needs(need_id) ON DELETE SET NULL,
  ADD COLUMN voucher_no    TEXT;

CREATE INDEX expenses_department_idx ON expenses (department_id) WHERE department_id IS NOT NULL;
CREATE INDEX expenses_need_idx ON expenses (need_id) WHERE need_id IS NOT NULL;

CREATE TABLE voucher_counters (
  year INT PRIMARY KEY,
  next INT NOT NULL DEFAULT 1 CHECK (next >= 1)
);

-- Number what is already there: per Nairobi year of recording, oldest first.
WITH numbered AS (
  SELECT expense_id,
         EXTRACT(YEAR FROM recorded_at AT TIME ZONE 'Africa/Nairobi')::int AS y,
         row_number() OVER (
           PARTITION BY EXTRACT(YEAR FROM recorded_at AT TIME ZONE 'Africa/Nairobi')
           ORDER BY recorded_at, expense_id
         ) AS n
    FROM expenses
)
UPDATE expenses e
   SET voucher_no = 'PV-' || numbered.y || '-' || lpad(numbered.n::text, 5, '0')
  FROM numbered
 WHERE numbered.expense_id = e.expense_id;

INSERT INTO voucher_counters (year, next)
SELECT EXTRACT(YEAR FROM recorded_at AT TIME ZONE 'Africa/Nairobi')::int, count(*) + 1
  FROM expenses
 GROUP BY 1;

-- Every new expense gets the next number of its Nairobi recording year here,
-- in the database, whatever inserts it (the API, a seed, a repair script). The
-- counter row stays locked until the inserting transaction ends: concurrent
-- recorders queue, and a rolled-back insert gives its number back.
CREATE FUNCTION expenses_issue_voucher() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  y INT;
  n INT;
BEGIN
  IF NEW.voucher_no IS NULL THEN
    y := EXTRACT(YEAR FROM COALESCE(NEW.recorded_at, now()) AT TIME ZONE 'Africa/Nairobi')::int;
    INSERT INTO voucher_counters (year, next) VALUES (y, 2)
      ON CONFLICT (year) DO UPDATE SET next = voucher_counters.next + 1
      RETURNING next - 1 INTO n;
    NEW.voucher_no := 'PV-' || y || '-' || lpad(n::text, 5, '0');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER expenses_voucher_no BEFORE INSERT ON expenses
  FOR EACH ROW EXECUTE FUNCTION expenses_issue_voucher();

ALTER TABLE expenses ALTER COLUMN voucher_no SET NOT NULL;
CREATE UNIQUE INDEX expenses_voucher_no_uniq ON expenses (voucher_no);

-- Down Migration
DROP TRIGGER IF EXISTS expenses_voucher_no ON expenses;
DROP FUNCTION IF EXISTS expenses_issue_voucher();
DROP INDEX IF EXISTS expenses_voucher_no_uniq;
DROP TABLE IF EXISTS voucher_counters;
DROP INDEX IF EXISTS expenses_need_idx;
DROP INDEX IF EXISTS expenses_department_idx;
ALTER TABLE expenses
  DROP COLUMN IF EXISTS voucher_no,
  DROP COLUMN IF EXISTS need_id,
  DROP COLUMN IF EXISTS department_id;
