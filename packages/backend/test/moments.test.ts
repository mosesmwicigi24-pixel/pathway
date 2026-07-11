// Community intelligence (Phase 4) — the moments detector is idempotent and
// deterministic (no AI); blessings are one-per-member with congregation scope;
// prayer chains invite ≤3 covenant pray-ers exactly once per post.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import {
  createCongregation,
  createCellGroup,
  createUser,
  createEnrollment,
  createModule,
  markContentConsumed,
  completeModule,
} from "./helpers/factories.js";
import { CommunityService } from "../src/modules/intelligence/community.js";
import { NotificationService } from "../src/modules/notifications/service.js";

const svc = () => new CommunityService(testPool(), new NotificationService(testPool()));

let cong: string, cellA: string, adaId: string, benId: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  cellA = await createCellGroup(cong, "Cell A");
  adaId = (await createUser({ congregationId: cong, cellGroupId: cellA, email: "ada@dev.local", fullName: "Ada Grace" })).user_id;
  benId = (await createUser({ congregationId: cong, cellGroupId: cellA, email: "ben@dev.local", fullName: "Ben Kip" })).user_id;
});
afterAll(async () => {
  await closeTestPool();
});

describe("moments detector", () => {
  it("detects module/verse/plan/level milestones once, idempotently", async () => {
    // Module completion (Ada)
    await createEnrollment(adaId, 1);
    const moduleId = await createModule(1, 1);
    await markContentConsumed(adaId, moduleId);
    await completeModule(adaId, moduleId);
    // Verse mastered (Ada)
    const v = await testPool().query(
      `INSERT INTO memory_verses (reference, verse_text) VALUES ('John 3:16', 'For God so loved') RETURNING memory_verse_id`,
    );
    await testPool().query(
      `INSERT INTO memory_verse_progress (user_id, memory_verse_id, status, best_match_pct) VALUES ($1, $2, 'mastered', 100)`,
      [adaId, v.rows[0].memory_verse_id],
    );
    // Plan finished (Ben)
    const p = await testPool().query(
      `INSERT INTO reading_plans (code, title, day_count) VALUES ('rooted', 'Rooted', 5) RETURNING plan_id`,
    );
    await testPool().query(
      `INSERT INTO reading_plan_progress (user_id, plan_id, current_day, completed_days, completed_at)
       VALUES ($1, $2, 5, '{1,2,3,4,5}', now())`,
      [benId, p.rows[0].plan_id],
    );
    // Level certificate (Ben)
    await testPool().query(
      `INSERT INTO certificates (user_id, level_number, verification_code, pdf_object_key, content_hash, signature)
       VALUES ($1, 1, 'VC-TEST-0001', 'certs/x.pdf', 'hash', 'sig')`,
      [benId],
    );

    const first = await svc().scanMoments();
    expect(first).toBe(4);
    const again = await svc().scanMoments();
    expect(again).toBe(0); // replay-safe

    const feed = await svc().list(adaId);
    expect(feed.length).toBe(4);
    const titles = feed.map((m) => m.title).join(" | ");
    expect(titles).toContain("Completed Level 1");
    expect(titles).toContain("John 3:16");
    expect(titles).toContain("Rooted");
  });
});

describe("blessings", () => {
  let momentId: string;
  beforeEach(async () => {
    const m = await testPool().query(
      `INSERT INTO community_moments (user_id, congregation_id, kind, ref_id, title, occurred_at)
       VALUES ($1, $2, 'module_complete', $3, 'Finished "Prayer"', now()) RETURNING moment_id`,
      [adaId, cong, randomUUID()],
    );
    momentId = m.rows[0].moment_id;
  });

  it("one blessing per member; switching kind updates; first bless notifies the celebrated", async () => {
    await svc().bless(benId, momentId, "amen");
    await svc().bless(benId, momentId, "fire"); // switch, not a second row

    const feed = await svc().list(benId);
    const mine = feed.find((m) => m.moment_id === momentId)!;
    expect(mine.fire_count).toBe(1);
    expect(mine.amen_count).toBe(0);
    expect(mine.my_blessing).toBe("fire");

    const notes = await testPool().query(
      `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND template = 'community_blessing'`,
      [adaId],
    );
    expect(notes.rows[0].n).toBe(1); // only the first bless notified
  });

  it("refuses a blessing from outside the congregation", async () => {
    const otherCong = await createCongregation("Other Branch");
    const stranger = (await createUser({ congregationId: otherCong, email: "x@dev.local", fullName: "Stranger" })).user_id;
    await expect(svc().bless(stranger, momentId, "amen")).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
  });
});

describe("prayer chains", () => {
  it("invites up to 3 congregation members (cell-mates first), exactly once", async () => {
    const cellB = await createCellGroup(cong, "Cell B");
    const c1 = (await createUser({ congregationId: cong, cellGroupId: cellA, email: "c1@dev.local", fullName: "C One" })).user_id;
    await createUser({ congregationId: cong, cellGroupId: cellB, email: "c2@dev.local", fullName: "C Two" });
    await createUser({ congregationId: cong, cellGroupId: cellB, email: "c3@dev.local", fullName: "C Three" });
    const otherCong = await createCongregation("Far Branch");
    await createUser({ congregationId: otherCong, email: "far@dev.local", fullName: "Far Away" });

    await testPool().query(
      `INSERT INTO prayer_wall_posts (post_id, author_user_id, congregation_id, body)
       VALUES ($1, $2, $3, 'Please stand with my family this week')`,
      [randomUUID(), adaId, cong],
    );

    const first = await svc().scanPrayerChains();
    expect(first).toBe(3);
    const again = await svc().scanPrayerChains();
    expect(again).toBe(0); // nobody nudged twice

    const nudged = await testPool().query(
      `SELECT n.user_id FROM prayer_nudges n JOIN prayer_wall_posts p ON p.post_id = n.post_id`,
    );
    const ids = nudged.rows.map((r) => String(r.user_id));
    expect(ids).toHaveLength(3);
    expect(ids).not.toContain(adaId); // never the author
    expect(ids).toContain(benId); // cell-mates ranked first
    expect(ids).toContain(c1);

    const notes = await testPool().query(
      `SELECT count(*)::int AS n FROM notifications WHERE template = 'prayer_chain'`,
    );
    expect(notes.rows[0].n).toBe(3);
  });
});
