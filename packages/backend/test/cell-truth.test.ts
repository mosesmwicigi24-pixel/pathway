// The Your-Cell screen's truth layer (owner's ask, 2026-08-24): the summary
// speaks about the member's OWN cell (never the homepage-featured one), the
// rhythm is derived from a real series when one exists (exceptions-aware, so a
// cancelled meeting is never announced), the roster leads with faces, turnout
// is the cell's — not the caller's — and the leader alone sees who's been
// missing. Plus: the admin leader pick keeps leader_assignments in lockstep,
// which is the table every cell RBAC scope check reads.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser } from "./helpers/factories.js";
import { CalendarService } from "../src/modules/calendar/service.js";
import { AdminOpsService } from "../src/modules/adminops/service.js";
import type { Principal } from "../src/http/http.js";

const cal = () => new CalendarService(testPool());
const principal = (userId: string, role: Principal["role"], cong: string): Principal => ({ userId, role, congregationId: cong });

interface Summary {
  cell: {
    name: string;
    members: number;
    meets: string | null;
    rhythm_source: "series" | "static" | null;
    focus: string | null;
    room: string | null;
    next: { start_at: string; occurrence_id: string } | null;
    roster: { count: number; faces: Array<{ first_name: string; avatar_url: string | null }> };
    turnout: { rate: number; meetings: number; trend: string | null } | null;
    leader_view: { count: number; names: string[] } | null;
  } | null;
}

async function fixture(): Promise<{ cong: string; cell: string; member: string }> {
  const cong = await createCongregation();
  const cell = await createCellGroup(cong, "Junction");
  const u = await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Mary Member", email: "mary@dev.local" });
  return { cong, cell, member: u.user_id };
}

async function pastMeeting(cong: string, cell: string, id: string, daysAgo: number): Promise<void> {
  await testPool().query(
    `INSERT INTO events (event_id, congregation_id, cell_group_id, title, occurs_at, qr_secret)
     VALUES ($1, $2, $3, 'Cell meeting', now() - ($4 || ' days')::interval, 'secret')`,
    [id, cong, cell, String(daysAgo)],
  );
}

async function checkIn(user: string, eventId: string): Promise<void> {
  await testPool().query(`INSERT INTO attendance_logs (user_id, event_id) VALUES ($1, $2)`, [user, eventId]);
}

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPool();
});

describe("cell summary tells the truth about the member's OWN cell", () => {
  it("descriptive fields ride the summary; typed meets text is labeled static", async () => {
    const { cell, member } = await fixture();
    await testPool().query(
      `UPDATE cell_groups SET meets = 'Sunday 21 June 2026', focus = 'Church Members', room = 'Nuru Place' WHERE cell_group_id = $1`,
      [cell],
    );
    const s = (await cal().cellSummary(member)) as Summary;
    expect(s.cell!.focus).toBe("Church Members");
    expect(s.cell!.room).toBe("Nuru Place");
    expect(s.cell!.meets).toBe("Sunday 21 June 2026");
    expect(s.cell!.rhythm_source).toBe("static");
    expect(s.cell!.next).toBeNull();
    expect(s.cell!.turnout).toBeNull(); // never met → no invented number
  });

  it("a real series overrides the typed text, and a cancelled meeting is never announced", async () => {
    const { cong, cell, member } = await fixture();
    await testPool().query(`UPDATE cell_groups SET meets = 'stale typed text' WHERE cell_group_id = $1`, [cell]);
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "adm@dev.local" });
    const d = new Date();
    d.setDate(d.getDate() + 7);
    const pad = (n: number): string => String(n).padStart(2, "0");
    const dtstart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T14:00:00`;
    const created = (await cal().createSeries(principal(admin.user_id, "Admin", cong), CalendarService.CreateSeries.parse({
      cell_group_id: cell,
      title: "Junction weekly",
      location: "Upperroom",
      timezone: "Africa/Nairobi",
      dtstart_local: dtstart,
      duration_min: 90,
      rrule: "FREQ=WEEKLY;COUNT=8",
      visibility: "cell",
    }))) as { series_id: string };

    const s1 = (await cal().cellSummary(member)) as Summary;
    expect(s1.cell!.rhythm_source).toBe("series");
    expect(s1.cell!.meets).toMatch(/^[A-Z][a-z]+s · \d{1,2}:\d{2} [AP]M$/); // "Sundays · 2:00 PM"
    expect(s1.cell!.meets).not.toContain("stale");
    expect(s1.cell!.next).not.toBeNull();
    const firstStart = s1.cell!.next!.start_at;

    // Cancel the first occurrence: the summary must announce the SECOND one.
    await testPool().query(
      `INSERT INTO event_exceptions (series_id, original_start_at, is_cancelled) VALUES ($1, $2, true)`,
      [created.series_id, firstStart],
    );
    const s2 = (await cal().cellSummary(member)) as Summary;
    expect(s2.cell!.next).not.toBeNull();
    expect(new Date(s2.cell!.next!.start_at).getTime()).toBeGreaterThan(new Date(firstStart).getTime());
  });

  it("roster leads with faces: photos first, capped at 8, count = full membership", async () => {
    const { cong, cell, member } = await fixture();
    for (let i = 0; i < 9; i++) {
      const u = await createUser({ congregationId: cong, cellGroupId: cell, fullName: `Zed Member${i}`, email: `m${i}@dev.local` });
      if (i < 2) {
        await testPool().query(`UPDATE users SET avatar_url = 'https://img/' || $2 WHERE user_id = $1`, [u.user_id, String(i)]);
      }
    }
    const s = (await cal().cellSummary(member)) as Summary;
    expect(s.cell!.roster.count).toBe(10);
    expect(s.cell!.roster.faces).toHaveLength(8);
    expect(s.cell!.roster.faces[0]!.avatar_url).not.toBeNull();
    expect(s.cell!.roster.faces[1]!.avatar_url).not.toBeNull();
  });

  it("turnout is the CELL's share over recent meetings, not the caller's ratio", async () => {
    const { cong, cell, member } = await fixture();
    const b = await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Ben B", email: "b@dev.local" });
    const c = await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Cia C", email: "c@dev.local" });
    await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Dan D", email: "d@dev.local" });
    await pastMeeting(cong, cell, "evt-m1", 14);
    await pastMeeting(cong, cell, "evt-m2", 7);
    await checkIn(member, "evt-m1");
    await checkIn(b.user_id, "evt-m1");
    await checkIn(member, "evt-m2");
    await checkIn(b.user_id, "evt-m2");
    await checkIn(c.user_id, "evt-m2");
    const s = (await cal().cellSummary(member)) as Summary;
    // 4 members; meeting shares 2/4 and 3/4 → 0.625 → 0.63.
    expect(s.cell!.turnout).toEqual({ rate: 0.63, meetings: 2, trend: null });
  });

  it("the leader — and only the leader — sees who missed the last two gatherings", async () => {
    const { cong, cell, member } = await fixture();
    const leader = await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Jake Wealth", email: "jake@dev.local" });
    const missing = await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Amos Away", email: "amos@dev.local" });
    await testPool().query(`UPDATE cell_groups SET leader_user_id = $2 WHERE cell_group_id = $1`, [cell, leader.user_id]);
    await pastMeeting(cong, cell, "evt-l1", 10);
    await pastMeeting(cong, cell, "evt-l2", 3);
    await checkIn(member, "evt-l1");
    await checkIn(member, "evt-l2");
    await checkIn(leader.user_id, "evt-l1");
    await checkIn(leader.user_id, "evt-l2");
    void missing; // never checked in

    const leaderSees = (await cal().cellSummary(leader.user_id)) as Summary;
    expect(leaderSees.cell!.leader_view).not.toBeNull();
    expect(leaderSees.cell!.leader_view!.names).toContain("Amos");
    expect(leaderSees.cell!.leader_view!.names).not.toContain("Jake"); // never lists yourself
    expect(leaderSees.cell!.leader_view!.names).not.toContain("Mary");

    const memberSees = (await cal().cellSummary(member)) as Summary;
    expect(memberSees.cell!.leader_view).toBeNull();
  });
});

describe("admin leader pick syncs leader_assignments (the RBAC scope table)", () => {
  it("set, replace, and clear keep exactly the right rows", async () => {
    const cong = await createCongregation();
    const cell = await createCellGroup(cong, "Yukos");
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "adm2@dev.local" });
    const a = await createUser({ congregationId: cong, cellGroupId: cell, fullName: "First Leader", email: "fl@dev.local" });
    const b = await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Second Leader", email: "sl@dev.local" });
    const ops = new AdminOpsService(testPool(), testPool());

    await ops.updateCell(admin.user_id, cell, AdminOpsService.UpdateCell.parse({ leader_user_id: a.user_id }));
    const rows1 = await testPool().query(`SELECT leader_user_id FROM leader_assignments WHERE cell_group_id = $1`, [cell]);
    expect(rows1.rows).toEqual([{ leader_user_id: a.user_id }]);

    await ops.updateCell(admin.user_id, cell, AdminOpsService.UpdateCell.parse({ leader_user_id: b.user_id }));
    const rows2 = await testPool().query(`SELECT leader_user_id FROM leader_assignments WHERE cell_group_id = $1`, [cell]);
    expect(rows2.rows).toEqual([{ leader_user_id: b.user_id }]);

    await ops.updateCell(admin.user_id, cell, AdminOpsService.UpdateCell.parse({ leader_user_id: null }));
    const rows3 = await testPool().query(`SELECT count(*)::int AS n FROM leader_assignments WHERE cell_group_id = $1`, [cell]);
    expect(rows3.rows[0]).toEqual({ n: 0 });
    const cleared = await testPool().query(`SELECT leader_user_id FROM cell_groups WHERE cell_group_id = $1`, [cell]);
    expect(cleared.rows[0]).toEqual({ leader_user_id: null });
  });

  it("a leader from another congregation is refused", async () => {
    const cong = await createCongregation("Main");
    const other = await createCongregation("Elsewhere");
    const cell = await createCellGroup(cong, "Silanga");
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "adm3@dev.local" });
    const stranger = await createUser({ congregationId: other, fullName: "Far Away", email: "far@dev.local" });
    const ops = new AdminOpsService(testPool(), testPool());
    await expect(
      ops.updateCell(admin.user_id, cell, AdminOpsService.UpdateCell.parse({ leader_user_id: stranger.user_id })),
    ).rejects.toThrow(/active member/i);
  });
});
