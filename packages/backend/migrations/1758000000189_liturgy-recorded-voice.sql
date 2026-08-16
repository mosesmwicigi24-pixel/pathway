-- The pastor's OWN VOICE on the liturgy, per band — so members hear him
-- instead of a synthesiser (owner request, 2026-08-12).
--
-- Key design call: this is keyed by (congregation_id, band), NOT
-- (congregation_id, day_date, band) like `liturgies` itself. The composed
-- LINE TEXT changes every day (spine + memory, see liturgy.ts), but nobody
-- can re-record seven times a day, seven days a week (49 recordings/week —
-- see the header of liturgy.ts and docs on this feature). A recording is a
-- standing asset for "the sunrise band," not a dub of one specific day's
-- text; it plays for every day until the pastor replaces it. `recorded_at`
-- carries when it was made — a literal `day_date` column would only invite
-- staleness (a `day_date` from last month lying about "today").
--
-- Per-band, never all-or-nothing: one row per band, so band 3 having no
-- recording never blocks bands 1/2/4-7 from serving (mixed is the NORMAL
-- case, not degraded — see liturgy.ts / LITURGY_VOICE docs). A member always
-- gets a voice for every band; some are his, most (for most pastors, most of
-- the time) are the synthesiser, and neither is presented as "missing."
--
-- recorded_by is nullable with ON DELETE SET NULL (unlike module_voice_notes'
-- CASCADE): this is corporate liturgical content, not a personal note — an
-- admin account being deactivated must never silently delete the pastor's
-- recorded liturgy out from under the whole congregation. No member name or
-- other personal data belongs in the audio file itself or its metadata; this
-- column is bookkeeping for the admin recorder UI only and is never surfaced
-- on the member-facing /home/liturgy payload (recorded_audio_url +
-- recorded_audio_duration_sec only).

-- Up Migration
CREATE TABLE IF NOT EXISTS liturgy_recordings (
  congregation_id UUID NOT NULL REFERENCES congregations(congregation_id) ON DELETE CASCADE,
  band            TEXT NOT NULL CHECK (band IN ('sunrise', 'morning', 'midday', 'afternoon', 'evening', 'night', 'midnight')),
  audio_url       TEXT NOT NULL,
  duration_sec    INT NOT NULL DEFAULT 0 CHECK (duration_sec BETWEEN 0 AND 900),
  recorded_by     UUID REFERENCES users(user_id) ON DELETE SET NULL,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (congregation_id, band)
);

-- Down Migration
DROP TABLE IF EXISTS liturgy_recordings;
