-- Plan-day reflections (member journaling on a reading-plan day). One reflection
-- per (user, plan, day) — resubmitting the same day UPDATES the body (upsert).
-- Offline-originated writes carry client_mutation_id; replays are no-ops (§2.1).

-- Up Migration

CREATE TABLE reading_plan_day_reflections (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  plan_id            UUID NOT NULL REFERENCES reading_plans(plan_id) ON DELETE CASCADE,
  day_number         INT NOT NULL CHECK (day_number > 0),
  body               TEXT NOT NULL,
  client_mutation_id TEXT UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, plan_id, day_number)
);

-- Down Migration

DROP TABLE IF EXISTS reading_plan_day_reflections;
