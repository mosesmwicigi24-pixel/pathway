// Nuru: the in-app AI companion (mobile make's NuruAssistant). Server-side proxy
// so the provider key never reaches the client (§5.10). Pastoral + privacy-safe:
// Nuru only ever grounds on a conversation the member can actually access
// (membership re-checked via ChatService → 404 otherwise), never on other
// members' private data. Conversation history is client-held and replayed each
// turn (the make keeps the Nuru thread ephemeral on-device).
import type { Pool } from "pg";
import { z } from "zod";
import { many } from "../../db/db.js";
import { ChatService } from "../chat/service.js";
import type { AiProvider } from "./provider.js";
import { companionGrounding, SEARCH_EXPANSION_SYSTEM } from "../intelligence/prompts.js";

/** Member Story + own-teaching retrieval, injected by registerAssistant. All
 *  grounding is best-effort: a failure must never block the member's chat. */
export interface AssistantGrounding {
  forUser(userId: string): Promise<{ narrative: string; factsLine: string } | null>;
  search(query: string, k: number): Promise<Array<{ title: string; ref: string | null; body: string }>>;
}

const NURU_SYSTEM = `You are Nuru, a warm, encouraging AI companion inside the Nuru Place discipleship app.
You help members of a church grow: summarize a conversation, draft an encouragement, surface prayer requests, or help plan a quiet time.
Style: gentle, hopeful, concise (a few sentences). You may reference Scripture lightly and pastorally.
Boundaries: never invent facts about other members or their private data; only use context you are given. Do not give medical, legal, or financial advice — gently point the member to a leader or professional. Encourage, never shame.`;

export class AssistantService {
  constructor(
    private readonly pool: Pool,
    private readonly provider: AiProvider,
    private readonly chatSvc = new ChatService(pool),
    private readonly grounding?: AssistantGrounding,
  ) {}

  static readonly Chat = z.object({
    messages: z
      .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().min(1).max(8000) }))
      .min(1)
      .max(40),
    conversation_id: z.string().uuid().optional(), // ground the answer on a chat the member can access
    context_limit: z.coerce.number().int().min(1).max(20).optional(), // recent messages to read (default 5)
  });

  /** How many recent messages Nuru reads for context (the "immediate" window). */
  static readonly DEFAULT_CONTEXT = 5;

  async chat(userId: string, input: z.infer<typeof AssistantService.Chat>): Promise<{ reply: string }> {
    let system = NURU_SYSTEM;
    if (input.conversation_id) {
      // Membership re-checked here — getConversation throws 404 outside the member's scope.
      const convo = (await this.chatSvc.getConversation(userId, input.conversation_id)) as {
        title?: string;
        messages: Array<{ author_name: string; body: string }>;
      };
      const limit = input.context_limit ?? AssistantService.DEFAULT_CONTEXT;
      const recent = convo.messages.slice(-limit);
      const transcript = recent.map((m) => `${m.author_name}: ${m.body}`).join("\n");
      system +=
        `\n\nYou are assisting inside the conversation "${convo.title ?? "a chat"}". ` +
        `Read these last ${recent.length} message(s) (oldest→newest) and let them guide your reply. ` +
        `Ground everything ONLY in this transcript — do not invent anything beyond it:\n${transcript}\n\n` +
        `If asked to suggest or draft a reply, respond with a single natural message the member could send next — no preamble, no quotes, no options list.`;
    }
    // Story-aware grounding (intelligence layer): the member's own story +
    // relevant excerpts of Nuru Place's own teaching. Opt-out → forUser()
    // returns null and nothing personal is injected. Best-effort by design.
    if (this.grounding) {
      try {
        const me = await this.grounding.forUser(userId);
        const lastUserText = [...input.messages].reverse().find((m) => m.role === "user")?.text ?? "";
        const chunks = lastUserText.length >= 8 ? await this.searchWithExpansion(lastUserText, 3) : [];
        system += companionGrounding(me?.narrative ?? "", me?.factsLine ?? "", chunks);
      } catch {
        /* grounding must never block the chat */
      }
    }
    // effort: "low" — this is a live chat the member is waiting on; adaptive
    // thinking is on by default on the standard-tier model and low effort
    // keeps the reply snappy without giving up Claude's quality over Fake/Groq.
    const reply = await this.provider.complete({ system, messages: input.messages, feature: "assistant_chat", effort: "low" });
    // Persist this exchange so the Nuru thread is retrievable across sessions
    // (best-effort — a storage hiccup must never swallow the member's reply).
    const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
    try {
      if (lastUser) await this.persist(userId, "user", lastUser.text);
      await this.persist(userId, "assistant", reply);
    } catch {
      /* non-fatal */
    }
    return { reply };
  }

  /** "Semantic-ish" search lift over our keyword (Postgres FTS) content index,
   *  without a new embeddings provider/vector store. websearch_to_tsquery ANDs
   *  bare words together, so naively appending AI-generated keywords to the
   *  member's own text would make the query MORE restrictive and could return
   *  FEWER results than the plain search — the opposite of the point. Instead:
   *  run the member's own text first; only if that comes back thin (fewer
   *  than `k` hits) ask a cheap fast-tier model for a handful of the topical/
   *  theological keywords a keyword search alone would miss (e.g. "I'm scared
   *  about my exam" → "fear anxiety courage trust exam"), run that as a
   *  SEPARATE search, and merge+dedupe. This also means the extra AI
   *  round-trip only happens when it can actually help — most questions that
   *  already match plenty of content skip it entirely, which keeps the common
   *  case fast. Best-effort throughout: any failure just returns what the
   *  primary search already found — grounding must never block the chat. */
  private async searchWithExpansion(
    query: string,
    k: number,
  ): Promise<Array<{ title: string; ref: string | null; body: string }>> {
    const primary = await this.grounding!.search(query, k);
    if (primary.length >= k) return primary;
    let expansion = "";
    try {
      expansion = (
        await this.provider.complete({
          system: SEARCH_EXPANSION_SYSTEM,
          messages: [{ role: "user", text: query }],
          tier: "fast",
          maxTokens: 40,
          feature: "search_expansion",
        })
      )
        .trim()
        .slice(0, 200);
    } catch {
      return primary;
    }
    if (!expansion) return primary;
    const extra = await this.grounding!.search(expansion, k - primary.length).catch(() => []);
    const seen = new Set(primary.map((c) => `${c.title}|${c.ref ?? ""}`));
    const merged = [...primary];
    for (const c of extra) {
      const key = `${c.title}|${c.ref ?? ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(c);
      }
    }
    return merged.slice(0, k);
  }

  private async persist(userId: string, role: "user" | "assistant", text: string): Promise<void> {
    await this.pool.query(`INSERT INTO assistant_messages (user_id, role, text) VALUES ($1, $2, $3)`, [userId, role, text]);
  }

  /** The member's saved Nuru thread, oldest→newest (their own only, §5.4). */
  async history(userId: string, limit = 200): Promise<{ messages: Array<{ role: string; text: string; created_at: string }> }> {
    const messages = await many<{ role: string; text: string; created_at: string }>(
      this.pool,
      `SELECT role, text, created_at FROM assistant_messages WHERE user_id = $1 ORDER BY created_at LIMIT $2`,
      [userId, Math.min(Math.max(limit, 1), 500)],
    );
    return { messages };
  }
}
