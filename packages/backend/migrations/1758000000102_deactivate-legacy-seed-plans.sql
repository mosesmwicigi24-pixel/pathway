-- Retire the 7 legacy demo/seed reading plans in favour of the 18 authored
-- 'Power to Become' study plans (seeds 097/098/100). Several legacy plans are
-- incomplete on the wire — psalms-of-comfort (0 days) and sermon-on-the-mount
-- (0 days) have NO content, gospel-of-john has only 4 of 21 days — so they open
-- empty in the apps ("plans not showing"). We deactivate rather than delete so
-- member enrolment history (reading_plan_progress) stays intact and the change
-- is reversible; the catalogue query filters `WHERE is_active`, so they vanish
-- from every client immediately. Re-runnable (idempotent UPDATE by code).

-- Up Migration
UPDATE reading_plans SET is_active = FALSE
 WHERE code IN (
   'rooted-psalms-10',
   'anchored-3',
   'gospel-of-john',
   'now-saved',
   'psalms-of-comfort',
   'dealing-with-grief',
   'sermon-on-the-mount'
 );

-- Down Migration
UPDATE reading_plans SET is_active = TRUE
 WHERE code IN (
   'rooted-psalms-10',
   'anchored-3',
   'gospel-of-john',
   'now-saved',
   'psalms-of-comfort',
   'dealing-with-grief',
   'sermon-on-the-mount'
 );
