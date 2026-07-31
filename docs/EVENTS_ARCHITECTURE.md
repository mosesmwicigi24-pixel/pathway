# Events & Announcements Architecture — the canonical model

**Status: ADOPTED 2026-07-18.** Outcome of the three-surface audit + a live reproduction
of the future-events bug. Governs the module rebuild. The member-facing wire contract
(16 endpoints consumed by iOS/RN/Android — see the frozen-contract table in the audit)
does not change shape; everything else is fair game.

---

## 1. The future-events bug — reproduced, root-caused

An event dated Sept 20 (64 days out) **saves correctly** (`POST /admin/events/series`
→ 201, series row intact, a covering `/calendar?from=+50d&to=+80d` query returns it).
It "disappears" because **five independent fixed horizons** hide it:

1. **35-day materialization horizon** (`calendar/service.ts:121`, env default
   `CAL_MATERIALIZE_HORIZON_DAYS=35`): a one-off >35d out materializes **zero**
   occurrence rows; a weekly ×52 series materializes ~5.
2. **Materialization runs exactly once, at create/update** — no cron ever
   re-materializes, so even the 35-day window rots after creation.
3. **Portal window: now−1mo → now+60d**, computed once at mount, never refetched on
   month navigation (`Events.tsx:1031`, duplicated in `Dashboard.tsx:147`). Because the
   portal derives series management from visible occurrences, an out-of-window event
   **can't even be edited or deleted** (there is no admin series-list endpoint).
4. **Member Events-tab windows** (RN +45d, Android fetch-once +60d) — "only nearby
   events appear."
5. **`maxInstances` counted from DTSTART, not the window** (`recurrence.ts:118`):
   any weekly series older than 8 weeks shows `next_at: null` in series lists despite
   real upcoming occurrences. Long-running series silently degrade.
6. Aggravators: portal-created open-ended rules get a **static `UNTIL = creation+12mo`**
   (series die a year in); materialized rows are **never reconciled after a series
   edit** (stale title/time served from `/events/:id` while `/calendar` shows the new).

**Fix direction (architectural):** windowed projection + windowed materialization +
a reconciling sweep + a real admin series API + window-paging clients. No fixed horizon
anywhere in the read path.

---

## 2. Occurrence truth model (keep the bones, fix the projection)

Series + RFC-5545 RRULE + deterministic synthetic occurrence ids (`series:ISO`) +
exceptions + `ensureOccurrence` are **right** and stay. Changes:

- `projectRange(from, to)` expands with `rule.between(from, to)` — never iterate from
  DTSTART; instance caps apply to *emitted* occurrences. Kill the per-series N+1
  exceptions query (one query, grouped).
- `materialize(seriesId, from, to)` is **window-parameterized**; the fixed horizon
  constant is deleted. Every reader of the `events` table (`homeEvents`, `myRsvps`,
  rosters) ensure-materializes its own window first (one batched upsert, `DO NOTHING`).
  The **default window is `[now−90d, now+90d]`, not `[now, now+90d]`** (amended
  2026-07-31): a strictly-forward window could never realize an occurrence that was
  already past the first time anything materialized the series — a back-dated event,
  an imported/restored series — so those occurrences projected on `/calendar` but had
  no `events` row, and every past-facing reader (command-center "recent occurrences",
  attendance roster, QR panel, CSV export) silently showed nothing.
- **Nightly reconcile sweep** (worker cron): for every active series, materialize a
  rolling `[now−90d, now+90d]` window AND reconcile — refresh times of rescheduled rows,
  soft-cancel materialized rows no longer produced by the rrule/exceptions
  (RSVP'd rows get an exception-style cancellation notice, unattended rows are pruned).
  The reconcile (refresh + prune) half stays **forward-only from `now`**: past rows are
  history — never re-timed, never pruned, never retro-notified as cancelled.
  The same reconcile runs synchronously on series update.
- **Open-ended series are legal**: drop the static UNTIL stamp; windowed expansion
  makes unbounded rules safe. Validation keeps INTERVAL/COUNT caps as DoS guards.
- Series **split** for Google-style "this and following":
  `POST /admin/events/series/:id/split {pivot_start_at, changes}` → old series gets
  `UNTIL=pivot−1s`, a new series (linked `split_from`) starts at the pivot with changes.
  "Only this occurrence" stays the exceptions path; "entire series" stays `PUT`.

## 3. Admin series API (the portal stops deriving series from occurrences)

- `GET /admin/events/series` — list with real `next_at` (windowed expansion), status,
  cadence label, follows, occurrence/RSVP/attendance counts, show_on_home/featured.
- `GET /admin/events/series/:id` — full detail (everything the command center needs:
  series fields, next/recent occurrences, exceptions, linked announcements, stats).
- `GET /admin/events/series/:id/timeline` — the audit-log slice for the series, its
  occurrences, and its announcements (created/edited/published/exception/check-in
  opened/QR issued/announcement sent/cancelled…). Everything is already audited;
  this is a filtered read, not new logging.
- `PUT /admin/events/series/:id` now also accepts the ops toggles
  (`rsvp_enabled, qr_enabled, manual_checkin_enabled, reminders_enabled,
  checkin_opens_min_before`) and `video_url` (today a dead column — wire it).
- `GET /admin/events/search?q=` — series + upcoming occurrences + announcements,
  matched on title/location/category/status; ILIKE + trigram index. Client search is
  instant over the loaded window; this endpoint covers the archive.

## 4. Calendar reads

`GET /calendar?from&to` keeps its shape (member-frozen) and its 92-day per-request cap.
Correctness no longer depends on any client's window: **clients page by visible range**
(month/agenda pages fetch on navigation, cached per month, prefetch ±1 month). The
admin consoles adopt the member CalendarView's already-correct pattern.

## 5. Announcements — first-class lifecycle

Schema: `announcements` gains `congregation_id` (multi-tenant fix; backfilled from the
sender, audience queries scoped), `series_id` (nullable FK), `event_occurrence_id`
(nullable VARCHAR) → the **three modes**: event-attached, series-attached, standalone.
Attachment is metadata + surfacing (command center lists linked announcements; sending
is unchanged). `archived_at` for archive/restore distinct from delete.

Lifecycle endpoints (existing: create/update/send/cancel/delete/feature/video):
- `POST /:id/duplicate` → new draft clone (this is also "resend" = duplicate + send,
  and "save as template / use template": a duplicate-source picker in the UI —
  no separate template entity).
- `POST /:id/archive` / `POST /:id/restore`.
- Scheduling is real today (`scheduled_at` + worker poll) — the portal finally gets a
  schedule input; pause/resume of a scheduled announcement = cancel→(re)schedule sugar.
- Edit stays draft/scheduled-only: **sent announcements are immutable history**.

**Channel honesty (fixes fabricated stats):**
- SMS/WhatsApp have **no provider**. `deliverOne` stops marking fake sends
  `delivered`; they record `suppressed (reason: no_provider)`. The composer greys
  those channels "awaiting provider". No fictional analytics.
- **Email becomes real**: announcements ride the existing SMTP `EmailProvider`
  (Brevo in prod — the same infra as password reset). Delivered = SMTP accepted.
- `markOpened` stamps **banner rows only** (today one tap contaminates every
  channel's opened stat).
- `GET /admin/announcements/:id` analytics are per-channel and real: targeted /
  delivered / suppressed(+reason) / failed / opened (banner), push sent/failed.
  Nothing we cannot measure is displayed.

## 6. Attendance & QR

- **Real QR at last**: `GET /admin/events/:id/qr` → `{scan_token, checkin_url,
  expires_at}` from the existing HMAC token machinery (rotating, time-boxed). The
  member apps' `POST /events/:id/attendance` validation already works — the admin
  consoles finally render a token members can actually scan. Auto-refresh on expiry.
- `GET /admin/events/:id/attendance.csv` — the export button becomes real
  (roster + guests + no-shows, one CSV).
- Roster truthfully tracks what the schema knows: RSVP'd, checked-in (QR vs manual),
  guests, first-timers, no-shows. Volunteer/children/late tracking needs member
  tagging that doesn't exist — deferred honestly (§10).
- `GET /admin/events/insights` replaces the portal's hard-coded tiles with real
  numbers: RSVP→check-in conversion (last N occurrences), first-time guests (30d),
  manual check-ins (7d), RSVP'd-but-absent for the most recent occurrence of each
  active series, low-RSVP upcoming events, no-response counts.

## 7. Automations (ride the existing worker/outbox)

Per-series `automation` JSONB, editable from the series editor, executed by existing
crons + outbox:
- `reminder_offsets_min` (default [1440, 60] — today's hardcoded T-24h/T-1h become
  configurable; still RSVP-going scoped, quiet-hours respected).
- `auto_archive_days` — completed occurrences archive after N days (worker cron).
- `low_rsvp_alert` — notify leaders T-48h when going < threshold.
- `qr_auto_ready` — QR panel arms `checkin_opens_min_before` (already a column).
More automations later ride the same JSONB without migrations.

## 8. Security/scoping fixes (correctness, member-visible only in the right way)

- `getEvent` / `setRsvp` / `listEventPosts` / `reactToPost` enforce the same
  congregation+visibility rules as `visibleSeries` (today any member with a synthetic
  id can read/RSVP/post to any congregation's occurrence).
- Featured event/announcement become **per-congregation** (today featuring un-features
  every congregation's pick globally).
- `/events` pages get real RBAC permissions (`events:view/edit/…`) instead of the
  coarse role gate, matching the rest of the console.

## 9. The two consoles (web + native, same IA)

- **Events Operations Center** (the page): live hero (today's events, needing-attention,
  real insights), month/week/agenda/year calendar with **windowed fetching, jump-to-date,
  jump-to-today, mini-calendar, infinite month navigation**, instant search, series rail.
- **Event Command Center** (per series/occurrence, replaces the cramped drawer):
  hero (status/cover/date/venue/series/host), attendance block (RSVP counts, conversion,
  check-ins live, guests, first-timers, no-shows), real QR panel, linked announcements
  (all three modes), moments/media, timeline, quick actions. Google Maps link from the
  venue string (a maps URL needs no API key). Weather/budget/volunteers: §10.
- **Editing** — grouped sections (General · Schedule & Recurrence · Registration &
  Attendance · Media · Announcements · Automations · Publishing · Advanced), live
  preview, Google-style recurrence editing (this / this-and-following via split /
  entire series). Occurrence reschedule/cancel keep the exceptions path.
- **Announcements Studio** (within the page): compose with real audience pickers
  (cells multi-select, level picker — today stubbed to "all"), channel picker with
  honest availability, schedule picker, the event/series/standalone attachment
  selector (today a dead dropdown), duplicate/archive/restore, per-channel analytics.
- Cosmetic-only controls are abolished: every toggle either does something real or
  does not render.

## 10. Honest non-goals (until infra exists — do not fake)

SMS/WhatsApp sending (needs a provider — Twilio/Africa's Talking); push open/click
tracking (needs FCM receipt plumbing); weather (external API + key); budgets/expenses,
volunteer scheduling, children check-in (need entities that don't exist); attendance
heat-maps beyond the weekly trend (needs per-service granularity we don't capture).
Each is a bounded follow-up, none blocks this architecture.

## 11. Compatibility & rollout

1. Migrations are additive (`announcements` columns, `event_series.split_from`,
   `automation` JSONB, `archived_at`, indexes incl. trigram).
2. Backend lands with the member contract byte-identical — the frozen-table endpoints
   keep their shapes; scoping fixes only *narrow* access to what visibility rules
   always intended. Member canary tests must pass unchanged.
3. Consoles swap to windowed fetching + the new admin APIs; the 60-day constants die.
4. Member-app follow-ups (RN's 45-day Events window; Android's fetch-once calendar)
   are noted for their own repos — server correctness no longer depends on them.
