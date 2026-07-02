// Streaming provider abstraction (docs/RADIO_STUDIO_CONTRACT.md §Streaming).
// Mirrors the payment-gateway pattern: an interface + a secret-free FakeStreamProvider
// default (dev/tests), selected by env RADIO_STREAM_PROVIDER (default "fake"; unknown
// → fake). Real providers (cloudflare/mux/rtmp) plug in later with env secrets.
//
// The provider owns ingest credentials: provision() mints them on program create,
// start()/stop() bracket a live broadcast, rotateKey() re-issues the secret stream
// key, and health() reports simulated-but-stable operational numbers for the live bar.
import { createHash } from "node:crypto";
import type { Env } from "../../config/env.js";

/** Ingest credentials for a program. `streamKey` is a SECRET — never sent to members. */
export interface StreamCredentials {
  provider: string;
  ingestUrl: string;
  streamKey: string;
  hlsUrl: string;
}

export interface StreamHealth {
  cpu: number; // percent 0-100
  memory: number; // percent 0-100
  bitrate: number; // kbps
  latency: number; // ms
  dropped: number; // dropped frames
  stability: number; // percent 0-100
  listeners: number; // current listeners
}

/** Minimal program shape the provider needs — the module passes the row. */
export interface ProviderProgram {
  id: string;
  is_live?: boolean;
  peak_listeners?: number;
}

export interface StreamProvider {
  /** Mint ingest credentials for a new program (called on create). */
  provision(programId: string): StreamCredentials;
  /** Begin a live broadcast (go-live). */
  start(program: ProviderProgram): void;
  /** End a live broadcast. */
  stop(program: ProviderProgram): void;
  /** Re-issue the secret stream key for a program. */
  rotateKey(programId: string): { streamKey: string };
  /** Operational health for the live status bar (live programs only). */
  health(program: ProviderProgram): StreamHealth;
}

// Deterministic short hash so URLs/keys/health are stable per program id (test-friendly).
function hash8(seed: string): string {
  return createHash("sha256").update(seed).digest("hex").slice(0, 8);
}
function seededInt(seed: string, min: number, max: number): number {
  const n = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16);
  return min + (n % (max - min + 1));
}

/**
 * Secret-free default. Deterministic ingest/stream_key/hls URLs derived from the
 * program id, and stable simulated health numbers — so tests are reproducible and
 * dev needs no upstream. rotateKey mixes in a random suffix so the key changes.
 */
export class FakeStreamProvider implements StreamProvider {
  provision(programId: string): StreamCredentials {
    return {
      provider: "fake",
      ingestUrl: "rtmp://ingest.local/live",
      streamKey: `nuru_${hash8(programId)}_${hash8(`key:${programId}`)}`,
      hlsUrl: `https://stream.local/hls/${programId}.m3u8`,
    };
  }

  start(_program: ProviderProgram): void {
    // no-op for the fake — a real provider would signal the ingest to accept input.
  }

  stop(_program: ProviderProgram): void {
    // no-op for the fake — a real provider would tear the live session down.
  }

  rotateKey(programId: string): { streamKey: string } {
    const rand = Math.random().toString(36).slice(2, 10);
    return { streamKey: `nuru_${hash8(programId)}_${rand}` };
  }

  health(program: ProviderProgram): StreamHealth {
    const id = program.id;
    return {
      cpu: seededInt(`cpu:${id}`, 20, 55),
      memory: seededInt(`mem:${id}`, 30, 65),
      bitrate: seededInt(`br:${id}`, 96, 320),
      latency: seededInt(`lat:${id}`, 40, 180),
      dropped: seededInt(`drop:${id}`, 0, 3),
      stability: seededInt(`stab:${id}`, 92, 100),
      listeners: program.peak_listeners ?? seededInt(`lis:${id}`, 5, 120),
    };
  }
}

/** Select the stream provider from env. Default "fake"; unknown values → fake. */
export function buildStreamProvider(env: Env): StreamProvider {
  switch (env.RADIO_STREAM_PROVIDER) {
    // cloudflare / mux / rtmp adapters plug in here once their env secrets exist.
    case "fake":
    default:
      return new FakeStreamProvider();
  }
}
