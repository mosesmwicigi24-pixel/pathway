// EVENTS_ARCHITECTURE backend phase — the canonical events model.
// Covers: the Sept-20 future-events regression (§1/§2, MANDATORY), windowed
// next_at (the maxInstances-from-DTSTART bug), series split (§2), the admin
// series API (§3), real QR / CSV / insights (§6), per-series automation (§7),
// and the §8 scoping + per-congregation featured fixes. Member wire shapes are
// exercised through the SAME frozen endpoints the apps consume.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser, createEvent, createLeaderAssignment } from "./helpers/factories.js";
import { CalendarService, occurrenceId } from "../src/modules/calendar/service.js";
import type { Principal } from "../src/http/http.js";

const svc = () => new CalendarService(testPool());
const auth = (t: string) => ({ Authorization: t });
const principal = (userId: string, role: Principal["role"], cong: string): Principal => ({ userId, role, congregationId: cong });
const UUIDS = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

let cong: string, admin: string, member: string, adminTok: string, memberTok: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  admin = (await createUser({ congregationId: cong, role: "Admin", email: "a@dev.local" })).user_id;
  member = (await createUser({ congregationId: cong, role: "Student", email: "m@dev.local" })).user_id;
  adminTok = bearer({ sub: admin, role: "Admin", cong });
  memberTok = bearer({ sub: member, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

describe("the Sept-20 future-events regression (§1/§2)", () => {
  it("an event 64 days out survives every read path", async () => {
    const d = new Date(Date.now() + 64 * 86_400_000);
    const dateStr = d.toISOString().slice(0, 10);
    const created = await agent().post("/v1/admin/events/series").set(auth(adminTok)).send({
      title: "Convention Sunday",
      timezone: "Africa/Nairobi",
      start_date: dateStr,
      start_time: "10:00",
      duration_min: 120,
      visibility: "members",
    });
    expect(created.status).toBe(201);
    const seriesId = created.body.series_id as string;

    // 1. A covering member /calendar window sees it (no fixed horizon in the read path).
    const from = new Date(Date.now() + 50 * 86_400_000).toISOString();
    const to = new Date(Date.now() + 80 * 86_400_000).toISOString();
    const cal = await agent()
      .get(`/v1/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .set(auth(memberTok));
    expect(cal.status).toBe(200);
    const occ = (cal.body.data as Array<{ series_id: string; start_at: string }>).find((o) => o.series_id === seriesId);
    expect(occ).toBeTruthy();

    // 2. The admin series list reports a REAL next_at (~64 days out, 10:00 EAT).
    const list = await agent().get("/v1/admin/events/series").set(auth(adminTok));
    expect(list.status).toBe(200);
    const row = (list.body.data as Array<{ series_id: string; next_at: string | null }>).find((s) => s.series_id === seriesId);
    expect(row).toBeTruthy();
    expect(row!.next_at).toBeTruthy();
    const expected = new Date(`${dateStr}T10:00:00+03:00`).getTime();
    expect(Math.abs(new Date(row!.next_at!).getTime() - expected)).toBeLessThan(3600_000);

    // 3. Curated onto Home, the reconcile sweep (invoked directly, as the
    //    nightly cron does) materializes it and /home/events serves it.
    const flag = await agent()
      .patch(`/v1/admin/events/series/${seriesId}/show-on-home`)
      .set(auth(adminTok))
      .send({ show_on_home: true });
    expect(flag.status).toBe(200);
    const sweep = await svc().reconcileSweep();
    expect(sweep.created).toBeGreaterThan(0);
    const home = await agent().get("/v1/home/events").set(auth(memberTok));
    expect(home.status).toBe(200);
    expect((home.body.data as Array<{ series_id: string }>).some((e) => e.series_id === seriesId)).toBe(true);
  });

  it("a weekly series created 10 weeks in the past reports a real next_at (the maxInstances bug)", async () => {
    const past = new Date(Date.now() - 70 * 86_400_000);
    const s = (await svc().createSeries(principal(admin, "Admin", cong), {
      title: "Old Faithful",
      timezone: "Africa/Nairobi",
      dtstart_local: `${past.toISOString().slice(0, 10)}T09:00:00`,
      duration_min: 60,
      rrule: "FREQ=WEEKLY", // open-ended — legal under §2
      visibility: "congregation",
    })) as { series_id: string };

    // Admin list: windowed expansion, never counted from DTSTART.
    const list = await agent().get("/v1/admin/events/series").set(auth(adminTok));
    const row = (list.body.data as Array<{ series_id: string; next_at: string | null }>).find((x) => x.series_id === s.series_id);
    expect(row!.next_at).toBeTruthy();
    expect(new Date(row!.next_at!).getTime()).toBeGreaterThan(Date.now());

    // Member series list (frozen endpoint) heals too.
    const memberList = await agent().get("/v1/calendar/series").set(auth(memberTok));
    const mRow = (memberList.body.data as Array<{ series_id: string; next_at: string | null }>).find((x) => x.series_id === s.series_id);
    expect(mRow!.next_at).toBeTruthy();
  });
});

describe("series split — this and following (§2)", () => {
  it("bounds the old series at the pivot, links the new one, migrates RSVPs", async () => {
    const start = new Date(Date.now() + 7 * 86_400_000);
    const s = (await svc().createSeries(principal(admin, "Admin", cong), {
      title: "Original Era",
      timezone: "Africa/Nairobi",
      dtstart_local: `${start.toISOString().slice(0, 10)}T18:00:00`,
      duration_min: 60,
      rrule: "FREQ=WEEKLY;COUNT=8",
      visibility: "congregation",
    })) as { series_id: string };

    const from = new Date().toISOString();
    const to = new Date(Date.now() + 75 * 86_400_000).toISOString();
    const projected = ((await svc().projectRange(member, from, to)) as Array<{ occurrence_id: string; series_id: string; start_at: string }>)
      .filter((o) => o.series_id === s.series_id);
    expect(projected.length).toBe(8);
    const pivot = projected[2]!.start_at;

    // RSVP on a post-pivot occurrence — it must survive the split.
    await svc().setRsvp(member, projected[3]!.occurrence_id, { status: "going" });

    const res = await agent()
      .post(`/v1/admin/events/series/${s.series_id}/split`)
      .set(auth(adminTok))
      .send({ pivot_start_at: pivot, changes: { title: "New Era" } });
    expect(res.status).toBe(201);
    const newId = res.body.new_series.series_id as string;
    expect(res.body.new_series.split_from).toBe(s.series_id);
    expect(res.body.series.rrule).toContain("UNTIL=");

    const after = (await svc().projectRange(member, from, to)) as Array<{ series_id: string; start_at: string; title: string }>;
    const oldOcc = after.filter((o) => o.series_id === s.series_id);
    const newOcc = after.filter((o) => o.series_id === newId);
    expect(oldOcc.length).toBe(2); // strictly before the pivot
    expect(oldOcc.every((o) => new Date(o.start_at) < new Date(pivot))).toBe(true);
    expect(newOcc.length).toBeGreaterThan(0);
    expect(new Date(newOcc[0]!.start_at).getTime()).toBe(new Date(pivot).getTime());
    expect(newOcc[0]!.title).toBe("New Era");

    // The RSVP migrated onto the matching instant of the NEW series.
    const rsvps = await testPool().query(`SELECT event_id FROM event_rsvps WHERE user_id = $1`, [member]);
    expect(rsvps.rows).toHaveLength(1);
    expect(rsvps.rows[0].event_id).toBe(occurrenceId(newId, projected[3]!.start_at));
  });
});

describe("reconcile on series update (§2)", () => {
  it("a title edit refreshes materialized rows synchronously (no stale /events/:id)", async () => {
    const start = new Date(Date.now() + 7 * 86_400_000);
    const s = (await svc().createSeries(principal(admin, "Admin", cong), {
      title: "Before Rename",
      timezone: "Africa/Nairobi",
      dtstart_local: `${start.toISOString().slice(0, 10)}T18:00:00`,
      duration_min: 60,
      rrule: "FREQ=WEEKLY;COUNT=3",
      visibility: "congregation",
    })) as { series_id: string };
    await svc().materialize(s.series_id);
    const ev = await testPool().query(`SELECT event_id FROM events WHERE series_id=$1 ORDER BY occurrence_start LIMIT 1`, [s.series_id]);
    const eventId = ev.rows[0].event_id as string;

    const put = await agent()
      .put(`/v1/admin/events/series/${s.series_id}`)
      .set(auth(adminTok))
      .send({ title: "After Rename" });
    expect(put.status).toBe(200);
    const detail = (await svc().getEvent(member, eventId)) as { title: string };
    expect(detail.title).toBe("After Rename"); // reconciled, not stale
  });

  it("occurrences the edited rule no longer produces are pruned with a cancellation notice", async () => {
    const start = new Date(Date.now() + 7 * 86_400_000);
    const s = (await svc().createSeries(principal(admin, "Admin", cong), {
      title: "Moving Night",
      timezone: "Africa/Nairobi",
      dtstart_local: `${start.toISOString().slice(0, 10)}T18:00:00`,
      duration_min: 60,
      rrule: "FREQ=WEEKLY;COUNT=3",
      visibility: "congregation",
    })) as { series_id: string };
    await svc().materialize(s.series_id);
    const ev = await testPool().query(`SELECT event_id FROM events WHERE series_id=$1 ORDER BY occurrence_start LIMIT 1`, [s.series_id]);
    await svc().setRsvp(member, ev.rows[0].event_id, { status: "going" });

    // Shift the whole series one day — every old instant becomes an orphan.
    const shifted = new Date(start.getTime() + 86_400_000);
    const put = await agent()
      .put(`/v1/admin/events/series/${s.series_id}`)
      .set(auth(adminTok))
      .send({ dtstart_local: `${shifted.toISOString().slice(0, 10)}T18:00:00` });
    expect(put.status).toBe(200);

    const gone = await testPool().query(`SELECT 1 FROM events WHERE event_id = $1`, [ev.rows[0].event_id]);
    expect(gone.rowCount).toBe(0); // pruned
    const note = await testPool().query(
      `SELECT 1 FROM notifications WHERE user_id = $1 AND template = 'event_cancelled'`,
      [member],
    );
    expect(note.rowCount).toBe(1); // the RSVP'd member was told
  });
});

describe("admin series API (§3)", () => {
  it("detail, timeline, and search return real data", async () => {
    const created = await agent().post("/v1/admin/events/series").set(auth(adminTok)).send({
      title: "Harvest Gathering",
      location: "Main Hall",
      timezone: "Africa/Nairobi",
      start_date: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10),
      start_time: "17:00",
      duration_min: 90,
      visibility: "members",
      rrule: "FREQ=WEEKLY;COUNT=4",
    });
    const sid = created.body.series_id as string;

    const detail = await agent().get(`/v1/admin/events/series/${sid}`).set(auth(adminTok));
    expect(detail.status).toBe(200);
    expect(detail.body.cadence).toBeTruthy();
    expect(detail.body.next_at).toBeTruthy();
    expect(detail.body.upcoming.length).toBeGreaterThan(0);
    expect(Array.isArray(detail.body.exceptions)).toBe(true);
    expect(Array.isArray(detail.body.announcements)).toBe(true);

    const timeline = await agent().get(`/v1/admin/events/series/${sid}/timeline`).set(auth(adminTok));
    expect(timeline.status).toBe(200);
    expect((timeline.body.data as Array<{ action: string }>).some((t) => t.action === "calendar.series_created")).toBe(true);

    const search = await agent().get("/v1/admin/events/search?q=Harvest").set(auth(adminTok));
    expect(search.status).toBe(200);
    expect((search.body.series as Array<{ series_id: string }>).some((x) => x.series_id === sid)).toBe(true);

    // A member (no events grant) is refused the admin surface.
    expect((await agent().get("/v1/admin/events/series").set(auth(memberTok))).status).toBe(403);
  });

  it("PUT wires video_url and the ops toggles through to the series", async () => {
    const s = (await svc().createSeries(principal(admin, "Admin", cong), {
      title: "Toggles",
      timezone: "Africa/Nairobi",
      dtstart_local: `${new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)}T09:00:00`,
      duration_min: 60,
      visibility: "congregation",
    })) as { series_id: string };
    const put = await agent().put(`/v1/admin/events/series/${s.series_id}`).set(auth(adminTok)).send({
      video_url: "https://res.cloudinary.com/x/promo.mp4",
      rsvp_enabled: false,
      manual_checkin_enabled: false,
    });
    expect(put.status).toBe(200);
    const row = await testPool().query(
      `SELECT video_url, rsvp_enabled, manual_checkin_enabled FROM event_series WHERE series_id = $1`,
      [s.series_id],
    );
    expect(row.rows[0]).toMatchObject({
      video_url: "https://res.cloudinary.com/x/promo.mp4",
      rsvp_enabled: false,
      manual_checkin_enabled: false,
    });
  });
});

describe("real QR + CSV export + insights (§6)", () => {
  it("the QR panel token round-trips through the member check-in validator", async () => {
    const s = (await svc().createSeries(principal(admin, "Admin", cong), {
      title: "Checkin Night",
      timezone: "Africa/Nairobi",
      dtstart_local: `${new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}T18:00:00`,
      duration_min: 60,
      visibility: "congregation",
    })) as { series_id: string };
    await svc().materialize(s.series_id);
    const ev = await testPool().query(`SELECT event_id FROM events WHERE series_id=$1`, [s.series_id]);
    const eventId = ev.rows[0].event_id as string;

    const qr = await agent().get(`/v1/admin/events/${eventId}/qr`).set(auth(adminTok));
    expect(qr.status).toBe(200);
    expect(qr.body.scan_token).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(qr.body.expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(qr.body.checkin_url).toContain(qr.body.scan_token);

    // The member scans exactly what the panel rendered — frozen endpoint accepts it.
    const checkin = await agent()
      .post(`/v1/events/${eventId}/attendance`)
      .set(auth(memberTok))
      .send({ client_scan_id: UUIDS(11), scan_token: qr.body.scan_token });
    expect(checkin.status).toBe(201);
    expect(checkin.body.duplicate).toBe(false);

    // Within the TTL the panel returns the SAME token (stable display).
    const again = await agent().get(`/v1/admin/events/${eventId}/qr`).set(auth(adminTok));
    expect(again.body.scan_token).toBe(qr.body.scan_token);
    expect(again.body.expires_at).toBe(qr.body.expires_at);
  });

  it("attendance.csv exports checked-in, guests, and no-shows", async () => {
    const cellA = await createCellGroup(cong, "Cell A");
    const leader = (await createUser({ congregationId: cong, role: "Instructor", email: "l@dev.local" })).user_id;
    await createLeaderAssignment(leader, cellA);
    const goer = (await createUser({ congregationId: cong, cellGroupId: cellA, fullName: "Checked Person", email: "c@dev.local" })).user_id;
    const ghost = (await createUser({ congregationId: cong, cellGroupId: cellA, fullName: "Ghost Person", email: "g@dev.local" })).user_id;
    const { event_id } = await createEvent(cong, { cellGroupId: cellA });
    const leaderTok = bearer({ sub: leader, role: "Instructor", cong });

    await agent().post(`/v1/admin/events/${event_id}/checkins`).set(auth(leaderTok)).send({ user_id: goer });
    await agent().post(`/v1/admin/events/${event_id}/guests`).set(auth(leaderTok)).send({ guest_name: "Walk In", first_time: true });
    await testPool().query(`INSERT INTO event_rsvps (event_id, user_id, status) VALUES ($1,$2,'going')`, [event_id, ghost]);

    const csv = await agent().get(`/v1/admin/events/${event_id}/attendance.csv`).set(auth(leaderTok));
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain("name,type,status,method,first_time,timestamp");
    expect(csv.text).toContain("Checked Person,member,checked_in,manual");
    expect(csv.text).toContain("Walk In,guest,checked_in,manual,true");
    expect(csv.text).toContain("Ghost Person,member,rsvp_no_show");
  });

  it("insights returns only real numbers", async () => {
    // A completed occurrence of a real series: 2 going, 1 checked in (manual),
    // 1 first-time guest.
    const past = new Date(Date.now() - 2 * 86_400_000);
    const s = (await svc().createSeries(principal(admin, "Admin", cong), {
      title: "Past Service",
      timezone: "Africa/Nairobi",
      dtstart_local: `${past.toISOString().slice(0, 10)}T09:00:00`,
      duration_min: 60,
      visibility: "congregation",
    })) as { series_id: string };
    const goer2 = (await createUser({ congregationId: cong, email: "g2@dev.local" })).user_id;
    await testPool().query(
      `INSERT INTO events (event_id, congregation_id, title, occurs_at, qr_secret, series_id, occurrence_start)
       VALUES ('past-1', $1, 'Past Service', $2, 'sec', $3, $2)`,
      [cong, past.toISOString(), s.series_id],
    );
    await testPool().query(`INSERT INTO event_rsvps (event_id, user_id, status) VALUES ('past-1',$1,'going'), ('past-1',$2,'going')`, [member, goer2]);
    await testPool().query(
      `INSERT INTO attendance_logs (user_id, event_id, method, recorded_by) VALUES ($1,'past-1','manual',$2)`,
      [member, admin],
    );
    await testPool().query(
      `INSERT INTO event_guests (event_id, guest_name, first_time, recorded_by) VALUES ('past-1','Newcomer',TRUE,$1)`,
      [admin],
    );

    const res = await agent().get("/v1/admin/events/insights").set(auth(adminTok));
    expect(res.status).toBe(200);
    expect(res.body.conversion).toMatchObject({ going: 2, checked_in: 1, rate: 50 });
    expect(res.body.first_time_guests_30d).toBe(1);
    expect(res.body.manual_checkins_7d).toBe(1);
    const noShow = (res.body.recent_no_shows as Array<{ series_id: string; absent: number }>).find((r) => r.series_id === s.series_id);
    expect(noShow).toBeTruthy();
    expect(noShow!.absent).toBe(1); // goer2 never checked in
  });
});

describe("per-series automation (§7)", () => {
  it("reminder_offsets_min drives the RSVP reminder scheduler", async () => {
    const d = new Date(Date.now() + 86_400_000);
    const created = await agent().post("/v1/admin/events/series").set(auth(adminTok)).send({
      title: "Custom Reminders",
      timezone: "Africa/Nairobi",
      start_date: d.toISOString().slice(0, 10),
      start_time: "18:00",
      duration_min: 60,
      visibility: "members",
      automation: { reminder_offsets_min: [120] },
    });
    expect(created.status).toBe(201);
    const sid = created.body.series_id as string;
    await svc().materialize(sid);
    const ev = await testPool().query(`SELECT event_id FROM events WHERE series_id=$1`, [sid]);

    const rsvp = await agent().post(`/v1/events/${ev.rows[0].event_id}/rsvp`).set(auth(memberTok)).send({ status: "going" });
    expect(rsvp.status).toBe(200);

    const reminders = await testPool().query(
      `SELECT template FROM notifications WHERE user_id=$1 AND template LIKE 'event_reminder%'`,
      [member],
    );
    // ONE reminder at the configured offset (not the default T-24h + T-1h pair).
    expect(reminders.rows).toHaveLength(1);
    expect(reminders.rows[0].template).toBe("event_reminder_1h");
  });

  it("low_rsvp_alert notifies leaders once per occurrence", async () => {
    const d = new Date(Date.now() + 86_400_000); // within the 48h default window
    const s = (await svc().createSeries(principal(admin, "Admin", cong), {
      title: "Quiet Event",
      timezone: "Africa/Nairobi",
      dtstart_local: `${d.toISOString().slice(0, 10)}T18:00:00`,
      duration_min: 60,
      visibility: "congregation",
      automation: { low_rsvp_alert: { threshold: 5, offset_min: 2880 } },
    })) as { series_id: string };
    await svc().materialize(s.series_id);

    expect(await svc().runLowRsvpAlerts()).toBe(1);
    const note = await testPool().query(
      `SELECT 1 FROM notifications WHERE user_id = $1 AND template = 'event_low_rsvp'`,
      [admin], // the series creator
    );
    expect(note.rowCount).toBe(1);
    expect(await svc().runLowRsvpAlerts()).toBe(0); // idempotent per occurrence
  });

  it("auto_archive_days archives completed occurrences", async () => {
    const past = new Date(Date.now() - 3 * 86_400_000);
    const s = (await svc().createSeries(principal(admin, "Admin", cong), {
      title: "Archivable",
      timezone: "Africa/Nairobi",
      dtstart_local: `${past.toISOString().slice(0, 10)}T09:00:00`,
      duration_min: 60,
      visibility: "congregation",
      automation: { auto_archive_days: 1 },
    })) as { series_id: string };
    await testPool().query(
      `INSERT INTO events (event_id, congregation_id, title, occurs_at, qr_secret, series_id, occurrence_start)
       VALUES ('old-1', $1, 'Archivable', $2, 'sec', $3, $2)`,
      [cong, past.toISOString(), s.series_id],
    );
    expect(await svc().runAutoArchive()).toBe(1);
    const row = await testPool().query(`SELECT archived_at FROM events WHERE event_id = 'old-1'`);
    expect(row.rows[0].archived_at).not.toBeNull();
    expect(await svc().runAutoArchive()).toBe(0); // idempotent
  });

  it("rejects malformed automation config", async () => {
    const res = await agent().post("/v1/admin/events/series").set(auth(adminTok)).send({
      title: "Bad Automation",
      timezone: "Africa/Nairobi",
      start_date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      start_time: "18:00",
      duration_min: 60,
      visibility: "members",
      automation: { reminder_offsets_min: ["soon"] },
    });
    expect(res.status).toBe(400);
  });
});

describe("occurrence scoping (§8)", () => {
  it("a member of congregation B gets 404 on A's cell-visibility occurrence (read, RSVP, posts)", async () => {
    const cellA = await createCellGroup(cong, "Cell A");
    const insider = (await createUser({ congregationId: cong, cellGroupId: cellA, email: "in@dev.local" })).user_id;
    const otherCellMember = (await createUser({ congregationId: cong, email: "oc@dev.local" })).user_id;
    const congB = await createCongregation("Other Branch");
    const outsider = (await createUser({ congregationId: congB, email: "out@dev.local" })).user_id;
    const outsiderTok = bearer({ sub: outsider, role: "Student", cong: congB });
    const otherCellTok = bearer({ sub: otherCellMember, role: "Student", cong });
    const insiderTok = bearer({ sub: insider, role: "Student", cong });

    const s = (await svc().createSeries(principal(admin, "Admin", cong), {
      title: "Cell A Only",
      cell_group_id: cellA,
      timezone: "Africa/Nairobi",
      dtstart_local: `${new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)}T18:00:00`,
      duration_min: 60,
      rrule: "FREQ=WEEKLY;COUNT=2",
      visibility: "cell",
    })) as { series_id: string };
    const projected = ((await svc().projectRange(insider, new Date().toISOString(), new Date(Date.now() + 20 * 86_400_000).toISOString())) as Array<{ occurrence_id: string; series_id: string }>)
      .filter((o) => o.series_id === s.series_id);
    const occId = projected[0]!.occurrence_id;

    // The insider can read + RSVP through the frozen endpoints.
    expect((await agent().get(`/v1/events/${occId}`).set(auth(insiderTok))).status).toBe(200);
    expect((await agent().post(`/v1/events/${occId}/rsvp`).set(auth(insiderTok)).send({ status: "going" })).status).toBe(200);

    // Cross-congregation: existence never leaks.
    expect((await agent().get(`/v1/events/${occId}`).set(auth(outsiderTok))).status).toBe(404);
    expect((await agent().post(`/v1/events/${occId}/rsvp`).set(auth(outsiderTok)).send({ status: "going" })).status).toBe(404);
    expect((await agent().get(`/v1/events/${occId}/posts`).set(auth(outsiderTok))).status).toBe(404);

    // Same congregation, different cell: cell visibility still applies.
    expect((await agent().get(`/v1/events/${occId}`).set(auth(otherCellTok))).status).toBe(404);
  });

  it("featured event is per-congregation — featuring in B keeps A's pick (§8)", async () => {
    const congB = await createCongregation("Branch B");
    const adminB = (await createUser({ congregationId: congB, role: "Admin", email: "ab@dev.local" })).user_id;
    const memberB = (await createUser({ congregationId: congB, email: "mb2@dev.local" })).user_id;
    const adminBTok = bearer({ sub: adminB, role: "Admin", cong: congB });
    const memberBTok = bearer({ sub: memberB, role: "Student", cong: congB });

    const mk = async (p: Principal, title: string) =>
      (await svc().createSeries(p, {
        title,
        timezone: "Africa/Nairobi",
        dtstart_local: `${new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10)}T09:00:00`,
        duration_min: 60,
        visibility: "congregation",
      })) as { series_id: string };
    const sA = await mk(principal(admin, "Admin", cong), "A Featured");
    const sB = await mk(principal(adminB, "Admin", congB), "B Featured");

    expect((await agent().post(`/v1/admin/events/series/${sA.series_id}/homepage`).set(auth(adminTok))).status).toBe(200);
    expect((await agent().post(`/v1/admin/events/series/${sB.series_id}/homepage`).set(auth(adminBTok))).status).toBe(200);

    // BOTH stay featured — the old code un-featured globally.
    const flags = await testPool().query(`SELECT series_id FROM event_series WHERE is_featured = true ORDER BY title`);
    expect(flags.rows.map((r) => r.series_id).sort()).toEqual([sA.series_id, sB.series_id].sort());

    const homeA = await agent().get("/v1/home/featured-event").set(auth(memberTok));
    expect(homeA.body.data.series_id).toBe(sA.series_id);
    const homeB = await agent().get("/v1/home/featured-event").set(auth(memberBTok));
    expect(homeB.body.data.series_id).toBe(sB.series_id);
  });
});
