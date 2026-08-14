-- Migration 195 · One phone format: E.164
-- ============================================================================
-- Phone numbers were stored four ways, and the mess had already caused a real
-- failure. Migration 192 deduplicated members by matching phone_number as a raw
-- string, so `0700529451` and `+254700529451` read as two different people. It
-- found one duplicate pair where normalised comparison finds three, and missed
-- Ednah Kavata entirely (migration 194 cleaned that up).
--
-- On production, 2026-08-15:
--     20  +254712345678   already correct
--     20  0712345678      local form
--      1  254798501690    no plus
--      5  '+254 704 650 578', '+254745 682761', …  correct but with spaces
--
-- The owner confirmed the membership is Kenyan, so a bare `0…` or `254…` is
-- unambiguously +254. Two exceptions were checked one by one rather than
-- assumed, because a phone number that no longer dials is worse than an untidy
-- one:
--
--   * Judith Naisenya holds +96875035055 — country code 968, a valid eight-digit
--     OMAN mobile. Kenyans working in the Gulf are not an edge case here.
--     Rewriting that to +254 would produce a number that reaches nobody, so any
--     already-valid international E.164 is left exactly as it is.
--   * Eunivent Masese has country_code US and city "Washington DC" but a Kenyan
--     +254 number. Her PHONE is Kenyan; her ADDRESS is not. This migration
--     touches phone_number only and leaves country_code alone — the two fields
--     answer different questions and conflating them is how the diaspora gets
--     erased from a roster.
--
-- Deliberately NOT adding a UNIQUE constraint on phone_number. Three numbers are
-- shared by more than one live account here, and the 2026-08-13 audit showed why
-- that is correct rather than dirty: one of the pairs is the owner and the App
-- Store review account on the owner's own handset, and households share a
-- handset. A phone identifies a DEVICE. See migration 190.

-- Up Migration

-- 1. Strip every space, hyphen, bracket and dot. Five rows differ only by these.
UPDATE users
   SET phone_number = regexp_replace(phone_number, '[\s\-().]', '', 'g'),
       updated_at = now()
 WHERE phone_number IS NOT NULL
   AND phone_number ~ '[\s\-().]';

-- 2. Local 0XXXXXXXXX -> +254XXXXXXXXX  (Kenyan mobile: 07… or 01…)
UPDATE users
   SET phone_number = '+254' || substring(phone_number from 2),
       updated_at = now()
 WHERE phone_number ~ '^0[17][0-9]{8}$';

-- 3. Bare 254XXXXXXXXX -> +254XXXXXXXXX
UPDATE users
   SET phone_number = '+' || phone_number,
       updated_at = now()
 WHERE phone_number ~ '^254[17][0-9]{8}$';

-- 4. Nine digits with no prefix at all -> +254XXXXXXXXX
UPDATE users
   SET phone_number = '+254' || phone_number,
       updated_at = now()
 WHERE phone_number ~ '^[17][0-9]{8}$';

-- Anything already starting '+' and not matching the Kenyan shapes above is a
-- deliberate no-op: see Judith, above.

-- Down Migration
-- Reversing to +254 -> 0 would be lossy in the way that matters: it cannot know
-- which rows arrived as '0…', which as '254…', and which already carried spaces,
-- so it would invent a history rather than restore one. E.164 is also the
-- strictly better representation — every number here still dials after this
-- migration, which was not true of '254798501690'. Nothing structural changed,
-- so there is nothing to undo.
