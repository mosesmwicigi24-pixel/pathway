// The office enrols partners from a register (POST /admin/partners/enrol):
// matched by phone, a stranger becomes a member in the chosen cell, nothing is
// written on a dry run, and running the list twice changes nothing.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser } from "./helpers/factories.js";
import { agent, bearer } from "./helpers/app.js";

const q = (text: string, params: unknown[] = []) => testPool().query(text, params);
let cong: string, cell: string, admin: string, adminTok: string, amina: string, baraka: string;

beforeAll(async () => {
  await resetDb();
  cong = await createCongregation("Enrol Branch");
  cell = await createCellGroup(cong, "Cell Upendo");
  admin = (await createUser({ congregationId: cong, fullName: "The Treasurer", phone: "+254700000001", role: "Admin" })).user_id;
  await q(`INSERT INTO rbac_user_permissions (user_id, module_id, capability) VALUES ($1, 'finance', 'view'), ($1, 'finance', 'manage')`, [admin]);
  adminTok = bearer({ sub: admin, role: "Admin", cong } as never);
  amina = (await createUser({ congregationId: cong, fullName: "Amina Otieno", phone: "+254705000423" })).user_id;
  baraka = (await createUser({ congregationId: cong, fullName: "Baraka Mwangi", phone: "+254798156959" })).user_id;
  // Baraka was a partner once and left.
  await q(`INSERT INTO partner_memberships (user_id, status, left_at) VALUES ($1, 'left', now())`, [baraka]);
});

afterAll(async () => {
  await closeTestPool();
});

const rows = [
  { full_name: "Maureen Mutile", phone: "0705000423" }, // Amina's number, written the register's way
  { full_name: "Moses Mariuki", phone: "254798156959" }, // Baraka, who left
  { full_name: "Stephen Musili", phone: "0745 292 781" }, // nobody
  { full_name: "Joe Blessing", phone: "0115688290" }, // nobody
  { full_name: "Nobody Really", phone: "12" }, // not a number
  { full_name: "Maureen Mutile", phone: "+254705000423" }, // listed twice
];

describe("POST /admin/partners/enrol", () => {
  it("a dry run says what would happen and writes nothing", async () => {
    const res = await agent().post("/v1/admin/partners/enrol").set("authorization", adminTok).send({ rows, cell_group_id: cell, dry_run: true }).expect(200);
    expect(res.body.dry_run).toBe(true);
    expect(res.body.counts).toEqual({ enrolled: 2, already: 1, created: 2, unknown: 0, ambiguous: 0, invalid: 1 });
    const by = Object.fromEntries(res.body.data.map((r: { full_name: string; phone: string; outcome: string }) => [`${r.full_name}|${r.phone}`, r.outcome]));
    expect(by["Maureen Mutile|+254705000423"]).toBe("already"); // the second listing
    expect(res.body.data[0]).toMatchObject({ outcome: "enrolled", user_id: amina, member_name: "Amina Otieno", phone: "+254705000423" });
    expect(res.body.data[1]).toMatchObject({ outcome: "enrolled", user_id: baraka, note: "was left" });
    expect(res.body.data[2]).toMatchObject({ outcome: "created", user_id: null, phone: "+254745292781" });
    expect(res.body.data[4].outcome).toBe("invalid");
    expect((await q(`SELECT count(*)::int AS n FROM partner_memberships WHERE status = 'active'`)).rows[0].n).toBe(0);
    expect((await q(`SELECT count(*)::int AS n FROM users WHERE phone_number = '+254745292781'`)).rows[0].n).toBe(0);
  });

  it("without a cell, a stranger is reported unknown and not created", async () => {
    const res = await agent().post("/v1/admin/partners/enrol").set("authorization", adminTok).send({ rows: [rows[2]] }).expect(200);
    expect(res.body.data[0].outcome).toBe("unknown");
    expect((await q(`SELECT count(*)::int AS n FROM users WHERE phone_number = '+254745292781'`)).rows[0].n).toBe(0);
  });

  it("for real: members are enrolled, strangers become members in the cell and partners, all audited", async () => {
    const res = await agent().post("/v1/admin/partners/enrol").set("authorization", adminTok).send({ rows, cell_group_id: cell }).expect(200);
    expect(res.body.counts).toEqual({ enrolled: 2, already: 1, created: 2, unknown: 0, ambiguous: 0, invalid: 1 });
    const active = await q(`SELECT u.full_name, u.phone_number, u.role, u.cell_group_id FROM partner_memberships pm JOIN users u USING (user_id) WHERE pm.status = 'active' ORDER BY u.full_name`);
    expect(active.rows.map((r) => r.full_name)).toEqual(["Amina Otieno", "Baraka Mwangi", "Joe Blessing", "Stephen Musili"]);
    const stephen = active.rows.find((r) => r.full_name === "Stephen Musili")!;
    expect(stephen).toMatchObject({ phone_number: "+254745292781", role: "Student", cell_group_id: cell });
    const enrol = await q(`SELECT current_level FROM enrollments e JOIN users u USING (user_id) WHERE u.phone_number = '+254115688290'`);
    expect(enrol.rows[0].current_level).toBe(1);
    const audits = await q(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'partners.enrolled_by_office' AND actor_id = $1`, [admin]);
    expect(audits.rows[0].n).toBe(4);
    // Baraka's membership was revived, not duplicated.
    expect((await q(`SELECT status, left_at FROM partner_memberships WHERE user_id = $1`, [baraka])).rows[0]).toEqual({ status: "active", left_at: null });
  });

  it("running the same register again changes nothing", async () => {
    const before = (await q(`SELECT count(*)::int AS n FROM users`)).rows[0].n;
    const res = await agent().post("/v1/admin/partners/enrol").set("authorization", adminTok).send({ rows, cell_group_id: cell }).expect(200);
    expect(res.body.counts).toEqual({ enrolled: 0, already: 5, created: 0, unknown: 0, ambiguous: 0, invalid: 1 });
    expect((await q(`SELECT count(*)::int AS n FROM users`)).rows[0].n).toBe(before);
  });

  it("two members on one number are left to the office; an unknown cell or a view-only officer is refused", async () => {
    await createUser({ congregationId: cong, fullName: "Amina Twin", phone: "+254705000423" });
    const res = await agent().post("/v1/admin/partners/enrol").set("authorization", adminTok).send({ rows: [rows[0]] }).expect(200);
    expect(res.body.data[0].outcome).toBe("ambiguous");
    await agent().post("/v1/admin/partners/enrol").set("authorization", adminTok).send({ rows: [rows[2]], cell_group_id: randomUUID() }).expect(400);
    const viewer = (await createUser({ congregationId: cong, fullName: "Viewer", phone: "+254700000002" })).user_id;
    await q(`INSERT INTO rbac_user_permissions (user_id, module_id, capability) VALUES ($1, 'finance', 'view')`, [viewer]);
    await agent().post("/v1/admin/partners/enrol").set("authorization", bearer({ sub: viewer, role: "Student", cong } as never)).send({ rows: [rows[2]] }).expect(403);
  });
});
