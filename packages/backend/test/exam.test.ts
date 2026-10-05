// Level exam — server-side scoring + the §1.9 rule-2 precondition.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import {
  createCongregation,
  createCellGroup,
  createUser,
  createEnrollment,
  createModule,
  addQuestion,
  markContentConsumed,
} from "./helpers/factories.js";
import { ProgressService } from "../src/modules/progress/service.js";
import { AssessmentService } from "../src/modules/assessment/service.js";
import { ExamService } from "../src/modules/assessment/exam.js";
import { agent, bearer } from "./helpers/app.js";

const progress = () => new ProgressService(testPool());
const assess = () => new AssessmentService(testPool());
const exam = () => new ExamService(testPool());

const MUT = "12121212-3434-4565-8787-909090909090";

describe("level exam (§1.9 rule 2)", () => {
  let student: string, l1m1: string, q: string;

  beforeEach(async () => {
    await resetDb();
    const cong = await createCongregation();
    const cell = await createCellGroup(cong);
    student = (await createUser({ congregationId: cong, cellGroupId: cell })).user_id;
    await createEnrollment(student, 1);
    l1m1 = await createModule(1, 1);
    q = await addQuestion(l1m1, "A");
  });
  afterAll(async () => {
    await closeTestPool();
  });

  async function finishModules(): Promise<void> {
    await progress().completeModule(student, l1m1, null);
    await assess().submitQuiz(student, l1m1, {
      client_mutation_id: "77777777-7777-4777-8777-777777777777",
      answers: [{ question_id: q, given_answer: "A" }],
    });
  }

  it("is locked until every module in the level is finished", async () => {
    await expect(exam().assemble(student, 1)).rejects.toMatchObject({ code: "GATE_LOCKED" });
  });

  it("assembles without leaking answers once the level is ready", async () => {
    await finishModules();
    const ex = (await exam().assemble(student, 1)) as {
      question_count: number;
      questions: Array<Record<string, unknown>>;
    };
    expect(ex.question_count).toBe(1);
    expect(ex.questions[0]).not.toHaveProperty("correct_answer");
  });

  it("scores a correct submission as passing and a wrong one as failing", async () => {
    await finishModules();
    const pass = await exam().submit(student, 1, {
      client_mutation_id: MUT,
      answers: [{ question_id: q, given_answer: "A" }],
    });
    expect(pass.score_achieved).toBe(100);
    expect(pass.is_passed).toBe(true);
  });

  it("fails a wrong submission", async () => {
    await finishModules();
    const fail = await exam().submit(student, 1, {
      client_mutation_id: MUT,
      answers: [{ question_id: q, given_answer: "Z" }],
    });
    expect(fail.score_achieved).toBe(0);
    expect(fail.is_passed).toBe(false);
  });

  it("is idempotent on client_mutation_id", async () => {
    await finishModules();
    const first = await exam().submit(student, 1, {
      client_mutation_id: MUT,
      answers: [{ question_id: q, given_answer: "A" }],
    });
    const again = await exam().submit(student, 1, {
      client_mutation_id: MUT,
      answers: [{ question_id: q, given_answer: "A" }],
    });
    expect(again.duplicate).toBe(true);
    expect(again.exam_attempt_id).toBe(first.exam_attempt_id);
    const { rows } = await testPool().query("SELECT count(*)::int n FROM level_exam_attempts");
    expect(rows[0].n).toBe(1);
  });

  it("shows the exit-exam as a visible, locked-until-ready row that fronts the level exam", async () => {
    // Author a Level-1 exit-exam module (like the portal's "Create level exam").
    const examModule = await createModule(1, 11, { evaluationKind: "exit_exam", title: "Level 1 Review" });
    await addQuestion(examModule, "A");
    const { CurriculumService } = await import("../src/modules/curriculum/service.js");
    const svc = new CurriculumService(testPool());
    type Row = { evaluation_kind: string; locked: boolean; completed: boolean; status: string };

    // Before the content module is finished the exam row is VISIBLE but LOCKED —
    // "you can see it, but you can't touch it until everything above it is done."
    const before = (await svc.listModulesForLevel(student, 1)) as Row[];
    const examBefore = before.find((m) => m.evaluation_kind === "exit_exam");
    expect(examBefore).toBeTruthy();
    expect(examBefore!.locked).toBe(true);
    expect(examBefore!.completed).toBe(false);

    await finishModules(); // completes l1m1 (the only content module)

    // Now it unlocks (accessible) but is still not "completed" — the exam is a
    // container, never a read-to-complete lesson.
    const after = (await svc.listModulesForLevel(student, 1)) as Row[];
    const examAfter = after.find((m) => m.evaluation_kind === "exit_exam");
    expect(examAfter!.locked).toBe(false);
    expect(examAfter!.status).toBe("next");
    expect(examAfter!.completed).toBe(false);

    // The exam itself assembles (the exit-exam module never blocks its own gate).
    const assembled = (await exam().assemble(student, 1)) as {
      question_count: number;
      questions: Array<{ question_id: string }>;
    };
    expect(assembled.question_count).toBeGreaterThanOrEqual(1);

    // Passing the exam flips the row to completed.
    const pass = await exam().submit(student, 1, {
      client_mutation_id: MUT,
      answers: assembled.questions.map((qq) => ({ question_id: qq.question_id, given_answer: "A" })),
    });
    expect(pass.is_passed).toBe(true);
    const done = (await svc.listModulesForLevel(student, 1)) as Row[];
    expect(done.find((m) => m.evaluation_kind === "exit_exam")!.completed).toBe(true);
  });

  it("hides the exit-exam row entirely while the level exam is unpublished (review)", async () => {
    const examModule = await createModule(1, 11, { evaluationKind: "exit_exam", title: "Level 1 Review" });
    await addQuestion(examModule, "A");
    await testPool().query("UPDATE levels SET exam_status = 'review' WHERE level_number = 1");
    const { CurriculumService } = await import("../src/modules/curriculum/service.js");
    const mods = (await new CurriculumService(testPool()).listModulesForLevel(student, 1)) as Array<{
      evaluation_kind: string;
    }>;
    expect(mods.some((m) => m.evaluation_kind === "exit_exam")).toBe(false);
  });

  it("is GATE_LOCKED while the level exam is in 'review' (unpublished)", async () => {
    await finishModules();
    await testPool().query("UPDATE levels SET exam_status = 'review' WHERE level_number = 1");
    await expect(exam().assemble(student, 1)).rejects.toMatchObject({ code: "GATE_LOCKED" });
    await expect(
      exam().submit(student, 1, { client_mutation_id: MUT, answers: [{ question_id: q, given_answer: "A" }] }),
    ).rejects.toMatchObject({ code: "GATE_LOCKED" });
    // Publishing it reopens the gate.
    await testPool().query("UPDATE levels SET exam_status = 'published' WHERE level_number = 1");
    const ex = (await exam().assemble(student, 1)) as { question_count: number };
    expect(ex.question_count).toBe(1);
  });
});

describe("exam availability (EXPERIENCE.md §7.2 #1)", () => {
  // A published exam with no active questions answers 422; the member apps
  // offer the exam only when /me/pathway (and the trail's exam row) say it is
  // available — published AND at least one active question in a published module.
  let student: string;
  beforeEach(async () => {
    await resetDb();
    const cong = await createCongregation();
    const cell = await createCellGroup(cong);
    student = (await createUser({ congregationId: cong, cellGroupId: cell })).user_id;
    await createEnrollment(student, 1);
  });

  type Level = { level_number: number; exam_published: boolean; exam_available: boolean };
  const levelOne = async (): Promise<Level> => {
    const { CurriculumService } = await import("../src/modules/curriculum/service.js");
    const sum = (await new CurriculumService(testPool()).getPathwaySummary(student)) as { levels: Level[] };
    return sum.levels.find((l) => l.level_number === 1)!;
  };

  it("is available only when the exam is published AND has an active question", async () => {
    const m1 = await createModule(1, 1);
    // Published, no questions anywhere in the level: published but not available.
    expect(await levelOne()).toMatchObject({ exam_published: true, exam_available: false });

    const qq = await addQuestion(m1, "A");
    expect(await levelOne()).toMatchObject({ exam_published: true, exam_available: true });

    // A deactivated pool is an empty pool.
    await testPool().query("UPDATE question_bank SET is_active = FALSE WHERE question_id = $1", [qq]);
    expect((await levelOne()).exam_available).toBe(false);

    // Questions in an UNPUBLISHED module don't count (examQuestions skips them).
    await testPool().query("UPDATE question_bank SET is_active = TRUE WHERE question_id = $1", [qq]);
    await testPool().query("UPDATE modules SET status = 'draft' WHERE module_id = $1", [m1]);
    expect((await levelOne()).exam_available).toBe(false);
    await testPool().query("UPDATE modules SET status = 'published' WHERE module_id = $1", [m1]);

    // In review it is neither published nor available.
    await testPool().query("UPDATE levels SET exam_status = 'review' WHERE level_number = 1");
    expect(await levelOne()).toMatchObject({ exam_published: false, exam_available: false });
  });

  it("counts lessons apart from the exam (EXPERIENCE.md §8.2)", async () => {
    const m1 = await createModule(1, 1);
    await createModule(1, 2);
    await createModule(1, 900, { evaluationKind: "exit_exam", title: "Level 1 Exam" });
    await progress().completeModule(student, m1, null);
    type L = { level_number: number; total_modules: number; completed_modules: number; lessons_total: number; lessons_completed: number };
    const { CurriculumService } = await import("../src/modules/curriculum/service.js");
    const l1 = ((await new CurriculumService(testPool()).getPathwaySummary(student)) as { levels: L[] }).levels.find((l) => l.level_number === 1)!;
    // The published exam is in the module total (older apps read it so) …
    expect(l1).toMatchObject({ total_modules: 3, completed_modules: 1 });
    // … but it is never "a module" on screen: two lessons, one done.
    expect(l1).toMatchObject({ lessons_total: 2, lessons_completed: 1 });
  });

  it("marks the trail's exam row, and the empty exam refuses in the member's words", async () => {
    const m1 = await createModule(1, 1);
    await createModule(1, 11, { evaluationKind: "exit_exam", title: "Level 1 Review" });
    await progress().completeModule(student, m1, null);
    const { CurriculumService } = await import("../src/modules/curriculum/service.js");
    type Row = { evaluation_kind: string; exam_available?: boolean };
    const examRow = async () =>
      ((await new CurriculumService(testPool()).listModulesForLevel(student, 1)) as Row[]).find(
        (m) => m.evaluation_kind === "exit_exam",
      )!;

    expect((await examRow()).exam_available).toBe(false);
    await expect(exam().assemble(student, 1)).rejects.toMatchObject({
      code: "UNPROCESSABLE",
      message: "Your Level 1 exam isn't ready yet — we'll let you know when it opens.",
    });

    await addQuestion(m1, "A");
    expect((await examRow()).exam_available).toBe(true);
    const ex = (await exam().assemble(student, 1)) as { question_count: number };
    expect(ex.question_count).toBe(1);
  });
});

describe("publishing an exam (EXPERIENCE.md §7.2 #1)", () => {
  let adminTok: string;
  beforeEach(async () => {
    await resetDb();
    const cong = await createCongregation();
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "admin@dev.local" });
    adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    await testPool().query("UPDATE levels SET exam_status = 'review' WHERE level_number = 1");
  });
  const put = (body: Record<string, unknown>) =>
    agent().put("/v1/admin/levels/1/exam").set({ Authorization: adminTok }).send({ required_exam_pass_mark: 80, ...body });
  const status = async () =>
    (await testPool().query("SELECT exam_status FROM levels WHERE level_number = 1")).rows[0].exam_status as string;

  it("refuses to publish an exam with no active questions, and publishes once it has one", async () => {
    const m1 = await createModule(1, 1);
    const refused = await put({ exam_status: "published" });
    expect(refused.status).toBe(422);
    expect(refused.body.error.message).toBe("Add at least one active question before publishing this exam.");
    expect(await status()).toBe("review");

    await addQuestion(m1, "A");
    expect((await put({ exam_status: "published" })).status).toBe(200);
    expect(await status()).toBe("published");
  });

  it("never blocks saving settings on an exam that is already published", async () => {
    await createModule(1, 1);
    await testPool().query("UPDATE levels SET exam_status = 'published' WHERE level_number = 1");
    expect((await put({ exam_status: "published", exam_shuffle: false })).status).toBe(200);
    expect((await put({ exam_status: "review" })).status).toBe(200);
    expect(await status()).toBe("review");
  });
});

describe("answer-choice shuffling", () => {
  it("delivers structured choices in a randomized order without leaking the key", async () => {
    await resetDb();
    const cong = await createCongregation();
    const cell = await createCellGroup(cong);
    const student = (await createUser({ congregationId: cong, cellGroupId: cell })).user_id;
    await createEnrollment(student, 1);
    const mod = await createModule(1, 1);
    // A single-select question with 8 choices — enough that a fixed order almost
    // never survives repeated shuffles by chance.
    const choices = ["A", "B", "C", "D", "E", "F", "G", "H"];
    await testPool().query(
      `INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, is_active, points)
       VALUES ($1, 'multiple_choice', 'Pick A', $2, 'A', TRUE, 1)`,
      [
        mod,
        JSON.stringify({ choices: choices.map((t) => ({ id: t, text: t, is_correct: t === "A" })) }),
      ],
    );
    // Consume the lesson so the quiz gate opens, then assemble several times.
    await markContentConsumed(student, mod);
    const orders = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const quiz = (await assess().assembleQuiz(student, mod)) as {
        questions: Array<{ answer_options: { choices: Array<{ id: string; text: string; is_correct?: unknown }> } }>;
      };
      const served = quiz.questions[0]!.answer_options.choices;
      // Never leaks is_correct.
      expect(served.every((c) => !("is_correct" in c))).toBe(true);
      // Same 8 options, some order.
      expect(served.map((c) => c.id).sort()).toEqual([...choices].sort());
      orders.add(served.map((c) => c.id).join(""));
    }
    // Across 12 deliveries we saw more than one order (shuffle is live).
    expect(orders.size).toBeGreaterThan(1);
  });
});
