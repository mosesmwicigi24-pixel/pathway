// Space lifecycle — join requests, leader/moderator delegation, removed/
// suspended member states, and derived cell membership on transfer (Chat
// Redesign C1/C2, docs/CHAT_REDESIGN.md, docs/CHAT_REDESIGN_PLAN.md).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, closeTestPool, testPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser, setCellLeader } from "./helpers/factories.js";

let cong: string;
let cellA: string, cellB: string;
let leaderId: string, leaderTok: string; // leader of cellA
let memberId: string, memberTok: string; // ordinary member of cellA
let outsiderId: string, outsiderTok: string; // not in cellA
let adminTok: string;

const auth = (t: string) => ({ Authorization: t });
const uuid = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

/** Provision cellA's group room (auto-provisions on first chat access by a
 *  member) and return its conversation_id. */
async function cellARoomId(): Promise<string> {
  const res = await agent().get("/v1/chat/conversations").set(auth(memberTok));
  const group = (res.body.conversations as Array<{ conversation_id: string; kind: string }>).find((c) => c.kind === "group");
  return group!.conversation_id;
}

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  cellA = await createCellGroup(cong, "Cell A");
  cellB = await createCellGroup(cong, "Cell B");
  const leader = await createUser({ congregationId: cong, cellGroupId: cellA, email: "sp-leader@dev.local", fullName: "Leader Lyn" });
  const member = await createUser({ congregationId: cong, cellGroupId: cellA, email: "sp-mem@dev.local", fullName: "Member Moe" });
  const outsider = await createUser({ congregationId: cong, cellGroupId: cellB, email: "sp-out@dev.local", fullName: "Outsider Otto" });
  const admin = await createUser({ congregationId: cong, role: "Admin", email: "sp-admin@dev.local", fullName: "Overseer" });
  leaderId = leader.user_id; memberId = member.user_id; outsiderId = outsider.user_id;
  await setCellLeader(cellA, leaderId);
  leaderTok = bearer({ sub: leaderId, role: "Student", cong });
  memberTok = bearer({ sub: memberId, role: "Student", cong });
  outsiderTok = bearer({ sub: outsiderId, role: "Student", cong });
  adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
});
afterAll(async () => {
  await closeTestPool();
});

describe("join request → leader review", () => {
  it("request → leader accepts → the requester gains access", async () => {
    const room = await cellARoomId();

    const req = await agent().post(`/v1/chat/spaces/${room}/join-requests`).set(auth(outsiderTok)).send({ message: "May I join?" });
    expect(req.status).toBe(201);
    expect(req.body.status).toBe("pending");

    // Before the decision — no access.
    const before = await agent().get(`/v1/chat/conversations/${room}`).set(auth(outsiderTok));
    expect(before.status).toBe(404);

    const list = await agent().get(`/v1/chat/spaces/${room}/join-requests`).set(auth(leaderTok));
    expect(list.status).toBe(200);
    expect((list.body.data as Array<{ user_id: string }>).map((r) => r.user_id)).toContain(outsiderId);

    const accept = await agent().post(`/v1/chat/spaces/${room}/join-requests/${req.body.request_id}/accept`).set(auth(leaderTok)).send({});
    expect(accept.status).toBe(200);
    expect(accept.body.status).toBe("accepted");

    const after = await agent().get(`/v1/chat/conversations/${room}`).set(auth(outsiderTok));
    expect(after.status).toBe(200);
    const send = await agent().post(`/v1/chat/conversations/${room}/messages`).set(auth(outsiderTok)).send({ message_id: uuid(1), body: "glad to be here" });
    expect(send.status).toBe(201);
  });

  it("request → leader declines → no access", async () => {
    const room = await cellARoomId();
    const req = await agent().post(`/v1/chat/spaces/${room}/join-requests`).set(auth(outsiderTok)).send({});
    const decline = await agent().post(`/v1/chat/spaces/${room}/join-requests/${req.body.request_id}/decline`).set(auth(leaderTok)).send({});
    expect(decline.status).toBe(200);
    expect(decline.body.status).toBe("declined");
    const after = await agent().get(`/v1/chat/conversations/${room}`).set(auth(outsiderTok));
    expect(after.status).toBe(404);
  });

  it("a non-leader ordinary member cannot approve or list join requests", async () => {
    const room = await cellARoomId();
    const req = await agent().post(`/v1/chat/spaces/${room}/join-requests`).set(auth(outsiderTok)).send({});
    const listDenied = await agent().get(`/v1/chat/spaces/${room}/join-requests`).set(auth(memberTok));
    expect(listDenied.status).toBe(403);
    const acceptDenied = await agent().post(`/v1/chat/spaces/${room}/join-requests/${req.body.request_id}/accept`).set(auth(memberTok)).send({});
    expect(acceptDenied.status).toBe(403);
  });

  it("an active cell member requesting their OWN room is a no-op (already_member)", async () => {
    const room = await cellARoomId();
    const req = await agent().post(`/v1/chat/spaces/${room}/join-requests`).set(auth(memberTok)).send({});
    expect(req.status).toBe(201);
    expect(req.body.status).toBe("already_member");
  });

  it("Admin+ can approve without being the leader (oversight)", async () => {
    const room = await cellARoomId();
    const req = await agent().post(`/v1/chat/spaces/${room}/join-requests`).set(auth(outsiderTok)).send({});
    const accept = await agent().post(`/v1/chat/spaces/${room}/join-requests/${req.body.request_id}/accept`).set(auth(adminTok)).send({});
    expect(accept.status).toBe(200);
  });

  it("a topical space's creator (not a cell leader) is its original leader", async () => {
    const founder = await createUser({ congregationId: cong, role: "Instructor", email: "sp-founder@dev.local", fullName: "Founder Fay" });
    const founderTok = bearer({ sub: founder.user_id, role: "Instructor", cong });
    const created = await agent().post("/v1/chat/spaces").set(auth(founderTok))
      .send({ conversation_id: uuid(50), title: "Worship Team", topic: "Sunday" });
    expect(created.status).toBe(201);
    const req = await agent().post(`/v1/chat/spaces/${uuid(50)}/join-requests`).set(auth(outsiderTok)).send({});
    expect(req.body.status).toBe("pending");
    // The creator (space leader) approves — not an Admin, not a delegated role.
    const accept = await agent().post(`/v1/chat/spaces/${uuid(50)}/join-requests/${req.body.request_id}/accept`)
      .set(auth(founderTok)).send({});
    expect(accept.status).toBe(200);
    // A non-leader member of the founder's congregation cannot.
    const deniedList = await agent().get(`/v1/chat/spaces/${uuid(50)}/join-requests`).set(auth(memberTok));
    expect(deniedList.status).toBe(403);
  });
});

describe("delegated roles (space_roles)", () => {
  it("the leader delegates a moderator, who can approve joins but cannot grant roles", async () => {
    const room = await cellARoomId();
    const grant = await agent().post(`/v1/chat/spaces/${room}/roles`).set(auth(leaderTok)).send({ user_id: memberId, role: "moderator" });
    expect(grant.status).toBe(201);
    expect(grant.body.role).toBe("moderator");

    const req = await agent().post(`/v1/chat/spaces/${room}/join-requests`).set(auth(outsiderTok)).send({});
    const accept = await agent().post(`/v1/chat/spaces/${room}/join-requests/${req.body.request_id}/accept`).set(auth(memberTok)).send({});
    expect(accept.status).toBe(200); // the delegated moderator CAN approve

    const grantDenied = await agent().post(`/v1/chat/spaces/${room}/roles`).set(auth(memberTok)).send({ user_id: outsiderId, role: "moderator" });
    expect(grantDenied.status).toBe(403); // but CANNOT grant further roles
  });

  it("a delegated leader (co-leader) CAN grant roles", async () => {
    const room = await cellARoomId();
    await agent().post(`/v1/chat/spaces/${room}/roles`).set(auth(leaderTok)).send({ user_id: memberId, role: "leader" });
    const grant = await agent().post(`/v1/chat/spaces/${room}/roles`).set(auth(memberTok)).send({ user_id: outsiderId, role: "moderator" });
    expect(grant.status).toBe(201);
  });

  it("revoking a role removes its power", async () => {
    const room = await cellARoomId();
    await agent().post(`/v1/chat/spaces/${room}/roles`).set(auth(leaderTok)).send({ user_id: memberId, role: "moderator" });
    const revoke = await agent().delete(`/v1/chat/spaces/${room}/roles/${memberId}/moderator`).set(auth(leaderTok));
    expect(revoke.status).toBe(200);

    const req = await agent().post(`/v1/chat/spaces/${room}/join-requests`).set(auth(outsiderTok)).send({});
    const denied = await agent().post(`/v1/chat/spaces/${room}/join-requests/${req.body.request_id}/accept`).set(auth(memberTok)).send({});
    expect(denied.status).toBe(403);
  });
});

describe("removed / suspended member states", () => {
  it("a removed member loses access; history stays (row kept, not deleted)", async () => {
    const room = await cellARoomId();
    const remove = await agent().post(`/v1/chat/spaces/${room}/members/${memberId}/remove`).set(auth(leaderTok)).send({});
    expect(remove.status).toBe(200);
    expect(remove.body.status).toBe("removed");

    const denied = await agent().get(`/v1/chat/conversations/${room}`).set(auth(memberTok));
    expect(denied.status).toBe(403); // explicit refusal, not a bare 404 — the row is still there

    const row = await testPool().query(`SELECT status FROM chat_members WHERE conversation_id = $1 AND user_id = $2`, [room, memberId]);
    expect(row.rows[0].status).toBe("removed"); // kept, not deleted
  });

  it("a suspended member loses access the same way", async () => {
    const room = await cellARoomId();
    const suspend = await agent().post(`/v1/chat/spaces/${room}/members/${memberId}/suspend`).set(auth(leaderTok)).send({});
    expect(suspend.status).toBe(200);
    const denied = await agent().post(`/v1/chat/conversations/${room}/messages`).set(auth(memberTok)).send({ message_id: uuid(3), body: "let me in" });
    expect(denied.status).toBe(403);
  });

  it("a non-leader/moderator cannot remove or suspend", async () => {
    const room = await cellARoomId();
    const other = await createUser({ congregationId: cong, cellGroupId: cellA, email: "sp-third@dev.local", fullName: "Third Party" });
    const otherTok = bearer({ sub: other.user_id, role: "Student", cong });
    const denied = await agent().post(`/v1/chat/spaces/${room}/members/${memberId}/remove`).set(auth(otherTok)).send({});
    expect(denied.status).toBe(403);
  });

  it("accepting a NEW join request revives a previously removed member (active again)", async () => {
    const room = await cellARoomId();
    await agent().post(`/v1/chat/spaces/${room}/members/${memberId}/remove`).set(auth(leaderTok)).send({});
    const req = await agent().post(`/v1/chat/spaces/${room}/join-requests`).set(auth(memberTok)).send({});
    expect(req.body.status).toBe("pending"); // no longer "already_member" — they were removed
    await agent().post(`/v1/chat/spaces/${room}/join-requests/${req.body.request_id}/accept`).set(auth(leaderTok)).send({});
    const restored = await agent().get(`/v1/chat/conversations/${room}`).set(auth(memberTok));
    expect(restored.status).toBe(200);
  });
});

describe("derived cell membership on transfer", () => {
  it("moving a member to a different cell ends the old room's membership (history kept) and joins the new room", async () => {
    const oldRoom = await cellARoomId();
    // Provision cellB's room too, via its own member.
    const bMember = await createUser({ congregationId: cong, cellGroupId: cellB, email: "sp-bmem@dev.local", fullName: "Bee Member" });
    const bMemberTok = bearer({ sub: bMember.user_id, role: "Student", cong });
    const bRoomRes = await agent().get("/v1/chat/conversations").set(auth(bMemberTok));
    const newRoom = (bRoomRes.body.conversations as Array<{ conversation_id: string; kind: string }>).find((c) => c.kind === "group")!.conversation_id;

    // memberId still active in cellA's room before the transfer.
    const before = await agent().get(`/v1/chat/conversations/${oldRoom}`).set(auth(memberTok));
    expect(before.status).toBe(200);

    const move = await agent().patch(`/v1/admin/members/${memberId}`).set(auth(adminTok)).send({ cell_group_id: cellB });
    expect(move.status).toBe(200);
    expect(move.body.cell_group_id).toBe(cellB);

    // Old room membership ended — refused, not silently vanished.
    const afterOld = await agent().get(`/v1/chat/conversations/${oldRoom}`).set(auth(memberTok));
    expect(afterOld.status).toBe(403);
    const oldRow = await testPool().query(`SELECT status FROM chat_members WHERE conversation_id = $1 AND user_id = $2`, [oldRoom, memberId]);
    expect(oldRow.rows[0].status).toBe("removed"); // history kept, not deleted

    // New room auto-joined, active, immediately (eager — not waiting for next lazy access).
    const newRow = await testPool().query(`SELECT status FROM chat_members WHERE conversation_id = $1 AND user_id = $2`, [newRoom, memberId]);
    expect(newRow.rows[0].status).toBe("active");
    const afterNew = await agent().get(`/v1/chat/conversations/${newRoom}`).set(auth(memberTok));
    expect(afterNew.status).toBe(200);
  });

  it("a member update that doesn't touch cell_group_id leaves chat membership untouched", async () => {
    const room = await cellARoomId();
    await agent().patch(`/v1/admin/members/${memberId}`).set(auth(adminTok)).send({ full_name: "Member Moe Jr." });
    const still = await agent().get(`/v1/chat/conversations/${room}`).set(auth(memberTok));
    expect(still.status).toBe(200);
  });
});
