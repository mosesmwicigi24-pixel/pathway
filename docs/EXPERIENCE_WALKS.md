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
