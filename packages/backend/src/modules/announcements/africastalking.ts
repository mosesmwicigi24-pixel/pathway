// Africa's Talking SMS, behind the MessageProvider interface next door.
//
// This is the "real deployment binds Twilio/Africa's Talking here" that
// providers.ts has been describing since it was written. It lives beside that
// interface rather than in a messaging/ of its own so there is exactly one
// definition of what an outbound message is — the giving receipt worker imports
// it from here too.
//
// What it is FOR, first: a stranger who gives through nuruplace.org has no
// account, so no `notifications` row can be keyed to them. Until now they got
// Safaricom's own SMS and nothing from the church at all. A text to the number
// that paid is the closest thing to the paper receipt this replaces.
//
// Costs money per message. Every send is one real shilling-ish of the church's
// airtime, which is why nothing here retries on its own — the outbox does that,
// with its own attempt cap, and a provider that also retried would multiply the
// two.
import type { Env } from "../../config/env.js";
import type { MessageProvider, OutboundMessage } from "./providers.js";

/** Africa's Talking status codes that mean "we have it". 101 sent, 102 queued. */
const ACCEPTED = new Set([101, 102]);

interface ATRecipient {
  statusCode?: number;
  status?: string;
  number?: string;
  messageId?: string;
  cost?: string;
}

export class AfricasTalkingSmsProvider implements MessageProvider {
  readonly channel = "sms" as const;

  constructor(
    private readonly cfg: {
      apiKey: string;
      username: string;
      /** The registered shortcode or alphanumeric sender id. Optional: without
       *  one Africa's Talking sends from a shared pool, which works but shows
       *  the giver a number they have no reason to trust. */
      senderId?: string | undefined;
      baseUrl: string;
      timeoutMs?: number | undefined;
    },
  ) {}

  async send(msg: OutboundMessage): Promise<{ ref: string }> {
    // Form-encoded, not JSON: their v1 messaging endpoint accepts only this.
    const form = new URLSearchParams({
      username: this.cfg.username,
      to: msg.to,
      message: msg.body,
    });
    if (this.cfg.senderId) form.set("from", this.cfg.senderId);

    const res = await fetch(`${this.cfg.baseUrl}/version1/messaging`, {
      method: "POST",
      headers: {
        apiKey: this.cfg.apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form.toString(),
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15_000),
    });

    if (!res.ok) {
      // The body carries their reason ("Invalid sender id", "InsufficientBalance"),
      // which is worth having in the log — a silent failure here means a giver
      // is never thanked and nobody finds out why.
      const detail = await res.text().catch(() => "");
      throw new Error(`Africa's Talking returned ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
    }

    const body = (await res.json()) as { SMSMessageData?: { Recipients?: ATRecipient[]; Message?: string } };
    const first = body.SMSMessageData?.Recipients?.[0];

    // A 200 is NOT success. Africa's Talking answers 200 with a per-recipient
    // statusCode, so an invalid number, a blocked sender id or an empty account
    // all arrive as a cheerful HTTP 200. Reading only res.ok would report every
    // one of those as a receipt sent.
    if (!first || !ACCEPTED.has(Number(first.statusCode))) {
      throw new Error(
        `Africa's Talking rejected the message: ` +
          `${first?.status ?? body.SMSMessageData?.Message ?? "no recipient in response"}` +
          `${first?.statusCode ? ` (code ${first.statusCode})` : ""}`,
      );
    }
    return { ref: first.messageId ?? `at-${first.statusCode}` };
  }
}

/**
 * Bind Africa's Talking when it is configured, else nothing.
 *
 * Returns undefined rather than a fake, deliberately: announcements treats an
 * unbound channel as `suppressed(no_provider)` and says so, which is honest.
 * A fake that swallowed messages would report every unsent receipt as sent.
 *
 * Note that binding this does NOT switch on SMS announcements — that service
 * takes its providers by constructor injection, so bulk sending stays a
 * separate, deliberate decision. Every message costs the church money.
 */
export function buildSmsProvider(env: Env): MessageProvider | undefined {
  const apiKey = env.AFRICASTALKING_API_KEY?.trim();
  const username = env.AFRICASTALKING_USERNAME?.trim();
  if (!apiKey || !username) return undefined;
  return new AfricasTalkingSmsProvider({
    apiKey,
    username,
    senderId: env.AFRICASTALKING_SENDER_ID?.trim() || undefined,
    // Sandbox is a different host, not a flag. Pointing production traffic at
    // it silently delivers nothing to anybody.
    baseUrl:
      env.AFRICASTALKING_ENV === "production"
        ? "https://api.africastalking.com"
        : "https://api.sandbox.africastalking.com",
  });
}
