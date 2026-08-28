// The cell roster — one payload, two truths (owner's ask, 2026-08-26).
// Everyone sees the PEOPLE; only the cell's shepherd sees score, risk band,
// attendance and last-seen. These tests pin the privacy split (the whole point
// of the design), the honest attendance window, and the empty-cell case.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser } from "./helpers/factories.js";
import { CalendarService } from "../src/modules/calendar/service.js";

const cal = () => new CalendarService(testPool());

interface Roster {
  cell: { cell_group_id: string; name: string } | null;
  can_shepherd: boolean;
  members: Array<{
    user_id: string;
    full_name: string;
    first_name: string;
    is_leader: boolean;
    is_me: boolean;
    score?: number | null;
    band?: string | null;
    attendance?: { present: number; of: number } | null;
    last_seen_days?: number | null;
  }>;
}

async function meeting(cong: string, cell: string, id: string, daysAgo: number): Promise<void> {
  await testPool().query(
    `INSERT INTO events (event_id, congregation_id, cell_group_id, title, occurs_at, qr_secret)
     VALUES ($1, $2, $3, 'Cell meeting', now() - ($4 || ' days')::interval, 's')`,
    [id, cong, cell, String(daysAgo)],
  );
}
const checkIn = (user: string, event: string): Promise<unknown> =>
  testPool().query(`INSERT INTO attendance_logs (user_id, event_id) VALUES ($1, $2)`, [user, event]);

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPool();
});

describe("the cell roster shows people to everyone, standing only to the shepherd", () => {
  it("a member sees names and faces — never a peer's score, band or attendance", async () => {
    const cong = await createCongregation();
    const cell = await createCellGroup(cong, "Junction");
    const leader = await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Jake Wealth", email: "j@dev.local" });
    const me = await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Mary Member", email: "m@dev.local" });
    await testPool().query(`UPDATE cell_groups SET leader_user_id = $2 WHERE cell_group_id = $1`, [cell, leader.user_id]);
    await testPool().query(
      `INSERT INTO engagement_scores (user_id, cell_group_id, h_score, c_score, a_score, e_score, band, window_end)
       VALUES ($1, $2, 0.5, 0.5, 0.5, 0.310, 'at_risk', CURRENT_DATE)`,
      [me.user_id, cell],
    );

    const r = (await cal().cellRoster(me.user_id)) as Roster;
    expect(r.can_shepherd).toBe(false);
    expect(r.cell!.name).toBe("Junction");
    expect(r.members).toHaveLength(2);
    const jake = r.members.find((m) => m.full_name === "Jake Wealth")!;
    expect(jake.is_leader).toBe(true);
    expect(jake.first_name).toBe("Jake");
    // The whole point: no pastoral standing reaches a peer.
    for (const m of r.members) {
      expect(m.score).toBeUndefined();
      expect(m.band).toBeUndefined();
      expect(m.attendance).toBeUndefined();
      expect(m.last_seen_days).toBeUndefined();
    }
  });

  it("the shepherd sees score, risk and attendance over the cell's real gatherings", async () => {
    const cong = await createCongregation();
    const cell = await createCellGroup(cong, "Junction");
    const leader = await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Jake Wealth", email: "j2@dev.local" });
    const faithful = await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Ann Present", email: "a@dev.local" });
    const absent = await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Ben Away", email: "b@dev.local" });
    await testPool().query(`UPDATE cell_groups SET leader_user_id = $2 WHERE cell_group_id = $1`, [cell, leader.user_id]);
    await testPool().query(
      `INSERT INTO engagement_scores (user_id, cell_group_id, h_score, c_score, a_score, e_score, band, window_end)
       VALUES ($1, $2, 0.8, 0.8, 0.8, 0.812, 'thriving', CURRENT_DATE)`,
      [faithful.user_id, cell],
    );
    await meeting(cong, cell, "evt-r1", 14);
    await meeting(cong, cell, "evt-r2", 7);
    await checkIn(faithful.user_id, "evt-r1");
    await checkIn(faithful.user_id, "evt-r2");

    const r = (await cal().cellRoster(leader.user_id)) as Roster;
    expect(r.can_shepherd).toBe(true);
    const ann = r.members.find((m) => m.full_name === "Ann Present")!;
    const ben = r.members.find((m) => m.full_name === "Ben Away")!;
    expect(ann.score).toBe(81);                       // 0.812 → a readable 0-100
    expect(ann.band).toBe("thriving");
    expect(ann.attendance).toEqual({ present: 2, of: 2 });
    expect(ben.attendance).toEqual({ present: 0, of: 2 });   // honest zero, real denominator
    expect(ben.score).toBeNull();                     // never scored yet — null, not 0
  });

  it("a cell that has never met reports no attendance rather than 0/0", async () => {
    const cong = await createCongregation();
    const cell = await createCellGroup(cong, "New Cell");
    const leader = await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Lead Er", email: "l@dev.local" });
    await testPool().query(`UPDATE cell_groups SET leader_user_id = $2 WHERE cell_group_id = $1`, [cell, leader.user_id]);
    const r = (await cal().cellRoster(leader.user_id)) as Roster;
    expect(r.members[0]!.attendance).toBeNull();
  });

  it("the leader is listed first, and the caller knows which row is their own", async () => {
    const cong = await createCongregation();
    const cell = await createCellGroup(cong, "Junction");
    const leader = await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Zoe Leader", email: "z@dev.local" });
    const me = await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Aaron Member", email: "aa@dev.local" });
    await testPool().query(`UPDATE cell_groups SET leader_user_id = $2 WHERE cell_group_id = $1`, [cell, leader.user_id]);
    const r = (await cal().cellRoster(me.user_id)) as Roster;
    expect(r.members[0]!.full_name).toBe("Zoe Leader");   // leader first, not alphabetical
    expect(r.members.find((m) => m.is_me)!.full_name).toBe("Aaron Member");
  });

  it("a member with no cell gets an empty roster, never someone else's", async () => {
    const cong = await createCongregation();
    const u = await createUser({ congregationId: cong, email: "none@dev.local" });
    const r = (await cal().cellRoster(u.user_id)) as Roster;
    expect(r.cell).toBeNull();
    expect(r.members).toEqual([]);
    expect(r.can_shepherd).toBe(false);
  });
});
