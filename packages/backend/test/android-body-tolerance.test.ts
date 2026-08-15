// Android request-body tolerance (Postel) — regression suite for the kotlinx
// null-vs-absent class fixed after live's cell_id 400 (c65c353).
//
// The Android app's kotlinx-serialization Json (encodeDefaults=true + the
// explicitNulls default) serializes every `val x: T? = null` request field as
// an explicit `"x": null` on the wire. zod `.optional()` accepts ABSENT but
// rejects NULL, so each endpoint here 400'd (VALIDATION_FAILED) on the real
// Android body until its schema was widened to `.nullish()`. Every test posts
// the exact Android-shaped body (snake_case, nulls included). Where the happy
// path needs heavy fixtures, the assertion is that the parse layer accepted
// the body (no VALIDATION_FAILED) — domain errors like NOT_FOUND are fine.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";

const auth = (t: string) => ({ Authorization: t });

let cong: string;
let userId: string;
let tok: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  const u = await createUser({ congregationId: cong, role: "Student", email: "kx-tolerance@dev.local" });
  userId = u.user_id;
  tok = bearer({ sub: userId, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

/** The schema accepted the body: whatever happened next, it wasn't a zod reject. */
function expectParsed(res: { status: number; body?: { error?: { code?: string } } }): void {
  expect(res.body?.error?.code).not.toBe("VALIDATION_FAILED");
}

describe("Android kotlinx body tolerance — full happy paths", () => {
  it("PUT /me/verses accepts version/verse_text/note as null and defaults version to KJV", async () => {
    const savedVerseId = randomUUID();
    const res = await agent().put("/v1/me/verses").set(auth(tok)).send({
      saved_verse_id: savedVerseId,
      reference: "John 3:16",
      version: null,
      verse_text: null,
      note: null,
      client_mutation_id: randomUUID(),
    });
    expect(res.status).toBe(200);
    const row = await testPool().query(`SELECT version FROM saved_verses WHERE saved_verse_id = $1`, [savedVerseId]);
    expect(row.rows[0].version).toBe("KJV");
  });

  it("POST /me/notifications/read accepts ids: null as mark-all", async () => {
    const res = await agent().post("/v1/me/notifications/read").set(auth(tok)).send({ ids: null });
    expect(res.status).toBe(200);
    expect(res.body.marked).toBe(0);
  });

  it("POST /me/devices accepts app_version/model/push_token as null", async () => {
    const res = await agent().post("/v1/me/devices").set(auth(tok)).send({
      platform: "android",
      app_version: null,
      model: null,
      push_token: null,
    });
    expect(res.status).toBe(201);
    expect(res.body.device_id).toBeTruthy();
  });

  it("POST /sync/push and /sync/pull accept device_id: null", async () => {
    const push = await agent().post("/v1/sync/push").set(auth(tok)).send({ device_id: null, mutations: [] });
    expect(push.status).toBe(200);
    const pull = await agent().post("/v1/sync/pull").set(auth(tok)).send({ device_id: null });
    expect(pull.status).toBe(200);
  });

  it("POST /chat/connections/requests accepts message: null", async () => {
    const other = await createUser({ congregationId: cong, role: "Student", email: "kx-peer@dev.local" });
    const res = await agent().post("/v1/chat/connections/requests").set(auth(tok)).send({
      user_id: other.user_id,
      message: null,
      client_mutation_id: randomUUID(),
    });
    expectParsed(res);
    expect(res.status).toBeLessThan(400);
    expect(res.body.request_id).toBeTruthy();
  });
});

describe("Android kotlinx body tolerance — parse layer (heavy-fixture endpoints)", () => {
  it("POST /modules/:id/complete accepts reflection_text: null", async () => {
    const res = await agent().post(`/v1/modules/${randomUUID()}/complete`).set(auth(tok))
      .send({ reflection_text: null });
    expectParsed(res);
  });

  it("POST /growth/plans/:id/days/:n/talk/assist accepts draft: null", async () => {
    const res = await agent().post(`/v1/growth/plans/${randomUUID()}/days/1/talk/assist`).set(auth(tok))
      .send({ draft: null });
    expectParsed(res);
  });

  it("POST /me/prayer/assist accepts seed: null", async () => {
    const res = await agent().post("/v1/me/prayer/assist").set(auth(tok)).send({ seed: null });
    expectParsed(res);
  });

  it("POST /chat/spaces/:id/join-requests accepts message: null", async () => {
    const res = await agent().post(`/v1/chat/spaces/${randomUUID()}/join-requests`).set(auth(tok))
      .send({ message: null });
    expectParsed(res);
  });

  it("POST /reading/groups accepts member_user_ids/name as null", async () => {
    const res = await agent().post("/v1/reading/groups").set(auth(tok))
      .send({ plan_id: randomUUID(), member_user_ids: null, name: null });
    expectParsed(res);
  });

  it("POST /reading/groups/:id/invites accepts user_id/message as null (link invite)", async () => {
    const res = await agent().post(`/v1/reading/groups/${randomUUID()}/invites`).set(auth(tok))
      .send({ user_id: null, message: null, client_mutation_id: randomUUID() });
    expectParsed(res);
  });

  it("POST /giving/intents accepts phone_number: null", async () => {
    const res = await agent().post("/v1/giving/intents").set(auth(tok)).send({
      fund: "tithe",
      amount_minor: 1000,
      currency: "KES",
      method: "card",
      phone_number: null,
      idempotency_key: randomUUID(),
    });
    expectParsed(res);
  });
});
