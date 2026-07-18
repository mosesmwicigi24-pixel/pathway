# Chat & Communication Module Redesign — Engineering Plan (Phase C0)

Written against the canonical owner brief at `docs/CHAT_REDESIGN.md` (2026-07-18).
This document is the C0 deliverable: gap analysis, data model, migration
strategy, API surface, permission matrix, phase breakdown, and open questions.
No feature code, no client changes, nothing deployed. The C1 migrations this
plan specifies are in `packages/backend/migrations/1758000000161`–`165`,
written but not applied to any running database.

Section numbers below (§7, §10, §13 …) follow the numbering the owner brief
itself uses when it cites its fuller source document; `CHAT_REDESIGN.md` is a
condensed transcription, so where a cited section's full text isn't present in
this repo I've reconstructed the intent from context and flagged it as such
rather than inventing detail that was never actually specified.

## 1. Gap analysis

Honest read of what's already there vs. what the spec wants. "Satisfies"
means the current code already does the right thing and C1–C4 should leave it
alone, not touch it just because it's in scope.

| Spec area | Current state | Verdict |
|---|---|---|
| **My Space — derived membership** | Cell rooms (`kind='group'`) auto-provision on cell creation (`adminops.createCell`) and auto-join a member on first chat access (`ensureCellGroup`/`access()` in `chat/service.ts`). | **Satisfies** the auto-add half. Auto-*transfer* on cell change and "history kept" are not implemented — a member who moves cells is never removed from the old room's `chat_members`, so old membership persists by omission, not by design. |
| **My Space — Follow/Request-to-Join, leader review** | `POST /chat/spaces/:id/join` joins **immediately**, no review, no pending state, no leader notification. Cell rooms have no join path at all for non-cell-members. | **Gap.** No `space_join_requests` table, no leader-review flow, no "pending/declined" member state. |
| **My Space — leader/co-leader/moderator roles** | `chat_members.role` is `member`/`admin` only; `admin` is set once, at space creation, for the creator. `cell_groups.leader_user_id` is the cell's leader, separately. No delegation. | **Gap.** No delegable moderator/co-leader grant independent of the room's original leader. |
| **My Space — removed/suspended, mute, report, pinned messages** | None of these exist. Message-level moderation (flag/remove) exists (`moderateMessage`), but there is no member-level removal/suspension, no mute, no report, no pinning. | **Gap** (member lifecycle, mute, report, pin all missing). |
| **Chat (DMs) — consent-gated, no unsolicited DMs** | `POST /chat/dms` opens or finds a DM with only two checks: same congregation, and neither party is a minor (D-M6). No request/accept handshake. | **Gap**, and the central one — this is the spec's headline requirement. |
| **Chat — states (blocked/restricted/removed)** | None modeled. No block table, no restriction, no removal-from-a-DM concept (a DM can only ever grow via `inviteToThread`, never shrink). | **Gap.** |
| **Chat — accept/decline/remove/block/report/mute/archive** | None of these actions exist for DMs. | **Gap.** |
| **Chat — DB-enforced consent, never UI-only** | N/A today (no consent model to enforce). The one adjacent precedent worth reusing: `access()` already refuses membership server-side, never trusting the client — the same posture the new consent check will need. | **Gap**, but the codebase's existing habit (server-authoritative membership, §1.1) is the right foundation to build the consent check on. |
| **My Discipler — tab exists only with a valid assignment** | `GET /me/discipleship` resolves a discipler via `relationship_tree` (explicit edge) falling back to `cell_groups.leader_user_id` (implicit, cell-derived) — **two different sources of truth**, and the cell-fallback one can change silently the moment a member's cell changes, with no "assignment" event at all. | **Partial.** Resolution logic exists and is a good v1, but it isn't an *assignment* — it's inference. No explicit "this became my discipler on this date, by this actor" record for the cell-fallback path. |
| **My Discipler — private 1:1, invisible to others** | The DM formed with a discipler (via `findDm`) is an ordinary `kind='dm'` conversation, subject to the same moderator-bypass as any other DM (`accessAsModerator` lets any Admin/SuperAdmin read it — the broadcast shield does NOT apply here, only to broadcast-stamped threads). | **Gap.** Ordinary Admin oversight currently CAN read a discipling conversation; the spec wants it "invisible to cell members/leaders/unrelated admins/other disciplers." |
| **My Discipler — one active primary, history, no merge on reassignment** | `relationship_tree` has `UNIQUE(disciple_id)` — literally cannot hold more than one row per disciple, ever. Reassignment requires overwriting/deleting the row, which **destroys** history outright. | **Gap**, and a real data-loss risk under the current schema if reassignment were implemented naively today. |
| **Talk with My Pastor — dedicated 1:1, Pastoral Inbox** | Does not exist. No pastor concept, no pastoral conversation type, no inbox. | **Gap**, greenfield. |
| **Talk with My Pastor — scalable assignment model, no hard-coded id** | Does not exist. | **Gap**, greenfield. |
| **Talk with My Pastor — biometric lock (moved from Broadcast)** | Does not exist **anywhere** in the codebase today — not on Broadcast, not on Pastoral, not on chat at all. Grepped exhaustively; no biometric/lock code in `chat/`, `identity/`, or elsewhere (WebAuthn passkeys are a *different* feature — sign-in, not a per-conversation lock). The server-side analogue that already exists is `requirePasswordStepUp()`, applied today to all four Broadcast routes. | **Gap**, but a good building block exists: the spec's move is a **UI/UX relocation of a feature that was never actually built**, not a migration of working code. The server-side half (step-up gating) can be added to Pastoral routes directly; the client-side half (device biometric APIs, PIN fallback, recents-blur) is pure client work, C3. |
| **Broadcast — distinct OFFICIAL thread, verified sender** | `chat.broadcast()` already fans one message to every recipient as an individually-stamped DM (`broadcast_id` on the message), and `isBroadcastThread()` + the shield in `accessAsModerator`/`listAllForModeration` already hide these threads from ordinary Admins (SuperAdmin-only, or by-name invite via `inviteToThread`). | **Already satisfies** the "distinct, protected thread" and "verified sender" requirements structurally. Visual distinction in the UI is a client concern (C3), not a data gap. |
| **Broadcast — configurable reply behaviour** | Always "ordinary chat" (recipient's reply is a normal message in the same DM). No `none`/`official_inbox`/`linked_thread` modes. | **Gap.** `reply_policy` column added in C1 (migration 165), default preserves current behaviour exactly. |
| **Broadcast — targeting (cell/ministry/level/campus/selected/custom), pre-send reach estimate, scheduling** | Only `congregation`/`all` targeting exists. No cell/ministry/level/campus/selected/custom audiences, no reach preview, no scheduled send. | **Gap** — out of scope for C1 (schema-only); flagged for C2/C3 targeting-engine work, not part of the five C1 migrations. |
| **Broadcast — delivery/read status** | Already exists: `broadcastDetail()` returns `delivered_count`/`seen_count` per recipient via `chat_members.last_read_at`. | **Already satisfies.** |
| **Security & encryption — no false E2EE claims** | No E2EE claim exists anywhere in the codebase or docs today (TLS in transit via the reverse proxy, at-rest via managed Postgres/disk encryption). | **Already satisfies** by omission — there is nothing to walk back. |
| **Security — never leak via logs/analytics/push previews** | Not audited as part of C0 (out of scope for a DB/plan phase); flagged for a C4 security-review pass. | **Not evaluated** — explicitly deferred, not silently skipped. |
| **Permissions — role: member/cell leader/discipler/pastor/admin/superadmin/broadcast admin/pastoral admin, space moderator** | Coarse `user_role` enum (Student/Instructor/Admin/SuperAdmin) plus a **separate, already-built fine-grained RBAC layer** (`rbac_roles`/`rbac_role_permissions`/`rbac_user_roles`, migration 035) that is architecturally exactly what "discipler / pastor / broadcast admin / pastoral admin" need — new role rows, no new tables. Per-space delegation (space moderator for *this* space specifically) is a different axis and needs `space_roles` (C1, migration 163). | **Partial — strong reuse story.** The RBAC scaffolding for global roles already exists and needs no migration, only new `rbac_roles` rows + `PERM_MODULES` entries (C2, TS constant, not SQL). Per-space delegation is new (C1 table, already written). |
| **Permissions — decisions consider block/device-lock/suspension** | Block and suspension don't exist yet (see above); device-lock is explicitly client-side per the owner brief. | **Gap** (block, suspension) / **N/A by design** (device lock). |
| **Notifications — typed (space/connection/DM/discipler/pastoral/broadcast/assignment/removal)** | `notifications` table (migration 007) is **template + JSONB payload**, not a fixed enum — new notification types are new `template` string values, zero schema change. | **Already satisfies** the extensibility requirement; no migration needed, C2 just adds template strings + trigger points. |
| **Data model — explicit conversation types, never inferred from titles** | `chat_conversations.kind` (`dm`/`group`/`space`) is structural only; today's *security* boundary is computed at read-time (`isBroadcastThread()` re-queries messages on every access). No stored type. | **Gap**, closed by migration 161 (this phase). |
| **Data model — space memberships, join requests, space roles** | See above. | **Gap**, closed by migration 163. |
| **Data model — connections + requests** | See above. | **Gap**, closed by migration 162. |
| **Data model — discipler assignments** | `relationship_tree` exists but has no history (see above). | **Partial — deferred to C2**, not one of the five C1 migrations (see §4 phase rationale). |
| **Data model — pastor assignments** | Doesn't exist. | **Gap**, closed by migration 164. |
| **Data model — conversation participants** | `chat_members` already is this. | **Already satisfies**, extended (not replaced) by migration 163's lifecycle columns. |
| **Data model — broadcasts + audiences + delivery records** | `chat_broadcasts` + `chat_messages.broadcast_id` + `chat_members.last_read_at` already is this (migration 157). | **Already satisfies.** |
| **Data model — blocks** | Doesn't exist. | **Gap**, closed by migration 162 (`user_connections.status='blocked'`, directional `blocked_by`). |
| **Data model — conversation locks** | Doesn't exist, and per the owner brief's own framing this is **client-side device state** (a phone's local biometric-gate setting), not server data. | **N/A by design** — the server's job is only to demand fresh step-up (`requirePasswordStepUp`) when a locked surface is opened; it has no business storing whether Ann's phone has Face ID enabled. Documented explicitly so nobody accidentally designs a server table for it later. |
| **Data model — security prefs (read-receipt/online-status privacy toggles)** | Doesn't exist. | **Gap — deferred to C2**, not part of the five explicitly-scoped C1 migrations; needs its own small table (`chat_privacy_prefs`) sized once the UI settles on exactly which toggles ship. |
| **Data model — audit events** | `audit_log` (migration 007) is a generic append-only actor/action/entity/metadata table, already used across the codebase (`audit()` helper in `db.ts`) including `adminops.createCell`. | **Already satisfies.** New actions (`connection.blocked`, `space.member_removed`, `pastor.assigned`, …) are just new `action` strings through the existing helper — no migration. |
| **Uniqueness invariants** (one pending request per pair, one DM per accepted connection, one active pastoral thread per member+pastor, one active discipler assignment, one active space membership per user+space) | Structurally new; C1's partial unique indexes implement the request/assignment invariants (`uq_connection_requests_pending`, `uq_space_join_requests_pending`, `uq_pastor_assignment_member_active`, `uq_pastor_assignment_default_active`). "One DM per accepted connection" and "one active discipler assignment" are C2 service-layer invariants layered on `ensureDm`'s existing find-or-create pattern and a future `discipler_assignments` history table, respectively. | **Partial** — the request/assignment invariants are DB-enforced now; the conversation-level invariants are C2. |
| **Idempotent offline retries** | Already the house style throughout chat (`client_mutation_id UNIQUE` on messages, broadcasts, conversations). | **Already satisfies** — C1's new tables follow the identical pattern (`client_mutation_id UNIQUE` on `connection_requests`). |

## 2. Data model design

### 2.1 `chat_conversations.type` (migration 161)

```sql
ALTER TABLE chat_conversations
  ADD COLUMN type VARCHAR(20)
    CHECK (type IN ('SPACE','DIRECT','DISCIPLER','PASTORAL','BROADCAST','BROADCAST_RESPONSE'));
```

`kind` (structural: dm/group/space — who's in the room) and `type` (security
class: what may be inferred about who's allowed to read it) are **deliberately
two different columns**. Collapsing them would mean either overloading `kind`
with security meaning (exactly what the spec forbids — "never infer security
from titles," and by extension, from a structural field never designed to
carry it) or losing the room-membership mechanics `kind` already drives
(`ensureCellGroup`, `discoverSpaces`, the DM-widens-to-group path in
`inviteToThread`). Two columns, two jobs.

Full backfill mapping and rationale is in the migration file itself
(`1758000000161_chat-conversation-type.sql`) and in §3 below.

### 2.2 `user_connections` + `connection_requests` (migration 162)

```sql
CREATE TABLE connection_requests (
  request_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a              UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  user_b              UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  requester_id        UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  status              VARCHAR(10) NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','accepted','declined','cancelled')),
  message             VARCHAR(500),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at          TIMESTAMPTZ,
  decided_by          UUID REFERENCES users(user_id) ON DELETE SET NULL,
  client_mutation_id  UUID UNIQUE,
  CHECK (user_a < user_b),
  CHECK (requester_id IN (user_a, user_b))
);
CREATE UNIQUE INDEX uq_connection_requests_pending
  ON connection_requests (user_a, user_b) WHERE status = 'pending';

CREATE TABLE user_connections (
  user_a         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  user_b         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  status         VARCHAR(10) NOT NULL DEFAULT 'accepted'
                    CHECK (status IN ('accepted','blocked','removed')),
  blocked_by     UUID REFERENCES users(user_id) ON DELETE SET NULL,
  established_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b),
  CHECK (status = 'blocked' OR blocked_by IS NULL)
);
```

Canonical ordering (`user_a < user_b`, `LEAST`/`GREATEST` at write time) turns
"one row per pair" and "one pending request per pair" into plain (partial)
unique indexes instead of app-level pair-locking. `blocked_by` is directional
so a one-sided block doesn't require deleting or hiding the other party's
side of history.

### 2.3 `space_join_requests` + `space_roles` + `chat_members` lifecycle (migration 163)

```sql
CREATE TABLE space_join_requests (
  request_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(conversation_id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  status          VARCHAR(10) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','accepted','declined','withdrawn')),
  message         VARCHAR(500),
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by      UUID REFERENCES users(user_id) ON DELETE SET NULL,
  decided_at      TIMESTAMPTZ,
  decision_note   VARCHAR(500)
);
CREATE UNIQUE INDEX uq_space_join_requests_pending
  ON space_join_requests (conversation_id, user_id) WHERE status = 'pending';

CREATE TABLE space_roles (
  conversation_id UUID NOT NULL REFERENCES chat_conversations(conversation_id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role            VARCHAR(10) NOT NULL CHECK (role IN ('leader','moderator')),
  granted_by      UUID REFERENCES users(user_id) ON DELETE SET NULL,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id, role)
);

ALTER TABLE chat_members
  ADD COLUMN status VARCHAR(10) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','removed','suspended')),
  ADD COLUMN status_changed_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN status_changed_at TIMESTAMPTZ;
```

`space_roles` is deliberately **additive-only**, the same shape as
`rbac_user_roles` (migration 035): a space's original leader is already
knowable (`cell_groups.leader_user_id` for a cell room, `chat_conversations.
created_by` for a topical space), so it's never duplicated into this table —
only *delegated* co-leader/moderator grants live here. This mirrors the
codebase's existing RBAC pattern (base grant elsewhere + additive union table)
rather than inventing a new shape.

`chat_members` gets a lifecycle instead of a second membership table:
`status` turns "removed" from "row deleted, history gone" into "row kept,
status changed" — which is also how "join/leave history" falls out for free
(`joined_at` already existed; `status_changed_at` covers the leave/removal
side). This was a real trade-off — a separate `space_membership_history` table
was the alternative — and I chose extending `chat_members` because every
existing query that reads membership (`access()`, `discoverSpaces()`,
`listConversations()`) already filters or joins on `chat_members`, so adding
`AND status = 'active'` to those WHERE clauses in C2 is a small, auditable
diff, versus rewriting them to union two tables.

### 2.4 `pastor_assignments` (migration 164)

```sql
CREATE TABLE pastor_assignments (
  assignment_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_user_id  UUID REFERENCES users(user_id) ON DELETE CASCADE,
  congregation_id UUID REFERENCES congregations(congregation_id) ON DELETE CASCADE,
  pastor_user_id  UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  assignment_kind VARCHAR(12) NOT NULL DEFAULT 'primary'
                     CHECK (assignment_kind IN ('primary','campus','cell','default')),
  assigned_by     UUID REFERENCES users(user_id) ON DELETE SET NULL,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  CHECK (member_user_id IS DISTINCT FROM pastor_user_id),
  CHECK (
    (member_user_id IS NOT NULL AND assignment_kind <> 'default')
    OR (member_user_id IS NULL AND assignment_kind = 'default' AND congregation_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX uq_pastor_assignment_member_active
  ON pastor_assignments (member_user_id) WHERE ended_at IS NULL AND member_user_id IS NOT NULL;
CREATE UNIQUE INDEX uq_pastor_assignment_default_active
  ON pastor_assignments (congregation_id) WHERE ended_at IS NULL AND member_user_id IS NULL;
```

Modeled as an edge-with-history (like `relationship_tree` should be, see
§2.5) rather than a foreign key on `users`, because reassignment is a first-
class event the spec wants preserved, not a value to overwrite. A row with
`member_user_id IS NULL` is the "configured default pastoral account" the
spec asks for, scoped per congregation — reusing the same table shape instead
of inventing a key-value config table (there isn't one in this codebase, and
introducing the first one just for this felt like the wrong precedent to set).
No config table anywhere in `packages/backend` currently — verified by search.

**Why this is a C1 table and discipler-assignment-history is not:** pastoral
has *zero* existing model — every part of it, including the ability to name
"who is my pastor" at all, is new. Discipler assignment has a working (if
history-less) v1 already shipped and in use (`relationship_tree`, resolved
today by `discipleship.resolveDiscipler`). Building the greenfield piece first
and hardening the working piece second is the lower-risk sequencing — see §4.

### 2.5 Discipler assignment (design only — no C1 migration)

Recommended for C2: a new `discipler_assignments` table, same shape as
§2.4's `pastor_assignments` (`member_user_id`, `discipler_user_id`,
`assigned_by`, `assigned_at`, `ended_at`, one-active-per-member partial unique
index), rather than retrofitting `relationship_tree`. Reasons: (a)
`relationship_tree.disciple_id` carries a `UNIQUE` constraint with no
`ended_at` — turning it into a history table means dropping that constraint,
which is a breaking change to every existing query that assumes at most one
row (`resolveDiscipler`, `discipleIds`, `assertInScope` in
`discipleship/service.ts`, all three), and (b) `relationship_tree` is
`multiplier_id`/`disciple_id`-named for a specific existing concept (the
"multiplier" growth-tree relationship) that predates and is entangled with the
scoring/growth module (`ScoresService`, `discipleIds` scope checks feed cell-
leader dashboards). A parallel table avoids re-litigating that entanglement
inside a chat redesign. `relationship_tree` keeps its current job; the new
table becomes the canonical source `resolveDiscipler` reads FIRST, falling
back to `relationship_tree` for existing edges not yet migrated, so nothing
that already depends on `relationship_tree` breaks mid-rollout.

### 2.6 Broadcast reply policy (migration 165)

```sql
ALTER TABLE chat_broadcasts
  ADD COLUMN reply_policy VARCHAR(20) NOT NULL DEFAULT 'ordinary_chat'
    CHECK (reply_policy IN ('none','official_inbox','ordinary_chat','linked_thread'));
```

Default (`ordinary_chat`) is today's actual, only behaviour — zero behaviour
change from this migration alone. `linked_thread` needs no extra column: its
target (e.g. "route this reply into the sender's Pastoral thread with them")
is computable at reply-time from `pastor_assignments`/`relationship_tree`
rather than stored per-broadcast, so it's a C2 service-layer decision, not a
schema one.

### 2.7 `conversation_locks` — explicitly NOT a server table

Per the owner brief's own framing, the biometric lock is **device state**: "OS
biometric APIs only… device-specific setting." Nothing about *whether* Ann's
phone requires Face ID to open Pastoral belongs on the server — it isn't
shared across her devices, it isn't something another party needs to see, and
storing it would be exactly the kind of security-theater server data the
brief is implicitly warning against by specifying "no false E2EE claims" and
being this precise about what's actually protected. The server's entire
responsibility here is `requirePasswordStepUp()` (already built, already used
on Broadcast) applied to the new Pastoral routes in C2 — the fresh-auth
backstop for "an unlocked phone left on a desk," which is a real server-side
risk, unlike "does this specific device show a Face ID prompt," which isn't.

### 2.8 Audit events — reuse, no migration

`audit_log` (migration 007) + the `audit()` helper (`db.ts:101`) already gives
every write here an append-only trail for free. C2 adds calls like
`audit(c, actorId, "connection.blocked", "user_connections", pairKey, {...})`
at each new mutation — no schema change.

## 3. Migration strategy for existing data

No data loss, and the redesign must not silently sever, hide, or duplicate a
single existing conversation. Concretely:

1. **Every existing conversation gets a `type` on migration 161**, computed
   from what's already true of it (never blank, never left to a client-side
   default at read time):
   - `kind IN ('space','group')` → `SPACE` (cell rooms unify into the Space
     model — their auto-membership already matches "derived from cell
     membership").
   - `kind = 'dm'` **and** it ever carried a broadcast-stamped message
     (`chat_messages.broadcast_id IS NOT NULL`) → `BROADCAST_RESPONSE`. This
     is the literal, mechanical mirror of the runtime check `isBroadcastThread
     ()` already performs on every read — the migration doesn't invent a new
     boundary, it materializes the one that already governs access today.
   - `kind = 'dm'` between a pair with a **current, on-file**
     `relationship_tree` edge, and no broadcast stamp → `DISCIPLER`. Only the
     *explicit* discipling relationship qualifies; a DM with a cell leader
     that has no `relationship_tree` row is left `DIRECT` (see Open Question
     1 — this is a real judgment call, not an obvious mechanical rule).
   - everything else `kind = 'dm'` → `DIRECT`.
   - No conversation is retyped `PASTORAL` — there is no pastoral concept to
     retype into (correct; matches the brief's explicit "no pastoral threads
     auto-created," extended here to "no pastoral threads auto-*retyped*"
     either).
   - No conversation is retyped `BROADCAST` (bare) — `chat_broadcasts` stays
     the sole source of truth for the sent object; the brief's phrase
     "broadcast threads stay BROADCAST" is read here as "keep their broadcast
     protection/identity," not as a literal instruction to relabel recipient
     threads with the bare `BROADCAST` type. `BROADCAST_RESPONSE` is the more
     precise fit for a *recipient's reply thread*, which is what these rows
     structurally are. Flagged explicitly as a judgment call, not hidden in
     the SQL comments alone.

2. **Existing DM pairs are grandfathered as `ACCEPTED` connections** (migration
   162) — every `DIRECT`-typed, exactly-two-member `dm` gets a `user_connections`
   row dated to the conversation's `created_at`. Consent is prospective, not
   retroactive: nobody already talking is asked to re-consent or is silently
   cut off the moment C2 starts enforcing the gate. `BROADCAST_RESPONSE`
   threads are excluded on purpose (§2.2) — a broadcast recipient never
   consented to an ongoing peer relationship with the sender.

3. **Broadcast threads keep their existing protection untouched.** Nothing
   about `isBroadcastThread()`, the SuperAdmin-only shield in
   `accessAsModerator`/`listAllForModeration`, or `chat_broadcasts` itself
   changes in C1. The new `type` column is additive metadata on top of
   behaviour that already works correctly.

4. **No pastoral threads are auto-created.** Confirmed by construction —
   there is no data in migration 164 to create them from; a human configures
   the first `pastor_assignments` row in C2/C3.

5. **Rollback protection.** Every C1 migration has a real, tested `down`
   section (dropping columns/tables it added) — verified by writing them
   before running `pnpm --filter @nuru/backend test`, since the embedded-
   Postgres harness applies every migration in `up` order on every run; a
   broken `down` wouldn't be caught by that alone, so each was hand-checked
   against its matching `up` for exact symmetry (index names, column names).

## 4. API surface design

All new endpoints follow the existing conventions: `{ error: { code,
message, request_id, details? } }` envelope (`http/errors.ts`), `auth`
middleware first, `requireRole`/`requirePermission`/`assertCellInScope` for
scoping, `client_mutation_id` for offline-originated writes, and reuse of
existing error codes where they already fit — notably **`CONSENT_REQUIRED`**
(already in `@nuru/shared`'s `API_ERROR_CODES`, defined but never yet thrown
anywhere in the codebase — this redesign is its first real use).
**Everything below is C2 scope** (service + route implementation); C1 ships
none of it — listed here so the schema in §2 can be checked against the
surface it needs to support.

| Method & path | Auth guard | Notes |
|---|---|---|
| `POST /chat/connections/requests` | `auth` + minor-safe + consent target must not already be blocked | Body `{ user_id, message?, client_mutation_id? }`. 409 `CONFLICT` if a pending request already exists either direction; if the OTHER party already has a pending request to the caller, auto-resolves both to accepted (mutual ask). |
| `GET /chat/connections/requests?direction=incoming\|outgoing` | `auth` | List, cursor-paginated per §3.1 convention. |
| `POST /chat/connections/requests/:id/accept` | `auth`, recipient only | Creates the `user_connections` row + (unlike today's `ensureDm`) does **not** auto-create the DM — `POST /chat/dms` still does that, now gated on the connection existing. |
| `POST /chat/connections/requests/:id/decline` | `auth`, recipient only | |
| `DELETE /chat/connections/requests/:id` | `auth`, requester only | Cancel. |
| `POST /chat/connections/:user_id/remove` | `auth`, either party | Sets `user_connections.status='removed'`; existing DM history is kept, not deleted (no-data-loss). |
| `POST /chat/connections/:user_id/block` | `auth` | `status='blocked'`, `blocked_by=caller`. |
| `POST /chat/connections/:user_id/unblock` | `auth`, only the blocker | |
| `GET /chat/connections` | `auth` | My accepted connections — the new "who can I already chat with" list. |
| `POST /chat/dms` *(changed)* | `auth` | Member-to-member: now 403 `CONSENT_REQUIRED` (not `NOT_FOUND`) if no accepted `user_connections` row exists, with `details.hint = "send a connection request first"`. Admin/SuperAdmin staff-support DM-anyone behaviour is **preserved as an explicit, audited exception** (see permission matrix) — not silently dropped. |
| `POST /chat/spaces/:id/join-requests` | `auth` | Replaces immediate-join for spaces the caller isn't auto-entitled to (non-cell-member requesting a cell room, or any member requesting a topical space that opts into review). Notifies the space's leader(s). |
| `GET /chat/spaces/:id/join-requests` | `auth`, leader/`space_roles` moderator/Admin+ | Pending queue. |
| `POST /chat/spaces/:id/join-requests/:reqId/accept` \| `/decline` | same as above | Accept inserts `chat_members`; decline just marks the request. |
| `POST /chat/spaces/:id/roles` | `auth`, leader/Admin+ | Body `{ user_id, role }`, `role IN ('leader','moderator')` → `space_roles` upsert. |
| `DELETE /chat/spaces/:id/roles/:user_id/:role` | `auth`, leader/Admin+ | Revoke a delegated role. |
| `POST /chat/spaces/:id/members/:user_id/remove` | `auth`, leader/moderator/Admin+ | `chat_members.status='removed'`. |
| `POST /chat/spaces/:id/members/:user_id/suspend` | `auth`, leader/moderator/Admin+ | `chat_members.status='suspended'`. |
| `GET /chat/discipler/conversation` | `auth` | Resolves (lazily creates, `DISCIPLER` type) the caller's thread with their CURRENT discipler. 404 `NOT_FOUND` with `details.no_discipler = true` if none assigned. |
| `GET /chat/pastoral/conversation` | `auth` | Same shape for `PASTORAL`, resolved via `pastor_assignments` (§2.4 resolution order) then the documented last-resort fallback (Open Question 2). |
| `GET /chat/pastoral/inbox` | `auth` + `requirePermission('chatPastoral','view')` OR caller is the assigned `pastor_user_id` + `requirePasswordStepUp()` | The "Talk with Your Pastor" pastor-facing list — password-gated like Broadcast, for the same reason (§2.7). |
| `POST /admin/pastor-assignments` | `auth` + `requirePermission('chatPastoral','edit')` | Body `{ member_user_id, pastor_user_id, assignment_kind }`; ends the member's prior active row, inserts the new one, notifies both parties. |
| `GET /admin/pastor-assignments?member_id=` | same | History view (all rows, active + ended). |
| `POST /chat/broadcast` *(changed)* | unchanged (`requireRole("SuperAdmin")` + `requirePasswordStepUp()`) | Body gains optional `reply_policy` (defaults `ordinary_chat`, i.e. unchanged). |

Existing routes left as-is in C1 and largely as-is in C2 unless noted:
`/chat/conversations`, `/chat/conversations/:id`, `/messages`, `/read`,
`/reactions`, `/readers`, moderation routes, `/chat/attachments/sign`,
`/chat/cells/:id/conversation`, `/chat/broadcasts`, `/chat/broadcasts/:id`,
`/chat/conversations/:id/invite`. `/chat/people` and `/chat/spaces/:id/join`
both need a C2 product decision on whether they're deprecated or repurposed —
tracked in §4 phase notes, not a C1 concern.

## 5. Permission matrix

Rows are relationship/role states; columns are the actions that matter most.
✓ = allowed, ✗ = denied (403 `FORBIDDEN_SCOPE` or `CONSENT_REQUIRED`), **cond.**
= allowed only under a stated condition. "Space" here means any `type=SPACE`
conversation (cell room or topical); "thread" means any 1:1 (`DIRECT`/
`DISCIPLER`/`PASTORAL`/`BROADCAST_RESPONSE`).

| Relationship / role | View thread/space | Send message | Approve space join | Manage space roles | Moderate space (remove/suspend) | Reassign discipler/pastor | Send broadcast | View broadcast replies | View Pastoral Inbox | Block/unblock |
|---|---|---|---|---|---|---|---|---|---|---|
| Active space member | ✓ (that space) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | n/a |
| Space leader (`cell_groups.leader_user_id` or creator) | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | n/a |
| Space moderator (`space_roles`) | ✓ | ✓ | ✓ | ✗ (cannot grant leader) | ✓ | ✗ | ✗ | ✗ | ✗ | n/a |
| Removed/suspended member | ✗ | ✗ | n/a | n/a | n/a | ✗ | ✗ | ✗ | ✗ | n/a |
| Accepted connection (peer) | ✓ (their DM) | ✓ | n/a | n/a | n/a | ✗ | ✗ | ✗ | ✗ | ✓ (either party) |
| Pending requester | ✗ (thread doesn't exist yet) | ✗ | n/a | n/a | n/a | ✗ | ✗ | ✗ | ✗ | n/a |
| Blocked party (either direction) | ✗ new sends; ✓ existing history read-only | ✗ | n/a | n/a | n/a | ✗ | ✗ | ✗ | ✗ | ✓ unblock (blocker only) |
| Current discipler (of this member) | ✓ (this member's `DISCIPLER` thread only) | ✓ | n/a | n/a | n/a | ✗ (self) | ✗ | ✗ | ✗ | n/a |
| Former discipler | ✗ | ✗ | n/a | n/a | n/a | ✗ | ✗ | ✗ | ✗ | n/a |
| Current pastor (of this member) | ✓ (this member's `PASTORAL` thread only) | ✓ | n/a | n/a | n/a | ✗ (self) | ✗ | ✗ | ✓ (own assigned members) | n/a |
| `pastoral_admin` (RBAC role) | ✓ (all `PASTORAL` threads) | **cond.** (invited into a specific thread only, never blanket) | n/a | n/a | n/a | ✓ | ✗ | ✗ | ✓ (all) | n/a |
| Ordinary Admin (no `pastoral_admin`/`chatPastoral` grant) | ✗ `DISCIPLER`/`PASTORAL`; ✓ `SPACE`/`DIRECT` (oversight) | ✗ into `DISCIPLER`/`PASTORAL` | ✓ (any space, oversight) | ✓ (any space) | ✓ (any space) | ✗ | ✗ | ✗ | ✗ | n/a |
| SuperAdmin | ✓ everywhere, **except** `BROADCAST_RESPONSE` threads of a broadcast they didn't send (structural exception already enforced today) | **cond.** (invite-by-name into one thread only, same as today's `inviteToThread`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (own; any, as SuperAdmin) | ✓ (if no `pastoral_admin` grant needed — SuperAdmin is the documented fallback, Open Question 2) | ✓ (support exception, audited) |
| `broadcast_admin` (RBAC role, non-SuperAdmin) | ✗ — broadcast stays SuperAdmin-only per the owner brief ("Broadcast — SuperAdmin ONLY. Not Admin, not Instructor") | ✗ | n/a | n/a | n/a | ✗ | ✗ (role exists for future delegation but is NOT wired to bypass the SuperAdmin-only gate in C1–C4 unless the brief is revisited) | ✗ | ✗ | n/a |

Notes: "Exceptional access" (owner brief, Permissions section) is implemented
as the existing `inviteToThread` per-thread invite pattern — never a blanket
role bypass — for both Admin-into-broadcast-reply and (new)
Admin-into-Pastoral. Every exceptional-access grant is `audit_log`'d.

## 6. Phase breakdown

**C1 — Data model (this phase).** Five migrations (161–165), schema-only, zero
behaviour change, zero client change. Gate: `pnpm --filter @nuru/backend test`
green against the pre-existing baseline (see §7), `pnpm typecheck && pnpm
lint` clean, migrations apply cleanly under the embedded-Postgres harness.
Size: **S** (~5 files, no service/route code, no OpenAPI change since no route
changed).

**C2 — Backend behaviour + contract.** Implement the service/route layer for
everything in §4: connection gate on `/chat/dms`, space join-request/role
endpoints, `DISCIPLER`/`PASTORAL` conversation resolution, `pastor_assignments`
admin endpoints, `discipler_assignments` table + resolution (§2.5),
`reply_policy` wiring in `ChatService#broadcast`, new `rbac_roles` rows +
`PERM_MODULES` entries in `http/auth.ts` (TS constant, no migration), new
`notifications` templates, `chat_privacy_prefs` table sized once C3's UI
settles on its toggles. OpenAPI updated (`pnpm openapi:lint` must pass) for
every new/changed path. Existing mobile/portal clients keep working — old
behaviour paths (`/chat/dms` unsolicited, `/chat/spaces/:id/join` instant) stay
functionally available until C3 clients cut over, per Open Question 4's
recommendation. Gate: full backend suite + new tests per endpoint,
`openapi:lint`, `typecheck`, `lint`. Size: **L**.

**C3 — Client integration** (web portal + iPad + mobile, per
`docs/COORDINATED_DEV.md`'s cross-surface rule). Chat tab consent UI (request/
accept/block/report), My Space tab (join review, delegated roles, mute, pin),
My Discipler tab, Talk with My Pastor tab + device biometric lock (Keychain/
LocalAuthentication on iOS, BiometricPrompt on Android, WebAuthn-adjacent or a
step-up re-prompt on web where no device biometric exists), Broadcast reply-
policy config UI, Pastoral Inbox portal screen, typed push/notification
handling. Gate: per-surface `typecheck && lint && test`, iPad `xcodebuild`, the
25-scenario test matrix walked manually per persona (member, cell leader,
discipler, pastor, superadmin — see Open Question 5 on the matrix itself),
`docs/PARITY.md` updated. Size: **XL** — by far the largest phase; four
surfaces, five new/changed tabs, a new device-security surface (biometric).

**C4 — Hardening + cutover.** Production backfill (automatic on deploy — C1's
migrations are idempotent and already tested against real data shape via the
embedded-Postgres harness), the deferred security-review pass (log/analytics/
push-preview leak audit, §1 of this doc's "Not evaluated" item), five-persona
flow review per the owner brief's Definition of Done, decide and execute the
fate of deprecated paths (`/chat/people`'s "list everyone" semantics,
unrestricted `/chat/dms` for staff), final `docs/PARITY.md` +
`docs/CROSS_SURFACE_DOD.md` sign-off, remove any C2/C3 back-compat shims once
every client has cut over. Size: **M**.

## 7. Verification: this phase

Baseline (this repo's `main`, migrations 000–160 only, before this branch's
new files): `pnpm --filter @nuru/backend test` → **86 passed / 3 failed test
files, 692 passed / 4 failed tests** — `attendance-ops.test.ts` (1),
`calendar.test.ts` (2), `openapi-routes.test.ts` (1). Confirmed by physically
moving migrations 161–165 out of the migrations directory, running the suite,
then moving them back — not inferred from the task description.

With migrations 161–165 present: **identical result** — 86/3 test files,
692/4 tests, same three files, same four failures, same error messages
(`qr_enabled` undefined, `event_id` undefined ×2, WebAuthn credential-route
path-param-name mismatch in the OpenAPI spec). Zero new failures, zero
migration errors — all 89 test files ran, meaning the embedded-Postgres
`globalSetup` applied all 165 migrations including the five new ones without
error (a migration failure there would abort the entire suite, not surface as
a handful of assertion failures). The four pre-existing failures are
unrelated to chat (event QR/RSVP fixtures and a WebAuthn OpenAPI path-param
naming mismatch) and are not attributed to this change.

## 8. Open product questions (max 5)

Each has a recommended default so C1–C2 implementation is never blocked
waiting on an answer; revisit if the human disagrees.

1. **Which existing DMs backfill to `DISCIPLER`?** Only pairs with an
   explicit, current `relationship_tree` edge, per §3. A cell-leader DM with
   no such edge stays `DIRECT` even though `resolveDiscipler()` would treat
   that same leader as "my discipler" via the cell-fallback path today.
   *Recommendation (applied):* conservative — don't retroactively reclassify
   an implicit, unstable relationship (it changes the moment a member's cell
   changes) as something as private and permission-gated as `DISCIPLER`. When
   C2 ships `discipler_assignments`, a real assignment event for the
   cell-fallback case can be created going forward, and that member's Chat-tab
   DM with their leader simply stays an ordinary DM unless/until one is made.

2. **Pastoral last-resort fallback, beyond the congregation default row.** If
   a congregation has no `pastor_assignments` default row configured either
   (§2.4), who does "Talk with My Pastor" resolve to? *Recommendation:* the
   congregation's earliest-created SuperAdmin (deterministic, same precedent
   as today's broadcast-audience "all" reach), **plus an audit_log entry every
   time this fallback actually fires**, so ops notices the gap and configures
   a real default rather than the fallback silently becoming permanent
   infrastructure.

3. **Is `reply_policy` set per-broadcast or as a congregation-wide standing
   default?** The C1 column is per-broadcast (§2.6). *Recommendation:*
   per-broadcast only for now — don't build a congregation-level settings
   layer speculatively; if SuperAdmins want a sticky default, C2 can default
   the compose UI to "whatever I picked last time" client-side, which needs no
   additional schema.

4. **Does "My Space" mean only the member's one home-cell room, or every
   `type=SPACE` room (cell + topical) treated uniformly?** The owner brief's
   phrase "Non-members: Follow/Request-to-Join" implies spaces beyond the
   member's own cell exist to discover — which only makes sense if topical
   spaces are in scope too. *Recommendation:* unify — cell rooms and topical
   spaces share the same `space_join_requests`/`space_roles` plumbing, but
   with different DEFAULT policy: a cell room auto-accepts its own active cell
   members (today's `ensureCellGroup` behaviour, unchanged) while anyone else
   requesting that cell room needs leader review; a topical space's owner
   chooses open-join vs. review-required per space (a small `chat_conversations.
   requires_join_approval BOOLEAN` flag, sized in C2, not part of the five C1
   migrations since it's a product toggle, not foundational schema).

5. **Is a block bidirectionally invisible, or one-directional (blocker hides
   the other party; the blocked party still sees them normally but can't
   message)?** *Recommendation:* one-directional message-blocking (neither
   side can send new messages once either has blocked) but NOT retroactive
   invisibility — existing history stays visible to both sides (no-data-loss
   principle, §"Migration (no data loss)" of the owner brief, applied here by
   extension even though blocking is a new feature, not migrated data), and
   only the blocked party loses visibility into the blocker's online/presence
   status, not the reverse.
