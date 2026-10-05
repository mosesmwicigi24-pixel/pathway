// Guardrails around a previous run's embedded Postgres.
//
// On 2026-08-15 a run died when the disk filled. Its postmaster survived,
// holding port 55432, and every subsequent run reported "no tests" until it was
// killed by hand — `pkill` and a plain `kill` both left it running; only `kill -9`
// worked. Reproducing an orphan on a healthy disk, pkill stops it cleanly, so the
// full disk (a shutdown checkpoint with nowhere to write) is the likeliest
// difference rather than any signal semantics.
//
// The fix does not rest on that diagnosis: ask politely, then insist. These pin
// the two properties that matter — it only ever touches OUR clusters, and it
// escalates until the port is actually free.
import { describe, it, expect } from "vitest";
import { clusterRunningIn, findOrphanClusters } from "./helpers/orphanCluster.js";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const reaperSource = readFileSync(join(here, "helpers", "orphanCluster.ts"), "utf8");
const setupSource = readFileSync(join(here, "helpers", "globalSetup.ts"), "utf8");

describe("it only ever reaps our own clusters", () => {
  it("requires BOTH the data-dir marker and a node_modules binary", () => {
    // A system Postgres on 55432 matches neither and must survive. Getting this
    // wrong destroys a developer's real database — strictly worse than the flake
    // being fixed.
    expect(reaperSource).toContain('DATA_DIR_MARKER = "nuru-pg-"');
    expect(reaperSource).toContain('BINARY_MARKER = "node_modules"');
    expect(reaperSource).toMatch(/!command\.includes\(DATA_DIR_MARKER\)\s*\|\|\s*!command\.includes\(BINARY_MARKER\)/);
  });

  it("never targets pid 0 or 1", () => {
    expect(reaperSource).toContain("pid <= 1");
  });

  it("finds nothing when the port is idle", () => {
    // 65000 is not a port anything here uses; the reaper must be quiet, not throw.
    expect(findOrphanClusters(65_000)).toEqual([]);
  });
});

describe("it uses a signal that actually stops Postgres", () => {
  it("sends SIGINT (fast shutdown) first", () => {
    expect(reaperSource).toContain('process.kill(orphan.pid, "SIGINT")');
  });

  it("escalates to SIGKILL rather than waiting forever", () => {
    expect(reaperSource).toContain('process.kill(orphan.pid, "SIGKILL")');
  });
});

describe("the error message no longer sends anyone down a dead end", () => {
  it("never RECOMMENDS pkill as the remedy", () => {
    // The old message ended "Stop it with: pkill -f 'nuru-pg-'" — a command that
    // reported success and changed nothing on the day it mattered.
    expect(setupSource).not.toContain("Stop it with: pkill");
  });

  it("points at disk space, the condition that actually differed", () => {
    expect(setupSource).toContain("Check free disk");
  });

  it("names a command that actually frees the port", () => {
    // kill -9 is what worked on the day. Blunt, but the message is for someone
    // already blocked, not for a tidy shutdown.
    expect(setupSource).toContain("kill -9 $(lsof -ti :");
  });

  it("distinguishes a stranger on the port from our own orphan", () => {
    // If it is not ours we leave it alone and say so, rather than reaping blind.
    expect(setupSource).toContain("NOT one of our test clusters");
  });
});

describe("abandoned data directories are swept", () => {
  it("skips the directory the current run is using", () => {
    expect(setupSource).toContain("full === currentDataDir");
  });

  it("skips directories that still have a live process", () => {
    expect(setupSource).toContain("live.has(full)");
  });
});

// 2026-10-05: a run on a private port (55437) swept the data directory of a
// suite running on 55432 — mid-run, 815 tests failed on "could not open file
// base/16384/…". The sweep only spared clusters on ITS OWN port. A directory a
// Postgres is running out of must be spared whatever port it serves.
describe("the temp-dir sweep never takes a running cluster's directory", () => {
  const scratch = (): string => mkdtempSync(join(tmpdir(), "nuru-sweeptest-"));

  it("a directory whose postmaster.pid names a live process is running — on any port", () => {
    const dir = scratch();
    try {
      writeFileSync(join(dir, "postmaster.pid"), `${process.pid}\n${dir}\n`);
      expect(clusterRunningIn(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a directory with no pid file, or a pid that has exited, is not", () => {
    const dir = scratch();
    try {
      expect(clusterRunningIn(dir)).toBe(false);
      const exited = spawnSync("true").pid!;
      writeFileSync(join(dir, "postmaster.pid"), `${exited}\n`);
      expect(clusterRunningIn(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the sweep asks it before removing anything", () => {
    expect(setupSource).toMatch(/clusterRunningIn\(full\)/);
  });
});
