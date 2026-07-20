// Selah — My Thoughts (Prayer Room tab 3, docs: prayer-room-arc). Private
// rich-text journal: CRUD, LWW upsert, offline-queue idempotency (both the
// direct PUT and the /sync/push mutation-queue replay), owner-scoping (private
// ground — no leader/admin read path), and hard delete + sync tombstoning.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";

let cong: string, me: string, meTok: string, other: string, otherTok: string;

const auth = (t: string) => ({ Authorization: t });
const uuid = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  const a = await createUser({ congregationId: cong, email: "me@dev.local" });
  const b = await createUser({ congregationId: cong, email: "other@dev.local" });
  me = a.user_id;
  other = b.user_id;
  meTok = bearer({ sub: me, role: "Student", cong });
  otherTok = bearer({ sub: other, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

describe("Selah — My Thoughts (private, offline-synced)", () => {
  it("creates, lists newest-first, reads by id, and hard-deletes with a tombstone", async () => {
    const t1 = await agent()
      .put("/v1/me/thoughts")
      .set(auth(meTok))
      .send({ thought_id: uuid(1), title: "Morning", body: "Pause. Reflect. Write." });
    expect(t1.status).toBe(200);
    expect(t1.body.duplicate).toBe(false);

    // A moment later, so created_at ordering is unambiguous.
    await new Promise((r) => setTimeout(r, 5));
    const t2 = await agent()
      .put("/v1/me/thoughts")
      .set(auth(meTok))
      .send({ thought_id: uuid(2), body: "A second thought" });
    expect(t2.status).toBe(200);

    const list = await agent().get("/v1/me/thoughts").set(auth(meTok));
    expect(list.status).toBe(200);
    expect(list.body.data.map((t: { thought_id: string }) => t.thought_id)).toEqual([uuid(2), uuid(1)]);

    const got = await agent().get(`/v1/me/thoughts/${uuid(1)}`).set(auth(meTok));
    expect(got.status).toBe(200);
    expect(got.body.title).toBe("Morning");
    expect(got.body.body).toBe("Pause. Reflect. Write.");
    expect(got.body.drawing_urls).toEqual([]);

    const del = await agent().delete(`/v1/me/thoughts/${uuid(1)}`).set(auth(meTok));
    expect(del.body.deleted).toBe(true);
    const reDel = await agent().delete(`/v1/me/thoughts/${uuid(1)}`).set(auth(meTok));
    expect(reDel.body.deleted).toBe(false); // idempotent

    const gone = await testPool().query(`SELECT 1 FROM member_thoughts WHERE thought_id=$1`, [uuid(1)]);
    expect(gone.rowCount).toBe(0); // HARD delete — privacy

    const pull = await agent().post("/v1/sync/pull").set(auth(meTok)).send({});
    expect(pull.body.tombstones.member_thoughts).toContain(uuid(1));
  });

  it("stores rich-text span attributes (bold/italic/color/font/spacing) and drawing URLs", async () => {
    const spans = [
      { start: 0, end: 5, bold: true },
      { start: 6, end: 12, italic: true, color: "#FF00AA", font: "Inter-Medium", spacing: 1.6 },
    ];
    const put = await agent()
      .put("/v1/me/thoughts")
      .set(auth(meTok))
      .send({
        thought_id: uuid(3),
        body: "Hello world",
        body_spans: spans,
        drawing_urls: ["https://res.cloudinary.com/nuru/image/upload/v1/nuru/thoughts/abc.png"],
      });
    expect(put.status).toBe(200);

    const got = await agent().get(`/v1/me/thoughts/${uuid(3)}`).set(auth(meTok));
    expect(got.body.body_spans).toEqual(spans);
    expect(got.body.drawing_urls).toEqual(["https://res.cloudinary.com/nuru/image/upload/v1/nuru/thoughts/abc.png"]);
  });

  it("LWW: a stale replay cannot clobber a newer write", async () => {
    const id = uuid(4);
    const t1 = new Date("2026-06-01T10:00:00Z").toISOString();
    const t2 = new Date("2026-06-02T10:00:00Z").toISOString();

    await agent().put("/v1/me/thoughts").set(auth(meTok)).send({ thought_id: id, body: "first", updated_at: t1 });
    await agent().put("/v1/me/thoughts").set(auth(meTok)).send({ thought_id: id, body: "second", updated_at: t2 });

    const stale = await agent()
      .put("/v1/me/thoughts")
      .set(auth(meTok))
      .send({ thought_id: id, body: "stale rewrite", updated_at: t1 });
    expect(stale.body.duplicate).toBe(true);

    const got = await agent().get(`/v1/me/thoughts/${id}`).set(auth(meTok));
    expect(got.body.body).toBe("second");
  });

  it("is idempotent on client_mutation_id — replaying the same id writes once", async () => {
    const id = uuid(5);
    const cmid = uuid(50);
    const first = await agent()
      .put("/v1/me/thoughts")
      .set(auth(meTok))
      .send({ thought_id: id, body: "one write", client_mutation_id: cmid });
    expect(first.body.duplicate).toBe(false);

    const replay = await agent()
      .put("/v1/me/thoughts")
      .set(auth(meTok))
      .send({ thought_id: id, body: "one write", client_mutation_id: cmid });
    expect(replay.body.duplicate).toBe(true);
    expect(replay.body.thought_id).toBe(id);

    const rows = await testPool().query(`SELECT count(*)::int AS n FROM member_thoughts WHERE thought_id=$1`, [id]);
    expect(rows.rows[0].n).toBe(1);
  });

  it("offline mutation queue replays thoughts idempotently via /sync/push", async () => {
    const id = uuid(6);
    const mutations = [
      { mutation_id: uuid(60), seq: 1, domain: "member_thoughts", op: "upsert", payload: { thought_id: id, body: "From the queue" } },
      { mutation_id: uuid(60), seq: 2, domain: "member_thoughts", op: "upsert", payload: { thought_id: id, body: "From the queue" } },
    ];
    const push = await agent().post("/v1/sync/push").set(auth(meTok)).send({ mutations });
    expect(push.body.results[0].status).toBe("applied");
    expect(push.body.results[1].status).toBe("duplicate");

    const del = await agent()
      .post("/v1/sync/push")
      .set(auth(meTok))
      .send({ mutations: [{ mutation_id: uuid(61), seq: 3, domain: "member_thoughts", op: "delete", payload: { thought_id: id } }] });
    expect(del.body.results[0].status).toBe("applied");
  });

  it("owner-scoping: another member cannot write into my thought id (403) and cannot read it (404)", async () => {
    const id = uuid(7);
    await agent().put("/v1/me/thoughts").set(auth(meTok)).send({ thought_id: id, body: "mine, private" });

    const hijack = await agent()
      .put("/v1/me/thoughts")
      .set(auth(otherTok))
      .send({ thought_id: id, body: "hijack", updated_at: new Date().toISOString() });
    expect(hijack.status).toBe(403);

    const peek = await agent().get(`/v1/me/thoughts/${id}`).set(auth(otherTok));
    expect(peek.status).toBe(404); // private ground — never confirms it exists

    const missing = await agent().get(`/v1/me/thoughts/${uuid(97)}`).set(auth(otherTok));
    expect(missing.status).toBe(404); // same code for truly-missing vs. not-mine

    const del = await agent().delete(`/v1/me/thoughts/${id}`).set(auth(otherTok));
    expect(del.body.deleted).toBe(false); // scoped delete: calm no-op, not an error

    const stillMine = await testPool().query(`SELECT 1 FROM member_thoughts WHERE thought_id=$1`, [id]);
    expect(stillMine.rowCount).toBe(1);

    // Never appears in another member's pull (user-scoped domain, §5.4).
    const theirPull = await agent().post("/v1/sync/pull").set(auth(otherTok)).send({});
    expect(theirPull.body.changes.member_thoughts ?? []).toHaveLength(0);
  });

  it("requires authentication", async () => {
    const noAuth = await agent().get("/v1/me/thoughts");
    expect(noAuth.status).toBe(401);
  });
});
