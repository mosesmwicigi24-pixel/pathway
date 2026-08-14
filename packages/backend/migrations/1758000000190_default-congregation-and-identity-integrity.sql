-- Migration 190 · Relational integrity: the home congregation, and identity uniqueness
-- ============================================================================
-- Found by the 2026-08-13 architectural audit (docs/PARITY_AUDIT.md).
--
-- 1. THE UNPLACED MEMBER
--    A member's congregation is set by ONE path: choosing a cell group during
--    onboarding (onboarding/service.ts). Registration deliberately does not set
--    it — cell choice is location-matched, and guessing would defeat that.
--
--    But 28 of 76 users had signed in and never reached that step, and the app
--    has no concept of "signed in, not yet placed". Congregation-scoped code
--    reads NULL and returns nothing, so those members got roughly a fifth of
--    the product: 0.57 Sunday letters each against 3.06, zero community
--    moments, zero prayer wall, and a hardcoded fallback liturgy instead of the
--    composed one — no scripture spine, no teaching quote, no pastor's voice.
--
--    A congregation may now be marked the DEFAULT: the one an unplaced member
--    reads corporate content from. It grants no membership and no roster entry
--    — scoped reads still see NULL and still exclude them, which is correct,
--    because they genuinely have not joined a cell yet. It only stops the front
--    door being a stub while they decide.
--
--    Exactly one default is enforceable, not conventional (partial unique
--    index). Backfilled to the congregation that actually has the members; an
--    admin moves it with one UPDATE.
--
-- 2. EMAIL UNIQUENESS DISAGREED WITH THE CODE
--    IdentityService.register() checks `WHERE email = $1 AND deleted_at IS NULL`
--    — it believes an email frees up when an account is deleted. The unique
--    index spanned ALL rows including soft-deleted ones. So a returning member
--    would pass the application's check and then hit a raw 23505, reported as
--    "an account with this email already exists" about an account they can no
--    longer see or recover. Nobody is soft-deleted yet, so this has never
--    fired; it would have fired the first time anyone was.
--
--    The index now matches what the code always meant.

-- Up Migration

ALTER TABLE congregations ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN congregations.is_default IS
  'The congregation an unplaced member (users.congregation_id IS NULL) reads corporate content from — liturgy, teaching quotes, the pastor''s recorded voice. Confers no membership: scoped queries still exclude them until they join a cell. At most one row may be true.';

-- Only true rows are indexed, so uniqueness on the column means at most one of
-- them can exist. A second `SET is_default = true` fails loudly rather than
-- leaving two candidates and a LIMIT 1 to pick between them arbitrarily.
CREATE UNIQUE INDEX IF NOT EXISTS congregations_one_default
  ON congregations (is_default) WHERE is_default;

-- Seed it to the congregation members actually belong to, not the alphabetically
-- first and not a hardcoded id. If several tie, the oldest wins — it is the one
-- the church started with. If there are no congregations at all this is a no-op
-- and current() keeps its existing fallback, which is still correct behaviour.
UPDATE congregations SET is_default = true
WHERE congregation_id = (
  SELECT c.congregation_id
  FROM congregations c
  LEFT JOIN users u ON u.congregation_id = c.congregation_id AND u.deleted_at IS NULL
  GROUP BY c.congregation_id, c.created_at
  ORDER BY count(u.user_id) DESC, c.created_at ASC
  LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM congregations WHERE is_default);

DROP INDEX IF EXISTS users_email_key_live;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
CREATE UNIQUE INDEX users_email_key_live ON users (email) WHERE deleted_at IS NULL;

-- Down Migration

DROP INDEX IF EXISTS users_email_key_live;
-- Restoring the all-rows unique constraint can only fail if a soft-deleted row
-- now shares an email with a live one — which is exactly the state the up
-- migration exists to permit. Reversing is therefore best-effort by design.
ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);

DROP INDEX IF EXISTS congregations_one_default;
ALTER TABLE congregations DROP COLUMN IF EXISTS is_default;
