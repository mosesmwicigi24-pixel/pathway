// One stats source (docs/CURRICULUM_ARCHITECTURE.md §3): /admin/curriculum/
// summary | validate | activity, plus the §2.5 one-editor-per-entity rule for
// the level pass mark (updateLevelExam owns it; updateLevel rejects it).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { agent, bearer } from "./helpers/app.js";
import { createCongregation, createUser, createEnrollment, createModule, addQuestion } from "./helpers/factories.js";

let cong: string, adminTok: string, studentTok: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  const admin = await createUser({ congregationId: cong, role: "Admin", email: "admin@dev.local" });
  const student = await createUser({ congregationId: cong, role: "Student", email: "s@dev.local" });
  adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
  studentTok = bearer({ sub: student.user_id, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

const auth = (t: string) => ({ Authorization: t });

describe("GET /admin/curriculum/summary (§3 — one call, one formula)", () => {
  it("returns totals + per-level cards + pipeline, consistent with /admin/levels", async () => {
    // Two published L1 modules (one with a passing quiz bank) + one L2 draft.
    const m1 = await createModule(1, 1);
    await addQuestion(m1, "A");
    await createModule(1, 2);
    await createModule(2, 1, { published: false });

    const res = await agent().get("/v1/admin/curriculum/summary").set(auth(adminTok));
    expect(res.status).toBe(200);
    const { totals, levels, pipeline } = res.body;

    // Consistency canary: the summary's published-module count equals the sum
    // /admin/levels reports per level (the counts used to disagree — §1 audit).
    const adminLevels = await agent().get("/v1/admin/levels").set(auth(adminTok));
    const publishedFromLevels = adminLevels.body.data.reduce(
      (acc: number, l: { published_count: string | number }) => acc + Number(l.published_count),
      0,
    );
    expect(totals.modules.published).toBe(publishedFromLevels);
    expect(totals.modules.published).toBe(2);
    expect(totals.modules.draft).toBe(1);

    // Per-level card for L1: counts, quiz block, validation badge shape.
    expect(Array.isArray(levels)).toBe(true);
    expect(levels.length).toBe(6); // 6 seeded levels
    const l1 = levels.find((l: { level_number: number }) => l.level_number === 1);
    expect(l1.modules_published).toBe(2);
    expect(l1.quiz).toMatchObject({ exam_published: true });
    expect(typeof l1.quiz.question_count).toBe("number");
    expect(l1).toHaveProperty("videos_attached");
    expect(l1).toHaveProperty("learners");
    expect(l1).toHaveProperty("completion_pct");
    expect(l1).toHaveProperty("certificates");
    expect(l1).toHaveProperty("last_updated");
    expect(["ok", "warnings", "errors"]).toContain(l1.validation.status);

    // Pipeline: the seeded levels are all published → live.
    expect(pipeline).toMatchObject({ drafts: 0, in_review: 0 });
    expect(pipeline.live).toBe(6);

    // Totals carry the whole health grid.
    for (const key of [
      "modules_missing_video",
      "modules_missing_quiz",
      "modules_missing_content",
      "learners_active",
      "avg_completion_pct",
      "certificates_issued",
      "badges_configured",
      "reflection_queue",
      "level_reviews_waiting",
    ]) {
      expect(totals).toHaveProperty(key);
    }
    expect(totals.video_assets).toHaveProperty("attached");
    expect(totals.video_assets).toHaveProperty("unattached");
  });

  it("denies non-admins (RBAC §5.4)", async () => {
    for (const path of ["summary", "validate", "activity"]) {
      const res = await agent().get(`/v1/admin/curriculum/${path}`).set(auth(studentTok));
      expect(res.status).toBe(403);
    }
  });
});

describe("GET /admin/curriculum/validate (§3 — completeness report)", () => {
  it("flags a published module with empty content and a quiz module with zero active questions", async () => {
    // Broken on purpose: published + whitespace-only content, quiz kind, no questions.
    const { rows } = await testPool().query<{ module_id: string }>(
      `INSERT INTO modules (level_number, module_sequence_number, title, lesson_content, status, evaluation_kind)
       VALUES (1, 1, 'Broken Lesson', '   ', 'published', 'quiz') RETURNING module_id`,
    );
    const broken = rows[0]!.module_id;

    const res = await agent().get("/v1/admin/curriculum/validate").set(auth(adminTok));
    expect(res.status).toBe(200);
    const issues = res.body.data as Array<{
      severity: string;
      level_number: number;
      module_id: string | null;
      code: string;
      message: string;
    }>;

    const empty = issues.find((i) => i.code === "module_empty_content");
    expect(empty).toMatchObject({ severity: "error", level_number: 1, module_id: broken });
    const noQuiz = issues.find((i) => i.code === "quiz_no_questions");
    expect(noQuiz).toMatchObject({ severity: "error", level_number: 1, module_id: broken });

    // Published levels with no published modules are flagged too (L2..L6 here).
    expect(issues.some((i) => i.code === "level_no_published_modules" && i.level_number === 2)).toBe(true);
    // Every issue carries the contract shape.
    for (const i of issues) {
      expect(["error", "warning", "info"]).toContain(i.severity);
      expect(typeof i.level_number).toBe("number");
      expect(typeof i.code).toBe("string");
      expect(typeof i.message).toBe("string");
    }
  });
});

describe("GET /admin/curriculum/activity (§3 — classified, not a flat feed)", () => {
  it("classifies module create/edit/publish and question adds server-side", async () => {
    // Create (module) → edit (edited) → publish (published) → questions (quiz),
    // through the real admin routes so the audit rows are the genuine ones.
    const created = await agent()
      .post("/v1/admin/modules")
      .set(auth(adminTok))
      .send({ level_number: 3, title: "Activity Probe", lesson_content: "Body", evaluation_kind: "none" });
    expect(created.status).toBe(201);
    const moduleId = created.body.module_id as string;

    await agent().put(`/v1/admin/modules/${moduleId}`).set(auth(adminTok)).send({ summary: "s" });
    await agent().post(`/v1/admin/modules/${moduleId}/publish`).set(auth(adminTok));
    await agent()
      .post(`/v1/admin/modules/${moduleId}/questions`)
      .set(auth(adminTok))
      .send({
        questions: [
          { q_type: "TrueFalse", question_text: "Is grace free?", correct_answer: "True" },
        ],
      });

    const res = await agent().get("/v1/admin/curriculum/activity").set(auth(adminTok));
    expect(res.status).toBe(200);
    const rows = res.body.data as Array<{ action: string; kind: string; entity_id: string | null }>;
    const kindOf = (action: string) => rows.find((r) => r.action === action && r.entity_id === moduleId)?.kind;
    expect(kindOf("module.created")).toBe("module");
    expect(kindOf("module.updated")).toBe("edited");
    expect(kindOf("module.published")).toBe("published");
    expect(kindOf("module.questions_added")).toBe("quiz");
    // Newest first.
    expect(rows[0]!.action).toBe("module.questions_added");
  });
});

describe("one editor per entity (§2.5): the exam endpoint owns the pass mark", () => {
  it("PUT /admin/levels/:n rejects required_exam_pass_mark (400); the exam endpoint accepts it", async () => {
    const rejected = await agent()
      .put("/v1/admin/levels/1")
      .set(auth(adminTok))
      .send({ required_exam_pass_mark: 75 });
    expect(rejected.status).toBe(400);

    // Everything else on updateLevel still works.
    const ok = await agent().put("/v1/admin/levels/1").set(auth(adminTok)).send({ title: "Renamed L1" });
    expect(ok.status).toBe(200);
    expect(ok.body.title).toBe("Renamed L1");

    const exam = await agent()
      .put("/v1/admin/levels/1/exam")
      .set(auth(adminTok))
      .send({ required_exam_pass_mark: 75 });
    expect(exam.status).toBe(200);
    expect(Number(exam.body.required_exam_pass_mark)).toBe(75);
  });
});

describe("levelsReport delegates to the same stats source (§3)", () => {
  it("GET /admin/reports/levels per-level numbers match the summary cards", async () => {
    const student2 = await createUser({ congregationId: cong, role: "Student", email: "s2@dev.local" });
    await createEnrollment(student2.user_id, 1);
    await createModule(1, 1);

    const [report, summary] = await Promise.all([
      agent().get("/v1/admin/reports/levels").set(auth(adminTok)),
      agent().get("/v1/admin/curriculum/summary").set(auth(adminTok)),
    ]);
    expect(report.status).toBe(200);
    expect(summary.status).toBe(200);
    for (const lvl of report.body.levels as Array<Record<string, number>>) {
      const card = summary.body.levels.find(
        (l: { level_number: number }) => l.level_number === lvl.level_number,
      );
      expect(card.modules_published).toBe(lvl.modules_published);
      expect(card.learners).toBe(lvl.learners);
      expect(card.completion_pct).toBe(lvl.completion_pct);
      expect(card.certificates).toBe(lvl.certificates);
    }
    expect(Array.isArray(report.body.trend)).toBe(true); // shape unchanged
  });
});
