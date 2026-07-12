// Wave 2 of companion presence — a discipler's voice on the lesson, and the
// quiet knowledge that your cell is studying alongside you.
//   • module_voice_notes: one per (module, congregation); Instructor+ only;
//     re-recording upserts; other congregations never see it.
//   • GET /community/presence: cell-mates active in the last 7 days (self
//     excluded), falling back to the congregation when the member is cell-less.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { agent, bearer } from "./helpers/app.js";
import {
  createCongregation,
  createCellGroup,
  createUser,
  createEnrollment,
  createModule,
} from "./helpers/factories.js";

let cong: string, otherCong: string, cell: string;
let studentId: string, leaderId: string, moduleId: string;
let studentTok: string, leaderTok: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  otherCong = await createCongregation();
  cell = await createCellGroup(cong, "Cell A");
  leaderId = (await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Leah Leader", role: "Instructor" })).user_id;
  studentId = (await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Sam Student" })).user_id;
  await createEnrollment(studentId, 1);
  moduleId = await createModule(1, 1);
  studentTok = bearer({ sub: studentId, role: "Student", cong });
  leaderTok = bearer({ sub: leaderId, role: "Instructor", cong });
});
afterAll(async () => {
  await closeTestPool();
});

const NOTE = { audio_url: "https://media.dev.local/voice/m1.m4a", duration_sec: 42 };

async function engage(userId: string, daysAgo: number): Promise<void> {
  await testPool().query(
    `INSERT INTO module_engagement (user_id, module_id, reading_seconds, updated_at)
     VALUES ($1, $2, 120, now() - make_interval(days => $3))
     ON CONFLICT (user_id, module_id) DO UPDATE SET updated_at = EXCLUDED.updated_at`,
    [userId, moduleId, daysAgo],
  );
}

describe("module voice notes", () => {
  it("a Student may not leave a voice note", async () => {
    const res = await agent().post(`/v1/modules/${moduleId}/voice-note`).set("Authorization", studentTok).send(NOTE);
    expect(res.status).toBe(403);
  });

  it("an Instructor leaves one; re-recording replaces it (upsert)", async () => {
    const first = await agent().post(`/v1/modules/${moduleId}/voice-note`).set("Authorization", leaderTok).send(NOTE);
    expect(first.status).toBe(201);

    const second = await agent()
      .post(`/v1/modules/${moduleId}/voice-note`)
      .set("Authorization", leaderTok)
      .send({ ...NOTE, audio_url: "https://media.dev.local/voice/m1-v2.m4a", duration_sec: 61 });
    expect(second.status).toBe(201);

    const rows = await testPool().query(
      `SELECT audio_url, duration_sec FROM module_voice_notes WHERE module_id = $1 AND congregation_id = $2`,
      [moduleId, cong],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].audio_url).toContain("m1-v2");
    expect(rows.rows[0].duration_sec).toBe(61);
  });

  it("members see their congregation's note on the module payload; other congregations do not", async () => {
    await agent().post(`/v1/modules/${moduleId}/voice-note`).set("Authorization", leaderTok).send(NOTE);

    const mine = await agent().get(`/v1/modules/${moduleId}`).set("Authorization", studentTok);
    expect(mine.status).toBe(200);
    expect(mine.body.voice_note?.author_name).toBe("Leah Leader");
    expect(mine.body.voice_note?.duration_sec).toBe(42);

    const strangerId = (await createUser({ congregationId: otherCong, fullName: "Otis Other" })).user_id;
    await createEnrollment(strangerId, 1);
    const theirs = await agent()
      .get(`/v1/modules/${moduleId}`)
      .set("Authorization", bearer({ sub: strangerId, role: "Student", cong: otherCong }));
    expect(theirs.status).toBe(200);
    expect(theirs.body.voice_note ?? null).toBeNull();
  });

  it("the author can remove their note", async () => {
    await agent().post(`/v1/modules/${moduleId}/voice-note`).set("Authorization", leaderTok).send(NOTE);
    const del = await agent().delete(`/v1/modules/${moduleId}/voice-note`).set("Authorization", leaderTok);
    expect(del.status).toBe(200);
    const rows = await testPool().query(`SELECT 1 FROM module_voice_notes`);
    expect(rows.rowCount).toBe(0);
  });
});

describe("community presence", () => {
  it("counts cell-mates active in the last 7 days, excluding me and the inactive", async () => {
    await engage(leaderId, 2); // active cell-mate
    await engage(studentId, 1); // me — must not count
    const idle = (await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Ida Idle" })).user_id;
    await engage(idle, 12); // too long ago

    const res = await agent().get("/v1/community/presence").set("Authorization", studentTok);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.names).toEqual(["Leah"]);
    expect(res.body.scope).toBe("cell");
  });

  it("falls back to the congregation when the member has no cell", async () => {
    const loneId = (await createUser({ congregationId: cong, fullName: "Lone Member" })).user_id;
    await engage(leaderId, 3);
    const res = await agent()
      .get("/v1/community/presence")
      .set("Authorization", bearer({ sub: loneId, role: "Student", cong }));
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.scope).toBe("congregation");
  });
});
