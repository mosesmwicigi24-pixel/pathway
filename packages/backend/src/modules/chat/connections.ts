// Chat connections — consent-gated peer relationships (Chat Redesign C1/C2,
// docs/CHAT_REDESIGN.md, docs/CHAT_REDESIGN_PLAN.md §2.2/§4). "No unsolicited
// DMs": A requests a connection → B accepts/declines → only then may a NEW
// /chat/dms thread be created between them (ChatService.createOrGetDm owns
// that gate — see chat/service.ts — this module owns the request/accept/
// decline/remove/block/unblock lifecycle behind it).
//
// Canonical unordered-pair storage (user_a < user_b, LEAST/GREATEST at write
// time — migration 162) turns "one row per pair" and "one pending request per
// pair" into plain (partial) unique indexes rather than app-level locking.
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx, audit, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { NotificationService } from "../notifications/service.js";

export interface ConnectionRow {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  status: "accepted" | "blocked" | "removed";
  established_at: string;
}

export class ConnectionsService {
  private readonly notifications: NotificationService;

  constructor(
    private readonly pool: Pool,
    notifications?: NotificationService,
  ) {
    this.notifications = notifications ?? new NotificationService(pool);
  }

  private async notify(userId: string, template: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.notifications.schedule({ userId, channel: "push", template, payload });
    } catch {
      // best-effort — the connection state change is authoritative regardless
    }
  }

  /** A live, non-deleted user — 404s (no existence leak) rather than surfacing
   *  "deleted" as a distinct state. */
  private async person(c: Queryable, userId: string): Promise<{ user_id: string; full_name: string; is_minor: boolean }> {
    const row = await maybeOne<{ user_id: string; full_name: string; is_minor: boolean; deleted_at: string | null }>(
      c, `SELECT user_id, full_name, is_minor, deleted_at FROM users WHERE user_id = $1`, [userId],
    );
    if (!row || row.deleted_at) throw new ApiError("NOT_FOUND", "Member not found");
    return row;
  }

  static readonly RequestConnection = z.object({
    user_id: z.string().uuid(),
    // nullish, not optional: Android's kotlinx Json sends "message": null when unset.
    message: z.string().max(500).nullish(),
    client_mutation_id: z.string().uuid().optional(),
  });

  /**
   * Ask to connect. Minor-safe (D-M6, extended here — connections are the new
   * gate in front of DMs, so the same rule that forbids a DM with/as a minor
   * forbids a connection with/as one). If the OTHER party already has a
   * pending ask to the caller, this resolves BOTH sides to accepted
   * immediately (a mutual ask) rather than making the second asker wait on a
   * request they'd have accepted anyway.
   */
  async requestConnection(
    userId: string,
    input: z.infer<typeof ConnectionsService.RequestConnection>,
  ): Promise<{ request_id: string; status: string; duplicate: boolean; mutual: boolean }> {
    if (input.user_id === userId) throw new ApiError("UNPROCESSABLE", "Cannot connect with yourself");
    return tx(this.pool, async (c) => {
      if (input.client_mutation_id) {
        const dup = await maybeOne<{ request_id: string; status: string }>(
          c, `SELECT request_id, status FROM connection_requests WHERE client_mutation_id = $1`, [input.client_mutation_id],
        );
        if (dup) return { ...dup, duplicate: true, mutual: false };
      }
      const me = await this.person(c, userId);
      const other = await this.person(c, input.user_id);
      if (me.is_minor || other.is_minor) {
        throw new ApiError("FORBIDDEN_SCOPE", "Connections are unavailable for minors");
      }
      const pair = await maybeOne<{ status: string }>(
        c, `SELECT status FROM user_connections WHERE user_a = LEAST($1::uuid,$2::uuid) AND user_b = GREATEST($1::uuid,$2::uuid)`,
        [userId, input.user_id],
      );
      if (pair?.status === "accepted") throw new ApiError("CONFLICT", "Already connected");
      if (pair?.status === "blocked") throw new ApiError("FORBIDDEN_SCOPE", "This connection is blocked");

      const existingReq = await maybeOne<{ request_id: string; requester_id: string }>(
        c,
        `SELECT request_id, requester_id FROM connection_requests
          WHERE user_a = LEAST($1::uuid,$2::uuid) AND user_b = GREATEST($1::uuid,$2::uuid) AND status = 'pending'`,
        [userId, input.user_id],
      );
      if (existingReq) {
        if (existingReq.requester_id === userId) {
          throw new ApiError("CONFLICT", "A connection request is already pending");
        }
        await c.query(
          `UPDATE connection_requests SET status = 'accepted', decided_at = now(), decided_by = $1 WHERE request_id = $2`,
          [userId, existingReq.request_id],
        );
        await c.query(
          `INSERT INTO user_connections (user_a, user_b, status) VALUES (LEAST($1::uuid,$2::uuid), GREATEST($1::uuid,$2::uuid), 'accepted')
           ON CONFLICT (user_a, user_b) DO UPDATE SET status = 'accepted', blocked_by = NULL, updated_at = now()`,
          [userId, input.user_id],
        );
        await audit(c, userId, "connection.accepted", "connection_requests", existingReq.request_id, { mutual: true });
        await this.notify(existingReq.requester_id, "connection_request_accepted", { user_id: userId, full_name: me.full_name });
        return { request_id: existingReq.request_id, status: "accepted", duplicate: false, mutual: true };
      }

      const row = await one<{ request_id: string; status: string }>(
        c,
        `INSERT INTO connection_requests (user_a, user_b, requester_id, message, client_mutation_id)
         VALUES (LEAST($1::uuid,$2::uuid), GREATEST($1::uuid,$2::uuid), $1, $3, $4) RETURNING request_id, status`,
        [userId, input.user_id, input.message ?? null, input.client_mutation_id ?? null],
      );
      await audit(c, userId, "connection.requested", "connection_requests", row.request_id, { to: input.user_id });
      await this.notify(input.user_id, "connection_request_received", {
        user_id: userId, full_name: me.full_name, request_id: row.request_id,
      });
      return { ...row, duplicate: false, mutual: false };
    });
  }

  /** Pending requests I sent (outgoing) or received (incoming). */
  async listRequests(userId: string, direction: "incoming" | "outgoing"): Promise<{ data: unknown[] }> {
    const data = direction === "outgoing"
      ? await many(
          this.pool,
          `SELECT cr.request_id, cr.status, cr.message, cr.created_at, u.user_id, u.full_name, u.avatar_url
             FROM connection_requests cr
             JOIN users u ON u.user_id = (CASE WHEN cr.user_a = $1 THEN cr.user_b ELSE cr.user_a END)
            WHERE cr.requester_id = $1 AND cr.status = 'pending'
            ORDER BY cr.created_at DESC`,
          [userId],
        )
      : await many(
          this.pool,
          `SELECT cr.request_id, cr.status, cr.message, cr.created_at, u.user_id, u.full_name, u.avatar_url
             FROM connection_requests cr
             JOIN users u ON u.user_id = cr.requester_id
            WHERE (cr.user_a = $1 OR cr.user_b = $1) AND cr.requester_id <> $1 AND cr.status = 'pending'
            ORDER BY cr.created_at DESC`,
          [userId],
        );
    return { data };
  }

  private async findRequest(c: Queryable, requestId: string): Promise<{ user_a: string; user_b: string; requester_id: string; status: string }> {
    const req = await maybeOne<{ user_a: string; user_b: string; requester_id: string; status: string }>(
      c, `SELECT user_a, user_b, requester_id, status FROM connection_requests WHERE request_id = $1`, [requestId],
    );
    if (!req) throw new ApiError("NOT_FOUND", "Connection request not found");
    return req;
  }

  /** Recipient-only. Creates/reinstates the accepted user_connections row. */
  async acceptRequest(userId: string, requestId: string): Promise<{ request_id: string; status: string; already: boolean }> {
    return tx(this.pool, async (c) => {
      const req = await this.findRequest(c, requestId);
      const recipientId = req.requester_id === req.user_a ? req.user_b : req.user_a;
      if (recipientId !== userId) throw new ApiError("FORBIDDEN_SCOPE", "Only the recipient can accept");
      if (req.status !== "pending") return { request_id: requestId, status: req.status, already: true };
      await c.query(`UPDATE connection_requests SET status = 'accepted', decided_at = now(), decided_by = $1 WHERE request_id = $2`, [userId, requestId]);
      await c.query(
        `INSERT INTO user_connections (user_a, user_b, status) VALUES ($1, $2, 'accepted')
         ON CONFLICT (user_a, user_b) DO UPDATE SET status = 'accepted', blocked_by = NULL, updated_at = now()`,
        [req.user_a, req.user_b],
      );
      await audit(c, userId, "connection.accepted", "connection_requests", requestId, {});
      const me = await this.person(c, userId);
      await this.notify(req.requester_id, "connection_request_accepted", { user_id: userId, full_name: me.full_name });
      return { request_id: requestId, status: "accepted", already: false };
    });
  }

  /** Recipient-only. */
  async declineRequest(userId: string, requestId: string): Promise<{ request_id: string; status: string; already: boolean }> {
    return tx(this.pool, async (c) => {
      const req = await this.findRequest(c, requestId);
      const recipientId = req.requester_id === req.user_a ? req.user_b : req.user_a;
      if (recipientId !== userId) throw new ApiError("FORBIDDEN_SCOPE", "Only the recipient can decline");
      if (req.status !== "pending") return { request_id: requestId, status: req.status, already: true };
      await c.query(`UPDATE connection_requests SET status = 'declined', decided_at = now(), decided_by = $1 WHERE request_id = $2`, [userId, requestId]);
      await audit(c, userId, "connection.declined", "connection_requests", requestId, {});
      const me = await this.person(c, userId);
      await this.notify(req.requester_id, "connection_request_declined", { user_id: userId, full_name: me.full_name });
      return { request_id: requestId, status: "declined", already: false };
    });
  }

  /** Requester-only cancel of a still-pending ask. */
  async cancelRequest(userId: string, requestId: string): Promise<{ request_id: string; status: string; already: boolean }> {
    return tx(this.pool, async (c) => {
      const req = await this.findRequest(c, requestId);
      if (req.requester_id !== userId) throw new ApiError("FORBIDDEN_SCOPE", "Only the requester can cancel");
      if (req.status !== "pending") return { request_id: requestId, status: req.status, already: true };
      await c.query(`UPDATE connection_requests SET status = 'cancelled', decided_at = now(), decided_by = $1 WHERE request_id = $2`, [userId, requestId]);
      return { request_id: requestId, status: "cancelled", already: false };
    });
  }

  /** Either party. Existing DM history is kept (no-data-loss) — this only
   *  reverts the pair to "not connected"; a fresh /chat/dms needs a new
   *  accepted connection to open a NEW thread (an existing one is unaffected). */
  async removeConnection(userId: string, otherUserId: string): Promise<{ user_id: string; status: string }> {
    return tx(this.pool, async (c) => {
      const row = await maybeOne<{ status: string }>(
        c, `SELECT status FROM user_connections WHERE user_a = LEAST($1::uuid,$2::uuid) AND user_b = GREATEST($1::uuid,$2::uuid)`, [userId, otherUserId],
      );
      if (!row || row.status !== "accepted") throw new ApiError("NOT_FOUND", "No active connection");
      await c.query(
        `UPDATE user_connections SET status = 'removed', updated_at = now() WHERE user_a = LEAST($1::uuid,$2::uuid) AND user_b = GREATEST($1::uuid,$2::uuid)`,
        [userId, otherUserId],
      );
      await audit(c, userId, "connection.removed", "user_connections", otherUserId, {});
      return { user_id: otherUserId, status: "removed" };
    });
  }

  /** One-directional: `blocked_by` records who. Cancels any pending ask
   *  between them (it no longer means anything once either side blocks). */
  async blockUser(userId: string, otherUserId: string): Promise<{ user_id: string; status: string }> {
    if (otherUserId === userId) throw new ApiError("UNPROCESSABLE", "Cannot block yourself");
    return tx(this.pool, async (c) => {
      await this.person(c, otherUserId);
      await c.query(
        `INSERT INTO user_connections (user_a, user_b, status, blocked_by)
         VALUES (LEAST($1::uuid,$2::uuid), GREATEST($1::uuid,$2::uuid), 'blocked', $1)
         ON CONFLICT (user_a, user_b) DO UPDATE SET status = 'blocked', blocked_by = $1, updated_at = now()`,
        [userId, otherUserId],
      );
      await c.query(
        `UPDATE connection_requests SET status = 'cancelled', decided_at = now(), decided_by = $1
           WHERE user_a = LEAST($1::uuid,$2::uuid) AND user_b = GREATEST($1::uuid,$2::uuid) AND status = 'pending'`,
        [userId, otherUserId],
      );
      await audit(c, userId, "connection.blocked", "user_connections", otherUserId, {});
      return { user_id: otherUserId, status: "blocked" };
    });
  }

  /** Blocker-only. Reverts to "removed" (not automatically re-accepted) — a
   *  fresh request is needed to chat again. */
  async unblockUser(userId: string, otherUserId: string): Promise<{ user_id: string; status: string }> {
    return tx(this.pool, async (c) => {
      const row = await maybeOne<{ status: string; blocked_by: string | null }>(
        c, `SELECT status, blocked_by FROM user_connections WHERE user_a = LEAST($1::uuid,$2::uuid) AND user_b = GREATEST($1::uuid,$2::uuid)`, [userId, otherUserId],
      );
      if (!row || row.status !== "blocked") throw new ApiError("NOT_FOUND", "Not currently blocked");
      if (row.blocked_by !== userId) throw new ApiError("FORBIDDEN_SCOPE", "Only the blocker can unblock");
      await c.query(
        `UPDATE user_connections SET status = 'removed', blocked_by = NULL, updated_at = now() WHERE user_a = LEAST($1::uuid,$2::uuid) AND user_b = GREATEST($1::uuid,$2::uuid)`,
        [userId, otherUserId],
      );
      await audit(c, userId, "connection.unblocked", "user_connections", otherUserId, {});
      return { user_id: otherUserId, status: "removed" };
    });
  }

  /** My accepted connections — "who can I already chat with". */
  async listConnections(userId: string): Promise<{ data: ConnectionRow[] }> {
    const data = await many<ConnectionRow>(
      this.pool,
      `SELECT u.user_id, u.full_name, u.avatar_url, uc.status, uc.established_at
         FROM user_connections uc
         JOIN users u ON u.user_id = (CASE WHEN uc.user_a = $1 THEN uc.user_b ELSE uc.user_a END)
        WHERE (uc.user_a = $1 OR uc.user_b = $1) AND uc.status = 'accepted'
        ORDER BY uc.established_at DESC`,
      [userId],
    );
    return { data };
  }
}
