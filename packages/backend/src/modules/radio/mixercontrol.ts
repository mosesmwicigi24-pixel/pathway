// LIVE MIX control abstraction (docs/RADIO_STUDIO_CONTRACT.md §Live mix).
// A liquidsoap engine on the VPS mixes the live broadcast (playlist bed + live
// mic + jingle queue) and exposes a VPS-local telnet control server. This module
// mirrors the provider/payment-gateway pattern: an interface + a real Telnet
// implementation + a NotConfigured thrower + a Fake for dev/tests, selected by
// buildMixerControl(env) with a register-time override for tests.
//
// Control contract (frozen — the liquidsoap script implements exactly this):
//   - plain-text telnet, newline-terminated commands, ~1.5s per-command timeout;
//   - channels mic|bed|jingle|master; gains are floats 0..1 on the wire, but the
//     API (this interface) speaks ints 0..100 — converted here, at the edge;
//   - `var.set mic = 0.82` → response contains "Variable mic set";
//   - `var.get mic` → "0.82";
//   - `jingles.push /var/www/pathway-media/<file>` → queues a jingle;
//   - every response is terminated by an "END" line; sessions end with `quit`.
import { createConnection } from "node:net";
import { ApiError } from "../../http/errors.js";
import type { Env } from "../../config/env.js";

/** The four live-mix channels liquidsoap exposes as interactive variables. */
export type MixerLiveChannel = "mic" | "bed" | "jingle" | "master";

export const MIXER_LIVE_CHANNELS: readonly MixerLiveChannel[] = ["mic", "bed", "jingle", "master"];

export interface MixerLiveStatus {
  connected: boolean;
  gains?: Record<string, number>; // 0..100 per channel, present when connected
}

export interface MixerControl {
  /** Set one or more channel gains. Values are ints 0..100 (converted to 0..1 on the wire). */
  setGains(gains: Partial<Record<MixerLiveChannel, number>>): Promise<void>;
  /** Queue a jingle by HOST-side file path (LIQUIDSOAP_MEDIA_DIR/<file>). */
  fireJingle(filePath: string): Promise<void>;
  /** Engine reachability + current gains (0..100). Never throws on a down engine. */
  status(): Promise<MixerLiveStatus>;
}

/** Clamp to an int 0..100 (defensive — routes already validate). */
function clampLevel(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** API 0..100 int → liquidsoap 0..1 float literal (always with decimals, e.g. "1.00"). */
function toWireGain(v: number): string {
  return (clampLevel(v) / 100).toFixed(2);
}

/**
 * One telnet session: connect, send each command in order (newline-terminated),
 * read each response up to its terminating "END" line, then `quit` and resolve
 * with the per-command response payloads. Any connect error, socket error, early
 * close, or a >~1.5s wait for a single response rejects the whole exchange.
 * One socket per call — simple and stateless, matching the low command volume.
 */
function telnetExchange(
  host: string,
  port: number,
  commands: string[],
  timeoutMs = 1500,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    const responses: string[] = [];
    let buffer = "";
    let sent = 0;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      socket.destroy();
      reject(err);
    };
    const arm = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fail(new Error("liquidsoap control timed out")), timeoutMs);
    };
    const sendNext = (): void => {
      if (sent >= commands.length) {
        // Done — end the session per the contract, then resolve.
        settled = true;
        if (timer) clearTimeout(timer);
        socket.write("quit\n");
        socket.end();
        resolve(responses);
        return;
      }
      arm();
      socket.write(`${commands[sent]}\n`);
    };

    socket.on("connect", sendNext);
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      // Each response is terminated by a line consisting of "END".
      for (;;) {
        const end = /^END\r?$/m.exec(buffer);
        if (!end) break;
        responses.push(buffer.slice(0, end.index).trim());
        buffer = buffer.slice(end.index + end[0].length).replace(/^\r?\n/, "");
        sent += 1;
        sendNext();
        if (settled) return;
      }
    });
    socket.on("error", (err) => fail(err));
    socket.on("close", () => fail(new Error("liquidsoap control connection closed")));
  });
}

/** Real control: talks to the liquidsoap telnet server (VPS-local, via env host/port). */
export class TelnetMixerControl implements MixerControl {
  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {}

  private async exchange(commands: string[]): Promise<string[]> {
    try {
      return await telnetExchange(this.host, this.port, commands);
    } catch {
      // Connect failure / timeout → the control is DOWN.
      throw new ApiError("UPSTREAM_UNAVAILABLE", "Live mix engine is unreachable");
    }
  }

  async setGains(gains: Partial<Record<MixerLiveChannel, number>>): Promise<void> {
    const entries = Object.entries(gains).filter(([, v]) => typeof v === "number") as [
      MixerLiveChannel,
      number,
    ][];
    if (entries.length === 0) return;
    const responses = await this.exchange(
      entries.map(([ch, v]) => `var.set ${ch} = ${toWireGain(v)}`),
    );
    entries.forEach(([ch], i) => {
      // Contract: a successful set responds with "Variable <ch> set (…)".
      if (!responses[i]?.includes(`Variable ${ch} set`)) {
        throw new ApiError("UPSTREAM_UNAVAILABLE", `Live mix engine did not accept the ${ch} level`);
      }
    });
  }

  async fireJingle(filePath: string): Promise<void> {
    // Response is the queued request id line — any response means accepted.
    await this.exchange([`jingles.push ${filePath}`]);
  }

  async status(): Promise<MixerLiveStatus> {
    try {
      const responses = await telnetExchange(
        this.host,
        this.port,
        MIXER_LIVE_CHANNELS.map((ch) => `var.get ${ch}`),
      );
      const gains: Record<string, number> = {};
      MIXER_LIVE_CHANNELS.forEach((ch, i) => {
        const f = Number.parseFloat(responses[i] ?? "");
        if (Number.isFinite(f)) gains[ch] = clampLevel(f * 100);
      });
      return { connected: true, gains };
    } catch {
      return { connected: false };
    }
  }
}

/** No engine configured — every control action is a 503; status() is caught upstream. */
export class NotConfiguredMixerControl implements MixerControl {
  private unavailable(): never {
    throw new ApiError("UPSTREAM_UNAVAILABLE", "Live mix engine is not configured");
  }
  async setGains(_gains: Partial<Record<MixerLiveChannel, number>>): Promise<void> {
    this.unavailable();
  }
  async fireJingle(_filePath: string): Promise<void> {
    this.unavailable();
  }
  async status(): Promise<MixerLiveStatus> {
    this.unavailable();
  }
}

/**
 * Secret-free fake for dev/tests: an in-memory gains map, fired jingle paths
 * recorded in order, and a status that always reports connected. Exported so
 * tests can inject it via registerRadio's mixerOverride and inspect state.
 */
export class FakeMixerControl implements MixerControl {
  public gains: Record<string, number> = {};
  public fired: string[] = [];

  async setGains(gains: Partial<Record<MixerLiveChannel, number>>): Promise<void> {
    for (const [ch, v] of Object.entries(gains)) {
      if (typeof v === "number") this.gains[ch] = clampLevel(v);
    }
  }
  async fireJingle(filePath: string): Promise<void> {
    this.fired.push(filePath);
  }
  async status(): Promise<MixerLiveStatus> {
    return { connected: true, gains: { ...this.gains } };
  }
  reset(): void {
    this.gains = {};
    this.fired = [];
  }
}

/**
 * Select the mixer control from env: LIQUIDSOAP_HOST set → the real telnet
 * control; else the Fake when the radio provider is "fake" (dev/tests need no
 * engine); else NotConfigured (real streaming without a mix engine → 503s).
 */
export function buildMixerControl(env: Env): MixerControl {
  if (env.LIQUIDSOAP_HOST) {
    const port = Number.parseInt(env.LIQUIDSOAP_PORT ?? "1234", 10);
    return new TelnetMixerControl(env.LIQUIDSOAP_HOST, Number.isFinite(port) ? port : 1234);
  }
  if (env.RADIO_STREAM_PROVIDER === "fake") return new FakeMixerControl();
  return new NotConfiguredMixerControl();
}
