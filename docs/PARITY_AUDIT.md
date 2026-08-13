
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
