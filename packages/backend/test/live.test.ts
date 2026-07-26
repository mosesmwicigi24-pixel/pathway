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
});

describe("matchRecordingFile (pure)", () => {
  it("picks the single candidate segment covering the window", () => {
    const started = new Date(Date.UTC(2026, 0, 5, 10, 0, 0));
    const ended = new Date(Date.UTC(2026, 0, 5, 10, 45, 0));
    const files = ["2026-01-05_10-00-00-000000.mp4", "not-a-segment.txt"];
    expect(matchRecordingFile(files, started, ended)).toBe("2026-01-05_10-00-00-000000.mp4");
  });

  it("returns null when multiple segments plausibly overlap (spans a segment boundary)", () => {
    const started = new Date(Date.UTC(2026, 0, 5, 9, 55, 0));
    const ended = new Date(Date.UTC(2026, 0, 5, 10, 5, 0));
    const files = ["2026-01-05_09-00-00-000000.mp4", "2026-01-05_10-00-00-000000.mp4"];
    expect(matchRecordingFile(files, started, ended)).toBeNull();
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
