// Leadership intelligence — the Member Intelligence cockpit gains a
// `formation` block (waves 1-3 + spiritual growth aggregates) and the portal
// Member Profile can read any member's walk. Both leadership-only.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { agent, bearer } from "./helpers/app.js";
import {
  createCongregation,
  createCellGroup,
  createUser,
  createEnrollment,
  createModule,
  markContentConsumed,
  completeModule,
} from "./helpers/factories.js";

let cong: string, memberId: string, moduleId: string;
let adminTok: string, studentTok: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  const cell = await createCellGroup(cong, "Cell A");
  const adminId = (await createUser({ congregationId: cong, fullName: "Ada Admin", role: "SuperAdmin" })).user_id;
  memberId = (await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Sam Student" })).user_id;
  await createEnrollment(memberId, 1);
  moduleId = await createModule(1, 1);
  adminTok = bearer({ sub: adminId, role: "SuperAdmin", cong });
  studentTok = bearer({ sub: memberId, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

describe("member intelligence formation block", () => {
  it("aggregates formation, companion, voice-note and cell-reading intel", async () => {
    await markContentConsumed(memberId, moduleId);
    await completeModule(memberId, moduleId);
    await testPool().query(
      `UPDATE module_reflections SET body = 'The Lord is teaching me patience with my family this season.'`,
    );
    await testPool().query(
      `INSERT INTO echo_log (user_id, day_date, kind, body) VALUES ($1, current_date, 'welcome_back', 'You are back.')`,
      [memberId],
    );
    await testPool().query(
      `INSERT INTO module_voice_notes (module_id, congregation_id, author_user_id, audio_url, duration_sec)
       VALUES ($1, $2, $3, 'https://media.dev.local/v.m4a', 60)`,
      [moduleId, cong, memberId],
    );

    const res = await agent().get("/v1/admin/analytics/intelligence").set("Authorization", adminTok);
    expect(res.status).toBe(200);
    const f = res.body.formation;
    expect(f).toBeTruthy();
    expect(f.weekly).toHaveLength(8);
    expect(f.weekly.at(-1).modules).toBe(1);
    expect(f.reflections.total).toBe(1);
    expect(f.reflections.latest[0].excerpt).toContain("patience");
    expect(f.reflections.latest[0].first_name).toBe("Sam");
    expect(f.companion.welcome_backs_7d).toBe(1);
    expect(f.voice_notes[0].notes).toBe(1);
    const cellA = f.cells_reading.find((c: { cell: string }) => c.cell === "Cell A");
    expect(cellA.members).toBe(1);
    expect(f.totals.readers_7d).toBeGreaterThanOrEqual(0);
  });

  it("stays leadership-only", async () => {
    const res = await agent().get("/v1/admin/analytics/intelligence").set("Authorization", studentTok);
    expect(res.status).toBe(403);
  });
});

describe("admin member walk", () => {
  it("returns the member's walk for the profile page", async () => {
    await markContentConsumed(memberId, moduleId);
    await completeModule(memberId, moduleId);
    const res = await agent().get(`/v1/admin/members/${memberId}/walk`).set("Authorization", adminTok);
    expect(res.status).toBe(200);
    const kinds = res.body.data.map((e: { kind: string }) => e.kind);
    expect(kinds).toContain("began");
    expect(kinds).toContain("module");
  });

  it("is not reachable by members", async () => {
    const res = await agent().get(`/v1/admin/members/${memberId}/walk`).set("Authorization", studentTok);
    expect(res.status).toBe(403);
  });
});
