// Nuru Live L5 interactions (docs/LIVE_INTERACTIVE.md) — reactions, raise-hand,
// live chat, pulse, and the L6 guest-invite scaffolding. Mirrors live.test.ts's
// idioms (embedded Postgres, real Express app via supertest).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser, createCellGroup } from "./helpers/factories.js";

const auth = (t: string) => ({ Authorization: t });

async function createChurchStream(tok: string, title = "Sunday service"): Promise<string> {
  const res = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "church", title, kind: "video" });
  expect(res.status).toBe(201);
  return res.body.stream_id as string;
}

let cong: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
});
afterAll(async () => {
  await closeTestPool();
});

describe("Live interactions — reactions", () => {
  it("appends a reaction (204) and rate-limits a faster-than-1s repeat (429 RATE_LIMITED)", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "r1@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await createChurchStream(tok);

    const first = await agent().post(`/v1/live/streams/${streamId}/reactions`).set(auth(tok)).send({ emoji: "like" });
    expect(first.status).toBe(204);

    const second = await agent().post(`/v1/live/streams/${streamId}/reactions`).set(auth(tok)).send({ emoji: "love" });
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe("RATE_LIMITED");

    const rows = await testPool().query(`SELECT count(*)::int AS n FROM live_stream_reactions WHERE stream_id = $1`, [streamId]);
    expect(rows.rows[0].n).toBe(1);
  });

  it("accepts the fire emoji and reports it in pulse totals", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "fire@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await createChurchStream(tok);

    const res = await agent().post(`/v1/live/streams/${streamId}/reactions`).set(auth(tok)).send({ emoji: "fire" });
    expect(res.status).toBe(204);
    const pulse = await agent().get(`/v1/live/streams/${streamId}/pulse`).set(auth(tok));
    expect(pulse.body.reactions.fire).toBe(1);
  });

  it("401s without a bearer token", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "r2@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await createChurchStream(tok);
    const res = await agent().post(`/v1/live/streams/${streamId}/reactions`).send({ emoji: "like" });
    expect(res.status).toBe(401);
  });

  it("404s an unknown stream", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "r3@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const res = await agent().post(`/v1/live/streams/00000000-0000-0000-0000-000000000000/reactions`).set(auth(tok)).send({ emoji: "like" });
    expect(res.status).toBe(404);
  });

  it("403s a cell stream reaction from a non-member", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "r4@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const cell = await createCellGroup(cong, "Cell A");
    const created = await agent().post("/v1/live/streams").set(auth(adminTok)).send({ scope: "cell", cell_id: cell, title: "Cell", kind: "video" });

    const outsider = await createUser({ congregationId: cong, email: "r5@dev.local" });
    const outsiderTok = bearer({ sub: outsider.user_id, role: "Student", cong });
    const res = await agent().post(`/v1/live/streams/${created.body.stream_id}/reactions`).set(auth(outsiderTok)).send({ emoji: "like" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_SCOPE");
  });

  it("409s once the stream has ended", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "r6@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await createChurchStream(tok);
    await agent().post(`/v1/live/streams/${streamId}/end`).set(auth(tok));
    const res = await agent().post(`/v1/live/streams/${streamId}/reactions`).set(auth(tok)).send({ emoji: "like" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });
});

describe("Live interactions — raise hand", () => {
  it("is idempotent: raising twice leaves exactly one row and pulse shows one raised hand", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "h1@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await createChurchStream(adminTok);
    const viewer = await createUser({ congregationId: cong, email: "h2@dev.local" });
    const viewerTok = bearer({ sub: viewer.user_id, role: "Student", cong });

    const r1 = await agent().post(`/v1/live/streams/${streamId}/hand`).set(auth(viewerTok)).send({ raised: true });
    expect(r1.status).toBe(204);
    const r2 = await agent().post(`/v1/live/streams/${streamId}/hand`).set(auth(viewerTok)).send({ raised: true });
    expect(r2.status).toBe(204);

    const rows = await testPool().query(`SELECT count(*)::int AS n FROM live_stream_hands WHERE stream_id = $1`, [streamId]);
    expect(rows.rows[0].n).toBe(1);

    const pulse = await agent().get(`/v1/live/streams/${streamId}/pulse`).set(auth(adminTok));
    expect(pulse.status).toBe(200);
    expect(pulse.body.hands).toHaveLength(1);
    expect(pulse.body.hands[0].user_id).toBe(viewer.user_id);
    expect(pulse.body.hands[0].full_name).toBeTruthy();
  });

  it("lowering removes the hand from pulse; lowering one never raised is a no-op", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "h3@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await createChurchStream(adminTok);
    const viewer = await createUser({ congregationId: cong, email: "h4@dev.local" });
    const viewerTok = bearer({ sub: viewer.user_id, role: "Student", cong });

    const neverRaised = await agent().post(`/v1/live/streams/${streamId}/hand`).set(auth(viewerTok)).send({ raised: false });
    expect(neverRaised.status).toBe(204);
    let pulse = await agent().get(`/v1/live/streams/${streamId}/pulse`).set(auth(adminTok));
    expect(pulse.body.hands).toHaveLength(0);

    await agent().post(`/v1/live/streams/${streamId}/hand`).set(auth(viewerTok)).send({ raised: true });
    pulse = await agent().get(`/v1/live/streams/${streamId}/pulse`).set(auth(adminTok));
    expect(pulse.body.hands).toHaveLength(1);

    await agent().post(`/v1/live/streams/${streamId}/hand`).set(auth(viewerTok)).send({ raised: false });
    pulse = await agent().get(`/v1/live/streams/${streamId}/pulse`).set(auth(adminTok));
    expect(pulse.body.hands).toHaveLength(0);
  });

  it("409s once the stream has ended", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "h5@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await createChurchStream(tok);
    await agent().post(`/v1/live/streams/${streamId}/end`).set(auth(tok));
    const res = await agent().post(`/v1/live/streams/${streamId}/hand`).set(auth(tok)).send({ raised: true });
    expect(res.status).toBe(409);
  });
});

describe("Live interactions — chat messages", () => {
  it("POSTs a message (201, trimmed) and rejects empty/whitespace-only or over-500 bodies (400)", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "m1@dev.local", fullName: "Broadcaster One" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await createChurchStream(tok);

    const ok = await agent().post(`/v1/live/streams/${streamId}/messages`).set(auth(tok)).send({ body: "  Hello church!  " });
    expect(ok.status).toBe(201);
    expect(ok.body.body).toBe("Hello church!");
    expect(ok.body.user_id).toBe(admin.user_id);
    expect(ok.body.full_name).toBe("Broadcaster One");
    expect(ok.body.message_id).toBeTruthy();
    expect(ok.body.sent_at).toBeTruthy();

    const empty = await agent().post(`/v1/live/streams/${streamId}/messages`).set(auth(tok)).send({ body: "   " });
    expect(empty.status).toBe(400);

    const tooLong = await agent().post(`/v1/live/streams/${streamId}/messages`).set(auth(tok)).send({ body: "x".repeat(501) });
    expect(tooLong.status).toBe(400);

    const exactly500 = await agent().post(`/v1/live/streams/${streamId}/messages`).set(auth(tok)).send({ body: "y".repeat(500) });
    expect(exactly500.status).toBe(201);
  });

  it("GET ?since=<cursor> returns only later messages, ascending", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "m2@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await createChurchStream(tok);

    const first = await agent().post(`/v1/live/streams/${streamId}/messages`).set(auth(tok)).send({ body: "first" });
    const cursor = first.body.sent_at as string;
    const second = await agent().post(`/v1/live/streams/${streamId}/messages`).set(auth(tok)).send({ body: "second" });
    const third = await agent().post(`/v1/live/streams/${streamId}/messages`).set(auth(tok)).send({ body: "third" });

    const all = await agent().get(`/v1/live/streams/${streamId}/messages`).set(auth(tok));
    expect(all.status).toBe(200);
    expect(all.body.messages.map((m: { body: string }) => m.body)).toEqual(["first", "second", "third"]);

    const since = await agent().get(`/v1/live/streams/${streamId}/messages?since=${encodeURIComponent(cursor)}`).set(auth(tok));
    expect(since.status).toBe(200);
    expect(since.body.messages.map((m: { body: string }) => m.body)).toEqual(["second", "third"]);
    expect(since.body.messages.map((m: { message_id: string }) => m.message_id)).toEqual([second.body.message_id, third.body.message_id]);
  });

  it("caps a poll at 200, still ascending", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "m3@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await createChurchStream(tok);

    await testPool().query(
      `INSERT INTO live_stream_messages (stream_id, user_id, body, sent_at)
       SELECT $1, $2, 'msg ' || gs, now() - (interval '1 second' * (205 - gs))
         FROM generate_series(1, 205) AS gs`,
      [streamId, admin.user_id],
    );

    const res = await agent().get(`/v1/live/streams/${streamId}/messages`).set(auth(tok));
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(200);
    expect(res.body.messages[0].body).toBe("msg 6");
    expect(res.body.messages[199].body).toBe("msg 205");
  });

  it("GET is allowed while the stream has ended (grace read); POST is not (409)", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "m4@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await createChurchStream(tok);
    await agent().post(`/v1/live/streams/${streamId}/messages`).set(auth(tok)).send({ body: "before end" });
    await agent().post(`/v1/live/streams/${streamId}/end`).set(auth(tok));

    const getAfterEnd = await agent().get(`/v1/live/streams/${streamId}/messages`).set(auth(tok));
    expect(getAfterEnd.status).toBe(200);
    expect(getAfterEnd.body.messages).toHaveLength(1);

    const postAfterEnd = await agent().post(`/v1/live/streams/${streamId}/messages`).set(auth(tok)).send({ body: "after end" });
    expect(postAfterEnd.status).toBe(409);
  });

  it("403s a cell stream's messages for a non-member (GET and POST)", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "m5@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const cell = await createCellGroup(cong, "Cell A");
    const created = await agent().post("/v1/live/streams").set(auth(adminTok)).send({ scope: "cell", cell_id: cell, title: "Cell", kind: "video" });

    const outsider = await createUser({ congregationId: cong, email: "m6@dev.local" });
    const outsiderTok = bearer({ sub: outsider.user_id, role: "Student", cong });
    const get = await agent().get(`/v1/live/streams/${created.body.stream_id}/messages`).set(auth(outsiderTok));
    expect(get.status).toBe(403);
    const post = await agent().post(`/v1/live/streams/${created.body.stream_id}/messages`).set(auth(outsiderTok)).send({ body: "hi" });
    expect(post.status).toBe(403);
  });
});

describe("Live interactions — pulse", () => {
  it("returns viewer_count, reaction totals + capped recent_reactions, hands, and guests in one snapshot", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "p1@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await createChurchStream(adminTok);

    const viewer = await createUser({ congregationId: cong, email: "p2@dev.local" });
    const viewerTok = bearer({ sub: viewer.user_id, role: "Student", cong });
    await agent().post(`/v1/live/streams/${streamId}/heartbeat`).set(auth(viewerTok));

    // 25 reactions, back-dated so the 1s/user guard doesn't apply, to prove
    // the pulse's recent_reactions really caps at ~20 (newest first).
    await testPool().query(
      `INSERT INTO live_stream_reactions (stream_id, user_id, emoji, occurred_at)
       SELECT $1, $2, CASE WHEN gs % 2 = 0 THEN 'like' ELSE 'love' END, now() - (interval '1 second' * (30 - gs))
         FROM generate_series(1, 25) AS gs`,
      [streamId, viewer.user_id],
    );

    await agent().post(`/v1/live/streams/${streamId}/hand`).set(auth(viewerTok)).send({ raised: true });

    const target = await createUser({ congregationId: cong, email: "p3@dev.local" });
    const inv = await agent().post(`/v1/live/streams/${streamId}/guests/${target.user_id}`).set(auth(adminTok));
    expect(inv.status).toBe(204);

    const pulse = await agent().get(`/v1/live/streams/${streamId}/pulse`).set(auth(adminTok));
    expect(pulse.status).toBe(200);
    expect(pulse.body.viewer_count).toBe(1);
    expect(pulse.body.reactions.like + pulse.body.reactions.love).toBe(25);
    expect(pulse.body.recent_reactions).toHaveLength(20);
    expect(pulse.body.hands).toHaveLength(1);
    expect(pulse.body.guests).toHaveLength(1);
    expect(pulse.body.guests[0]).toMatchObject({ user_id: target.user_id, status: "invited" });
    expect(pulse.body.guests[0].full_name).toBeTruthy();
  });

  it("stays readable (200) as a grace read once the stream has ended", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "p4@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await createChurchStream(tok);
    await agent().post(`/v1/live/streams/${streamId}/end`).set(auth(tok));
    const res = await agent().get(`/v1/live/streams/${streamId}/pulse`).set(auth(tok));
    expect(res.status).toBe(200);
  });
});

describe("Live interactions — guest invite state machine (L6 scaffolding)", () => {
  it("only the broadcaster may invite; a non-owner is refused (403)", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "g1@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await createChurchStream(adminTok);

    const bystander = await createUser({ congregationId: cong, role: "Admin", email: "g2@dev.local" });
    const bystanderTok = bearer({ sub: bystander.user_id, role: "Admin", cong });
    const target = await createUser({ congregationId: cong, email: "g3@dev.local" });

    const res = await agent().post(`/v1/live/streams/${streamId}/guests/${target.user_id}`).set(auth(bystanderTok));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_SCOPE");
  });

  it("the broadcaster cannot invite themselves (400 VALIDATION_FAILED)", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "g4@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await createChurchStream(tok);
    const res = await agent().post(`/v1/live/streams/${streamId}/guests/${admin.user_id}`).set(auth(tok));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("caps active (invited+accepted) guests at 6; the 7th invite 409s; re-inviting an active guest is a no-op that doesn't count against the cap", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "g5@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await createChurchStream(tok);

    const targets: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const t = await createUser({ congregationId: cong, email: `g5-target-${i}@dev.local` });
      targets.push(t.user_id);
      const res = await agent().post(`/v1/live/streams/${streamId}/guests/${t.user_id}`).set(auth(tok));
      expect(res.status).toBe(204);
    }

    // Re-inviting an already-invited guest is idempotent, not a 7th slot.
    const reinvite = await agent().post(`/v1/live/streams/${streamId}/guests/${targets[0]}`).set(auth(tok));
    expect(reinvite.status).toBe(204);

    const seventh = await createUser({ congregationId: cong, email: "g5-target-7@dev.local" });
    const overCap = await agent().post(`/v1/live/streams/${streamId}/guests/${seventh.user_id}`).set(auth(tok));
    expect(overCap.status).toBe(409);
    expect(overCap.body.error.code).toBe("CONFLICT");
  });

  it("invitee can accept or decline; a non-invitee responding 404s", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "g6@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await createChurchStream(tok);
    const invitee = await createUser({ congregationId: cong, email: "g7@dev.local" });
    const inviteeTok = bearer({ sub: invitee.user_id, role: "Student", cong });
    await agent().post(`/v1/live/streams/${streamId}/guests/${invitee.user_id}`).set(auth(tok));

    const stranger = await createUser({ congregationId: cong, email: "g8@dev.local" });
    const strangerTok = bearer({ sub: stranger.user_id, role: "Student", cong });
    const strangerRes = await agent().post(`/v1/live/streams/${streamId}/guests/respond`).set(auth(strangerTok)).send({ accept: true });
    expect(strangerRes.status).toBe(404);

    const accept = await agent().post(`/v1/live/streams/${streamId}/guests/respond`).set(auth(inviteeTok)).send({ accept: true });
    expect(accept.status).toBe(204);
    const row = await testPool().query(`SELECT status FROM live_stream_guests WHERE stream_id = $1 AND user_id = $2`, [streamId, invitee.user_id]);
    expect(row.rows[0].status).toBe("accepted");
  });

  it("the broadcaster can remove a guest; a guest can remove (leave) themselves; a bystander cannot", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "g9@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await createChurchStream(tok);

    const guestA = await createUser({ congregationId: cong, email: "g10@dev.local" });
    const guestATok = bearer({ sub: guestA.user_id, role: "Student", cong });
    await agent().post(`/v1/live/streams/${streamId}/guests/${guestA.user_id}`).set(auth(tok));
    await agent().post(`/v1/live/streams/${streamId}/guests/respond`).set(auth(guestATok)).send({ accept: true });

    const guestB = await createUser({ congregationId: cong, email: "g11@dev.local" });
    await agent().post(`/v1/live/streams/${streamId}/guests/${guestB.user_id}`).set(auth(tok));

    const bystander = await createUser({ congregationId: cong, email: "g12@dev.local" });
    const bystanderTok = bearer({ sub: bystander.user_id, role: "Student", cong });
    const forbidden = await agent().delete(`/v1/live/streams/${streamId}/guests/${guestA.user_id}`).set(auth(bystanderTok));
    expect(forbidden.status).toBe(403);

    const ownerRemoves = await agent().delete(`/v1/live/streams/${streamId}/guests/${guestA.user_id}`).set(auth(tok));
    expect(ownerRemoves.status).toBe(204);
    const rowA = await testPool().query(`SELECT status FROM live_stream_guests WHERE stream_id = $1 AND user_id = $2`, [streamId, guestA.user_id]);
    expect(rowA.rows[0].status).toBe("removed");

    const selfLeaves = await agent().delete(`/v1/live/streams/${streamId}/guests/${guestB.user_id}`).set(auth(bearer({ sub: guestB.user_id, role: "Student", cong })));
    expect(selfLeaves.status).toBe(204);
    const rowB = await testPool().query(`SELECT status FROM live_stream_guests WHERE stream_id = $1 AND user_id = $2`, [streamId, guestB.user_id]);
    expect(rowB.rows[0].status).toBe("removed");
  });

  it("stream end sweeps every active (invited/accepted) guest row to 'ended'", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "g13@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await createChurchStream(tok);

    const accepted = await createUser({ congregationId: cong, email: "g14@dev.local" });
    const acceptedTok = bearer({ sub: accepted.user_id, role: "Student", cong });
    await agent().post(`/v1/live/streams/${streamId}/guests/${accepted.user_id}`).set(auth(tok));
    await agent().post(`/v1/live/streams/${streamId}/guests/respond`).set(auth(acceptedTok)).send({ accept: true });

    const stillInvited = await createUser({ congregationId: cong, email: "g15@dev.local" });
    await agent().post(`/v1/live/streams/${streamId}/guests/${stillInvited.user_id}`).set(auth(tok));

    const declined = await createUser({ congregationId: cong, email: "g16@dev.local" });
    const declinedTok = bearer({ sub: declined.user_id, role: "Student", cong });
    await agent().post(`/v1/live/streams/${streamId}/guests/${declined.user_id}`).set(auth(tok));
    await agent().post(`/v1/live/streams/${streamId}/guests/respond`).set(auth(declinedTok)).send({ accept: false });

    await agent().post(`/v1/live/streams/${streamId}/end`).set(auth(tok));

    const rows = await testPool().query<{ user_id: string; status: string }>(
      `SELECT user_id, status FROM live_stream_guests WHERE stream_id = $1 ORDER BY invited_at`,
      [streamId],
    );
    const byUser = Object.fromEntries(rows.rows.map((r) => [r.user_id, r.status]));
    expect(byUser[accepted.user_id]).toBe("ended");
    expect(byUser[stillInvited.user_id]).toBe("ended");
    expect(byUser[declined.user_id]).toBe("declined"); // already terminal — the sweep leaves it alone

    // Guest actions reject once the stream has ended too.
    const postEndInvite = await agent().post(`/v1/live/streams/${streamId}/guests/${stillInvited.user_id}`).set(auth(tok));
    expect(postEndInvite.status).toBe(409);
  });

  it("fires the live_guest_invite notification to the invitee", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "g17@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await createChurchStream(tok);
    const target = await createUser({ congregationId: cong, email: "g18@dev.local" });

    const res = await agent().post(`/v1/live/streams/${streamId}/guests/${target.user_id}`).set(auth(tok));
    expect(res.status).toBe(204);

    const row = await testPool().query(
      `SELECT template FROM notifications WHERE user_id = $1 AND template = 'live_guest_invite'`,
      [target.user_id],
    );
    expect(row.rows).toHaveLength(1);
  });

  it("401s guest endpoints without a bearer token", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "g19@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await createChurchStream(tok);
    const target = await createUser({ congregationId: cong, email: "g20@dev.local" });
    const res = await agent().post(`/v1/live/streams/${streamId}/guests/${target.user_id}`);
    expect(res.status).toBe(401);
  });
});

describe("CreateStream tolerance — Android kotlinx body", () => {
  it("accepts an explicit cell_id: null for a church stream (kotlinx encodeDefaults)", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "kx@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const res = await agent().post("/v1/live/streams").set(auth(tok))
      .send({ scope: "church", cell_id: null, title: "test 12", kind: "video" });
    expect(res.status).toBe(201);
  });
});
