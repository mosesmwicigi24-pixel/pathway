// Nuru assistant proxy (mobile NuruAssistant). Tests run against the offline
// FakeAiProvider (no GEMINI_API_KEY in the suite). Verifies the endpoint replies,
// and that grounding is privacy-safe: Nuru only sees a conversation the member
// can actually access (§5.4) — otherwise 404.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser } from "./helpers/factories.js";
import { AssistantService } from "../src/modules/assistant/service.js";
import type { AiCompletion, AiProvider } from "../src/modules/assistant/provider.js";

let cong: string, cellA: string, cellB: string;
let aTok: string, bTok: string;
let aUserId: string;
const auth = (t: string) => ({ Authorization: t });
const uuid = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  cellA = await createCellGroup(cong, "Cell A");
  cellB = await createCellGroup(cong, "Cell B");
  const a = await createUser({ congregationId: cong, cellGroupId: cellA, email: "a@dev.local", fullName: "Ada" });
  const b = await createUser({ congregationId: cong, cellGroupId: cellB, email: "b@dev.local", fullName: "Cara" });
  aUserId = a.user_id;
  aTok = bearer({ sub: a.user_id, role: "Student", cong });
  bTok = bearer({ sub: b.user_id, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

describe("Nuru assistant", () => {
  it("replies to a prompt (offline fake provider)", async () => {
    const res = await agent().post("/v1/assistant/chat").set(auth(aTok))
      .send({ messages: [{ role: "user", text: "Draft an encouragement for my friend" }] });
    expect(res.status).toBe(200);
    expect(typeof res.body.reply).toBe("string");
    expect(res.body.reply.length).toBeGreaterThan(0);
  });

  it("can ground on a conversation the member belongs to", async () => {
    // 'a' has a group room; seed a message so there's a transcript.
    const list = await agent().get("/v1/chat/conversations").set(auth(aTok));
    const g = (list.body.conversations as Array<{ conversation_id: string; kind: string }>).find((c) => c.kind === "group")!.conversation_id;
    await agent().post(`/v1/chat/conversations/${g}/messages`).set(auth(aTok)).send({ message_id: uuid(1), body: "Please pray for my exams" });

    const res = await agent().post("/v1/assistant/chat").set(auth(aTok))
      .send({ messages: [{ role: "user", text: "Summarize my cohort" }], conversation_id: g });
    expect(res.status).toBe(200);
    expect(res.body.reply.length).toBeGreaterThan(0);
  });

  it("refuses to ground on a conversation outside the member's scope (404, no leak)", async () => {
    const list = await agent().get("/v1/chat/conversations").set(auth(aTok));
    const gA = (list.body.conversations as Array<{ conversation_id: string; kind: string }>).find((c) => c.kind === "group")!.conversation_id;
    // 'b' (different cell) cannot ground Nuru on cell A's room.
    const res = await agent().post("/v1/assistant/chat").set(auth(bTok))
      .send({ messages: [{ role: "user", text: "What did they say?" }], conversation_id: gA });
    expect(res.status).toBe(404);
  });

  it("rejects an empty message list", async () => {
    const res = await agent().post("/v1/assistant/chat").set(auth(aTok)).send({ messages: [] });
    expect([400, 422]).toContain(res.status);
  });

  it("persists the Nuru thread and returns it from history (private per member)", async () => {
    const empty = await agent().get("/v1/assistant/history").set(auth(aTok));
    expect(empty.status).toBe(200);
    expect(empty.body.messages).toEqual([]);

    await agent().post("/v1/assistant/chat").set(auth(aTok))
      .send({ messages: [{ role: "user", text: "Help me plan a quiet time" }] });

    const hist = await agent().get("/v1/assistant/history").set(auth(aTok));
    const msgs = hist.body.messages as Array<{ role: string; text: string }>;
    expect(msgs.length).toBe(2); // the user turn + Nuru's reply
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].text).toBe("Help me plan a quiet time");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].text.length).toBeGreaterThan(0);

    const other = await agent().get("/v1/assistant/history").set(auth(bTok));
    expect((other.body.messages as unknown[]).length).toBe(0); // another member can't see it
  });
});

describe("companion search-expansion grounding (semantic-ish lift over FTS)", () => {
  it("only expands when the primary search comes back thin, and merges the two result sets", async () => {
    const calls: AiCompletion[] = [];
    const searchQueries: string[] = [];
    const provider: AiProvider = {
      name: "stub",
      complete: (input) => {
        calls.push(input);
        if (input.feature === "search_expansion") return Promise.resolve("fear anxiety courage");
        return Promise.resolve("Here is my reply.");
      },
    };
    const svc = new AssistantService(testPool(), provider, undefined, {
      forUser: () => Promise.resolve(null),
      search: (q, _k) => {
        searchQueries.push(q);
        // Primary search (the member's own text) comes back thin (1 < k=3) —
        // this should trigger exactly one expansion call + a second search.
        if (q === "I'm scared about my exam tomorrow") return Promise.resolve([{ title: "Trust", ref: "Ps 56:3", body: "..." }]);
        return Promise.resolve([{ title: "Courage", ref: "Josh 1:9", body: "..." }]);
      },
    });

    const res = await svc.chat(aUserId, { messages: [{ role: "user", text: "I'm scared about my exam tomorrow" }] });
    expect(res.reply).toBe("Here is my reply.");
    expect(calls.filter((c) => c.feature === "search_expansion")).toHaveLength(1);
    expect(searchQueries).toEqual(["I'm scared about my exam tomorrow", "fear anxiety courage"]);
  });

  it("skips the expansion call entirely when the primary search already returns k results", async () => {
    const calls: AiCompletion[] = [];
    const searchQueries: string[] = [];
    const provider: AiProvider = {
      name: "stub",
      complete: (input) => {
        calls.push(input);
        return Promise.resolve("Here is my reply.");
      },
    };
    const svc = new AssistantService(testPool(), provider, undefined, {
      forUser: () => Promise.resolve(null),
      search: (q, k) => {
        searchQueries.push(q);
        return Promise.resolve(Array.from({ length: k }, (_, i) => ({ title: `Hit ${i}`, ref: null, body: "..." })));
      },
    });

    await svc.chat(aUserId, { messages: [{ role: "user", text: "Tell me about prayer and fasting" }] });
    expect(calls.some((c) => c.feature === "search_expansion")).toBe(false);
    expect(searchQueries).toEqual(["Tell me about prayer and fasting"]); // only the primary search ran
  });

  it("falls back to the primary (possibly empty) results when expansion fails — grounding never blocks the chat", async () => {
    const searchQueries: string[] = [];
    const provider: AiProvider = {
      name: "stub",
      complete: (input) => {
        if (input.feature === "search_expansion") return Promise.reject(new Error("model down"));
        return Promise.resolve("Reply anyway.");
      },
    };
    const svc = new AssistantService(testPool(), provider, undefined, {
      forUser: () => Promise.resolve(null),
      search: (q) => {
        searchQueries.push(q);
        return Promise.resolve([]);
      },
    });

    const res = await svc.chat(aUserId, { messages: [{ role: "user", text: "Please pray for my family" }] });
    expect(res.reply).toBe("Reply anyway.");
    expect(searchQueries).toEqual(["Please pray for my family"]); // no second search after the failed expansion
  });
});
