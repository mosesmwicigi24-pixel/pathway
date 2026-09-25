-- Pledge names (docs/PARTNERS_PROGRAMME.md §2). Owner, 2026-09-25.
--
-- A pledge could only be called what it pointed at — the campaign's title, the
-- fund's name, "A department need", or "Partnership". A member with two
-- pledges to the same fund could not tell them apart. `title` is the member's
-- own name for the promise; NULL keeps the derived one (PartnersService.title),
-- so nothing already on a phone changes until someone types a name.
--
-- Bounds match the zod schema on both the create and update bodies (2–60).

-- Up Migration

ALTER TABLE pledges ADD COLUMN title TEXT CHECK (title IS NULL OR char_length(title) BETWEEN 2 AND 60);

-- Down Migration

ALTER TABLE pledges DROP COLUMN IF EXISTS title;
