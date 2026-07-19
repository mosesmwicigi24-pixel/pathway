// Module: reading-social (Reading & Social R1 — "Read with a Friend", spec
// §3/§6; docs/READING_SOCIAL_PLAN.md §4). Shared plan groups, invites, and
// the public deep-link landing page. Migrations 174 (groups/members) and 175
// (invites) already on main (R0); this is the service + route layer.
//
// registerReadingSocial mounts the authenticated /reading/* routes under the
// versioned /v1 base (same as every other module). registerReadingSocialJoin
// mounts the PUBLIC, unauthenticated /join/{token} landing page directly on
// the root app — it must answer at the bare domain
// (https://pathway.nuruplace.org/join/{token}), not under /v1, so it can
// double as the Universal Link/App Link target once that native infra lands
// (docs/READING_SOCIAL_PLAN.md §5).
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { ReadingSocialService } from "./groups.js";
import { ReadingInvitesService } from "./invites.js";
import { renderJoinPage, renderInviteNotFoundPage, firstName } from "./publicPage.js";

const GroupIdParam = z.object({ id: z.string().uuid() });
const InviteIdParam = z.object({ id: z.string().uuid(), invite_id: z.string().uuid() });
const TokenParam = z.object({ token: z.string().min(8).max(64) });

export const readingSocialRouter: Router = Router();
export const readingSocialJoinRouter: Router = Router();

export function registerReadingSocial(ctx: AppContext): Router {
  const groups = new ReadingSocialService(ctx.db.primary);
  const invites = new ReadingInvitesService(ctx.db.primary, groups);
  const auth = authenticate(ctx.env);
  const r = readingSocialRouter;

  r.post("/reading/groups", auth, handler(async (req, res) => {
    const input = parseBody(ReadingSocialService.CreateGroup, req.body);
    res.status(201).json(await groups.createOrGetGroup(requirePrincipal(req).userId, input));
  }));

  r.get("/reading/groups", auth, handler(async (req, res) => {
    res.json(await groups.listMyGroups(requirePrincipal(req).userId));
  }));

  r.get("/reading/groups/:id", auth, handler(async (req, res) => {
    const { id } = parseBody(GroupIdParam, req.params);
    res.json(await groups.getGroup(requirePrincipal(req).userId, id));
  }));

  r.post("/reading/groups/:id/archive", auth, handler(async (req, res) => {
    const { id } = parseBody(GroupIdParam, req.params);
    res.json(await groups.archiveGroup(requirePrincipal(req).userId, id));
  }));

  r.post("/reading/groups/:id/leave", auth, handler(async (req, res) => {
    const { id } = parseBody(GroupIdParam, req.params);
    res.json(await groups.leaveGroup(requirePrincipal(req).userId, id));
  }));

  r.post("/reading/groups/:id/invites", auth, handler(async (req, res) => {
    const { id } = parseBody(GroupIdParam, req.params);
    const input = parseBody(ReadingInvitesService.CreateInvite, req.body);
    res.status(201).json(await invites.createInvite(requirePrincipal(req).userId, id, input));
  }));

  r.get("/reading/groups/:id/invites", auth, handler(async (req, res) => {
    const { id } = parseBody(GroupIdParam, req.params);
    res.json(await invites.listInvites(requirePrincipal(req).userId, id));
  }));

  r.post("/reading/groups/:id/invites/:invite_id/revoke", auth, handler(async (req, res) => {
    const { id, invite_id } = parseBody(InviteIdParam, req.params);
    res.json(await invites.revokeInvite(requirePrincipal(req).userId, id, invite_id));
  }));

  r.get("/reading/invites/:token", auth, handler(async (req, res) => {
    const { token } = parseBody(TokenParam, req.params);
    res.json(await invites.getInvitePreview(requirePrincipal(req).userId, token));
  }));

  r.post("/reading/invites/:token/accept", auth, handler(async (req, res) => {
    const { token } = parseBody(TokenParam, req.params);
    res.status(200).json(await invites.acceptInvite(requirePrincipal(req).userId, token));
  }));

  r.post("/reading/invites/:token/decline", auth, handler(async (req, res) => {
    const { token } = parseBody(TokenParam, req.params);
    res.json(await invites.declineInvite(requirePrincipal(req).userId, token));
  }));

  return r;
}

/** Public, unauthenticated /join/{token} landing page. Mount directly on the
 *  root app (NOT under /v1) — see module header. Never returns the JSON
 *  error envelope; a bad/expired/revoked/declined token always renders a
 *  friendly 404 HTML page instead. */
export function registerReadingSocialJoin(ctx: AppContext): Router {
  const groups = new ReadingSocialService(ctx.db.primary);
  const invites = new ReadingInvitesService(ctx.db.primary, groups);
  const r = readingSocialJoinRouter;

  r.get("/join/:token", async (req, res) => {
    const token = req.params.token ?? "";
    try {
      const preview = await invites.getInvitePreview("", token);
      const html = renderJoinPage({
        token,
        joinUrl: `${ctx.env.APP_PUBLIC_URL}/join/${token}`,
        planTitle: preview.plan.title,
        planDescription: preview.plan.description,
        planSubtitle: preview.plan.subtitle,
        dayCount: preview.plan.day_count,
        imageUrl: preview.plan.image_url,
        inviterFirstName: firstName(preview.inviter.full_name),
        message: preview.message,
        appScheme: ctx.env.READING_INVITE_APP_SCHEME,
        androidStoreUrl: ctx.env.READING_INVITE_ANDROID_STORE_URL ?? null,
        iosStoreUrl: ctx.env.READING_INVITE_IOS_STORE_URL ?? null,
      });
      res.status(200).type("html").send(html);
    } catch {
      res.status(404).type("html").send(renderInviteNotFoundPage());
    }
  });

  return r;
}
