// The unplaced-member rule (2026-08-21). Found on production: a self-registered
// account elevated to staff had congregation_id NULL, and the login path minted
// cong:"" into the JWT — which reached uuid-typed SQL as
// `invalid input syntax for type uuid: ""`, a 500 on every congregation-scoped
// route. The rule that closes the class: READS with a null congregation come
// back EMPTY (an unplaced member has nothing scoped to see), WRITES get a named
// refusal, and no congregation must never widen into every congregation.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation } from "./helpers/factories.js";
import { agent, bearer } from "./helpers/app.js";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPool();
});

async function unplacedInstructor(): Promise<string> {
  const { rows } = await testPool().query<{ user_id: string }>(
    `INSERT INTO users (full_name, email, role) VALUES ('Unplaced Staff', 'unplaced@dev.local', 'Instructor')
     RETURNING user_id`,
  );
  const userId = rows[0]!.user_id;
  // The follow-up permission the production account holds — being unplaced is
  // about the congregation, not the role grant.
  await testPool().query(
    `INSERT INTO rbac_user_roles (user_id, role_key) VALUES ($1, 'follow_up_team') ON CONFLICT DO NOTHING`,
    [userId],
  );
  return userId;
}

describe("an unplaced staff member: empty reads, named write refusals, never a 500", () => {
  it("the follow-up screens load empty instead of erroring", async () => {
    const userId = await unplacedInstructor();
    const tok = bearer({ sub: userId, role: "Instructor", cong: null });

    const due = await agent().get("/v1/admin/follow-up/due").set("Authorization", tok);
    expect(due.status).toBe(200);
    expect(due.body.data).toEqual([]);

    const cadences = await agent().get("/v1/admin/follow-up/cadences").set("Authorization", tok);
    expect(cadences.status).toBe(200);
    expect(cadences.body.data).toEqual([]);
  });

  it("creating congregation-scoped state is refused by name, not by stack trace", async () => {
    const userId = await unplacedInstructor();
    const res = await agent()
      .post("/v1/admin/follow-up/cadences")
      .set("Authorization", bearer({ sub: userId, role: "Instructor", cong: null }))
      .send({
        name: "Orphan cadence",
        trigger: "first_visit",
        steps: [{ offset_days: 0, kind: "human", action: "Call" }],
      });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain("not placed in a congregation");
  });

  it("a legacy token still carrying cong:\"\" is treated as unplaced, not as a uuid", async () => {
    // Tokens minted before this fix carry the empty string for up to their
    // TTL; the middleware maps them to null rather than letting them reach SQL.
    const userId = await unplacedInstructor();
    const res = await agent()
      .get("/v1/admin/follow-up/due")
      .set("Authorization", bearer({ sub: userId, role: "Instructor", cong: "" }));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("no congregation never means every congregation", async () => {
    // A placed congregation has a featured announcement; an unplaced member
    // must NOT see it — only global (congregation-less) announcements reach
    // someone the church has not placed yet.
    const cong = await createCongregation();
    const userId = await unplacedInstructor();
    await testPool().query(
      `INSERT INTO announcements (congregation_id, title, body, status, is_featured, sent_at, channels, audience_kind, created_by)
       VALUES ($1, 'Branch news', 'local', 'sent', true, now(), '{banner}', 'all', $2)`,
      [cong, userId],
    );
    const res = await agent()
      .get("/v1/home/featured-announcement")
      .set("Authorization", bearer({ sub: userId, role: "Instructor", cong: null }));
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });
});
