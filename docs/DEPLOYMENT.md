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

> **`$PORTAL_ROOT` = `/var/www/pathway-portal`** (verified 2026-09-23 from the
> live nginx server block: `root /var/www/pathway-portal;` in
> `/etc/nginx/sites-enabled/pathway.nuruplace.org` — the host nginx serves the
> bundle directly; there is no Caddy in front of it any more). Fetch the
> artifact with `gh run download <run id> -n portal-<full sha> -D /tmp/portal-new`
> and rsync from there. The API side is scripted on the box:
> `/usr/local/sbin/pathway-deploy-api.sh <short sha> [--migrate]` (pulls
> `ghcr.io/…/pathway-backend:sha-<short>`, repins `BACKEND_IMAGE` in `.env`,
> runs `migrate` with `-T` when asked, recreates api + worker with BOTH compose
> files, prints image revisions + readyz).

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

### 2026-10-07 — The editorial Sunday Letter (v3): a photograph, the week's true figures, the verse in full, an A4 PDF

**What shipped.** pathway#512 (`e5912d1`, squash-merged on its exact green head), on the owner's YES ("deploy when green"). The owner asked for "a better Sunday Letter… images… a good report like a nice template from Pages", and on the canvas chose:
- the editorial letter;
- signed "Pastor Moses" in handwriting;
- with a "keep this letter" PDF.

The contract is additive, with no migration. Every new field is derived, never written by the model:
- `photo`: from the eye-checked nature library, by theme and the week's weather season, frozen per letter.
- `figures`: true counts of the letter's own week, never a zero.
- `scripture`: the text comes from the church's `daily_verses`. The model now chooses from those references.
- `issue_no`, `reading_minutes`, `paragraphs`, `signed_by` and `pdf_url`.

New: `GET /me/letters/:id/pdf`. It renders one A4 page with `pdf-lib` (a new dependency) and OFL fonts bundled in the image. The apps' letter screens are being rebuilt to it. Until they ship, the new fields are ignored and members see no change. This Sunday's letters are the first written with the new fields.

**Caught while building.**
- pdf-lib's font subsetter dropped Inter's glyphs ("No. 6" printed as ". 6"). Inter is now embedded whole.
- A passing network blip cost one render its photograph. The fetch now retries once and caches in-process.

**Verified.** - **Deploy:** 2026-10-07 09:10 EAT, with no migration. The api and worker run revision `e5912d132`, restarts 0. `/readyz` returns 200 through the edge.
- **Image contents:** all 6 letter fonts are present, and `letterPdf.js` and `letterExtras.js` are in the running dist.
- **Verses:** `daily_verses` holds 365, all with text.
- **Inside the live API container,** with no member data:
  - a sample letter fetched its photograph from the curated library ("A rose-coloured sunrise over the hills", 33,041 bytes);
  - it rendered a 396,467-byte `%PDF-`.
- **The new route:** `GET /v1/me/letters/:id/pdf` answers 401 without a token.
- **Since 06:10Z:** 0 error-level lines in the api or worker logs, and 0 5xx at nginx.

**Two snags, neither affecting production:**
- **The connection dropped mid-verification.** The deploy script's SSH session hit "server not responding" after the containers had already been recreated. Production was checked first, then verified separately.
- **A verification script swallowed itself.** Fed through `ssh … bash -s`, a `docker exec -i … psql -c` line read the REST OF THE SCRIPT from standard input. Run remote scripts as a file (`scp`, then `bash file </dev/null`), never through stdin, whenever they contain `docker exec -i`.

**Rollback.** Redeploy `sha-a6d1d61`. Nothing was migrated. Letters written meanwhile only carry extra keys inside `highlights`, which the older code ignores.

### 2026-10-06 — Home's featured video had black bars baked in, and the verse photo ignored the hour

**What the owner saw (01:37–01:45, iPhone build 131).**
1. The new featured video, "Nuru Pathway", uploaded at 01:23, was a portrait clip pillarboxed inside a wide frame.
2. Behind the Verse for Today at 01:42 was a crowd of people under soap bubbles. The owner asked for pictures that "reflect the hour, the time, the season … realistic … in the nature … now this is midnight, there must be something beautiful demonstrating midnight."

**Root causes.**
1. **Video.** Two causes:
   - The file itself was 1920×1080 with the bars in its pixels: a 608×1080 portrait picture exported from a 16:9 DaVinci Resolve timeline. ffmpeg `cropdetect` gave the same result at 0:00, 0:50 and 1:40.
   - Both apps also forced every featured video into 16:9.
2. **Verse photo.** `artForText()` scored the verse's words (10 per hit) above the time of day (6), so "race … runners … prize" chose a daytime crowd at midnight. The pools under it had their own faults:
   - the themed library held runners, an astronaut tagged "storm, water", painted hands, a wine glass and bread;
   - half the night pool was northern lights and snow;
   - 14:00–17:00 drew from the sunset pool.

**Fixes.**
1. **Video file** (production data write, owner YES "Crop and replace"):
   - Cropped on the Mac (`crop=608:1080:656:0`, x264 CRF 19, the original 50 fps, AAC 192k, faststart): 336 MB down to 37 MB.
   - Uploaded beside the original as `f599e26f-…-portrait.mp4` with a portrait thumbnail.
   - Backed up the row to `/root/backups/featured-video-20261006/media_asset.csv`.
   - Updated the one `media_assets` row with a guard (`external_url`, `thumbnail_url`, `source_object_key`).
   - The original `.mov` is kept, so rollback is a single update.
   - The apps take the video's own shape: iOS 41e1919 (in build 132, installed) and Android 9caedab.
2. **Pictures** (pathway#509, squash-merged `a6d1d61`, owner YES "deploy when green"):
   - A new `intelligence/nature.ts` holds 216 nature photographs, each looked at on contact sheets.
   - The hour is the law: a picture clock set by Nairobi's sun, in nine stages from deep night to nightfall.
   - The season fits: Kenya's rains and dry months, and the church year's Advent, Christmas, Lent and Easter.
   - The verse's words choose only among the photographs the hour allows.
   - The payload is unchanged, so no app build is needed.

**Verified.** **Video:**
- Both new files are served through the edge (200, `video/mp4`, 37,074,853 bytes, sha256 matched the encode; ffprobe reads 608×1080).
- After the update, the row points at the portrait file with `is_homepage` still true.
- Build 132 has called `/home/welcome-video` since the switch (02:21–02:23 EAT). The endpoint reads that row directly with no cache, so it returns the portrait file. When this entry was written, the phone had not yet fetched the new files (the card hadn't been scrolled into view since).

**Pictures:**
- Deployed 2026-10-06 00:01 UTC (03:01 EAT), with no migration and no schema change.
- The image `sha-a6d1d61` was pulled; api and worker run revision `a6d1d61b1`, healthy, restarts 0.
- `/readyz` returns 200 locally and through the edge, and the api logs show 0 errors since.
- `nature.js` is present in the running dist.
- Asked inside the container at 03:01 EAT with the race verse, the hour reads *deepnight*, the weather *rains*, 216 photos. The liturgy card gets "Moonlight on a rocky shore" and the verse card "The night sky held in still water": different photographs, both of the night.

**Why it went unnoticed.** The picker's tests checked that it *matched words*, not that it kept the hour. No test asked what a member sees at midnight, and nobody had looked at the pools' photographs together until tonight's contact sheets. The upload path has no check for baked-in bars either.

**Prevention.** `test/nature-art.test.ts` covers:
- the owner's exact case, plus the old picker's output pinned as evidence;
- every hour of the clock;
- 14:00 is never a sunset;
- the season;
- the two cards never coincide over a year;
- daily variety;
- a banned list of the 30 people, object and far-north photographs.

Follow-up for the owner, not done: the admin upload could run `cropdetect` and offer to crop.

**Also audited.** The verse and liturgy cards share one selector now. The old `artForText`, `pickBandArt` and `LITURGY_ART` remain exported for their tests only, and no route serves them; deleting them is a cleanup for later. The portal is unchanged and wasn't redeployed.

### 2026-10-05 — The stack lands: Giving cycles, notification sounds, Experience Cycles 1–5 (server)

**What shipped.** pathway#507 (merge commit `c349bbf`) merged the branches that had been
stacked since 2026-09-28. That was the Giving cycles 1–10 (was #496), notification
sounds (was #497) and the Experience programme's server side (was #498),
with the day's two hotfixes already on `main`.

**Owner YES, 2026-10-05** ("yes to A, B, C and D — go ahead"):
- **(A) Money logic:** the Giving cycles, including the two schedule backfills.
- **(B) Announcement visibility:** any recipient, by any channel, can open an announcement, and opening it reads its notices.
- **(C) Migrations 218–223.**
- **(D) Android's sign-out revokes the session.** This ships with the app merge, not this deploy.

**Migrations.** All six are additive: new columns on `transactions`,
`giving_schedules`, `pledges` and `notification_preferences`; a check on
the new `failure_code`; and six indexes (three in 218, one in 220, two in 222). Two backfills ran against
production's baseline of 8 active schedules (3 monthly, 5 weekly, none paused):
- 219 set `anchor_day` on the 3 monthly schedules from their creation day.
- 220 found no paused schedule to label.

Backups were taken first: `giving_schedules`, `pledges` and
`transactions` → `/root/backups/stack-deploy-20261005/`.

**Verified.** Deployed 2026-10-05 21:27 UTC with `--migrate`: api + worker revision `c349bbf8c…` (image `sha-c349bbf`), api healthy, worker up with no restarts (FCM, SMTP and SMS providers active), `/readyz` 200 locally and through the edge. All six migrations ran (218–223), 18 of 18 columns and 6 of 6 indexes exist, and the `failure_code` check is in place. Monthly schedules with `anchor_day`: 3, as expected; paused schedules without a reason: 0; the 8 schedules are unchanged. The new routes answer (`/v1/me/cell-connection` and others → 401 unauthenticated), the running `dist` holds the new code, and there were no error-level lines and no 5xx afterwards. Backup: `money-tables.dump` (35,982 bytes, 8 schedules, 3 pledges, 141 transactions). Portal: the CI artifact `portal-c349bbf…` is served, and `version.txt` = `c349bbf8c…` through the edge (the previous bundle is kept beside the backups). **Merged during a GitHub Actions incident** on the owner's explicit "merge", with the queued CI jobs cancelled by GitHub. The evidence was green build, lint, types, contract, migrations and seed on the previous commit, the full suite green locally on the merged code (176 files, 1,932 tests), and `main`'s CI on `c349bbf` then went fully green (`checks`, 8 shards, `ci`). CI itself now runs in 8 parallel shards (about 3 minutes each).

**Rollback.** Redeploy `sha-50e914e` and the previous portal artifact. The
migrations are additive, so the old code runs on the new schema; roll
forward rather than down. The backups hold every pre-deploy row.

### 2026-10-05 — Every member read "Level 1 of 7": a stray level, and a status no member read honoured

**Symptom.** Both member apps' closing walk (Experience Cycle 3) read
"Level 1 of 7", a 14% journey ring, a map view saying "SIX-LEVEL PATHWAY"
over "0/7", and a second "LEVEL 1" on the trail. Production (read-only):
**seven published levels**. Level 7 was titled "LEVEL 1" with no modules.
Its description began "Multiplying — raising leaders…", so it may have been
meant as a seventh level and given the wrong title. Level 6 was titled
"Level 6", also with no modules. All 87 active members were on Level 1.

**Root cause.** The portal sets each level to Draft, In review or Published,
but no member-facing read honoured that status. `/levels` and `/me/pathway`
selected every level. Unpublishing level 7, the owner's first choice, would
have changed nothing members see. The trace caught this before the write.

**Why undetected.** The admin toggle saves and reads back fine on staff
screens. Members' screens have no test of a draft level. Nothing in the
local rig had more levels than its seed until production's content was
copied in for this programme.

**Permanent fix.** pathway#505 (`50e914e`): `/levels` lists published levels
only. `/me/pathway` lists published levels plus every level at or below the
member's own, so drafting a level hides only the road ahead, never where a
member stands or has walked. Staff reads are unchanged.

**Data.** Owner YES, 2026-10-05 ("yes do the level 7 fix"): level 7 →
`draft`, guarded (title "LEVEL 1", published, no modules, no member on or
past it), backed up to `/root/backups/level7-draft-20261005/level7.csv`.
The level cache (`cache:levels`, 10 minutes) was cleared. Level 6's name
stays as it is, on the owner's word.

**Prevention.** `draft-levels.test.ts` reproduces production's exact shape
and fails without the fix.

**Verified.** Deployed 2026-10-05 15:31 UTC: api + worker revision `50e914e55…` (image `sha-50e914e`), healthy, `/readyz` 200 locally and through the edge, `/v1/levels` → 401 unauthenticated (route present). Both filters are in the running `dist/modules/curriculum/service.js`, and the 10:35 Talk fix is still present. Level 7 set to `draft` at 15:31 UTC ("level 7 set to draft"). Read-only check: level 7 is `draft`; a Level 1 member's levels number **6** (1 Foundations of Faith … 6 Level 6). No error-level lines and no 5xx since. Redis held no `levels` key, so nothing stale was served.

**Rollback.** Code: redeploy `sha-ec9a519`. Data: set level 7's `status`
back to `published` (the backup holds the full row).


### 2026-10-05 — A post in Talk it Over never completed the part: 14 members' plan days stuck

**Symptom.** Walking Plans for the experience programme on Android, a day
could not be finished without posting, and after posting the day still read
"Next" on Talk it Over. Production (read-only, counts only): **34 plan days
for 14 members** had Talk it Over as their only open part, the latest on
2026-09-30. Their next day stayed locked. On **23 of those days (11 members,
13 plans)** the member had posted in that day's conversation.

**Root cause.** The owner's rule (2026-10-05) is that Talk it Over is
completed by posting **or** by "I've talked it over". The server held only
half of it. `POST /growth/plans/:id/days/:n/talk` created the post and
completed nothing. Whether a post completed the part depended on each app
calling `/growth/segments/:id/complete` afterwards. The Android build on
members' phones never did, and it has no "I've talked it over" button.

**Why undetected.** Server tests covered posting and completing a part
separately; none said "a post completes Talk". The rule lived in app code,
and the two apps had drifted. The trapped state looks like an ordinary
unfinished day, so no member could tell it apart from "not done yet".

**Permanent fix.** pathway#502 (ec9a519): `postTalk` completes the day's talk
part through the same `completeSegment` door the apps use (same gate, same
seal). A post on a day still behind an earlier one stands and leaves that
day open. It reaches every app build already on phones. The Android
"I've talked it over" button ships in the next app build (Experience
Cycle 3, §7.4 #1).

**Data.** Owner YES 2026-10-05 ("yes do both 1 and 2"). The 23 talk parts
where the member had posted were completed, each dated to the member's
**first** post that day, and `completed_days`/`current_day` were updated as
`completeSegment` does. No plan was finished by it. The transaction
refused to commit unless the set matched the backed-up one exactly (row
count plus an md5 of the (member, part, post time) set), every part
inserted, every plan row updated, and no stuck day with a post remained.
Backup: `/root/backups/talk-backfill-20261005/` (pairs.csv, progress.csv).
Rehearsed first on the local prod-shaped database: a wrong expectation is
refused with nothing changed, the real run seals the right days, a no-post
day is left alone, and a second run is refused. The 11 days that remain (8 members; some had posted on other days but
not these) have no post. A post now completes them on any app version, and
"I've talked it over" arrives with the next Android build.

**Prevention.** The server owns the rule, and
`growth-content.test.ts` pins it (the test fails without the fix). Audited the
class, "a part some app build cannot complete": production's open parts
by kind show Talk as the only pattern; besides it there is one member's video
part from July.

**Verified.** Deployed 2026-10-05 10:35:19 UTC: api + worker revision `ec9a51937…` (image `sha-ec9a519`), api healthy, `/readyz` 200 locally and through the edge, `POST /v1/auth/login {}` → 400 JSON, the talk route unauthenticated → 401, and the fix present in the running `dist/modules/growth/service.js` (line 408, `await this.completeTalkParts(…)`). No error-level lines and no 5xx responses since. The data fix committed at 10:37 UTC ("23 parts completed, 13 plan rows updated, 0 remain"). Re-count, read-only: stuck on Talk went from 34 days to 11 (8 members), none of them with a post. All 23 parts are dated exactly to the member's first post. No plan was finished by it. Backups: `pairs.csv` (23 rows) and `progress.csv` (13 rows) in `/root/backups/talk-backfill-20261005/`.

**Rollback.** Code: redeploy `sha-e6b6e63`. Data: delete the 23 (user_id, segment_id) rows listed in `pairs.csv` and restore the 13 rows of `progress.csv`.


### 2026-10-04 — Android could not give an unnamed gift, check in to a service, or save a formatted thought

**Symptom.** Walking Give on the Android emulator for the experience
programme, a plain KSh 1,000 Tithe answered **"Request body failed
validation"**. Production's API log for the 8 days it keeps held 11 gift
attempts, all Android (`okhttp/4.12.0`), all Sunday 2026-10-04: **10 refused
with 400** in 2–15 ms, and **1 accepted** — a *named* gift (KSh 2,500, 10:00:50
EAT) right after three refusals. No money moved on a refusal (the body is
refused before any charge or STK push).

**Root cause.** The Android app's kotlinx Json (`encodeDefaults = true`,
explicit nulls on) sends every unset `val x: T? = null` request field as
`"x": null`. Three server schemas still declared such fields `.optional()`,
which accepts *absent* but refuses *null*:

- `POST /giving/intents` `account_name` — every unnamed Android gift (card,
  M-Pesa, PayPal, a pledge's Pay now, a need's gift), since named giving
  shipped on 2026-07-27.
- `POST /services/:id/attendance` `attended_at` (Android never sets it),
  `full_name`, `phone_number` — every Android QR service check-in, since
  2026-08-16.
- `PUT /me/thoughts` and its `/sync/push` replay — every *formatted* Selah
  thought, silently; offline, the queued write was rejected and dropped.

**Why undetected.** This exact class had been fixed before (live's `cell_id`,
c65c353) and `test/android-body-tolerance.test.ts` exists for it — but its
giving test posted a body *without* `account_name`, so it never sent the
field Android sends. The app showed the raw error, so it read as a member
problem; check-in and thoughts had no production traffic in the log window.

**Permanent fix.** pathway#499 (e6b6e63): those fields accept null and treat
it as *not given* — the profile and now() fill check-in fields, an unnamed
gift stays unnamed, stored thought spans match iOS's; a check-in's
`email: null` keeps its meaning ("I have no email"). The only fix that
reaches Android builds already on phones.

**Prevention.** The tolerance suite now posts Android's **exact** bodies (5 new
tests; all fail on the old schemas). A read-only audit of all 72 Android
request bodies against the production schemas found no other instance. The
Android side will also stop sending these nulls (`@EncodeDefault(NEVER)`) in
its next build. Known deploy-order hazard of the same family: the Android
notification-sounds build sends `sound_enabled` to a `.strict()` schema —
the backend (#497) must deploy first.

**Verified.** Deployed 2026-10-04 15:01:42 UTC: api + worker revision
`e6b6e634f…`, api healthy, `/readyz` 200 through the edge, the new rules
present in the running `dist/`, `POST /v1/giving/intents` unauthenticated →
401, no error lines in the following 10 minutes. A real gift was not used as
a probe (it would move money).


### 2026-09-05 → 2026-09-11 — The whole box vanishes for two to four hours, about every three days

**Symptom.** Members on Android and iOS, and the owner in Firefox, saw
"taking too long to respond" / "failed to connect to pathway.nuruplace.org/
72.60.187.67 (port 443) … after 15000ms" — at 21:03, 22:54 and 12:49 EAT on
different days, from different phones and networks. The first report
(5 Sep, 11:49 EAT) could not be caught: by the time anyone probed, the site
answered again and nothing had recorded when it failed or for how long.

**What the outside watch recorded** (`.github/workflows/uptime.yml`, added
that day, every five minutes from a GitHub runner):

| Down (UTC) | Up (UTC) | Length | EAT window |
|---|---|---|---|
| 2026-09-05 19:25 | 21:25 | 2 h 00 | Fri 22:25 → 00:25 |
| 2026-09-08 23:20 | 01:17 | 1 h 57 | Tue 02:20 → 04:17 |
| 2026-09-11 04:52 | 09:11 | 4 h 19 | Thu 07:52 → 12:11 |

Every failed probe was a **TCP connect timeout** — on `/readyz` AND on the
portal's `/`. Not a 502, not a 503 "degraded": nginx itself was not accepting
connections. The machine, or the route to it, was gone; it came back with no
human touching it (issues #469, #470, #471, closed by the probe on recovery).

**What it is not.** Not old phones and not the apps: the same failure was
seen from GitHub's runners in the same windows, and the apps' own error
text is exactly what OkHttp / URLSession say when a SYN gets no answer. Not
Hostinger's published status either (nothing posted on those dates).

**Where the cause lives — all on the box, none of it visible from outside.**
The address is Hostinger, Paris, shared with the mail server
(rDNS `mail.bethanyhouse.co.ke`) and four other stacks, on a host the
runbook already calls CPU-starved and oversubscribed. Three explanations
fit "whole box, hours, self-recovering", and the box's own records decide
between them:

1. **Memory exhaustion → swap thrash**, until the OOM killer frees it:
   `dmesg -T | grep -iE 'oom|killed process'` and `journalctl --since`
   for those windows; `free -h` now.
2. **Provider mitigation.** A mail host draws abuse; a null-route or a
   firewall block for a fixed period looks exactly like this. hPanel →
   the VPS → Firewall / security events for those dates; Hostinger
   support can confirm a null-route.
3. **A scheduled job on the host** (backup, log rotation, mail housekeeping)
   pegging IO for hours: `crontab -l`, `ls /etc/cron.*`, and mailcow's own
   schedules, against the window start times.

**Permanent fixes, in order of effect.**
- Move the pathway API off the mail box. A small dedicated VPS ends the
  shared fate with mail and the CPU steal in one move, and makes the
  runbook's "do not build on the box" caveat moot.
- Until then, memory limits on the other stacks (`mem_limit` in their
  compose files) so mail cannot take the API down with it.
- Cloudflare in front of `pathway.nuruplace.org`: Kenyan members terminate
  TLS at a Nairobi edge instead of Paris, the origin address is hidden from
  abuse, and the portal's static bundle stays served from cache during a
  short origin loss. (An origin null-route still takes the API down — this
  is a mitigation, not the fix.)
- The apps: keep the last good copy of what they read and show it while the
  server is away, say plainly that the server is unreachable, and retry
  without being asked — so a two-hour host outage is a stale Home, not a
  blank page. (Tracked in the mobile repos.)

**Still unproven.** Which of the three it is. Nothing here can be settled
without a shell on the box or hPanel; the commands above are the first ten
minutes of that session.


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
