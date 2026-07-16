// Chat: DMs, cell groups, public spaces (mobile Chat make). Server-authoritative
// membership (§5.4), offline-queueable idempotent sends (§1.7/§3.6), minor-safe
// DMs (D-M6).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, closeTestPool, testPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser, createLeaderAssignment } from "./helpers/factories.js";
import { hashPassword } from "../src/modules/identity/passwords.js";

let cong: string, cellA: string, cellB: string;
let aId: string, aTok: string; // cellA
let a2Id: string, a2Tok: string; // cellA (same cell as a)
let bId: string, bTok: string; // cellB
let lId: string, leaderTok: string; // Instructor in cellA
let minorId: string, minorTok: string; // a minor in cellA
let adminTok: string; // Admin (not a member of any cell room)

const auth = (t: string) => ({ Authorization: t });
const uuid = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

/** A staff token that has JUST confirmed its password. The broadcast routes are
 *  password-gated (§5.3 step-up), so a staff caller reaching them in the real app
 *  has re-entered their password within the last 15 minutes and holds a re-minted
 *  token carrying pwd_at. Minting it here is the equivalent of that, without
 *  needing a real password hash on every fixture user. */
const staff = (sub: string, role: "Instructor" | "Admin" | "SuperAdmin", cong: string): string =>
  bearer({ sub, role, cong, pwd_at: Math.floor(Date.now() / 1000) });

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  cellA = await createCellGroup(cong, "Cell A");
  cellB = await createCellGroup(cong, "Cell B");
  const a = await createUser({ congregationId: cong, cellGroupId: cellA, email: "a@dev.local", fullName: "Ada" });
  const a2 = await createUser({ congregationId: cong, cellGroupId: cellA, email: "a2@dev.local", fullName: "Ben" });
  const b = await createUser({ congregationId: cong, cellGroupId: cellB, email: "b@dev.local", fullName: "Cara" });
  const l = await createUser({ congregationId: cong, cellGroupId: cellA, role: "Instructor", email: "l@dev.local", fullName: "Lee" });
  const minor = await createUser({ congregationId: cong, cellGroupId: cellA, email: "m@dev.local", fullName: "Kid", dateOfBirth: "2015-01-01" });
  expect(minor.is_minor).toBe(true);
  const admin = await createUser({ congregationId: cong, cellGroupId: cellB, role: "Admin", email: "admin@dev.local", fullName: "Admin" });
  aId = a.user_id; a2Id = a2.user_id; bId = b.user_id; lId = l.user_id; minorId = minor.user_id;
  aTok = bearer({ sub: a.user_id, role: "Student", cong });
  a2Tok = bearer({ sub: a2.user_id, role: "Student", cong });
  bTok = bearer({ sub: b.user_id, role: "Student", cong });
  leaderTok = bearer({ sub: l.user_id, role: "Instructor", cong });
  minorTok = bearer({ sub: minor.user_id, role: "Student", cong });
  adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
});
afterAll(async () => {
  await closeTestPool();
});

async function groupId(tok: string): Promise<string> {
  const res = await agent().get("/v1/chat/conversations").set(auth(tok));
  const group = (res.body.conversations as Array<{ conversation_id: string; kind: string }>).find((c) => c.kind === "group");
  return group!.conversation_id;
}

describe("message edit / delete (author-only)", () => {
  it("author edits and soft-deletes their own message; others cannot", async () => {
    const g = await groupId(aTok);
    await agent().post(`/v1/chat/conversations/${g}/messages`).set(auth(aTok))
      .send({ message_id: uuid(1), body: "frist draft", client_mutation_id: uuid(50) });

    // a non-author cannot edit or delete
    const otherEdit = await agent().patch(`/v1/chat/messages/${uuid(1)}`).set(auth(a2Tok)).send({ body: "hijack" });
    expect(otherEdit.status).toBe(404);
    const otherDel = await agent().delete(`/v1/chat/messages/${uuid(1)}`).set(auth(a2Tok));
    expect(otherDel.status).toBe(404);

    // author edits → body changes + is_edited flips
    const edit = await agent().patch(`/v1/chat/messages/${uuid(1)}`).set(auth(aTok)).send({ body: "first draft, fixed" });
    expect(edit.status).toBe(200);
    let seen = await agent().get(`/v1/chat/conversations/${g}`).set(auth(a2Tok));
    const edited = (seen.body.messages as Array<{ message_id: string; body: string; is_edited: boolean }>).find((m) => m.message_id === uuid(1));
    expect(edited?.body).toBe("first draft, fixed");
    expect(edited?.is_edited).toBe(true);

    // author deletes → message disappears from everyone's read
    const del = await agent().delete(`/v1/chat/messages/${uuid(1)}`).set(auth(aTok));
    expect(del.status).toBe(200);
    seen = await agent().get(`/v1/chat/conversations/${g}`).set(auth(a2Tok));
    expect((seen.body.messages as Array<{ message_id: string }>).some((m) => m.message_id === uuid(1))).toBe(false);

    // editing a deleted message 404s
    const reEdit = await agent().patch(`/v1/chat/messages/${uuid(1)}`).set(auth(aTok)).send({ body: "back?" });
    expect(reEdit.status).toBe(404);
  });
});

describe("cell groups", () => {
  it("auto-provisions one group room per cell and members of the cell share it", async () => {
    const gA = await groupId(aTok);
    const gA2 = await groupId(a2Tok);
    expect(gA).toBe(gA2); // same cell → same room

    const gB = await groupId(bTok);
    expect(gB).not.toBe(gA); // different cell → different room
  });

  it("a cell member sees another member's message; an out-of-cell member gets 404", async () => {
    const g = await groupId(aTok);
    const sent = await agent().post(`/v1/chat/conversations/${g}/messages`).set(auth(aTok))
      .send({ message_id: uuid(1), body: "Grace and peace", client_mutation_id: uuid(50) });
    expect(sent.status).toBe(201);

    const seen = await agent().get(`/v1/chat/conversations/${g}`).set(auth(a2Tok));
    expect(seen.status).toBe(200);
    expect((seen.body.messages as Array<{ body: string }>).map((m) => m.body)).toContain("Grace and peace");

    const denied = await agent().get(`/v1/chat/conversations/${g}`).set(auth(bTok));
    expect(denied.status).toBe(404); // no existence leak across cells
  });

  it("send is idempotent on client_mutation_id", async () => {
    const g = await groupId(aTok);
    const send = () => agent().post(`/v1/chat/conversations/${g}/messages`).set(auth(aTok))
      .send({ message_id: uuid(2), body: "once", client_mutation_id: uuid(51) });
    expect((await send()).status).toBe(201);
    const replay = await send();
    expect(replay.body.duplicate).toBe(true);
    const convo = await agent().get(`/v1/chat/conversations/${g}`).set(auth(aTok));
    expect((convo.body.messages as unknown[]).filter((m) => (m as { body: string }).body === "once")).toHaveLength(1);
  });
});

describe("unread + reactions", () => {
  it("unread clears after marking read", async () => {
    const g = await groupId(a2Tok); // a2 is a member
    await agent().post(`/v1/chat/conversations/${g}/messages`).set(auth(aTok)).send({ message_id: uuid(3), body: "hi" });
    let list = await agent().get("/v1/chat/conversations").set(auth(a2Tok));
    let group = (list.body.conversations as Array<{ conversation_id: string; unread: number }>).find((c) => c.conversation_id === g)!;
    expect(group.unread).toBeGreaterThanOrEqual(1);

    await agent().post(`/v1/chat/conversations/${g}/read`).set(auth(a2Tok)).send({});
    list = await agent().get("/v1/chat/conversations").set(auth(a2Tok));
    group = (list.body.conversations as Array<{ conversation_id: string; unread: number }>).find((c) => c.conversation_id === g)!;
    expect(group.unread).toBe(0);
  });

  it("toggles a reaction on and off", async () => {
    const g = await groupId(aTok);
    await agent().post(`/v1/chat/conversations/${g}/messages`).set(auth(aTok)).send({ message_id: uuid(4), body: "amen" });
    const on = await agent().post(`/v1/chat/messages/${uuid(4)}/reactions`).set(auth(a2Tok)).send({ emoji: "🙏" });
    expect(on.body.on).toBe(true);
    const off = await agent().post(`/v1/chat/messages/${uuid(4)}/reactions`).set(auth(a2Tok)).send({ emoji: "🙏" });
    expect(off.body.on).toBe(false);
  });
});

describe("direct messages", () => {
  it("creates a DM, dedupes, and both members can read it", async () => {
    const made = await agent().post("/v1/chat/dms").set(auth(aTok)).send({ user_id: a2Id });
    expect(made.status).toBe(201);
    const again = await agent().post("/v1/chat/dms").set(auth(aTok)).send({ user_id: a2Id });
    expect(again.body.conversation_id).toBe(made.body.conversation_id); // deduped

    await agent().post(`/v1/chat/conversations/${made.body.conversation_id}/messages`).set(auth(aTok)).send({ message_id: uuid(5), body: "hey Ben" });
    const read = await agent().get(`/v1/chat/conversations/${made.body.conversation_id}`).set(auth(a2Tok));
    expect(read.status).toBe(200);
    expect(read.body.title).toBe("Ada"); // DM titled by the other member
  });

  it("inbox rows carry peer_user_id for DMs (null for group rooms)", async () => {
    const made = await agent().post("/v1/chat/dms").set(auth(aTok)).send({ user_id: a2Id });
    const inbox = await agent().get("/v1/chat/conversations").set(auth(aTok));
    const rows = inbox.body.conversations as Array<{ conversation_id: string; kind: string; peer_user_id: string | null }>;
    const dm = rows.find((c) => c.conversation_id === made.body.conversation_id)!;
    expect(dm.peer_user_id).toBe(a2Id); // the OTHER member, not me
    const group = rows.find((c) => c.kind === "group")!;
    expect(group.peer_user_id).toBeNull();
  });

  it("blocks DMs with a minor (D-M6)", async () => {
    const res = await agent().post("/v1/chat/dms").set(auth(aTok)).send({ user_id: minorId });
    expect(res.status).toBe(403);
  });
});

describe("public spaces", () => {
  it("a leader creates a space; a member discovers, joins, and posts", async () => {
    const created = await agent().post("/v1/chat/spaces").set(auth(leaderTok))
      .send({ conversation_id: uuid(9), title: "Worship Team", topic: "Sunday set lists" });
    expect(created.status).toBe(201);

    const discover = await agent().get("/v1/chat/conversations").set(auth(aTok));
    expect((discover.body.discover_spaces as Array<{ conversation_id: string }>).some((s) => s.conversation_id === uuid(9))).toBe(true);

    const joined = await agent().post(`/v1/chat/spaces/${uuid(9)}/join`).set(auth(aTok)).send({});
    expect(joined.body.joined).toBe(true);

    const post = await agent().post(`/v1/chat/conversations/${uuid(9)}/messages`).set(auth(aTok)).send({ message_id: uuid(10), body: "Excited to serve" });
    expect(post.status).toBe(201);

    // Now it shows up in their joined conversations, not discover.
    const list = await agent().get("/v1/chat/conversations").set(auth(aTok));
    expect((list.body.conversations as Array<{ conversation_id: string }>).some((c) => c.conversation_id === uuid(9))).toBe(true);
    expect((list.body.discover_spaces as Array<{ conversation_id: string }>).some((s) => s.conversation_id === uuid(9))).toBe(false);
  });

  it("a GLOBAL public space (no congregation) is discoverable + joinable by a member who HAS a congregation", async () => {
    // Reproduces the prod bug: spaces created with congregation_id = NULL were
    // invisible to anyone scoped to a congregation. A NULL-congregation public
    // space must be global (visible to everyone).
    await testPool().query(
      `INSERT INTO chat_conversations (conversation_id, kind, title, topic, is_public, congregation_id, created_by)
       VALUES ($1, 'space', 'Global Praise', 'For everyone', TRUE, NULL, $2)`,
      [uuid(20), lId],
    );
    // `a` is a Student firmly in congregation `cong`.
    const discover = await agent().get("/v1/chat/conversations").set(auth(aTok));
    expect((discover.body.discover_spaces as Array<{ conversation_id: string }>).some((s) => s.conversation_id === uuid(20))).toBe(true);

    const joined = await agent().post(`/v1/chat/spaces/${uuid(20)}/join`).set(auth(aTok)).send({});
    expect(joined.status).toBe(200);
    expect(joined.body.joined).toBe(true);

    const list = await agent().get("/v1/chat/conversations").set(auth(aTok));
    expect((list.body.conversations as Array<{ conversation_id: string }>).some((c) => c.conversation_id === uuid(20))).toBe(true);
  });

  it("carries a space category through discover, inbox, and the thread head", async () => {
    await agent().post("/v1/chat/spaces").set(auth(leaderTok))
      .send({ conversation_id: uuid(11), title: "Youth Ablaze", topic: "For the youth", category: "youth" });

    const discover = await agent().get("/v1/chat/conversations").set(auth(aTok));
    const found = (discover.body.discover_spaces as Array<{ conversation_id: string; category: string }>).find((s) => s.conversation_id === uuid(11))!;
    expect(found.category).toBe("youth");

    await agent().post(`/v1/chat/spaces/${uuid(11)}/join`).set(auth(aTok)).send({});
    const head = await agent().get(`/v1/chat/conversations/${uuid(11)}`).set(auth(aTok));
    expect(head.body.category).toBe("youth");
    expect(head.body.member_count).toBeGreaterThanOrEqual(1);
  });

  it("a not-yet-onboarded member (no congregation) discovers a public space, follows it, and adopts the congregation", async () => {
    await agent().post("/v1/chat/spaces").set(auth(leaderTok))
      .send({ conversation_id: uuid(13), title: "Welcome Space", topic: "Start here" });

    // A fresh self-signup with no congregation yet.
    const orphan = await createUser({ congregationId: cong, email: "newbie@dev.local", fullName: "New Bie" });
    await testPool().query("UPDATE users SET congregation_id = NULL WHERE user_id = $1", [orphan.user_id]);
    const orphanTok = bearer({ sub: orphan.user_id, role: "Student", cong: "" });

    // They still see the public space to follow.
    const discover = await agent().get("/v1/chat/conversations").set(auth(orphanTok));
    expect((discover.body.discover_spaces as Array<{ conversation_id: string }>).some((s) => s.conversation_id === uuid(13))).toBe(true);

    // Following (joining) it adopts the space's congregation as their home.
    const joined = await agent().post(`/v1/chat/spaces/${uuid(13)}/join`).set(auth(orphanTok)).send({});
    expect(joined.body.joined).toBe(true);
    const row = await testPool().query("SELECT congregation_id FROM users WHERE user_id = $1", [orphan.user_id]);
    expect(row.rows[0].congregation_id).toBe(cong);
  });
});

describe("moderation (Admin/SuperAdmin)", () => {
  it("admin flags a message — it shows is_flagged in the admin view", async () => {
    const g = await groupId(aTok);
    await agent().post(`/v1/chat/conversations/${g}/messages`).set(auth(aTok)).send({ message_id: uuid(20), body: "needs a look" });

    const flag = await agent().post(`/v1/chat/messages/${uuid(20)}/flag`).set(auth(adminTok)).send({ reason: "review" });
    expect(flag.status).toBe(200);
    expect(flag.body.is_flagged).toBe(true);

    const adminView = await agent().get(`/v1/chat/conversations/${g}`).set(auth(adminTok));
    const msg = (adminView.body.messages as Array<{ message_id: string; is_flagged: boolean; flag_reason: string | null }>).find((m) => m.message_id === uuid(20))!;
    expect(msg.is_flagged).toBe(true);
    expect(msg.flag_reason).toBe("review");
  });

  it("admin removes a message — hidden from members, visible to admin as is_hidden", async () => {
    const g = await groupId(aTok);
    await agent().post(`/v1/chat/conversations/${g}/messages`).set(auth(aTok)).send({ message_id: uuid(21), body: "to remove" });

    const removed = await agent().post(`/v1/chat/messages/${uuid(21)}/remove`).set(auth(adminTok)).send({});
    expect(removed.status).toBe(200);
    expect(removed.body.is_hidden).toBe(true);

    const memberView = await agent().get(`/v1/chat/conversations/${g}`).set(auth(a2Tok));
    expect((memberView.body.messages as Array<{ message_id: string }>).some((m) => m.message_id === uuid(21))).toBe(false);

    const adminView = await agent().get(`/v1/chat/conversations/${g}`).set(auth(adminTok));
    const msg = (adminView.body.messages as Array<{ message_id: string; is_hidden: boolean }>).find((m) => m.message_id === uuid(21))!;
    expect(msg.is_hidden).toBe(true);
  });

  it("a non-admin (Student) cannot moderate — 403", async () => {
    const g = await groupId(aTok);
    await agent().post(`/v1/chat/conversations/${g}/messages`).set(auth(aTok)).send({ message_id: uuid(22), body: "hands off" });
    const denied = await agent().post(`/v1/chat/messages/${uuid(22)}/flag`).set(auth(a2Tok)).send({ reason: "x" });
    expect(denied.status).toBe(403);
  });

  it("admin can read a conversation they are not a member of", async () => {
    const g = await groupId(aTok); // cellA room; admin is in cellB
    await agent().post(`/v1/chat/conversations/${g}/messages`).set(auth(aTok)).send({ message_id: uuid(23), body: "for oversight" });
    const view = await agent().get(`/v1/chat/conversations/${g}`).set(auth(adminTok));
    expect(view.status).toBe(200);
    expect((view.body.messages as Array<{ body: string }>).map((m) => m.body)).toContain("for oversight");
  });
});

describe("DM directory (people)", () => {
  it("lists same-congregation members, excluding self and minors", async () => {
    const res = await agent().get("/v1/chat/people").set(auth(aTok));
    expect(res.status).toBe(200);
    const ids = (res.body.people as Array<{ user_id: string }>).map((p) => p.user_id);
    expect(ids).toContain(a2Id); // a peer
    expect(ids).toContain(bId); // another cell, same congregation
    expect(ids).not.toContain(aId); // not self
    expect(ids).not.toContain(minorId); // minors never appear (D-M6)
  });

  it("filters by name search", async () => {
    const res = await agent().get("/v1/chat/people").query({ q: "ben" }).set(auth(aTok));
    const names = (res.body.people as Array<{ full_name: string }>).map((p) => p.full_name);
    expect(names).toEqual(["Ben"]);
  });

  it("a minor caller gets an empty directory (D-M6)", async () => {
    const res = await agent().get("/v1/chat/people").set(auth(minorTok));
    expect(res.status).toBe(200);
    expect(res.body.people).toEqual([]);
  });

  it("excludes users with a NULL congregation, and a NULL-congregation caller sees nobody", async () => {
    // An unattached user (e.g. a fresh self-signup) — congregation set to NULL.
    const orphan = await createUser({ congregationId: cong, email: "orphan@dev.local", fullName: "Orphan One" });
    await testPool().query("UPDATE users SET congregation_id = NULL WHERE user_id = $1", [orphan.user_id]);
    const orphanTok = bearer({ sub: orphan.user_id, role: "Student", cong });

    // The orphan never appears in another member's directory.
    const seen = await agent().get("/v1/chat/people").set(auth(aTok));
    expect((seen.body.people as Array<{ user_id: string }>).map((p) => p.user_id)).not.toContain(orphan.user_id);

    // The orphan (NULL congregation) sees nobody.
    const mine = await agent().get("/v1/chat/people").set(auth(orphanTok));
    expect(mine.status).toBe(200);
    expect(mine.body.people).toEqual([]);
  });

  it("carries public achievement flair — level, badge count + icons, cert count (aggregates only)", async () => {
    // Give Ben (a2) real achievements: Level 3 enrollment, two badges (one with
    // an icon), and a certificate.
    await testPool().query(
      `INSERT INTO enrollments (user_id, current_level) VALUES ($1, 3)
       ON CONFLICT (user_id) DO UPDATE SET current_level = 3`,
      [a2Id],
    );
    await testPool().query(
      `INSERT INTO badges (code, name, description, icon_key, category, criteria) VALUES
         ('t_first', 'First Steps', 'First module.', '🌱', 'journey', '{"kind":"module_count","count":1}'),
         ('t_streak', 'Faithful',   'Seven days.',   NULL, 'consistency', '{"kind":"streak_days","days":7}')`,
    );
    await testPool().query(
      `INSERT INTO user_badges (user_id, badge_id, source)
       SELECT $1, badge_id, '{"event":"test"}'::jsonb FROM badges WHERE code IN ('t_first','t_streak')`,
      [a2Id],
    );
    await testPool().query(
      `INSERT INTO certificates (user_id, level_number, verification_code, pdf_object_key, content_hash, signature)
       VALUES ($1, 1, 'TEST-CERT-0001', 'certs/test.pdf', 'hash', 'sig')`,
      [a2Id],
    );

    const res = await agent().get("/v1/chat/people").set(auth(aTok));
    expect(res.status).toBe(200);
    type Flair = { user_id: string; level: number; badge_count: number; badge_icons: string[]; cert_count: number };
    const people = res.body.people as Flair[];

    const ben = people.find((p) => p.user_id === a2Id)!;
    expect(ben.level).toBe(3);
    expect(ben.badge_count).toBe(2);
    expect(ben.badge_icons).toEqual(["🌱"]); // NULL icon_key rows dropped, count still 2
    expect(ben.cert_count).toBe(1);

    // A member with no achievements still gets safe defaults — level 1, zeros.
    const cara = people.find((p) => p.user_id === bId)!;
    expect(cara.level).toBe(1);
    expect(cara.badge_count).toBe(0);
    expect(cara.badge_icons).toEqual([]);
    expect(cara.cert_count).toBe(0);

    // Aggregates only — no private detail leaks onto a directory row.
    expect(ben).not.toHaveProperty("badges");
    expect(ben).not.toHaveProperty("awarded_at");
    expect(ben).not.toHaveProperty("verification_code");
  });
});

describe("cell conversation (portal Message cell)", () => {
  it("a scoped leader opens their cell's group room (same id as the auto-provisioned room)", async () => {
    await createLeaderAssignment(lId, cellA);
    const opened = await agent().post(`/v1/chat/cells/${cellA}/conversation`).set(auth(leaderTok)).send({});
    expect(opened.status).toBe(201);
    // It is the very room cell members already share.
    const memberRoom = await groupId(aTok);
    expect(opened.body.conversation_id).toBe(memberRoom);

    // The leader is now a member and can read it.
    const view = await agent().get(`/v1/chat/conversations/${opened.body.conversation_id}`).set(auth(leaderTok));
    expect(view.status).toBe(200);
  });

  it("an Admin opens any cell's room without a leader_assignment", async () => {
    const opened = await agent().post(`/v1/chat/cells/${cellA}/conversation`).set(auth(adminTok)).send({});
    expect(opened.status).toBe(201);
  });

  it("an out-of-scope leader is refused (403 FORBIDDEN_SCOPE)", async () => {
    // Lee is assigned to cellA only → cellB is out of scope.
    await createLeaderAssignment(lId, cellA);
    const denied = await agent().post(`/v1/chat/cells/${cellB}/conversation`).set(auth(leaderTok)).send({});
    expect(denied.status).toBe(403);
  });

  it("a plain Student cannot open a cell room (insufficient role)", async () => {
    const denied = await agent().post(`/v1/chat/cells/${cellA}/conversation`).set(auth(aTok)).send({});
    expect(denied.status).toBe(403);
  });
});

describe("portal staff: global directory + cross-congregation DM + scope=mine", () => {
  it("an Admin sees members across congregations in the directory; a Student does not", async () => {
    const cong2 = await createCongregation();
    const far = await createUser({ congregationId: cong2, email: "far@dev.local", fullName: "Far Away" });

    const adminView = await agent().get("/v1/chat/people").set(auth(adminTok));
    expect(adminView.status).toBe(200);
    const adminIds = (adminView.body.people as Array<{ user_id: string }>).map((p) => p.user_id);
    expect(adminIds).toContain(far.user_id); // global reach for staff

    const studentView = await agent().get("/v1/chat/people").set(auth(aTok));
    const studentIds = (studentView.body.people as Array<{ user_id: string }>).map((p) => p.user_id);
    expect(studentIds).not.toContain(far.user_id); // members stay congregation-scoped
  });

  it("the directory never includes minors, even for an Admin", async () => {
    const adminView = await agent().get("/v1/chat/people").set(auth(adminTok));
    const ids = (adminView.body.people as Array<{ user_id: string }>).map((p) => p.user_id);
    expect(ids).not.toContain(minorId);
  });

  it("an Admin can start a DM with a member in another congregation", async () => {
    const cong2 = await createCongregation();
    const far = await createUser({ congregationId: cong2, email: "far2@dev.local", fullName: "Far Two" });
    const dm = await agent().post("/v1/chat/dms").set(auth(adminTok)).send({ user_id: far.user_id });
    expect(dm.status).toBe(201);
    expect(dm.body.conversation_id).toBeTruthy();
  });

  it("scope=mine gives an Admin their personal inbox (joined conversations) not the oversight list", async () => {
    // Admin starts a DM → that conversation is theirs.
    const dm = await agent().post("/v1/chat/dms").set(auth(adminTok)).send({ user_id: aId });
    const mine = await agent().get("/v1/chat/conversations").query({ scope: "mine" }).set(auth(adminTok));
    expect(mine.status).toBe(200);
    const ids = (mine.body.conversations as Array<{ conversation_id: string }>).map((c) => c.conversation_id);
    expect(ids).toContain(dm.body.conversation_id);
    // Every row in the personal inbox is one the admin actually belongs to.
    const kinds = (mine.body.conversations as Array<{ kind: string }>).map((c) => c.kind);
    expect(kinds.every((k) => ["dm", "group", "space"].includes(k))).toBe(true);
  });
});

describe("inbox row counters (message_count + reaction_count)", () => {
  it("reports total messages and reactions per conversation", async () => {
    const g = await groupId(aTok);
    await agent().post(`/v1/chat/conversations/${g}/messages`).set(auth(aTok)).send({ message_id: uuid(80), body: "one" });
    await agent().post(`/v1/chat/conversations/${g}/messages`).set(auth(a2Tok)).send({ message_id: uuid(81), body: "two" });
    await agent().post(`/v1/chat/messages/${uuid(80)}/reactions`).set(auth(a2Tok)).send({ emoji: "🙏" });
    await agent().post(`/v1/chat/messages/${uuid(81)}/reactions`).set(auth(aTok)).send({ emoji: "❤️" });

    const list = await agent().get("/v1/chat/conversations").set(auth(aTok));
    const row = (list.body.conversations as Array<{ conversation_id: string; message_count: number; reaction_count: number }>)
      .find((c) => c.conversation_id === g)!;
    expect(row.message_count).toBe(2);
    expect(row.reaction_count).toBe(2);
  });
});

describe("broadcast (staff → every congregation member as an individual DM)", () => {
  it("delivers one message to each member as a 1:1 DM from the sender; replay is a no-op; Students get 403", async () => {
    // Fresh congregation so the count is exact: an Admin sender + 2 members
    // (+ a minor, who must be skipped — DMs never touch minors, D-M6).
    const cong2 = await createCongregation("Broadcast Branch");
    const sender = await createUser({ congregationId: cong2, role: "Admin", email: "pastor@dev.local", fullName: "Pastor Pat" });
    const m1 = await createUser({ congregationId: cong2, email: "m1@dev.local", fullName: "Member One" });
    const m2 = await createUser({ congregationId: cong2, email: "m2@dev.local", fullName: "Member Two" });
    await createUser({ congregationId: cong2, email: "kid2@dev.local", fullName: "Kid Two", dateOfBirth: "2016-06-06" });
    const senderTok = staff(sender.user_id, "Admin", cong2);
    const m1Tok = bearer({ sub: m1.user_id, role: "Student", cong: cong2 });
    const m2Tok = bearer({ sub: m2.user_id, role: "Student", cong: cong2 });

    // A Student may not broadcast (route is Instructor+).
    const denied = await agent().post("/v1/chat/broadcast").set(auth(m1Tok))
      .send({ body: "hijack the pulpit", client_mutation_id: uuid(97) });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FORBIDDEN_SCOPE");

    const res = await agent().post("/v1/chat/broadcast").set(auth(senderTok))
      .send({ body: "Service moves to 10am this Sunday 🙏", client_mutation_id: uuid(98) });
    expect(res.status).toBe(201);
    expect(res.body.sent).toBe(2); // minor + sender excluded
    expect(res.body.duplicate).toBe(false);

    // Each member finds a personal DM from the sender with the message — and can reply in it.
    for (const tok of [m1Tok, m2Tok]) {
      const inbox = await agent().get("/v1/chat/conversations").set(auth(tok));
      const dm = (inbox.body.conversations as Array<{ conversation_id: string; kind: string; title: string; last_body: string }>)
        .find((c) => c.kind === "dm")!;
      expect(dm).toBeDefined();
      expect(dm.title).toBe("Pastor Pat");
      expect(dm.last_body).toBe("Service moves to 10am this Sunday 🙏");
      const thread = await agent().get(`/v1/chat/conversations/${dm.conversation_id}`).set(auth(tok));
      const msgs = thread.body.messages as Array<{ body: string; author_user_id: string; message_id: string }>;
      expect(msgs).toHaveLength(1);
      expect(msgs[0]!.author_user_id).toBe(sender.user_id);
      expect(msgs[0]!.message_id).toBe(msgs[0]!.message_id.toLowerCase()); // server-minted lowercase id
    }

    // The two DMs are distinct conversations (individual threads, no group room).
    const senderInbox = await agent().get("/v1/chat/conversations?scope=mine").set(auth(senderTok));
    const dms = (senderInbox.body.conversations as Array<{ kind: string }>).filter((c) => c.kind === "dm");
    expect(dms).toHaveLength(2);

    // Replaying the same client_mutation_id is a no-op: no new messages anywhere.
    const replay = await agent().post("/v1/chat/broadcast").set(auth(senderTok))
      .send({ body: "Service moves to 10am this Sunday 🙏", client_mutation_id: uuid(98) });
    expect(replay.status).toBe(201);
    expect(replay.body.duplicate).toBe(true);
    expect(replay.body.sent).toBe(2);
    const count = await testPool().query(
      `SELECT count(*)::int AS n FROM chat_messages WHERE body = $1`,
      ["Service moves to 10am this Sunday 🙏"],
    );
    expect(count.rows[0].n).toBe(2);
  });

  it("an image broadcast delivers msg_type image + attachment_url (body = caption) to every DM", async () => {
    const cong2 = await createCongregation("Broadcast Branch Img");
    const sender = await createUser({ congregationId: cong2, role: "Instructor", email: "img-lead@dev.local", fullName: "Ivy Lead" });
    const m1 = await createUser({ congregationId: cong2, email: "im1@dev.local", fullName: "Img One" });
    const m2 = await createUser({ congregationId: cong2, email: "im2@dev.local", fullName: "Img Two" });
    const senderTok = staff(sender.user_id, "Instructor", cong2);
    const m1Tok = bearer({ sub: m1.user_id, role: "Student", cong: cong2 });
    const m2Tok = bearer({ sub: m2.user_id, role: "Student", cong: cong2 });

    const flyer = "https://res.cloudinary.com/demo/image/upload/v1/nuru/chat/flyer.jpg";
    const res = await agent().post("/v1/chat/broadcast").set(auth(senderTok))
      .send({ body: "Sunday flyer 📸", msg_type: "image", attachment_url: flyer, client_mutation_id: uuid(90) });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ sent: 2, duplicate: false });
    expect(res.body.broadcast_id).toBeTruthy();

    // BOTH recipients' DMs carry the image message with the caption as body.
    for (const tok of [m1Tok, m2Tok]) {
      const inbox = await agent().get("/v1/chat/conversations").set(auth(tok));
      const dm = (inbox.body.conversations as Array<{ conversation_id: string; kind: string; last_type: string }>)
        .find((c) => c.kind === "dm")!;
      expect(dm).toBeDefined();
      expect(dm.last_type).toBe("image");
      const thread = await agent().get(`/v1/chat/conversations/${dm.conversation_id}`).set(auth(tok));
      const msgs = thread.body.messages as Array<{ body: string; msg_type: string; attachment_url: string | null }>;
      expect(msgs).toHaveLength(1);
      expect(msgs[0]!.msg_type).toBe("image");
      expect(msgs[0]!.attachment_url).toBe(flyer);
      expect(msgs[0]!.body).toBe("Sunday flyer 📸");
    }

    // Replay is still a no-op with the attachment present.
    const replay = await agent().post("/v1/chat/broadcast").set(auth(senderTok))
      .send({ body: "Sunday flyer 📸", msg_type: "image", attachment_url: flyer, client_mutation_id: uuid(90) });
    expect(replay.body).toMatchObject({ sent: 2, duplicate: true, broadcast_id: res.body.broadcast_id });
    const count = await testPool().query(
      `SELECT count(*)::int AS n FROM chat_messages WHERE attachment_url = $1`, [flyer],
    );
    expect(count.rows[0].n).toBe(2);
  });

  it("re-broadcasting (new client_mutation_id) reuses the existing DMs instead of creating new ones", async () => {
    const cong2 = await createCongregation("Broadcast Branch 2");
    const sender = await createUser({ congregationId: cong2, role: "Instructor", email: "lead@dev.local", fullName: "Lead Lee" });
    const m1 = await createUser({ congregationId: cong2, email: "bm1@dev.local", fullName: "Bee One" });
    const senderTok = staff(sender.user_id, "Instructor", cong2);
    const m1Tok = bearer({ sub: m1.user_id, role: "Student", cong: cong2 });

    const first = await agent().post("/v1/chat/broadcast").set(auth(senderTok))
      .send({ body: "first word", client_mutation_id: uuid(95) });
    expect(first.body).toMatchObject({ sent: 1, duplicate: false });
    const second = await agent().post("/v1/chat/broadcast").set(auth(senderTok))
      .send({ body: "second word", client_mutation_id: uuid(96) });
    expect(second.body).toMatchObject({ sent: 1, duplicate: false });
    expect(second.body.broadcast_id).not.toBe(first.body.broadcast_id); // two sends, two things sent

    const inbox = await agent().get("/v1/chat/conversations").set(auth(m1Tok));
    const dms = (inbox.body.conversations as Array<{ conversation_id: string; kind: string }>).filter((c) => c.kind === "dm");
    expect(dms).toHaveLength(1); // same thread, two messages
    const thread = await agent().get(`/v1/chat/conversations/${dms[0]!.conversation_id}`).set(auth(m1Tok));
    expect((thread.body.messages as unknown[]).length).toBe(2);
  });
});

/** The Broadcast tab: one message out, every answer home. A broadcast is a thing
 *  you can point at — without the parent row the delivered copies were
 *  indistinguishable from hand-typed DMs and nothing could be asked of them. */
describe("broadcast — the sent thing, and the answers to it", () => {
  interface Resp { user_id: string; full_name: string; body: string; conversation_id: string }

  it("gathers every reply under the broadcast, each carrying the private thread it came from", async () => {
    const cong2 = await createCongregation("Answering Branch");
    const sender = await createUser({ congregationId: cong2, role: "Admin", email: "bc-pastor@dev.local", fullName: "Pastor Ann" });
    const m1 = await createUser({ congregationId: cong2, email: "bc1@dev.local", fullName: "Ann Member" });
    const m2 = await createUser({ congregationId: cong2, email: "bc2@dev.local", fullName: "Ben Member" });
    await createUser({ congregationId: cong2, email: "bc3@dev.local", fullName: "Quiet Cara" }); // never answers
    const senderTok = staff(sender.user_id, "Admin", cong2);
    const m1Tok = bearer({ sub: m1.user_id, role: "Student", cong: cong2 });
    const m2Tok = bearer({ sub: m2.user_id, role: "Student", cong: cong2 });

    const sent = await agent().post("/v1/chat/broadcast").set(auth(senderTok))
      .send({ body: "Who can serve on Sunday?", client_mutation_id: uuid(70) });
    const bId = sent.body.broadcast_id as string;
    expect(sent.body.sent).toBe(3);

    // Two of the three answer, in their own private threads.
    // NB: uuid(n) here pads to TWO digits — keep every n <= 99 or it mints an
    // invalid uuid and the route 400s.
    const replyIn = async (tok: string, body: string, msgN: number, mutN: number): Promise<void> => {
      const inbox = await agent().get("/v1/chat/conversations").set(auth(tok));
      const dm = (inbox.body.conversations as Array<{ conversation_id: string; kind: string }>).find((c) => c.kind === "dm")!;
      const r = await agent().post(`/v1/chat/conversations/${dm.conversation_id}/messages`).set(auth(tok))
        .send({ message_id: uuid(msgN), body, msg_type: "text", client_mutation_id: uuid(mutN) });
      expect(r.status, `reply failed: ${JSON.stringify(r.body)}`).toBeLessThan(300);
    };
    await replyIn(m1Tok, "I can serve 🙋🏽‍♀️", 71, 73);
    await replyIn(m2Tok, "Travelling, but praying", 72, 74);

    const detail = await agent().get(`/v1/chat/broadcasts/${bId}`).set(auth(senderTok));
    expect(detail.status).toBe(200);
    expect(detail.body.body).toBe("Who can serve on Sunday?"); // the top message
    expect(detail.body.recipient_count).toBe(3);

    const responses = detail.body.responses as Resp[];
    expect(responses).toHaveLength(2); // Cara's silence is not a response
    expect(responses.map((r) => r.full_name).sort()).toEqual(["Ann Member", "Ben Member"]);
    // Each answer carries the thread it lives in — already seeded with the
    // broadcast, so "open the conversation" is a navigation, not a creation.
    for (const r of responses) expect(r.conversation_id).toBeTruthy();
    const annThread = responses.find((r) => r.full_name === "Ann Member")!.conversation_id;
    const opened = await agent().get(`/v1/chat/conversations/${annThread}`).set(auth(senderTok));
    const msgs = opened.body.messages as Array<{ body: string }>;
    expect(msgs[0]!.body).toBe("Who can serve on Sunday?"); // the broadcast IS the top message
    expect(msgs[1]!.body).toBe("I can serve 🙋🏽‍♀️");

    // The list carries the two numbers that matter.
    const list = await agent().get("/v1/chat/broadcasts").set(auth(senderTok));
    const row = (list.body.data as Array<{ broadcast_id: string; recipient_count: number; replied_count: number }>)
      .find((b) => b.broadcast_id === bId)!;
    expect(row.recipient_count).toBe(3);
    expect(row.replied_count).toBe(2);
  });

  it("a broadcast's replies are private to its sender — another admin cannot read them", async () => {
    const cong2 = await createCongregation("Private Branch");
    const sender = await createUser({ congregationId: cong2, role: "Admin", email: "mine@dev.local", fullName: "Mine Admin" });
    const nosy = await createUser({ congregationId: cong2, role: "Admin", email: "nosy@dev.local", fullName: "Nosy Admin" });
    await createUser({ congregationId: cong2, email: "pm1@dev.local", fullName: "Pat Member" });
    const senderTok = staff(sender.user_id, "Admin", cong2);
    const nosyTok = staff(nosy.user_id, "Admin", cong2);

    const sent = await agent().post("/v1/chat/broadcast").set(auth(senderTok))
      .send({ body: "How is your heart today?", client_mutation_id: uuid(75) });

    const peek = await agent().get(`/v1/chat/broadcasts/${sent.body.broadcast_id}`).set(auth(nosyTok));
    expect(peek.status).toBe(403);
    expect(peek.body.error.code).toBe("FORBIDDEN_SCOPE");

    // ...and it isn't in their list either.
    const list = await agent().get("/v1/chat/broadcasts").set(auth(nosyTok));
    expect(list.body.data).toHaveLength(0);
  });

  it("audience=all is SuperAdmin-only, and reaches members an Instructor's congregation misses", async () => {
    const congA = await createCongregation("Reach A");
    const congB = await createCongregation("Reach B");
    const boss = await createUser({ congregationId: congA, role: "SuperAdmin", email: "boss@dev.local", fullName: "Big Boss" });
    const lead = await createUser({ congregationId: congA, role: "Instructor", email: "lead2@dev.local", fullName: "Lead Two" });
    await createUser({ congregationId: congA, email: "ra1@dev.local", fullName: "A One" });
    await createUser({ congregationId: congB, email: "rb1@dev.local", fullName: "B One" });
    const bossTok = staff(boss.user_id, "SuperAdmin", congA);
    const leadTok = staff(lead.user_id, "Instructor", congA);

    // An Instructor may not reach everyone.
    const denied = await agent().post("/v1/chat/broadcast").set(auth(leadTok))
      .send({ body: "everyone hear me", audience: "all", client_mutation_id: uuid(80) });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FORBIDDEN_SCOPE");

    // Their congregation-scoped broadcast reaches only congregation A (boss, lead's own is excluded, A One).
    const scoped = await agent().post("/v1/chat/broadcast").set(auth(leadTok))
      .send({ body: "branch only", client_mutation_id: uuid(81) });
    expect(scoped.body.sent).toBe(2); // boss + A One — never B One

    // The SuperAdmin's reaches across congregations.
    const all = await agent().post("/v1/chat/broadcast").set(auth(bossTok))
      .send({ body: "to the whole church", audience: "all", client_mutation_id: uuid(82) });
    expect(all.status).toBe(201);
    const reached = all.body.sent as number;
    expect(reached).toBeGreaterThanOrEqual(3); // lead + A One + B One, across both congregations
  });

  /** Oversight is not a reason to read someone's answer to a broadcast. An Admin
   *  who needs one particular conversation is invited into THAT THREAD by name;
   *  there is no verb that hands over the broadcast. */
  it("hides broadcast threads from an Admin's oversight inbox — but not from a SuperAdmin", async () => {
    const cong2 = await createCongregation("Shield Branch");
    const boss = await createUser({ congregationId: cong2, role: "SuperAdmin", email: "sh-boss@dev.local", fullName: "Shield Boss" });
    const nosy = await createUser({ congregationId: cong2, role: "Admin", email: "sh-admin@dev.local", fullName: "Shield Admin" });
    const mem = await createUser({ congregationId: cong2, email: "sh1@dev.local", fullName: "Shield Member" });
    const bossTok = staff(boss.user_id, "SuperAdmin", cong2);
    const nosyTok = staff(nosy.user_id, "Admin", cong2);
    const memTok = bearer({ sub: mem.user_id, role: "Student", cong: cong2 });

    await agent().post("/v1/chat/broadcast").set(auth(bossTok))
      .send({ body: "How is your heart?", client_mutation_id: uuid(60) });
    // The member answers — privately, they believe.
    const inbox = await agent().get("/v1/chat/conversations").set(auth(memTok));
    const dm = (inbox.body.conversations as Array<{ conversation_id: string; kind: string }>).find((c) => c.kind === "dm")!;
    await agent().post(`/v1/chat/conversations/${dm.conversation_id}/messages`).set(auth(memTok))
      .send({ message_id: uuid(61), body: "Honestly, I am struggling", msg_type: "text", client_mutation_id: uuid(62) });

    // The Admin's oversight inbox does not carry it...
    const modInbox = await agent().get("/v1/chat/conversations").set(auth(nosyTok));
    const ids = (modInbox.body.conversations as Array<{ conversation_id: string }>).map((c) => c.conversation_id);
    expect(ids).not.toContain(dm.conversation_id);
    // ...and neither does the direct door, even knowing the id (404, no existence leak).
    const direct = await agent().get(`/v1/chat/conversations/${dm.conversation_id}`).set(auth(nosyTok));
    expect(direct.status).toBe(404);

    // The SuperAdmin sees it in oversight, and can open it.
    const bossInbox = await agent().get("/v1/chat/conversations").set(auth(bossTok));
    expect((bossInbox.body.conversations as Array<{ conversation_id: string }>).map((c) => c.conversation_id))
      .toContain(dm.conversation_id);
    const bossOpen = await agent().get(`/v1/chat/conversations/${dm.conversation_id}`).set(auth(bossTok));
    expect(bossOpen.status).toBe(200);

    // An ordinary DM is NOT shielded — Admin oversight is unchanged elsewhere.
    const plain = await agent().post("/v1/chat/dms").set(auth(memTok)).send({ user_id: nosy.user_id });
    const plainOpen = await agent().get(`/v1/chat/conversations/${plain.body.conversation_id}`).set(auth(nosyTok));
    expect(plainOpen.status).toBe(200);
  });

  it("a SuperAdmin invites one person into ONE thread — and the member is told", async () => {
    const cong2 = await createCongregation("Invite Branch");
    const boss = await createUser({ congregationId: cong2, role: "SuperAdmin", email: "iv-boss@dev.local", fullName: "Pastor Ivy" });
    const deacon = await createUser({ congregationId: cong2, role: "Admin", email: "iv-dea@dev.local", fullName: "Deacon Dan" });
    const mem = await createUser({ congregationId: cong2, email: "iv1@dev.local", fullName: "Iva Member" });
    const other = await createUser({ congregationId: cong2, email: "iv2@dev.local", fullName: "Otto Member" });
    const bossTok = staff(boss.user_id, "SuperAdmin", cong2);
    const deaTok = staff(deacon.user_id, "Admin", cong2);
    const memTok = bearer({ sub: mem.user_id, role: "Student", cong: cong2 });
    const otherTok = bearer({ sub: other.user_id, role: "Student", cong: cong2 });

    await agent().post("/v1/chat/broadcast").set(auth(bossTok))
      .send({ body: "Tell me how to pray for you", client_mutation_id: uuid(64) });
    const threadOf = async (tok: string): Promise<string> => {
      const ib = await agent().get("/v1/chat/conversations").set(auth(tok));
      return (ib.body.conversations as Array<{ conversation_id: string; kind: string }>).find((c) => c.kind === "dm")!.conversation_id;
    };
    const ivaThread = await threadOf(memTok);
    const ottoThread = await threadOf(otherTok);

    // Before: the deacon can reach neither.
    expect((await agent().get(`/v1/chat/conversations/${ivaThread}`).set(auth(deaTok))).status).toBe(404);

    const inv = await agent().post(`/v1/chat/conversations/${ivaThread}/invite`).set(auth(bossTok))
      .send({ user_id: deacon.user_id });
    expect(inv.status).toBe(201);
    expect(inv.body.already).toBe(false);

    // The deacon can now open THAT thread — through membership, not oversight.
    const opened = await agent().get(`/v1/chat/conversations/${ivaThread}`).set(auth(deaTok));
    expect(opened.status).toBe(200);
    // ...and still nothing else. The authorisation was for one conversation.
    expect((await agent().get(`/v1/chat/conversations/${ottoThread}`).set(auth(deaTok))).status).toBe(404);

    // Iva is TOLD — a silent reader would be a betrayal.
    const seen = await agent().get(`/v1/chat/conversations/${ivaThread}`).set(auth(memTok));
    const bodies = (seen.body.messages as Array<{ body: string }>).map((m) => m.body);
    expect(bodies.some((b) => b.includes("Pastor Ivy invited Deacon Dan into this conversation."))).toBe(true);

    // Re-inviting is a no-op, not a second notice.
    const again = await agent().post(`/v1/chat/conversations/${ivaThread}/invite`).set(auth(bossTok))
      .send({ user_id: deacon.user_id });
    expect(again.body.already).toBe(true);
    const after = await agent().get(`/v1/chat/conversations/${ivaThread}`).set(auth(memTok));
    expect((after.body.messages as Array<{ body: string }>).filter((m) => m.body.includes("invited"))).toHaveLength(1);

    // An Admin cannot invite — widening a private room is a SuperAdmin act.
    const denied = await agent().post(`/v1/chat/conversations/${ottoThread}/invite`).set(auth(deaTok))
      .send({ user_id: mem.user_id });
    expect(denied.status).toBe(403);
  });

  /** A valid session is not the same claim as "the account owner is holding the
   *  phone". An unlocked, logged-in handset left on a desk is already past auth
   *  and past requireRole — so before it opens the church's private answers, the
   *  password is asked for again (§5.3 step-up). */
  it("will not open a broadcast on a session alone — the password is asked for again", async () => {
    const cong2 = await createCongregation("Locked Branch");
    const boss = await createUser({ congregationId: cong2, role: "SuperAdmin", email: "lk-boss@dev.local", fullName: "Locked Boss" });
    await createUser({ congregationId: cong2, email: "lk1@dev.local", fullName: "Locked Member" });
    await testPool().query(`UPDATE users SET password_hash = $2 WHERE user_id = $1`,
      [boss.user_id, await hashPassword("correct horse battery")]);

    // A perfectly valid, logged-in staff session — no password confirmation on it.
    const session = bearer({ sub: boss.user_id, role: "SuperAdmin", cong: cong2 });

    const listed = await agent().get("/v1/chat/broadcasts").set(auth(session));
    expect(listed.status).toBe(403);
    expect(listed.body.error.code).toBe("FORBIDDEN_SCOPE");
    expect(listed.body.error.details.password_required).toBe(true); // the client's cue to prompt
    // Sending in the church's name is gated too.
    const sent = await agent().post("/v1/chat/broadcast").set(auth(session))
      .send({ body: "not from me", client_mutation_id: uuid(66) });
    expect(sent.status).toBe(403);
    expect(sent.body.error.details.password_required).toBe(true);

    // A wrong password does not open it.
    const wrong = await agent().post("/v1/auth/confirm-password").set(auth(session)).send({ password: "hunter2" });
    expect(wrong.status).toBe(401);

    // The right one re-mints the SAME session, now password-confirmed.
    const ok = await agent().post("/v1/auth/confirm-password").set(auth(session))
      .send({ password: "correct horse battery" });
    expect(ok.status).toBe(200);
    expect(ok.body.access_token).toBeTruthy();
    const confirmed = `Bearer ${ok.body.access_token}`;

    const opened = await agent().get("/v1/chat/broadcasts").set(auth(confirmed));
    expect(opened.status).toBe(200);
    const nowSent = await agent().post("/v1/chat/broadcast").set(auth(confirmed))
      .send({ body: "Grace to you", client_mutation_id: uuid(67) });
    expect(nowSent.status).toBe(201);

    // A confirmation older than the window is no longer good enough.
    const stale = bearer({ sub: boss.user_id, role: "SuperAdmin", cong: cong2, pwd_at: Math.floor(Date.now() / 1000) - 1000 });
    expect((await agent().get("/v1/chat/broadcasts").set(auth(stale))).status).toBe(403);
  });

  it("confirming a password never downgrades a session that had 2FA", async () => {
    const cong2 = await createCongregation("Carry Branch");
    const boss = await createUser({ congregationId: cong2, role: "SuperAdmin", email: "cy-boss@dev.local", fullName: "Carry Boss" });
    await testPool().query(`UPDATE users SET password_hash = $2 WHERE user_id = $1`,
      [boss.user_id, await hashPassword("second factor please")]);
    const mfaAt = Math.floor(Date.now() / 1000);
    const strong = bearer({ sub: boss.user_id, role: "SuperAdmin", cong: cong2, mfa: true, mfa_at: mfaAt });

    const ok = await agent().post("/v1/auth/confirm-password").set(auth(strong))
      .send({ password: "second factor please" });
    expect(ok.status).toBe(200);
    // The re-minted token still carries the second factor — a password step-up
    // must never quietly weaken what was already proven.
    const claims = JSON.parse(Buffer.from((ok.body.access_token as string).split(".")[1]!, "base64").toString()) as
      { mfa?: boolean; mfa_at?: number; pwd_at?: number };
    expect(claims.mfa).toBe(true);
    expect(claims.mfa_at).toBe(mfaAt);
    expect(claims.pwd_at).toBeGreaterThanOrEqual(mfaAt);
  });

  it("a replay returns what actually landed, not a recount of today's membership", async () => {
    const cong2 = await createCongregation("Replay Branch");
    const sender = await createUser({ congregationId: cong2, role: "Admin", email: "rp@dev.local", fullName: "Replay Ray" });
    await createUser({ congregationId: cong2, email: "rp1@dev.local", fullName: "Rp One" });
    const senderTok = staff(sender.user_id, "Admin", cong2);

    const first = await agent().post("/v1/chat/broadcast").set(auth(senderTok))
      .send({ body: "counted once", client_mutation_id: uuid(85) });
    expect(first.body.sent).toBe(1);

    // Someone joins AFTER the send. The replay must still report 1 — the number
    // that actually went out — not 2, which never happened.
    await createUser({ congregationId: cong2, email: "rp2@dev.local", fullName: "Rp Two (joined later)" });
    const replay = await agent().post("/v1/chat/broadcast").set(auth(senderTok))
      .send({ body: "counted once", client_mutation_id: uuid(85) });
    expect(replay.body).toMatchObject({ sent: 1, duplicate: true, broadcast_id: first.body.broadcast_id });

    // And the latecomer got nothing — a replay delivers no new copies.
    const copies = await testPool().query(`SELECT count(*)::int AS n FROM chat_messages WHERE body = $1`, ["counted once"]);
    expect(copies.rows[0].n).toBe(1);
  });
});

// keep references used (lint)
void aId;
