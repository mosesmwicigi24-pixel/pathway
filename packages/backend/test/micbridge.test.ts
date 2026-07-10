// Web mic bridge — WebSocket → liquidsoap-harbor SOURCE piping (micbridge.ts).
// A fake harbor (raw TCP server) stands in for liquidsoap so the suite runs
// offline: it captures the SOURCE handshake and every byte piped after it.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createTcpServer, type Server as TcpServer, type Socket } from "node:net";
import { once } from "node:events";
import { pino } from "pino";
import WebSocket from "ws";
import { testEnv } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { signAccessToken } from "../src/modules/identity/tokens.js";
import { attachMicBridge, MIC_BRIDGE_PATH } from "../src/modules/radio/micbridge.js";

let http: Server;
let port: number;
let harbor: TcpServer;
let harborPort: number;
let cong: string;

// What the fake harbor observed for the current connection.
let seenHandshake = "";
let seenBytes: Buffer[] = [];
let refuseNext = false; // simulate a busy mount (401)

beforeAll(async () => {
  await resetDb();
  cong = await createCongregation();

  harbor = createTcpServer((sock: Socket) => {
    seenHandshake = "";
    seenBytes = [];
    let inBody = false;
    sock.on("data", (chunk) => {
      if (inBody) { seenBytes.push(chunk); return; }
      seenHandshake += chunk.toString("utf8");
      const end = seenHandshake.indexOf("\r\n\r\n");
      if (end === -1) return;
      const rest = Buffer.from(seenHandshake.slice(end + 4), "utf8");
      if (rest.length > 0) seenBytes.push(rest);
      seenHandshake = seenHandshake.slice(0, end + 4);
      inBody = true;
      sock.write(refuseNext ? "HTTP/1.0 401 Unauthorized\r\n\r\n" : "HTTP/1.0 200 OK\r\n\r\n");
    });
  });
  harbor.listen(0);
  await once(harbor, "listening");
  harborPort = (harbor.address() as { port: number }).port;

  const env = { ...testEnv(), LIQUIDSOAP_HOST: "127.0.0.1", ICECAST_SOURCE_PASSWORD: "sekret" };
  http = createHttpServer();
  attachMicBridge(http, {
    env,
    db: testPool(),
    log: pino({ level: "silent" }),
    harbor: { host: "127.0.0.1", port: harborPort },
  });
  http.listen(0);
  await once(http, "listening");
  port = (http.address() as { port: number }).port;
});

afterAll(async () => {
  http.close();
  harbor.close();
  await closeTestPool();
});

function wsUrl(token: string, ct?: string): string {
  const q = new URLSearchParams({ token });
  if (ct) q.set("ct", ct);
  return `ws://127.0.0.1:${port}${MIC_BRIDGE_PATH}?${q}`;
}

async function adminToken(email: string): Promise<string> {
  const admin = await createUser({ congregationId: cong, role: "Admin", email });
  return signAccessToken(testEnv(), { sub: admin.user_id, role: "Admin", cong });
}

/** Wait for a close event and return its code+reason. */
function closed(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) =>
    ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() })),
  );
}

describe("mic bridge — auth", () => {
  it("rejects a garbage token with 4001", async () => {
    const ws = new WebSocket(wsUrl("not-a-token"));
    const { code } = await closed(ws);
    expect(code).toBe(4001);
  });

  it("rejects a Student (no radio:edit) with 4003", async () => {
    const student = await createUser({ congregationId: cong, role: "Student", email: "s@dev.local" });
    const tok = signAccessToken(testEnv(), { sub: student.user_id, role: "Student", cong });
    const ws = new WebSocket(wsUrl(tok));
    const { code } = await closed(ws);
    expect(code).toBe(4003);
  });
});

describe("mic bridge — SOURCE piping", () => {
  it("performs the harbor handshake, acks, and pipes bytes verbatim", async () => {
    const tok = await adminToken("mic1@dev.local");
    const ws = new WebSocket(wsUrl(tok, "audio/webm"));

    // First server frame is the {ok:true} ack after the harbor's 200.
    const ack = await new Promise<string>((resolve, reject) => {
      ws.on("message", (d) => resolve(d.toString()));
      ws.on("close", (code, reason) => reject(new Error(`closed ${code} ${reason}`)));
    });
    expect(JSON.parse(ack).ok).toBe(true);
    expect(seenHandshake).toContain("SOURCE /mic HTTP/1.0");
    expect(seenHandshake).toContain("Content-Type: audio/webm");
    expect(seenHandshake).toContain(
      `Authorization: Basic ${Buffer.from("source:sekret").toString("base64")}`,
    );

    const chunk1 = Buffer.from([1, 2, 3, 4]);
    const chunk2 = Buffer.from([9, 8, 7]);
    ws.send(chunk1);
    ws.send(chunk2);
    await new Promise((r) => setTimeout(r, 150));
    expect(Buffer.concat(seenBytes)).toEqual(Buffer.concat([chunk1, chunk2]));
    ws.close();
  });

  it("surfaces a busy/refused mount as 4409", async () => {
    refuseNext = true;
    const tok = await adminToken("mic2@dev.local");
    const ws = new WebSocket(wsUrl(tok));
    const { code, reason } = await closed(ws);
    refuseNext = false;
    expect(code).toBe(4409);
    expect(reason).toContain("busy or refused");
  });
});
