// Discipleship Hub — the read-aggregation composition layer (student Hub + discipler
// roster/dossier). Drives DiscipleshipService directly (like the engagement test),
// asserting the frozen wire shapes and the two authority axes (relationship_tree
// edges + leader_assignments cell scope).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import {
  createCongregation,
  createCellGroup,
  createUser,
  createEnrollment,
  createModule,
  createLeaderAssignment,
  createRelationship,
  createPendingLevelAdvancement,
  completeModule,
  markReflected,
  setCellLeader,
  addInteractionDays,
} from "./helpers/factories.js";
import { DiscipleshipService } from "../src/modules/discipleship/service.js";
import type { Principal } from "../src/http/http.js";
import { ApiError } from "../src/http/errors.js";

const svc = () => new DiscipleshipService(testPool());
const principal = (userId: string, role: Principal["role"]): Principal => ({
  userId,
  role,
  congregationId: "c",
});

/** Insert an existing 1:1 DM between two users (read-only findDm target). */
async function makeDm(a: string, b: string): Promise<string> {
  const { rows } = await testPool().query<{ conversation_id: string }>(
    `INSERT INTO chat_conversations (conversation_id, kind) VALUES (gen_random_uuid(), 'dm')
     RETURNING conversation_id`,
  );
  const cid = rows[0]!.conversation_id;
  await testPool().query(
    `INSERT INTO chat_members (conversation_id, user_id) VALUES ($1,$2),($1,$3)`,
    [cid, a, b],
  );
  return cid;
}

describe("Discipleship Hub", () => {
  let cong: string, cell: string;

  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation();
    cell = await createCellGroup(cong);
  });
  afterAll(async () => {
    await closeTestPool();
  });

  describe("GET /me/discipleship (student self)", () => {
    it("resolves the discipler via the cell leader and returns the Hub shape", async () => {
      const leader = (await createUser({ congregationId: cong, role: "Instructor", fullName: "Cell Lead" })).user_id;
      await setCellLeader(cell, leader);
      const student = (await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Amara" })).user_id;
      await createEnrollment(student, 2);

      // A level-2 curriculum: 2 published modules, one completed.
      const m1 = await createModule(2, 1, { title: "L2 M1" });
      await createModule(2, 2, { title: "L2 M2" });
      await completeModule(student, m1);

      const hub = await svc().myHub(student);

      expect(hub.discipler).not.toBeNull();
      expect(hub.discipler!.user_id).toBe(leader);
      expect(hub.discipler!.role_label).toBe("Cell Leader");
      expect(hub.can_message).toBe(true);
      expect(hub.dm_conversation_id).toBeNull(); // no DM created in a GET
      expect(hub.progression.current_level).toBe(2);
      expect(hub.progression.level_title).toBeTruthy();
      expect(hub.progression.modules_total).toBe(2);
      expect(hub.progression.modules_completed).toBe(1);
      expect(hub.progression.awaiting_review).toBe(false);
      expect(hub.progression.awaiting_level).toBeNull();
      // scores object: every domain key present (int or null).
      for (const k of ["overall", "word", "prayer", "habits", "curriculum", "attendance"]) {
        expect(hub.scores).toHaveProperty(k);
      }
      expect(hub.next_meeting_at).toBeNull();
      expect(Array.isArray(hub.notes)).toBe(true);
    });

    it("resolves the discipler via an explicit relationship_tree edge (role_label Discipler)", async () => {
      const multiplier = (await createUser({ congregationId: cong, role: "Instructor", fullName: "Multi" })).user_id;
      const student = (await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Bola" })).user_id;
      await createEnrollment(student, 1);
      await createRelationship(multiplier, student);

      const hub = await svc().myHub(student);
      expect(hub.discipler!.user_id).toBe(multiplier);
      expect(hub.discipler!.role_label).toBe("Discipler");
      expect(hub.discipler!.established_at).toBeTruthy();
    });

    it("surfaces an existing DM but never exposes pastoral_note; feedback_notes only", async () => {
      const leader = (await createUser({ congregationId: cong, role: "Instructor" })).user_id;
      await setCellLeader(cell, leader);
      const student = (await createUser({ congregationId: cong, cellGroupId: cell })).user_id;
      await createEnrollment(student, 1);
      const cid = await makeDm(student, leader);

      const mod = await createModule(1, 1, { title: "Foundations" });
      await markReflected(student, mod);
      // Reviewer sets a member-visible feedback note AND an internal pastoral note.
      await testPool().query(
        `UPDATE module_reflections SET state='returned', feedback_notes='Please expand paragraph 2', pastoral_note='SECRET internal note'
           WHERE user_id=$1`,
        [student],
      );

      const hub = await svc().myHub(student);
      expect(hub.dm_conversation_id).toBe(cid);
      expect(hub.reflections.length).toBe(1);
      expect(hub.reflections[0]!.feedback_notes).toBe("Please expand paragraph 2");
      expect(JSON.stringify(hub.reflections[0])).not.toContain("pastoral_note");
      expect(JSON.stringify(hub.reflections[0])).not.toContain("SECRET");
    });

    it("can_message is false for a minor", async () => {
      const leader = (await createUser({ congregationId: cong, role: "Instructor" })).user_id;
      await setCellLeader(cell, leader);
      const minor = await createUser({
        congregationId: cong,
        cellGroupId: cell,
        fullName: "Teen",
        dateOfBirth: "2015-01-01",
      });
      expect(minor.is_minor).toBe(true);
      await createEnrollment(minor.user_id, 1);

      const hub = await svc().myHub(minor.user_id);
      expect(hub.can_message).toBe(false);
    });

    it("awaiting_review/awaiting_level reflect a pending level advancement", async () => {
      const student = (await createUser({ congregationId: cong, cellGroupId: cell })).user_id;
      await createEnrollment(student, 2);
      await createPendingLevelAdvancement(student, 2);

      const hub = await svc().myHub(student);
      expect(hub.progression.awaiting_review).toBe(true);
      expect(hub.progression.awaiting_level).toBe(2);
    });
  });

  describe("GET /disciples (roster, scoped)", () => {
    it("includes only the leader's own students (cell scope), not others", async () => {
      const leader = (await createUser({ congregationId: cong, role: "Instructor" })).user_id;
      await createLeaderAssignment(leader, cell);
      const mine = (await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Mine" })).user_id;
      await createEnrollment(mine, 1);

      // A student in a DIFFERENT cell the leader does not lead.
      const otherCell = await createCellGroup(cong, "Cell B");
      const notMine = (await createUser({ congregationId: cong, cellGroupId: otherCell, fullName: "NotMine" })).user_id;
      await createEnrollment(notMine, 1);

      const { data, summary } = await svc().roster(principal(leader, "Instructor"));
      const ids = data.map((r) => r.user_id);
      expect(ids).toContain(mine);
      expect(ids).not.toContain(notMine);
      expect(summary.total_students).toBe(1);
    });

    it("also includes relationship_tree disciples outside the leader's cells", async () => {
      const leader = (await createUser({ congregationId: cong, role: "Instructor" })).user_id;
      const otherCell = await createCellGroup(cong, "Cell C");
      const edgeStudent = (await createUser({ congregationId: cong, cellGroupId: otherCell, fullName: "Edge" })).user_id;
      await createEnrollment(edgeStudent, 1);
      await createRelationship(leader, edgeStudent);

      const { data } = await svc().roster(principal(leader, "Instructor"));
      expect(data.map((r) => r.user_id)).toContain(edgeStudent);
    });

    it("summary.awaiting_action counts students with pending reflections OR pending level advancements", async () => {
      const leader = (await createUser({ congregationId: cong, role: "Instructor" })).user_id;
      await createLeaderAssignment(leader, cell);

      const a = (await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Aa" })).user_id;
      await createEnrollment(a, 1);
      const modA = await createModule(1, 1, { title: "L1 M1" });
      await markReflected(a, modA); // defaults to state 'pending'

      const b = (await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Bb" })).user_id;
      await createEnrollment(b, 2);
      await createPendingLevelAdvancement(b, 2);

      const c = (await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Cc" })).user_id;
      await createEnrollment(c, 1); // nothing pending

      const { data, summary } = await svc().roster(principal(leader, "Instructor"));
      expect(summary.total_students).toBe(3);
      expect(summary.awaiting_action).toBe(2);
      // Action-needed students sort ahead of the quiet one.
      expect(data[data.length - 1]!.user_id).toBe(c);
      const rowB = data.find((r) => r.user_id === b)!;
      expect(rowB.awaiting_level).toBe(2);
      const rowA = data.find((r) => r.user_id === a)!;
      expect(rowA.pending_reflections).toBe(1);
    });
  });

  describe("GET /disciples/:id (dossier, scoped)", () => {
    it("returns 403 FORBIDDEN_SCOPE for an out-of-scope student", async () => {
      const leader = (await createUser({ congregationId: cong, role: "Instructor" })).user_id;
      await createLeaderAssignment(leader, cell); // leads `cell`, but not otherCell
      const otherCell = await createCellGroup(cong, "Cell D");
      const stranger = (await createUser({ congregationId: cong, cellGroupId: otherCell })).user_id;
      await createEnrollment(stranger, 1);

      await expect(svc().dossier(principal(leader, "Instructor"), stranger)).rejects.toMatchObject({
        code: "FORBIDDEN_SCOPE",
      });
      await expect(svc().dossier(principal(leader, "Instructor"), stranger)).rejects.toBeInstanceOf(ApiError);
    });

    it("returns the full journey incl. reflection BODIES for an in-scope student", async () => {
      const leader = (await createUser({ congregationId: cong, role: "Instructor" })).user_id;
      await createLeaderAssignment(leader, cell);
      const student = (await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Dara" })).user_id;
      await createEnrollment(student, 1);
      const mod = await createModule(1, 1, { title: "Roots" });
      await markReflected(student, mod, "My honest pastoral reflection body.");
      await addInteractionDays(student, 3);

      const dossier = (await svc().dossier(principal(leader, "Instructor"), student)) as {
        member: Record<string, unknown>;
        progression: Record<string, unknown>;
        scores: Record<string, unknown>;
        engagement: Record<string, unknown>;
        reflections: Array<Record<string, unknown>>;
        recent_activity: Array<Record<string, unknown>>;
        dm_conversation_id: string | null;
      };

      expect(dossier.member.user_id).toBe(student);
      expect(dossier.member.joined_at).toBeTruthy();
      expect(dossier.progression.current_level).toBe(1);
      expect(dossier.reflections.length).toBe(1);
      expect(dossier.reflections[0]!.body).toBe("My honest pastoral reflection body.");
      expect(dossier.reflections[0]).toHaveProperty("module_title", "Roots");
      expect(dossier.recent_activity.length).toBeGreaterThan(0);
      expect(dossier.engagement).toHaveProperty("days_since_last_activity");
      expect(dossier.dm_conversation_id).toBeNull();
    });

    it("Admin may view any student (unrestricted scope)", async () => {
      const admin = (await createUser({ congregationId: cong, role: "Admin" })).user_id;
      const student = (await createUser({ congregationId: cong, cellGroupId: cell })).user_id;
      await createEnrollment(student, 1);
      const dossier = (await svc().dossier(principal(admin, "Admin"), student)) as { member: { user_id: string } };
      expect(dossier.member.user_id).toBe(student);
    });
  });
});
