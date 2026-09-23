-- Partners programme: memberships, pledges, claims, reminders (docs/PARTNERS_PROGRAMME.md).
--
-- Owner, 2026-09-23: "people can voluntarily join in as a program", with or
-- without a fund or campaign; several pledges each with its own ledger;
-- reminders 3 days before and up to three polite follow-ups 12 h apart.
--
-- WHAT IS DELIBERATELY ABSENT
--   · no pledge_payments table — a payment IS a transactions row; attribution
--     is transactions.pledge_id, written at the moment of giving (never
--     re-derived), so a statement and a pledge can never disagree.
--   · no stored progress — computed from transactions every read.
--   · department needs (phase 3) are referenced by a bare uuid for now; the FK
--     arrives with the departments migration.

-- Up Migration

CREATE TABLE partner_memberships (
  user_id            UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','left')),
  joined_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  paused_at          TIMESTAMPTZ,
  left_at            TIMESTAMPTZ,
  reminders_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pledges (
  pledge_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  shape              TEXT NOT NULL CHECK (shape IN ('monthly','total')),
  amount_minor       BIGINT CHECK (amount_minor IS NULL OR amount_minor > 0),
  target_minor       BIGINT CHECK (target_minor IS NULL OR target_minor > 0),
  currency           CHAR(3) NOT NULL DEFAULT 'KES',
  due_day            SMALLINT CHECK (due_day IS NULL OR (due_day BETWEEN 1 AND 28)),
  due_on             DATE,
  until_on           DATE,
  fund_id            UUID REFERENCES funds(fund_id),
  campaign_id        UUID REFERENCES campaigns(campaign_id),
  need_id            UUID,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','fulfilled','cancelled')),
  reminders_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  note               TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  fulfilled_at       TIMESTAMPTZ,
  cancelled_at       TIMESTAMPTZ,
  CONSTRAINT pledges_one_target CHECK (
    (fund_id IS NOT NULL)::int + (campaign_id IS NOT NULL)::int + (need_id IS NOT NULL)::int <= 1
  ),
  CONSTRAINT pledges_shape_fields CHECK (
    (shape = 'monthly' AND amount_minor IS NOT NULL AND due_day IS NOT NULL)
    OR (shape = 'total' AND target_minor IS NOT NULL AND due_on IS NOT NULL)
  )
);
CREATE INDEX pledges_user_idx ON pledges (user_id, status);

ALTER TABLE giving_schedules ADD COLUMN pledge_id UUID REFERENCES pledges(pledge_id) ON DELETE SET NULL;
ALTER TABLE pledges ADD COLUMN schedule_id UUID REFERENCES giving_schedules(schedule_id) ON DELETE SET NULL;
CREATE INDEX pledges_schedule_idx ON pledges (schedule_id) WHERE schedule_id IS NOT NULL;
ALTER TABLE transactions ADD COLUMN pledge_id UUID REFERENCES pledges(pledge_id) ON DELETE SET NULL;
CREATE INDEX transactions_pledge_idx ON transactions (pledge_id) WHERE pledge_id IS NOT NULL;
CREATE INDEX giving_schedules_pledge_idx ON giving_schedules (pledge_id) WHERE pledge_id IS NOT NULL;

CREATE TABLE pledge_claims (
  claim_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pledge_id       UUID NOT NULL REFERENCES pledges(pledge_id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  amount_minor    BIGINT NOT NULL CHECK (amount_minor > 0),
  currency        CHAR(3) NOT NULL DEFAULT 'KES',
  paid_on         DATE NOT NULL,
  note            TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  decided_by      UUID REFERENCES users(user_id),
  decided_at      TIMESTAMPTZ,
  transaction_id  UUID REFERENCES transactions(transaction_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX pledge_claims_pending_idx ON pledge_claims (status) WHERE status = 'pending';
-- FK support (the fk-index-coverage guard): cascades and SET NULLs must not scan.
CREATE INDEX pledge_claims_pledge_idx ON pledge_claims (pledge_id);
CREATE INDEX pledge_claims_user_idx ON pledge_claims (user_id);

CREATE TABLE pledge_reminders (
  reminder_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pledge_id    UUID NOT NULL REFERENCES pledges(pledge_id) ON DELETE CASCADE,
  due_on       DATE NOT NULL,
  sequence     SMALLINT NOT NULL CHECK (sequence BETWEEN 0 AND 3),
  kind         TEXT NOT NULL DEFAULT 'auto' CHECK (kind IN ('auto','manual')),
  channel      TEXT NOT NULL,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_by      UUID REFERENCES users(user_id)
);
-- Automatic reminders: one per (pledge, due date, step) — never twice for the
-- same due date. Manual ones are spaced by time (12 h), not by uniqueness.
CREATE UNIQUE INDEX pledge_reminders_auto_once ON pledge_reminders (pledge_id, due_on, sequence) WHERE kind = 'auto';
CREATE INDEX pledge_reminders_pledge_sent_idx ON pledge_reminders (pledge_id, sent_at DESC);

-- Down Migration

DROP TABLE IF EXISTS pledge_reminders;
DROP TABLE IF EXISTS pledge_claims;
DROP INDEX IF EXISTS transactions_pledge_idx;
ALTER TABLE transactions DROP COLUMN IF EXISTS pledge_id;
DROP INDEX IF EXISTS giving_schedules_pledge_idx;
DROP INDEX IF EXISTS pledges_schedule_idx;
ALTER TABLE pledges DROP COLUMN IF EXISTS schedule_id;
ALTER TABLE giving_schedules DROP COLUMN IF EXISTS pledge_id;
DROP TABLE IF EXISTS pledges;
DROP TABLE IF EXISTS partner_memberships;
