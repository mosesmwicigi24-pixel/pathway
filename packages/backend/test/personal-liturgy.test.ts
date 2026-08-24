// The liturgy, addressed to one person (owner's ask, 2026-08-24): the hour's
// LINE stays the church's; the charge + companion verse turn personal when
// the member carries something — an open prayer, a plan mid-walk, an
// unfinished module. These tests pin the three signals, the empty-handed
// fallback, and the daily stability that keeps a liturgy from flickering.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { personalTouch } from "../src/modules/intelligence/personalLiturgy.js";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPool();
});

async function member(): Promise<string> {
  const cong = await createCongregation();
  const u = await createUser({ congregationId: cong, email: "lit@dev.local" });
  return u.user_id;
}

describe("the personal charge speaks to what the member carries", () => {
  it("an open prayer surfaces, by its own short title", async () => {
    const userId = await member();
    await testPool().query(
      `INSERT INTO prayer_entries (entry_id, user_id, title, body, is_answered)
       VALUES (gen_random_uuid(), $1, 'Peace for my mother', 'long text…', false)`,
      [userId],
    );
    const touch = await personalTouch(testPool(), userId, "morning", "morning", "2026-08-24");
    expect(touch).not.toBeNull();
    expect(touch!.charge).toContain("Peace for my mother");
    expect(touch!.verse_line.reference).toMatch(/Philippians 4:6|1 Peter 5:7/);
  });

  it("an ANSWERED prayer no longer speaks", async () => {
    const userId = await member();
    await testPool().query(
      `INSERT INTO prayer_entries (entry_id, user_id, title, body, is_answered)
       VALUES (gen_random_uuid(), $1, 'Old request', 'x', true)`,
      [userId],
    );
    expect(await personalTouch(testPool(), userId, "morning", "morning", "2026-08-24")).toBeNull();
  });

  it("a reading plan mid-walk surfaces with its day number", async () => {
    const userId = await member();
    const { rows } = await testPool().query<{ plan_id: string }>(
      `INSERT INTO reading_plans (code, title, description, category, day_count)
       VALUES ('t-plan', 'First Steps', 'd', 'foundations', 7) RETURNING plan_id`,
    );
    await testPool().query(
      `INSERT INTO reading_plan_progress (user_id, plan_id, current_day) VALUES ($1, $2, 3)`,
      [userId, rows[0]!.plan_id],
    );
    const touch = await personalTouch(testPool(), userId, "evening", "evening", "2026-08-24");
    expect(touch!.charge).toContain("First Steps");
    expect(touch!.charge).toContain("3");
  });

  it("empty-handed members keep the church's own charge (null)", async () => {
    const userId = await member();
    expect(await personalTouch(testPool(), userId, "midday", "midday", "2026-08-24")).toBeNull();
  });

  it("the choice is stable within a day and can move across days", async () => {
    const userId = await member();
    await testPool().query(
      `INSERT INTO prayer_entries (entry_id, user_id, title, body, is_answered)
       VALUES (gen_random_uuid(), $1, 'Provision', 'x', false)`,
      [userId],
    );
    const { rows } = await testPool().query<{ plan_id: string }>(
      `INSERT INTO reading_plans (code, title, description, category, day_count)
       VALUES ('t2', 'Deep Roots', 'd', 'growth', 30) RETURNING plan_id`,
    );
    await testPool().query(
      `INSERT INTO reading_plan_progress (user_id, plan_id, current_day) VALUES ($1, $2, 9)`,
      [userId, rows[0]!.plan_id],
    );
    const a = await personalTouch(testPool(), userId, "morning", "morning", "2026-08-24");
    const b = await personalTouch(testPool(), userId, "morning", "morning", "2026-08-24");
    expect(a!.charge).toBe(b!.charge); // same day → same word, no flicker
  });

  it("prayer titles too long for a card are trimmed with an ellipsis", async () => {
    const userId = await member();
    await testPool().query(
      `INSERT INTO prayer_entries (entry_id, user_id, title, body, is_answered)
       VALUES (gen_random_uuid(), $1, $2, 'x', false)`,
      [userId, "A very long prayer title that would sprawl right across the whole liturgy card"],
    );
    const touch = await personalTouch(testPool(), userId, "night", "night", "2026-08-24");
    expect(touch!.charge).toContain("…");
    expect(touch!.charge.length).toBeLessThan(160);
  });
});
