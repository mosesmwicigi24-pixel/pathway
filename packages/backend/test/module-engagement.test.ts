// Module engagement (mobile reader heartbeats) + server-authored pagination.
// Accumulating upsert with server-side delta caps (≤600s per heartbeat), last_page
// overwrite-when-provided, and the §1.9 gate: a member can never read or write
// engagement for content they cannot open. content_pages is derived from
// lesson_content on the <!-- page-break --> marker (trimmed, empties dropped,
// whole-body fallback) without ever mutating lesson_content itself.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import {
  createCongregation,
  createCellGroup,
  createUser,
  createEnrollment,
  createModule,
} from "./helpers/factories.js";
import { CurriculumService, splitContentPages } from "../src/modules/curriculum/service.js";
import { AdminCurriculumService } from "../src/modules/curriculum/admin.js";

const curriculum = () => new CurriculumService(testPool());

interface Totals {
  reading_seconds: number;
  audio_seconds: number;
  video_seconds: number;
  last_page: number;
}

describe("module engagement + server-authored pagination", () => {
  let userId: string;
  let l1m1: string, l1m2: string;

  beforeEach(async () => {
    await resetDb();
    const cong = await createCongregation();
    const cell = await createCellGroup(cong);
    userId = (await createUser({ congregationId: cong, cellGroupId: cell })).user_id;
    await createEnrollment(userId, 1);
    l1m1 = await createModule(1, 1); // universal entry point — always open
    l1m2 = await createModule(1, 2); // locked until m1 is completed/passed
  });

  afterAll(async () => {
    await closeTestPool();
  });

  // ---------- engagement upsert ----------

  it("GET before any heartbeat returns zeros and page 1", async () => {
    const t = (await curriculum().getEngagement(userId, l1m1)) as Totals;
    expect(t).toEqual({ reading_seconds: 0, audio_seconds: 0, video_seconds: 0, last_page: 1 });
  });

  it("heartbeats accumulate: totals grow by the deltas across posts", async () => {
    const first = (await curriculum().recordEngagement(userId, l1m1, {
      reading_seconds: 120,
      audio_seconds: 30,
    })) as Totals;
    expect(first).toEqual({ reading_seconds: 120, audio_seconds: 30, video_seconds: 0, last_page: 1 });

    const second = (await curriculum().recordEngagement(userId, l1m1, {
      reading_seconds: 45,
      video_seconds: 60,
      last_page: 3,
    })) as Totals;
    expect(second).toEqual({ reading_seconds: 165, audio_seconds: 30, video_seconds: 60, last_page: 3 });

    const read = (await curriculum().getEngagement(userId, l1m1)) as Totals;
    expect(read).toEqual(second);
  });

  it("server-side cap: a single heartbeat can never claim more than 600s per channel", async () => {
    // Bypasses the route-level zod bound on purpose — the service clamps too.
    const t = (await curriculum().recordEngagement(userId, l1m1, {
      reading_seconds: 9999,
      audio_seconds: 601,
      video_seconds: -5 as number,
    })) as Totals;
    expect(t.reading_seconds).toBe(600);
    expect(t.audio_seconds).toBe(600);
    expect(t.video_seconds).toBe(0); // negative deltas clamp to 0, never subtract
  });

  it("the wire contract also rejects out-of-range deltas (zod, fixed for iOS)", () => {
    expect(CurriculumService.EngagementSchema.safeParse({ reading_seconds: 601 }).success).toBe(false);
    expect(CurriculumService.EngagementSchema.safeParse({ last_page: 0 }).success).toBe(false);
    expect(CurriculumService.EngagementSchema.safeParse({}).success).toBe(true); // all optional
  });

  it("last_page overwrites when provided and persists when omitted", async () => {
    await curriculum().recordEngagement(userId, l1m1, { reading_seconds: 10, last_page: 5 });
    const t = (await curriculum().recordEngagement(userId, l1m1, { reading_seconds: 10 })) as Totals;
    expect(t.last_page).toBe(5); // omitted → untouched
    const t2 = (await curriculum().recordEngagement(userId, l1m1, { last_page: 2 })) as Totals;
    expect(t2.last_page).toBe(2); // provided → overwritten (going back is fine)
  });

  it("404 on an unknown module (read and write)", async () => {
    const ghost = "00000000-0000-4000-8000-000000000000";
    await expect(curriculum().recordEngagement(userId, ghost, { reading_seconds: 10 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(curriculum().getEngagement(userId, ghost)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("HARD LOCK (§1.9): a gated member cannot write or read engagement for a locked module", async () => {
    await expect(curriculum().recordEngagement(userId, l1m2, { reading_seconds: 30 })).rejects.toMatchObject({
      code: "GATE_LOCKED",
    });
    await expect(curriculum().getEngagement(userId, l1m2)).rejects.toMatchObject({ code: "GATE_LOCKED" });
    const { rows } = await testPool().query(`SELECT count(*)::int n FROM module_engagement WHERE user_id = $1`, [
      userId,
    ]);
    expect(rows[0].n).toBe(0); // nothing leaked through the gate
  });

  it("non-published modules are invisible to engagement (404, like getModule)", async () => {
    const draft = await createModule(1, 3, { published: false });
    await expect(curriculum().recordEngagement(userId, draft, { reading_seconds: 10 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  // ---------- server-authored pagination (content_pages) ----------

  it("splitContentPages splits on the marker (whitespace-tolerant), trims, drops empties", () => {
    expect(splitContentPages("One\n\n<!-- page-break -->\n\nTwo\n<!--page-break-->Three")).toEqual([
      "One",
      "Two",
      "Three",
    ]);
    expect(splitContentPages("A<!--   page-break   -->B<!-- page-break --><!-- page-break -->")).toEqual(["A", "B"]);
  });

  it("splitContentPages falls back to the whole body when no markers", () => {
    expect(splitContentPages("Just one page")).toEqual(["Just one page"]);
  });

  it("member getModule returns content_pages without changing lesson_content", async () => {
    const body = "Intro text\n\n<!-- page-break -->\n\nDeeper truth\n\n<!--  page-break  -->\n\nClosing";
    await testPool().query(`UPDATE modules SET lesson_content = $1 WHERE module_id = $2`, [body, l1m1]);
    const mod = (await curriculum().getModule(userId, l1m1)) as { lesson_content: string; content_pages: string[] };
    expect(mod.lesson_content).toBe(body); // untouched — backwards compatible
    expect(mod.content_pages).toEqual(["Intro text", "Deeper truth", "Closing"]);
  });

  it("member getModule without markers yields a single page (fallback)", async () => {
    const mod = (await curriculum().getModule(userId, l1m1)) as { lesson_content: string; content_pages: string[] };
    expect(mod.content_pages).toEqual([mod.lesson_content]);
  });

  it("ADMIN getModule carries the same derived content_pages (portal preview)", async () => {
    const body = "Page A\n\n<!-- page-break -->\n\nPage B";
    await testPool().query(`UPDATE modules SET lesson_content = $1 WHERE module_id = $2`, [body, l1m2]);
    const admin = new AdminCurriculumService(testPool());
    const mod = (await admin.getModule(l1m2)) as { lesson_content: string; content_pages: string[] };
    expect(mod.lesson_content).toBe(body);
    expect(mod.content_pages).toEqual(["Page A", "Page B"]);
  });
});
