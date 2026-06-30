// Activity telemetry service. App-area dwell time (parity gap #3): the client
// batches per-screen dwell durations and posts them here. Best-effort — malformed
// rows are clamped/skipped, never 500. Idempotent on client_event_id so an offline
// replay of the same batch is a no-op (§2.1, §3.6). This is a usage signal only;
// it never originates gating, scoring, or money (§1.1).
import type { Pool } from "pg";

const MAX_DURATION_MS = 86_400_000; // one day; clamp anything larger

export interface ScreenEvent {
  screen: string;
  duration_ms: number;
  occurred_at: string;
  client_event_id: string;
}

export class ActivityService {
  constructor(private readonly pool: Pool) {}

  /**
   * Batch-insert screen dwell events for a member. Returns how many rows were
   * accepted (newly inserted). Duplicates by client_event_id are silently
   * skipped, so a replay reports fewer accepted than submitted.
   */
  async recordScreens(userId: string, events: ScreenEvent[]): Promise<number> {
    // Defensive clamp/skip: trim screen to 40 chars, floor duration at 0 and cap
    // at one day, require a parseable timestamp. Telemetry is never worth a 500.
    const rows: { screen: string; duration: number; occurredAt: Date; clientEventId: string }[] = [];
    for (const e of events) {
      const screen = String(e.screen).slice(0, 40);
      if (!screen) continue;
      const occurredAt = new Date(e.occurred_at);
      if (Number.isNaN(occurredAt.getTime())) continue;
      const duration = Math.max(0, Math.min(MAX_DURATION_MS, Math.trunc(e.duration_ms)));
      rows.push({ screen, duration, occurredAt, clientEventId: e.client_event_id });
    }
    if (rows.length === 0) return 0;

    // Single multi-row INSERT … ON CONFLICT (client_event_id) DO NOTHING. The
    // RETURNING count gives us the number of rows that were actually new.
    const values: string[] = [];
    const params: unknown[] = [];
    rows.forEach((r, i) => {
      const b = i * 5;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`);
      params.push(userId, r.screen, r.duration, r.occurredAt.toISOString(), r.clientEventId);
    });
    const res = await this.pool.query(
      `INSERT INTO app_screen_events (user_id, screen, duration_ms, occurred_at, client_event_id)
       VALUES ${values.join(", ")}
       ON CONFLICT (client_event_id) DO NOTHING
       RETURNING event_id`,
      params,
    );
    return res.rowCount ?? 0;
  }
}
