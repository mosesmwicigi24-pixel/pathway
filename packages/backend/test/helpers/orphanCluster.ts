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
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

/** Our test clusters live in mkdtemp(tmpdir(), "nuru-pg-") directories. */
const DATA_DIR_MARKER = "nuru-pg-";
/** …and are started by the vendored binary, never a system install. */
const BINARY_MARKER = "node_modules";

export interface OrphanCluster {
  pid: number;
  /** The -D data directory, so it can be removed once the process is gone. */
  dataDir: string | null;
  command: string;
}

/** Every process listening on `port`, narrowed to ones that are ours. */
export function findOrphanClusters(port: number): OrphanCluster[] {
  let pids: string[] = [];
  try {
    pids = execFileSync("lsof", ["-ti", `:${port}`], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  } catch {
    return []; // lsof exits non-zero when nothing is listening — that is the good case.
  }

  const found: OrphanCluster[] = [];
  for (const raw of pids) {
    const pid = Number(raw);
    if (!Number.isInteger(pid) || pid <= 1) continue;
    let command = "";
    try {
      command = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).trim();
    } catch {
      continue; // vanished between lsof and ps
    }
    // Both markers, or we leave it strictly alone.
    if (!command.includes(DATA_DIR_MARKER) || !command.includes(BINARY_MARKER)) continue;
    const dataDir = /-D\s+(\S+)/.exec(command)?.[1] ?? null;
    found.push({ pid, dataDir, command });
  }
  return found;
}

/**
 * Stop an orphaned cluster: SIGINT (fast shutdown) first, SIGKILL after a grace
 * period, then remove its data directory. Returns what it did, so the caller can
 * say so out loud rather than reaping silently.
 */
export function reapOrphanCluster(
  orphan: OrphanCluster,
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

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
