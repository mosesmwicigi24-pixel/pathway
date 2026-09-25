-- Finance ERP (docs/FINANCE_ERP.md §2–§3). Additive: journals for postings that
-- are not giving transactions (expenses, fund transfers), office-recorded gifts
-- with gapless receipts, reversal fields, expenses with maker-checker, budgets,
-- expense categories, fund descriptions. Every posting stays double-entry.

-- Up Migration

-- kind: expense / expense_void (an expense's approval and its undoing),
-- transfer (fund → fund), opening (a fund's balance brought in from before the
-- system: debit cash, credit fund), reversal (the mirror of a transfer or an
-- opening journal — reversal_of names it, and a journal is reversed at most
-- once). idempotency_key makes a retried money-moving POST a replay, not a
-- second posting.
CREATE TABLE journals (
  journal_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            TEXT NOT NULL CHECK (kind IN ('expense', 'expense_void', 'transfer', 'opening', 'reversal')),
  memo            TEXT,
  occurred_on     DATE NOT NULL,
  ref_id          UUID,
  reversal_of     UUID REFERENCES journals(journal_id),
  idempotency_key TEXT,
  created_by      UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT journals_reversal_names_original CHECK ((kind = 'reversal') = (reversal_of IS NOT NULL))
);
CREATE INDEX journals_ref_idx ON journals (ref_id) WHERE ref_id IS NOT NULL;
CREATE INDEX journals_created_by_idx ON journals (created_by) WHERE created_by IS NOT NULL;
CREATE UNIQUE INDEX journals_one_reversal ON journals (reversal_of) WHERE reversal_of IS NOT NULL;
CREATE UNIQUE INDEX journals_idempotency_key_uniq ON journals (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX journals_kind_occurred_idx ON journals (kind, occurred_on DESC);

ALTER TABLE ledger_entries ALTER COLUMN transaction_id DROP NOT NULL;
ALTER TABLE ledger_entries ADD COLUMN journal_id UUID REFERENCES journals(journal_id);
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_one_owner CHECK (num_nonnulls(transaction_id, journal_id) = 1);
CREATE INDEX ledger_entries_journal_idx ON ledger_entries (journal_id) WHERE journal_id IS NOT NULL;
CREATE INDEX ledger_entries_account_created_idx ON ledger_entries (account, created_at);

-- Office-recorded gifts and reversals live on the transaction itself.
ALTER TABLE transactions
  ADD COLUMN office_channel   TEXT CHECK (office_channel IS NULL OR office_channel IN ('onhand', 'bank', 'cheque', 'mpesa', 'other')),
  ADD COLUMN office_reference TEXT,
  ADD COLUMN recorded_by      UUID REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN reversed_at      TIMESTAMPTZ,
  ADD COLUMN reversed_by      UUID REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN reversal_reason  TEXT;
CREATE INDEX transactions_recorded_by_idx ON transactions (recorded_by) WHERE recorded_by IS NOT NULL;
CREATE INDEX transactions_reversed_by_idx ON transactions (reversed_by) WHERE reversed_by IS NOT NULL;

-- Who a gift belongs to, now that the office records gifts too (migration 202
-- set the rule for website gifts). 202 said two things: every row must be
-- attributable to SOMEBODY, and an app row with no member is a bug. Both stay
-- true. What changes is that an office-recorded gift is attributable to the
-- office record itself: the walk-in who gave cash at the table (a name, maybe
-- a phone) and the loose offering nobody signed for (anonymous) have no user
-- row and never will, but the office recorded them on a channel, with a
-- receipt, and is accountable for them. So:
--   · memberless rows may come from the website OR the office — never the app;
--   · a memberless row is attributable through a paying phone (website), or
--     through being an office record (source 'admin' with its office_channel).
-- Deliberately NOT tied to recorded_by: that column is ON DELETE SET NULL, and
-- a CHECK that read it would make deleting the recording user fail.
ALTER TABLE transactions DROP CONSTRAINT transactions_memberless_only_from_website;
ALTER TABLE transactions DROP CONSTRAINT transactions_attributable;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_memberless_source
  CHECK (user_id IS NOT NULL OR source IN ('website', 'admin'));
ALTER TABLE transactions
  ADD CONSTRAINT transactions_attributable
  CHECK (user_id IS NOT NULL OR giver_phone IS NOT NULL OR (source = 'admin' AND office_channel IS NOT NULL));

-- One payment, one record: a receipt code (M-Pesa code or office receipt) can
-- never be recorded twice. Verified 2026-09-26: production has no duplicates.
CREATE UNIQUE INDEX transactions_receipt_code_uniq ON transactions (receipt_code) WHERE receipt_code IS NOT NULL AND status <> 'failed';
-- An office gift's receipt is always its own gapless OR- number; the M-Pesa
-- code of an M-Pesa payment recorded by hand lives in office_reference. It is
-- still one payment, one record: two SUCCEEDED office M-Pesa rows may not
-- carry the same code. A reversed (refunded) row falls out of the index, so
-- the corrected entry can be recorded again. (receipt_code would have been the
-- wrong home: the STK callback writes receipt_code on settlement, and a clash
-- there would roll the settlement back.)
CREATE UNIQUE INDEX transactions_office_mpesa_ref_uniq ON transactions (upper(office_reference)) WHERE office_channel = 'mpesa' AND status = 'succeeded';

CREATE TABLE receipt_counters (
  year INT PRIMARY KEY,
  next INT NOT NULL DEFAULT 1 CHECK (next >= 1)
);

ALTER TABLE funds ADD COLUMN description TEXT, ADD COLUMN sort INT NOT NULL DEFAULT 0;

CREATE TABLE expense_categories (
  category_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9-]{1,39}$'),
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort        INT NOT NULL DEFAULT 0
);
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

CREATE TABLE expenses (
  expense_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id         UUID NOT NULL REFERENCES funds(fund_id),
  category_id     UUID NOT NULL REFERENCES expense_categories(category_id),
  payee           TEXT NOT NULL CHECK (char_length(payee) BETWEEN 2 AND 120),
  description     TEXT CHECK (description IS NULL OR char_length(description) <= 500),
  amount_minor    BIGINT NOT NULL CHECK (amount_minor > 0),
  currency        CHAR(3) NOT NULL DEFAULT 'KES',
  spent_on        DATE NOT NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('onhand', 'bank', 'cheque', 'mpesa', 'other')),
  reference       TEXT,
  status          TEXT NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'approved', 'void')),
  recorded_by     UUID REFERENCES users(user_id) ON DELETE SET NULL,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by     UUID REFERENCES users(user_id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ,
  voided_by       UUID REFERENCES users(user_id) ON DELETE SET NULL,
  voided_at       TIMESTAMPTZ,
  void_reason     TEXT,
  journal_id      UUID REFERENCES journals(journal_id),
  void_journal_id UUID REFERENCES journals(journal_id)
);
CREATE INDEX expenses_status_spent_idx ON expenses (status, spent_on DESC);
CREATE INDEX expenses_fund_idx ON expenses (fund_id);
CREATE INDEX expenses_category_idx ON expenses (category_id);
CREATE INDEX expenses_recorded_by_idx ON expenses (recorded_by) WHERE recorded_by IS NOT NULL;
CREATE INDEX expenses_approved_by_idx ON expenses (approved_by) WHERE approved_by IS NOT NULL;
CREATE INDEX expenses_voided_by_idx ON expenses (voided_by) WHERE voided_by IS NOT NULL;
CREATE INDEX expenses_journal_idx ON expenses (journal_id) WHERE journal_id IS NOT NULL;
CREATE INDEX expenses_void_journal_idx ON expenses (void_journal_id) WHERE void_journal_id IS NOT NULL;

CREATE TABLE fund_transfers (
  transfer_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_fund_id UUID NOT NULL REFERENCES funds(fund_id),
  to_fund_id   UUID NOT NULL REFERENCES funds(fund_id),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency     CHAR(3) NOT NULL DEFAULT 'KES',
  occurred_on  DATE NOT NULL,
  memo         TEXT NOT NULL CHECK (char_length(memo) BETWEEN 3 AND 300),
  created_by   UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  journal_id   UUID REFERENCES journals(journal_id),
  CHECK (from_fund_id <> to_fund_id)
);
CREATE INDEX fund_transfers_from_idx ON fund_transfers (from_fund_id);
CREATE INDEX fund_transfers_to_idx ON fund_transfers (to_fund_id);
CREATE INDEX fund_transfers_created_by_idx ON fund_transfers (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX fund_transfers_journal_idx ON fund_transfers (journal_id) WHERE journal_id IS NOT NULL;

CREATE TABLE budgets (
  budget_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year        INT NOT NULL UNIQUE CHECK (year BETWEEN 2020 AND 2100),
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  created_by  UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ
);
CREATE INDEX budgets_created_by_idx ON budgets (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX budgets_approved_by_idx ON budgets (approved_by) WHERE approved_by IS NOT NULL;

CREATE TABLE budget_lines (
  line_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id     UUID NOT NULL REFERENCES budgets(budget_id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
  fund_id       UUID REFERENCES funds(fund_id),
  category_id   UUID REFERENCES expense_categories(category_id),
  label         TEXT NOT NULL CHECK (char_length(label) BETWEEN 2 AND 80),
  monthly_minor BIGINT[] NOT NULL CHECK (array_length(monthly_minor, 1) = 12 AND 0 <= ALL (monthly_minor)),
  CHECK ((kind = 'income' AND fund_id IS NOT NULL) OR (kind = 'expense' AND category_id IS NOT NULL))
);
CREATE INDEX budget_lines_budget_idx ON budget_lines (budget_id);
CREATE INDEX budget_lines_fund_idx ON budget_lines (fund_id) WHERE fund_id IS NOT NULL;
CREATE INDEX budget_lines_category_idx ON budget_lines (category_id) WHERE category_id IS NOT NULL;

-- Down Migration

-- Refuse rather than orphan money records: the pre-216 constraints cannot hold
-- a memberless office gift, and deleting one would destroy a real receipt.
-- Rolling back is only possible while none exist.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM transactions WHERE user_id IS NULL AND source = 'admin') THEN
    RAISE EXCEPTION 'finance-erp down: memberless office gifts exist; refusing to restore the member-or-website constraints';
  END IF;
END $$;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_attributable;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_memberless_source;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_attributable
  CHECK (user_id IS NOT NULL OR giver_phone IS NOT NULL);
ALTER TABLE transactions
  ADD CONSTRAINT transactions_memberless_only_from_website
  CHECK (user_id IS NOT NULL OR source = 'website');

DROP TABLE IF EXISTS budget_lines;
DROP TABLE IF EXISTS budgets;
DROP TABLE IF EXISTS fund_transfers;
DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS expense_categories;
ALTER TABLE funds DROP COLUMN IF EXISTS sort, DROP COLUMN IF EXISTS description;
DROP TABLE IF EXISTS receipt_counters;
DROP INDEX IF EXISTS transactions_office_mpesa_ref_uniq;
DROP INDEX IF EXISTS transactions_receipt_code_uniq;
DROP INDEX IF EXISTS transactions_reversed_by_idx;
DROP INDEX IF EXISTS transactions_recorded_by_idx;
ALTER TABLE transactions
  DROP COLUMN IF EXISTS reversal_reason, DROP COLUMN IF EXISTS reversed_by, DROP COLUMN IF EXISTS reversed_at,
  DROP COLUMN IF EXISTS recorded_by, DROP COLUMN IF EXISTS office_reference, DROP COLUMN IF EXISTS office_channel;
DROP INDEX IF EXISTS ledger_entries_account_created_idx;
DROP INDEX IF EXISTS ledger_entries_journal_idx;
ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_one_owner;
-- Refuse rather than destroy money records: rolling back is only possible while
-- no journal postings exist (docs/FINANCE_ERP.md §3).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM ledger_entries WHERE journal_id IS NOT NULL) THEN
    RAISE EXCEPTION 'finance-erp down: journal postings exist; refusing to drop them';
  END IF;
END $$;
ALTER TABLE ledger_entries DROP COLUMN IF EXISTS journal_id;
ALTER TABLE ledger_entries ALTER COLUMN transaction_id SET NOT NULL;
DROP TABLE IF EXISTS journals;
