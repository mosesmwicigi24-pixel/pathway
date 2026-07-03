// Notification dispatch provider (spec §1.5). The actual APNs/FCM/email send is
// behind this interface so the scheduling/worker logic is testable and the real
// provider (PUSH_PROVIDER_KEY) drops in for production. Without a key configured
// we use a logging provider that succeeds — dev flows complete without delivery.
import type { Messaging } from "firebase-admin/messaging";
import type { Logger } from "pino";
import type { Env } from "../config/env.js";

export interface DispatchMessage {
  channel: "push" | "email";
  to: string; // device token or email address
  template: string;
  payload: Record<string, unknown>;
}

export interface DispatchProvider {
  send(msg: DispatchMessage): Promise<void>;
}

class LoggingDispatchProvider implements DispatchProvider {
  constructor(private readonly log?: Logger) {}
  send(msg: DispatchMessage): Promise<void> {
    this.log?.info({ channel: msg.channel, template: msg.template, to: msg.to }, "notification (logged, no provider)");
    return Promise.resolve();
  }
}

/** Human title/body for a push, from the notification payload (falls back to the
 *  template name). The mobile client shows notification.title/body directly. */
function pushCopy(msg: DispatchMessage): { title: string; body: string } {
  const p = msg.payload;
  const title = typeof p.title === "string" && p.title ? p.title : "Nuru Pathway";
  const body =
    typeof p.body === "string" && p.body
      ? p.body
      : typeof p.feedback === "string" && p.feedback
        ? p.feedback
        : msg.template.replace(/_/g, " ");
  return { title, body };
}

/**
 * Real FCM push via the Firebase Admin SDK (§D-M9). Email still falls through to
 * logging (no email provider yet). Initialised lazily from FCM_SERVICE_ACCOUNT
 * (JSON string or a file path). `data` values must be strings per FCM.
 */
class FcmDispatchProvider implements DispatchProvider {
  private messaging: Messaging | null = null;

  constructor(
    private readonly serviceAccount: string,
    private readonly fallback: DispatchProvider,
    private readonly log?: Logger,
  ) {}

  private async messagingClient(): Promise<Messaging> {
    if (this.messaging) return this.messaging;
    const { cert, initializeApp, getApps } = await import("firebase-admin/app");
    const { getMessaging } = await import("firebase-admin/messaging");
    const creds = this.serviceAccount.trim().startsWith("{")
      ? JSON.parse(this.serviceAccount)
      : JSON.parse(await (await import("node:fs/promises")).readFile(this.serviceAccount, "utf8"));
    const app = getApps().find((a) => a?.name === "nuru-fcm") ?? initializeApp({ credential: cert(creds) }, "nuru-fcm");
    this.messaging = getMessaging(app);
    return this.messaging;
  }

  async send(msg: DispatchMessage): Promise<void> {
    if (msg.channel !== "push") return this.fallback.send(msg);
    const { title, body } = pushCopy(msg);
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(msg.payload)) {
      if (v != null) data[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    const messaging = await this.messagingClient();
    // Throws on invalid/expired token → the worker marks the row 'failed' and logs.
    await messaging.send({ token: msg.to, notification: { title, body }, data, android: { priority: "high" } });
  }
}

export function buildDispatchProvider(env: Env, log?: Logger): DispatchProvider {
  const fallback = new LoggingDispatchProvider(log);
  // Real FCM push when a service account is configured; email + unconfigured
  // installs (dev/tests) keep the logging provider.
  if (env.FCM_SERVICE_ACCOUNT) {
    log?.info("notification dispatch: FCM push provider active");
    return new FcmDispatchProvider(env.FCM_SERVICE_ACCOUNT, fallback, log);
  }
  return fallback;
}
