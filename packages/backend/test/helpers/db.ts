// Per-test database access: a shared pool against the embedded Postgres from
// globalSetup, plus resetDb() to truncate between tests and re-apply seeds.
import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drainBackgroundWork, pendingBackgroundWork } from "../../src/db/background.js";

const here = dirname(fileURLToPath(import.meta.url));
const seedDir = join(here, "..", "..", "seeds");
const TEST_DATABASE_URL = "postgres://nuru:nuru@localhost:55432/nuru_test";

let pool: pg.Pool | null = null;

export function testPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
  return pool;
}

export async function closeTestPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Truncate all data tables (keep schema), then re-apply the level/fund seeds.
 *
 * Two properties matter beyond "the tables are empty", both learned the hard way
 * (docs/PARITY_AUDIT.md, 2026-08-13):
 *
 *  1. **Quiesce first.** A request can return to supertest while a fire-and-forget
 *     write is still open on another pooled connection. TRUNCATE then wants
 *     AccessExclusiveLock on that table while the straggler wants RowShareLock on
 *     `users` for its FK check — a lock cycle, and Postgres kills the TRUNCATE, so
 *     the *next* test fails in its beforeEach. Draining first means there is
 *     nothing to race. Anything fire-and-forget must go through `background()`.
 *
 *  2. **Stable lock order.** `pg_tables` returns catalog order, which shifts as
 *     TRUNCATE rewrites relfilenodes — so the same reset locked the same tables in
 *     a *different* order on every call, which is what turned a collision into a
 *     random deadlock rather than a deterministic wait. ORDER BY tablename pins it.
 *
 * `lock_timeout` is the backstop: if some future write skips `background()`, the
 * reset fails fast with a message naming the cause instead of deadlocking in an
 * unrelated file minutes later.
 */
export async function resetDb(opts: { lockTimeoutMs?: number } = {}): Promise<void> {
  const p = testPool();
  await drainBackgroundWork();

  const { rows } = await p.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname='public' AND tablename NOT IN ('pgmigrations')
       AND tablename NOT LIKE 'interaction\\_events\\_%'
     ORDER BY tablename`,
  );
  const tables = rows.map((r) => `"${r.tablename}"`).join(", ");
  if (tables) {
    const client = await p.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL lock_timeout = ${Math.max(1, opts.lockTimeoutMs ?? 5_000)}`);
      await client.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw explainResetFailure(err);
    } finally {
      client.release();
    }
  }
  for (const f of readdirSync(seedDir).filter((f) => f.endsWith(".sql") && !f.includes("placeholder")).sort()) {
    await p.query(readFileSync(join(seedDir, f), "utf8"));
  }
}

/** Turn "lock_timeout"/"deadlock detected" into the actionable diagnosis. */
function explainResetFailure(err: unknown): unknown {
  const code = (err as { code?: string } | null)?.code;
  if (code !== "55P03" && code !== "40P01") return err; // lock_not_available / deadlock_detected
  return new Error(
    `resetDb() could not take its TRUNCATE locks (${code}): another connection is still writing to this ` +
      `database. That is almost always an un-awaited write that outlived its HTTP response — route it ` +
      `through background() in src/db/background.ts so the harness can drain it. ` +
      `(${pendingBackgroundWork()} tracked write(s) pending at failure.)`,
    { cause: err },
  );
}
