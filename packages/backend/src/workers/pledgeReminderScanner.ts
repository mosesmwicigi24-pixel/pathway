// Pledge reminders (docs/PARTNERS_PROGRAMME.md §3): a notice three days
// before a due date, then — if the date passes unpaid — up to three polite
// follow-ups twelve hours apart, then silence. Every send honours the
// member's channel preferences, quiet hours and daily cap through
// NotificationService; every step is recorded in pledge_reminders so a due
// date is never nagged twice. Also flips completed total pledges to
// fulfilled with a thank-you.
import type { Pool } from "pg";
import type { Logger } from "pino";
import { PartnersService } from "../modules/financial/partners.js";
import type { NotificationService } from "../modules/notifications/service.js";

export class PledgeReminderScanner {
  private readonly partners: PartnersService;
  constructor(pool: Pool, private readonly notifications: NotificationService, private readonly log?: Logger) {
    this.partners = new PartnersService(pool);
  }

  async scanOnce(now = new Date()): Promise<{ due_soon: number; follow_ups: number; fulfilled: number }> {
    const fulfilled = await this.partners.fulfilCompleted(this.notifications, now);
    const r = await this.partners.sendDueReminders(this.notifications, now);
    if (fulfilled || r.due_soon || r.follow_ups) this.log?.info({ ...r, fulfilled }, "pledge reminders");
    return { ...r, fulfilled };
  }

  start(intervalMs: number): () => void {
    const tick = (): void => { void this.scanOnce().catch((e) => this.log?.error({ err: e }, "pledge reminder scan failed")); };
    tick();
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }
}
