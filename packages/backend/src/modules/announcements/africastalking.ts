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
import type { Logger } from "pino";
import type { Env } from "../../config/env.js";
import type { MessageProvider, OutboundMessage } from "./providers.js";

/**
 * Africa's Talking status codes that mean "we have it": 100 Processed,
 * 101 Sent, 102 Queued — everything else in their table (401 RiskHold,
 * 402 InvalidSenderId, 405 InsufficientBalance, ...) is a failure.
 *
 * 100 was missing from this set on 2026-08-22, and the error it produced reads
 * like a paradox worth remembering: "rejected the message: Success (code 100)".
 * The very first receipt Africa's Talking genuinely accepted was thrown as a
 * failure, so the outbox dutifully retried a DELIVERED text up to its attempt
 * cap — the giver was thanked in quintuplicate, at five times the cost. A wrong
 * entry here fails safe in NEITHER direction, which is why the tests pin all
 * three success codes individually.
 */
const ACCEPTED = new Set([100, 101, 102]);

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
    private readonly log?: Logger | undefined,
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

    // Log the outcome even though it succeeded.
    //
    // 101 and 102 are BOTH accepted, and they do not mean the same thing: 101
    // is sent, 102 is queued — and a queue can sit forever when the sender id
    // is not approved or the account is under review. A receipt that Africa's
    // Talking accepted and never delivered used to leave no trace at all here,
    // so "the church says it texted me and I got nothing" was unanswerable.
    // `cost` is the other tell: a message that will never be delivered is
    // usually accepted at a cost of 0.
    this.log?.info(
      {
        at_status: first.status,
        at_status_code: first.statusCode,
        at_message_id: first.messageId,
        at_cost: first.cost,
        sender_id: this.cfg.senderId ?? "(shared pool)",
      },
      first.statusCode === 102
        ? "sms QUEUED by Africa's Talking (not yet sent) — check the sender id is approved if it never arrives"
        : "sms accepted by Africa's Talking",
    );
    return { ref: first.messageId ?? `at-${first.statusCode}` };
  }

  /**
   * Submit ONE body to MANY numbers and return Africa's Talking's verdict for
   * each. Campaigns need the per-recipient rows — messageId is what the
   * delivery-report webhook keys on, statusCode is per-number (one blacklisted
   * number does not fail its neighbours), and cost is the honest bill.
   *
   * The caller chunks; this sends exactly what it is given in one request.
   * HTTP-level failure throws (nothing was accepted); a per-recipient refusal
   * does NOT throw — it is a row in the report, not an exception.
   */
  async sendBatch(
    numbers: string[],
    body: string,
  ): Promise<Array<{ number: string; statusCode: number; status: string; messageId: string | null; cost: string | null }>> {
    if (numbers.length === 0) return [];
    const form = new URLSearchParams({
      username: this.cfg.username,
      to: numbers.join(","),
      message: body,
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
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 30_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Africa's Talking returned ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
    }
    const parsed = (await res.json()) as { SMSMessageData?: { Recipients?: ATRecipient[] } };
    return (parsed.SMSMessageData?.Recipients ?? []).map((r) => ({
      number: r.number ?? "",
      statusCode: Number(r.statusCode ?? 0),
      status: r.status ?? "",
      messageId: r.messageId ?? null,
      cost: r.cost ?? null,
    }));
  }

  /**
   * The account balance, as Africa's Talking states it ("KES 1234.50"), or
   * null when unreadable. Advisory only — shown beside the cost estimate so an
   * admin sees "credit is about to run out" BEFORE the delivery reports say it
   * the expensive way. Never blocks a send on its own.
   */
  async balance(): Promise<string | null> {
    try {
      const res = await fetch(
        `${this.cfg.baseUrl}/version1/user?username=${encodeURIComponent(this.cfg.username)}`,
        { headers: { apiKey: this.cfg.apiKey, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) return null;
      const parsed = (await res.json()) as { UserData?: { balance?: string } };
      return parsed.UserData?.balance ?? null;
    } catch {
      return null;
    }
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
export function buildSmsProvider(env: Env, log?: Logger): MessageProvider | undefined {
  const apiKey = env.AFRICASTALKING_API_KEY?.trim();
  const username = env.AFRICASTALKING_USERNAME?.trim();
  if (!apiKey || !username) return undefined;
  if (env.AFRICASTALKING_ENV !== "production") {
    // The sandbox is not a degraded mode — it is a different host that ACCEPTS
    // every message with a happy 101 and delivers to nobody outside their
    // simulator. Bound here by accident, every receipt reports sent and no
    // phone ever rings, which is indistinguishable from working in every place
    // but the giver's pocket. Say so at bind time, once, where logs are read.
    log?.warn(
      { at_env: env.AFRICASTALKING_ENV ?? "(unset)" },
      "Africa's Talking bound to the SANDBOX host — messages will be accepted and delivered to NOBODY. " +
        "Set AFRICASTALKING_ENV=production in the api AND worker containers if this is production.",
    );
  }
  return new AfricasTalkingSmsProvider(
    {
      apiKey,
      username,
      senderId: env.AFRICASTALKING_SENDER_ID?.trim() || undefined,
      // Sandbox is a different host, not a flag. Pointing production traffic at
      // it silently delivers nothing to anybody.
      baseUrl:
        env.AFRICASTALKING_ENV === "production"
          ? "https://api.africastalking.com"
          : "https://api.sandbox.africastalking.com",
    },
    log,
  );
}
