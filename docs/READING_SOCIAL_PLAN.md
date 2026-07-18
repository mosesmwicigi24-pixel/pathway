# Reading, Social & Polish Epic — Engineering Plan (Phase R0)

Written against the canonical owner brief at `docs/READING_SOCIAL_REDESIGN.md`
(2026-07-19). This document is the R0 deliverable: gap analysis, data-model
sketch, migration strategy, API surface, invite deep-link architecture, phase
breakdown, and open questions. **No feature code, no client changes, nothing
deployed.** Modeled on `docs/CHAT_REDESIGN_PLAN.md` (the C0 deliverable for
the chat epic that shipped C1–C4 in migrations 161–173) — same shape, same
standard of evidence: every claim below is grounded in a file:line citation
gathered by reading the actual code, not inferred from the spec's wording.

The R1 tables this plan specifies are in
`packages/backend/migrations/1758000000174_shared-plan-groups.sql` and
`...175_shared-plan-invites.sql` — written and proven against the full
backend suite (embedded Postgres applies every migration on every test run),
but not applied to any running (staging/prod) database. This mirrors exactly
how the chat epic's C0 shipped C1's schema ahead of C2's behavior.

## 0. Scope of this document vs. the owner brief's 9 sections

The owner brief bundles nine concerns under one epic. Sections 1–2 (chat
reliability, chat nav labels) belong to the **chat** epic, already built
through C4 (migrations 161–173) — out of scope here, mentioned only where a
reading-social decision reuses something chat shipped. This document covers
sections **3–9**: Read with a Friend, Shared notes, Highlighting,
Invitations, Typography, Card design, and the Design-system audit.

---

## 1. Gap analysis — all 9 spec sections, current state vs. spec

| Spec area | Current state | Verdict |
|---|---|---|
| **§1 Chat reliability audit** | Owned by the chat epic (already shipped, C4). | **N/A — different epic.** Flagged in case a future reading-social phase re-touches chat notification wiring (§3 progress notifications do); if so, re-verify per the chat epic's standing rule. |
| **§2 Chat nav labels** | Owned by the chat epic. | **N/A — different epic.** |
| **§3 Read with a Friend — search friends** | `GET /chat/people?q=` (`chat/index.ts:114-119`, `ChatService.listPeople`) already searches same-congregation members, minor-safe. `GET /chat/connections` (`chat/index.ts:162-164`) already lists accepted friend connections. | **Already satisfies — reuse, don't rebuild.** The friend graph (`user_connections`/`connection_requests`, migration 162) shipped with the chat epic is exactly "search friends"; a reading-social invite only needs to consume it, not re-implement search or a second consent model. |
| **§3 invite to a plan, accept/decline** | No concept exists. Grepped `plan_group\|shared_plan\|plan_participant\|plan_invite\|plan_buddy` across `src/`, `migrations/`, `packages/shared/src` — zero hits. | **Gap**, closed by this phase's schema (`shared_plan_groups`, `shared_plan_group_members`, `shared_plan_invites` — §2 below). |
| **§3 active shared plans, who joined** | `reading_plan_progress` (migration 029) is strictly per-user; nothing links two members' enrollments in the same plan. The only cross-member surface on a plan is `plan_day_talk_posts` (migration 121) — a flat thread **public to every member enrolled in the plan**, not scoped to a friend pair or invite. | **Gap.** "Read with a Friend" needs a bounded group (2–N named members), not a global thread. Closed by `shared_plan_groups` + `shared_plan_group_members`. |
| **§3 per-participant progress (days/chapters done)** | `reading_plan_progress.current_day`/`completed_days` exists per-user but is documented **private to the member** (`growth-content/service.ts:1-6`, "progress is private to the member (§5.4)"). No query exposes one member's progress to another. | **Gap, and a genuine privacy-model exception.** Exposing progress to co-members of a shared group is spec-mandated (§3) but must be scoped tightly — see §2.1 design note and the API guard in §4. |
| **§3 progress notifications** | `NotificationService.schedule()` (`notifications/service.ts:79-126`) is generic (template + JSONB payload); nothing in `growth`/`growth-content` calls it today — plan completion emits zero notifications. | **Gap, cheap to close** — new template strings through the existing pipeline, no schema change (same pattern the chat epic used for `connection_request_received` etc.). Behavior wiring is R1 (next phase), not this one. |
| **§4 Shared notes — personal notes** | `reading_plan_day_reflections` (migration 089) is the closest thing: one journal entry per `(user, plan, day)`, private, `client_mutation_id`-idempotent. It is **not** a note-taking system — one entry per day, no anchor to a passage, no sharing, no threading. | **Partial.** Reflections stay as-is (a different, private-journaling feature); `plan_notes` (R2, design-only this phase) is a new, richer, shareable primitive, not a replacement. |
| **§4 share with friends, comments, replies, likes, @mentions, questions** | `plan_day_talk_posts`/`plan_day_talk_likes` (migration 121, "Talk it Over") is the only precedent: flat post + heart-like, **global to every plan enrollee**, no threaded replies, no @mentions, no question flag, no scoping to a friend group. | **Gap**, closed in design (not migrated) by `plan_notes` + `note_comments` + `note_reactions` + `note_mentions` — see §2.2. Sized for R2. |
| **§5 Highlighting — colors, edit/remove, filter, share, notes attached** | Zero highlighting code anywhere in `packages/backend` (grepped `highlight` across `src/` and `migrations/` — no hits). | **Gap, fully greenfield.** Sketched in §2.3 (`plan_highlights`), sized for R2. |
| **§6 Invitations — deep link, rich preview, QR, WhatsApp/social share, copy link** | See the cross-repo invite audit below (§3). Today's invite on iOS is a **plain-text `ShareLink`** string with no URL at all (`nuru-member-ios/Features/Grow/ReadingPlansView.swift:855,461`). Android's plan "Invite" button is a **literal no-op** (`nuru-android/.../PlanDetailScreen.kt:462-475`, `.clickable { }`). Neither app has universal-link/App-Link infra; the backend/portal serve no public HTML and no OG tags anywhere. | **Gap — the deepest one in this epic.** Nothing to build on; §5 below is a from-scratch architecture. |
| **§7 Typography — one global system** | Not audited in this phase (client-code audit, no backend signal to gather); flagged for R5. | **Not evaluated** — explicitly deferred, not silently skipped (same posture the chat epic's C0 took on its own deferred security pass). |
| **§8 Card design audit** | Same — client-side, R5. | **Not evaluated.** |
| **§9 Design-system audit (tokens, components)** | Same — client-side, R5; the mobile RN app's `tokens.ts` is the nominal source of truth per `docs/PARITY.md`, but see §6 below for why R3–R5's real client targets are `nuru-member-ios`/`nuru-android`, not `packages/mobile`. | **Not evaluated.** |

---

## 2. Data-model design

### 2.1 `shared_plan_groups` + `shared_plan_group_members` (R1 — migration 174)

```sql
CREATE TABLE shared_plan_groups (
  group_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     UUID NOT NULL REFERENCES reading_plans(plan_id) ON DELETE CASCADE,
  created_by  UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  name        VARCHAR(120),                 -- optional custom label; NULL = client derives one from members
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ                    -- soft "ended" state; NULL = active ("active shared plans")
);

CREATE TABLE shared_plan_group_members (
  group_id  UUID NOT NULL REFERENCES shared_plan_groups(group_id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  status    VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','left','removed')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at   TIMESTAMPTZ,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX idx_spg_members_user ON shared_plan_group_members (user_id) WHERE status = 'active';
CREATE INDEX idx_spg_plan ON shared_plan_groups (plan_id);
```

**Deliberately no separate progress table.** "Per-participant progress" is
answered by joining `shared_plan_group_members` (who's in the group) to the
**existing** `reading_plan_progress` (migration 029) on `(user_id, plan_id =
group.plan_id)` — joining a group auto-enrolls the member in the underlying
plan via the existing, unmodified `GrowthContentService.startPlan()`
(`growth-content/service.ts:246-256`). This is the same reuse posture the
chat epic took with `chat_members` instead of a second membership table
(`docs/CHAT_REDESIGN_PLAN.md` §2.3): one source of truth for "how far has
this person gotten," never duplicated into the social layer.

**Deliberately no `space_roles`-style delegation.** A shared reading group is
a 2–8 person friend circle, not a public space with strangers to moderate —
`created_by` is the sole owner; there is no moderator/co-leader tier in R1.
See Open Question 4.

**Progress-visibility scope, stated precisely** (this is a real exception to
an existing invariant, not a new default): `reading_plan_progress` is
documented private to the member. Exposing `current_day`/`completed_days` to
another user is permitted **only** when both users are `status='active'`
members of the same `shared_plan_group`, and **only** for that group's
`plan_id` — never a member's progress on a *different* plan, never to a
non-member. This is enforced in the service layer's group-detail query (a
`WHERE` scoped to the caller's own active group memberships), the same
query-layer discipline RBAC scoping already uses elsewhere (§5.4).

### 2.2 `shared_plan_invites` (R1 — migration 175)

```sql
CREATE TABLE shared_plan_invites (
  invite_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id           UUID NOT NULL REFERENCES shared_plan_groups(group_id) ON DELETE CASCADE,
  inviter_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  invitee_user_id    UUID REFERENCES users(user_id) ON DELETE CASCADE,   -- set: targeted in-app invite; NULL: open share-link
  token               VARCHAR(43) NOT NULL,   -- URL-safe opaque id, the /join/{token} path segment
  status              VARCHAR(10) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','accepted','declined','revoked','expired')),
  message             VARCHAR(500),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ,             -- NULL = no expiry (open share links); service defaults targeted invites to +14d
  decided_at          TIMESTAMPTZ,
  accepted_by         UUID REFERENCES users(user_id) ON DELETE SET NULL,  -- who actually redeemed it (may differ from invitee_user_id on an open link)
  client_mutation_id  UUID UNIQUE
);
CREATE UNIQUE INDEX uq_shared_plan_invites_token ON shared_plan_invites (token);
CREATE UNIQUE INDEX uq_shared_plan_invites_pending_target
  ON shared_plan_invites (group_id, invitee_user_id) WHERE status = 'pending' AND invitee_user_id IS NOT NULL;
CREATE INDEX idx_shared_plan_invites_group ON shared_plan_invites (group_id);
```

Every invite carries a `token` — targeted invites get one too (not just open
links), so a single "Join {name}'s plan" push notification and a shareable
WhatsApp link can both resolve through the exact same `/join/{token}`
surface and the exact same accept endpoint; the client never needs two code
paths for "invited a friend" vs. "shared a link." `invitee_user_id` is the
only thing that distinguishes them, and it's optional.

**Token storage: plaintext, not hashed** — a deliberate departure from
`password_resets.token_hash` (migration 159). Rationale: a password-reset
token *is* a credential (possession = full account takeover), so it's hashed
per §5.5's spirit. An invite token identifies "which plan invite," nothing
more — the worst-case leak is a stranger joining a friend's reading-plan
group, which is join-request-shaped, not account-takeover-shaped, and the
`/join/{token}` public OG page (§4) needs a fast, hash-free lookup to render
a preview to unauthenticated crawlers (WhatsApp/iMessage link-preview bots)
without spending a bcrypt/argon2 compare on every fetch. Flagged explicitly
as a security-posture judgment call, not an oversight — see Open Question 1.

### 2.3 R2 sketch (design only, no migration this phase)

**`plan_notes` / `note_comments` / `note_reactions` / `note_mentions`:**

```sql
CREATE TABLE plan_notes (
  note_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  plan_id            UUID NOT NULL REFERENCES reading_plans(plan_id) ON DELETE CASCADE,
  day_number         INT NOT NULL CHECK (day_number > 0),
  segment_id         UUID REFERENCES reading_plan_day_segments(segment_id) ON DELETE SET NULL, -- optional anchor
  body               TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  is_question        BOOLEAN NOT NULL DEFAULT FALSE,        -- the "question" flag (spec §4)
  shared_group_id    UUID REFERENCES shared_plan_groups(group_id) ON DELETE SET NULL, -- NULL = private; set = visible to that group
  client_mutation_id UUID UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE note_comments (
  comment_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id            UUID NOT NULL REFERENCES plan_notes(note_id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  body               TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  client_mutation_id UUID UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
  -- flat (one level), same shape as plan_day_talk_posts — no reply_to_id;
  -- "replies" in the spec is read as "comments on a note," not nested threads.
);

CREATE TABLE note_reactions (
  note_id    UUID NOT NULL REFERENCES plan_notes(note_id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  reaction   VARCHAR(16) NOT NULL DEFAULT 'like',   -- room for more than plan_day_talk_likes' single heart
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, user_id, reaction)
);

CREATE TABLE note_mentions (
  target_type       VARCHAR(7) NOT NULL CHECK (target_type IN ('note','comment')),
  target_id         UUID NOT NULL,   -- note_id or comment_id, depending on target_type
  mentioned_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (target_type, target_id, mentioned_user_id)
);
```

`note_mentions.target_id` is deliberately **not** a foreign key — it points
into one of two different tables depending on `target_type`, which Postgres
can't express as a single FK without a third join table. This is a real
trade-off (documented rather than hidden): the alternative was two nullable
FK columns (`note_id`/`comment_id`, exactly one set), which is what
`note_reactions` on Talk-it-Over-style tables elsewhere in this codebase
would suggest, but doubles the column count for every mention row to buy
referential integrity on a purely additive, denormalizable-if-broken
notification-fanout table. Sized properly in R2 once the mention-parsing
service exists to validate this call against real usage.

**`plan_highlights`:**

```sql
CREATE TABLE plan_highlights (
  highlight_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  plan_id            UUID NOT NULL REFERENCES reading_plans(plan_id) ON DELETE CASCADE,
  day_number         INT NOT NULL CHECK (day_number > 0),
  start_offset       INT NOT NULL CHECK (start_offset >= 0),
  end_offset         INT NOT NULL CHECK (end_offset > start_offset),
  color              VARCHAR(10) NOT NULL DEFAULT 'yellow'
                        CHECK (color IN ('yellow','green','blue','pink','purple')),
  note_id            UUID REFERENCES plan_notes(note_id) ON DELETE SET NULL,  -- optional attached note
  is_shared          BOOLEAN NOT NULL DEFAULT FALSE,
  client_mutation_id UUID UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Anchored to `(plan_id, day_number, offset)`, deliberately NOT
`segment_id`.** This is the single most important design call in this
document and it exists because of a real liability found while researching
this phase: the portal's plan editor calls `AdminGrowthService.updatePlan()`
→ `replaceDays()` (`growth-content/admin.ts:198-215`), which **deletes and
re-inserts** `reading_plan_days` and (by cascade) `reading_plan_day_segments`
on every save — re-minting every `segment_id`. `reading_plan_segment_progress`
already silently loses history on every content edit (that's how migration
156 found "38 of 56 recorded day-marks never earned" — some of that drift is
exactly this). Anchoring highlights to `segment_id` would mean a plan's own
editors silently detach every member's highlights the next time they fix a
typo. Anchoring to `day_number` + a character offset into the day's
concatenated content is not immune to edits either (an edit can still shift
text under an offset), but it survives the one edit pattern that's
*guaranteed* to happen (routine typo/copy fixes that don't touch length
materially) without requiring `replaceDays()` to change in R2. See Open
Question 3 for the harder edit-shifts-everything case.

---

## 3. Cross-repo invite-mechanism audit (the "text-only" mechanism §6 replaces)

Researched read-only in both native member-app repos, per instruction.

**iOS (`nuru-member-ios`, bundle `org.nuruplace.member`):**
- Invite today = plain-text `ShareLink` (SwiftUI → `UIActivityViewController`), **no URL, no token**. Three call sites, all in `Features/Grow/ReadingPlansView.swift`: the per-plan CTA (`:855`, `"Join me on \"\(title)\" — a \(dayCount)-day journey in the Word on Nuru Pathway."`), the catalogue "Read with a friend" card (`:461`), and a completion share-image (`:1868`).
- Deep-link infra: a custom `nuru://` URL scheme (`Config/NuruMember-Info.plist:16-26`) exists **only for home-screen widgets** — `.onOpenURL` in `Features/Shell/RootView.swift:208-218` switches on `url.host` to select a tab (`pathway`/`plans`/`chat`/`events`/`give`/`radio`); it does not parse a path or params, and there is no per-plan target. **No universal links** — no `*.entitlements` file exists anywhere in the tree, no `associated-domains` capability, no `apple-app-site-association` reference.

**Android (`nuru-android`, `applicationId = com.nuruplace`):**
- Invite today = a **no-op**. The plan-detail "Invite" button is `.clickable { }` with an empty body, explicitly commented `// White "Invite" button (no-op)` (`feature/grow/PlanDetailScreen.kt:462-475`). Android has no plan-invite feature at all — not even the text share iOS has. This is the largest single client gap in the whole epic.
- Deep-link infra: **none.** `AndroidManifest.xml` has no App Links intent-filter (no `VIEW`/`BROWSABLE`, no `android:scheme`/`host`, no `autoVerify`) — only the launcher intent-filter on `MainActivity`. No `assetlinks.json` reference anywhere.

**Backend + portal (this repo):** no public unauthenticated route exists
anywhere except `/login` (`packages/admin-web/src/App.tsx:63-77`); the only
`join` route in the backend is the already-authenticated
`POST /chat/spaces/:id/join`. No OG/`<meta property>` rendering exists
anywhere (`packages/admin-web` is a client-rendered Vite SPA — it cannot
emit crawlable tags for a share preview even if a route were added to it).
The backend emits no public HTML today (grepped `sendFile`/`text/html` —
only email templates use an `html` field).

**Bottom line: §6 is fully greenfield on every surface.** Nothing to
migrate away from, no legacy format to preserve compatibility with — which
simplifies the design (§5) but means every piece (AASA/assetlinks hosting, a
server-rendered OG page, per-plan URL parsing on both native apps, the
designed invite image) is new work, not an upgrade.

---

## 4. API surface design (R1 scope — schema this phase, behavior next)

Conventions follow the house style exactly: `{ error: { code, message,
request_id, details? } }` envelope (`http/errors.ts`), `auth` middleware
first, `client_mutation_id` on offline-originated writes, non-paginated
`{ data: [...] }` list responses (matching `chat/connections.ts`'s
low-cardinality lists, not the cursor-paginated admin lists — a shared
reading group's member/invite counts are single digits, so `Paginated<T>`
would be over-engineering here).

| Method & path | Auth guard | Notes |
|---|---|---|
| `POST /reading/groups` | `auth`, minor-safe (see below) | Body `{ plan_id, member_user_ids?: string[], name?, client_mutation_id? }`. Creates the group, adds the caller as `created_by` + first member. Each `member_user_ids` entry must be an accepted `user_connections` peer (else 403 `CONSENT_REQUIRED`, `details.hint = "connect first"` — the exact pattern `POST /chat/dms` already uses) and gets a `shared_plan_invites` row + `plan_group_invite_received` notification. Omitting `member_user_ids` creates a solo group ready for an open share-link. |
| `GET /reading/groups` | `auth` | My active + archived shared groups, each with plan summary + member list + each member's `current_day`/`completed_days.length`/`completed_at` (§2.1 scope rule). |
| `GET /reading/groups/:id` | `auth`, active member only | Full detail (403 `FORBIDDEN_SCOPE` for a non-member — never a 404 leak of group existence to a stranger, matching the `person()` 404-not-403 pattern used the other direction in `chat/connections.ts:45-51` doesn't apply here since group *existence* isn't sensitive the same way a *user* is, but *membership* is). |
| `POST /reading/groups/:id/archive` | `auth`, `created_by` only | Sets `archived_at`; membership rows and history are kept (no-data-loss, same posture as chat's `connections/:id/remove`). |
| `POST /reading/groups/:id/invites` | `auth`, active member | Body `{ user_id?, message?, client_mutation_id? }`. `user_id` set → targeted invite (connection-required, same gate as group creation). `user_id` omitted → mints a new open-link invite (`invitee_user_id NULL`, `token` fresh, no expiry). |
| `GET /reading/groups/:id/invites` | `auth`, active member | Pending + past invites for this group. |
| `POST /reading/groups/:id/invites/:invite_id/revoke` | `auth`, `inviter_id` or `created_by` | Sets `status='revoked'`. |
| `GET /reading/invites/:token` | `auth` | Authenticated in-app preview (plan title/cover/description/day_count, inviter name, message, group member count) — what the app calls right after a deep link opens the app while logged in. 404 `NOT_FOUND` if unknown/expired/revoked token. |
| `POST /reading/invites/:token/accept` | `auth`, minor-safe | Redeems: if `invitee_user_id` is set, must match caller (else 403). Establishes (or requires — Open Q2) an accepted `user_connections` row between `inviter_id` and caller, adds caller to `shared_plan_group_members`, calls the existing `GrowthContentService.startPlan()` to enroll in the underlying plan (unchanged), marks the invite `accepted`, notifies the inviter. Idempotent via `client_mutation_id` + a no-op re-accept of an already-accepted invite. |
| `POST /reading/invites/:token/decline` | `auth` | Targeted invites only (403 on an open-link invite — there's no one party to decline for everyone). |
| `GET /join/{token}` | **none (public)** | Not a JSON route — see §5. Server-rendered OG HTML landing page; the unauthenticated fallback + crawler-preview surface behind every shared link. |

**Minor-safety, stated once, reused everywhere in this table:** every write
above that adds a *new* cross-user edge (group creation with named members,
targeted invite, invite acceptance) requires — or creates — an accepted
`user_connections` row, and `ConnectionsService.requestConnection()` already
refuses that pairing when either party `is_minor` (`chat/connections.ts:81-
83`). Reusing the connection graph as the gate means Read-with-a-Friend
inherits the chat epic's minor-safety enforcement for free instead of
re-implementing a second consent/age check. This is a design decision, not
an open question — see §2.2 and the reasoning above.

**Progress-event notifications (R1 behavior, no new schema):** on a
successful `completeDay`/`completeSegment` roll-up
(`growth-content/service.ts:295-354`), if the caller is an active member of
any `shared_plan_group`, schedule `plan_group_day_completed` (best-effort,
wrapped in try/catch exactly like `ConnectionsService.notify()`,
`chat/connections.ts:35-41`) to the group's other active members. New
template strings only (`plan_group_invite_received`,
`plan_group_invite_accepted`, `plan_group_member_joined`,
`plan_group_day_completed`) through the existing `NotificationService`
pipeline — zero schema change, same as every notification the chat epic
added. See Open Question 5 for cadence/dedup.

---

## 5. Invite deep-link architecture (spec §6)

**The three-tier fallback, in the order a tap actually resolves:**

1. **Installed, and Universal Links/App Links are configured** — the OS
   intercepts `https://pathway.nuruplace.org/join/{token}` before it ever
   reaches a browser or this backend route, and opens the app directly to
   the invite-preview screen (which calls the authenticated
   `GET /reading/invites/:token`). This requires two new static files hosted
   at the domain root — `/.well-known/apple-app-site-association` (iOS) and
   `/.well-known/assetlinks.json` (Android) — plus the matching Associated
   Domains entitlement (iOS, currently absent — §3) and an `autoVerify`
   intent-filter (Android, currently absent — §3). **Infra prerequisite,
   tracked for R1/R3, not shippable from a schema-only phase.**
2. **Not installed, or the OS/app hasn't verified the domain yet (cold
   click, WhatsApp in-app browser, first-time verification race)** — the tap
   lands on the backend's `GET /join/{token}` HTML page. That page is a
   thin, server-rendered document (Express `res.send()` of a small HTML
   template — no framework, matching the email templates' precedent at
   `identity/email-templates.ts`, the only existing server-rendered HTML in
   this codebase) carrying: `og:title` (plan title), `og:description`
   (plan subtitle/description + inviter's message + day count), `og:image`
   (the "designed invite image" the spec asks for — a per-plan static asset,
   `reading_plans.image_url` reused, or a new composited image generated
   once per plan, sized in R2/R4, not this phase), and a small inline script
   that attempts `nuru://join/{token}` (extending the existing iOS/Android
   custom-scheme infra — the one confirmed piece of deep-link plumbing that
   already exists, per §3) with a ~1200ms timeout that falls through to the
   App Store / Play Store listing (store IDs configured per-platform,
   `?token={token}` preserved as a deferred-deep-link param the app reads on
   first launch post-install — the standard "store-then-plan" pattern).
3. **A crawler fetches the link for a preview card (WhatsApp, iMessage,
   Slack, etc.)** — these bots never execute the inline script; they parse
   only the `<meta property="og:*">` tags server-rendered into the initial
   response, which is exactly what tier 2's HTML already provides. No
   separate crawler-detection branch is needed — tiers 2 and 3 are the same
   response, read two different ways by a browser vs. a bot.

**QR** is a client-side rendering of the same `/join/{token}` URL (a QR code
*of* the link, not a separate mechanism) — no backend work beyond the URL
existing. **WhatsApp + social share + copy link** are all "share this same
URL" on the client — again, no backend fan-out per channel; the one
`/join/{token}` URL is the entire payload for every channel.

**Why the backend, not the portal, serves `/join/{token}`:** `admin-web` is
a client-rendered Vite SPA (`packages/admin-web/src/App.tsx` +
`react-router-dom@7`) — it ships static JS and cannot emit OG tags a crawler
sees before JS runs, which defeats the entire point of a rich preview card.
The backend already answers `pathway.nuruplace.org` (per
`docs/ANDROID_RELEASE.md:5`); a new unauthenticated Express route there,
served from the same origin, is the only surface capable of both
server-rendering OG tags and (per tier 1) being the Universal
Link/App Link target the OS intercepts before either app or portal is
involved.

---

## 6. Client-surface scoping note (evidence-based, not an open question)

`docs/COORDINATED_DEV.md`/`docs/PARITY.md` name `packages/mobile` (React
Native) as "the" member-app surface. It is not, in practice, the live
target for this epic: `packages/mobile/src` has no commits since
2026-06-30 (last: "Mobile native capture: device-model + coarse location"),
while `nuru-member-ios` and `nuru-android` both have commits from *today*
(2026-07-19, "epic remainder — pastor probe, type dedup, discipler path,
server mutes" — the tail end of the chat epic's own client rollout, per
this session's own memory of the chat epic). Per user memory ("Native iOS
member app," "Nuru member Android port"), the RN app is mid-retirement in
favor of these two native rebuilds. **R3/R4 (client phases) target
`nuru-member-ios` + `nuru-android` as the member surfaces, and `admin-web` +
the iPad app (`pathwayforipad`) for the portal's plan-CMS/moderation side —
not `packages/mobile`.** `packages/mobile` is touched only if a future
session confirms it's still shipping to real users; flagged here so R3
doesn't silently plan work against a surface nobody uses.

---

## 7. Phase breakdown

**R0 — Design (this phase).** This document + `shared_plan_groups`/
`shared_plan_group_members`/`shared_plan_invites` (migrations 174–175),
schema-only, zero behavior, zero client change. Gate: `pnpm typecheck &&
pnpm lint`, full backend Vitest suite green against the pre-existing
baseline, `pnpm openapi:lint` green (no OpenAPI changes expected — no route
exists yet). Size: **S**.

**R1 — Backend social.** Service + route layer for every endpoint in §4
except the R2-only ones: group create/list/detail/archive, invite
create/list/revoke/accept/decline, the `/join/{token}` OG page (§5 tiers
2–3), progress-event notification wiring, OpenAPI updated for every new
path (`pnpm openapi:lint` must pass). The AASA/assetlinks static files can
ship here too (infra, no schema). Gate: full backend suite + new endpoint
tests, `openapi:lint`, `typecheck`, `lint`. Size: **L**.

**R2 — Backend highlights + notes.** `plan_notes`/`note_comments`/
`note_reactions`/`note_mentions`/`plan_highlights` migrations (§2.3) +
service/route layer (CRUD + filter-by-color + mention-parsing + share-to-
group visibility). Resolves Open Question 3 (offset-anchoring durability)
before or alongside this phase — it's the right moment, since the tables
don't exist yet to migrate data out of. Gate: same as R1. Size: **L**.

**R3 — Clients: collaborative** (`nuru-member-ios` + `nuru-android`, per §6).
Read-with-a-Friend UI: friend search/invite-to-plan (reusing the chat
epic's connection UI where it already exists), active shared plans list,
per-participant progress display, accept/decline screens, in-app invite
acceptance via `GET /reading/invites/:token`. Gate: per-repo build/tests,
`docs/PARITY.md` updated. Size: **L**.

**R4 — Clients: highlights/notes + invites.** Highlighter UI (color picker,
filter, edit/remove), notes UI (compose, comment, react, @mention, question
flag), and the invite *sending* UI (rich card composer, QR, WhatsApp/social
share sheets, deep-link *receiving* — the `nuru://` scheme extension +, once
tier-1 infra from §5 lands, real Universal Links/App Links). This is the
phase that finally replaces the plain-text `ShareLink` (iOS) and the no-op
button (Android) found in §3. Gate: per-repo build/tests + the deep-link
opens-correct-plan manual check on both real devices, `docs/PARITY.md`
updated. Size: **XL**.

**R5 — Typography/card/design-system audit.** Spec §7–9, both native member
apps + `admin-web` + `pathwayforipad` where the plan CMS/moderation UI
lives. One global type system, card-layout audit ("Celebrate the Family,"
"Reading Plan," "My Prayer Room" flagged by the brief as drift examples),
consolidated tokens, no duplicate one-off styling. Gate: per-surface
build/tests + a visual pass against the iPad's design-precedence rule
(`docs/PARITY.md` §0 — iPad wins on UX/brand, web conforms). Size: **L**.

---

## 8. Verification: this phase

Baseline (`main`, migrations 000–173, before this branch's new files):
full `pnpm --filter @nuru/backend test` run — recorded in the final report
of this session (run after the two new migrations were written, then
re-verified by the same stash-and-restore method the chat epic's C0 used,
so the pre-existing failure baseline is never misattributed to this
change).

---

## 9. Open product questions (max 5)

Each has a recommended default so R1–R2 are never blocked on an answer.

1. **Invite token security posture.** §2.2 stores `shared_plan_invites.token`
   in plaintext, unlike `password_resets.token_hash`. *Recommendation
   (applied):* plaintext is correct here — the token identifies a plan
   invite, not an account credential; a leaked token's worst case is an
   uninvited join to a friend circle's reading plan, not account takeover.
   Revisit only if a future feature reuses this same token type for
   something higher-stakes.

2. **Does redeeming an invite require a *pre-existing* accepted connection,
   or does acceptance *create* one on the spot?** §4 says "establishes (or
   requires)" without picking. *Recommendation:* creates one on the spot if
   none exists (mirroring `ConnectionsService.requestConnection()`'s mutual-
   accept shortcut, `chat/connections.ts:97-113`) rather than requiring the
   inviter to separately send a connection request first — an invite to a
   *specific* plan is already unambiguous, unsolicited-DM-shaped consent
   (the inviter clearly wants to talk to this person), so making them ask
   twice would be friction the spec's "polished and compelling" goal for §6
   argues against. Still blocked by minor-safety (§4) either way.

3. **Highlight anchoring durability under content edits.** §2.3 anchors
   `plan_highlights` to `(plan_id, day_number, offset)` to survive
   `replaceDays()`'s segment-id churn, but an edit that *inserts or removes*
   text before a highlighted span still shifts it under the stored offsets
   (this is not solved, only made less fragile than segment-id anchoring
   would have been). *Recommendation:* accept the residual risk for R2 —
   offset-drift on a genuine content edit is rare (plans are seeded once,
   rarely hand-edited after launch, per the ~60 seed migrations found in
   research) and a client can defensively re-clamp an out-of-range
   highlight to "unknown, hidden" rather than crash or mis-render. A proper
   fix (diffing `replaceDays()` instead of delete-and-reinsert, preserving
   `plan_day_id`/`segment_id` identity when content is textually similar)
   is real work; defer it to a dedicated hardening pass once R2 usage data
   shows whether drift is actually happening, rather than over-building the
   admin CMS speculatively in R2.

4. **Shared-group roles.** §2.1 ships creator-only ownership, no
   moderator/co-leader tier (unlike chat's `space_roles`). *Recommendation
   (applied):* correct for v1 — these are small, invite-only friend circles
   where the chat epic's abuse vectors (public spaces, strangers requesting
   to join) don't apply; add delegation only if real usage or abuse reports
   argue for it, per the same "don't build ahead of a settled UI" posture
   `docs/CHAT_REDESIGN_PLAN.md` Open Question 3 took on broadcast
   `reply_policy` scope.

5. **Progress-notification cadence.** §4 flags that naive fan-out (every
   member's every day-completion pings every other member) is spammy — a
   10-day plan with 5 friends is up to 50 notifications. *Recommendation:*
   dedup per `(group_id, day_number, notifying_user_id, recipient_user_id)`
   at the service layer before calling `NotificationService.schedule()` (a
   completion re-triggered by a client retry or `completeSegment` rollup
   racing `completeDay` must not double-notify), and rely on the *existing*
   `notification_preferences.max_daily` cap (`notifications/service.ts:64-
   72,105`) as the final backstop rather than inventing a second,
   feature-specific throttle — the infrastructure to prevent notification
   fatigue already exists and already applies to every template, including
   these new ones, with zero extra code.
