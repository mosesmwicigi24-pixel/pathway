-- Take back the days nobody actually walked.
--
-- POST /growth/plans/:id/complete-day used to set reading_plan_progress
-- .completed_days with no check that the day's parts had been read — it
-- validated only day_number <= day_count. So a day could be sealed with "0 of 3
-- parts read", and a 10-day plan finished in 10 taps with nothing opened. The
-- service now refuses that (CONTENT_INCOMPLETE) and gates day N on days 1..N-1
-- (GATE_LOCKED), but the rows already written are still lying: on prod, 38 of 56
-- recorded day-marks across 11 members were never earned.
--
-- Rewrite completed_days to only the days the member genuinely finished:
-- every one of the day's parts read. A day with NO parts is kept — there was
-- nothing to read, so its mark was honest (NOT EXISTS is vacuously true for it).
-- current_day and completed_at are recomputed from the honest array, so a plan
-- that was never really finished stops claiming a completion date.
--
-- This only ever REMOVES unearned marks; a day whose parts are all read keeps
-- its mark. Members who did the reading lose nothing.

-- Up Migration
WITH honest AS (
  SELECT pr.user_id,
         pr.plan_id,
         COALESCE(ARRAY(
           SELECT d.day_number
             FROM reading_plan_days d
            WHERE d.plan_id = pr.plan_id
              AND d.day_number = ANY (pr.completed_days)
              AND NOT EXISTS (
                    SELECT 1
                      FROM reading_plan_day_segments s
                      LEFT JOIN reading_plan_segment_progress sp
                        ON sp.segment_id = s.segment_id AND sp.user_id = pr.user_id
                     WHERE s.plan_day_id = d.plan_day_id
                       AND sp.user_id IS NULL)
            ORDER BY d.day_number
         ), '{}'::int[]) AS days
    FROM reading_plan_progress pr
)
UPDATE reading_plan_progress pr
   SET completed_days = h.days,
       -- The day they are standing on: the first one not yet finished.
       current_day = LEAST(
         COALESCE((SELECT MIN(gs) FROM generate_series(1, p.day_count) gs
                    WHERE gs <> ALL (h.days)), p.day_count),
         p.day_count),
       -- A plan is only finished when every day of it is.
       completed_at = CASE WHEN cardinality(h.days) >= p.day_count
                           THEN pr.completed_at ELSE NULL END,
       updated_at = now()
  FROM honest h,
       reading_plans p
 WHERE pr.user_id = h.user_id
   AND pr.plan_id = h.plan_id
   AND p.plan_id = pr.plan_id
   AND pr.completed_days IS DISTINCT FROM h.days;

-- Down Migration
-- Irreversible by design: the stripped marks recorded days that were never
-- read, so there is nothing truthful to restore them to.
