// Conversation mutes (Chat Redesign C4, docs/CHAT_REDESIGN.md — "Chat"
// §"Controls: ... mute, archive, ..." and "Talk with My Pastor" §"⋮ menu —
// ... mute, archive, ...", migration 172 `conversation_mutes`).
//
// Covers: mute suppresses each typed nudge (chat_dm_message /
// chat_discipler_message / chat_pastoral_message / chat_broadcast), an
// expired timed mute lets a fresh nudge through again, an explicit unmute
// restores nudges immediately, a non-participant is refused (404, no
// existence leak), and both mute and unmute are idempotent. `muted` is also
// checked as additive on the conversation list + detail payloads.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, closeTestPool, testPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser, setCellLeader } from "./helpers/factories.js";

let cong: string;
let cellA: string;
let leaderId: string, leaderTok: string; // leader of cellA — doubles as the disciple's discipler below
let memberId: string, memberTok: string;
let outsiderId: string, outsiderTok: string; // not in cellA, not connected to memberId
let adminTok: string;
let superAdminId: string, superAdminTok: string;

const auth = (t: string) => ({ Authorization: t });
const staff = (sub: string, role: "Instructor" | "Admin" | "SuperAdmin", congId: string): string =>
  bearer({ sub, role, cong: congId, pwd_at: Math.floor(Date.now() / 1000) });
const uuid = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  cellA = await createCellGroup(cong, "Cell A");
  const leader = await createUser({ congregationId: cong, cellGroupId: cellA, email: "mu-leader@dev.local", fullName: "Leader Lyn" });
  const member = await createUser({ congregationId: cong, cellGroupId: cellA, email: "mu-member@dev.local", fullName: "Member Moe" });
  const outsider = await createUser({ congregationId: cong, email: "mu-out@dev.local", fullName: "Outsider Otto" });
  const admin = await createUser({ congregationId: cong, role: "Admin", email: "mu-admin@dev.local", fullName: "Overseer" });
  const superAdmin = await createUser({ congregationId: cong, role: "SuperAdmin", email: "mu-super@dev.local", fullName: "Boss Bea" });

  leaderId = leader.user_id; memberId = member.user_id; outsiderId = outsider.user_id;
  await setCellLeader(cellA, leaderId);
  leaderTok = bearer({ sub: leaderId, role: "Student", cong });
  memberTok = bearer({ sub: memberId, role: "Student", cong });
  outsiderTok = bearer({ sub: outsiderId, role: "Student", cong });
  adminTok = staff(admin.user_id, "Admin", cong);
  superAdminId = superAdmin.user_id;
  superAdminTok = staff(superAdminId, "SuperAdmin", cong);
});
afterAll(async () => {
  await closeTestPool();
});

/** memberId <-> outsiderId, connected + DM open. */
async function openDm(): Promise<string> {
  const req = await agent().post("/v1/chat/connections/requests").set(auth(memberTok)).send({ user_id: outsiderId });
  await agent().post(`/v1/chat/connections/requests/${req.body.request_id}/accept`).set(auth(outsiderTok)).send({});
  const dm = await agent().post("/v1/chat/dms").set(auth(memberTok)).send({ user_id: outsiderId });
  return dm.body.conversation_id as string;
}

async function notifCount(userId: string, template: string): Promise<number> {
  const rows = await testPool().query(
    `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND template = $2`, [userId, template],
  );
  return rows.rows[0].n;
}

describe("mute — chat_dm_message suppression", () => {
  it("an active forever-mute suppresses the DM nudge for the muter only", async () => {
    const dm = await openDm();
    const mute = await agent().put(`/v1/chat/conversations/${dm}/mute`).set(auth(outsiderTok)).send({});
    expect(mute.status).toBe(200);
    expect(mute.body).toMatchObject({ conversation_id: dm, muted: true, muted_until: null });

    await agent().post(`/v1/chat/conversations/${dm}/messages`).set(auth(memberTok)).send({ message_id: uuid(1), body: "hey" });
    expect(await notifCount(outsiderId, "chat_dm_message")).toBe(0);

    // Reply back the other way — the SENDER (memberId) never muted, so they get nudged normally.
    await agent().post(`/v1/chat/conversations/${dm}/messages`).set(auth(outsiderTok)).send({ message_id: uuid(2), body: "reply" });
    expect(await notifCount(memberId, "chat_dm_message")).toBe(1);
  });

  it("unmute restores nudges immediately", async () => {
    const dm = await openDm();
    await agent().put(`/v1/chat/conversations/${dm}/mute`).set(auth(outsiderTok)).send({});
    await agent().post(`/v1/chat/conversations/${dm}/messages`).set(auth(memberTok)).send({ message_id: uuid(3), body: "one" });
    expect(await notifCount(outsiderId, "chat_dm_message")).toBe(0);

    const unmute = await agent().delete(`/v1/chat/conversations/${dm}/mute`).set(auth(outsiderTok));
    expect(unmute.status).toBe(200);
    expect(unmute.body).toMatchObject({ conversation_id: dm, muted: false });

    await agent().post(`/v1/chat/conversations/${dm}/messages`).set(auth(memberTok)).send({ message_id: uuid(4), body: "two" });
    expect(await notifCount(outsiderId, "chat_dm_message")).toBe(1);
  });

  it("a timed mute in the past no longer suppresses — expiry restores nudges without an explicit unmute", async () => {
    const dm = await openDm();
    const past = new Date(Date.now() - 60_000).toISOString();
    const mute = await agent().put(`/v1/chat/conversations/${dm}/mute`).set(auth(outsiderTok)).send({ until: past });
    expect(mute.status).toBe(200);
    expect(mute.body.muted_until).toBe(past);

    await agent().post(`/v1/chat/conversations/${dm}/messages`).set(auth(memberTok)).send({ message_id: uuid(5), body: "already expired" });
    expect(await notifCount(outsiderId, "chat_dm_message")).toBe(1); // never suppressed — expiry was already in the past
  });

  it("a timed mute still in the future suppresses; is idempotent (overwrites, not duplicates)", async () => {
    const dm = await openDm();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    await agent().put(`/v1/chat/conversations/${dm}/mute`).set(auth(outsiderTok)).send({ until: future });
    const again = await agent().put(`/v1/chat/conversations/${dm}/mute`).set(auth(outsiderTok)).send({ until: future });
    expect(again.status).toBe(200);

    const rows = await testPool().query(`SELECT count(*)::int AS n FROM conversation_mutes WHERE conversation_id = $1 AND user_id = $2`, [dm, outsiderId]);
    expect(rows.rows[0].n).toBe(1); // one row, overwritten — not two

    await agent().post(`/v1/chat/conversations/${dm}/messages`).set(auth(memberTok)).send({ message_id: uuid(6), body: "still muted" });
    expect(await notifCount(outsiderId, "chat_dm_message")).toBe(0);
  });

  it("unmute is idempotent — unmuting an already-unmuted (or never-muted) conversation is a no-op, not an error", async () => {
    const dm = await openDm();
    const first = await agent().delete(`/v1/chat/conversations/${dm}/mute`).set(auth(outsiderTok));
    expect(first.status).toBe(200);
    const second = await agent().delete(`/v1/chat/conversations/${dm}/mute`).set(auth(outsiderTok));
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ conversation_id: dm, muted: false });
  });
});

describe("mute — discipler and pastoral nudges", () => {
  it("suppresses chat_discipler_message", async () => {
    await agent().post("/v1/admin/discipler-assignments").set(auth(adminTok)).send({ disciple_user_id: memberId, discipler_user_id: leaderId });
    const disc = await agent().get("/v1/chat/discipler/conversation").set(auth(memberTok));
    const conversationId = disc.body.conversation_id as string;

    await agent().put(`/v1/chat/conversations/${conversationId}/mute`).set(auth(leaderTok)).send({});
    await agent().post(`/v1/chat/conversations/${conversationId}/messages`).set(auth(memberTok)).send({ message_id: uuid(10), body: "seeking counsel" });
    expect(await notifCount(leaderId, "chat_discipler_message")).toBe(0);
  });

  it("suppresses chat_pastoral_message (generic template) for the pastor when the PASTOR muted the thread", async () => {
    const past = await agent().post("/v1/chat/pastoral").set(auth(memberTok)).send({});
    expect(past.status).toBe(201);
    const conversationId = past.body.conversation_id as string;
    const pastorId = past.body.pastor_user_id as string; // resolves to superAdminId (fallback — no explicit assignment/default)
    expect(pastorId).toBe(superAdminId);

    await agent().put(`/v1/chat/conversations/${conversationId}/mute`).set(auth(superAdminTok)).send({});
    await agent().post(`/v1/chat/conversations/${conversationId}/messages`).set(auth(memberTok)).send({ message_id: uuid(11), body: "please pray for me" });
    expect(await notifCount(pastorId, "chat_pastoral_message")).toBe(0);
  });
});

describe("mute — broadcast nudges too", () => {
  it("suppresses chat_broadcast for a recipient who muted their BROADCAST_RESPONSE thread ahead of time", async () => {
    // Bootstrap the BROADCAST_RESPONSE thread by sending once, then mute it, then send again.
    const first = await agent().post("/v1/chat/broadcast").set(auth(superAdminTok)).send({ body: "first word", audience: "congregation" });
    expect(first.status).toBe(201);
    const inbox = await agent().get("/v1/chat/conversations").set(auth(outsiderTok));
    const thread = (inbox.body.conversations as Array<{ conversation_id: string; type: string }>).find((c) => c.type === "BROADCAST_RESPONSE");
    expect(thread).toBeTruthy();
    expect(await notifCount(outsiderId, "chat_broadcast")).toBe(1);

    await agent().put(`/v1/chat/conversations/${thread!.conversation_id}/mute`).set(auth(outsiderTok)).send({});
    // Dispatch the outstanding nudge so the throttle doesn't mask the mute check.
    await testPool().query(`UPDATE notifications SET status = 'sent' WHERE user_id = $1 AND template = 'chat_broadcast'`, [outsiderId]);

    await agent().post("/v1/chat/broadcast").set(auth(superAdminTok)).send({ body: "second word", audience: "congregation" });
    expect(await notifCount(outsiderId, "chat_broadcast")).toBe(1); // still 1 — the second was suppressed by the mute, not the throttle
  });
});

describe("mute — access control", () => {
  it("refuses a non-participant (404, no existence leak)", async () => {
    const dm = await openDm();
    const mute = await agent().put(`/v1/chat/conversations/${dm}/mute`).set(auth(leaderTok)).send({});
    expect(mute.status).toBe(404);
    const unmute = await agent().delete(`/v1/chat/conversations/${dm}/mute`).set(auth(leaderTok));
    expect(unmute.status).toBe(404);
  });

  it("404s for a conversation id that doesn't exist at all", async () => {
    const mute = await agent().put(`/v1/chat/conversations/${uuid(99)}/mute`).set(auth(memberTok)).send({});
    expect(mute.status).toBe(404);
  });

  it("401s without auth", async () => {
    const dm = await openDm();
    const mute = await agent().put(`/v1/chat/conversations/${dm}/mute`).send({});
    expect(mute.status).toBe(401);
  });
});

describe("mute — surfaced additively on list + detail", () => {
  it("`muted` appears false by default, true after muting, on both the list row and the detail head", async () => {
    const dm = await openDm();

    const before = await agent().get("/v1/chat/conversations").set(auth(outsiderTok));
    const beforeRow = (before.body.conversations as Array<{ conversation_id: string; muted: boolean }>).find((c) => c.conversation_id === dm);
    expect(beforeRow?.muted).toBe(false);
    const beforeDetail = await agent().get(`/v1/chat/conversations/${dm}`).set(auth(outsiderTok));
    expect(beforeDetail.body.muted).toBe(false);

    await agent().put(`/v1/chat/conversations/${dm}/mute`).set(auth(outsiderTok)).send({});

    const after = await agent().get("/v1/chat/conversations").set(auth(outsiderTok));
    const afterRow = (after.body.conversations as Array<{ conversation_id: string; muted: boolean }>).find((c) => c.conversation_id === dm);
    expect(afterRow?.muted).toBe(true);
    const afterDetail = await agent().get(`/v1/chat/conversations/${dm}`).set(auth(outsiderTok));
    expect(afterDetail.body.muted).toBe(true);

    // The OTHER participant never sees it as muted — mine only.
    const otherSide = await agent().get("/v1/chat/conversations").set(auth(memberTok));
    const otherRow = (otherSide.body.conversations as Array<{ conversation_id: string; muted: boolean }>).find((c) => c.conversation_id === dm);
    expect(otherRow?.muted).toBe(false);
  });
});
