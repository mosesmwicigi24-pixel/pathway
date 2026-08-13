
## 2026-08-13 — the flaky backend suite: a TRUNCATE deadlock, and a runner that always exited 0

Closes the "**Still open → the test suite is flaky**" item in the entry below. Two
defects, one of which made the other invisible.

### Root cause 1 — an un-awaited write racing the next test's reset

Postgres named both sides itself, caught by replaying the suite in a pinned random
file order (`--sequence.shuffle.files --sequence.seed=101`):

```
ERROR:  deadlock detected
DETAIL: Process 48671 waits for AccessExclusiveLock on relation 19368; blocked by process 48672.
        Process 48672 waits for RowShareLock on relation 16728; blocked by process 48671.
        Process 48671: TRUNCATE "interaction_events", … RESTART IDENTITY CASCADE
        Process 48672: INSERT INTO auth_events (user_id, kind) VALUES ($1, 'login')
```

`issueSession()` fired login telemetry as `void pool.query(...)` — deliberately
un-awaited so a logging hiccup can never block a login. The HTTP response therefore
returns while that INSERT is still open. The next test's `beforeEach → resetDb()`
runs `TRUNCATE` over ~200 tables: it holds `users` and wants `auth_events`, while the
straggler holds `auth_events` and wants `RowShareLock` on `users` for its FK check.
A cycle. Postgres kills the TRUNCATE, so **the failure lands on whichever test was
about to run** — never on the code that caused it.

Two things made it look like cross-file pollution and kept it moving:

- **`pg_tables` has no `ORDER BY`.** Catalog order shifts as TRUNCATE rewrites
  relfilenodes, so every reset locked the same tables in a *different* order. That
  is what turned a collision into a random deadlock instead of a deterministic wait.
- **Vitest's `BaseSequencer` re-orders files every run** — by previous-run duration,
  failed files first, from `node_modules/.vite/vitest/results.json`. A file that
  failed is promoted to the front of the next run, where it passes. Hence "three
  runs, three different results".

### It was NOT a §5.4 scoping leak

`prayer-wall > does not leak the wall across congregations` was the alarming one. It
is not an RBAC bug:

- The reproduced failure is a **`beforeEach` hook error**, which Vitest reports under
  the name of the test that was about to run — the identical signature seen here on
  `identity.test.ts`, with `Module.resetDb test/helpers/db.ts:35` in the stack.
- `PrayerWallService.list/get/access` all scope with
  `p.congregation_id = (SELECT congregation_id FROM users WHERE user_id = $1)`, and
  `PrayerAiService.points` scopes every one of its three queries to `user_id = $1`.
- The test builds both congregations itself, so a real leak would require two
  separate `congregations` rows to share an id.

The assertion has since passed on every run of the verification below.

### Root cause 2 — `pnpm test` exited 0 on a red suite

`embedded-postgres` pulls in `async-exit-hook`, which registers `beforeExit` with
code 0 and so ends a natural exit in `process.exit(0)` — discarding the non-zero
exit code Vitest had set. Proven by bisection: the same failing test exits **1**
under a config with no `globalSetup`, and **0** with the project's.

So CI's "Unit + integration tests" step has been passing unconditionally. Every
backend test failure since embedded-postgres landed was invisible — including the
deadlock above. Green was never proof.

### Permanent fix

| Change | Why |
|---|---|
| `src/db/background.ts` — `background()` / `drainBackgroundWork()` | fire-and-forget work stays un-awaited for the caller but is *tracked*, so it can be drained |
| `identity/service.ts`, `assistant/usage.ts` | the two request-path `void pool.query(...)` sites now route through it |
| `resetDb()` drains first | nothing is in flight when the TRUNCATE takes its locks |
| `resetDb()` orders by `tablename` + `SET LOCAL lock_timeout` | stable lock order; contention now fails fast with a message naming the cause instead of deadlocking in an unrelated file |
| `globalSetup.teardown()` drops async-exit-hook's `beforeExit`/`exit` listeners | a failing run exits non-zero again; signal hooks left intact so Ctrl-C still cleans up |
| `globalSetup.setup()` waits for port 55432 | an orphaned cluster from a prior run is reported, not silently connected to |
| `teardownTimeout: 180_000` | the shutdown checkpoint grows with the run (one was 182s); at the 10s default teardown was abandoned mid-stop, orphaning the cluster and breaking the *next* run |
| `test/test-isolation.test.ts` | pins all of it, including the actionable-error path |

`src/index.ts` drains on shutdown too — a SIGTERM mid-deploy used to drop whatever
telemetry was in flight.

### Verified by inspection

| Check | Result |
|---|---|
| deadlock reproduced from ground truth | Postgres deadlock report, both PIDs and statements |
| the fix replayed against the *exact* failing order (seed 101) | 1125 passed |
| 5 consecutive full runs, default order | 1125 passed each |
| failing test now exits non-zero | `EXIT=1` (was `EXIT=0`) |
| passing run still exits zero | `EXIT=0`, no unhandled rejections |
| `typecheck` / `lint` | clean |

### What else was audited

- **Every fire-and-forget DB write in a request path.** Two existed
  (`auth_events`, `ai_usage_events`); both are now tracked. The remaining `void …`
  sites are worker loops (`worker.ts`, `workers/*`, `micbridge`), started explicitly
  and never by a request, plus the in-memory rate-limit store.
- **Non-truncatable state.** No materialized views, no non-`public` schemas, no
  standalone sequences (`RESTART IDENTITY` covers the owned ones). `maintenance.test.ts`
  is the only test that does DDL; `provision`/`prune` are no-ops against today's
  migration-created partitions, and the prune regex cannot match
  `interaction_events_default`.
- **Connection exhaustion** ruled out — no `too many clients` in any run log
  (`max_connections=100`, pools capped at 4, files serial).
- **The `NOT LIKE 'interaction_events_%'` filter** in `resetDb` was matching by
  accident: `_` is a LIKE wildcard. Now escaped, same set, correct by intent.

### Still open

- **`resetDb()` truncates ~200 tables ~1100 times per run.** It is correct but it
  churns relfilenodes hard — that is why the shutdown checkpoint hit `sync files=742134`.
  Truncating only non-empty tables would cut it, and needs care to stay sound.
- **`fileParallelism: false` is load-bearing but for a different reason than its
  comment claims.** Per-file databases would *not* have fixed this bug — the race was
  within a single file — but they would let the suite run in parallel.

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
