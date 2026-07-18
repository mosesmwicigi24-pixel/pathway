// Chat connections — consent-gated Chat (Chat Redesign C1/C2,
// docs/CHAT_REDESIGN.md, docs/CHAT_REDESIGN_PLAN.md). "No unsolicited DMs":
// request → accept → chat; unsolicited DM refused; declined stays refused;
// block stops both directions; remove reverts to not-connected; existing
// threads are never re-gated (grandfathering).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, closeTestPool, testPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser } from "./helpers/factories.js";

let cong: string;
let aId: string, aTok: string;
let bId: string, bTok: string;
let cId: string, cTok: string;
let minorId: string, minorTok: string;
let adminId: string, adminTok: string;

const auth = (t: string) => ({ Authorization: t });
const uuid = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  const cell = await createCellGroup(cong, "Cell Con");
  const a = await createUser({ congregationId: cong, cellGroupId: cell, email: "conn-a@dev.local", fullName: "Ann" });
  const b = await createUser({ congregationId: cong, cellGroupId: cell, email: "conn-b@dev.local", fullName: "Ben" });
  const cc = await createUser({ congregationId: cong, cellGroupId: cell, email: "conn-c@dev.local", fullName: "Cara" });
  const minor = await createUser({ congregationId: cong, cellGroupId: cell, email: "conn-m@dev.local", fullName: "Kid", dateOfBirth: "2015-01-01" });
  const admin = await createUser({ congregationId: cong, role: "Admin", email: "conn-admin@dev.local", fullName: "Overseer" });
  aId = a.user_id; bId = b.user_id; cId = cc.user_id; minorId = minor.user_id; adminId = admin.user_id;
  aTok = bearer({ sub: aId, role: "Student", cong });
  bTok = bearer({ sub: bId, role: "Student", cong });
  cTok = bearer({ sub: cId, role: "Student", cong });
  minorTok = bearer({ sub: minorId, role: "Student", cong });
  adminTok = bearer({ sub: adminId, role: "Admin", cong });
});
afterAll(async () => {
  await closeTestPool();
});

describe("connection request → accept → chat", () => {
  it("end to end: request, accept, then a DM opens and both can chat", async () => {
    const req = await agent().post("/v1/chat/connections/requests").set(auth(aTok)).send({ user_id: bId, message: "hi Ben!" });
    expect(req.status).toBe(201);
    expect(req.body.status).toBe("pending");
    expect(req.body.mutual).toBe(false);

    // Not yet connected — a DM still refuses.
    const early = await agent().post("/v1/chat/dms").set(auth(aTok)).send({ user_id: bId });
    expect(early.status).toBe(403);
    expect(early.body.error.code).toBe("CONSENT_REQUIRED");
    expect(early.body.error.details.hint).toBe("send a connection request first");

    // It shows up in each side's request list.
    const outgoing = await agent().get("/v1/chat/connections/requests").query({ direction: "outgoing" }).set(auth(aTok));
    expect((outgoing.body.data as Array<{ user_id: string }>).map((r) => r.user_id)).toContain(bId);
    const incoming = await agent().get("/v1/chat/connections/requests").query({ direction: "incoming" }).set(auth(bTok));
    expect((incoming.body.data as Array<{ user_id: string }>).map((r) => r.user_id)).toContain(aId);

    const acc = await agent().post(`/v1/chat/connections/requests/${req.body.request_id}/accept`).set(auth(bTok)).send({});
    expect(acc.status).toBe(200);
    expect(acc.body.status).toBe("accepted");

    // Now connected — appears in both lists.
    const aList = await agent().get("/v1/chat/connections").set(auth(aTok));
    expect((aList.body.data as Array<{ user_id: string }>).map((c) => c.user_id)).toContain(bId);
    const bList = await agent().get("/v1/chat/connections").set(auth(bTok));
    expect((bList.body.data as Array<{ user_id: string }>).map((c) => c.user_id)).toContain(aId);

    const made = await agent().post("/v1/chat/dms").set(auth(aTok)).send({ user_id: bId });
    expect(made.status).toBe(201);
    const send = await agent().post(`/v1/chat/conversations/${made.body.conversation_id}/messages`).set(auth(aTok))
      .send({ message_id: uuid(1), body: "Hey Ben, connected!" });
    expect(send.status).toBe(201);
    const read = await agent().get(`/v1/chat/conversations/${made.body.conversation_id}`).set(auth(bTok));
    expect((read.body.messages as Array<{ body: string }>).map((m) => m.body)).toContain("Hey Ben, connected!");
  });

  it("a mutual ask (both sides request) resolves immediately to accepted", async () => {
    const first = await agent().post("/v1/chat/connections/requests").set(auth(aTok)).send({ user_id: bId });
    expect(first.body.status).toBe("pending");
    // Ben asks Ann back before Ann has accepted — resolves both sides at once.
    const second = await agent().post("/v1/chat/connections/requests").set(auth(bTok)).send({ user_id: aId });
    expect(second.status).toBe(201);
    expect(second.body.status).toBe("accepted");
    expect(second.body.mutual).toBe(true);
    expect(second.body.request_id).toBe(first.body.request_id); // resolved the SAME ask, not a second one

    const made = await agent().post("/v1/chat/dms").set(auth(aTok)).send({ user_id: bId });
    expect(made.status).toBe(201);
  });

  it("declined stays refused — a DM still requires a fresh request", async () => {
    const req = await agent().post("/v1/chat/connections/requests").set(auth(aTok)).send({ user_id: bId });
    const dec = await agent().post(`/v1/chat/connections/requests/${req.body.request_id}/decline`).set(auth(bTok)).send({});
    expect(dec.status).toBe(200);
    expect(dec.body.status).toBe("declined");

    const dm = await agent().post("/v1/chat/dms").set(auth(aTok)).send({ user_id: bId });
    expect(dm.status).toBe(403);
    expect(dm.body.error.code).toBe("CONSENT_REQUIRED");

    // A fresh ask is allowed (declined doesn't permanently lock the pair).
    const again = await agent().post("/v1/chat/connections/requests").set(auth(aTok)).send({ user_id: bId });
    expect(again.status).toBe(201);
  });

  it("only the recipient may accept/decline; only the requester may cancel", async () => {
    const req = await agent().post("/v1/chat/connections/requests").set(auth(aTok)).send({ user_id: bId });
    const selfAccept = await agent().post(`/v1/chat/connections/requests/${req.body.request_id}/accept`).set(auth(aTok)).send({});
    expect(selfAccept.status).toBe(403);
    const outsiderDecline = await agent().post(`/v1/chat/connections/requests/${req.body.request_id}/decline`).set(auth(cTok)).send({});
    expect(outsiderDecline.status).toBe(403);
    const recipientCancel = await agent().delete(`/v1/chat/connections/requests/${req.body.request_id}`).set(auth(bTok));
    expect(recipientCancel.status).toBe(403);

    const cancel = await agent().delete(`/v1/chat/connections/requests/${req.body.request_id}`).set(auth(aTok));
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe("cancelled");
  });

  it("409s a second request while one is already pending, and once already connected", async () => {
    await agent().post("/v1/chat/connections/requests").set(auth(aTok)).send({ user_id: bId });
    const dup = await agent().post("/v1/chat/connections/requests").set(auth(aTok)).send({ user_id: bId });
    expect(dup.status).toBe(409);

    const cancelled = await testPool().query(`SELECT request_id FROM connection_requests WHERE requester_id = $1`, [aId]);
    const acc = await agent().post(`/v1/chat/connections/requests/${cancelled.rows[0].request_id}/accept`).set(auth(bTok)).send({});
    expect(acc.status).toBe(200);

    const already = await agent().post("/v1/chat/connections/requests").set(auth(bTok)).send({ user_id: aId });
    expect(already.status).toBe(409);
  });

  it("is idempotent on client_mutation_id", async () => {
    const mut = uuid(70);
    const first = await agent().post("/v1/chat/connections/requests").set(auth(aTok)).send({ user_id: bId, client_mutation_id: mut });
    const replay = await agent().post("/v1/chat/connections/requests").set(auth(aTok)).send({ user_id: bId, client_mutation_id: mut });
    expect(replay.body.request_id).toBe(first.body.request_id);
    expect(replay.body.duplicate).toBe(true);
    const count = await testPool().query(`SELECT count(*)::int AS n FROM connection_requests`);
    expect(count.rows[0].n).toBe(1);
  });

  it("refuses connections with/as a minor (D-M6, extended)", async () => {
    const res = await agent().post("/v1/chat/connections/requests").set(auth(aTok)).send({ user_id: minorId });
    expect(res.status).toBe(403);
  });

  it("emits typed notifications on request, accept, and decline", async () => {
    const req = await agent().post("/v1/chat/connections/requests").set(auth(aTok)).send({ user_id: bId });
    let rows = await testPool().query(`SELECT template FROM notifications WHERE user_id = $1`, [bId]);
    expect(rows.rows.map((r: { template: string }) => r.template)).toContain("connection_request_received");

    await agent().post(`/v1/chat/connections/requests/${req.body.request_id}/accept`).set(auth(bTok)).send({});
    rows = await testPool().query(`SELECT template FROM notifications WHERE user_id = $1`, [aId]);
    expect(rows.rows.map((r: { template: string }) => r.template)).toContain("connection_request_accepted");

    const req2 = await agent().post("/v1/chat/connections/requests").set(auth(cTok)).send({ user_id: aId });
    await agent().post(`/v1/chat/connections/requests/${req2.body.request_id}/decline`).set(auth(aTok)).send({});
    rows = await testPool().query(`SELECT template FROM notifications WHERE user_id = $1`, [cId]);
    expect(rows.rows.map((r: { template: string }) => r.template)).toContain("connection_request_declined");
  });
});

describe("block / unblock", () => {
  it("stops sends in both directions; existing history stays readable", async () => {
    const req = await agent().post("/v1/chat/connections/requests").set(auth(aTok)).send({ user_id: bId });
    await agent().post(`/v1/chat/connections/requests/${req.body.request_id}/accept`).set(auth(bTok)).send({});
    const dm = await agent().post("/v1/chat/dms").set(auth(aTok)).send({ user_id: bId });
    await agent().post(`/v1/chat/conversations/${dm.body.conversation_id}/messages`).set(auth(aTok)).send({ message_id: uuid(10), body: "before the block" });

    const block = await agent().post(`/v1/chat/connections/${bId}/block`).set(auth(aTok)).send({});
    expect(block.status).toBe(200);
    expect(block.body.status).toBe("blocked");

    // Neither side can send anymore.
    const fromBlocker = await agent().post(`/v1/chat/conversations/${dm.body.conversation_id}/messages`).set(auth(aTok)).send({ message_id: uuid(11), body: "blocker tries" });
    expect(fromBlocker.status).toBe(403);
    const fromBlocked = await agent().post(`/v1/chat/conversations/${dm.body.conversation_id}/messages`).set(auth(bTok)).send({ message_id: uuid(12), body: "blocked tries" });
    expect(fromBlocked.status).toBe(403);

    // Existing history stays visible to both.
    const readByBlocker = await agent().get(`/v1/chat/conversations/${dm.body.conversation_id}`).set(auth(aTok));
    expect((readByBlocker.body.messages as Array<{ body: string }>).map((m) => m.body)).toContain("before the block");
    const readByBlocked = await agent().get(`/v1/chat/conversations/${dm.body.conversation_id}`).set(auth(bTok));
    expect((readByBlocked.body.messages as Array<{ body: string }>).map((m) => m.body)).toContain("before the block");
  });

  it("cancels a pending request between the pair", async () => {
    await agent().post("/v1/chat/connections/requests").set(auth(aTok)).send({ user_id: bId });
    await agent().post(`/v1/chat/connections/${bId}/block`).set(auth(aTok)).send({});
    const row = await testPool().query(`SELECT status FROM connection_requests WHERE user_a = LEAST($1::uuid,$2::uuid) AND user_b = GREATEST($1::uuid,$2::uuid)`, [aId, bId]);
    expect(row.rows[0].status).toBe("cancelled");
  });

  it("only the blocker may unblock; unblocking reverts to removed, not re-accepted", async () => {
    await agent().post(`/v1/chat/connections/${bId}/block`).set(auth(aTok)).send({});
    const wrongParty = await agent().post(`/v1/chat/connections/${aId}/unblock`).set(auth(bTok)).send({});
    expect(wrongParty.status).toBe(403);

    const ok = await agent().post(`/v1/chat/connections/${bId}/unblock`).set(auth(aTok)).send({});
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("removed");

    // Chatting again needs a fresh request, not automatic re-acceptance.
    const dm = await agent().post("/v1/chat/dms").set(auth(aTok)).send({ user_id: bId });
    expect(dm.status).toBe(403);
    expect(dm.body.error.code).toBe("CONSENT_REQUIRED");
  });
});

describe("remove connection", () => {
  it("reverts to not-connected; existing thread history is kept but a NEW thread needs a fresh accept", async () => {
    const req = await agent().post("/v1/chat/connections/requests").set(auth(aTok)).send({ user_id: bId });
    await agent().post(`/v1/chat/connections/requests/${req.body.request_id}/accept`).set(auth(bTok)).send({});
    const dm = await agent().post("/v1/chat/dms").set(auth(aTok)).send({ user_id: bId });
    await agent().post(`/v1/chat/conversations/${dm.body.conversation_id}/messages`).set(auth(aTok)).send({ message_id: uuid(20), body: "keepsake" });

    const removed = await agent().post(`/v1/chat/connections/${aId}/remove`).set(auth(bTok)).send({});
    expect(removed.status).toBe(200);
    expect(removed.body.status).toBe("removed");

    const list = await agent().get("/v1/chat/connections").set(auth(aTok));
    expect((list.body.data as Array<{ user_id: string }>).map((c) => c.user_id)).not.toContain(bId);

    // The EXISTING thread is untouched (no-data-loss) — reopening it via its id still works.
    const reread = await agent().get(`/v1/chat/conversations/${dm.body.conversation_id}`).set(auth(aTok));
    expect(reread.status).toBe(200);
    expect((reread.body.messages as Array<{ body: string }>).map((m) => m.body)).toContain("keepsake");

    // But POST /chat/dms for a case with NO existing thread would need a fresh
    // connection — proven against a third party who was never connected.
    const freshAttempt = await agent().post("/v1/chat/dms").set(auth(aTok)).send({ user_id: cId });
    expect(freshAttempt.status).toBe(403);
  });
});

describe("grandfathering — existing threads are never re-gated", () => {
  it("a pre-existing DM thread with no accepted connection row is still returned by POST /chat/dms", async () => {
    // Simulates a thread that predates the consent model (e.g. a DISCIPLER/
    // PASTORAL-flavoured DM, deliberately excluded from migration 162's
    // accepted-connection backfill) — createOrGetDm's find-first step must
    // return it unconditionally, never re-gate an existing thread.
    const convoId = uuid(30);
    await testPool().query(
      `INSERT INTO chat_conversations (conversation_id, kind, congregation_id, created_by) VALUES ($1, 'dm', $2, $3)`,
      [convoId, cong, aId],
    );
    await testPool().query(`INSERT INTO chat_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`, [convoId, aId, cId]);
    const noConnection = await testPool().query(
      `SELECT 1 FROM user_connections WHERE user_a = LEAST($1::uuid,$2::uuid) AND user_b = GREATEST($1::uuid,$2::uuid)`, [aId, cId],
    );
    expect(noConnection.rowCount).toBe(0);

    const opened = await agent().post("/v1/chat/dms").set(auth(aTok)).send({ user_id: cId });
    expect(opened.status).toBe(201);
    expect(opened.body.conversation_id).toBe(convoId);
  });

  it("a migration-162-backfilled accepted connection lets a DM open normally", async () => {
    const convoId = uuid(31);
    await testPool().query(
      `INSERT INTO chat_conversations (conversation_id, kind, type, congregation_id, created_by, created_at)
       VALUES ($1, 'dm', 'DIRECT', $2, $3, now())`,
      [convoId, cong, aId],
    );
    await testPool().query(`INSERT INTO chat_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`, [convoId, aId, bId]);
    await testPool().query(
      `INSERT INTO user_connections (user_a, user_b, status, established_at, updated_at)
       VALUES (LEAST($1::uuid,$2::uuid), GREATEST($1::uuid,$2::uuid), 'accepted', now(), now())`,
      [aId, bId],
    );
    const opened = await agent().post("/v1/chat/dms").set(auth(aTok)).send({ user_id: bId });
    expect(opened.status).toBe(201);
    expect(opened.body.conversation_id).toBe(convoId);
    const send = await agent().post(`/v1/chat/conversations/${convoId}/messages`).set(auth(bTok)).send({ message_id: uuid(32), body: "still works" });
    expect(send.status).toBe(201);
  });
});

describe("staff exception stays audited", () => {
  it("records an audit_log entry when staff opens a brand-new DM without a connection", async () => {
    const res = await agent().post("/v1/chat/dms").set(auth(adminTok)).send({ user_id: bId });
    expect(res.status).toBe(201);
    const rows = await testPool().query(`SELECT action FROM audit_log WHERE actor_id = $1 AND action = 'chat.dm.staff_exception'`, [adminId]);
    expect(rows.rowCount).toBeGreaterThanOrEqual(1);
  });
});

// keep references used (lint)
void cId;
