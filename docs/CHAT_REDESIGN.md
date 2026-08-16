# Chat & Communication Module Redesign — Owner Specification (2026-07-18)

Canonical owner brief for the communications spine rebuild. Phases tracked in
CHAT_REDESIGN_PLAN.md (written by the C0 design phase). Terminology: "Nuru
Place" throughout (the brief's "Noodle Place" is a transcription artifact).

## Member tabs (4): My Space · Chat · My Discipler · Talk with My Pastor
## SuperAdmin tabs (5): + Broadcast. Admin authority ≠ message-content access.

### My Space
- Space membership DERIVED from active cell membership (auto add/transfer, history kept).
- Non-members: Follow/Request-to-Join → pending → leader notified → leader reviews profile → accept/decline → notifications. Only leaders/delegated moderators approve.
- Members: view/send/reply/react/member-list/notifications. Pending/declined see nothing protected.
- Support: leader + co-leader/moderator roles, pending list, removed/suspended, join/leave history, moderation, mute, report, pinned messages, announcements.

### Chat (rename of DMs) — consent-gated
- No unsolicited DMs. Flow: A requests connection → B accepts/declines → only then chat opens (either side may initiate).
- States: not connected / request sent / request received / connected / blocked / restricted / removed.
- Controls: accept/decline, remove connection, block, report, mute, archive, delete-where-permitted, read receipts, online-status privacy.
- DB/permission checks must verify ACCEPTED connection — never UI-only.

### My Discipler
- Tab active only when a valid discipler assignment exists. Private 1:1, invisible to cell members/leaders/unrelated admins/other disciplers.
- One active primary discipler; history; reassignment does NOT merge or expose the former conversation (deliberate archival/handover policy). Notifications on assign/change. Permission checks follow the CURRENT assignment.

### Talk with My Pastor (replaces broadcast-reply-as-pastoral-chat)
- Dedicated private 1:1 pastoral channel; pastor side = Pastoral Inbox ("Talk with Your Pastor").
- One thread per member; members never see others' threads; ordinary admins excluded without explicit pastoral permission.
- Scalable pastor-assignment model (primary/assigned/campus/cell pastor; SuperAdmin as default) — no hard-coded user id. Unassigned → configured default pastoral account.
- THE BIOMETRIC LOCK MOVES HERE (from Broadcast): ⋮ menu — lock/unlock, enable/disable biometric, mute, archive, report security concern, privacy info. OS biometric APIs only; PIN fallback; no raw biometric data; hidden notification previews when locked; recents-blur where supported; re-auth on timeout/restart/logout/device-lock; device-specific setting.

### Broadcast (stays separate, SuperAdmin)
- Delivered into recipients' Chat as a visually-distinct OFFICIAL broadcast thread (verified sender identity). Never auto-creates a pastoral conversation.
- Configurable reply behavior: none / official response inbox / ordinary chat where permitted / linked response thread. Replies never route to Talk with My Pastor unless explicitly configured.
- Targeting: everyone / cell / ministry / leaders / level / campus / selected / custom. Pre-send confirmation with estimated reach. Delivery/read status, scheduling, attachments.

### Security & encryption
- Encrypt in transit, at rest (DB), local device storage, cached attachments. NO false E2EE claims — label accurately. If E2EE later: audited protocols only, defined key lifecycle, server-blind, group key rotation on membership change.
- Never leak messages via logs/analytics/crash reports/push previews/backups/admin dashboards/search indexes.

### Permissions (server-enforced, relationship-based)
- Roles: member, cell leader, space moderator, discipler, pastor, admin, superadmin, broadcast admin, pastoral admin.
- Decisions consider: role + active cell membership + space membership status + accepted connection + current discipler/pastor assignment + participants + block status + device lock + suspension.
- Exceptional access: explicit, limited, audited.

### Notifications (typed)
space request / accepted / declined; connection request / accepted; new DM / discipler / pastoral / broadcast; discipler & pastor assignment; removal/suspension. Locked pastoral → generic "You have a new private pastoral message."

### Data model
Explicit conversation types: SPACE / DIRECT / DISCIPLER / PASTORAL / BROADCAST / BROADCAST_RESPONSE — never infer security from titles. Tables for: space memberships, join requests, space roles, connections + requests, discipler assignments, pastor assignments, conversation participants, broadcasts + audiences + delivery records, blocks, conversation locks, security prefs, audit events. Uniqueness: one pending request per pair, one direct convo per accepted connection, one active pastoral thread per member+pastor, one active discipler assignment, one active space membership per user+space. Idempotent offline retries.

### Migration (no data loss)
Inspect first. Rename DMs→Chat keeping conversations; decide grandfathering of existing DM pairs under consent model; move biometric protection Broadcast→Pastoral; preserve historical broadcasts (never converted to pastoral threads); preserve timestamps/order/attachments/read states; rollback protection.

### UX
Modern, calm, trustworthy. Clear empty states (per-tab, spec §14). Search, unread filters, archive, typing, delivery/read, attachments, voice notes, replies/reactions, offline/retry/failed states, accessibility, smooth tabs. Privacy labels per type (§15) with responsible wording — no absolute-confidentiality promises.

### Test matrix: the 25 scenarios of §16 (auto-membership through deactivated-account handling).

### Definition of done (§17)
Full-stack (frontend, backend, DB, permissions, realtime, notifications, security); five-persona flow reviews (member, cell leader, discipler, pastor, superadmin); no orphaned old logic; Broadcast/Pastoral fully separated; biometrics on pastoral; consent-gated DMs; derived space membership; consistent labels everywhere.
