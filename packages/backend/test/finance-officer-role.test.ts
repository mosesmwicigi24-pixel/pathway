// The Finance Officer role and the Finance ERP (migration 217, owner-approved
// 2026-09-26). finance:manage records money — office gifts, expenses — and
// finance:approve approves it. The role holds both; maker-checker still stops
// one officer approving their own expense.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { agent, bearer } from "./helpers/app.js";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPool();
});

const grantRole = (userId: string) =>
  testPool().query(`INSERT INTO rbac_user_roles (user_id, role_key) VALUES ($1, 'finance_officer') ON CONFLICT DO NOTHING`, [userId]);

describe("the Finance Officer role", () => {
  it("holds finance view, export, manage and approve", async () => {
    const caps = (await testPool().query(
      `SELECT capability FROM rbac_role_permissions WHERE role_key = 'finance_officer' AND module_id = 'finance' ORDER BY capability`,
    )).rows.map((r) => r.capability);
    expect(caps).toEqual(expect.arrayContaining(["view", "export", "manage", "approve"]));
  });

  it("can record a gift and approve a colleague's expense — but not their own", async () => {
    const cong = await createCongregation();
    const a = await createUser({ congregationId: cong, role: "Instructor", email: "officer.a@dev.local", fullName: "Officer A" });
    const b = await createUser({ congregationId: cong, role: "Instructor", email: "officer.b@dev.local", fullName: "Officer B" });
    const member = await createUser({ congregationId: cong, fullName: "Giver" });
    await grantRole(a.user_id);
    await grantRole(b.user_id);
    const as = (u: { user_id: string }) => bearer({ sub: u.user_id, role: "Instructor", cong });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());

    const gift = await agent().post("/v1/admin/finance/gifts").set("Authorization", as(a)).send({
      idempotency_key: randomUUID(), user_id: member.user_id, fund: "general", amount_minor: 50_000, currency: "KES", channel: "onhand", received_on: today,
    });
    expect(gift.status).toBe(201);
    expect(gift.body.receipt_code).toMatch(/^OR-\d{4}-00001$/);

    const exp = await agent().post("/v1/admin/finance/expenses").set("Authorization", as(a)).send({
      fund: "general", category: "utilities", payee: "Kenya Power", amount_minor: 10_000, currency: "KES", spent_on: today, channel: "onhand",
    });
    expect(exp.status).toBe(201);
    const own = await agent().post(`/v1/admin/finance/expenses/${exp.body.expense_id}/approve`).set("Authorization", as(a)).send({});
    expect(own.status).toBe(403);
    expect(own.body.error?.code).toBe("SAME_PERSON");
    const colleague = await agent().post(`/v1/admin/finance/expenses/${exp.body.expense_id}/approve`).set("Authorization", as(b)).send({});
    expect(colleague.status).toBe(200);
    expect(colleague.body.status).toBe("approved");
  });
});
