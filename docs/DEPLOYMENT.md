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
unzip -o portal-<sha>.zip -d /tmp/portal-new
rsync -a --delete /tmp/portal-new/ "$PORTAL_ROOT"/
```

> **`$PORTAL_ROOT` is the one thing this document cannot tell you.** The
> `Caddyfile` is mounted into the container from the box and is not in this
> repo, so the static root is only visible on the server. Read it out of the
> Caddyfile once and record it here — until then this step is guesswork, which
> is exactly what a runbook exists to eliminate.

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
