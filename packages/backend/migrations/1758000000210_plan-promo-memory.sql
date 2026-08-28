-- Migration 210 · The promo's memory (owner, 2026-08-26: the plan ads should be
-- "intelligent and smart and customized and with memory and with history").
--
-- Without a memory the same plan is promoted every day forever — the shelf goes
-- stale and the member learns to ignore it. This table is what the selector
-- REMEMBERS: which plan it put in front of whom, in which slot, and on which
-- day. It reads it back to avoid repeating a plan too soon and to rotate the
-- library fairly. One row per (member, plan) — the last showing wins, and
-- `times_shown` is how the selector knows something has been offered often and
-- passed over.
--
-- It is a record of what was SHOWN, never of what was read: reading history
-- lives in reading_plan_progress and stays the source of truth for that.

-- Up Migration
CREATE TABLE plan_promo_log (
  user_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  plan_id      UUID NOT NULL REFERENCES reading_plans(plan_id) ON DELETE CASCADE,
  slot         VARCHAR(32) NOT NULL,           -- why it was shown (continue|next_step|carrying|cell|fresh)
  last_shown_on DATE NOT NULL,
  times_shown  INT NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, plan_id)
);

CREATE INDEX idx_plan_promo_log_recent ON plan_promo_log (user_id, last_shown_on DESC);
-- plan_id is the SECOND column of the primary key, so it has no usable index of
-- its own — and its FK cascades. Without this, retiring a plan sequentially
-- scans every promo ever logged (the repo's fk-index-coverage guard caught it).
CREATE INDEX idx_plan_promo_log_plan ON plan_promo_log (plan_id);

-- Down Migration
DROP TABLE plan_promo_log;
