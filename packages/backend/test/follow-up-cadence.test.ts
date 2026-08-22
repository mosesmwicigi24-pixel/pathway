// The follow-up cadence engine.
//
// A cadence is what happens after someone first visits, or stops coming: a
// sequence of touches, some sent by the system, some performed by a leader and
// then recorded. The failures that matter here are pastoral rather than
// technical — chasing someone who already came back, or messaging a family
// twice — so those are what these tests pin.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { CadenceService } from "../src/modules/attendance/cadence.js";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPool();
});

const svc = (): CadenceService => new CadenceService(testPool());

/** A cadence with one automated step (day 1) and one human step (day 2). */
async function seedCadence(
  congregationId: string,
  trigger = "first_visit",
): Promise<{ cadence_id: string; auto_step: string; human_step: string }> {
  const c = await testPool().query(
    `INSERT INTO follow_up_cadences (congregation_id, name, trigger)
     VALUES ($1, $2, $3) RETURNING cadence_id`,
    [congregationId, `Cadence ${trigger}`, trigger],
  );
  const cadenceId = c.rows[0].cadence_id;
  const a = await testPool().query(
    `INSERT INTO follow_up_cadence_steps (cadence_id, offset_days, kind, channel, action, message, sequence)
     VALUES ($1, 1, 'automated', 'push', 'Welcome message', 'Thank you for joining us', 1)
     RETURNING step_id`,
    [cadenceId],
  );
  const h = await testPool().query(
    `INSERT INTO follow_up_cadence_steps (cadence_id, offset_days, kind, channel, action, sequence)
     VALUES ($1, 2, 'human', NULL, 'Phone call', 2) RETURNING step_id`,
    [cadenceId],
  );
  return { cadence_id: cadenceId, auto_step: a.rows[0].step_id, human_step: h.rows[0].step_id };
}

describe("arming lays out the whole plan up front", () => {
  it("creates one event per step, with due dates computed from the trigger", async () => {
    const cong = await createCongregation();
    await seedCadence(cong);
    const u = await createUser({ congregationId: cong, role: "Student", email: "new@dev.local" });

    const armed = await svc().arm(cong, u.user_id, "first_visit");
    expect(armed?.steps).toBe(2);

    const rows = await testPool().query(
      `SELECT e.due_at, s.offset_days FROM follow_up_step_events e
         JOIN follow_up_cadence_steps s ON s.step_id = e.step_id
         JOIN follow_up_runs r ON r.run_id = e.run_id
        WHERE r.user_id = $1 ORDER BY s.sequence`,
      [u.user_id],
    );
    expect(rows.rowCount).toBe(2);
    // Laid out at arming time so the portal can answer "who is due this week"
    // with one indexed query, and a pastor can see the plan for a person.
    const gapDays = (new Date(rows.rows[1].due_at).getTime() - new Date(rows.rows[0].due_at).getTime()) / 86_400_000;
    expect(Math.round(gapDays)).toBe(1);
  });

  it("refuses to arm the same cadence twice for one member", async () => {
    const cong = await createCongregation();
    await seedCadence(cong);
    const u = await createUser({ congregationId: cong, role: "Student", email: "twice@dev.local" });

    expect(await svc().arm(cong, u.user_id, "first_visit")).not.toBeNull();
    // Double-arming is what sends a grieving family two "we missed you"
    // messages. The second is worse than none.
    expect(await svc().arm(cong, u.user_id, "first_visit")).toBeNull();

    const runs = await testPool().query(
      `SELECT count(*)::int AS n FROM follow_up_runs WHERE user_id = $1`, [u.user_id]);
    expect(runs.rows[0].n).toBe(1);
  });

  it("is a no-op, not an error, when no cadence is configured", async () => {
    const cong = await createCongregation();
    const u = await createUser({ congregationId: cong, role: "Student", email: "none@dev.local" });
    expect(await svc().arm(cong, u.user_id, "first_visit")).toBeNull();
  });
});

describe("advancing dispatches only what is due, and only automated steps", () => {
  it("leaves a human step alone even when overdue", async () => {
    const cong = await createCongregation();
    await seedCadence(cong);
    const u = await createUser({ congregationId: cong, role: "Student", email: "human@dev.local" });
    await svc().arm(cong, u.user_id, "first_visit", { at: Date.now() - 10 * 86_400_000 });

    await svc().advance();

    const human = await testPool().query(
      `SELECT e.completed_at FROM follow_up_step_events e
         JOIN follow_up_cadence_steps s ON s.step_id = e.step_id
        WHERE s.kind = 'human'`,
    );
    // A system that "completed" a phone call because a timer expired would be
    // lying to whoever reads the register.
    expect(human.rows[0].completed_at).toBeNull();
  });

  it("does not dispatch a step that is not yet due", async () => {
    const cong = await createCongregation();
    await seedCadence(cong);
    const u = await createUser({ congregationId: cong, role: "Student", email: "early@dev.local" });
    await svc().arm(cong, u.user_id, "first_visit");

    const res = await svc().advance();
    expect(res.dispatched).toBe(0);
  });

  it("claims a step before sending, so two workers cannot both send it", async () => {
    const cong = await createCongregation();
    await seedCadence(cong);
    const u = await createUser({ congregationId: cong, role: "Student", email: "race@dev.local" });
    await svc().arm(cong, u.user_id, "first_visit", { at: Date.now() - 10 * 86_400_000 });

    const [a, b] = await Promise.all([svc().advance(), svc().advance()]);
    // Exactly one of them may claim it. Better a message occasionally missed
    // than a bereaved family texted twice.
    expect(a.dispatched + b.dispatched).toBe(1);
  });
});

describe("coming back stops the chasing", () => {
  it("closes every open run when a member returns", async () => {
    const cong = await createCongregation();
    await seedCadence(cong, "missed_services");
    const u = await createUser({ congregationId: cong, role: "Student", email: "back@dev.local" });
    await svc().arm(cong, u.user_id, "missed_services");

    const closed = await svc().closeOpenRuns(u.user_id, "returned");
    expect(closed).toBe(1);

    // And nothing further fires for them.
    const res = await svc().advance(Date.now() + 30 * 86_400_000);
    expect(res.dispatched).toBe(0);
  });
});

describe("the leader's list and what they record", () => {
  it("shows human steps that are due, with how overdue they are", async () => {
    const cong = await createCongregation();
    await seedCadence(cong);
    const u = await createUser({ congregationId: cong, role: "Student", email: "due@dev.local" });
    await svc().arm(cong, u.user_id, "first_visit", { at: Date.now() - 10 * 86_400_000 });

    const due = await svc().dueForLeaders(cong);
    expect(due).toHaveLength(1);
    expect(due[0]!.action).toBe("Phone call");
    expect(due[0]!.days_overdue).toBeGreaterThanOrEqual(7);
  });

  it("keeps the outcome, not just that it was done", async () => {
    const cong = await createCongregation();
    await seedCadence(cong);
    const leader = await createUser({ congregationId: cong, role: "Instructor", email: "leader@dev.local" });
    const u = await createUser({ congregationId: cong, role: "Student", email: "called@dev.local" });
    await svc().arm(cong, u.user_id, "first_visit", { at: Date.now() - 10 * 86_400_000 });

    const due = await svc().dueForLeaders(cong);
    await svc().recordContact(due[0]!.event_id, leader.user_id, "no_answer", "Rang twice");

    const row = await testPool().query(
      `SELECT outcome, note, completed_by FROM follow_up_step_events WHERE event_id = $1`,
      [due[0]!.event_id],
    );
    // "No answer" is a different pastoral fact from "reached". A register that
    // only stores "done" cannot tell you which, so it cannot tell you who still
    // needs reaching.
    expect(row.rows[0].outcome).toBe("no_answer");
    expect(row.rows[0].note).toBe("Rang twice");
    expect(row.rows[0].completed_by).toBe(leader.user_id);

    expect(await svc().dueForLeaders(cong)).toHaveLength(0);
  });

  it("refuses to record the same step twice", async () => {
    const cong = await createCongregation();
    await seedCadence(cong);
    const leader = await createUser({ congregationId: cong, role: "Instructor", email: "l2@dev.local" });
    const u = await createUser({ congregationId: cong, role: "Student", email: "once@dev.local" });
    await svc().arm(cong, u.user_id, "first_visit", { at: Date.now() - 10 * 86_400_000 });

    const due = await svc().dueForLeaders(cong);
    await svc().recordContact(due[0]!.event_id, leader.user_id, "reached");
    await expect(svc().recordContact(due[0]!.event_id, leader.user_id, "reached")).rejects.toThrow();
  });

  it("does not leak another congregation's follow-ups", async () => {
    const mine = await createCongregation("Mine");
    const theirs = await createCongregation("Theirs");
    await seedCadence(theirs);
    const u = await createUser({ congregationId: theirs, role: "Student", email: "other@dev.local" });
    await svc().arm(theirs, u.user_id, "first_visit", { at: Date.now() - 10 * 86_400_000 });

    // §5.4 scoping: a leader sees their own congregation's flock, nobody else's.
    expect(await svc().dueForLeaders(mine)).toHaveLength(0);
    expect(await svc().dueForLeaders(theirs)).toHaveLength(1);
  });
});
