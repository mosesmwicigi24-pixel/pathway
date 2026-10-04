# The Nuru Pathway experience — one product, not a set of pages

Owner mandate (2026-10-04): ten complete top-to-bottom cycles over the whole
member experience — **Home → Pathway → Plans → Events → Give → Partners &
giving history → Cell & Community → You & Profile → notifications,
announcements & supporting journeys → every shared component, state and
cross-product journey** — each cycle implemented on **both member apps**
(iOS `nuru-member-ios`, Android `nuru-android`), re-walked from Home, and
recorded here with evidence. Business rules, money, permissions and the
server's authority never change; the experience layer does.

## 1. The questions every screen answers

1. **Where am I?** 2. **What matters here?** 3. **What can I do?**
4. **What happens next?** 5. **What have I completed?** 6. **What needs my attention?**

A screen that cannot answer one of these in a glance is not finished.

## 2. Principles

- **One truth, shown everywhere.** A fact about the member (their level, their
  next step, their giving, their cell) is derived once and every surface shows
  the same words. Two cards never tell two stories.
- **The server decides; the app explains.** The client never invents state;
  it turns the server's state into one plain sentence and one next action.
- **Honest states.** Loading, empty, offline, failed and done each have one
  shared look and words that say what really happened — never raw server
  text, never "check your connection" when it wasn't the connection.
- **Calm by default.** One primary action per screen; celebration only when
  something was truly achieved.
- **Promise only what works.** A screen never names a feature, payment rail
  or step the member cannot actually use.

## 3. The member's journey state (Cycle 1 foundation)

Derived once per app from `GET /me/pathway` (the CURRENT level's row:
`status` ∈ active · completed · awaiting_review · locked, `exam_published`,
`completed_modules`/`total_modules`) and the next incomplete module.
**Modules a member earns alone; levels need a human discipler to usher them
in** (exam pass → pending advancement → `awaiting_review` → ushered).

| Stage | When (current level) | Pill | Next step (title · line · action) |
|---|---|---|---|
| `learning` | status `active` | `X of Y modules` | Continue (or Start, when X = 0): «module title» · "X of Y modules in Level N" · **Continue** → that module |
| `examReady` | status `completed`, exam published | `Exam ready` | "Take the Level N exam" · "Every module is done — the exam opens the way to Level N+1." · **Begin the exam** → the exam |
| `examSoon` | status `completed`, exam not published | `Exam opens soon` | "Level N complete" · "Every module is done. The exam opens soon — we'll let you know." · no action |
| `awaitingUsher` | status `awaiting_review` | `Exam passed` | "Level N+1 is next" · "You passed the Level N exam. Your leader will open Level N+1 — you'll get a notice." · **See Level N** |
| `finished` | the LAST level is `awaiting_review` (final exam passed) | `Commissioned` | "You have been commissioned" · "Sent to make disciples — Matthew 28:19" · **See your journey** |

Rules: the summit celebration fires only at `finished` (it used to fire when
every *published* module was done — Level 1 finishers were "commissioned"
while Levels 2–6 had no modules yet). Journey progress is counted in levels
(`(levels before the current + current fraction) / all levels`), never as a
share of published modules, and it never reads 100 before `finished` (capped
at 99 while the last exam is unpassed). "Almost there" never shows at 100%.
The growth score is a score ("45"), not a percent. A level the server reports
as `awaiting_review` is its own state, never "locked" (Android used to decode
it as locked — a member who had passed saw their own level locked). A locked
next module opens its level page, never a module the server would refuse.
Where §3 is silent the apps share these words: the kicker per stage
("Continue · Level 1", "Exam ready · Level 1"…), "Start" when nothing is done
yet, and "Modules open soon" / "Level N is being prepared" for a level with
no modules.

Where it shows: the Home header pill, the Home continue card, the Home
progress line, the Pathway hero card, the Pathway ring and the summit card.

## 4. One state language (Cycle 1 foundation)

| Cause | Title | Line | Action |
|---|---|---|---|
| The device has no network | You're offline | Showing what you last saw — we'll refresh when you're back. (Nothing saved yet: "Connect to the internet, then try again.") | Try again |
| A timeout or dropped answer while the device HAS a network | Something went wrong on our side | It isn't you — please try again in a moment. | Try again |
| Session ended (401 after refresh failed) | Your session has ended | Sign in again to pick up where you left off. | Sign in |
| Server error (5xx) | Something went wrong on our side | It isn't you — please try again in a moment. | Try again |
| Not found (404) | This isn't here any more | It may have been moved or removed. | Go back |
| A member-facing refusal (400/409/422 with our own words) | the server's own words | — | as the screen needs |

Raw server or exception text is never shown to a member. One shared view
renders loading, empty and error states, full width, on every screen.

## 6. Information hierarchy (Cycle 2)

**Each pillar has one home, and Home points to it once.** Home had up to 25
sections and told every pillar's story more than once (the Pathway ×3, the
cell ×2, plans ×3, prayer ×4). It now has a fixed opening, one week block,
the day, and the family.

### 6.1 Home, top to bottom
1. **Live and on-air banners** — unchanged, and only while live.
2. **The owner's opening, in his order:** verse for today → featured video →
   the Sunday letter → what needs you today (or the reflection strip) → the
   liturgy. Unchanged.
3. **YOUR WEEK** — one card, five rows in the journey's order. Each row is an
   icon, a title (the next thing), one line (when or where it stands), and a
   chevron; a tap opens that place.

| Row | When | Title | Line | Opens |
|---|---|---|---|---|
| Pathway | always | journey next-step title ("Take the Level 1 exam") | "Level N · " + journey pill | the journey's destination |
| Plans | an enrolled, unfinished plan | the plan's title | "Day X of Y · today's reading" | that plan's day |
| Plans | none | "Start a reading plan" | "A few minutes a day — with the whole family of God." | Plans |
| Events | the member is going to an upcoming gathering | its title | "EEE d MMM · h:mm a · You're going" | that event |
| Events | an upcoming gathering, not RSVP'd | its title | "EEE d MMM · h:mm a" | that event |
| Events | nothing upcoming | "No gatherings this week" | "See the church calendar" | Events |
| Giving | a recurring gift or a pledge's collector prompts within 7 days | the pledge's title, or "Your weekly gift" / "Your monthly gift" | "Collected on EEE d MMM" | its pledge / the gift's sheet |
| Giving | a pledge instalment is due, with no collector | the pledge's title | "KSh X due EEE d MMM" ("overdue" when past) | Partners |
| Giving | otherwise | "Give" | the rails line ("Tithe & offering · M-Pesa") | Give |
| Cell | in a cell | the cell's name | "Next gathering EEE d MMM" or "Next gathering not set · N members" | the cell page |
| Cell | no cell | "Find your cell" | "Gather with believers near you." | Community |

   A row whose data failed to load shows its "none" form; it never blocks the
   card.

4. **Today's rhythm** — the daily habits card, unchanged.
5. **The family** — the prayer wall, celebrations, the featured carousel
   (announcements and events), and the featured gathering.
6. **Growing** — your progress (scores), grow your faith (devotional,
   memory verses, prayer room, your calling, your discipler), and the
   encouragement banner.
7. **Support God's work** — the giving banner, shown only when the giving row
   is "Give" (a member already giving isn't asked twice).

**Gone from Home, because the week block covers them:**
- the "For you today" hero card (the same ask as "what needs you today");
- the continue-level card;
- the minis row (reading plan and prayer room are in the week block and in
  "grow");
- the plan-resume banner;
- the "Your cell" card and the cohort section;
- the upcoming-events list.

### 6.2 One header on every tab
Every tab root answers *where am I · what matters here* in the same shape:
an uppercase eyebrow, the serif title, one line of what matters now, and the
bell always at the far right.
- **Events:** the eyebrow is "EVENTS" (no emoji). The line is "Next: «title» ·
  EEE d MMM" or "Nothing planned this week".
- **Plans:** the line is the active plan ("Rooted: 10 Days in the Psalms · Day
  1 of 10"), else the tagline.
- **Give:** the bell sits at the right of the Give | Partners switch.
- **You:** no empty band under the segment switch, and one settings gear (the
  segment bar's) — Profile's second gear is gone.

### 6.3 Pathway: a finished level folds away
When the current level is not `learning`, its module list folds into one row:
"20 of 20 modules done · Show" (it expands). The exam row at the foot of the
trail is gone when the hero already shows the exam step. Both apps mark the
rail "You" (the member's level) and "Next" (the following one).

### 6.4 Partners: a pledge collected automatically says so
The owner's 2026-09-28 rule ("Collected on Mon 5 Oct" instead of Pay for a
running recurring gift) extends to a **pledge** whose collector prompts on or
before the instalment's date: the DUE row shows "Collected on EEE d MMM", and
a tap opens the pledge. A pledge with no collector keeps Pay; paying early by
hand stays possible from the pledge page.

### 6.5 Events: a quiet week is quiet
With nothing in range, Events shows:
- the header line "Nothing planned this week";
- the week strip;
- one calm card: "The calendar is quiet this week — gatherings the church
  posts appear here.";
- the calendar and check-in entries as two compact rows.

The tabs, search and filters show only when there is something to filter.

**§6 decisions where the table was silent (2026-10-04, both apps):**
- Today's echo follows today's rhythm. The calendar's "happening now" card
  stays between the video and the letter.
- Grow is a 2×2 grid (Devotional · Hide His Word · My Prayer Room · Your
  Calling) plus one "Your discipler" row. The separate disciplers card and
  grow's reading-plan tile are gone (the week's Plans row covers it).
- The Cell row is the member's OWN cell (their cell summary), never the
  church's featured cell.
- "This week" is today through the seventh day after. The Events row merges
  the calendar, curated events and RSVPs, and skips a declined gathering
  unless it's the only one.
- Giving: overdue reads "KSh X overdue since EEE d MMM". The table's order is
  the priority. A paused collector, or one prompting after the instalment,
  counts as no collector.
- With no journey loaded, the Pathway row reads "Your pathway · Level N".
- A folded level shows "Show" and "· Hide".

**Noted for later cycles:** every bell's gold dot is static, not tied to
unread — a false signal (Cycle 3/6). The Profile segment has no bell.

### 6.6 Fixes carried from Cycle 1
- Android's growth delta ("▲100") never wraps.
- Both apps label the rail "You" / "Next".

## 7. Interaction design (Cycle 3)

**Every tap lands where it points, every screen has a way out, and Back
returns you where you were.** Cycle 3 tapped through every YOUR WEEK row, the
bells, the inbox, a gift by M-Pesa (answered on time, late, and not at all),
the six pledge steps, Events and You, on both apps.

### 7.1 Rules
1. **A tap lands where it points**, on the tab that owns it, at the thing it
   names. A notice with nowhere to go shows only itself (its title, its words,
   when) and Dismiss — never a greeting or "Continue my journey".
2. **Offer only what will work.** An action shows only when the server says it
   can succeed.
3. **Every screen has a way out.** Every full-screen state has a visible exit,
   and the last button never sits under the tab bar.
4. **Leaving never loses what you typed without asking.** A flow with entries
   asks before it discards them.
5. **Back returns you where you were** — the same content at the same scroll.
   A refresh updates in place: no skeleton, and no number (a "0") that isn't
   true yet.
6. **The primary action is the member's real next step.** When the church
   collects automatically, paying is a choice, not the call to action.
7. **The last tap before money moves names the money** ("Give KSh 1,000").
8. **Signals tell the truth.** A bell's dot means something is unread.

### 7.2 Changes
| # | Where | Seen | Cycle 3 |
|---|---|---|---|
| 1 | The exam (contract + both apps) | `exam_published` with no questions → "Exam ready" → the exam answers 422. iOS: "The gate isn't open yet · …Finish every module…", no top back, "Back to Level" under the tab bar. Android: "No exam questions for this level · Try again" | **Server:** each `/me/pathway` level and the trail's exam row carry `exam_available` = published AND at least one active question in a published module of the level. Publishing an exam with no questions is refused: "Add at least one active question before publishing this exam." The exam's 422 says "Your Level N exam isn't ready yet — we'll let you know when it opens." **Apps:** `examReady` needs `exam_available` (absent = available, for an older server); otherwise the stage is `examSoon` (§3 words). The exam screen has a back at the top and its bottom button above the tab bar; a refusal there offers Go back, never Try again. |
| 2 | Pledge page (both) | "Pay now" is the gold primary under "Collected automatically — next KSh 5,000 on 5 Oct" | With an active collector: "Pay early" and "Pause", both secondary. With none: "Pay now" stays primary. |
| 3 | Inbox and pushes (both) | A Live notice opens a sheet with a greeting, journey chips and "Continue my journey" | The inbox and a tapped push share one router: `live_stream_started` and `live_guest_invite` open the Live exactly as a tapped push does (the player while live; a calm "This Live has ended" once over). The fallback sheet shows only the notice — title, full words, when — and Dismiss. iOS shows "Mark all read" only while something is unread (as Android). |
| 4 | Bells (both) | Gold dots always on (Events, Plans, Give, Pathway); the Pathway bell opens nothing; Home shows a count | One bell everywhere: it opens the inbox, and shows one gold dot only while the inbox's unread count is above zero — one shared count, refreshed on foreground, on leaving the inbox and after marking read. |
| 5 | M-Pesa wait (iOS) | "Check your phone" has no button; the watch stops at 60 s; a payment answered at 70 s never shows — the member must quit the app | A quiet "Close" from the start. While on screen the watch keeps going (every 10 s, up to 5 minutes), so a late answer still lands. After 60 s the line reads "Still processing — it will show in Recent giving once it clears." and "Done" becomes the primary. Android, which already has Done, uses the same line. |
| 6 | M-Pesa number sheet (iOS) | "Give Now" | "Give KSh 1,000"; a recurring start keeps "Start Monthly Gift" |
| 7 | New pledge (both) | ✕ on step 5 throws away five steps silently | Once anything is chosen past step 1: "Leave this pledge?" · "What you entered won't be kept." · Keep editing / Leave |
| 8 | Back (Android) | Back from the exam rebuilds Home: top of page, skeletons, score "0" | Home keeps its content and scroll across a full-screen route, and refreshes in place |
| 9 | Featured event (both) | The carousel can show the featured event beside its own card | Never twice on one screen |
| 10 | Money in flight (Android) | Android's Giving row can ask for an instalment already on its way | iOS's rule: skip an instalment fully in flight; ask only the uncovered rest |
| 11 | Tab bar (iOS) | Stays hidden when a notice switches tabs from an open thread | Restored whenever a notice switches tabs |
| 12 | Notification permission (both) | Asked cold on first launch, from a plan reminder or the radio | Asked only when the member turns on something that needs it (a reminder, Live alerts), with one line saying why |
| 13 | Tests (iOS) | ReaderPolishTests and ScriptureRefsTests never run | In the test target |

### 7.3 Decided while building (both apps say these words)
- **A Live that has ended:** "This Live has ended" · the Live's name (when
  known) · **Go back** — the same action as §4's "This isn't here any more".
  A Live notice opens the stream it names (`stream_id`), never whichever
  stream happens to be live now.
- **The exam row while unavailable:** "Level exam · opens soon"; the level
  page's card: "Level N complete · Every module is done. The exam opens soon
  — we'll let you know."
- **Asking for notifications** (rule 4 — never cold): plan reminder "Allow
  notifications?" · "So your daily reading reminder can reach you." · Not now
  / Continue; radio "So we can tell you when Nuru Radio goes live."; Settings
  push "So devotionals, events and reminders reach this phone."; refused for
  good: "Notifications are off" · "‹reason› Turn them on for Nuru Pathway in
  Settings." · Open Settings. **Android only** also asks on a pledge's
  "Remind me before it's due" ("So your pledge reminders reach this phone.")
  and, while the phone has notifications off, shows one Home card — "Turn on
  notifications" · "So messages, Live invites and reminders reach this
  phone." · Turn on / Not now (hidden 14 days) — because Android carries real
  pushes (messages, Live invites, giving notices) and no longer asks at
  launch. iOS has no remote push yet, so it promises none (§2: promise only
  what works).
- **Waiting for M-Pesa** is never a celebration: "Check your phone", the PIN
  line, "Prompt sent to …", a quiet Close; "Thank you for your generosity"
  and its tick only on the server's confirmed success. Android showed
  "Thank you" while the prompt was still waiting (live since before this
  programme) — fixed to iOS's stages, cadence (3 s for a minute, then 10 s to
  5 minutes) and words.
- **"Request body failed validation"** is our side's fault, not a refusal in
  a member's words: it reads as §4's "Something went wrong on our side".
- **A paused collector** counts as no collector: the pledge keeps its gold
  "Pay now". "Leave" in "Leave this pledge?" is the destructive colour.
- **The new-pledge flow covers the tab bar** on both apps, so a tab switch
  cannot throw away a half-made pledge.

## 5. Cycle log

### Cycle 1 — Understand & establish the foundation (2026-10-04)

**Walked** (iOS, local API, member Ada — Level 1, 20 of 20 modules, two
pledges, a recurring gift, a claim; evidence `~/.nuru-e2e/shots/c1`): Home,
Pathway, Plans, Events, Give, Partners, pledge pages, You (Community,
Departments, Profile, Settings), notifications.

**Found — the product had no single truth about the member:**
- Home pill "Level 1 · 20 of 20 modules · Begin today"; Home card "100%
  complete · Almost there — finish strong · Continue" (back into a finished
  module); Home progress "0 modules left before Level 2"; Pathway "Continue
  where you left off · Dev Module 20" and "You have been commissioned" — while
  the truth was **take the Level 1 exam**, shown only as a row below twenty
  finished modules.
- The Pathway ring said 100% for a member at Level 1 of 6; Home's ring said
  "45%" for a growth score of 45.
- Errors: Pathway showed raw "Invalid or expired access token" in a narrow
  column; Plans the same text in another style; Events "Check your
  connection" when the connection was fine.
- Home's giving card promised "M-Pesa, card and more" — card is not
  available. Profile showed the phone as +254700000000 while Give shows
  0700 000 000.

**Decided:** §3 one journey state, §4 one state language, and the small
truths (score not percent, rails that work, one phone format).

**Built** (both apps, 2026-10-04):
- iOS `feat/experience` 5245f76 · 2d812a5 · cfd85ab — 313 → 345 tests.
- Android `feat/experience` 7c035cd · 10772b2 · 77239b3 · 77b38b9 — 762 → 796 tests.
- One journey model (`Journey.swift` / `Journey.kt`) behind the Home pill, the
  Home continue card, the Home progress line, the Pathway hero, both rings, the
  rail, the milestones and the summit.
- One state language (`StateLanguage.swift` / `StateLanguage.kt`) with a shared
  full-width state card on Pathway, Plans, Events, Partners, Departments and
  Home, and on every Android screen built on `AsyncContent`.
- Rails that work on Home's giving card; the score shown as a score; one phone
  format.

**Found while building:**
- Android decoded `awaiting_review` as locked, so a member who had passed saw
  their own level locked.
- iOS's exam row never appeared: "every module done" was read as "level
  passed".
- iOS's "For you today · Open prayer journal" opened the Pathway tab.

All three are fixed.

**Seen on screen** (Ada, both apps, the same words):
- Home: pill "Level 1 · Exam ready"; ring "45"; card "EXAM READY · LEVEL 1 —
  Take the Level 1 exam — Every module is done — the exam opens the way to
  Level 2. — Begin the exam"; progress line "Take the Level 1 exam".
- Pathway: ring 17% (was 100%); the same exam step leads; the summit is no
  longer reached, and no celebration fires.

**Carried to Cycle 2:**
- Home still carries up to 25 sections, each pillar repeated (Pathway ×3, Cell
  ×2, Plans ×3).
- Every tab opens with a different header.
- iOS marks the rail "You"/"Next"; Android doesn't.
- Android's growth delta "▲100" wraps to two lines.
- Raw server text remains on secondary screens (Devotional, Memory Verse,
  Quiz, Giving statement, Live…) and in Give's money flows.

Checked and not a bug: `MAX_LEVEL = 5` in `levelAdvancement.ts` is "the last
level you can be ushered FROM" (ushering 5 → 6 works; 6 → 7 is refused).

### Cycle 2 — Information hierarchy (2026-10-04)

**Built:**
- iOS `feat/experience` a51b69c · 64d6df2 · 22e69c0 · ade896a — 345 → 388 tests.
- Android `feat/experience` 7b6fd0d · 1674f73 · 6cbf76d · 5331fa4 — 796 → 835 tests.
- The full §6 on both apps: the YOUR WEEK card (pure, tested `HomeWeek` /
  `YourWeek`), Home re-ordered and freed of every duplicate pillar card, one
  header (Events without its emoji and with its "Next" line, the Plans line,
  the Give bell, the You segment without the band or a second gear), the
  folded finished level and one exam step, "Collected on" for a pledge's
  collector, and a quiet Events week.

**Seen on screen** (Ada, both apps, the same five rows):
- "Take the Level 1 exam · Level 1 · Exam ready"
- "Start a reading plan · A few minutes a day — with the whole family of God."
- "No gatherings this week · See the church calendar"
- "Kenya trip · Collected on Mon 5 Oct"
- "Dev Cell A · Next gathering not set · 6 members"

Also seen: Partners DUE "Collected on Mon 5 Oct" for Kenya trip (Roof sheets
keeps Pay); Pathway "20 of 20 modules done · Show" with the rail's You/Next;
Events "Nothing planned this week" with one calm card and two compact rows;
"▲100" on one line.

**Found while building:**
- iOS: an upcoming gathering opened from Home showed COMPLETED with no
  check-in (no end time was read as long past). Fixed.
- The old Home card showed a plan Ada never started as "Day 1 of 10" — the
  week's honest "Start a reading plan" replaced it.

**Checked, not a regression:** Android debug builds freeze 13–19 s on the
first launch after an install, in the pre-programme build too; warm launches
take 1.2 s with no skipped frames. A release build is measured in Cycle 7.

**Carried to Cycle 3:**
- Every bell opens the inbox, and its dot shows only when something is unread
  (today: static dots; the Pathway bell is decorative).
- Money already on its way: Android's Giving row adopts iOS's rule (skip an
  instalment fully in flight, ask only the uncovered rest).
- The featured event can show twice (carousel + featured gathering).
- iOS's orphaned ReaderPolish/ScriptureRefs tests.

**Carried to Cycle 4:** the week rows' type (iOS sans, Android serif) and
icons differ; the rhythm tiles' "Pending"; Grow tile labels truncate;
the Partners DUE amount wraps beside the chip.

### Cycle 3 — Interaction design (2026-10-04)

**Walked** (Ada, local API, both apps): every YOUR WEEK row; Home, Give,
Events and Community bells; the inbox and a notice; Give KSh 1,000 by fake
M-Pesa answered at once, at 70 s, and not at all; all six pledge steps and
their ✕; Events → All events & calendar; You → Community.

**Works:** the Giving row lands on the pledge, the Cell row on the cell, the
quiet week on the calendar; a gift answered at once ends on "Thank you for
your generosity · KSh 1,000 · Tithe · Ref …" and the year pill moves from
KSh 13,500 to 14,500; the pledge steps read clearly and the review says
"Nothing is charged by creating it."

**Reconciled with production's shape:** production's Level 1 has a separate
exam module (seq 900) counted in the total, so a finisher reads "10 of 11";
both apps already take the trail's open exam row as `examReady`. The dead end
needs an exam published with no active questions — the admin route allows
it today. The local rig had every level published with no questions, which
is how the walk found it.

**Spec:** §7.

**Carried to Cycle 4:** the inbox's empty white band above its header (iOS);
the M-Pesa sheet's empty lower half; the pledge amount tiles are squares
while Give's are pills; Home's greeting differs ("Happy Lord's Day, Ada." on
iOS, "Good afternoon, Ada." on Android); inbox icons differ (gear / bell).

**Carried to Cycle 5:** You → Community stacks three switchers (Community ·
Departments · Profile → Talk · Pray → My Space · Chat · My Discipler · …) and
repeats the verse of the day.
