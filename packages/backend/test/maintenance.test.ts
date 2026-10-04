// Scheduled maintenance — partition provision/prune around the 13-month boundary
// and the nightly is_minor refresh (§2.4, §5.9).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser, birthDateForAge } from "./helpers/factories.js";
import { PartitionMaintenance, refreshMinorFlags } from "../src/jobs/maintenance.js";

const partExists = async (name: string): Promise<boolean> =>
  (await testPool().query("SELECT 1 FROM pg_class WHERE relname=$1", [name])).rowCount === 1;

/** The partition for the DATABASE's current month + offset — the month the
 *  provisioning function itself reads (CURRENT_DATE, in the server's zone).
 *  Node's UTC month disagreed with it in the last three hours of every month
 *  on a Nairobi-zoned server: harmless while the migrations' 2026 partitions
 *  existed, a failure on every month-end evening from 31 Jan 2027. */
const ym = async (offsetMonths: number): Promise<string> =>
  (await testPool().query<{ name: string }>(
    `SELECT 'interaction_events_' || to_char(date_trunc('month', CURRENT_DATE) + make_interval(months => $1), 'YYYY_MM') AS name`,
    [offsetMonths],
  )).rows[0]!.name;

describe("partition maintenance (§2.4, §5.9)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("provisions current + next 2 months and prunes partitions older than 13 months", async () => {
    const pm = new PartitionMaintenance(testPool());
    await pm.provision(2);
    expect(await partExists(await ym(0))).toBe(true);
    expect(await partExists(await ym(2))).toBe(true);

    // An old partition (well beyond 13 months) gets pruned; a current one survives.
    await testPool().query(
      `CREATE TABLE IF NOT EXISTS interaction_events_2020_01
         PARTITION OF interaction_events FOR VALUES FROM ('2020-01-01') TO ('2020-02-01')`,
    );
    expect(await partExists("interaction_events_2020_01")).toBe(true);

    await pm.prune(13);
    expect(await partExists("interaction_events_2020_01")).toBe(false); // dropped
    expect(await partExists(await ym(0))).toBe(true); // kept
  });
});

describe("is_minor nightly refresh (§5.9)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("repairs a stale is_minor flag in both directions", async () => {
    const cong = await createCongregation();
    const minor = (await createUser({ congregationId: cong, dateOfBirth: birthDateForAge(11) })).user_id; // ~child
    const adult = (await createUser({ congregationId: cong, dateOfBirth: "1990-01-01", email: "a@dev.local" })).user_id;

    // Force the flags stale WITHOUT touching date_of_birth (so the trigger doesn't fix them).
    await testPool().query("UPDATE users SET is_minor = FALSE WHERE user_id=$1", [minor]);
    await testPool().query("UPDATE users SET is_minor = TRUE WHERE user_id=$1", [adult]);

    const { updated } = await refreshMinorFlags(testPool());
    expect(updated).toBe(2);

    const rows = await testPool().query("SELECT user_id, is_minor FROM users WHERE user_id = ANY($1)", [
      [minor, adult],
    ]);
    const byId = Object.fromEntries(rows.rows.map((r) => [r.user_id, r.is_minor]));
    expect(byId[minor]).toBe(true);
    expect(byId[adult]).toBe(false);
  });
});
