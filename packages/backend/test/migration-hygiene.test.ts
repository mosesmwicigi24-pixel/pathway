// Static hygiene checks over the migration directory. These catch the class of
// failure where a migration APPLIES CLEANLY and is recorded as applied, yet leaves
// the schema in the wrong state — which neither CI's "migrations apply" step nor
// its "down all → up all" reversibility gate can detect, because both end in a
// self-consistent schema. No database needed: this is a lint over the files.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

describe("migration hygiene (static)", () => {
  it("has migrations to check", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("every file with a down section declares `-- Up Migration` first", () => {
    // node-pg-migrate only splits a SQL migration when the up marker is present.
    // Without it the ENTIRE file is the up migration, so the down section runs
    // immediately after the up section and quietly undoes it — while the
    // migration is stamped as applied and can never re-run. That is exactly how
    // 182 (🔥 reactions) shipped a CHECK that still rejected 'fire'.
    const offenders = files.filter((f) => {
      const sql = readFileSync(join(migrationsDir, f), "utf8");
      const down = sql.indexOf("-- Down Migration");
      if (down < 0) return false; // up-only migration: whole file is the up, correctly
      const up = sql.indexOf("-- Up Migration");
      return up < 0 || up > down;
    });
    expect(offenders).toEqual([]);
  });

  it("migration numbers are unique and strictly increasing", () => {
    // Concurrent sessions minting the same number is a real hazard here: two
    // files sharing a prefix apply in an order neither author intended, and the
    // second one to be written is invisible in `ls` order. CLAUDE.md's "git pull
    // + ls migrations before minting a number" is the process control; this is
    // the one that cannot be forgotten.
    const numbers = files.map((f) => f.split("_")[0]!);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect([...numbers].sort()).toEqual(numbers);
  });
});
