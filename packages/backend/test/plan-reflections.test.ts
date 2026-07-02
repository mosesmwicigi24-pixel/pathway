// Plan-day reflections — POST upserts per (user, plan, day); client_mutation_id
// replays are no-ops returning the stored row (§2.1); GET returns row-or-null;
// unknown plan 404s. (iOS contract — field names are fixed.)
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";

let cong: string, me: string, meTok: string, plan: string;
const auth = (t: string) => ({ Authorization: t });
const path = (planId: string, day: number) => `/v1/growth/plans/${planId}/days/${day}/reflection`;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  me = (await createUser({ congregationId: cong, email: "me@dev.local" })).user_id;
  meTok = bearer({ sub: me, role: "Student", cong });
  const { rows } = await testPool().query<{ plan_id: string }>(
    `INSERT INTO reading_plans (code, title, day_count) VALUES ('rooted-t', 'Rooted', 10) RETURNING plan_id`,
  );
  plan = rows[0]!.plan_id;
});
afterAll(async () => {
  await closeTestPool();
});

describe("plan-day reflections", () => {
  it("creates, then upserts on resubmit (same row, new body, bumped updated_at)", async () => {
    const first = await agent().post(path(plan, 3)).set(auth(meTok)).send({ body: "First thoughts" });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ plan_id: plan, day_number: 3, body: "First thoughts" });
    expect(typeof first.body.id).toBe("string");
    expect(typeof first.body.created_at).toBe("string");

    const second = await agent().post(path(plan, 3)).set(auth(meTok)).send({ body: "Revised thoughts" });
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id); // same (user, plan, day) row
    expect(second.body.body).toBe("Revised thoughts");
    expect(new Date(second.body.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(first.body.updated_at).getTime(),
    );

    const { rows } = await testPool().query("SELECT count(*)::int n FROM reading_plan_day_reflections");
    expect(rows[0].n).toBe(1);
  });

  it("client_mutation_id replay is a no-op returning the existing row", async () => {
    const first = await agent()
      .post(path(plan, 1))
      .set(auth(meTok))
      .send({ body: "Day one", client_mutation_id: "cmid-1" });
    expect(first.status).toBe(201);

    const replay = await agent()
      .post(path(plan, 1))
      .set(auth(meTok))
      .send({ body: "SHOULD NOT REPLACE", client_mutation_id: "cmid-1" });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.body.body).toBe("Day one"); // replay did not overwrite
    expect(replay.body.updated_at).toBe(first.body.updated_at);
  });

  it("GET returns the row, or null when nothing was written", async () => {
    const empty = await agent().get(path(plan, 5)).set(auth(meTok));
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ data: null });

    await agent().post(path(plan, 5)).set(auth(meTok)).send({ body: "Selah" });
    const filled = await agent().get(path(plan, 5)).set(auth(meTok));
    expect(filled.body.data).toMatchObject({ plan_id: plan, day_number: 5, body: "Selah" });
  });

  it("reflections are per-member — another user's day is separate", async () => {
    const other = await createUser({ congregationId: cong, email: "other@dev.local" });
    const otherTok = bearer({ sub: other.user_id, role: "Student", cong });
    await agent().post(path(plan, 2)).set(auth(meTok)).send({ body: "mine" });
    const theirs = await agent().get(path(plan, 2)).set(auth(otherTok));
    expect(theirs.body).toEqual({ data: null });
  });

  it("404s an unknown plan on both verbs", async () => {
    const ghost = "00000000-0000-4000-8000-00000000dead";
    const post = await agent().post(path(ghost, 1)).set(auth(meTok)).send({ body: "x" });
    expect(post.status).toBe(404);
    expect(post.body.error.code).toBe("NOT_FOUND");
    const get = await agent().get(path(ghost, 1)).set(auth(meTok));
    expect(get.status).toBe(404);
  });

  it("validates the body (1..4000 chars) and day number", async () => {
    const empty = await agent().post(path(plan, 1)).set(auth(meTok)).send({ body: "" });
    expect(empty.status).toBe(400);
    const tooLong = await agent().post(path(plan, 1)).set(auth(meTok)).send({ body: "x".repeat(4001) });
    expect(tooLong.status).toBe(400);
    const badDay = await agent().post(path(plan, 0)).set(auth(meTok)).send({ body: "x" });
    expect(badDay.status).toBe(400);
  });
});
