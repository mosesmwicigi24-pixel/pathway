// Backend entry point. Boots config → DB pools → logger → HTTP server, with a
// graceful shutdown that drains the pools. The 10 service modules ship inside
// this one process (modular monolith) and can be split later (§1.5).
import "dotenv/config";
import { pino } from "pino";
import { loadEnv } from "./config/env.js";
import { createPools, closePools } from "./db/pool.js";
import { createApp } from "./http/app.js";
import { OutboxWorker } from "./workers/outbox.js";
import { buildOutboxHandlers } from "./workers/handlers.js";

function main(): void {
  const env = loadEnv();
  const log = pino({ level: env.LOG_LEVEL });
  const db = createPools(env);
  const ctx = { env, db, log };
  const app = createApp(ctx);

  // Drain the transactional outbox in-process (modular monolith). In a split
  // deployment this is its own worker; the contract is unchanged (§1.6).
  const outbox = new OutboxWorker(db.primary, buildOutboxHandlers(ctx), log);
  const stopOutbox = outbox.start(5_000);

  const server = app.listen(env.PORT, () => {
    log.info({ port: env.PORT, region: env.AWS_REGION, env: env.NODE_ENV }, "nuru backend up");
  });

  const shutdown = (signal: string): void => {
    log.info({ signal }, "shutting down");
    stopOutbox();
    server.close(() => {
      void closePools(db).then(() => process.exit(0));
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
