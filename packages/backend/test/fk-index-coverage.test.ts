// Every cascade path out of a parent row must be indexed (migration 191).
//
// Postgres indexes the primary key a foreign key POINTS AT, never the foreign
// key column itself. So an unindexed FK column can only be searched by
// sequential scan — and ON DELETE CASCADE / SET NULL has to search it on every
// parent delete. Before migration 191, deleting one user scanned 45 tables.
//
// This runs against the real migrated schema, so it fails the moment someone
// adds a cascading FK without an index — which is the only way this stays true.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";

beforeAll(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPool();
});

describe("foreign-key index coverage", () => {
  it("no single-column CASCADE/SET NULL foreign key is left unindexed", async () => {
    const { rows } = await testPool().query<{ child: string; col: string; parent: string }>(
      `SELECT c.conrelid::regclass::text AS child,
              a.attname                  AS col,
              c.confrelid::regclass::text AS parent
         FROM pg_constraint c
         JOIN unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON k.ord = 1
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        WHERE c.contype = 'f'
          AND array_length(c.conkey, 1) = 1
          AND c.confdeltype IN ('c', 'n')
          AND NOT EXISTS (
                SELECT 1 FROM pg_index i
                 WHERE i.indrelid = c.conrelid AND i.indkey[0] = a.attnum)
        ORDER BY 1, 2`,
    );

    // Named, not counted: a failure should say WHICH delete path degraded.
    expect(rows.map((r) => `${r.child}.${r.col} -> ${r.parent}`)).toEqual([]);
  });
});
