-- Reading & Social R1 · Shared plan invites (docs/READING_SOCIAL_REDESIGN.md
-- §3/§6, docs/READING_SOCIAL_PLAN.md §2.2/§5)
-- ============================================================================
-- One shape covers BOTH invite paths the owner brief asks for: a targeted
-- in-app invite to a specific friend (invitee_user_id set) and an open,
-- shareable WhatsApp/social/copy-link invite (invitee_user_id NULL). Every
-- row gets a `token` either way, so a single /join/{token} deep-link surface
-- and a single accept endpoint serve both — the client never needs two code
-- paths for "invited a friend" vs. "shared a link."
--
-- token is stored PLAINTEXT, not hashed like password_resets.token_hash
-- (migration 159) — a deliberate, documented departure. A password-reset
-- token is a credential (possession = account takeover); this token
-- identifies "which plan invite" and nothing more. Worst case on leak: a
-- stranger joins a friend's reading-plan group, which is join-request-shaped,
-- not account-takeover-shaped — and the public /join/{token} OG preview page
-- needs a fast, hash-free lookup to render a card for unauthenticated
-- crawlers (WhatsApp/iMessage link-preview bots) without spending an
-- argon2 compare on every fetch. See docs/READING_SOCIAL_PLAN.md Open
-- Question 1.
--
-- Minor-safety is inherited, not reimplemented: redeeming an invite
-- establishes (or requires) an accepted user_connections row between
-- inviter and invitee (migration 162), and ConnectionsService.
-- requestConnection() already refuses that pairing when either party
-- is_minor (chat/connections.ts) — R1's service layer reuses that gate
-- rather than building a second consent/age check.
-- ============================================================================

-- Up Migration

CREATE TABLE IF NOT EXISTS shared_plan_invites (
  invite_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id           UUID NOT NULL REFERENCES shared_plan_groups(group_id) ON DELETE CASCADE,
  inviter_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  invitee_user_id    UUID REFERENCES users(user_id) ON DELETE CASCADE,  -- set: targeted invite; NULL: open share-link
  token               VARCHAR(43) NOT NULL,  -- URL-safe opaque id; the /join/{token} path segment
  status              VARCHAR(10) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','accepted','declined','revoked','expired')),
  message             VARCHAR(500),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ,            -- NULL = no expiry (open share links); service defaults targeted invites to +14d
  decided_at          TIMESTAMPTZ,
  accepted_by         UUID REFERENCES users(user_id) ON DELETE SET NULL,  -- who actually redeemed it (may differ from invitee_user_id on an open link)
  client_mutation_id  UUID UNIQUE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_shared_plan_invites_token ON shared_plan_invites (token);
CREATE UNIQUE INDEX IF NOT EXISTS uq_shared_plan_invites_pending_target
  ON shared_plan_invites (group_id, invitee_user_id) WHERE status = 'pending' AND invitee_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shared_plan_invites_group ON shared_plan_invites (group_id);

-- Down Migration

DROP INDEX IF EXISTS idx_shared_plan_invites_group;
DROP INDEX IF EXISTS uq_shared_plan_invites_pending_target;
DROP INDEX IF EXISTS uq_shared_plan_invites_token;
DROP TABLE IF EXISTS shared_plan_invites;
