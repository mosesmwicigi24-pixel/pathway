# Level 1 — Foundations of Faith: content + quizzes

Source of truth: **"The Nuru Discipleship Pathway Classes — Full Curriculum, Level 1:
Foundations of Faith"** (the church's own PDF). Every module body and every quiz
question here is drawn **solely** from that document — no external content.

- **Modules 1–6** (God & His Nature → The Fellowship): full lesson content +
  **10 multiple-choice questions each**. Questions progress from basic recall to
  deeper comprehension; 4 options, one correct, three plausible text-grounded
  distractors; difficulty 1→5.
- **Module 7** (The Holy Spirit & Empowerment Pt 1): lesson + quiz **re-authored by
  the pastoral team** and applied directly to production; exported back from prod
  2026-08-02 (supersedes the original PDF-derived set).
- **Module 8**: full teaching content supplied by the pastoral team (was
  outline-only); read-and-complete lesson, no quiz.
- **Modules 9–10**: full teaching content + 10-question quizzes supplied by the
  pastoral team and applied directly to production (were outline-only, no quiz);
  exported back from prod 2026-08-02.
- The Level 1 exit exam is sequenced after the 10 modules.

Files:
- `q_1.json … q_7.json`, `q_9.json`, `q_10.json` — the questions per module
  (legacy authoring shape; 7/9/10 regenerated from the prod export).
- `gen-sql.mjs` — the original generator (module 1–6 sections only now; see its
  header note). Do **not** rerun it wholesale — modules 7–10 in `seed-level1.sql`
  have been hand-synced since.
- `seed-level1.sql` — the idempotent SQL, kept in lock-step with production
  (fingerprint-verified per module: md5 of lesson body + md5-set of question texts).

Re-apply (idempotent):
`docker exec -i pathway-postgres-1 psql -U nuru -d nuru -v ON_ERROR_STOP=1 < seed-level1.sql`
