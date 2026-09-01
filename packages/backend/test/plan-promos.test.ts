// Plan promos that know the reader (owner, 2026-08-26: "intelligent and smart
// and customized and with memory and with history"). Each slot must EARN its
// place from something true about the member — these tests pin that, plus the
// memory that stops one plan owning the shelf, and the privacy line: the
// "carrying" slot names a THEME, never the member's own words.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser } from "./helpers/factories.js";
import { planPromos } from "../src/modules/growth-content/promos.js";

async function plan(code: string, title: string, category: string, sort: number): Promise<string> {
  const { rows } = await testPool().query<{ plan_id: string }>(
    `INSERT INTO reading_plans (code, title, description, category, day_count, sort, is_active)
     VALUES ($1, $2, 'd', $3, 10, $4, true) RETURNING plan_id`,
    [code, title, category, sort],
  );
  return rows[0]!.plan_id;
}
const start = (u: string, p: string, done = false): Promise<unknown> =>
  testPool().query(
    `INSERT INTO reading_plan_progress (user_id, plan_id, current_day, completed_at)
     VALUES ($1, $2, 3, ${done ? "now()" : "NULL"})`,
    [u, p],
  );
const pray = (u: string, title: string): Promise<unknown> =>
  testPool().query(
    `INSERT INTO prayer_entries (entry_id, user_id, title, body, is_answered)
     VALUES (gen_random_uuid(), $1, $2, '', false)`,
    [u, title],
  );

beforeEach(async () => {
  await resetDb();
  // resetDb re-applies the seeds, which ship a real plan library. These tests
  // reason about ORDER and MEMORY, so they need a library they fully control.
  await testPool().query(`DELETE FROM reading_plans`);
});
afterAll(async () => {
  await closeTestPool();
});

describe("plan promos earn their place", () => {
  it("a plan in progress leads, and its reason says so", async () => {
    const cong = await createCongregation();
    const u = await createUser({ congregationId: cong, email: "a@dev.local" });
    const walking = await plan("p1", "First Steps", "Foundations", 1);
    await plan("p2", "Fear Not", "Courage", 2);
    await start(u.user_id, walking);

    const promos = await planPromos(testPool(), u.user_id);
    expect(promos[0]!.slot).toBe("continue");
    expect(promos[0]!.plan_id).toBe(walking);
    expect(promos[0]!.kicker).toBe("PICK UP WHERE YOU LEFT OFF");
  });

  it("history speaks: finishing one plan proposes the next in that same stream", async () => {
    const cong = await createCongregation();
    const u = await createUser({ congregationId: cong, email: "b@dev.local" });
    const done = await plan("p1", "Who Am I?", "Identity", 1);
    const sameStream = await plan("p2", "New Lenses", "Identity", 2);
    await plan("p3", "Fear Not", "Courage", 3);
    await start(u.user_id, done, true);

    const promos = await planPromos(testPool(), u.user_id);
    const next = promos.find((p) => p.slot === "next_step")!;
    expect(next.plan_id).toBe(sameStream);           // same category, not just the next row
    expect(next.reason).toContain("Who Am I?");      // it says WHY, by name
  });

  it("an open prayer about fear proposes courage — by THEME, never the member's words", async () => {
    const cong = await createCongregation();
    const u = await createUser({ congregationId: cong, email: "c@dev.local" });
    const courage = await plan("p1", "Fear Not", "Courage", 1);
    await plan("p2", "Speak Life", "Growth", 2);
    await pray(u.user_id, "I am so anxious about my mother's surgery");

    const promos = await planPromos(testPool(), u.user_id);
    const carrying = promos.find((p) => p.slot === "carrying")!;
    expect(carrying.plan_id).toBe(courage);
    expect(carrying.reason).toContain("fear");
    // The privacy line: their own sentence never travels into the ad.
    expect(carrying.reason.toLowerCase()).not.toContain("mother");
    expect(carrying.reason.toLowerCase()).not.toContain("surgery");
  });

  it("what the cell is reading is offered as belonging, with a real count", async () => {
    const cong = await createCongregation();
    const cell = await createCellGroup(cong, "Junction");
    const me = await createUser({ congregationId: cong, cellGroupId: cell, email: "d@dev.local" });
    const mate1 = await createUser({ congregationId: cong, cellGroupId: cell, email: "e@dev.local" });
    const mate2 = await createUser({ congregationId: cong, cellGroupId: cell, email: "f@dev.local" });
    const shared = await plan("p1", "Better Together", "Relationships", 1);
    await start(mate1.user_id, shared);
    await start(mate2.user_id, shared);

    const promos = await planPromos(testPool(), me.user_id);
    const cellSlot = promos.find((p) => p.slot === "cell")!;
    expect(cellSlot.plan_id).toBe(shared);
    expect(cellSlot.reason).toContain("2 people in your cell");
  });

  it("memory: a plan just promoted is rested, and the least-shown rises", async () => {
    const cong = await createCongregation();
    const u = await createUser({ congregationId: cong, email: "g@dev.local" });
    const a = await plan("p1", "Plan A", "Growth", 1);
    const b = await plan("p2", "Plan B", "Growth", 2);

    const first = await planPromos(testPool(), u.user_id, 1);
    expect(first).toHaveLength(1);
    expect(first[0]!.plan_id).toBe(a);               // library order on a blank slate

    const second = await planPromos(testPool(), u.user_id, 1);
    expect(second[0]!.plan_id).toBe(b);              // A was just shown — B's turn

    const log = await testPool().query<{ plan_id: string; times_shown: number }>(
      `SELECT plan_id, times_shown FROM plan_promo_log WHERE user_id = $1 ORDER BY plan_id`,
      [u.user_id],
    );
    expect(log.rows).toHaveLength(2);                // it remembered both
  });

  it("never promotes a plan already finished, and never the same plan twice in one page", async () => {
    const cong = await createCongregation();
    const u = await createUser({ congregationId: cong, email: "h@dev.local" });
    const finished = await plan("p1", "Done Plan", "Growth", 1);
    await plan("p2", "Plan B", "Growth", 2);
    await plan("p3", "Plan C", "Faith", 3);
    await start(u.user_id, finished, true);

    const promos = await planPromos(testPool(), u.user_id);
    expect(promos.some((p) => p.plan_id === finished)).toBe(false);
    expect(new Set(promos.map((p) => p.plan_id)).size).toBe(promos.length);
  });

  it("an empty library is an empty page, not an error", async () => {
    const cong = await createCongregation();
    const u = await createUser({ congregationId: cong, email: "i@dev.local" });
    expect(await planPromos(testPool(), u.user_id)).toEqual([]);
  });
});
