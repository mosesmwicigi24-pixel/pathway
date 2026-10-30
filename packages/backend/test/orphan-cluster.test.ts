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
// the three properties that matter — it only ever touches OUR clusters, only once
// their run is gone, and it escalates until the port is actually free.
import { describe, it, expect } from "vitest";
import {
  clusterRunningIn,
  clusterStartingIn,
  describeCluster,
  findOrphanClusters,
  findTestClusters,
  reapOrphanCluster,
} from "./helpers/orphanCluster.js";
import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
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

  it("names the suite that holds the port when it is still running", () => {
    // Not a stranger and not a stuck orphan: the person blocked needs to know
    // whose run this is, and that waiting is the answer.
    expect(setupSource).toContain("A suite that is still running holds it");
    expect(setupSource).toContain("running.map(describeCluster)");
  });
});

describe("abandoned data directories are swept", () => {
  it("skips the directory the current run is using", () => {
    expect(setupSource).toContain("full === currentDataDir");
  });

  it("skips directories that still have a live process", () => {
    expect(setupSource).toContain("live.has(full)");
  });

  it("counts every cluster on the port as live, not only the orphans", () => {
    // findOrphanClusters narrowed on 2026-10-30. Built from that, this set would
    // have stopped sparing the clusters that are actually in use.
    expect(setupSource).toMatch(/live = new Set\(findTestClusters\(TEST_PG_PORT\)/);
  });
});

// 2026-10-30: proving a cluster was ours never proved it was abandoned. Every
// checkout shares the port, so a suite started beside a running one reaped it
// mid-run: 233 false failures, and the victim's workers then deadlocked the new
// suite's setup. These run a real process tree on a real port, through the same
// lsof and ps a run uses. The cluster is a bare listener rather than Postgres
// because what is under test is who owns it, not what it serves.
describe("a cluster is only an orphan once its run is gone", () => {
  // Started as a direct child of the run, as embedded-postgres does.
  const RUN = `
    require("node:child_process").spawn(process.execPath, process.argv.slice(2), { stdio: "inherit" });
    setInterval(() => {}, 60_000);
  `;
  const LISTENER = `
    require("node:net").createServer().listen(0, "127.0.0.1", function () {
      console.log(JSON.stringify({ pid: process.pid, port: this.address().port }));
    });
  `;

  interface Started {
    root: string;
    run: ChildProcess;
    pid: number;
    port: number;
    dataDir: string;
  }

  async function startCluster({ ours = true, ignoresSigint = false } = {}): Promise<Started> {
    const root = mkdtempSync(join(tmpdir(), "nuru-sweeptest-"));
    const binDir = ours ? join(root, "node_modules") : root;
    const dataDir = join(root, ours ? "nuru-pg-fake" : "data");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(dataDir);
    const binary = join(binDir, "postgres.cjs");
    writeFileSync(binary, `${ignoresSigint ? 'process.on("SIGINT", () => {});' : ""}${LISTENER}`);
    const runScript = join(root, "run.cjs");
    writeFileSync(runScript, RUN);
    const run = spawn(process.execPath, [runScript, binary, "-D", dataDir], { stdio: ["ignore", "pipe", "inherit"] });
    const [line] = (await once(createInterface({ input: run.stdout! }), "line")) as [string];
    const { pid, port } = JSON.parse(line) as { pid: number; port: number };
    return { root, run, pid, port, dataDir };
  }

  async function killRun({ run }: Started): Promise<void> {
    run.kill("SIGKILL");
    await once(run, "exit");
  }

  function cleanUp({ root, run, pid }: Started): void {
    for (const target of [pid, run.pid!]) {
      try {
        process.kill(target, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
    rmSync(root, { recursive: true, force: true });
  }

  it("leaves a cluster alone while its run is alive", async () => {
    const started = await startCluster();
    try {
      expect(findTestClusters(started.port)).toMatchObject([
        { pid: started.pid, parentPid: started.run.pid, dataDir: started.dataDir },
      ]);
      expect(findOrphanClusters(started.port)).toEqual([]);
    } finally {
      cleanUp(started);
    }
  });

  it("calls it an orphan once its run has died, and reaping then frees the port", async () => {
    // What the reaper exists for: a crashed run leaves a postmaster holding the port.
    const started = await startCluster();
    try {
      await killRun(started);
      const orphans = findOrphanClusters(started.port);
      expect(orphans).toMatchObject([{ pid: started.pid, parentPid: 1, dataDir: started.dataDir }]);

      expect(reapOrphanCluster(orphans[0]!, { graceMs: 2_000 })).toMatchObject({ signal: "SIGINT", dataDirRemoved: true });
      expect(findTestClusters(started.port)).toEqual([]);
      expect(existsSync(started.dataDir)).toBe(false);
    } finally {
      cleanUp(started);
    }
  });

  it("still insists on an orphan that ignores the polite signal", async () => {
    // 2026-08-15: pkill and a plain kill both left the postmaster running.
    const started = await startCluster({ ignoresSigint: true });
    try {
      await killRun(started);
      const orphans = findOrphanClusters(started.port);
      expect(orphans).toHaveLength(1);

      expect(reapOrphanCluster(orphans[0]!, { graceMs: 300 })).toMatchObject({ signal: "SIGKILL", dataDirRemoved: true });
      expect(findTestClusters(started.port)).toEqual([]);
    } finally {
      cleanUp(started);
    }
  });

  it("never reads a stranger as an orphan, however it came to have pid 1 as its parent", async () => {
    // A Postgres run by launchd or systemd has parent 1 from the day it starts, so
    // that test alone would reach a developer's real database. Ours comes first.
    const started = await startCluster({ ours: false });
    try {
      await killRun(started);
      expect(execFileSync("ps", ["-p", String(started.pid), "-o", "ppid="], { encoding: "utf8" }).trim()).toBe("1");
      expect(findTestClusters(started.port)).toEqual([]);
      expect(findOrphanClusters(started.port)).toEqual([]);
    } finally {
      cleanUp(started);
    }
  });

  it("describes a cluster by its pid, its run and its checkout", async () => {
    const started = await startCluster();
    try {
      const description = describeCluster(findTestClusters(started.port)[0]!);
      expect(description).toContain(`postgres pid ${started.pid}`);
      expect(description).toContain(`run pid ${started.run.pid}`);
      expect(description).toContain(started.root);
    } finally {
      cleanUp(started);
    }
  });

  it("only ever hands the reaper orphans, on every pass of the wait", () => {
    // Every pass, because the run being waited for can die during the wait.
    expect(setupSource).toMatch(/for \(;;\) \{[\s\S]*of findOrphanClusters\(TEST_PG_PORT\)\) \{[\s\S]*reapOrphanCluster\(orphan\)/);
    expect(setupSource.match(/reapOrphanCluster\(/g)).toHaveLength(1);
  });
});

// 2026-10-30: suites that wait instead of killing are all released together, so
// one always loses the port after finding it free. These need two real suites to
// exercise; the source is pinned, as the rest of this file does.
describe("a suite that loses the port during setup", () => {
  it("goes back to waiting instead of dying on embedded-postgres's bare undefined", () => {
    expect(setupSource).toContain("await startCluster();");
    expect(setupSource).not.toMatch(/await epg\.start\(\);\s*await epg\.createDatabase/);
    expect(setupSource).toMatch(/if \(!\(await portInUse\(\)\)\) throw err;[\s\S]{0,160}await awaitFreePort\(\);/);
  });

  it("still fails as a failure: teardown never waits on a postmaster that has gone", () => {
    // stop() would hang on an 'exit' event that has already fired, and
    // async-exit-hook would then end the run with exit code 0.
    expect(setupSource).toMatch(/if \(clusterRunningIn\(currentDataDir\)\) await epg\.stop\(\)/);
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

  // 2026-10-30: postmaster.pid only exists once Postgres is up, so a suite started
  // a second after another swept its directory out from under initdb.
  it("a directory touched recently may be one a run is still setting up", () => {
    const dir = scratch();
    try {
      expect(clusterStartingIn(dir)).toBe(true);
      const anHourAgo = new Date(Date.now() - 60 * 60_000);
      utimesSync(dir, anHourAgo, anHourAgo);
      expect(clusterStartingIn(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a directory that has gone is not", () => {
    const dir = scratch();
    rmSync(dir, { recursive: true, force: true });
    expect(clusterStartingIn(dir)).toBe(false);
  });

  it("the sweep asks that too", () => {
    expect(setupSource).toMatch(/clusterStartingIn\(full\)/);
  });
});
