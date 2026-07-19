// AI Prayer Points (Prayer Room tab 4, docs: prayer-room-arc). Two surfaces:
//   • assist — Gemini-in-Gmail style: draft (or start) a prayer in the
//     member's own voice. A SUGGESTION only; the member always edits/sends it.
//   • points — the corpus generator: reads ACROSS the member's own Selah
//     thoughts + private prayer journal + published prayer-wall posts and
//     distills concise prayer points. Read-only over the CALLER's own data —
//     every query below is scoped to $1 = userId, nothing else is ever touched.
// Both routes are gated on the member's AI consent (users.ai_opt_out), unlike
// the Talk-it-Over assist (which acts on words the member is about to type,
// not on stored personal content) — this reads the member's private corpus,
// so the same covenant that gates the Sunday Letter applies here (§1.1).
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import type { AiProvider } from "../assistant/provider.js";
import { PRAYER_ASSIST_SYSTEM, PRAYER_POINTS_SYSTEM } from "./prompts.js";

export class PrayerAiService {
  constructor(
    private readonly pool: Pool,
    private readonly provider: AiProvider,
  ) {}

  static readonly Assist = z.object({ seed: z.string().max(4000).optional() }).strict();

  private async assertConsent(userId: string): Promise<void> {
    const row = await maybeOne<{ ai_opt_out: boolean }>(
      this.pool,
      `SELECT ai_opt_out FROM users WHERE user_id = $1`,
      [userId],
    );
    if (!row) throw new ApiError("NOT_FOUND", "Member not found");
    if (row.ai_opt_out) {
      throw new ApiError("CONSENT_REQUIRED", "Turn on AI personalization in settings to use the prayer assistant");
    }
  }

  /** Draft (or start) a prayer in the member's own voice. Nothing is posted or
   *  persisted — the result is returned for the member to edit and pray. */
  async assist(userId: string, input: z.infer<typeof PrayerAiService.Assist>): Promise<{ suggestion: string }> {
    await this.assertConsent(userId);
    const seed = input.seed?.trim() ?? "";
    const suggestion = await this.provider.complete({
      system: PRAYER_ASSIST_SYSTEM,
      messages: [
        {
          role: "user",
          text: seed
            ? `My seed points — draft a short prayer from these, in my own voice:\n${seed}`
            : "I have no seed points — give me a gentle starter prayer I can make my own.",
        },
      ],
    });
    return { suggestion: suggestion.trim().slice(0, 2000) };
  }

  /** The corpus generator: concise prayer points distilled from the member's
   *  own Selah thoughts + private prayers + their own published prayer-wall
   *  posts. Every query is scoped to `userId` — no other principal's rows are
   *  ever read (§5.4). Returns [] (no AI call) when the member has written
   *  nothing yet, rather than fabricating points from an empty corpus. */
  async points(userId: string): Promise<{ points: string[] }> {
    await this.assertConsent(userId);
    const [thoughts, prayers, wall] = await Promise.all([
      many<{ body: string }>(
        this.pool,
        `SELECT body FROM member_thoughts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [userId],
      ),
      many<{ body: string }>(
        this.pool,
        `SELECT body FROM prayer_entries WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [userId],
      ),
      many<{ body: string }>(
        this.pool,
        `SELECT body FROM prayer_wall_posts WHERE author_user_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [userId],
      ),
    ]);
    if (thoughts.length === 0 && prayers.length === 0 && wall.length === 0) return { points: [] };

    const section = (label: string, rows: Array<{ body: string }>): string =>
      rows.length === 0 ? "" : `${label}:\n${rows.map((r) => `- ${r.body.slice(0, 500)}`).join("\n")}`;
    const corpus = [
      section("Selah thoughts", thoughts),
      section("Private prayer journal", prayers),
      section("Published prayers", wall),
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 8000);

    const raw = await this.provider.complete({
      system: PRAYER_POINTS_SYSTEM,
      messages: [{ role: "user", text: corpus }],
      maxTokens: 400,
    });
    const points = raw
      .split("\n")
      .map((line) => line.replace(/^[-•*\d.)\s]+/, "").trim())
      .filter((line) => line.length > 0)
      .slice(0, 12);
    return { points };
  }
}
