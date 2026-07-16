// Chat: direct messages, cell groups, and public spaces (mobile "Chat" make).
// Membership is server-authoritative (§5.4): a member reads only conversations
// they belong to, plus public spaces in their congregation. Sends are offline-
// queueable — client-generated message_id + client_mutation_id replays are
// no-ops (§1.7/§3.6). DMs respect minor-safety (D-M6): a member cannot open a
// DM with a minor (nor a minor with anyone). Group rooms are auto-provisioned
// per cell and the caller is auto-joined on first read.
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx, recordChange, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";

interface ConversationRow {
  conversation_id: string;
  kind: "dm" | "group" | "space";
  is_public: boolean;
  congregation_id: string | null;
  cell_group_id: string | null;
}

/** Roles with cross-conversation oversight + moderation (§5.4). */
type ViewerRole = string | undefined;
const isModerator = (role: ViewerRole): boolean => role === "Admin" || role === "SuperAdmin";

/** A broadcast as every path describes it — the send, the list, the detail — so
 *  the client draws "the message you sent" from one shape, whichever door it
 *  came through. */
export interface BroadcastRow {
  broadcast_id: string;
  body: string;
  msg_type: string;
  attachment_url: string | null;
  audience: "congregation" | "all";
  recipient_count: number;
  created_at: string;
}
const BROADCAST_COLS = "broadcast_id, body, msg_type, attachment_url, audience, recipient_count, created_at";

type ModerationAction = "flag" | "unflag" | "remove" | "restore";

export class ChatService {
  constructor(private readonly pool: Pool) {}

  static readonly SendMessage = z.object({
    message_id: z.string().uuid(), // client-generated (offline-first)
    body: z.string().max(20_000).default(""),
    msg_type: z.enum(["text", "voice", "image", "file", "video"]).default("text"),
    attachment_url: z.string().url().max(2000).optional(),
    attachment_meta: z.record(z.unknown()).optional(),
    reply_to_id: z.string().uuid().optional(),
    client_mutation_id: z.string().uuid().optional(),
  });

  static readonly ToggleReaction = z.object({
    message_id: z.string().uuid(),
    emoji: z.string().min(1).max(16),
    client_mutation_id: z.string().uuid().optional(),
  });

  static readonly MarkRead = z.object({
    conversation_id: z.string().uuid(),
    client_mutation_id: z.string().uuid().optional(),
  });

  static readonly CreateDm = z.object({ user_id: z.string().uuid() });

  static readonly InviteToThread = z.object({ user_id: z.string().uuid() });

  static readonly Broadcast = z.object({
    body: z.string().min(1).max(20_000), // for an image broadcast this is the caption
    msg_type: z.enum(["text", "image"]).default("text"),
    attachment_url: z.string().url().max(2000).optional(),
    /** Who it reaches. OMIT IT and it means the WHOLE CHURCH — only a SuperAdmin
     *  can broadcast at all, and when they simply type and send they mean
     *  everyone. Pass "congregation" to narrow it to their own on purpose.
     *
     *  Deliberately NOT `.default("congregation")`: a schema default is applied
     *  before the service sees the request, making "didn't say" indistinguishable
     *  from "said congregation" — which is exactly how a broadcast quietly
     *  reached 40 of 60 members, the other 19 having no congregation to be
     *  scoped to. */
    audience: z.enum(["congregation", "all"]).optional(),
    client_mutation_id: z.string().uuid().optional(),
  });

  static readonly CreateSpace = z.object({
    conversation_id: z.string().uuid(),
    title: z.string().min(3).max(200),
    topic: z.string().max(300).optional(),
    category: z.string().max(24).optional(),
    client_mutation_id: z.string().uuid().optional(),
  });

  /** The caller's cell + congregation + display fields, or nulls. */
  private async me(c: Queryable, userId: string): Promise<{ cell_group_id: string | null; congregation_id: string | null; is_minor: boolean }> {
    return one(
      c,
      `SELECT cell_group_id, congregation_id, is_minor FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
  }

  /**
   * Ensure a cell has its group room and return its conversation id, without the
   * write-on-read churn of the previous DO UPDATE (which bumped updated_at on
   * every inbox load). Derives congregation + title from the cell itself, so it
   * works for any cell — not just the caller's. Returns null if the cell is gone.
   */
  private async ensureGroupForCell(c: Queryable, cellGroupId: string): Promise<string | null> {
    const existing = await maybeOne<{ conversation_id: string }>(
      c,
      `SELECT conversation_id FROM chat_conversations WHERE cell_group_id = $1 AND kind = 'group'`,
      [cellGroupId],
    );
    if (existing) return existing.conversation_id;
    const cell = await maybeOne<{ name: string; congregation_id: string }>(
      c,
      `SELECT name, congregation_id FROM cell_groups WHERE cell_group_id = $1`,
      [cellGroupId],
    );
    if (!cell) return null;
    const convo = await one<{ conversation_id: string }>(
      c,
      `INSERT INTO chat_conversations (conversation_id, kind, title, cell_group_id, congregation_id, is_public)
       VALUES (gen_random_uuid(), 'group', $1, $2, $3, FALSE)
       ON CONFLICT (cell_group_id) WHERE kind = 'group' DO NOTHING
       RETURNING conversation_id`,
      [`${cell.name} cell`, cellGroupId, cell.congregation_id],
    );
    // Lost the insert race → read the row the winning transaction created.
    if (convo) return convo.conversation_id;
    const raced = await one<{ conversation_id: string }>(
      c,
      `SELECT conversation_id FROM chat_conversations WHERE cell_group_id = $1 AND kind = 'group'`,
      [cellGroupId],
    );
    return raced.conversation_id;
  }

  /** Ensure the caller's cell has a group room and the caller is a member of it.
   *  Skips all writes once both already hold — the common case on inbox reload. */
  private async ensureCellGroup(c: Queryable, userId: string): Promise<void> {
    const me = await this.me(c, userId);
    if (!me.cell_group_id) return;
    const already = await maybeOne(
      c,
      `SELECT 1 FROM chat_members m
         JOIN chat_conversations cv ON cv.conversation_id = m.conversation_id
        WHERE cv.cell_group_id = $1 AND cv.kind = 'group' AND m.user_id = $2`,
      [me.cell_group_id, userId],
    );
    if (already) return; // provisioned + joined — no write needed
    const conversationId = await this.ensureGroupForCell(c, me.cell_group_id);
    if (!conversationId) return;
    await c.query(
      `INSERT INTO chat_members (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [conversationId, userId],
    );
  }

  /**
   * Open (provisioning if needed) a specific cell's group conversation and add
   * the actor as a member so they can post — used by the portal's "Message cell"
   * action. Caller scope (leader_assignments / Admin) is enforced at the route
   * via assertCellInScope before this runs.
   */
  async ensureCellConversation(actorUserId: string, cellGroupId: string): Promise<{ conversation_id: string }> {
    return tx(this.pool, async (c) => {
      const conversationId = await this.ensureGroupForCell(c, cellGroupId);
      if (!conversationId) throw new ApiError("NOT_FOUND", "Cell not found");
      await c.query(
        `INSERT INTO chat_members (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [conversationId, actorUserId],
      );
      return { conversation_id: conversationId };
    });
  }

  /**
   * DM directory: members in the caller's congregation the caller may message.
   * Minor-safe (D-M6) — a minor caller gets an empty list, and minors never
   * appear for anyone. Excludes self and soft-deleted users. Optional name search.
   */
  async listPeople(userId: string, q?: string, viewerRole?: ViewerRole): Promise<{ people: unknown[] }> {
    const me = await this.me(this.pool, userId);
    const term = (q ?? "").trim();
    // Achievement flair on every directory row — PUBLIC aggregates only (level,
    // counts, up to 3 badge icons). Never per-badge provenance, scores, or any
    // other private detail. Lateral joins keep it one round-trip per query.
    const flairSelect = `,
            COALESCE(e.current_level, 1)   AS level,
            COALESCE(bd.badge_count, 0)    AS badge_count,
            COALESCE(bd.badge_icons, '{}') AS badge_icons,
            COALESCE(ce.cert_count, 0)     AS cert_count`;
    const flairJoins = `
           LEFT JOIN enrollments e ON e.user_id = u.user_id
           LEFT JOIN LATERAL (
             SELECT COUNT(*)::int AS badge_count,
                    (ARRAY_REMOVE(ARRAY_AGG(b.icon_key ORDER BY ub.awarded_at DESC), NULL))[1:3] AS badge_icons
               FROM user_badges ub
               JOIN badges b ON b.badge_id = ub.badge_id
              WHERE ub.user_id = u.user_id AND ub.revoked_at IS NULL
           ) bd ON TRUE
           LEFT JOIN LATERAL (
             SELECT COUNT(*)::int AS cert_count FROM certificates ct WHERE ct.user_id = u.user_id
           ) ce ON TRUE`;
    // Portal staff (Admin/SuperAdmin) get the GLOBAL directory — every registered
    // member is immediately reachable, across congregations — so the web portal
    // can DM anyone. Minors are still excluded everywhere (D-M6 minor-safety).
    if (isModerator(viewerRole)) {
      const people = await many(
        this.pool,
        `SELECT u.user_id, u.full_name, u.role, u.avatar_url, c.name AS congregation${flairSelect}
           FROM users u
           LEFT JOIN congregations c ON c.congregation_id = u.congregation_id${flairJoins}
          WHERE u.user_id <> $1
            AND u.deleted_at IS NULL
            AND u.is_minor = FALSE
            ${term ? "AND u.full_name ILIKE $2" : ""}
          ORDER BY u.full_name
          LIMIT 200`,
        term ? [userId, `%${term}%`] : [userId],
      );
      return { people };
    }
    // A member with no congregation sees nobody (can't be scoped to a directory).
    if (me.is_minor || !me.congregation_id) return { people: [] };
    const people = await many(
      this.pool,
      // Only real congregation members appear: a user with a NULL congregation
      // (e.g. an unattached signup) is never DM-able. `= $1` already excludes
      // NULLs; the explicit IS NOT NULL locks the guarantee.
      `SELECT u.user_id, u.full_name, u.role, u.avatar_url${flairSelect}
         FROM users u${flairJoins}
        WHERE u.congregation_id = $1
          AND u.congregation_id IS NOT NULL
          AND u.user_id <> $2
          AND u.deleted_at IS NULL
          AND u.is_minor = FALSE
          ${term ? "AND u.full_name ILIKE $3" : ""}
        ORDER BY u.full_name
        LIMIT 100`,
      term ? [me.congregation_id, userId, `%${term}%`] : [me.congregation_id, userId],
    );
    return { people };
  }

  /** Membership-checked conversation fetch; public spaces are readable by congregation members. */
  private async access(c: Queryable, userId: string, conversationId: string): Promise<ConversationRow> {
    const convo = await maybeOne<ConversationRow>(
      c,
      `SELECT conversation_id, kind, is_public, congregation_id, cell_group_id
         FROM chat_conversations WHERE conversation_id = $1`,
      [conversationId],
    );
    if (!convo) throw new ApiError("NOT_FOUND", "Conversation not found");
    const member = await maybeOne(c, `SELECT 1 FROM chat_members WHERE conversation_id = $1 AND user_id = $2`, [conversationId, userId]);
    if (member) return convo;
    const me = await this.me(c, userId);
    // A cell's group room belongs to every member of that cell — auto-join on access.
    if (convo.kind === "group" && convo.cell_group_id && me.cell_group_id === convo.cell_group_id) {
      await c.query(`INSERT INTO chat_members (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [conversationId, userId]);
      return convo;
    }
    // A public space is readable by everyone if it's GLOBAL (no congregation),
    // otherwise by members of its congregation — and by a not-yet-onboarded member
    // (no congregation), who adopts it when they join.
    if (convo.kind === "space" && convo.is_public && (convo.congregation_id == null || me.congregation_id == null || me.congregation_id === convo.congregation_id)) {
      return convo; // readable, not yet joined
    }
    throw new ApiError("NOT_FOUND", "Conversation not found"); // no existence leak
  }

  /** Moderator conversation fetch — bypasses membership (Admin/SuperAdmin only).
   *
   *  EXCEPT a broadcast thread. When someone answers a broadcast they are writing
   *  privately to the one person who sent it, and moderation is not a reason to
   *  read that. Those threads are SuperAdmin-only, and an Admin who needs to see
   *  one must be invited into that thread by name — the invitation is per-thread,
   *  never per-broadcast. The shield is here rather than only in the list because
   *  a conversation id is guessable-adjacent (it travels in payloads) and the
   *  list is not the only door.
   *
   *  Members are unaffected: the sender and the recipient reach their own thread
   *  through the ordinary membership path in access(), which never comes here. */
  private async accessAsModerator(
    c: Queryable,
    conversationId: string,
    viewerRole?: ViewerRole,
  ): Promise<ConversationRow> {
    const convo = await maybeOne<ConversationRow>(
      c,
      `SELECT conversation_id, kind, is_public, congregation_id, cell_group_id
         FROM chat_conversations WHERE conversation_id = $1`,
      [conversationId],
    );
    if (!convo) throw new ApiError("NOT_FOUND", "Conversation not found");
    if (viewerRole !== "SuperAdmin" && (await this.isBroadcastThread(c, conversationId))) {
      throw new ApiError("NOT_FOUND", "Conversation not found"); // no existence leak
    }
    return convo;
  }

  /** Was this conversation started by a broadcast? (Any message in it stamped
   *  back to a chat_broadcasts parent.) */
  private async isBroadcastThread(c: Queryable, conversationId: string): Promise<boolean> {
    const hit = await maybeOne(
      c,
      `SELECT 1 FROM chat_messages
        WHERE conversation_id = $1 AND broadcast_id IS NOT NULL LIMIT 1`,
      [conversationId],
    );
    return hit !== null && hit !== undefined;
  }

  /**
   * Admin/SuperAdmin oversight inbox: every conversation, with member count,
   * last-message preview, and a per-conversation count of flagged-but-not-hidden
   * messages. Server-authoritative (§1.1) — only moderators reach this path.
   *
   * Broadcast threads are withheld from everyone but a SuperAdmin. Answering a
   * broadcast is writing privately to the one person who sent it, and oversight
   * is not a reason to read that; an Admin who needs a particular thread is
   * invited into that thread by name. Threads they are genuinely IN still reach
   * them — through the personal inbox, as a member, like anyone else.
   */
  private async listAllForModeration(viewerRole?: ViewerRole): Promise<{ conversations: unknown[]; discover_spaces: unknown[] }> {
    const hideBroadcasts = viewerRole !== "SuperAdmin";
    const conversations = await many(
      this.pool,
      `SELECT cv.conversation_id, cv.kind, cv.is_public,
              cv.title, cv.topic, cv.category,
              (SELECT count(*)::int FROM chat_members m2 WHERE m2.conversation_id = cv.conversation_id) AS member_count,
              lm.body AS last_body, lm.msg_type AS last_type, lm.created_at AS last_at,
              (lm.attachment_meta->>'duration')::int AS last_duration,
              la.full_name AS last_author,
              0 AS unread,
              (SELECT count(*)::int FROM chat_messages cm
                 WHERE cm.conversation_id = cv.conversation_id AND NOT cm.is_hidden) AS message_count,
              (SELECT count(*)::int FROM chat_reactions cr
                 JOIN chat_messages rm ON rm.message_id = cr.message_id
                WHERE rm.conversation_id = cv.conversation_id AND NOT rm.is_hidden) AS reaction_count,
              (SELECT count(*)::int FROM chat_messages fm
                 WHERE fm.conversation_id = cv.conversation_id AND fm.is_flagged AND NOT fm.is_hidden) AS flagged
         FROM chat_conversations cv
         LEFT JOIN LATERAL (
            SELECT body, msg_type, created_at, author_user_id, attachment_meta FROM chat_messages
             WHERE conversation_id = cv.conversation_id AND NOT is_hidden
             ORDER BY created_at DESC LIMIT 1
         ) lm ON TRUE
         LEFT JOIN users la ON la.user_id = lm.author_user_id
        WHERE NOT ($1::boolean AND EXISTS (
                SELECT 1 FROM chat_messages bm
                 WHERE bm.conversation_id = cv.conversation_id
                   AND bm.broadcast_id IS NOT NULL))
        ORDER BY COALESCE(lm.created_at, cv.created_at) DESC
        LIMIT 500`,
      [hideBroadcasts],
    );
    return { conversations, discover_spaces: [] };
  }

  /** The inbox: my conversations (with unread + preview) + discoverable spaces. */
  async listConversations(userId: string, viewerRole?: ViewerRole, scope?: "mine" | "all"): Promise<{ conversations: unknown[]; discover_spaces: unknown[] }> {
    // Moderators get the oversight inbox (all conversations), but still see
    // public spaces they haven't joined under "discover" so they can follow them.
    // `scope=mine` opts a moderator into the personal inbox instead (the web
    // portal uses it so staff see their own Spaces / DMs / Groups like mobile).
    if (isModerator(viewerRole) && scope !== "mine") {
      const mod = await this.listAllForModeration(viewerRole);
      return { conversations: mod.conversations, discover_spaces: await this.discoverSpaces(userId) };
    }
    await tx(this.pool, async (c) => this.ensureCellGroup(c, userId));
    const conversations = await many(
      this.pool,
      `SELECT cv.conversation_id, cv.kind, cv.is_public,
              CASE WHEN cv.kind = 'dm' THEN other.full_name ELSE cv.title END AS title,
              CASE WHEN cv.kind = 'dm' THEN other.avatar_url ELSE NULL END AS avatar_url,
              CASE WHEN cv.kind = 'dm' THEN other.user_id ELSE NULL END AS peer_user_id,
              cv.topic, cv.category,
              (SELECT count(*)::int FROM chat_members m2 WHERE m2.conversation_id = cv.conversation_id) AS member_count,
              lm.body AS last_body, lm.msg_type AS last_type, lm.created_at AS last_at,
              (lm.attachment_meta->>'duration')::int AS last_duration,
              la.full_name AS last_author,
              (SELECT count(*)::int FROM chat_messages um
                 WHERE um.conversation_id = cv.conversation_id AND NOT um.is_hidden
                   AND um.author_user_id <> $1
                   AND (mem.last_read_at IS NULL OR um.created_at > mem.last_read_at)) AS unread,
              (SELECT count(*)::int FROM chat_messages cm
                 WHERE cm.conversation_id = cv.conversation_id AND NOT cm.is_hidden) AS message_count,
              (SELECT count(*)::int FROM chat_reactions cr
                 JOIN chat_messages rm ON rm.message_id = cr.message_id
                WHERE rm.conversation_id = cv.conversation_id AND NOT rm.is_hidden) AS reaction_count
         FROM chat_members mem
         JOIN chat_conversations cv ON cv.conversation_id = mem.conversation_id
         LEFT JOIN LATERAL (
            SELECT om.user_id FROM chat_members om
             WHERE om.conversation_id = cv.conversation_id AND om.user_id <> $1 LIMIT 1
         ) od ON cv.kind = 'dm'
         LEFT JOIN users other ON other.user_id = od.user_id
         LEFT JOIN LATERAL (
            SELECT body, msg_type, created_at, author_user_id, attachment_meta FROM chat_messages
             WHERE conversation_id = cv.conversation_id AND NOT is_hidden
             ORDER BY created_at DESC LIMIT 1
         ) lm ON TRUE
         LEFT JOIN users la ON la.user_id = lm.author_user_id
        WHERE mem.user_id = $1
        ORDER BY COALESCE(lm.created_at, cv.created_at) DESC
        LIMIT 200`,
      [userId],
    );
    return { conversations, discover_spaces: await this.discoverSpaces(userId) };
  }

  /**
   * Public spaces the member can follow (kind='space', is_public, not yet joined).
   * Scoped to the member's congregation — but a brand-new member who hasn't been
   * onboarded into one yet (congregation_id IS NULL) sees ALL public spaces, so
   * the Chat tab is never empty for them; joining a space adopts its congregation.
   */
  private async discoverSpaces(userId: string): Promise<unknown[]> {
    return many(
      this.pool,
      `SELECT cv.conversation_id, cv.title, cv.topic, cv.category,
              (SELECT count(*)::int FROM chat_members m2 WHERE m2.conversation_id = cv.conversation_id) AS member_count
         FROM chat_conversations cv
         JOIN users u ON u.user_id = $1
        WHERE cv.kind = 'space' AND cv.is_public = TRUE
          -- A public space with no congregation is GLOBAL (visible to everyone);
          -- otherwise it's scoped to its congregation. A not-yet-onboarded member
          -- (no congregation) sees all public spaces.
          AND (cv.congregation_id IS NULL OR u.congregation_id IS NULL OR cv.congregation_id = u.congregation_id)
          AND NOT EXISTS (SELECT 1 FROM chat_members m WHERE m.conversation_id = cv.conversation_id AND m.user_id = $1)
        ORDER BY cv.created_at DESC
        LIMIT 50`,
      [userId],
    );
  }

  /**
   * A conversation's messages (oldest→newest) with reactions, reply previews,
   * authors. Members see only visible messages. Moderators (Admin/SuperAdmin)
   * bypass membership, see hidden messages, and get per-message moderation state.
   */
  async getConversation(userId: string, conversationId: string, viewerRole?: ViewerRole): Promise<unknown> {
    const moderator = isModerator(viewerRole);
    // A moderator bypasses membership — but NOT into a broadcast thread, which
    // only a SuperAdmin may read from the outside. An Admin INVITED into one
    // still gets in: they go through the ordinary membership door instead, which
    // is the whole point of inviting them to a thread rather than to a broadcast.
    const shielded = moderator && viewerRole !== "SuperAdmin"
      && (await this.isBroadcastThread(this.pool, conversationId));
    const convo = moderator && !shielded
      ? await this.accessAsModerator(this.pool, conversationId, viewerRole)
      : await this.access(this.pool, userId, conversationId);
    const head = await one<Record<string, unknown>>(
      this.pool,
      `SELECT cv.conversation_id, cv.kind, cv.is_public, cv.topic, cv.category,
              CASE WHEN cv.kind = 'dm' THEN other.full_name ELSE cv.title END AS title,
              CASE WHEN cv.kind = 'dm' THEN other.avatar_url ELSE NULL END AS avatar_url,
              (SELECT count(*)::int FROM chat_members m2 WHERE m2.conversation_id = cv.conversation_id) AS member_count,
              EXISTS (SELECT 1 FROM chat_members m WHERE m.conversation_id = cv.conversation_id AND m.user_id = $1) AS joined
         FROM chat_conversations cv
         LEFT JOIN LATERAL (
            SELECT om.user_id FROM chat_members om WHERE om.conversation_id = cv.conversation_id AND om.user_id <> $1 LIMIT 1
         ) od ON cv.kind = 'dm'
         LEFT JOIN users other ON other.user_id = od.user_id
        WHERE cv.conversation_id = $2`,
      [userId, conversationId],
    );
    const messages = await many(
      this.pool,
      `SELECT m.message_id, m.author_user_id, u.full_name AS author_name, u.avatar_url AS author_avatar, m.body, m.msg_type,
              m.attachment_url, m.attachment_meta, m.reply_to_id, m.ai_tag, m.is_edited, m.created_at,
              m.broadcast_id,
              ${moderator ? "m.is_hidden, m.is_flagged, m.flag_reason, m.moderated_at," : ""}
              rt.body AS reply_body, ru.full_name AS reply_author,
              (m.author_user_id = $1) AS mine,
              COALESCE((
                 SELECT json_agg(json_build_object('emoji', r.emoji, 'count', r.cnt, 'mine', r.mine))
                   FROM (SELECT emoji, count(*)::int AS cnt, bool_or(user_id = $1) AS mine
                           FROM chat_reactions WHERE message_id = m.message_id GROUP BY emoji) r
              ), '[]'::json) AS reactions,
              -- Read receipts: how many recipients (everyone but the author) have a
              -- last_read pointer at/after this message, and how many recipients exist.
              (SELECT count(*)::int FROM chat_members mr
                 WHERE mr.conversation_id = m.conversation_id AND mr.user_id <> m.author_user_id
                   AND mr.last_read_at IS NOT NULL AND mr.last_read_at >= m.created_at) AS read_count,
              (SELECT count(*)::int FROM chat_members mr2
                 WHERE mr2.conversation_id = m.conversation_id AND mr2.user_id <> m.author_user_id) AS recipient_count
         FROM chat_messages m
         JOIN users u ON u.user_id = m.author_user_id
         LEFT JOIN chat_messages rt ON rt.message_id = m.reply_to_id
         LEFT JOIN users ru ON ru.user_id = rt.author_user_id
        WHERE m.conversation_id = $2 AND m.deleted_at IS NULL ${moderator ? "" : "AND NOT m.is_hidden"}
        ORDER BY m.created_at
        LIMIT 500`,
      [userId, conversationId],
    );
    return { ...head, kind: convo.kind, messages };
  }

  async sendMessage(
    userId: string,
    conversationId: string,
    input: z.infer<typeof ChatService.SendMessage>,
  ): Promise<{ message_id: string; duplicate: boolean }> {
    return tx(this.pool, async (c) => {
      if (input.client_mutation_id) {
        const dup = await maybeOne<{ message_id: string }>(c, `SELECT message_id FROM chat_messages WHERE client_mutation_id = $1`, [input.client_mutation_id]);
        if (dup) return { message_id: dup.message_id, duplicate: true };
      }
      const convo = await this.access(c, userId, conversationId);
      // Public spaces auto-join the sender on first post (matches the make's join-then-send flow).
      if (convo.kind === "space") {
        await c.query(`INSERT INTO chat_members (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [conversationId, userId]);
      }
      const res = await c.query(
        `INSERT INTO chat_messages (message_id, conversation_id, author_user_id, body, msg_type, attachment_url, attachment_meta, reply_to_id, client_mutation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (message_id) DO NOTHING RETURNING message_id`,
        [
          input.message_id, conversationId, userId, input.body, input.msg_type,
          input.attachment_url ?? null, input.attachment_meta ? JSON.stringify(input.attachment_meta) : null,
          input.reply_to_id ?? null, input.client_mutation_id ?? null,
        ],
      );
      if (res.rowCount === 0) return { message_id: input.message_id, duplicate: true };
      await c.query(`UPDATE chat_conversations SET updated_at = now() WHERE conversation_id = $1`, [conversationId]);
      await recordChange(c, "chat_messages", input.message_id, null, "upsert");
      return { message_id: input.message_id, duplicate: false };
    });
  }

  static readonly EditMessage = z.object({ body: z.string().min(1).max(4000) });

  /** Author-only edit. Only the message's author may change its body; sets the
   *  is_edited flag so the client can show "(edited)". 404 if not theirs/deleted. */
  async editMessage(userId: string, messageId: string, body: string): Promise<{ message_id: string; body: string; is_edited: boolean }> {
    const row = await maybeOne<{ message_id: string; body: string }>(
      this.pool,
      `UPDATE chat_messages SET body = $3, is_edited = TRUE, updated_at = now()
         WHERE message_id = $1 AND author_user_id = $2 AND deleted_at IS NULL
       RETURNING message_id, body`,
      [messageId, userId, body],
    );
    if (!row) throw new ApiError("NOT_FOUND", "Message not found or not yours to edit");
    return { ...row, is_edited: true };
  }

  /** Author-only soft delete. The message is excluded from every read thereafter. */
  async deleteMessage(userId: string, messageId: string): Promise<{ message_id: string; deleted: boolean }> {
    const row = await maybeOne<{ message_id: string }>(
      this.pool,
      `UPDATE chat_messages SET deleted_at = now(), updated_at = now()
         WHERE message_id = $1 AND author_user_id = $2 AND deleted_at IS NULL
       RETURNING message_id`,
      [messageId, userId],
    );
    if (!row) throw new ApiError("NOT_FOUND", "Message not found or not yours to delete");
    return { message_id: row.message_id, deleted: true };
  }

  async toggleReaction(userId: string, input: z.infer<typeof ChatService.ToggleReaction>): Promise<{ message_id: string; emoji: string; on: boolean }> {
    return tx(this.pool, async (c) => {
      const msg = await maybeOne<{ conversation_id: string }>(c, `SELECT conversation_id FROM chat_messages WHERE message_id = $1 AND NOT is_hidden`, [input.message_id]);
      if (!msg) throw new ApiError("NOT_FOUND", "Message not found");
      await this.access(c, userId, msg.conversation_id);
      const del = await c.query(`DELETE FROM chat_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`, [input.message_id, userId, input.emoji]);
      if ((del.rowCount ?? 0) > 0) return { message_id: input.message_id, emoji: input.emoji, on: false };
      await c.query(`INSERT INTO chat_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [input.message_id, userId, input.emoji]);
      return { message_id: input.message_id, emoji: input.emoji, on: true };
    });
  }

  async markRead(userId: string, conversationId: string): Promise<{ conversation_id: string }> {
    await this.access(this.pool, userId, conversationId);
    await this.pool.query(
      `UPDATE chat_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId],
    );
    return { conversation_id: conversationId };
  }

  /** Read receipts for a message — who (other than the author) has seen it, and how
   *  many recipients there are. Author-only (the "eye" / Seen-by view). */
  async messageReaders(
    userId: string,
    messageId: string,
  ): Promise<{ recipient_count: number; read_count: number; readers: unknown[] }> {
    const msg = await maybeOne<{ conversation_id: string; author_user_id: string; created_at: string }>(
      this.pool,
      `SELECT conversation_id, author_user_id, created_at FROM chat_messages WHERE message_id = $1 AND deleted_at IS NULL`,
      [messageId],
    );
    if (!msg) throw new ApiError("NOT_FOUND", "Message not found");
    if (msg.author_user_id !== userId) throw new ApiError("FORBIDDEN_SCOPE", "Only the author can see read receipts");
    const recipient = await one<{ n: number }>(
      this.pool,
      `SELECT count(*)::int AS n FROM chat_members WHERE conversation_id = $1 AND user_id <> $2`,
      [msg.conversation_id, userId],
    );
    const readers = await many(
      this.pool,
      `SELECT u.user_id, u.full_name, u.avatar_url, mr.last_read_at AS read_at
         FROM chat_members mr JOIN users u ON u.user_id = mr.user_id
        WHERE mr.conversation_id = $1 AND mr.user_id <> $2
          AND mr.last_read_at IS NOT NULL AND mr.last_read_at >= $3
        ORDER BY mr.last_read_at DESC`,
      [msg.conversation_id, userId, msg.created_at],
    );
    return { recipient_count: recipient.n, read_count: readers.length, readers };
  }

  /**
   * Create or return the 1:1 DM with another member. Minor-safe everywhere. A
   * member may only DM within their own congregation; portal staff (Admin/
   * SuperAdmin) may DM anyone (cross-congregation) so the portal can reach
   * everyone registered.
   */
  async createOrGetDm(userId: string, otherUserId: string, viewerRole?: ViewerRole): Promise<{ conversation_id: string }> {
    if (otherUserId === userId) throw new ApiError("UNPROCESSABLE", "Cannot DM yourself");
    return tx(this.pool, async (c) => {
      const me = await this.me(c, userId);
      const other = await maybeOne<{ congregation_id: string | null; is_minor: boolean }>(
        c, `SELECT congregation_id, is_minor FROM users WHERE user_id = $1 AND deleted_at IS NULL`, [otherUserId],
      );
      if (!other) throw new ApiError("NOT_FOUND", "Member not found");
      if (me.is_minor || other.is_minor) throw new ApiError("FORBIDDEN_SCOPE", "Direct messages are unavailable for minors");
      const moderator = isModerator(viewerRole);
      if (!moderator && (!me.congregation_id || me.congregation_id !== other.congregation_id)) {
        throw new ApiError("NOT_FOUND", "Member not found");
      }
      // The DM is filed under the initiator's congregation (or the other member's,
      // for a not-yet-onboarded staff account).
      const dmCongregation = me.congregation_id ?? other.congregation_id;
      const conversationId = await this.ensureDm(c, userId, otherUserId, dmCongregation);
      return { conversation_id: conversationId };
    });
  }

  /** Find-or-create the 1:1 DM between two users — the raw ensure step shared by
   *  createOrGetDm and broadcast. No policy checks here; callers gate first. */
  private async ensureDm(c: Queryable, userId: string, otherUserId: string, congregationId: string | null): Promise<string> {
    const existing = await maybeOne<{ conversation_id: string }>(
      c,
      `SELECT cv.conversation_id FROM chat_conversations cv
        WHERE cv.kind = 'dm'
          AND EXISTS (SELECT 1 FROM chat_members a WHERE a.conversation_id = cv.conversation_id AND a.user_id = $1)
          AND EXISTS (SELECT 1 FROM chat_members b WHERE b.conversation_id = cv.conversation_id AND b.user_id = $2)
        LIMIT 1`,
      [userId, otherUserId],
    );
    if (existing) return existing.conversation_id;

    const convo = await one<{ conversation_id: string }>(
      c,
      `INSERT INTO chat_conversations (conversation_id, kind, congregation_id, created_by)
       VALUES (gen_random_uuid(), 'dm', $1, $2) RETURNING conversation_id`,
      [congregationId, userId],
    );
    await c.query(
      `INSERT INTO chat_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`,
      [convo.conversation_id, userId, otherUserId],
    );
    return convo.conversation_id;
  }

  /** Everyone a broadcast reaches, excluding the sender, soft-deleted accounts,
   *  and minors (D-M6 — a broadcast materializes DMs, and DMs with minors are
   *  forbidden everywhere).
   *
   *  audience "congregation": active members of the sender's own congregation.
   *  audience "all": every active member, congregation or not — the whole point
   *  of the SuperAdmin reach is that it does not depend on where someone has
   *  been filed. (Roughly a third of members currently have no congregation, so
   *  a congregation-scoped fan-out would silently skip them.) */
  private async broadcastRecipients(
    c: Queryable,
    senderId: string,
    audience: "congregation" | "all",
  ): Promise<string[]> {
    if (audience === "all") {
      const rows = await many<{ user_id: string }>(
        c,
        `SELECT user_id FROM users
          WHERE user_id <> $1 AND deleted_at IS NULL AND is_minor = FALSE
          ORDER BY user_id`,
        [senderId],
      );
      return rows.map((r) => r.user_id);
    }
    const me = await this.me(c, senderId);
    if (!me.congregation_id) throw new ApiError("UNPROCESSABLE", "You need a congregation to broadcast");
    const rows = await many<{ user_id: string }>(
      c,
      `SELECT user_id FROM users
        WHERE congregation_id = $1 AND user_id <> $2 AND deleted_at IS NULL AND is_minor = FALSE
        ORDER BY user_id`,
      [me.congregation_id, senderId],
    );
    return rows.map((r) => r.user_id);
  }

  /**
   * Staff broadcast (Instructor+ — gated at the route, §5.4): deliver ONE message
   * to EVERY active member of the sender's congregation as an individual DM from
   * the sender. No group room — each member replies in their own 1:1 thread,
   * which lands back in the sender's inbox like any DM. Message ids are
   * server-minted (gen_random_uuid — the client never chooses them); the whole
   * fan-out is one transaction, so it lands for everyone or no one. Idempotent
   * on client_mutation_id (§3.6): the id is stamped on the first delivered copy
   * (the column is UNIQUE), so a replay short-circuits to a no-op. May carry an
   * image (msg_type='image' + attachment_url, same shape as sendMessage — the
   * bytes went straight to Cloudinary via /chat/attachments/sign, §4.5); body
   * is then the caption.
   */
  async broadcast(
    senderId: string,
    input: z.infer<typeof ChatService.Broadcast>,
    viewerRole?: ViewerRole,
  ): Promise<BroadcastRow & { sent: number; duplicate: boolean }> {
    // Unasked, the reach follows who you are: a SuperAdmin's broadcast means the
    // WHOLE church — including the members filed under no congregation, who are
    // not a rounding error (19 of 60 today). Anyone else means their own.
    const audience = input.audience ?? (viewerRole === "SuperAdmin" ? "all" : "congregation");
    // Reaching every congregation at once is a SuperAdmin act, however it arrives.
    if (audience === "all" && viewerRole !== "SuperAdmin") {
      throw new ApiError("FORBIDDEN_SCOPE", "Only a SuperAdmin can broadcast to every member");
    }
    return tx(this.pool, async (c) => {
      // Idempotent on the BROADCAST (§3.6), not on one lucky copy: a replay now
      // returns the id and the count that actually landed, rather than
      // recomputing today's membership and reporting a number that never
      // happened.
      // A replay returns the SAME sent thing, whole — so a client that lost the
      // response (or retried from its offline queue) still renders the message
      // exactly as it went out, rather than a bare id it cannot draw.
      if (input.client_mutation_id) {
        const dup = await maybeOne<BroadcastRow>(
          c,
          `SELECT ${BROADCAST_COLS} FROM chat_broadcasts WHERE client_mutation_id = $1`,
          [input.client_mutation_id],
        );
        if (dup) return { ...dup, sent: dup.recipient_count, duplicate: true };
      }
      const recipients = await this.broadcastRecipients(c, senderId, audience);
      const me = await this.me(c, senderId);
      // Return the whole row, not just its id: the moment a broadcast is sent the
      // UI shows it as THE SENT MESSAGE — pinned at the top of its own page, with
      // the server's own timestamp and the count it actually reached. Sending
      // should not need a second round trip to find out what you just said.
      const bc = await one<BroadcastRow>(
        c,
        `INSERT INTO chat_broadcasts
           (sender_user_id, body, msg_type, attachment_url, audience, congregation_id, recipient_count, client_mutation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${BROADCAST_COLS}`,
        [
          senderId, input.body, input.msg_type, input.attachment_url ?? null,
          audience, audience === "all" ? null : me.congregation_id,
          recipients.length, input.client_mutation_id ?? null,
        ],
      );
      for (const otherUserId of recipients) {
        // An 'all' broadcast crosses congregations, so the DM belongs to the
        // recipient's, not the sender's.
        const dmCongregation = audience === "all"
          ? (await this.me(c, otherUserId)).congregation_id ?? me.congregation_id
          : me.congregation_id;
        const conversationId = await this.ensureDm(c, senderId, otherUserId, dmCongregation);
        const msg = await one<{ message_id: string }>(
          c,
          `INSERT INTO chat_messages (message_id, conversation_id, author_user_id, body, msg_type, attachment_url, broadcast_id)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6) RETURNING message_id`,
          [conversationId, senderId, input.body, input.msg_type, input.attachment_url ?? null, bc.broadcast_id],
        );
        await c.query(`UPDATE chat_conversations SET updated_at = now() WHERE conversation_id = $1`, [conversationId]);
        await recordChange(c, "chat_messages", msg.message_id, null, "upsert");
      }
      return { ...bc, sent: recipients.length, duplicate: false };
    });
  }

  /**
   * Bring one more person into ONE thread — never into the broadcast.
   *
   * The unit of authorisation is deliberately the thread, not the broadcast: a
   * SuperAdmin who wants a deacon on Ann's reply authorises them for ANN's
   * thread, and gains them nothing anywhere else. There is no "share the
   * broadcast" verb, because that would hand over sixty private conversations
   * with one tap.
   *
   * The member is TOLD. A note lands in the thread naming who joined, because a
   * person who wrote privately to their pastor is owed the knowledge that
   * someone else is now reading — a silent reader is a betrayal, not a feature.
   * The note is a real message, so it syncs, previews, and cannot be missed.
   *
   * The thread stops being a dm the moment a third person is in it (a dm's
   * title/avatar is "the other member", which is meaningless once there are
   * two of them), so it becomes a group titled for the member it is about.
   */
  async inviteToThread(
    actorId: string,
    conversationId: string,
    input: z.infer<typeof ChatService.InviteToThread>,
    viewerRole?: ViewerRole,
  ): Promise<{ conversation_id: string; invited: string; already: boolean }> {
    if (viewerRole !== "SuperAdmin") {
      throw new ApiError("FORBIDDEN_SCOPE", "Only a SuperAdmin can bring someone into a thread");
    }
    return tx(this.pool, async (c) => {
      const convo = await maybeOne<{ kind: string; congregation_id: string | null }>(
        c,
        `SELECT kind, congregation_id FROM chat_conversations WHERE conversation_id = $1`,
        [conversationId],
      );
      if (!convo) throw new ApiError("NOT_FOUND", "Conversation not found");
      // You may only widen a room you are in. Oversight is not authorship.
      const mine = await maybeOne(
        c, `SELECT 1 FROM chat_members WHERE conversation_id = $1 AND user_id = $2`, [conversationId, actorId],
      );
      if (!mine) throw new ApiError("FORBIDDEN_SCOPE", "You are not in this thread");
      if (input.user_id === actorId) throw new ApiError("UNPROCESSABLE", "You are already here");

      const guest = await maybeOne<{ full_name: string; is_minor: boolean }>(
        c,
        `SELECT full_name, is_minor FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
        [input.user_id],
      );
      if (!guest) throw new ApiError("NOT_FOUND", "Member not found");
      if (guest.is_minor) throw new ApiError("FORBIDDEN_SCOPE", "Direct messages are unavailable for minors");

      const already = await maybeOne(
        c, `SELECT 1 FROM chat_members WHERE conversation_id = $1 AND user_id = $2`, [conversationId, input.user_id],
      );
      if (already) return { conversation_id: conversationId, invited: input.user_id, already: true };

      await c.query(
        `INSERT INTO chat_members (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [conversationId, input.user_id],
      );
      if (convo.kind === "dm") {
        // Title it for the person it is ABOUT — the one member who isn't staff —
        // so it stays findable for everyone now in it.
        const subject = await maybeOne<{ full_name: string }>(
          c,
          `SELECT u.full_name FROM chat_members m
             JOIN users u ON u.user_id = m.user_id
            WHERE m.conversation_id = $1 AND m.user_id <> $2 AND m.user_id <> $3
            ORDER BY u.full_name LIMIT 1`,
          [conversationId, actorId, input.user_id],
        );
        await c.query(
          `UPDATE chat_conversations SET kind = 'group', title = COALESCE(title, $2), updated_at = now()
            WHERE conversation_id = $1`,
          [conversationId, subject?.full_name ?? "Conversation"],
        );
      }
      const actor = await maybeOne<{ full_name: string }>(
        c, `SELECT full_name FROM users WHERE user_id = $1`, [actorId],
      );
      const note = await one<{ message_id: string }>(
        c,
        `INSERT INTO chat_messages (message_id, conversation_id, author_user_id, body, msg_type)
         VALUES (gen_random_uuid(), $1, $2, $3, 'text') RETURNING message_id`,
        [conversationId, actorId, `${actor?.full_name ?? "A leader"} invited ${guest.full_name} into this conversation.`],
      );
      await c.query(`UPDATE chat_conversations SET updated_at = now() WHERE conversation_id = $1`, [conversationId]);
      await recordChange(c, "chat_messages", note.message_id, null, "upsert");
      return { conversation_id: conversationId, invited: input.user_id, already: false };
    });
  }

  /** Broadcasts newest first, each with the numbers that matter: how many it
   *  reached, how many have seen it, how many answered.
   *
   *  The page opens on the last 4 — the ones still live enough to be worth
   *  watching — and asks for the rest only when you say so. `limit` caps it;
   *  `total` tells the client how many more there are, so "show all 12" can name
   *  its number instead of guessing. */
  async listBroadcasts(senderId: string, limit = 4): Promise<{ data: unknown[]; total: number }> {
    const { n: total } = await one<{ n: number }>(
      this.pool,
      `SELECT count(*)::int AS n FROM chat_broadcasts WHERE sender_user_id = $1`,
      [senderId],
    );
    const data = await many(
      this.pool,
      `SELECT b.broadcast_id, b.body, b.msg_type, b.attachment_url, b.audience,
              b.recipient_count, b.created_at,
              (SELECT count(DISTINCT r.author_user_id)::int
                 FROM chat_messages copy
                 JOIN chat_messages r ON r.conversation_id = copy.conversation_id
                WHERE copy.broadcast_id = b.broadcast_id
                  AND r.author_user_id <> b.sender_user_id
                  AND r.created_at > copy.created_at
                  AND r.deleted_at IS NULL AND NOT r.is_hidden) AS replied_count,
              (SELECT count(*)::int
                 FROM chat_messages copy
                 JOIN chat_members mem ON mem.conversation_id = copy.conversation_id
                                      AND mem.user_id <> b.sender_user_id
                WHERE copy.broadcast_id = b.broadcast_id
                  AND mem.last_read_at IS NOT NULL
                  AND mem.last_read_at >= copy.created_at) AS seen_count
         FROM chat_broadcasts b
        WHERE b.sender_user_id = $1
        ORDER BY b.created_at DESC
        LIMIT $2`,
      [senderId, limit],
    );
    return { data, total };
  }

  /**
   * One broadcast and everything it stirred up: the message itself at the top,
   * then every response beneath it — the church answering back in one place.
   *
   * A response needs no table of its own: it is any message in a delivered
   * copy's conversation, written by the recipient, after the copy landed. Each
   * carries its conversation_id, which IS the private thread with that person —
   * already seeded with the broadcast as its top message. Promoting a response
   * to a full conversation is therefore just opening it; there is nothing to
   * create, and no context to re-attach.
   */
  async broadcastDetail(senderId: string, broadcastId: string, viewerRole?: ViewerRole): Promise<unknown> {
    const b = await maybeOne<{ sender_user_id: string }>(
      this.pool,
      `SELECT broadcast_id, sender_user_id, body, msg_type, attachment_url, audience,
              recipient_count, created_at
         FROM chat_broadcasts WHERE broadcast_id = $1`,
      [broadcastId],
    );
    if (!b) throw new ApiError("NOT_FOUND", "Broadcast not found");
    // Your own — or any, if you are a SuperAdmin: broadcasts are the one place a
    // SuperAdmin has oversight by role. For everyone else these replies are the
    // private words of members answering ONE person (§5.4), so an Admin who needs
    // a particular conversation is invited into that THREAD, never handed the
    // broadcast.
    if (b.sender_user_id !== senderId && viewerRole !== "SuperAdmin") {
      throw new ApiError("FORBIDDEN_SCOPE", "Not your broadcast");
    }
    const responses = await many(
      this.pool,
      `SELECT r.message_id, r.conversation_id, r.body, r.msg_type, r.attachment_url,
              r.created_at, u.user_id, u.full_name, u.avatar_url,
              (SELECT count(*)::int FROM chat_messages n
                WHERE n.conversation_id = r.conversation_id
                  AND n.author_user_id = r.author_user_id
                  AND n.deleted_at IS NULL AND NOT n.is_hidden) AS from_them
         FROM chat_messages copy
         JOIN chat_messages r ON r.conversation_id = copy.conversation_id
                             AND r.created_at > copy.created_at
         JOIN users u ON u.user_id = r.author_user_id
        WHERE copy.broadcast_id = $1
          AND r.author_user_id <> $2
          AND r.deleted_at IS NULL AND NOT r.is_hidden
        ORDER BY r.created_at DESC
        LIMIT 500`,
      // Exclude the BROADCAST'S sender, not the viewer — a SuperAdmin reading
      // someone else's broadcast wants the members' answers, not to have their
      // own messages filtered out of a thread they were never in.
      [broadcastId, b.sender_user_id],
    );
    // Who it reached, and who has actually seen it — the ticks.
    //
    // delivered: the copy exists in their thread. A broadcast is written server-
    //   side into every recipient's conversation in one transaction, so delivery
    //   is not a hope: if the row is there, it arrived. One blue tick.
    // seen_at: they opened the thread AFTER the copy landed (chat_members
    //   .last_read_at, the same read receipt the rest of chat runs on). Two blue
    //   ticks.
    const recipients = await many(
      this.pool,
      `SELECT u.user_id, u.full_name, u.avatar_url,
              copy.created_at AS delivered_at,
              TRUE AS delivered,
              (mem.last_read_at IS NOT NULL AND mem.last_read_at >= copy.created_at) AS seen,
              CASE WHEN mem.last_read_at IS NOT NULL AND mem.last_read_at >= copy.created_at
                   THEN mem.last_read_at END AS seen_at
         FROM chat_messages copy
         JOIN chat_members mem ON mem.conversation_id = copy.conversation_id
                              AND mem.user_id <> $2
         JOIN users u ON u.user_id = mem.user_id
        WHERE copy.broadcast_id = $1
        ORDER BY (mem.last_read_at IS NOT NULL AND mem.last_read_at >= copy.created_at) DESC,
                 u.full_name`,
      [broadcastId, b.sender_user_id],
    );
    const seenCount = (recipients as Array<{ seen: boolean }>).filter((r) => r.seen).length;
    return { ...b, responses, recipients, delivered_count: recipients.length, seen_count: seenCount };
  }

  /** Join a public space in the caller's congregation. */
  async joinSpace(userId: string, conversationId: string): Promise<{ conversation_id: string; joined: boolean }> {
    return tx(this.pool, async (c) => {
      const convo = await this.access(c, userId, conversationId);
      if (convo.kind !== "space") throw new ApiError("UNPROCESSABLE", "Not a space");
      await c.query(`INSERT INTO chat_members (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [conversationId, userId]);
      // New self-registered members (no congregation yet) adopt the space's
      // congregation on join, so it becomes their home community.
      if (convo.congregation_id) {
        await c.query(
          `UPDATE users SET congregation_id = $2 WHERE user_id = $1 AND congregation_id IS NULL`,
          [userId, convo.congregation_id],
        );
      }
      return { conversation_id: conversationId, joined: true };
    });
  }

  /** Create a public space in the caller's congregation (Instructor+). */
  async createSpace(userId: string, input: z.infer<typeof ChatService.CreateSpace>): Promise<{ conversation_id: string; duplicate: boolean }> {
    return tx(this.pool, async (c) => {
      if (input.client_mutation_id) {
        const dup = await maybeOne<{ conversation_id: string }>(c, `SELECT conversation_id FROM chat_conversations WHERE client_mutation_id = $1`, [input.client_mutation_id]);
        if (dup) return { conversation_id: dup.conversation_id, duplicate: true };
      }
      const me = await this.me(c, userId);
      const res = await c.query(
        `INSERT INTO chat_conversations (conversation_id, kind, title, topic, category, congregation_id, is_public, created_by, client_mutation_id)
         VALUES ($1, 'space', $2, $3, $4, $5, TRUE, $6, $7) ON CONFLICT (conversation_id) DO NOTHING RETURNING conversation_id`,
        [input.conversation_id, input.title, input.topic ?? null, input.category ?? null, me.congregation_id, userId, input.client_mutation_id ?? null],
      );
      if (res.rowCount === 0) return { conversation_id: input.conversation_id, duplicate: true };
      await c.query(`INSERT INTO chat_members (conversation_id, user_id, role) VALUES ($1, $2, 'admin') ON CONFLICT DO NOTHING`, [input.conversation_id, userId]);
      return { conversation_id: input.conversation_id, duplicate: false };
    });
  }

  /**
   * Moderate a message (Admin/SuperAdmin only, §5.4). Server-authoritative state
   * (§1.1): flag (soft, still visible to members), unflag, remove (hide from
   * members), restore. Stamps moderated_by/at for the audit trail.
   */
  async moderateMessage(
    actorId: string,
    role: ViewerRole,
    messageId: string,
    action: ModerationAction,
    reason?: string,
  ): Promise<{ message_id: string; is_flagged: boolean; is_hidden: boolean }> {
    if (!isModerator(role)) throw new ApiError("FORBIDDEN_SCOPE", "Moderation requires Admin");
    return tx(this.pool, async (c) => {
      const msg = await maybeOne<{ message_id: string }>(c, `SELECT message_id FROM chat_messages WHERE message_id = $1`, [messageId]);
      if (!msg) throw new ApiError("NOT_FOUND", "Message not found");
      let row: { is_flagged: boolean; is_hidden: boolean };
      switch (action) {
        case "flag":
          row = await one(c, `UPDATE chat_messages SET is_flagged = TRUE, flag_reason = $2, moderated_by = $3, moderated_at = now() WHERE message_id = $1 RETURNING is_flagged, is_hidden`, [messageId, reason ?? null, actorId]);
          break;
        case "unflag":
          row = await one(c, `UPDATE chat_messages SET is_flagged = FALSE, flag_reason = NULL, moderated_by = $2, moderated_at = now() WHERE message_id = $1 RETURNING is_flagged, is_hidden`, [messageId, actorId]);
          break;
        case "remove":
          row = await one(c, `UPDATE chat_messages SET is_hidden = TRUE, moderated_by = $2, moderated_at = now() WHERE message_id = $1 RETURNING is_flagged, is_hidden`, [messageId, actorId]);
          break;
        case "restore":
          row = await one(c, `UPDATE chat_messages SET is_hidden = FALSE, moderated_by = $2, moderated_at = now() WHERE message_id = $1 RETURNING is_flagged, is_hidden`, [messageId, actorId]);
          break;
      }
      return { message_id: messageId, is_flagged: row.is_flagged, is_hidden: row.is_hidden };
    });
  }
}
