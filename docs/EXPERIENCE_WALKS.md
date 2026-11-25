# Experience walks — the scored re-walks (EXPERIENCE.md §2a, rules 1, 2, 7)

Every cycle closes with the full ten-area walk on both member apps, in order,
with every screen scored on the six questions (EXPERIENCE.md §1):

1. **Where am I?** 2. **What matters here?** 3. **What can I do?**
4. **What happens next?** 5. **What have I completed?** 6. **What needs my attention?**

A line names the on-screen evidence, quoted exactly, or says **fails** and why.
A screen that needs scrolling or guessing to answer a question fails it. Two
cards telling two stories fail "what matters". A word or number that
contradicts another screen fails too.

Screenshots live with the rig (`~/.nuru-e2e/shots/<walk>/<app>/`). This file
keeps the scores and the findings, and EXPERIENCE.md's cycle log keeps the
summary.

## Member app review — 2026-11-25 (partial)

The local synthetic Ada account was used against the local test API. Android's
Home, Pathway, Plans, Events, Give and You tabs were opened, along with the exam
introduction, a reading day and its Word, calendar, Partners statement, cell
conversation, profile, settings, notifications and an announcement. iOS's six
tab roots and selected learning, prayer, library, resource, notification and cell
screens were captured using the app's debug launch routes. This is **not** the
full scored walk or re-walk required by §2a: not every screen, interaction,
accessibility setting, role or error state was exercised.

Changes from this pass: Pathway explains that level progress includes the exam;
the Events strip names both months across a boundary and exposes full dates to
accessibility services; iOS empty library headers stay at the top and four back
controls have labels and larger touch targets. At the largest iOS accessibility
text size, Events summary badges and live-card labels now stack rather than
overlap; Android Events was also visually checked at 2x text. These visual
checks do not substitute for a VoiceOver or TalkBack interaction walk.
Both native app test suites passed. The iOS Home scroll test intermittently
failed with an offset consistent with clamping the short fixture; the fixture
now includes enough content below the anchor to exercise insertion and removal
without that artificial clamp. The full iOS suite then passed, as did three
repetitions of that test; this is evidence of improved stability, not proof that
all causes of intermittency are eliminated.
Android Home showed cached content and an offline notice with the test emulator
offline, and the notice cleared after connectivity was restored.
The synthetic member's Android reading Day 4 was completed in the local test
environment; returning to its plan showed 57% complete and offered Day 5 next.
A test-event RSVP was also submitted as “Maybe” and its status was confirmed
through the local API. No payment transaction was initiated.
On Android, a test exam answer was saved, the exam was left, and reopening it
returned to question 2 with the resume message. A follow-up automated pass
answered all 91 questions on the synthetic account and submitted the exam;
the server returned 30%, and the app displayed the 80% pass mark and retry
options. “Almost there” was misleading at that score, so both native apps now
use “Keep going” for non-passing quiz and exam results. The 91-question length
is an experience finding; its content and scoring were not changed.
On a clean iOS simulator the sign-in screen's status bar used dark glyphs on a
dark background. The signed-out appearance now uses light glyphs, verified on
the simulator; the signed-in Home screen retains dark glyphs on its light bar.
An Android offline spot-check opened all six tab roots using previously cached
data and restored Wi-Fi and mobile data afterward. This does not establish that
all offline actions, empty states, or stale-data labels behave correctly.
An Android synthetic private prayer was saved offline and reached the local
server after reconnection, but the journal stayed stale. After a targeted fix,
a second offline save showed a device-saved notice, then appeared in the
journal after reconnecting; a local database query found exactly one matching
row. The final notice says the prayer was submitted for sync and asks the member
to check the journal, since a later server rejection remains possible. The notice
is held only during the current journal session and does not
yet identify a server rejection or cover edits and deletions.

React Native integrity follow-up: malformed or undecryptable `np:queue` data
previously appeared empty and could be overwritten. Queue operations now fail
and preserve the stored bytes; tests cover malformed JSON, unexpected shapes,
and decryption failure. This is not a queue recovery mechanism: an affected
member cannot enqueue or sync until the underlying data is recovered. The
separate install-wide queue, plaintext query persistence, encryption fallback,
and background error visibility need further security work.
Concurrent queue updates and sequence assignment in the shared React Native
store/engine are now serialized, with tests for parallel enqueues and clearing
while another mutation is added. This does not establish coordination between
independent store instances or processes.
Native iOS's encrypted queue now fails closed if a payload cannot be decoded,
instead of replaying an empty payload, and propagates encryption or database
insertion errors rather than reporting a successful enqueue; duplicate IDs do
not replace existing rows. The native Android shared queue now serializes
sequence assignment and insertion; a test interleaves ten enqueues. These are
targeted protections, not a complete native offline-storage audit.
All three mobile implementations now constrain acknowledgement cleanup to the
submitted batch and recognized terminal statuses. Android also stops draining
on an incomplete response; its regression tests cover a 100-row incomplete
batch and a new row inserted during a request. React Native tests the same
in-flight addition and an unknown status. iOS tests the acknowledgement filter
and 20 concurrent enqueues. The tests use synthetic data and fake responses.
An iOS cache audit found that sealing could fall back to plaintext and database
failures could be ignored. Cache rows are now encrypted before transactional
writes; database failures roll back and propagate to sync so cursors are not
advanced after a failed cache operation. A database-trigger regression verifies
rollback and encrypted storage. Removing shadowing protocol defaults was also
necessary for the encrypted implementation to be called. In a signed iOS
simulator, synthetic prayers loaded online remained visible on an offline
relaunch. An unsigned simulator could not use Keychain, so its cache-reopen test
failed; ad-hoc signing made Keychain and cache-reopen tests pass. This does not
establish behavior under every Keychain or storage failure.
Further audit findings: `Keychain.set` deletes before re-adding and does not
check the result; the offline database key is re-written on load. A Keychain
failure may therefore make existing encrypted work unreadable. Also, iOS
prayer-journal write paths currently update the local UI/cache before checking
whether `sync.enqueue` succeeded, and callers do not act on its Boolean result.
These need separate fail-safe key handling and user-visible save-error work;
the signed simulator's successful run does not resolve those failure cases.
The complete backend suite passed 1,932 tests across 176 files against its
isolated test database. This exercises existing server checks but is not a
production security assessment or a substitute for a complete app walk.

An isolated iOS sign-in against a local 503 server showed the intended error
message but low-contrast red text on navy. The error now uses the existing
light error color used on dark screens (approximately 11.2:1 against the sign-in
background); the simulated outage screen was captured again after the change.

Open finding: in the local fixture, recurring gift rows presented past schedule
dates as “next” while a statement showed a later due date. The test rig does not
run the worker, so the production behavior and underlying cause are unverified;
do not infer actual payment status or change scheduling logic from this observation.
Follow-up: a read-only query on the synthetic account confirmed active weekly
and monthly schedules with past `next_run_at` values. The worker calls the
scheduler every five minutes; its backlog guard rolls a schedule at least one
whole cycle behind to a future occurrence without collecting missed cycles.
The existing isolated Postgres test for this behavior passed (three tests,
including a check that no backlog transaction is created). This supports the
local-fixture explanation but does not verify the production worker, actual
payment status, or the separate statement discrepancy.

## Cycle 3 close (2026-10-05)

Walked as Ada (Level 1 done, exam ready; reading First Steps, Days 1–3 done;
RSVP'd to Sunday Service; pledges, gifts and receipts; Dev Cell A), on
production's church content in the local prod-shaped database. State spot
checks on Home, Pathway and Plans: Ben (new, nothing started, no cell), Eli
(exam passed, waiting to be ushered), Cara (2 lessons, a plan begun 5 days
ago).

| App (build) | Screens scored | Fails Q1–Q6 | Bugs | Experience findings | Scorecard |
|---|---|---|---|---|---|
| iOS (d55d767) | 107 (642 lines) | 1 · 26 · 0 · 24 · 11 · 10 | 12 | 18 | `~/.nuru-e2e/shots/c3-close/ios/scorecard.md` |
| Android (a0e9f76) | 79 | 5 · 12 · 6 · 8 · 6 · 7 | 13 | 25 | `~/.nuru-e2e/shots/c3-close/android/scorecard.md` |

**Most-failed questions:**
- What matters here? (two stories on one screen, or an untrue line leading)
- What happens next? (a past date, the exam hidden under the modules,
  "In progress" for something never started)

**What could not be reached:**
- error and offline states: shown in Cycle 3's verification instead, with
  offline and forced-503 failure lines on both apps;
- badges, receipts and reminders: the rig does not run the worker;
- success screens: the walks were read-only.

Routing of every finding: EXPERIENCE.md cycle log, "Cycle 3, part 2 and close".
