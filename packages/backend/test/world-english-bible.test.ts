import { describe, expect, it, vi } from "vitest";
import { parseWorldEnglishReference, worldEnglishPassage } from "../src/modules/growth-content/world-english-bible.js";

describe("World English Bible references", () => {
  it("preserves ordered ranges, lists and multiple books", () => {
    expect(parseWorldEnglishReference("1 Corinthians 15:45, 49; Proverbs 13:20")).toEqual([
      { book: "1CO", chapter: 15, verses: [45, 49] }, { book: "PRO", chapter: 13, verses: [20] },
    ]);
    expect(parseWorldEnglishReference("Jude 20–21")).toEqual([{ book: "JUD", chapter: 1, verses: [20, 21] }]);
    expect(parseWorldEnglishReference("Psalm 1:1–3")[0]?.verses).toEqual([1, 2, 3]);
  });
  it("rejects ambiguous, partial, malformed and duplicate verses", () => {
    for (const value of ["Romans 12:3b", "John 3:17-16", "John 3:16,16", "John 3:999", "John 3-4", "John 3:16?x=1", "NotABook 1:1"]) {
      expect(() => parseWorldEnglishReference(value)).toThrow();
    }
  });
});

describe("World English Bible provider", () => {
  const body = { translation: { id: "ENGWEBP" }, book: { id: "JHN" }, chapter: { number: 3, content: [
    { type: "heading", content: ["Heading"] },
    { type: "verse", number: 16, content: [{ text: "First" }, { noteId: 1 }, { text: "verse." }] },
    { type: "verse", number: 17, content: ["Second verse."] },
    { type: "verse", number: 25, content: [{ noteId: 2 }] },
  ] } };
  it("requests the fixed public-domain source and returns only requested verses", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    await expect(worldEnglishPassage("John 3:17, 16", request)).resolves.toBe("Second verse. First verse.");
    expect(request).toHaveBeenCalledWith("https://bible.helloao.org/api/ENGWEBP/JHN/3.json", expect.objectContaining({ redirect: "error" }));
  });
  it("fails closed for missing verses, wrong translation or unavailable source", async () => {
    await expect(worldEnglishPassage("John 3:18", vi.fn().mockResolvedValue(new Response(JSON.stringify(body))))).rejects.toThrow();
    await expect(worldEnglishPassage("John 3:25", vi.fn().mockResolvedValue(new Response(JSON.stringify(body))))).rejects.toThrow();
    await expect(worldEnglishPassage("John 3:16", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...body, translation: { id: "other" } }))))).rejects.toThrow();
    await expect(worldEnglishPassage("John 3:16", vi.fn().mockResolvedValue(new Response("no", { status: 503 })))).rejects.toThrow();
  });
  it("reads the published Romans 12:2b reference from its validated second clause", async () => {
    const roman = { translation: { id: "ENGWEBP" }, book: { id: "ROM" }, chapter: { number: 12, content: [
      { type: "verse", number: 2, content: ["Do not conform, but be transformed by renewing your mind."] },
    ] } };
    await expect(worldEnglishPassage("Romans 12:2b", vi.fn().mockResolvedValue(new Response(JSON.stringify(roman))))).resolves.toBe("but be transformed by renewing your mind.");
    roman.chapter.content[0]!.content = ["Unexpected revised verse."];
    await expect(worldEnglishPassage("Romans 12:2b", vi.fn().mockResolvedValue(new Response(JSON.stringify(roman))))).rejects.toThrow();
  });
});
