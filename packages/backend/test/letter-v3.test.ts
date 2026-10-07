// The Sunday Letter v3 — the editorial letter (owner, 2026-10-07). Everything
// new is derived, never model-written: the photograph (eye-checked library,
// by theme and season), the week's figures (true counts), the verse's own
// words (the church's daily-verse library), the issue number, the PDF.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser, createEnrollment, createModule } from "./helpers/factories.js";
import { ContentIndexService } from "../src/modules/intelligence/content.js";
import { StoryService } from "../src/modules/intelligence/story.js";
import { LettersService } from "../src/modules/intelligence/letters.js";
import { NATURE, weatherOf } from "../src/modules/intelligence/nature.js";
import { PDFDocument } from "pdf-lib";
import {
  CAPTION_VERSES,
  captionText,
  captionVerse,
  forgetCaptionVerses,
  letterFigures,
  paragraphsOf,
  photoForLetter,
  readingMinutes,
  weekWindow,
} from "../src/modules/intelligence/letterExtras.js";
import { planLetterPage, renderLetterPdf } from "../src/modules/intelligence/letterPdf.js";
import { LETTER_THEMES } from "../src/modules/intelligence/prompts.js";
import { FakeAiProvider } from "../src/modules/assistant/provider.js";

let meId: string, meTok: string, enrollmentId: string, moduleId: string;
const provider = new FakeAiProvider();
const letters = () => new LettersService(testPool(), provider, new StoryService(testPool(), provider), new ContentIndexService(testPool()));
const weekOf = LettersService.weekOf();
/** An instant inside (or outside) the letter's week, in EAT. */
const inWeek = (dayOffsetFromSunday: number, hh = 10) =>
  new Date(new Date(`${weekOf}T${String(hh).padStart(2, "0")}:00:00+03:00`).getTime() + dayOffsetFromSunday * 86_400_000).toISOString();

const TINY_JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAEAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDp6KKK+OPoz//Z", "base64");
const binary = (res: { setEncoding: (e: string) => void; on: (ev: string, cb: (c?: Buffer) => void) => void }, cb: (e: null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c?: Buffer) => c && chunks.push(Buffer.from(c)));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};

beforeEach(async () => {
  await resetDb();
  forgetCaptionVerses();
  const cong = await createCongregation();
  const cell = await createCellGroup(cong, "Cell A");
  meId = (await createUser({ congregationId: cong, cellGroupId: cell, email: "lv3@dev.local", fullName: "Ada Grace" })).user_id;
  meTok = bearer({ sub: meId, role: "Student", cong });
  enrollmentId = await createEnrollment(meId, 1);
  moduleId = await createModule(1, 1);
  await createModule(1, 2); // still waiting → a real next step
  await testPool().query(`INSERT INTO interaction_events (user_id, kind, occurred_at, client_event_id) VALUES ($1, 'word', now() - interval '1 day', gen_random_uuid())`, [meId]);
  await testPool().query(
    `INSERT INTO daily_verses (day_index, day_date, theme, reference, version, verse_text)
     VALUES (1, '2026-01-01', 'Hope', 'Philippians 1:6', 'WEB', 'being confident of this very thing, that he who began a good work in you will complete it until the day of Jesus Christ.')`,
  );
});
afterAll(async () => {
  await closeTestPool();
});

describe("derived, never written by the model", () => {
  it("the body reads as paragraphs, and a reading time", () => {
    expect(paragraphsOf("First thought.\n\nSecond thought.")).toEqual(["First thought.", "Second thought."]);
    expect(paragraphsOf("One block\nwith a soft break.")).toEqual(["One block with a soft break."]);
    expect(readingMinutes("word ".repeat(150))).toBe(1);
    expect(readingMinutes("word ".repeat(400))).toBe(2);
  });

  // Owner, 2026-10-07: "make the … paragraph". Letters before v3 were one block.
  it("one long block is split at the sentence nearest each equal share; abbreviations never end a sentence", () => {
    const sentence = (first: string, words: number) => `${first} ${"word ".repeat(words - 2)}end.`;
    const four = [sentence("One", 20), sentence("Two", 20), sentence("Three", 20), sentence("Four", 20)];
    expect(paragraphsOf(four.join(" "))).toEqual([`${four[0]} ${four[1]}`, `${four[2]} ${four[3]}`]);

    const abbrev = `${sentence("One", 30)} St. John kept issue No. 9 and ${"word ".repeat(20)}end. ${sentence("Three", 30)}`;
    const split = paragraphsOf(abbrev);
    expect(split).toHaveLength(2);
    expect(split.join(" ")).toBe(abbrev);
    expect(split.some((p) => p.startsWith("John") || p.startsWith("9"))).toBe(false);

    const long = Array.from({ length: 11 }, (_, i) => sentence(`S${i}`, 20)).join(" ");
    expect(paragraphsOf(long)).toHaveLength(3);
    expect(paragraphsOf(long).join(" ")).toBe(long);
    // the model's own paragraphs are kept as written
    expect(paragraphsOf(`${four.join(" ")}\n\nA short close.`)).toEqual([four.join(" "), "A short close."]);
  });

  // Owner, 2026-10-07: "make the caption below the image scriptural".
  it("every theme has scripture for its photograph — references only, the words come from the library", () => {
    expect(Object.keys(CAPTION_VERSES).sort()).toEqual([...LETTER_THEMES].sort());
    for (const [theme, refs] of Object.entries(CAPTION_VERSES)) {
      expect(refs.length, theme).toBeGreaterThanOrEqual(3);
      for (const r of refs) expect(r).toMatch(/^(\d )?[A-Z][a-z]+( [A-Za-z]+)* \d+:\d+(-\d+)?$/);
    }
  });

  it("the caption is a verse from the library, the same every time, never from the letter's own chapter", async () => {
    await testPool().query(
      `INSERT INTO daily_verses (day_index, day_date, theme, reference, version, verse_text) VALUES
         (2, '2026-01-02', 'Rest', 'Psalm 23:2', 'NIV', 'He makes me lie down in green pastures, he leads me beside quiet waters.'),
         (3, '2026-01-03', 'New', 'Isaiah 43:19', 'NIV', 'See, I am doing a new thing! Now it springs up; do you not perceive it? I am making a way in the wilderness and streams in the wasteland.')`,
    );
    const v = (await captionVerse(testPool(), "letter-1", "water", null))!;
    expect(["Psalm 23:2", "Isaiah 43:19"]).toContain(v.ref);
    expect(captionText(v)).toMatch(/^\u201C.+\u201D \u2014 (Psalm 23:2|Isaiah 43:19) \(NIV\)$/);
    expect(await captionVerse(testPool(), "letter-1", "water", null)).toEqual(v);
    for (const id of ["a", "b", "c", "d", "e", "f"]) {
      expect((await captionVerse(testPool(), id, "water", "Psalm 23:1-3"))!.ref).toBe("Isaiah 43:19");
    }
    // none of the theme's verses in the library: no caption verse (the description stays)
    expect(await captionVerse(testPool(), "letter-1", "harvest", null)).toBeNull();
  });

  it("the photograph fits the theme and the week's season, and is the same every time", () => {
    const a = photoForLetter("letter-1", "dawn", "2026-10-04")!;
    const photo = NATURE.find((p) => p.id === a.id)!;
    expect(photo.hours.some((h) => h === "sunrise" || h === "predawn")).toBe(true);
    expect(photo.weather === undefined || photo.weather === weatherOf(new Date("2026-10-04T12:00:00+03:00"))).toBe(true);
    expect(photoForLetter("letter-1", "dawn", "2026-10-04")).toEqual(a);
    expect(a.caption).toContain("Chosen for a week of new beginnings");
    // a frozen choice wins over the derivation
    const other = NATURE.find((p) => p.id !== a.id)!;
    expect(photoForLetter("letter-1", "dawn", "2026-10-04", other.id)!.id).toBe(other.id);
  });

  it("the figures are the member's own week, true counts only, never a zero", async () => {
    const { rows } = await testPool().query<{ progress_id: string }>(
      `INSERT INTO module_progress (enrollment_id, module_id, is_completed, completed_at) VALUES ($1, $2, TRUE, $3) RETURNING progress_id`,
      [enrollmentId, moduleId, inWeek(-2)],
    );
    await testPool().query(`INSERT INTO module_reflections (progress_id, user_id, module_id, body, submitted_at) VALUES ($1, $2, $3, 'I am learning', $4)`, [rows[0]!.progress_id, meId, moduleId, inWeek(-3)]);
    await testPool().query(
      `INSERT INTO prayer_entries (entry_id, user_id, body, is_answered, answered_at) VALUES (gen_random_uuid(), $1, 'for my mother', TRUE, $2), (gen_random_uuid(), $1, 'for work', TRUE, $3)`,
      [meId, inWeek(-1), inWeek(-9)], // the second was answered the week before — not this letter's
    );
    const figs = await letterFigures(testPool(), meId, weekOf);
    expect(figs).toEqual([
      { value: "1", label: "lesson finished" },
      { value: "1", label: "reflection written" },
      { value: "1", label: "prayer answered" },
    ]);
    const { from, to } = weekWindow(weekOf);
    expect(new Date(to).getTime() - new Date(from).getTime()).toBe(7 * 86_400_000);
  });
});

describe("the v3 letter, composed and served", () => {
  it("freezes the photograph, the figures and the verse's words, and serves the editorial fields", async () => {
    await testPool().query(`INSERT INTO module_progress (enrollment_id, module_id, is_completed, completed_at) VALUES ($1, $2, TRUE, $3)`, [enrollmentId, moduleId, inWeek(-1)]);
    const out = await letters().runWeekly();
    expect(out.written).toBe(1);

    const { rows } = await testPool().query<{ highlights: Record<string, unknown> }>(`SELECT highlights FROM pastoral_letters WHERE user_id = $1`, [meId]);
    const stored = rows[0]!.highlights;
    expect(typeof stored.photo_id).toBe("string");
    expect(stored.figures).toEqual([{ value: "1", label: "lesson finished" }]);
    expect(stored.scripture_text).toContain("he who began a good work in you");

    const res = await agent().get("/v1/me/letters/latest").set("Authorization", meTok);
    expect(res.status).toBe(200);
    const l = res.body.letter;
    expect(l.issue_no).toBe(1);
    expect(l.paragraphs.length).toBeGreaterThanOrEqual(1);
    expect(l.reading_minutes).toBeGreaterThanOrEqual(1);
    expect(l.scripture).toEqual({ ref: "Philippians 1:6", text: expect.stringContaining("good work"), version: "WEB" });
    expect(l.photo.id).toBe(stored.photo_id);
    expect(l.photo.url).toMatch(/^https:\/\/images\.unsplash\.com\/photo-/);
    expect(l.figures).toEqual([{ value: "1", label: "lesson finished" }]);
    expect(l.signed_by).toEqual({ name: "Pastor Moses", role: "Nuru Place" });
    expect(l.pdf_url).toBe(`/v1/me/letters/${l.letter_id}/pdf`);
    // the v2 fields are still there for older apps
    expect(l.body).toBeTruthy();
    expect(l.scripture_ref).toBe("Philippians 1:6");
    expect(Array.isArray(l.highlights)).toBe(true);
  });

  it("a letter written before v3 derives the same fields on read", async () => {
    await testPool().query(
      `INSERT INTO pastoral_letters (user_id, week_of, title, salutation, theme, image_key, body, scripture_ref, highlights)
       VALUES ($1, $2, 'Old letter', 'Dear Ada,', 'water', 'water', 'One.\n\nTwo.', 'Philippians 1:6', '{"moments":["x"]}'::jsonb)`,
      [meId, weekOf],
    );
    await testPool().query(
      `INSERT INTO daily_verses (day_index, day_date, theme, reference, version, verse_text)
       VALUES (2, '2026-01-02', 'Rest', 'Psalm 23:2', 'NIV', 'He makes me lie down in green pastures, he leads me beside quiet waters.')`,
    );
    const l = (await letters().latest(meId))!;
    expect(l.photo?.caption).toBe("\u201CHe makes me lie down in green pastures, he leads me beside quiet waters.\u201D \u2014 Psalm 23:2 (NIV)");
    expect(l.paragraphs).toEqual(["One.", "Two."]);
    expect(l.scripture?.text).toContain("good work");
    expect(l.photo).not.toBeNull();
    expect(l.figures).toEqual([]);
  });
});

describe("keep this letter — the A4 page", () => {
  it("serves the member's own letter as a private PDF, and refuses anyone else's", async () => {
    await letters().runWeekly();
    const id = (await letters().latest(meId))!.letter_id;
    const res = await agent().get(`/v1/me/letters/${id}/pdf`).set("Authorization", meTok).buffer(true).parse(binary as never);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");

    const other = await createUser({ congregationId: (await createCongregation()), email: "lv3-other@dev.local", fullName: "Ben" });
    const theirs = await agent().get(`/v1/me/letters/${id}/pdf`).set("Authorization", bearer({ sub: other.user_id, role: "Student" }));
    expect(theirs.status).toBe(404);
  });

  // Owner, 2026-10-07: "format the font like the heading to reach the end of the page".
  it("runs the full measure, and a long letter tightens to one page without losing its photograph", async () => {
    await letters().runWeekly();
    const base = (await letters().latest(meId))!;
    const long = {
      ...base,
      title: "A title long enough that it has to wrap onto a second line of the page",
      paragraphs: paragraphsOf(Array.from({ length: 12 }, (_, i) => `Sentence ${i} ${"word ".repeat(18)}end.`).join(" ")),
      share_line: "A line worth keeping, long enough to need a second line on the page when it is set large.",
      figures: [
        { value: "2", label: "lessons finished" },
        { value: "5 of 7", label: "days in the Word" },
        { value: "1", label: "reflection written" },
      ],
    };
    expect(long.paragraphs).toHaveLength(3);
    const plan = await planLetterPage(long, true);
    expect(plan.measure).toBeCloseTo(595.28 - 2 * 48, 1);
    expect(plan.end).toBeGreaterThanOrEqual(plan.floor);
    expect(plan.fit.photoH).toBeGreaterThan(0);
    const roomy = await planLetterPage({ ...base, paragraphs: ["A short week, gently told."] }, true);
    expect(roomy.fit).toEqual({ photoH: 170, body: 12.5, leading: 18.5, pullQuote: true });
    const pdf = await PDFDocument.load(await renderLetterPdf(long, { firstName: "Ada", photo: new Uint8Array(TINY_JPEG) }));
    expect(pdf.getPageCount()).toBe(1);
  });

  it("carries its photograph when it has one", async () => {
    await letters().runWeekly();
    const letter = (await letters().latest(meId))!;
    const without = await renderLetterPdf(letter, { firstName: "Ada", photo: null });
    const withPhoto = await renderLetterPdf(letter, { firstName: "Ada", photo: new Uint8Array(TINY_JPEG) });
    expect(Buffer.from(withPhoto).subarray(0, 5).toString()).toBe("%PDF-");
    expect(withPhoto.length).toBeGreaterThan(without.length);
  });
});
