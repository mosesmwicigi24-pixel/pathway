// Module: assessment (spec §1.5)
// Owns: Randomised quiz assembly, server-side scoring, attempt logs, reflection
// submission & review queue. Endpoints per §3.3 (assessment).
import { Router } from "express";
import type { AppContext } from "../../http/context.js";
import { authenticate } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { AssessmentService } from "./service.js";

export const assessmentRouter: Router = Router();

export function registerAssessment(ctx: AppContext): Router {
  const svc = new AssessmentService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const r = assessmentRouter;

  // Assemble a randomized quiz for an unlocked module (no answers leaked).
  r.get(
    "/modules/:id/quiz",
    auth,
    handler(async (req, res) => {
      res.json(await svc.assembleQuiz(requirePrincipal(req).userId, req.params.id ?? ""));
    }),
  );

  // Submit answers; scored server-side, returns the result + any unlock.
  r.post(
    "/modules/:id/quiz/attempts",
    auth,
    handler(async (req, res) => {
      const sub = parseBody(AssessmentService.QuizSubmission, req.body);
      res.json(await svc.submitQuiz(requirePrincipal(req).userId, req.params.id ?? "", sub));
    }),
  );

  return r;
}
