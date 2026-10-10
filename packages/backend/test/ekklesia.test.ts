// Ekklesia — the intercessory watch. Membership gates the body and the act of
// interceding; anyone may bring a need; intercessions are one row per day;
// leaders close and pin; scope never leaks across congregations.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, closeTestPool, testPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";

let cong: string, moses: string, mosesTok: string, graceTok: string, graceId: string, pastorTok: string, strangerTok: string;
const auth = (t: string) => ({ Authorization: t });
const uuid = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  const other = await createCongregation();
  const m = await createUser({ congregationId: cong, email: "moses@dev.local", fullName: "Moses Nganga" });
  const g = await createUser({ congregationId: cong, email: "grace@dev.local", fullName: "Grace Wanjiru" });
  const p = await createUser({ congregationId: cong, email: "pastor@dev.local", fullName: "Pastor", role: "Instructor" });
  const s = await createUser({ congregationId: other, email: "far@dev.local", fullName: "Far Away" });
  moses = m.user_id; graceId = g.user_id;
  mosesTok = bearer({ sub: m.user_id, role: "Student", cong });
  graceTok = bearer({ sub: g.user_id, role: "Student", cong });
  pastorTok = bearer({ sub: p.user_id, role: "Instructor", cong });
  strangerTok = bearer({ sub: s.user_id, role: "Student", cong: other });
});
afterAll(async () => {
  await closeTestPool();
});

const bring = (tok: string, n: number, extra: Record<string, unknown> = {}) =>
  agent().post("/v1/ekklesia/requests").set(auth(tok)).send({
    request_id: uuid(n), title: "Healing for Eliyanah", body: "Spiking fever and a cough; she is very weak.", for_whom: "Eliyanah Praisely", ...extra,
  });

describe("Ekklesia", () => {
  it("shows the watch to everyone, the needs only to intercessors", async () => {
    await bring(mosesTok, 1);
    // Grace has not joined: she sees the watch, the counts, a preview — no bodies.
    const outside = await agent().get("/v1/ekklesia").set(auth(graceTok));
    expect(outside.status).toBe(200);
    expect(outside.body.group.is_member).toBe(false);
    expect(outside.body.group.active_count).toBe(1);
    expect(outside.body.requests).toEqual([]);
    expect(outside.body.preview).toHaveLength(1);
    expect(outside.body.preview[0].title).toBe("Healing for Eliyanah");
    expect(outside.body.preview[0].body).toBeUndefined();

    const joined = await agent().post("/v1/ekklesia/join").set(auth(graceTok));
    expect(joined.body).toMatchObject({ joined: true, member_count: 1, first_time: true });
    const inside = await agent().get("/v1/ekklesia").set(auth(graceTok));
    expect(inside.body.group.is_member).toBe(true);
    expect(inside.body.requests).toHaveLength(1);
    expect(inside.body.requests[0]).toMatchObject({ for_whom: "Eliyanah Praisely", author_name: "Moses Nganga", mine: false, intercessor_count: 0, i_prayed_today: false });
    expect(inside.body.group.needs_me_today).toBe(1);
  });

  it("notifies every intercessor once when a need is brought, and a replay is a no-op", async () => {
    await agent().post("/v1/ekklesia/join").set(auth(graceTok));
    await agent().post("/v1/ekklesia/join").set(auth(pastorTok));
    const first = await bring(mosesTok, 2, { client_mutation_id: uuid(90), urgency: "urgent" });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ request_id: uuid(2), duplicate: false, notified: 2 });
    const again = await bring(mosesTok, 2, { client_mutation_id: uuid(90), urgency: "urgent" });
    expect(again.body).toMatchObject({ request_id: uuid(2), duplicate: true, notified: 0 });
    const { rows } = await testPool().query(`SELECT user_id, payload FROM notifications WHERE template = 'ekklesia_request' ORDER BY user_id`);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.user_id)).not.toContain(moses);
    expect(rows[0].payload.title).toBe("Ekklesia · urgent");
    expect(rows[0].payload.body).toBe("Eliyanah Praisely: Healing for Eliyanah");
  });

  it("counts intercession once per day, and only for intercessors", async () => {
    await bring(mosesTok, 3);
    const refused = await agent().post(`/v1/ekklesia/requests/${uuid(3)}/intercede`).set(auth(graceTok));
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("FORBIDDEN_SCOPE");
    expect(refused.body.error.details.join).toBe(true);

    await agent().post("/v1/ekklesia/join").set(auth(graceTok));
    const one = await agent().post(`/v1/ekklesia/requests/${uuid(3)}/intercede`).set(auth(graceTok));
    expect(one.body).toMatchObject({ prayed_today: true, first_today: true, prayer_count: 1, intercessor_count: 1, my_prayer_days: 1 });
    const two = await agent().post(`/v1/ekklesia/requests/${uuid(3)}/intercede`).set(auth(graceTok));
    expect(two.body).toMatchObject({ prayed_today: true, first_today: false, prayer_count: 1, intercessor_count: 1 });

    const detail = await agent().get(`/v1/ekklesia/requests/${uuid(3)}`).set(auth(graceTok));
    expect(detail.status).toBe(200);
    expect(detail.body.request.i_prayed_today).toBe(true);
    expect(detail.body.intercessors).toHaveLength(1);
    expect(detail.body.intercessors[0]).toMatchObject({ name: "Grace Wanjiru", days: 1, me: true });

    const summary = await agent().get("/v1/ekklesia/summary").set(auth(graceTok));
    expect(summary.body).toMatchObject({ is_member: true, member_count: 1, active_count: 1, needs_me_today: 0, my_prayers_today: 1, prayers_today: 1 });
    expect(summary.body.latest[0].for_whom).toBe("Eliyanah Praisely");
    // A non-member's summary keeps the person's name with the watch.
    const outside = await agent().get("/v1/ekklesia/summary").set(auth(mosesTok));
    expect(outside.body.latest[0].for_whom).toBeNull();
  });

  it("lets the requester write back and close; a leader pins; a stranger to the watch cannot", async () => {
    await bring(mosesTok, 4);
    await agent().post("/v1/ekklesia/join").set(auth(graceTok));
    const up = await agent().post(`/v1/ekklesia/requests/${uuid(4)}/updates`).set(auth(mosesTok)).send({ update_id: uuid(40), body: "Fever is down this morning. Keep praying." });
    expect(up.status).toBe(201);
    const pinNo = await agent().post(`/v1/ekklesia/requests/${uuid(4)}/pinned`).set(auth(graceTok)).send({ pinned: true });
    expect(pinNo.status).toBe(403);
    const pinYes = await agent().post(`/v1/ekklesia/requests/${uuid(4)}/pinned`).set(auth(pastorTok)).send({ pinned: true });
    expect(pinYes.body.is_pinned).toBe(true);
    const closeNo = await agent().post(`/v1/ekklesia/requests/${uuid(4)}/answered`).set(auth(graceTok)).send({ answered: true });
    expect(closeNo.status).toBe(403);
    const closeYes = await agent().post(`/v1/ekklesia/requests/${uuid(4)}/answered`).set(auth(mosesTok)).send({ answered: true, note: "She is home and eating." });
    expect(closeYes.body.is_answered).toBe(true);

    const active = await agent().get("/v1/ekklesia").set(auth(graceTok));
    expect(active.body.requests).toHaveLength(0);
    const answered = await agent().get("/v1/ekklesia?status=answered").set(auth(graceTok));
    expect(answered.body.requests).toHaveLength(1);
    expect(answered.body.requests[0]).toMatchObject({ is_answered: true, answered_note: "She is home and eating.", is_pinned: false, update_count: 1 });
    expect(answered.body.group.answered_count).toBe(1);
  });

  it("never leaks the watch across congregations", async () => {
    await bring(mosesTok, 5);
    const far = await agent().get("/v1/ekklesia").set(auth(strangerTok));
    expect(far.body.group.active_count).toBe(0);
    expect(far.body.preview).toEqual([]);
    const peek = await agent().get(`/v1/ekklesia/requests/${uuid(5)}`).set(auth(strangerTok));
    expect(peek.status).toBe(404);
    const pray = await agent().post(`/v1/ekklesia/requests/${uuid(5)}/intercede`).set(auth(strangerTok));
    expect(pray.status).toBe(404);
  });

  it("puts the watch on an intercessor's Home rail, never on anyone else's", async () => {
    await bring(mosesTok, 6, { urgency: "urgent" });
    const before = await agent().get("/v1/me/home/nudges").set(auth(graceTok));
    expect((before.body.nudges as Array<{ kind: string }>).some((n) => n.kind === "ekklesia_watch")).toBe(false);
    await agent().post("/v1/ekklesia/join").set(auth(graceTok));
    const after = await agent().get("/v1/me/home/nudges").set(auth(graceTok));
    const card = (after.body.nudges as Array<{ kind: string; title: string; route: string; accent: string }>).find((n) => n.kind === "ekklesia_watch");
    expect(card).toMatchObject({ title: "1 need waits on the watch", route: "ekklesia", accent: "gold" });
    await agent().post(`/v1/ekklesia/requests/${uuid(6)}/intercede`).set(auth(graceTok));
    const done = await agent().get("/v1/me/home/nudges").set(auth(graceTok));
    expect((done.body.nudges as Array<{ kind: string }>).some((n) => n.kind === "ekklesia_watch")).toBe(false);
  });

  it("appoints leaders from the watch, and lets a member leave and return", async () => {
    await agent().post("/v1/ekklesia/join").set(auth(graceTok));
    const no = await agent().post(`/v1/ekklesia/members/${graceId}/role`).set(auth(mosesTok)).send({ role: "leader" });
    expect(no.status).toBe(403);
    const yes = await agent().post(`/v1/ekklesia/members/${graceId}/role`).set(auth(pastorTok)).send({ role: "leader" });
    expect(yes.body).toMatchObject({ user_id: graceId, role: "leader" });
    const left = await agent().post("/v1/ekklesia/leave").set(auth(graceTok));
    expect(left.body).toMatchObject({ left: true, member_count: 0 });
    const back = await agent().post("/v1/ekklesia/join").set(auth(graceTok));
    expect(back.body).toMatchObject({ joined: true, member_count: 1, first_time: false });
    const me = await agent().get("/v1/ekklesia").set(auth(graceTok));
    expect(me.body.group.my_role).toBe("leader");
  });
});
