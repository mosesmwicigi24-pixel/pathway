-- Migration 209 · Plan covers that speak their plan (owner, 2026-08-25:
-- "the plans images are almost the same — ensure the image resonates with
-- the message"). Every active plan gets a hand-matched photograph from the
-- verified scripture-imagery collection (src/modules/intelligence/imagery.ts):
-- First Steps walks a first path, Fear Not faces the storm, The Reward System
-- stands in ripe wheat. Keyed by title (stable across the PDF→migration
-- pipeline); a missing title is a silent no-op. Forward-only: the previous
-- generic covers are not worth preserving.

-- Up Migration
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1080&q=70' WHERE title = 'First Steps';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1469571486292-0ba58a3f068b?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Who Am I?';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1425913397330-cf8af2ff40a1?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Where Did I Come From?';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1476231682828-37e571bc172f?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Healed of Rejection';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1454789548928-9efd52dc4031?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Fear Not';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=1080&q=70' WHERE title = 'New Grace';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Built to Last';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Why Am I Here?';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Ask Better';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?auto=format&fit=crop&w=1080&q=70' WHERE title = 'The Renewed Mind';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Change to Become';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1080&q=70' WHERE title = 'New Lenses';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1490730141103-6cac27aaab94?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Speak Life';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1435224668334-0f82ec57b605?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Believe Again';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1484557985045-edf25e08da73?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Better Together';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1465188162913-8fb5709d6d57?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Prepared in Secret';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Readers Become Leaders';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=1080&q=70' WHERE title = 'What''s in Your Hand?';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1439066615861-d1af74d74000?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Covenant Love';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1486870591958-9b9d0d1dda99?auto=format&fit=crop&w=1080&q=70' WHERE title = 'Lead Yourself First';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1445264718234-a623be589d37?auto=format&fit=crop&w=1080&q=70' WHERE title = 'The God of Systems';
UPDATE reading_plans SET image_url = 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1080&q=70' WHERE title = 'The Reward System';

-- Down Migration
-- Data refresh: the previous generic covers are deliberately not preserved,
-- so reversing is an explicit no-op (CI proves down 0 → up for every file).
SELECT 1;
