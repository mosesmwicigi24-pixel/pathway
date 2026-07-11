-- Intelligence Phase 4 — the liturgy Home + community intelligence.
--   • liturgies: ONE AI-composed set of prayer lines per congregation per day
--     (morning / midday / evening / night), shared by every member — content,
--     not personal data, like module_explanations. Season + Sunday awareness is
--     computed deterministically in code (computus); AI only writes words.
--   • community_moments: server-DETECTED milestones worth celebrating (module
--     complete, level certificate, verse mastered, plan finished). Nightly scan,
--     idempotent via UNIQUE(user_id, kind, ref_id) — the scan can re-run freely.
--   • moment_blessings: one-tap congratulations (amen/heart/fire) — one per
--     member per moment, content-free by design (no moderation surface).
--   • prayer_nudges: who was invited to stand with which prayer-wall post, so
--     the 15-minute chain scan is replay-safe and nobody is nudged twice.

-- Up Migration
CREATE TABLE IF NOT EXISTS liturgies (
  congregation_id UUID NOT NULL REFERENCES congregations(congregation_id) ON DELETE CASCADE,
  day_date        DATE NOT NULL,
  part            TEXT NOT NULL CHECK (part IN ('morning', 'midday', 'evening', 'night')),
  body            TEXT NOT NULL,
  scripture_ref   TEXT,
  season          TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (congregation_id, day_date, part)
);

CREATE TABLE IF NOT EXISTS community_moments (
  moment_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  congregation_id UUID REFERENCES congregations(congregation_id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('module_complete', 'level_complete', 'verse_mastered', 'plan_complete')),
  ref_id          UUID NOT NULL,          -- module / certificate / verse / plan id
  title           TEXT NOT NULL,          -- human line, e.g. 'Finished "Prayer & Fasting"'
  occurred_at     TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_moments_feed ON community_moments (congregation_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS moment_blessings (
  moment_id  UUID NOT NULL REFERENCES community_moments(moment_id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('amen', 'heart', 'fire')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (moment_id, user_id)
);

CREATE TABLE IF NOT EXISTS prayer_nudges (
  post_id    UUID NOT NULL REFERENCES prayer_wall_posts(post_id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

-- Down Migration
DROP TABLE IF EXISTS prayer_nudges;
DROP TABLE IF EXISTS moment_blessings;
DROP TABLE IF EXISTS community_moments;
DROP TABLE IF EXISTS liturgies;
