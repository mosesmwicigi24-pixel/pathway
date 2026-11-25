// Build narration input only from the member's already-authorized plan view.
// No client-supplied text or private reflections enter this path.
export interface NarrationSegment {
  sort: number;
  kind: string;
  title: string;
  reference: string | null;
  content: string | null;
}

export interface NarrationDay {
  day_number: number;
  locked: boolean;
  title: string | null;
  segments: NarrationSegment[];
}

export type NarrationBlock =
  | { type: "heading"; text: string }
  | { type: "prose"; text: string }
  | { type: "scripture"; reference: string | null; text: string | null };

export class NarrationSourceError extends Error {
  constructor(readonly reason: "not_found" | "locked" | "empty") {
    super(`Narration source ${reason}`);
  }
}

function rank(segment: NarrationSegment): number {
  switch (segment.kind.toLowerCase()) {
    case "video": case "audio": return 0;
    case "scripture": return 1;
    case "talk": return 3;
    case "reading": return 5;
    default: return segment.title.toLowerCase().startsWith("pray") ? 4 : 2;
  }
}

/** A null scripture body means the passage must be resolved before playback;
 * it must not be silently omitted. */
export function narrationBlocks(days: NarrationDay[], dayNumber: number, part: "word" | "respond"): NarrationBlock[] {
  const day = days.find((candidate) => candidate.day_number === dayNumber);
  if (!day) throw new NarrationSourceError("not_found");
  if (day.locked) throw new NarrationSourceError("locked");
  const blocks: NarrationBlock[] = [];
  if (part === "word" && day.title?.trim()) blocks.push({ type: "heading", text: day.title.trim() });
  const segments = [...day.segments].sort((a, b) => rank(a) - rank(b) || a.sort - b.sort);
  for (const segment of segments) {
    const segmentRank = rank(segment);
    if (part === "word" ? ![1, 2, 5].includes(segmentRank) : segmentRank !== 4) continue;
    const text = segment.content?.trim() || null;
    if (part === "word" && segment.kind.toLowerCase() === "scripture") {
      const reference = segment.reference?.trim() || null;
      if (text || reference) blocks.push({ type: "scripture", reference, text });
    } else if (text) {
      if (part === "word" && segment.kind.toLowerCase() === "reading") {
        blocks.push({ type: "heading", text: "Go deeper" });
      }
      blocks.push({ type: "prose", text });
    }
  }
  if (!blocks.length) throw new NarrationSourceError("empty");
  return blocks;
}
