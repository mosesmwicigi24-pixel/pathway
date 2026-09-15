// Assessment — server-side quiz assembly + scoring (§1.9, §3.3, §3.7).
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
import { AssessmentService } from "../src/modules/assessment/service.js";
import { ProgressService } from "../src/modules/progress/service.js";
import { CurriculumService } from "../src/modules/curriculum/service.js";

const assess = () => new AssessmentService(testPool());
const progress = () => new ProgressService(testPool());
const curriculum = () => new CurriculumService(testPool());

const MUT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("assessment / quiz (§1.9, §3.7)", () => {
  let userId: string;
  let l1m1: string, l1m2: string, q1: string, q2: string;

  beforeEach(async () => {
    await resetDb();
    const cong = await createCongregation();
    const cell = await createCellGroup(cong);
    userId = (await createUser({ congregationId: cong, cellGroupId: cell })).user_id;
    await createEnrollment(userId, 1);
    l1m1 = await createModule(1, 1, { quizPassMark: 70 });
    l1m2 = await createModule(1, 2);
    q1 = await addQuestion(l1m1, "A");
    q2 = await addQuestion(l1m1, "B");
    // The member has read the lesson — the content gate's precondition.
    await markContentConsumed(userId, l1m1);
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("blocks the quiz until the lesson content is consumed (§1.3)", async () => {
    // l1m1 is the unlocked entry module; clear the setup's engagement so the
    // ONLY thing standing between the member and the quiz is having read it.
    await testPool().query(`DELETE FROM module_engagement WHERE module_id = $1`, [l1m1]);
    await expect(assess().assembleQuiz(userId, l1m1)).rejects.toMatchObject({ code: "CONTENT_INCOMPLETE" });
    // Once the lesson is read, the quiz assembles.
    await markContentConsumed(userId, l1m1);
    const quiz = (await assess().assembleQuiz(userId, l1m1)) as { question_count: number };
    expect(quiz.question_count).toBe(2);
  });

  it("assembles a quiz without leaking correct answers", async () => {
    const quiz = (await assess().assembleQuiz(userId, l1m1)) as {
      question_count: number;
      questions: Array<Record<string, unknown>>;
    };
    expect(quiz.question_count).toBe(2);
    for (const q of quiz.questions) {
      expect(q).toHaveProperty("question_id");
      expect(q).toHaveProperty("answer_options");
      expect(q).not.toHaveProperty("correct_answer"); // §5.8
    }
  });

  it("scores a fully-correct submission as 100 and passing", async () => {
    const res = await assess().submitQuiz(userId, l1m1, {
      client_mutation_id: MUT,
      answers: [
        { question_id: q1, given_answer: "A" },
        { question_id: q2, given_answer: "b" }, // case-insensitive
      ],
    });
    expect(res.score_achieved).toBe(100);
    expect(res.is_passed).toBe(true);
    expect(res.pass_mark).toBe(70);
    // A pass IS the completion of a quiz module — written by the server, in the
    // same transaction, not left to a client follow-up (2026-09-16: 33 rows
    // across 18 members had a pass and is_completed = false; the app re-offered
    // the test every visit).
    const row = await testPool().query(
      `SELECT mp.is_completed, mp.completed_at FROM module_progress mp
         JOIN enrollments e ON e.enrollment_id = mp.enrollment_id
        WHERE e.user_id = $1 AND mp.module_id = $2`,
      [userId, l1m1],
    );
    expect(row.rows[0].is_completed).toBe(true);
    expect(row.rows[0].completed_at).not.toBeNull();
    const detail = (await curriculum().getModule(userId, l1m1)) as { completed_at: string | null; best_score: number | null };
    expect(detail.completed_at).not.toBeNull();
    expect(detail.best_score).toBe(100);
    const done = await testPool().query(
      `SELECT 1 FROM interaction_events WHERE user_id = $1 AND kind = 'module_completed' AND module_id = $2`,
      [userId, l1m1],
    );
    expect(done.rowCount).toBe(1);
  });

  it("a retake of an already-completed module does not re-fire completion", async () => {
    const pass = { answers: [{ question_id: q1, given_answer: "A" }, { question_id: q2, given_answer: "B" }] };
    await assess().submitQuiz(userId, l1m1, { client_mutation_id: MUT, ...pass });
    await assess().submitQuiz(userId, l1m1, { client_mutation_id: "aaaaaaaa-bbbb-cccc-dddd-000000000002", ...pass });
    const done = await testPool().query(
      `SELECT count(*)::int AS n FROM interaction_events WHERE user_id = $1 AND kind = 'module_completed' AND module_id = $2`,
      [userId, l1m1],
    );
    expect(done.rows[0].n).toBe(1);
  });

  it("a legacy row (passed attempt, is_completed still false) reads as completed with its score", async () => {
    await assess().submitQuiz(userId, l1m1, {
      client_mutation_id: MUT,
      answers: [{ question_id: q1, given_answer: "A" }, { question_id: q2, given_answer: "B" }],
    });
    // The shape prod carried before 2026-09-16.
    await testPool().query(
      `UPDATE module_progress mp SET is_completed = FALSE, completed_at = NULL
         FROM enrollments e WHERE e.enrollment_id = mp.enrollment_id AND e.user_id = $1 AND mp.module_id = $2`,
      [userId, l1m1],
    );
    const detail = (await curriculum().getModule(userId, l1m1)) as { completed_at: string | null; best_score: number | null };
    expect(detail.completed_at).not.toBeNull();
    expect(detail.best_score).toBe(100);
    const list = (await curriculum().listModulesForLevel(userId, 1)) as Array<{ module_id: string; completed: boolean }>;
    expect(list.find((m) => m.module_id === l1m1)?.completed).toBe(true);
  });

  it("fails a half-correct submission below the pass mark (unanswered = wrong)", async () => {
    const res = await assess().submitQuiz(userId, l1m1, {
      client_mutation_id: MUT,
      answers: [{ question_id: q1, given_answer: "A" }], // q2 omitted → wrong
    });
    expect(res.score_achieved).toBe(50);
    expect(res.is_passed).toBe(false);
  });

  it("is idempotent on client_mutation_id", async () => {
    const first = await assess().submitQuiz(userId, l1m1, {
      client_mutation_id: MUT,
      answers: [{ question_id: q1, given_answer: "A" }, { question_id: q2, given_answer: "B" }],
    });
    expect(first.duplicate).toBe(false);
    const again = await assess().submitQuiz(userId, l1m1, {
      client_mutation_id: MUT,
      answers: [{ question_id: q1, given_answer: "A" }, { question_id: q2, given_answer: "B" }],
    });
    expect(again.duplicate).toBe(true);
    expect(again.attempt_id).toBe(first.attempt_id);
    const { rows } = await testPool().query(`SELECT count(*)::int n FROM quiz_attempts`);
    expect(rows[0].n).toBe(1);
  });

  it("refuses quiz actions on a locked module (§1.9 hard lock)", async () => {
    await expect(assess().assembleQuiz(userId, l1m2)).rejects.toMatchObject({ code: "GATE_LOCKED" });
    await expect(
      assess().submitQuiz(userId, l1m2, { client_mutation_id: MUT, answers: [{ question_id: q1, given_answer: "A" }] }),
    ).rejects.toMatchObject({ code: "GATE_LOCKED" });
  });

  it("passing the quiz of a completed module unlocks the next (Flow A)", async () => {
    await progress().completeModule(userId, l1m1, null); // mark complete first
    const res = await assess().submitQuiz(userId, l1m1, {
      client_mutation_id: MUT,
      answers: [{ question_id: q1, given_answer: "A" }, { question_id: q2, given_answer: "B" }],
    });
    expect(res.is_passed).toBe(true);
    expect(res.unlocked_next_module_id).toBe(l1m2);
  });
});
