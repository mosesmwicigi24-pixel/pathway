// Module: attendance (church services)
// Owns: the weekly service cadence, QR check-in with contact registration, and
// the attendance streak (runs, breaks, failures). Event attendance — cell
// gatherings and one-off events — stays in the progress module.
import { Router } from "express";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { ChurchAttendanceService, checkInSchema, createServiceSchema } from "./service.js";

export const attendanceRouter: Router = Router();

export function registerAttendance(ctx: AppContext): Router {
  const svc = new ChurchAttendanceService(ctx.db.primary);
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

  return r;
}
