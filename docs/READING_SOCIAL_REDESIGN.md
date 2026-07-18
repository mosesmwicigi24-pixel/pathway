# Reading, Social & Polish Epic — Owner Specification (2026-07-19)

Canonical brief. Phases in READING_SOCIAL_PLAN.md (from the R0 design phase).

## 1. Chat reliability — root-cause pipeline audit (DB→API→state→cache→UI). First bug found+fixed 2026-07-19 (migration collision). Standing rule: every future phase re-verifies conversation loading end-to-end.
## 2. Chat nav labels — My Space · Chats · My Disciple · My Pastor (structure exists; align naming; tabs render even when empty, built to expand).
## 3. Read with a Friend — rival/surpass YouVersion: search friends, invite to a plan, accept/decline, active shared plans, who joined, per-participant progress (days/chapters done), progress notifications. Collaborative feel throughout.
## 4. Shared notes per plan — personal notes, share with friends, comments, replies, likes/reactions, @mentions, questions + answers inside a study. Discussion/accountability/discipleship over solo reading.
## 5. Highlighting — YouVersion-class: highlight any plan text, multiple colors, permanent, edit/remove, filter by color, optional share, notes attached to highlights. Clean + fast.
## 6. Invitations — replace text-only: deep link opening the plan (installed) or store-then-plan (not installed); designed invite image; rich preview card (title/cover/description/author/days/message); optional QR; WhatsApp + social share; copy link. Polished and compelling.
## 7. Typography — ONE global system (families/sizes/weights/line-heights/letter-spacing/heading hierarchy) inherited everywhere; kill per-component font definitions. (Screens showing drift: Celebrate the Family, Reading Plan, My Prayer Room cards.)
## 8. Card design — audit every feature card: layout, padding, margins, alignment, type, image placement, icons, shadows, radius, hierarchy, spacing. Modern, cohesive.
## 9. Design-system audit — fonts/colors/icons/buttons/cards/inputs/lists/empty/loading/error states/spacing/component reuse/responsiveness → consolidated tokens + reusable components; no duplicate one-off styling.

Objective: seamless collaborative reading + reliable chat + rich invitations + visually consistent app. Keep refining beyond the reported issues until polished, scalable, production-ready.
