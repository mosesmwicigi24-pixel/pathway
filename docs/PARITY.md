# Cross-Surface Parity Matrix

> **Purpose.** Nuru Pathway ships on four surfaces over one backend. They can't change in a
> single commit (the iPad app is a separate repo, in Swift), so parity is enforced by the
> **rules in this doc + the [Definition of Done](./CROSS_SURFACE_DOD.md)**, not by hope.
> This file is the living map of *what each surface has* so drift is visible.
>
> Keep it current: any change that adds/removes a feature on any surface updates a row here.

Last full audit: **2026-07-12** (two-direction agent sweep; see §Standardization below).

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
| **Discipleship Hub** | `/disciples` (+`:id`) — reuses `/chat/dms`·`/reviews/levels/:id/usher`·`/admin/reflections/:id/decision` | ✅ | ✅ | ~~D-11~~ **RESOLVED 2026-07-04** — iPad console ported section-for-section (triaged roster, dossier, inline message/usher/reflection actions). The port surfaced a web bug: UsherCard passed user_id where the route keys on the ADVANCEMENT id (every web usher 404'd) — fixed on web same day. Known asymmetry: dossier access allows relationship_tree edges OR leader_assignments, but usher scope checks leader_assignments only (edge-only disciplers see 'ready' but can't usher — backend decision pending) |
| Chat (oversight) | /chat/* + moderation + /assistant/chat | ✅ | ✅ | Parity (iPad mute/archive local-only) |
| **Events Operations Center** | `/admin/events/series` (+detail/timeline/split/search/insights/qr/attendance.csv), windowed `/calendar`, announcements lifecycle | ✅ | ✅ | **RE-ARCHITECTED 2026-07-19** (docs/EVENTS_ARCHITECTURE.md) — future-events bug root-caused (5 stacked horizons) and killed: windowed month-paged calendars on BOTH consoles, real server-issued QR (the old client-faked QR is gone), real insights (hard-coded tiles deleted), Event Command Center with timeline + CSV export, Google-style edit scopes (exception / split / series), Announcements Studio (3 attachment modes, wired targeting + scheduling, duplicate/archive/restore, honest channels — SMS/WhatsApp greyed until a provider exists). Native closed its reschedule-occurrence + announcement-edit gaps. |
| Finance (read-only) | /admin/finance/* | ✅ | ✅ | Parity (presentation reimagined on iPad) |
| **Website (nuruplace.org)** | `/webhooks/website-contact` (S2S), `/admin/enquiries` (+`/{id}/ack`) | ✅ | ☐ | **NEW 2026-08-20** — the portal is the administration point for the public website. New `Website` sidebar group, new `website` RBAC module and a built-in `website` staff role (seeds/08_rbac.sql, beside the other built-ins — a migration-seeded role is truncated away by resetDb) so a communications volunteer gets the site WITHOUT members, finance or curriculum. First screen: Enquiries — the connection card / contact form / prayer requests from nuruplace.org (migration 201), defaulting to the unanswered queue with tel: and mailto: on every row, because the reply happens off-platform. iPad: ☐ needs a sibling PR in `pathwayforipad`. Mobile: N/A — admin-only. |
| Certificates | /admin/certificates, /verify/{code} | ✅ | ✅ | Parity |
| Badges | /admin/badges | ✅ | ✅ | Parity |
| **Curriculum Dashboard** | `/admin/curriculum/{summary,validate,activity}` (one stats source) | ✅ | ✅ | **RE-ARCHITECTED 2026-07-18** (docs/CURRICULUM_ARCHITECTURE.md) — replaces Curriculum Levels + CMS Curriculum on BOTH consoles: health grid, clickable pipeline, ranked needs-attention (server validation), classified activity, grouped quick actions, collapsed analytics, one-Open level cards |
| **Levels & Modules Workspace** | /admin/levels·modules·questions + `/admin/modules/{id}/media` | ✅ | ✅ | **RE-ARCHITECTED 2026-07-18** — replaces Level Detail: tree + sectioned module editor (Overview/Content/Media placements/Quiz/Publishing). Native gained EDITABLE module question banks (was read-only); exam settings + exam_status gate surfaced at the level node. Old routes redirect; native's duplicate `.levelDetail` entry deleted |
| Quiz Builder (context-aware) | /admin/…/exam, questions | ✅ | ✅ | Specialized exam editor launched WITH context (web `?level=N`, native router preselect) — never re-selects; sidebar entries removed both consoles |
| Video Library | /admin/media (+external, chunk·finalize, thumbnail, **placements**) | ✅ | ✅ | **PLACEMENT-AWARE 2026-07-18** — one asset, many module placements (level inferred, per-placement remove, 409 duplicate guard); the level-tag "attachment" and media→module title reverse-write are gone. (~~D-03~~ history: refuted stale 2026-07-12) |
| Content Studio | /admin/growth/* + /admin/levels/:n/encouragements | ✅ | ✅ | ~~D-04~~ resolved — iPad Content Studio now has the Encouragements section |
| **Intelligence** | Both: **`/admin/analytics/intelligence`** | ✅ | ✅ | ~~D-05~~ **RESOLVED** 2026-06-30 — iPad rebuilt on the canonical endpoint; devices/app-area/activity/location now real |
| Users | /admin/users | ✅ | ✅ | Parity |
| Roles & Permissions | /admin/roles (+permissions) | ✅ | ✅ | Parity |
| Congregations | /admin/congregations | ✅ | ✅ | Parity |
| Countries | /admin/countries | ✅ | ✅ | Parity (no delete either side) |
| Languages | /admin/languages | ✅ | ✅ | Parity |
| My Profile | /me (+password, activity) | ✅ | ✅ | Parity |
| **Biometric sign-in** | `/auth/webauthn/*` (passkeys) · native LocalAuthentication | ✅ | ✅ | **LIVE 2026-07-18** — deliberate platform expression, same outcome (no password retyping): web registers **passkeys** (WebAuthn, Touch ID/Face ID/Windows Hello; Login button + Profile Passkeys tab + enrollment nudge; staff-scope gate + audit identical to password login, UV=required bypasses TOTP) · iPad/Mac use **Face ID/Touch ID** (LAContext) as an opt-in lock gate + login fast path over the persisted session — native passkeys impossible on the free Apple team (no associated-domains). Passwords are never stored on any surface. |
| **Radio Studio** | `/admin/radio/programs` (+go-live/end/rotate-key/health/comments/tracks/audio-upload/schedule-conflicts/mic-bridge) | ✅ | ✅ | **LIVE 2026-07-03** — real broadcast on self-hosted **Icecast** (`RADIO_STREAM_PROVIDER=icecast`) + **liquidsoap** playout engine (playlist bed + jingle queue + live-mic harbor). iPad broadcasts a connected USB mic natively (AVAudioEngine→AAC→Icecast SOURCE) with boost + **On-air/Cue in-ear monitor**. Session audio upload (≤110 MB, MP3/WAV/AAC/ALAC), playlists, loop modes, now-playing. Member app plays the live stream with auto-reconnect + adaptive buffer. See [[radio-live-icecast]]. **2026-07-05**: single-live rule + overlap warnings + auto-air deferral on both consoles; WEB now broadcasts a mic too (device picker w/ hot-plug, real meters/boost, MediaRecorder → WS mic-bridge) and has Listen (Broadcast/Monitor/Cue) with a feedback guard — web/iPad mic parity reached, different transports (WS bridge vs native TCP). |
| **Audio Mixer** | `/admin/radio/mixer/{scenes,jingles}` + `/mixer/live/{levels,eq,jingle,status}` | ✅ | ✅ | **LIVE 2026-07-03** — drives the liquidsoap mix over telnet: mic/bed/jingle/master faders (gliding), per-bus 3-band EQ + compressor, jingle fire, and sound presets (Talk Show / Podcast / Voice Over Music / Warm Music / Bright). Consoles hydrate from the engine's real state so settings survive navigation. Admin-only (not a member surface) |
| Module Preview (learner) | /admin/modules/:id (+questions) | ✅ | ✅ | ~~D-06~~ **RESOLVED 2026-07-12** — native Learner Preview sheet off the module editor; renders the CURRENT unsaved draft (ahead of web's saved-only) |
| Reset Password page | /auth/password/reset | ✅ | ❌ | Minor — iPad login only |

**Bottom line (2026-07-12):** ZERO open capability gaps between web, iPad and Mac. Every page and every in-page capability is at parity or deliberately platform-expressed (§Standardization).

### Standardization sweep — 2026-07-12 (two agent audits, both directions, then 5 build crews)
**Web → native (closed):** Flock Brief / Shepherd's Pulse (whole page — had never been in this ledger), Level Reviews usher-triage queue, learner Module Preview (D-06), markdown toolbar + Write/Preview (D-02), video thumbnail upload, chat oversight extras (edit / restore / hard delete / attachment send), forgot-password link.
**Native → web (closed):** multi-file upload queue with per-file progress + retry, bulk select + bulk add/delete, drag-to-reorder playlists, session deep link (?open=), zero-signal silence watchdog, device connect/disconnect toasts + label-based mic brand registry, Roles EDIT modal (and the backend PUT silently dropping role_type — fixed, tested).
**Deliberate platform expressions (NOT gaps — do not chase):** USB mic brand sensing depth (native reads OS device metadata; browsers only see labels post-permission — label fuzzy-match is the web ceiling) · native session View modals + capped previews vs web inline scroll lists (both functionally complete) · admin password-reset placement (web: members list · native: member detail — same capability) · mic transport (native raw TCP SOURCE vs web WebSocket bridge — same behavior) · Mac-only window/idiom features.

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
| **Community** (was Chat) | iOS `CommunityView` / Android `CommunitySegment` — two doors: **Talk** = Chat, ChatThread, NewMessage, SpacePreview, NuruAssistant; **Pray** = PrayerRoom (embedded). CohortDiscussions, Thread stay reachable from Home | /chat/*, /assistant/*, /community/threads*, /me/prayers, /prayer-wall/* — **Phase 3 steps 1–2 (2026-09-03):** the You-tab segment is *labelled* Community but its enum case / route string stay `chat` on both apps so every deep link (`"chat"` → `openYou(.chat)`; Android `composable("chat")`, `shortcuts.xml`, `routeFor`) resolves unchanged. Restructuring only. Steps 3–4 (Discussions under Community; "Together" cell feed) not started. |
| Give | Giving, GivingStatement, GivingReceipt, **Partners** (iOS `PartnersView` / Android `PartnersScreen`), **PartnerInviteSheet** (both, hosted on Home) | /giving/* — **Partners phase 1 (2026-09-02):** `GET /giving/partnership` derives standing from `giving_schedules` (never stored twice); `kept` counts collected cycles only; `since_you_began` is church-wide, never attributed. **Phase 2 (2026-09-03):** `campaigns` + `partner_invite_log` (migration 212); `GET /giving/invitation` decides *whether* to ask (all restraint rules server-side, 24 tests); `/giving/invitation/{id}/shown|outcome`; admin `/admin/campaigns*` (draft-until-live, `reach`). Tiers from `tiers.ts` off one costing (KSh 20,000/disciple/level), rounded DOWN. Both clients render only what the server returns. |
| Prayer / Verses | PrayerJournal, PrayerWall(+Detail), VerseLibrary | /me/prayers, /prayer-wall/*, /me/verses |
| Gifts / Profile / Notifs | Gifts, Profile, Notifications | /gifts/*, /me, /me/notifications |
| Discipleship | DiscipleshipHub (student view) | /me/discipleship (+ /chat/dms for messaging discipler) |
| Your Cell | CellInfo (iOS `CellInfoView`, Android `CellInfoScreen`) | /me/cell-summary — since cell-truth (2026-08-24) the SINGLE payload for the screen: own-cell descriptive fields, series-derived `meets` + exceptions-aware `next`, roster faces, cell `turnout`, leader-only `leader_view`. `/home/featured-cell` is Home-only again (its use on the cell screen showed OTHER cells' details; Android's `FeaturedCellEnv` decode bug fixed in the same change-set). Upstream truth is authored on portal Cell Detail ("Shepherding": leader picker → `leader_assignments` sync; weekly-rhythm editor → real cell `event_series`). |

Shares with admin surfaces: the backend, `@nuru/shared`, and `tokens.ts`.

---

## 5. Drift register & backfill punch-list

| ID | Drift | Surfaces | Severity | Action |
|---|---|---|---|---|
| ~~D-01~~ | ~~Cell Detail uses legacy `/cohorts/{id}/members`~~ | iPad | ~~Med~~ | **DONE 2026-06-30** — iPad Cell Detail repointed to `/admin/reports/engagement` + `/admin/members` (filtered by `cell_group_id`), mirroring web; legacy `/cohorts` call removed. (Backend `/cohorts/:cell_id/members` + `/cells/:id/milestones` terminology cleanup still open — see D-09.) |
| ~~D-02~~ | ~~Level Detail duplicates CMS~~ | iPad | ~~Low~~ | **DONE 2026-07-12** — markdown toolbar + Write/Preview toggle added (the real substance); dedicated-route difference accepted as layout |
| ~~D-03~~ | ~~No chunked video upload~~ | iPad | ~~Med~~ | **STALE 2026-07-12** — audit found the full ChunkUploader already shipped; ledger was wrong. Thumbnail upload/clear added for full parity |
| ~~D-04~~ | ~~No Encouragements authoring~~ | iPad | ~~Med~~ | **DONE 2026-06-30** — per-level Encouragements section added to Content Studio (level picker + CRUD on `/admin/levels/:n/encouragements` + `/admin/encouragements/:id`) |
| ~~D-05~~ | ~~Intelligence not on the canonical endpoint~~ | iPad | ~~High~~ | **DONE 2026-06-30** — iPad People Intelligence rebuilt on `/admin/analytics/intelligence`; devices/app-area/activity-by-hour/giving-frequency/location now render real data. Only the backend's own not-captured flags remain labeled: device model, screen dwell, login timestamp, geo lat/lng |
| ~~D-06~~ | ~~No learner Module Preview~~ | iPad | ~~Low~~ | **DONE 2026-07-12** — Learner Preview sheet (previews unsaved drafts) |
| D-07 | Tokens hand-ported to Swift | iPad | Med | Generate `NuruTheme.swift` from `tokens.ts`/a `tokens.json` so brand can't fork |
| D-08 | iPad presentation pass not on web | Web | **DONE 2026-06-30** | iPad has precedence (§0). Web palette added to `admin-web` CSS (admin-only; mobile untouched). **All 24 admin pages ported** to the iPad design (typecheck 0, Vite build green). Two small follow-ups: (a) **Quiz Builder** — the exam-settings/field/colour asks live in the shared `components/curriculum/ModuleQuizBuilder.tsx` (out of the page-file scope); (b) ~~Roles — web has no role-EDIT modal~~ **DONE 2026-07-12** (dual-mode RoleModal + backend role_type persist fix). |
| ~~D-10~~ | ~~admin-web `tsc` typecheck broken (851 errors)~~ | Web | ~~tooling~~ | **DONE 2026-06-30** — web-only react-redux/@reduxjs-toolkit resolved React/@types/react peers to the React 19 store copy, poisoning JSX types. Pinned their peers to React 18 via scoped `pnpm.overrides`. admin-web 851→0; mobile still 0; root `pnpm typecheck` green. |
| D-09 | Terminology mix (Cohort vs Cell) at the wire | Backend | Med | Plan an additive rename; keep old paths until clients migrate |
| D-12 | Android has a dead `CommunityHubScreen` at `composable("community")` — no inbound caller (shortcuts land on `prayer-room?tab=corporate`; `routeFor` never returns it; the MainShell comments list it as a *caller* of `chat`/`give`, not a target). iOS has no equivalent. Found while auditing Phase 3. | Android | Low | Remove in its own PR after Phase 3 lands — not in the restructuring PR, which must stay revertible in one commit. Verify nothing external (FCM payload, App Link) names `community` first. |
| ~~D-11~~ | ~~Discipleship Hub not on iPad~~ | iPad | ~~Med~~ | **DONE 2026-07-04** — DisciplesView.swift (roster + dossier + actions) under Operations. Bonus: found + fixed the web usher advancement-id 404. Open follow-up: usher scope ignores relationship_tree edges (backend) |

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
