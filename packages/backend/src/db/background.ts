// Tracked fire-and-forget work. Some writes must never block or fail the request
// that triggered them — login telemetry (auth_events), AI usage metering
// (ai_usage_events). Discarding the promise outright (`void pool.query(...)`)
// makes that true but leaves the write *invisible*: nothing can tell whether it
// is still in flight. Two things need to know.
//
//   • Graceful shutdown — a SIGTERM during a deploy dropped whatever telemetry
//     was mid-write, silently.
//   • The test harness — an un-awaited INSERT outlives the HTTP response, so it
//     is still holding row locks when the NEXT test's resetDb() runs
//     TRUNCATE over every table. TRUNCATE wants AccessExclusiveLock on the
//     straggler's table while the straggler wants RowShareLock on `users` for
//     its FK check: a lock cycle, and Postgres kills the TRUNCATE. That is the
//     flake documented in docs/PARITY_AUDIT.md (2026-08-13).
//
// So: still fire-and-forget for the caller (never awaited, never throws), but
// registered, so `drainBackgroundWork()` can wait for quiescence.
const pending = new Set<Promise<void>>();

/**
 * Register side work that the caller must not wait on. Errors are swallowed —
 * a telemetry hiccup can never surface to (or slow down) the member waiting on
 * the real response — but the promise stays observable until it settles.
 */
export function background(work: Promise<unknown>): void {
  const tracked: Promise<void> = work.then(
    () => {
      pending.delete(tracked);
    },
    () => {
      pending.delete(tracked);
    },
  );
  pending.add(tracked);
}

/** How many registered writes are still in flight (diagnostics). */
export function pendingBackgroundWork(): number {
  return pending.size;
}

/**
 * Wait until every registered write has settled. Loops rather than awaiting
 * once, because draining one write can schedule another. Throws past the
 * deadline instead of hanging, so a stuck write is reported rather than
 * silently waited on forever.
 */
export async function drainBackgroundWork(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (pending.size > 0) {
    if (Date.now() > deadline) {
      throw new Error(`drainBackgroundWork: ${pending.size} write(s) still in flight after ${timeoutMs}ms`);
    }
    await Promise.all([...pending]);
  }
}
