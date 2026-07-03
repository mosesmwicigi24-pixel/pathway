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
  /** Current on-air track from the stream's icy metadata (null when unknown). */
  now_playing?: string | null;
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
  /**
   * Operational health for the live status bar (live programs only). May be
   * async: real providers (e.g. Icecast) fetch status over the network. The
   * service awaits the result, so returning either a value or a Promise works.
   */
  health(program: ProviderProgram): StreamHealth | Promise<StreamHealth>;
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

/** An all-zero / "Offline" health reading (stability 0), used when Icecast is down. */
function offlineHealth(): StreamHealth {
  return { cpu: 0, memory: 0, bitrate: 0, latency: 0, dropped: 0, stability: 0, listeners: 0 };
}

/**
 * Real self-hosted Icecast provider for live-mic broadcasting.
 *
 * Icecast is SOURCE-DRIVEN: the stream is live the moment a broadcaster's source
 * client (butt, Mixxx, …) connects to the mount with user "source" and the global
 * source password; it ends when they disconnect. There is no server-side start/stop
 * for us to call — so start()/stop() are no-ops. Per-program isolation is the mount
 * ("/s_<8hex>.mp3"); the source password is global Icecast config, so it's not
 * per-program-rotatable.
 *
 * health() reads Icecast's own status-json.xsl and maps the matching source's live
 * numbers into StreamHealth. Icecast doesn't report cpu/memory/latency/dropped, so
 * those are 0; `stability` is expressed on the DTO's 0-100 scale (100 = connected /
 * "Excellent", 0 = "Offline"). Any failure fetching/parsing → an all-zero/Offline
 * reading so a down Icecast never 500s the live-status route.
 */
export class IcecastStreamProvider implements StreamProvider {
  constructor(private readonly env: Env) {}

  /** Per-session mount derived from the program id: "/s_<first 8 hex of id>.mp3". */
  private mount(programId: string): string {
    return `/s_${hash8(programId)}.mp3`;
  }

  provision(programId: string): StreamCredentials {
    const mount = this.mount(programId);
    const host = this.env.ICECAST_SOURCE_HOST ?? "";
    const port = this.env.ICECAST_SOURCE_PORT ?? "";
    const base = this.env.ICECAST_PUBLIC_BASE ?? "";
    return {
      provider: "icecast",
      // What the broadcaster types into butt/Mixxx: host, port, mount.
      ingestUrl: `${host}:${port}${mount}`,
      // Icecast uses a global source password + fixed user "source"; the mount is
      // the per-session part. The password is the secret "stream key".
      streamKey: this.env.ICECAST_SOURCE_PASSWORD ?? "",
      // A direct MP3 stream URL playable in any audio player (named hls_url for
      // interface compatibility; for Icecast it's the Icecast stream URL).
      hlsUrl: `${base}${mount}`,
    };
  }

  start(_program: ProviderProgram): void {
    // no-op: Icecast is source-driven — the stream goes live when the broadcaster's
    // source client connects to the mount, not on any call we make.
  }

  stop(_program: ProviderProgram): void {
    // no-op: the stream ends when the source client disconnects; nothing to tear down.
  }

  rotateKey(_programId: string): { streamKey: string } {
    // Icecast's source password is global (config-level, in icecast.xml), so per-program
    // rotation isn't supported — return the currently configured password unchanged.
    return { streamKey: this.env.ICECAST_SOURCE_PASSWORD ?? "" };
  }

  async health(program: ProviderProgram): Promise<StreamHealth> {
    const statusUrl = this.env.ICECAST_STATUS_URL;
    if (!statusUrl) return offlineHealth();
    const mount = this.mount(program.id);
    try {
      const res = await fetch(statusUrl);
      if (!res.ok) return offlineHealth();
      const body = (await res.json()) as {
        icestats?: { source?: IcecastSource | IcecastSource[] };
      };
      const raw = body.icestats?.source;
      // `source` may be a single object, an array, or absent.
      const sources: IcecastSource[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const match = sources.find((s) => {
        const listenurl = typeof s.listenurl === "string" ? s.listenurl : "";
        return listenurl.endsWith(mount);
      });
      if (!match) return offlineHealth();
      const bitrate = num(match.bitrate) || num(match["ice-bitrate"]) || 0;
      return {
        cpu: 0,
        memory: 0,
        bitrate,
        latency: 0,
        dropped: 0,
        stability: 100, // connected → "Excellent" (0-100 DTO scale)
        listeners: num(match.listeners) || 0,
        // Icy stream metadata — liquidsoap publishes the current track's tags,
        // so admins can see which song is on air right now.
        now_playing: icyTitle(match),
      };
    } catch {
      // A down/unreachable Icecast must never 500 the live-status route.
      return offlineHealth();
    }
  }
}

/** Shape of an Icecast status-json.xsl source entry (only the fields we read). */
interface IcecastSource {
  listenurl?: string;
  listeners?: number | string;
  bitrate?: number | string;
  "ice-bitrate"?: number | string;
  title?: string;
  artist?: string;
  yp_currently_playing?: string;
}

/** Current-track label from Icecast's icy metadata (null when absent). */
function icyTitle(s: IcecastSource): string | null {
  const artist = typeof s.artist === "string" ? s.artist.trim() : "";
  const title = typeof s.title === "string" ? s.title.trim() : "";
  if (artist && title) return `${artist} — ${title}`;
  if (title) return title;
  const yp = typeof s.yp_currently_playing === "string" ? s.yp_currently_playing.trim() : "";
  return yp || null;
}

/** Coerce a possibly-string numeric field to a finite number (0 on failure). */
function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** Select the stream provider from env. Default "fake"; unknown values → fake. */
export function buildStreamProvider(env: Env): StreamProvider {
  switch (env.RADIO_STREAM_PROVIDER) {
    // cloudflare / mux / rtmp adapters plug in here once their env secrets exist.
    case "icecast":
      // Real self-hosted Icecast when the required env is present; else fall back to
      // Fake (like other real providers) so dev/tests never need an upstream.
      if (env.ICECAST_SOURCE_HOST && env.ICECAST_PUBLIC_BASE) return new IcecastStreamProvider(env);
      return new FakeStreamProvider();
    case "fake":
    default:
      return new FakeStreamProvider();
  }
}
