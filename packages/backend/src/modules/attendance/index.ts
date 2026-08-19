// Module: attendance (church services)
// Owns: the weekly service cadence, QR check-in with contact registration, and
// the attendance streak (runs, breaks, failures). Event attendance — cell
// gatherings and one-off events — stays in the progress module.
import { Router } from "express";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { ChurchAttendanceService, checkInSchema, createServiceSchema } from "./service.js";
import { FollowUpService } from "./follow-up.js";

export const attendanceRouter: Router = Router();

export function registerAttendance(ctx: AppContext): Router {
  const svc = new ChurchAttendanceService(ctx.db.primary);
  // Reporting reads only; point it at the replica so a Sunday-morning report
  // never competes with the check-in writes happening at the same moment.
  const followUp = new FollowUpService(ctx.db.replica);
  const auth = authenticate(ctx.env);
  const leaderPlus = [auth, requireRole("Instructor")] as const;
  const r = attendanceRouter;

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

  /** Every member with their attendance standing, longest absence first. */
  r.get(
    "/admin/follow-up/members",
    ...leaderPlus,
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
    ...leaderPlus,
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
    ...leaderPlus,
    handler(async (req, res) => {
      res.json({ data: await followUp.serviceSummaries(requirePrincipal(req), yearParam(req.query.year)) });
    }),
  );

  /** Who missed this service — the call list. */
  r.get(
    "/admin/follow-up/services/:id/absentees",
    ...leaderPlus,
    handler(async (req, res) => {
      res.json(await followUp.absentees(requirePrincipal(req), req.params.id ?? ""));
    }),
  );

  /** The one-screen year figure. */
  r.get(
    "/admin/follow-up/overview",
    ...leaderPlus,
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
