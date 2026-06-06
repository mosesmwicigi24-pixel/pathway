// Presentational sample content for the Pathway UI, mirroring the Figma Make
// design ("Nuru Pathway app design"). This is the seed shape the screens render
// today; once the CMS + sync land, these are replaced by localStore-backed reads
// (see HomeScreen's getLocalStore usage for the wired pattern). Keeping the shape
// here means screens stay declarative and swapping the source (to the localStore /
// sync reads in src/db) is a one-file change.

export type LevelStatus = "completed" | "active" | "locked";

export interface LevelMeta {
  id: number;
  title: string;
  subtitle: string;
  modules: number;
  completed: number;
  minutes: number;
  status: LevelStatus;
}

export const LEVELS: LevelMeta[] = [
  { id: 1, title: "Foundations of Faith", subtitle: "God, His Word, prayer & the Church", modules: 9, completed: 9, minutes: 95, status: "completed" },
  { id: 2, title: "Inner Transformation", subtitle: "Renewing the mind, character & holiness", modules: 9, completed: 3, minutes: 110, status: "active" },
  { id: 3, title: "Grace & Kingdom", subtitle: "Living under grace in God's Kingdom", modules: 8, completed: 0, minutes: 100, status: "locked" },
  { id: 4, title: "Life in the Holy Spirit", subtitle: "Walking in gifts, power & guidance", modules: 10, completed: 0, minutes: 130, status: "locked" },
  { id: 5, title: "Leadership & Multiplication", subtitle: "Discipling others & building God's house", modules: 7, completed: 0, minutes: 90, status: "locked" },
  { id: 6, title: "Maturity & Legacy", subtitle: "Finishing strong and fathering a generation", modules: 6, completed: 0, minutes: 80, status: "locked" },
];

// Lookups that return a guaranteed LevelMeta (the screens always have a level to
// render). They fall back to the active level, then the first, so callers never
// deal with `undefined` under noUncheckedIndexedAccess.
export function getActiveLevel(): LevelMeta {
  const active = LEVELS.find((l) => l.status === "active");
  if (active) return active;
  const first = LEVELS[0];
  if (first) return first;
  throw new Error("LEVELS must not be empty");
}

export function getLevel(id: number): LevelMeta {
  return LEVELS.find((l) => l.id === id) ?? getActiveLevel();
}

export type ModuleStatus = "completed" | "next" | "locked";
export type MediaKind = "text" | "audio" | "video";

export interface ModuleMeta {
  id: number;
  title: string;
  summary: string;
  minutes: number;
  status: ModuleStatus;
  progress: number;
  media: MediaKind[];
}

// Module list for the active level (Level 2). Other levels reuse this shape.
export const LEVEL_MODULES: ModuleMeta[] = [
  { id: 1, title: "Who Is God?", summary: "The nature, goodness, and fatherhood of God.", minutes: 10, status: "completed", progress: 100, media: ["text", "audio"] },
  { id: 2, title: "The Word of God", summary: "How Scripture forms faith and daily decisions.", minutes: 8, status: "completed", progress: 100, media: ["text", "video"] },
  { id: 3, title: "Prayer & Communion", summary: "Building a consistent life of prayer.", minutes: 12, status: "completed", progress: 100, media: ["text", "audio"] },
  { id: 4, title: "The Church of Christ", summary: "Belonging, service, fellowship, and spiritual family.", minutes: 12, status: "next", progress: 35, media: ["text", "audio", "video"] },
  { id: 5, title: "Faith & Righteousness", summary: "Standing in Christ with confidence and humility.", minutes: 15, status: "locked", progress: 0, media: ["text"] },
  { id: 6, title: "Salvation Explained", summary: "Grace, repentance, assurance, and new life.", minutes: 9, status: "locked", progress: 0, media: ["text", "video"] },
  { id: 7, title: "The Holy Spirit's Role", summary: "Guidance, comfort, gifts, and power.", minutes: 11, status: "locked", progress: 0, media: ["text", "audio"] },
  { id: 8, title: "Living by the Spirit", summary: "Daily obedience and spiritual sensitivity.", minutes: 14, status: "locked", progress: 0, media: ["text"] },
  { id: 9, title: "Kingdom Identity", summary: "Living as a witness in the world.", minutes: 13, status: "locked", progress: 0, media: ["text", "video"] },
];
