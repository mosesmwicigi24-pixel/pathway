// Environment configuration (spec Appendix B.1). Validated once at boot; the rest
// of the app imports the typed `env` object. Secrets are read from the process
// environment only — never hard-coded (§5.10).
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "staging", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  AWS_REGION: z.string().default("af-south-1"),

  DATABASE_URL: z.string().url(),
  DATABASE_REPLICA_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),

  JWT_SIGNING_KEY: z.string().min(1),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  // Persistent login: the refresh token slides forward on every use (rotation
  // re-stamps expires_at), so a ~10-year window means a session never expires on
  // its own — it ends only on explicit logout (revokeFamily) or token-reuse theft
  // detection. The 15-min access token is refreshed transparently underneath.
  REFRESH_TTL: z.coerce.number().int().positive().default(315_360_000),

  KINGSCHAT_OIDC_ISSUER: z.string().optional(),
  KINGSCHAT_OIDC_CLIENT_ID: z.string().optional(),
  KINGSCHAT_OIDC_SECRET: z.string().optional(),

  // Secondary OAuth/OIDC providers (Appendix B.1). Issuers are well-known
  // (Google: accounts.google.com, Apple: appleid.apple.com), so only the client
  // credentials are configured here. Apple's secret is the operator-generated,
  // periodically-rotated ES256 client-secret JWT (stored by name, never built here).
  OAUTH_GOOGLE_CLIENT_ID: z.string().optional(),
  OAUTH_GOOGLE_SECRET: z.string().optional(),
  OAUTH_APPLE_CLIENT_ID: z.string().optional(),
  OAUTH_APPLE_SECRET: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  MPESA_CALLBACK_SECRET: z.string().optional(),
  AIRTEL_CALLBACK_SECRET: z.string().optional(),
  // --- M-Pesa Daraja (Lipa na M-Pesa Online / STK push). Secrets by name only,
  // git-ignored (§5.10) — never stored in the DB. When all four are present the
  // real Daraja adapter is used; otherwise the HMAC fake. ---
  MPESA_CONSUMER_KEY: z.string().optional(),
  MPESA_CONSUMER_SECRET: z.string().optional(),
  MPESA_PASSKEY: z.string().optional(),
  MPESA_SHORTCODE: z.string().optional(),
  MPESA_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  MPESA_TX_TYPE: z.enum(["CustomerPayBillOnline", "CustomerBuyGoodsOnline"]).default("CustomerPayBillOnline"),
  MPESA_CALLBACK_URL: z.string().optional(), // public HTTPS https://<host>/v1/webhooks/mobilemoney/mpesa
  // --- PayPal (Orders v2). PayPal can't transact KES, so PayPal gifts settle in
  // USD (the entered amount is treated as USD). Secrets by name only (§5.10). ---
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_SECRET: z.string().optional(),
  PAYPAL_ENV: z.enum(["sandbox", "live"]).default("sandbox"),
  PAYPAL_RETURN_URL: z.string().default("https://app.nurupathway.org/giving/paypal/return"),

  YOUVERSION_APP_KEY: z.string().optional(),
  YOUVERSION_LANGUAGE_RANGES: z.string().default("en"),

  CLOUDINARY_URL: z.string().optional(),
  CERT_SIGNING_KEY: z.string().optional(),
  PUSH_PROVIDER_KEY: z.string().optional(),
  // FCM (§D-M9) — the Firebase Admin service-account JSON as a single-line string
  // (or a path to the file). Present → real FCM push delivery; absent → the
  // logging provider (dev/tests complete without sending). Server-side secret.
  FCM_SERVICE_ACCOUNT: z.string().optional(),

  // --- Transactional email (password reset, §5.3). SMTP by name only (§5.10);
  // absent → a logging no-op (dev). In prod we relay through the on-VPS mailcow. ---
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.string().default("false").transform((v) => v === "true" || v === "1"),
  // TLS servername when SMTP_HOST is an IP (cert validates against the real host).
  SMTP_TLS_SERVERNAME: z.string().optional(),
  EMAIL_FROM: z.string().default("Nuru Place <no-reply@nuruplace.org>"),
  // Public base URL used to build links in emails (e.g. the password-reset page).
  APP_PUBLIC_URL: z.string().url().default("https://pathway.nuruplace.org"),

  // --- Reading & Social R1 invite deep links (spec §6; docs/READING_SOCIAL_PLAN.md
  // §5). The public /join/{token} page attempts this custom scheme first (the
  // one confirmed piece of existing deep-link plumbing — nuru:// already
  // switches tabs on both native apps' home-screen widgets), then falls back
  // to the platform store after a short timeout. READING_INVITE_IOS_STORE_URL
  // is left unset by default: Apple Store links need a numeric app id we don't
  // have yet, not the bundle id (org.nuruplace.member) — set it once the app
  // is listed. Android's package (com.nuruplace) is already known, so that
  // default is real. ---
  READING_INVITE_APP_SCHEME: z.string().default("nuru"),
  READING_INVITE_ANDROID_STORE_URL: z.string().default("https://play.google.com/store/apps/details?id=com.nuruplace"),
  READING_INVITE_IOS_STORE_URL: z.string().optional(),

  // --- Passkeys / WebAuthn (§5.3 strong auth). The RP ID is the domain passkeys
  // are bound to; the origin is what signed clientData must match. Both default
  // to APP_PUBLIC_URL (hostname / origin) — prod: pathway.nuruplace.org. Override
  // only for split-host setups; plain localhost works for dev. ---
  WEBAUTHN_RP_ID: z.string().optional(),
  WEBAUTHN_ORIGIN: z.string().optional(),

  // --- Nuru AI (§5.10: keys by name only; absent → offline fake responder). ---
  // Anthropic (Claude) — preferred; tiered models power the intelligence layer
  // (fast = nightly story batch, standard = companion chat, deep = Sunday Letter).
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL_FAST: z.string().default("claude-haiku-4-5-20251001"),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5"),
  ANTHROPIC_MODEL_DEEP: z.string().default("claude-opus-4-8"),
  // Google AI Studio / Gemini (free-tier fallback).
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.0-flash"),
  // Groq — free tier, no billing. Open models (Llama 3.3).
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),

  // --- Features v2 (App. B additions) ---
  VIDEO_PROVIDER: z.enum(["cloudinary", "hls"]).default("cloudinary"),
  VIDEO_MAX_HEIGHT: z.coerce.number().int().positive().default(720),
  STORAGE_BUCKET_MEDIA: z.string().optional(),
  CDN_BASE_URL: z.string().optional(),
  // --- Self-hosted video storage (videos live on our own disk, NOT Cloudinary).
  // Uploaded bytes stream to MEDIA_STORAGE_DIR; members fetch them from
  // MEDIA_PUBLIC_BASE_URL (served by nginx). In prod the dir is a host volume
  // (/var/www/pathway-media → /data/media) and the base is the public /media path. ---
  MEDIA_STORAGE_DIR: z.string().default("/tmp/nuru-media"),
  MEDIA_PUBLIC_BASE_URL: z.string().default("http://localhost:8080/media"),
  MEDIA_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(524_288_000), // 500 MB
  // CAL_MATERIALIZE_HORIZON_DAYS is gone (EVENTS_ARCHITECTURE §2): there is no
  // fixed materialization horizon any more — readers window their own
  // materialization and the nightly sweep keeps a rolling 90-day window. A
  // leftover env var is simply ignored (zod strips unknown keys).
  CAL_MAX_INSTANCES: z.coerce.number().int().positive().default(500),

  // --- Radio Broadcast Studio streaming provider. "fake" (default) needs no
  // secrets and is used in dev/tests; cloudflare/mux/rtmp plug in later with their
  // own env secrets (by name only, §5.10). Unknown values fall back to "fake".
  // "icecast" is the real self-hosted provider for live-mic broadcasting: a source
  // client (butt/Mixxx) connects to our Icecast and members stream the mount. ---
  RADIO_STREAM_PROVIDER: z.enum(["fake", "cloudflare", "mux", "rtmp", "icecast"]).default("fake"),

  // --- Icecast live-audio provider (self-hosted). Source-driven: the stream is
  // live when a broadcaster's source client connects; there is no server-side
  // start/stop. Secrets by name only (§5.10). When ICECAST_SOURCE_HOST and
  // ICECAST_PUBLIC_BASE are set, buildStreamProvider selects Icecast; else Fake. ---
  ICECAST_SOURCE_HOST: z.string().optional(), // public host a source client connects to, e.g. "pathway.nuruplace.org"
  ICECAST_SOURCE_PORT: z.string().optional(), // e.g. "8000" (kept as string — it's typed into butt/Mixxx verbatim)
  ICECAST_SOURCE_PASSWORD: z.string().optional(), // the global Icecast source password (secret)
  ICECAST_PUBLIC_BASE: z.string().optional(), // public base URL for LISTENERS, e.g. "https://pathway.nuruplace.org/radio" (no trailing slash)
  ICECAST_STATUS_URL: z.string().optional(), // internal Icecast status JSON for health, e.g. "http://127.0.0.1:8000/status-json.xsl"

  // --- Liquidsoap LIVE MIX engine (self-hosted, VPS-local telnet control). When
  // LIQUIDSOAP_HOST is set the real telnet control is used (the container reaches
  // the host via the docker bridge); else the Fake (RADIO_STREAM_PROVIDER=fake) or
  // NotConfigured. LIQUIDSOAP_MEDIA_DIR is the HOST-side directory where /media
  // files live — jingle pushes must send host paths, not container paths. ---
  LIQUIDSOAP_HOST: z.string().optional(),
  LIQUIDSOAP_PORT: z.string().default("1234"),
  // Harbor = the live mix's mic input (Icecast SOURCE protocol). The web mic
  // bridge dials LIQUIDSOAP_HOST:HARBOR_PORT and pushes browser audio to MOUNT.
  LIQUIDSOAP_HARBOR_PORT: z.string().default("8005"),
  LIQUIDSOAP_HARBOR_MOUNT: z.string().default("/mic"),
  LIQUIDSOAP_MEDIA_DIR: z.string().default("/var/www/pathway-media"),

  // --- Nuru Live (self-hosted MediaMTX — docs/LIVE_STREAMING.md). L0 infra
  // (RTMP ingest :1935, HLS out behind nginx /live/*) is already on the VPS;
  // these two just point the backend at it. LIVE_RECORDINGS_DIR is the
  // HOST-side directory MediaMTX's `runOnRecordSegmentComplete` writes fMP4
  // segments into (%path/ sub-folders per stream path) — the recording
  // registrar scans it every ~2 min. LIVE_RTMP_BASE_URL is what POST
  // /live/streams echoes back as the publish target; the broadcaster appends
  // ?user=<stream_id>&pass=<stream_key>. ---
  LIVE_RECORDINGS_DIR: z.string().default("/opt/pathway/mediamtx/recordings"),
  LIVE_RTMP_BASE_URL: z.string().default("rtmp://pathway.nuruplace.org:1935"),

  // --- Nuru Live L1.5 (infinite fan-out — docs/LIVE_STREAMING.md). Optional;
  // when set, a VPS-local publisher daemon (ops/live-cdn/) mirrors the CHURCH
  // HLS playlist/segments to a Cloudflare R2 public bucket (R2 fronts however
  // many viewers show up — the VPS's own uplink no longer caps church-scope
  // fan-out). GET /live/now then returns an ABSOLUTE hls_url built from this
  // base for church-scope rows only ("<base>/live-cdn/church/index.m3u8"),
  // plus hls_fallback_url (the direct relative URL) so clients can fail over
  // if the CDN copy 404s (e.g. publisher hasn't caught up yet). Cell streams
  // are unaffected — always the direct low-latency relative URL — the
  // fan-out problem is a church-wide-audience problem, not a small-cell one.
  // No trailing slash, e.g. "https://pub-xxxx.r2.dev". ---
  LIVE_CDN_BASE: z.string().optional(),

  // --- Nuru Live L1.5b (per-stream CDN paths — fixes the "flicker" bug where
  // a NEW church broadcast's first seconds could show the PREVIOUS stream's
  // manifest/segments, because every broadcast reused the exact same static
  // R2 object path). Default OFF: gates the switch to
  // "<base>/live-cdn/church/<stream_id>/index.m3u8" behind this flag so the
  // backend can ship the capability BEFORE the VPS publisher daemon
  // (ops/live-cdn/publisher.py) is updated/redeployed to actually write that
  // per-stream path — turning this on before the daemon writes per-stream
  // objects would make hls_url 404 for every church stream. See
  // docs/LIVE_CDN_PERSTREAM.md for the rollout sequence. No effect unless
  // LIVE_CDN_BASE is also set. ---
  LIVE_CDN_PER_STREAM: z.string().optional().default("false").transform((v) => v === "true" || v === "1"),

  // --- Nuru Live L6a (guest WebRTC publish — docs/LIVE_INTERACTIVE.md). L0/L6
  // infra (MediaMTX webrtc: yes, path pattern
  // ~^guest/[0-9a-zA-Z-]+/[0-9a-zA-Z-]+$, nginx TLS termination) is already on
  // the VPS; this is the public WHIP/WHEP signaling base GET
  // /live/streams/:id/guests/me/ingest echoes back as
  // "<base>/guest/<streamId>/<userId>/whip". No trailing slash. ---
  LIVE_WEBRTC_BASE_URL: z.string().default("https://pathway.nuruplace.org/webrtc"),

  // --- Nuru Live: publisher-liveness sweep (prod incident — a live_streams
  // row can sit status='live' for hours with ZERO RTMP publishers connected
  // once a broadcaster's app/network dies abnormally, and the one-live-per-
  // scope unique index then 409s every attempt to go live again until the
  // old 12h orphan fallback finally clears it). MediaMTX's HTTP control API
  // (v3/paths/list) reports whether a path has an actual connected
  // publisher; this is its base URL as reachable from the backend's docker
  // network (the MediaMTX container's own service name), used by both the
  // ~2min worker sweep and createStream's owner self-recovery. No trailing
  // slash. ---
  LIVE_MEDIAMTX_API_BASE: z.string().default("http://nuru-mediamtx:9997"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/** Parse and cache the environment. Throws a readable error on misconfiguration. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join("\n")}`);
  }
  cached = parsed.data;
  return cached;
}
