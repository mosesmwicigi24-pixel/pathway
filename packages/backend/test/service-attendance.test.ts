// Church service attendance — QR scan-token validation, contact registration,
// idempotency, congregation scoping and the rolled-up streak (§3.3, §5).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser, createChurchService } from "./helpers/factories.js";
import {
  ChurchAttendanceService,
  serviceScanToken,
  serviceQrPayload,
  parseServiceQrPayload,
} from "../src/modules/attendance/service.js";
import type { Principal } from "../src/http/http.js";

const svc = () => new ChurchAttendanceService(testPool());
const SCAN = "11111111-1111-4111-8111-111111111111";
const SCAN2 = "22222222-2222-4222-8222-222222222222";

function principal(userId: string, congregationId: string, role: Principal["role"] = "Student"): Principal {
  return { userId, congregationId, role };
}

describe("church service attendance", () => {
  let cong: string, member: Principal, serviceId: string, token: string;

  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation();
    const cell = await createCellGroup(cong);
    const u = await createUser({
      congregationId: cong,
      cellGroupId: cell,
      fullName: "Grace Wanjiru",
      phone: "+254711000111",
      email: "grace@example.com",
    });
    member = principal(u.user_id, cong);
    const s = await createChurchService(cong, { qrSecret: "s3cr3t" });
    serviceId = s.service_id;
    token = serviceScanToken("s3cr3t", serviceId);
  });
  afterAll(async () => {
    await closeTestPool();
  });

  // ---- QR payload ----

  it("round-trips the QR payload the sanctuary screen displays", () => {
    const payload = serviceQrPayload(serviceId, "s3cr3t");
    expect(parseServiceQrPayload(payload)).toEqual({ service_id: serviceId, scan_token: token });
  });

  it("rejects a QR that isn't ours", () => {
    expect(parseServiceQrPayload("https://example.com/whatever")).toBeNull();
    expect(parseServiceQrPayload("nuru-service:only-two-parts")).toBeNull();
  });

  // ---- Check-in ----

  it("records a check-in with the contact details registered at the scan", async () => {
    const res = await svc().checkIn(member, serviceId, {
      client_scan_id: SCAN,
      scan_token: token,
      full_name: "Grace W.",
      phone_number: "+254711999888",
      email: "grace.w@example.com",
    });
    expect(res.duplicate).toBe(false);
    expect(res).toMatchObject({
      full_name: "Grace W.",
      phone_number: "+254711999888",
      email: "grace.w@example.com",
    });
    expect(res.attended_at).toBeTruthy();

    const { rows } = await testPool().query(
      `SELECT full_name, phone_number, email FROM service_attendance WHERE attendance_id = $1`,
      [res.attendance_id],
    );
    expect(rows[0]).toMatchObject({ full_name: "Grace W.", phone_number: "+254711999888" });
  });

  it("falls back to the profile for details the app didn't send", async () => {
    const res = await svc().checkIn(member, serviceId, { client_scan_id: SCAN, scan_token: token });
    expect(res).toMatchObject({
      full_name: "Grace Wanjiru",
      phone_number: "+254711000111",
      email: "grace@example.com",
    });
  });

  it("keeps the snapshot when the member later edits their profile", async () => {
    const res = await svc().checkIn(member, serviceId, { client_scan_id: SCAN, scan_token: token });
    await testPool().query(`UPDATE users SET full_name = 'Renamed', phone_number = '+254700000000' WHERE user_id = $1`, [
      member.userId,
    ]);
    const { rows } = await testPool().query(`SELECT full_name FROM service_attendance WHERE attendance_id = $1`, [
      res.attendance_id,
    ]);
    expect(rows[0].full_name).toBe("Grace Wanjiru");
  });

  it("nudges engagement + gamification and logs the activity event", async () => {
    await svc().checkIn(member, serviceId, { client_scan_id: SCAN, scan_token: token });
    const ob = await testPool().query("SELECT topic FROM outbox ORDER BY topic");
    // follow_up.arm joins the set because this is the member's FIRST service
    // attendance, which is what arms the first-visit cadence. Enqueued rather
    // than run inline so a follow-up rhythm can never fail somebody's check-in.
    //
    // attendance.welcome is the SMS at the door, enqueued for the same reason:
    // a provider outage must not roll back an attendance that genuinely
    // happened. Unlike follow_up.arm it fires on EVERY check-in, not only the
    // first — the once-a-day guard lives in the handler (see
    // checkin-welcome-sms.test.ts), because a second scan of the same code is
    // already a no-op here, while an 8am and an 11am service are two real
    // arrivals that must not become two texts.
    expect(ob.rows.map((r) => r.topic)).toEqual([
      "attendance.welcome",
      "engagement.recompute",
      "follow_up.arm",
      "gamification.evaluate",
    ]);
    const ie = await testPool().query("SELECT count(*)::int n FROM interaction_events WHERE kind='check_in'");
    expect(ie.rows[0].n).toBe(1);
  });

  it("arms the first-visit cadence once, not every Sunday", async () => {
    await svc().checkIn(member, serviceId, { client_scan_id: SCAN, scan_token: token });
    const afterFirst = await testPool().query(
      `SELECT count(*)::int AS n FROM outbox WHERE topic = 'follow_up.arm'`,
    );
    expect(afterFirst.rows[0].n).toBe(1);

    // A second, different service. Coming back is not a first visit, and a
    // member who attends every week must not be welcomed every week.
    const second = await createChurchService(cong, {
      title: "Midweek",
      startsAt: new Date(Date.now() - 86_400_000).toISOString(),
    });
    await svc().checkIn(member, second.service_id, {
      client_scan_id: "33333333-3333-3333-3333-333333333333",
      scan_token: serviceScanToken(second.qr_secret, second.service_id),
    });

    const afterSecond = await testPool().query(
      `SELECT count(*)::int AS n FROM outbox WHERE topic = 'follow_up.arm'`,
    );
    expect(afterSecond.rows[0].n).toBe(1);
  });

  it("is idempotent on a replayed scan id", async () => {
    const first = await svc().checkIn(member, serviceId, { client_scan_id: SCAN, scan_token: token });
    const again = await svc().checkIn(member, serviceId, { client_scan_id: SCAN, scan_token: token });
    expect(again.duplicate).toBe(true);
    expect(again.attendance_id).toBe(first.attendance_id);
  });

  it("is idempotent on a second scan with a fresh scan id", async () => {
    const first = await svc().checkIn(member, serviceId, { client_scan_id: SCAN, scan_token: token });
    const again = await svc().checkIn(member, serviceId, { client_scan_id: SCAN2, scan_token: token });
    expect(again.duplicate).toBe(true);
    expect(again.attendance_id).toBe(first.attendance_id);
  });

  it("rejects a forged scan token", async () => {
    await expect(
      svc().checkIn(member, serviceId, { client_scan_id: SCAN, scan_token: "forged" }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("404s an unknown service", async () => {
    await expect(
      svc().checkIn(member, "00000000-0000-4000-8000-000000000000", { client_scan_id: SCAN, scan_token: token }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a service belonging to another congregation", async () => {
    const other = await createCongregation("Other Branch");
    const otherSvc = await createChurchService(other, { qrSecret: "other" });
    await expect(
      svc().checkIn(member, otherSvc.service_id, {
        client_scan_id: SCAN,
        scan_token: serviceScanToken("other", otherSvc.service_id),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
  });

  it("refuses a check-in before the window opens and after it closes", async () => {
    const soon = await createChurchService(cong, {
      title: "Later Service",
      qrSecret: "s3cr3t",
      checkinOpensAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await expect(
      svc().checkIn(member, soon.service_id, {
        client_scan_id: SCAN,
        scan_token: serviceScanToken("s3cr3t", soon.service_id),
      }),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE" });

    const past = await createChurchService(cong, {
      title: "Closed Service",
      qrSecret: "s3cr3t",
      checkinClosesAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    await expect(
      svc().checkIn(member, past.service_id, {
        client_scan_id: SCAN2,
        scan_token: serviceScanToken("s3cr3t", past.service_id),
      }),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });

  it("refuses a check-in when QR is disabled for the service", async () => {
    const off = await createChurchService(cong, { title: "No QR", qrSecret: "s3cr3t", qrEnabled: false });
    await expect(
      svc().checkIn(member, off.service_id, {
        client_scan_id: SCAN,
        scan_token: serviceScanToken("s3cr3t", off.service_id),
      }),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });

  it("clamps a client clock running fast back to server time", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const res = await svc().checkIn(member, serviceId, {
      client_scan_id: SCAN,
      scan_token: token,
      attended_at: future,
    });
    expect(new Date(res.attended_at).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("trusts an offline queue replaying the real arrival time", async () => {
    const arrived = new Date(Date.now() - 1_800_000).toISOString();
    const res = await svc().checkIn(member, serviceId, {
      client_scan_id: SCAN,
      scan_token: token,
      attended_at: arrived,
    });
    expect(new Date(res.attended_at).getTime()).toBe(new Date(arrived).getTime());
  });

  // ---- Streak ----

  it("builds a streak across services and persists the snapshot", async () => {
    // Three past Sundays; the member attends the first and the third.
    const older = await createChurchService(cong, {
      title: "Sunday A",
      qrSecret: "a",
      startsAt: new Date(Date.now() - 3 * 604_800_000).toISOString(),
    });
    await createChurchService(cong, {
      title: "Sunday B",
      qrSecret: "b",
      startsAt: new Date(Date.now() - 2 * 604_800_000).toISOString(),
    });
    await svc().checkIn(member, older.service_id, {
      client_scan_id: SCAN2,
      scan_token: serviceScanToken("a", older.service_id),
    });
    const res = await svc().checkIn(member, serviceId, { client_scan_id: SCAN, scan_token: token });

    expect(res.streak).toMatchObject({
      current_streak: 1,
      longest_streak: 1,
      total_attended: 2,
      total_missed: 1, // Sunday B
      breaks: 1,
      status: "active",
    });

    const snap = await testPool().query(
      `SELECT current_streak, total_missed, breaks, status FROM service_attendance_streaks WHERE user_id = $1`,
      [member.userId],
    );
    expect(snap.rows[0]).toMatchObject({ current_streak: 1, total_missed: 1, breaks: 1, status: "active" });
  });

  it("does not count a service flagged as not counting toward the streak", async () => {
    const older = await createChurchService(cong, {
      title: "Sunday A",
      qrSecret: "a",
      startsAt: new Date(Date.now() - 2 * 604_800_000).toISOString(),
    });
    await createChurchService(cong, {
      title: "Extra Midweek",
      qrSecret: "m",
      countsForStreak: false,
      startsAt: new Date(Date.now() - 604_800_000).toISOString(),
    });
    await svc().checkIn(member, older.service_id, {
      client_scan_id: SCAN2,
      scan_token: serviceScanToken("a", older.service_id),
    });
    const res = await svc().checkIn(member, serviceId, { client_scan_id: SCAN, scan_token: token });
    expect(res.streak).toMatchObject({ current_streak: 2, total_missed: 0, breaks: 0 });
  });

  it("reports a `new` streak for a member who has never checked in", async () => {
    expect(await svc().streakFor(member)).toMatchObject({ status: "new", current_streak: 0, total_missed: 0 });
  });

  it("lists the member's history with misses visible", async () => {
    await createChurchService(cong, {
      title: "Missed Sunday",
      qrSecret: "m",
      startsAt: new Date(Date.now() - 604_800_000).toISOString(),
    });
    const older = await createChurchService(cong, {
      title: "Attended Sunday",
      qrSecret: "a",
      startsAt: new Date(Date.now() - 2 * 604_800_000).toISOString(),
    });
    await svc().checkIn(member, older.service_id, {
      client_scan_id: SCAN2,
      scan_token: serviceScanToken("a", older.service_id),
    });

    const history = await svc().historyFor(member);
    expect(history.map((h) => [h.title, h.attended])).toEqual([
      ["Sunday Service", false],
      ["Missed Sunday", false],
      ["Attended Sunday", true],
    ]);
  });

  // ---- Discovery + leader views ----

  it("lists only services open for check-in", async () => {
    await createChurchService(cong, {
      title: "Not Yet Open",
      checkinOpensAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const open = await svc().openServices(member);
    expect(open.map((s) => s.title)).toEqual(["Sunday Service"]);
    expect(open[0]!.attended).toBe(false);
  });

  it("marks a service the member already attended", async () => {
    await svc().checkIn(member, serviceId, { client_scan_id: SCAN, scan_token: token });
    const open = await svc().openServices(member);
    expect(open[0]).toMatchObject({ attended: true });
  });

  it("gives a leader the roster with registered contact details", async () => {
    await svc().checkIn(member, serviceId, {
      client_scan_id: SCAN,
      scan_token: token,
      full_name: "Grace W.",
      phone_number: "+254711999888",
    });
    const leader = await createUser({ congregationId: cong, role: "Instructor" });
    const roster = await svc().roster(principal(leader.user_id, cong, "Instructor"), serviceId);
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({ full_name: "Grace W.", phone_number: "+254711999888", method: "qr" });
  });

  it("creates a service and hands the leader a scannable payload", async () => {
    const leader = principal((await createUser({ congregationId: cong, role: "Instructor" })).user_id, cong, "Instructor");
    const created = await svc().createService(leader, {
      title: "Sunday First Service",
      service_date: "2026-03-01",
      starts_at: "2026-03-01T06:00:00.000Z",
      qr_enabled: true,
      counts_for_streak: true,
    });
    const qr = await svc().qrPayloadFor(leader, created.service_id);
    const parsed = parseServiceQrPayload(qr.payload);
    expect(parsed?.service_id).toBe(created.service_id);

    // The payload is genuinely scannable: it checks a member in.
    const res = await svc().checkIn(member, created.service_id, {
      client_scan_id: SCAN,
      scan_token: parsed!.scan_token,
    });
    expect(res.duplicate).toBe(false);
  });

  it("refuses a duplicate service slot", async () => {
    const leader = principal((await createUser({ congregationId: cong, role: "Instructor" })).user_id, cong, "Instructor");
    const input = {
      title: "Sunday First Service",
      service_date: "2026-03-01",
      starts_at: "2026-03-01T06:00:00.000Z",
      qr_enabled: true,
      counts_for_streak: true,
    };
    await svc().createService(leader, input);
    await expect(svc().createService(leader, input)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
