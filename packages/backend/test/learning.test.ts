// Living curriculum (intelligence Phase 3) — explain-differently caches per
// module+style and respects §1.9 gating; quiz remediation composes from the
// member's latest FAILED attempt (cached per attempt); verse spaced repetition
// surfaces weak+stale verses. All offline on the FakeAiProvider.
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
import { LearningService } from "../src/modules/intelligence/learning.js";
import { FakeAiProvider } from "../src/modules/assistant/provider.js";
import { AssessmentService } from "../src/modules/assessment/service.js";

const provider = new FakeAiProvider();
const svc = () => new LearningService(testPool(), provider);

let meId: string, moduleId: string;

beforeEach(async () => {
  await resetDb();
  const cong = await createCongregation();
  const cell = await createCellGroup(cong, "Cell A");
  meId = (await createUser({ congregationId: cong, cellGroupId: cell, email: "me@dev.local", fullName: "Ada" })).user_id;
  await createEnrollment(meId, 1);
  moduleId = await createModule(1, 1);
});
afterAll(async () => {
  await closeTestPool();
});

describe("explain it differently", () => {
  it("renders per style, caches, and speaks Kiswahili when asked", async () => {
    const sw = await svc().explain(meId, moduleId, "swahili");
    expect(sw.body).toContain("Somo");
    expect(sw.cached).toBe(false);
    const again = await svc().explain(meId, moduleId, "swahili");
    expect(again.cached).toBe(true);

    const story = await svc().explain(meId, moduleId, "story");
    expect(story.body.toLowerCase()).toContain("market");
  });

  it("stays behind the §1.9 gate — a locked module refuses", async () => {
    const locked = await createModule(1, 2); // module 2 locked until module 1 completes
    await expect(svc().explain(meId, locked, "simple")).rejects.toMatchObject({ code: "GATE_LOCKED" });
  });
});

describe("quiz remediation", () => {
  it("requires a failed attempt, then composes + caches per attempt", async () => {
    await expect(svc().remediate(meId, moduleId)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    const qid = await addQuestion(moduleId, "A");
    await markContentConsumed(meId, moduleId);
    const fail = await new AssessmentService(testPool()).submitQuiz(meId, moduleId, {
      client_mutation_id: "3b7c1c9a-4d2e-4f6a-8b1c-2d3e4f5a6b7c",
      answers: [{ question_id: qid, given_answer: "Z" }],
    });
    expect(fail.is_passed).toBe(false);

    const first = await svc().remediate(meId, moduleId);
    expect(first.cached).toBe(false);
    expect(first.missed).toBe(1);
    expect(first.body.toLowerCase()).toContain("try again");

    const second = await svc().remediate(meId, moduleId);
    expect(second.cached).toBe(true);
    expect(second.attempt_id).toBe(first.attempt_id);
  });
});

describe("verse spaced repetition", () => {
  it("surfaces weak + stale verses, weakest first; fresh practice is not due", async () => {
    const ins = async (ref: string, pct: number, status: string, daysAgo: number): Promise<void> => {
      const v = await testPool().query(
        `INSERT INTO memory_verses (reference, verse_text) VALUES ($1, 'text') RETURNING memory_verse_id`,
        [ref],
      );
      await testPool().query(
        `INSERT INTO memory_verse_progress (user_id, memory_verse_id, status, best_match_pct, updated_at)
         VALUES ($1, $2, $3, $4, now() - make_interval(days => $5))`,
        [meId, v.rows[0].memory_verse_id, status, pct, daysAgo],
      );
    };
    await ins("John 3:16", 40, "learning", 2); // weak + 2d stale → due
    await ins("Psalm 23:1", 90, "learning", 1); // strong + fresh → not due
    await ins("Romans 8:28", 100, "mastered", 30); // mastered + 30d → refresh due

    const due = await svc().dueVerses(meId);
    expect(due.map((d) => d.reference)).toEqual(["John 3:16", "Romans 8:28"]);
    expect(due[0]!.days_since).toBeGreaterThanOrEqual(2);
  });
});
