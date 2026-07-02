// Radio Broadcast Studio + Virtual Audio Mixer service (docs/RADIO_STUDIO_CONTRACT.md).
// Server-authoritative program lifecycle + member interactions. The provider owns
// ingest credentials; the module owns the DB and the public/admin projection split:
// the admin surface sees stream_key/ingest_*; the member surface NEVER does.
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import type { StreamProvider, StreamHealth } from "./provider.js";

// --- Row / DTO shapes -------------------------------------------------------

export interface RadioProgramRow {
  id: string;
  title: string;
  description: string | null;
  category: string;
  speaker: string | null;
  location: string | null;
  artwork_url: string | null;
  tags: string[];
  visibility: "public" | "members" | "private";
  scheduled_at: string | null;
  duration_min: number | null;
  repeat: string | null;
  timezone: string | null;
  status: "draft" | "scheduled" | "live" | "ended";
  loop_mode: "none" | "loop_all" | "repeat_one";
  is_live: boolean;
  live_started_at: string | null;
  live_ended_at: string | null;
  audio_url: string | null;
  audio_duration_sec: number | null;
  auto_go_live: boolean;
  record_broadcast: boolean;
  record_target: "cloud" | "local" | "both" | null;
  peak_listeners: number;
  ingest_provider: string | null;
  ingest_url: string | null;
  stream_key: string | null;
  hls_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Public projection: strips the ingest secrets (§DTO — no stream_key/ingest_url/ingest_provider).
// Detail/now-playing reads populate `tracks` with the ordered playlist (incl. audio_url).
export type RadioProgramPublic = Omit<RadioProgramRow, "stream_key" | "ingest_url" | "ingest_provider"> & {
  tracks?: RadioPlaylistItem[];
};

export type RadioTrackKind = "music" | "preaching" | "audio";
export type RadioLoopMode = "none" | "loop_all" | "repeat_one";

export interface RadioTrackRow {
  id: string;
  title: string;
  kind: RadioTrackKind;
  audio_url: string;
  duration_sec: number | null;
  size_bytes: number | null;
  created_by: string | null;
  created_at: string;
}

export interface RadioPlaylistItem {
  id: string;
  position: number;
  track: RadioTrackRow;
}

export interface RadioReactionCounts {
  heart: number;
  amen: number;
  fire: number;
}

export interface RadioCommentRow {
  id: string;
  program_id: string;
  member_id: string;
  body: string;
  hidden: boolean;
  client_event_id: string | null;
  created_at: string;
}

export interface MixerSceneRow {
  id: string;
  name: string;
  hint: string | null;
  channels: unknown[];
  is_default: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MixerJingleRow {
  id: string;
  label: string;
  color: string | null;
  audio_url: string | null;
  sort: number;
  created_by: string | null;
  created_at: string;
}

const PROGRAM_COLUMNS = `
  id, title, description, category, speaker, location, artwork_url, tags, visibility,
  scheduled_at, duration_min, repeat, timezone, status, loop_mode, is_live, live_started_at,
  live_ended_at, audio_url, audio_duration_sec, auto_go_live, record_broadcast,
  record_target, peak_listeners, ingest_provider, ingest_url, stream_key, hls_url,
  created_by, created_at, updated_at`;

function toPublic(row: RadioProgramRow): RadioProgramPublic {
  const { stream_key: _sk, ingest_url: _iu, ingest_provider: _ip, ...rest } = row;
  return rest;
}

export class RadioService {
  constructor(
    private readonly pool: Pool,
    private readonly provider: StreamProvider,
  ) {}

  // --- Validation schemas (inline zod, per module convention) ---------------

  static readonly CreateProgram = z
    .object({
      title: z.string().min(1).max(300),
      description: z.string().max(4000).optional(),
      category: z.enum(["Sermon", "Worship", "Prayer", "Bible Study", "Conference"]),
      speaker: z.string().max(200).optional(),
      location: z.string().max(200).optional(),
      artwork_url: z.string().max(2000).optional(),
      tags: z.array(z.string().max(60)).max(30).optional(),
      visibility: z.enum(["public", "members", "private"]).optional(),
      scheduled_at: z.string().datetime().optional(),
      duration_min: z.number().int().positive().max(1440).optional(),
      repeat: z.string().max(30).optional(),
      timezone: z.string().max(60).optional(),
      loop_mode: z.enum(["none", "loop_all", "repeat_one"]).optional(),
      audio_url: z.string().max(2000).optional(),
      audio_duration_sec: z.number().int().positive().optional(),
      auto_go_live: z.boolean().optional(),
      record_broadcast: z.boolean().optional(),
      record_target: z.enum(["cloud", "local", "both"]).optional(),
    })
    .strict();

  static readonly UpdateProgram = RadioService.CreateProgram.partial().extend({
    status: z.enum(["draft", "scheduled", "live", "ended"]).optional(),
  });

  static readonly ListQuery = z
    .object({
      status: z.enum(["draft", "scheduled", "live", "ended"]).optional(),
    })
    .strict();

  static readonly React = z
    .object({
      kind: z.enum(["heart", "amen", "fire"]),
      client_event_id: z.string().min(1).max(200),
    })
    .strict();

  static readonly Comment = z
    .object({
      body: z.string().min(1).max(2000),
      client_event_id: z.string().min(1).max(200),
    })
    .strict();

  static readonly SceneBody = z
    .object({
      name: z.string().min(1).max(120),
      hint: z.string().max(300).optional(),
      channels: z
        .array(
          z
            .object({
              id: z.string().min(1).max(60),
              name: z.string().min(1).max(120),
              sub: z.string().max(120).optional(),
              color: z.string().max(40).optional(),
              level: z.number().optional(),
              pan: z.number().optional(),
              muted: z.boolean().optional(),
              solo: z.boolean().optional(),
            })
            .strict(),
        )
        .max(64)
        .optional(),
      is_default: z.boolean().optional(),
    })
    .strict();

  static readonly SceneUpdate = RadioService.SceneBody.partial();

  static readonly JingleBody = z
    .object({
      label: z.string().min(1).max(120),
      color: z.string().max(40).optional(),
      audio_url: z.string().max(2000).optional(),
      sort: z.number().int().optional(),
    })
    .strict();

  static readonly TrackBody = z
    .object({
      title: z.string().min(1).max(300),
      kind: z.enum(["music", "preaching", "audio"]),
      audio_url: z.string().min(1).max(2000),
      duration_sec: z.number().int().positive().optional(),
      size_bytes: z.number().int().nonnegative().optional(),
    })
    .strict();

  static readonly TrackListQuery = z
    .object({
      kind: z.enum(["music", "preaching", "audio"]).optional(),
    })
    .strict();

  static readonly AddPlaylistItem = z
    .object({
      track_id: z.string().uuid(),
    })
    .strict();

  static readonly ReorderPlaylist = z
    .object({
      item_ids: z.array(z.string().uuid()).min(1),
    })
    .strict();

  // --- Programs: admin ------------------------------------------------------

  async listAdmin(status?: string): Promise<RadioProgramRow[]> {
    if (status) {
      return many<RadioProgramRow>(
        this.pool,
        `SELECT ${PROGRAM_COLUMNS} FROM radio_programs WHERE status = $1 ORDER BY created_at DESC`,
        [status],
      );
    }
    return many<RadioProgramRow>(
      this.pool,
      `SELECT ${PROGRAM_COLUMNS} FROM radio_programs ORDER BY created_at DESC`,
    );
  }

  async getAdmin(id: string): Promise<RadioProgramRow> {
    return one<RadioProgramRow>(this.pool, `SELECT ${PROGRAM_COLUMNS} FROM radio_programs WHERE id = $1`, [id]);
  }

  async create(
    createdBy: string,
    input: z.infer<typeof RadioService.CreateProgram>,
  ): Promise<RadioProgramRow> {
    return tx(this.pool, async (c) => {
      const status = input.scheduled_at ? "scheduled" : "draft";
      const inserted = await one<{ id: string }>(
        c,
        `INSERT INTO radio_programs
           (title, description, category, speaker, location, artwork_url, tags, visibility,
            scheduled_at, duration_min, repeat, timezone, status, loop_mode, audio_url,
            audio_duration_sec, auto_go_live, record_broadcast, record_target, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'{}'::text[]),COALESCE($8,'public'),
                 $9,$10,COALESCE($11,'none'),$12,$13,COALESCE($14,'none'),$15,$16,
                 COALESCE($17,true),COALESCE($18,false),$19,$20)
         RETURNING id`,
        [
          input.title,
          input.description ?? null,
          input.category,
          input.speaker ?? null,
          input.location ?? null,
          input.artwork_url ?? null,
          input.tags ?? null,
          input.visibility ?? null,
          input.scheduled_at ?? null,
          input.duration_min ?? null,
          input.repeat ?? null,
          input.timezone ?? null,
          status,
          input.loop_mode ?? null,
          input.audio_url ?? null,
          input.audio_duration_sec ?? null,
          input.auto_go_live ?? null,
          input.record_broadcast ?? null,
          input.record_target ?? null,
          createdBy,
        ],
      );
      // Provision ingest credentials for the new program.
      const creds = this.provider.provision(inserted.id);
      await c.query(
        `UPDATE radio_programs
            SET ingest_provider = $2, ingest_url = $3, stream_key = $4, hls_url = $5, updated_at = now()
          WHERE id = $1`,
        [inserted.id, creds.provider, creds.ingestUrl, creds.streamKey, creds.hlsUrl],
      );
      return one<RadioProgramRow>(c, `SELECT ${PROGRAM_COLUMNS} FROM radio_programs WHERE id = $1`, [inserted.id]);
    });
  }

  async update(
    id: string,
    input: z.infer<typeof RadioService.UpdateProgram>,
  ): Promise<RadioProgramRow> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    const set = (col: string, val: unknown): void => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (input.title !== undefined) set("title", input.title);
    if (input.description !== undefined) set("description", input.description);
    if (input.category !== undefined) set("category", input.category);
    if (input.speaker !== undefined) set("speaker", input.speaker);
    if (input.location !== undefined) set("location", input.location);
    if (input.artwork_url !== undefined) set("artwork_url", input.artwork_url);
    if (input.tags !== undefined) set("tags", input.tags);
    if (input.visibility !== undefined) set("visibility", input.visibility);
    if (input.scheduled_at !== undefined) set("scheduled_at", input.scheduled_at);
    if (input.duration_min !== undefined) set("duration_min", input.duration_min);
    if (input.repeat !== undefined) set("repeat", input.repeat);
    if (input.timezone !== undefined) set("timezone", input.timezone);
    if (input.loop_mode !== undefined) set("loop_mode", input.loop_mode);
    if (input.audio_url !== undefined) set("audio_url", input.audio_url);
    if (input.audio_duration_sec !== undefined) set("audio_duration_sec", input.audio_duration_sec);
    if (input.auto_go_live !== undefined) set("auto_go_live", input.auto_go_live);
    if (input.status !== undefined) set("status", input.status);
    if (input.record_broadcast !== undefined) set("record_broadcast", input.record_broadcast);
    if (input.record_target !== undefined) set("record_target", input.record_target);
    if (sets.length === 0) return this.getAdmin(id);
    sets.push(`updated_at = now()`);
    return one<RadioProgramRow>(
      this.pool,
      `UPDATE radio_programs SET ${sets.join(", ")} WHERE id = $1 RETURNING ${PROGRAM_COLUMNS}`,
      params,
    );
  }

  async remove(id: string): Promise<{ ok: true }> {
    const res = await this.pool.query(`DELETE FROM radio_programs WHERE id = $1`, [id]);
    if (!res.rowCount) throw new ApiError("NOT_FOUND", "Program not found");
    return { ok: true };
  }

  async goLive(id: string): Promise<RadioProgramRow> {
    return tx(this.pool, async (c) => {
      const program = await one<RadioProgramRow>(
        c,
        `SELECT ${PROGRAM_COLUMNS} FROM radio_programs WHERE id = $1`,
        [id],
      );
      this.provider.start({ id: program.id, is_live: program.is_live, peak_listeners: program.peak_listeners });
      return one<RadioProgramRow>(
        c,
        `UPDATE radio_programs
            SET status = 'live', is_live = true, live_started_at = now(),
                live_ended_at = NULL, updated_at = now()
          WHERE id = $1 RETURNING ${PROGRAM_COLUMNS}`,
        [id],
      );
    });
  }

  async end(id: string): Promise<RadioProgramRow> {
    return tx(this.pool, async (c) => {
      const program = await one<RadioProgramRow>(
        c,
        `SELECT ${PROGRAM_COLUMNS} FROM radio_programs WHERE id = $1`,
        [id],
      );
      this.provider.stop({ id: program.id, is_live: program.is_live, peak_listeners: program.peak_listeners });
      return one<RadioProgramRow>(
        c,
        `UPDATE radio_programs
            SET status = 'ended', is_live = false, live_ended_at = now(), updated_at = now()
          WHERE id = $1 RETURNING ${PROGRAM_COLUMNS}`,
        [id],
      );
    });
  }

  /**
   * Auto-air sweep (worker, ~30s tick). Airs scheduled programs whose time has
   * come (auto_go_live) and auto-ends live programs past their duration. Runs on
   * a single worker (// single-worker assumption) — the SELECTs guard is_live so a
   * tick can't double-fire go-live, and each goLive/end is isolated in try/catch
   * so one failure doesn't abort the sweep. Idempotent.
   */
  async airDueEvents(now = new Date()): Promise<{ aired: number; ended: number }> {
    let aired = 0;
    let ended = 0;

    const toAir = await many<{ id: string }>(
      this.pool,
      `SELECT id FROM radio_programs
        WHERE status = 'scheduled' AND auto_go_live = true AND is_live = false
          AND scheduled_at IS NOT NULL AND scheduled_at <= $1`,
      [now],
    );
    for (const { id } of toAir) {
      try {
        await this.goLive(id);
        aired += 1;
      } catch {
        /* one failure must not abort the sweep; next tick retries. */
      }
    }

    const toEnd = await many<{ id: string }>(
      this.pool,
      `SELECT id FROM radio_programs
        WHERE status = 'live' AND is_live = true
          AND duration_min IS NOT NULL AND live_started_at IS NOT NULL
          AND live_started_at + (duration_min || ' minutes')::interval <= $1`,
      [now],
    );
    for (const { id } of toEnd) {
      try {
        await this.end(id);
        ended += 1;
      } catch {
        /* isolate — next tick retries. */
      }
    }

    return { aired, ended };
  }

  async rotateKey(id: string): Promise<{ stream_key: string }> {
    await this.getAdmin(id); // 404 if missing
    const { streamKey } = this.provider.rotateKey(id);
    await this.pool.query(`UPDATE radio_programs SET stream_key = $2, updated_at = now() WHERE id = $1`, [
      id,
      streamKey,
    ]);
    return { stream_key: streamKey };
  }

  async health(id: string): Promise<StreamHealth> {
    const program = await this.getAdmin(id);
    if (!program.is_live) throw new ApiError("CONFLICT", "Program is not live");
    return await this.provider.health({ id: program.id, is_live: program.is_live, peak_listeners: program.peak_listeners });
  }

  // --- Programs: member (public projection) ---------------------------------

  /** Visible programs: public always; members-only requires an authed member; never private. */
  async listPublic(): Promise<RadioProgramPublic[]> {
    const rows = await many<RadioProgramRow>(
      this.pool,
      `SELECT ${PROGRAM_COLUMNS} FROM radio_programs
        WHERE visibility IN ('public','members') AND status <> 'draft'
        ORDER BY is_live DESC, COALESCE(scheduled_at, created_at) DESC`,
    );
    return rows.map(toPublic);
  }

  async nowPlaying(): Promise<RadioProgramPublic | null> {
    const live = await maybeOne<RadioProgramRow>(
      this.pool,
      `SELECT ${PROGRAM_COLUMNS} FROM radio_programs
        WHERE is_live = true AND visibility IN ('public','members')
        ORDER BY live_started_at DESC LIMIT 1`,
    );
    if (live) return this.withPlaylist(toPublic(live));
    const next = await maybeOne<RadioProgramRow>(
      this.pool,
      `SELECT ${PROGRAM_COLUMNS} FROM radio_programs
        WHERE status = 'scheduled' AND visibility IN ('public','members') AND scheduled_at >= now()
        ORDER BY scheduled_at ASC LIMIT 1`,
    );
    return next ? this.withPlaylist(toPublic(next)) : null;
  }

  async getPublic(id: string): Promise<RadioProgramPublic> {
    const row = await maybeOne<RadioProgramRow>(
      this.pool,
      `SELECT ${PROGRAM_COLUMNS} FROM radio_programs WHERE id = $1`,
      [id],
    );
    if (!row || row.visibility === "private") throw new ApiError("NOT_FOUND", "Program not found");
    return this.withPlaylist(toPublic(row));
  }

  /** Attach the ordered playlist (with embedded track incl. audio_url) to a public program. */
  private async withPlaylist(program: RadioProgramPublic): Promise<RadioProgramPublic> {
    return { ...program, tracks: await this.listPlaylist(program.id) };
  }

  private async assertVisible(id: string): Promise<void> {
    const row = await maybeOne<{ visibility: string }>(
      this.pool,
      `SELECT visibility FROM radio_programs WHERE id = $1`,
      [id],
    );
    if (!row || row.visibility === "private") throw new ApiError("NOT_FOUND", "Program not found");
  }

  // --- Reactions ------------------------------------------------------------

  private async reactionCounts(programId: string): Promise<RadioReactionCounts> {
    const rows = await many<{ kind: string; n: string }>(
      this.pool,
      `SELECT kind, COUNT(*)::text AS n FROM radio_reactions WHERE program_id = $1 GROUP BY kind`,
      [programId],
    );
    const counts: RadioReactionCounts = { heart: 0, amen: 0, fire: 0 };
    for (const r of rows) {
      if (r.kind === "heart" || r.kind === "amen" || r.kind === "fire") counts[r.kind] = Number(r.n);
    }
    return counts;
  }

  /** Idempotent per client_event_id (§2.1/§3.6): a replay is a no-op returning the same counts. */
  async react(
    programId: string,
    memberId: string,
    input: z.infer<typeof RadioService.React>,
  ): Promise<{ counts: RadioReactionCounts }> {
    await this.assertVisible(programId);
    await this.pool.query(
      `INSERT INTO radio_reactions (program_id, member_id, kind, client_event_id)
         VALUES ($1,$2,$3,$4)
       ON CONFLICT (client_event_id) DO NOTHING`,
      [programId, memberId, input.kind, input.client_event_id],
    );
    return { counts: await this.reactionCounts(programId) };
  }

  async reactionCountsPublic(programId: string): Promise<RadioReactionCounts> {
    return this.reactionCounts(programId);
  }

  // --- Comments -------------------------------------------------------------

  /** Non-hidden comments, newest first (member view). */
  async listComments(programId: string): Promise<RadioCommentRow[]> {
    await this.assertVisible(programId);
    return many<RadioCommentRow>(
      this.pool,
      `SELECT id, program_id, member_id, body, hidden, client_event_id, created_at
         FROM radio_comments WHERE program_id = $1 AND hidden = false
        ORDER BY created_at DESC`,
      [programId],
    );
  }

  /** All comments incl. hidden (admin moderation view). */
  async listCommentsAdmin(programId: string): Promise<RadioCommentRow[]> {
    await this.getAdmin(programId); // 404 if missing
    return many<RadioCommentRow>(
      this.pool,
      `SELECT id, program_id, member_id, body, hidden, client_event_id, created_at
         FROM radio_comments WHERE program_id = $1
        ORDER BY created_at DESC`,
      [programId],
    );
  }

  /** Idempotent per client_event_id: a replay returns the already-stored comment. */
  async addComment(
    programId: string,
    memberId: string,
    input: z.infer<typeof RadioService.Comment>,
  ): Promise<RadioCommentRow> {
    await this.assertVisible(programId);
    return tx(this.pool, async (c) => {
      const existing = await maybeOne<RadioCommentRow>(
        c,
        `SELECT id, program_id, member_id, body, hidden, client_event_id, created_at
           FROM radio_comments WHERE client_event_id = $1`,
        [input.client_event_id],
      );
      if (existing) return existing;
      return one<RadioCommentRow>(
        c,
        `INSERT INTO radio_comments (program_id, member_id, body, client_event_id)
           VALUES ($1,$2,$3,$4)
         RETURNING id, program_id, member_id, body, hidden, client_event_id, created_at`,
        [programId, memberId, input.body, input.client_event_id],
      );
    });
  }

  /** Moderation: hide a comment. */
  async hideComment(commentId: string): Promise<{ ok: true }> {
    const res = await this.pool.query(
      `UPDATE radio_comments SET hidden = true WHERE id = $1`,
      [commentId],
    );
    if (!res.rowCount) throw new ApiError("NOT_FOUND", "Comment not found");
    return { ok: true };
  }

  // --- Audio library: tracks ------------------------------------------------

  private static readonly TRACK_COLUMNS = `id, title, kind, audio_url, duration_sec, size_bytes::float8 AS size_bytes, created_by, created_at`;

  /** Library tracks, newest first, optionally filtered by kind. */
  async listTracks(kind?: RadioTrackKind): Promise<RadioTrackRow[]> {
    if (kind) {
      return many<RadioTrackRow>(
        this.pool,
        `SELECT ${RadioService.TRACK_COLUMNS} FROM radio_tracks WHERE kind = $1 ORDER BY created_at DESC`,
        [kind],
      );
    }
    return many<RadioTrackRow>(
      this.pool,
      `SELECT ${RadioService.TRACK_COLUMNS} FROM radio_tracks ORDER BY created_at DESC`,
    );
  }

  async createTrack(
    createdBy: string,
    input: z.infer<typeof RadioService.TrackBody>,
  ): Promise<RadioTrackRow> {
    return one<RadioTrackRow>(
      this.pool,
      `INSERT INTO radio_tracks (title, kind, audio_url, duration_sec, size_bytes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING ${RadioService.TRACK_COLUMNS}`,
      [input.title, input.kind, input.audio_url, input.duration_sec ?? null, input.size_bytes ?? null, createdBy],
    );
  }

  /** Delete a track; cascades it out of every playlist (FK ON DELETE CASCADE). */
  async removeTrack(id: string): Promise<{ ok: true }> {
    const res = await this.pool.query(`DELETE FROM radio_tracks WHERE id = $1`, [id]);
    if (!res.rowCount) throw new ApiError("NOT_FOUND", "Track not found");
    return { ok: true };
  }

  // --- Session playlists ----------------------------------------------------

  /** Ordered playlist for a program, each item embedding its track. */
  async listPlaylist(programId: string): Promise<RadioPlaylistItem[]> {
    const rows = await many<{
      id: string;
      position: number;
      t_id: string;
      title: string;
      kind: RadioTrackKind;
      audio_url: string;
      duration_sec: number | null;
      size_bytes: number | null;
      created_by: string | null;
      created_at: string;
    }>(
      this.pool,
      `SELECT pt.id, pt.position,
              t.id AS t_id, t.title, t.kind, t.audio_url, t.duration_sec,
              t.size_bytes::float8 AS size_bytes, t.created_by, t.created_at
         FROM radio_program_tracks pt
         JOIN radio_tracks t ON t.id = pt.track_id
        WHERE pt.program_id = $1
        ORDER BY pt.position ASC`,
      [programId],
    );
    return rows.map((r) => ({
      id: r.id,
      position: r.position,
      track: {
        id: r.t_id,
        title: r.title,
        kind: r.kind,
        audio_url: r.audio_url,
        duration_sec: r.duration_sec,
        size_bytes: r.size_bytes,
        created_by: r.created_by,
        created_at: r.created_at,
      },
    }));
  }

  /** Admin playlist read — 404s if the program is missing. */
  async listPlaylistAdmin(programId: string): Promise<RadioPlaylistItem[]> {
    await this.getAdmin(programId); // 404 if missing
    return this.listPlaylist(programId);
  }

  /** Append a track at the next position (max+1). */
  async addPlaylistItem(
    programId: string,
    input: z.infer<typeof RadioService.AddPlaylistItem>,
  ): Promise<RadioPlaylistItem> {
    await this.getAdmin(programId); // 404 if program missing
    const track = await maybeOne<{ id: string }>(this.pool, `SELECT id FROM radio_tracks WHERE id = $1`, [
      input.track_id,
    ]);
    if (!track) throw new ApiError("NOT_FOUND", "Track not found");
    return tx(this.pool, async (c) => {
      const next = await one<{ pos: number }>(
        c,
        `SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM radio_program_tracks WHERE program_id = $1`,
        [programId],
      );
      const inserted = await one<{ id: string; position: number }>(
        c,
        `INSERT INTO radio_program_tracks (program_id, track_id, position)
           VALUES ($1,$2,$3) RETURNING id, position`,
        [programId, input.track_id, next.pos],
      );
      const trackRow = await one<RadioTrackRow>(
        c,
        `SELECT ${RadioService.TRACK_COLUMNS} FROM radio_tracks WHERE id = $1`,
        [input.track_id],
      );
      return { id: inserted.id, position: inserted.position, track: trackRow };
    });
  }

  /** Remove a playlist item, then re-normalize remaining positions to 1..n. */
  async removePlaylistItem(programId: string, itemId: string): Promise<{ ok: true }> {
    await this.getAdmin(programId); // 404 if program missing
    return tx(this.pool, async (c) => {
      const res = await c.query(
        `DELETE FROM radio_program_tracks WHERE id = $1 AND program_id = $2`,
        [itemId, programId],
      );
      if (!res.rowCount) throw new ApiError("NOT_FOUND", "Playlist item not found");
      await c.query(
        `WITH ranked AS (
           SELECT id, ROW_NUMBER() OVER (ORDER BY position ASC) AS rn
             FROM radio_program_tracks WHERE program_id = $1
         )
         UPDATE radio_program_tracks pt
            SET position = ranked.rn
           FROM ranked WHERE pt.id = ranked.id`,
        [programId],
      );
      return { ok: true };
    });
  }

  /** Reorder the full playlist: item_ids must exactly match the program's items. */
  async reorderPlaylist(
    programId: string,
    input: z.infer<typeof RadioService.ReorderPlaylist>,
  ): Promise<{ ok: true }> {
    await this.getAdmin(programId); // 404 if program missing
    return tx(this.pool, async (c) => {
      const existing = await many<{ id: string }>(
        c,
        `SELECT id FROM radio_program_tracks WHERE program_id = $1`,
        [programId],
      );
      const existingSet = new Set(existing.map((r) => r.id));
      const requested = new Set(input.item_ids);
      if (
        existingSet.size !== requested.size ||
        input.item_ids.length !== existing.length ||
        !input.item_ids.every((id) => existingSet.has(id))
      ) {
        throw new ApiError("VALIDATION_FAILED", "item_ids must match the program's playlist items exactly");
      }
      for (let i = 0; i < input.item_ids.length; i += 1) {
        await c.query(
          `UPDATE radio_program_tracks SET position = $1 WHERE id = $2 AND program_id = $3`,
          [i + 1, input.item_ids[i], programId],
        );
      }
      return { ok: true };
    });
  }

  // --- Mixer scenes ---------------------------------------------------------

  async listScenes(): Promise<MixerSceneRow[]> {
    return many<MixerSceneRow>(
      this.pool,
      `SELECT id, name, hint, channels, is_default, created_by, created_at, updated_at
         FROM mixer_scenes ORDER BY is_default DESC, name ASC`,
    );
  }

  async createScene(
    createdBy: string,
    input: z.infer<typeof RadioService.SceneBody>,
  ): Promise<MixerSceneRow> {
    return one<MixerSceneRow>(
      this.pool,
      `INSERT INTO mixer_scenes (name, hint, channels, is_default, created_by)
         VALUES ($1,$2,COALESCE($3,'[]'::jsonb),COALESCE($4,false),$5)
       RETURNING id, name, hint, channels, is_default, created_by, created_at, updated_at`,
      [input.name, input.hint ?? null, JSON.stringify(input.channels ?? []), input.is_default ?? null, createdBy],
    );
  }

  async updateScene(
    id: string,
    input: z.infer<typeof RadioService.SceneUpdate>,
  ): Promise<MixerSceneRow> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    const set = (col: string, val: unknown): void => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (input.name !== undefined) set("name", input.name);
    if (input.hint !== undefined) set("hint", input.hint);
    if (input.channels !== undefined) set("channels", JSON.stringify(input.channels));
    if (input.is_default !== undefined) set("is_default", input.is_default);
    if (sets.length === 0) {
      return one<MixerSceneRow>(
        this.pool,
        `SELECT id, name, hint, channels, is_default, created_by, created_at, updated_at
           FROM mixer_scenes WHERE id = $1`,
        [id],
      );
    }
    sets.push(`updated_at = now()`);
    return one<MixerSceneRow>(
      this.pool,
      `UPDATE mixer_scenes SET ${sets.join(", ")} WHERE id = $1
       RETURNING id, name, hint, channels, is_default, created_by, created_at, updated_at`,
      params,
    );
  }

  async removeScene(id: string): Promise<{ ok: true }> {
    const res = await this.pool.query(`DELETE FROM mixer_scenes WHERE id = $1`, [id]);
    if (!res.rowCount) throw new ApiError("NOT_FOUND", "Scene not found");
    return { ok: true };
  }

  // --- Mixer jingles --------------------------------------------------------

  async listJingles(): Promise<MixerJingleRow[]> {
    return many<MixerJingleRow>(
      this.pool,
      `SELECT id, label, color, audio_url, sort, created_by, created_at
         FROM mixer_jingles ORDER BY sort ASC, created_at ASC`,
    );
  }

  async createJingle(
    createdBy: string,
    input: z.infer<typeof RadioService.JingleBody>,
  ): Promise<MixerJingleRow> {
    return one<MixerJingleRow>(
      this.pool,
      `INSERT INTO mixer_jingles (label, color, audio_url, sort, created_by)
         VALUES ($1,$2,$3,COALESCE($4,0),$5)
       RETURNING id, label, color, audio_url, sort, created_by, created_at`,
      [input.label, input.color ?? null, input.audio_url ?? null, input.sort ?? null, createdBy],
    );
  }

  async removeJingle(id: string): Promise<{ ok: true }> {
    const res = await this.pool.query(`DELETE FROM mixer_jingles WHERE id = $1`, [id]);
    if (!res.rowCount) throw new ApiError("NOT_FOUND", "Jingle not found");
    return { ok: true };
  }
}
