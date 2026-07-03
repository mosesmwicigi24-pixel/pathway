// Level advancement — the discipler "usher" gate (§1.9). THE RULE: modules a
// member earns alone; LEVELS require a human discipler to usher them in. A
// passing level exam records a PENDING advancement and does NOT advance
// current_level; only a scoped discipler ushering the member flips it to N+1.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import {
  createCongregation,
  createCellGroup,
  createUser,
  createEnrollment,
  createModule,
  addQuestion,
  createLeaderAssignment,
} from "./helpers/factories.js";
import { ProgressService } from "../src/modules/progress/service.js";
import { AssessmentService } from "../src/modules/assessment/service.js";
import { ExamService } from "../src/modules/assessment/exam.js";
import { LevelAdvancementService } from "../src/modules/assessment/levelAdvancement.js";
import { CurriculumService } from "../src/modules/curriculum/service.js";
import type { Principal } from "../src/http/http.js";

const progress = () => new ProgressService(testPool());
const assess = () => new AssessmentService(testPool());
const exam = () => new ExamService(testPool());
const usherer = () => new LevelAdvancementService(testPool());
const curriculum = () => new CurriculumService(testPool());

const principal = (userId: string, role: Principal["role"]): Principal => ({ userId, role, congregationId: "c" });

const currentLevel = async (userId: string): Promise<number> =>
  (await testPool().query("SELECT current_level FROM enrollments WHERE user_id=$1", [userId])).rows[0].current_level;

describe("level advancement — the discipler usher gate (§1.9)", () => {
  let cong: string, cell: string, student: string, instructor: string, l1m1: string, q: string;

  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation();
    cell = await createCellGroup(cong);
    student = (await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Amina" })).user_id;
    instructor = (await createUser({ congregationId: cong, role: "Instructor" })).user_id;
    await createEnrollment(student, 1);
    l1m1 = await createModule(1, 1);
    q = await addQuestion(l1m1, "A");
  });
  afterAll(async () => {
    await closeTestPool();
  });

  async function finishLevel1(): Promise<void> {
    await progress().completeModule(student, l1m1, null);
    await assess().submitQuiz(student, l1m1, {
      client_mutation_id: "aaaa1111-1111-4111-8111-111111111111",
      answers: [{ question_id: q, given_answer: "A" }],
    });
  }

  async function passExam(mut = "bbbb2222-2222-4222-8222-222222222222") {
    return exam().submit(student, 1, { client_mutation_id: mut, answers: [{ question_id: q, given_answer: "A" }] });
  }

  it("a passing exam records a PENDING advancement and does NOT advance current_level", async () => {
    await finishLevel1();
    const res = await passExam();
    expect(res.is_passed).toBe(true);
    // current_level unchanged — the exam is the member's solo effort, not the gate.
    expect(await currentLevel(student)).toBe(1);
    const adv = await testPool().query(
      "SELECT status, level_number FROM level_advancements WHERE user_id=$1",
      [student],
    );
    expect(adv.rows).toHaveLength(1);
    expect(adv.rows[0].status).toBe("pending");
    expect(adv.rows[0].level_number).toBe(1);
  });

  it("a failing exam records NO advancement", async () => {
    await finishLevel1();
    await exam().submit(student, 1, {
      client_mutation_id: "cccc3333-3333-4333-8333-333333333333",
      answers: [{ question_id: q, given_answer: "Z" }],
    });
    const adv = await testPool().query("SELECT count(*)::int n FROM level_advancements WHERE user_id=$1", [student]);
    expect(adv.rows[0].n).toBe(0);
  });

  it("re-passing while pending is idempotent (one advancement row)", async () => {
    await finishLevel1();
    await passExam("dddd4444-4444-4444-8444-444444444444");
    await passExam("eeee5555-5555-4555-8555-555555555555");
    const adv = await testPool().query("SELECT count(*)::int n FROM level_advancements WHERE user_id=$1", [student]);
    expect(adv.rows[0].n).toBe(1);
  });

  it("member pathway surfaces awaiting_review for the pending level; next stays locked", async () => {
    await finishLevel1();
    await passExam();
    const summary = (await curriculum().getPathwaySummary(student)) as {
      levels: Array<{ level_number: number; status: string; awaiting_review: boolean }>;
    };
    const l1 = summary.levels.find((l) => l.level_number === 1)!;
    const l2 = summary.levels.find((l) => l.level_number === 2)!;
    expect(l1.status).toBe("awaiting_review");
    expect(l1.awaiting_review).toBe(true);
    expect(l2.status).toBe("locked");
    expect(l2.awaiting_review).toBe(false);
  });

  it("GET /reviews/levels lists the pending advancement scoped to the discipler", async () => {
    await finishLevel1();
    await passExam();

    // Unassigned instructor sees nothing.
    const unassigned = (await usherer().listPending(principal(instructor, "Instructor"))) as unknown[];
    expect(unassigned).toHaveLength(0);

    // Assigned instructor sees the item with the expected shape.
    await createLeaderAssignment(instructor, cell);
    const assigned = (await usherer().listPending(principal(instructor, "Instructor"))) as Array<{
      id: string;
      user_id: string;
      member_name: string;
      level_number: number;
      exam_score: number | null;
      created_at: string;
    }>;
    expect(assigned).toHaveLength(1);
    expect(assigned[0]!.user_id).toBe(student);
    expect(assigned[0]!.member_name).toBe("Amina");
    expect(assigned[0]!.level_number).toBe(1);
    expect(assigned[0]!.exam_score).toBe(100);
  });

  it("ushering advances the member + is idempotent + notifies + audits", async () => {
    await finishLevel1();
    await passExam();
    await createLeaderAssignment(instructor, cell);
    const [item] = (await usherer().listPending(principal(instructor, "Instructor"))) as Array<{ id: string }>;

    const done = await usherer().usher(principal(instructor, "Instructor"), item!.id, "Proud of your growth");
    expect(done.status).toBe("ushered");
    expect(done.advanced).toBe(true);
    expect(done.new_level).toBe(2);
    expect(await currentLevel(student)).toBe(2);

    // The member was notified.
    const notif = await testPool().query(
      "SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND template='level_ushered'",
      [student],
    );
    expect(notif.rows[0].n).toBe(1);
    // The usher was audited.
    const audit = await testPool().query(
      "SELECT count(*)::int n FROM audit_log WHERE action='level.ushered' AND entity_id=$1",
      [item!.id],
    );
    expect(audit.rows[0].n).toBe(1);

    // Idempotent: a second usher is a no-op (no double-advance, no second notify).
    const again = await usherer().usher(principal(instructor, "Instructor"), item!.id, "again");
    expect(again.advanced).toBe(false);
    expect(await currentLevel(student)).toBe(2);
    const notif2 = await testPool().query(
      "SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND template='level_ushered'",
      [student],
    );
    expect(notif2.rows[0].n).toBe(1);
  });

  it("an out-of-scope discipler cannot usher (§5.4 FORBIDDEN_SCOPE)", async () => {
    await finishLevel1();
    await passExam();
    const id = (await testPool().query("SELECT id FROM level_advancements WHERE user_id=$1", [student])).rows[0].id;
    // instructor has NO assignment for the student's cell
    await expect(
      usherer().usher(principal(instructor, "Instructor"), id, undefined),
    ).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    expect(await currentLevel(student)).toBe(1);
  });

  it("the next level stays locked until the member is ushered", async () => {
    // Give L2 a module so we can probe its unlock state.
    const l2m1 = await createModule(2, 1);
    await addQuestion(l2m1, "A");
    await finishLevel1();
    await passExam();

    // Before usher: L2·M1 is locked (hard-lock ceiling still at level 1).
    const before = (await curriculum().listModulesForLevel(student, 2)) as Array<{ module_id: string; locked: boolean }>;
    expect(before.find((m) => m.module_id === l2m1)!.locked).toBe(true);

    await createLeaderAssignment(instructor, cell);
    const id = (await testPool().query("SELECT id FROM level_advancements WHERE user_id=$1", [student])).rows[0].id;
    await usherer().usher(principal(instructor, "Instructor"), id, undefined);

    // After usher: L2·M1 (first module of the now-current level) is open.
    const after = (await curriculum().listModulesForLevel(student, 2)) as Array<{ module_id: string; locked: boolean }>;
    expect(after.find((m) => m.module_id === l2m1)!.locked).toBe(false);
  });
});
