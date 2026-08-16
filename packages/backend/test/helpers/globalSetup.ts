// Vitest globalSetup: boot a single embedded PostgreSQL for the whole run,
// apply all §2 migrations and the seeds, expose its DSN via a fixed port so test
// workers connect to the same instance. Teardown stops it.
import type EmbeddedPostgres from "embedded-postgres";
import migrationRunner from "node-pg-migrate";
import pg from "pg";
import net from "node:net";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findOrphanClusters, reapOrphanCluster } from "./orphanCluster.js";

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(here, "..", "..");
export const TEST_PG_PORT = 55432;
export const TEST_DATABASE_URL = `postgres://nuru:nuru@localhost:${TEST_PG_PORT}/nuru_test`;

type EmbeddedPostgresCtor = new (options: ConstructorParameters<typeof EmbeddedPostgres>[0]) => EmbeddedPostgres;

let epg: EmbeddedPostgres;
/** This run's data dir — never swept while in use. */
let currentDataDir = "";
/** The process listeners `embedded-postgres` installs — see teardown(). */
let installedExitHooks: Array<{ event: "beforeExit" | "exit"; listener: (...args: never[]) => void }> = [];

const portInUse = (): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    const probe = net
      .connect({ host: "127.0.0.1", port: TEST_PG_PORT })
      .on("connect", () => {
        probe.destroy();
        resolve(true);
      })
      .on("error", () => resolve(false));
  });

/**
 * Ensure nothing is on the test port — reaping a previous run's cluster if that
 * is what is there.
 *
 * Waiting alone was not enough. A crashed run leaves a postmaster holding 55432
 * with no one to stop it, so every subsequent run failed until a human noticed
 * and intervened — and the intervention the old message suggested
 * (`pkill -f 'nuru-pg-'`) was observed to report success and change nothing on
 * 2026-08-15 — only `kill -9` freed the port. That run had died with the disk
 * full, and a graceful shutdown needs to write a checkpoint. Reproduced on a
 * healthy disk, pkill works fine, so the disk is the likeliest difference.
 *
 * So identify it, prove it is ours, and stop it properly (SIGINT, then SIGKILL).
 * Anything on that port that is NOT ours is still a hard error — reaping a
 * developer's real database because it happened to be on 55432 would be a far
 * worse failure than the one being fixed.
 */
async function awaitFreePort(timeoutMs = 60_000): Promise<void> {
  if (await portInUse()) {
    for (const orphan of findOrphanClusters(TEST_PG_PORT)) {
      const { pid, signal, dataDirRemoved } = reapOrphanCluster(orphan);
      // Say it out loud. A test harness that silently kills processes is its own
      // kind of problem.
      console.warn(
        `[test] reaped an orphaned embedded Postgres on port ${TEST_PG_PORT} ` +
          `(pid ${pid}, ${signal}${dataDirRemoved ? ", data dir removed" : ""}). ` +
          `Left by a previous run that died before teardown.`,
      );
    }
  }

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!(await portInUse())) return;
    if (Date.now() > deadline) {
      const stranger = findOrphanClusters(TEST_PG_PORT).length === 0;
      throw new Error(
        `Port ${TEST_PG_PORT} is still in use after ${timeoutMs}ms. ` +
          (stranger
            ? `Whatever holds it is NOT one of our test clusters (no nuru-pg- data dir), so it was left ` +
              `alone deliberately. Find it with: lsof -ti :${TEST_PG_PORT}`
            : `An orphaned test cluster would not stop, even after SIGINT and SIGKILL. Check free disk ` +
              `space — a Postgres shutdown has to write a checkpoint. Then: kill -9 $(lsof -ti :${TEST_PG_PORT})`) +
          ` — the suite refuses to run against a stale cluster.`,
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * Remove test cluster directories left by runs that died before teardown. Each
 * is ~180 MB; 1.6 GB of them was found on one machine, having helped fill the
 * disk whose filling killed the run that created the newest one. Only
 * directories with no live process are touched.
 */
function sweepAbandonedDataDirs(): void {
  const live = new Set(findOrphanClusters(TEST_PG_PORT).map((o) => o.dataDir));
  let freed = 0;
  for (const dir of readdirSync(tmpdir()).filter((d) => d.startsWith("nuru-pg-"))) {
    const full = join(tmpdir(), dir);
    if (live.has(full) || full === currentDataDir) continue;
    try {
      rmSync(full, { recursive: true, force: true });
      freed += 1;
    } catch {
      /* in use by another checkout's run, or gone already */
    }
  }
  if (freed > 0) console.warn(`[test] swept ${freed} abandoned test cluster director${freed === 1 ? "y" : "ies"}.`);
}

/**
 * Import embedded-postgres, noting which process listeners it installs on the way
 * in. It pulls in async-exit-hook, whose 'beforeExit' registration ends in
 * `process.exit(0)` — clobbering the non-zero exit code vitest sets for a failing
 * run, so `pnpm test` reported success on a red suite (in CI too). Teardown drops
 * exactly these two listeners once the cluster is down; the signal registrations
 * (SIGINT/SIGTERM/…) are left alone, so Ctrl-C still cleans up.
 */
async function importEmbeddedPostgres(): Promise<EmbeddedPostgresCtor> {
  const before = { beforeExit: new Set(process.listeners("beforeExit")), exit: new Set(process.listeners("exit")) };
  const mod = await import("embedded-postgres");
  installedExitHooks = (["beforeExit", "exit"] as const).flatMap((event) =>
    process
      .listeners(event)
      .filter((l) => !before[event].has(l))
      .map((listener) => ({ event, listener: listener as (...args: never[]) => void })),
  );
  return mod.default;
}

export async function setup(): Promise<void> {
  // A previous run's cluster can outlive its vitest process (its shutdown
  // checkpoint takes seconds and grows with the run). Binding would fail and the
  // whole suite would collapse with an unattributable error, so wait it out and
  // say so plainly if it never clears.
  await awaitFreePort();

  const EmbeddedPostgresCtor = await importEmbeddedPostgres();
  const dataDir = mkdtempSync(join(tmpdir(), "nuru-pg-"));
  currentDataDir = dataDir;
  // Now that we know which directory is ours, clear out the dead ones.
  sweepAbandonedDataDirs();
  epg = new EmbeddedPostgresCtor({
    databaseDir: dataDir,
    user: "nuru",
    password: "nuru",
    port: TEST_PG_PORT,
    persistent: false,
  });
  await epg.initialise();
  await epg.start();
  await epg.createDatabase("nuru_test");

  await migrationRunner({
    databaseUrl: TEST_DATABASE_URL,
    dir: join(backendRoot, "migrations"),
    migrationsTable: "pgmigrations",
    direction: "up",
    count: Infinity,
    log: () => {},
  });

  const c = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await c.connect();
  const seedDir = join(backendRoot, "seeds");
  for (const f of readdirSync(seedDir).filter((f) => f.endsWith(".sql") && !f.includes("placeholder")).sort()) {
    await c.query(readFileSync(join(seedDir, f), "utf8"));
  }
  await c.end();
}

export async function teardown(): Promise<void> {
  if (epg) await epg.stop();
  // The cluster is down, so async-exit-hook's at-exit cleanup has nothing left to
  // do — and leaving it registered would force process.exit(0) over a failing
  // run's exit code. Drop it and let the real exit code stand.
  for (const { event, listener } of installedExitHooks) process.removeListener(event, listener);
  installedExitHooks = [];
}
