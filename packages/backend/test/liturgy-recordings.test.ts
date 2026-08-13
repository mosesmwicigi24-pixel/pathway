// The pastor's own voice on the liturgy (migration 189) — admin-only upload/
// list/delete, per-band, upsert-to-replace, and LiturgyService.current()
// preferring the recording for the CURRENT band when one exists.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { agent, bearer, testEnv } from "./helpers/app.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { LiturgyService, BANDS } from "../src/modules/intelligence/liturgy.js";
import { LiturgyRecordingService } from "../src/modules/intelligence/liturgyRecordings.js";
import { FakeAiProvider } from "../src/modules/assistant/provider.js";

const storageDir = testEnv().MEDIA_STORAGE_DIR;
const filenameOf = (url: string): string => url.split("/").pop()!;

let cong: string, adminId: string, studentId: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  adminId = (await createUser({ congregationId: cong, role: "Admin", email: "pastor@dev.local" })).user_id;
  studentId = (await createUser({ congregationId: cong, role: "Student", email: "member@dev.local" })).user_id;
});
afterAll(async () => {
  await closeTestPool();
});

describe("upload requires Admin", () => {
  it("a member (Student) gets 403", async () => {
    const tok = bearer({ sub: studentId, role: "Student", cong });
    const res = await agent()
      .post("/v1/admin/liturgy/recordings/sunrise")
      .set("Authorization", tok)
      .field("duration_sec", "30")
      .attach("file", Buffer.from("fake-aac-bytes"), { filename: "sunrise.m4a", contentType: "audio/mp4" });
    expect(res.status).toBe(403);
  });

  it("an Admin succeeds", async () => {
    const tok = bearer({ sub: adminId, role: "Admin", cong });
    const res = await agent()
      .post("/v1/admin/liturgy/recordings/sunrise")
      .set("Authorization", tok)
      .field("duration_sec", "42")
      .attach("file", Buffer.from("fake-aac-bytes"), { filename: "sunrise.m4a", contentType: "audio/mp4" });
    expect(res.status).toBe(201);
    expect(res.body.band).toBe("sunrise");
    expect(res.body.audio_url).toContain("/media/");
    expect(res.body.duration_sec).toBe(42);
  });
});

describe("type + duration validation rejects junk", () => {
  it("rejects a non-audio file with 400", async () => {
    const tok = bearer({ sub: adminId, role: "Admin", cong });
    const res = await agent()
      .post("/v1/admin/liturgy/recordings/evening")
      .set("Authorization", tok)
      .field("duration_sec", "30")
      .attach("file", Buffer.from("hello"), { filename: "notes.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
  });

  it("rejects an insane duration (out of the 1-900s sane range)", async () => {
    const tok = bearer({ sub: adminId, role: "Admin", cong });
    const res = await agent()
      .post("/v1/admin/liturgy/recordings/evening")
      .set("Authorization", tok)
      .field("duration_sec", "99999")
      .attach("file", Buffer.from("fake-aac-bytes"), { filename: "evening.m4a", contentType: "audio/mp4" });
    expect(res.status).toBe(400);
  });

  it("rejects an oversized file (over the 20 MB cap)", async () => {
    const tok = bearer({ sub: adminId, role: "Admin", cong });
    const big = Buffer.alloc(20 * 1024 * 1024 + 1);
    const res = await agent()
      .post("/v1/admin/liturgy/recordings/night")
      .set("Authorization", tok)
      .field("duration_sec", "30")
      .attach("file", big, { filename: "night.m4a", contentType: "audio/mp4" });
    expect(res.status).toBe(400);
  }, 20_000);

  it("rejects an invalid band in the URL", async () => {
    const tok = bearer({ sub: adminId, role: "Admin", cong });
    const res = await agent()
      .post("/v1/admin/liturgy/recordings/teatime")
      .set("Authorization", tok)
      .field("duration_sec", "30")
      .attach("file", Buffer.from("fake-aac-bytes"), { filename: "x.m4a", contentType: "audio/mp4" });
    expect(res.status).toBe(400);
  });
});

describe("per-band storage + retrieval (list) — mixed coverage, never all-or-nothing", () => {
  it("GET /admin/liturgy/recordings always returns all seven bands, most null", async () => {
    const tok = bearer({ sub: adminId, role: "Admin", cong });
    await agent()
      .post("/v1/admin/liturgy/recordings/sunrise")
      .set("Authorization", tok)
      .field("duration_sec", "50")
      .attach("file", Buffer.from("aac-1"), { filename: "a.m4a", contentType: "audio/mp4" })
      .expect(201);

    const res = await agent().get("/v1/admin/liturgy/recordings").set("Authorization", tok);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(7);
    expect(res.body.data.map((r: { band: string }) => r.band)).toEqual([...BANDS]);
    const sunrise = res.body.data.find((r: { band: string }) => r.band === "sunrise");
    expect(sunrise.audio_url).toContain("/media/");
    expect(sunrise.duration_sec).toBe(50);
    // Every other band is untouched — recording one never blocks the rest.
    for (const row of res.body.data.filter((r: { band: string }) => r.band !== "sunrise")) {
      expect(row.audio_url).toBeNull();
      expect(row.duration_sec).toBeNull();
      expect(row.recorded_at).toBeNull();
    }
  });
});

describe("replacing a recording (upsert) — he will re-record", () => {
  it("a second upload for the same band replaces the first and removes the old file from disk", async () => {
    const tok = bearer({ sub: adminId, role: "Admin", cong });
    const first = await agent()
      .post("/v1/admin/liturgy/recordings/midday")
      .set("Authorization", tok)
      .field("duration_sec", "20")
      .attach("file", Buffer.from("take-one"), { filename: "one.m4a", contentType: "audio/mp4" });
    expect(first.status).toBe(201);
    const firstPath = join(storageDir, filenameOf(first.body.audio_url));
    expect(existsSync(firstPath)).toBe(true);

    const second = await agent()
      .post("/v1/admin/liturgy/recordings/midday")
      .set("Authorization", tok)
      .field("duration_sec", "35")
      .attach("file", Buffer.from("take-two-longer"), { filename: "two.m4a", contentType: "audio/mp4" });
    expect(second.status).toBe(201);
    expect(second.body.audio_url).not.toBe(first.body.audio_url);

    // Old file is gone; the DB (and disk) reflect only the newest take.
    expect(existsSync(firstPath)).toBe(false);
    const secondPath = join(storageDir, filenameOf(second.body.audio_url));
    expect(existsSync(secondPath)).toBe(true);

    const list = await agent().get("/v1/admin/liturgy/recordings").set("Authorization", tok);
    const midday = list.body.data.find((r: { band: string }) => r.band === "midday");
    expect(midday.audio_url).toBe(second.body.audio_url);
    expect(midday.duration_sec).toBe(35);

    const rows = await testPool().query(`SELECT count(*)::int AS n FROM liturgy_recordings WHERE congregation_id = $1 AND band = 'midday'`, [cong]);
    expect(rows.rows[0].n).toBe(1); // upsert, not a second row
  });
});

describe("deleting a recording — that band alone falls back to synthesis", () => {
  it("removes the row and the file; the band reverts to null; other bands unaffected", async () => {
    const tok = bearer({ sub: adminId, role: "Admin", cong });
    const up = await agent()
      .post("/v1/admin/liturgy/recordings/afternoon")
      .set("Authorization", tok)
      .field("duration_sec", "18")
      .attach("file", Buffer.from("afternoon-take"), { filename: "a.m4a", contentType: "audio/mp4" })
      .expect(201);
    const path = join(storageDir, filenameOf(up.body.audio_url));
    expect(existsSync(path)).toBe(true);

    const del = await agent().delete("/v1/admin/liturgy/recordings/afternoon").set("Authorization", tok);
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(true);
    expect(existsSync(path)).toBe(false);

    const list = await agent().get("/v1/admin/liturgy/recordings").set("Authorization", tok);
    const afternoon = list.body.data.find((r: { band: string }) => r.band === "afternoon");
    expect(afternoon.audio_url).toBeNull();
  });

  it("deleting a band with no recording 404s", async () => {
    const tok = bearer({ sub: adminId, role: "Admin", cong });
    const res = await agent().delete("/v1/admin/liturgy/recordings/midnight").set("Authorization", tok);
    expect(res.status).toBe(404);
  });

  it("a member (Student) cannot delete either", async () => {
    const tok = bearer({ sub: studentId, role: "Student", cong });
    const res = await agent().delete("/v1/admin/liturgy/recordings/midnight").set("Authorization", tok);
    expect(res.status).toBe(403);
  });
});

describe("LiturgyService.current() prefers the recording for the CURRENT band only", () => {
  it("a band with a recording carries recorded_audio_url; every other band still serves normally with it null", async () => {
    const recordings = new LiturgyRecordingService(testPool());
    const liturgy = new LiturgyService(testPool(), new FakeAiProvider());

    const sunrise = new Date("2026-07-11T03:00:00Z"); // 06:00 EAT → sunrise band
    const midday = new Date("2026-07-11T09:30:00Z"); // 12:30 EAT → midday band

    // Before any recording exists, both bands serve fine with recorded fields null.
    const before = await liturgy.current(cong, sunrise);
    expect(before.band).toBe("sunrise");
    expect(before.recorded_audio_url).toBeNull();
    expect(before.recorded_audio_duration_sec).toBeNull();
    expect(before.line.length).toBeGreaterThan(0); // still serves — never blocked

    await recordings.upsert(cong, "sunrise", {
      audioUrl: "http://localhost/media/liturgy_sunrise_take.m4a",
      durationSec: 61,
      recordedBy: adminId,
    });

    const after = await liturgy.current(cong, sunrise);
    expect(after.band).toBe("sunrise");
    expect(after.recorded_audio_url).toBe("http://localhost/media/liturgy_sunrise_take.m4a");
    expect(after.recorded_audio_duration_sec).toBe(61);
    expect(after.line.length).toBeGreaterThan(0); // the composed line still rides along too

    // A DIFFERENT band (midday), never recorded, is completely unaffected —
    // per-band, never all-or-nothing.
    const otherBand = await liturgy.current(cong, midday);
    expect(otherBand.band).toBe("midday");
    expect(otherBand.recorded_audio_url).toBeNull();
    expect(otherBand.recorded_audio_duration_sec).toBeNull();
  });

  it("a null congregation (no congregation on the account) still serves the fallback with recorded fields null", async () => {
    const liturgy = new LiturgyService(testPool(), new FakeAiProvider());
    const now = await liturgy.current(null, new Date("2026-07-11T03:00:00Z"));
    expect(now.recorded_audio_url).toBeNull();
    expect(now.recorded_audio_duration_sec).toBeNull();
    expect(now.line.length).toBeGreaterThan(0);
  });
});

describe("LiturgyRecordingService (unit)", () => {
  it("list() always returns all seven bands in clock order", async () => {
    const svc = new LiturgyRecordingService(testPool());
    const list = await svc.list(cong);
    expect(list.map((r) => r.band)).toEqual([...BANDS]);
    expect(list.every((r) => r.audio_url === null)).toBe(true);
  });

  it("upsert() reports the previous audio_url so the caller can clean up disk", async () => {
    const svc = new LiturgyRecordingService(testPool());
    const first = await svc.upsert(cong, "night", { audioUrl: "http://x/1.m4a", durationSec: 10, recordedBy: adminId });
    expect(first.previousAudioUrl).toBeNull();
    const second = await svc.upsert(cong, "night", { audioUrl: "http://x/2.m4a", durationSec: 20, recordedBy: adminId });
    expect(second.previousAudioUrl).toBe("http://x/1.m4a");
  });

  it("remove() throws NOT_FOUND for a band with no recording", async () => {
    const svc = new LiturgyRecordingService(testPool());
    await expect(svc.remove(cong, "night")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
