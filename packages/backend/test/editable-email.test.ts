// Email is editable (owner ruling, 2026-08-14: the assigned identifier is
// user_id; everything else may change).
//
// It was previously withheld as "the login identity". But a credential a member
// cannot correct is a trap rather than a safeguard — people mistype an address
// at signup, or lose the mailbox. The care is in what happens AROUND the edit:
// it must stay unique among live accounts, it must still work as a login, and
// it must leave a trail, because whoever changes it changes who can get in.
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

const rowVersion = async (userId: string): Promise<number> => {
  const r = await testPool().query(`SELECT row_version FROM users WHERE user_id = $1`, [userId]);
  return r.rows[0].row_version;
};

describe("a member can correct their own email", () => {
  it("saves the new address", async () => {
    const cong = await createCongregation();
    const u = await createUser({ congregationId: cong, role: "Student", email: "typo@dev.local" });

    const res = await agent()
      .patch("/v1/me")
      .set("Authorization", bearer({ sub: u.user_id, role: "Student", cong }))
      .send({ email: "correct@dev.local", row_version: await rowVersion(u.user_id) });

    expect(res.status).toBeLessThan(300);
    const row = await testPool().query(`SELECT email FROM users WHERE user_id = $1`, [u.user_id]);
    expect(row.rows[0].email).toBe("correct@dev.local");
  });

  it("normalises it the way the login path reads it", async () => {
    const cong = await createCongregation();
    const u = await createUser({ congregationId: cong, role: "Student", email: "before@dev.local" });

    const res = await agent()
      .patch("/v1/me")
      .set("Authorization", bearer({ sub: u.user_id, role: "Student", cong }))
      .send({ email: "  Moses@Dev.Local  ", row_version: await rowVersion(u.user_id) });
    // Assert the request SUCCEEDED before asserting what it stored — otherwise a
    // 400 surfaces as a confusing "email unchanged" mismatch.
    expect(res.status).toBeLessThan(300);

    // Otherwise a member types their address with a capital and can never sign
    // in again — the edit would have locked them out of their own account.
    const row = await testPool().query(`SELECT email FROM users WHERE user_id = $1`, [u.user_id]);
    expect(row.rows[0].email).toBe("moses@dev.local");
  });
});

describe("it cannot be used to take someone else's address", () => {
  it("refuses an address a live account already holds", async () => {
    const cong = await createCongregation();
    const mine = await createUser({ congregationId: cong, role: "Student", email: "mine@dev.local" });
    await createUser({ congregationId: cong, role: "Student", email: "theirs@dev.local" });

    const res = await agent()
      .patch("/v1/me")
      .set("Authorization", bearer({ sub: mine.user_id, role: "Student", cong }))
      .send({ email: "theirs@dev.local", row_version: await rowVersion(mine.user_id) });

    // A named 409, not a raw constraint violation leaking out as a 500.
    expect(res.status).toBe(409);
    const row = await testPool().query(`SELECT email FROM users WHERE user_id = $1`, [mine.user_id]);
    expect(row.rows[0].email).toBe("mine@dev.local");
  });

  it("DOES allow an address only a retired account holds", async () => {
    const cong = await createCongregation();
    const gone = await createUser({ congregationId: cong, role: "Student", email: "freed@dev.local" });
    await testPool().query(`UPDATE users SET deleted_at = now() WHERE user_id = $1`, [gone.user_id]);
    const u = await createUser({ congregationId: cong, role: "Student", email: "current@dev.local" });

    // Migration 190 made the unique index partial on live rows precisely so a
    // member who left can come back — or hand their address on.
    const res = await agent()
      .patch("/v1/me")
      .set("Authorization", bearer({ sub: u.user_id, role: "Student", cong }))
      .send({ email: "freed@dev.local", row_version: await rowVersion(u.user_id) });
    expect(res.status).toBeLessThan(300);
  });
});

describe("the change leaves a trail", () => {
  it("records who changed it, from what, to what", async () => {
    const cong = await createCongregation();
    const u = await createUser({ congregationId: cong, role: "Student", email: "old@dev.local" });

    await agent()
      .patch("/v1/me")
      .set("Authorization", bearer({ sub: u.user_id, role: "Student", cong }))
      .send({ email: "new@dev.local", row_version: await rowVersion(u.user_id) });

    // Changing this changes who can sign in. If it was not the member who did
    // it, the audit row is the only way anyone ever finds out.
    const log = await testPool().query(
      `SELECT metadata FROM audit_log WHERE action = 'user.email_changed' AND entity_id = $1`,
      [u.user_id],
    );
    expect(log.rowCount).toBe(1);
    expect(log.rows[0].metadata.from).toBe("old@dev.local");
    expect(log.rows[0].metadata.to).toBe("new@dev.local");
  });

  it("does not log a no-op re-save of the same address", async () => {
    const cong = await createCongregation();
    const u = await createUser({ congregationId: cong, role: "Student", email: "same@dev.local" });

    await agent()
      .patch("/v1/me")
      .set("Authorization", bearer({ sub: u.user_id, role: "Student", cong }))
      .send({ email: "same@dev.local", full_name: "Renamed", row_version: await rowVersion(u.user_id) });

    const log = await testPool().query(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'user.email_changed' AND entity_id = $1`,
      [u.user_id],
    );
    expect(log.rows[0].n).toBe(0);
  });
});
