// Web mic bridge (docs/RADIO_STUDIO_CONTRACT.md §Live mix — browser broadcasting).
//
// Browsers cannot open the raw TCP Icecast SOURCE connection the iPad uses, so
// the web console captures the mic (getUserMedia → MediaRecorder) and streams
// the encoded chunks over a WebSocket to THIS bridge, which performs the
// SOURCE handshake against the liquidsoap harbor (the live mix's /mic input)
// and pipes bytes through verbatim. liquidsoap's ffmpeg decoders handle the
// browser formats (WebM/Opus from Chrome/Edge/Firefox, MP4/AAC from Safari) —
// verified against the production engine.
//
// Auth: browsers can't set headers on a WebSocket, so the access token rides a
// query param, verified with the SAME verifier as HTTP auth, then the caller
// must hold radio:edit (same SQL as requirePermission). The harbor only accepts
// ONE source per mount — a second broadcaster (e.g. the iPad is on mic) gets a
// clean 4409 close, surfaced as "someone is already on mic".
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { connect, type Socket } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import type { Pool } from "pg";
import type { Logger } from "pino";
import type { Env } from "../../config/env.js";
import { verifyAccessToken } from "../identity/tokens.js";
import { many } from "../../db/db.js";

export const MIC_BRIDGE_PATH = "/v1/admin/radio/mic-bridge";

// Content types the consoles are allowed to declare to the harbor.
const ALLOWED_CT = new Set(["audio/webm", "audio/mp4", "audio/aac", "audio/mpeg", "audio/ogg"]);

interface BridgeDeps {
  env: Env;
  db: Pool; // replica is fine — permission reads only
  log: Logger;
  /** Test seam: overrides the harbor TCP endpoint. */
  harbor?: { host: string; port: number };
}

/** radio:edit check — same union as requirePermission (role grants ∪ direct grants). */
async function hasRadioEdit(db: Pool, userId: string, role: string): Promise<boolean> {
  if (role === "SuperAdmin" || role === "Admin") return true;
  const rows = await many<{ ok: number }>(
    db,
    `SELECT 1 AS ok
       FROM rbac_user_roles ur
       JOIN rbac_roles r ON r.role_key = ur.role_key AND r.status = 'active'
       JOIN rbac_role_permissions rp ON rp.role_key = ur.role_key
      WHERE ur.user_id = $1 AND rp.module_id = 'radio' AND rp.capability = 'edit'
     UNION ALL
     SELECT 1 AS ok
       FROM rbac_user_permissions up
      WHERE up.user_id = $1 AND up.module_id = 'radio' AND up.capability = 'edit'
      LIMIT 1`,
    [userId],
  );
  return rows.length > 0;
}

/**
 * Attach the mic-bridge WebSocket endpoint to the API's HTTP server.
 * No-op paths (wrong URL) are destroyed so unrelated upgrades never dangle.
 */
export function attachMicBridge(server: Server, deps: BridgeDeps): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== MIC_BRIDGE_PATH) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleSession(ws, url, deps).catch((err) => {
        deps.log.error({ err }, "mic-bridge session error");
        try { ws.close(1011, "internal error"); } catch { /* already closed */ }
      });
    });
  });
}

async function handleSession(ws: WebSocket, url: URL, deps: BridgeDeps): Promise<void> {
  const { env, db, log } = deps;

  // --- authn + authz ---------------------------------------------------------
  let principal: { userId: string; role: string };
  try {
    const claims = verifyAccessToken(env, url.searchParams.get("token") ?? "");
    principal = { userId: claims.sub, role: claims.role };
  } catch {
    ws.close(4001, "invalid or expired token");
    return;
  }
  if (!(await hasRadioEdit(db, principal.userId, principal.role))) {
    ws.close(4003, "missing radio:edit permission");
    return;
  }

  // --- config ----------------------------------------------------------------
  const harborHost = deps.harbor?.host ?? env.LIQUIDSOAP_HOST;
  const harborPort = deps.harbor?.port ?? Number.parseInt(env.LIQUIDSOAP_HARBOR_PORT ?? "8005", 10);
  const password = env.ICECAST_SOURCE_PASSWORD;
  if (!harborHost || !Number.isFinite(harborPort) || !password) {
    ws.close(4004, "mic bridge is not configured on this server");
    return;
  }
  const ctParam = url.searchParams.get("ct") ?? "audio/webm";
  const contentType = ALLOWED_CT.has(ctParam) ? ctParam : "audio/webm";
  // Hand-built envs (tests) may miss schema defaults — never emit "undefined".
  const mount = env.LIQUIDSOAP_HARBOR_MOUNT ?? "/mic";

  // --- harbor SOURCE connection ----------------------------------------------
  const harbor: Socket = connect({ host: harborHost, port: harborPort });
  let handshaken = false;
  let response = "";
  const queued: Buffer[] = []; // chunks arriving before the harbor says 200

  const teardown = (code: number, reason: string): void => {
    try { ws.close(code, reason); } catch { /* closed */ }
    harbor.destroy();
  };

  harbor.setTimeout(10_000, () => {
    if (!handshaken) teardown(4008, "live mix engine did not respond");
  });
  harbor.on("error", () => {
    teardown(4008, handshaken ? "engine connection lost" : "live mix engine is not running (no live session)");
  });
  harbor.on("close", () => {
    if (handshaken) teardown(1011, "engine connection closed");
  });
  harbor.on("connect", () => {
    const auth = Buffer.from(`source:${password}`).toString("base64");
    harbor.write(
      `SOURCE ${mount} HTTP/1.0\r\n` +
        `Authorization: Basic ${auth}\r\n` +
        `User-Agent: nuru-web-mic\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`,
    );
  });
  harbor.on("data", (chunk) => {
    if (handshaken) return; // the harbor doesn't talk back mid-stream
    response += chunk.toString("utf8");
    if (!response.includes("\r\n")) return;
    if (/\b200\b/.test(response)) {
      handshaken = true;
      harbor.setTimeout(0);
      for (const buf of queued.splice(0)) harbor.write(buf);
      ws.send(JSON.stringify({ ok: true, mount }));
      log.info({ user: principal.userId, ct: contentType }, "mic-bridge on air");
    } else if (/\b(401|403)\b/.test(response)) {
      teardown(4409, "the mic input is busy or refused (someone may already be on mic)");
    } else {
      teardown(4008, `unexpected engine response: ${response.slice(0, 60)}`);
    }
  });

  // --- pipe browser → harbor ---------------------------------------------------
  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (!isBinary) return; // text frames are reserved for future control messages
    if (handshaken) harbor.write(data);
    else if (queued.length < 64) queued.push(Buffer.from(data)); // ~16s @128kbps cap
  });
  ws.on("close", () => {
    log.info({ user: principal.userId }, "mic-bridge off air");
    harbor.end();
  });
  ws.on("error", () => harbor.destroy());

  // Keepalive: terminate dead browsers so the mount frees for the next broadcaster.
  const heartbeat = setInterval(() => {
    if (ws.readyState !== ws.OPEN) { clearInterval(heartbeat); return; }
    ws.ping();
  }, 20_000);
  ws.on("close", () => clearInterval(heartbeat));
}
