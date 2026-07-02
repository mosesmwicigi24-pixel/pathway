// Radio Broadcast Studio + Virtual Audio Mixer (docs/RADIO_STUDIO_CONTRACT.md).
// Covers: create→go-live→end lifecycle; member list respects visibility + omits
// stream_key; idempotent react (same client_event_id twice = one row); comment
// create + moderation hide; mixer scene create/update/list; validation failure.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { RadioService } from "../src/modules/radio/service.js";
import {
  FakeStreamProvider,
  IcecastStreamProvider,
  buildStreamProvider,
} from "../src/modules/radio/provider.js";
import type { Env } from "../src/config/env.js";
import { createHash } from "node:crypto";

const auth = (t: string) => ({ Authorization: t });

let cong: string;
let adminTok: string;

async function makeAdminTok(email: string): Promise<string> {
  const admin = await createUser({ congregationId: cong, role: "Admin", email });
  return bearer({ sub: admin.user_id, role: "Admin", cong });
}

async function createProgram(overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const res = await agent()
    .post("/v1/admin/radio/programs")
    .set(auth(adminTok))
    .send({ title: "Sunday Sermon", category: "Sermon", ...overrides });
  expect(res.status).toBe(201);
  return res.body;
}

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  adminTok = await makeAdminTok("admin@dev.local");
});
afterAll(async () => {
  await closeTestPool();
});

describe("radio — program lifecycle (create → go-live → end)", () => {
  it("create provisions ingest credentials and returns the admin program", async () => {
    const prog = await createProgram();
    expect(prog.id).toBeTruthy();
    expect(prog.status).toBe("draft");
    expect(prog.is_live).toBe(false);
    // Provider provisioned creds on create.
    expect(prog.ingest_provider).toBe("fake");
    expect(prog.ingest_url).toBe("rtmp://ingest.local/live");
    expect(typeof prog.stream_key).toBe("string");
    expect(prog.hls_url).toBe(`https://stream.local/hls/${prog.id}.m3u8`);
  });

  it("scheduled_at at create sets status=scheduled", async () => {
    const prog = await createProgram({ scheduled_at: new Date(Date.now() + 3_600_000).toISOString() });
    expect(prog.status).toBe("scheduled");
  });

  it("go-live sets live, end sets ended; health only while live", async () => {
    const prog = await createProgram();
    const id = prog.id as string;

    const live = await agent().post(`/v1/admin/radio/programs/${id}/go-live`).set(auth(adminTok));
    expect(live.status).toBe(200);
    expect(live.body.status).toBe("live");
    expect(live.body.is_live).toBe(true);
    expect(live.body.live_started_at).toBeTruthy();

    const health = await agent().get(`/v1/admin/radio/programs/${id}/health`).set(auth(adminTok));
    expect(health.status).toBe(200);
    expect(typeof health.body.bitrate).toBe("number");
    expect(typeof health.body.listeners).toBe("number");

    const end = await agent().post(`/v1/admin/radio/programs/${id}/end`).set(auth(adminTok));
    expect(end.status).toBe(200);
    expect(end.body.status).toBe("ended");
    expect(end.body.is_live).toBe(false);
    expect(end.body.live_ended_at).toBeTruthy();

    // Health 409s once the program is no longer live.
    const health2 = await agent().get(`/v1/admin/radio/programs/${id}/health`).set(auth(adminTok));
    expect(health2.status).toBe(409);
  });

  it("rotate-key issues a new stream key", async () => {
    const prog = await createProgram();
    const before = prog.stream_key as string;
    const rot = await agent().post(`/v1/admin/radio/programs/${prog.id}/rotate-key`).set(auth(adminTok));
    expect(rot.status).toBe(200);
    expect(typeof rot.body.stream_key).toBe("string");
    expect(rot.body.stream_key).not.toBe(before);
    const after = await agent().get(`/v1/admin/radio/programs/${prog.id}`).set(auth(adminTok));
    expect(after.body.stream_key).toBe(rot.body.stream_key);
  });

  it("rejects invalid create body (validation)", async () => {
    const res = await agent()
      .post("/v1/admin/radio/programs")
      .set(auth(adminTok))
      .send({ title: "", category: "NotACategory" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("requires the radio permission (a Student is 403)", async () => {
    const student = await createUser({ congregationId: cong, role: "Student", email: "stu@dev.local" });
    const tok = bearer({ sub: student.user_id, role: "Student", cong });
    const res = await agent().post("/v1/admin/radio/programs").set(auth(tok)).send({ title: "x", category: "Sermon" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_SCOPE");
  });
});

describe("radio — member surface respects visibility + omits secrets", () => {
  it("member list returns public+members programs, never private, and never stream_key", async () => {
    const pub = await createProgram({ title: "Public", visibility: "public" });
    await createProgram({ title: "MembersOnly", visibility: "members" });
    await createProgram({ title: "Private", visibility: "private" });
    // Publish them off draft so they surface on the member list.
    for (const t of ["Public", "MembersOnly", "Private"]) {
      await testPool().query(`UPDATE radio_programs SET status = 'scheduled' WHERE title = $1`, [t]);
    }

    const member = await createUser({ congregationId: cong, role: "Student", email: "mem@dev.local" });
    const tok = bearer({ sub: member.user_id, role: "Student", cong });
    const res = await agent().get("/v1/radio/programs").set(auth(tok));
    expect(res.status).toBe(200);
    const titles = (res.body as { title: string }[]).map((p) => p.title).sort();
    expect(titles).toEqual(["MembersOnly", "Public"]);
    // No ingest secrets ever leak to members.
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/stream_key/);
    expect(raw).not.toMatch(/ingest_url/);
    expect(raw).not.toMatch(/ingest_provider/);
    void pub;
  });

  it("member GET of a private program 404s; a public one omits stream_key", async () => {
    const priv = await createProgram({ visibility: "private" });
    const pub = await createProgram({ visibility: "public" });
    const member = await createUser({ congregationId: cong, role: "Student", email: "mem2@dev.local" });
    const tok = bearer({ sub: member.user_id, role: "Student", cong });

    const p404 = await agent().get(`/v1/radio/programs/${priv.id}`).set(auth(tok));
    expect(p404.status).toBe(404);

    const ok = await agent().get(`/v1/radio/programs/${pub.id}`).set(auth(tok));
    expect(ok.status).toBe(200);
    expect(ok.body.hls_url).toBeTruthy();
    expect(ok.body.stream_key).toBeUndefined();
    expect(ok.body.ingest_url).toBeUndefined();
  });

  it("now-playing returns the live program (no stream_key)", async () => {
    const prog = await createProgram({ visibility: "public" });
    await agent().post(`/v1/admin/radio/programs/${prog.id}/go-live`).set(auth(adminTok));
    const member = await createUser({ congregationId: cong, role: "Student", email: "mem3@dev.local" });
    const tok = bearer({ sub: member.user_id, role: "Student", cong });
    const res = await agent().get("/v1/radio/now-playing").set(auth(tok));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(prog.id);
    expect(res.body.is_live).toBe(true);
    expect(res.body.stream_key).toBeUndefined();
  });
});

describe("radio — reactions are idempotent per client_event_id", () => {
  it("the same client_event_id twice inserts one row and returns the same counts", async () => {
    const prog = await createProgram({ visibility: "public" });
    const member = await createUser({ congregationId: cong, role: "Student", email: "r@dev.local" });
    const tok = bearer({ sub: member.user_id, role: "Student", cong });

    const first = await agent()
      .post(`/v1/radio/programs/${prog.id}/react`)
      .set(auth(tok))
      .send({ kind: "amen", client_event_id: "evt-1" });
    expect(first.status).toBe(200);
    expect(first.body.counts.amen).toBe(1);

    const replay = await agent()
      .post(`/v1/radio/programs/${prog.id}/react`)
      .set(auth(tok))
      .send({ kind: "amen", client_event_id: "evt-1" });
    expect(replay.status).toBe(200);
    expect(replay.body.counts.amen).toBe(1); // no double-count

    const { rows } = await testPool().query(`SELECT COUNT(*)::int AS n FROM radio_reactions WHERE program_id = $1`, [
      prog.id,
    ]);
    expect(rows[0].n).toBe(1);
  });
});

describe("radio — comments create + moderation hide", () => {
  it("member posts a comment (idempotent), admin hides it, member no longer sees it", async () => {
    const prog = await createProgram({ visibility: "public" });
    const member = await createUser({ congregationId: cong, role: "Student", email: "c@dev.local" });
    const tok = bearer({ sub: member.user_id, role: "Student", cong });

    const c1 = await agent()
      .post(`/v1/radio/programs/${prog.id}/comments`)
      .set(auth(tok))
      .send({ body: "Amen!", client_event_id: "c-1" });
    expect(c1.status).toBe(201);
    const commentId = c1.body.id as string;

    // Replay returns the same row, no duplicate.
    const c1b = await agent()
      .post(`/v1/radio/programs/${prog.id}/comments`)
      .set(auth(tok))
      .send({ body: "Amen!", client_event_id: "c-1" });
    expect(c1b.status).toBe(201);
    expect(c1b.body.id).toBe(commentId);

    const list1 = await agent().get(`/v1/radio/programs/${prog.id}/comments`).set(auth(tok));
    expect(list1.body).toHaveLength(1);

    // Admin hides it.
    const hide = await agent().delete(`/v1/admin/radio/comments/${commentId}`).set(auth(adminTok));
    expect(hide.status).toBe(200);

    const list2 = await agent().get(`/v1/radio/programs/${prog.id}/comments`).set(auth(tok));
    expect(list2.body).toHaveLength(0);

    // Admin moderation view still shows the hidden comment.
    const adminList = await agent().get(`/v1/admin/radio/programs/${prog.id}/comments`).set(auth(adminTok));
    expect(adminList.body).toHaveLength(1);
    expect(adminList.body[0].hidden).toBe(true);
  });
});

describe("radio — uploaded session audio + auto-air (ADDENDUM)", () => {
  it("create with audio_url + auto_go_live=false persists and returns them", async () => {
    const prog = await createProgram({
      audio_url: "http://localhost:8080/media/abc.mp3",
      audio_duration_sec: 1800,
      auto_go_live: false,
    });
    expect(prog.audio_url).toBe("http://localhost:8080/media/abc.mp3");
    expect(prog.audio_duration_sec).toBe(1800);
    expect(prog.auto_go_live).toBe(false);
  });

  it("auto_go_live defaults to true when omitted", async () => {
    const prog = await createProgram();
    expect(prog.auto_go_live).toBe(true);
  });

  it("member GET includes audio fields but still no stream_key", async () => {
    const prog = await createProgram({
      visibility: "public",
      audio_url: "http://localhost:8080/media/sermon.mp3",
      audio_duration_sec: 900,
    });
    const member = await createUser({ congregationId: cong, role: "Student", email: "aud@dev.local" });
    const tok = bearer({ sub: member.user_id, role: "Student", cong });
    const res = await agent().get(`/v1/radio/programs/${prog.id}`).set(auth(tok));
    expect(res.status).toBe(200);
    expect(res.body.audio_url).toBe("http://localhost:8080/media/sermon.mp3");
    expect(res.body.audio_duration_sec).toBe(900);
    expect(res.body.auto_go_live).toBe(true);
    expect(res.body.stream_key).toBeUndefined();
    expect(res.body.ingest_url).toBeUndefined();
  });

  it("airDueEvents airs due auto-air programs, skips opted-out, auto-ends over-duration", async () => {
    const svc = new RadioService(testPool(), new FakeStreamProvider());
    const past = new Date(Date.now() - 5 * 60_000).toISOString();

    // Due + auto-air on → should go live.
    const due = await createProgram({ scheduled_at: past, auto_go_live: true });
    // Due + auto-air off → should stay scheduled.
    const optedOut = await createProgram({ scheduled_at: past, auto_go_live: false });

    const first = await svc.airDueEvents();
    expect(first.aired).toBe(1);

    const dueRow = await agent().get(`/v1/admin/radio/programs/${due.id}`).set(auth(adminTok));
    expect(dueRow.body.status).toBe("live");
    expect(dueRow.body.is_live).toBe(true);

    const optRow = await agent().get(`/v1/admin/radio/programs/${optedOut.id}`).set(auth(adminTok));
    expect(optRow.body.status).toBe("scheduled");
    expect(optRow.body.is_live).toBe(false);

    // A live program past its duration_min → auto-ended.
    await testPool().query(
      `UPDATE radio_programs SET duration_min = 30, live_started_at = now() - interval '45 minutes' WHERE id = $1`,
      [due.id],
    );
    const second = await svc.airDueEvents();
    expect(second.ended).toBe(1);

    const endedRow = await agent().get(`/v1/admin/radio/programs/${due.id}`).set(auth(adminTok));
    expect(endedRow.body.status).toBe("ended");
    expect(endedRow.body.is_live).toBe(false);
  });
});

describe("radio — audio upload validation", () => {
  it("rejects with 400 when no file is provided", async () => {
    const res = await agent().post("/v1/admin/media/audio/upload").set(auth(adminTok));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("radio — mixer scenes + jingles", () => {
  it("scene create → update → list round-trips channels", async () => {
    const create = await agent()
      .post("/v1/admin/radio/mixer/scenes")
      .set(auth(adminTok))
      .send({
        name: "Preaching",
        hint: "Voice-forward",
        channels: [{ id: "mic1", name: "Mic 1", level: 0.8, pan: 0, muted: false, solo: false }],
      });
    expect(create.status).toBe(201);
    expect(create.body.name).toBe("Preaching");
    expect(create.body.channels).toHaveLength(1);
    const id = create.body.id as string;

    const upd = await agent()
      .patch(`/v1/admin/radio/mixer/scenes/${id}`)
      .set(auth(adminTok))
      .send({ hint: "Updated", channels: [{ id: "mic1", name: "Mic 1", level: 0.5 }] });
    expect(upd.status).toBe(200);
    expect(upd.body.hint).toBe("Updated");
    expect(upd.body.channels[0].level).toBe(0.5);

    const list = await agent().get("/v1/admin/radio/mixer/scenes").set(auth(adminTok));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
  });

  it("jingle create + list + delete", async () => {
    const create = await agent()
      .post("/v1/admin/radio/mixer/jingles")
      .set(auth(adminTok))
      .send({ label: "Intro", color: "#E6C66E", sort: 1 });
    expect(create.status).toBe(201);
    const id = create.body.id as string;

    const list = await agent().get("/v1/admin/radio/mixer/jingles").set(auth(adminTok));
    expect(list.body).toHaveLength(1);

    const del = await agent().delete(`/v1/admin/radio/mixer/jingles/${id}`).set(auth(adminTok));
    expect(del.status).toBe(200);
    const list2 = await agent().get("/v1/admin/radio/mixer/jingles").set(auth(adminTok));
    expect(list2.body).toHaveLength(0);
  });

  it("rejects an invalid scene body (validation)", async () => {
    const res = await agent().post("/v1/admin/radio/mixer/scenes").set(auth(adminTok)).send({ hint: "no name" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });
});

// --- Icecast stream provider (pure unit tests — no DB, no real Icecast) --------

// A minimal fake env with the Icecast fields; cast to Env for the provider.
function icecastEnv(overrides: Partial<Env> = {}): Env {
  return {
    RADIO_STREAM_PROVIDER: "icecast",
    ICECAST_SOURCE_HOST: "pathway.nuruplace.org",
    ICECAST_SOURCE_PORT: "8000",
    ICECAST_SOURCE_PASSWORD: "s3cret-source-pw",
    ICECAST_PUBLIC_BASE: "https://pathway.nuruplace.org/radio",
    ICECAST_STATUS_URL: "http://127.0.0.1:8000/status-json.xsl",
    ...overrides,
  } as unknown as Env;
}

describe("radio — IcecastStreamProvider", () => {
  const programId = "11112222-3333-4444-5555-666677778888";
  // mount is derived from the first 8 hex of the sha256 of the program id.
  const mount = `/s_${createHash("sha256").update(programId).digest("hex").slice(0, 8)}.mp3`;

  it("provision() maps ingest/stream_key/hls_url/provider", () => {
    const p = new IcecastStreamProvider(icecastEnv());
    const creds = p.provision(programId);
    expect(creds.provider).toBe("icecast");
    expect(creds.ingestUrl).toBe(`pathway.nuruplace.org:8000${mount}`);
    expect(creds.streamKey).toBe("s3cret-source-pw");
    expect(creds.hlsUrl).toBe(`https://pathway.nuruplace.org/radio${mount}`);
  });

  it("start()/stop() are no-ops and rotateKey() returns the configured password", () => {
    const p = new IcecastStreamProvider(icecastEnv());
    expect(p.start({ id: programId })).toBeUndefined();
    expect(p.stop({ id: programId })).toBeUndefined();
    expect(p.rotateKey(programId)).toEqual({ streamKey: "s3cret-source-pw" });
  });

  it("buildStreamProvider returns Icecast when required env is set, Fake otherwise", () => {
    expect(buildStreamProvider(icecastEnv())).toBeInstanceOf(IcecastStreamProvider);
    // Missing ICECAST_PUBLIC_BASE → falls back to Fake.
    expect(
      buildStreamProvider(icecastEnv({ ICECAST_PUBLIC_BASE: undefined })),
    ).toBeInstanceOf(FakeStreamProvider);
    // Default provider is Fake.
    expect(buildStreamProvider({ RADIO_STREAM_PROVIDER: "fake" } as unknown as Env)).toBeInstanceOf(
      FakeStreamProvider,
    );
  });

  it("health() parses a matching source (array) into StreamHealth", async () => {
    const p = new IcecastStreamProvider(icecastEnv());
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          icestats: {
            source: [
              { listenurl: `http://127.0.0.1:8000${mount}`, listeners: 42, bitrate: 128 },
              { listenurl: "http://127.0.0.1:8000/other.mp3", listeners: 9 },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    try {
      const h = await p.health({ id: programId });
      expect(h.listeners).toBe(42);
      expect(h.bitrate).toBe(128);
      expect(h.stability).toBe(100);
      expect(h.cpu).toBe(0);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("health() returns Offline (all-zero) when Icecast is unreachable", async () => {
    const p = new IcecastStreamProvider(icecastEnv());
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("connection refused");
    }) as typeof fetch;
    try {
      const h = await p.health({ id: programId });
      expect(h).toEqual({ cpu: 0, memory: 0, bitrate: 0, latency: 0, dropped: 0, stability: 0, listeners: 0 });
    } finally {
      globalThis.fetch = orig;
    }
  });
});
