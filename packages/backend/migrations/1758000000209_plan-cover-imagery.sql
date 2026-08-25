-- Migration 209 · Plan covers that speak their plan (owner, 2026-08-25:
-- "the plans images are almost the same — ensure the image resonates with
-- the message"). Every active plan gets a hand-matched photograph from the
-- verified scripture-imagery collection (src/modules/intelligence/imagery.ts):
-- First Steps walks a first path, Fear Not faces the storm, The Reward System
-- stands in ripe wheat. Keyed by title (stable across the PDF→migration
-- pipeline); a missing title is a silent no-op. Forward-only: the previous
-- generic covers are not worth preserving.

-- Up Migration
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?auto=format&fit=crop&w=1080&q=70' WHERE title = 'First Steps';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1499996860823-5214fcc65f8f?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Who Am I?';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1425913397330-cf8af2ff40a1?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Where Did I Come From?';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1518199266791-5375a83190b7?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Healed of Rejection';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1454789548928-9efd52dc4031?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Fear Not';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=1080&q=70' WHERE title = 'New Grace';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1516557070061-c3d1653fa646?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Built to Last';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1533241242276-46a506b40d66?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Why Am I Here?';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Ask Better';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?auto=format&fit=crop&w=1080&q=70' WHERE title = 'The Renewed Mind';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1444465693019-aa0b6392460d?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Change to Become';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1574258495973-f010dfbb5371?auto=format&fit=crop&w=1080&q=70' WHERE title = 'New Lenses';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1478737270239-2f02b77fc618?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Speak Life';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1435224668334-0f82ec57b605?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Believe Again';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Better Together';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1465188162913-8fb5709d6d57?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Prepared in Secret';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Readers Become Leaders';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?auto=format&fit=crop&w=1080&q=70' WHERE title = 'What''s in Your Hand?';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1522673607200-164d1b6ce486?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Covenant Love';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1486870591958-9b9d0d1dda99?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Lead Yourself First';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1445264718234-a623be589d37?auto=format&fit=crop&w=1080&q=70' WHERE title = 'The God of Systems';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1080&q=70' WHERE title = 'The Reward System';

-- Down Migration
-- Data refresh: the previous generic covers are deliberately not preserved,
-- so reversing is an explicit no-op (CI proves down 0 → up for every file).
SELECT 1;
