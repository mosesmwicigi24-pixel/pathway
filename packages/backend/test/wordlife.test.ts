// Per-member "Word & Reading life" (wordlife module) for the admin Member Profile.
// Verifies the dossier reflects real practice, the coaching insight reacts to the
// data, prayer is never surfaced (§5.4), and the endpoint is RBAC-gated.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser } from "./helpers/factories.js";
import { WordLifeService } from "../src/modules/wordlife/service.js";

let cong: string, cell: string, memberId: string, memberTok: string, adminTok: string;
const auth = (t: string) => ({ Authorization: t });

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  cell = await createCellGroup(cong, "Cell A");
  const member = await createUser({ congregationId: cong, cellGroupId: cell, email: "m@dev.local", fullName: "Ada" });
  memberId = member.user_id;
  memberTok = bearer({ sub: memberId, role: "Student", cong });
  adminTok = bearer({ sub: "00000000-0000-4000-8000-0000000000aa", role: "Admin", cong });
});
afterAll(async () => {
  await closeTestPool();
});

describe("GET /admin/members/:id/word-life", () => {
  it("reflects real practice and never surfaces prayer (§5.4)", async () => {
    // Member masters a verse — emits a 'word' rhythm tick and sets mastery.
    const list = await agent().get("/v1/growth/memory-verses").set(auth(memberTok));
    const vid = (list.body.data as Array<{ memory_verse_id: string }>)[0]!.memory_verse_id;
    await agent().post("/v1/growth/memory-verses/practice").set(auth(memberTok)).send({ memory_verse_id: vid, match_pct: 96 });

    const res = await agent().get(`/v1/admin/members/${memberId}/word-life`).set(auth(adminTok));
    expect(res.status).toBe(200);
    expect(res.body.word_score.score).toBeGreaterThanOrEqual(0);
    expect(res.body.word_score.score).toBeLessThanOrEqual(100);
    expect(res.body.memorization.verses_mastered).toBeGreaterThanOrEqual(1);
    expect(res.body.rhythm.word_days_30).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.insight.profile).toBe("string");
    expect(typeof res.body.insight.headline).toBe("string");
    // Prayer must never appear in a per-member admin view (§5.4).
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain("prayer");
  });

  it("flags a member with no Word activity as dormant", async () => {
    const res = await agent().get(`/v1/admin/members/${memberId}/word-life`).set(auth(adminTok));
    expect(res.status).toBe(200);
    expect(res.body.memorization.verses_mastered).toBe(0);
    expect(res.body.insight.profile).toBe("dormant");
  });

  it("is not accessible to a non-admin member", async () => {
    const res = await agent().get(`/v1/admin/members/${memberId}/word-life`).set(auth(memberTok));
    expect(res.status).toBe(403);
  });

  it("404s for an unknown member id (matches memberDetail semantics)", async () => {
    const res = await agent().get(`/v1/admin/members/00000000-0000-4000-8000-0000000000ff/word-life`).set(auth(adminTok));
    expect(res.status).toBe(404);
  });
});

describe("WordLifeService.insight (pure)", () => {
  it("calls out a reader who isn't memorizing", () => {
    expect(WordLifeService.insight({ reads30: 6, mastered: 0, engaged: 0, reading: 3 }).profile).toBe("reader_not_memorizer");
  });
  it("calls out a memorizer who rarely opens the Word", () => {
    expect(WordLifeService.insight({ reads30: 0, mastered: 3, engaged: 4, reading: 0 }).profile).toBe("memorizer_not_reader");
  });
  it("recognizes a balanced rhythm", () => {
    expect(WordLifeService.insight({ reads30: 8, mastered: 5, engaged: 10, reading: 12 }).profile).toBe("balanced");
  });
  it("treats no activity as dormant", () => {
    expect(WordLifeService.insight({ reads30: 0, mastered: 0, engaged: 0, reading: 0 }).profile).toBe("dormant");
  });
});
