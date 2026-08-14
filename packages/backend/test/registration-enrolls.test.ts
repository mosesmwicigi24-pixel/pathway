// Registering IS joining the pathway.
//
// The audit of 2026-08-14 found 28 members holding an account and no
// enrollment — no level, no module, nothing to open — the longest for 42 days.
// The cause was architectural, not operational: POST /v1/me/onboarding was the
// only code that created an enrollment, and it had never once been called in
// production (`audit_log WHERE action='user.onboarded'` → 0 rows), because no
// client calls it. Every enrollment in the database was minted by hand in the
// portal.
//
// These tests exist so that state cannot come back.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { agent } from "./helpers/app.js";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPool();
});

const register = (email: string) =>
  agent().post("/v1/auth/register").send({
    full_name: "New Member",
    email,
    password: "correct horse battery staple",
  });

describe("a member who signs up is on the pathway", () => {
  it("registration creates the enrollment, not a later admin action", async () => {
    const res = await register("arrives@dev.local");
    expect(res.status).toBeLessThan(300);

    const row = await testPool().query(
      `SELECT en.current_level, en.state
         FROM enrollments en JOIN users u ON u.user_id = en.user_id
        WHERE u.email = $1`,
      ["arrives@dev.local"],
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0].current_level).toBe(1);
    expect(row.rows[0].state).toBe("active");
  });

  it("leaves nobody behind: no live Student can exist without one", async () => {
    await register("a@dev.local");
    await register("b@dev.local");
    await register("c@dev.local");

    // The invariant itself, stated as a query. This is what returned 28 in
    // production and must always return 0.
    const stranded = await testPool().query(
      `SELECT count(*)::int AS n
         FROM users u
         LEFT JOIN enrollments en ON en.user_id = u.user_id
        WHERE u.deleted_at IS NULL AND u.role = 'Student' AND en.enrollment_id IS NULL`,
    );
    expect(stranded.rows[0].n).toBe(0);
  });

  it("rolls back the enrollment too when the account is rejected", async () => {
    await register("dupe@dev.local");
    const second = await register("dupe@dev.local");
    expect(second.status).toBe(409);

    // Same transaction: one member, one enrollment. A failed signup must not
    // leave an orphan behind.
    const n = await testPool().query(
      `SELECT count(*)::int AS n FROM enrollments en
         JOIN users u ON u.user_id = en.user_id WHERE u.email = $1`,
      ["dupe@dev.local"],
    );
    expect(n.rows[0].n).toBe(1);
  });

  it("still lets a leader set a different start level afterwards", async () => {
    await register("starts-higher@dev.local");
    const u = await testPool().query(`SELECT user_id FROM users WHERE email = $1`, [
      "starts-higher@dev.local",
    ]);
    // Auto-enrolling at level 1 must not freeze anyone there — the portal's
    // start_set path still owns where a member actually begins.
    await testPool().query(
      `UPDATE enrollments SET start_level = 3, current_level = 3 WHERE user_id = $1`,
      [u.rows[0].user_id],
    );
    const after = await testPool().query(
      `SELECT current_level, start_level FROM enrollments WHERE user_id = $1`,
      [u.rows[0].user_id],
    );
    expect(after.rows[0].current_level).toBe(3);
    expect(after.rows[0].start_level).toBe(3);
  });
});
