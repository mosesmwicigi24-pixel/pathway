// Wave 3 — footprints + Your Walk. Counted, not guessed: footprints are the
// cell-mates who really completed the module (self excluded, other
// congregations invisible); the walk is the member's own history unioned
// from real tables, newest first.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { agent, bearer } from "./helpers/app.js";
import {
  createCongregation,
  createCellGroup,
  createUser,
  createEnrollment,
  createModule,
  markContentConsumed,
  completeModule,
} from "./helpers/factories.js";

let cong: string, cell: string, meId: string, mateId: string, moduleId: string;
let meTok: string;

async function finish(userId: string): Promise<void> {
  await markContentConsumed(userId, moduleId);
  await completeModule(userId, moduleId);
}

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  cell = await createCellGroup(cong, "Cell A");
  meId = (await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Sam Student" })).user_id;
  mateId = (await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Leah Mate" })).user_id;
  await createEnrollment(meId, 1);
  await createEnrollment(mateId, 1);
  moduleId = await createModule(1, 1);
  meTok = bearer({ sub: meId, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

describe("footprints", () => {
  it("shows cell-mates who completed the module, never me, never strangers", async () => {
    await finish(mateId);
    await finish(meId); // my own completion must not count

    const otherCong = await createCongregation();
    const strangerId = (await createUser({ congregationId: otherCong, fullName: "Otis Other" })).user_id;
    await createEnrollment(strangerId, 1);
    await finish(strangerId);

    const res = await agent().get(`/v1/modules/${moduleId}/footprints`).set("Authorization", meTok);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.scope).toBe("cell");
    expect(res.body.footprints[0].first_name).toBe("Leah");
  });

  it("is empty (not an error) when nobody has walked here yet", async () => {
    const res = await agent().get(`/v1/modules/${moduleId}/footprints`).set("Authorization", meTok);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.footprints).toEqual([]);
  });
});

describe("your walk", () => {
  it("threads real history newest-first: began, module, reflection, verse", async () => {
    await finish(meId);
    await testPool().query(
      `UPDATE module_reflections SET body = $1, submitted_at = now() - interval '1 day'
        WHERE user_id = $2`,
      ["The Spirit is teaching me to slow down and listen before I speak in my cell.", meId],
    );
    await testPool().query(
      `WITH v AS (
         INSERT INTO memory_verses (reference, verse_text) VALUES ('Psalm 23:1', 'The LORD is my shepherd')
         RETURNING memory_verse_id
       )
       INSERT INTO memory_verse_progress (user_id, memory_verse_id, status, best_match_pct)
       SELECT $1, memory_verse_id, 'mastered', 96 FROM v`,
      [meId],
    );

    const res = await agent().get("/v1/me/walk").set("Authorization", meTok);
    expect(res.status).toBe(200);
    const kinds = res.body.data.map((e: { kind: string }) => e.kind);
    expect(kinds).toContain("began");
    expect(kinds).toContain("module");
    expect(kinds).toContain("reflection");
    expect(kinds).toContain("verse");

    const times = res.body.data.map((e: { occurred_at: string }) => new Date(e.occurred_at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    const reflection = res.body.data.find((e: { kind: string }) => e.kind === "reflection");
    expect(reflection.quote).toContain("slow down");
    const verse = res.body.data.find((e: { kind: string }) => e.kind === "verse");
    expect(verse.title).toBe("Mastered Psalm 23:1");
    expect(verse.detail).toBe("96% word-perfect");
  });

  it("only ever shows MY walk", async () => {
    await finish(mateId);
    const res = await agent().get("/v1/me/walk").set("Authorization", meTok);
    const kinds = res.body.data.map((e: { kind: string }) => e.kind);
    expect(kinds).toEqual(["began"]); // my enrollment only — none of Leah's events
  });
});
