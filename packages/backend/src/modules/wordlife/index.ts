// Module: wordlife — per-member "Word & Reading life" for the admin Member
// Profile. Reuses the canonical Word score (scores module) and adds the
// reading / memorization / rhythm / quiz dossier + a coaching insight. Gated on
// the same RBAC as the member profile it lives on (members:view, §5.4), so a
// multiplier only sees members inside their scope.
import { Router } from "express";
import type { AppContext } from "../../http/context.js";
import { authenticate, requirePermission } from "../../http/auth.js";
import { handler } from "../../http/http.js";
import { WordLifeService } from "./service.js";

export const wordLifeRouter: Router = Router();

export function registerWordLife(ctx: AppContext): Router {
  const svc = new WordLifeService(ctx.db.replica);
  const auth = authenticate(ctx.env);
  const perm = requirePermission(ctx.db.replica);
  const r = wordLifeRouter;

  // How this member reads + practises the Word — shown on the Member Profile.
  r.get("/admin/members/:id/word-life", auth, perm("members", "view"), handler(async (req, res) => {
    res.json(await svc.memberWordLife(req.params.id ?? ""));
  }));

  return r;
}
