// /me/notification-preferences — member channel toggles (iOS contract:
// push_enabled / email_enabled / sms_enabled). Defaults true/true/false when no
// row exists; PUT upserts all three and returns the saved shape.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";

let cong: string, me: string, meTok: string;
const auth = (t: string) => ({ Authorization: t });

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  me = (await createUser({ congregationId: cong, email: "me@dev.local" })).user_id;
  meTok = bearer({ sub: me, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

describe("/me/notification-preferences", () => {
  it("GET returns defaults (push+email on, sms off) when no row exists", async () => {
    const res = await agent().get("/v1/me/notification-preferences").set(auth(meTok));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ push_enabled: true, email_enabled: true, sms_enabled: false });
  });

  it("PUT upserts and round-trips through GET", async () => {
    const put = await agent()
      .put("/v1/me/notification-preferences")
      .set(auth(meTok))
      .send({ push_enabled: false, email_enabled: true, sms_enabled: true });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ push_enabled: false, email_enabled: true, sms_enabled: true });

    const get = await agent().get("/v1/me/notification-preferences").set(auth(meTok));
    expect(get.body).toEqual({ push_enabled: false, email_enabled: true, sms_enabled: true });

    // Second PUT updates the same row (no duplicate).
    const again = await agent()
      .put("/v1/me/notification-preferences")
      .set(auth(meTok))
      .send({ push_enabled: true, email_enabled: false, sms_enabled: false });
    expect(again.body).toEqual({ push_enabled: true, email_enabled: false, sms_enabled: false });
    const { rows } = await testPool().query(
      "SELECT count(*)::int n FROM notification_preferences WHERE user_id = $1",
      [me],
    );
    expect(rows[0].n).toBe(1);
  });

  it("PUT preserves quiet-hours / cap columns from the onboarding writer", async () => {
    await testPool().query(
      `INSERT INTO notification_preferences (user_id, push_enabled, email_enabled, quiet_from, quiet_to, max_daily)
       VALUES ($1, TRUE, TRUE, '20:00', '08:00', 5)`,
      [me],
    );
    await agent()
      .put("/v1/me/notification-preferences")
      .set(auth(meTok))
      .send({ push_enabled: false, email_enabled: false, sms_enabled: true });
    const { rows } = await testPool().query(
      "SELECT quiet_from::text, quiet_to::text, max_daily FROM notification_preferences WHERE user_id = $1",
      [me],
    );
    expect(rows[0]).toEqual({ quiet_from: "20:00:00", quiet_to: "08:00:00", max_daily: 5 });
  });

  it("PUT rejects a missing or non-boolean field (all three required)", async () => {
    const missing = await agent()
      .put("/v1/me/notification-preferences")
      .set(auth(meTok))
      .send({ push_enabled: true, email_enabled: true });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe("VALIDATION_FAILED");

    const wrongType = await agent()
      .put("/v1/me/notification-preferences")
      .set(auth(meTok))
      .send({ push_enabled: "yes", email_enabled: true, sms_enabled: false });
    expect(wrongType.status).toBe(400);
  });

  it("requires a session", async () => {
    const res = await agent().get("/v1/me/notification-preferences");
    expect(res.status).toBe(401);
  });
});
