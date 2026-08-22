-- Migration 199 · Mercy's two rules, seeded as cadences
-- ============================================================================
-- The Follow-Up department's plan (leader: Mercy Mukulu, 2026-08-20) prescribes
-- two rhythms in plain words:
--
--   "Call or message first-time guests within 24 hours."
--   "Contact absentees within the week."
--
-- The cadence engine (migrations 197/198, #429) was live but the tables were
-- empty — there was no way to create a cadence, so the To-call list could only
-- ever read zero. This seeds her two rules for every congregation that exists
-- when it runs. Congregations created later define their own through the new
-- portal editor; a seed cannot know about them, and guessing would be worse.
--
-- Shapes, and why:
--   FIRST-TIME GUEST (first_visit)
--     day 0  automated push  "Thank you for worshipping with us"
--     day 1  human           Welcome call            <- her 24-hour rule
--   The push lands the same day because scan-to-join means a first-timer HAS
--   the app; the call is deliberately human and deliberately day 1.
--
--   ABSENT TWO SUNDAYS (missed_services, threshold 2)
--     day 0  automated push  "We have missed you"
--     day 2  human           Check-in call           <- "within the week"
--   Threshold 2, not 1: one missed Sunday is a weekend away, and chasing it
--   would teach members the church texts them for skipping once. Two in a row
--   is a pattern. The daily sweep (worker) arms this.
--
-- ON CONFLICT (congregation_id, name) DO NOTHING: re-running never duplicates,
-- and a congregation that renamed or retuned theirs is left alone.

-- Up Migration

INSERT INTO follow_up_cadences (congregation_id, name, trigger, trigger_threshold)
SELECT c.congregation_id, 'First-time guest', 'first_visit', 1
  FROM congregations c
ON CONFLICT (congregation_id, name) DO NOTHING;

INSERT INTO follow_up_cadences (congregation_id, name, trigger, trigger_threshold)
SELECT c.congregation_id, 'Absent two Sundays', 'missed_services', 2
  FROM congregations c
ON CONFLICT (congregation_id, name) DO NOTHING;

INSERT INTO follow_up_cadence_steps (cadence_id, offset_days, kind, channel, action, message, sequence)
SELECT c.cadence_id, s.offset_days, s.kind, s.channel, s.action, s.message, s.sequence
  FROM follow_up_cadences c
  JOIN (VALUES
    (0, 'automated', 'push',  'Welcome message',
     'Thank you for worshipping with us today — we are so glad you came. You are welcome home anytime.', 1),
    (1, 'human',     NULL,    'Welcome call', NULL, 2)
  ) AS s(offset_days, kind, channel, action, message, sequence) ON TRUE
 WHERE c.name = 'First-time guest'
   AND NOT EXISTS (SELECT 1 FROM follow_up_cadence_steps e WHERE e.cadence_id = c.cadence_id);

INSERT INTO follow_up_cadence_steps (cadence_id, offset_days, kind, channel, action, message, sequence)
SELECT c.cadence_id, s.offset_days, s.kind, s.channel, s.action, s.message, s.sequence
  FROM follow_up_cadences c
  JOIN (VALUES
    (0, 'automated', 'push',  'We have missed you',
     'We have missed you at church — you are thought of, and there is a place for you on Sunday.', 1),
    (2, 'human',     NULL,    'Check-in call', NULL, 2)
  ) AS s(offset_days, kind, channel, action, message, sequence) ON TRUE
 WHERE c.name = 'Absent two Sundays'
   AND NOT EXISTS (SELECT 1 FROM follow_up_cadence_steps e WHERE e.cadence_id = c.cadence_id);

-- Down Migration
-- Removes ONLY the two seeded names, and only where no run has ever started —
-- deleting a cadence whose runs exist would cascade away real pastoral history.
DELETE FROM follow_up_cadences c
 WHERE c.name IN ('First-time guest', 'Absent two Sundays')
   AND NOT EXISTS (SELECT 1 FROM follow_up_runs r WHERE r.cadence_id = c.cadence_id);
