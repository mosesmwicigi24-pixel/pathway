-- Migration 192 · Retire two superseded member accounts
-- ============================================================================
-- The 2026-08-13 audit found three phone numbers shared by more than one live
-- account. Opening each one settled all three differently, which is the whole
-- argument against treating a phone number as an identity key.
--
--   0712884213 — Romy Ndinda, twice. The older account's email is literally
--     `ndindarose04+old@gmail.com`; the newer is `ndindarose04@gmail.com` with
--     23 sessions to the old one's 6, three modules to one, six chats to one.
--     She tagged it `+old` herself. Superseded.
--
--   0742580719 — George Waweru, twice, a week apart, on two Gmail addresses.
--     Activity moved wholesale to the second: 24 sessions against 7, three
--     modules against none. Superseded.
--
--   +254700706875 — Moses Mwicigi (1260 sessions, the owner) and "Nuru
--     Reviewer" <reviewered@nuruplace.org> (zero sessions). That is the app
--     store review account, deliberately created on the owner's own number.
--     NOT a duplicate. Left completely alone — and the reason phone must never
--     become a unique constraint. Families share one handset here; so do an
--     owner and a review account.
--
-- Both superseded accounts were still receiving Sunday letters — three and four
-- of them — so two members have been getting two personal pastoral letters
-- each, from a live account and a dead one. That is the concrete harm being
-- fixed: AI spend on a letter nobody opens, and a member wondering which of the
-- two is really addressed to them.
--
-- SOFT delete, so this is reversible with one UPDATE and every row they wrote
-- (chat messages, reflections, letters) stays attributed and intact. Migration
-- 190 made the email index partial on `deleted_at IS NULL`, so both addresses
-- free up: either member can register again on the same email tomorrow.
--
-- Matched on email AND phone together so this cannot over-reach. On any other
-- database — a fresh test DB, a rebuild, a second deployment — it matches
-- nothing and is a silent no-op, which is the correct behaviour for a data
-- repair that is true of exactly one production dataset.

-- Up Migration

UPDATE users
   SET deleted_at = now(), updated_at = now(), row_version = row_version + 1
 WHERE deleted_at IS NULL
   AND (email, phone_number) IN (
     ('ndindarose04+old@gmail.com', '0712884213'),
     ('georgewaweru865@gmail.com',  '0742580719')
   );

-- Down Migration

UPDATE users
   SET deleted_at = NULL, updated_at = now(), row_version = row_version + 1
 WHERE deleted_at IS NOT NULL
   AND (email, phone_number) IN (
     ('ndindarose04+old@gmail.com', '0712884213'),
     ('georgewaweru865@gmail.com',  '0742580719')
   );
