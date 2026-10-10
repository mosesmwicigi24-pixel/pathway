-- Ekklesia — the congregation's intercessory watch, moved into the Prayer Room
-- from the WhatsApp group of the same name ("Ekklesia Intercessory · Pray for
-- the Body of Christ"). Six tables for four ideas:
--
--   * ekklesia_groups           one row per congregation: the watch's name and mission.
--   * ekklesia_members          who has joined the watch (any member may; leaders are
--                               appointed, and the church's Instructors/Admins count
--                               as leaders without a row).
--   * ekklesia_requests         what the watch is asked to carry. Any member of the
--                               congregation may bring one; it is not the public
--                               Prayer Wall — only intercessors read the body.
--   * ekklesia_intercessions    one row per intercessor per request per DAY. An
--                               intercessory group prays the same need again
--                               tomorrow, so the grain is the day, not the tap:
--                               "12 intercessors · 40 prayers" is honest arithmetic.
--   * ekklesia_updates          the requester's (or an intercessor's) word back to
--                               the watch — an update, or a testimony when answered.
--   * ekklesia_request_notices  who has been told about which request, so a
--                               replayed POST never pushes the watch twice.
--
-- Scope is the congregation (§5.4), enforced in the query layer. Writes carry a
-- client-generated id and client_mutation_id so a retry is a no-op (§3.6).

-- Up Migration

CREATE TABLE ekklesia_groups (
  congregation_id  UUID PRIMARY KEY REFERENCES congregations(congregation_id) ON DELETE CASCADE,
  name             TEXT NOT NULL DEFAULT 'Ekklesia',
  mission          TEXT NOT NULL DEFAULT 'Pray for the Body of Christ',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ekklesia_members (
  congregation_id  UUID NOT NULL REFERENCES congregations(congregation_id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role             TEXT NOT NULL DEFAULT 'intercessor' CHECK (role IN ('intercessor','leader')),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','left')),
  joined_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at          TIMESTAMPTZ,
  PRIMARY KEY (congregation_id, user_id)
);
CREATE INDEX ekklesia_members_user_idx ON ekklesia_members (user_id);

CREATE TABLE ekklesia_requests (
  request_id          UUID PRIMARY KEY,
  congregation_id     UUID NOT NULL REFERENCES congregations(congregation_id) ON DELETE CASCADE,
  author_user_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  body                TEXT NOT NULL,
  for_whom            TEXT,
  urgency             TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal','urgent')),
  is_answered         BOOLEAN NOT NULL DEFAULT FALSE,
  answered_at         TIMESTAMPTZ,
  answered_note       TEXT,
  is_pinned           BOOLEAN NOT NULL DEFAULT FALSE,
  is_hidden           BOOLEAN NOT NULL DEFAULT FALSE,
  hidden_by           UUID REFERENCES users(user_id) ON DELETE SET NULL,
  client_mutation_id  UUID UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ekklesia_requests_feed_idx ON ekklesia_requests (congregation_id, is_answered, is_pinned DESC, created_at DESC);
CREATE INDEX ekklesia_requests_author_idx ON ekklesia_requests (author_user_id);
CREATE INDEX ekklesia_requests_hidden_by_idx ON ekklesia_requests (hidden_by) WHERE hidden_by IS NOT NULL;

CREATE TABLE ekklesia_intercessions (
  request_id  UUID NOT NULL REFERENCES ekklesia_requests(request_id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  prayed_on   DATE NOT NULL,
  prayed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, user_id, prayed_on)
);
CREATE INDEX ekklesia_intercessions_user_idx ON ekklesia_intercessions (user_id, prayed_on DESC);

CREATE TABLE ekklesia_updates (
  update_id           UUID PRIMARY KEY,
  request_id          UUID NOT NULL REFERENCES ekklesia_requests(request_id) ON DELETE CASCADE,
  author_user_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  kind                TEXT NOT NULL DEFAULT 'update' CHECK (kind IN ('update','testimony')),
  body                TEXT NOT NULL,
  client_mutation_id  UUID UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ekklesia_updates_request_idx ON ekklesia_updates (request_id, created_at);
CREATE INDEX ekklesia_updates_author_idx ON ekklesia_updates (author_user_id);

CREATE TABLE ekklesia_request_notices (
  request_id  UUID NOT NULL REFERENCES ekklesia_requests(request_id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, user_id)
);
CREATE INDEX ekklesia_request_notices_user_idx ON ekklesia_request_notices (user_id);

-- Down Migration

DROP TABLE IF EXISTS ekklesia_request_notices;
DROP TABLE IF EXISTS ekklesia_updates;
DROP TABLE IF EXISTS ekklesia_intercessions;
DROP TABLE IF EXISTS ekklesia_requests;
DROP TABLE IF EXISTS ekklesia_members;
DROP TABLE IF EXISTS ekklesia_groups;
