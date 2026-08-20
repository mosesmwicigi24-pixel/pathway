// Module: attendance (church services)
// Owns: the weekly service cadence, QR check-in with contact registration, and
// the attendance streak (runs, breaks, failures). Event attendance — cell
// gatherings and one-off events — stays in the progress module.
import { Router } from "express";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole, requirePermission} from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { ChurchAttendanceService, checkInSchema, createServiceSchema } from "./service.js";
import { FollowUpService } from "./follow-up.js";
import { ServiceJoinService, joinByScanSchema } from "./join.js";
import { CadenceService, recordContactSchema, createCadenceSchema } from "./cadence.js";
import { z } from "zod";

export const attendanceRouter: Router = Router();

export function registerAttendance(ctx: AppContext): Router {
  const svc = new ChurchAttendanceService(ctx.db.primary);
  // Reporting reads only; point it at the replica so a Sunday-morning report
  // never competes with the check-in writes happening at the same moment.
  const followUp = new FollowUpService(ctx.db.replica);
  const auth = authenticate(ctx.env);
  const leaderPlus = [auth, requireRole("Instructor")] as const;
  // Follow-up is its own job, so it is its own permission (migration 198).
  // Reading the register and working the call list are separate from
  // administering members: the people who ring round on a Monday are often not
  // the people who edit the roll, and a `follow_up_team` role holds followUp
  // and nothing else — which is what makes it safe to hand out widely.
  const perm = requirePermission(ctx.db.replica);
  const followUpView = [auth, perm("followUp", "view")] as const;
  const followUpEdit = [auth, perm("followUp", "edit")] as const;
  const r = attendanceRouter;
  const joinSvc = new ServiceJoinService(ctx.db.primary);
  const cadence = new CadenceService(ctx.db.primary, undefined, ctx.log);

  // --- Public: joining by scan ---

  /**
   * The ONE unauthenticated route in this module, and it is that way because a
   * visitor holding up their phone at the door has no account yet — requiring
   * one would defeat the entire feature.
   *
   * It is not open registration. The scan token must match, and the service's
   * check-in window must be OPEN, so a photographed code stops working when the
   * service ends. Joins are also rate-limited per service and each one records
   * the service it came through. See join.ts for why those three, and the
   * trade the owner made knowingly.
   */
  r.post(
    "/join/service/:id",
    handler(async (req, res) => {
      const body = parseBody(joinByScanSchema, req.body ?? {});
      const result = await joinSvc.joinByScan(req.params.id ?? "", body);
      res.status(201).json(result);
    }),
  );

  // --- Member ---

  /** Services open for check-in right now — what the scanner screen introduces. */
  r.get(
    "/services/open",
    auth,
    handler(async (req, res) => {
      res.json({ data: await svc.openServices(requirePrincipal(req)) });
    }),
  );

  /** Recent + upcoming services for the member's congregation. */
  r.get(
    "/services",
    auth,
    handler(async (req, res) => {
      const limit = Number(req.query.limit ?? 20);
      res.json({ data: await svc.listServices(requirePrincipal(req), Number.isFinite(limit) ? limit : 20) });
    }),
  );

  /**
   * QR check-in. Idempotent on client_scan_id and on (member, service), so an
   * offline replay or a second scan returns the original row with duplicate=true.
   */
  r.post(
    "/services/:id/attendance",
    auth,
    handler(async (req, res) => {
      const body = parseBody(checkInSchema, req.body ?? {});
      const result = await svc.checkIn(requirePrincipal(req), req.params.id ?? "", body);
      res.status(result.duplicate ? 200 : 201).json(result);
    }),
  );

  /** The member's own streak: current run, longest, breaks and failures. */
  r.get(
    "/me/attendance/streak",
    auth,
    handler(async (req, res) => {
      res.json(await svc.streakFor(requirePrincipal(req)));
    }),
  );

  /** The member's own service-by-service history, attended and missed. */
  r.get(
    "/me/attendance",
    auth,
    handler(async (req, res) => {
      const limit = Number(req.query.limit ?? 30);
      res.json({ data: await svc.historyFor(requirePrincipal(req), Number.isFinite(limit) ? limit : 30) });
    }),
  );

  // --- Leader+ ---

  /** Create the cadence slot members scan into. */
  r.post(
    "/services",
    ...leaderPlus,
    handler(async (req, res) => {
      const body = parseBody(createServiceSchema, req.body ?? {});
      res.status(201).json(await svc.createService(requirePrincipal(req), body));
    }),
  );

  /** The string to render as the QR on the sanctuary screen. Never member-visible. */
  r.get(
    "/services/:id/qr",
    ...leaderPlus,
    handler(async (req, res) => {
      res.json(await svc.qrPayloadFor(requirePrincipal(req), req.params.id ?? ""));
    }),
  );

  /** Who attended, with the contact details each member registered. */
  r.get(
    "/services/:id/attendance",
    ...leaderPlus,
    handler(async (req, res) => {
      res.json({ data: await svc.roster(requirePrincipal(req), req.params.id ?? "") });
    }),
  );

  // --- Follow-up (administration) ---
  // Who came, who didn't, and who to call. Leader+ only: this is the whole
  // congregation's contact list, not a member's own record.

  /** The congregation's cadences, steps and open-run counts. */
  r.get(
    "/admin/follow-up/cadences",
    ...followUpView,
    handler(async (req, res) => {
      res.json({ data: await cadence.listCadences(requirePrincipal(req).congregationId) });
    }),
  );

  /** Create a cadence with its steps. */
  r.post(
    "/admin/follow-up/cadences",
    ...followUpEdit,
    handler(async (req, res) => {
      const p = requirePrincipal(req);
      const body = parseBody(createCadenceSchema, req.body ?? {});
      res.status(201).json(await cadence.createCadence(p.congregationId, p.userId, body));
    }),
  );

  /** Switch a cadence on or off. Off stops NEW runs; runs in flight finish. */
  r.patch(
    "/admin/follow-up/cadences/:id",
    ...followUpEdit,
    handler(async (req, res) => {
      const body = parseBody(z.object({ is_active: z.boolean() }).strict(), req.body ?? {});
      await cadence.setActive(requirePrincipal(req).congregationId, req.params.id ?? "", body.is_active);
      res.status(204).end();
    }),
  );

  /**
   * The leader's due list: human cadence steps that have come due. Automated
   * steps never appear here — they are the worker's job, and mixing them would
   * make this something to scroll past rather than work through.
   */
  r.get(
    "/admin/follow-up/due",
    ...followUpView,
    handler(async (req, res) => {
      const p = requirePrincipal(req);
      const limit = Number(req.query.limit ?? 100);
      res.json({ data: await cadence.dueForLeaders(p.congregationId, Number.isFinite(limit) ? limit : 100) });
    }),
  );

  /**
   * A leader records that they made the contact, and what came of it. The
   * outcome is required: a register that only stores "done" cannot tell anyone
   * who still needs reaching.
   */
  r.post(
    "/admin/follow-up/due/:eventId",
    ...followUpEdit,
    handler(async (req, res) => {
      const body = parseBody(recordContactSchema, req.body ?? {});
      await cadence.recordContact(
        req.params.eventId ?? "",
        requirePrincipal(req).userId,
        body.outcome,
        body.note,
      );
      res.status(204).end();
    }),
  );

  /** Every member with their attendance standing, longest absence first. */
  r.get(
    "/admin/follow-up/members",
    ...followUpView,
    handler(async (req, res) => {
      const p = requirePrincipal(req);
      res.json({
        data: await followUp.members(p, yearParam(req.query.year), {
          status: typeof req.query.status === "string" ? req.query.status : undefined,
          limit: numParam(req.query.limit),
        }),
      });
    }),
  );

  /** The raw scan log — every check-in with the details captured at the scan. */
  r.get(
    "/admin/follow-up/scans",
    ...followUpView,
    handler(async (req, res) => {
      res.json({
        data: await followUp.scanLog(requirePrincipal(req), {
          serviceId: typeof req.query.service_id === "string" ? req.query.service_id : undefined,
          limit: numParam(req.query.limit),
        }),
      });
    }),
  );

  /** Per-service totals — the end-of-day report for each gathering. */
  r.get(
    "/admin/follow-up/services",
    ...followUpView,
    handler(async (req, res) => {
      res.json({ data: await followUp.serviceSummaries(requirePrincipal(req), yearParam(req.query.year)) });
    }),
  );

  /** Who missed this service — the call list. */
  r.get(
    "/admin/follow-up/services/:id/absentees",
    ...followUpView,
    handler(async (req, res) => {
      res.json(await followUp.absentees(requirePrincipal(req), req.params.id ?? ""));
    }),
  );

  /** The one-screen year figure. */
  r.get(
    "/admin/follow-up/overview",
    ...followUpView,
    handler(async (req, res) => {
      res.json(await followUp.yearOverview(requirePrincipal(req), yearParam(req.query.year)));
    }),
  );

  return r;
}

/** Query year, defaulting to the current one; anything unparseable falls back. */
function yearParam(raw: unknown): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 2000 && n <= 2999 ? n : new Date().getUTCFullYear();
}

function numParam(raw: unknown): number | undefined {
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
