// Shared application context handed to every module's register() hook. Holds the
// cross-cutting singletons (config, DB pools, logger) so modules stay stateless
// and hold no connections of their own (§1.1 "Stateless services, stateful data").
import type { Logger } from "pino";
import type { Redis } from "ioredis";
import type { Env } from "../config/env.js";
import type { DbPools } from "../db/pool.js";
import type { ObjectStore } from "../modules/certificates/objectStore.js";
import type { WebAuthnVerifier } from "../modules/identity/webauthn.js";
import type { MessageProvider } from "../modules/announcements/providers.js";
import type { AiProvider } from "../modules/assistant/provider.js";

export interface AppContext {
  env: Env;
  db: DbPools;
  log: Logger;
  // Present when REDIS_URL is configured (sessions/cache/rate-limit, §1.6). Optional
  // so tests and Redis-less dev still build a working app.
  redis?: Redis | undefined;
  // Object storage for rendered artifacts (certificate PDFs, §4.5). Optional —
  // modules fall back to buildObjectStore(env) (disk under MEDIA_STORAGE_DIR);
  // tests inject an InMemoryObjectStore shared between issuer and download route.
  objectStore?: ObjectStore | undefined;
  // Passkey ceremony verifier (§5.3). Optional — identity falls back to the real
  // @simplewebauthn adapter; tests inject FakeWebAuthnVerifier (no authenticator
  // hardware in CI).
  webauthnVerifier?: WebAuthnVerifier | undefined;
  // Outbound SMS (§5.10, keys by name only). Optional — the worker falls back to
  // buildSmsProvider(env), which binds Africa's Talking when it is configured
  // and nothing when it is not; tests inject FakeMessageProvider so no message
  // ever costs the church a shilling in CI.
  smsProvider?: MessageProvider | undefined;
  // Nuru AI (§AI layer). Optional — workers fall back to buildAiProvider(env),
  // Claude when ANTHROPIC_API_KEY is set; tests inject a stub so no receipt
  // copy ever depends on the network in CI.
  aiProvider?: AiProvider | undefined;
}
