# Member Intelligence Audit — Home, Pathway, Plans, Chat, Give, Profile, Notifications, Prayer Room

Read-only audit. No code was changed to produce this document. Commissioned 2026-08-10 against the owner's brief: *"check on all pages where the app interacts with member... Go big and smart."*

## Method, scope, and how much to trust this

- **Backend** findings (packages/backend/src) were read directly by me, then spot-verified a second time on the four highest-stakes claims (the notification `pushCopy` fallback, the `level_ushered` payload-key bug, the missing email provider, the two independent scoring formulas) by re-reading the exact files myself. All four confirmed exactly as reported.
- **iOS** (`nuru-member-ios/NuruMember`) and **Android** (`nuru-android/.../member`) findings come from a dedicated read-only research pass per surface, citing file + line number for every quoted string. I did not re-open every one of those ~250 citations myself, but the two client reports independently arrived at byte-for-byte-identical shared strings (e.g. the six `WhisperLines` in `ModuleView.swift` and `ModuleScreen.kt`, the exam/quiz pass-fail copy, the giving verse) which is strong internal corroboration that both are reading real source, not guessing.
- **Repo state at read time:** backend HEAD `c83cb16` on `feat/claude-ai-provider`, working tree clean. A concurrent agent was live-editing `modules/assistant/` and `modules/intelligence/{letters,liturgy,prompts}.ts` in a separate git worktree (`.worktrees/aipass`, head `419cb7e`). Everything quoted below is from the **committed** tree; anywhere I rely on something in that in-flight branch it is explicitly flagged "in-flight, not final."
- Every "GUESS" below is labeled as such. Everything else is a direct quote with a file:line citation you can open yourself.

---

## Executive summary — the honest version

The app is **not pretending to be personal where it matters most, and it's not as personal as it could be everywhere else.** Concretely:

1. **The five surfaces that actually read as intelligent are real.** The daily greeting, the mood-matched verse of the day, the daily liturgy, the "echo" (welcome-back/anniversary) card, and the Sunday Letter are all genuinely computed per member from real signals (streak, scores, prayers, reflections, recent emotion) via Claude, with deterministic non-AI fallbacks when there's no model key. This is good work and the owner should know it's not smoke.
2. **Almost everything else that *looks* personal is a client-side template with `firstName`/a count slotted in, rotated by day-of-year — not by anything about that member's actual state.** The Home encouragement banner, the module-reading "whisper" lines, the Pathway Summit line, the notification detail popup — all fall in this bucket on both apps.
3. **The progress/growth score is legitimately more sophisticated than "modules completed."** It is a real 28-day-rolling, consistency-times-depth composite across five domains (§ below), and — importantly — nothing in the code lets an AI model touch it; scores are pure SQL. That is the correct architecture and should not change. But it has three integrity problems: two competing scoring systems that can disagree, one domain ("Attendance") that measures app-opens rather than what its name implies, and it is displayed inconsistently alongside a *different* number (level-completion %) that looks identical on screen.
4. **The single biggest, cheapest fix in this whole audit is a notification-copy bug, not an AI project.** ~15 of ~25 notification templates ship with no `title`/`body` in their payload, so the fallback in `workers/dispatch.ts` renders the underscored template name as the message. A member who just got ushered into Level 3 currently receives a push that says **"level ushered"**. A member who earns a badge gets **"badge awarded"**. This one function (`pushCopy`, `workers/dispatch.ts:30-40`) is on the critical path of nearly every emotionally significant moment in the app and is silently degrading almost all of them.
5. **Giving receipts are never actually emailed.** `giving_receipt` is scheduled on the `email` channel, but no email provider is wired into dispatch (`workers/dispatch.ts:76-88` only handles `push`); email silently falls to a logger. Every act of generosity in the app currently produces a thank-you that nobody receives outside the in-app PDF.
6. **The Nuru AI assistant is not gated by scary consent language — it's gated by discoverability.** 76 users, 186 messages all-time, 0 in 7 days is a UX-findability problem, not a trust problem: the assistant is three taps deep (`You → Chat → an unlabeled gradient card`), and for a member with no unread messages the card's own subtitle literally reads **"The AI assistant · 0 updates across 0 spaces"** on both apps — it describes an empty inbox, not what the AI can do.
7. **iOS and Android are close to parity** (both ship all 4 Prayer Room tabs, the same Talk-it-Over/Read-with-a-Friend features, the same score/badge/certificate surfaces), with two concrete gaps: Android has no "send this verse into chat" share path (iOS does), and Android has no Cohort **Discussions** board at all (iOS does, routed and functional).
8. **There is a real, load-bearing consent gate** (`users.ai_opt_out`), but it only covers some AI paths — the daily greeting, verse mood classification, and Talk-it-Over AI assist are **not** gated, so a member who opts out of "Nuru Intelligence" still gets an AI-written greeting built from their streak/level/scores/emotion signal. That is a promise-vs-behavior gap worth closing.

---

## 1. HOME

| Screen / element | What the member sees today (verbatim) | Where it comes from | Data that exists but isn't used | Proposed improvement | Effort | Impact | Risk |
|---|---|---|---|---|---|---|---|
| **Greeting line ("Good morning, Moses")** | iOS/Android: `"\(greeting), \(firstName)."` — 4 time-of-day branches + Sunday (`HomeView.swift:2221`, `HomeScreen.kt:512-516`) | **Client-side template.** Device clock, not server timezone; `users.timezone` is collected but ignored here. | `users.timezone`; the AI-personal line right below it already exists | Drive the greeting word off `users.timezone` (already stored) so a member abroad isn't told "good morning" at their 11pm | S | Low | None |
| **"Nuru's daily word"** (the italic line under the greeting) | e.g. *"Grace and peace, Moses — God is with you in today's step."* | **Genuinely personal.** `GET me/home/greeting`; AI prompt explicitly fed `firstName, overall growth band, weakest area, level, streak, active days, prayer count, reflection count, and a 48h "heart" emotion signal` (`home/service.ts:118-134`). Falls back to 1-of-7 name-slotted templates, hashed per member+day, when no AI key is set. | — (already the best-used signal in the app) | Nothing structural — but this line is **not covered by the AI opt-out** (`ai_opt_out` doesn't gate `dailyGreeting`), which contradicts the Profile copy promising the opposite (see §Chat/consent). Gate it, or change the Profile copy to be accurate. | S | Med (trust) | Low |
| **Verse of the day** | e.g. *"Your word is a lamp to my feet…" — Psalm 119:105* (client fallback) or a mood-matched verse | **Two-tier: genuinely personal (primary) + static (fallback).** Backend classifies the member's emotional/spiritual season from their own prayers + reactions + activity into 1 of 37 mood labels (`home/service.ts:279-287`), then serves a verse tagged with that mood from `daily_verses`. No AI key → falls back to weakest-score→theme mapping, still per member. | `saved_verses`, `memory_verse_progress` reference text — none of these feed verse *selection* today | Already well-designed; the main gap is the "reason" line degrades to just the theme name (`home/service.ts:364`) with no AI key — low-cost copy fallback improvement | S | Low | None |
| **Encouragement quote under the verse** | e.g. *"You have made us for yourself, O Lord…" — Augustine* | **100% static, congregation-wide.** 8 themes × 3 quotes, picked by `epochDay % pool.length` — **no user id in the hash; every member sees the identical quote that day** (`home/verses.ts:161-219`) | The member's own mood classification (computed one step earlier in the same request!) is discarded — mood-library themes (`"FEAR & ANXIETY"`) aren't even keys in this quote table | Key the quote pool off the *same* mood label already computed for the verse, and hash by `userId` not just `day` | S | Med | Low |
| **Liturgy card** (morning/midday/evening/night prayer) | e.g. *"Rise — his mercies are new for you this morning…"* | **AI-composed, but per-congregation not per-member** — deliberately: *"No names, no personal data — this liturgy is prayed by the whole congregation"* (`intelligence/prompts.ts:84-90`). Members with no congregation always get a hardcoded fallback. | — (intentional design; correct) | No change needed — this one is honest about being shared, and says so nowhere in the UI it needs to (it just doesn't pretend) | — | — | — |
| **Echo card ("the app remembers you")** | e.g. *"You're back. That's what matters — not the days in between."* | **Genuinely personal, deliberately AI-free.** Real triggers: 4+ day gap since last activity, a 6-10-day-old reflection never re-surfaced, or a 30-day plan-completion anniversary (`intelligence/echoes.ts:66-141`) | — | This is the model for "honest personalization" — extend the same pattern (real event, no AI needed) to giving and streak milestones (see Give/Profile rows) | — | — | — |
| **Next-action / "For You Today" hero** | e.g. *"Streak_save: '5 days with God — continue today'"*, *"We saved your place"*, *"Let's conquer: {quiz title}"* | **Rule-based, real signals, all copy hardcoded** (11 candidate cards ranked by priority, `home/service.ts:469-701`) — genuinely reflects the member's actual state (streak, next module, failed quiz, weakest domain) even though the sentences themselves are fixed strings | Member's own name is **never used** in any of the 11 candidates | Low-cost, high-leverage: add `firstName` to the top 3-4 candidates (streak_save, welcome_back, weak_*) the same way the greeting does | S | Med | Low |
| **Rhythm card (Prayer/Word/Reflection today)** | *"Today's rhythm complete 🎉"* / *"Today's rhythm"* | Client-composed from a real `GET me/rhythm/today` payload; static frame | — | — | — | — | — |
| **Encouragement banner** (iOS `HomeEncouragementCard`, Android `EncouragementCard`) | e.g. *"Day 5 of your walk, Moses. Small faithfulness is building something eternal."*, *"Your community lifted 6 prayers — stand with one of them today."* | **Class B — client-side template**, day-of-year rotated, `firstName`/streak/count slotted in (`HomeCards.swift:455-512`, near-identical on Android). Android's "prayer count" is actually the length of the on-screen prayer preview list, not a real congregation total. | The backend already computes richer signals (mood, weakest domain) that never reach this card | Move this card's selection logic server-side into the same signal set as `nextAction`, so it stops rotating blind and starts reflecting real state; fix the Android count to be a real total | M | Med | Low |
| **"For you today" pct banner** | *"Almost there — finish strong 🎉"* (fires at pct ≥ 60) | Client threshold on a real completion %, static copy | — | — | — | — | — |
| **Give banner** | *"Sow into something eternal" / "Every gift carries the gospel further…"* | **100% static**, identical for every member, first-time giver or 5-year monthly partner | `transactions` (giving history) exists and is queried **nowhere** in `modules/home`, `modules/intelligence`, or `modules/notifications` | See Give section — this is the front door to that whole gap | M | Med | Med (pastoral tone risk — see roadmap) |
| **Cell card** | *"You're not in a cell yet" / "Find your people — grow where your absence is noticed."* | Static frame, real cell data when present | — | — | — | — | — |
| **Sunday Letter knock** | *"A letter was written for you"* | Static teaser; the letter itself (`GET me/letters`) is a genuinely personal AI-written 110-160 word pastoral letter citing 2-3 real details from the member's week (`intelligence/letters.ts`, `LETTER_SYSTEM` prompt) | — | This is real and good — the only gap is it's **weekly and passive** (member has to notice the knock); consider a push when it's written (currently `sunday_letter` template ships with no title/body — see Notifications §7) | S | High | Low |
| **Community moments rail** | e.g. *"Finished 'Grace to Live By'"*, *"Hid Psalm 23 in their heart"* | **Genuinely real** — deterministic SQL over actual completions, deduped, backend | — | — | — | — | — |

---

## 2. PATHWAY (progress rating covered in its own section below)

| Screen / element | What the member sees today | Where it comes from | Data that exists but isn't used | Proposed improvement | Effort | Impact | Risk |
|---|---|---|---|---|---|---|---|
| **Header greeting** (second, independent implementation) | Same greeting pattern as Home, but **no Sunday branch on iOS**, different fallback-name casing between screens (`"Friend"` vs `"friend"`) | Client-side, duplicated logic (3rd/4th reimplementation counting Chat and Notifications) | — | Extract to one shared component/hook per client so the 4 greeting implementations can't drift further | S | Low | None |
| **Level cards** | Backend theme/description when present; else a **hardcoded 6-line subtitle map** identical on iOS and Android (`"God, His Word, prayer & the Church"` etc.) | Fallback only — real content is admin-authored | — | Fine as a fallback; just confirm every level has a real `theme` set in the CMS so the fallback never actually fires | S | Low | None |
| **Level detail "verse"** ⚠️ | **The SAME verse text — "He that followeth me shall not walk in darkness…" John 8:12 — is shown on every single level**, only the reference line is swapped for the level's theme string | Client bug, iOS `LevelDetailView.swift:139-144` (need to confirm Android parity — not flagged there, worth checking) | — | Give each level its own verse (already have `scripture_ref` fields elsewhere in the schema/CMS pattern used for `level_encouragements`) | S | Med | Low |
| **Per-level encouragement cards** | Admin-authored cheer/nudge/verse cards keyed by `level_number` + `after_module_sequence` | **Real CMS content, not personalized** — identical for every member at that level (`level_encouragements` table, `encouragements/service.ts:34-42`) | — | This is fine as congregation-wide encouragement; the gap is it's a *second*, disconnected "encouragement" concept from the Home quote pool (§1) — unify or rename so admins/owner aren't maintaining two unrelated systems that share a word | M | Low | Low |
| **Quiz PASS** | *"Module Passed" / "The next module on your pathway is now unlocked."* | Static, real unlock state | — | — | — | — | — |
| **Quiz FAIL** | *"Almost there" / "You need {passMark}% to pass. Take a moment to review the lesson — you've got this." / "Review with Nuru"* | Static, real numbers; **"Review with Nuru" is a real AI entry point** (`learning.ts` explain/remediate) | — | — | — | — | — |
| **Exam PASS** | *"A true milestone. Awaiting your discipler's blessing to continue to the next level. 🌿"* | Static, real state | — | — | — | — | — |
| **Exam FAIL** | *"Not yet — and that's okay" / "You need {passMark}%… revisit the modules and come back when you're ready — you can retake it."* | Static, real numbers | — | Good tone already — grace-forward, no shame. No change needed. | — | — | — |
| **"Awaiting your discipler's blessing"** (post-pass, pre-usher) | Static wait-state copy, both apps | Real: the member IS waiting on a real discipler action (`level_advancement` usher step) | `mentor_notes` (next meeting date) exists and is **not surfaced here** — "your discipler will usher you at your next meeting, Thursday" doesn't exist | Surface the discipler's next scheduled meeting (already collected in `mentor_notes`/`relationship_tree`) next to the wait state, so it's not just a void | M | Med | Low |
| **Milestones / Next Reward** | *"The '{badge name}' badge" / "{n} to go"* | Real badge criteria (`module_count`, `level_reached`, `streak_days`, `attendance_count`) | `user_streaks.longest_streak_days` never celebrated, only current streak | Add a one-time "your longest streak was N days" moment | S | Low | Low |
| **The Summit / Commissioning** | *"{firstName}, you have been commissioned — go."* / *"{n} levels between you and being sent."* | **The one genuinely name-aware Pathway line**, client template, real level count | — | — | — | — | — |
| **"Your Walk" timeline** | Real event titles: *"Finished 'Grace to Live By'"*, *"Passed the Level 2 exam"*, quoted reflection excerpts | **Genuinely real**, deliberately AI-free — one SQL UNION over 8 real event kinds, doc comment literally says *"everything here is counted, not guessed"* | — | This is the best-designed surface in the whole app. No change needed structurally. | — | — | — |
| **Footprints** ("3 others walked here before you") | Real cell-mates who completed the same module, first names + avatars | Genuinely real, backend-computed | — | — | — | — | — |

---

## 3. PLANS (reading plans)

| Screen / element | What the member sees today | Where it comes from | Data that exists but isn't used | Proposed improvement | Effort | Impact | Risk |
|---|---|---|---|---|---|---|---|
| **"Featured for you" rail** | Plan cards | **Not personalized at all — literally `plans.take(8)`** (Android `ReadingPlansScreen.kt:117-125`; iOS equivalent unconfirmed but same backend endpoint) | Member's level, weakest score domain, past-completed plan categories — all exist, none used to rank plans | Rank by relevance (level-appropriate, matches weakest domain, excludes already-completed) before falling back to recency | M | Med | Low |
| **Day view / day prompts** | Scripture, devotional text, "Talk it Over" questions, "Go Deeper" refs | **100% static, authored once in a SQL migration per plan** (`reading_plan_day_segments`) — same for all ~76 members reading that plan | — | This is appropriate — a curated devotional shouldn't be AI-rewritten per member. No change needed to the content itself. | — | — | — |
| **"Talk it Over" prompt** | e.g. *"What 'rubble' have you been staring at — and can you say 'great is Your faithfulness' over it?"* | Static, admin-authored, real and good writing | — | — | — | — | — |
| **"Talk it Over" AI-assist (✨ compose button)** | Helps the member phrase their own answer in their own voice | **Real AI feature**, but ⚠️ `assistTalk()` takes **no userId** and is **not consent-gated** — the one AI path in the whole backend that ignores `ai_opt_out` entirely and gets zero member context (`growth/service.ts:565-569`) | — | Either gate it consistently with every other AI touchpoint, or — since it never reads personal data anyway — explicitly document why it's exempt. Right now it's an inconsistency, not a decision. | S | Low (privacy hygiene) | Low |
| **Completion / celebration** | Fireworks animation, *"PLAN COMPLETE — '{n} days walking with God'" / "Well done, good and faithful servant." Matthew 25:23* | Client celebration on a real completion event; **backend returns zero message on plan/segment completion** — the celebration is entirely client-invented | — | — | — | — | — |
| **"You're behind" / catch-up messaging** | **Does not exist.** Only a passive grace line: *"grace covers missed days"* | Confirmed by exhaustive grep on both backend and both clients — zero hits for behind/catch-up/missed-day copy anywhere | `reading_plan_days.current_day` vs actual elapsed calendar days is trivially computable | Add ONE gentle nudge: a `plan_day_reminder`-style notification when a member is 3+ days behind their own pace, in the same "grace, not guilt" voice already used everywhere else in the app | M | High | Low |
| **Read with a Friend** | Real per-friend progress, invite flow, `nuru://join/{token}` deep link | **Genuinely real**, shipped feature (per project memory, R1 live 2026-07-20) | — | — | — | — | — |

---

## 4. CHAT (why 0 messages in 7 days)

| Screen / element | What the member sees today | Where it comes from | Data that exists but isn't used | Proposed improvement | Effort | Impact | Risk |
|---|---|---|---|---|---|---|---|
| **Entry point depth** | Chat is not a top-level tab on either app; it's a *segment* inside "You". The Nuru AI assistant is a *card inside that segment*, opened via `fullScreenCover`/route | Structural — both apps agree: **3 taps from launch, no cross-surface entry point** (Home/Pathway/Plans never link to it) | — | This is the single biggest lever on the 0-in-7-days number. Add a Home-surfaced entry (e.g. fold the AI into the existing "For You Today" hero, or a light-touch suggestion after a quiz-fail/next-action moment) | M (both apps) | High | Low |
| **AI card subtitle** | For a typical member: literally **"The AI assistant · 0 updates across 0 spaces"** (both apps, verbatim) | Client bug of framing — the subtitle describes the *chat inbox*, not the *AI* | — | Replace with something that describes capability, not inbox state, e.g. rotate through the same 4 suggestion strings already defined | S (both apps) | High | Low |
| **AI welcome message** | *"Hi, I'm Nuru ✨ your AI companion. I can summarize chats, draft an encouragement, surface prayer requests, or simply talk it through."* (iOS) / *"...I can help with Scripture, your pathway and prayer."* (Android — **different wording from iOS**) | Static, both apps, **not name-aware** ("Hi, I'm Nuru" never "Hi, Moses") | The backend's own companion grounding (`factsLine`) already knows the member's name/level/scores when consent is on | Personalize the welcome line the same way the Home greeting is personalized, and make iOS/Android copy identical | S (both apps) | Med | Low |
| **Suggestion chips** | *"Summarize my cell"*, *"Draft an encouragement"*, *"Find prayer requests"*, *"Plan my quiet time"* | Static, both apps, **worded for a leader/discipler, not an ordinary member** ("my cell" implies you lead one) | — | Rewrite for a member's actual first-use cases: *"Explain today's verse"*, *"Help me pray about..."*, *"What's next on my pathway?"* | S (both apps) | Med | Low |
| **Chips disappear after first message, forever** | Once history is non-empty, the suggestion chips never render again on either app | Client logic (`if (messages.isEmpty())`) | — | Keep a persistent "ask something else" affordance instead of an all-or-nothing gate | S (both apps) | Low | Low |
| **AI consent gate** | Only gates Prayer Points (hard block) and describes itself in Profile: *"Nuru remembers your journey... Your prayer journal is never read — ever."* | Real (`users.ai_opt_out`), but **the base assistant chat has no gate at all** — copy inconsistency, not the deterrent it might seem | — | See dedicated note below (contradiction between "never read" and Prayer Points explicitly reading Selah/prayers) | S | Med (trust) | Low |
| **Chat empty states** | *"No spaces yet."*, *"Connect with someone before starting a chat."*, single terse sentence, **no suggested action** | Static, both apps | — | Add one CTA per empty state (e.g. "Message your discipler" button directly in the empty DM list) | S (both apps) | Med | Low |
| **DM friction** | A member **cannot** message another member at all without an explicit connection-request/accept round trip | Real, deliberate design | — | Not a bug — flag only because it compounds the discoverability problem (Home never nudges toward *any* first message, DM or AI) | — | — | — |
| **Discipler channel** | *"Private between you and your assigned discipler."*, cta *"Open conversation"* | Real thread, resolved via 3-step pastor/discipler assignment logic; **zero opening/seed message** — a brand-new thread is just blank | — | A single system-authored opener ("Say hello to {discipler name} — they're here to walk with you") would remove the "what do I even say" barrier | S | Med | Low |
| **Pastoral channel** | Long, honest privacy disclosure (*"not end-to-end encrypted... the lock is a privacy screen on THIS device only"*) | Real, and admirably honest about its own limits | — | No change — this is a model for honest privacy copy, not a problem | — | — | — |
| **AI draft-a-reply (✨ in threads)** | *"NURU SUGGESTS"* / real AI-generated summary+draft grounded in the actual last 5 messages | **Genuinely real**, consent-independent (grounds only in the visible transcript, not personal data) | — | — | — | — | — |
| **Cell/Space chat** | Auto-created per cell, **zero welcome message, zero "send the first message" nudge** — deliberately, per a code comment | Real space, intentionally un-nudged | — | Given the 0-messages number, this deliberate choice is worth revisiting — even one system message ("Welcome to {cell} — say hi to your family") costs nothing and removes the "am I allowed to post first" hesitation | S | Med | Low |

---

## 5. GIVE

| Screen / element | What the member sees today | Where it comes from | Data that exists but isn't used | Proposed improvement | Effort | Impact | Risk |
|---|---|---|---|---|---|---|---|
| **Give screen framing** | *"Sow into the Kingdom" / "Generosity is worship — a quiet, joyful act."* | Static, identical for every member | `transactions` (full giving history) — queried in **zero** spiritual-surface code paths | — | — | — | — |
| **Confirmation / thank-you** | *"Thank you for your generosity"* — **the exact same string for a first KSh 100 gift and a 5-year monthly partner** | Static, both apps, confirmed byte-identical | Giving history, streak of consecutive months given, total lifetime giving — all sit unused in `transactions` | Add a *counted, honest* acknowledgement in the same spirit as "Your Walk" — e.g. "This is your 12th gift this year" — never an amount-based ranking, never comparison to others | M | Med | **Med — pastoral tone risk; needs product/pastoral sign-off, not just engineering, so giving never reads as transactional or performance-tracked** |
| **Receipt PDF** | Hardcoded 2 Corinthians 9:7 on every receipt, every gift, every member | Static template (`financial/statementPdf.ts`) | — | Fine as a fixed liturgical element — a receipt isn't the place for personalization | — | — | — |
| **Giving receipt notification** ⚠️ | **Never actually delivered.** Scheduled on the `email` channel; no email provider is bound in dispatch; falls to a logger | Confirmed bug, `workers/dispatch.ts:76-88` | — | Either wire a real transactional-email provider (needs a credential decision — see roadmap), or reroute this specific template to push+in-app immediately as a fast fix while email is set up properly | S (fast fix) / M (real email) | High (trust — money moved and nobody was thanked) | Low (fast fix) / needs external credential (real fix) |
| **Recurring giving** | Silent mechanical renewal; **no pre-charge reminder, no failure notice, no thank-you on renewal** | Confirmed — `financial/service.ts:609-653`, failures just increment a counter silently | — | At minimum: notify on failed recurring charge (a member's gift silently not going through, with no way to know, is a real gap) | M | Med | Low |
| **"Name your gift"** | *"Shows on the church's M-Pesa statement — like a Paybill account name."* | Static, clear, functional | — | — | — | — | — |

---

## 6. PROFILE

| Screen / element | What the member sees today | Where it comes from | Data that exists but isn't used | Proposed improvement | Effort | Impact | Risk |
|---|---|---|---|---|---|---|---|
| **Milestones (Android)** ⚠️ | **A hardcoded 3-item list**: Baptism (real), *"Level N · in progress — Keep going"*, *"Pathway completion — Your journey continues"* — the last two are the same for every member forever | Client-only, Android-specific (`ProfileScreen.kt:946-956`) — **iOS has no equivalent "Milestones" section**; iOS's journey lives in "Your Walk" on Pathway instead | `users.year_of_salvation`, `users.is_baptized`, `users.date_of_birth` — collected at onboarding, echoed back on `/me`, and used for **nothing else** | Either delete this static section on Android (Your Walk already covers it better) or make it real: spiritual birthday (`year_of_salvation`), actual baptism date, actual level-completion dates | S | Med | Low |
| **Badges** | Real award data, static frame (*"Badges celebrate your growth — not competition."*) | Real | — | Good tone already | — | — | — |
| **Growth scores** | Number + backend band word + trend | Real — see dedicated Progress Rating section | — | — | — | — | — |
| **Certificates** | Real, HMAC-signed, publicly verifiable | Real | — | — | — | — | — |
| **"Your Calling" / spiritual gifts** | Real assessment, real top-gifts result | Real (`gift_assessments`) — but the result is **never referenced anywhere else**: not in the greeting, not in next-action, not in serving-track nudges, even though `serving_tracks` matches are computed | `growth/service.ts:245-253` computes serving-track matches that are never surfaced anywhere | Add a next-action candidate: "You're gifted in {top gift} — {matching serving track} is looking for people" | M | Med | Low |
| **"Nuru Intelligence" consent copy** | *"Nuru remembers your journey to walk with you personally. Your prayer journal is never read — ever."* | Static, identical wording on both apps | — | See dedicated contradiction note below | S | Med (trust) | Low |
| **Member ID** ⚠️ | Android hardcodes `"-2026"` into the generated member-ID string | Client bug, cosmetic but will look wrong on 2027-01-01 | — | Derive the year, don't hardcode it | S | Low | Low |

---

## 7. NOTIFICATIONS / REMINDERS

This is where the audit found the most consequential, cheapest-to-fix problems.

| Template | Trigger / cadence | Copy actually shipped today | Fix |
|---|---|---|---|
| `reengage` | Leader engagement score in `watch`/`at_risk` band, hourly scan, 72h cooldown | **None** → renders as `"reengage"` on both apps (client has a local title-map override, but the *body* is still the raw template name in several paths) | Add real payload copy at the point of scheduling (`workers/nudgeScanner.ts:36-41`) |
| `badge_awarded` | Badge earned | **None** → `"badge awarded"` | Add `title`/`body` at `gamification/service.ts:88` |
| `level_completed` | Level ushered | **None** → `"level completed"` | Add copy at `workers/handlers.ts:71-77` |
| `level_ushered` ⚠️ | Discipler ushers a member forward | Payload has a real, warm message — *"Your discipler has ushered you into Level N"* — **under the key `message`, which `pushCopy()` never reads** (`levelAdvancement.ts:139` vs `dispatch.ts:33-38`). Renders as `"level ushered"`. | **One-line fix**: rename the payload key from `message` to `body` |
| `giving_receipt` | Gift settles | Scheduled with no copy, on a channel (`email`) with no provider bound → **never delivered at all** | See Give §5 |
| `connection_request_received/accepted/declined` | Chat connection lifecycle | **None** → `"connection request received"` etc. | Add copy |
| `space_join_requested/accepted/declined` | Space approval flow | **None** | Add copy |
| `plan_group_invite_*`, `plan_group_member_joined`, `plan_group_day_completed` | Reading-social events | **None** → underscored template names | Add copy |
| `sunday_letter` | Letter written, Sun 16:00 EAT | **None** → `"sunday letter"` (the letter itself is beautifully written; the *notification announcing it* is broken) | Add copy — this is a one-line fix with outsized emotional payoff |
| `event_reminder_24h/1h`, `event_low_rsvp` | RSVP'd event approaching / low turnout | **None** | Add copy |
| `reflection_approved/returned/deferred` | Discipler reviews a reflection | Uses the reviewer's own `feedback_notes` when present — **this one works correctly** as designed | — |
| `community_blessing` | First "amen"/heart/fire on your moment | *"You were celebrated 🎉" / "🙌 {moment title} — your church family sees it."* | Already good — model for the rest |
| `prayer_chain` | New prayer-wall post, every 15 min, up to 3 cell-mates | *"Stand with a friend in prayer" / "Someone in your family just shared a prayer need. Will you pray with them today?"* | Already good |
| `chat_dm_message` / `chat_discipler_message` / `chat_broadcast` | New message | Real sender name + preview | Already good |

**Structural root cause:** `notifications.template` is a bare string key with **no copy registry, no i18n table** — every call site is expected to remember to pass `title`/`body` inline, and roughly 15 of 25 forgot. This isn't 15 separate bugs; it's one missing abstraction. See roadmap.

**Cron/reminder inventory** (`worker.ts`): the schedule is rich (5s outbox drain, hourly reengage scan, nightly liturgy/story/streak jobs, Sunday letters, Saturday flock briefs, 15-min prayer chains) but **nothing is scheduled around an individual member's own habits** — no per-member "best time to reach you" (even though `interaction_events` has the data to learn one), no plan-day-specific reminder, no streak-at-risk push, no birthday, no giving reminder.

**Permission-request copy**: iOS fires the bare OS prompt with no pre-explainer screen. Android is worse — `POST_NOTIFICATIONS` is declared in the manifest but **never actually requested** by any launcher in the codebase, meaning push is silently off for any Android 13+ member who didn't get the one-time OS prompt on first launch. This is a real, mechanically-verified gap, not a guess.

---

## 8. PRAYER ROOM

| Tab | What the member sees | Source | Note |
|---|---|---|---|
| **Private** (journal) | Free-form user entries, real streak/rhythm stats | 100% user-authored, no generated content | Working as intended |
| **Corporate** (Prayer Wall) | Free-form posts, congregation-scoped, real prayer counts | 100% user-authored | Working as intended. Note: there is **no separate "corporate prayer" content table** — no liturgy-of-the-hours list, no church-authored prayer points; "Corporate" just means "the wall," which is accurate but the tab label could be read as implying curated content |
| **Selah** | Free-form rich-text + pen journal | 100% user-authored, explicitly no leader/admin read path | Working as intended |
| **Prayer Points** | AI-distilled 3-8 short prayer points from the member's own Selah + private prayers + wall posts | **Real AI feature**, consent-gated, grounded only in the member's own words, explicitly told never to invent a concern not present in the material | Working as intended — the best-designed AI feature in the app |
| **⚠️ Copy contradiction** | Profile promises *"Your prayer journal is never read — ever"*; one screen later, the Prayer Points gather card says *"Nuru reads across your own Selah thoughts, **private prayers**, and things you've shared to the wall"* | Both strings verbatim, both apps | A careful member will notice this is a direct contradiction. Fix: **reword the Profile promise** to something true — e.g. "Your prayer journal is never read by another person — only you can see it, and Nuru only reads it if you turn this on to help you pray" | S | Med (trust) | Low |

---

## Progress rating — is it intelligent?

**Short answer: the math is legitimately good; the presentation and plumbing around it are not yet trustworthy.**

### What it actually computes (confirmed by direct code read, not the researcher's summary)

```
overall = 0.25×habits + 0.25×curriculum + 0.20×attendance + 0.15×word + 0.15×prayer
```
(`scores/service.ts:20-22`) — every domain is itself a **consistency × depth** blend over a rolling 28-day window, not a raw completion count:

- **Word** = 45% consistency (active days / 20) + 40% memorization mastery + 15% breadth of verses attempted
- **Prayer** = 60% consistency + 40% depth (volume + answered-rate)
- **Habits** = 60% consistency + 40% completeness of daily rhythm ticks
- **Curriculum** = completion %, blended with quiz-mastery % once any exists (65/35)
- **Attendance** = any day with app activity, capped at 20/28 days — **this is "app presence," not gathering attendance**, and the code comment itself flags this as a judgment call, not a bug

Bands: `Deeply rooted (80+) / Growing (60+) / Sprouting (35+) / Just beginning`. This is a genuinely non-competitive, formative vocabulary — good, keep it.

**AI never touches the number.** Every score is pure SQL/TypeScript arithmetic; the AI layer only ever *reads* the score to write prose (the greeting, the letter) around it. This is the correct architecture per the spec's server-authoritative rule, and nothing in this audit found a violation of it.

### Three integrity problems, none of them about the formula itself

1. **Two scoring systems can disagree.** The member-facing `ScoresService` (5 domains, 28d window, `Deeply rooted/Growing/Sprouting/Just beginning`) is what the member sees on Home/Pathway/Profile. A **separate** `EngagementService` (3 factors — habits/curriculum/attendance only, 30d window, `thriving/steady/watch/at_risk`) drives the `reengage` push notification. A member could see "Growing" on their own screen while quietly being scored `at_risk` by the system that decides whether to nudge them — and never know it. **Fix:** either merge into one scoring engine with two views (member-facing vs leader-facing), or explicitly document why they must differ and make sure the member-visible number and the nudge-triggering number can never contradict each other in a way the member would notice.

2. **Two different numbers both render as a bare "X%" in the same app.** The Home mini-ring shows `growthScore%` (the composite score). The Pathway header shows `completedModules/totalModules` as a percentage. These are answering two different questions ("how is my walk overall" vs "how much of this level is done") but look identical on screen. **Fix:** never show a bare, unlabeled "%" — always pair it with a unit word (score vs. modules) the way the Profile score cards already do correctly.

3. **"Attendance" is a stretch of the word.** It currently means "opened the app that day," not "was physically or spiritually present" in a way a discipler or the member would recognize as attendance. This is an honesty issue more than a technical one — the code comment already admits it's "the owner's call." **Fix:** either rename the domain label (e.g. "Presence") in member-facing copy, or fold real `attendance_logs` (cell check-ins) into it so the name matches the meaning.

### What "honest, motivating, consistent" would look like concretely

- **Honest:** never inflate — already true (pure arithmetic, no AI). Keep it that way; treat "AI must never write to a score column" as a standing invariant worth a test, not just a convention.
- **Motivating:** the `nextAction` weakest-domain cards already point at the *next real step* ("Grow in prayer" → opens the prayer journal) — this is the right pattern; extend it to reference the member's name and, where relevant, their spiritual gifts / serving-track match (currently unused, §Profile).
- **Consistent across all three surfaces:** iOS and Android already render the same 5 score bars with the same band words — good. The inconsistency is *within* each app (score% vs completion% both bare), not *between* the apps.

---

## Personalization data that exists but is unused anywhere

| Data | Where it lives | Currently used by | The gap |
|---|---|---|---|
| `users.year_of_salvation` | onboarding | only echoed on `/me` | No spiritual-birthday moment — the one occasion the whole app is built around |
| `users.date_of_birth` | onboarding | `is_minor` flag only | No birthday greeting |
| `transactions` (giving history) | financial module | finance/statement reads only | Zero references in Home, Intelligence, Notifications, or Scores — a faithful monthly giver gets no acknowledgement anywhere in the spiritual surfaces of the app |
| `gift_assessments.top_gifts` + `serving_tracks` matches | growth module | the Gifts screen only | Never feeds next-action, greeting, or a serving nudge |
| `saved_verses` | growth module | the "My Verses" list only | Never feeds verse-of-the-day selection or assistant grounding |
| `mentor_notes` / next-meeting date | growth-content module | the Discipleship Hub screen only | "Your discipler meets you Thursday" doesn't exist on Home or Pathway's wait-state |
| `app_screen_events` (per-screen dwell time) | activity module | **nothing reads this table anywhere** | Pure write-only telemetry today |
| `user_streaks.longest_streak_days` | gamification | achievements list only | Never celebrated as its own moment |
| `module_reflections.body` | assessment module | 220-char excerpts feed the AI's private "member story" only | The richest first-person text in the whole system; never used for verse-of-the-day mood (which reads prayers only) or next-action |
| `notification_preferences` | identity module | quiet-hours only | No learned "best time to reach this member" despite `interaction_events` having enough data to derive one |

---

## Parity — where iOS and Android members see genuinely different things

| # | Gap | Evidence | Confidence |
|---|---|---|---|
| P1 | **"Send this verse into chat" does not exist on Android.** iOS's verse-share sheet offers "Share as a picture" / "Send in chat" (the latter posts directly into a real conversation); Android only opens the OS share sheet. iOS's featured-video card also has a share-to-chat path Android lacks entirely. | iOS `Features/Home/ShareToChatSheet.swift`; no equivalent symbol anywhere in the Android tree | High |
| P2 | **Cohort "Discussions" board is missing on Android entirely.** iOS has a routed, functional `DiscussionsView` (pinned threads, compose, comments, offline queue) reachable from Grow; Android's Community hub only lists Prayer Room / Messages / Events / Announcements / Live radio — no Discussions concept at all. | iOS `Features/Community/DiscussionsView.swift`, `GrowView.swift:61`; zero Android hits | High |
| P3 | **Android never requests notification permission in-app.** `POST_NOTIFICATIONS` is declared in the manifest but no `RequestPermission` launcher exists anywhere in the codebase — push is silently off for any Android 13+ member who dismissed or never saw the one-time OS prompt. iOS has an explicit (if unexplained) authorization prompt. | Manifest declares it; grep for permission launchers returns none for notifications | High (mechanically verified) |
| P4 | Both apps ship all 4 Prayer Room tabs, matching Talk-it-Over/Read-with-a-Friend, matching score/badge/certificate surfaces, matching Selah rich editor + ink drawing | — | No gap |
| P5 | Android's Profile has a static "Milestones" 3-item list; iOS has no equivalent section (iOS's journey lives entirely in "Your Walk" on Pathway) — this is a **structural** difference in where the journey concept lives, not just wording | §6 Profile row above | High |
| P6 | Android is ahead on in-thread voice notes (a documented Android→iOS backport per `docs/PARITY_AUDIT.md`) | project history | No gap, informational |

---

## Prioritized roadmap — smallest change, biggest human impact, first

Ordered by (impact ÷ effort), not by dependency order. Each entry names the exact files that change per surface, and flags anything needing a migration, OpenAPI change, or dual-client work.

### Tier 0 — backend-only, sub-day fixes, no client release needed

1. **Fix the `level_ushered` payload key bug.** `packages/backend/src/modules/assessment/levelAdvancement.ts:131-141` — rename `message:` to `body:` in the payload so `pushCopy()` (`workers/dispatch.ts:30-40`) actually reads it. **1 line. No migration, no OpenAPI change, no client change.**
2. **Fill in `title`/`body` for every notification template currently shipping bare.** Files: `packages/backend/src/modules/gamification/service.ts:88`, `packages/backend/src/workers/handlers.ts:51-85`, `modules/chat/connections.ts:111,122,176,191`, `modules/chat/service.ts:1674,1735`, `modules/reading-social/groups.ts:192,307,346`, `modules/reading-social/invites.ts:134,259`, `modules/live/service.ts:390,399,1354`, `modules/intelligence/letters.ts:106-112` (Sunday Letter announcement). No schema change — payload is already a JSON column. No client change (clients already render `payload.title`/`.body` when present).
3. **Reroute `giving_receipt` off the dead email channel** to `push` + rely on the existing in-app receipt, as a fast fix. Files: `packages/backend/src/workers/handlers.ts:79-85`. A proper transactional-email provider (e.g. Postmark/SES) is a separate, larger piece of work that needs a credential decision from the owner — flag it, don't block the fast fix on it.
4. **Rewrite the two contradictory AI-consent strings** ("prayer journal is never read — ever" vs. Prayer Points explicitly reading it). This is copy-only but touches both clients: iOS `Features/Profile/ProfileView.swift:473`, `Features/Community/PrayerPointsView.swift:85`; Android `feature/profile/ProfileScreen.kt:1224`, `feature/community/PrayerPointsScreen.kt`. Small client release, no backend change.

### Tier 1 — one client-side release per app, no backend change

5. **Fix the AI card subtitle** ("0 updates across 0 spaces"). iOS `ChatView.swift:536`; Android `ChatScreen.kt:588-603`. Replace with capability copy.
6. **Rewrite the AI suggestion chips and welcome message** to be member-appropriate, not leader-flavored, and make iOS/Android identical. iOS `NuruAssistantView.swift:37-50`; Android `AssistantScreen.kt:140-145`, `:79-83`.
7. **Fix the Level-Detail duplicate-verse bug.** iOS `LevelDetailView.swift:139-144` (confirm/fix Android equivalent too).
8. **Android: request `POST_NOTIFICATIONS` properly**, with a one-line rationale, on first relevant screen. `AndroidManifest.xml` already declares it; add the runtime request.

### Tier 2 — cross-surface feature work (backend + both clients)

9. **Surface the AI assistant from Home**, not just three taps deep inside Chat. Needs a small backend decision (what triggers the suggestion) + both client changes. This is the single highest-leverage move on the 0-messages-in-7-days number.
10. **Add a gentle "you're a few days behind on {plan}" nudge.** New backend trigger (reuse the existing grace-first tone already established everywhere else), new notification template with real copy from day one, no client change needed beyond existing notification rendering.
11. **Reconcile the two scoring systems** (`ScoresService` vs `EngagementService`) so the number a member sees and the number that decides whether they get nudged can't silently disagree. Backend-only, but touches the `reengage` trigger and possibly the leader-facing portal cohort views — coordinate with whoever owns the portal engagement dashboards before changing the leader-facing formula.
12. **Distinguish score% from completion% visually** everywhere both currently render as a bare "%". Both clients, small change, no backend change (the data already carries a unit — clients just aren't using it).

### Tier 3 — larger, needs product/pastoral judgment before engineering starts

13. **Use giving history for an honest, non-transactional acknowledgement.** Needs pastoral sign-off on tone before any code — the wrong version of this reads as "we're tracking how much you give," which would be a real trust regression, not an improvement.
14. **Close the Android parity gaps** (send-to-chat verse share, Discussions board) — or, if Discussions is intentionally being retired, remove it from iOS instead of building it on Android. Needs a product decision on which direction parity should go, not just an engineering ticket.
15. **Build a copy/template registry for notifications** so "forgot to pass title/body" becomes structurally impossible instead of a recurring bug class. Backend-only but touches the `notifications` table shape — likely wants a migration (adding a resolved-copy column or a lookup table) and would be the permanent fix behind the Tier-0 patch in item 2.

---

## The five things I would do first, given one day

1. **Fix the `level_ushered` payload-key bug** (`levelAdvancement.ts:139`) — one line, and it's the single most emotionally significant moment in the app (a member being ushered into a new level) currently rendering as the literal string "level ushered."
2. **Fill in real copy for the ~15 bare notification templates**, starting with `badge_awarded`, `level_completed`, `sunday_letter`, and `reengage` — these fire constantly and are currently self-sabotaging.
3. **Reroute `giving_receipt` to push instead of the dead email channel** — money moved and, right now, nobody is actually thanked for it outside the in-app screen.
4. **Rewrite the AI chat card subtitle and welcome/suggestion copy** on both apps — the cheapest, highest-confidence lever on "why does nobody message the AI."
5. **Fix the two contradictory "your prayer journal is never read" strings** — a small, fast trust fix before a member notices the contradiction themselves.
