// Follow-up — the administration reports built on service attendance: who came,
// who didn't, and who to call. The absentee list is the load-bearing one, so
// most of these pin its edges.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser, createChurchService, createEvent } from "./helpers/factories.js";
import { FollowUpService } from "../src/modules/attendance/follow-up.js";
import { ChurchAttendanceService, serviceScanToken } from "../src/modules/attendance/service.js";
import type { Principal } from "../src/http/http.js";

const followUp = () => new FollowUpService(testPool());
const attendance = () => new ChurchAttendanceService(testPool());
const YEAR = 2026;

function principal(userId: string, congregationId: string, role: Principal["role"] = "Instructor"): Principal {
  return { userId, congregationId, role };
}

/** A service on a given date in YEAR, already started so it counts. */
async function serviceOn(cong: string, monthDay: string, opts: { title?: string; secret?: string } = {}) {
  const startsAt = `${YEAR}-${monthDay}T08:00:00.000Z`;
  return createChurchService(cong, {
    title: opts.title ?? `Service ${monthDay}`,
    serviceDate: `${YEAR}-${monthDay}`,
    startsAt,
    qrSecret: opts.secret ?? `secret-${monthDay}`,
  });
}

let scanSeq = 0;
function nextScanId(): string {
  scanSeq += 1;
  return `00000000-0000-4000-8000-${String(scanSeq).padStart(12, "0")}`;
}

async function checkIn(member: Principal, serviceId: string, secret: string) {
  return attendance().checkIn(member, serviceId, {
    client_scan_id: nextScanId(),
    scan_token: serviceScanToken(secret, serviceId),
  });
}

describe("follow-up reports", () => {
  let cong: string, leader: Principal, grace: Principal, peter: Principal;

  beforeEach(async () => {
    await resetDb();
    scanSeq = 0;
    cong = await createCongregation();
    leader = principal((await createUser({ congregationId: cong, role: "Instructor", fullName: "Leader Leah" })).user_id, cong);
    grace = principal(
      (await createUser({ congregationId: cong, fullName: "Grace Wanjiru", phone: "+254711000111", email: "grace@example.com" })).user_id,
      cong,
      "Student",
    );
    peter = principal(
      (await createUser({ congregationId: cong, fullName: "Peter Otieno", phone: "+254722000222", email: "peter@example.com" })).user_id,
      cong,
      "Student",
    );
  });
  afterAll(async () => {
    await closeTestPool();
  });

  // ---- Member standing ----

  it("lists everyone on the roll, including those who never came", async () => {
    await serviceOn(cong, "01-04");
    const rows = await followUp().members(leader, YEAR);
    expect(rows).toHaveLength(3); // leader + 2 members
    expect(rows.every((r) => r.never_attended)).toBe(true);
    expect(rows.every((r) => r.status === "new")).toBe(true);
  });

  it("counts attended and missed services for the year", async () => {
    const a = await serviceOn(cong, "01-04", { secret: "a" });
    await serviceOn(cong, "01-11", { secret: "b" }); // Grace misses this
    const c = await serviceOn(cong, "01-18", { secret: "c" });
    await checkIn(grace, a.service_id, "a");
    await checkIn(grace, c.service_id, "c");

    const row = (await followUp().members(leader, YEAR)).find((r) => r.user_id === grace.userId)!;
    expect(row).toMatchObject({
      attended_this_year: 2,
      missed_this_year: 1,
      current_streak: 1,
      breaks: 1,
      status: "active",
      never_attended: false,
    });
  });

  it("carries the contact details registered at the last scan", async () => {
    const a = await serviceOn(cong, "01-04", { secret: "a" });
    await attendance().checkIn(grace, a.service_id, {
      client_scan_id: nextScanId(),
      scan_token: serviceScanToken("a", a.service_id),
      full_name: "Grace W.",
      phone_number: "+254799888777",
    });
    const row = (await followUp().members(leader, YEAR)).find((r) => r.user_id === grace.userId)!;
    expect(row.registered_name).toBe("Grace W.");
    expect(row.registered_phone).toBe("+254799888777");
    // The profile value is still there beside it, unchanged.
    expect(row.phone_number).toBe("+254711000111");
    expect(row.last_service_title).toBe("Service 01-04");
  });

  it("orders the queue worst-first — longest current absence at the top", async () => {
    const a = await serviceOn(cong, "01-04", { secret: "a" });
    const b = await serviceOn(cong, "01-11", { secret: "b" });
    // Grace attends both; Peter attends the first then stops.
    await checkIn(grace, a.service_id, "a");
    await checkIn(grace, b.service_id, "b");
    await checkIn(peter, a.service_id, "a");

    const rows = await followUp().members(leader, YEAR);
    expect(rows[0]!.user_id).toBe(peter.userId); // missed the most recent
    expect(rows[0]!.current_miss_run).toBe(1);
    expect(rows.find((r) => r.user_id === grace.userId)!.current_miss_run).toBe(0);
  });

  it("filters by status", async () => {
    const a = await serviceOn(cong, "01-04", { secret: "a" });
    await serviceOn(cong, "01-11", { secret: "b" });
    await checkIn(grace, a.service_id, "a");
    const atRisk = await followUp().members(leader, YEAR, { status: "at_risk" });
    expect(atRisk.map((r) => r.user_id)).toEqual([grace.userId]);
  });

  it("ignores a service flagged as not counting toward the streak", async () => {
    await serviceOn(cong, "01-04", { secret: "a" });
    await createChurchService(cong, {
      title: "Extra Midweek",
      serviceDate: `${YEAR}-01-07`,
      startsAt: `${YEAR}-01-07T17:00:00.000Z`,
      countsForStreak: false,
    });
    const row = (await followUp().members(leader, YEAR)).find((r) => r.user_id === grace.userId)!;
    // One eligible service missed, not two — and misses only start at the first
    // check-in, so a never-attender carries none.
    expect(row.missed_this_year).toBe(0);
    expect(row.never_attended).toBe(true);
  });

  // ---- Scan log ----

  it("logs every scan with the details captured at it, newest first", async () => {
    const a = await serviceOn(cong, "01-04", { secret: "a" });
    const b = await serviceOn(cong, "01-11", { secret: "b" });
    await checkIn(grace, a.service_id, "a");
    await checkIn(grace, b.service_id, "b");

    const log = await followUp().scanLog(leader);
    expect(log).toHaveLength(2);
    expect(log[0]!.service_title).toBe("Service 01-11"); // newest first
    expect(log[0]).toMatchObject({
      full_name: "Grace Wanjiru",
      phone_number: "+254711000111",
      email: "grace@example.com",
      method: "qr",
    });
    expect(log[0]!.service_date).toBe(`${YEAR}-01-11`);
  });

  it("filters the scan log to one service", async () => {
    const a = await serviceOn(cong, "01-04", { secret: "a" });
    const b = await serviceOn(cong, "01-11", { secret: "b" });
    await checkIn(grace, a.service_id, "a");
    await checkIn(peter, b.service_id, "b");
    const log = await followUp().scanLog(leader, { serviceId: b.service_id });
    expect(log.map((l) => l.user_id)).toEqual([peter.userId]);
  });

  // ---- Per-service totals ----

  it("summarises each service with attended, absent and rate", async () => {
    const a = await serviceOn(cong, "01-04", { secret: "a" });
    await checkIn(grace, a.service_id, "a");
    const [summary] = await followUp().serviceSummaries(leader, YEAR);
    expect(summary).toMatchObject({
      title: "Service 01-04",
      expected: 3,
      attended: 1,
      absent: 2,
    });
    expect(summary!.attendance_rate).toBeCloseTo(0.333, 3);
  });

  // ---- Absentees: the call list ----

  it("names who missed a service, with a phone number to call", async () => {
    const a = await serviceOn(cong, "01-04", { secret: "a" });
    await checkIn(grace, a.service_id, "a");

    const { service, absentees } = await followUp().absentees(leader, a.service_id);
    expect(service).toMatchObject({ attended: 1, absent: 2 });
    const names = absentees.map((x) => x.full_name).sort();
    expect(names).toEqual(["Leader Leah", "Peter Otieno"]);
    const peterRow = absentees.find((x) => x.user_id === peter.userId)!;
    expect(peterRow.phone_number).toBe("+254722000222");
    expect(peterRow.never_attended).toBe(true);
  });

  it("separates someone who stopped coming from someone who never came", async () => {
    const a = await serviceOn(cong, "01-04", { secret: "a" });
    const b = await serviceOn(cong, "01-11", { secret: "b" });
    await checkIn(peter, a.service_id, "a"); // came once, then missed b

    const { absentees } = await followUp().absentees(leader, b.service_id);
    const lapsed = absentees.find((x) => x.user_id === peter.userId)!;
    const never = absentees.find((x) => x.user_id === grace.userId)!;
    expect(lapsed.never_attended).toBe(false);
    expect(lapsed.last_attended_at).toBeTruthy();
    expect(lapsed.current_miss_run).toBe(1);
    expect(never.never_attended).toBe(true);
    expect(never.last_attended_at).toBeNull();
  });

  it("refuses a service belonging to another congregation", async () => {
    const other = await createCongregation("Other Branch");
    const otherSvc = await createChurchService(other, { serviceDate: `${YEAR}-01-04` });
    await expect(followUp().absentees(leader, otherSvc.service_id)).rejects.toMatchObject({
      code: "FORBIDDEN_SCOPE",
    });
  });

  it("404s an unknown service", async () => {
    await expect(
      followUp().absentees(leader, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ---- Events counted beside services, never inside the streak ----

  it("counts event check-ins separately from service attendance", async () => {
    const a = await serviceOn(cong, "01-04", { secret: "a" });
    await checkIn(grace, a.service_id, "a");
    // A cell gathering (attendance_logs, the generic event path) the same week.
    await createEvent(cong, { eventId: "cell-gathering-1" });
    await testPool().query(
      `INSERT INTO attendance_logs (user_id, event_id, checked_in_at) VALUES ($1, $2, $3)`,
      [grace.userId, "cell-gathering-1", `${YEAR}-01-06T17:00:00.000Z`],
    );

    const row = (await followUp().members(leader, YEAR)).find((r) => r.user_id === grace.userId)!;
    expect(row.events_attended_this_year).toBe(1);
    // The event must not touch the service figures or the streak.
    expect(row.attended_this_year).toBe(1);
    expect(row.missed_this_year).toBe(0);
    expect(row.current_streak).toBe(1);

    const o = await followUp().yearOverview(leader, YEAR);
    expect(o.total_event_check_ins).toBe(1);
    expect(o.total_check_ins).toBe(1); // services only
  });

  // ---- Year overview ----

  it("counts Sundays separately from all services held", async () => {
    await serviceOn(cong, "01-04"); // 2026-01-04 is a Sunday
    await serviceOn(cong, "01-07"); // Wednesday
    await serviceOn(cong, "01-11"); // Sunday
    const o = await followUp().yearOverview(leader, YEAR);
    expect(o.services_held).toBe(3);
    expect(o.sundays_held).toBe(2);
  });

  it("reports engagement across the congregation", async () => {
    const a = await serviceOn(cong, "01-04", { secret: "a" });
    await serviceOn(cong, "01-11", { secret: "b" });
    await checkIn(grace, a.service_id, "a"); // attended, then missed → at_risk

    const o = await followUp().yearOverview(leader, YEAR);
    expect(o).toMatchObject({
      year: YEAR,
      members: 3,
      members_attended: 1,
      members_never_attended: 2,
      members_at_risk: 1,
      total_check_ins: 1,
    });
  });

  it("reports an empty year without falling over", async () => {
    const o = await followUp().yearOverview(leader, YEAR);
    expect(o).toMatchObject({ services_held: 0, sundays_held: 0, total_check_ins: 0, members: 3 });
    expect(await followUp().serviceSummaries(leader, YEAR)).toEqual([]);
    expect(await followUp().scanLog(leader)).toEqual([]);
  });
});
