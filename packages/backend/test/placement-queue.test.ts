// Who is still waiting for a cell.
//
// Twenty-eight members sat unplaced for up to 42 days (2026-08-14 audit). The
// portal had no way to express the question "who has nobody?", so nobody asked
// it. These tests hold the answer visible.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser, createCellGroup } from "./helpers/factories.js";
import { agent, bearer } from "./helpers/app.js";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPool();
});

const roster = async (cong: string, admin: string, qs = "") =>
  agent()
    .get(`/v1/admin/members${qs}`)
    .set("Authorization", bearer({ sub: admin, role: "Admin", cong }));

describe("members awaiting a cell", () => {
  it("reports the count on EVERY roster page, whatever the caller filtered by", async () => {
    const cong = await createCongregation();
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "admin@dev.local" });
    const cell = await createCellGroup(cong);

    await createUser({ congregationId: cong, role: "Student", email: "placed@dev.local", cellGroupId: cell });
    await createUser({ congregationId: cong, role: "Student", email: "waiting1@dev.local" });
    await createUser({ congregationId: cong, role: "Student", email: "waiting2@dev.local" });

    // The count must survive a filter that excludes the very people it counts —
    // otherwise filtering to one cell hides the queue, which is how 28 people
    // stayed invisible for six weeks.
    const filtered = await roster(cong, admin.user_id, `?cell_group_id=${cell}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.awaiting_placement).toBe(2);
  });

  it("says how long the longest wait has been, not just how many", async () => {
    const cong = await createCongregation();
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "admin2@dev.local" });
    const old = await createUser({ congregationId: cong, role: "Student", email: "old@dev.local" });
    await testPool().query(
      `UPDATE users SET created_at = now() - interval '42 days' WHERE user_id = $1`,
      [old.user_id],
    );

    const res = await roster(cong, admin.user_id);
    // "28 waiting" is a statistic. "someone has waited 42 days" is a person.
    expect(res.body.awaiting_placement).toBe(1);
    expect(res.body.longest_wait_days).toBeGreaterThanOrEqual(42);
  });

  it("filters the roster down to exactly those waiting", async () => {
    const cong = await createCongregation();
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "admin3@dev.local" });
    const cell = await createCellGroup(cong);
    await createUser({ congregationId: cong, role: "Student", email: "in@dev.local", cellGroupId: cell });
    await createUser({ congregationId: cong, role: "Student", email: "out@dev.local" });

    const awaiting = await roster(cong, admin.user_id, "?placement=awaiting");
    expect(awaiting.body.data).toHaveLength(1);
    expect((awaiting.body.data[0] as { email: string }).email).toBe("out@dev.local");

    const placed = await roster(cong, admin.user_id, "?placement=placed");
    expect(placed.body.data).toHaveLength(1);
    expect((placed.body.data[0] as { email: string }).email).toBe("in@dev.local");
  });

  it("reads zero when everyone has a cell — no false alarm", async () => {
    const cong = await createCongregation();
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "admin4@dev.local" });
    const cell = await createCellGroup(cong);
    await createUser({ congregationId: cong, role: "Student", email: "settled@dev.local", cellGroupId: cell });

    const res = await roster(cong, admin.user_id);
    expect(res.body.awaiting_placement).toBe(0);
    expect(res.body.longest_wait_days).toBe(0);
  });

  it("does not count retired accounts as people waiting", async () => {
    const cong = await createCongregation();
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "admin5@dev.local" });
    const gone = await createUser({ congregationId: cong, role: "Student", email: "gone@dev.local" });
    await testPool().query(`UPDATE users SET deleted_at = now() WHERE user_id = $1`, [gone.user_id]);

    // Migration 193 taught this lesson: `deleted_at IS NULL` is part of the
    // definition of "member", and leaving it out enrolled six test accounts.
    const res = await roster(cong, admin.user_id);
    expect(res.body.awaiting_placement).toBe(0);
  });
});
