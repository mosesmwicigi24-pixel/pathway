// Relational integrity between a member and the rest of the system
// (migration 190, 2026-08-13 architectural audit).
//
// A member's congregation is set by joining a cell during onboarding.
// Between registering and choosing, users.congregation_id is NULL — and
// congregation-scoped code read that NULL and returned nothing, so the daily
// liturgy fell back to a hardcoded string: no scripture spine, no teaching
// quote, no pastor's voice. On production that was 28 of 76 signed-in users.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser, createCellGroup, createLeaderAssignment } from "./helpers/factories.js";
import { agent, bearer } from "./helpers/app.js";
import { LiturgyService, FALLBACK_LITURGY, bandOf } from "../src/modules/intelligence/liturgy.js";
import { FakeAiProvider } from "../src/modules/assistant/provider.js";

const svc = (): LiturgyService => new LiturgyService(testPool(), new FakeAiProvider());

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPool();
});

describe("the unplaced member still gets a real liturgy", () => {
  it("reads the default congregation's composed day, not the hardcoded fallback", async () => {
    const home = await createCongregation();
    await testPool().query(`UPDATE congregations SET is_default = true WHERE congregation_id = $1`, [home]);

    const now = new Date();
    // Compose the real day for the default congregation first, so there is
    // something distinguishable to inherit.
    await svc().composeFor(home, now);

    const unplaced = await svc().current(null, now);
    const placed = await svc().current(home, now);

    expect(unplaced.line).toBe(placed.line);
    expect(unplaced.line).not.toBe(FALLBACK_LITURGY[bandOf(now)].line);
  });

  it("inherits the pastor's recording for the current band", async () => {
    const home = await createCongregation();
    await testPool().query(`UPDATE congregations SET is_default = true WHERE congregation_id = $1`, [home]);
    const band = bandOf(new Date());
    await testPool().query(
      `INSERT INTO liturgy_recordings (congregation_id, band, audio_url, duration_sec)
       VALUES ($1, $2, 'https://example.test/media/liturgy_x.m4a', 42)`,
      [home, band],
    );

    const unplaced = await svc().current(null);
    expect(unplaced.recorded_audio_url).toBe("https://example.test/media/liturgy_x.m4a");
    expect(unplaced.recorded_audio_duration_sec).toBe(42);
  });

  it("falls back to the hardcoded liturgy when NO congregation is marked default", async () => {
    await createCongregation(); // exists, but not default
    const now = new Date();
    const out = await svc().current(null, now);
    expect(out.line).toBe(FALLBACK_LITURGY[bandOf(now)].line);
  });

  it("reading the default congregation's content does NOT make you a member of it", async () => {
    const home = await createCongregation();
    await testPool().query(`UPDATE congregations SET is_default = true WHERE congregation_id = $1`, [home]);
    const u = await createUser({ role: "Student", email: "unplaced@dev.local" });

    await svc().current(null);

    // The whole point of the fix: corporate content is shared, membership is not.
    // If this ever flips, an unplaced member starts appearing in a roster and in
    // scoped feeds they never joined — a §5.4 scoping break, not a feature.
    const row = await testPool().query(`SELECT congregation_id FROM users WHERE user_id = $1`, [u.user_id]);
    expect(row.rows[0].congregation_id).toBeNull();
  });
});

describe("only one congregation can be the default", () => {
  it("marking a second one fails loudly instead of leaving two candidates", async () => {
    const a = await createCongregation();
    const b = await createCongregation();
    await testPool().query(`UPDATE congregations SET is_default = true WHERE congregation_id = $1`, [a]);
    await expect(
      testPool().query(`UPDATE congregations SET is_default = true WHERE congregation_id = $1`, [b]),
    ).rejects.toThrow();
  });
});

describe("email uniqueness matches what registration believes", () => {
  it("a soft-deleted account frees its email for a returning member", async () => {
    const cong = await createCongregation();
    const first = await createUser({ congregationId: cong, role: "Student", email: "returning@dev.local" });
    await testPool().query(`UPDATE users SET deleted_at = now() WHERE user_id = $1`, [first.user_id]);

    // IdentityService.register() checks `email = $1 AND deleted_at IS NULL` and
    // concludes the address is free. Before migration 190 the unique index
    // spanned every row, so the insert then died on a raw 23505 and the member
    // was told an account exists that they can neither see nor recover.
    await expect(
      createUser({ congregationId: cong, role: "Student", email: "returning@dev.local" }),
    ).resolves.toBeTruthy();
  });

  it("still refuses a duplicate among LIVE accounts", async () => {
    const cong = await createCongregation();
    await createUser({ congregationId: cong, role: "Student", email: "taken@dev.local" });
    await expect(
      createUser({ congregationId: cong, role: "Student", email: "taken@dev.local" }),
    ).rejects.toThrow();
  });
});

describe("cell is the noun; cohort still resolves for shipped clients", () => {
  it("/cells/:id/members and /cohorts/:id/members are the same endpoint", async () => {
    const cong = await createCongregation();
    const cell = await createCellGroup(cong);
    const leader = await createUser({ congregationId: cong, role: "Instructor", email: "leader@dev.local" });
    await createLeaderAssignment(leader.user_id, cell);
    const tok = bearer({ sub: leader.user_id, role: "Instructor", cong });

    const canonical = await agent().get(`/v1/cells/${cell}/members`).set("Authorization", tok);
    const legacy = await agent().get(`/v1/cohorts/${cell}/members`).set("Authorization", tok);

    expect(canonical.status).toBe(200);
    // The alias is not decoration: an iPad build already on a device calls it.
    expect(legacy.status).toBe(200);
    expect(legacy.body).toEqual(canonical.body);
  });

  it("the dashboard ships cells_running AND the old key, with the same value", async () => {
    const cong = await createCongregation();
    await createCellGroup(cong, "Cell A");
    await createCellGroup(cong, "Cell B");
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "admin@dev.local" });

    const res = await agent()
      .get("/v1/admin/reports/overview")
      .set("Authorization", bearer({ sub: admin.user_id, role: "Admin", cong }));

    expect(res.status).toBe(200);
    expect(res.body.cells_running).toBe(2);
    expect(res.body.cohorts_running).toBe(res.body.cells_running);
  });
});

describe("liturgy is composed only where someone can read it", () => {
  it("skips a congregation with no members", async () => {
    const populated = await createCongregation("Populated");
    const empty = await createCongregation("Empty");
    await createUser({ congregationId: populated, role: "Student", email: "reader@dev.local" });

    const n = await svc().composeAll();

    // An empty congregation had accumulated 142 composed liturgies on
    // production — 49% of all composition, every one a paid model call that
    // nobody could open.
    expect(n).toBe(1);
    const rows = await testPool().query(`SELECT congregation_id FROM liturgies WHERE congregation_id = $1`, [empty]);
    expect(rows.rowCount).toBe(0);
  });

  it("still composes the DEFAULT congregation when it has no members of its own", async () => {
    const home = await createCongregation("Default but empty");
    await testPool().query(`UPDATE congregations SET is_default = true WHERE congregation_id = $1`, [home]);

    // "No members" is not "no readers": every unplaced member reads from here.
    const n = await svc().composeAll();
    expect(n).toBe(1);
  });
});
