// One run at a time (Giving Cycle 8). A timer that fires while the previous
// run is still going skips that tick and says so — instead of starting a
// second run over the same rows (a slow provider used to stack scheduler runs
// on top of each other, each re-reading the same due schedules).
export interface TickLog {
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export function oneAtATime(name: string, run: () => Promise<unknown>, log?: TickLog): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) {
      log?.warn({ job: name }, "previous run still going — skipping this tick");
      return;
    }
    running = true;
    try {
      await run();
    } catch (err) {
      log?.error({ err }, `${name} failed`);
    } finally {
      running = false;
    }
  };
}
