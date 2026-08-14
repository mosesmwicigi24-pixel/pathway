-- Migration 194 · Roster hygiene: test accounts, and the duplicate 192 missed
-- ============================================================================
-- Found while verifying migration 193. Two of these are my own faults from the
-- 2026-08-13 audit, and one is a consequence of 193 itself.
--
-- 1. SIX "John Doe" TEST ACCOUNTS are live members.
--    testuser@example.com, john.doe@example.com, john.doe.new@example.com,
--    johndoe@example.com, johndoe123@example.com, testuser.nuru.999@gmail.com
--    — created 17-26 July while the registration flow was being exercised.
--    Verified before touching them: ZERO modules, ZERO attendance, ZERO gifts,
--    ZERO reading progress. Nothing is lost.
--
--    They inflate every membership count, they sit in the Flock Brief and the
--    Shepherd's Pulse as souls to care for, and migration 193 — mine, an hour
--    ago — just handed all six a Level 1 pathway, because it selected on
--    `role='Student' AND deleted_at IS NULL` and a fake account satisfies both.
--    A backfill is only as good as its definition of "member".
--
-- 2. EDNAH KAVATA's `+old` ACCOUNT IS STILL LIVE.
--    Migration 192 retired exactly this pattern for Romy Ndinda
--    (ndindarose04+old@gmail.com) — but missed Ednah, because 192 found its
--    duplicates by matching PHONE NUMBERS and Ednah's pair share no phone.
--    A dedup is only as good as the key it matches on, and phone was the wrong
--    key twice over: it also compared raw strings, so `0700529451` and
--    `+254700529451` read as different people (three normalized duplicate pairs
--    exist where raw comparison sees one).
--
--    Ednah's `+old` holds 1 completed module; her current account holds 2 and
--    twelve gifts. The `+old` suffix is self-labelling — the member marked it
--    old herself. Retiring it matches the precedent already set for Romy. The
--    single module on the retired row is NOT merged across: moving a person's
--    discipleship record between accounts is a decision for a pastor, not a
--    migration, and soft-delete keeps it recoverable if that decision goes the
--    other way.
--
-- 3. SIMON NYORO KEEPS BOTH ACCOUNTS — owner's decision, 2026-08-14.
--    Two live accounts: simonnjuguna873@ (3 Jul) and simonnyoro873@ (13 Jul),
--    the `873` identical in both. I proposed retiring the older on the grounds
--    that both hold zero activity, so nothing could be lost. The owner said
--    keep him, and the owner knows the man.
--
--    Which is the right call regardless of what the data shows. Njuguna and
--    Nyoro are both real Kikuyu names, a shared numeric suffix is weaker
--    evidence than it looks, and "zero activity so nothing is lost" measures
--    only what the DATABASE would lose — not what a person loses when the
--    account they are about to open stops existing. Two rows in a roster is a
--    tidiness problem. Retiring the wrong man's login is a pastoral one.

-- Up Migration

-- Test accounts. Narrow and explicit by address — no LIKE '%test%' sweep, which
-- would catch a real member with "test" in their name or a testimony address.
UPDATE users
   SET deleted_at = now(), updated_at = now()
 WHERE deleted_at IS NULL
   AND email IN (
     'testuser@example.com',
     'john.doe@example.com',
     'john.doe.new@example.com',
     'johndoe@example.com',
     'johndoe123@example.com',
     'testuser.nuru.999@gmail.com'
   );

-- The duplicate migration 192's phone-based matching could not see.
UPDATE users
   SET deleted_at = now(), updated_at = now()
 WHERE deleted_at IS NULL
   AND email = 'kilonziednah+old@gmail.com';

-- Down Migration
-- Restores the rows without guessing at anything: these accounts were soft
-- deleted by this migration and nothing else about them was altered. Migration
-- 190's email index is partial on `deleted_at IS NULL`, so bringing them back
-- cannot collide with an address that has since been reused.
UPDATE users
   SET deleted_at = NULL, updated_at = now()
 WHERE email IN (
   'testuser@example.com',
   'john.doe@example.com',
   'john.doe.new@example.com',
   'johndoe@example.com',
   'johndoe123@example.com',
   'testuser.nuru.999@gmail.com',
   'kilonziednah+old@gmail.com'
 );
