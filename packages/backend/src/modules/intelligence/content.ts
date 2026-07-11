// Content grounding index — retrieval over OUR OWN teaching (curriculum
// modules, reading-plan segments, devotionals) so every AI answer speaks in
// Nuru Place's voice and can cite its own lessons.
//
// Mechanism: Postgres FTS (tsvector GIN) — no new extension, runs in the
// embedded-postgres test suite, and ranks well at this corpus size (hundreds
// to a few thousand chunks). The service interface hides the mechanism; a
// vector index can replace it later without touching callers.
import type { Pool } from "pg";
import { many, one } from "../../db/db.js";

export interface ContentChunk {
  title: string;
  ref: string | null;
  body: string;
}

const CHUNK_MAX = 1400;

/** Split markdown-ish text into ~CHUNK_MAX-char chunks on paragraph boundaries. */
export function chunkText(text: string, max = CHUNK_MAX): string[] {
  const clean = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → label
    .replace(/<!--[\s\S]*?-->/g, "") // authoring markers (page breaks)
    .trim();
  if (!clean) return [];
  const paras = clean.split(/\n{2,}/);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    const para = p.trim();
    if (!para) continue;
    if (para.length > max) {
      if (cur) {
        chunks.push(cur);
        cur = "";
      }
      for (let i = 0; i < para.length; i += max) chunks.push(para.slice(i, i + max));
      continue;
    }
    if (cur.length + para.length + 2 > max) {
      chunks.push(cur);
      cur = para;
    } else {
      cur = cur ? `${cur}\n\n${para}` : para;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export class ContentIndexService {
  constructor(private readonly pool: Pool) {}

  /** Rebuild the whole index from source tables. Idempotent (wipe + refill). */
  async reindexAll(): Promise<{ sources: number; chunks: number }> {
    const client = await this.pool.connect();
    let sources = 0;
    let chunks = 0;
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM content_chunks`);

      const insert = async (kind: string, id: string, title: string, ref: string | null, body: string): Promise<void> => {
        const parts = chunkText(body);
        for (let i = 0; i < parts.length; i++) {
          await client.query(
            `INSERT INTO content_chunks (source_kind, source_id, seq, title, ref, body)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (source_kind, source_id, seq) DO UPDATE SET title = $4, ref = $5, body = $6, updated_at = now()`,
            [kind, id, i, title, ref, parts[i]],
          );
          chunks++;
        }
        if (parts.length > 0) sources++;
      };

      const modules = await many<{ module_id: string; title: string; lesson_content: string; level_number: number; module_sequence_number: number }>(
        client as unknown as Pool,
        `SELECT module_id, title, lesson_content, level_number, module_sequence_number
           FROM modules WHERE is_published = TRUE AND coalesce(evaluation_kind, '') <> 'exit_exam'`,
      );
      for (const m of modules) {
        await insert("module", m.module_id, m.title, `Level ${m.level_number} · Module ${m.module_sequence_number}`, m.lesson_content);
      }

      const segments = await many<{ segment_id: string; title: string; content: string; reference: string | null; day_number: number; plan_title: string }>(
        client as unknown as Pool,
        `SELECT s.segment_id, s.title, s.content, s.reference, d.day_number, p.title AS plan_title
           FROM reading_plan_day_segments s
           JOIN reading_plan_days d ON d.plan_day_id = s.plan_day_id
           JOIN reading_plans p ON p.plan_id = d.plan_id
          WHERE s.content IS NOT NULL AND s.kind IN ('devotional', 'scripture', 'reading')`,
      );
      for (const s of segments) {
        const body = s.reference ? `${s.reference}\n\n${s.content}` : s.content;
        await insert("plan_segment", s.segment_id, s.title, `Plan: ${s.plan_title} · Day ${s.day_number}`, body);
      }

      const devotionals = await many<{ devotional_id: string; title: string; body: string; scripture_ref: string | null; series: string | null }>(
        client as unknown as Pool,
        `SELECT devotional_id, title, body, scripture_ref, series FROM devotionals`,
      );
      for (const d of devotionals) {
        const body = d.scripture_ref ? `${d.scripture_ref}\n\n${d.body}` : d.body;
        await insert("devotional", d.devotional_id, d.title, d.series ? `Devotional · ${d.series}` : "Devotional", body);
      }

      await client.query("COMMIT");
      return { sources, chunks };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Top-k relevant teaching chunks for a free-text query ([] when nothing matches). */
  async search(query: string, k = 4): Promise<ContentChunk[]> {
    const q = query.trim().slice(0, 400);
    if (q.length < 3) return [];
    return many<ContentChunk>(
      this.pool,
      `SELECT title, ref, body
         FROM content_chunks, websearch_to_tsquery('english', $1) query
        WHERE tsv @@ query
        ORDER BY ts_rank(tsv, query) DESC
        LIMIT $2`,
      [q, Math.min(Math.max(k, 1), 8)],
    );
  }

  async count(): Promise<number> {
    const row = await one<{ n: number }>(this.pool, `SELECT count(*)::int AS n FROM content_chunks`);
    return row.n;
  }
}
