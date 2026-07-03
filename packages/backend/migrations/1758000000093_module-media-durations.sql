-- Module media durations + admin-controlled audio. Purely additive: three
-- nullable columns on `modules` so the reader can show real "watch X min /
-- listen Y min" labels and play an admin-set audio track. Gating, scoring, and
-- the content_pages split are untouched. `audio_url` is brokered to a signed,
-- expiring URL for members exactly like `video_url` (raw storage refs never
-- leak); admins read/write the raw values. Durations are whole seconds.

-- Up Migration

ALTER TABLE modules
  ADD COLUMN video_duration_sec INT,
  ADD COLUMN audio_url          TEXT,
  ADD COLUMN audio_duration_sec INT;

-- Down Migration

ALTER TABLE modules
  DROP COLUMN IF EXISTS video_duration_sec,
  DROP COLUMN IF EXISTS audio_url,
  DROP COLUMN IF EXISTS audio_duration_sec;
