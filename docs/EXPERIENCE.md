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

## 2a. How every cycle runs (the owner's rules, as a checklist)

1. **Walk all ten areas, in order, on both apps:** Home → Pathway → Plans →
   Events → Give → Partners & giving history → Cell & Community → You &
   Profile → notifications, announcements & supporting journeys → shared
   components and states. The cycle's theme decides what to look for; it
   never shortens the walk.
2. **Score every screen on the six questions** (§1): one line per question,
   or "fails".
3. **Spec first:** this document gets the cycle's rules and a numbered
   change table (seen → change), in the same words for both apps.
4. **Contract first:** a server change ships additive and absent-safe before
   the apps read it.
5. **Build both apps** from that one spec.
6. **Verify on screen:** before and after screenshots of every change on
   both apps, and green test suites.
7. **Re-walk from Home:** the full ten-area walk again on both apps, scored
   again. Anything new goes into the next cycle's list.
8. **Record** the cycle in §5: built, seen, found, carried.
9. **The gates never move.** Business rules, money, permissions and the
   server's authority are untouched. Merging (which deploys), production data
   writes and store builds wait for the owner's YES.

**Audit, 2026-10-05.** Cycles 1–3 kept rules 3–6, 8 and 9. Two places fell
short:
- Cycle 3's walk skipped Plans' reading flow, giving history (receipts and
  statements), announcements and the cell page.
- No cycle has yet scored every screen on the six questions, or re-walked
  all ten areas after building.

On the owner's word (2026-10-05) Cycle 3 is finished before Cycle 4. Its
skipped areas were walked on production's content (§7.4), and it closes with
the full ten-area re-walk on both apps, every screen scored. From then on,
rules 1, 2 and 7 are done in full every cycle.

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

### 7.4 Part 2: the areas Cycle 3 skipped (2026-10-05)

Walked on both apps with **production's own content** (plans, levels,
lessons, exam questions, announcements, events, copied read-only into a
local database) and test members built to match production's counts (§2a).
Areas: Plans (start a plan, read a day, Talk it Over), giving history
(receipt, statement, the Partners statement, "I paid another way"),
announcements (from Home and from the inbox), Events (a gathering's page,
RSVP), the cell page, Community, Profile and Settings.

**Owner decision (2026-10-05): Talk it Over stays a required part of a
plan day.** A member completes it by posting in the conversation or by
tapping "I've talked it over". Nobody is forced to post. The server rule
(every part done) does not change.

| # | Where | Seen | In production (read-only) | Part 2 |
|---|---|---|---|---|
| 1 | Talk it Over (Android) | No way to finish the day without posting; leaving leaves it "Next" | 34 plan days stuck on Talk for 14 members, all Android | The gold "I've talked it over" button, as on iOS; it completes the part and returns to the day. iOS: fix the code comment that says opening completes it; only posting or the button does. |
| 2 | A plan's page (both) | Says "Start plan" (Android) / "Begin Day 1" with Day 1 "Start" (iOS) after the member has started and done parts | 39 of 53 started plans never finished a day | The page follows progress: "Continue · Day 1" with "1 part left"; a finished day is ticked. |
| 3 | Plans tab (both) | The same plan twice: "Continue reading" and "Pick up where you left off" | — | One card for the plan in progress. |
| 4 | Streak card (both) | "0-day streak" beside a tick on today | — | Today is ticked only when a day is finished; before that, "Today: 2 of 3 parts". |
| 5 | Featured plans (server) | Each visit features different plans | 6.6 different featured plans per member per day (max 10) | The promos are the same all day for a member (Nairobi day); the shown log is written once a day. |
| 6 | Events (both) | Opens on "Today (0)"; the gatherings sit under "Upcoming" | 10 of the last 60 days had an event | Opens on the first tab that has something. |
| 7 | Events (both) | "Series you follow" lists series the member does not follow, each with "+ Follow" | 10 members follow any series | "Series you follow" holds only followed series; the rest sit under "More series". |
| 8 | Events (both) | "Every Sunday · 9:00 AM · 9:00 AM" | — | The time once. |
| 9 | A gathering (both) | "Buzzing" with no posts; "Who's going" beside "Who's coming"; a "0 you're going" chip | 9 members have ever RSVP'd | "Buzzing" only when there are posts; the wall is "The wall"; no zero chips. |
| 10 | Announcements (server) | A notice of an announcement sent without the in-app banner opens "not found" | 1 of 3 sent announcements; 10 recipients | Any recipient, by any channel, can open it. **Changes who can see it: deploy waits for the owner's YES.** |
| 11 | Announcements (server) | Reading an announcement leaves its notice unread, so the bell keeps its dot | — | Opening an announcement marks its notices read. |
| 12 | Announcement page | iOS: raw "Announcement not found" with Try again; Android: the cover image twice | — | §4's state card (Go back); the cover once. |
| 13 | Inbox (server) | Reminders scheduled for days ahead show as "now" ("Your event starts in about an hour" six days early) | 8 future reminders in 4 members' inboxes right now | A notice appears once it is due. |
| 14 | After a gift (both) | A second "Thank you for sowing · Amen" pops up later, on another tab | — | One celebration, on the gift's own screen (extends §8.2 #17 to iOS). |
| 15 | Community header (both) | "You're all caught up" beside a bell with unread notices | — | Say what it counts: "No new messages". |
| 16 | The cell page | Android has no way forward; iOS has "Watch replays" and "Open community". Attendance reads "0/8 · you, this month" on iOS and "48% · last 8 meetings" on Android | 0 of 7 cells have a leader; 37 of 76 members have no cell | Android gets both actions; one attendance figure with the server's meaning, the same words on both. |
| 17 | Home tab (iOS) | Tapping the Home tab showed a stale "not found" page left in its history | — | Tapping the current tab returns to its top. |

**Decided while building part 2 (both apps say these words):**

- **A post completes Talk it Over on the server** (`8e5341e`). Until now only
  some app builds completed the part after a post. That is how 14 Android
  members' posts left their days open (row 1). The apps' own call after a
  post stays; it is idempotent. **Shipped to production alone** as
  pathway#502 (`ec9a519`, 2026-10-05, owner YES), with a data fix for the
  23 stuck days where the member had posted. Each was dated to the member's
  first post. Stuck days went from 34 to 11 (8 members, none with a post).
  Ledger: DEPLOYMENT.md, 2026-10-05.
- **The streak card's tick agrees on every phone.** `/growth/plans` gives
  each plan's `last_day_finished_at`: the moment the last part of a fully
  read day was read (`272fba9`). Today is ticked when that falls on today's
  Nairobi day, or when this phone saw the seal. The count beside it is still
  the overnight streak (recomputed 04:00), unchanged.
- **The whole promo page stands all day, fillers included** (`65b8959`).
  Android saw three pages in three calls: showing a plan counts it, and the
  filler picked the least-shown. A plan the member has begun is never
  offered as "FROM THE LIBRARY".
- **No success before the server says so.** A part's gold button ("I've
  talked it over", "Finished", "I've read today's Word") waits for the
  server. On failure the page stays and says "Couldn't save that." with the
  §4 sentence, **above the button**. iOS used to return to the day first and
  fail silently. The same audit covered every success haptic, celebration
  and swallowed write on both apps (iOS: memory verse practice, Home's verse
  save, "Mark answered", the radio reminder, and a "Save practice" that
  saved nothing, now "Done"). Writes that go through the offline queue
  (§1.7) stay as designed.
- **Starting a plan is one tap:** "Begin Day 1" starts the plan and opens
  Day 1. Then "Continue · Day N"; a finished plan offers "Read again". A
  failed start: "Couldn't start this plan" with the §4 sentence.
- **The featured plan is the server's** first promo the member isn't
  already reading, with the server's own label. "PLAN OF THE DAY" (the first
  plan not begun) stands in only when the promos can't load.
- **Recorded difference:** on Android "Open community" opens the cell's
  chat room, because Android has no cell board.
- **Bottom bars clear the gesture bar** (Android: the plan reader, the chat
  composer and the plan page's buttons sat under it, as Talk's did).

**Owner decisions (2026-10-05, from the success-before-save audit):**
- **Location sharing:** the switch waits for the server on both apps. On
  failure it stays as it was and says why. It used to show Off at once, so a
  member could read Off while the server still held their location.
- **Hearts** on the devotional and plan pages: no "Saved" claim, because
  nothing was saved anywhere. The heart stays as a quiet like until real
  saving exists as its own feature.

**Owner items found (not app work):** no cell has a leader in production
(every cell page says "Not assigned yet"); 21 members (28%) passed the
Level 1 exam and wait to be ushered while Level 2 has no published lessons;
today's verse art pairs a prayer verse with a glass of wine.

**Carried:** the Partners statement thanks the member and says their
pledges "carry 3 disciples through a level" while KSh 0 has been given
(Cycle 6); Home points to the exam three times and twice calls it a
"review" (Cycle 5); the edit sheets' empty lower half (Cycle 4).

## 8. Visual language (Cycle 4)

**One look on both apps, built from one set of tokens, and nothing on screen
that reads wrong.** The apps already share the tokens
(`packages/mobile/src/theme/tokens.ts`: paper, white, navy, gold, the ink
scale; Fraunces for titles, Inter — regular drawn as Medium, the owner's
"global voice" — for text; radii 14/24/999; one soft shadow); Cycle 4 makes
every screen use them the same way. Walked: Home, Pathway, Plans, Events,
Give, Partners, Community, Profile and Settings on both apps, side by side.

### 8.1 The grammar
1. **Colour roles.** Paper is the page; white is a card; navy is chrome,
   ceremony and at most one dark feature card per tab; gold is the accent —
   kickers, progress, the primary action, selected states. Green, amber and
   red only say state (on track · due · failed or destructive). No other
   hues.
2. **One header per tab.** Gold kicker in caps · Fraunces title · one Inter
   line · the bell at the right. The kicker names the tab (Home's is the
   date); the greeting belongs to Home alone; a segment switch (Give |
   Partners, Community | Departments | Profile) sits above the kicker. A
   pushed page: back · kicker · title.
3. **Type roles.** Kicker Inter 11 bold, tracking 1.4, gold · screen title
   Fraunces 26–28 · card title Fraunces 18 semibold · **content row title
   Fraunces 15 semibold** (things: a week row, a pledge, a plan, an event, a
   notice) · **control row title Inter 14 medium** (settings, profile fields,
   menus) · body Inter 13–14 · meta Inter 11.
4. **Buttons.** One primary per screen: gold fill, navy text, radius 14.
   Secondary: white, hairline border, navy text. Compact in-row action: a
   navy pill ("Pay", "Go back", "Turn on"). Text action: gold text ("Give
   again", "Show"). Destructive: red, and an alert's destructive role.
5. **Cards.** White, radius 24, hairline border, the one soft shadow; gentle
   prompts on gold tint; every loading / empty / failed state is §4's one
   state card.
6. **Pills and chips** are full pills: selected navy, unselected white with a
   hairline; status chips tinted (green on track, amber due). Amount choices
   are pills everywhere (Give and the pledge steps).
7. **Icons.** One family (Lucide) in 14 / 18 / 22; row icons sit on gold-tint
   tiles. A notice's icon says what it is about.
8. **Words that look like data never leak.** Dates read "EEE d MMM" (with the
   year when it isn't this year); a date-only value (a birthday, a due day)
   is the calendar date sent, never shifted by a time zone; an empty value
   reads "Not set"; no internal names ("Firebase") reach a member.
9. **Nothing that matters truncates.** Titles wrap to two lines; a
   carousel's peek is deliberate; a field is never hidden behind a floating
   button.

### 8.2 Changes
| # | Where | Seen | Cycle 4 |
|---|---|---|---|
| 1 | Headers (both) | Pathway puts the greeting and "Level 1 of 6" above its title; Community's kicker is "GOOD MORNING · ADA"; Android's Settings has no header | §8.1 rule 2 on every tab. Pathway: "PATHWAY · Foundations of Faith · Level 1 of 6 · 20 of 20 modules"; Community: "COMMUNITY · Nuru Connect · You're all caught up"; Settings: "PREFERENCES · Settings" (as iOS) |
| 2 | Content rows (both) | YOUR WEEK rows are Inter on iOS, Fraunces on Android; their icons differ | Content row title (rule 3) on both; the same icon per pillar |
| 3 | "Quick help from Nuru" (both) | A purple and green gradient | Navy with gold — rule 1 |
| 4 | Module counts (contract + both) | "20 of 21 done" over "20 of 20 modules done" on one screen | New `lessons_total` / `lessons_completed` on `/me/pathway` (94002f6; absent → today's fields): every "X of Y modules" counts lessons; the exam is its own step |
| 5 | Plans streak card (both) | iOS "0 days wi…" (cut); Android "0-day streak · Read today to start your streak" | Android's words on both, never cut |
| 6 | Featured plan (both) | The same member, the same day: "Rooted: 10 Days in the Psalms" on iOS, "Who Am I?" on Android | One pick: the same rule over the same inputs (the server's order, the Nairobi day) |
| 7 | Give (iOS) | Amount pills wrap to two lines; "Enter a custom amount" half hidden behind the Give button | Pills on one line (as Android); the field fully visible above the button |
| 8 | Profile (Android) | Date of birth "1989-12-31T21:00:00.000Z"; empty fields "—" | "1 Jan 1990"-style dates (rule 8); "Not set" |
| 9 | Settings (Android) | A "Firebase account · Email / password sign-in (add-alongside)" row | No internal names: if a member needs it, name it by what it does; otherwise it goes |
| 10 | Inbox (iOS) | An empty white band above the header | The header as on Android |
| 11 | M-Pesa number sheet (iOS) | The sheet's lower half is empty | The sheet sized to its content |
| 12 | Pledge amount step (both) | Square tiles; Give uses pills | Pills (rule 6) |
| 13 | Sunday greeting | iOS "Happy Lord's Day, Ada."; Android "Good evening, Ada." | Both: "Happy Lord's Day, ‹name›." on Sundays |
| 14 | Inbox icons | A Live notice is a gear on iOS, a bell on Android | One icon per notice family, the same on both (Live → broadcast) |
| 15 | The level card | Navy on iOS, gold on Android | Navy (Pathway's one feature card) |
| 16 | State screens | The exam's refusal is a full screen on iOS, a card on Android | §4's one state card on both |
| 17 | A confirmed gift | iOS "KSh 1,000 · Tithe · Ref …"; Android "Gift confirmed — receipt on its way. 🎉" after an extra "Thank you for sowing" overlay | iOS's line on both; one celebration, no overlay before it |
| 18 | M-Pesa stages (Android) | The tab bar stays under the ceremony | The ceremony covers it (as iOS) |
| 19 | "Sign out" (iOS) | Not in the destructive colour | Destructive role |
| 20 | From Cycle 2 | Android's rhythm tiles read "Pending"; Grow tile labels truncate; the Partners DUE amount wraps beside its chip | Plain words; rule 9; amount and chip on one line or stacked deliberately |
| 21 | Typography (both, owner 2026-10-05: "check the fonts and put them in vigorous test to be the same") | The family is right everywhere — a forensic check of the announcement body matched Inter Medium, not the system font — but sizes drift: iOS sets 1,674 sizes in code and 521 (31%) are off the type scale (Inter 10 ×203, 9 ×116, 8 ×30, Fraunces 24/20/17/21, even 11.5 and 10.5); Android 247 of 1,164 (21%), mostly 9–10. Nothing below 11 pt is on the scale | Every text on §8.1 rule 3's scale (11 · 12 · 13 · 14 · 15 · 16 · 18 · 22 · 26 · 28) and the same role at the same size on both apps; nothing under 11 pt; long reading (an announcement, a lesson) is the one 16 pt body. Proven by §8.3's tests, not by eye |

### 8.3 Typography tests (both apps)
- **The faces resolve.** iOS: every face the code names (`Inter-*`,
  `Fraunces-*`, `lucide`) loads by name (`UIFont(name:)`), so a missing font
  can never fall back to the system face in silence. Android: every
  `NuruType` style's family is Inter or Fraunces.
- **The scale holds.** A source check in each test suite fails on a size off
  the scale, and on a system or default font used for text (icons and
  home-screen widgets are allowed and listed). It starts as a ratchet — the
  count may only fall — and reaches zero by the end of Cycle 4.
- **What renders is what's asked for.** iOS renders a token-styled `Text`
  and the same string in the named face with `ImageRenderer`; the pixels must
  match.

## 9. Cycles 5–10, combined (owner, 2026-10-05: "combine all other cycles")

The six remaining cycles run as **one**: one spec (this section), one build
round per app, and one closing walk — the full ten areas on both apps, every
screen scored, every persona's state and the error and offline states — that
closes the programme. The themes keep their rules: journeys (§9.1–9.2),
context (§9.3), states under stress (§9.4), one product across both apps
(§9.5), fewer and better things (§9.6), and the final pass (§9.7).

### Journeys (Cycle 5)

**Every journey has a front door, one next step at a time, and an end the
member can see — and every promise along it can be kept.** Cycle 5 follows a
member through each journey end to end: the first day (Ben), the way back
after a pause (Cara), lessons to the exam to the leader's blessing (Ada,
Eli), a plan day, a first gift and a recurring one, an event from finding to
check-in, and finding a cell.

### 9.1 Rules
1. **One name for each thing, everywhere on the journey.** The exam is "the
   Level N exam" — never "review" or "module".
2. **A front door before any long step**: what it is, what it asks, what
   happens after. The exam opens on "91 questions · pass mark 80% · your
   answers are kept if you leave · a pass goes to your leader for Level 2 ·
   Begin".
3. **Each row says its verb** ("Start ·", "Continue ·", "Done today ·"), and
   "What needs you today" never repeats a YOUR WEEK row.
4. **A first day leads with the first step of the path** ("Start Level 1 ·
   God & His Nature"), not a side task.
5. **A pause is named kindly, once** ("You paused First Steps on Thursday —
   Day 2 is waiting"), never as a shortfall.
6. **What is already in motion leads.** A recurring gift being collected comes
   before a one-time gift; a one-time gift is a choice below.
7. **No dead ends, and no promises the church cannot keep yet.** A row that
   says "Find your cell" lands on a way to find one; a next level with no
   lessons says "Level 2 is being prepared — we'll let you know" (§3's words),
   not "your leader will open Level 2".
8. **One week shape.** Week strips that show days start on the same day on
   every screen.

### 9.2 Changes (from the Cycle 3 close walks; Cycle 4's walk adds its own)
| # | Journey | Seen | Cycle 5 |
|---|---|---|---|
| 1 | Exam (server + both) | Four names ("Level 1 review is open · Start review", "Level 1 Review · Start this module", "Take the Level 1 exam"); the exam opens on "QUESTION 1 OF 91" with no count, pass mark or what a pass does | "the Level 1 exam" everywhere (the server's `level_review` nudge words too); the front door of rule 2 |
| 2 | Home (both) | "What needs you today" repeats YOUR WEEK's exam row | Never repeats a YOUR WEEK row (rule 3) |
| 3 | Today's reading (both) | YOUR WEEK "Day 4 of 7 · today's reading" beside Plans "Today's reading is done"; a rhythm chip "Start today" beside "Word DONE"; week strips start Monday (Home) and Sunday (Plans) | "Day 3 done today · Day 4 next"; one streak named, or the two named apart; one first day of the week (rule 8) |
| 4 | First day (Ben, both) | "Reflection due today" leads; YOUR WEEK "God & His Nature" with no verb; "0 of 10 modules" and a "0" ring | "Start Level 1 · God & His Nature" leads; verbs on every row; no zero ring on a first day |
| 5 | Way back (Cara, both) | A four-day pause is never named | Rule 5 on Home and the plan |
| 6 | Give (both) | A one-time KSh 1,000 tithe is pre-filled while the weekly KSh 1,000 tithe (collected Mon 12 Oct) sits below the fold, told twice | Lead with the gift in motion (rule 6); tell it once |
| 7 | Waiting for the next level (Eli, both) | "Your leader will open Level 2" while Level 2 has no lessons and no cell has a leader; two cards with two words ("leader", "discipler") | "Level 2 is being prepared — we'll let you know"; one card, one word |
| 8 | Discipler (both) | Offered in five places to members who have none | Said once: "No discipler yet — your leader will pair you" |
| 9 | The rail (both) | Levels 1 and 3 both read "Foundations"; the circles look tappable and do nothing | Each level's own short name; a circle opens its level, or doesn't look tappable |
| 10 | The ring (both) | The exam is not in the level's fraction: a member who passed and one who has not both read 14% | The exam counts as the level's last step |
| 11 | Events (both) | One-off events offered as series to follow | Only a repeating series is a series |
| 12 | Find your cell (server + both) | "Find your cell" opens Community, which has no way to find a cell — while 37 of 76 members in production have none | **Owner (2026-10-05): "Ask to be connected."** The member says where they live and when they're free ("Ask the church"); it goes to **their own pastor** in their pastoral thread, who assigns the cell with the tools they have. No list of cells or homes is shown. Server: `POST/GET /me/cell-connection` (ed1525d, no schema change). After asking: "Sent to your pastor on ‹date› — they'll connect you · Open the conversation". In a cell: the cell page. A minor: "Ask a parent or guardian to contact the church office." |
| 13 | Community (both) | Three stacked switchers; the verse of the day repeated | One switcher; the verse once (Home owns it) |
| 14 | PayPal (Android) | The waiting stage celebrates (Cycle 1 carry) | Never a celebration before the server confirms (§7.3) |

### 9.3 Context (Cycle 6) — the app knows what is true right now
1. **What is already happening is said first.** A claim the office is
   checking sits on the DUE row it covers ("KSh 2,000 is being checked by the
   office"), so nobody pays twice.
2. **Nothing is urgent before it is.** "DUE" only within the fortnight; further
   out it is "Coming up · 31 Dec".
3. **Time of day agrees.** The greeting, the liturgy card and the rhythm say
   the same part of the day ("Good afternoon" never sits over "EVENING").
4. **A screen speaks to the member's state**, never a generic default —
   Ben's, Cara's, Eli's and Ada's Home each lead with their own next step.

### 9.4 States under stress (Cycle 7)
Every screen is walked in the states production really has: a new member
(Ben), a paused plan (Cara), behind on a pledge (Dee), awaiting the usher
(Eli), exam ready (Ada); a failed and a paused recurring gift, a USD pledge
with a claim being checked, a member with no cell; an empty day; **error and
offline** on every tab (§4's one state language, captured on both apps); a
slow network (loading never shows a fake fact). Android's debug build froze on
a cold launch (Cycle 1) — measured on a local release-mode build, not a store
build.

### 9.5 One product (Cycle 8)
1. The same words for the same thing on both apps — every journey word, state
   line and button; the remaining differences in docs/PARITY.md are closed or
   recorded with a reason (D-13: the cell board).
2. The same order of the same things on every tab.
3. Nothing that one app promises and the other cannot keep.

### 9.6 Fewer, better things (Cycle 9)
1. A card that repeats another card goes.
2. Dead routes and screens go (Android `CommunityHubScreen`, PARITY D-12), each
   with its evidence that nothing reaches it.
3. One way to do each thing (You → Community's three switchers become one).
4. Text grows with the phone's text size without cutting (a test at the
   largest size on both apps).

### 9.7 The final pass (Cycle 10)
The closing walk: all ten areas on both apps, every screen scored on the six
questions and the §8.1 rules, every persona's state, error and offline on
every tab. Done when no question fails for a reason this programme can fix,
and what remains is listed for the owner.

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

**Built:**
- Server: `exam_available` on `/me/pathway` and the trail's exam row, the
  empty exam's words, publishing an empty exam refused (92557c1); Home's
  level-review nudge waits for a takeable exam (af0cc32).
- iOS `feat/experience` 6a6f695 … 99e744f (14 commits) — 388 → 431 tests.
- Android `feat/experience` 78709ac … d37d148 (15 commits) — 835 → 868 tests.
- All 13 items of §7.2 and the §7.3 decisions.

**Seen on screen** (Ada, local API, both apps — `shots/c3/{ios,android}`):
- No questions: "Level 1 complete · Level 1 · Exam opens soon" in YOUR WEEK,
  "Exam opens soon" on Home and Pathway, the level card's "Every module is
  done. The exam opens soon — we'll let you know.", and the exam itself
  answering "Your Level 1 exam isn't ready yet — we'll let you know when it
  opens." with Go back. With questions (production's shape — an exam module
  at seq 900, "20 of 21"): "Exam ready", "Take the Level 1 exam", and on iOS
  the exam opening on the Pathway tab, back at the top, "Next Question"
  above the tab bar.
- Kenya trip (collected automatically): "Pay early" · "Pause"; Roof sheets
  (no collector): gold "Pay now".
- A Live notice: "This Live has ended · Ring check · Go back"; no
  "All read" chip with nothing unread; every bell with no dot at 0 unread;
  the Pathway bell opens the inbox.
- M-Pesa, unanswered: "Check your phone" with Close; at 60 s "Still
  processing — it will show in Recent giving once it clears." with Done;
  answered at 87 s (iOS) and 127 s (Android): "Thank you for your
  generosity". The number sheet says "Give KSh 1,000".
- "Leave this pledge? · What you entered won't be kept. · Keep editing /
  Leave"; the flow covers the tab bar on both apps.
- Android: Home → exam → Go back is pixel-identical (same scroll, no
  skeleton, no "0"); Home's "Turn on notifications" card.
- iOS: a thread's hidden tab bar returns when a notice switches tabs; no
  cold permission prompt on a fresh install; 15 yes-or-no confirmations
  that hid an answer are alerts showing both.

**Found while building — production (fixed and deployed the same day):**
Android sent unset fields as `null`, and three schemas refused it — every
unnamed Android gift, every Android QR service check-in, every formatted
Selah thought (dropped when queued offline). pathway#499 (e6b6e63),
deployed 2026-10-04 15:01 UTC on the owner's YES; ledger entry #501. Also:
Android's M-Pesa wait said "Thank you for your generosity" before the
server confirmed anything (live) — fixed in a2e40b8, ships with the next
Android build. A dated test went red on 1 Oct (fixed at the root,
feat/giving-cycles ca38a36).

**Carried to Cycle 4 (visual language):** the inbox's empty white band
(iOS); the M-Pesa sheet's empty lower half (iOS); pledge amount tiles are
squares, Give's are pills; Home's greeting ("Happy Lord's Day, Ada." /
"Good evening, Ada."); inbox icons (gear / bell); the level card navy (iOS) /
gold (Android); the exam refusal full-screen (iOS) / a card (Android); the
success line ("KSh 1,000 · Tithe · Ref …" / "Gift confirmed — receipt on its
way. 🎉") and Android's extra "Thank you for sowing" overlay; Android's
M-Pesa stages keep the tab bar; "Sign out" not in the destructive colour;
plus Cycle 2's week-row type and icons, "Pending", Grow labels, the DUE wrap.

**Carried to Cycle 5 (journeys):** "What needs you today" repeats YOUR WEEK's
exam row and calls the exam a "review"; PayPal's waiting stage still
celebrates on Android (check iOS); You → Community's three switchers and the
repeated verse.

**Carried to Cycle 7:** Android's debug build still freezes ("isn't
responding") on a cold launch — measure the release build.

### Cycle 3, part 2 and close — the skipped areas, then the scored walk (2026-10-05)

**Built** (spec §7.4):
- Server:
  - Inbox shows only notices that are due; announcements open for any
    recipient, and opening one reads its notices (5111964; the change in who
    can see needs the owner's YES before deploy).
  - Promos stay the same all day (5111964, 65b8959).
  - A Talk it Over post completes the part (8e5341e). This is **in production**
    as pathway#502, with a data fix for 23 stuck days.
  - `last_day_finished_at` (272fba9).
  - Ended series are never featured or offered (43f8ca1).
- iOS 3d070c5 … d55d767, 466 tests. Android 63267a2 … a0e9f76, 934 tests.
- Owner decisions:
  - Talk stays required.
  - The location switch waits for the server.
  - Hearts never say "Saved".

**Walked and scored** (§2a rules 1, 2, 7; production's content, local rig;
scorecards in `EXPERIENCE_WALKS.md`):

| | Screens | Q1 | Q2 | Q3 | Q4 | Q5 | Q6 | Bugs |
|---|---|---|---|---|---|---|---|---|
| iOS (d55d767) | 107 | 1 | 26 | 0 | 24 | 11 | 10 | 12 |
| Android (a0e9f76) | 79 | 5 | 12 | 6 | 8 | 6 | 7 | 13 |

The two walks agree on the big findings:
- the stray seventh level ("Level 1 of 7");
- an ended gathering featured at its first date;
- "In progress" on unopened lessons;
- a done Talk part still asking;
- one gift shown at two times;
- four gold "Begin the journey" on Plans;
- payment methods marked "SOON".

**Into Cycle 4** (fixed in its build): the bugs from both walks, plus the visual
rules (one primary, one date format, nothing cut, no internal ids, no zero
counts, rails that work) and the success-before-save audit's findings
(Android: lost voice notes and posts, about 20 silent failures, the RSVP
refusal crash risk).

**Carried to Cycle 5 (journeys):**
- the exam's four names, its opening page and pass mark;
- "Today's reading" meaning two things;
- Give leading with a one-time tithe while the weekly one is automatic;
- one-off events offered as series;
- Ben's first day and "Find your cell";
- Cara's unnamed pause;
- the level rail's names and its tappable-looking circles.

**Carried to Cycle 6 (context):** the Partners DUE row asks for the full
amount without naming the KSh 2,000 the office is checking. This is by
design (a claim counts once confirmed, GIVING.md), but the member is not told.

**Owner items:**
- Production has seven published levels: level 7 is a stray titled "LEVEL 1",
  and level 6 is "Level 6". The portal's level status was never read by
  member APIs, so "Draft" hid nothing (fix proposed).
- The "Graduation is Calling" announcement asks for a fee to a personal
  M-Pesa number.
- The Level 1 exam is 91 questions at 80%.
- No cell has a leader.
- Content typos and duplicate series.

**Rig:**
- Two kernel panics: sleep with a nearly full disk. The Mac is now kept
  awake while agents run, and the disk is to be freed.
- The rig does not run the worker, so badges and receipts are not shown.

Cycle 3 is closed.
