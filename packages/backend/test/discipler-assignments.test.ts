// Discipler assignments — history table + reassignment archival (Chat
// Redesign C2, docs/CHAT_REDESIGN.md "My Discipler",
// docs/CHAT_REDESIGN_PLAN.md §2.5). Covers: assign, reassign (ends the prior
// row + archives the old DISCIPLER conversation, never merged/exposed), the
// Hub's discipler resolution preferring the assignment over relationship_tree
// or the cell-leader inference, minor-safety, scope, and admin-exclusion
// (ordinary Admin oversight still cannot read a DISCIPLER thread — C1's
// scoping to type='SPACE' holding under C2).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, closeTestPool, testPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser, createLeaderAssignment } from "./helpers/factories.js";

let cong: string, cell: string;
let leaderId: string, leaderTok: string;
let discipler2Id: string, discipler2Tok: string;
let discipleId: string, discipleTok: string;
let minorId: string, minorTok: string;
let outsiderId: string, outsiderTok: string; // Instructor, no leader_assignments to this cell
let adminId: string, adminTok: string;

const auth = (t: string) => ({ Authorization: t });

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  cell = await createCellGroup(cong, "Cell DA");
  const leader = await createUser({ congregationId: cong, role: "Instructor", email: "da-leader@dev.local", fullName: "Leo" });
  await createLeaderAssignment(leader.user_id, cell);
  const discipler2 = await createUser({ congregationId: cong, role: "Instructor", email: "da-d2@dev.local", fullName: "Dara" });
  const disciple = await createUser({ congregationId: cong, cellGroupId: cell, email: "da-disciple@dev.local", fullName: "Amy" });
  const minor = await createUser({ congregationId: cong, cellGroupId: cell, email: "da-minor@dev.local", fullName: "Kid", dateOfBirth: "2015-01-01" });
  const outsider = await createUser({ congregationId: cong, role: "Instructor", email: "da-outsider@dev.local", fullName: "Out" });
  const admin = await createUser({ congregationId: cong, role: "Admin", email: "da-admin@dev.local", fullName: "Overseer" });

  leaderId = leader.user_id; leaderTok = bearer({ sub: leaderId, role: "Instructor", cong });
  discipler2Id = discipler2.user_id; discipler2Tok = bearer({ sub: discipler2Id, role: "Instructor", cong });
  discipleId = disciple.user_id; discipleTok = bearer({ sub: discipleId, role: "Student", cong });
  minorId = minor.user_id; minorTok = bearer({ sub: minorId, role: "Student", cong });
  outsiderId = outsider.user_id; outsiderTok = bearer({ sub: outsiderId, role: "Instructor", cong });
  adminId = admin.user_id; adminTok = bearer({ sub: adminId, role: "Admin", cong });
});
afterAll(async () => {
  await closeTestPool();
});

describe("assign → reassign, with history + archival", () => {
  it("assigns, resolves via /me/discipleship and GET /chat/discipler/conversation, then reassigns and archives the old thread", async () => {
    const assign = await agent().post("/v1/admin/discipler-assignments").set(auth(leaderTok))
      .send({ disciple_user_id: discipleId, discipler_user_id: leaderId });
    expect(assign.status).toBe(201);
    expect(assign.body.reassigned).toBe(false);

    const hub = await agent().get("/v1/me/discipleship").set(auth(discipleTok));
    expect(hub.body.data.discipler.user_id).toBe(leaderId);
    expect(hub.body.data.discipler.role_label).toBe("Discipler");
    expect(hub.body.data.discipler.established_at).toBeTruthy();

    const opened = await agent().get("/v1/chat/discipler/conversation").set(auth(discipleTok));
    expect(opened.status).toBe(200);
    const oldConversationId = opened.body.conversation_id as string;
    const send = await agent().post(`/v1/chat/conversations/${oldConversationId}/messages`).set(auth(discipleTok))
      .send({ message_id: "00000000-0000-4000-8000-000000000001", body: "hello discipler" });
    expect(send.status).toBe(201);

    // Reassign to a different discipler.
    const reassign = await agent().post("/v1/admin/discipler-assignments").set(auth(leaderTok))
      .send({ disciple_user_id: discipleId, discipler_user_id: discipler2Id });
    expect(reassign.status).toBe(201);
    expect(reassign.body.reassigned).toBe(true);

    // The Hub now resolves the NEW discipler.
    const hub2 = await agent().get("/v1/me/discipleship").set(auth(discipleTok));
    expect(hub2.body.data.discipler.user_id).toBe(discipler2Id);

    // A FRESH conversation is created — never the old one, never merged.
    const opened2 = await agent().get("/v1/chat/discipler/conversation").set(auth(discipleTok));
    expect(opened2.status).toBe(200);
    const newConversationId = opened2.body.conversation_id as string;
    expect(newConversationId).not.toBe(oldConversationId);

    // The OLD conversation is archived (history kept, not deleted).
    const archived = await testPool().query(`SELECT archived_at FROM chat_conversations WHERE conversation_id = $1`, [oldConversationId]);
    expect(archived.rows[0].archived_at).not.toBeNull();
    const oldMessages = await testPool().query(`SELECT body FROM chat_messages WHERE conversation_id = $1`, [oldConversationId]);
    expect(oldMessages.rows.map((r: { body: string }) => r.body)).toContain("hello discipler");

    // Full history: two rows, newest first, first (current) has no ended_at.
    const history = await agent().get("/v1/admin/discipler-assignments").query({ disciple_id: discipleId }).set(auth(leaderTok));
    expect(history.status).toBe(200);
    const rows = history.body.data as Array<{ discipler_user_id: string; ended_at: string | null }>;
    expect(rows.length).toBe(2);
    expect(rows[0]!.discipler_user_id).toBe(discipler2Id);
    expect(rows[0]!.ended_at).toBeNull();
    expect(rows[1]!.discipler_user_id).toBe(leaderId);
    expect(rows[1]!.ended_at).not.toBeNull();

    // audit_log records both the assignment and the reassignment.
    const audits = await testPool().query(`SELECT action FROM audit_log WHERE actor_id = $1 ORDER BY occurred_at`, [leaderId]);
    const actions = audits.rows.map((r: { action: string }) => r.action);
    expect(actions).toContain("discipler.assigned");
    expect(actions).toContain("discipler.reassigned");
  });

  it("reassigning to the SAME discipler is an idempotent no-op", async () => {
    await agent().post("/v1/admin/discipler-assignments").set(auth(leaderTok))
      .send({ disciple_user_id: discipleId, discipler_user_id: leaderId });
    const again = await agent().post("/v1/admin/discipler-assignments").set(auth(leaderTok))
      .send({ disciple_user_id: discipleId, discipler_user_id: leaderId });
    expect(again.status).toBe(201);
    expect(again.body.reassigned).toBe(false);
    const count = await testPool().query(`SELECT count(*)::int AS n FROM discipler_assignments WHERE disciple_user_id = $1`, [discipleId]);
    expect(count.rows[0].n).toBe(1);
  });

  it("404s GET /chat/discipler/conversation for a disciple with no assignment", async () => {
    const res = await agent().get("/v1/chat/discipler/conversation").set(auth(discipleTok));
    expect(res.status).toBe(404);
    expect(res.body.error.details.no_discipler).toBe(true);
  });

  it("refuses a DISCIPLER thread for a minor disciple (D-M6), even with a valid assignment", async () => {
    await agent().post("/v1/admin/discipler-assignments").set(auth(leaderTok))
      .send({ disciple_user_id: minorId, discipler_user_id: leaderId });
    const opened = await agent().get("/v1/chat/discipler/conversation").set(auth(minorTok));
    expect(opened.status).toBe(403);
  });

  it("403s an out-of-scope Instructor (no leader_assignments to this cell)", async () => {
    const res = await agent().post("/v1/admin/discipler-assignments").set(auth(outsiderTok))
      .send({ disciple_user_id: discipleId, discipler_user_id: outsiderId });
    expect(res.status).toBe(403);
  });

  it("422s self-assignment", async () => {
    const res = await agent().post("/v1/admin/discipler-assignments").set(auth(leaderTok))
      .send({ disciple_user_id: discipleId, discipler_user_id: discipleId });
    expect(res.status).toBe(400);
  });
});

describe("admin-exclusion from DISCIPLER threads (C1 scoping holds under C2)", () => {
  it("an ordinary Admin's oversight inbox never surfaces a DISCIPLER thread, and direct access 404s", async () => {
    await agent().post("/v1/admin/discipler-assignments").set(auth(leaderTok))
      .send({ disciple_user_id: discipleId, discipler_user_id: leaderId });
    const opened = await agent().get("/v1/chat/discipler/conversation").set(auth(discipleTok));
    const conversationId = opened.body.conversation_id as string;

    const inbox = await agent().get("/v1/chat/conversations").set(auth(adminTok));
    const ids = (inbox.body.conversations as Array<{ conversation_id: string }>).map((c) => c.conversation_id);
    expect(ids).not.toContain(conversationId);

    const direct = await agent().get(`/v1/chat/conversations/${conversationId}`).set(auth(adminTok));
    expect(direct.status).toBe(404);
  });
});
