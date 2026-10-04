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
import { createCongregation, createUser, createChurchService } from "./helpers/factories.js";
import { serviceScanToken } from "../src/modules/attendance/service.js";

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

describe("Android kotlinx body tolerance — found 2026-10-04 (full happy paths)", () => {
  it("POST /services/:id/attendance accepts the Android check-in: name/phone/email/attended_at as null", async () => {
    const svc = await createChurchService(cong, {
      checkinOpensAt: new Date(Date.now() - 3_600_000).toISOString(),
      checkinClosesAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    // ServiceCheckInBody (nuru-android data/net/EventsDtos.kt): attended_at is
    // never set and blank contact fields go out as null.
    const res = await agent().post(`/v1/services/${svc.service_id}/attendance`).set(auth(tok)).send({
      client_scan_id: randomUUID(),
      scan_token: serviceScanToken(svc.qr_secret, svc.service_id),
      full_name: null,
      phone_number: null,
      email: null,
      attended_at: null,
    });
    expect(res.status).toBe(201);
    // null name/phone fell back to the profile, as an absent field always did.
    const row = await testPool().query(
      `SELECT full_name, phone_number FROM service_attendance WHERE user_id = $1 AND service_id = $2`,
      [userId, svc.service_id],
    );
    expect(row.rows[0].full_name).toBeTruthy();
    expect(row.rows[0].phone_number).toBe("+254700000000");
  });

  // A formatted Selah span as Android sends it (SelahRichEditor): every
  // attribute the span doesn't use goes out as null.
  const androidSpans = [{ start: 0, end: 5, bold: true, italic: null, color: null, font: null, spacing: null }];

  it("PUT /me/thoughts accepts formatted spans with null attributes and stores them like iOS's", async () => {
    const id = randomUUID();
    const res = await agent().put("/v1/me/thoughts").set(auth(tok)).send({
      thought_id: id,
      title: null,
      body: "Grace upon grace",
      body_spans: androidSpans,
      client_mutation_id: randomUUID(),
    });
    expectParsed(res);
    expect(res.status).toBeLessThan(300);
    const row = await testPool().query(`SELECT body_spans FROM member_thoughts WHERE thought_id = $1`, [id]);
    expect(row.rows[0].body_spans).toEqual([{ start: 0, end: 5, bold: true }]);
  });

  it("POST /sync/push replays a formatted Android thought instead of rejecting (and dropping) it", async () => {
    const id = randomUUID();
    const push = await agent().post("/v1/sync/push").set(auth(tok)).send({
      device_id: null,
      mutations: [{
        mutation_id: randomUUID(), seq: 1, domain: "member_thoughts", op: "upsert",
        payload: { thought_id: id, title: null, body: "Written offline", body_spans: androidSpans, client_mutation_id: randomUUID() },
      }],
    });
    expect(push.status).toBe(200);
    expect(push.body.results[0].status).toBe("applied");
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

  // The exact GiveBody an unnamed Android gift sends (nuru-android
  // data/net/GivingDtos.kt): phone_number AND account_name as null; pledge_id
  // and need_id are @EncodeDefault(NEVER), so absent. This test used to omit
  // account_name, so the sweep missed it — and production refused every
  // unnamed Android gift with VALIDATION_FAILED (2026-10-04).
  for (const method of ["card", "mpesa"] as const) {
    it(`POST /giving/intents accepts the unnamed Android gift (${method}): phone_number and account_name null`, async () => {
      const res = await agent().post("/v1/giving/intents").set(auth(tok)).send({
        fund: "tithe",
        amount_minor: 100000,
        currency: "KES",
        method,
        phone_number: null,
        account_name: null,
        idempotency_key: randomUUID(),
      });
      expectParsed(res);
    });
  }
});
