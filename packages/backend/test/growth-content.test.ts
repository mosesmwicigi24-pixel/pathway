// Growth content (Contract Matrix D5): devotionals, memory verses + mastery,
// reading plans + day progress, resources, mentor. Content is shared; progress
// is per-member and idempotent.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";

let cong: string, me: string, meTok: string, mentor: string;
const auth = (t: string) => ({ Authorization: t });

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  const a = await createUser({ congregationId: cong, email: "me@dev.local" });
  const b = await createUser({ congregationId: cong, role: "Instructor", email: "mentor@dev.local", fullName: "Pastor James" });
  me = a.user_id;
  mentor = b.user_id;
  meTok = bearer({ sub: me, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

describe("devotional + resources (seeded content)", () => {
  it("serves today's devotional and the resource library", async () => {
    const dev = await agent().get("/v1/growth/devotional").set(auth(meTok));
    expect(dev.status).toBe(200);
    expect(dev.body.title).toBeTruthy();
    expect(dev.body.scripture_ref).toBeTruthy();

    const res = await agent().get("/v1/growth/resources").set(auth(meTok));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toHaveProperty("kind");
  });
});

describe("Word score", () => {
  it("is 0 with no activity, rises with practice, and ticks the word rhythm", async () => {
    const list = await agent().get("/v1/growth/memory-verses").set(auth(meTok));
    const vid = (list.body.data as Array<{ memory_verse_id: string }>)[0]!.memory_verse_id;

    const before = await agent().get("/v1/me/scores/word").set(auth(meTok));
    expect(before.status).toBe(200);
    expect(before.body.score).toBe(0);
    expect(before.body.band).toBe("Just beginning");

    await agent().post("/v1/growth/memory-verses/practice").set(auth(meTok)).send({ memory_verse_id: vid, match_pct: 96 });

    const after = await agent().get("/v1/me/scores/word").set(auth(meTok));
    expect(after.body.score).toBeGreaterThan(0);
    expect(after.body.components).toHaveProperty("memorization");
    expect(after.body.detail.verses_mastered).toBe(1);
    expect(after.body.detail.active_days).toBeGreaterThanOrEqual(1); // practice emitted a 'word' event (28d window)

    // practising Scripture now ticks the daily "word" rhythm
    const rhythm = await agent().get("/v1/me/rhythm/today").set(auth(meTok));
    expect(rhythm.body.word).toBe(true);
  });
});

describe("Home disciplers carousel", () => {
  async function tagDiscipler(userId: string, message?: string, avatar?: string): Promise<void> {
    await testPool().query(
      `INSERT INTO rbac_roles (role_key, name, role_type) VALUES ('discipler','Discipler (Cell Leader)','field')
       ON CONFLICT (role_key) DO NOTHING`,
    );
    await testPool().query(
      `INSERT INTO rbac_user_roles (user_id, role_key, assigned_by) VALUES ($1,'discipler',$1) ON CONFLICT DO NOTHING`,
      [userId],
    );
    if (message !== undefined || avatar !== undefined) {
      await testPool().query(`UPDATE users SET discipler_message = $2, avatar_url = $3 WHERE user_id = $1`, [
        userId,
        message ?? null,
        avatar ?? null,
      ]);
    }
  }

  it("lists disciplers in my congregation with name, message and photo", async () => {
    await tagDiscipler(mentor, "Walking with you on the journey.", "https://example.com/p.jpg");
    const res = await agent().get("/v1/home/disciplers").set(auth(meTok));
    expect(res.status).toBe(200);
    const list = res.body.data as Array<{
      user_id: string;
      full_name: string;
      message: string | null;
      avatar_url: string | null;
      role_label: string;
    }>;
    const d = list.find((x) => x.user_id === mentor);
    expect(d).toBeTruthy();
    expect(d!.full_name).toBe("Pastor James");
    expect(d!.message).toBe("Walking with you on the journey.");
    expect(d!.avatar_url).toBe("https://example.com/p.jpg");
    expect(d!.role_label).toBe("Discipler");
  });

  it("does not leak disciplers from other congregations", async () => {
    const other = await createCongregation("Other Branch");
    const o = await createUser({ congregationId: other, email: "other@dev.local", fullName: "Other Leader" });
    await tagDiscipler(o.user_id);
    const res = await agent().get("/v1/home/disciplers").set(auth(meTok));
    expect(res.status).toBe(200);
    expect((res.body.data as Array<{ user_id: string }>).some((x) => x.user_id === o.user_id)).toBe(false);
  });
});

describe("memory verses + mastery", () => {
  it("lists verses learning by default and masters at ≥90% match", async () => {
    const list = await agent().get("/v1/growth/memory-verses").set(auth(meTok));
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    expect(list.body.data.every((v: { status: string }) => v.status === "learning")).toBe(true);
    const id = list.body.data[0].memory_verse_id;

    // A weak attempt stays "learning"; a strong one masters; best is kept.
    await agent().post("/v1/growth/memory-verses/practice").set(auth(meTok)).send({ memory_verse_id: id, match_pct: 60 });
    const strong = await agent().post("/v1/growth/memory-verses/practice").set(auth(meTok)).send({ memory_verse_id: id, match_pct: 95 });
    expect(strong.body.status).toBe("mastered");

    const weakerReplay = await agent().post("/v1/growth/memory-verses/practice").set(auth(meTok)).send({ memory_verse_id: id, match_pct: 20 });
    expect(weakerReplay.body.status).toBe("mastered"); // best_match_pct kept; never demoted
    expect(weakerReplay.body.best_match_pct).toBe(95);

    const after = await agent().get("/v1/growth/memory-verses").set(auth(meTok));
    expect(after.body.data.find((v: { memory_verse_id: string }) => v.memory_verse_id === id).status).toBe("mastered");
  });
});

describe("reading plans + day progress", () => {
  it("starts a plan and advances current_day as days are completed", async () => {
    const plans = await agent().get("/v1/growth/plans").set(auth(meTok));
    expect(plans.status).toBe(200);
    const john = plans.body.data.find((p: { code: string }) => p.code === "gospel-of-john");
    expect(john.enrolled).toBe(false);

    const start = await agent().post(`/v1/growth/plans/${john.plan_id}/start`).set(auth(meTok));
    expect(start.status).toBe(201);
    expect(start.body.current_day).toBe(1);

    const detail = await agent().get(`/v1/growth/plans/${john.plan_id}`).set(auth(meTok));
    expect(detail.body.enrolled).toBe(true);
    expect(detail.body.days.length).toBeGreaterThan(0);
    expect(detail.body.days[0].reference).toBeTruthy();

    const d1 = await agent().post(`/v1/growth/plans/${john.plan_id}/complete-day`).set(auth(meTok)).send({ day_number: 1 });
    expect(d1.body.current_day).toBe(2);
    expect(d1.body.completed_days).toContain(1);

    // Idempotent re-complete: no duplicate day, no regression.
    const d1again = await agent().post(`/v1/growth/plans/${john.plan_id}/complete-day`).set(auth(meTok)).send({ day_number: 1 });
    expect(d1again.body.completed_days).toEqual([1]);
    expect(d1again.body.current_day).toBe(2);
  });

  it("serves the curated 10-day Psalms plan with segments ordered Watch → Reading → Devotional → Talk", async () => {
    const plans = await agent().get("/v1/growth/plans").set(auth(meTok));
    const rooted = plans.body.data.find((p: { code: string }) => p.code === "rooted-psalms-10");
    expect(rooted).toBeTruthy();
    expect(rooted.day_count).toBe(10);

    const detail = await agent().get(`/v1/growth/plans/${rooted.plan_id}`).set(auth(meTok));
    expect(detail.body.days.length).toBe(10);
    const segs = detail.body.days[0].segments as Array<{ kind: string; sort: number; video_url: string | null }>;
    expect(segs.map((s) => s.kind)).toEqual(["video", "scripture", "devotional", "talk"]);
    expect(segs[0].video_url).toBeTruthy(); // the Watch segment has a video

    // Completing a Scripture segment records a 'word'-family activity (feeds the Word score).
    const reading = segs.find((s) => s.kind === "scripture")!;
    const before = await agent().get("/v1/me/scores/word").set(auth(meTok));
    await agent().post(`/v1/growth/segments/${(detail.body.days[0].segments.find((s: { kind: string; segment_id: string }) => s.kind === "scripture")).segment_id}/complete`).set(auth(meTok));
    const after = await agent().get("/v1/me/scores/word").set(auth(meTok));
    expect(after.body.score).toBeGreaterThanOrEqual(before.body.score);
    expect(reading.kind).toBe("scripture");
  });
});

/** The plan is walked, not skimmed. A day is finished when its PARTS are
 *  finished (server-decided, §1.1), and day N only opens once 1..N-1 are behind
 *  it. These are the invariants whose absence let a day be sealed showing
 *  "0 of 3 parts read". */
describe("reading plans — a day is earned, and the days are walked in order", () => {
  interface Seg { segment_id: string; kind: string; completed: boolean; content: string | null; video_url: string | null }
  interface Day { day_number: number; completed: boolean; locked: boolean; content: string | null; segments: Seg[] }

  const psalms = async (): Promise<{ plan_id: string }> => {
    const plans = await agent().get("/v1/growth/plans").set(auth(meTok));
    return plans.body.data.find((p: { code: string }) => p.code === "rooted-psalms-10");
  };
  const detailOf = async (planId: string): Promise<{ next_day: number | null; days: Day[] }> =>
    (await agent().get(`/v1/growth/plans/${planId}`).set(auth(meTok))).body;

  it("refuses to seal a day whose parts are still unread", async () => {
    const p = await psalms();
    const before = await detailOf(p.plan_id);
    expect(before.days[0]!.segments.length).toBe(4);
    expect(before.days[0]!.completed).toBe(false);

    const sealed = await agent().post(`/v1/growth/plans/${p.plan_id}/complete-day`).set(auth(meTok)).send({ day_number: 1 });
    expect(sealed.status).toBe(409);
    expect(sealed.body.error.code).toBe("CONTENT_INCOMPLETE");
    expect(sealed.body.error.details.parts_remaining).toBe(4);

    // and nothing was recorded on the way out
    const after = await detailOf(p.plan_id);
    expect(after.days[0]!.completed).toBe(false);
  });

  it("seals the day only once every part is read, then opens the next one", async () => {
    const p = await psalms();
    let d = await detailOf(p.plan_id);
    expect(d.next_day).toBe(1);
    expect(d.days[1]!.locked).toBe(true);

    const segs = d.days[0]!.segments;
    for (const [i, s] of segs.entries()) {
      const r = await agent().post(`/v1/growth/segments/${s.segment_id}/complete`).set(auth(meTok));
      expect(r.status).toBe(200);
      // The day rolls up on the LAST part, not before.
      expect(r.body.day_completed).toBe(i === segs.length - 1);
    }

    d = await detailOf(p.plan_id);
    expect(d.days[0]!.completed).toBe(true);
    expect(d.days[1]!.locked).toBe(false);   // day 2 has opened
    expect(d.days[2]!.locked).toBe(true);    // day 3 has not
    expect(d.next_day).toBe(2);

    // Re-sealing a finished day is a no-op, not a second completion.
    const again = await agent().post(`/v1/growth/plans/${p.plan_id}/complete-day`).set(auth(meTok)).send({ day_number: 1 });
    expect(again.status).toBe(200);
    expect(again.body.completed_days).toEqual([1]);
  });

  it("locks day 2 while day 1 is unfinished — by the day CTA and by the part", async () => {
    const p = await psalms();
    const d = await detailOf(p.plan_id);

    const skip = await agent().post(`/v1/growth/plans/${p.plan_id}/complete-day`).set(auth(meTok)).send({ day_number: 2 });
    expect(skip.status).toBe(409);
    expect(skip.body.error.code).toBe("GATE_LOCKED");
    expect(skip.body.error.details.next_day).toBe(1);

    // The part is another door into the same room — it is gated too.
    const part = await agent().post(`/v1/growth/segments/${d.days[1]!.segments[0]!.segment_id}/complete`).set(auth(meTok));
    expect(part.status).toBe(409);
    expect(part.body.error.code).toBe("GATE_LOCKED");
  });

  it("withholds a locked day's words — the journey is visible, the content is not", async () => {
    const p = await psalms();
    const d = await detailOf(p.plan_id);

    const open = d.days[0]!;
    expect(open.locked).toBe(false);
    expect(open.segments.some((s) => s.content !== null)).toBe(true);
    expect(open.segments.find((s) => s.kind === "video")!.video_url).toBeTruthy();

    const locked = d.days[4]!;
    expect(locked.locked).toBe(true);
    // Shape stays — the member can see what is coming and that it is real...
    expect(locked.segments.length).toBe(4);
    expect(locked.segments.map((s) => s.kind)).toEqual(["video", "scripture", "devotional", "talk"]);
    // ...but no client, however old, can render past the gate.
    expect(locked.content).toBeNull();
    expect(locked.segments.every((s) => s.content === null)).toBe(true);
    expect(locked.segments.every((s) => s.video_url === null)).toBe(true);
  });

  it("refuses a day that is not in the plan, however plausible the number", async () => {
    const p = await psalms();
    // 10-day plan: day 11 is beyond it, and day 0 never reaches the handler.
    const beyond = await agent().post(`/v1/growth/plans/${p.plan_id}/complete-day`).set(auth(meTok)).send({ day_number: 11 });
    expect(beyond.status).toBe(400);
    expect(beyond.body.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("Talk it Over — AI compose help", () => {
  it("returns an editable suggestion (offline provider in tests) and posts nothing", async () => {
    const plans = await agent().get("/v1/growth/plans").set(auth(meTok));
    const rooted = plans.body.data.find((p: { code: string }) => p.code === "rooted-psalms-10");

    // No draft → a first-person starter from the day's questions.
    const fresh = await agent()
      .post(`/v1/growth/plans/${rooted.plan_id}/days/1/talk/assist`)
      .set(auth(meTok)).send({});
    expect(fresh.status).toBe(200);
    expect(fresh.body.suggestion.length).toBeGreaterThan(0);

    // With a draft → the member's words polished, still just a suggestion.
    const polish = await agent()
      .post(`/v1/growth/plans/${rooted.plan_id}/days/1/talk/assist`)
      .set(auth(meTok)).send({ draft: "i am learning that god knows me" });
    expect(polish.status).toBe(200);
    expect(polish.body.suggestion.length).toBeGreaterThan(0);

    // Suggestion only — the day's conversation stays empty until the member posts.
    const list = await agent().get(`/v1/growth/plans/${rooted.plan_id}/days/1/talk`).set(auth(meTok));
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([]);
  });
});

describe("mentor", () => {
  it("returns the discipler from the relationship tree + meeting notes", async () => {
    await testPool().query(`INSERT INTO relationship_tree (multiplier_id, disciple_id) VALUES ($1, $2)`, [mentor, me]);
    await testPool().query(
      `INSERT INTO mentor_notes (user_id, mentor_user_id, topic, note, met_at, next_meeting_at)
       VALUES ($1, $2, 'Renewing the mind', 'Worked through Romans 12.', now() - interval '7 days', now() + interval '3 days')`,
      [me, mentor],
    );
    const res = await agent().get("/v1/growth/mentor").set(auth(meTok));
    expect(res.status).toBe(200);
    expect(res.body.mentor.full_name).toBe("Pastor James");
    expect(res.body.notes).toHaveLength(1);
    expect(res.body.notes[0].topic).toBe("Renewing the mind");
    expect(res.body.next_meeting_at).not.toBeNull();
  });

  it("returns null mentor when no discipler is assigned", async () => {
    const res = await agent().get("/v1/growth/mentor").set(auth(meTok));
    expect(res.status).toBe(200);
    expect(res.body.mentor).toBeNull();
    expect(res.body.notes).toEqual([]);
  });
});
