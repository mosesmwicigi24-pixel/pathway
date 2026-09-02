-- Partners, phase 2: campaigns and the memory behind the invitation.
--
-- Phase 1 needed no schema at all — a partner IS an active giving_schedule, and
-- the standing is derived. This phase adds only the two things that genuinely
-- do not exist yet: something to invite people TO, and a record of who has been
-- asked, so nobody is asked too often.
--
-- WHAT IS DELIBERATELY ABSENT
--   · no partner_tiers table. Tiers are copy derived from one number (the cost
--     of carrying a disciple through a level), and copy in a database is copy
--     nobody reviews. They live in code beside the words they shape.
--   · no partners table. That was the whole finding of phase 1: partners are
--     giving_schedules, and a second home for them is a second truth.

-- Up Migration

-- ── Campaigns ────────────────────────────────────────────────────────────────
-- Something to invite people to, with a real goal and a real end.
CREATE TABLE campaigns (
  campaign_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  congregation_id UUID NOT NULL REFERENCES congregations(congregation_id) ON DELETE CASCADE,
  title           VARCHAR(120) NOT NULL,
  blurb           TEXT NOT NULL,
  image_url       TEXT,
  fund_id         UUID REFERENCES funds(fund_id),

  goal_minor      BIGINT NOT NULL CHECK (goal_minor > 0),
  currency        CHAR(3) NOT NULL,

  starts_on       DATE NOT NULL,
  -- A campaign without an end is not a campaign, it is a permanent ask. The
  -- popup's "final three days" rule depends on this being real.
  ends_on         DATE NOT NULL,

  -- A MATCH MAY ONLY BE CLAIMED IF SOMEONE REALLY PLEDGED ONE (owner decision,
  -- 2026-09-02). Both columns move together or not at all: the constraint makes
  -- "a match with no matcher" unrepresentable rather than merely discouraged.
  -- Claiming a match that does not exist is the fastest way to lose a
  -- congregation's trust, so the database refuses to hold that state.
  match_minor     BIGINT CHECK (match_minor IS NULL OR match_minor > 0),
  match_pledger   VARCHAR(120),

  status          VARCHAR(10) NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','live','ended')),
  created_by      UUID REFERENCES users(user_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT campaign_dates_sane CHECK (ends_on >= starts_on),
  CONSTRAINT campaign_match_needs_a_matcher CHECK (
    (match_minor IS NULL AND match_pledger IS NULL) OR
    (match_minor IS NOT NULL AND match_pledger IS NOT NULL)
  )
);

-- The popup asks "is there a campaign running for my congregation today?" on
-- every eligible Home load, so that question gets its own index.
CREATE INDEX idx_campaigns_live
  ON campaigns (congregation_id, ends_on)
  WHERE status = 'live';

-- FK index (the CI guard requires one on every cascading FK).
CREATE INDEX idx_campaigns_fund ON campaigns (fund_id);
CREATE INDEX idx_campaigns_created_by ON campaigns (created_by);

-- ── The invitation's memory ──────────────────────────────────────────────────
-- Modelled on plan_promo_log (migration 210), which already proves the pattern:
-- one row per member per campaign, carrying what happened and when.
--
-- This table is what ENFORCES the design's restraint. Every rule — three
-- showings per campaign ever, fourteen days between waves, never again after
-- "don't ask again", never at all once they gave — is a read of this row. The
-- rules are not documentation; they are queries against these columns.
CREATE TABLE partner_invite_log (
  user_id       UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  campaign_id   UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,

  times_shown   INT NOT NULL DEFAULT 0,
  last_shown_on DATE,

  -- What the member did about it. 'dismissed' is a soft no and decays with the
  -- wave; 'declined' is "don't ask again" and is permanent. Keeping them apart
  -- is the difference between patience and pestering.
  outcome       VARCHAR(12) CHECK (outcome IN ('dismissed','declined','opened','gave')),
  outcome_at    TIMESTAMPTZ,

  PRIMARY KEY (user_id, campaign_id)
);

-- "Who may I show this to today?" is answered per campaign, so lead with it.
CREATE INDEX idx_partner_invite_campaign ON partner_invite_log (campaign_id, last_shown_on);

-- Down Migration
-- partner_invite_log first: it references campaigns.
DROP INDEX IF EXISTS idx_partner_invite_campaign;
DROP TABLE IF EXISTS partner_invite_log;
DROP INDEX IF EXISTS idx_campaigns_created_by;
DROP INDEX IF EXISTS idx_campaigns_fund;
DROP INDEX IF EXISTS idx_campaigns_live;
DROP TABLE IF EXISTS campaigns;
