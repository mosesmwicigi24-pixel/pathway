# Curriculum Architecture — the canonical model

**Status: ADOPTED 2026-07-18.** This document is the outcome of the three-surface audit
(backend tables/endpoints, web portal pages, native screens) and governs the CMS
re-architecture. It replaces the five-page CMS (Curriculum Levels, CMS Curriculum,
Level Detail, Level Quiz Builder, Video Library) with two workspaces on one canonical
backend model. Nothing here changes the member-facing wire contract.

---

## 1. What the audit found (why we are doing this)

**Same numbers, different answers.** Published-module counts are computed in six
independent SQL sites; completion % has four different formulas; certificate counts
five sites. On the web portal the same level shows *learner completion* on one page and
*module-publish ratio* on another, in identical-looking progress bars. Natively, the
"Level Detail" sidebar entry renders a verbatim duplicate of the CMS page.

**Same entity, many editors.** The level pass mark is writable from three surfaces
through two endpoints (`updateLevel` and `updateLevelExam` both write
`required_exam_pass_mark` — clobber risk). Module creation happens from three pages.
An exit-exam question bank is editable from two mounted editors at once.

**Video attachment is three disjoint mechanisms.** `modules.media_asset_id` (single FK,
one asset can "own" only one module), the legacy free-text `modules.video_url` /
`audio_url` columns, and the loose `media_assets.level_number` library tag. Web attaches
by module FK; native tags by level only and types raw URLs into modules. The media
library even reverse-writes `modules.title`.

**Two competing advancement workflows** both write `enrollments.current_level`:
the current exam→pending→discipler-usher path, and a legacy reflection-approve path
that advances directly and issues the certificate.

**What is already right (do not rebuild):** the per-module quiz config, the
`question_bank` model, immutable `module_versions`, the centralized gating predicate
(`progress/gating.ts` — the single §1.9 enforcement point), the level lifecycle columns
(`status`, `locked`, `exam_status`), and the media transcode/signed-URL pipeline.

---

## 2. Canonical entity model

```
Curriculum                    ← NEW root (curricula table; one seeded row today)
 └─ Level (level_number)      ← existing; gains curriculum_id FK
     └─ Module (module_id)    ← existing
         ├─ Content pages     ← derived projection (see §2.3)
         ├─ Media placements  ← NEW (media_placements table)
         ├─ Quiz              ← existing per-module config + question_bank
         └─ Reflection        ← existing module_reflections
 Level exit exam              ← existing (evaluation_kind='exit_exam' module)
 Video Asset                  ← existing media_assets; placed, never duplicated
```

### 2.1 Curriculum root
New `curricula` table (`curriculum_id UUID PK, slug UNIQUE, title, created_at`), one
seeded row `discipleship-pathway`. `levels.curriculum_id` is added NOT NULL DEFAULT that
row. **`level_number` remains the PK and every existing FK is untouched** — the root is
additive so future curricula are possible without re-keying the world.

### 2.2 Media placements — one asset, many placements
New table:

```sql
media_placements (
  placement_id   UUID PK,
  media_asset_id UUID NOT NULL REFERENCES media_assets,
  module_id      UUID NOT NULL REFERENCES modules,
  position       INT  NOT NULL DEFAULT 0,   -- order within the module
  required       BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (media_asset_id, module_id)
)
```

- The **level is always inferred from the module** — never asked for twice, never stored.
- Backfill: every current `modules.media_asset_id` becomes a placement row.
- `modules.media_asset_id` **stays as a derived cache** of the module's primary
  (lowest-position) placement, maintained by placement CRUD — this is what keeps the
  member `/modules/:id` read path byte-identical. Placements are authoritative;
  the column is a mirror.
- Manifest gating (§1.9) becomes: *the asset is available iff ANY of its placements'
  modules is unlocked for this member* (through the existing shared predicate). This is
  strictly correct for shared assets and can never expose content the member hasn't
  legitimately unlocked.
- `media_assets.level_number` is demoted to a library display tag (derived from
  placements at read time where present); UIs stop writing it as an "attachment".
- The media library **stops reverse-writing `modules.title`**.
- Homepage/event/announcement video attachment mechanisms are unchanged in this phase
  (they are not curriculum placements); a uniform `target` enum is a possible future.

### 2.3 Content pages (deliberate deviation, recorded honestly)
The target model names "Content Blocks" as rows. We keep the shipped design: the module
body is one markdown column, split into **titled sections at read time** on
`<!-- page-break -->` markers, served as `content_pages[]`. The *entity exists at the
API level*; the storage stays a single versioned column. Rationale: the member apps
already render this shape, `module_versions` history stays trivially correct, and a
block-table migration is all risk and no user-visible gain today. Revisit only when
block-level media embedding inside a page is needed.

### 2.4 One advancement writer
`enrollments.current_level` is written by exactly one workflow: the **discipler-usher
path** (`assessment/levelAdvancement.ts`). The legacy reflection-approve side effect
(direct advancement + certificate issue from `reflection.ts`) is removed; approving a
reflection now only records the decision. Certificate issuance rides the advancement.
Admin placement (`adminops` enrollment start) remains as the explicit admin override.

### 2.5 One editor per entity
- Module content/metadata: `AdminCurriculumService.updateModule` only. The legacy
  `CurriculumService.editModule` path is deleted.
- Level pass mark + exam settings: **`updateLevelExam` only.** `updateLevel` no longer
  accepts `required_exam_pass_mark`.
- Questions: one editor component per surface, always launched with module context.

---

## 3. One stats source

New `curriculum/stats.ts` owns the aggregate SQL. Everything reads it:

- **`GET /admin/curriculum/summary`** — the Curriculum Dashboard payload in one call:
  - totals: levels by status (published/draft/in_review/archived-none), modules by
    status, modules missing video / missing quiz / missing content, learners active,
    avg completion (ONE formula: distinct completed published-module rows ÷
    (learners × published modules)), avg quiz score, certificates issued, badges
    configured, reflection queue depth, level reviews waiting, video assets
    attached/unattached.
  - per-level summary cards: title/theme/color/status/locked, published+draft modules,
    quiz status (exam exists? published? question count), videos attached, estimated
    duration, learners, completion, certificates, last_updated, validation status.
  - pipeline counts (drafts / in review / locked / live).
- **`GET /admin/curriculum/validate`** — the completeness report: published module with
  empty content; quiz-kind module with zero active questions; published level with zero
  published modules; missing/unpublished exit exam; placement pointing at archived
  module/asset; module marked required with no evaluation. Each issue carries
  `{severity, level_number, module_id?, code, message}`.
- **`GET /admin/curriculum/activity`** — audit-log slice classified server-side:
  `published | edited | review | video | quiz | module | milestone`.
- `adminops levelsReport` delegates its per-level numbers to the same stats layer
  (the report endpoint stays for the dashboards already consuming it).

---

## 4. Admin API surface (delta only — module/level CRUD is already right)

| New | Purpose |
|---|---|
| `GET /admin/curriculum/summary` | dashboard, one call |
| `GET /admin/curriculum/validate` | validation report |
| `GET /admin/curriculum/activity` | classified activity |
| `GET /admin/modules/:id/media` | placements of a module |
| `POST /admin/media/:id/placements` `{module_id, position?, required?}` | place an asset |
| `DELETE /admin/media/placements/:placementId` | remove a placement |

| Changed | How |
|---|---|
| `PUT /admin/levels/:n` | drops `required_exam_pass_mark` (exam endpoint owns it) |
| `GET /admin/media` rows | gain `placements: [{module_id, module_title, level_number}]` |
| reflection decision | no longer advances level / issues certificate |

| Removed | Why |
|---|---|
| `CurriculumService.editModule` legacy path | duplicate editor |
| media→`modules.title` reverse-write | title has one owner |

**Member-facing routes: zero changes.** `/levels`, `/me/pathway`, `/levels/:n/modules`,
`/modules/:id` (+engagement/complete/quiz/exam/reflection), `/media/:id/manifest`,
certificates — all byte-compatible. Gating continues to flow through the single
predicate in `progress/gating.ts`.

---

## 5. The two workspaces (web + native, same information architecture)

### 5.1 Curriculum Dashboard (replaces Curriculum Levels + CMS Curriculum)
Answers: *is the curriculum healthy, what needs attention, what do I work on next?*
- **Curriculum Health** — the summary grid from `/admin/curriculum/summary` (levels by
  status, modules by status, missing video/quiz/content, reflection queue, reviews
  waiting, certificates, badges, assets attached/unattached, avg completion, avg quiz
  score). Every count is a link.
- **Pipeline** — the Draft / In Review / Locked / Live strip, kept, now **clickable**:
  each tile filters the level cards below.
- **Needs attention** — the validation report, ranked.
- **Activity** — classified (Recently Published, Recently Edited, Pending Review,
  Videos, Quiz changes, Module changes, Learner milestones), not a flat feed.
- **Quick actions by workflow** — Create (New Level / New Module / New Quiz / Upload
  Video / Register External) · Manage (Reflection Queue / Reviews / Learners /
  Certificates) · Utilities (Refresh Analytics / Validate Curriculum).
- **Analytics** — expandable sections (learners by level, completion, enrolment trend,
  module distribution, video engagement, quiz performance, content completeness) —
  collapsed by default, no chart wall.
- **Level summary cards** — status, published/draft modules, quiz status, videos
  attached, est. duration, learners, completion, certificates, last updated, validation
  badge — and **one Open button** into the workspace. All other actions live inside.

### 5.2 Levels & Modules Workspace (replaces Level Detail)
- Left tree: levels expand to modules; search, collapse/expand, drag-reorder,
  add/duplicate/archive, bulk publish.
- Right: the **sectioned module editor** — one module, sections not pages:
  Overview · Content · Media · Quiz · Resources · Reflection · Publishing · Analytics.
  Collapsible cards inside sections (Basics, Objectives, Scripture, Tags, Media,
  Quiz, Publishing/Visibility, Version History).
- **Quiz is a section, not a place.** The question-bank editor mounts inside
  Module → Quiz with context already known; the Level exit exam is reached from the
  level node (Level → Final Assessment). The standalone Quiz Builder page becomes a
  context-aware specialized editor (`?level=n` / `?module=id`) launched from the
  workspace — it never asks the admin to re-select what the click already knew.
  The exam publish/review state is surfaced in the workspace level header, not hidden
  in the builder.
- **Media section** = the module's placements: pick from the Video Library, reorder,
  mark required; the same asset may be placed in many modules — never duplicated.

### 5.3 Video Library (kept, placement-aware)
- Attach panel: **Module picker (level inferred and shown, never asked)**; an asset
  lists ALL its placements; detaching removes one placement, not the asset.
- Metadata drawer: video, placements (level·module), duration, presenter/caption,
  thumbnail, visibility/publication, download/streaming policy where supported.

### 5.4 Navigation (target)
Web sidebar: **Curriculum Dashboard · Levels & Modules · Video Library · Content
Studio** (Quiz Builder reachable, context-aware; old routes 301 into the new ones).
Native `Section` enum: `.curriculum` (dashboard) + workspace drill-in; the duplicate
`.levelDetail` entry is deleted; `.cms`/`.curriculumLevels` collapse into `.curriculum`.

---

## 6. Migration & compatibility plan

1. **Additive migrations first**: `curricula` + `levels.curriculum_id`,
   `media_placements` + backfill from `modules.media_asset_id`. Forward-only, no
   destructive change; legacy columns stay as derived mirrors.
2. **Backend behavior changes** land with tests: placement CRUD maintaining the mirror
   column, manifest any-placement gating, single advancement writer, `updateLevel`
   dropping the pass-mark field, legacy edit path removed.
3. **Frontends swap** to `/admin/curriculum/summary` and the two workspaces; old pages
   deleted, old routes redirected. Web and native ship the same information
   architecture (desk-adaptive on Mac/iPad).
4. **Member apps: nothing to do.** No member endpoint changes shape; gating unchanged.
5. PARITY.md gains a "Curriculum workspaces" section; the five-page rows are retired.
