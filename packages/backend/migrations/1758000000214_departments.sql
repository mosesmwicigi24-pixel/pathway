-- Departments (docs/PARTNERS_PROGRAMME.md §4): where members serve, what the
-- department says, and what it needs.
--
-- A NEED is a first-class giving target: transactions.need_id and
-- pledges.need_id are written at giving time, so a need's progress is exact
-- and can never double-count other gifts to the same fund. (The spec's first
-- draft said "approval creates a campaign"; a campaign's progress is fund-wide
-- since its start date, which would count the whole church's offerings toward
-- one department's roof. Campaigns stay for church-wide appeals.)

-- Up Migration

CREATE TABLE departments (
  department_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  congregation_id  UUID NOT NULL REFERENCES congregations(congregation_id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  purpose          TEXT NOT NULL DEFAULT '',
  leader_user_id   UUID REFERENCES users(user_id) ON DELETE SET NULL,
  meets            TEXT,
  image_url        TEXT,
  fund_code        TEXT,
  gift_keys        TEXT[] NOT NULL DEFAULT '{}',
  is_open_to_join  BOOLEAN NOT NULL DEFAULT TRUE,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by       UUID REFERENCES users(user_id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX departments_congregation_idx ON departments (congregation_id, status);

CREATE TABLE department_members (
  department_id  UUID NOT NULL REFERENCES departments(department_id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role           TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('leader','member')),
  status         TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','active','declined','left')),
  requested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by     UUID REFERENCES users(user_id),
  decided_at     TIMESTAMPTZ,
  left_at        TIMESTAMPTZ,
  PRIMARY KEY (department_id, user_id)
);
CREATE INDEX department_members_user_idx ON department_members (user_id, status);

CREATE TABLE department_posts (
  post_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id   UUID NOT NULL REFERENCES departments(department_id) ON DELETE CASCADE,
  author_user_id  UUID NOT NULL REFERENCES users(user_id),
  body            TEXT NOT NULL,
  image_url       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX department_posts_dept_idx ON department_posts (department_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE department_needs (
  need_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id  UUID NOT NULL REFERENCES departments(department_id) ON DELETE CASCADE,
  submitted_by   UUID NOT NULL REFERENCES users(user_id),
  title          TEXT NOT NULL,
  why            TEXT NOT NULL,
  target_minor   BIGINT NOT NULL CHECK (target_minor > 0),
  currency       CHAR(3) NOT NULL DEFAULT 'KES',
  deadline       DATE,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','closed')),
  decided_by     UUID REFERENCES users(user_id),
  decided_at     TIMESTAMPTZ,
  decision_note  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at      TIMESTAMPTZ
);
CREATE INDEX department_needs_status_idx ON department_needs (status, created_at DESC);

ALTER TABLE pledges ADD CONSTRAINT pledges_need_fk FOREIGN KEY (need_id) REFERENCES department_needs(need_id) ON DELETE SET NULL;
ALTER TABLE transactions ADD COLUMN need_id UUID REFERENCES department_needs(need_id) ON DELETE SET NULL;
CREATE INDEX transactions_need_idx ON transactions (need_id) WHERE need_id IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS transactions_need_idx;
ALTER TABLE transactions DROP COLUMN IF EXISTS need_id;
ALTER TABLE pledges DROP CONSTRAINT IF EXISTS pledges_need_fk;
DROP TABLE IF EXISTS department_needs;
DROP TABLE IF EXISTS department_posts;
DROP TABLE IF EXISTS department_members;
DROP TABLE IF EXISTS departments;
