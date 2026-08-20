// The Follow-up role (migration 198).
//
// Owner ruling, 2026-08-17: follow-up is its own section of the portal and only
// users holding a follow-up role may see it.
//
// Until now Services and Follow-up were gated on members:view, reasoning that it
// is the same people seen through attendance rather than the register. That was
// wrong for this church. The call list is names, phone numbers, missed services
// and what was said on the last call — a distinct pastoral job, often done by
// people who have no business editing the roll. These tests hold that line.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { agent, bearer } from "./helpers/app.js";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPool();
});

async function grant(userId: string, roleKey: string): Promise<void> {
  await testPool().query(
    `INSERT INTO rbac_user_roles (user_id, role_key) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, roleKey],
  );
}

describe("the followUp module exists and is held by the right roles", () => {
  it("creates a follow_up_team role that holds followUp and nothing else", async () => {
    const role = await testPool().query(`SELECT name FROM rbac_roles WHERE role_key = 'follow_up_team'`);
    expect(role.rowCount).toBe(1);

    const mods = await testPool().query(
      `SELECT DISTINCT module_id FROM rbac_role_permissions WHERE role_key = 'follow_up_team'`,
    );
    // The whole point: safe to hand out widely because it grants one section.
    expect(mods.rows.map((r) => r.module_id)).toEqual(["followUp"]);
  });

  it("gives the senior roles the section too", async () => {
    // A pastor who could not see their own follow-up list would be an absurdity.
    for (const role of ["super_admin", "national_director", "pastoral_reviewer", "discipler"]) {
      const r = await testPool().query(
        `SELECT 1 FROM rbac_role_permissions WHERE role_key = $1 AND module_id = 'followUp' AND capability = 'view'`,
        [role],
      );
      expect(r.rowCount, `${role} should hold followUp:view`).toBe(1);
    }
  });

  it("does NOT give it to roles whose job is elsewhere", async () => {
    for (const role of ["finance_officer", "curriculum_editor", "member"]) {
      const r = await testPool().query(
        `SELECT 1 FROM rbac_role_permissions WHERE role_key = $1 AND module_id = 'followUp'`,
        [role],
      );
      expect(r.rowCount, `${role} should not hold followUp`).toBe(0);
    }
  });
});

describe("the endpoints enforce it", () => {
  it("lets a follow_up_team member work the call list", async () => {
    const cong = await createCongregation();
    const u = await createUser({ congregationId: cong, role: "Instructor", email: "team@dev.local" });
    await grant(u.user_id, "follow_up_team");

    const res = await agent()
      .get("/v1/admin/follow-up/due")
      .set("Authorization", bearer({ sub: u.user_id, role: "Instructor", cong }));
    expect(res.status).toBe(200);
  });

  it("refuses an Instructor who does not hold the role", async () => {
    const cong = await createCongregation();
    const u = await createUser({ congregationId: cong, role: "Instructor", email: "nope@dev.local" });

    // Being staff is no longer enough. This is the change: the old gate was
    // requireRole("Instructor"), which let every leader read the call list.
    const res = await agent()
      .get("/v1/admin/follow-up/due")
      .set("Authorization", bearer({ sub: u.user_id, role: "Instructor", cong }));
    expect(res.status).toBe(403);
  });

  it("refuses a plain member outright", async () => {
    const cong = await createCongregation();
    const u = await createUser({ congregationId: cong, role: "Student", email: "member@dev.local" });
    const res = await agent()
      .get("/v1/admin/follow-up/due")
      .set("Authorization", bearer({ sub: u.user_id, role: "Student", cong }));
    expect(res.status).toBe(403);
  });

  it("separates reading the list from closing a call", async () => {
    const cong = await createCongregation();
    const u = await createUser({ congregationId: cong, role: "Instructor", email: "readonly@dev.local" });
    await grant(u.user_id, "follow_up_team");
    // Strip the edit half, keep view: a leader compiling reports is not
    // necessarily the person who should be marking calls as made.
    await testPool().query(
      `DELETE FROM rbac_role_permissions WHERE role_key = 'follow_up_team' AND capability = 'edit'`,
    );

    const tok = bearer({ sub: u.user_id, role: "Instructor", cong });
    expect((await agent().get("/v1/admin/follow-up/due").set("Authorization", tok)).status).toBe(200);
    const write = await agent()
      .post("/v1/admin/follow-up/due/00000000-0000-0000-0000-000000000000")
      .set("Authorization", tok)
      .send({ outcome: "reached" });
    expect(write.status).toBe(403);
  });
});
