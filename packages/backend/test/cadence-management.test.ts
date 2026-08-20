// Cadence management, and the absentee sweep (Mercy's second rule).
//
// The engine shipped with no way to create a cadence — the tables were empty
// and the To-call list could only ever read zero. These cover the editor
// endpoints and the daily sweep that arms missed_services, which matters
// because absence is the absence of an event: nothing fires on its own.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser, createChurchService } from "./helpers/factories.js";
import { agent, bearer } from "./helpers/app.js";
import { CadenceService } from "../src/modules/attendance/cadence.js";
import { serviceScanToken } from "../src/modules/attendance/service.js";
import { ChurchAttendanceService } from "../src/modules/attendance/service.js";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPool();
});

async function grantTeam(userId: string): Promise<void> {
  await testPool().query(
    `INSERT INTO rbac_user_roles (user_id, role_key) VALUES ($1, 'follow_up_team') ON CONFLICT DO NOTHING`,
    [userId],
  );
}

const CADENCE = {
  name: "First-time guest",
  trigger: "first_visit",
  steps: [
    { offset_days: 0, kind: "automated", channel: "push", action: "Welcome message", message: "So glad you came" },
    { offset_days: 1, kind: "human", action: "Welcome call" },
  ],
};

describe("creating and listing cadences", () => {
  it("creates a cadence with its steps and lists it back", async () => {
    const cong = await createCongregation();
    const leader = await createUser({ congregationId: cong, role: "Instructor", email: "l@dev.local" });
    await grantTeam(leader.user_id);
    const tok = bearer({ sub: leader.user_id, role: "Instructor", cong });

    const created = await agent().post("/v1/admin/follow-up/cadences").set("Authorization", tok).send(CADENCE);
    expect(created.status).toBe(201);

    const list = await agent().get("/v1/admin/follow-up/cadences").set("Authorization", tok);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].steps).toHaveLength(2);
    expect(list.body.data[0].open_runs).toBe(0);
  });

  it("rejects an automated step with no channel as a named 400, not a 500", async () => {
    const cong = await createCongregation();
    const leader = await createUser({ congregationId: cong, role: "Instructor", email: "l2@dev.local" });
    await grantTeam(leader.user_id);
    const res = await agent()
      .post("/v1/admin/follow-up/cadences")
      .set("Authorization", bearer({ sub: leader.user_id, role: "Instructor", cong }))
      .send({ ...CADENCE, steps: [{ offset_days: 0, kind: "automated", action: "Ghost step" }] });
    // The half-configured step that silently never sends — refused at the door.
    expect(res.status).toBe(400);
  });

  it("requires followUp:edit to create — view alone reads but cannot write", async () => {
    const cong = await createCongregation();
    const viewer = await createUser({ congregationId: cong, role: "Instructor", email: "v@dev.local" });
    await grantTeam(viewer.user_id);
    await testPool().query(
      `DELETE FROM rbac_role_permissions WHERE role_key = 'follow_up_team' AND capability = 'edit'`,
    );
    const tok = bearer({ sub: viewer.user_id, role: "Instructor", cong });
    expect((await agent().get("/v1/admin/follow-up/cadences").set("Authorization", tok)).status).toBe(200);
    expect((await agent().post("/v1/admin/follow-up/cadences").set("Authorization", tok).send(CADENCE)).status).toBe(403);
  });

  it("switching a cadence off stops new runs but leaves existing ones running", async () => {
    const cong = await createCongregation();
    const leader = await createUser({ congregationId: cong, role: "Instructor", email: "l3@dev.local" });
    await grantTeam(leader.user_id);
    const tok = bearer({ sub: leader.user_id, role: "Instructor", cong });
    const created = await agent().post("/v1/admin/follow-up/cadences").set("Authorization", tok).send(CADENCE);

    const svc = new CadenceService(testPool());
    const m1 = await createUser({ congregationId: cong, role: "Student", email: "m1@dev.local" });
    expect(await svc.arm(cong, m1.user_id, "first_visit")).not.toBeNull();

    await agent()
      .patch(`/v1/admin/follow-up/cadences/${created.body.cadence_id}`)
      .set("Authorization", tok)
      .send({ is_active: false })
      .expect(204);

    // New arming refused; the member already inside is not abandoned.
    const m2 = await createUser({ congregationId: cong, role: "Student", email: "m2@dev.local" });
    expect(await svc.arm(cong, m2.user_id, "first_visit")).toBeNull();
    const open = await testPool().query(
      `SELECT count(*)::int AS n FROM follow_up_runs WHERE user_id = $1 AND closed_at IS NULL`,
      [m1.user_id],
    );
    expect(open.rows[0].n).toBe(1);
  });
});

describe("the absentee sweep — Mercy's second rule", () => {
  /** Three weekly services, oldest first — created ONCE per test, because
   *  church_services enforces one service per slot per congregation. */
  async function threeSundays(cong: string): Promise<Array<{ service_id: string; qr_secret: string }>> {
    const out: Array<{ service_id: string; qr_secret: string }> = [];
    for (const weeksAgo of [3, 2, 1]) {
      const day = new Date(Date.now() - weeksAgo * 7 * 86_400_000);
      out.push(
        await createChurchService(cong, {
          title: `Sunday -${weeksAgo}w`,
          startsAt: day.toISOString(),
          serviceDate: day.toISOString().slice(0, 10),
        }),
      );
    }
    return out;
  }

  async function attend(cong: string, userId: string, s: { service_id: string; qr_secret: string }): Promise<void> {
    await new ChurchAttendanceService(testPool()).checkIn(
      { userId, congregationId: cong, role: "Student" } as never,
      s.service_id,
      { client_scan_id: crypto.randomUUID(), scan_token: serviceScanToken(s.qr_secret, s.service_id) },
    );
  }

  it("arms a member at the threshold, and not one below it", async () => {
    const cong = await createCongregation();
    await testPool().query(
      `INSERT INTO follow_up_cadences (congregation_id, name, trigger, trigger_threshold)
       VALUES ($1, 'Absent two Sundays', 'missed_services', 2)`,
      [cong],
    );
    const c = await testPool().query(`SELECT cadence_id FROM follow_up_cadences WHERE congregation_id = $1`, [cong]);
    await testPool().query(
      `INSERT INTO follow_up_cadence_steps (cadence_id, offset_days, kind, channel, action, sequence)
       VALUES ($1, 0, 'human', NULL, 'Check-in call', 1)`,
      [c.rows[0].cadence_id],
    );

    const sundays = await threeSundays(cong);
    const lapsed = await createUser({ congregationId: cong, role: "Student", email: "lapsed@dev.local" });
    const fresh = await createUser({ congregationId: cong, role: "Student", email: "fresh@dev.local" });
    await attend(cong, lapsed.user_id, sundays[0]!); // then missed 2 in a row
    await attend(cong, fresh.user_id, sundays[2]!);  // attended the latest

    const svc = new CadenceService(testPool());
    const { armed } = await svc.armAbsentees();
    expect(armed).toBe(1);

    const runs = await testPool().query(`SELECT user_id FROM follow_up_runs WHERE closed_at IS NULL`);
    expect(runs.rows.map((r) => r.user_id)).toEqual([lapsed.user_id]);
    expect(runs.rows.map((r) => r.user_id)).not.toContain(fresh.user_id);
  });

  it("never arms someone who has NEVER attended — that is a different register", async () => {
    const cong = await createCongregation();
    await testPool().query(
      `INSERT INTO follow_up_cadences (congregation_id, name, trigger, trigger_threshold)
       VALUES ($1, 'Absent two Sundays', 'missed_services', 1)`,
      [cong],
    );
    await createUser({ congregationId: cong, role: "Student", email: "never@dev.local" });
    await createChurchService(cong, {});

    const { armed } = await new CadenceService(testPool()).armAbsentees();
    // "Never attended" is the roll's own column and a different conversation —
    // a "we've missed you" message to someone who has never come reads as spam.
    expect(armed).toBe(0);
  });

  it("running the sweep twice does not double-chase", async () => {
    const cong = await createCongregation();
    await testPool().query(
      `INSERT INTO follow_up_cadences (congregation_id, name, trigger, trigger_threshold)
       VALUES ($1, 'Absent two Sundays', 'missed_services', 2)`,
      [cong],
    );
    const c = await testPool().query(`SELECT cadence_id FROM follow_up_cadences WHERE congregation_id = $1`, [cong]);
    await testPool().query(
      `INSERT INTO follow_up_cadence_steps (cadence_id, offset_days, kind, channel, action, sequence)
       VALUES ($1, 0, 'human', NULL, 'Check-in call', 1)`,
      [c.rows[0].cadence_id],
    );
    const sundays = await threeSundays(cong);
    const m = await createUser({ congregationId: cong, role: "Student", email: "twice@dev.local" });
    await attend(cong, m.user_id, sundays[0]!);

    const svc = new CadenceService(testPool());
    expect((await svc.armAbsentees()).armed).toBe(1);
    expect((await svc.armAbsentees()).armed).toBe(0);
  });
});
