// A targeted reading invite also lands in the inviter↔invitee DM as a card.
//
// Owner, 2026-09-16: "share with a friend, which goes to a chat as a link…
// when you click that link, it opens the plan." Two code paths mint targeted
// invites — creating a group with named members (groups.ts) and inviting into
// an existing group (invites.ts) — so the post lives here, called by both.
//
// The message carries the join URL in plain text (older clients show a
// tappable link) AND `attachment_meta.invite` (newer clients render a plan
// card). Best effort by design: a DM the consent rules refuse must never fail
// the invite — the push notification still reaches them — but the reason is
// logged, never swallowed.
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { maybeOne } from "../../db/db.js";
import { ChatService } from "../chat/service.js";

export interface InviteDmInput {
  inviterId: string;
  inviteeId: string;
  groupId: string;
  token: string;
  inviterName: string | null;
}

export async function postReadingInviteToDm(pool: Pool, publicBaseUrl: string, input: InviteDmInput): Promise<void> {
  try {
    const plan = await maybeOne<{ title: string; subtitle: string | null; day_count: number; image_url: string | null }>(
      pool,
      `SELECT p.title, p.subtitle, p.day_count, p.image_url
         FROM shared_plan_groups g JOIN reading_plans p ON p.plan_id = g.plan_id WHERE g.group_id = $1`,
      [input.groupId],
    );
    if (!plan) return;
    const joinUrl = `${publicBaseUrl.replace(/\/+$/, "")}/join/${input.token}`;
    const first = (input.inviterName ?? "A friend").split(" ")[0];
    const chat = new ChatService(pool);
    const dm = await chat.createOrGetDm(input.inviterId, input.inviteeId);
    await chat.sendMessage(input.inviterId, dm.conversation_id, {
      message_id: randomUUID(),
      body: `${first} invited you to read "${plan.title}" together — ${joinUrl}`,
      msg_type: "text",
      attachment_meta: {
        invite: {
          token: input.token, join_url: joinUrl, plan_title: plan.title, plan_subtitle: plan.subtitle,
          day_count: plan.day_count, image_url: plan.image_url,
        },
      },
      client_mutation_id: randomUUID(),
    });
  } catch (e) {
    console.error("[reading-invite] DM post failed", {
      inviterId: input.inviterId, inviteeId: input.inviteeId, groupId: input.groupId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
