// Guards the test harness's own isolation guarantee.
//
// The suite shares one embedded Postgres and resets it between tests. That reset
// is only sound if nothing else is writing while it runs: an un-awaited write
// that outlives its HTTP response still holds row locks when the next test's
// TRUNCATE asks for AccessExclusiveLock, and the two deadlock — killing the
// TRUNCATE, so an unrelated test fails in its beforeEach. It surfaced as a
// different file failing on each full run (docs/PARITY_AUDIT.md, 2026-08-13).
//
// These tests pin the two halves of the fix: fire-and-forget work is tracked and
// drainable, and a reset that *does* meet contention says so instead of
// deadlocking somewhere else minutes later.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { testEnv } from "./helpers/app.js";
import { background, drainBackgroundWork, pendingBackgroundWork } from "../src/db/background.js";
import { IdentityService } from "../src/modules/identity/service.js";

describe("test isolation — background writes are drained, not raced", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("tracks fire-and-forget work and drainBackgroundWork() waits for it", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    background(gate);
    expect(pendingBackgroundWork()).toBe(1);

    let drained = false;
    const draining = drainBackgroundWork().then(() => (drained = true));
    await Promise.resolve();
    expect(drained).toBe(false); // still waiting on the gate

    release();
    await draining;
    expect(drained).toBe(true);
    expect(pendingBackgroundWork()).toBe(0);
  });

  it("swallows a failing background write without rejecting the drain", async () => {
    background(Promise.reject(new Error("telemetry hiccup")));
    await expect(drainBackgroundWork()).resolves.toBeUndefined();
    expect(pendingBackgroundWork()).toBe(0);
  });

  it("login telemetry is tracked, so it has landed once the drain returns", async () => {
    // issueSession() fires the auth_events INSERT without awaiting it — the write
    // that used to still be open when the next test's TRUNCATE started.
    const svc = new IdentityService(testPool(), testEnv());
    await svc.loginWithOAuth({ provider: "kingschat", sub: "kc-drain", fullName: "Ada" });

    await drainBackgroundWork();

    const { rows } = await testPool().query<{ n: number }>(
      `SELECT count(*)::int n FROM auth_events WHERE kind = 'login'`,
    );
    expect(rows[0]!.n).toBe(1);
  });

  it("reports contention plainly instead of deadlocking when a write escapes the drain", async () => {
    // Stand in for an untracked straggler: hold a RowExclusiveLock that TRUNCATE
    // cannot take. The reset must fail fast, naming the cause.
    const holder = await testPool().connect();
    try {
      await holder.query("BEGIN");
      await holder.query(`INSERT INTO congregations (name, country) VALUES ('Lock Holder', 'KE')`);

      await expect(resetDb({ lockTimeoutMs: 300 })).rejects.toThrow(/could not take its TRUNCATE locks/);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
  });
});
