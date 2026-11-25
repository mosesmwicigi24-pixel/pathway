import { describe, expect, it } from "vitest";
import { narrationBlocks, type NarrationDay } from "../src/modules/growth-content/narration-source.js";

const day: NarrationDay = {
  day_number: 1, locked: false, title: "A New Day", segments: [
    { sort: 1, kind: "devotional", title: "Teaching", content: "The teaching.", reference: null },
    { sort: 2, kind: "scripture", title: "Scripture", content: null, reference: "John 3:16" },
    { sort: 3, kind: "talk", title: "Talk", content: "Private discussion prompt", reference: null },
    { sort: 4, kind: "devotional", title: "Prayer", content: "A prayer.", reference: null },
    { sort: 5, kind: "reading", title: "Further reading", content: "Psalm 23", reference: null },
    { sort: 6, kind: "video", title: "Video", content: "Video notes", reference: null },
  ],
};

describe("plan narration source", () => {
  it("orders the Word like the readers, retaining unresolved scripture for explicit resolution", () => {
    expect(narrationBlocks([day], 1, "word")).toEqual([
      { type: "heading", text: "A New Day" },
      { type: "scripture", reference: "John 3:16", text: null },
      { type: "prose", text: "The teaching." },
      { type: "heading", text: "Go deeper" },
      { type: "prose", text: "Psalm 23" },
    ]);
  });

  it("limits Respond to the authored prayer, never talk or video", () => {
    expect(narrationBlocks([day], 1, "respond")).toEqual([{ type: "prose", text: "A prayer." }]);
  });

  it("refuses locked and unknown days even if their bodies are present", () => {
    expect(() => narrationBlocks([{ ...day, locked: true }], 1, "word")).toThrow("Narration source locked");
    expect(() => narrationBlocks([day], 2, "word")).toThrow("Narration source not_found");
  });

  it("returns an explicit empty error instead of playing nothing", () => {
    expect(() => narrationBlocks([{ ...day, segments: [] }], 1, "respond")).toThrow("Narration source empty");
  });
});
