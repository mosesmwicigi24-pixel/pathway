// Nuru Live L1 (docs/LIVE_STREAMING.md) — backend module. L0 infra (MediaMTX)
// is out of scope here; these tests exercise the backend's half: RBAC + §5.4
// scoping on stream creation, the MediaMTX authHTTP webhook, one-live-per-path,
// /live/now visibility, end + the auto-end/recording sweep, and viewer
// heartbeat → viewer_peak.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser, createCellGroup, createLeaderAssignment } from "./helpers/factories.js";
import { LiveService } from "../src/modules/live/service.js";
import { matchRecordingFile } from "../src/modules/live/recordings.js";

const auth = (t: string) => ({ Authorization: t });
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function grantRole(userId: string, roleKey: string): Promise<void> {
  await testPool().query(`INSERT INTO rbac_user_roles (user_id, role_key) VALUES ($1, $2)`, [userId, roleKey]);
}

let cong: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
});
afterAll(async () => {
  await closeTestPool();
});

describe("Live streaming — permission gate (live:go)", () => {
  it("a member with no grant is refused (403 FORBIDDEN_SCOPE)", async () => {
    const u = await createUser({ congregationId: cong, email: "nogrant@dev.local" });
    const tok = bearer({ sub: u.user_id, role: "Student", cong });
    const res = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "church", title: "Sunday", kind: "video" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_SCOPE");
  });

  it("a cell leader (discipler grant, plain Student coarse role) can go live for their own cell, but not church-wide", async () => {
    const cell = await createCellGroup(cong, "Cell A");
    const otherCell = await createCellGroup(cong, "Cell B");
    const leader = await createUser({ congregationId: cong, email: "leader@dev.local" }); // role: Student
    await grantRole(leader.user_id, "discipler"); // live:go, field-tier — not staff
    await createLeaderAssignment(leader.user_id, cell);
    const tok = bearer({ sub: leader.user_id, role: "Student", cong });

    const ok = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "cell", cell_id: cell, title: "Cell service", kind: "video" });
    expect(ok.status).toBe(201);
    expect(ok.body.path).toBe(`cell/${cell}`);

    // Not assigned to otherCell → refused even though they hold live:go.
    const wrongCell = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "cell", cell_id: otherCell, title: "Not mine", kind: "video" });
    expect(wrongCell.status).toBe(403);
    expect(wrongCell.body.error.code).toBe("FORBIDDEN_SCOPE");

    // Church-wide requires the "unscoped" (staff) grant — a field-tier discipler lacks it.
    const church = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "church", title: "Sunday service", kind: "video" });
    expect(church.status).toBe(403);
    expect(church.body.error.code).toBe("FORBIDDEN_SCOPE");
  });

  it("a staff-tier holder (events_coordinator grant, Instructor coarse role) CAN go church-wide", async () => {
    const staff = await createUser({ congregationId: cong, role: "Instructor", email: "staff@dev.local" });
    await grantRole(staff.user_id, "events_coordinator");
    const tok = bearer({ sub: staff.user_id, role: "Instructor", cong });
    const res = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "church", title: "Sunday service", kind: "video" });
    expect(res.status).toBe(201);
    expect(res.body.path).toBe("church");
  });
});

describe("Live streaming — stream creation + MediaMTX authHTTP webhook", () => {
  it("mints a stream_id + rtmp_url + stream_key whose sha256 the webhook accepts for publish", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "admin@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const res = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "church", title: "Sunday service", kind: "video" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ path: "church" });
    expect(res.body.rtmp_url).toContain("rtmp://");
    expect(res.body.stream_key).toMatch(/^[0-9a-f]{32}$/);

    const row = await testPool().query(`SELECT stream_key_hash FROM live_streams WHERE stream_id = $1`, [res.body.stream_id]);
    expect(row.rows[0].stream_key_hash).toBe(sha256(res.body.stream_key));

    const ok = await agent().post("/v1/live/auth").send({
      user: res.body.stream_id, password: res.body.stream_key, path: "church", action: "publish",
    });
    expect(ok.status).toBe(200);
  });

  it("rejects publish with the wrong password", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "admin2@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const res = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "church", title: "Sunday service", kind: "video" });
    const bad = await agent().post("/v1/live/auth").send({ user: res.body.stream_id, password: "wrong-key", path: "church", action: "publish" });
    expect(bad.status).toBe(401);
  });

  it("rejects publish to the wrong path (a key never authorizes a path other than its own stream's)", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "admin3@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const res = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "church", title: "Sunday service", kind: "video" });
    const wrongPath = await agent().post("/v1/live/auth").send({
      user: res.body.stream_id, password: res.body.stream_key, path: "cell/00000000-0000-0000-0000-000000000000", action: "publish",
    });
    expect(wrongPath.status).toBe(401);
  });

  it("rejects publish once the stream has ended", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "admin4@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const created = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "church", title: "Sunday service", kind: "video" });
    await agent().post(`/v1/live/streams/${created.body.stream_id}/end`).set(auth(tok));
    const res = await agent().post("/v1/live/auth").send({
      user: created.body.stream_id, password: created.body.stream_key, path: "church", action: "publish",
    });
    expect(res.status).toBe(401);
  });

  it("leaves non-publish actions (read/playback) open unconditionally", async () => {
    const res = await agent().post("/v1/live/auth").send({ user: "00000000-0000-0000-0000-000000000000", password: "x", path: "church", action: "read" });
    expect(res.status).toBe(200);
  });

  it("401s a malformed/unknown stream_id on publish rather than throwing", async () => {
    const res = await agent().post("/v1/live/auth").send({ user: "not-a-uuid", password: "x", path: "church", action: "publish" });
    expect(res.status).toBe(401);
  });
});

describe("Live streaming — one live per scope target", () => {
  it("refuses a second concurrent church stream (409 CONFLICT)", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "a1@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const first = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "church", title: "First", kind: "video" });
    expect(first.status).toBe(201);
    const second = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "church", title: "Second", kind: "video" });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("CONFLICT");
  });

  it("refuses a second concurrent stream for the SAME cell, but allows a DIFFERENT cell", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "a2@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const cellA = await createCellGroup(cong, "Cell A");
    const cellB = await createCellGroup(cong, "Cell B");

    const first = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "cell", cell_id: cellA, title: "A live", kind: "video" });
    expect(first.status).toBe(201);
    const dup = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "cell", cell_id: cellA, title: "A live again", kind: "video" });
    expect(dup.status).toBe(409);
    const other = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "cell", cell_id: cellB, title: "B live", kind: "video" });
    expect(other.status).toBe(201);
  });

  it("a NEW stream is allowed once the previous one has ended", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "a3@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const first = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "church", title: "First", kind: "video" });
    await agent().post(`/v1/live/streams/${first.body.stream_id}/end`).set(auth(tok));
    const second = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "church", title: "Second", kind: "video" });
    expect(second.status).toBe(201);
  });
});

describe("Live streaming — /live/now visibility", () => {
  it("shows church streams to everyone; hides a cell stream from a non-member; shows it to a member", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "b1@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const cell = await createCellGroup(cong, "Cell A");
    await agent().post("/v1/live/streams").set(auth(adminTok)).send({ scope: "church", title: "Sunday", kind: "video" });
    await agent().post("/v1/live/streams").set(auth(adminTok)).send({ scope: "cell", cell_id: cell, title: "Cell meeting", kind: "video" });

    const outsider = await createUser({ congregationId: cong, email: "outsider@dev.local" });
    const outsiderTok = bearer({ sub: outsider.user_id, role: "Student", cong });
    const outsiderNow = await agent().get("/v1/live/now").set(auth(outsiderTok));
    expect(outsiderNow.status).toBe(200);
    const outsiderScopes = outsiderNow.body.data.map((s: { scope: string }) => s.scope);
    expect(outsiderScopes).toEqual(["church"]);

    const member = await createUser({ congregationId: cong, cellGroupId: cell, email: "member@dev.local" });
    const memberTok = bearer({ sub: member.user_id, role: "Student", cong });
    const memberNow = await agent().get("/v1/live/now").set(auth(memberTok));
    const memberScopes = memberNow.body.data.map((s: { scope: string }) => s.scope).sort();
    expect(memberScopes).toEqual(["cell", "church"]);

    const cellRow = memberNow.body.data.find((s: { scope: string }) => s.scope === "cell");
    expect(cellRow.hls_url).toBe(`/live/cell/${cell}/index.m3u8`);
    expect(cellRow.started_by_name).toBeTruthy();
    expect(cellRow.viewer_count).toBe(0);
  });
});

describe("Live streaming — L1.5 CDN switch (LIVE_CDN_BASE)", () => {
  it("without LIVE_CDN_BASE, church and cell rows both keep the direct relative hls_url and carry no hls_fallback_url", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "cdn-off-1@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const cell = await createCellGroup(cong, "Cell A");
    await agent().post("/v1/live/streams").set(auth(adminTok)).send({ scope: "church", title: "Sunday", kind: "video" });
    await agent().post("/v1/live/streams").set(auth(adminTok)).send({ scope: "cell", cell_id: cell, title: "Cell meeting", kind: "video" });

    const now = await agent().get("/v1/live/now").set(auth(adminTok));
    expect(now.status).toBe(200);
    const church = now.body.data.find((s: { scope: string }) => s.scope === "church");
    const cellRow = now.body.data.find((s: { scope: string }) => s.scope === "cell");
    expect(church.hls_url).toBe("/live/church/index.m3u8");
    expect(church.hls_fallback_url).toBeUndefined();
    expect(cellRow.hls_url).toBe(`/live/cell/${cell}/index.m3u8`);
    expect(cellRow.hls_fallback_url).toBeUndefined();
  });

  it("with LIVE_CDN_BASE set, the church row gets an absolute CDN hls_url + a direct hls_fallback_url; the cell row is unaffected", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "cdn-on-1@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const cell = await createCellGroup(cong, "Cell A");
    const cdnBase = "https://pub-example.r2.dev";
    const overrides = { LIVE_CDN_BASE: cdnBase };

    await agent(overrides).post("/v1/live/streams").set(auth(adminTok)).send({ scope: "church", title: "Sunday", kind: "video" });
    await agent(overrides).post("/v1/live/streams").set(auth(adminTok)).send({ scope: "cell", cell_id: cell, title: "Cell meeting", kind: "video" });

    const now = await agent(overrides).get("/v1/live/now").set(auth(adminTok));
    expect(now.status).toBe(200);
    const church = now.body.data.find((s: { scope: string }) => s.scope === "church");
    const cellRow = now.body.data.find((s: { scope: string }) => s.scope === "cell");

    expect(church.hls_url).toBe(`${cdnBase}/live-cdn/church/index.m3u8`);
    expect(church.hls_fallback_url).toBe("/live/church/index.m3u8");

    // Cell scope always keeps the direct relative URL, CDN base or not.
    expect(cellRow.hls_url).toBe(`/live/cell/${cell}/index.m3u8`);
    expect(cellRow.hls_fallback_url).toBeUndefined();
  });
});

describe("Live streaming — L1.5b per-stream CDN paths (LIVE_CDN_PER_STREAM, docs/LIVE_CDN_PERSTREAM.md)", () => {
  it("LIVE_CDN_BASE set but LIVE_CDN_PER_STREAM off (the default): church hls_url stays the legacy static path", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "cdnps-off@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const cdnBase = "https://pub-example.r2.dev";
    const created = await agent({ LIVE_CDN_BASE: cdnBase }).post("/v1/live/streams").set(auth(adminTok)).send({ scope: "church", title: "Sunday", kind: "video" });

    const now = await agent({ LIVE_CDN_BASE: cdnBase }).get("/v1/live/now").set(auth(adminTok));
    const church = now.body.data.find((s: { scope: string }) => s.scope === "church");
    expect(church.hls_url).toBe(`${cdnBase}/live-cdn/church/index.m3u8`);
    expect(church.hls_url).not.toContain(created.body.stream_id);
  });

  it("LIVE_CDN_BASE + LIVE_CDN_PER_STREAM=true: church hls_url is scoped by stream_id; fallback and cell rows unaffected", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "cdnps-on@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const cell = await createCellGroup(cong, "Cell A");
    const cdnBase = "https://pub-example.r2.dev";
    const overrides = { LIVE_CDN_BASE: cdnBase, LIVE_CDN_PER_STREAM: true };

    const created = await agent(overrides).post("/v1/live/streams").set(auth(adminTok)).send({ scope: "church", title: "Sunday", kind: "video" });
    await agent(overrides).post("/v1/live/streams").set(auth(adminTok)).send({ scope: "cell", cell_id: cell, title: "Cell meeting", kind: "video" });

    const now = await agent(overrides).get("/v1/live/now").set(auth(adminTok));
    const church = now.body.data.find((s: { scope: string }) => s.scope === "church");
    const cellRow = now.body.data.find((s: { scope: string }) => s.scope === "cell");

    expect(church.hls_url).toBe(`${cdnBase}/live-cdn/church/${created.body.stream_id}/index.m3u8`);
    expect(church.hls_fallback_url).toBe("/live/church/index.m3u8"); // fallback untouched by the flag

    expect(cellRow.hls_url).toBe(`/live/cell/${cell}/index.m3u8`);
    expect(cellRow.hls_fallback_url).toBeUndefined();
  });

  it("a SECOND church broadcast gets a DIFFERENT per-stream path than the first (the actual flicker fix)", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "cdnps-two@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const overrides = { LIVE_CDN_BASE: "https://pub-example.r2.dev", LIVE_CDN_PER_STREAM: true };

    const first = await agent(overrides).post("/v1/live/streams").set(auth(adminTok)).send({ scope: "church", title: "First", kind: "video" });
    const now1 = await agent(overrides).get("/v1/live/now").set(auth(adminTok));
    const firstUrl = now1.body.data.find((s: { scope: string }) => s.scope === "church").hls_url;
    expect(firstUrl).toContain(first.body.stream_id);

    await agent(overrides).post(`/v1/live/streams/${first.body.stream_id}/end`).set(auth(adminTok));
    const second = await agent(overrides).post("/v1/live/streams").set(auth(adminTok)).send({ scope: "church", title: "Second", kind: "video" });
    const now2 = await agent(overrides).get("/v1/live/now").set(auth(adminTok));
    const secondUrl = now2.body.data.find((s: { scope: string }) => s.scope === "church").hls_url;
    expect(secondUrl).toContain(second.body.stream_id);
    expect(secondUrl).not.toBe(firstUrl);
  });
});

describe("Live streaming — GET /live/church/current (unauthenticated, VPS-daemon-only)", () => {
  it("returns null when no church stream is live", async () => {
    const res = await agent().get("/v1/live/church/current"); // no Authorization header at all
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ stream_id: null });
  });

  it("returns the live church stream's id once one is live, and null again after it ends", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "current-1@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const created = await agent().post("/v1/live/streams").set(auth(adminTok)).send({ scope: "church", title: "Sunday", kind: "video" });

    const live = await agent().get("/v1/live/church/current");
    expect(live.body).toEqual({ stream_id: created.body.stream_id });

    await agent().post(`/v1/live/streams/${created.body.stream_id}/end`).set(auth(adminTok));
    const ended = await agent().get("/v1/live/church/current");
    expect(ended.body).toEqual({ stream_id: null });
  });

  it("ignores a live CELL stream — only reports church", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "current-2@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const cell = await createCellGroup(cong, "Cell A");
    await agent().post("/v1/live/streams").set(auth(adminTok)).send({ scope: "cell", cell_id: cell, title: "Cell", kind: "video" });

    const res = await agent().get("/v1/live/church/current");
    expect(res.body).toEqual({ stream_id: null });
  });
});

describe("Live streaming — end", () => {
  it("the broadcaster can end their own stream; replay is idempotent", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "c1@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const created = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "church", title: "Sunday", kind: "video" });
    const end1 = await agent().post(`/v1/live/streams/${created.body.stream_id}/end`).set(auth(tok));
    expect(end1.status).toBe(200);
    expect(end1.body.status).toBe("ended");
    const end2 = await agent().post(`/v1/live/streams/${created.body.stream_id}/end`).set(auth(tok));
    expect(end2.status).toBe(200);
    expect(end2.body.status).toBe("ended");
  });

  it("a bystander without live:manage cannot end someone else's stream", async () => {
    const staff = await createUser({ congregationId: cong, role: "Instructor", email: "c2@dev.local" });
    await grantRole(staff.user_id, "events_coordinator"); // go only, not manage
    const tok = bearer({ sub: staff.user_id, role: "Instructor", cong });
    const created = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "church", title: "Sunday", kind: "video" });

    const bystander = await createUser({ congregationId: cong, role: "Instructor", email: "c3@dev.local" });
    await grantRole(bystander.user_id, "events_coordinator");
    const byTok = bearer({ sub: bystander.user_id, role: "Instructor", cong });
    const res = await agent().post(`/v1/live/streams/${created.body.stream_id}/end`).set(auth(byTok));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_SCOPE");
  });

  it("a live:manage holder can end someone else's stream", async () => {
    const staff = await createUser({ congregationId: cong, role: "Instructor", email: "c4@dev.local" });
    await grantRole(staff.user_id, "events_coordinator");
    const tok = bearer({ sub: staff.user_id, role: "Instructor", cong });
    const created = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "church", title: "Sunday", kind: "video" });

    const overseer = await createUser({ congregationId: cong, role: "Instructor", email: "c5@dev.local" });
    await grantRole(overseer.user_id, "national_director"); // has live:manage
    const overseerTok = bearer({ sub: overseer.user_id, role: "Instructor", cong });
    const res = await agent().post(`/v1/live/streams/${created.body.stream_id}/end`).set(auth(overseerTok));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ended");
  });
});

describe("Live streaming — auto-end sweep + recording registrar", () => {
  it("auto-ends a stream still live 12+ hours after it started", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "d1@dev.local" });
    const { rows } = await testPool().query<{ stream_id: string }>(
      `INSERT INTO live_streams (scope, started_by, title, kind, stream_key_hash, started_at)
       VALUES ('church', $1, 'Orphaned', 'video', 'deadbeef', now() - interval '13 hours')
       RETURNING stream_id`,
      [admin.user_id],
    );
    const svc = new LiveService(testPool());
    const result = await svc.sweep();
    expect(result.auto_ended).toBe(1);
    const row = await testPool().query(`SELECT status, ended_at FROM live_streams WHERE stream_id = $1`, [rows[0]!.stream_id]);
    expect(row.rows[0].status).toBe("ended");
    expect(row.rows[0].ended_at).not.toBeNull();
  });

  it("does not touch a stream still within its first 12 hours", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "d2@dev.local" });
    const { rows } = await testPool().query<{ stream_id: string }>(
      `INSERT INTO live_streams (scope, started_by, title, kind, stream_key_hash, started_at)
       VALUES ('church', $1, 'Fresh', 'video', 'deadbeef', now() - interval '1 hour')
       RETURNING stream_id`,
      [admin.user_id],
    );
    const svc = new LiveService(testPool());
    await svc.sweep();
    const row = await testPool().query(`SELECT status FROM live_streams WHERE stream_id = $1`, [rows[0]!.stream_id]);
    expect(row.rows[0].status).toBe("live");
  });

  it("registers recording_url once a matching MediaMTX segment file appears on disk", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "d3@dev.local" });
    const startedAt = new Date(Date.UTC(2026, 0, 5, 10, 0, 0));
    const endedAt = new Date(Date.UTC(2026, 0, 5, 10, 45, 0));
    const { rows } = await testPool().query<{ stream_id: string }>(
      `INSERT INTO live_streams (scope, started_by, title, kind, stream_key_hash, status, started_at, ended_at)
       VALUES ('church', $1, 'Recorded', 'video', 'deadbeef', 'ended', $2, $3)
       RETURNING stream_id`,
      [admin.user_id, startedAt.toISOString(), endedAt.toISOString()],
    );
    const recordingsDir = mkdtempSync(join(tmpdir(), "nuru-live-rec-"));
    mkdirSync(join(recordingsDir, "church"), { recursive: true });
    const segmentName = "2026-01-05_10-00-00-000000.mp4";
    writeFileSync(join(recordingsDir, "church", segmentName), "fake mp4 bytes");

    const svc = new LiveService(testPool(), recordingsDir);
    const result = await svc.sweep();
    expect(result.registered).toBe(1);
    const row = await testPool().query(`SELECT recording_url FROM live_streams WHERE stream_id = $1`, [rows[0]!.stream_id]);
    expect(row.rows[0].recording_url).toBe(`/live-recordings/church/${segmentName}`);
  });

  it("leaves recording_url null when the recordings dir has no matching segment yet", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "d4@dev.local" });
    const { rows } = await testPool().query<{ stream_id: string }>(
      `INSERT INTO live_streams (scope, started_by, title, kind, stream_key_hash, status, started_at, ended_at)
       VALUES ('church', $1, 'Not yet recorded', 'video', 'deadbeef', 'ended', now() - interval '1 hour', now())
       RETURNING stream_id`,
      [admin.user_id],
    );
    const recordingsDir = mkdtempSync(join(tmpdir(), "nuru-live-rec-empty-"));
    const svc = new LiveService(testPool(), recordingsDir);
    await svc.sweep();
    const row = await testPool().query(`SELECT recording_url FROM live_streams WHERE stream_id = $1`, [rows[0]!.stream_id]);
    expect(row.rows[0].recording_url).toBeNull();
  });

  // Prod incident (docs on recordings.ts): 10 ended streams, only 1 had
  // recording_url even though the recordings dir had plenty of .mp4 files —
  // the old matcher's [started_at - 24h, ended_at] window + "exactly one
  // candidate or bust" rule failed on every realistic case. These sweep-level
  // tests exercise the fixed algorithm against realistic MediaMTX conditions.

  it("registers the LARGER of two files the SAME stream produced (segment rollover / the app auto-reconnecting mid-stream)", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "rollover1@dev.local" });
    const startedAt = new Date(Date.UTC(2026, 6, 31, 9, 0, 0));
    const endedAt = new Date(Date.UTC(2026, 6, 31, 9, 40, 0));
    const { rows } = await testPool().query<{ stream_id: string }>(
      `INSERT INTO live_streams (scope, started_by, title, kind, stream_key_hash, status, started_at, ended_at)
       VALUES ('church', $1, 'Reconnected mid-stream', 'video', 'deadbeef', 'ended', $2, $3)
       RETURNING stream_id`,
      [admin.user_id, startedAt.toISOString(), endedAt.toISOString()],
    );
    const recordingsDir = mkdtempSync(join(tmpdir(), "nuru-live-rec-rollover-"));
    mkdirSync(join(recordingsDir, "church"), { recursive: true });
    // Real prod filename shape: MediaMTX's %f microseconds suffix.
    const firstSegment = "2026-07-31_09-00-05-346775.mp4"; // small — the connection that dropped
    const secondSegment = "2026-07-31_09-03-22-981004.mp4"; // large — the reconnect that finished the stream
    writeFileSync(join(recordingsDir, "church", firstSegment), Buffer.alloc(1_000));
    writeFileSync(join(recordingsDir, "church", secondSegment), Buffer.alloc(50_000));

    const svc = new LiveService(testPool(), recordingsDir);
    const result = await svc.sweep();
    expect(result.registered).toBe(1);
    const row = await testPool().query(`SELECT recording_url FROM live_streams WHERE stream_id = $1`, [rows[0]!.stream_id]);
    expect(row.rows[0].recording_url).toBe(`/live-recordings/church/${secondSegment}`);
  });

  it("never steals a file another stream has already claimed, even when it also falls inside the new stream's window (rapid consecutive test streams)", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "noclaim1@dev.local" });
    const recordingsDir = mkdtempSync(join(tmpdir(), "nuru-live-rec-noclaim-"));
    mkdirSync(join(recordingsDir, "church"), { recursive: true });
    const onlyFile = "2026-07-31_09-05-00-000000.mp4";
    writeFileSync(join(recordingsDir, "church", onlyFile), Buffer.alloc(1_000));

    // Stream A already claimed the only file on disk.
    await testPool().query(
      `INSERT INTO live_streams (scope, started_by, title, kind, stream_key_hash, status, started_at, ended_at, recording_url)
       VALUES ('church', $1, 'Stream A', 'video', 'deadbeef', 'ended', $2, $3, $4)`,
      [admin.user_id, new Date(Date.UTC(2026, 6, 31, 9, 0, 0)).toISOString(), new Date(Date.UTC(2026, 6, 31, 9, 8, 0)).toISOString(), `/live-recordings/church/${onlyFile}`],
    );
    // Stream B started minutes later — its OWN window also plausibly covers
    // that same file, but it must not steal it.
    const { rows } = await testPool().query<{ stream_id: string }>(
      `INSERT INTO live_streams (scope, started_by, title, kind, stream_key_hash, status, started_at, ended_at)
       VALUES ('church', $1, 'Stream B', 'video', 'deadbeef', 'ended', $2, $3)
       RETURNING stream_id`,
      [admin.user_id, new Date(Date.UTC(2026, 6, 31, 9, 3, 0)).toISOString(), new Date(Date.UTC(2026, 6, 31, 9, 10, 0)).toISOString()],
    );

    const svc = new LiveService(testPool(), recordingsDir);
    const result = await svc.sweep();
    expect(result.registered).toBe(0); // nothing left for B to plausibly claim
    const row = await testPool().query(`SELECT recording_url FROM live_streams WHERE stream_id = $1`, [rows[0]!.stream_id]);
    expect(row.rows[0].recording_url).toBeNull();
  });

  it("heals the whole backlog on the next sweep tick once matching files exist — confirms no separate maintenance endpoint is needed", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "heal1@dev.local" });
    const recordingsDir = mkdtempSync(join(tmpdir(), "nuru-live-rec-heal-"));
    mkdirSync(join(recordingsDir, "church"), { recursive: true });
    const { rows } = await testPool().query<{ stream_id: string }>(
      `INSERT INTO live_streams (scope, started_by, title, kind, stream_key_hash, status, started_at, ended_at)
       VALUES ('church', $1, 'Backlogged', 'video', 'deadbeef', 'ended', $2, $3)
       RETURNING stream_id`,
      [admin.user_id, new Date(Date.UTC(2026, 6, 31, 9, 0, 0)).toISOString(), new Date(Date.UTC(2026, 6, 31, 9, 10, 0)).toISOString()],
    );
    const svc = new LiveService(testPool(), recordingsDir);

    // Tick 1: no file on disk yet (e.g. MediaMTX hadn't flushed the segment) — stays unregistered.
    const tick1 = await svc.sweep();
    expect(tick1.registered).toBe(0);
    const afterTick1 = await testPool().query(`SELECT recording_url FROM live_streams WHERE stream_id = $1`, [rows[0]!.stream_id]);
    expect(afterTick1.rows[0].recording_url).toBeNull();

    // The file lands on disk between ticks (this is exactly what "the sweep
    // already re-attempts every ~2 min" means in practice).
    writeFileSync(join(recordingsDir, "church", "2026-07-31_09-00-10-000000.mp4"), Buffer.alloc(1_000));

    // Tick 2: same still-unregistered row is picked up again and now resolves.
    const tick2 = await svc.sweep();
    expect(tick2.registered).toBe(1);
    const afterTick2 = await testPool().query(`SELECT recording_url FROM live_streams WHERE stream_id = $1`, [rows[0]!.stream_id]);
    expect(afterTick2.rows[0].recording_url).toBe("/live-recordings/church/2026-07-31_09-00-10-000000.mp4");
  });
});

describe("matchRecordingFile (pure) — docs/LIVE_STREAMING.md prod incident fixtures", () => {
  it("picks the single candidate segment covering the window", () => {
    const started = new Date(Date.UTC(2026, 0, 5, 10, 0, 0));
    const ended = new Date(Date.UTC(2026, 0, 5, 10, 45, 0));
    const files = ["2026-01-05_10-00-00-000000.mp4", "not-a-segment.txt"];
    expect(matchRecordingFile(files, started, ended)).toBe("2026-01-05_10-00-00-000000.mp4");
  });

  it("matches a real prod filename (MediaMTX's %f microsecond suffix)", () => {
    const started = new Date(Date.UTC(2026, 6, 31, 9, 3, 0));
    const ended = new Date(Date.UTC(2026, 6, 31, 9, 20, 0));
    const files = ["2026-07-31_09-03-22-346775.mp4"];
    expect(matchRecordingFile(files, started, ended)).toBe("2026-07-31_09-03-22-346775.mp4");
  });

  it("no longer gives up when a stream spans a segment boundary — picks the earliest-starting of its OWN two segments instead of returning null", () => {
    // Both files genuinely belong to THIS stream's tight window (a real
    // MediaMTX segment-rotation mid-broadcast). The OLD matcher refused to
    // pick either the moment more than one candidate existed; the new one
    // picks the primary (earliest-starting, sizes unknown here) segment.
    const started = new Date(Date.UTC(2026, 0, 5, 9, 59, 0));
    const ended = new Date(Date.UTC(2026, 0, 5, 10, 5, 0));
    const files = ["2026-01-05_10-00-00-000000.mp4", "2026-01-05_10-02-00-000000.mp4"];
    // Neither file's size is known here — falls back to earliest-starting (the primary segment).
    expect(matchRecordingFile(files, started, ended)).toBe("2026-01-05_10-00-00-000000.mp4");
  });

  it("excludes a neighbouring stream's file that sits just outside the grace window (rapid consecutive test streams)", () => {
    // This is the actual shape of the old bug: 09:00 and 10:00 files, 55
    // minutes apart, both fell inside the old 24h look-back and jointly
    // caused a total refusal. With a tight (default 2 min) grace window, the
    // unrelated 09:00 file is correctly excluded and the real 10:00 segment
    // is matched cleanly.
    const started = new Date(Date.UTC(2026, 0, 5, 9, 55, 0));
    const ended = new Date(Date.UTC(2026, 0, 5, 10, 5, 0));
    const files = ["2026-01-05_09-00-00-000000.mp4", "2026-01-05_10-00-00-000000.mp4"];
    expect(matchRecordingFile(files, started, ended)).toBe("2026-01-05_10-00-00-000000.mp4");
  });

  it("tolerates a couple of minutes of clock skew at the window edges, but not more", () => {
    const started = new Date(Date.UTC(2026, 0, 5, 10, 0, 0));
    const ended = new Date(Date.UTC(2026, 0, 5, 10, 30, 0));
    // 90s early — within the default 2-minute grace.
    expect(matchRecordingFile(["2026-01-05_09-58-30-000000.mp4"], started, ended)).toBe("2026-01-05_09-58-30-000000.mp4");
    // 90s after ended_at — also within grace.
    expect(matchRecordingFile(["2026-01-05_10-31-30-000000.mp4"], started, ended)).toBe("2026-01-05_10-31-30-000000.mp4");
    // 5 minutes early — outside the default grace, excluded.
    expect(matchRecordingFile(["2026-01-05_09-55-00-000000.mp4"], started, ended)).toBeNull();
  });

  it("prefers the larger (longer) of several same-stream segments when sizes are known — segment rollover / mid-stream reconnect", () => {
    const started = new Date(Date.UTC(2026, 6, 31, 9, 0, 0));
    const ended = new Date(Date.UTC(2026, 6, 31, 9, 40, 0));
    const files = [
      { name: "2026-07-31_09-00-05-346775.mp4", sizeBytes: 1_000 }, // dropped connection
      { name: "2026-07-31_09-03-22-981004.mp4", sizeBytes: 50_000 }, // the reconnect that ran to completion
    ];
    expect(matchRecordingFile(files, started, ended)).toBe("2026-07-31_09-03-22-981004.mp4");
  });

  it("falls back to earliest-starting when sizes are unknown or tied", () => {
    const started = new Date(Date.UTC(2026, 6, 31, 9, 0, 0));
    const ended = new Date(Date.UTC(2026, 6, 31, 9, 40, 0));
    const files = [
      { name: "2026-07-31_09-10-00-000000.mp4", sizeBytes: 5_000 },
      { name: "2026-07-31_09-05-00-000000.mp4", sizeBytes: 5_000 }, // tied size, starts earlier
    ];
    expect(matchRecordingFile(files, started, ended)).toBe("2026-07-31_09-05-00-000000.mp4");
  });

  it("never returns a file already claimed by another stream", () => {
    const started = new Date(Date.UTC(2026, 6, 31, 9, 0, 0));
    const ended = new Date(Date.UTC(2026, 6, 31, 9, 10, 0));
    const files = ["2026-07-31_09-01-00-000000.mp4", "2026-07-31_09-02-00-000000.mp4"];
    // The earlier (would-be-preferred) file is already claimed — matcher must
    // fall through to the other still-unclaimed candidate.
    expect(matchRecordingFile(files, started, ended, { claimed: new Set(["2026-07-31_09-01-00-000000.mp4"]) }))
      .toBe("2026-07-31_09-02-00-000000.mp4");
    // Both claimed — nothing left to give.
    expect(
      matchRecordingFile(files, started, ended, {
        claimed: new Set(["2026-07-31_09-01-00-000000.mp4", "2026-07-31_09-02-00-000000.mp4"]),
      }),
    ).toBeNull();
  });

  it("returns null when nothing matches", () => {
    const started = new Date(Date.UTC(2026, 0, 5, 10, 0, 0));
    const ended = new Date(Date.UTC(2026, 0, 5, 10, 45, 0));
    expect(matchRecordingFile(["2020-01-01_00-00-00-000000.mp4"], started, ended)).toBeNull();
  });
});

describe("Live streaming — viewer heartbeat / viewer_peak", () => {
  it("heartbeat upserts presence and bumps viewer_peak; /live/now reflects the live viewer_count", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "e1@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const created = await agent().post("/v1/live/streams").set(auth(adminTok)).send({ scope: "church", title: "Sunday", kind: "video" });

    const viewer1 = await createUser({ congregationId: cong, email: "v1@dev.local" });
    const viewer2 = await createUser({ congregationId: cong, email: "v2@dev.local" });
    const v1Tok = bearer({ sub: viewer1.user_id, role: "Student", cong });
    const v2Tok = bearer({ sub: viewer2.user_id, role: "Student", cong });

    const hb1 = await agent().post(`/v1/live/streams/${created.body.stream_id}/heartbeat`).set(auth(v1Tok));
    expect(hb1.status).toBe(200);
    expect(hb1.body).toEqual({ ok: true });
    await agent().post(`/v1/live/streams/${created.body.stream_id}/heartbeat`).set(auth(v2Tok));

    const row = await testPool().query(`SELECT viewer_peak FROM live_streams WHERE stream_id = $1`, [created.body.stream_id]);
    expect(row.rows[0].viewer_peak).toBe(2);

    const now = await agent().get("/v1/live/now").set(auth(adminTok));
    expect(now.body.data[0].viewer_count).toBe(2);
  });

  it("403s a heartbeat on a cell stream from a non-member", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "e2@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const cell = await createCellGroup(cong, "Cell A");
    const created = await agent().post("/v1/live/streams").set(auth(adminTok)).send({ scope: "cell", cell_id: cell, title: "Cell", kind: "video" });

    const outsider = await createUser({ congregationId: cong, email: "e3@dev.local" });
    const outsiderTok = bearer({ sub: outsider.user_id, role: "Student", cong });
    const res = await agent().post(`/v1/live/streams/${created.body.stream_id}/heartbeat`).set(auth(outsiderTok));
    expect(res.status).toBe(403);
  });
});

describe("Live streaming — recordings list", () => {
  it("lists ended streams with a recording, hidden from non-cell-members", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "f1@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const cell = await createCellGroup(cong, "Cell A");
    const created = await agent().post("/v1/live/streams").set(auth(adminTok)).send({ scope: "cell", cell_id: cell, title: "Cell replay", kind: "video" });
    await agent().post(`/v1/live/streams/${created.body.stream_id}/end`).set(auth(adminTok));
    await testPool().query(`UPDATE live_streams SET recording_url = '/live-recordings/cell/x/seg.mp4' WHERE stream_id = $1`, [created.body.stream_id]);

    const outsider = await createUser({ congregationId: cong, email: "f2@dev.local" });
    const outsiderTok = bearer({ sub: outsider.user_id, role: "Student", cong });
    const hidden = await agent().get("/v1/live/recordings").set(auth(outsiderTok));
    expect(hidden.body.data).toHaveLength(0);

    const member = await createUser({ congregationId: cong, cellGroupId: cell, email: "f3@dev.local" });
    const memberTok = bearer({ sub: member.user_id, role: "Student", cong });
    const visible = await agent().get("/v1/live/recordings?scope=cell").set(auth(memberTok));
    expect(visible.body.data).toHaveLength(1);
    expect(visible.body.data[0].recording_url).toBe("/live-recordings/cell/x/seg.mp4");
  });
});

describe("Live streaming — recording stewardship (GET /live/recordings/mine, DELETE /live/recordings/:id)", () => {
  async function endedStreamWithRecording(
    ownerId: string,
    opts: { scope?: "church" | "cell"; cellId?: string | null; title?: string } = {},
  ): Promise<string> {
    const scope = opts.scope ?? "church";
    const { rows } = await testPool().query<{ stream_id: string }>(
      `INSERT INTO live_streams (scope, cell_id, started_by, title, kind, stream_key_hash, status, started_at, ended_at, recording_url)
       VALUES ($1, $2, $3, $4, 'video', 'deadbeef', 'ended', now() - interval '1 hour', now(), '/live-recordings/x/seg.mp4')
       RETURNING stream_id`,
      [scope, opts.cellId ?? null, ownerId, opts.title ?? "Recorded"],
    );
    return rows[0]!.stream_id;
  }

  it("GET /mine lists only the caller's own recordings, newest first", async () => {
    // Plain Student roles (not Admin/SuperAdmin — that bridge grants the full
    // permission grid, including live:manage, which would make this see
    // everyone's recordings instead of proving the ownership filter).
    const owner = await createUser({ congregationId: cong, email: "mine1@dev.local" });
    const ownerTok = bearer({ sub: owner.user_id, role: "Student", cong });
    const other = await createUser({ congregationId: cong, email: "mine2@dev.local" });

    const older = await endedStreamWithRecording(owner.user_id, { title: "Older" });
    await testPool().query(`UPDATE live_streams SET ended_at = now() - interval '2 hours' WHERE stream_id = $1`, [older]);
    const newer = await endedStreamWithRecording(owner.user_id, { title: "Newer" });
    await endedStreamWithRecording(other.user_id, { title: "Not mine" });

    const res = await agent().get("/v1/live/recordings/mine").set(auth(ownerTok));
    expect(res.status).toBe(200);
    expect(res.body.data.map((r: { stream_id: string }) => r.stream_id)).toEqual([newer, older]);
    expect(res.body.data[0]).toMatchObject({ recording_id: newer, stream_id: newer, title: "Newer", url: "/live-recordings/x/seg.mp4" });
  });

  it("GET /mine shows a live:manage holder every caller's recordings, not just their own", async () => {
    const owner = await createUser({ congregationId: cong, role: "Admin", email: "mine3@dev.local" });
    const streamId = await endedStreamWithRecording(owner.user_id, { title: "Someone else's" });

    const overseer = await createUser({ congregationId: cong, role: "Instructor", email: "mine4@dev.local" });
    await grantRole(overseer.user_id, "national_director"); // live:manage
    const overseerTok = bearer({ sub: overseer.user_id, role: "Instructor", cong });

    const res = await agent().get("/v1/live/recordings/mine").set(auth(overseerTok));
    expect(res.status).toBe(200);
    expect(res.body.data.map((r: { stream_id: string }) => r.stream_id)).toContain(streamId);
  });

  it("a plain member with neither ownership nor live:manage sees an empty /mine list", async () => {
    const owner = await createUser({ congregationId: cong, role: "Admin", email: "mine5@dev.local" });
    await endedStreamWithRecording(owner.user_id);

    const stranger = await createUser({ congregationId: cong, email: "mine6@dev.local" });
    const strangerTok = bearer({ sub: stranger.user_id, role: "Student", cong });
    const res = await agent().get("/v1/live/recordings/mine").set(auth(strangerTok));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("DELETE lets the owner delete their own recording; it then vanishes from every list", async () => {
    const owner = await createUser({ congregationId: cong, role: "Admin", email: "del1@dev.local" });
    const ownerTok = bearer({ sub: owner.user_id, role: "Admin", cong });
    const streamId = await endedStreamWithRecording(owner.user_id);

    const del = await agent().delete(`/v1/live/recordings/${streamId}`).set(auth(ownerTok));
    expect(del.status).toBe(204);

    const mine = await agent().get("/v1/live/recordings/mine").set(auth(ownerTok));
    expect(mine.body.data).toEqual([]);
    const list = await agent().get("/v1/live/recordings").set(auth(ownerTok));
    expect(list.body.data.map((r: { stream_id: string }) => r.stream_id)).not.toContain(streamId);

    const row = await testPool().query(`SELECT recording_url, recording_deleted_at FROM live_streams WHERE stream_id = $1`, [streamId]);
    expect(row.rows[0].recording_url).not.toBeNull(); // soft-delete only — row/URL untouched
    expect(row.rows[0].recording_deleted_at).not.toBeNull();

    const auditRow = await testPool().query(`SELECT action FROM audit_log WHERE entity_id = $1 AND action = 'live.recording_deleted'`, [streamId]);
    expect(auditRow.rows).toHaveLength(1);
  });

  it("DELETE lets a live:manage holder delete someone else's recording", async () => {
    const owner = await createUser({ congregationId: cong, role: "Admin", email: "del2@dev.local" });
    const streamId = await endedStreamWithRecording(owner.user_id);

    const overseer = await createUser({ congregationId: cong, role: "Instructor", email: "del3@dev.local" });
    await grantRole(overseer.user_id, "national_director");
    const overseerTok = bearer({ sub: overseer.user_id, role: "Instructor", cong });

    const res = await agent().delete(`/v1/live/recordings/${streamId}`).set(auth(overseerTok));
    expect(res.status).toBe(204);
  });

  it("DELETE 403s a stranger with neither ownership nor live:manage", async () => {
    const owner = await createUser({ congregationId: cong, role: "Admin", email: "del4@dev.local" });
    const streamId = await endedStreamWithRecording(owner.user_id);

    const stranger = await createUser({ congregationId: cong, role: "Instructor", email: "del5@dev.local" });
    await grantRole(stranger.user_id, "events_coordinator"); // live:go only, not manage
    const strangerTok = bearer({ sub: stranger.user_id, role: "Instructor", cong });

    const res = await agent().delete(`/v1/live/recordings/${streamId}`).set(auth(strangerTok));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_SCOPE");
  });

  it("DELETE 404s an unknown stream_id and a stream that never had a recording", async () => {
    const owner = await createUser({ congregationId: cong, role: "Admin", email: "del6@dev.local" });
    const ownerTok = bearer({ sub: owner.user_id, role: "Admin", cong });

    const unknown = await agent().delete(`/v1/live/recordings/00000000-0000-0000-0000-000000000000`).set(auth(ownerTok));
    expect(unknown.status).toBe(404);

    const created = await agent().post("/v1/live/streams").set(auth(ownerTok)).send({ scope: "church", title: "Never recorded", kind: "video" });
    await agent().post(`/v1/live/streams/${created.body.stream_id}/end`).set(auth(ownerTok));
    const noRecording = await agent().delete(`/v1/live/recordings/${created.body.stream_id}`).set(auth(ownerTok));
    expect(noRecording.status).toBe(404);
  });

  it("DELETE is idempotent — a repeat delete of an already-deleted recording is a silent no-op, not an error", async () => {
    const owner = await createUser({ congregationId: cong, role: "Admin", email: "del7@dev.local" });
    const ownerTok = bearer({ sub: owner.user_id, role: "Admin", cong });
    const streamId = await endedStreamWithRecording(owner.user_id);

    const first = await agent().delete(`/v1/live/recordings/${streamId}`).set(auth(ownerTok));
    expect(first.status).toBe(204);
    const second = await agent().delete(`/v1/live/recordings/${streamId}`).set(auth(ownerTok));
    expect(second.status).toBe(204);

    const auditRow = await testPool().query(`SELECT action FROM audit_log WHERE entity_id = $1 AND action = 'live.recording_deleted'`, [streamId]);
    expect(auditRow.rows).toHaveLength(1); // only the first delete actually changed something
  });
});
