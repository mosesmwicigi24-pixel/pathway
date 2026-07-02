// Manual password reset from the portal (§5.5): server-minted temporary
// password, session revocation, rank guard, and audit trail.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser } from "./helpers/factories.js";
import { AdminOpsService } from "../src/modules/adminops/service.js";
import { verifyPassword } from "../src/modules/identity/passwords.js";

const svc = () => new AdminOpsService(testPool());

describe("resetMemberPassword", () => {
  let memberId: string;
  let adminId: string;
  let otherAdminId: string;

  beforeEach(async () => {
    await resetDb();
    const cong = await createCongregation();
    const cell = await createCellGroup(cong);
    memberId = (await createUser({ congregationId: cong, cellGroupId: cell })).user_id;
    adminId = (await createUser({ congregationId: cong, fullName: "Admin One", phone: "+254700000001", role: "Admin" })).user_id;
    otherAdminId = (await createUser({ congregationId: cong, fullName: "Admin Two", phone: "+254700000002", role: "Admin" })).user_id;
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("mints a temporary password that verifies against the stored hash", async () => {
    const r = await svc().resetMemberPassword({ userId: adminId, role: "Admin" }, memberId);
    expect(r.temporary_password).toMatch(/^Nuru-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
    expect(r.full_name).toBe("Test Member");
    const { rows } = await testPool().query<{ password_hash: string; failed_login_count: number; locked_until: string | null }>(
      `SELECT password_hash, failed_login_count, locked_until FROM users WHERE user_id = $1`,
      [memberId],
    );
    expect(await verifyPassword(rows[0]!.password_hash, r.temporary_password)).toBe(true);
    expect(rows[0]!.failed_login_count).toBe(0);
    expect(rows[0]!.locked_until).toBeNull();
  });

  it("revokes every live refresh token and writes an audit row", async () => {
    await testPool().query(
      `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at) VALUES ($1, 'h1', gen_random_uuid(), now() + interval '7 days')`,
      [memberId],
    );
    await svc().resetMemberPassword({ userId: adminId, role: "Admin" }, memberId);
    const live = await testPool().query(
      `SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`,
      [memberId],
    );
    expect(live.rows[0]!.n).toBe(0);
    const auditRow = await testPool().query(
      `SELECT actor_id FROM audit_log WHERE action = 'member.password_reset' AND entity_id = $1`,
      [memberId],
    );
    expect(auditRow.rows[0]!.actor_id).toBe(adminId);
  });

  it("refuses peers and higher roles unless the actor is SuperAdmin", async () => {
    await expect(
      svc().resetMemberPassword({ userId: adminId, role: "Admin" }, otherAdminId),
    ).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    // SuperAdmin can reset anyone, admins included.
    const r = await svc().resetMemberPassword({ userId: adminId, role: "SuperAdmin" }, otherAdminId);
    expect(r.temporary_password).toMatch(/^Nuru-/);
  });

  it("404s an unknown or deleted member", async () => {
    await expect(
      svc().resetMemberPassword({ userId: adminId, role: "Admin" }, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
