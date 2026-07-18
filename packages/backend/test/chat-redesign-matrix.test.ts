// Chat & Communication Module Redesign — §16 test matrix (Chat Redesign C4,
// docs/CHAT_REDESIGN.md: "Test matrix: the 25 scenarios of §16 (auto-
// membership through deactivated-account handling)").
//
// §16's full scenario text lives only in the owner's fuller source document,
// not reproduced in this repo (docs/CHAT_REDESIGN_PLAN.md's own header notes
// this explicitly for every section it cites). The 25 scenarios below are
// this phase's reconstruction from the owner brief (docs/CHAT_REDESIGN.md)
// and the C1/C2/C3 implementation record — one entry per named flow across
// My Space, Chat, My Discipler, Talk with My Pastor, Broadcast, and
// Notifications, opening on auto-membership and closing on deactivated-
// account handling exactly as the brief's own framing describes.
//
// BACKEND — exercised end-to-end below via the real HTTP surface + DB state.
// CLIENT-ONLY — device/UI behaviour with no server contract to assert
// against (marked inline; not skipped tests, simply not present here).
//
//  1. Auto-membership — a new cell member auto-joins the cell's room.      BACKEND
//  2. Cell transfer — old room membership ends (history kept), new joins.  BACKEND
//  3. Non-member request-to-join a space → pending, leader notified.       BACKEND
//  4. Leader reviews → accept → requester gains access.                    BACKEND
//  5. Leader reviews → decline → requester still has no access.            BACKEND
//  6. Pending/declined requester sees nothing protected beforehand.        BACKEND
//  7. Leader delegates a co-leader/moderator role (space_roles).           BACKEND
//  8. Delegated moderator approves joins but cannot grant further roles.   BACKEND
//  9. Removed member loses access; row kept (history), not deleted.        BACKEND
// 10. Suspended member loses access the same way.                         BACKEND
// 11. requires_approval space refuses a direct join; join-requests works
//     around it; a cell room is never subject to it (always direct-joins). BACKEND
// 12. My Space UX — search/unread-filter/archive, smooth tab entry.       CLIENT-ONLY
// 13. Chat consent: request → accept → DM opens → both can send.          BACKEND
// 14. Chat consent: unsolicited DM refused CONSENT_REQUIRED.               BACKEND
// 15. Chat consent: declined request leaves the pair refused until fresh. BACKEND
// 16. Block stops new sends both directions; existing history readable.   BACKEND
// 17. Unblock reverts to "removed" — a fresh request is required.         BACKEND
// 18. My Discipler thread exists ONLY with a valid current assignment.    BACKEND
// 19. My Discipler thread is invisible to ordinary Admin oversight.       BACKEND
// 20. Talk with My Pastor: assigned → congregation default → audited
//     SuperAdmin fallback, in that order.                                 BACKEND
// 21. Pastoral Inbox requires a FRESH password step-up, even for the
//     assigned pastor; the eligibility probe needs none.                  BACKEND
// 22. Biometric lock on Pastoral — OS Face ID/PIN, hidden previews when
//     locked, recents-blur, re-auth on timeout/restart/logout/device-lock. CLIENT-ONLY
// 23. Broadcast delivers as a distinct per-recipient BROADCAST_RESPONSE
//     thread; reply_policy governs the RECIPIENT only, never the sender.  BACKEND
// 24. Notifications: typed nudges for new DM/DISCIPLER/PASTORAL messages
//     and a new broadcast (Pastoral's is GENERIC); throttled against
//     per-message spam (one outstanding nudge per thread).                BACKEND
// 25. Deactivated-account handling — a soft-deleted member can't be
//     reached by a fresh DM, and pastoral fallback resolution skips a
//     deleted SuperAdmin rather than resolving to a ghost account.        BACKEND
//
// 23 of 25 are backend-testable end-to-end (≥18 target); 2 are client-only
// device/UI behaviour with no server contract.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, closeTestPool, testPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser, setCellLeader } from "./helpers/factories.js";

let cong: string;
let cellA: string, cellB: string;
let leaderId: string, leaderTok: string; // leader of cellA (role Student — a cell leader, not portal staff)
let memberId: string, memberTok: string; // ordinary member of cellA
let outsiderId: string, outsiderTok: string; // member of cellB (not in cellA)
let pastorId: string, pastorTok: string, pastorStepUpTok: string;
let defaultPastorId: string;
let superAdminId: string; // earliest SuperAdmin — the fallback candidate
let superAdmin2Id: string;
let adminId: string, adminTok: string;

const auth = (t: string) => ({ Authorization: t });
const staff = (sub: string, role: "Instructor" | "Admin" | "SuperAdmin", congId: string): string =>
  bearer({ sub, role, cong: congId, pwd_at: Math.floor(Date.now() / 1000) });
const uuid = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

/** Provision cellA's group room (auto-provisions on first chat access) and return its id. */
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
  const leader = await createUser({ congregationId: cong, cellGroupId: cellA, email: "mx-leader@dev.local", fullName: "Leader Lyn" });
  const member = await createUser({ congregationId: cong, cellGroupId: cellA, email: "mx-member@dev.local", fullName: "Member Moe" });
  const outsider = await createUser({ congregationId: cong, cellGroupId: cellB, email: "mx-out@dev.local", fullName: "Outsider Otto" });
  const pastor = await createUser({ congregationId: cong, role: "Instructor", email: "mx-pastor@dev.local", fullName: "Pastor Joy" });
  const defaultPastor = await createUser({ congregationId: cong, role: "Instructor", email: "mx-default@dev.local", fullName: "Pastor Default" });
  const superAdmin = await createUser({ congregationId: cong, role: "SuperAdmin", email: "mx-super1@dev.local", fullName: "Fallback Sam" });
  const superAdmin2 = await createUser({ congregationId: cong, role: "SuperAdmin", email: "mx-super2@dev.local", fullName: "Fallback Sue" });
  const admin = await createUser({ congregationId: cong, role: "Admin", email: "mx-admin@dev.local", fullName: "Overseer" });

  leaderId = leader.user_id; memberId = member.user_id; outsiderId = outsider.user_id;
  await setCellLeader(cellA, leaderId);
  leaderTok = bearer({ sub: leaderId, role: "Student", cong });
  memberTok = bearer({ sub: memberId, role: "Student", cong });
  outsiderTok = bearer({ sub: outsiderId, role: "Student", cong });
  pastorId = pastor.user_id; pastorTok = bearer({ sub: pastorId, role: "Instructor", cong }); pastorStepUpTok = staff(pastorId, "Instructor", cong);
  defaultPastorId = defaultPastor.user_id;
  superAdminId = superAdmin.user_id;
  superAdmin2Id = superAdmin2.user_id;
  adminId = admin.user_id; adminTok = staff(adminId, "Admin", cong);
});
afterAll(async () => {
  await closeTestPool();
});

// 1–2: My Space — derived membership + cell transfer.
describe("1-2. My Space — auto-membership + cell transfer", () => {
  it("1. a cell member auto-joins the cell's room on first chat access", async () => {
    const room = await cellARoomId();
    expect(room).toBeTruthy();
    const row = await testPool().query(`SELECT status FROM chat_members WHERE conversation_id = $1 AND user_id = $2`, [room, memberId]);
    expect(row.rows[0].status).toBe("active");
  });

  it("2. moving a member to a different cell ends the old room's membership (history kept) and joins the new room", async () => {
    const oldRoom = await cellARoomId();
    const bMember = await createUser({ congregationId: cong, cellGroupId: cellB, email: "mx-bmem@dev.local", fullName: "Bee Member" });
    const bTok = bearer({ sub: bMember.user_id, role: "Student", cong });
    const bRoomRes = await agent().get("/v1/chat/conversations").set(auth(bTok));
    const newRoom = (bRoomRes.body.conversations as Array<{ conversation_id: string; kind: string }>).find((c) => c.kind === "group")!.conversation_id;

    const move = await agent().patch(`/v1/admin/members/${memberId}`).set(auth(adminTok)).send({ cell_group_id: cellB });
    expect(move.status).toBe(200);

    const afterOld = await agent().get(`/v1/chat/conversations/${oldRoom}`).set(auth(memberTok));
    expect(afterOld.status).toBe(403); // refused, row kept — not a bare vanish
    const oldRow = await testPool().query(`SELECT status FROM chat_members WHERE conversation_id = $1 AND user_id = $2`, [oldRoom, memberId]);
    expect(oldRow.rows[0].status).toBe("removed");

    const newRow = await testPool().query(`SELECT status FROM chat_members WHERE conversation_id = $1 AND user_id = $2`, [newRoom, memberId]);
    expect(newRow.rows[0].status).toBe("active");
  });
});

// 3–6: join-request review lifecycle.
describe("3-6. My Space — join-request review", () => {
  it("3-4. request → leader notified → accept → the requester gains access", async () => {
    const room = await cellARoomId();
    const req = await agent().post(`/v1/chat/spaces/${room}/join-requests`).set(auth(outsiderTok)).send({ message: "May I join?" });
    expect(req.status).toBe(201);
    expect(req.body.status).toBe("pending");
    const notif = await testPool().query(`SELECT template FROM notifications WHERE user_id = $1`, [leaderId]);
    expect(notif.rows.map((r: { template: string }) => r.template)).toContain("space_join_requested");

    const accept = await agent().post(`/v1/chat/spaces/${room}/join-requests/${req.body.request_id}/accept`).set(auth(leaderTok)).send({});
    expect(accept.status).toBe(200);
    const after = await agent().get(`/v1/chat/conversations/${room}`).set(auth(outsiderTok));
    expect(after.status).toBe(200);
  });

  it("5-6. request → leader declines → requester still has no access (nothing protected leaks beforehand either)", async () => {
    const room = await cellARoomId();
    const beforeDecision = await agent().get(`/v1/chat/conversations/${room}`).set(auth(outsiderTok));
    expect(beforeDecision.status).toBe(404); // pending sees nothing protected
    const req = await agent().post(`/v1/chat/spaces/${room}/join-requests`).set(auth(outsiderTok)).send({});
    const decline = await agent().post(`/v1/chat/spaces/${room}/join-requests/${req.body.request_id}/decline`).set(auth(leaderTok)).send({});
    expect(decline.status).toBe(200);
    const after = await agent().get(`/v1/chat/conversations/${room}`).set(auth(outsiderTok));
    expect(after.status).toBe(404); // declined sees nothing protected either
  });
});

// 7–8: delegated space_roles.
describe("7-8. My Space — delegated co-leader/moderator roles", () => {
  it("7-8. a delegated moderator can approve joins but cannot grant further roles", async () => {
    const room = await cellARoomId();
    const grant = await agent().post(`/v1/chat/spaces/${room}/roles`).set(auth(leaderTok)).send({ user_id: memberId, role: "moderator" });
    expect(grant.status).toBe(201);

    const req = await agent().post(`/v1/chat/spaces/${room}/join-requests`).set(auth(outsiderTok)).send({});
    const accept = await agent().post(`/v1/chat/spaces/${room}/join-requests/${req.body.request_id}/accept`).set(auth(memberTok)).send({});
    expect(accept.status).toBe(200);

    const grantDenied = await agent().post(`/v1/chat/spaces/${room}/roles`).set(auth(memberTok)).send({ user_id: outsiderId, role: "moderator" });
    expect(grantDenied.status).toBe(403);
  });
});

// 9–10: removed/suspended member lifecycle.
describe("9-10. My Space — removed / suspended member states", () => {
  it("9. a removed member loses access; the row is kept, not deleted", async () => {
    const room = await cellARoomId();
    const remove = await agent().post(`/v1/chat/spaces/${room}/members/${memberId}/remove`).set(auth(leaderTok)).send({});
    expect(remove.status).toBe(200);
    const denied = await agent().get(`/v1/chat/conversations/${room}`).set(auth(memberTok));
    expect(denied.status).toBe(403);
    const row = await testPool().query(`SELECT status FROM chat_members WHERE conversation_id = $1 AND user_id = $2`, [room, memberId]);
    expect(row.rows[0].status).toBe("removed");
  });

  it("10. a suspended member loses access the same way", async () => {
    const room = await cellARoomId();
    const suspend = await agent().post(`/v1/chat/spaces/${room}/members/${memberId}/suspend`).set(auth(leaderTok)).send({});
    expect(suspend.status).toBe(200);
    const denied = await agent().post(`/v1/chat/conversations/${room}/messages`).set(auth(memberTok)).send({ message_id: uuid(1), body: "let me in" });
    expect(denied.status).toBe(403);
  });
});

// 11: requires_approval (migration 170), and cell rooms' exemption from it.
describe("11. My Space — requires_approval spaces refuse a direct join", () => {
  it("a requires_approval space refuses direct join (approval_required) but the join-request path still works", async () => {
    const founderTok = staff(pastorId, "Instructor", cong);
    const created = await agent().post("/v1/chat/spaces").set(auth(founderTok))
      .send({ conversation_id: uuid(50), title: "Leadership Only", requires_approval: true });
    expect(created.status).toBe(201);

    const directJoin = await agent().post(`/v1/chat/spaces/${uuid(50)}/join`).set(auth(outsiderTok));
    expect(directJoin.status).toBe(403);
    expect(directJoin.body.error.details.approval_required).toBe(true);

    const req = await agent().post(`/v1/chat/spaces/${uuid(50)}/join-requests`).set(auth(outsiderTok)).send({});
    expect(req.body.status).toBe("pending");
    const accept = await agent().post(`/v1/chat/spaces/${uuid(50)}/join-requests/${req.body.request_id}/accept`).set(auth(founderTok)).send({});
    expect(accept.status).toBe(200);
    const after = await agent().get(`/v1/chat/conversations/${uuid(50)}`).set(auth(outsiderTok));
    expect(after.status).toBe(200);
  });

  it("a plain (requires_approval=false) space still joins directly — default behaviour unchanged", async () => {
    const founderTok = staff(pastorId, "Instructor", cong);
    await agent().post("/v1/chat/spaces").set(auth(founderTok)).send({ conversation_id: uuid(51), title: "Open Space" });
    const join = await agent().post(`/v1/chat/spaces/${uuid(51)}/join`).set(auth(outsiderTok));
    expect(join.status).toBe(200);
  });

  it("a cell room is never subject to requires_approval — its own active member always direct-joins (unaffected route)", async () => {
    const room = await cellARoomId(); // memberId already auto-joined; requires_approval doesn't even apply to kind='group'
    const row = await testPool().query(`SELECT status FROM chat_members WHERE conversation_id = $1 AND user_id = $2`, [room, memberId]);
    expect(row.rows[0].status).toBe("active");
    // The direct-join ROUTE explicitly refuses a cell room outright (422), not 403 — it was never reachable this way.
    const attempt = await agent().post(`/v1/chat/spaces/${room}/join`).set(auth(memberTok));
    expect(attempt.status).toBe(422);
  });
});

// 12: CLIENT-ONLY — My Space UX (search/unread-filter/archive, smooth tabs). No server contract to assert.

// 13–17: Chat (DM) consent gate.
describe("13-17. Chat — consent-gated DMs, block/unblock", () => {
  it("13. request → accept → DM opens → both can send", async () => {
    const req = await agent().post("/v1/chat/connections/requests").set(auth(memberTok)).send({ user_id: outsiderId });
    expect(req.status).toBe(201);
    await agent().post(`/v1/chat/connections/requests/${req.body.request_id}/accept`).set(auth(outsiderTok)).send({});
    const dm = await agent().post("/v1/chat/dms").set(auth(memberTok)).send({ user_id: outsiderId });
    expect(dm.status).toBe(201);
    const send = await agent().post(`/v1/chat/conversations/${dm.body.conversation_id}/messages`).set(auth(outsiderTok))
      .send({ message_id: uuid(2), body: "hi back" });
    expect(send.status).toBe(201);
  });

  it("14. an unsolicited DM (no accepted connection) is refused CONSENT_REQUIRED", async () => {
    const dm = await agent().post("/v1/chat/dms").set(auth(memberTok)).send({ user_id: outsiderId });
    expect(dm.status).toBe(403);
    expect(dm.body.error.code).toBe("CONSENT_REQUIRED");
  });

  it("15. a declined request leaves the pair refused until a fresh request", async () => {
    const req = await agent().post("/v1/chat/connections/requests").set(auth(memberTok)).send({ user_id: outsiderId });
    await agent().post(`/v1/chat/connections/requests/${req.body.request_id}/decline`).set(auth(outsiderTok)).send({});
    const stillRefused = await agent().post("/v1/chat/dms").set(auth(memberTok)).send({ user_id: outsiderId });
    expect(stillRefused.status).toBe(403);
    const fresh = await agent().post("/v1/chat/connections/requests").set(auth(memberTok)).send({ user_id: outsiderId });
    expect(fresh.status).toBe(201);
  });

  it("16. block stops new sends in both directions; existing history stays readable", async () => {
    const req = await agent().post("/v1/chat/connections/requests").set(auth(memberTok)).send({ user_id: outsiderId });
    await agent().post(`/v1/chat/connections/requests/${req.body.request_id}/accept`).set(auth(outsiderTok)).send({});
    const dm = await agent().post("/v1/chat/dms").set(auth(memberTok)).send({ user_id: outsiderId });
    await agent().post(`/v1/chat/conversations/${dm.body.conversation_id}/messages`).set(auth(memberTok)).send({ message_id: uuid(3), body: "before block" });

    await agent().post(`/v1/chat/connections/${outsiderId}/block`).set(auth(memberTok)).send({});
    const blockedSend = await agent().post(`/v1/chat/conversations/${dm.body.conversation_id}/messages`).set(auth(outsiderTok)).send({ message_id: uuid(4), body: "after block" });
    expect(blockedSend.status).toBe(403);

    const history = await agent().get(`/v1/chat/conversations/${dm.body.conversation_id}`).set(auth(outsiderTok));
    expect(history.status).toBe(200);
    expect((history.body.messages as Array<{ body: string }>).map((m) => m.body)).toContain("before block");
  });

  it("17. unblock reverts to 'removed' — a fresh request is required to chat again", async () => {
    const req = await agent().post("/v1/chat/connections/requests").set(auth(memberTok)).send({ user_id: outsiderId });
    await agent().post(`/v1/chat/connections/requests/${req.body.request_id}/accept`).set(auth(outsiderTok)).send({});
    await agent().post(`/v1/chat/connections/${outsiderId}/block`).set(auth(memberTok)).send({});
    const unblock = await agent().post(`/v1/chat/connections/${outsiderId}/unblock`).set(auth(memberTok)).send({});
    expect(unblock.status).toBe(200);
    expect(unblock.body.status).toBe("removed");
    const stillNeedsRequest = await agent().post("/v1/chat/dms").set(auth(outsiderTok)).send({ user_id: memberId });
    expect(stillNeedsRequest.status).toBe(403); // the EXISTING thread was already exempt via findDm — a brand new pair below asserts freshness instead
  });
});

// 18–19: My Discipler.
describe("18-19. My Discipler — assignment-gated, admin-excluded", () => {
  it("18. the thread exists ONLY with a valid current assignment (404 no_discipler otherwise), and opens once assigned", async () => {
    const before = await agent().get("/v1/chat/discipler/conversation").set(auth(memberTok));
    expect(before.status).toBe(404);
    expect(before.body.error.details.no_discipler).toBe(true);

    const assign = await agent().post("/v1/admin/discipler-assignments").set(auth(adminTok))
      .send({ disciple_user_id: memberId, discipler_user_id: leaderId });
    expect(assign.status).toBe(201);

    const opened = await agent().get("/v1/chat/discipler/conversation").set(auth(memberTok));
    expect(opened.status).toBe(200);
  });

  it("19. an ordinary Admin's oversight never surfaces a DISCIPLER thread", async () => {
    await agent().post("/v1/admin/discipler-assignments").set(auth(adminTok))
      .send({ disciple_user_id: memberId, discipler_user_id: leaderId });
    const opened = await agent().get("/v1/chat/discipler/conversation").set(auth(memberTok));
    const conversationId = opened.body.conversation_id as string;

    const inbox = await agent().get("/v1/chat/conversations").set(auth(adminTok));
    const ids = (inbox.body.conversations as Array<{ conversation_id: string }>).map((c) => c.conversation_id);
    expect(ids).not.toContain(conversationId);
    const direct = await agent().get(`/v1/chat/conversations/${conversationId}`).set(auth(adminTok));
    expect(direct.status).toBe(404);
  });
});

// 20–21: Talk with My Pastor.
describe("20-21. Talk with My Pastor — resolution order + step-up + eligibility", () => {
  it("20. resolves assigned → congregation default → audited SuperAdmin fallback, in that order", async () => {
    const fallback = await agent().post("/v1/chat/pastoral").set(auth(memberTok)).send({});
    expect(fallback.body.source).toBe("fallback_superadmin");
    expect(fallback.body.pastor_user_id).toBe(superAdminId); // earliest-created

    await testPool().query(`DELETE FROM chat_conversations WHERE conversation_id = $1`, [fallback.body.conversation_id]);
    await agent().post("/v1/admin/pastor-assignments").set(auth(adminTok))
      .send({ congregation_id: cong, pastor_user_id: defaultPastorId, assignment_kind: "default" });
    const viaDefault = await agent().post("/v1/chat/pastoral").set(auth(memberTok)).send({});
    expect(viaDefault.body.source).toBe("congregation_default");
    expect(viaDefault.body.pastor_user_id).toBe(defaultPastorId);

    await testPool().query(`DELETE FROM chat_conversations WHERE conversation_id = $1`, [viaDefault.body.conversation_id]);
    await agent().post("/v1/admin/pastor-assignments").set(auth(adminTok))
      .send({ member_user_id: memberId, pastor_user_id: pastorId });
    const viaAssigned = await agent().post("/v1/chat/pastoral").set(auth(memberTok)).send({});
    expect(viaAssigned.body.source).toBe("assigned");
    expect(viaAssigned.body.pastor_user_id).toBe(pastorId);
  });

  it("21. Pastoral Inbox needs a FRESH password step-up even for the assigned pastor; the eligibility probe needs none", async () => {
    await agent().post("/v1/admin/pastor-assignments").set(auth(adminTok))
      .send({ member_user_id: memberId, pastor_user_id: pastorId });

    const noStepUp = await agent().get("/v1/chat/pastoral/inbox").set(auth(pastorTok));
    expect(noStepUp.status).toBe(403);
    const withStepUp = await agent().get("/v1/chat/pastoral/inbox").set(auth(pastorStepUpTok));
    expect(withStepUp.status).toBe(200);

    const eligible = await agent().get("/v1/chat/pastoral/eligibility").set(auth(pastorTok)); // no step-up token
    expect(eligible.status).toBe(200);
    expect(eligible.body.is_pastor).toBe(true);

    const notPastor = await agent().get("/v1/chat/pastoral/eligibility").set(auth(memberTok));
    expect(notPastor.body.is_pastor).toBe(false);
  });
});

// 22: CLIENT-ONLY — biometric lock (device Face ID/PIN, hidden previews when
// locked, recents-blur, re-auth on timeout/restart/logout/device-lock). No
// server table by design (docs/CHAT_REDESIGN_PLAN.md §2.7) — the server's
// only piece is the password step-up already covered by scenario 21.

// 23: Broadcast → distinct BROADCAST_RESPONSE thread, reply_policy scoped to the recipient.
describe("23. Broadcast — distinct per-recipient thread, reply_policy governs the recipient only", () => {
  it("delivers as a BROADCAST_RESPONSE thread; reply_policy='none' refuses the recipient's reply but never the sender's", async () => {
    const bossTok = staff(superAdminId, "SuperAdmin", cong);
    const sent = await agent().post("/v1/chat/broadcast").set(auth(bossTok))
      .send({ body: "An important word", audience: "congregation", reply_policy: "none" });
    expect(sent.status).toBe(201);

    const inbox = await agent().get("/v1/chat/conversations").set(auth(memberTok));
    const thread = (inbox.body.conversations as Array<{ conversation_id: string; type: string }>).find((c) => c.type === "BROADCAST_RESPONSE");
    expect(thread).toBeTruthy();

    const recipientReply = await agent().post(`/v1/chat/conversations/${thread!.conversation_id}/messages`).set(auth(memberTok))
      .send({ message_id: uuid(5), body: "trying to reply" });
    expect(recipientReply.status).toBe(403);
    expect(recipientReply.body.error.details.reply_policy).toBe("none");

    const senderReply = await agent().post(`/v1/chat/conversations/${thread!.conversation_id}/messages`).set(auth(bossTok))
      .send({ message_id: uuid(6), body: "a follow-up from me" });
    expect(senderReply.status).toBe(201); // the broadcaster is never gated
  });
});

// 24: Notifications — typed + throttled.
describe("24. Notifications — typed nudges, generic pastoral, throttled against spam", () => {
  it("fires typed nudges for new DM, DISCIPLER, and PASTORAL messages, and a new broadcast", async () => {
    // DM
    const req = await agent().post("/v1/chat/connections/requests").set(auth(memberTok)).send({ user_id: outsiderId });
    await agent().post(`/v1/chat/connections/requests/${req.body.request_id}/accept`).set(auth(outsiderTok)).send({});
    const dm = await agent().post("/v1/chat/dms").set(auth(memberTok)).send({ user_id: outsiderId });
    await agent().post(`/v1/chat/conversations/${dm.body.conversation_id}/messages`).set(auth(memberTok)).send({ message_id: uuid(10), body: "hey there" });
    const dmNotif = await testPool().query(`SELECT template, payload FROM notifications WHERE user_id = $1 AND template = 'chat_dm_message'`, [outsiderId]);
    expect(dmNotif.rowCount).toBe(1);
    expect(dmNotif.rows[0].payload.title).toBe("Member Moe");
    expect(dmNotif.rows[0].payload.body).toBe("hey there");

    // DISCIPLER
    await agent().post("/v1/admin/discipler-assignments").set(auth(adminTok)).send({ disciple_user_id: memberId, discipler_user_id: leaderId });
    const disc = await agent().get("/v1/chat/discipler/conversation").set(auth(memberTok));
    await agent().post(`/v1/chat/conversations/${disc.body.conversation_id}/messages`).set(auth(memberTok)).send({ message_id: uuid(11), body: "seeking counsel" });
    const discNotif = await testPool().query(`SELECT template FROM notifications WHERE user_id = $1 AND template = 'chat_discipler_message'`, [leaderId]);
    expect(discNotif.rowCount).toBe(1);

    // PASTORAL — generic, no sender/body (owner brief §"Notifications")
    const past = await agent().post("/v1/chat/pastoral").set(auth(memberTok)).send({});
    await agent().post(`/v1/chat/conversations/${past.body.conversation_id}/messages`).set(auth(memberTok)).send({ message_id: uuid(12), body: "please pray for me privately" });
    const pastNotif = await testPool().query(`SELECT payload FROM notifications WHERE user_id = $1 AND template = 'chat_pastoral_message'`, [past.body.pastor_user_id]);
    expect(pastNotif.rowCount).toBe(1);
    expect(pastNotif.rows[0].payload.title).toBe("Nuru Pathway");
    expect(pastNotif.rows[0].payload.body).toBe("You have a new private pastoral message.");
    expect(JSON.stringify(pastNotif.rows[0].payload)).not.toContain("please pray"); // never leaks the body
    expect(JSON.stringify(pastNotif.rows[0].payload)).not.toContain("Member Moe"); // never names the sender

    // Broadcast
    const bossTok = staff(superAdminId, "SuperAdmin", cong);
    await agent().post("/v1/chat/broadcast").set(auth(bossTok)).send({ body: "Sunday is coming", audience: "congregation" });
    const bcNotif = await testPool().query(`SELECT template FROM notifications WHERE user_id = $1 AND template = 'chat_broadcast'`, [memberId]);
    expect(bcNotif.rowCount).toBe(1);
  });

  it("throttles: a second message before the first nudge is dispatched does not double-schedule; a THIRD after dispatch does", async () => {
    const req = await agent().post("/v1/chat/connections/requests").set(auth(memberTok)).send({ user_id: outsiderId });
    await agent().post(`/v1/chat/connections/requests/${req.body.request_id}/accept`).set(auth(outsiderTok)).send({});
    const dm = await agent().post("/v1/chat/dms").set(auth(memberTok)).send({ user_id: outsiderId });

    await agent().post(`/v1/chat/conversations/${dm.body.conversation_id}/messages`).set(auth(memberTok)).send({ message_id: uuid(20), body: "one" });
    await agent().post(`/v1/chat/conversations/${dm.body.conversation_id}/messages`).set(auth(memberTok)).send({ message_id: uuid(21), body: "two" });
    let rows = await testPool().query(
      `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND template = 'chat_dm_message'`, [outsiderId],
    );
    expect(rows.rows[0].n).toBe(1); // still just the first — the second is throttled

    // Simulate the dispatch worker delivering the first nudge.
    await testPool().query(`UPDATE notifications SET status = 'sent' WHERE user_id = $1 AND template = 'chat_dm_message'`, [outsiderId]);
    await agent().post(`/v1/chat/conversations/${dm.body.conversation_id}/messages`).set(auth(memberTok)).send({ message_id: uuid(22), body: "three" });
    rows = await testPool().query(
      `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND template = 'chat_dm_message'`, [outsiderId],
    );
    expect(rows.rows[0].n).toBe(2); // a fresh nudge is free to schedule once the prior one is no longer undelivered
  });
});

// 25: deactivated-account handling.
describe("25. Deactivated-account handling", () => {
  it("a soft-deleted member cannot be reached by a fresh connection request or DM (404, no existence leak)", async () => {
    await testPool().query(`UPDATE users SET deleted_at = now() WHERE user_id = $1`, [outsiderId]);
    const req = await agent().post("/v1/chat/connections/requests").set(auth(memberTok)).send({ user_id: outsiderId });
    expect(req.status).toBe(404);
    const dm = await agent().post("/v1/chat/dms").set(auth(memberTok)).send({ user_id: outsiderId });
    expect(dm.status).toBe(404);
  });

  it("pastoral fallback resolution skips a deleted SuperAdmin — resolves to the next earliest ACTIVE one", async () => {
    await testPool().query(`UPDATE users SET deleted_at = now() WHERE user_id = $1`, [superAdminId]); // the earliest — deactivated
    const opened = await agent().post("/v1/chat/pastoral").set(auth(memberTok)).send({});
    expect(opened.status).toBe(201);
    expect(opened.body.pastor_user_id).toBe(superAdmin2Id); // falls through to the next active SuperAdmin, not a ghost account
    expect(opened.body.source).toBe("fallback_superadmin");
  });
});

// ---- Additional C4 coverage beyond the §16 matrix (worklist items not
// tied to a single named scenario above) ----

describe("additional coverage — conversation `type` exposure (list + detail, additive)", () => {
  it("list and detail both carry `type` alongside `kind`", async () => {
    const req = await agent().post("/v1/chat/connections/requests").set(auth(memberTok)).send({ user_id: outsiderId });
    await agent().post(`/v1/chat/connections/requests/${req.body.request_id}/accept`).set(auth(outsiderTok)).send({});
    const dm = await agent().post("/v1/chat/dms").set(auth(memberTok)).send({ user_id: outsiderId });

    const list = await agent().get("/v1/chat/conversations").set(auth(memberTok));
    const row = (list.body.conversations as Array<{ conversation_id: string; type: string }>).find((c) => c.conversation_id === dm.body.conversation_id);
    expect(row?.type).toBe("DIRECT");

    const detail = await agent().get(`/v1/chat/conversations/${dm.body.conversation_id}`).set(auth(memberTok));
    expect(detail.body.type).toBe("DIRECT");
  });
});

describe("additional coverage — member-facing message report", () => {
  it("is idempotent per reporter+message and surfaces in the existing moderation queue's flagged count", async () => {
    const room = await cellARoomId();
    const sent = await agent().post(`/v1/chat/conversations/${room}/messages`).set(auth(memberTok)).send({ message_id: uuid(30), body: "questionable" });
    expect(sent.status).toBe(201);

    const report1 = await agent().post(`/v1/chat/messages/${uuid(30)}/report`).set(auth(leaderTok)).send({ reason: "off-topic" });
    expect(report1.status).toBe(201);
    expect(report1.body.already).toBe(false);
    const report2 = await agent().post(`/v1/chat/messages/${uuid(30)}/report`).set(auth(leaderTok)).send({ reason: "off-topic again" });
    expect(report2.status).toBe(201);
    expect(report2.body.already).toBe(true);

    const count = await testPool().query(`SELECT count(*)::int AS n FROM message_reports WHERE message_id = $1`, [uuid(30)]);
    expect(count.rows[0].n).toBe(1); // one row per reporter, not two

    const modInbox = await agent().get("/v1/chat/conversations").set(auth(adminTok));
    const modRow = (modInbox.body.conversations as Array<{ conversation_id: string; flagged: number }>).find((c) => c.conversation_id === room);
    expect(modRow?.flagged).toBeGreaterThanOrEqual(1);
  });

  it("refuses a non-participant (404, no existence leak)", async () => {
    const req = await agent().post("/v1/chat/connections/requests").set(auth(memberTok)).send({ user_id: outsiderId });
    await agent().post(`/v1/chat/connections/requests/${req.body.request_id}/accept`).set(auth(outsiderTok)).send({});
    const dm = await agent().post("/v1/chat/dms").set(auth(memberTok)).send({ user_id: outsiderId });
    const sent = await agent().post(`/v1/chat/conversations/${dm.body.conversation_id}/messages`).set(auth(memberTok)).send({ message_id: uuid(31), body: "private" });
    expect(sent.status).toBe(201);
    const outsiderReport = await agent().post(`/v1/chat/messages/${uuid(31)}/report`).set(auth(leaderTok)).send({}); // leader is not in this DM
    expect(outsiderReport.status).toBe(404);
  });
});
