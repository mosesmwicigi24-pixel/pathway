// Shepherd's Pulse (intelligence Phase 2) — drift rules fire against the
// member's own baseline; emotion/crisis reads of consented writing create
// signals (crisis notifies carers); listing/ack are leader-scoped (§5.4);
// the weekly Flock Brief composes idempotently. All offline on the fake.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser, createEnrollment, createModule } from "./helpers/factories.js";
import { SignalsService } from "../src/modules/intelligence/signals.js";
import { StoryService } from "../src/modules/intelligence/story.js";
import { FakeAiProvider } from "../src/modules/assistant/provider.js";
import { NotificationService } from "../src/modules/notifications/service.js";
import { ProgressService } from "../src/modules/progress/service.js";
import type { Principal } from "../src/http/http.js";

const provider = new FakeAiProvider();
const svc = () =>
  new SignalsService(testPool(), provider, new StoryService(testPool(), provider), new NotificationService(testPool()));

let cong: string, cell: string, memberId: string, leaderId: string;
const leaderP = (): Principal => ({ userId: leaderId, role: "Instructor", congregationId: cong });

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  cell = await createCellGroup(cong, "Cell A");
  memberId = (await createUser({ congregationId: cong, cellGroupId: cell, email: "m@dev.local", fullName: "Mary Wanjiru" })).user_id;
  leaderId = (await createUser({ congregationId: cong, cellGroupId: cell, email: "l@dev.local", fullName: "Leader Levi" })).user_id;
  await testPool().query(`INSERT INTO leader_assignments (leader_user_id, cell_group_id) VALUES ($1, $2)`, [leaderId, cell]);
  await createEnrollment(memberId, 1);
});
afterAll(async () => {
  await closeTestPool();
});

async function daysOfActivity(userId: string, daysAgo: number[]): Promise<void> {
  for (const d of daysAgo) {
    await testPool().query(
      `INSERT INTO interaction_events (user_id, kind, occurred_at, client_event_id)
       VALUES ($1, 'word', now() - make_interval(days => $2), gen_random_uuid())`,
      [userId, d],
    );
  }
}

describe("drift rules", () => {
  it("flags a steady member who has gone quiet — idempotent per day", async () => {
    await daysOfActivity(memberId, [9, 11, 13, 15, 17, 19, 21, 24]); // steady before, silent last 7
    const first = await svc().scanDrift();
    expect(first.flagged).toBe(1);
    const again = await svc().scanDrift();
    expect(again.flagged).toBe(0); // UNIQUE(user, kind, day)

    const rows = await svc().listFor(leaderP());
    expect(rows.some((s) => s.kind === "drift_risk" && s.severity === "watch" && s.member_name === "Mary Wanjiru")).toBe(true);
  });

  it("does not flag a member who was never active", async () => {
    const out = await svc().scanDrift();
    expect(out.flagged).toBe(0);
  });
});

describe("emotion + crisis reads", () => {
  async function reflect(userId: string, body: string): Promise<void> {
    const moduleId = await createModule(1, 1);
    await new ProgressService(testPool()).completeModule(userId, moduleId, null);
    const prog = await testPool().query(`SELECT progress_id FROM module_progress ORDER BY completed_at DESC LIMIT 1`);
    await testPool().query(
      `INSERT INTO module_reflections (progress_id, user_id, module_id, body) VALUES ($1, $2, $3, $4)`,
      [prog.rows[0].progress_id, userId, moduleId, body],
    );
  }

  it("a weary reflection becomes a watch signal; crisis language escalates and notifies carers", async () => {
    await reflect(memberId, "I am so tired and weary this season, but I keep going.");
    const out1 = await svc().classifyRecent();
    expect(out1.flagged).toBe(1);
    expect(out1.crises).toBe(0);

    // Second member in the same cell writes crisis language. Insert the
    // progress row directly — this test is about signals, not §1.9 gating.
    const other = (await createUser({ congregationId: cong, cellGroupId: cell, email: "o@dev.local", fullName: "Otis Kip" })).user_id;
    await createEnrollment(other, 1);
    const mod2 = await createModule(1, 2);
    const prog2 = await testPool().query(
      `INSERT INTO module_progress (enrollment_id, module_id, is_completed, completed_at)
       SELECT e.enrollment_id, $2, TRUE, now() FROM enrollments e WHERE e.user_id = $1
       RETURNING progress_id`,
      [other, mod2],
    );
    await testPool().query(`INSERT INTO module_reflections (progress_id, user_id, module_id, body) VALUES ($1, $2, $3, $4)`, [
      prog2.rows[0].progress_id,
      other,
      mod2,
      "Honestly I feel there is no reason to live anymore.",
    ]);

    const out2 = await svc().classifyRecent();
    expect(out2.crises).toBe(1);

    const urgent = await testPool().query(`SELECT severity FROM signals WHERE user_id = $1 AND kind = 'crisis'`, [other]);
    expect(urgent.rows[0].severity).toBe("urgent");
    // The cell leader got a care flag (no content in the payload).
    const notif = await testPool().query(
      `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND template = 'member_care_flag'`,
      [leaderId],
    );
    expect(notif.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it("respects opt-out: no signals from an opted-out member's writing", async () => {
    await testPool().query(`UPDATE users SET ai_opt_out = TRUE WHERE user_id = $1`, [memberId]);
    await reflect(memberId, "I am so tired and weary.");
    const out = await svc().classifyRecent();
    expect(out.read).toBe(0);
  });
});

describe("leader scoping + ack", () => {
  it("a foreign instructor sees nothing; the cell leader can acknowledge", async () => {
    await daysOfActivity(memberId, [9, 11, 13, 15, 17, 19, 21, 24]);
    await svc().scanDrift();

    const stranger = (await createUser({ congregationId: cong, email: "s@dev.local", fullName: "Stranger Sam" })).user_id;
    const strangerRows = await svc().listFor({ userId: stranger, role: "Instructor", congregationId: cong });
    expect(strangerRows.length).toBe(0);

    const mine = await svc().listFor(leaderP());
    expect(mine.length).toBe(1);
    const acked = await svc().acknowledge(leaderP(), mine[0]!.signal_id);
    expect(acked.acknowledged_at).toBeTruthy();
    await expect(svc().acknowledge({ userId: stranger, role: "Instructor", congregationId: cong }, mine[0]!.signal_id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("draft outreach", () => {
  it("drafts a suggestion for the person behind a signal in the leader's flock", async () => {
    await daysOfActivity(memberId, [9, 11, 13, 15, 17, 19, 21, 24]);
    await svc().scanDrift();
    const mine = await svc().listFor(leaderP());
    expect(mine.length).toBe(1);

    const { suggestion } = await svc().draftOutreach(leaderP(), mine[0]!.signal_id);
    expect(typeof suggestion).toBe("string");
    expect(suggestion.length).toBeGreaterThan(0);
  });

  it("404s for a signal outside the leader's flock, and for a bogus id", async () => {
    await daysOfActivity(memberId, [9, 11, 13, 15, 17, 19, 21, 24]);
    await svc().scanDrift();
    const mine = await svc().listFor(leaderP());

    const stranger = (await createUser({ congregationId: cong, email: "s2@dev.local", fullName: "Stranger Two" })).user_id;
    await expect(
      svc().draftOutreach({ userId: stranger, role: "Instructor", congregationId: cong }, mine[0]!.signal_id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(svc().draftOutreach(leaderP(), "00000000-0000-4000-8000-000000000099")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("flock brief", () => {
  it("composes one brief per leader per week, idempotently", async () => {
    await new StoryService(testPool(), provider).rebuildFor(memberId); // brief pulls from stories
    const first = await svc().composeBriefs();
    expect(first.written).toBe(1);
    const again = await svc().composeBriefs();
    expect(again.written).toBe(0);

    const brief = await svc().myBrief(leaderId);
    expect(brief).toBeTruthy();
    expect(brief!.body.length).toBeGreaterThan(40);
  });
});
