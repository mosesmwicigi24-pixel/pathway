// AI Prayer Points (Prayer Room tab 4, docs: prayer-room-arc). Gemini-in-Gmail
// style prayer assist (seeded + starter), the corpus generator (reads across
// Selah thoughts + private prayers + published prayer-wall posts, scoped
// strictly to the caller), and the AI consent gate (§1.1). Runs entirely on
// the FakeAiProvider — the test env has no provider key configured.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { PrayerAiService } from "../src/modules/intelligence/prayer.js";
import type { AiCompletion } from "../src/modules/assistant/provider.js";

let cong: string, me: string, meTok: string, other: string, otherTok: string;
const auth = (t: string) => ({ Authorization: t });
const uuid = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  const a = await createUser({ congregationId: cong, email: "me@dev.local" });
  const b = await createUser({ congregationId: cong, email: "other@dev.local" });
  me = a.user_id;
  other = b.user_id;
  meTok = bearer({ sub: me, role: "Student", cong });
  otherTok = bearer({ sub: other, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

describe("prayer assist — Gemini-in-Gmail style draft", () => {
  it("drafts a gentle starter prayer when given no seed", async () => {
    const res = await agent().post("/v1/me/prayer/assist").set(auth(meTok)).send({});
    expect(res.status).toBe(200);
    expect(typeof res.body.suggestion).toBe("string");
    expect(res.body.suggestion.length).toBeGreaterThan(0);
  });

  it("drafts from a member's seed points, in their own voice", async () => {
    const res = await agent()
      .post("/v1/me/prayer/assist")
      .set(auth(meTok))
      .send({ seed: "worried about my exams; grateful for my cell group" });
    expect(res.status).toBe(200);
    expect(res.body.suggestion.length).toBeGreaterThan(0);
  });

  it("never persists anything — it is a suggestion only", async () => {
    await agent().post("/v1/me/prayer/assist").set(auth(meTok)).send({ seed: "for my family" });
    const rows = await testPool().query(`SELECT 1 FROM prayer_entries WHERE user_id = $1`, [me]);
    expect(rows.rowCount).toBe(0);
  });

  it("refuses when the member has opted out of AI (403 CONSENT_REQUIRED)", async () => {
    await testPool().query(`UPDATE users SET ai_opt_out = TRUE WHERE user_id = $1`, [me]);
    const res = await agent().post("/v1/me/prayer/assist").set(auth(meTok)).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CONSENT_REQUIRED");
  });

  it("requires authentication", async () => {
    const res = await agent().post("/v1/me/prayer/assist").send({});
    expect(res.status).toBe(401);
  });
});

describe("prayer points — the corpus generator", () => {
  it("returns an empty list when the member has written nothing yet", async () => {
    const res = await agent().post("/v1/me/prayer/points").set(auth(meTok));
    expect(res.status).toBe(200);
    expect(res.body.points).toEqual([]);
  });

  it("summarizes across the member's own thoughts + private prayers + published prayers", async () => {
    await agent()
      .put("/v1/me/thoughts")
      .set(auth(meTok))
      .send({ thought_id: uuid(1), body: "Grateful for how steady this season has felt." });
    await agent()
      .put("/v1/me/prayers")
      .set(auth(meTok))
      .send({ entry_id: uuid(2), body: "Pray for strength with my family relationships." });
    await agent()
      .post("/v1/prayer-wall")
      .set(auth(meTok))
      .send({ post_id: uuid(3), body: "Please stand with me for wisdom this week." });

    const res = await agent().post("/v1/me/prayer/points").set(auth(meTok));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.points)).toBe(true);
    expect(res.body.points.length).toBeGreaterThan(0);
    for (const p of res.body.points) {
      expect(typeof p).toBe("string");
      expect(p.length).toBeGreaterThan(0);
    }
  });

  it("is read-only over the CALLER's data — the corpus sent to the AI never contains another member's thoughts/prayers", async () => {
    await agent().put("/v1/me/thoughts").set(auth(otherTok)).send({ thought_id: uuid(10), body: "SOMEONE_ELSES_SECRET_THOUGHT" });
    await agent().put("/v1/me/prayers").set(auth(otherTok)).send({ entry_id: uuid(11), body: "SOMEONE_ELSES_SECRET_PRAYER" });
    await agent()
      .post("/v1/prayer-wall")
      .set(auth(otherTok))
      .send({ post_id: uuid(13), body: "SOMEONE_ELSES_SECRET_WALL_POST" });
    await agent().put("/v1/me/thoughts").set(auth(meTok)).send({ thought_id: uuid(12), body: "MY_OWN_THOUGHT_ABOUT_PATIENCE" });

    const seen: AiCompletion[] = [];
    const capturing = {
      name: "capture",
      complete: (input: AiCompletion) => {
        seen.push(input);
        return Promise.resolve("A prayer point");
      },
    };
    const svc = new PrayerAiService(testPool(), capturing);
    const out = await svc.points(me);
    expect(out.points).toEqual(["A prayer point"]);
    expect(seen.length).toBe(1);
    const corpus = seen[0]!.messages[0]!.text;
    expect(corpus).toContain("MY_OWN_THOUGHT_ABOUT_PATIENCE");
    expect(corpus).not.toContain("SOMEONE_ELSES_SECRET_THOUGHT");
    expect(corpus).not.toContain("SOMEONE_ELSES_SECRET_PRAYER");
    expect(corpus).not.toContain("SOMEONE_ELSES_SECRET_WALL_POST");
  });

  it("refuses when the member has opted out of AI (403 CONSENT_REQUIRED)", async () => {
    await agent().put("/v1/me/thoughts").set(auth(meTok)).send({ thought_id: uuid(20), body: "Something to summarize." });
    await testPool().query(`UPDATE users SET ai_opt_out = TRUE WHERE user_id = $1`, [me]);
    const res = await agent().post("/v1/me/prayer/points").set(auth(meTok));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CONSENT_REQUIRED");
  });

  it("requires authentication", async () => {
    const res = await agent().post("/v1/me/prayer/points");
    expect(res.status).toBe(401);
  });
});
