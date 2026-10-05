// A level's status is the portal's promise: Draft and In review hide it from
// members. Until 2026-10-05 no member read honoured it — production carried a
// stray seventh level titled "LEVEL 1", so all 87 members read "Level 1 of 7".
// Members see published levels, plus every level at or below their own:
// drafting a level can hide the road ahead, never where a member stands or has
// already walked.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser, createEnrollment } from "./helpers/factories.js";
import { CurriculumService } from "../src/modules/curriculum/service.js";

const curriculum = () => new CurriculumService(testPool());
type Level = { level_number: number };
const numbers = (rows: Level[]) => rows.map((l) => l.level_number);
const pathwayLevels = async (userId: string) =>
  numbers(((await curriculum().getPathwaySummary(userId)) as { levels: Level[] }).levels);

describe("draft levels are hidden from members", () => {
  let cong: string;
  let top: number;

  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation();
    const { rows } = await testPool().query<{ n: number }>(`SELECT COALESCE(MAX(level_number), 0)::int AS n FROM levels`);
    top = rows[0]!.n;
    // Production's stray level, exactly: one past the last, titled "LEVEL 1".
    await testPool().query(`INSERT INTO levels (level_number, title, status) VALUES ($1, 'LEVEL 1', 'draft')`, [top + 1]);
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("the level catalogue lists published levels only", async () => {
    const listed = numbers((await curriculum().listLevels()) as Level[]);
    expect(listed).not.toContain(top + 1);
    expect(listed).toContain(1);
  });

  it("a member's pathway leaves out a draft level ahead of them", async () => {
    const userId = (await createUser({ congregationId: cong })).user_id;
    await createEnrollment(userId, 1);
    const levels = await pathwayLevels(userId);
    expect(levels).not.toContain(top + 1);
    expect(levels.length).toBe(top);
  });

  it("an In review level is hidden the same way", async () => {
    await testPool().query(`UPDATE levels SET status = 'in_review' WHERE level_number = $1`, [top + 1]);
    const userId = (await createUser({ congregationId: cong })).user_id;
    await createEnrollment(userId, 1);
    expect(await pathwayLevels(userId)).not.toContain(top + 1);
  });

  it("never hides where a member stands or has already walked", async () => {
    // A member placed on the draft level still sees it…
    const onIt = (await createUser({ congregationId: cong })).user_id;
    await createEnrollment(onIt, top + 1);
    expect(await pathwayLevels(onIt)).toContain(top + 1);

    // …and drafting a level a member has passed does not erase it from their journey.
    await testPool().query(`UPDATE levels SET status = 'draft' WHERE level_number = 1`);
    const past = (await createUser({ congregationId: cong })).user_id;
    await createEnrollment(past, 2);
    expect(await pathwayLevels(past)).toContain(1);
  });
});
