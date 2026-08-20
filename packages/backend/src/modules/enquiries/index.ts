// Module: enquiries — intake for nuruplace.org's connection card, contact form
// and prayer request, plus the pastoral triage queue over them (migration 197).
//
// The intake is a `/webhooks/*` route on purpose: app.ts skips JSON parsing for
// that prefix, so the handler sees the raw bytes the signature was computed
// over. Parsing first and re-serialising would change the bytes (key order,
// whitespace) and every signature would fail.
import express, { Router } from "express";
import type { AppContext } from "../../http/context.js";
import { authenticate, requirePermission } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { ApiError } from "../../http/errors.js";
import { EnquiriesService } from "./service.js";

export function registerEnquiries(ctx: AppContext): Router {
  const svc = new EnquiriesService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const perm = requirePermission(ctx.db.replica); // RBAC: website module (§5.4)
  // A FRESH router per call, deliberately unlike the module-level singleton the
  // other 34 modules export.
  //
  // With a singleton, every createApp() re-registers these handlers onto the
  // same router object and the FIRST registration wins — so a second app built
  // with different env is silently served by the first app's closures, which
  // still hold the first env. A test asserting "refuses when no secret is
  // configured" then passes through a handler that has one, and reports 200.
  // That is exactly what happened here, and the same shape would let a
  // rotated secret keep answering with the old one for the process's lifetime.
  const r = Router();

  // No session auth: authenticity is the HMAC, same trust model as
  // /webhooks/stripe and /webhooks/mobilemoney/:provider.
  r.post(
    "/webhooks/website-contact",
    express.raw({ type: "*/*", limit: "256kb" }),
    handler(async (req, res) => {
      const secret = ctx.env.WEBSITE_CONTACT_WEBHOOK_SECRET;
      if (!secret) {
        // Refuse rather than accept unsigned. An unauthenticated write into the
        // pastoral inbox is worse than a website whose form is temporarily
        // unavailable — the website already tells visitors to telephone when
        // delivery fails, so failing closed keeps a real path open.
        throw new ApiError("UPSTREAM_UNAVAILABLE", "Website contact intake is not configured");
      }
      const rawBody: string = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body ?? {});
      EnquiriesService.verifySignature(rawBody, req.header("x-nuruplace-signature"), secret);

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        throw new ApiError("VALIDATION_FAILED", "Body is not valid JSON");
      }
      const input = parseBody(EnquiriesService.Submission, parsed);
      const result = await svc.receive(input);
      res.json({ received: true, ...result });
    }),
  );

  // Gated on the `website` module, not a role tier. Care signals are
  // Instructor+ BECAUSE they are scoped to "my flock"; an enquiry comes from a
  // stranger with no cell, so there is nothing to scope by and a tier gate
  // would show every leader every visitor's phone number and prayer request —
  // wider than the feature needs under the Kenya Data Protection Act.
  //
  // A permission instead means the person who runs the website gets exactly
  // this and not the membership roster. Admin and SuperAdmin still pass, by the
  // short-circuit in requirePermission.
  r.get(
    "/admin/enquiries",
    auth,
    perm("website", "view"),
    handler(async (req, res) => {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const limit = Number(req.query.limit ?? 50);
      res.json(await svc.list(status, Number.isFinite(limit) ? limit : 50));
    }),
  );

  r.post(
    "/admin/enquiries/:id/ack",
    auth,
    perm("website", "edit"),
    handler(async (req, res) => {
      const input = parseBody(EnquiriesService.Ack, req.body ?? {});
      res.json(await svc.acknowledge(req.params.id ?? "", requirePrincipal(req).userId, input));
    }),
  );

  return r;
}
