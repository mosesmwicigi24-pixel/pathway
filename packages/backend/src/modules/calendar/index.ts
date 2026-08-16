// Module: calendar (Features v2 §C; EVENTS_ARCHITECTURE for the admin surface)
// Owns: event series (recurrence), occurrence projection, exceptions, RSVPs,
// the admin series API (§3), real QR/CSV/insights (§6), and chrono-node
// quick-add. Visibility-scoped (§5.4); recurrence validated + capped.
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requirePermission } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { CalendarService } from "./service.js";
import { AttendanceService } from "../progress/attendance.js";

export const calendarRouter: Router = Router();

export function registerCalendar(ctx: AppContext): Router {
  const svc = new CalendarService(ctx.db.primary, ctx.env.CAL_MAX_INSTANCES);
  const attendance = new AttendanceService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const perm = requirePermission(ctx.db.replica);
  // §8: real events RBAC. The coarse Instructor+ bridge stays — cell leaders run
  // their own cells' events, with fine-grained scoping enforced in the service
  // layer (assertCellInScope / assertCreateRight) — and an rbac `events:<cap>`
  // grant now ALSO opens the endpoint, matching the rest of the console.
  const eventsPerm = (cap: string) => {
    const byGrant = perm("events", cap);
    return (req: Request, res: Response, next: NextFunction): void => {
      const p = req.principal;
      if (p && (p.role === "Instructor" || p.role === "Admin" || p.role === "SuperAdmin")) return next();
      void byGrant(req, res, next);
    };
  };
  const leaderPlus = (cap: string) => [auth, eventsPerm(cap)] as const;
  const r = calendarRouter;

  // Projected occurrences in a bounded window.
  r.get(
    "/calendar",
    auth,
    handler(async (req, res) => {
      const q = parseBody(z.object({ from: z.string().min(1), to: z.string().min(1) }), req.query);
      res.json({ data: await svc.projectRange(requirePrincipal(req).userId, q.from, q.to) });
    }),
  );

  r.get(
    "/events/:id",
    auth,
    handler(async (req, res) => {
      res.json(await svc.getEvent(requirePrincipal(req).userId, req.params.id ?? ""));
    }),
  );

  r.post(
    "/events/:id/rsvp",
    auth,
    handler(async (req, res) => {
      const input = parseBody(CalendarService.Rsvp, req.body ?? {});
      res.json(await svc.setRsvp(requirePrincipal(req).userId, req.params.id ?? "", input));
    }),
  );

  // Event wall: attendee posts (image + caption) under an occurrence.
  r.get(
    "/events/:id/posts",
    auth,
    handler(async (req, res) => {
      res.json(await svc.listEventPosts(requirePrincipal(req).userId, req.params.id ?? ""));
    }),
  );
  r.post(
    "/events/:id/posts",
    auth,
    handler(async (req, res) => {
      const input = parseBody(CalendarService.EventPost, req.body ?? {});
      res.status(201).json(await svc.createEventPost(requirePrincipal(req).userId, req.params.id ?? "", input));
    }),
  );
  // Set / switch / clear the member's single reaction on a post.
  r.post(
    "/events/:id/posts/:postId/react",
    auth,
    handler(async (req, res) => {
      const { kind } = parseBody(CalendarService.Reaction, req.body ?? {});
      res.json(await svc.reactToPost(requirePrincipal(req).userId, req.params.id ?? "", req.params.postId ?? "", kind));
    }),
  );

  // The member's upcoming RSVPs ("My RSVPs", Contract Matrix B2).
  r.get(
    "/me/rsvps",
    auth,
    handler(async (req, res) => {
      res.json({ data: await svc.myRsvps(requirePrincipal(req).userId) });
    }),
  );

  // Events tab: followable series + follow toggle ("Series you follow").
  r.get(
    "/calendar/series",
    auth,
    handler(async (req, res) => {
      res.json({ data: await svc.listSeries(requirePrincipal(req).userId) });
    }),
  );
  r.post(
    "/calendar/series/:id/follow",
    auth,
    handler(async (req, res) => {
      res.json(await svc.toggleFollow(requirePrincipal(req).userId, req.params.id ?? ""));
    }),
  );

  // Events tab: the member's cell summary card (cell · members · attendance · next).
  r.get(
    "/me/cell-summary",
    auth,
    handler(async (req, res) => {
      res.json(await svc.cellSummary(requirePrincipal(req).userId));
    }),
  );

  // ---- Leader attendance ops (Contract Matrix B2; cell-scoped, audited) ----
  r.post(
    "/admin/events/:id/checkins",
    ...leaderPlus("edit"),
    handler(async (req, res) => {
      const input = parseBody(AttendanceService.ManualCheckIn, req.body ?? {});
      res.status(201).json(await attendance.manualCheckIn(requirePrincipal(req), req.params.id ?? "", input));
    }),
  );

  r.post(
    "/admin/events/:id/guests",
    ...leaderPlus("edit"),
    handler(async (req, res) => {
      const input = parseBody(AttendanceService.AddGuest, req.body ?? {});
      res.status(201).json(await attendance.addGuest(requirePrincipal(req), req.params.id ?? "", input));
    }),
  );

  r.get(
    "/admin/events/:id/attendance",
    ...leaderPlus("view"),
    handler(async (req, res) => {
      res.json(await attendance.roster(requirePrincipal(req), req.params.id ?? ""));
    }),
  );

  // RSVP roster for one occurrence — buckets + counts (Events page; cell-scoped).
  r.get(
    "/admin/events/:id/rsvps",
    ...leaderPlus("view"),
    handler(async (req, res) => {
      res.json(await svc.rsvpRoster(requirePrincipal(req), req.params.id ?? ""));
    }),
  );

  // NLP quick-add — suggestion only; never auto-creates. Leader+ (CPU-bound).
  r.post(
    "/calendar/parse",
    ...leaderPlus("view"),
    handler(async (req, res) => {
      const input = parseBody(z.object({ text: z.string().min(1).max(500), timezone: z.string().min(1).max(64) }), req.body ?? {});
      res.json(svc.parse(input.text, input.timezone));
    }),
  );

  // --- Admin series API (EVENTS_ARCHITECTURE §3): the console's source of truth ---
  r.get(
    "/admin/events/series",
    ...leaderPlus("view"),
    handler(async (req, res) => {
      const q = parseBody(CalendarService.AdminSeriesList, req.query);
      res.json(await svc.adminListSeries(requirePrincipal(req), q));
    }),
  );
  r.get(
    "/admin/events/series/:id",
    ...leaderPlus("view"),
    handler(async (req, res) => {
      res.json(await svc.adminSeriesDetail(requirePrincipal(req), req.params.id ?? ""));
    }),
  );
  r.get(
    "/admin/events/series/:id/timeline",
    ...leaderPlus("view"),
    handler(async (req, res) => {
      res.json(await svc.adminSeriesTimeline(requirePrincipal(req), req.params.id ?? ""));
    }),
  );
  // Google-style "this and following" (§2).
  r.post(
    "/admin/events/series/:id/split",
    ...leaderPlus("edit"),
    handler(async (req, res) => {
      const input = parseBody(CalendarService.Split, req.body ?? {});
      res.status(201).json(await svc.splitSeries(requirePrincipal(req), req.params.id ?? "", input));
    }),
  );
  // Archive-wide search: series + upcoming occurrences + announcements (§3).
  r.get(
    "/admin/events/search",
    ...leaderPlus("view"),
    handler(async (req, res) => {
      const q = parseBody(CalendarService.AdminSearch, req.query);
      res.json(await svc.adminSearch(requirePrincipal(req), q));
    }),
  );
  // Real insights tiles — only numbers the schema knows (§6).
  r.get(
    "/admin/events/insights",
    ...leaderPlus("view"),
    handler(async (req, res) => {
      res.json(await attendance.insights(requirePrincipal(req)));
    }),
  );
  // Real QR: the HMAC scan token members actually validate, time-boxed (§6).
  r.get(
    "/admin/events/:id/qr",
    ...leaderPlus("edit"),
    handler(async (req, res) => {
      await svc.ensureEvent(req.params.id ?? "");
      res.json(await attendance.qrPanel(requirePrincipal(req), req.params.id ?? ""));
    }),
  );
  // Attendance CSV export (§6).
  r.get(
    "/admin/events/:id/attendance.csv",
    ...leaderPlus("export"),
    handler(async (req, res) => {
      await svc.ensureEvent(req.params.id ?? "");
      const csv = await attendance.rosterCsv(requirePrincipal(req), req.params.id ?? "");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="attendance-${(req.params.id ?? "event").replace(/[^A-Za-z0-9_-]/g, "_")}.csv"`);
      res.send(csv);
    }),
  );

  // --- Admin / Instructor: series management ---
  r.post(
    "/admin/events/series",
    ...leaderPlus("create"),
    handler(async (req, res) => {
      const input = parseBody(CalendarService.CreateSeries, req.body ?? {});
      res.status(201).json(await svc.createSeries(requirePrincipal(req), input));
    }),
  );

  r.put(
    "/admin/events/series/:id",
    ...leaderPlus("edit"),
    handler(async (req, res) => {
      const input = parseBody(CalendarService.UpdateSeries, req.body ?? {});
      res.json(await svc.updateSeries(requirePrincipal(req), req.params.id ?? "", input));
    }),
  );

  r.post(
    "/admin/events/series/:id/exceptions",
    ...leaderPlus("edit"),
    handler(async (req, res) => {
      const input = parseBody(CalendarService.Exception, req.body ?? {});
      res.status(201).json(await svc.addException(requirePrincipal(req), req.params.id ?? "", input));
    }),
  );

  r.delete(
    "/admin/events/series/:id",
    ...leaderPlus("delete"),
    handler(async (req, res) => {
      res.json(await svc.deleteSeries(requirePrincipal(req), req.params.id ?? ""));
    }),
  );

  // Feature / unfeature a series on the mobile homepage (single featured, Admin+).
  r.post(
    "/admin/events/series/:id/homepage",
    ...leaderPlus("edit"),
    handler(async (req, res) => {
      res.json(await svc.setSeriesFeatured(requirePrincipal(req), req.params.id ?? "", true));
    }),
  );
  r.delete(
    "/admin/events/series/:id/homepage",
    ...leaderPlus("edit"),
    handler(async (req, res) => {
      res.json(await svc.setSeriesFeatured(requirePrincipal(req), req.params.id ?? "", false));
    }),
  );

  // The single homepage-featured event for the mobile Home screen.
  r.get(
    "/home/featured-event",
    auth,
    handler(async (req, res) => {
      res.json({ data: await svc.featuredEvent(requirePrincipal(req).congregationId) });
    }),
  );

  // Show / hide a series on the member Home "Upcoming events" list (up to 5,
  // portal-curated — unlike the single `homepage` feature above, any number of
  // series may be flagged; the server caps the list). Admin+.
  r.patch(
    "/admin/events/series/:id/show-on-home",
    ...leaderPlus("edit"),
    handler(async (req, res) => {
      const { show_on_home } = parseBody(z.object({ show_on_home: z.boolean() }), req.body ?? {});
      res.json(await svc.setSeriesShowOnHome(requirePrincipal(req), req.params.id ?? "", show_on_home));
    }),
  );

  // Home "Upcoming events" — up to 5 soonest occurrences from show_on_home
  // series, soonest first. Server-capped; the client never decides the count.
  r.get(
    "/home/events",
    auth,
    handler(async (req, res) => {
      const principal = requirePrincipal(req);
      res.json({ data: await svc.homeEvents(principal.userId, principal.congregationId) });
    }),
  );

  // ---- Event Moments (community photo gallery) ----
  // Members read the congregation's moments; leaders (Instructor+) post / remove.
  r.get(
    "/moments",
    auth,
    handler(async (req, res) => {
      res.json({ data: await svc.listMoments(requirePrincipal(req).congregationId) });
    }),
  );
  r.post(
    "/admin/moments",
    ...leaderPlus("create"),
    handler(async (req, res) => {
      const input = parseBody(
        z.object({
          image_url: z.string().url().max(2048),
          caption: z.string().trim().max(280).optional(),
          tag: z.string().trim().max(60).optional(),
        }),
        req.body ?? {},
      );
      res.status(201).json(await svc.createMoment(requirePrincipal(req), input));
    }),
  );
  r.delete(
    "/admin/moments/:id",
    ...leaderPlus("delete"),
    handler(async (req, res) => {
      res.json(await svc.deleteMoment(requirePrincipal(req), req.params.id ?? ""));
    }),
  );

  // Pause / resume a series — paused series stop projecting future occurrences.
  r.post(
    "/admin/events/series/:id/pause",
    ...leaderPlus("edit"),
    handler(async (req, res) => {
      res.json(await svc.pauseSeries(requirePrincipal(req), req.params.id ?? ""));
    }),
  );

  r.post(
    "/admin/events/series/:id/resume",
    ...leaderPlus("edit"),
    handler(async (req, res) => {
      res.json(await svc.resumeSeries(requirePrincipal(req), req.params.id ?? ""));
    }),
  );

  return r;
}
