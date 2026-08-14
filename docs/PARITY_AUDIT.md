
## 2026-08-13 — recorded liturgy voice + sermon quote library shipped and deployed

**Merged:** pathway #415 (quotes), #416 (recording backend), #417 (migration hygiene),
#400 (calendar materialize); iOS #116; Android #104. Closed #401 as superseded.

**Deployed:** `ghcr.io/…/pathway-backend:sha-9a53f7b`, api + worker recreated,
`restarts=0`. Deployed by *sha tag*, not `latest`, so the running image is provably HEAD.

### Verified by inspection, not by success messages

| Check | Result |
|---|---|
| running image on api + worker | `sha-9a53f7b` — matches HEAD |
| `to_regclass` on new relations | `teaching_quotes` ✓, `liturgy_recordings` ✓ |
| migrations 188, 189 | recorded applied |
| quote library actually populated | **0 rows after migrate** — see below |
| container can write `/data/media` | uid 1000 `node`, WRITE_OK |
| storage survives recreate | bind `/var/www/pathway-media` |
| audio served publicly | `https://pathway.nuruplace.org/media/…` → 200 |
| nginx body cap vs 20 MB app cap | `client_max_body_size 25m` — clears it |
| routes probed | `/v1/home/liturgy` 401, `/v1/admin/liturgy/recordings` 401 (auth-gated, not 404) |
| api + worker logs since restart | no level 50/60 |

### The migration lied by omission

`teaching_quotes` existed and was **empty**. Migration 188 creates the table;
the 400 lines come from `scripts/seed-teaching-quotes.ts` over the staged corpus,
which nothing runs on deploy. "Migrations complete!" printed, the relation existed,
and the feature would have been silently dead — every liturgy falling back to no
quote at all. Seeded manually in-container: 31 documents read, 8 excluded per
`CURATION.md`, **400 inserted**, 0 duplicates. Spot-checked on prod: all 400
attributed `Pastor Moses`, zero divine-speech leaks.

**Class:** any feature whose content arrives via a seed script rather than a
migration has this hole. Worth auditing the other seeders before the next deploy.

### Prod schema drift found and closed out

`live_stream_reactions_emoji_check` already contained `'fire'` on prod — but
migration 182 was applied `2026-07-31T09:32Z`, **eleven hours before** #402 landed
its `-- Up Migration` marker. So prod ran the broken file and was hand-repaired at
the time; the correct schema was never the migration's doing. #401 proposed a repair
numbered `184`, already taken by `live-share-links` (applied 1 Aug). Both facts make
the same point, so #417 replaced the repair with a static lint: up-marker present,
numbers unique and increasing. Proven to fire by planting both offenders.

### Still open

- **The test suite is flaky.** Three full runs, three different results: `calendar`
  (real, fixed by #400), then `prayer-ai`, then `prayer-wall` — each passing in
  isolation. Green is not currently proof; cross-file isolation against the shared
  embedded Postgres needs a look.
- **Quote quality is mixed.** "The blood of The Soap will not make you clean unless
  you apply it" is a transcription artifact, and several lines are cut mid-sentence.
  400 extracted; the strongest subset has not been chosen.

## 2026-08-13/14 — architectural + data-integrity audit

Audited the LIVE production database (76 users, 188 tables) against the code, the
OpenAPI contract and the four surfaces. Findings ordered by what they cost a member.

### Fixed

**1. The unplaced member — 28 of 76 signed-in users had no congregation.**
Congregation arrives exactly one way: joining a cell during onboarding.
Registration deliberately does not set it (cell choice is location-matched).
Nothing modelled the state in between, so every congregation-scoped read
returned nothing. Measured per person against placed members:

| surface | unplaced | placed |
|---|---|---|
| Sunday letters | 0.57 each | 3.06 each |
| chat memberships | 0.64 | 3.13 |
| notifications | 12.2 | 48.7 |
| community moments | 0 | — |
| prayer wall posts | 0 | — |
| daily liturgy | hardcoded fallback | composed: spine, quote, pastor's voice |

Everything built over the past week was invisible to 37% of signed-in users.
Fix: `congregations.is_default` (migration 190) — an unplaced member reads its
corporate content, **without** gaining membership. A test asserts the
non-membership, because widening it would be a §5.4 scoping break dressed as a
feature. One default enforced by partial unique index.

**2. Email uniqueness contradicted registration.** `register()` checks
`deleted_at IS NULL`; the unique index spanned all rows. A returning member
would pass the app check, hit a raw 23505, and be told an account exists they
cannot see or recover. Zero soft-deleted users today, so it had never fired.

**3. Cohort/cell — one thing with two names, and two things with one name.**
`cohorts_running` counted `cell_groups`; the tile said "Cohorts running"; the
route was `/cohorts/{cell_id}` — a path noun contradicting its own parameter; a
403 said "this cohort". But **cohort is also correct and current** in retention
analytics (join-month cohorts). Each occurrence was classified rather than
swept — a blanket rename would have corrupted the analytics. `/cells` is now
canonical with `/cohorts` mounted beside it, and `cells_running` ships next to
the old key, so released iPad and portal builds keep working.

**4. 63 cascade paths were unindexed** (migration 191). Postgres indexes the PK
a foreign key points at, never the FK column, so deleting one user sequentially
scanned 45 tables. Cost scales with table size, not rows deleted — invisible now,
worst exactly when a member asks to be deleted from a database with history.
Generated from `pg_constraint`, not typed. Guarded by a test proven to fire.

**5. The OpenAPI↔route parity guard could not see multi-path routes.** One
handler on two paths makes `route.path` an array, which the checker joined into
a comma-separated pseudo-path — so both real paths read as undocumented and both
documented paths as unimplemented. A guard that fails loudly on correct code is
a guard about to be disabled.

### Checked and found sound (recorded so it is not re-audited)

- **The M-Pesa money path.** 23 of 48 phones are stored in local `07…` format,
  and `FinancialService` passes the profile phone straight through — but
  `toMsisdn()` in `providers.ts` already normalises `0…`, bare `7…` and `+254…`
  to Daraja's `2547XXXXXXXX`. **Giving is not broken.** Noted because the shape
  of the data invites exactly the wrong conclusion. Its one limit: `254` is
  hardcoded, so a non-Kenyan local number would be mis-prefixed — harmless,
  since M-Pesa is Safaricom-only and it would fail upstream anyway.
- **Polymorphic references resolve.** `community_moments.ref_id` (128 rows) and
  `echo_log.ref_id` (54) have no FK by design; zero dangle, and every moment has
  a congregation, so none are invisible to the feed.
- **Declared-but-unconstrained relations are clean** —
  `prayer_wall_posts.source_entry_id`, `gift_assessments.set_id`: zero orphans.

### Open, needing the owner's judgement — deliberately NOT actioned

- **Three duplicate phone numbers.** Two are the same person twice
  (`0712884213`, `0742580719` — same name on both accounts); one is
  `+254700706875` shared by two different names. Merging member accounts is
  irreversible and decides whose discipleship record survives. That is not a
  call to make from a query result.
- **Phone format is mixed** — 25 E.164, 23 local, 7 of the local ones with no
  `country_code` to normalise from. `0712884213` and `+254712884213` are the
  same number and will never match each other for dedup. Fixing it properly
  means normalising at entry with a country selector, then re-running dedup.
- **Two congregations, one empty.** "The Good News Mission" holds all 48 placed
  members; "Nuru Place" has zero. Migration 190 defaults to the one with the
  members. If the intent is to migrate to "Nuru Place", that is one UPDATE — but
  it is a product decision, not a data-cleanliness one.

### Not covered by this pass

Client-side DTO drift on iOS/Android beyond the liturgy contract; the §1.9
hard-lock gating invariant; idempotency replay coverage; RBAC scope enforcement
per endpoint. Each deserves its own pass rather than a paragraph in this one.
