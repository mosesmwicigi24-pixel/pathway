// Selah — My Thoughts (Prayer Room tab 3, docs: prayer-room-arc). A private
// rich-text journal: member-scoped, offline-synced (client-generated ids, LWW
// on updated_at, §1.7), with deliberately NO leader/admin read path — this is
// "private ground" (owner spec 2026-07-18), exactly like the prayer journal
// (§5.4). Drawings are Cloudinary URLs uploaded through the existing chat/media
// sign flow; this module only ever stores the resulting secure_urls.
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, recordChange, tx } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";

const ThoughtSpan = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  color: z.string().max(20).optional(),
  font: z.string().max(60).optional(),
});

export interface ThoughtRow {
  thought_id: string;
  title: string | null;
  body: string;
  body_spans: unknown | null;
  drawing_urls: string[];
  created_at: string;
  updated_at: string;
}

export class ThoughtsService {
  constructor(private readonly pool: Pool) {}

  static readonly ThoughtUpsert = z.object({
    thought_id: z.string().uuid(), // client-generated (offline-first)
    title: z.string().max(200).nullable().optional(),
    body: z.string().min(1).max(20_000),
    body_spans: z.array(ThoughtSpan).max(2000).nullable().optional(),
    drawing_urls: z.array(z.string().url().max(2048)).max(50).optional(),
    updated_at: z.string().datetime().optional(), // LWW anchor; defaults to now
    client_mutation_id: z.string().uuid().optional(),
  });

  /** LWW upsert: an older replay never clobbers a newer write (§1.7). */
  async upsert(
    userId: string,
    input: z.infer<typeof ThoughtsService.ThoughtUpsert>,
  ): Promise<{ thought_id: string; duplicate: boolean }> {
    return tx(this.pool, async (c) => {
      if (input.client_mutation_id) {
        const dup = await maybeOne<{ thought_id: string }>(
          c,
          `SELECT thought_id FROM member_thoughts WHERE client_mutation_id = $1`,
          [input.client_mutation_id],
        );
        if (dup) return { thought_id: dup.thought_id, duplicate: true };
      }
      const updatedAt = input.updated_at ?? new Date().toISOString();
      const res = await c.query(
        `INSERT INTO member_thoughts
           (thought_id, user_id, title, body, body_spans, drawing_urls, updated_at, client_mutation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (thought_id) DO UPDATE SET
           title = EXCLUDED.title, body = EXCLUDED.body, body_spans = EXCLUDED.body_spans,
           drawing_urls = EXCLUDED.drawing_urls,
           updated_at = EXCLUDED.updated_at, client_mutation_id = EXCLUDED.client_mutation_id
         WHERE member_thoughts.user_id = EXCLUDED.user_id          -- never touch another member's thought
           AND member_thoughts.updated_at <= EXCLUDED.updated_at   -- LWW
         RETURNING thought_id`,
        [
          input.thought_id,
          userId,
          input.title ?? null,
          input.body,
          input.body_spans ? JSON.stringify(input.body_spans) : null,
          input.drawing_urls ?? [],
          updatedAt,
          input.client_mutation_id ?? null,
        ],
      );
      if (res.rowCount === 0) {
        // Row exists but is newer (stale replay) or belongs to someone else.
        const owner = await maybeOne<{ user_id: string }>(
          c,
          `SELECT user_id FROM member_thoughts WHERE thought_id = $1`,
          [input.thought_id],
        );
        if (owner && owner.user_id !== userId) throw new ApiError("FORBIDDEN_SCOPE", "Not your thought");
        return { thought_id: input.thought_id, duplicate: true }; // stale LWW replay → no-op
      }
      await recordChange(c, "member_thoughts", input.thought_id, userId, "upsert");
      return { thought_id: input.thought_id, duplicate: false };
    });
  }

  /** HARD delete (member privacy) + tombstone so every device drops it.
   *  Scoped to the caller — a foreign id is a calm no-op, never an error. */
  async delete(userId: string, thoughtId: string): Promise<{ deleted: boolean }> {
    return tx(this.pool, async (c) => {
      const res = await c.query(`DELETE FROM member_thoughts WHERE thought_id = $1 AND user_id = $2`, [
        thoughtId,
        userId,
      ]);
      if ((res.rowCount ?? 0) > 0) await recordChange(c, "member_thoughts", thoughtId, userId, "delete");
      return { deleted: (res.rowCount ?? 0) > 0 };
    });
  }

  async list(userId: string): Promise<{ data: ThoughtRow[] }> {
    const data = await many<ThoughtRow>(
      this.pool,
      `SELECT thought_id, title, body, body_spans, drawing_urls, created_at, updated_at
         FROM member_thoughts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500`,
      [userId],
    );
    return { data };
  }

  /** Private ground — a foreign or missing id both resolve to 404, so we never
   *  confirm to another member that a thought exists (§5.4 pastoral privacy). */
  async getById(userId: string, thoughtId: string): Promise<ThoughtRow> {
    const row = await maybeOne<ThoughtRow>(
      this.pool,
      `SELECT thought_id, title, body, body_spans, drawing_urls, created_at, updated_at
         FROM member_thoughts WHERE thought_id = $1 AND user_id = $2`,
      [thoughtId, userId],
    );
    if (!row) throw new ApiError("NOT_FOUND", "Thought not found");
    return row;
  }
}
