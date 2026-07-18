// Module: chat — direct messages, cell groups, and public spaces (mobile make).
// All member-facing and server-authoritative on membership (§5.4). Sends are the
// same idempotent shape replayed by /sync/push (chat_messages:create etc.).
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole, assertCellInScope, requirePasswordStepUp } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { ChatService } from "./service.js";
import { ConnectionsService } from "./connections.js";
import { MediaService } from "../media/service.js";

const IdParam = z.object({ id: z.string().uuid() });
const UserIdParam = z.object({ user_id: z.string().uuid() });
const RequestIdParam = z.object({ id: z.string().uuid(), reqId: z.string().uuid() });
const RoleParam = z.object({ id: z.string().uuid(), user_id: z.string().uuid(), role: z.enum(["leader", "moderator"]) });
const MemberActionParam = z.object({ id: z.string().uuid(), user_id: z.string().uuid() });

export const chatRouter: Router = Router();

export function registerChat(ctx: AppContext): Router {
  const svc = new ChatService(ctx.db.primary);
  const connections = new ConnectionsService(ctx.db.primary);
  const media = new MediaService(ctx.env.CLOUDINARY_URL);
  const auth = authenticate(ctx.env);
  const r = chatRouter;

  // Broker real Cloudinary signed-upload params for an attachment; the client
  // POSTs the bytes directly to Cloudinary (never our server, §4.5), then sends a
  // message referencing the returned secure_url. Folder is namespaced per author.
  r.post("/chat/attachments/sign", auth, handler(async (req, res) => {
    parseBody(
      z.object({ content_type: z.string().min(3).max(120), kind: z.enum(["image", "voice", "video", "file"]).default("image") }),
      req.body,
    );
    const folder = `nuru/chat/${requirePrincipal(req).userId}`;
    res.status(201).json(media.signUpload({ folder }));
  }));

  // `?scope=mine` forces the personal inbox (my Spaces / DMs / Groups) even for a
  // moderator — the web portal uses it so staff see their OWN conversations, the
  // same way the mobile app does. Without it, moderators get the oversight inbox.
  const ConvQuery = z.object({ scope: z.enum(["mine", "all"]).optional() });
  r.get("/chat/conversations", auth, handler(async (req, res) => {
    const p = requirePrincipal(req);
    const { scope } = parseBody(ConvQuery, req.query);
    res.json(await svc.listConversations(p.userId, p.role, scope));
  }));

  r.get("/chat/conversations/:id", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const p = requirePrincipal(req);
    res.json(await svc.getConversation(p.userId, id, p.role));
  }));

  r.post("/chat/conversations/:id/messages", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const input = parseBody(ChatService.SendMessage, req.body);
    res.status(201).json(await svc.sendMessage(requirePrincipal(req).userId, id, input));
  }));

  r.post("/chat/conversations/:id/read", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await svc.markRead(requirePrincipal(req).userId, id));
  }));

  r.post("/chat/messages/:id/reactions", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const body = parseBody(ChatService.ToggleReaction.omit({ message_id: true }), req.body);
    res.json(await svc.toggleReaction(requirePrincipal(req).userId, { message_id: id, ...body }));
  }));

  // Read receipts — who has seen this message (author only; the "eye" / Seen-by view).
  r.get("/chat/messages/:id/readers", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await svc.messageReaders(requirePrincipal(req).userId, id));
  }));

  // Author-only edit / delete of a sent message (mobile three-dot "more actions").
  r.patch("/chat/messages/:id", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const { body } = parseBody(ChatService.EditMessage, req.body);
    res.json(await svc.editMessage(requirePrincipal(req).userId, id, body));
  }));

  r.delete("/chat/messages/:id", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await svc.deleteMessage(requirePrincipal(req).userId, id));
  }));

  // DM directory: members the caller may start a direct message with (minor-safe,
  // same congregation). Powers the mobile "New message" picker.
  const PeopleQuery = z.object({ q: z.string().max(120).optional() });
  r.get("/chat/people", auth, handler(async (req, res) => {
    const { q } = parseBody(PeopleQuery, req.query);
    const p = requirePrincipal(req);
    res.json(await svc.listPeople(p.userId, q, p.role));
  }));

  r.post("/chat/dms", auth, handler(async (req, res) => {
    const input = parseBody(ChatService.CreateDm, req.body);
    const p = requirePrincipal(req);
    res.status(201).json(await svc.createOrGetDm(p.userId, input.user_id, p.role));
  }));

  // ---- Connections: consent-gated Chat (Chat Redesign C1/C2) ----
  // "No unsolicited DMs" — request/accept/decline/remove/block/unblock. See
  // chat/connections.ts and CreateDm's gate above for how the two meet.
  r.post("/chat/connections/requests", auth, handler(async (req, res) => {
    const input = parseBody(ConnectionsService.RequestConnection, req.body);
    res.status(201).json(await connections.requestConnection(requirePrincipal(req).userId, input));
  }));

  const ListRequestsQuery = z.object({ direction: z.enum(["incoming", "outgoing"]) });
  r.get("/chat/connections/requests", auth, handler(async (req, res) => {
    const { direction } = parseBody(ListRequestsQuery, req.query);
    res.json(await connections.listRequests(requirePrincipal(req).userId, direction));
  }));

  r.post("/chat/connections/requests/:id/accept", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await connections.acceptRequest(requirePrincipal(req).userId, id));
  }));

  r.post("/chat/connections/requests/:id/decline", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await connections.declineRequest(requirePrincipal(req).userId, id));
  }));

  r.delete("/chat/connections/requests/:id", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await connections.cancelRequest(requirePrincipal(req).userId, id));
  }));

  r.get("/chat/connections", auth, handler(async (req, res) => {
    res.json(await connections.listConnections(requirePrincipal(req).userId));
  }));

  r.post("/chat/connections/:user_id/remove", auth, handler(async (req, res) => {
    const { user_id } = parseBody(UserIdParam, req.params);
    res.json(await connections.removeConnection(requirePrincipal(req).userId, user_id));
  }));

  r.post("/chat/connections/:user_id/block", auth, handler(async (req, res) => {
    const { user_id } = parseBody(UserIdParam, req.params);
    res.json(await connections.blockUser(requirePrincipal(req).userId, user_id));
  }));

  r.post("/chat/connections/:user_id/unblock", auth, handler(async (req, res) => {
    const { user_id } = parseBody(UserIdParam, req.params);
    res.json(await connections.unblockUser(requirePrincipal(req).userId, user_id));
  }));

  // Broadcast — SuperAdmin ONLY. Not Admin, not Instructor, not a member: the
  // whole thing is a conversation between the SuperAdmin and one member at a
  // time, and nobody else is in it. Below SuperAdmin there is no tab and a 403
  // here. (It was Instructor+ when written, but no client ever called it, so
  // nothing is taken away.) An admin who needs ONE particular conversation is
  // invited into that thread by name — see /chat/conversations/:id/invite.
  //
  // One message delivered to every active member as an individual DM from the
  // sender (ensure-DM + insert, no group room). Replies come back as normal 1:1
  // threads, private to the sender. Idempotent on client_mutation_id (§3.6).
  //   audience omitted → the whole church, because the sender is a SuperAdmin.
  //   audience=congregation → an explicit narrowing to the sender's own.
  // Password-gated too: speaking to the whole church in your name is at least as
  // grave as reading the answers.
  r.post("/chat/broadcast", auth, requireRole("SuperAdmin"), requirePasswordStepUp(), handler(async (req, res) => {
    const input = parseBody(ChatService.Broadcast, req.body);
    const p = requirePrincipal(req);
    res.status(201).json(await svc.broadcast(p.userId, input, p.role));
  }));

  // The Broadcast tab: what I have sent, and who answered. SuperAdmin only —
  // anyone below never sees the tab, and gets 403 here if they ask anyway. A
  // broadcast's replies are members speaking privately to ONE person (§5.4).
  // Password-gated (§5.3). A valid session is not the same claim as "the owner is
  // holding the phone": an unlocked, logged-in handset on a desk is already past
  // auth and past requireRole. Before it opens the church's private answers, the
  // person holding it re-enters their password. 403 + details.password_required
  // is the client's cue to prompt and retry.
  // Opens on the last 4 sent — the ones still live enough to watch. `?limit=` (up
  // to 100) fetches the rest when the member asks for them; `total` comes back so
  // "show all N" can name its number instead of guessing.
  const BroadcastsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(4) });
  r.get("/chat/broadcasts", auth, requireRole("SuperAdmin"), requirePasswordStepUp(), handler(async (req, res) => {
    const { limit } = parseBody(BroadcastsQuery, req.query);
    res.json(await svc.listBroadcasts(requirePrincipal(req).userId, limit));
  }));

  // One broadcast: the message, then every response to it. Each response carries
  // the conversation_id of the private thread with that person — already seeded
  // with the broadcast as its top message, so "open the thread" is a navigation,
  // not a creation.
  r.get("/chat/broadcasts/:id", auth, requireRole("SuperAdmin"), requirePasswordStepUp(), handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const p = requirePrincipal(req);
    res.json(await svc.broadcastDetail(p.userId, id, p.role));
  }));

  // Bring one more person into ONE thread — never into the broadcast. SuperAdmin
  // only, and only a thread they are already in. The member is told: a note lands
  // in the conversation naming who joined.
  r.post("/chat/conversations/:id/invite", auth, requireRole("SuperAdmin"), requirePasswordStepUp(), handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const input = parseBody(ChatService.InviteToThread, req.body);
    const p = requirePrincipal(req);
    res.status(201).json(await svc.inviteToThread(p.userId, id, input, p.role));
  }));

  // Open a cell's group conversation (provisioning it on first use). Scope-checked
  // against the actor's leader_assignments (Admin/SuperAdmin pass). Backs the
  // portal Cell Engagement "Message cell" action.
  r.post("/chat/cells/:id/conversation", auth, requireRole("Instructor"), handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const p = requirePrincipal(req);
    await assertCellInScope(ctx.db.primary, p, id);
    res.status(201).json(await svc.ensureCellConversation(p.userId, id));
  }));

  r.post("/chat/spaces/:id/join", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await svc.joinSpace(requirePrincipal(req).userId, id));
  }));

  // ---- Space lifecycle: join requests, delegated roles, moderation (C1/C2) ----
  r.post("/chat/spaces/:id/join-requests", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const input = parseBody(ChatService.RequestJoinSpace, req.body);
    res.status(201).json(await svc.requestJoinSpace(requirePrincipal(req).userId, id, input));
  }));

  r.get("/chat/spaces/:id/join-requests", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const p = requirePrincipal(req);
    res.json(await svc.listJoinRequests(p.userId, id, p.role));
  }));

  r.post("/chat/spaces/:id/join-requests/:reqId/accept", auth, handler(async (req, res) => {
    const { id, reqId } = parseBody(RequestIdParam, req.params);
    const p = requirePrincipal(req);
    res.json(await svc.decideJoinRequest(p.userId, id, reqId, "accept", p.role));
  }));

  r.post("/chat/spaces/:id/join-requests/:reqId/decline", auth, handler(async (req, res) => {
    const { id, reqId } = parseBody(RequestIdParam, req.params);
    const p = requirePrincipal(req);
    res.json(await svc.decideJoinRequest(p.userId, id, reqId, "decline", p.role));
  }));

  r.post("/chat/spaces/:id/roles", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const input = parseBody(ChatService.GrantSpaceRole, req.body);
    const p = requirePrincipal(req);
    res.status(201).json(await svc.grantSpaceRole(p.userId, id, input, p.role));
  }));

  r.delete("/chat/spaces/:id/roles/:user_id/:role", auth, handler(async (req, res) => {
    const { id, user_id, role } = parseBody(RoleParam, req.params);
    const p = requirePrincipal(req);
    res.json(await svc.revokeSpaceRole(p.userId, id, user_id, role, p.role));
  }));

  r.post("/chat/spaces/:id/members/:user_id/remove", auth, handler(async (req, res) => {
    const { id, user_id } = parseBody(MemberActionParam, req.params);
    const p = requirePrincipal(req);
    res.json(await svc.setSpaceMemberStatus(p.userId, id, user_id, "removed", p.role));
  }));

  r.post("/chat/spaces/:id/members/:user_id/suspend", auth, handler(async (req, res) => {
    const { id, user_id } = parseBody(MemberActionParam, req.params);
    const p = requirePrincipal(req);
    res.json(await svc.setSpaceMemberStatus(p.userId, id, user_id, "suspended", p.role));
  }));

  // Leaders curate public spaces for their congregation.
  r.post("/chat/spaces", auth, requireRole("Instructor"), handler(async (req, res) => {
    const input = parseBody(ChatService.CreateSpace, req.body);
    res.status(201).json(await svc.createSpace(requirePrincipal(req).userId, input));
  }));

  // Moderation (Admin/SuperAdmin via requireRole("Admin")). Server-authoritative
  // gating — the portal console flags, removes, and restores messages here (§1.1).
  const FlagBody = z.object({ reason: z.string().max(500).optional() });
  r.post("/chat/messages/:id/flag", auth, requireRole("Admin"), handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const { reason } = parseBody(FlagBody, req.body);
    const p = requirePrincipal(req);
    res.json(await svc.moderateMessage(p.userId, p.role, id, "flag", reason));
  }));
  r.post("/chat/messages/:id/unflag", auth, requireRole("Admin"), handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const p = requirePrincipal(req);
    res.json(await svc.moderateMessage(p.userId, p.role, id, "unflag"));
  }));
  r.post("/chat/messages/:id/remove", auth, requireRole("Admin"), handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const p = requirePrincipal(req);
    res.json(await svc.moderateMessage(p.userId, p.role, id, "remove"));
  }));
  r.post("/chat/messages/:id/restore", auth, requireRole("Admin"), handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const p = requirePrincipal(req);
    res.json(await svc.moderateMessage(p.userId, p.role, id, "restore"));
  }));

  return r;
}
