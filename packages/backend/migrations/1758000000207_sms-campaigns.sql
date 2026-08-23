-- Migration 207 · Bulk SMS campaigns with per-recipient delivery truth
-- ============================================================================
-- The portal gets an SMS center: compose, pick an audience, send, and then see
-- what ACTUALLY happened to each person's message — not what the submit call
-- claimed. The evening of 2026-08-22 established the ground rules the schema
-- encodes:
--
--   * accepted != sent != delivered. Africa's Talking answers the submit with
--     a per-recipient statusCode (100/101/102 are "we have it"), and the FINAL
--     outcome arrives later on their delivery-report webhook, with a failure
--     reason when it failed (InsufficientCredit, AbsentSubscriber, ...). A
--     recipient row therefore has a lifecycle, not a boolean.
--   * broadcast respects the opt-in (notification_preferences.sms_enabled).
--     Receipts are transactional; campaigns are not. Suppressed people are
--     RECORDED with a reason, never silently skipped — "why did person C not
--     get it" must be answerable from this table.
--   * retries are bounded and reasoned: a failed row keeps its reason and its
--     attempt count, and only retryable reasons may be retried.
--
-- status vocabulary (recipient):
--   queued      resolved into the campaign, nothing submitted yet
--   submitted   Africa's Talking accepted it; at_message_id + cost recorded;
--               shown as "awaiting delivery report" until the webhook speaks
--   delivered   the delivery report said Success — the only source of this
--   failed      submit rejected OR the delivery report said Failed/Rejected;
--               failure_reason carries their words
--   suppressed  never submitted: opted_out | no_phone | duplicate_phone
-- ============================================================================

-- Up Migration

-- Named, reusable member groups ("Ushering team", "Discipleship class of 2026").
CREATE TABLE sms_groups (
  group_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  congregation_id UUID NOT NULL REFERENCES congregations(congregation_id),
  name            VARCHAR(80) NOT NULL,
  created_by      UUID REFERENCES users(user_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (congregation_id, name)
);

CREATE TABLE sms_group_members (
  group_id  UUID NOT NULL REFERENCES sms_groups(group_id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
-- Deleting a user cascades into memberships; the PK leads with group_id, so
-- that delete path needs its own index (fk-index-coverage).
CREATE INDEX idx_sms_group_members_user ON sms_group_members (user_id);

CREATE TABLE sms_campaigns (
  campaign_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  congregation_id UUID NOT NULL REFERENCES congregations(congregation_id),
  title           VARCHAR(120) NOT NULL,
  body            TEXT NOT NULL,
  -- How the audience was chosen, kept verbatim so the report can say "sent to
  -- Discipleship class" months later: {kind: all|cells|level|group|individuals|event_rsvps, ...}
  audience        JSONB NOT NULL,
  -- Billing shape at compose time: gsm-7 septet count and the segment count it
  -- implies. Frozen here because editing copy later must not rewrite history.
  segments        INT NOT NULL DEFAULT 1,
  status          VARCHAR(12) NOT NULL DEFAULT 'draft',   -- draft | sending | sent
  created_by      UUID REFERENCES users(user_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ,
  CONSTRAINT sms_campaign_status CHECK (status IN ('draft','sending','sent'))
);
CREATE INDEX idx_sms_campaigns_cong ON sms_campaigns (congregation_id, created_at DESC);

CREATE TABLE sms_campaign_recipients (
  recipient_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    UUID NOT NULL REFERENCES sms_campaigns(campaign_id) ON DELETE CASCADE,
  user_id        UUID REFERENCES users(user_id),
  full_name      VARCHAR(255),          -- snapshot: the report must keep saying who
  phone          VARCHAR(32) NOT NULL,  -- snapshot: the number it actually went to
  status         VARCHAR(12) NOT NULL DEFAULT 'queued',
  suppress_reason VARCHAR(30),          -- opted_out | no_phone | duplicate_phone
  failure_reason  VARCHAR(80),          -- Africa's Talking's words, verbatim
  at_message_id  VARCHAR(100),          -- their id; the delivery report keys on it
  cost           VARCHAR(20),           -- their per-message cost string, e.g. "KES 0.8000"
  attempts       INT NOT NULL DEFAULT 0,
  submitted_at   TIMESTAMPTZ,
  delivered_at   TIMESTAMPTZ,
  CONSTRAINT sms_recipient_status CHECK
    (status IN ('queued','submitted','delivered','failed','suppressed')),
  UNIQUE (campaign_id, phone)
);
CREATE INDEX idx_sms_recipients_campaign ON sms_campaign_recipients (campaign_id, status);
-- The delivery-report webhook looks rows up by Africa's Talking's message id.
CREATE INDEX idx_sms_recipients_atid ON sms_campaign_recipients (at_message_id)
  WHERE at_message_id IS NOT NULL;

-- Down Migration

DROP TABLE IF EXISTS sms_campaign_recipients;
DROP TABLE IF EXISTS sms_campaigns;
DROP TABLE IF EXISTS sms_group_members;
DROP TABLE IF EXISTS sms_groups;
