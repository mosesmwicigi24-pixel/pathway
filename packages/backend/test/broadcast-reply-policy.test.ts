// Broadcast reply_policy (Chat Redesign C2, migration 165,
// docs/CHAT_REDESIGN_PLAN.md §2.6) — enforced at send time in
// ChatService#sendMessage. The default (omitted / 'ordinary_chat') is
// today's exact, unchanged behaviour; 'none'/'official_inbox' refuse the
// RECIPIENT's reply (never the broadcaster); 'linked_thread' additionally
// resolves where the reply SHOULD go (the sender's DISCIPLER/PASTORAL thread
// with the member) rather than silently writing it there.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser } from "./helpers/factories.js";

let cong: string, cell: string;
let bossId: string, bossTok: string; // SuperAdmin, broadcasts + (in one test) doubles as discipler
let memberId: string, memberTok: string;

const auth = (t: string) => ({ Authorization: t });
const staff = (sub: string, role: "Instructor" | "Admin" | "SuperAdmin", congId: string): string =>
  bearer({ sub, role, cong: congId, pwd_at: Math.floor(Date.now() / 1000) });
const uuid = (n: number) => `00000000-0000-4000-9000-0000000000${String(n).padStart(2, "0")}`;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  cell = await createCellGroup(cong, "Cell RP");
  const boss = await createUser({ congregationId: cong, role: "SuperAdmin", email: "rp-boss@dev.local", fullName: "Boss" });
  const member = await createUser({ congregationId: cong, cellGroupId: cell, email: "rp-member@dev.local", fullName: "Mo" });
  bossId = boss.user_id; bossTok = staff(bossId, "SuperAdmin", cong);
  memberId = member.user_id; memberTok = bearer({ sub: memberId, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

/** Send a broadcast with the given reply_policy (omit to test the default),
 *  returning the recipient's own delivered conversation_id. */
async function broadcastTo(replyPolicy?: string): Promise<string> {
  const body: Record<string, unknown> = { body: "An important word", audience: "congregation" };
  if (replyPolicy) body.reply_policy = replyPolicy;
  const sent = await agent().post("/v1/chat/broadcast").set(auth(bossTok)).send(body);
  expect(sent.status).toBe(201);
  if (replyPolicy) expect(sent.body.reply_policy).toBe(replyPolicy);
  else expect(sent.body.reply_policy).toBe("ordinary_chat");
  const inbox = await agent().get("/v1/chat/conversations").set(auth(memberTok));
  const row = (inbox.body.conversations as Array<{ conversation_id: string; last_body: string }>)
    .find((c) => c.last_body === "An important word")!;
  return row.conversation_id;
}

describe("default (omitted / ordinary_chat) — unchanged behaviour", () => {
  it("the recipient may reply freely", async () => {
    const conversationId = await broadcastTo();
    const reply = await agent().post(`/v1/chat/conversations/${conversationId}/messages`).set(auth(memberTok))
      .send({ message_id: uuid(1), body: "Thank you!" });
    expect(reply.status).toBe(201);
  });

  it("explicit 'ordinary_chat' behaves identically to omitting it", async () => {
    const conversationId = await broadcastTo("ordinary_chat");
    const reply = await agent().post(`/v1/chat/conversations/${conversationId}/messages`).set(auth(memberTok))
      .send({ message_id: uuid(2), body: "Thank you!" });
    expect(reply.status).toBe(201);
  });
});

describe("'none' and 'official_inbox' — recipient reply refused, broadcaster unaffected", () => {
  it("'none' blocks the recipient with details.reply_policy", async () => {
    const conversationId = await broadcastTo("none");
    const reply = await agent().post(`/v1/chat/conversations/${conversationId}/messages`).set(auth(memberTok))
      .send({ message_id: uuid(3), body: "Can I reply?" });
    expect(reply.status).toBe(403);
    expect(reply.body.error.details.reply_policy).toBe("none");

    // The broadcaster can still write into the same thread (a follow-up note).
    const fromBoss = await agent().post(`/v1/chat/conversations/${conversationId}/messages`).set(auth(bossTok))
      .send({ message_id: uuid(4), body: "One more thing" });
    expect(fromBoss.status).toBe(201);
  });

  it("'official_inbox' blocks the recipient with its own distinct detail", async () => {
    const conversationId = await broadcastTo("official_inbox");
    const reply = await agent().post(`/v1/chat/conversations/${conversationId}/messages`).set(auth(memberTok))
      .send({ message_id: uuid(5), body: "Can I reply?" });
    expect(reply.status).toBe(403);
    expect(reply.body.error.details.reply_policy).toBe("official_inbox");
  });
});

describe("'linked_thread' — resolves the recipient's DISCIPLER thread with the sender", () => {
  it("points at the existing DISCIPLER thread when the broadcaster IS the member's current discipler", async () => {
    // Broadcast FIRST (its own BROADCAST_RESPONSE dm), THEN assign + open the
    // discipler thread — kept as a SEPARATE conversation (openDisciplerConversation
    // looks up type='DISCIPLER' specifically, so it never collides with the
    // broadcast's dm even though both are between the same two users).
    const conversationId = await broadcastTo("linked_thread");
    const assign = await agent().post("/v1/admin/discipler-assignments").set(auth(bossTok))
      .send({ disciple_user_id: memberId, discipler_user_id: bossId });
    expect(assign.status).toBe(201);
    const disciplerThread = await agent().get("/v1/chat/discipler/conversation").set(auth(memberTok));
    expect(disciplerThread.status).toBe(200);
    expect(disciplerThread.body.conversation_id).not.toBe(conversationId);

    const reply = await agent().post(`/v1/chat/conversations/${conversationId}/messages`).set(auth(memberTok))
      .send({ message_id: uuid(6), body: "Can I reply?" });
    expect(reply.status).toBe(403);
    expect(reply.body.error.details.reply_policy).toBe("linked_thread");
    expect(reply.body.error.details.linked_conversation_id).toBe(disciplerThread.body.conversation_id);
  });

  it("resolves null when no DISCIPLER/PASTORAL relationship applies", async () => {
    const conversationId = await broadcastTo("linked_thread");
    const reply = await agent().post(`/v1/chat/conversations/${conversationId}/messages`).set(auth(memberTok))
      .send({ message_id: uuid(7), body: "Can I reply?" });
    expect(reply.status).toBe(403);
    expect(reply.body.error.details.reply_policy).toBe("linked_thread");
    expect(reply.body.error.details.linked_conversation_id).toBeNull();
  });
});
