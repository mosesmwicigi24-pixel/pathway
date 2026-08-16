-- Selah — My Thoughts (Prayer Room tab 3, docs: prayer-room-arc). A private,
-- rich-text journal page: bold/italic/color/font spans plus stylus drawings.
-- Ground rule (owner spec 2026-07-18): "Only you can see it" — this table has
-- deliberately NO leader/admin read path, exactly like prayer_entries (§5.4).
-- Portable rich text: `body` is plain markdown (renders everywhere, degrades
-- gracefully); `body_spans` is a JSON array of the WYSIWYG span attributes
-- (bold/italic/color/font ranges) the client editor needs to reconstruct its
-- exact formatting — markdown alone cannot carry color/font. Drawings (iOS
-- PencilKit / Android stylus ink) are uploaded through the EXISTING chat/media
-- Cloudinary sign flow (POST /chat/attachments/sign) and only the resulting
-- secure_urls are stored here. Offline-synced: client-generated id, LWW on
-- updated_at, client_mutation_id for offline-queue idempotency (§1.7, §2.1).

-- Up Migration

CREATE TABLE member_thoughts (
  thought_id         UUID PRIMARY KEY,                        -- client-generated (offline-first)
  user_id             UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  title               VARCHAR(200),
  body                TEXT NOT NULL,                           -- portable markdown
  body_spans          JSONB,                                   -- [{start,end,bold?,italic?,color?,font?}, ...]
  drawing_urls        TEXT[] NOT NULL DEFAULT '{}',             -- Cloudinary secure_urls (pen/stylus strokes)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),       -- LWW anchor
  client_mutation_id  UUID UNIQUE                               -- offline-queue idempotency (§2.1)
);
CREATE INDEX idx_member_thoughts_user ON member_thoughts (user_id, created_at DESC);

-- Down Migration

DROP INDEX IF EXISTS idx_member_thoughts_user;
DROP TABLE IF EXISTS member_thoughts;
