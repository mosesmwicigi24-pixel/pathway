// Vitest globalSetup: boot a single embedded PostgreSQL for the whole run,
// apply all §2 migrations and the seeds, expose its DSN via a fixed port so test
// workers connect to the same instance. Teardown stops it.
import type EmbeddedPostgres from "embedded-postgres";
import migrationRunner from "node-pg-migrate";
import pg from "pg";
import net from "node:net";
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(here, "..", "..");
export const TEST_PG_PORT = 55432;
export const TEST_DATABASE_URL = `postgres://nuru:nuru@localhost:${TEST_PG_PORT}/nuru_test`;

type EmbeddedPostgresCtor = new (options: ConstructorParameters<typeof EmbeddedPostgres>[0]) => EmbeddedPostgres;

let epg: EmbeddedPostgres;
/** The process listeners `embedded-postgres` installs — see teardown(). */
let installedExitHooks: Array<{ event: "beforeExit" | "exit"; listener: (...args: never[]) => void }> = [];

/** Resolves once nothing is listening on the test port, or throws saying who is. */
async function awaitFreePort(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const busy = await new Promise<boolean>((resolve) => {
      const probe = net
        .connect({ host: "127.0.0.1", port: TEST_PG_PORT })
        .on("connect", () => {
          probe.destroy();
          resolve(true);
        })
        .on("error", () => resolve(false));
    });
    if (!busy) return;
    if (Date.now() > deadline) {
      throw new Error(
        `Port ${TEST_PG_PORT} is still in use after ${timeoutMs}ms. A previous run's embedded Postgres ` +
          `is likely orphaned — the suite would otherwise silently run against that stale cluster. ` +
          `Stop it with: pkill -f 'nuru-pg-'`,
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }
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
