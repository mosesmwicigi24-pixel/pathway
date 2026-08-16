// Pastoral — "Talk with My Pastor" (Chat Redesign C2, docs/CHAT_REDESIGN.md
// §"Talk with My Pastor", docs/CHAT_REDESIGN_PLAN.md §2.4/§4/§8 Q2). Covers:
// resolution order (assigned → congregation default → audited SuperAdmin
// fallback), create-or-open idempotency, minor-safety, the pastor-facing
// inbox's password step-up + scope, and admin assignment CRUD with history.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, closeTestPool, testPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser } from "./helpers/factories.js";

let cong: string, cell: string;
let memberId: string, memberTok: string;
let pastorId: string, pastorTok: string, pastorStepUpTok: string;
let defaultPastorId: string, defaultPastorTok: string;
let superAdminId: string, superAdminTok: string, superAdminStepUpTok: string;
let minorId: string, minorTok: string;
let adminId: string, adminTok: string;

const auth = (t: string) => ({ Authorization: t });
const staff = (sub: string, role: "Instructor" | "Admin" | "SuperAdmin", congId: string): string =>
  bearer({ sub, role, cong: congId, pwd_at: Math.floor(Date.now() / 1000) });

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  cell = await createCellGroup(cong, "Cell PA");
  const member = await createUser({ congregationId: cong, cellGroupId: cell, email: "pa-member@dev.local", fullName: "Mira" });
  const pastor = await createUser({ congregationId: cong, role: "Instructor", email: "pa-pastor@dev.local", fullName: "Pastor Joy" });
  const defaultPastor = await createUser({ congregationId: cong, role: "Instructor", email: "pa-default@dev.local", fullName: "Pastor Default" });
  // SuperAdmin, no explicit assignment to anyone — the last-resort fallback candidate.
  const superAdmin = await createUser({ congregationId: cong, role: "SuperAdmin", email: "pa-super@dev.local", fullName: "Pastor Fallback" });
  const minor = await createUser({ congregationId: cong, cellGroupId: cell, email: "pa-minor@dev.local", fullName: "Kid", dateOfBirth: "2015-01-01" });
  const admin = await createUser({ congregationId: cong, role: "Admin", email: "pa-admin@dev.local", fullName: "Overseer" });

  memberId = member.user_id; memberTok = bearer({ sub: memberId, role: "Student", cong });
  pastorId = pastor.user_id;
  pastorTok = bearer({ sub: pastorId, role: "Instructor", cong });
  pastorStepUpTok = staff(pastorId, "Instructor", cong);
  defaultPastorId = defaultPastor.user_id; defaultPastorTok = staff(defaultPastorId, "Instructor", cong);
  superAdminId = superAdmin.user_id;
  superAdminTok = bearer({ sub: superAdminId, role: "SuperAdmin", cong });
  superAdminStepUpTok = staff(superAdminId, "SuperAdmin", cong);
  minorId = minor.user_id; minorTok = bearer({ sub: minorId, role: "Student", cong });
  adminId = admin.user_id; adminTok = staff(adminId, "Admin", cong);
});
afterAll(async () => {
  await closeTestPool();
});

describe("resolution order", () => {
  it("step 3: falls back to the congregation's earliest-created SuperAdmin, and audits it", async () => {
    const opened = await agent().post("/v1/chat/pastoral").set(auth(memberTok)).send({});
    expect(opened.status).toBe(201);
    expect(opened.body.pastor_user_id).toBe(superAdminId);
    expect(opened.body.source).toBe("fallback_superadmin");

    const audits = await testPool().query(
      `SELECT metadata FROM audit_log WHERE action = 'pastoral.fallback_used' AND actor_id = $1`, [memberId],
    );
    expect(audits.rowCount).toBeGreaterThanOrEqual(1);
  });

  it("step 2: a congregation default row wins over the fallback", async () => {
    await agent().post("/v1/admin/pastor-assignments").set(auth(adminTok))
      .send({ congregation_id: cong, pastor_user_id: defaultPastorId, assignment_kind: "default" });
    const opened = await agent().post("/v1/chat/pastoral").set(auth(memberTok)).send({});
    expect(opened.status).toBe(201);
    expect(opened.body.pastor_user_id).toBe(defaultPastorId);
    expect(opened.body.source).toBe("congregation_default");
  });

  it("step 1: a personal assignment wins over the congregation default and the fallback", async () => {
    await agent().post("/v1/admin/pastor-assignments").set(auth(adminTok))
      .send({ congregation_id: cong, pastor_user_id: defaultPastorId, assignment_kind: "default" });
    await agent().post("/v1/admin/pastor-assignments").set(auth(adminTok))
      .send({ member_user_id: memberId, pastor_user_id: pastorId, assignment_kind: "primary" });
    const opened = await agent().post("/v1/chat/pastoral").set(auth(memberTok)).send({});
    expect(opened.status).toBe(201);
    expect(opened.body.pastor_user_id).toBe(pastorId);
    expect(opened.body.source).toBe("assigned");
  });
});

describe("create-or-open idempotency + minor-safety", () => {
  it("POST /chat/pastoral twice returns the SAME conversation", async () => {
    await agent().post("/v1/admin/pastor-assignments").set(auth(adminTok))
      .send({ member_user_id: memberId, pastor_user_id: pastorId });
    const first = await agent().post("/v1/chat/pastoral").set(auth(memberTok)).send({});
    const second = await agent().post("/v1/chat/pastoral").set(auth(memberTok)).send({});
    expect(second.body.conversation_id).toBe(first.body.conversation_id);

    const send = await agent().post(`/v1/chat/conversations/${first.body.conversation_id}/messages`).set(auth(memberTok))
      .send({ message_id: "00000000-0000-4000-8000-000000000011", body: "Pastor, please pray for me" });
    expect(send.status).toBe(201);
  });

  it("refuses a PASTORAL thread for a minor member (D-M6)", async () => {
    await agent().post("/v1/admin/pastor-assignments").set(auth(adminTok))
      .send({ member_user_id: minorId, pastor_user_id: pastorId });
    const opened = await agent().post("/v1/chat/pastoral").set(auth(minorTok)).send({});
    expect(opened.status).toBe(403);
  });

  it("no step-up needed for the member's own thread", async () => {
    // memberTok deliberately carries no pwd_at.
    const opened = await agent().post("/v1/chat/pastoral").set(auth(memberTok)).send({});
    expect(opened.status).toBe(201);
  });
});

describe("Pastoral Inbox — password step-up + scope", () => {
  it("403s without a fresh password confirmation, even for the assigned pastor", async () => {
    await agent().post("/v1/admin/pastor-assignments").set(auth(adminTok))
      .send({ member_user_id: memberId, pastor_user_id: pastorId });
    const res = await agent().get("/v1/chat/pastoral/inbox").set(auth(pastorTok)); // no pwd_at
    expect(res.status).toBe(403);
    expect(res.body.error.details.password_required).toBe(true);
  });

  it("403s a caller who has never held a pastor assignment, even with step-up", async () => {
    const strangerStepUp = staff(memberId, "Instructor" as never, cong); // arbitrary non-pastor, has step-up
    const res = await agent().get("/v1/chat/pastoral/inbox").set(auth(strangerStepUp));
    expect(res.status).toBe(403);
  });

  it("lists the pastor's own threads, and every thread for a SuperAdmin", async () => {
    await agent().post("/v1/admin/pastor-assignments").set(auth(adminTok))
      .send({ member_user_id: memberId, pastor_user_id: pastorId });
    const opened = await agent().post("/v1/chat/pastoral").set(auth(memberTok)).send({});
    expect(opened.body.pastor_user_id).toBe(pastorId);

    const pastorInbox = await agent().get("/v1/chat/pastoral/inbox").set(auth(pastorStepUpTok));
    expect(pastorInbox.status).toBe(200);
    const pastorRows = pastorInbox.body.data as Array<{ member_user_id: string }>;
    expect(pastorRows.map((r) => r.member_user_id)).toContain(memberId);

    const superInbox = await agent().get("/v1/chat/pastoral/inbox").set(auth(superAdminStepUpTok));
    expect(superInbox.status).toBe(200);
    const superRows = superInbox.body.data as Array<{ member_user_id: string }>;
    expect(superRows.map((r) => r.member_user_id)).toContain(memberId);
  });
});

describe("admin assignment CRUD + history", () => {
  it("reassigning a member's pastor ends the prior row (history preserved)", async () => {
    const first = await agent().post("/v1/admin/pastor-assignments").set(auth(adminTok))
      .send({ member_user_id: memberId, pastor_user_id: pastorId });
    expect(first.body.reassigned).toBe(false);
    const second = await agent().post("/v1/admin/pastor-assignments").set(auth(adminTok))
      .send({ member_user_id: memberId, pastor_user_id: defaultPastorId });
    expect(second.body.reassigned).toBe(true);

    const history = await agent().get("/v1/admin/pastor-assignments").query({ member_id: memberId }).set(auth(adminTok));
    expect(history.status).toBe(200);
    const rows = history.body.data as Array<{ pastor_user_id: string; ended_at: string | null }>;
    expect(rows.length).toBe(2);
    expect(rows[0]!.pastor_user_id).toBe(defaultPastorId);
    expect(rows[0]!.ended_at).toBeNull();
    expect(rows[1]!.pastor_user_id).toBe(pastorId);
    expect(rows[1]!.ended_at).not.toBeNull();
  });

  it("422s a malformed default row (missing congregation_id, or member_user_id set with kind=default)", async () => {
    const noCong = await agent().post("/v1/admin/pastor-assignments").set(auth(adminTok))
      .send({ pastor_user_id: pastorId, assignment_kind: "default" });
    expect(noCong.status).toBe(400);
    const conflict = await agent().post("/v1/admin/pastor-assignments").set(auth(adminTok))
      .send({ member_user_id: memberId, pastor_user_id: pastorId, assignment_kind: "default" });
    expect(conflict.status).toBe(400);
  });

  it("requires Admin — an Instructor is refused", async () => {
    const res = await agent().post("/v1/admin/pastor-assignments").set(auth(pastorTok))
      .send({ member_user_id: memberId, pastor_user_id: pastorId });
    expect(res.status).toBe(403);
  });
});

describe("admin-exclusion from PASTORAL threads (mirrors DISCIPLER's C1 scoping)", () => {
  it("an ordinary Admin's oversight inbox never surfaces a PASTORAL thread, and direct access 404s", async () => {
    await agent().post("/v1/admin/pastor-assignments").set(auth(adminTok))
      .send({ member_user_id: memberId, pastor_user_id: pastorId });
    const opened = await agent().post("/v1/chat/pastoral").set(auth(memberTok)).send({});
    const conversationId = opened.body.conversation_id as string;

    const inbox = await agent().get("/v1/chat/conversations").set(auth(adminTok));
    const ids = (inbox.body.conversations as Array<{ conversation_id: string }>).map((c) => c.conversation_id);
    expect(ids).not.toContain(conversationId);

    const direct = await agent().get(`/v1/chat/conversations/${conversationId}`).set(auth(adminTok));
    expect(direct.status).toBe(404);
  });
});
