// Weekly service schedules (migration 203): rhythm → rows, so the standing
// QR poster never points at a Sunday nobody remembered to create.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser, createChurchService } from "./helpers/factories.js";
import { agent, bearer } from "./helpers/app.js";
import { ServiceScheduleService } from "../src/modules/attendance/schedule.js";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPool();
});

/** Tomorrow's EXTRACT(DOW), so every materialize test has an occurrence inside the horizon. */
function tomorrowDow(): number {
  return (new Date().getDay() + 1) % 7;
}

async function leaderToken(cong: string): Promise<string> {
  const leader = await createUser({ congregationId: cong, role: "Instructor", email: "sched@dev.local" });
  return bearer({ sub: leader.user_id, role: "Instructor", cong });
}

describe("declaring a rhythm", () => {
  it("creates the schedule AND its nearest occurrence in one motion", async () => {
    const cong = await createCongregation();
    const tok = await leaderToken(cong);

    const res = await agent().post("/v1/admin/service-schedules").set("Authorization", tok).send({
      title: "Sunday Service",
      day_of_week: tomorrowDow(),
      starts_time: "09:00",
    });
    expect(res.status).toBe(201);
    expect(res.body.is_active).toBe(true);

    // The nearest occurrence already exists — created by the declare itself,
    // not left waiting for tomorrow's cron.
    const { rows } = await testPool().query(
      `SELECT title, qr_enabled, checkin_opens_at IS NOT NULL AS has_window,
              length(qr_secret) AS secret_len
         FROM church_services WHERE congregation_id = $1`,
      [cong],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Sunday Service");
    expect(rows[0].qr_enabled).toBe(true);
    expect(rows[0].has_window).toBe(true);
    expect(rows[0].secret_len).toBe(64);
  });

  it("declaring the same rhythm twice is a named conflict", async () => {
    const cong = await createCongregation();
    const tok = await leaderToken(cong);
    const body = { title: "Sunday Service", day_of_week: tomorrowDow(), starts_time: "09:00" };
    await agent().post("/v1/admin/service-schedules").set("Authorization", tok).send(body);
    const dup = await agent().post("/v1/admin/service-schedules").set("Authorization", tok).send(body);
    expect(dup.status).toBe(409);
  });
});

describe("materialization is idempotent and respectful of humans", () => {
  it("running twice creates each occurrence once", async () => {
    const cong = await createCongregation();
    const tok = await leaderToken(cong);
    await agent().post("/v1/admin/service-schedules").set("Authorization", tok).send({
      title: "Sunday Service",
      day_of_week: tomorrowDow(),
      starts_time: "09:00",
    });

    const svc = new ServiceScheduleService(testPool());
    const secondRun = await svc.materialize();
    expect(secondRun).toBe(0);

    const { rows } = await testPool().query(
      `SELECT count(*)::int AS n FROM church_services WHERE congregation_id = $1`,
      [cong],
    );
    expect(rows[0].n).toBe(1);
  });

  it("a hand-created service IS that week's occurrence — the schedule steps aside", async () => {
    const cong = await createCongregation();
    const tomorrow = new Date(Date.now() + 86_400_000);
    // The human got there first, with their own times and their own secret.
    await createChurchService(cong, {
      title: "Sunday Service",
      serviceDate: tomorrow.toISOString().slice(0, 10),
      startsAt: tomorrow.toISOString(),
      qrSecret: "hand-made-secret",
    });

    const tok = await leaderToken(cong);
    await agent().post("/v1/admin/service-schedules").set("Authorization", tok).send({
      title: "Sunday Service",
      day_of_week: tomorrow.getDay(),
      starts_time: "09:00",
    });

    const { rows } = await testPool().query(
      `SELECT qr_secret FROM church_services WHERE congregation_id = $1`,
      [cong],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].qr_secret).toBe("hand-made-secret");
  });

  it("a paused rhythm materializes nothing", async () => {
    const cong = await createCongregation();
    const tok = await leaderToken(cong);
    const created = await agent().post("/v1/admin/service-schedules").set("Authorization", tok).send({
      title: "Sunday Service",
      day_of_week: tomorrowDow(),
      starts_time: "09:00",
    });
    await agent()
      .patch(`/v1/admin/service-schedules/${created.body.schedule_id}`)
      .set("Authorization", tok)
      .send({ is_active: false });
    // Wipe the occurrence the declare created, then re-materialize: paused
    // rhythm, no new rows.
    await testPool().query(`DELETE FROM church_services WHERE congregation_id = $1`, [cong]);
    const n = await new ServiceScheduleService(testPool()).materialize();
    const { rows } = await testPool().query(
      `SELECT count(*)::int AS n FROM church_services WHERE congregation_id = $1`,
      [cong],
    );
    expect(n).toBe(0);
    expect(rows[0].n).toBe(0);
  });

  it("occurrence times honor the congregation's timezone", async () => {
    const cong = await createCongregation();
    await testPool().query(`UPDATE congregations SET timezone = 'Africa/Nairobi' WHERE congregation_id = $1`, [cong]);
    const tok = await leaderToken(cong);
    await agent().post("/v1/admin/service-schedules").set("Authorization", tok).send({
      title: "Sunday Service",
      day_of_week: tomorrowDow(),
      starts_time: "09:00",
      checkin_opens_minutes: 45,
      checkin_closes_minutes: 240,
    });
    // 09:00 Nairobi is 06:00 UTC (no DST there, ever — which is why the
    // column stores local time and the conversion happens per-date).
    const { rows } = await testPool().query(
      `SELECT to_char(starts_at AT TIME ZONE 'UTC', 'HH24:MI') AS utc_start,
              to_char(checkin_opens_at AT TIME ZONE 'UTC', 'HH24:MI') AS utc_opens,
              to_char(checkin_closes_at AT TIME ZONE 'UTC', 'HH24:MI') AS utc_closes
         FROM church_services WHERE congregation_id = $1`,
      [cong],
    );
    expect(rows[0]).toEqual({ utc_start: "06:00", utc_opens: "05:15", utc_closes: "10:00" });
  });
});
