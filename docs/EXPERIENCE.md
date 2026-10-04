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

### 6.6 Fixes carried from Cycle 1
- Android's growth delta ("▲100") never wraps.
- Both apps label the rail "You" / "Next".

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
