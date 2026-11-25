import { describe, expect, it, vi } from "vitest";
import { narrationScript } from "../src/modules/growth-content/narration-script.js";

describe("narration script", () => {
  it("retains the reading order and resolves missing scripture", async () => {
    const passage = vi.fn().mockResolvedValue("For God so loved the world.");
    await expect(narrationScript([
      { type: "heading", text: "A New Day" },
      { type: "scripture", reference: "John 3:16", text: null },
      { type: "prose", text: "**Remember** this.\n\n[Read more](https://example.com)" },
    ], passage)).resolves.toEqual(["A New Day", "John 3, verse 16.", "For God so loved the world.", "Remember this.", "Read more"]);
    expect(passage).toHaveBeenCalledWith("John 3:16");
  });

  it("fails rather than omitting a passage when scripture is unavailable", async () => {
    await expect(narrationScript([{ type: "scripture", reference: "John 3:16", text: null }],
      async () => { throw new Error("private provider detail"); })).rejects.toThrow("Narration scripture unavailable");
  });

  it("bounds paragraphs without losing text and preserves authored scripture", async () => {
    const text = "word ".repeat(400).trim();
    const passage = vi.fn();
    const script = await narrationScript([{ type: "scripture", reference: null, text }], passage);
    expect(script.every((p) => p.length <= 1200)).toBe(true);
    expect(script.join(" ")).toBe(text);
    expect(passage).not.toHaveBeenCalled();
  });

  it("reads sequential verse numbers silently but keeps numbers in the passage", async () => {
    const script = await narrationScript([{ type: "scripture", reference: "James 1:22-23",
      text: "22 Do not merely listen. They waited 430 years. 23 Anyone who listens." }], async () => "");
    expect(script).toEqual(["James 1, verses 22 to 23.", "Do not merely listen. They waited 430 years. Anyone who listens."]);
  });
});
