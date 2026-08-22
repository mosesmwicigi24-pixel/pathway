-- Migration 197 · Website enquiries (nuruplace.org → pastoral triage)
-- ============================================================================
-- The church website's connection card, contact form and prayer request post
-- here. Until now they had nowhere to go: the site had no destination
-- configured, so the form refused to submit and told visitors to telephone
-- instead. Honest, but it meant nobody could reach the church in writing.
--
-- Why its own table rather than `care_signals`:
--   Signals are about people we already have — drift, emotion, crisis for "my
--   flock, cells I lead + my disciples". An enquiry is the opposite situation:
--   somebody OUTSIDE the church reaching in, with no user_id, no congregation
--   membership, no level, and no history. Forcing them into the member model
--   would mean inventing a shadow user for every stranger who fills a form,
--   which pollutes the roster, the scoring and the hard-lock invariant.
--
-- Why not `chat_messages` / the pastoral inbox: that inbox is a conversation
-- between authenticated parties. There is no session here and no way to reply
-- in-thread — the reply happens by telephone, WhatsApp or email, off-platform.
--
-- So: a small, deliberately flat intake table. No foreign key to users for the
-- SENDER (they have none), only for the pastor who picks it up.
-- ============================================================================

-- Up Migration

CREATE TABLE website_enquiries (
  enquiry_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable and ON DELETE SET NULL: the website is one site for the whole
  -- church today, so an enquiry may not name a congregation. Losing the
  -- congregation must never delete somebody's unanswered message.
  congregation_id UUID REFERENCES congregations(congregation_id) ON DELETE SET NULL,

  -- 'connection_card' | 'message' | 'prayer'. Underscored here while the
  -- website's wire format is hyphenated; the module maps between them, because
  -- changing the website's public payload would break a deployed client.
  kind            VARCHAR(20)  NOT NULL,

  full_name       VARCHAR(255) NOT NULL,
  -- Free text, NOT E.164 (migration 195). A visitor types what they type, and
  -- rejecting a badly formatted number would lose the message entirely — the
  -- one outcome this whole feature exists to prevent. Normalise on follow-up.
  phone_number    VARCHAR(64),
  email           VARCHAR(255),
  message         TEXT         NOT NULL,

  -- Which language they wrote in, so the reply matches. The site is en + sw.
  locale          VARCHAR(8)   NOT NULL DEFAULT 'en',
  wants_prayer    BOOLEAN      NOT NULL DEFAULT FALSE,
  planning_visit  BOOLEAN      NOT NULL DEFAULT FALSE,

  -- Room for a second site or a campaign landing page later without a new table.
  source          VARCHAR(32)  NOT NULL DEFAULT 'website',

  -- When the visitor pressed send, as reported by the sender; distinct from
  -- when we received it, so a queued retry after an outage does not read as a
  -- message sent at 3am.
  submitted_at    TIMESTAMPTZ  NOT NULL,
  received_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- 'new' | 'acknowledged' | 'closed'
  status          VARCHAR(12)  NOT NULL DEFAULT 'new',
  acknowledged_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  note            TEXT,

  CONSTRAINT website_enquiries_kind_chk
    CHECK (kind IN ('connection_card', 'message', 'prayer')),
  CONSTRAINT website_enquiries_status_chk
    CHECK (status IN ('new', 'acknowledged', 'closed')),
  -- A way to reach them is the entire point of an enquiry.
  CONSTRAINT website_enquiries_reachable_chk
    CHECK (phone_number IS NOT NULL OR email IS NOT NULL)
);

-- Idempotency (§3.6). The website retries on a timeout, and a person who gets
-- no confirmation presses send again. Both must be no-ops rather than two
-- entries a pastor answers twice. Derived by the sender from the submission
-- content, so a genuine second message minutes later is a different key.
ALTER TABLE website_enquiries
  ADD COLUMN dedupe_key VARCHAR(64) UNIQUE;

-- The triage queue: unanswered first, newest first. This is the only read path
-- that matters, and it is the one a pastor refreshes.
CREATE INDEX idx_website_enquiries_queue
  ON website_enquiries (status, received_at DESC);

-- "Anything from this person before?" — asked while writing the reply.
CREATE INDEX idx_website_enquiries_phone ON website_enquiries (phone_number)
  WHERE phone_number IS NOT NULL;
CREATE INDEX idx_website_enquiries_email ON website_enquiries (email)
  WHERE email IS NOT NULL;

-- Both FKs are ON DELETE SET NULL, and Postgres does not index the referencing
-- side automatically. Without these, deleting one congregation or one user
-- makes Postgres sequentially scan this whole table to find the rows to null
-- out — and it takes a lock while it does. test/fk-index-coverage.test.ts
-- enforces this repo-wide; it caught both of these, which is the entire point
-- of having it.
CREATE INDEX idx_website_enquiries_congregation
  ON website_enquiries (congregation_id);
CREATE INDEX idx_website_enquiries_acknowledged_by
  ON website_enquiries (acknowledged_by);

-- Down Migration

DROP INDEX IF EXISTS idx_website_enquiries_acknowledged_by;
DROP INDEX IF EXISTS idx_website_enquiries_congregation;
DROP INDEX IF EXISTS idx_website_enquiries_email;
DROP INDEX IF EXISTS idx_website_enquiries_phone;
DROP INDEX IF EXISTS idx_website_enquiries_queue;
DROP TABLE IF EXISTS website_enquiries;
