// The Sunday Letter — once a week, the strongest model writes each active,
// consenting member a short pastoral letter woven from their ACTUAL week
// (member_story facts + narrative, plus a relevant excerpt of the church's own
// teaching). Cached in pastoral_letters (UNIQUE user_id+week_of ⇒ the weekly
// job is idempotent and replay-safe), delivered via the notifications pipeline.
import type { Pool } from "pg";
import { many, maybeOne } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import type { AiProvider } from "../assistant/provider.js";
import type { NotificationService } from "../notifications/service.js";
import type { ContentIndexService } from "./content.js";
import type { StoryService } from "./story.js";
import { LETTER_SYSTEM } from "./prompts.js";

export interface LetterRow {
  letter_id: string;
  week_of: string;
  body: string;
  scripture_ref: string | null;
  created_at: string;
  read_at: string | null;
}

export class LettersService {
  constructor(
    private readonly pool: Pool,
    private readonly provider: AiProvider,
    private readonly story: StoryService,
    private readonly content: ContentIndexService,
    private readonly notifications?: NotificationService,
  ) {}

  /** The Sunday (EAT) of the week containing `now`, as YYYY-MM-DD. */
  static weekOf(now: Date = new Date()): string {
    const eat = new Date(now.getTime() + 3 * 3600_000); // EAT = UTC+3, no DST
    const sunday = new Date(Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate() - eat.getUTCDay()));
    return sunday.toISOString().slice(0, 10);
  }

  /** Parse the model's "Scripture: Ref\n\nbody" contract (forgiving). */
  private static parse(raw: string): { body: string; scriptureRef: string | null } {
    const m = raw.match(/^\s*Scripture:\s*(.+?)\s*\n+([\s\S]+)$/i);
    if (m?.[1] && m[2]) return { scriptureRef: m[1].trim().slice(0, 120), body: m[2].trim() };
    return { scriptureRef: null, body: raw.trim() };
  }

  /** Compose + store one member's letter for the week. No-op if it exists. */
  async composeFor(userId: string, weekOf: string): Promise<LetterRow | null> {
    const existing = await maybeOne<LetterRow>(
      this.pool,
      `SELECT letter_id, week_of::text, body, scripture_ref, created_at, read_at FROM pastoral_letters
        WHERE user_id = $1 AND week_of = $2`,
      [userId, weekOf],
    );
    if (existing) return existing;

    const row = await this.story.get(userId);
    const built = row ?? (await this.story.rebuildFor(userId));
    if (!built) return null;

    // A touch of the church's own teaching, keyed off the member's season.
    let teaching = "";
    try {
      const seed =
        built.facts.reflections_recent[0]?.excerpt ??
        built.facts.last_module_completed?.title ??
        "grace faithfulness walking with God";
      const chunks = await this.content.search(seed, 2);
      if (chunks.length > 0) {
        teaching =
          `\n\nExcerpts from Nuru Place's own teaching (echo one phrase only if it truly fits):\n` +
          chunks.map((c) => `[${c.ref ?? c.title}] ${c.body.slice(0, 500)}`).join("\n");
      }
    } catch {
      /* teaching garnish is optional */
    }

    const raw = await this.provider.complete({
      system: LETTER_SYSTEM,
      messages: [
        {
          role: "user",
          text:
            `Member story JSON:\n${JSON.stringify(built.facts)}\n\n` +
            (built.narrative ? `Pastoral dossier: ${built.narrative}\n` : "") +
            teaching +
            `\n\nWrite this member's Sunday Letter for the week of ${weekOf}.`,
        },
      ],
      tier: "deep",
      // 2000, not 600: the deep-tier model thinks by default and max_tokens
      // caps thinking + the visible letter together — a tight budget here
      // risks truncating the actual 110-160 word letter to nothing.
      maxTokens: 2000,
      feature: "sunday_letter",
    });
    const { body, scriptureRef } = LettersService.parse(raw);

    const inserted = await maybeOne<LetterRow>(
      this.pool,
      `INSERT INTO pastoral_letters (user_id, week_of, body, scripture_ref)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, week_of) DO NOTHING
       RETURNING letter_id, week_of::text, body, scripture_ref, created_at, read_at`,
      [userId, weekOf, body, scriptureRef],
    );
    if (inserted && this.notifications) {
      try {
        await this.notifications.schedule({
          userId,
          channel: "push",
          template: "sunday_letter",
          payload: { letter_id: inserted.letter_id, week_of: weekOf },
        });
      } catch {
        /* the letter exists even if the knock fails */
      }
    }
    return inserted ?? this.composeFor(userId, weekOf); // lost a race → return the winner
  }

  /** Weekly batch: every consenting member active in the last 28 days. */
  async runWeekly(opts: { userIds?: string[]; now?: Date } = {}): Promise<{ week_of: string; written: number; skipped: number }> {
    const weekOf = LettersService.weekOf(opts.now);
    const candidates =
      opts.userIds ??
      (
        await many<{ user_id: string }>(
          this.pool,
          `SELECT u.user_id FROM users u
            WHERE u.ai_opt_out = FALSE
              AND EXISTS (SELECT 1 FROM interaction_events ie
                           WHERE ie.user_id = u.user_id AND ie.occurred_at >= now() - interval '28 days')
              AND EXISTS (SELECT 1 FROM enrollments e WHERE e.user_id = u.user_id)`,
        )
      ).map((r) => r.user_id);

    let written = 0;
    let skipped = 0;
    for (const userId of candidates) {
      try {
        const before = await maybeOne(
          this.pool,
          `SELECT 1 FROM pastoral_letters WHERE user_id = $1 AND week_of = $2`,
          [userId, weekOf],
        );
        if (before) {
          skipped++;
          continue;
        }
        const letter = await this.composeFor(userId, weekOf);
        if (letter) written++;
        else skipped++;
      } catch {
        skipped++; // one member must never sink the batch
      }
    }
    return { week_of: weekOf, written, skipped };
  }

  async list(userId: string, limit = 20): Promise<LetterRow[]> {
    return many<LetterRow>(
      this.pool,
      `SELECT letter_id, week_of::text, body, scripture_ref, created_at, read_at
         FROM pastoral_letters WHERE user_id = $1 ORDER BY week_of DESC LIMIT $2`,
      [userId, Math.min(Math.max(limit, 1), 50)],
    );
  }

  async latest(userId: string): Promise<LetterRow | null> {
    return maybeOne<LetterRow>(
      this.pool,
      `SELECT letter_id, week_of::text, body, scripture_ref, created_at, read_at
         FROM pastoral_letters WHERE user_id = $1 ORDER BY week_of DESC LIMIT 1`,
      [userId],
    );
  }

  async markRead(userId: string, letterId: string): Promise<{ letter_id: string; read_at: string }> {
    const row = await maybeOne<{ letter_id: string; read_at: string }>(
      this.pool,
      `UPDATE pastoral_letters SET read_at = coalesce(read_at, now())
        WHERE letter_id = $1 AND user_id = $2
        RETURNING letter_id, read_at`,
      [letterId, userId],
    );
    if (!row) throw new ApiError("NOT_FOUND", "Letter not found");
    return row;
  }
}
