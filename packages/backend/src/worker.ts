// Background worker process (spec §1.6, §1.8, §2.4, §5.9) — separate deployable
// from the API. Runs the frequent pollers (outbox drain, notification dispatch,
// re-engagement scan) on intervals and the daily jobs (engagement recompute,
// partition maintenance, is_minor refresh) on cron. Every job is idempotent and
// concurrency-safe (SKIP LOCKED / IF NOT EXISTS), so multiple worker replicas are
// fine. Graceful shutdown stops schedulers and drains the pools.
import "dotenv/config";
import { pino } from "pino";
import cron from "node-cron";
import { loadEnv } from "./config/env.js";
import { createPools, closePools } from "./db/pool.js";
import { buildRedis } from "./redis.js";
import { OutboxWorker } from "./workers/outbox.js";
import { buildOutboxHandlers } from "./workers/handlers.js";
import { NotificationWorker } from "./workers/notificationWorker.js";
import { buildDispatchProvider } from "./workers/dispatch.js";
import { NudgeScanner } from "./workers/nudgeScanner.js";
import { NotificationService } from "./modules/notifications/service.js";
import { EngagementService } from "./modules/engagement/service.js";
import { PartitionMaintenance, refreshMinorFlags } from "./jobs/maintenance.js";
import { GamificationService } from "./modules/gamification/service.js";
import { AnnouncementService } from "./modules/announcements/service.js";
import { CalendarService } from "./modules/calendar/service.js";
import { buildEmailProvider } from "./modules/identity/email.js";
import { FinancialService } from "./modules/financial/service.js";
import { buildPaymentGateway } from "./modules/financial/gateway.js";
import { buildMobileMoneyProviders } from "./modules/financial/providers.js";
import { RadioService } from "./modules/radio/service.js";
import { buildStreamProvider } from "./modules/radio/provider.js";
import { buildAiProvider } from "./modules/assistant/provider.js";
import { ContentIndexService } from "./modules/intelligence/content.js";
import { StoryService } from "./modules/intelligence/story.js";
import { LettersService } from "./modules/intelligence/letters.js";
import { SignalsService } from "./modules/intelligence/signals.js";
import { LiturgyService } from "./modules/intelligence/liturgy.js";
import { CommunityService } from "./modules/intelligence/community.js";
import { LiveService } from "./modules/live/service.js";

function main(): void {
  const env = loadEnv();
  const log = pino({ level: env.LOG_LEVEL });
  const db = createPools(env);
  const redis = buildRedis(env);
  const ctx = { env, db, log, redis };

  // Frequent pollers (their own intervals; each returns a stop()).
  const stops: Array<() => void> = [
    new OutboxWorker(db.primary, buildOutboxHandlers(ctx), log).start(5_000),
    new NotificationWorker(db.primary, buildDispatchProvider(env, log), log).start(10_000),
    new NudgeScanner(db.primary, new NotificationService(db.primary), log).start(60 * 60 * 1000),
  ];

  // Scheduled announcements: dispatch any whose send time has arrived (B5).
  // dispatchDue() is idempotent per (recipient, channel), so overlap is safe.
  // EVENTS_ARCHITECTURE §5: the email channel rides the same SMTP EmailProvider
  // as password reset (Brevo in prod; logging fallback when SMTP env is absent,
  // so dev/tests run offline). SMS/WhatsApp have NO provider bound — deliveries
  // record suppressed(no_provider), never a fabricated "delivered".
  const announcements = new AnnouncementService(db.primary, { email: buildEmailProvider(env, log) });
  const annTimer = setInterval(
    () => void announcements.dispatchDue().catch((err) => log.error({ err }, "announcement dispatch failed")),
    60_000,
  );
  stops.push(() => clearInterval(annTimer));

  // Recurring giving (B7): the server creates each cycle's intent. Deterministic
  // per-cycle idempotency keys make overlapping/restarted runs double-charge-proof.
  const financial = new FinancialService(db.primary, buildPaymentGateway(env), buildMobileMoneyProviders(env));
  const schedTimer = setInterval(
    () => void financial.runDueSchedules().catch((err) => log.error({ err }, "giving schedule run failed")),
    5 * 60_000,
  );
  stops.push(() => clearInterval(schedTimer));

  // Radio auto-air (ADDENDUM): air scheduled programs at their time + auto-end
  // live ones past their duration. Single worker → the is_live-guarded sweep is
  // double-fire-safe; each goLive/end is isolated. ~30s tick.
  const radio = new RadioService(db.primary, buildStreamProvider(env));
  const radioTimer = setInterval(
    () => void radio.airDueEvents().catch((err) => log.error({ err }, "radio auto-air failed")),
    30_000,
  );
  stops.push(() => clearInterval(radioTimer));

  // Nuru Live (docs/LIVE_STREAMING.md L1): auto-end orphaned streams — first
  // the publisher-liveness check (MediaMTX confirms no publisher, past a 90s
  // grace) which is how most broadcaster-crashed streams actually get
  // cleared within minutes; the 12h absolute fallback still catches anything
  // left over from a sustained MediaMTX control-API outage. Also registers a
  // recording_url once MediaMTX's fMP4 segment for the window shows up on
  // disk. ~2min tick.
  const live = new LiveService(
    db.primary,
    env.LIVE_RECORDINGS_DIR,
    env.LIVE_RTMP_BASE_URL,
    undefined,
    undefined,
    undefined,
    undefined,
    env.LIVE_MEDIAMTX_API_BASE,
  );
  const liveTimer = setInterval(
    () => void live.sweep().catch((err) => log.error({ err }, "live sweep failed")),
    2 * 60_000,
  );
  stops.push(() => clearInterval(liveTimer));

  // Daily jobs on cron (server local time). Each guards its own errors.
  const engagement = new EngagementService(db.primary, db.replica);
  const partitions = new PartitionMaintenance(db.primary);
  const gamification = new GamificationService(db.primary);
  const safe = (label: string, fn: () => Promise<unknown>) => () =>
    void fn().catch((err) => log.error({ err }, `${label} failed`));

  // Intelligence layer (AI Phase 1): nightly content reindex + Member Story
  // rebuild (03:00 EAT), and the Sunday Letter run (Sunday 16:00 EAT). Every
  // job is idempotent (wipe+refill index; story upsert; letters UNIQUE per
  // user+week), and a missing AI key degrades to the offline fake provider.
  const aiProvider = buildAiProvider(env);
  const contentIndex = new ContentIndexService(db.primary);
  const memberStory = new StoryService(db.primary, aiProvider);
  const intelNotifications = new NotificationService(db.primary);
  const letters = new LettersService(db.primary, aiProvider, memberStory, contentIndex, intelNotifications);
  const pulse = new SignalsService(db.primary, aiProvider, memberStory, intelNotifications);
  const liturgy = new LiturgyService(db.primary, aiProvider);
  const communityIntel = new CommunityService(db.primary, intelNotifications);

  // EVENTS_ARCHITECTURE §2/§7: the calendar's reconcile sweep + automation crons.
  const calendar = new CalendarService(db.primary, env.CAL_MAX_INSTANCES);

  const tasks = [
    cron.schedule("0 2 * * *", safe("engagement recompute", () => engagement.runRecompute())),
    // §2: nightly reconcile — materialize a rolling [now, now+90d] window for
    // every active series AND refresh/prune drifted materialized rows.
    cron.schedule("30 2 * * *", safe("events reconcile sweep", async () => {
      const out = await calendar.reconcileSweep();
      log.info(out, "events reconciled");
    })),
    // §7: per-series automations (auto-archive daily; low-RSVP alerts hourly).
    cron.schedule("0 5 * * *", safe("events auto-archive", async () => {
      const n = await calendar.runAutoArchive();
      if (n > 0) log.info({ archived: n }, "occurrences auto-archived");
    })),
    cron.schedule("15 * * * *", safe("low-RSVP alerts", async () => {
      const n = await calendar.runLowRsvpAlerts();
      if (n > 0) log.info({ alerted: n }, "low-RSVP alerts sent");
    })),
    cron.schedule("0 0 * * *", safe("intelligence reindex + story rebuild", async () => {
      await contentIndex.reindexAll();
      const { rebuilt } = await memberStory.rebuildAll();
      log.info({ rebuilt }, "member stories rebuilt");
    })),
    cron.schedule("0 13 * * 0", safe("sunday letters", async () => {
      const out = await letters.runWeekly();
      log.info(out, "sunday letters written");
    })),
    // Shepherd's Pulse: nightly drift + emotion scan (after stories), and the
    // leaders' Flock Brief on Saturday 16:00 UTC (19:00 EAT — read before Sunday).
    cron.schedule("30 0 * * *", safe("shepherds pulse scan", async () => {
      const out = await pulse.runNightly();
      log.info(out, "pulse signals scanned");
    })),
    cron.schedule("0 16 * * 6", safe("flock briefs", async () => {
      const out = await pulse.composeBriefs();
      log.info(out, "flock briefs written");
    })),
    // Phase 4 — the liturgy Home + community intelligence.
    // 01:00 UTC = 04:00 EAT: today's liturgy is ready before the first riser.
    cron.schedule("0 1 * * *", safe("daily liturgy", async () => {
      const n = await liturgy.composeAll();
      log.info({ composed: n }, "daily liturgy composed");
    })),
    cron.schedule("45 0 * * *", safe("community moments scan", async () => {
      const n = await communityIntel.scanMoments();
      log.info({ inserted: n }, "community moments detected");
    })),
    cron.schedule("*/15 * * * *", safe("prayer chains", async () => {
      const n = await communityIntel.scanPrayerChains();
      if (n > 0) log.info({ nudged: n }, "prayer chain invitations sent");
    })),
    cron.schedule("0 3 * * *", safe("partition maintenance", () => partitions.run())),
    cron.schedule("0 4 * * *", safe("is_minor refresh", () => refreshMinorFlags(db.primary))),
    cron.schedule("0 4 * * *", safe("streak recompute", () => gamification.recomputeActiveStreaks())),
  ];

  log.info({ region: env.AWS_REGION, env: env.NODE_ENV }, "nuru worker up");

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "worker shutting down");
    for (const stop of stops) stop();
    for (const task of tasks) task.stop();
    void closePools(db).then(() => {
      if (redis) redis.disconnect();
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
