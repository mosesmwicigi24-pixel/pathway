# Cross-Surface Parity Matrix

> **Purpose.** Nuru Pathway ships on four surfaces over one backend. They can't change in a
> single commit (the iPad app is a separate repo, in Swift), so parity is enforced by the
> **rules in this doc + the [Definition of Done](./CROSS_SURFACE_DOD.md)**, not by hope.
> This file is the living map of *what each surface has* so drift is visible.
>
> Keep it current: any change that adds/removes a feature on any surface updates a row here.

Last full audit: **2026-06-30**.

---

## 0. What "the same thing" means

Parity is enforced at **four levels**, not at the pixel level:

1. **API contract** — every surface speaks the same endpoints (the OpenAPI spec).
2. **Data models** — the same shapes (`@nuru/shared` for TS; generated/mirrored for Swift).
3. **Business rules** — gating, scoring, money, validation live **server-side only**; clients display, never decide.
4. **Brand & terminology** — same design tokens, same words (Cell not Cohort, etc.).

**Layout is intentionally surface-specific.** An iPad landscape console, a phone portrait
app, and a web page *should* look different. We do **not** chase pixel parity — we chase
contract + behavior + brand parity.

### Design precedence — the iPad is the reference of record

When surfaces **diverge on UX, presentation, feature shape, or brand**, the **iPad app wins**
and the others conform to it. The iPad carries the latest, most considered design pass
(density, color system, premium tables, Finance/Events/Chat/Intelligence redesigns), so it is
the canonical design source. The web portal is brought up to match the iPad; brand decisions
made on the iPad flow **back into the token source** (`tokens.ts`) and outward to every surface.

**The one boundary:** precedence is about *design/UX/feature-shape*, **not** the contract.
Levels 1–3 of "the same thing" stay **backend-authoritative** — the API contract, data models,
and business rules (gating/scoring/money/validation) are owned by the backend + OpenAPI +
`@nuru/shared`; the iPad cannot override them (it's a client). Precedence governs *how things
look and behave on screen*, plus the brand palette.

**Parity target (decided 2026-06-30): bring BACKEND + WEB PORTAL up to iPad parity.** The iPad
is the reference; the web portal matches its design and features, and the backend provides
every capability the iPad surfaces (closing the "coming soon" gaps). **Mobile is touched ONLY
when (a) the database/contract changes, or (b) a new shared component genuinely needs to live
on the member app** — e.g. capturing device model / activity / location requires the mobile
client to *send* that data. Pure web-presentation and pure backend-aggregation work does **not**
touch mobile.

**Brand scope (decided 2026-06-30): ADMIN-ONLY for now.** The iPad's evolved palette (bright
LED-green, luminous accents, deeper sidebar) is applied to the **web portal** so the two admin
consoles match. The shared `tokens.ts` and the **member mobile app are left unchanged** — i.e.
the web's brand is updated in `admin-web` (its own CSS vars), not in `tokens.ts`. Revisit if we
later want one brand across all four surfaces.

---

## 1. Sources of truth (single, canonical)

| Concern | Source of truth | Path |
|---|---|---|
| Wire contract | **OpenAPI** | `packages/shared/src/openapi/openapi.yaml` (lint: `pnpm openapi:lint`; conformance test: `packages/backend/test/openapi-routes.test.ts`) |
| Types / enums / DTOs | **`@nuru/shared`** | `packages/shared/src/types/*` (enums, models, sync, api, dto) + `constants.ts` |
| Business rules | **`@nuru/backend`** | `packages/backend/src/modules/*` — server-authoritative |
| Design tokens | **mobile `tokens.ts`** | `packages/mobile/src/theme/tokens.ts` (mirrors the web CSS vars; the iPad `NuruTheme.swift` is a hand-port — see Drift D-07) |

**Rule:** changes start at the source of truth and flow outward. Web + mobile import
`@nuru/shared`; the iPad mirrors the OpenAPI spec (today by hand — codegen is the plan).

---

## 2. The two audiences

There are **two distinct products**, not three identical ones:

- **Admin consoles** — the **Web portal** (`packages/admin-web`) and the **iPad app**
  (`pathwayforipad`). Both consume the `/admin/*` surface. **These should be at parity with each other.**
- **Member app** — **Mobile** (`packages/mobile`). Consumes the member surface
  (`/me/*`, `/giving/*`, `/chat/*`, `/calendar`, `/growth/*`, `/levels`, `/modules`, …).
  A different feature set by design; it shares the backend, `@nuru/shared`, and tokens.

So most parity work is **Web ⟷ iPad**. Mobile is tracked separately (§4) and only shares the
foundations.

---

## 3. Admin parity matrix (Web ⟷ iPad)

Legend: ✅ present · ⚠️ present but drift · ❌ missing · N/A not applicable.

| Feature / page | Key `/admin` endpoints | Web | iPad | Status / drift |
|---|---|:--:|:--:|---|
| Dashboard | reports/overview·engagement·attendance·consents·levels, calendar, audit | ✅ | ✅ | Parity |
| Notifications | /admin/notifications (+:action) | ✅ | ✅ | Parity |
| Cell Engagement | reports/engagement, /admin/cells | ✅ | ✅ | Parity |
| Cell Detail | reports/engagement + members (filtered by cell_group_id) | ✅ | ✅ | ~~D-01~~ resolved — iPad now matches web's sourcing |
| Members | /admin/members (+id, results, enrollment, graduation) | ✅ | ✅ | Parity |
| Member Detail | /admin/members/{id} (+results, password-reset) | ✅ | ✅ | Parity — incl. **admin password reset** (`POST /admin/members/:id/password-reset`, rank-guarded) on both surfaces as of 2026-07-03 |
| Reflection Queue | /admin/reflections (+decision, history) | ✅ | ✅ | Parity |
| Chat (oversight) | /chat/* + moderation + /assistant/chat | ✅ | ✅ | Parity (iPad mute/archive local-only) |
| Events | calendar, /admin/events/*, announcements, moments | ✅ | ✅ | Parity (iPad adds client-rendered QR) |
| Finance (read-only) | /admin/finance/* | ✅ | ✅ | Parity (presentation reimagined on iPad) |
| Certificates | /admin/certificates, /verify/{code} | ✅ | ✅ | Parity |
| Badges | /admin/badges | ✅ | ✅ | Parity |
| Curriculum Levels | reports/levels | ✅ | ✅ | Parity |
| CMS — Curriculum | /admin/levels·modules·questions | ✅ | ✅ | Parity |
| Level Detail | Web: dedicated `/cms/level/:id` editor · iPad: same view as CMS | ✅ | ⚠️ | **D-02** iPad "Level Detail" == CMS view (title only) |
| Quiz Builder | /admin/…/exam, questions | ✅ | ✅ | Parity |
| Video Library | /admin/media (+external) | ✅ | ⚠️ | **D-03** iPad lacks the chunked video-upload pipeline (`/admin/media/videos/chunk·finalize`); external/URL only |
| Content Studio | /admin/growth/* + /admin/levels/:n/encouragements | ✅ | ✅ | ~~D-04~~ resolved — iPad Content Studio now has the Encouragements section |
| **Intelligence** | Both: **`/admin/analytics/intelligence`** | ✅ | ✅ | ~~D-05~~ **RESOLVED** 2026-06-30 — iPad rebuilt on the canonical endpoint; devices/app-area/activity/location now real |
| Users | /admin/users | ✅ | ✅ | Parity |
| Roles & Permissions | /admin/roles (+permissions) | ✅ | ✅ | Parity |
| Congregations | /admin/congregations | ✅ | ✅ | Parity |
| Countries | /admin/countries | ✅ | ✅ | Parity (no delete either side) |
| Languages | /admin/languages | ✅ | ✅ | Parity |
| My Profile | /me (+password, activity) | ✅ | ✅ | Parity |
| **Radio Studio** | `/admin/radio/programs` (+go-live/end/rotate-key/health/comments/tracks/audio-upload) | ✅ | ✅ | **LIVE 2026-07-03** — real broadcast on self-hosted **Icecast** (`RADIO_STREAM_PROVIDER=icecast`) + **liquidsoap** playout engine (playlist bed + jingle queue + live-mic harbor). iPad broadcasts a connected USB mic natively (AVAudioEngine→AAC→Icecast SOURCE) with boost + **On-air/Cue in-ear monitor**. Session audio upload (≤110 MB, MP3/WAV/AAC/ALAC), playlists, loop modes, now-playing. Member app plays the live stream with auto-reconnect + adaptive buffer. See [[radio-live-icecast]] |
| **Audio Mixer** | `/admin/radio/mixer/{scenes,jingles}` + `/mixer/live/{levels,eq,jingle,status}` | ✅ | ✅ | **LIVE 2026-07-03** — drives the liquidsoap mix over telnet: mic/bed/jingle/master faders (gliding), per-bus 3-band EQ + compressor, jingle fire, and sound presets (Talk Show / Podcast / Voice Over Music / Warm Music / Bright). Consoles hydrate from the engine's real state so settings survive navigation. Admin-only (not a member surface) |
| Module Preview (learner) | /admin/modules/:id (+questions) | ✅ | ❌ | **D-06** iPad has no standalone learner-preview |
| Reset Password page | /auth/password/reset | ✅ | ❌ | Minor — iPad login only |

**Bottom line:** ~22 of 24 admin pages are at parity. Concrete drift is D-01…D-06.

---

## 4. Member surface (Mobile) — inventory

Tracked for completeness; not expected to match the admin consoles. Mobile = 7 tabs +
pushed flows, all on member endpoints, offline-first via `/sync/{pull,push}`.

| Area | Screens | Member endpoints |
|---|---|---|
| Home | HomeDashboard | /me/home/*, /me/rhythm/*, /me/scores, /me/pathway, /home/featured-*, /me/announcements |
| Pathway | Levels, Level, Module, Quiz, Reflection, LevelComplete | /me/pathway, /levels/:n/modules, /modules/:id (+complete, quiz, reflection) |
| Plans / Growth | ReadingPlans, PlanDetail, PlanDay, Watch, Devotional, MemoryVerse, Resources, Mentor | /growth/* , /me/scores/word |
| Events | Events, Calendar, EventDetail, AnnouncementDetail | /calendar, /events/:id (+rsvp, posts), /me/rsvps, /announcements/:id |
| Chat | Chat, ChatThread, NewMessage, SpacePreview, NuruAssistant, CohortDiscussions, Thread | /chat/*, /assistant/*, /community/threads* |
| Give | Giving, GivingStatement, GivingReceipt | /giving/* |
| Prayer / Verses | PrayerJournal, PrayerWall(+Detail), VerseLibrary | /me/prayers, /prayer-wall/*, /me/verses |
| Gifts / Profile / Notifs | Gifts, Profile, Notifications | /gifts/*, /me, /me/notifications |

Shares with admin surfaces: the backend, `@nuru/shared`, and `tokens.ts`.

---

## 5. Drift register & backfill punch-list

| ID | Drift | Surfaces | Severity | Action |
|---|---|---|---|---|
| ~~D-01~~ | ~~Cell Detail uses legacy `/cohorts/{id}/members`~~ | iPad | ~~Med~~ | **DONE 2026-06-30** — iPad Cell Detail repointed to `/admin/reports/engagement` + `/admin/members` (filtered by `cell_group_id`), mirroring web; legacy `/cohorts` call removed. (Backend `/cohorts/:cell_id/members` + `/cells/:id/milestones` terminology cleanup still open — see D-09.) |
| D-02 | "Level Detail" duplicates the CMS view | iPad | Low | Either make it a distinct per-level editor (match web) or drop the sidebar entry |
| D-03 | No chunked video upload | iPad | Med | Port `/admin/media/videos/chunk·finalize` flow, or accept external-only (decide) |
| ~~D-04~~ | ~~No Encouragements authoring~~ | iPad | ~~Med~~ | **DONE 2026-06-30** — per-level Encouragements section added to Content Studio (level picker + CRUD on `/admin/levels/:n/encouragements` + `/admin/encouragements/:id`) |
| ~~D-05~~ | ~~Intelligence not on the canonical endpoint~~ | iPad | ~~High~~ | **DONE 2026-06-30** — iPad People Intelligence rebuilt on `/admin/analytics/intelligence`; devices/app-area/activity-by-hour/giving-frequency/location now render real data. Only the backend's own not-captured flags remain labeled: device model, screen dwell, login timestamp, geo lat/lng |
| D-06 | No learner Module Preview | iPad | Low | Add, or mark N/A for iPad |
| D-07 | Tokens hand-ported to Swift | iPad | Med | Generate `NuruTheme.swift` from `tokens.ts`/a `tokens.json` so brand can't fork |
| D-08 | iPad presentation pass not on web | Web | **DONE 2026-06-30** | iPad has precedence (§0). Web palette added to `admin-web` CSS (admin-only; mobile untouched). **All 24 admin pages ported** to the iPad design (typecheck 0, Vite build green). Two small follow-ups: (a) **Quiz Builder** — the exam-settings/field/colour asks live in the shared `components/curriculum/ModuleQuizBuilder.tsx` (out of the page-file scope); (b) **Roles** — web has no role-EDIT modal (a feature gap, not a port). |
| ~~D-10~~ | ~~admin-web `tsc` typecheck broken (851 errors)~~ | Web | ~~tooling~~ | **DONE 2026-06-30** — web-only react-redux/@reduxjs-toolkit resolved React/@types/react peers to the React 19 store copy, poisoning JSX types. Pinned their peers to React 18 via scoped `pnpm.overrides`. admin-web 851→0; mobile still 0; root `pnpm typecheck` green. |
| D-09 | Terminology mix (Cohort vs Cell) at the wire | Backend | Med | Plan an additive rename; keep old paths until clients migrate |

---

## 6. The rules (governance)

1. **Contract-first.** No client feature until the backend endpoint + OpenAPI are updated; `pnpm openapi:lint` and the route-conformance test must pass.
2. **Types from one place.** Web/mobile import `@nuru/shared`; iPad models track the OpenAPI (codegen — see D-07-style automation).
3. **Server-authoritative logic.** Gating/scoring/money/validation never reimplemented client-side.
4. **One token source.** Brand/spacing/type change in `tokens.ts`; web + iPad derive from it.
5. **Shared terminology.** Renames land on every surface in the same change-set; update the glossary.
6. **Additive, backward-compatible API.** Never remove/rename a field a deployed client reads — add → migrate → retire (mobile is offline-first).
7. **Every change carries a [Definition of Done](./CROSS_SURFACE_DOD.md)** across surfaces; "N/A" is a *decision* with a reason, recorded in §3/§5.
8. **Two-repo coordination.** One ticket ID; linked PRs in `pathway` and `pathwayforipad`; merged together; both PR descriptions carry the DoD checklist.
9. **This matrix is updated in the same PR** that changes any surface's feature set.
