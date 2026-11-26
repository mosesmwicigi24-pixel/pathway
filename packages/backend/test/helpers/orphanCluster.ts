// Finding and reaping a previous run's embedded Postgres.
//
// The suite boots one cluster on a fixed port (55432). When a run dies without
// running teardown — a crash, a SIGKILL, the disk filling mid-build — the
// postmaster survives its parent and keeps the port. #418 added a guard that
// refuses to run in that state rather than silently connecting to the stale
// cluster, which was right: a green suite against yesterday's schema is worse
// than no suite. But the guard only told a human to fix it, and on 2026-08-15
// the fix it suggested did not work.
//
// What was actually observed that day: `pkill -f 'nuru-pg-'` reported success,
// the postmaster was still holding the port, a plain `kill` did nothing either,
// and only `kill -9` freed it. The run had died because the disk filled — 117 MB
// free of 460 GB.
//
// What was NOT the cause, tested rather than assumed: SIGTERM's "smart shutdown"
// semantics. Reproducing an orphan on a healthy disk — with and without a
// stranded client connection attached — pkill stopped it cleanly both times. So
// the plausible-sounding story (SIGTERM means wait for clients, the orphan's own
// connections are what is attached, it waits forever) is not what happened here.
// The remaining difference is the full disk: a graceful shutdown has to write a
// checkpoint, and there was nowhere to write it.
//
// The fix does not depend on knowing which. Ask politely, then insist:
// SIGINT (fast shutdown) and, if the process is still there, SIGKILL. That is
// robust whether a shutdown is waiting on a client, blocked on a full disk, or
// wedged for a reason nobody has seen yet.
//
// Safety is the rest of the design. This must never touch a developer's real
// Postgres, so a process is only ever a candidate when BOTH hold:
//   * its command line contains our data-directory marker (`nuru-pg-`), and
//   * it is the embedded-postgres binary from a node_modules tree.
// A system postgres matches neither.
//
// Those two prove a process is OURS. They do not prove it is ABANDONED, and every
// checkout and worktree shares this port, so a healthy cluster on it is usually
// another suite mid-run. Reproduced on 2026-10-30: a suite started beside a running
// one reaped its cluster and logged "Left by a previous run that died before
// teardown" while that run was alive. 233 of the victim's 358 tests failed, and its
// workers, still connecting to the shared port, deadlocked the new suite's own
// setup, so neither run survived.
//
// So a cluster is an orphan only when its run is gone, and the kernel says so.
// embedded-postgres spawns the postmaster directly from the run's process, and a
// process whose parent dies is handed to pid 1 (launchd, init) on the spot. That
// needs no owner file, which could go stale, and it protects suites on older
// branches, which would never have written one. Where something other than pid 1
// adopts orphans (a Linux subreaper such as `systemd --user`) a dead run's cluster
// reads as owned, which costs a named failure instead of a reap: the cheap way
// round to be wrong.
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

/** Our test clusters live in mkdtemp(tmpdir(), "nuru-pg-") directories. */
const DATA_DIR_MARKER = "nuru-pg-";
/** …and are started by the vendored binary, never a system install. */
const BINARY_MARKER = "node_modules";
/** Who a process is handed to when its parent dies: launchd, or init. */
const ADOPTIVE_PARENT_PID = 1;
/** Far longer than a run ever takes to get from mkdtemp to a postmaster.pid. */
const STARTUP_GRACE_MS = 10 * 60_000;

export interface TestCluster {
  pid: number;
  /** The -D data directory, so it can be removed once the process is gone. */
  dataDir: string | null;
  command: string;
  /** The run that started it, until that run dies and pid 1 adopts it. */
  parentPid: number;
}

/** Every process listening on `port`, narrowed to ones that are ours, running or not. */
export function findTestClusters(port: number): TestCluster[] {
  let pids: string[] = [];
  try {
    pids = execFileSync("lsof", ["-ti", `:${port}`], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  } catch {
    return []; // lsof exits non-zero when nothing is listening — that is the good case.
  }

  const found: TestCluster[] = [];
  for (const raw of pids) {
    const pid = Number(raw);
    if (!Number.isInteger(pid) || pid <= 1) continue;
    let processInfo = "";
    try {
      processInfo = execFileSync("ps", ["-p", String(pid), "-o", "ppid=", "-o", "command="], { encoding: "utf8" }).trim();
    } catch {
      continue; // vanished between lsof and ps
    }
    const [, parentPid = "", command = ""] = /^(\d+)\s+(.*)$/s.exec(processInfo) ?? [];
    // Both markers, or we leave it strictly alone.
    if (!command.includes(DATA_DIR_MARKER) || !command.includes(BINARY_MARKER)) continue;
    const dataDir = /-D\s+(\S+)/.exec(command)?.[1] ?? null;
    found.push({ pid, dataDir, command, parentPid: Number(parentPid) });
  }
  return found;
}

/** Has the run that started this cluster gone? See the header for why this is the test. */
export function isOrphaned(cluster: TestCluster): boolean {
  return cluster.parentPid === ADOPTIVE_PARENT_PID;
}

/** Our clusters on `port` whose run is gone: the only ones it is safe to stop. */
export function findOrphanClusters(port: number): TestCluster[] {
  return findTestClusters(port).filter(isOrphaned);
}

/**
 * A cluster in words someone can act on. vitest retitles itself `node (vitest)`,
 * so a run's own command line says nothing about where it lives; the path of the
 * postmaster's binary does.
 */
export function describeCluster({ pid, parentPid, command }: TestCluster): string {
  const checkout = command.split(`/${BINARY_MARKER}/`)[0];
  return `postgres pid ${pid}, started by run pid ${parentPid} from ${checkout}`;
}

/**
 * Stop an orphaned cluster: SIGINT (fast shutdown) first, SIGKILL after a grace
 * period, then remove its data directory. Returns what it did, so the caller can
 * say so out loud rather than reaping silently.
 */
export function reapOrphanCluster(
  orphan: TestCluster,
  { graceMs = 5_000, sleep = (ms: number) => execFileSync("sleep", [String(ms / 1000)]) } = {},
): { pid: number; signal: "SIGINT" | "SIGKILL"; dataDirRemoved: boolean } {
  let signal: "SIGINT" | "SIGKILL" = "SIGINT";
  try {
    process.kill(orphan.pid, "SIGINT");
  } catch {
    /* already gone */
  }

  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && isAlive(orphan.pid)) sleep(250);

  if (isAlive(orphan.pid)) {
    signal = "SIGKILL";
    try {
      process.kill(orphan.pid, "SIGKILL");
    } catch {
      /* raced */
    }
    const hardDeadline = Date.now() + 2_000;
    while (Date.now() < hardDeadline && isAlive(orphan.pid)) sleep(250);
  }

  // A killed cluster leaves its whole data directory behind — ~180 MB each, and
  // they accumulate invisibly in the temp dir. 1.6 GB of them was found on this
  // machine on 2026-08-15, having helped fill the disk that killed the run that
  // created the last one.
  let dataDirRemoved = false;
  if (orphan.dataDir && orphan.dataDir.includes(DATA_DIR_MARKER) && !isAlive(orphan.pid)) {
    try {
      rmSync(orphan.dataDir, { recursive: true, force: true });
      dataDirRemoved = true;
    } catch {
      /* best effort — a leftover directory is untidy, not broken */
    }
  }
  return { pid: orphan.pid, signal, dataDirRemoved };
}

/**
 * Is a Postgres running out of `dataDir` right now — on ANY port, started by
 * ANY checkout? Postgres writes its pid as the first line of postmaster.pid and
 * removes the file on a clean stop, so a live pid there means hands off.
 *
 * The temp-dir sweep used to spare only directories of clusters on its OWN
 * port. On 2026-10-05 a run on a private port (55437) swept the directory of a
 * suite running on 55432, mid-run: 815 tests failed on "could not open file
 * base/16384/…". A stale pid file whose pid was reused reads as live, which
 * leaks one directory rather than destroying a running cluster.
 */
export function clusterRunningIn(dataDir: string): boolean {
  let pid: number;
  try {
    pid = Number(readFileSync(join(dataDir, "postmaster.pid"), "utf8").split("\n")[0]);
  } catch {
    return false; // no pid file: no postmaster has this directory open
  }
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM"; // alive, just not ours to signal
  }
}

/**
 * Could a run still be bringing a Postgres up in `dataDir`?
 *
 * clusterRunningIn only sees a postmaster once it has written postmaster.pid, and
 * a run creates its directory seconds before that, while initdb fills it. For
 * those seconds a directory in use looks exactly like an abandoned one: on
 * 2026-10-30 a suite started a second after another swept its directory out from
 * under initdb ("Postgres init script exited with code 1"). initdb keeps touching
 * the directory as it works, so one touched recently is left for a later sweep. A
 * crashed run's directory waits a few minutes longer; a live one survives.
 */
export function clusterStartingIn(dataDir: string): boolean {
  try {
    return Date.now() - statSync(dataDir).mtimeMs < STARTUP_GRACE_MS;
  } catch {
    return false; // already gone: nothing to spare
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
