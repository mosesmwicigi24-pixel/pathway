// Nuru Live L6a (docs/LIVE_INTERACTIVE.md) — guest WebRTC publish
// authorization + URL plumbing: guest_token mint-on-accept/revoke-on-exit,
// the /v1/live/auth webhook's new guest publish/read rules, the
// guests/me/ingest endpoint, and pulse's owner-only whep_url. Mirrors
// live-interactions.test.ts's idioms (embedded Postgres, real Express app via
// supertest).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";

const auth = (t: string) => ({ Authorization: t });
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

interface CreatedStream {
  stream_id: string;
  stream_key: string;
}

async function createChurchStream(tok: string, title = "Sunday service"): Promise<CreatedStream> {
  const res = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "church", title, kind: "video" });
  expect(res.status).toBe(201);
  return { stream_id: res.body.stream_id, stream_key: res.body.stream_key };
}

async function inviteAndAccept(ownerTok: string, streamId: string, guestUserId: string, guestTok: string): Promise<void> {
  const invite = await agent().post(`/v1/live/streams/${streamId}/guests/${guestUserId}`).set(auth(ownerTok));
  expect(invite.status).toBe(204);
  const accept = await agent().post(`/v1/live/streams/${streamId}/guests/respond`).set(auth(guestTok)).send({ accept: true });
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

describe("Live L6a — guest_token lifecycle", () => {
  it("accepting mints a random token; declining leaves it null", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "t1@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const stream = await createChurchStream(adminTok);

    const accepter = await createUser({ congregationId: cong, email: "t2@dev.local" });
    const accepterTok = bearer({ sub: accepter.user_id, role: "Student", cong });
    await agent().post(`/v1/live/streams/${stream.stream_id}/guests/${accepter.user_id}`).set(auth(adminTok));
    await agent().post(`/v1/live/streams/${stream.stream_id}/guests/respond`).set(auth(accepterTok)).send({ accept: true });
    const acceptedToken = await guestToken(stream.stream_id, accepter.user_id);
    expect(acceptedToken).toMatch(/^[0-9a-f]{32}$/);

    const decliner = await createUser({ congregationId: cong, email: "t3@dev.local" });
    const declinerTok = bearer({ sub: decliner.user_id, role: "Student", cong });
    await agent().post(`/v1/live/streams/${stream.stream_id}/guests/${decliner.user_id}`).set(auth(adminTok));
    await agent().post(`/v1/live/streams/${stream.stream_id}/guests/respond`).set(auth(declinerTok)).send({ accept: false });
    expect(await guestToken(stream.stream_id, decliner.user_id)).toBeNull();
  });

  it("removal (broadcaster) revokes the token", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "t4@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const stream = await createChurchStream(adminTok);
    const guest = await createUser({ congregationId: cong, email: "t5@dev.local" });
    const guestTok = bearer({ sub: guest.user_id, role: "Student", cong });
    await inviteAndAccept(adminTok, stream.stream_id, guest.user_id, guestTok);
    expect(await guestToken(stream.stream_id, guest.user_id)).not.toBeNull();

    const removed = await agent().delete(`/v1/live/streams/${stream.stream_id}/guests/${guest.user_id}`).set(auth(adminTok));
    expect(removed.status).toBe(204);
    expect(await guestToken(stream.stream_id, guest.user_id)).toBeNull();
  });

  it("self-leave revokes the token", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "t6@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const stream = await createChurchStream(adminTok);
    const guest = await createUser({ congregationId: cong, email: "t7@dev.local" });
    const guestTok = bearer({ sub: guest.user_id, role: "Student", cong });
    await inviteAndAccept(adminTok, stream.stream_id, guest.user_id, guestTok);

    const left = await agent().delete(`/v1/live/streams/${stream.stream_id}/guests/${guest.user_id}`).set(auth(guestTok));
    expect(left.status).toBe(204);
    expect(await guestToken(stream.stream_id, guest.user_id)).toBeNull();
  });

  it("ending the stream sweeps every active guest's token to null", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "t8@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const stream = await createChurchStream(adminTok);
    const guest = await createUser({ congregationId: cong, email: "t9@dev.local" });
    const guestTok = bearer({ sub: guest.user_id, role: "Student", cong });
    await inviteAndAccept(adminTok, stream.stream_id, guest.user_id, guestTok);
    expect(await guestToken(stream.stream_id, guest.user_id)).not.toBeNull();

    await agent().post(`/v1/live/streams/${stream.stream_id}/end`).set(auth(adminTok));
    expect(await guestToken(stream.stream_id, guest.user_id)).toBeNull();
  });

  it("re-inviting a lapsed guest clears any stale token from a prior accepted stint", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "t10@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const stream = await createChurchStream(adminTok);
    const guest = await createUser({ congregationId: cong, email: "t11@dev.local" });
    const guestTok = bearer({ sub: guest.user_id, role: "Student", cong });
    await inviteAndAccept(adminTok, stream.stream_id, guest.user_id, guestTok);
    await agent().delete(`/v1/live/streams/${stream.stream_id}/guests/${guest.user_id}`).set(auth(adminTok));

    const reinvite = await agent().post(`/v1/live/streams/${stream.stream_id}/guests/${guest.user_id}`).set(auth(adminTok));
    expect(reinvite.status).toBe(204);
    expect(await guestToken(stream.stream_id, guest.user_id)).toBeNull();
  });
});

describe("Live L6a — /v1/live/auth guest publish (WHIP)", () => {
  it("allows publish for an accepted guest presenting their own valid token", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "p1@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const stream = await createChurchStream(adminTok);
    const guest = await createUser({ congregationId: cong, email: "p2@dev.local" });
    const guestTok = bearer({ sub: guest.user_id, role: "Student", cong });
    await inviteAndAccept(adminTok, stream.stream_id, guest.user_id, guestTok);
    const token = await guestToken(stream.stream_id, guest.user_id);

    const res = await agent().post("/v1/live/auth").send({
      user: guest.user_id, password: token, path: `guest/${stream.stream_id}/${guest.user_id}`, action: "publish",
    });
    expect(res.status).toBe(200);
  });

  it("denies publish with the wrong token", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "p3@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const stream = await createChurchStream(adminTok);
    const guest = await createUser({ congregationId: cong, email: "p4@dev.local" });
    const guestTok = bearer({ sub: guest.user_id, role: "Student", cong });
    await inviteAndAccept(adminTok, stream.stream_id, guest.user_id, guestTok);

    const res = await agent().post("/v1/live/auth").send({
      user: guest.user_id, password: "0".repeat(32), path: `guest/${stream.stream_id}/${guest.user_id}`, action: "publish",
    });
    expect(res.status).toBe(401);
  });

  it("denies publish while still only 'invited' (not yet accepted)", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "p5@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const stream = await createChurchStream(adminTok);
    const guest = await createUser({ congregationId: cong, email: "p6@dev.local" });
    await agent().post(`/v1/live/streams/${stream.stream_id}/guests/${guest.user_id}`).set(auth(adminTok));

    const res = await agent().post("/v1/live/auth").send({
      user: guest.user_id, password: "anything", path: `guest/${stream.stream_id}/${guest.user_id}`, action: "publish",
    });
    expect(res.status).toBe(401);
  });

  it("denies publish once the stream has ended (token revoked by the end-sweep)", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "p7@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const stream = await createChurchStream(adminTok);
    const guest = await createUser({ congregationId: cong, email: "p8@dev.local" });
    const guestTok = bearer({ sub: guest.user_id, role: "Student", cong });
    await inviteAndAccept(adminTok, stream.stream_id, guest.user_id, guestTok);
    const token = await guestToken(stream.stream_id, guest.user_id);
    await agent().post(`/v1/live/streams/${stream.stream_id}/end`).set(auth(adminTok));

    const res = await agent().post("/v1/live/auth").send({
      user: guest.user_id, password: token, path: `guest/${stream.stream_id}/${guest.user_id}`, action: "publish",
    });
    expect(res.status).toBe(401);
  });

  it("denies publish when the 'user' credential doesn't self-identify as the path's userId (no cross-guest impersonation)", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "p9@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const stream = await createChurchStream(adminTok);
    const guestA = await createUser({ congregationId: cong, email: "p10@dev.local" });
    const guestATok = bearer({ sub: guestA.user_id, role: "Student", cong });
    await inviteAndAccept(adminTok, stream.stream_id, guestA.user_id, guestATok);
    const tokenA = await guestToken(stream.stream_id, guestA.user_id);
    const guestB = await createUser({ congregationId: cong, email: "p11@dev.local" });

    // guestA's own valid token, but claiming to be guestB — must be denied.
    const res = await agent().post("/v1/live/auth").send({
      user: guestB.user_id, password: tokenA, path: `guest/${stream.stream_id}/${guestA.user_id}`, action: "publish",
    });
    expect(res.status).toBe(401);
  });

  it("401s a malformed guest path gracefully rather than throwing", async () => {
    const res = await agent().post("/v1/live/auth").send({
      user: "x", password: "y", path: "guest/not-a-uuid/also-not", action: "publish",
    });
    // Not a recognized guest path (fails GUEST_PATH_RE) -> falls through to
    // the existing church/cell publish logic, which 401s on an invalid user.
    expect(res.status).toBe(401);
  });
});

describe("Live L6a — /v1/live/auth guest read (WHEP)", () => {
  it("allows read for the stream's own owner publish key (host composites)", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "r1@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const stream = await createChurchStream(adminTok);
    const guest = await createUser({ congregationId: cong, email: "r2@dev.local" });
    const guestTok = bearer({ sub: guest.user_id, role: "Student", cong });
    await inviteAndAccept(adminTok, stream.stream_id, guest.user_id, guestTok);

    const res = await agent().post("/v1/live/auth").send({
      user: stream.stream_id, password: stream.stream_key, path: `guest/${stream.stream_id}/${guest.user_id}`, action: "read",
    });
    expect(res.status).toBe(200);
  });

  it("allows read for any accepted guest of the same stream previewing another guest's path", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "r3@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const stream = await createChurchStream(adminTok);
    const guestA = await createUser({ congregationId: cong, email: "r4@dev.local" });
    const guestATok = bearer({ sub: guestA.user_id, role: "Student", cong });
    await inviteAndAccept(adminTok, stream.stream_id, guestA.user_id, guestATok);
    const guestB = await createUser({ congregationId: cong, email: "r5@dev.local" });
    const guestBTok = bearer({ sub: guestB.user_id, role: "Student", cong });
    await inviteAndAccept(adminTok, stream.stream_id, guestB.user_id, guestBTok);
    const tokenB = await guestToken(stream.stream_id, guestB.user_id);

    // guestB reads guestA's path using guestB's OWN credentials.
    const res = await agent().post("/v1/live/auth").send({
      user: guestB.user_id, password: tokenB, path: `guest/${stream.stream_id}/${guestA.user_id}`, action: "read",
    });
    expect(res.status).toBe(200);
  });

  it("denies read for a stranger's random credentials", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "r6@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const stream = await createChurchStream(adminTok);
    const guest = await createUser({ congregationId: cong, email: "r7@dev.local" });
    const guestTok = bearer({ sub: guest.user_id, role: "Student", cong });
    await inviteAndAccept(adminTok, stream.stream_id, guest.user_id, guestTok);
    const stranger = await createUser({ congregationId: cong, email: "r8@dev.local" });

    const res = await agent().post("/v1/live/auth").send({
      user: stranger.user_id, password: "totally-made-up", path: `guest/${stream.stream_id}/${guest.user_id}`, action: "read",
    });
    expect(res.status).toBe(401);
  });

  it("denies read using a guest token minted for a DIFFERENT stream", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "r9@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamA = await createChurchStream(adminTok, "Stream A");
    await agent().post(`/v1/live/streams/${streamA.stream_id}/end`).set(auth(adminTok));
    const streamB = await createChurchStream(adminTok, "Stream B");

    const guest = await createUser({ congregationId: cong, email: "r10@dev.local" });
    const guestTok = bearer({ sub: guest.user_id, role: "Student", cong });
    await inviteAndAccept(adminTok, streamB.stream_id, guest.user_id, guestTok);
    const tokenOnB = await guestToken(streamB.stream_id, guest.user_id);

    // Credentials are valid on stream B, but the read is scoped to stream A's path.
    const res = await agent().post("/v1/live/auth").send({
      user: guest.user_id, password: tokenOnB, path: `guest/${streamA.stream_id}/${guest.user_id}`, action: "read",
    });
    expect(res.status).toBe(401);
  });
});

describe("Live L6a — church/cell + non-publish probes stay byte-identical", () => {
  it("still leaves non-publish, non-guest actions open unconditionally", async () => {
    const res = await agent().post("/v1/live/auth").send({ user: "", password: "", path: "church", action: "read" });
    expect(res.status).toBe(200);
  });

  it("still mints+validates church publish exactly as before", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "cc1@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const stream = await createChurchStream(adminTok);
    const ok = await agent().post("/v1/live/auth").send({
      user: stream.stream_id, password: stream.stream_key, path: "church", action: "publish",
    });
    expect(ok.status).toBe(200);
    const row = await testPool().query(`SELECT stream_key_hash FROM live_streams WHERE stream_id = $1`, [stream.stream_id]);
    expect(row.rows[0].stream_key_hash).toBe(sha256(stream.stream_key));
  });
});

describe("Live L6a — GET /v1/live/streams/:id/guests/me/ingest", () => {
  it("returns whip_url + token + path for an accepted guest of a live stream", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "i1@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const stream = await createChurchStream(adminTok);
    const guest = await createUser({ congregationId: cong, email: "i2@dev.local" });
    const guestTok = bearer({ sub: guest.user_id, role: "Student", cong });
    await inviteAndAccept(adminTok, stream.stream_id, guest.user_id, guestTok);
    const token = await guestToken(stream.stream_id, guest.user_id);

    const res = await agent().get(`/v1/live/streams/${stream.stream_id}/guests/me/ingest`).set(auth(guestTok));
    expect(res.status).toBe(200);
    expect(res.body.token).toBe(token);
    expect(res.body.path).toBe(`guest/${stream.stream_id}/${guest.user_id}`);
    expect(res.body.whip_url).toBe(`https://pathway.nuruplace.org/webrtc/guest/${stream.stream_id}/${guest.user_id}/whip`);

    // The token in the ingest response actually authorizes publish via /v1/live/auth.
    const publishOk = await agent().post("/v1/live/auth").send({
      user: guest.user_id, password: res.body.token, path: res.body.path, action: "publish",
    });
    expect(publishOk.status).toBe(200);
  });

  it("403s a caller who was never invited", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "i3@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const stream = await createChurchStream(adminTok);
    const stranger = await createUser({ congregationId: cong, email: "i4@dev.local" });
    const strangerTok = bearer({ sub: stranger.user_id, role: "Student", cong });

    const res = await agent().get(`/v1/live/streams/${stream.stream_id}/guests/me/ingest`).set(auth(strangerTok));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_SCOPE");
  });

  it("403s an invitee who hasn't accepted yet", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "i5@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const stream = await createChurchStream(adminTok);
    const invitee = await createUser({ congregationId: cong, email: "i6@dev.local" });
    const inviteeTok = bearer({ sub: invitee.user_id, role: "Student", cong });
    await agent().post(`/v1/live/streams/${stream.stream_id}/guests/${invitee.user_id}`).set(auth(adminTok));

    const res = await agent().get(`/v1/live/streams/${stream.stream_id}/guests/me/ingest`).set(auth(inviteeTok));
    expect(res.status).toBe(403);
  });

  it("403s an accepted guest once the stream has ended", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "i7@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const stream = await createChurchStream(adminTok);
    const guest = await createUser({ congregationId: cong, email: "i8@dev.local" });
    const guestTok = bearer({ sub: guest.user_id, role: "Student", cong });
    await inviteAndAccept(adminTok, stream.stream_id, guest.user_id, guestTok);
    await agent().post(`/v1/live/streams/${stream.stream_id}/end`).set(auth(adminTok));

    const res = await agent().get(`/v1/live/streams/${stream.stream_id}/guests/me/ingest`).set(auth(guestTok));
    expect(res.status).toBe(403);
  });

  it("404s an unknown stream", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "i9@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const res = await agent().get(`/v1/live/streams/00000000-0000-0000-0000-000000000000/guests/me/ingest`).set(auth(adminTok));
    expect(res.status).toBe(404);
  });

  it("401s without a bearer token", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "i10@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const stream = await createChurchStream(adminTok);
    const res = await agent().get(`/v1/live/streams/${stream.stream_id}/guests/me/ingest`);
    expect(res.status).toBe(401);
  });
});

describe("Live L6a — pulse whep_url (ADDITIVE, owner-only)", () => {
  it("the stream owner's pulse includes whep_url for each accepted guest", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "w1@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const stream = await createChurchStream(adminTok);
    const guest = await createUser({ congregationId: cong, email: "w2@dev.local" });
    const guestTok = bearer({ sub: guest.user_id, role: "Student", cong });
    await inviteAndAccept(adminTok, stream.stream_id, guest.user_id, guestTok);

    const pulse = await agent().get(`/v1/live/streams/${stream.stream_id}/pulse`).set(auth(adminTok));
    expect(pulse.status).toBe(200);
    const guestRow = pulse.body.guests.find((g: { user_id: string }) => g.user_id === guest.user_id);
    expect(guestRow.whep_url).toBe(`https://pathway.nuruplace.org/webrtc/guest/${stream.stream_id}/${guest.user_id}/whep`);
  });

  it("a non-owner caller's pulse has no whep_url field on any guest", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "w3@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const stream = await createChurchStream(adminTok);
    const guest = await createUser({ congregationId: cong, email: "w4@dev.local" });
    const guestTok = bearer({ sub: guest.user_id, role: "Student", cong });
    await inviteAndAccept(adminTok, stream.stream_id, guest.user_id, guestTok);

    // The guest themselves, viewing their own pulse.
    const guestPulse = await agent().get(`/v1/live/streams/${stream.stream_id}/pulse`).set(auth(guestTok));
    expect(guestPulse.status).toBe(200);
    const guestRowFromGuest = guestPulse.body.guests.find((g: { user_id: string }) => g.user_id === guest.user_id);
    expect(guestRowFromGuest.whep_url).toBeUndefined();

    // An uninvolved viewer (church stream is visible to everyone).
    const viewer = await createUser({ congregationId: cong, email: "w5@dev.local" });
    const viewerTok = bearer({ sub: viewer.user_id, role: "Student", cong });
    const viewerPulse = await agent().get(`/v1/live/streams/${stream.stream_id}/pulse`).set(auth(viewerTok));
    expect(viewerPulse.status).toBe(200);
    const guestRowFromViewer = viewerPulse.body.guests.find((g: { user_id: string }) => g.user_id === guest.user_id);
    expect(guestRowFromViewer.whep_url).toBeUndefined();
  });
});
