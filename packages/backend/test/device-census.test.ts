// The device census must stay one row per (user, platform, model): clients
// register on EVERY app launch, so registration is an upsert that refreshes
// app_version/last_seen_at rather than accumulating a row per launch.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { agent, bearer } from "./helpers/app.js";
import { createCongregation, createUser } from "./helpers/factories.js";

let tok: string, userId: string;

beforeEach(async () => {
  await resetDb();
  const cong = await createCongregation();
  userId = (await createUser({ congregationId: cong, fullName: "Devi Device" })).user_id;
  tok = bearer({ sub: userId, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

describe("device census", () => {
  it("re-registration updates the one row instead of accumulating", async () => {
    const a = await agent().post("/v1/me/devices").set("Authorization", tok)
      .send({ platform: "ios", app_version: "1.1+54", model: "iPhone18,2" });
    expect(a.status).toBe(201);
    const b = await agent().post("/v1/me/devices").set("Authorization", tok)
      .send({ platform: "ios", app_version: "1.1+55", model: "iPhone18,2" });
    expect(b.status).toBe(201);

    const rows = await testPool().query(
      `SELECT app_version, last_seen_at FROM client_devices WHERE user_id = $1`, [userId]);
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].app_version).toBe("1.1+55");
    expect(rows.rows[0].last_seen_at).not.toBeNull();
  });

  it("null-model registrations dedupe too (COALESCE sentinel)", async () => {
    await agent().post("/v1/me/devices").set("Authorization", tok).send({ platform: "android" });
    await agent().post("/v1/me/devices").set("Authorization", tok).send({ platform: "android" });
    const rows = await testPool().query(
      `SELECT count(*)::int AS n FROM client_devices WHERE user_id = $1`, [userId]);
    expect(rows.rows[0].n).toBe(1);
  });
});
