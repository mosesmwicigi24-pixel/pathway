-- Fix: reading-plan scripture segments were seeded as `_Reference_ — read slowly…`.
-- No client renders `_underscore_` italics (the RN Markdown inline parser handles
-- only *asterisk* emphasis, and BOTH native apps render segment content as plain
-- text), so every plan day's first tab printed literal underscores. The only
-- shape that renders correctly on every surface is plain text — emphasis is the
-- client's typography job, not the content's. Forward-only content repair,
-- scoped tightly to the seeded pattern so authored content is never touched.

-- Up Migration

UPDATE reading_plan_day_segments
   SET content = substring(content from 2 for position('_ — ' in content) - 2)
                 || substring(content from position('_ — ' in content) + 1)
 WHERE kind = 'scripture'
   AND content LIKE '\_%\_ — %' ESCAPE '\';

-- Down Migration

-- Content repair is one-way: the underscore wrappers were a seed defect, so
-- down is a deliberate no-op (nothing to restore).
SELECT 1;
