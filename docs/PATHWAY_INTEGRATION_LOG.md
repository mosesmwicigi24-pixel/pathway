# Pathway end-to-end integration — change log

Senior UI/UX + full-stack pass to make all mobile content dynamic (DB-backed),
integrate every backend feature, fix keyboard handling, and polish Pathway UX.
Scope approved: **P1–P5** (mobile binds, keyboard, UX, CMS authoring, backend).

## Audit summary (before changes)
- ~26/32 mobile screens already bound to real data; events/calendar/announcements/
  chat/DMs/media/discussions all live.
- Hardcoded-but-API-exists: `LevelScreen` MENTOR/LEVEL_VERSE/fake-announcements,
  Home discipler card.
- No CMS authoring for growth content (devotionals/memory-verses/reading-plans/
  resources) — `GrowthAdminApi` existed, imported by zero pages.
- Pathway trail "encouragements" fabricated client-side (no backend).
- Keyboard avoidance missing: NuruAssistant, Thread, Giving sheet, MemoryVerse
  (HIGH); Quiz, Module, Reflection, Devotional (MED).

## Phases
- **P5 (backend):** `level_encouragements` table + member read + Admin CRUD.
- **P1+P2+P3 (mobile):** bind mentor/verse/announcement, consume encouragements,
  shared keyboard-inset hook applied app-wide, Pathway UX polish.
- **P4 (admin-web):** CMS pages for growth content + level encouragements editor.

---

## Changes

### P5 — backend: level encouragements (CMS-managed Pathway trail content)
- migration `1758000000053_level-encouragements.sql` — new `level_encouragements`
  table (level_number, after_module_sequence, kind, title, body, image_url,
  scripture_ref, emoji, is_active, sort_order).
- new module `packages/backend/src/modules/encouragements/` — member read
  `GET /levels/:n/encouragements` + Admin CRUD under `/admin/levels/:n/encouragements`.
