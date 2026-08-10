// Intelligence layer Phase 1 — content grounding index (FTS over our own
// teaching), the Member Story builder, the Sunday Letter job (idempotent per
// user+week), the consent covenant, and story-aware companion grounding.
// Everything runs offline on the FakeAiProvider (no key in the test env).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser, createEnrollment, createModule } from "./helpers/factories.js";
import { ContentIndexService, chunkText } from "../src/modules/intelligence/content.js";
import { StoryService } from "../src/modules/intelligence/story.js";
import { LettersService } from "../src/modules/intelligence/letters.js";
import { AssistantService } from "../src/modules/assistant/service.js";
import { FakeAiProvider, type AiCompletion } from "../src/modules/assistant/provider.js";
import { ChatService } from "../src/modules/chat/service.js";
import { ProgressService } from "../src/modules/progress/service.js";

let cong: string, cell: string, meId: string, meTok: string, adminTok: string;
const auth = (t: string) => ({ Authorization: t });

const provider = new FakeAiProvider();
const content = () => new ContentIndexService(testPool());
const story = () => new StoryService(testPool(), provider);
const letters = () => new LettersService(testPool(), provider, story(), content());

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  cell = await createCellGroup(cong, "Cell A");
  const me = await createUser({ congregationId: cong, cellGroupId: cell, email: "me@dev.local", fullName: "Ada Grace" });
  meId = me.user_id;
  meTok = bearer({ sub: meId, role: "Student", cong });
  adminTok = bearer({ sub: meId, role: "SuperAdmin", cong });
});
afterAll(async () => {
  await closeTestPool();
});

describe("content grounding index", () => {
  it("chunks long text on paragraph boundaries", () => {
    const parts = chunkText(`${"alpha ".repeat(100)}\n\n${"beta ".repeat(100)}`, 700);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts[0]).toContain("alpha");
  });

  it("indexes modules + devotionals and finds them by meaning-bearing words", async () => {
    const moduleId = await createModule(1, 1);
    await testPool().query(
      `UPDATE modules SET lesson_content = 'The covenant between Jonathan and David teaches us loyal friendship that reflects God''s faithfulness.' WHERE module_id = $1`,
      [moduleId],
    );
    await testPool().query(
      `INSERT INTO devotionals (day_number, title, scripture_ref, body)
       VALUES (999, 'Streams of Mercy', 'Lamentations 3:22-23', 'His mercies are new every morning; great is Your faithfulness.')`,
    );
    const out = await content().reindexAll();
    expect(out.chunks).toBeGreaterThanOrEqual(2);

    const hits = await content().search("covenant friendship", 4);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.ref).toContain("Level 1");

    const dev = await content().search("mercies new every morning", 4);
    expect(dev.some((h) => h.title === "Streams of Mercy")).toBe(true);
  });
});

describe("member story", () => {
  it("builds facts + an AI narrative, and skips written content when opted out", async () => {
    await createEnrollment(meId, 1);
    const moduleId = await createModule(1, 1);
    await new ProgressService(testPool()).completeModule(meId, moduleId, null);
    const prog = await testPool().query(`SELECT progress_id FROM module_progress LIMIT 1`);
    await testPool().query(
      `INSERT INTO module_reflections (progress_id, user_id, module_id, body)
       VALUES ($1, $2, $3, 'This week I learned to trust God with my family.')`,
      [prog.rows[0].progress_id, meId, moduleId],
    );

    const row = await story().rebuildFor(meId);
    expect(row).toBeTruthy();
    expect(row!.facts.name).toBe("Ada Grace");
    expect(row!.facts.modules_completed_total).toBeGreaterThanOrEqual(1);
    expect(row!.facts.reflections_recent.length).toBe(1);
    expect(row!.narrative.length).toBeGreaterThan(20);

    // Opt out → reflections excluded, narrative not generated.
    await testPool().query(`UPDATE users SET ai_opt_out = TRUE WHERE user_id = $1`, [meId]);
    const optedOut = await story().rebuildFor(meId);
    expect(optedOut!.facts.reflections_recent.length).toBe(0);
    expect(optedOut!.narrative).toBe("");
  });
});

describe("sunday letters", () => {
  it("writes one letter per member per week (idempotent) and parses the scripture line", async () => {
    await createEnrollment(meId, 1);
    await testPool().query(
      `INSERT INTO interaction_events (user_id, kind, occurred_at, client_event_id)
       VALUES ($1, 'word', now() - interval '1 day', gen_random_uuid())`,
      [meId],
    );
    const first = await letters().runWeekly();
    expect(first.written).toBe(1);
    const again = await letters().runWeekly();
    expect(again.written).toBe(0);
    expect(again.skipped).toBeGreaterThanOrEqual(1);

    const mine = await letters().list(meId);
    expect(mine.length).toBe(1);
    expect(mine[0]!.scripture_ref).toBe("Philippians 1:6");
    expect(mine[0]!.body).toContain("Nuru Place");
  });

  it("skips opted-out members entirely", async () => {
    await createEnrollment(meId, 1);
    await testPool().query(`UPDATE users SET ai_opt_out = TRUE WHERE user_id = $1`, [meId]);
    await testPool().query(
      `INSERT INTO interaction_events (user_id, kind, occurred_at, client_event_id)
       VALUES ($1, 'word', now(), gen_random_uuid())`,
      [meId],
    );
    const out = await letters().runWeekly();
    expect(out.written).toBe(0);
  });

  it("serves letters over HTTP: latest → read → admin single-user run", async () => {
    await createEnrollment(meId, 1);
    const run = await agent()
      .post("/v1/admin/intelligence/letters/run")
      .set(auth(adminTok))
      .send({ user_id: meId });
    expect(run.status).toBe(200);
    expect(run.body.written).toBe(1);

    const latest = await agent().get("/v1/me/letters/latest").set(auth(meTok));
    expect(latest.status).toBe(200);
    expect(latest.body.letter.read_at).toBeNull();

    const read = await agent().post(`/v1/me/letters/${latest.body.letter.letter_id}/read`).set(auth(meTok));
    expect(read.status).toBe(200);
    expect(read.body.read_at).toBeTruthy();

    const list = await agent().get("/v1/me/letters").set(auth(meTok));
    expect(list.body.data.length).toBe(1);
  });
});

describe("AI usage observability", () => {
  it("aggregates recorded events by feature/tier/provider/model (Admin+ only)", async () => {
    await testPool().query(
      `INSERT INTO ai_usage_events (feature, tier, provider, model, input_tokens, output_tokens, latency_ms, success)
       VALUES ('assistant_chat', 'standard', 'anthropic', 'claude-sonnet-5', 100, 50, 800, TRUE),
              ('assistant_chat', 'standard', 'anthropic', 'claude-sonnet-5', 120, 60, 900, TRUE),
              ('sunday_letter', 'deep', 'anthropic', 'claude-opus-5', 500, 300, 4000, FALSE)`,
    );
    const res = await agent().get("/v1/admin/intelligence/ai-usage").set(auth(adminTok));
    expect(res.status).toBe(200);
    expect(res.body.total_calls).toBe(3);
    const chatRow = res.body.rows.find((r: { feature: string }) => r.feature === "assistant_chat");
    expect(chatRow.calls).toBe(2);
    expect(chatRow.total_input_tokens).toBe(220);
    expect(chatRow.total_output_tokens).toBe(110);
    const letterRow = res.body.rows.find((r: { feature: string }) => r.feature === "sunday_letter");
    expect(letterRow.failures).toBe(1);
    expect(res.body.total_estimated_cost_usd).toBeGreaterThan(0);
  });

  it("is not reachable by a member", async () => {
    const res = await agent().get("/v1/admin/intelligence/ai-usage").set(auth(meTok));
    expect(res.status).toBe(403);
  });

  it("wiring a real HTTP chat call through registerAssistant's buildAiProvider(env, recorder) never throws — offline (FakeAiProvider) writes no events, by design", async () => {
    const chat = await agent().post("/v1/assistant/chat").set(auth(meTok)).send({ messages: [{ role: "user", text: "Hello, how are you today?" }] });
    expect(chat.status).toBe(200);
    // No ANTHROPIC/GROQ/GEMINI key in the test env → FakeAiProvider, which
    // never calls the recorder (there is nothing real to bill or time).
    const res = await agent().get("/v1/admin/intelligence/ai-usage").set(auth(adminTok));
    expect(res.status).toBe(200);
    expect(res.body.rows.find((r: { feature: string }) => r.feature === "assistant_chat")).toBeUndefined();
  });
});

describe("consent covenant", () => {
  it("flips ai_opt_out and deletes the story on opt-out", async () => {
    await createEnrollment(meId, 1);
    await story().rebuildFor(meId);
    const before = await agent().get("/v1/me/ai").set(auth(meTok));
    expect(before.body.opt_out).toBe(false);

    const set = await agent().post("/v1/me/ai/consent").set(auth(meTok)).send({ opt_out: true });
    expect(set.body.opt_out).toBe(true);
    const gone = await testPool().query(`SELECT 1 FROM member_story WHERE user_id = $1`, [meId]);
    expect(gone.rowCount).toBe(0);

    const after = await agent().get("/v1/me/ai").set(auth(meTok));
    expect(after.body.opt_out).toBe(true);
  });
});

describe("story-aware companion", () => {
  it("injects the member's narrative + own-teaching citations into the system prompt", async () => {
    await createEnrollment(meId, 1);
    const moduleId = await createModule(1, 1);
    await testPool().query(
      `UPDATE modules SET lesson_content = 'Prayer is covenant conversation: we speak, God answers, faith grows.' WHERE module_id = $1`,
      [moduleId],
    );
    await content().reindexAll();
    await story().rebuildFor(meId);

    const seen: AiCompletion[] = [];
    const capturing = {
      name: "capture",
      complete: (input: AiCompletion) => {
        seen.push(input);
        return Promise.resolve("ok");
      },
    };
    const st = story();
    const ct = content();
    const svc = new AssistantService(testPool(), capturing, new ChatService(testPool()), {
      forUser: (uid) => st.forCompanion(uid),
      search: (q, k) => ct.search(q, k),
    });
    await svc.chat(meId, { messages: [{ role: "user", text: "How do I grow in prayer and covenant conversation?" }] });
    // The thin 1-chunk corpus (< k=3) also triggers one search_expansion call
    // alongside the main reply — filter to the actual chat reply, not by index.
    const mainCalls = () => seen.filter((c) => c.feature === "assistant_chat");
    expect(mainCalls()).toHaveLength(1);
    const sys = mainCalls()[0]!.system;
    expect(sys).toContain("About this member");
    expect(sys).toContain("Level 1 · Module 1"); // citation of our own teaching
    expect(sys).toContain("Befrienders Kenya"); // guardrails ride along

    // Opt-out → no personal grounding block.
    await testPool().query(`UPDATE users SET ai_opt_out = TRUE WHERE user_id = $1`, [meId]);
    await svc.chat(meId, { messages: [{ role: "user", text: "How do I grow in prayer?" }] });
    expect(mainCalls()).toHaveLength(2);
    expect(mainCalls()[1]!.system).not.toContain("About this member");
  });
});
