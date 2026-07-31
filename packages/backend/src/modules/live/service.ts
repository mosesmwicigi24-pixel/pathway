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
  /** Present only on church-scope rows when LIVE_CDN_BASE is configured — the
   *  direct, relative, low-latency URL to fail over to if the CDN copy 404s
   *  (e.g. the publisher hasn't caught up to a just-started stream yet). */
  hls_fallback_url?: string;
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

// ---- L5 interactions (docs/LIVE_INTERACTIVE.md) ---------------------------

export type ReactionEmoji = "like" | "love" | "fire";
export type GuestStatus = "invited" | "accepted" | "declined" | "removed" | "ended";

export interface LiveMessageRow {
  message_id: string;
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  body: string;
  sent_at: string;
}

export interface LiveHandRow {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  raised_at: string;
}

export interface LiveGuestRow {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  status: GuestStatus;
  /** L6a (docs/LIVE_INTERACTIVE.md) — ADDITIVE, owner-only: the WHEP URL the
   *  broadcaster's own device subscribes to for this guest's WebRTC video, to
   *  composite it locally. Absent for every caller other than the stream's
   *  own owner (build 91 iOS clients decode tolerantly either way). */
  whep_url?: string;
}

export interface GuestIngest {
  whip_url: string;
  token: string;
  path: string;
}

export interface LivePulse {
  viewer_count: number;
  reactions: { like: number; love: number; fire: number };
  recent_reactions: { emoji: ReactionEmoji; at: string }[];
  hands: LiveHandRow[];
  guests: LiveGuestRow[];
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

/** L6a (docs/LIVE_INTERACTIVE.md): the MediaMTX WebRTC path for one guest's
 *  slot on a stream — matches the deployed path pattern
 *  ~^guest/[0-9a-zA-Z-]+/[0-9a-zA-Z-]+$. */
function guestPathFor(streamId: string, userId: string): string {
  return `guest/${streamId}/${userId}`;
}

/** L6a: matches MediaMTX's deployed guest path pattern and captures the two
 *  UUIDs strictly (the looser `[0-9a-zA-Z-]+` MediaMTX pattern is intentionally
 *  broader than what this backend ever actually mints, so a non-UUID segment
 *  here just falls through to "not a guest path" — never a 500). */
const GUEST_PATH_RE =
  /^guest\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

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
    /** L1.5 (docs/LIVE_STREAMING.md) — set from env LIVE_CDN_BASE. When present,
     *  church-scope /live/now rows get an absolute CDN hls_url instead of the
     *  direct relative one. No trailing slash, e.g. "https://pub-xxxx.r2.dev". */
    private readonly cdnBase?: string,
    /** L6a (docs/LIVE_INTERACTIVE.md) — set from env LIVE_WEBRTC_BASE_URL. The
     *  public WHIP/WHEP signaling base MediaMTX's nginx TLS front sits behind.
     *  No trailing slash. */
    private readonly webrtcBaseUrl = "https://pathway.nuruplace.org/webrtc",
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

  // ---- L5 interactions (docs/LIVE_INTERACTIVE.md) ----------------------

  static readonly React = z.object({
    emoji: z.enum(["like", "love", "fire"]),
  });

  static readonly SetHand = z.object({
    raised: z.boolean(),
  });

  static readonly MessagesQuery = z.object({
    since: z.string().datetime({ offset: true }).optional(),
  });

  static readonly SendMessage = z.object({
    body: z.string().trim().min(1).max(500),
  });

  static readonly GuestRespond = z.object({
    accept: z.boolean(),
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

  /** L5 (docs/LIVE_INTERACTIVE.md): fetch a stream or 404. Every interaction
   *  endpoint (reactions, hand, messages, pulse, guests) starts here. */
  private async streamOrThrow(streamId: string): Promise<StreamRow> {
    const stream = await this.streamById(this.pool, streamId);
    if (!stream) throw new ApiError("NOT_FOUND", "Live stream not found");
    return stream;
  }

  /** Same cell-membership visibility rule as heartbeat/listNow/listRecordings. */
  private async assertVisible(principal: Principal, stream: StreamRow): Promise<void> {
    if (stream.scope === "cell" && !(await this.canWatchCell(principal, stream.cell_id!))) {
      throw new ApiError("FORBIDDEN_SCOPE", "This stream is not visible to you");
    }
  }

  /** All L5 writes except pulse + messages GET require the stream to still be live (409 CONFLICT). */
  private assertLive(stream: StreamRow): void {
    if (stream.status !== "live") throw new ApiError("CONFLICT", "This live stream has ended");
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
    // L6a (docs/LIVE_INTERACTIVE.md): guest WebRTC paths get their own rules
    // for publish AND read, dispatched first — everything below this branch
    // (church/cell publish, and the non-publish default) is untouched.
    const guestMatch = GUEST_PATH_RE.exec(input.path);
    if (guestMatch) {
      const streamId = guestMatch[1]!;
      const userId = guestMatch[2]!;
      if (input.action === "publish") return this.authGuestPublish(streamId, userId, input.user, input.password);
      if (input.action === "read") return this.authGuestRead(streamId, userId, input.user, input.password);
      return true; // other actions (api probes, etc.) stay open, same default as below
    }

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

  /**
   * L6a guest publish (WHIP): allowed iff the (stream, userId) guest row is
   * 'accepted', its guest_token matches the request's password, the request's
   * user self-identifies as that same userId (a token never authorizes
   * publishing under a different guest's identity), and the stream is still
   * live.
   */
  private async authGuestPublish(streamId: string, userId: string, user: string, password: string): Promise<boolean> {
    if (user !== userId) return false;
    const stream = await maybeOne<{ status: string }>(this.pool, `SELECT status FROM live_streams WHERE stream_id = $1`, [streamId]);
    if (!stream || stream.status !== "live") return false;
    const guest = await maybeOne<{ status: GuestStatus; guest_token: string | null }>(
      this.pool,
      `SELECT status, guest_token FROM live_stream_guests WHERE stream_id = $1 AND user_id = $2`,
      [streamId, userId],
    );
    return !!guest && guest.status === "accepted" && guest.guest_token !== null && guest.guest_token === password;
  }

  /**
   * L6a guest read (WHEP): allowed iff the caller presents EITHER the
   * stream's own owner publish key (user=stream_id, password=stream_key — so
   * the host can subscribe to composite locally) OR any accepted guest's own
   * (user_id, guest_token) pair for the SAME stream (guests may preview each
   * other later). The userId segment in the path itself is not otherwise
   * consulted — read access is scoped to the stream, not to one guest slot.
   */
  private async authGuestRead(streamId: string, _userId: string, user: string, password: string): Promise<boolean> {
    const stream = await maybeOne<{ stream_key_hash: string }>(
      this.pool, `SELECT stream_key_hash FROM live_streams WHERE stream_id = $1`, [streamId],
    );
    if (!stream) return false;
    if (user === streamId && sha256Hex(password) === stream.stream_key_hash) return true;
    const guest = await maybeOne(
      this.pool,
      `SELECT 1 FROM live_stream_guests WHERE stream_id = $1 AND user_id = $2 AND status = 'accepted' AND guest_token = $3`,
      [streamId, user, password],
    );
    return !!guest;
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
      // L5 (docs/LIVE_INTERACTIVE.md): stream end sweeps every still-active
      // guest (invited or accepted) to 'ended' — a per-stream grant that never
      // outlives the stream it was granted on. L6a: also clears guest_token —
      // an ended guest's publish/read credential is revoked, not just their
      // status.
      await c.query(
        `UPDATE live_stream_guests SET status = 'ended', responded_at = COALESCE(responded_at, now()), guest_token = NULL
          WHERE stream_id = $1 AND status IN ('invited', 'accepted')`,
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
      const directUrl = `/live/${path}/index.m3u8`;
      // L1.5 (docs/LIVE_STREAMING.md): church-scope only — infinite fan-out
      // rides Cloudflare R2 instead of the VPS's own uplink. Cell streams keep
      // the direct low-latency relative URL unconditionally (small audience,
      // no fan-out problem to solve).
      const row: LiveNowRow =
        r.scope === "church" && this.cdnBase
          ? {
              stream_id: r.stream_id, scope: r.scope, cell_id: r.cell_id, title: r.title, kind: r.kind,
              started_at: r.started_at, hls_url: `${this.cdnBase}/live-cdn/church/index.m3u8`,
              hls_fallback_url: directUrl,
              started_by_name: r.started_by_name, viewer_count: viewerCount,
            }
          : {
              stream_id: r.stream_id, scope: r.scope, cell_id: r.cell_id, title: r.title, kind: r.kind,
              started_at: r.started_at, hls_url: directUrl,
              started_by_name: r.started_by_name, viewer_count: viewerCount,
            };
      data.push(row);
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

  // ---- L5 interactions (docs/LIVE_INTERACTIVE.md) -----------------------

  /**
   * Append a reaction event. Rate-limited to >=1s/user (any emoji) via a
   * single atomic `INSERT ... WHERE NOT EXISTS` — no separate check-then-write
   * race, no in-memory bucket (works the same across horizontally scaled
   * instances since the guard lives in the row itself).
   */
  async react(principal: Principal, streamId: string, input: z.infer<typeof LiveService.React>): Promise<void> {
    const stream = await this.streamOrThrow(streamId);
    await this.assertVisible(principal, stream);
    this.assertLive(stream);

    const inserted = await maybeOne<{ reaction_id: string }>(
      this.pool,
      `INSERT INTO live_stream_reactions (stream_id, user_id, emoji)
       SELECT $1, $2, $3
        WHERE NOT EXISTS (
          SELECT 1 FROM live_stream_reactions
           WHERE stream_id = $1 AND user_id = $2 AND occurred_at > now() - interval '1 second'
        )
       RETURNING reaction_id`,
      [streamId, principal.userId, input.emoji],
    );
    if (!inserted) throw new ApiError("RATE_LIMITED", "One reaction per second");
  }

  /**
   * Idempotent upsert of one hand state per (stream, user). Raising only ever
   * moves raised_at forward; lowering only ever moves lowered_at forward —
   * "currently raised" is computed at read time (pulse) as
   * `raised_at IS NOT NULL AND (lowered_at IS NULL OR raised_at > lowered_at)`,
   * so repeated identical calls never create a second row or change the
   * logical state.
   */
  async setHand(principal: Principal, streamId: string, input: z.infer<typeof LiveService.SetHand>): Promise<void> {
    const stream = await this.streamOrThrow(streamId);
    await this.assertVisible(principal, stream);
    this.assertLive(stream);

    await this.pool.query(
      `INSERT INTO live_stream_hands (stream_id, user_id, raised_at, lowered_at)
       VALUES ($1, $2, CASE WHEN $3 THEN now() ELSE NULL END, CASE WHEN $3 THEN NULL ELSE now() END)
       ON CONFLICT (stream_id, user_id) DO UPDATE SET
         raised_at = CASE WHEN $3 THEN now() ELSE live_stream_hands.raised_at END,
         lowered_at = CASE WHEN $3 THEN live_stream_hands.lowered_at ELSE now() END`,
      [streamId, principal.userId, input.raised],
    );
  }

  /** Ascending, cap 200/poll. Allowed while the stream has ended (grace read) —
   *  visibility still applies. `since` omitted returns the most recent 200. */
  async listMessages(
    principal: Principal,
    streamId: string,
    q: z.infer<typeof LiveService.MessagesQuery>,
  ): Promise<{ messages: LiveMessageRow[] }> {
    const stream = await this.streamOrThrow(streamId);
    await this.assertVisible(principal, stream);

    // sent_at is formatted server-side at MICROSECOND precision (to_char, not
    // the driver's default JS-Date parse) — a plain Date round-trips through
    // JSON at millisecond precision, which would round a message's own
    // `since` cursor UP past itself and re-include it on the next poll.
    const messages = q.since
      ? await many<LiveMessageRow>(
          this.pool,
          `SELECT m.message_id, m.user_id, u.full_name, u.avatar_url, m.body,
                  to_char(m.sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS sent_at
             FROM live_stream_messages m JOIN users u ON u.user_id = m.user_id
            WHERE m.stream_id = $1 AND m.sent_at > $2
            ORDER BY m.sent_at ASC LIMIT 200`,
          [streamId, q.since],
        )
      : await many<LiveMessageRow>(
          this.pool,
          `SELECT recent.message_id, recent.user_id, recent.full_name, recent.avatar_url, recent.body,
                  to_char(recent.sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS sent_at
             FROM (
               SELECT m.message_id, m.user_id, u.full_name, u.avatar_url, m.body, m.sent_at
                 FROM live_stream_messages m JOIN users u ON u.user_id = m.user_id
                WHERE m.stream_id = $1
                ORDER BY m.sent_at DESC LIMIT 200
             ) recent ORDER BY recent.sent_at ASC`,
          [streamId],
        );
    return { messages };
  }

  /** POST .../messages — trimmed non-empty, <=500 chars (enforced by SendMessage). */
  async sendMessage(
    principal: Principal,
    streamId: string,
    input: z.infer<typeof LiveService.SendMessage>,
  ): Promise<LiveMessageRow> {
    const stream = await this.streamOrThrow(streamId);
    await this.assertVisible(principal, stream);
    this.assertLive(stream);

    const row = await one<{ message_id: string; sent_at: string }>(
      this.pool,
      `INSERT INTO live_stream_messages (stream_id, user_id, body) VALUES ($1, $2, $3)
       RETURNING message_id, to_char(sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS sent_at`,
      [streamId, principal.userId, input.body],
    );
    const user = await one<{ full_name: string; avatar_url: string | null }>(
      this.pool, `SELECT full_name, avatar_url FROM users WHERE user_id = $1`, [principal.userId],
    );
    return {
      message_id: row.message_id, user_id: principal.userId,
      full_name: user.full_name, avatar_url: user.avatar_url,
      body: input.body, sent_at: row.sent_at,
    };
  }

  /**
   * One snapshot for the whole overlay — the only two L5 reads allowed once a
   * stream has ended (grace read: the client's last poll can still resolve).
   * viewer_count reuses the exact same live_viewers window as /live/now and
   * heartbeat; guests are limited to the still-active pair (invited/accepted) —
   * once a stream ends they're all swept to 'ended' by endStream and this list
   * empties out naturally.
   */
  async pulse(principal: Principal, streamId: string): Promise<LivePulse> {
    const stream = await this.streamOrThrow(streamId);
    await this.assertVisible(principal, stream);

    const viewerCount = await this.activeViewerCount(streamId);

    const totals = await many<{ emoji: ReactionEmoji; n: string }>(
      this.pool, `SELECT emoji, count(*)::text AS n FROM live_stream_reactions WHERE stream_id = $1 GROUP BY emoji`, [streamId],
    );
    const reactions = { like: 0, love: 0, fire: 0 };
    for (const t of totals) reactions[t.emoji] = Number(t.n);

    const recent = await many<{ emoji: ReactionEmoji; occurred_at: string }>(
      this.pool,
      `SELECT emoji, occurred_at FROM live_stream_reactions WHERE stream_id = $1 ORDER BY occurred_at DESC LIMIT 20`,
      [streamId],
    );
    const recent_reactions = recent.map((r) => ({ emoji: r.emoji, at: r.occurred_at }));

    const hands = await many<LiveHandRow>(
      this.pool,
      `SELECT h.user_id, u.full_name, u.avatar_url, h.raised_at
         FROM live_stream_hands h JOIN users u ON u.user_id = h.user_id
        WHERE h.stream_id = $1 AND h.raised_at IS NOT NULL AND (h.lowered_at IS NULL OR h.raised_at > h.lowered_at)
        ORDER BY h.raised_at ASC`,
      [streamId],
    );

    const guestRows = await many<LiveGuestRow>(
      this.pool,
      `SELECT g.user_id, u.full_name, u.avatar_url, g.status
         FROM live_stream_guests g JOIN users u ON u.user_id = g.user_id
        WHERE g.stream_id = $1 AND g.status IN ('invited', 'accepted')
        ORDER BY g.invited_at ASC`,
      [streamId],
    );
    // L6a (docs/LIVE_INTERACTIVE.md): ADDITIVE — only the stream's own owner
    // (the one whose device composites the guests locally) gets each guest's
    // whep_url. Every other caller (viewers, the guests themselves) sees the
    // same shape as before this field existed.
    const guests: LiveGuestRow[] =
      principal.userId === stream.started_by
        ? guestRows.map((g) => ({ ...g, whep_url: `${this.webrtcBaseUrl}/${guestPathFor(streamId, g.user_id)}/whep` }))
        : guestRows;

    return { viewer_count: viewerCount, reactions, recent_reactions, hands, guests };
  }

  /**
   * L6 scaffolding (video is its own later phase against this contract):
   * broadcaster-only, cap 6 active (invited+accepted) guests, target may not
   * be the broadcaster themselves. Re-inviting an already invited/accepted
   * guest is an idempotent no-op (does not re-count against the cap). Fires
   * the existing best-effort push path with template `live_guest_invite`.
   */
  async inviteGuest(principal: Principal, streamId: string, targetUserId: string): Promise<void> {
    const stream = await this.streamOrThrow(streamId);
    this.assertLive(stream);
    if (principal.userId !== stream.started_by) {
      throw new ApiError("FORBIDDEN_SCOPE", "Only the broadcaster may invite guests");
    }
    if (targetUserId === stream.started_by) {
      throw new ApiError("VALIDATION_FAILED", "The broadcaster cannot invite themselves as a guest");
    }
    const target = await maybeOne(this.pool, `SELECT 1 FROM users WHERE user_id = $1 AND deleted_at IS NULL`, [targetUserId]);
    if (!target) throw new ApiError("NOT_FOUND", "User not found");

    const invited = await tx(this.pool, async (c) => {
      const existing = await maybeOne<{ status: GuestStatus }>(
        c, `SELECT status FROM live_stream_guests WHERE stream_id = $1 AND user_id = $2 FOR UPDATE`,
        [streamId, targetUserId],
      );
      if (existing && (existing.status === "invited" || existing.status === "accepted")) {
        return false; // already active — idempotent no-op, does not re-count against the cap
      }
      const active = await one<{ n: string }>(
        c, `SELECT count(*)::text AS n FROM live_stream_guests WHERE stream_id = $1 AND status IN ('invited', 'accepted')`,
        [streamId],
      );
      if (Number(active.n) >= 6) {
        throw new ApiError("CONFLICT", "This stream already has 6 active guests");
      }
      // L6a: re-inviting a lapsed (declined/removed/ended) guest also clears
      // any stale guest_token from a prior accepted stint — a fresh invite
      // gets a fresh accept before it can publish/read again.
      await c.query(
        `INSERT INTO live_stream_guests (stream_id, user_id, status, invited_at, responded_at, guest_token)
         VALUES ($1, $2, 'invited', now(), NULL, NULL)
         ON CONFLICT (stream_id, user_id) DO UPDATE SET status = 'invited', invited_at = now(), responded_at = NULL, guest_token = NULL`,
        [streamId, targetUserId],
      );
      await audit(c, principal.userId, "live.guest_invited", "live_stream_guests", streamId, { user_id: targetUserId });
      return true;
    });

    if (invited) {
      await this.notify(targetUserId, "live_guest_invite", { stream_id: streamId, title: stream.title });
    }
  }

  /** Invitee only; the invite must currently be 'invited' (a stale/absent one
   *  404s). L6a (docs/LIVE_INTERACTIVE.md): accepting mints a fresh random
   *  guest_token — the WebRTC WHIP/WHEP credential for this guest's slot on
   *  this stream, valid for exactly as long as status stays 'accepted'.
   *  Declining leaves guest_token NULL (it was never accepted). */
  async respondGuestInvite(
    principal: Principal,
    streamId: string,
    input: z.infer<typeof LiveService.GuestRespond>,
  ): Promise<void> {
    const stream = await this.streamOrThrow(streamId);
    this.assertLive(stream);

    await tx(this.pool, async (c) => {
      const existing = await maybeOne<{ status: GuestStatus }>(
        c, `SELECT status FROM live_stream_guests WHERE stream_id = $1 AND user_id = $2 FOR UPDATE`,
        [streamId, principal.userId],
      );
      if (!existing || existing.status !== "invited") {
        throw new ApiError("NOT_FOUND", "No pending guest invite for you on this stream");
      }
      const token = input.accept ? randomBytes(16).toString("hex") : null;
      await c.query(
        `UPDATE live_stream_guests SET status = $3, responded_at = now(), guest_token = $4 WHERE stream_id = $1 AND user_id = $2`,
        [streamId, principal.userId, input.accept ? "accepted" : "declined", token],
      );
      await audit(c, principal.userId, "live.guest_responded", "live_stream_guests", streamId, { accepted: input.accept });
    });
  }

  /** Broadcaster (remove) or the guest themselves (leave). Idempotent — removing
   *  an already-terminal (or never-invited) row is a silent no-op. L6a: also
   *  revokes guest_token — removal/leaving kills the WebRTC publish/read
   *  credential immediately, not just the status label. */
  async removeGuest(principal: Principal, streamId: string, targetUserId: string): Promise<void> {
    const stream = await this.streamOrThrow(streamId);
    this.assertLive(stream);
    const allowed = principal.userId === stream.started_by || principal.userId === targetUserId;
    if (!allowed) throw new ApiError("FORBIDDEN_SCOPE", "Only the broadcaster or the guest themselves may remove this guest");

    await tx(this.pool, async (c) => {
      const res = await c.query(
        `UPDATE live_stream_guests SET status = 'removed', responded_at = now(), guest_token = NULL
          WHERE stream_id = $1 AND user_id = $2 AND status IN ('invited', 'accepted')`,
        [streamId, targetUserId],
      );
      if ((res.rowCount ?? 0) > 0) {
        await audit(c, principal.userId, "live.guest_removed", "live_stream_guests", streamId, { user_id: targetUserId });
      }
    });
  }

  /**
   * L6a (docs/LIVE_INTERACTIVE.md): the accepted guest's own WHIP publish
   * credentials for this stream. 404 for an unknown stream_id (matches every
   * other L5/L6 endpoint's streamOrThrow pattern); FORBIDDEN_SCOPE for every
   * other way the caller isn't currently an accepted guest of a LIVE stream
   * (not live, never invited, declined, removed, or already swept to ended).
   */
  async guestIngest(principal: Principal, streamId: string): Promise<GuestIngest> {
    const stream = await this.streamOrThrow(streamId);
    const guest = await maybeOne<{ status: GuestStatus; guest_token: string | null }>(
      this.pool,
      `SELECT status, guest_token FROM live_stream_guests WHERE stream_id = $1 AND user_id = $2`,
      [streamId, principal.userId],
    );
    if (stream.status !== "live" || !guest || guest.status !== "accepted" || !guest.guest_token) {
      throw new ApiError("FORBIDDEN_SCOPE", "You are not an accepted guest of a live stream");
    }
    const path = guestPathFor(streamId, principal.userId);
    return { whip_url: `${this.webrtcBaseUrl}/${path}/whip`, token: guest.guest_token, path };
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
