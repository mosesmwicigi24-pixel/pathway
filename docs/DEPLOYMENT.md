# Deploying to production

`pathway.nuruplace.org` runs **two separately-deployed things**, and it is easy
to ship one and believe you shipped both:

| Part | Built by | Deployed as |
|---|---|---|
| **Backend API + worker** | `.github/workflows/build-image.yml` → GHCR | a container image the VPS pulls |
| **Admin portal** (`@nuru/admin-web`) | `.github/workflows/ci.yml` → run artifact | a static bundle Caddy serves |

Neither is automatic. A merge to `main` builds both, but nothing on the box
moves until a human runs the steps below.

Neither is built *on* the VPS, deliberately: that box is CPU-starved and
oversubscribed, and a build there stalls under ~90% CPU steal. Both halves are
built in CI and downloaded.

---

## 1. Backend

```bash
cd /opt/pathway
docker compose -f docker-compose.prod.yml -f docker-compose.vps.yml pull
docker compose -f docker-compose.prod.yml -f docker-compose.vps.yml run --rm -T migrate
docker compose -f docker-compose.prod.yml -f docker-compose.vps.yml up -d \
  --force-recreate --no-deps api worker
```

> **Why `-T`.** Without it, `compose run` allocates a TTY and holds stdin open.
> If the terminal you launched it from then goes away — ssh drops, the laptop
> sleeps, the session is closed — the migrate process is left blocked in
> `epoll` on a pty nobody is attached to. It never exits, so `--rm` never
> fires, and the container sits "Up" forever holding a reference to a stale
> image. That is exactly what happened on 2026-08-24 (see the ledger entry
> below): a container ran for nine days doing nothing. `-T` makes the step
> non-interactive, which is what a deploy step should be anyway.
>
> A TTY container also makes `docker logs` block on the pty, which is what
> makes these look scarier than they are when you find one.

Pulling a private GHCR image needs `docker login ghcr.io` with a `read:packages`
PAT, unless the package has been made public. The image holds only compiled JS —
no secrets — so public is acceptable.

## 2. Portal

Download the `portal-<sha>` artifact from the green **CI** run for the commit
you are deploying (Actions → CI → that run → Artifacts), then extract it over
the directory Caddy serves.

```bash
PORTAL_ROOT=/var/www/pathway-portal          # nginx, not Caddy: see below

unzip -o portal-<sha>.zip -d /tmp/portal-new
cp -a "$PORTAL_ROOT" /root/portal-backup-$(date +%s)
rm -rf "$PORTAL_ROOT"/assets                 # hashed names: stale ones accumulate forever
cp -a /tmp/portal-new/. "$PORTAL_ROOT"/
chown -R 501:staff "$PORTAL_ROOT"
```

> **`$PORTAL_ROOT` is `/var/www/pathway-portal`**, and it is served by **nginx**,
> not Caddy — `root /var/www/pathway-portal;` in
> `/etc/nginx/sites-enabled/pathway.nuruplace.org`. Recorded 2026-08-17; this
> paragraph previously said the value could not be known from the repo.

> **DO NOT `rsync --delete` INTO THIS DIRECTORY.** It holds two pages that are
> NOT in the CI bundle and never will be:
>
> ```
> privacy.html          → the privacy policy URL on the Play listing
> delete-account.html   → the account-deletion URL Play requires
> ```
>
> Both currently serve 200. `rsync -a --delete`, which this runbook used to
> prescribe, removes them — and the first anyone would learn of it is a Play
> policy warning, or a member following a deletion link into a 404. The copy
> above overwrites what the bundle contains and leaves everything else alone.
>
> `assets/` is cleared deliberately, and only `assets/`: Vite emits
> content-hashed filenames, so without that the directory grows a new copy of
> the app every deploy and never sheds one. Nothing outside `assets/` is ever
> removed.

---

## 3. Verify — do not trust the deploy output

`migrate` prints "migrations complete" when nothing ran, `docker pull` reports
success for an unchanged digest, and copying files is not evidence a browser is
being served them. Check each half by inspection.

**The API is running the code you think it is.** Pick a route that is new in
this release; it must answer, not 404. A `Cannot GET` body is Express saying the
route does not exist, which means the old image is still up:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://pathway.nuruplace.org/v1/services
# 401 = deployed (route exists, auth required).  404 = NOT deployed.
```

Calibrate against a route you know exists before believing a 404 — an
unauthenticated `GET` on a `POST`-only route also 404s:

```bash
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' \
  -X POST -H 'Content-Type: application/json' -d '{}' \
  https://pathway.nuruplace.org/v1/auth/login
# 400 application/json = the API itself is up and reachable at /v1.
```

Note that `/` and any unknown path return **200 text/html**, because Caddy falls
through to the SPA. Those tell you nothing about the API.

**Every new relation exists.** Migration numbering collisions between concurrent
branches are a known failure here, so confirm the objects rather than the
migration log:

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U nuru -d nuru -c "SELECT to_regclass('church_services'), \
                                  to_regclass('service_attendance'), \
                                  to_regclass('service_attendance_streaks');"
# any NULL = that migration did not run
```

**The portal being served is the bundle you built.** CI stamps the commit sha
into `version.txt` inside the bundle:

```bash
curl -s https://pathway.nuruplace.org/version.txt
# must equal the sha you deployed; a stale bundle behind a cache is otherwise
# indistinguishable from a successful deploy
```

**Workers are up and logs are clean:**

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --since 5m api worker | grep -i error
```

---

## 4. Rollback

Backend: re-pull the previous image tag and recreate. Migrations are written
forward-only but proven reversible in CI (`down 0` then up), so a schema
rollback is possible but is a deliberate decision, not a reflex — data written
since the deploy may not survive it.

Portal: extract the previous run's artifact over `$PORTAL_ROOT`. It is a static
bundle, so this is instant and total.

## Incident ledger

### 2026-09-02 — Recurring giving could never have worked: the charger had no M-Pesa keys

**Symptom.** A probe of the new `/giving/partnership` endpoint showed six
active M-Pesa schedules created 17-18 June with `kept: 0` — not one cycle ever
collected — and `giving_schedules.last_error` reading **"mpesa payments are not
configured"** on every one.

**Root cause.** The Daraja credentials were listed under the **`api`** service
in `docker-compose.vps.yml` and nowhere else. The process that charges
recurring gifts is `runDueSchedules`, which runs in the **`worker`**. The worker
had never been given those variables — `env | grep -c MPESA_` returned **0** in
the worker and **7** in the api. Recurring giving has therefore never been
capable of collecting a single shilling in production since the day it shipped.

**Why undetected.** Two reasons compounding.

1. Until migration 211 landed that same morning, `runDueSchedules` swallowed
   every failure with a bare `catch { failed += 1 }`. The charger had been
   failing on every pass for ten weeks and saying nothing to anyone. The only
   reason this was findable at all is that the failure-visibility work had
   shipped hours earlier and had started writing `last_error` to the row.
2. This is the **third** instance of the same class in this one file, which
   already records the AI keys (2026-08-01) and SMTP. Each time, a provider was
   wired to the api and the worker — the process that actually runs the job —
   was forgotten.

**A latent danger this exposed, worse than the outage itself.** `next_run_at`
advances by ONE interval per success, so a schedule due 24 June becomes 1 July —
still in the past, still due. The moment M-Pesa was configured, each stale
schedule would have been charged roughly **ten times in quick succession** over
the next few worker passes. The per-cycle idempotency key does **not** protect
against this: it keys on `(schedule, due-instant)`, and ten stale cycles carry
ten distinct keys. They are not a repeat of one charge; they are ten
legitimately distinct charges that nothing in the system would have questioned.
Fixing the configuration without noticing this would have looked like a
successful deploy while emptying accounts.

**A lie found in our own tests.** The failure-visibility tests written that
morning simulated "the giver's payment failed" using a `FinancialService`
constructed with **no providers** — which is the misconfiguration path, not a
declined payment. They passed while describing something they never exercised,
and they would have kept passing after the two paths were given different
behaviour. They now use a provider that is configured and declines.

**An error of judgement, recorded because the fix was not only technical.** On
finding six rows in `giving_schedules`, I reported them to the owner as "six
real partners" and wrote "ten weeks of partners believing they were giving"
into commit messages and a PR body. I drafted an apology letter for him to send
them. They were all his own test schedules — two accounts, the same phone
number on all six, three of them exact duplicates. One query against `users`
would have shown that, and I had been in that database repeatedly. Six rows in
a giving table are not six people until you check. The engineering findings
stood; the human urgency I attached to them was invented.

**Permanent fixes.**
- `docker-compose.vps.yml` hoists the keys into an `x-mpesa-env` **anchor**
  referenced by both `api` and `worker`. Listing them twice would have worked
  and invited a fourth outage of this shape; an anchor makes the two impossible
  to separate by accident.
- The charger refuses a backlog: a schedule more than one full interval overdue
  is rolled forward to its next FUTURE occurrence and not collected
  (`skipped` counter). `rollForward` steps interval by interval so a
  Tuesday-09:00 gift lands on a future Tuesday at 09:00.
- `ProviderNotConfiguredError` separates *our* fault from *theirs*. A
  configuration failure does not count toward a giver's three strikes, does not
  pause their schedule, and does not notify them — it is recorded and shouted at
  the operator instead. A distinct type, not a string match: a message anyone
  may reword is not a thing to branch on.

**What else was audited.** Every payment-provider variable in
`docker-compose.vps.yml` was checked against both services; M-Pesa was the only
one still split (Stripe and the webhook secrets already sat in the shared
anchor). The owner's eight test schedules were cleared from production at his
instruction, after asserting that no schedule belonged to any other phone and
that no transaction referenced one; 104 transactions and 112 ledger entries were
left untouched.

**Still unproven.** Recurring giving has been made *capable* of working and
verified only that far — the worker now sees the credentials. No charge has ever
completed end to end in production. Until one does, this is a fix believed to
work, not a fix demonstrated to work.

### 2026-09-02 — A migrate container ran for nine days doing nothing

**Symptom.** During the deploy of `2ad3f0b`, `docker ps` showed
`pathway-migrate-run-0057e65ff03f` **"Up 9 days (unhealthy)"** on the floating
`:latest` tag, alongside the real `api`/`worker` on their pinned sha.

**A wrong turn worth recording.** The first two attempts to inspect it timed
out, and I reported that *`docker inspect` hangs on this container* — and
reasoned from that to "something is deeply stuck". That was wrong. Both
commands were batched with `docker logs`, and `docker logs` is what blocked.
Bounded separately, `docker inspect` on the stray container returned in
milliseconds, exit 0, same as on a healthy one. **Lesson: never attribute a
hang to a command you did not time in isolation** — batching diagnostics
hides which one failed.

**Root cause.** The container was started 2026-08-24T12:39:52Z with
`Tty=true, OpenStdin=true` — a `docker compose run --rm migrate` *without*
`-T`. Its process tree was `sh -lc pnpm migrate:up` → `node pnpm migrate:up`,
with stdin/stdout bound to `/dev/pts/0` and the child parked in `ep_poll`.
The launching terminal went away; the process was left waiting on a pty
nobody was attached to, so it never exited, so `--rm` never fired. The TTY is
also why `docker logs` blocked on it.

**Blast radius: none.** It held no database lock (`pg_locks` ungranted = 0, no
idle-in-transaction backends, oldest xact age 00:00:00), consumed 0.0% CPU,
and was not in D-state. It could not have blocked a future migration. Its only
cost was clutter and a reference to a stale image.

**Why undetected.** Nothing watches for orphaned `*-run-*` containers, and
`docker ps` output is long enough on this box (41 shims, five stacks) that one
extra line reads as normal.

**Permanent fix.** The runbook's migrate step now specifies `--rm -T`
(§1 above, with the reasoning inline). A deploy step should be
non-interactive; the TTY bought nothing and cost nine days of a phantom
container.

**What else was audited.** Every stack on the box (`pathway`, `neema`,
`bethany`, `bethanywebsite`, `mailcow`) for `-run-` leftovers: this was the
only one. The migrate run from *this* deploy cleaned itself up correctly. The
only other TTY-allocated containers are two mailcow services, which are
configured that way deliberately and are not orphans. No sibling instances of
the class exist.

### 2026-08-24 — Daily liturgy silently served fallback (thinking exhausted the compose budget)

**Symptom.** After the liturgy voice-rules deploy (#454, `cba9a8a`), today's
`liturgies` rows never appeared: every `/home/liturgy` fetch re-ran the deep-tier
compose (~36-46 s response times) and members read the authored fallback. The
usage ledger (`ai_usage_events`) showed the calls *succeeding*, which sent the
investigation down two false trails (GitHub billing, then request timing).

**Root cause.** Deep-tier thinking shares `max_tokens` with the visible output.
The new voice rules made Opus deliberate longer while writing *less*; at
`maxTokens: 3200` thinking consumed the entire budget and the reply contained no
text ("The assistant had nothing to say"). `composeFor`'s catch swallowed the
error without logging and served `FALLBACK_LITURGY` uncached — correct behavior
wearing an invisibility cloak.

**Why undetected.** (1) The catch was silent — a governance violation ("never
swallow errors silently") that had sat there since the catch was written.
(2) `ai_usage_events` records success at the HTTP layer, before the empty-text
guard throws. (3) The member-facing response still returned 200 with a plausible
line, and the personal-word override masked the communal line in probes.

**Fix.** #455 (`662d80a`): `maxTokens` 3200 → 8000 (visible JSON is ~700
tokens; thinking can no longer quietly exhaust the budget) and the catch logs
what it swallows. Proven live: the first real fetch on the fixed image composed
and cached all 7 bands.

**Class audit.** Other deep/standard-tier call sites either stream, use ample
budgets, or surface errors to the caller; the empty-text-after-thinking hazard
is specific to bounded-JSON deep calls — `daily_liturgy` was the only one at a
tight budget. The silent-catch pattern was not found elsewhere in the
intelligence module (`personalLiturgy` falls back loudly via its own guard and
caches deterministically).

**Prevention.** Any future bounded-output deep-tier call: budget ≥ 4x the
expected visible output, and no catch without a log line. `ai_usage_events`
"success" must not be read as "output usable".
