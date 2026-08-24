-- Personal liturgy compositions (owner's ask, 2026-08-24): the member's card
-- becomes ONE thought in three parts — a statement, a Scripture, and a brief
-- explanation — composed from what the member carries (open prayers, plan,
-- lesson, faithfulness), never quoting their own written words back at them.
-- Cached per (member, day, part) so the word is stable for the whole window
-- and composition happens at most once per part.

-- Up Migration
CREATE TABLE personal_liturgies (
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  day_date    DATE NOT NULL,
  part        VARCHAR(10) NOT NULL,            -- morning | midday | evening | night
  statement   TEXT NOT NULL,
  verse_ref   VARCHAR(80) NOT NULL,
  verse_text  TEXT NOT NULL,
  explanation TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day_date, part)
);

-- Down Migration
DROP TABLE personal_liturgies;
