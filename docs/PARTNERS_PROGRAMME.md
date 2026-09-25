# Partners programme, pledges, reminders, departments — owner design (2026-09-23)

Approved by Moses 2026-09-23 ("YES to all three"). This is the single spec the
backend, portal, iOS and Android build from. Section references are to the
technical spec where they apply.

## 0. Structure (both member apps)

- Bottom bar: **Home · Pathway · Plans · Events · Give · You** (six).
- **Live** (broadcasters only, `live:go`) moves into **Events** as a
  "Broadcast" card at the top: Go Live / return-to-broadcast / My Broadcasts.
- **You** capsule: **Community · Departments · Profile · Settings**. Settings
  is the existing settings screen promoted from behind the gear.
- **Give** tab opens on a two-segment capsule: **Give** (the current giving
  screen) · **Partners** (the programme, §2). Every existing route name
  (`give`, `events`, `chat`, `profile`) keeps resolving — deep links, pushes and
  Home tiles do not change.
- Android money fix, shipped with the structure: a Weekly/Monthly choice
  creates a schedule (`POST /giving/schedules`), a one-time gift does not;
  the cover-fee choice is sent; the schedules list is reachable.

## 1. Vocabulary

- **Partner** — a member who joined the programme. Joining needs no fund, no
  campaign and no money: it is a voluntary programme. A partner record is
  `partner_memberships` (one per member; `status` active|paused|left).
- **Pledge** — a promise, one of two shapes:
  - `monthly`: `amount_minor` every month, open-ended (optionally `until`);
  - `total`: `target_minor` by `due_on`, paid in any instalments.
  A pledge MAY point at exactly one of: a fund, a campaign, or a department
  need (§4). Or none ("general partnership"). A partner may hold many.
  `status`: active | paused | fulfilled | cancelled.
- **Pledge payment** — a `transactions` row attributed to a pledge
  (`transactions.pledge_id`). Attribution happens when: (a) the gift was started
  from the pledge's *Pay now*; (b) the schedule bound to the pledge charged
  (`giving_schedules.pledge_id`); (c) the member answered "Count this toward
  your pledge?" on a gift to the same fund/campaign; (d) the office confirmed
  an "I paid another way" claim (`pledge_claims`: pending|confirmed|rejected;
  a confirmed claim creates a `transactions` row with `provider='manual'`).
- **Progress** — computed, never stored: monthly = paid in the current period
  vs amount; total = sum paid vs target. Labels: on track · behind ·
  fulfilled · paused.
- **Due date** — monthly: the pledge's `due_day` each month (default: the day
  it was created); total: `due_on`, plus optional instalment dates the member
  sets. A schedule-bound pledge's due date is the schedule's `next_run_at`.

## 2. The Partners portal (member app, Give → Partners)

1. Standing: partner since, tier (derived from monthly commitment vs
   giving-tier-economics), gifts collected, season impact (existing).
2. My pledges: one card per pledge — shape, target, progress bar, label,
   next due, fund/campaign/need if any; actions Pay now · Pause · Edit ·
   Cancel · "I paid another way".
3. Due: every upcoming due across pledges and schedules, soonest first, with
   Pay now / Resume.
4. Statements: by year → by pledge → payments; the yearly PDF statement and
   receipts (existing endpoints).
5. Join / Add a pledge: shape → amount → optional target (fund, campaign,
   department need) → due day → optional schedule ("charge me automatically"
   creates a schedule bound to the pledge) → done. Joining without a pledge is
   allowed ("Join the programme" alone).
6. Reminder preferences: on/off, honouring the member's channel preferences.

## 3. Reminders (server, notification worker)

- `pledge_due_soon`: once, 3 days before a due date.
- `pledge_overdue`: if unpaid after the due date, up to **three** polite
  follow-ups **twelve hours apart** (12 h, 24 h, 36 h after due), then stop
  and label "behind". Never repeated for the same due date
  (`pledge_reminders` keyed by pledge + due_on + sequence).
- Quiet hours 21:00–07:00 Africa/Nairobi: a reminder that falls in the window
  is sent at 07:00.
- Channel: whatever the member allows (push/SMS/email preferences); the
  member can switch pledge reminders off entirely.
- A payment or a confirmed claim cancels queued follow-ups for that due date.
- Admin "Send reminder" (portal): one partner or everyone behind; the same
  12-hour spacing is enforced against automatic ones, so nobody is nagged
  twice. Logged in `pledge_reminders` with `sent_by`.
- `pledge_fulfilled`: a thank-you the moment a total pledge completes.

## 3a. Member UI v2 — Give header + Partners screen (owner-approved 2026-09-24)

Both apps, one rule each; the portal drawer follows the same vocabulary later.

- **One header band.** The Give tab paints ONE cream band: a full-width
  two-segment control (GIVE | PARTNERS, uppercase, selected half navy with gold
  text, no icons) as the first row, then the segment's own title. Give: "Sow
  into the Kingdom" + "Generosity is worship — a quiet, joyful act." + the year
  pill ("KSh N given this year", tap → statement) with an eye button that masks
  the amount ("KSh ••••"), persisted per device (`give.hideYearTotal`, default
  visible). Partners: "Walk with the church" + "Decide in advance. The church
  can plan." Nothing else in the band. No "GIVE"/"PARTNERS" eyebrows.
- **Button roles.** Gold fill + navy text = the ONE primary action on a screen
  ("Make a pledge", "Join the programme"). Navy fill + white = money actions
  ("Pay", "Resume"). Navy outline = secondary ("Statement"). Chips carry state
  only: green On track / Fulfilled, gold Behind, grey Paused.
- **Partners screen order.** Standing card (partner since · kept · tier chip ·
  Make a pledge + Statement) → DUE rows (only when due) → MY PLEDGES cards
  (title, state chip, target line, gold progress bar, "N of M kept this year"
  or "paid · to go", next due) → STATEMENT (year chips; Pledged / Paid /
  Remaining; pledge-tied payments only; Full statement and PDF link).
  "Your rhythm" moves to the Give segment under the amount field (one row,
  only when a schedule exists); "Since you began" leaves the Partners tab;
  no explanatory paragraphs anywhere on the tab.
- **Partner-only statement rule (both clients, from server facts):**
  Paid = Σ statement `payments[].amount_minor` where `pledge_id` is set.
  Pledged = Σ over pledges not cancelled: monthly → `amount_minor` × number of
  `due_day` dates in that year from max(pledge `created_at`, 1 Jan) through
  31 Dec; total → `target_minor` if `due_on` falls in that year, else 0.
  Remaining = max(Pledged − Paid, 0). Gifts without a pledge are never shown
  on the Partners tab (they stay in the full statement). If the server ever
  exposes these totals, it must implement exactly this rule.
  **The server does (2026-09-25, §3c):** the rule lives in
  `packages/backend/src/modules/financial/partnerStatementMath.ts`, pinned by
  `test/partners-statement.test.ts` with the same cases as Android's
  `PartnerStatementMathTest`; per pledge it also reports `kept` (payments this
  year, a raw count) and `due_count` (due dates elapsed through today).

## 3b. Pledge names + server-routed pledge money (owner-approved 2026-09-25)

- **A pledge has a name.** `pledges.title` (migration 215, 2–60 chars,
  optional). The wire `title` is the custom name when set, else the derived
  one (campaign → fund → need → "Partnership"); `custom_title` says which.
  Create accepts `title`; PATCH `title: null` clears it. Portal and iPad
  show `title` and need no change.
- **"What is this pledge for?"** — `GET /giving/partnership` carries
  `pledge_options` (General partnership · active funds · live campaigns ·
  approved department needs, in that order, keys `general`, `fund:<code>`,
  `campaign:<id>`, `need:<id>`). Picking one sets the target AND the name;
  "Custom name…" sends a title only and no target. Both apps render the same
  picker; a client with no options falls back to General + the funds.
- **Pledge money is routed by the server, never the chip.** One helper,
  `FinancialService.pledgeFundCode`: the pledge's fund → its campaign's fund
  → its need's department fund → `discipleship` if active → the first active
  fund. Used by gift intents (a `pledge_id` overrides the request's `fund`;
  a need alone still overrides; pledge wins over need), by the pledge's
  auto-schedule and by any schedule bound to a pledge, and by confirmed
  claims. Audit rows and provider metadata record the booked fund.
- **The ceremony tells the truth.** `POST /giving/intents` returns
  `fund {code, name}` and `pledge {pledge_id, title} | null` (also on an
  idempotent replay). Clients render "Enter your PIN to complete KSh 1,000
  toward your <title> pledge." or "… to <fund name>", and fall back to the
  chip label only when the result carries no fund.

## 3c. Two statements, not one (owner-approved 2026-09-25)

- **Partners statement** — the partnership only. Screen + PDF
  (`GET /giving/partners/statement.pdf?year=`; 404 for a member who never
  partnered): standing (partner since · tier), Pledged / Paid / Remaining for
  the year (the §3a rule, now also computed server-side and returned on
  `GET /giving/statements` as `pledged_minor`, `paid_minor`, `remaining_minor`
  with a per-pledge `pledges[]` breakdown — clients prefer the server's numbers
  and fall back to local math on older servers), one row per pledge, and
  pledge-tied payments by month with subtotals and a year total. Gifts outside a
  pledge never appear here.
- **Giving statement** — the complete record (every gift, every fund), as
  before, with pledge payments tagged "<pledge> pledge" (history rows carry
  `pledge_id` / `pledge_title`).
- **Wiring.** On the Partners tab, "Statement" and "Partners statement and
  PDF" open the Partners statement; a "Giving statement" button on that screen
  keeps the complete record one tap away. The Give tab's "View statement" is
  unchanged.

## 4. Departments

- `departments` (congregation, name, purpose, leader_user_id, meets, photo,
  is_open_to_join, status). Portal CRUD (perm `departments:manage`).
- `department_members` (department, user, role leader|member, status
  requested|active|left, requested_at, decided_by/at). Member taps "I'd like
  to serve here" → leader/admin approves in the portal → shows on the
  department and on the member's profile.
- `department_posts` (department, author, body, image_url, created_at):
  leader or admin posts; members read them on the department page; a new
  post can nudge department members.
- `department_needs` (department, submitted_by, title, why, target_minor,
  currency, deadline, status pending|approved|rejected|closed): a leader
  submits a need; the office approves. **An approved need is its own giving
  target** — `transactions.need_id` (a gift started from "Give to this
  need") and `pledges.need_id` are written at giving time, so progress is
  exact and never double-counts other gifts to the same fund. (Revised
  2026-09-23 from "approval creates a campaign": a campaign's progress is
  fund-wide since its start date.) Members see only approved needs; the
  leader also sees pending and closed ones. `POST /giving/intents` accepts
  `need_id` (approved and open, 422 otherwise).
- "A good fit for you": departments whose `gift_keys` intersect the member's
  top gifts (reuse `serving_tracks.gift_keys` mapping) are flagged.
- **A need's fund is server-authoritative.** A gift, a pledge schedule or a
  confirmed claim that names a need lands in the need's department `fund_code`
  when that names an active fund; otherwise the gift's own fund (or the
  programme default for pledges). Clients never decide where need money goes,
  so a need can never split across funds by platform.
- **The office is bounded by its congregation (§5.4).** Every admin read and
  write on departments — list, queues, edits, posts, needs, decisions — is
  scoped to the principal's congregation; a principal with no congregation
  (SuperAdmin) sees all. Out of scope = `403 FORBIDDEN_SCOPE`, never a silent
  success.

## 5. Contract (member API; admin API mirrors under /admin)

- `POST /giving/partners/join` `{}` → membership
- `GET /giving/partnership` → membership, tier, pledges[] (with progress,
  next_due, target), due[], stats (existing fields kept)
- `POST /giving/pledges` `{shape, amount_minor|target_minor, currency, due_day?|due_on?, fund?, campaign_id?, need_id?, auto_schedule?: {method, frequency}}`
- `PATCH /giving/pledges/:id` `{status?: paused|active|cancelled, amount_minor?, due_day?, reminders_enabled?}`
- `GET /giving/pledges/:id` → pledge + payments[] + reminders[]
- `POST /giving/pledges/:id/claims` `{amount_minor, paid_on, note}` → claim
- `POST /giving/intents` gains optional `pledge_id`, `cover_fee`
- `POST /giving/schedules` gains optional `pledge_id`
- `GET /giving/statements?year=` → by year/by pledge summary + the §3a partner
  view (`pledged_minor`, `paid_minor`, `remaining_minor`, `pledges[]`)
- `GET /giving/partners/statement.pdf?year=` → the partner-only PDF (§3a);
  `GET /giving/statement.pdf` stays the full Give statement
- Departments (member): `GET /departments` (fit, my_status, counts, latest
  post), `GET /me/departments`, `GET /departments/:id` (posts, members,
  needs with raised/percent), `POST|DELETE /departments/:id/serve`. Leader
  (checked in the service): `POST /departments/:id/posts`, `DELETE
  .../posts/:postId`, `POST /departments/:id/needs`, `POST
  /departments/:id/serve-requests/:userId/approve|decline`.
- Admin (`departments:view|manage`): `GET|POST /admin/departments`, `PATCH
  /admin/departments/:id` (incl. status archived), `POST|DELETE .../posts`,
  `POST .../needs`, `GET /admin/departments/serve-requests?status=`, `POST
  /admin/departments/:id/serve-requests/:userId/:decision`, `GET
  /admin/departments/needs?status=`, `POST
  /admin/departments/needs/:needId/approve|reject|close`.
- Admin partners: `/admin/partners` (list, detail), `/:userId/remind`,
  `/remind-behind`, `/claims`, `/claims/:id/confirm|reject`.

## 6. Phases

1. Structure + Android money fix + programme (join, standing, pledges CRUD,
   statements) + portal Partners list.
2. Attribution, reminders, claims, admin remind/confirm, per-pledge statements.
3. Departments end to end.
