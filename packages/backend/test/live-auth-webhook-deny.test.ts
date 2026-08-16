// Nuru Live — PROVEN IN PRODUCTION (2026-07-31): MediaMTX v1.19.3 forwards an
// EMPTY `user` for WHIP/WHEP publish/read unless the client authenticates
// with HTTP Basic (query-param creds are silently ignored). Before this fix,
// `LiveService.AuthWebhook` declared `user: z.string().min(1)...`, so every
// such request died at `parseBody()` with a 400 VALIDATION_FAILED — which
// MediaMTX logged as "failed to authenticate" and gave up on, silently
// breaking the entire L6a guest-video feature.
//
// The fix's contract, exercised here: POST /v1/live/auth is an
// authentication webhook reached by an untrusted, session-less caller — it
// must ALWAYS answer with a decision (200 allow / 401 deny), never a
// validation error (400) or a crash (500). See docs/LIVE_STREAMING.md
// "Hard-won operational facts" and docs/LIVE_INTERACTIVE.md's L6a section.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Writable } from "node:stream";
import { pino } from "pino";
import supertest from "supertest";
import { createApp } from "../src/http/app.js";
import { testEnv, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";

const auth = (t: string) => ({ Authorization: t });

/** A real app wired to a pino logger that captures every log line instead of
 *  discarding it (tests elsewhere use level:"silent"), so we can assert on
 *  what the auth webhook actually logs — specifically, that it NEVER logs a
 *  password or guest_token value. */
function buildCapturingApp(): { app: ReturnType<typeof supertest>; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const pool = testPool();
  const log = pino({ level: "info" }, stream);
  const app = createApp({ env: testEnv(), db: { primary: pool, replica: pool }, log });
  return { app: supertest(app), lines };
}

interface CreatedStream {
  stream_id: string;
  stream_key: string;
}

async function createChurchStream(app: ReturnType<typeof supertest>, tok: string): Promise<CreatedStream> {
  const res = await app.post("/v1/live/streams").set(auth(tok)).send({ scope: "church", title: "Sunday service", kind: "video" });
  expect(res.status).toBe(201);
  return { stream_id: res.body.stream_id, stream_key: res.body.stream_key };
}

async function inviteAndAccept(app: ReturnType<typeof supertest>, ownerTok: string, streamId: string, guestUserId: string, guestTok: string): Promise<void> {
  const invite = await app.post(`/v1/live/streams/${streamId}/guests/${guestUserId}`).set(auth(ownerTok));
  expect(invite.status).toBe(204);
  const accept = await app.post(`/v1/live/streams/${streamId}/guests/respond`).set(auth(guestTok)).send({ accept: true });
  expect(accept.status).toBe(204);
}

async function guestToken(streamId: string, userId: string): Promise<string> {
  const row = await testPool().query<{ guest_token: string | null }>(
    `SELECT guest_token FROM live_stream_guests WHERE stream_id = $1 AND user_id = $2`,
    [streamId, userId],
  );
  return row.rows[0]!.guest_token as string;
}

let cong: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
});
afterAll(async () => {
  await closeTestPool();
});

describe("POST /v1/live/auth — deny, never validation-error", () => {
  it("empty `user` on a guest publish path -> 401, NOT 400", async () => {
    const { app } = buildCapturingApp();
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "d1@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const stream = await createChurchStream(app, adminTok);
    const guest = await createUser({ congregationId: cong, email: "d2@dev.local" });
    const guestTok = bearer({ sub: guest.user_id, role: "Student", cong });
    await inviteAndAccept(app, adminTok, stream.stream_id, guest.user_id, guestTok);
    const token = await guestToken(stream.stream_id, guest.user_id);

    const res = await app.post("/v1/live/auth").send({
      user: "", password: token, path: `guest/${stream.stream_id}/${guest.user_id}`, action: "publish",
    });
    expect(res.status).toBe(401);
    expect(res.status).not.toBe(400);
  });

  it("absent `user` field entirely -> 401 deny, NOT 400 (the exact production shape: MediaMTX v1.19.3's real WHIP/WHEP request)", async () => {
    const { app } = buildCapturingApp();
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "d3@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const stream = await createChurchStream(app, adminTok);
    const guest = await createUser({ congregationId: cong, email: "d4@dev.local" });
    const guestTok = bearer({ sub: guest.user_id, role: "Student", cong });
    await inviteAndAccept(app, adminTok, stream.stream_id, guest.user_id, guestTok);

    // No `user` key at all — this is what MediaMTX actually sent in prod.
    const res = await app.post("/v1/live/auth").send({
      password: "irrelevant", path: `guest/${stream.stream_id}/${guest.user_id}`, action: "publish",
    });
    expect(res.status).toBe(401);
    expect(res.status).not.toBe(400);
  });

  it("also 401s the church/cell (non-guest) publish path on an absent `user`", async () => {
    const { app } = buildCapturingApp();
    const res = await app.post("/v1/live/auth").send({ password: "irrelevant", path: "church", action: "publish" });
    expect(res.status).toBe(401);
    expect(res.status).not.toBe(400);
  });

  it("garbage body (wrong field types) on a would-be-guarded action -> 401, NOT 500", async () => {
    const { app, lines } = buildCapturingApp();
    // `path` is a number (not a string), `action` is "publish" so the route
    // can't early-exit-allow — this must fail zod parsing and still resolve
    // to a plain 401, not a 500 from an uncaught throw.
    const res = await app.post("/v1/live/auth").send({ action: "publish", path: 12345, user: { nested: true }, password: null });
    expect(res.status).toBe(401);
    expect(res.status).not.toBe(500);
    expect(lines.some((l) => l.includes("unparseable body"))).toBe(true);
  });

  it("oversized `user`/`password` fields -> 401, NOT 500", async () => {
    const { app } = buildCapturingApp();
    const res = await app.post("/v1/live/auth").send({
      action: "publish",
      path: "church",
      user: "x".repeat(500),
      password: "y".repeat(500),
    });
    expect(res.status).toBe(401);
    expect(res.status).not.toBe(500);
  });

  it("minimal body (no user/password at all) on a syntactically-invalid guest path -> 401, NOT 400/500", async () => {
    const { app } = buildCapturingApp();
    const res = await app.post("/v1/live/auth").send({ action: "publish", path: "guest/not-json-shaped" });
    expect(res.status).toBe(401);
  });

  it("truly empty JSON body {} -> allowed (non-publish, non-guest default), never a 400/500", async () => {
    // Mirrors an MediaMTX probe with nothing meaningful in the body — action
    // isn't "publish" (it's undefined) and there's no guest path, so this
    // must hit the early-exit allow, not the parser at all.
    const { app } = buildCapturingApp();
    const res = await app.post("/v1/live/auth").send({});
    expect(res.status).toBe(200);
  });

  it("REGRESSION GUARD: a valid guest (accepted status + correct guest_token) still gets 200 allow", async () => {
    const { app } = buildCapturingApp();
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "d5@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const stream = await createChurchStream(app, adminTok);
    const guest = await createUser({ congregationId: cong, email: "d6@dev.local" });
    const guestTok = bearer({ sub: guest.user_id, role: "Student", cong });
    await inviteAndAccept(app, adminTok, stream.stream_id, guest.user_id, guestTok);
    const token = await guestToken(stream.stream_id, guest.user_id);

    const res = await app.post("/v1/live/auth").send({
      user: guest.user_id, password: token, path: `guest/${stream.stream_id}/${guest.user_id}`, action: "publish",
    });
    expect(res.status).toBe(200);
  });

  it("REGRESSION GUARD: a non-publish, non-guest action with empty creds is still allowed (protects the HLS/CDN poll)", async () => {
    const { app } = buildCapturingApp();
    const res = await app.post("/v1/live/auth").send({ user: "", password: "", path: "church", action: "read" });
    expect(res.status).toBe(200);
  });

  it("never logs the password or guest_token value, on either the deny or the malformed-body path", async () => {
    const { app, lines } = buildCapturingApp();
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "d7@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const stream = await createChurchStream(app, adminTok);
    const guest = await createUser({ congregationId: cong, email: "d8@dev.local" });
    const guestTok = bearer({ sub: guest.user_id, role: "Student", cong });
    await inviteAndAccept(app, adminTok, stream.stream_id, guest.user_id, guestTok);
    const realToken = await guestToken(stream.stream_id, guest.user_id);

    const WRONG_SECRET = "TOTALLY-SECRET-WRONG-PASSWORD-VALUE-9f8e7d";
    const denyRes = await app.post("/v1/live/auth").send({
      user: guest.user_id, password: WRONG_SECRET, path: `guest/${stream.stream_id}/${guest.user_id}`, action: "publish",
    });
    expect(denyRes.status).toBe(401);

    const malformedRes = await app.post("/v1/live/auth").send({
      action: "publish", path: "church", user: "x".repeat(500), password: WRONG_SECRET,
    });
    expect(malformedRes.status).toBe(401);

    // Also exercise the real stream key so we're sure it isn't logged either.
    const validKeyDenyRes = await app.post("/v1/live/auth").send({
      user: stream.stream_id, password: "wrong-" + stream.stream_key, path: "church", action: "publish",
    });
    expect(validKeyDenyRes.status).toBe(401);

    const captured = lines.join("\n");
    expect(captured).not.toContain(WRONG_SECRET);
    expect(captured).not.toContain(realToken);
    expect(captured).not.toContain(stream.stream_key);
  });
});
