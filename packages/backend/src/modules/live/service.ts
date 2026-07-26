// Nuru Live L1 — backend module (docs/LIVE_STREAMING.md). L0 infra (MediaMTX
// on the VPS: RTMP ingest :1935, HLS out behind nginx /live/*, fMP4 recordings
// to disk) is already live; this owns: minting stream keys (RBAC + §5.4
// scoping), the MediaMTX authHTTP webhook, live_streams/live_viewers, viewer
// presence, the recording registrar, and the auto-end-orphans sweep.
import { randomBytes, createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx, audit, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { effectivePermissions, assertCellInScope } from "../../http/auth.js";
import type { Principal } from "../../http/http.js";
import { IdentityService } from "../identity/service.js";
import { NotificationService } from "../notifications/service.js";
import { matchRecordingFile } from "./recordings.js";

export type LiveScope = "church" | "cell";
export type LiveKind = "video" | "audio";

export interface CreatedStream {
  stream_id: string;
  rtmp_url: string;
  stream_key: string;
  path: string;
}

export interface LiveNowRow {
  stream_id: string;
  scope: LiveScope;
  cell_id: string | null;
  title: string;
  kind: LiveKind;
  started_at: string;
  hls_url: string;
  started_by_name: string;
  viewer_count: number;
}

export interface RecordingRow {
  stream_id: string;
  scope: LiveScope;
  cell_id: string | null;
  title: string;
  kind: LiveKind;
  started_at: string;
  ended_at: string;
  recording_url: string;
}

interface StreamRow {
  stream_id: string;
  scope: LiveScope;
  cell_id: string | null;
  started_by: string;
  title: string;
  kind: LiveKind;
  status: "live" | "ended";
  stream_key_hash: string;
  started_at: string;
  ended_at: string | null;
  viewer_peak: number;
  recording_url: string | null;
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** The MediaMTX path for a stream's scope — 'church' or 'cell/{cellId}'. */
function pathFor(scope: LiveScope, cellId: string | null): string {
  return scope === "church" ? "church" : `cell/${cellId}`;
}

/** Postgres unique_violation (23505) — the DB-level one-live-per-path guard. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

export class LiveService {
  private readonly notifications: NotificationService;

  constructor(
    private readonly pool: Pool,
    private readonly recordingsDir = "/opt/pathway/mediamtx/recordings",
    private readonly rtmpBaseUrl = "rtmp://pathway.nuruplace.org:1935",
    notifications?: NotificationService,
  ) {
    this.notifications = notifications ?? new NotificationService(pool);
  }

  static readonly CreateStream = z.object({
    scope: z.enum(["church", "cell"]),
    cell_id: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(200),
    kind: z.enum(["video", "audio"]),
  });

  static readonly AuthWebhook = z.object({
    user: z.string().min(1).max(200),
    password: z.string().max(200).optional().default(""),
    path: z.string().min(1).max(200),
    action: z.string().min(1).max(40),
  });

  static readonly RecordingsQuery = z.object({
    scope: z.enum(["church", "cell"]).optional(),
    cell_id: z.string().uuid().optional(),
  });

  // ---- internals ------------------------------------------------------

  private async isStaff(principal: Principal): Promise<boolean> {
    if (IdentityService.STAFF_ROLES.has(principal.role)) return true;
    const row = await maybeOne<{ is_staff: boolean }>(
      this.pool,
      `SELECT is_staff FROM users WHERE user_id = $1`,
      [principal.userId],
    );
    return row?.is_staff === true;
  }

  /** Does the caller hold the `live:<cap>` grant (role or direct), or the legacy
   *  SuperAdmin/Admin bridge (effectivePermissions returns the full grid for
   *  those roles already, so no separate role check is needed here). */
  private async hasCap(principal: Principal, cap: "go" | "manage"): Promise<boolean> {
    const perms = await effectivePermissions(this.pool, principal.userId, principal.role);
    return perms.some((p) => p.module_id === "live" && p.capability === cap);
  }

  /** A member of the cell (users.cell_group_id match), Admin/SuperAdmin, or a
   *  live:manage holder (oversight) may watch/see a cell-scoped stream. */
  private async canWatchCell(principal: Principal, cellId: string): Promise<boolean> {
    if (principal.role === "Admin" || principal.role === "SuperAdmin") return true;
    const row = await maybeOne(
      this.pool,
      `SELECT 1 FROM users WHERE user_id = $1 AND cell_group_id = $2`,
      [principal.userId, cellId],
    );
    if (row) return true;
    return this.hasCap(principal, "manage");
  }

  private async notify(userId: string, template: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.notifications.schedule({ userId, channel: "push", template, payload });
    } catch {
      // best-effort — the stream is authoritative regardless of push delivery
    }
  }

  private async notifyStreamStarted(streamId: string, scope: LiveScope, cellId: string | null, title: string, starterId: string): Promise<void> {
    try {
      if (scope === "church") {
        const starter = await maybeOne<{ congregation_id: string }>(
          this.pool, `SELECT congregation_id FROM users WHERE user_id = $1`, [starterId],
        );
        if (!starter) return;
        const members = await many<{ user_id: string }>(
          this.pool,
          `SELECT user_id FROM users WHERE deleted_at IS NULL AND congregation_id = $1 AND user_id <> $2`,
          [starter.congregation_id, starterId],
        );
        for (const m of members) {
          await this.notify(m.user_id, "live_stream_started", { stream_id: streamId, scope, title });
        }
      } else {
        const members = await many<{ user_id: string }>(
          this.pool,
          `SELECT user_id FROM users WHERE deleted_at IS NULL AND cell_group_id = $1 AND user_id <> $2`,
          [cellId, starterId],
        );
        for (const m of members) {
          await this.notify(m.user_id, "live_stream_started", { stream_id: streamId, scope, cell_id: cellId, title });
        }
      }
    } catch {
      // best-effort — never break stream creation over a notification failure
    }
  }

  private async streamById(c: Queryable, streamId: string): Promise<StreamRow | null> {
    return maybeOne<StreamRow>(
      c,
      `SELECT stream_id, scope, cell_id, started_by, title, kind, status, stream_key_hash,
              started_at, ended_at, viewer_peak, recording_url
         FROM live_streams WHERE stream_id = $1`,
      [streamId],
    );
  }

  /** Best-effort: match one MediaMTX segment covering the window and stamp
   *  recording_url. Never throws — a missing/absent recordings dir (e.g. local
   *  dev) is just "not registered yet", not an error. */
  private async tryRegisterRecording(row: { stream_id: string; scope: LiveScope; cell_id: string | null; started_at: string; ended_at: string | null }): Promise<boolean> {
    if (!row.ended_at) return false;
    try {
      const path = pathFor(row.scope, row.cell_id);
      const dir = join(this.recordingsDir, path);
      const files = await readdir(dir);
      const match = matchRecordingFile(files, new Date(row.started_at), new Date(row.ended_at));
      if (!match) return false;
      const recordingUrl = `/live-recordings/${path}/${match}`;
      const res = await this.pool.query(
        `UPDATE live_streams SET recording_url = $2 WHERE stream_id = $1 AND recording_url IS NULL`,
        [row.stream_id, recordingUrl],
      );
      return (res.rowCount ?? 0) > 0;
    } catch {
      return false;
    }
  }

  // ---- public API -------------------------------------------------------

  /**
   * Mint a stream + publish key (§5.4 scoping). Route-level `requirePermission`
   * already asserted the caller holds `live:go` at all; this layers the scope
   * refinement: church needs the caller to be STAFF (mirrors the console login
   * gate's STAFF_ROLES-or-is_staff check — "the unscoped grant"); cell needs
   * Admin/SuperAdmin or the cell in the caller's leader_assignments (reusing
   * assertCellInScope). One live stream per scope target — a concurrent
   * duplicate 409s via the DB's partial unique index.
   */
  async createStream(principal: Principal, input: z.infer<typeof LiveService.CreateStream>): Promise<CreatedStream> {
    if (input.scope === "cell" && !input.cell_id) {
      throw new ApiError("VALIDATION_FAILED", "cell_id is required for scope=cell");
    }
    if (input.scope === "church" && input.cell_id) {
      throw new ApiError("VALIDATION_FAILED", "cell_id must be omitted for scope=church");
    }

    if (input.scope === "church") {
      if (!(await this.isStaff(principal))) {
        throw new ApiError("FORBIDDEN_SCOPE", "Church-wide live requires staff access");
      }
    } else {
      const cellId = input.cell_id!;
      const cell = await maybeOne(this.pool, `SELECT 1 FROM cell_groups WHERE cell_group_id = $1`, [cellId]);
      if (!cell) throw new ApiError("NOT_FOUND", "Cell group not found");
      if (principal.role !== "Admin" && principal.role !== "SuperAdmin") {
        await assertCellInScope(this.pool, principal, cellId);
      }
    }

    const scope = input.scope;
    const cellId = input.cell_id ?? null;
    const path = pathFor(scope, cellId);
    const streamKey = randomBytes(16).toString("hex"); // 32 hex chars
    const keyHash = sha256Hex(streamKey);

    let streamId: string;
    try {
      streamId = await tx(this.pool, async (c) => {
        const created = await one<{ stream_id: string }>(
          c,
          `INSERT INTO live_streams (scope, cell_id, started_by, title, kind, stream_key_hash)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING stream_id`,
          [scope, cellId, principal.userId, input.title, input.kind, keyHash],
        );
        await audit(c, principal.userId, "live.stream_started", "live_streams", created.stream_id, {
          scope, cell_id: cellId, kind: input.kind,
        });
        return created.stream_id;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ApiError("CONFLICT", "A live stream is already running for this scope");
      }
      throw err;
    }

    // Push fan-out runs AFTER commit (best-effort; never blocks/reverts the stream).
    await this.notifyStreamStarted(streamId, scope, cellId, input.title, principal.userId);

    return { stream_id: streamId, rtmp_url: `${this.rtmpBaseUrl}/${path}`, stream_key: streamKey, path };
  }

  /**
   * MediaMTX authHTTP webhook. `action=publish` must match a LIVE stream by
   * stream_id (=user), sha256(password) === stream_key_hash, AND the posted
   * path === that stream's own path (a key never authorizes a path other than
   * its own stream's). Any other action (read/playback/…) is left open for
   * now — HLS viewer auth is a signed-URL concern at the nginx layer, not yet
   * built. Never throws on malformed input — an untrusted webhook body is just
   * a 401, not a 500.
   */
  async authWebhook(input: z.infer<typeof LiveService.AuthWebhook>): Promise<boolean> {
    if (input.action !== "publish") return true;
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(input.user)) return false;
    const stream = await maybeOne<{ stream_key_hash: string; scope: LiveScope; cell_id: string | null; status: string }>(
      this.pool,
      `SELECT stream_key_hash, scope, cell_id, status FROM live_streams WHERE stream_id = $1`,
      [input.user],
    );
    if (!stream || stream.status !== "live") return false;
    if (sha256Hex(input.password) !== stream.stream_key_hash) return false;
    return input.path === pathFor(stream.scope, stream.cell_id);
  }

  /** Starter, live:manage, or Admin/SuperAdmin (covered by hasCap's bridge). Idempotent. */
  async endStream(principal: Principal, streamId: string): Promise<{ stream_id: string; status: string; ended_at: string }> {
    const stream = await this.streamById(this.pool, streamId);
    if (!stream) throw new ApiError("NOT_FOUND", "Live stream not found");
    if (stream.status === "ended") {
      return { stream_id: streamId, status: "ended", ended_at: stream.ended_at ?? new Date(0).toISOString() };
    }
    const allowed = principal.userId === stream.started_by || (await this.hasCap(principal, "manage"));
    if (!allowed) throw new ApiError("FORBIDDEN_SCOPE", "Only the broadcaster or a live:manage holder may end this stream");

    const updated = await tx(this.pool, async (c) => {
      const row = await one<{ ended_at: string }>(
        c, `UPDATE live_streams SET status = 'ended', ended_at = now() WHERE stream_id = $1 AND status = 'live' RETURNING ended_at`,
        [streamId],
      );
      await audit(c, principal.userId, "live.stream_ended", "live_streams", streamId, {});
      return row;
    });

    // Best-effort inline registration attempt — the ~2min worker sweep is the backstop.
    await this.tryRegisterRecording({ stream_id: streamId, scope: stream.scope, cell_id: stream.cell_id, started_at: stream.started_at, ended_at: updated.ended_at });

    return { stream_id: streamId, status: "ended", ended_at: updated.ended_at };
  }

  /** What's live that the caller may watch: church always; cell only for its members
   *  (or Admin/SuperAdmin/live:manage — oversight). */
  async listNow(principal: Principal): Promise<{ data: LiveNowRow[] }> {
    const rows = await many<StreamRow & { started_by_name: string }>(
      this.pool,
      `SELECT s.stream_id, s.scope, s.cell_id, s.started_by, s.title, s.kind, s.status,
              s.stream_key_hash, s.started_at, s.ended_at, s.viewer_peak, s.recording_url,
              u.full_name AS started_by_name
         FROM live_streams s
         JOIN users u ON u.user_id = s.started_by
        WHERE s.status = 'live'
        ORDER BY s.started_at DESC`,
    );
    const data: LiveNowRow[] = [];
    for (const r of rows) {
      if (r.scope === "cell" && !(await this.canWatchCell(principal, r.cell_id!))) continue;
      const path = pathFor(r.scope, r.cell_id);
      const viewerCount = await this.activeViewerCount(r.stream_id);
      data.push({
        stream_id: r.stream_id, scope: r.scope, cell_id: r.cell_id, title: r.title, kind: r.kind,
        started_at: r.started_at, hls_url: `/live/${path}/index.m3u8`,
        started_by_name: r.started_by_name, viewer_count: viewerCount,
      });
    }
    return { data };
  }

  private async activeViewerCount(streamId: string): Promise<number> {
    const row = await maybeOne<{ n: string }>(
      this.pool,
      `SELECT count(*)::text AS n FROM live_viewers WHERE stream_id = $1 AND last_seen_at > now() - interval '60 seconds'`,
      [streamId],
    );
    return row ? Number(row.n) : 0;
  }

  /** Viewer heartbeat: upserts presence, updates viewer_peak = GREATEST(current,
   *  distinct-in-last-60s), and opportunistically prunes long-stale rows. 404 for
   *  an unknown/ended stream; 403 if a cell stream isn't visible to the caller. */
  async heartbeat(principal: Principal, streamId: string): Promise<{ ok: true }> {
    const stream = await maybeOne<{ scope: LiveScope; cell_id: string | null; status: string }>(
      this.pool, `SELECT scope, cell_id, status FROM live_streams WHERE stream_id = $1`, [streamId],
    );
    if (!stream || stream.status !== "live") throw new ApiError("NOT_FOUND", "Live stream not found");
    if (stream.scope === "cell" && !(await this.canWatchCell(principal, stream.cell_id!))) {
      throw new ApiError("FORBIDDEN_SCOPE", "This stream is not visible to you");
    }

    await tx(this.pool, async (c) => {
      await c.query(
        `INSERT INTO live_viewers (stream_id, user_id, last_seen_at) VALUES ($1, $2, now())
         ON CONFLICT (stream_id, user_id) DO UPDATE SET last_seen_at = now()`,
        [streamId, principal.userId],
      );
      // Opportunistic prune — long-idle viewers (10 min) never accumulate.
      await c.query(
        `DELETE FROM live_viewers WHERE stream_id = $1 AND last_seen_at < now() - interval '10 minutes'`,
        [streamId],
      );
      const count = await one<{ n: string }>(
        c, `SELECT count(*)::text AS n FROM live_viewers WHERE stream_id = $1 AND last_seen_at > now() - interval '60 seconds'`,
        [streamId],
      );
      await c.query(`UPDATE live_streams SET viewer_peak = GREATEST(viewer_peak, $2) WHERE stream_id = $1`, [streamId, Number(count.n)]);
    });
    return { ok: true };
  }

  /** Ended streams with a registered recording, same visibility rules as listNow. */
  async listRecordings(principal: Principal, q: z.infer<typeof LiveService.RecordingsQuery>): Promise<{ data: RecordingRow[] }> {
    const rows = await many<Pick<StreamRow, "stream_id" | "scope" | "cell_id" | "title" | "kind" | "started_at" | "ended_at" | "recording_url">>(
      this.pool,
      `SELECT stream_id, scope, cell_id, title, kind, started_at, ended_at, recording_url
         FROM live_streams
        WHERE status = 'ended' AND recording_url IS NOT NULL
          AND ($1::text IS NULL OR scope = $1)
          AND ($2::uuid IS NULL OR cell_id = $2)
        ORDER BY ended_at DESC NULLS LAST`,
      [q.scope ?? null, q.cell_id ?? null],
    );
    const data: RecordingRow[] = [];
    for (const r of rows) {
      if (r.scope === "cell" && !(await this.canWatchCell(principal, r.cell_id!))) continue;
      data.push({
        stream_id: r.stream_id, scope: r.scope, cell_id: r.cell_id, title: r.title, kind: r.kind,
        started_at: r.started_at, ended_at: r.ended_at ?? "", recording_url: r.recording_url ?? "",
      });
    }
    return { data };
  }

  /**
   * Worker sweep (~2min tick, per docs/LIVE_STREAMING.md L1): auto-ends streams
   * whose broadcaster crashed (status='live' older than 12h) and registers a
   * recording_url for any status='ended' stream that doesn't have one yet.
   * Each stream is isolated in try/catch so one failure never aborts the sweep.
   */
  async sweep(now: Date = new Date()): Promise<{ auto_ended: number; registered: number }> {
    let autoEnded = 0;
    const orphans = await many<{ stream_id: string }>(
      this.pool,
      `SELECT stream_id FROM live_streams WHERE status = 'live' AND started_at <= $1::timestamptz - interval '12 hours'`,
      [now],
    );
    for (const { stream_id } of orphans) {
      try {
        await tx(this.pool, async (c) => {
          await c.query(`UPDATE live_streams SET status = 'ended', ended_at = now() WHERE stream_id = $1 AND status = 'live'`, [stream_id]);
          await audit(c, null, "live.stream_auto_ended", "live_streams", stream_id, { reason: "orphaned_past_12h" });
        });
        autoEnded += 1;
      } catch {
        /* one failure must not abort the sweep; next tick retries */
      }
    }

    let registered = 0;
    const pending = await many<{ stream_id: string; scope: LiveScope; cell_id: string | null; started_at: string; ended_at: string | null }>(
      this.pool,
      `SELECT stream_id, scope, cell_id, started_at, ended_at FROM live_streams WHERE status = 'ended' AND recording_url IS NULL`,
    );
    for (const row of pending) {
      try {
        if (await this.tryRegisterRecording(row)) registered += 1;
      } catch {
        /* best-effort; next tick retries */
      }
    }
    return { auto_ended: autoEnded, registered };
  }
}
