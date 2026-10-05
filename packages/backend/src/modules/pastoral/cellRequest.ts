// "Ask to be connected" — finding a cell (owner, 2026-10-05; EXPERIENCE.md
// §9.2 #12). 37 of 76 members in production had no cell, and "Find your cell"
// led nowhere. The owner chose: the member says where they live and when
// they're free, and the request goes to THEIR pastor in their own pastoral
// thread — the office's existing private channel, so nobody new sees the
// member's area — and the pastor assigns a cell with the tools they already
// have. No list of cells or homes is shown to members.
//
// Its own file because chat/service imports pastoral/service: sending from
// there would be an import cycle.
import type { Pool } from "pg";
import { z } from "zod";
import { maybeOne } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { ChatService } from "../chat/service.js";
import { PastoralService } from "./service.js";

export const CellConnection = z.object({
  area: z.string().trim().min(2).max(80),
  availability: z.string().trim().min(2).max(120),
  note: z.string().trim().max(300).nullish().transform((v) => v || undefined),
  client_mutation_id: z.string().uuid(),
});

export interface CellConnectionStatus {
  in_cell: boolean;
  request: { requested_at: string; conversation_id: string } | null;
}

export class CellRequestService {
  constructor(private readonly pool: Pool) {}

  /** In a cell already? Otherwise, when did they last ask — on any phone. */
  async status(userId: string): Promise<CellConnectionStatus> {
    const me = await maybeOne<{ cell_group_id: string | null }>(
      this.pool,
      `SELECT cell_group_id FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    if (!me) throw new ApiError("NOT_FOUND", "Member not found");
    if (me.cell_group_id) return { in_cell: true, request: null };
    const r = await maybeOne<{ requested_at: string; conversation_id: string }>(
      this.pool,
      `SELECT m.created_at AS requested_at, m.conversation_id
         FROM chat_messages m
        WHERE m.author_user_id = $1 AND m.deleted_at IS NULL
          AND m.attachment_meta->>'kind' = 'cell_request'
        ORDER BY m.created_at DESC
        LIMIT 1`,
      [userId],
    );
    return { in_cell: false, request: r ?? null };
  }

  async ask(userId: string, input: z.infer<typeof CellConnection>): Promise<{ conversation_id: string; requested_at: string }> {
    const now = await this.status(userId);
    if (now.in_cell) throw new ApiError("CONFLICT", "You're already in a cell.");

    let conversationId: string;
    try {
      conversationId = (await new PastoralService(this.pool).openMyThread(userId)).conversation_id;
    } catch (err) {
      // Direct messages stay closed to minors (D-M6): point them to a grown-up.
      if (err instanceof ApiError && err.code === "FORBIDDEN_SCOPE") {
        throw new ApiError("UNPROCESSABLE", "Ask a parent or guardian to contact the church office — they'll connect you to a cell.");
      }
      if (err instanceof ApiError && err.details?.no_pastor) {
        throw new ApiError("UNPROCESSABLE", "The church office can't take this here yet — please ask at church on Sunday.");
      }
      throw err;
    }

    const body = `I'd like to join a cell. I live in ${input.area}, and I'm free ${input.availability}.`
      + (input.note ? `\n\n${input.note}` : "");
    // The normal send path, so the pastor is told as for any message; the
    // client id makes a replay a no-op.
    await new ChatService(this.pool).sendMessage(userId, conversationId, {
      message_id: input.client_mutation_id,
      body,
      msg_type: "text",
      attachment_meta: { kind: "cell_request", area: input.area, availability: input.availability },
      client_mutation_id: input.client_mutation_id,
    });
    const after = await this.status(userId);
    return { conversation_id: conversationId, requested_at: after.request?.requested_at ?? new Date().toISOString() };
  }
}
