// Production incident (owner hit this on real devices 2026-07-31): a
// live_streams row can sit status='live' for hours with ZERO RTMP publishers
// connected once a broadcaster's app/network dies abnormally, and the
// one-live-per-scope partial unique index then 409s every attempt to go live
// again until the old 12h orphan fallback finally clears it.
//
// This file covers the fix: (1) the worker sweep's new publisher-liveness
// pass, which asks MediaMTX's HTTP control API whether a stream's path has an
// actual connected publisher and auto-ends it once none has been observed for
// PUBLISHER_GRACE_MS (90s) — long enough to survive a broadcaster's own
// RTMP reconnect/backoff (3 attempts over ~17s) without getting killed
// mid-recovery; and (2) createStream's owner self-recovery, which lets the
// SAME caller (or a live:manage holder) retrying "go live" clear a confirmed-
// dead stream instead of just 409ing.
//
// MediaMTX itself is never actually reached in tests — every case stubs
// globalThis.fetch, mirroring the existing IcecastStreamProvider.health()
// tests in radio.test.ts.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser, createCellGroup, createLeaderAssignment } from "./helpers/factories.js";
import { LiveService } from "../src/modules/live/service.js";

const auth = (t: string) => ({ Authorization: t });

async function grantRole(userId: string, roleKey: string): Promise<void> {
  await testPool().query(`INSERT INTO rbac_user_roles (user_id, role_key) VALUES ($1, $2)`, [userId, roleKey]);
}

/** A MediaMTX /v3/paths/list response body for a set of named paths. */
function mtxBody(items: Array<{ name: string; ready: boolean; source: unknown }>) {
  return { itemCount: items.length, pageCount: 1, items };
}

/** Stub globalThis.fetch for the duration of a test; always restores after. */
function stubFetch(impl: () => Response | Promise<Response>): () => void {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => impl()) as typeof fetch;
  return () => {
    globalThis.fetch = orig;
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let cong: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
});
afterAll(async () => {
  await closeTestPool();
});

describe("Live streaming — worker sweep publisher-liveness pass", () => {
  async function insertLiveChurchStream(startedById: string): Promise<string> {
    const { rows } = await testPool().query<{ stream_id: string }>(
      `INSERT INTO live_streams (scope, started_by, title, kind, stream_key_hash, started_at)
       VALUES ('church', $1, 'Live', 'video', 'deadbeef', now())
       RETURNING stream_id`,
      [startedById],
    );
    return rows[0]!.stream_id;
  }

  it("leaves a publisher-less stream alone within the grace window (protects a broadcaster still connecting/reconnecting)", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "grace1@dev.local" });
    const streamId = await insertLiveChurchStream(admin.user_id);
    const restore = stubFetch(() => jsonResponse(mtxBody([{ name: "church", ready: false, source: null }])));
    try {
      const svc = new LiveService(testPool());
      const t0 = new Date();
      await svc.sweep(t0); // first observation — starts the grace clock, must not end yet
      await svc.sweep(new Date(t0.getTime() + 30_000)); // 30s later — still within the 90s grace
      const row = await testPool().query(`SELECT status FROM live_streams WHERE stream_id = $1`, [streamId]);
      expect(row.rows[0].status).toBe("live");
    } finally {
      restore();
    }
  });

  it("auto-ends a stream once no publisher has been observed for past the grace window", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "grace2@dev.local" });
    const streamId = await insertLiveChurchStream(admin.user_id);
    const restore = stubFetch(() => jsonResponse(mtxBody([{ name: "church", ready: false, source: null }])));
    try {
      const svc = new LiveService(testPool());
      const t0 = new Date();
      await svc.sweep(t0); // starts the clock
      const result = await svc.sweep(new Date(t0.getTime() + 91_000)); // past the 90s grace
      expect(result.auto_ended).toBe(1);
      const row = await testPool().query(`SELECT status, ended_at FROM live_streams WHERE stream_id = $1`, [streamId]);
      expect(row.rows[0].status).toBe("ended");
      expect(row.rows[0].ended_at).not.toBeNull();
      const auditRow = await testPool().query(
        `SELECT action, metadata FROM audit_log WHERE entity_id = $1 AND action = 'live.stream_auto_ended'`,
        [streamId],
      );
      expect(auditRow.rows).toHaveLength(1);
      expect(auditRow.rows[0].metadata).toMatchObject({ reason: "publisher_gone" });
    } finally {
      restore();
    }
  });

  it("leaves a stream alone when MediaMTX reports a publisher IS connected, however long it's been checked", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "grace3@dev.local" });
    const streamId = await insertLiveChurchStream(admin.user_id);
    const restore = stubFetch(() =>
      jsonResponse(mtxBody([{ name: "church", ready: true, source: { type: "rtmpConn" } }])),
    );
    try {
      const svc = new LiveService(testPool());
      const t0 = new Date();
      await svc.sweep(t0);
      await svc.sweep(new Date(t0.getTime() + 5 * 60_000)); // well past any grace window
      const row = await testPool().query(`SELECT status FROM live_streams WHERE stream_id = $1`, [streamId]);
      expect(row.rows[0].status).toBe("live");
    } finally {
      restore();
    }
  });

  it("does nothing when the MediaMTX API call fails — never mass-ends live broadcasts on a control-plane outage", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "grace4@dev.local" });
    const streamId = await insertLiveChurchStream(admin.user_id);
    const restore = stubFetch(() => {
      throw new Error("connection refused");
    });
    try {
      const svc = new LiveService(testPool());
      const t0 = new Date();
      await svc.sweep(t0);
      const result = await svc.sweep(new Date(t0.getTime() + 5 * 60_000));
      expect(result.auto_ended).toBe(0);
      const row = await testPool().query(`SELECT status FROM live_streams WHERE stream_id = $1`, [streamId]);
      expect(row.rows[0].status).toBe("live");
    } finally {
      restore();
    }
  });

  it("a broadcaster whose RTMP drops and reconnects within the grace window is NOT ended out from under them", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "grace5@dev.local" });
    const streamId = await insertLiveChurchStream(admin.user_id);
    let ready = false;
    const restore = stubFetch(() =>
      jsonResponse(mtxBody([{ name: "church", ready, source: ready ? { type: "rtmpConn" } : null }])),
    );
    try {
      const svc = new LiveService(testPool());
      const t0 = new Date();

      // Drops at t0 — sweep observes no publisher, starts the grace clock.
      await svc.sweep(t0);
      // Reconnects well within grace (the app's own 3-attempt/~17s backoff).
      ready = true;
      await svc.sweep(new Date(t0.getTime() + 10_000));
      let row = await testPool().query(`SELECT status FROM live_streams WHERE stream_id = $1`, [streamId]);
      expect(row.rows[0].status).toBe("live");

      // A LATER, independent drop — must start its OWN fresh clock, not
      // inherit the first drop's already-elapsed time.
      ready = false;
      await svc.sweep(new Date(t0.getTime() + 160_000)); // first observation of THIS drop
      row = await testPool().query(`SELECT status FROM live_streams WHERE stream_id = $1`, [streamId]);
      expect(row.rows[0].status).toBe("live"); // not ended — clock just (re)started

      await svc.sweep(new Date(t0.getTime() + 160_000 + 91_000)); // past grace on the NEW clock
      row = await testPool().query(`SELECT status FROM live_streams WHERE stream_id = $1`, [streamId]);
      expect(row.rows[0].status).toBe("ended");
    } finally {
      restore();
    }
  });

  it("still auto-ends via the 12h absolute fallback when MediaMTX stays unreachable indefinitely", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "grace6@dev.local" });
    const { rows } = await testPool().query<{ stream_id: string }>(
      `INSERT INTO live_streams (scope, started_by, title, kind, stream_key_hash, started_at)
       VALUES ('church', $1, 'Long orphan', 'video', 'deadbeef', now() - interval '13 hours')
       RETURNING stream_id`,
      [admin.user_id],
    );
    const restore = stubFetch(() => {
      throw new Error("connection refused");
    });
    try {
      const svc = new LiveService(testPool());
      const result = await svc.sweep();
      expect(result.auto_ended).toBe(1); // caught by the 12h fallback, not the publisher-liveness pass
      const row = await testPool().query(`SELECT status FROM live_streams WHERE stream_id = $1`, [rows[0]!.stream_id]);
      expect(row.rows[0].status).toBe("ended");
    } finally {
      restore();
    }
  });
});

describe("Live streaming — createStream owner self-recovery on 409 conflict", () => {
  it("auto-recovers the caller's own dead stream: ends the stale one and mints the new one instead of 409ing", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "recover1@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const first = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "church", title: "First", kind: "video" });
    expect(first.status).toBe(201);

    const restore = stubFetch(() => jsonResponse(mtxBody([{ name: "church", ready: false, source: null }])));
    try {
      const second = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "church", title: "Second", kind: "video" });
      expect(second.status).toBe(201);
      expect(second.body.stream_id).not.toBe(first.body.stream_id);

      const oldRow = await testPool().query(`SELECT status, ended_at FROM live_streams WHERE stream_id = $1`, [first.body.stream_id]);
      expect(oldRow.rows[0].status).toBe("ended");
      expect(oldRow.rows[0].ended_at).not.toBeNull();

      const newRow = await testPool().query(`SELECT status FROM live_streams WHERE stream_id = $1`, [second.body.stream_id]);
      expect(newRow.rows[0].status).toBe("live");

      const auditRow = await testPool().query(
        `SELECT metadata FROM audit_log WHERE entity_id = $1 AND action = 'live.stream_auto_ended'`,
        [first.body.stream_id],
      );
      expect(auditRow.rows).toHaveLength(1);
      expect(auditRow.rows[0].metadata).toMatchObject({ reason: "publisher_gone", trigger: "create_conflict" });
    } finally {
      restore();
    }
  });

  it("still 409s when a real publisher is live — actionable details naming it's the caller's own stream", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "recover2@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const first = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "church", title: "First", kind: "video" });
    expect(first.status).toBe(201);

    const restore = stubFetch(() => jsonResponse(mtxBody([{ name: "church", ready: true, source: { type: "rtmpConn" } }])));
    try {
      const second = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "church", title: "Second", kind: "video" });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe("CONFLICT");
      expect(second.body.error.details).toMatchObject({ reason: "publisher_connected", stream_id: first.body.stream_id });

      const row = await testPool().query(`SELECT status FROM live_streams WHERE stream_id = $1`, [first.body.stream_id]);
      expect(row.rows[0].status).toBe("live"); // untouched
    } finally {
      restore();
    }
  });

  it("MediaMTX being unreachable during the conflict check keeps the 409 — never guesses the old stream is dead", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "recover3@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const first = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "church", title: "First", kind: "video" });

    const restore = stubFetch(() => {
      throw new Error("connection refused");
    });
    try {
      const second = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "church", title: "Second", kind: "video" });
      expect(second.status).toBe(409);
      const row = await testPool().query(`SELECT status FROM live_streams WHERE stream_id = $1`, [first.body.stream_id]);
      expect(row.rows[0].status).toBe("live");
    } finally {
      restore();
    }
  });

  it("a non-owner without live:manage still gets a plain 409 — no self-recovery, even though MediaMTX shows no publisher", async () => {
    const owner = await createUser({ congregationId: cong, role: "Admin", email: "recover4@dev.local" });
    const ownerTok = bearer({ sub: owner.user_id, role: "Admin", cong });
    const first = await agent().post("/v1/live/streams").set(auth(ownerTok)).send({ scope: "church", title: "First", kind: "video" });

    const stranger = await createUser({ congregationId: cong, role: "Instructor", email: "recover5@dev.local" });
    await grantRole(stranger.user_id, "events_coordinator"); // live:go only, not manage, not the owner
    const strangerTok = bearer({ sub: stranger.user_id, role: "Instructor", cong });

    const restore = stubFetch(() => jsonResponse(mtxBody([{ name: "church", ready: false, source: null }])));
    try {
      const res = await agent().post("/v1/live/streams").set(auth(strangerTok)).send({ scope: "church", title: "Interloper", kind: "video" });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONFLICT");
      expect(res.body.error.details).toBeUndefined(); // plain 409, unchanged from before this feature

      const row = await testPool().query(`SELECT status FROM live_streams WHERE stream_id = $1`, [first.body.stream_id]);
      expect(row.rows[0].status).toBe("live"); // the stranger never got to touch it
    } finally {
      restore();
    }
  });

  it("a live:manage holder can also self-recover someone else's dead stream, not just the original owner", async () => {
    const owner = await createUser({ congregationId: cong, role: "Instructor", email: "recover6@dev.local" });
    await grantRole(owner.user_id, "events_coordinator"); // church-scope go, staff-tier
    const ownerTok = bearer({ sub: owner.user_id, role: "Instructor", cong });
    const first = await agent().post("/v1/live/streams").set(auth(ownerTok)).send({ scope: "church", title: "Owner's stream", kind: "video" });
    expect(first.status).toBe(201);

    const overseer = await createUser({ congregationId: cong, role: "Instructor", email: "recover7@dev.local" });
    await grantRole(overseer.user_id, "national_director"); // live:go AND live:manage
    const overseerTok = bearer({ sub: overseer.user_id, role: "Instructor", cong });

    const restore = stubFetch(() => jsonResponse(mtxBody([{ name: "church", ready: false, source: null }])));
    try {
      const second = await agent().post("/v1/live/streams").set(auth(overseerTok)).send({ scope: "church", title: "Overseer takes over", kind: "video" });
      expect(second.status).toBe(201);

      const oldRow = await testPool().query(`SELECT status FROM live_streams WHERE stream_id = $1`, [first.body.stream_id]);
      expect(oldRow.rows[0].status).toBe("ended");
    } finally {
      restore();
    }
  });

  it("cell scope: auto-recovery only touches the SAME cell's stale stream, not a different cell's live one", async () => {
    const cellA = await createCellGroup(cong, "Cell A");
    const cellB = await createCellGroup(cong, "Cell B");
    const leader = await createUser({ congregationId: cong, email: "recover8@dev.local" });
    await grantRole(leader.user_id, "discipler");
    await createLeaderAssignment(leader.user_id, cellA);
    await createLeaderAssignment(leader.user_id, cellB);
    const tok = bearer({ sub: leader.user_id, role: "Student", cong });

    const a = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "cell", cell_id: cellA, title: "Cell A live", kind: "video" });
    const b = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "cell", cell_id: cellB, title: "Cell B live", kind: "video" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const restore = stubFetch(() =>
      jsonResponse(mtxBody([{ name: `cell/${cellA}`, ready: false, source: null }])), // only cellA's publisher is gone
    );
    try {
      const retryA = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "cell", cell_id: cellA, title: "Cell A retry", kind: "video" });
      expect(retryA.status).toBe(201); // recovered

      const bRow = await testPool().query(`SELECT status FROM live_streams WHERE stream_id = $1`, [b.body.stream_id]);
      expect(bRow.rows[0].status).toBe("live"); // untouched — different cell's path was never even queried for A's retry
    } finally {
      restore();
    }
  });
});
