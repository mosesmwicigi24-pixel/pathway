-- Level-exam publish gate. A level's final exam is only shown to (and takeable
-- by) members once an admin flips it from 'review' to 'published' — the owner's
-- "review / publish" toggle on the Level Quiz Builder. Distinct from the
-- level-wide CMS `status`; this governs the EXAM specifically.
--
-- Backfill: any level that already has live exam questions (a published module
-- with active questions) is set 'published' so production members mid-pathway
-- don't lose exam access on deploy. Everything else starts in 'review'.

-- Up Migration
ALTER TABLE levels
  ADD COLUMN IF NOT EXISTS exam_status TEXT NOT NULL DEFAULT 'review'
    CHECK (exam_status IN ('review', 'published'));

UPDATE levels l
   SET exam_status = 'published'
 WHERE EXISTS (
   SELECT 1
     FROM modules m
     JOIN question_bank q ON q.module_id = m.module_id
    WHERE m.level_number = l.level_number
      AND m.is_published
      AND q.is_active
 );

-- Down Migration
ALTER TABLE levels DROP COLUMN IF EXISTS exam_status;
