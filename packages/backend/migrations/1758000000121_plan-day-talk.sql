-- Talk it Over — the shared plan-day conversation (YouVersion-style). Members
-- walking the same plan respond to the day's questions, read each other, and
-- encourage with a heart. Flat thread per (plan, day); hearts toggle.

-- Up Migration
CREATE TABLE plan_day_talk_posts (
  post_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id    uuid NOT NULL REFERENCES reading_plans(plan_id) ON DELETE CASCADE,
  day_number integer NOT NULL CHECK (day_number >= 1),
  user_id    uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_plan_day_talk_thread ON plan_day_talk_posts (plan_id, day_number, created_at);

CREATE TABLE plan_day_talk_likes (
  post_id    uuid NOT NULL REFERENCES plan_day_talk_posts(post_id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

-- Down Migration
DROP TABLE IF EXISTS plan_day_talk_likes;
DROP TABLE IF EXISTS plan_day_talk_posts;
