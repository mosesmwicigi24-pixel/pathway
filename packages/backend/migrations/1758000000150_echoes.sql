-- Wave 1 of the companion presence: ECHOES — the app remembers you.
-- One moment per member per day, chosen deterministically from their own
-- history (their reflection words, their return after absence, their
-- anniversaries). NO AI is involved: nothing is generated about a person;
-- their own words are simply carried back to them. echo_log both caps the
-- cadence (PK user+day → one per day, stable across refetches) and prevents
-- the same reflection/anniversary from ever echoing twice (kind+ref lookups).

-- Up Migration
CREATE TABLE IF NOT EXISTS echo_log (
  user_id  UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  day_date DATE NOT NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('welcome_back', 'reflection_echo', 'anniversary')),
  ref_id   UUID,
  body     TEXT NOT NULL,
  quote    TEXT,
  ref      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day_date)
);
CREATE INDEX IF NOT EXISTS idx_echo_log_kind_ref ON echo_log (user_id, kind, ref_id);

-- Down Migration
DROP TABLE IF EXISTS echo_log;
