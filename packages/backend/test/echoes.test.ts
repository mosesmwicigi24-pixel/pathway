// Echoes (companion Wave 1) — one moment per member per day, chosen by fixed
// priority from real history, AI-free, never repeated. "Specificity or
// silence": with nothing true to say, the endpoint says nothing.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
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
import { EchoesService } from "../src/modules/intelligence/echoes.js";

const svc = () => new EchoesService(testPool());

let cong: string, adaId: string, moduleId: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  const cell = await createCellGroup(cong, "Cell A");
  adaId = (await createUser({ congregationId: cong, cellGroupId: cell, email: "ada@dev.local", fullName: "Ada" })).user_id;
  await createEnrollment(adaId, 1);
  moduleId = await createModule(1, 1);
});
afterAll(async () => {
  await closeTestPool();
});

async function reflect(daysAgo: number, body: string): Promise<void> {
  await markContentConsumed(adaId, moduleId);
  await completeModule(adaId, moduleId);
  await testPool().query(
    `INSERT INTO module_reflections (progress_id, user_id, module_id, body, submitted_at)
     SELECT mp.progress_id, $1, $2, $3, now() - make_interval(days => $4)
       FROM module_progress mp JOIN enrollments e ON e.enrollment_id = mp.enrollment_id
      WHERE e.user_id = $1 AND mp.module_id = $2
     ON CONFLICT (progress_id) DO UPDATE SET body = EXCLUDED.body, submitted_at = EXCLUDED.submitted_at`,
    [adaId, moduleId, body, daysAgo],
  );
}

async function engaged(daysAgo: number): Promise<void> {
  await testPool().query(
    `INSERT INTO module_engagement (user_id, module_id, reading_seconds, updated_at)
     VALUES ($1, $2, 300, now() - make_interval(days => $3))
     ON CONFLICT (user_id, module_id) DO UPDATE SET updated_at = EXCLUDED.updated_at`,
    [adaId, moduleId, daysAgo],
  );
}

describe("echoes", () => {
  it("says nothing when nothing true and specific exists", async () => {
    expect(await svc().today(adaId)).toBeNull();
  });

  it("echoes a 7-day-old reflection verbatim, once ever, stable within the day", async () => {
    await reflect(7, "The Spirit is asking me to guard my speech this week and I want to obey Him fully.");
    const e = await svc().today(adaId);
    expect(e?.kind).toBe("reflection_echo");
    expect(e?.quote).toContain("guard my speech");
    expect(e?.body).toContain("Seven days ago");

    // Same day → same echo (logged, not recomputed).
    const again = await svc().today(adaId);
    expect(again?.quote).toBe(e?.quote);

    // A later day never repeats that reflection.
    await testPool().query(`UPDATE echo_log SET day_date = day_date - 1`);
    const next = await svc().today(adaId);
    expect(next).toBeNull();
  });

  it("welcome_back outranks a reflection echo after ≥4 quiet days", async () => {
    await reflect(7, "A reflection long enough to qualify for echoing back to me another day soon.");
    await engaged(5); // last activity 5 days ago
    const e = await svc().today(adaId);
    expect(e?.kind).toBe("welcome_back");
    expect(e?.body).toContain("You're back");
    expect(e?.ref).toContain("Psalm 103");
  });

  it("recent activity means no welcome_back (grace, not spam)", async () => {
    await engaged(1);
    const e = await svc().today(adaId);
    expect(e).toBeNull();
  });

  it("marks the month anniversary of a finished module", async () => {
    await markContentConsumed(adaId, moduleId);
    await completeModule(adaId, moduleId);
    await testPool().query(
      `UPDATE module_progress SET completed_at = now() - interval '30 days'`,
    );
    const e = await svc().today(adaId);
    expect(e?.kind).toBe("anniversary");
    expect(e?.body).toContain("One month ago today");
  });
});
