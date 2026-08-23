// Notification dispatch provider (spec §1.5). The actual APNs/FCM/email send is
// behind this interface so the scheduling/worker logic is testable and the real
// providers (PUSH_PROVIDER_KEY / SMTP_*) drop in for production. Without either
// configured we use a logging provider — dev flows complete without delivery,
// but (per the incident this file was rewritten to close, PR notes) that must
// NEVER be mistaken for a real send: unconfigured email now fails the row
// loudly instead of quietly "succeeding" into a log line.
import type { Messaging } from "firebase-admin/messaging";
import type { Logger } from "pino";
import type { Env } from "../config/env.js";
import { buildEmailProvider, type EmailProvider } from "../modules/identity/email.js";
import { buildSmsProvider } from "../modules/announcements/africastalking.js";
import type { MessageProvider } from "../modules/announcements/providers.js";
import { fitSms, firstNameOf, gsm7Length } from "../lib/sms-text.js";

export interface DispatchMessage {
  channel: "push" | "email" | "sms";
  to: string; // device token, email address, or E.164 phone number
  template: string;
  payload: Record<string, unknown>;
}

export interface DispatchProvider {
  send(msg: DispatchMessage): Promise<void>;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Template → human copy for push notifications (Bug: members were receiving
 * the raw template name — e.g. "badge awarded", "level completed", "event
 * cancelled", "member care flag" — as the push body, because pushCopy() fell
 * back to `template.replace(/_/g, " ")`). One entry per push-channel template
 * that does NOT already compose an explicit payload.title/payload.body at its
 * call site (chat DM/discipler/pastoral/broadcast + community_blessing +
 * prayer_chain + announcement already do — see pushCopy() below, which always
 * prefers an explicit payload over this table).
 *
 * Each function must be defensive (payload is user/AI/DB-adjacent data) and
 * MUST NEVER throw — a copy bug must never block a real notification.
 *
 * `member_care_flag` is deliberately generic: signals.ts documents "no
 * content in the push" by design (a leader's lock screen must never show a
 * member's sensitive detail), so this table honours that and does NOT look up
 * or echo anything about the flagged member.
 */
const PUSH_TEMPLATE_COPY: Record<
  string,
  (p: Record<string, unknown>) => { title: string; body: string }
> = {
  badge_awarded: (p) => ({
    title: "New badge!",
    body: str(p.name)
      ? `${str(p.name)} badge earned — well done!`
      : "You just earned a new badge. Well done!",
  }),
  level_completed: (p) => {
    const level = num(p.level_number);
    return {
      title: "Level complete!",
      body: level
        ? `You've completed Level ${level}. Keep growing!`
        : "You've completed a level. Keep growing!",
    };
  },
  level_ushered: (p) => {
    const level = num(p.level_number);
    return {
      title: "You've been ushered forward",
      body:
        str(p.message) ??
        (level
          ? `Your discipler has ushered you into Level ${level}.`
          : "Your discipler has ushered you into your next level."),
    };
  },
  event_cancelled: (p) => {
    const title = str(p.title);
    const note = str(p.note);
    return {
      title: "Event cancelled",
      body: title
        ? `${title} has been cancelled.${note ? ` ${note}` : ""}`
        : "An event you RSVP'd to has been cancelled.",
    };
  },
  event_rescheduled: (p) => {
    const title = str(p.title);
    return {
      title: "Event rescheduled",
      body: title
        ? `${title} has a new time — check the event for details.`
        : "An event you RSVP'd to has a new time.",
    };
  },
  event_low_rsvp: (p) => {
    const going = num(p.going);
    const threshold = num(p.threshold);
    return {
      title: "Low RSVPs",
      body:
        going != null && threshold != null
          ? `Only ${going} of ${threshold} RSVPs so far — help spread the word.`
          : "This event could use a few more RSVPs — help spread the word.",
    };
  },
  event_reminder_24h: (p) => ({
    title: str(p.title) ?? "Event tomorrow",
    body: str(p.title)
      ? `${p.title} is tomorrow — see you there!`
      : "You have an event coming up tomorrow.",
  }),
  event_reminder_1h: (p) => ({
    title: str(p.title) ?? "Starting soon",
    body: str(p.title)
      ? `${p.title} starts in about an hour.`
      : "An event you RSVP'd to starts in about an hour.",
  }),
  member_care_flag: () => ({
    title: "A member may need care",
    body: "Someone in your flock has a new care signal — open Signals in the portal to see more.",
  }),
  sunday_letter: () => ({
    title: "Your Sunday Letter is ready",
    body: "A word written just for you this week — open Nuru Pathway to read it.",
  }),
  flock_brief: () => ({
    title: "Your Flock Brief is ready",
    body: "This week's summary of the people you shepherd is ready to read.",
  }),
  reengage: () => ({
    title: "Thinking of you",
    body: "It's been a while — your next step in Nuru Pathway is ready whenever you are.",
  }),
  reflection_approved: () => ({
    title: "Reflection approved",
    body: "Your reflection was approved — keep going!",
  }),
  reflection_returned: (p) => ({
    title: "A note on your reflection",
    body: str(p.feedback) ?? "Your discipler asked you to take another look at your reflection.",
  }),
  reflection_deferred: () => ({
    title: "Reflection deferred",
    body: "Your discipler is taking a little more time before deciding on your reflection.",
  }),
  plan_group_invite_received: (p) => ({
    title: "New reading invite",
    body: str(p.inviter_name)
      ? `${p.inviter_name} invited you to read together.`
      : "You've been invited to read together.",
  }),
  plan_group_invite_accepted: (p) => ({
    title: "Invite accepted",
    body: str(p.full_name)
      ? `${p.full_name} accepted your reading invite.`
      : "Your reading invite was accepted.",
  }),
  plan_group_member_joined: (p) => ({
    title: "Your reading group grew",
    body: str(p.full_name)
      ? `${p.full_name} just joined your reading group.`
      : "Someone just joined your reading group.",
  }),
  plan_group_day_completed: (p) => {
    const name = str(p.notifier_name);
    const day = num(p.day_number);
    return {
      title: "Reading update",
      body:
        name && day != null
          ? `${name} completed Day ${day} — keep each other going!`
          : "A friend in your reading group just completed a day.",
    };
  },
  space_join_requested: (p) => ({
    title: "New join request",
    body: str(p.requester_name)
      ? `${p.requester_name} wants to join your space.`
      : "Someone wants to join your space.",
  }),
  space_join_accepted: () => ({
    title: "You're in!",
    body: "Your request to join the space was accepted.",
  }),
  space_join_declined: () => ({
    title: "Join request update",
    body: "Your request to join that space wasn't accepted this time.",
  }),
  connection_request_received: (p) => ({
    title: "New connection request",
    body: str(p.full_name)
      ? `${p.full_name} wants to connect with you.`
      : "Someone wants to connect with you.",
  }),
  connection_request_accepted: (p) => ({
    title: "Connection accepted",
    body: str(p.full_name)
      ? `${p.full_name} accepted your connection request.`
      : "Your connection request was accepted.",
  }),
  connection_request_declined: () => ({
    title: "Connection update",
    body: "Your connection request wasn't accepted this time.",
  }),
  live_stream_started: (p) => ({
    title: str(p.title) ?? "We're live!",
    body: "Tap in — a broadcast just started.",
  }),
  live_guest_invite: (p) => ({
    title: "You're invited to go live",
    body: str(p.title)
      ? `You've been invited to join "${p.title}" as a guest.`
      : "You've been invited to join a live broadcast as a guest.",
  }),
};

/** The full set of push templates this dispatcher knows how to render real
 *  copy for — exported for table-driven tests so a template added without
 *  copy fails the suite instead of shipping a raw identifier to a member. */
export const KNOWN_PUSH_TEMPLATES = Object.keys(PUSH_TEMPLATE_COPY);

/** Human title/body for a push, from the notification payload. Call sites
 *  that already know exactly what a member should read (chat DM/discipler/
 *  pastoral/broadcast, community_blessing, prayer_chain, announcement) set
 *  payload.title + payload.body explicitly and that ALWAYS wins. Everything
 *  else resolves through PUSH_TEMPLATE_COPY using the payload's specifics
 *  (badge name, level number, event title, member name, ...) so the push
 *  says something real. Only a template with neither falls to the dignified
 *  generic fallback below — logged at WARN so a missing template is visible,
 *  not silently shipped as its own identifier (the bug this closes). */
function pushCopy(msg: DispatchMessage, log?: Logger): { title: string; body: string } {
  const p = msg.payload;
  const generated = PUSH_TEMPLATE_COPY[msg.template]?.(p);
  const title = str(p.title) ?? generated?.title ?? "Nuru Pathway";
  const body = str(p.body) ?? generated?.body ?? str(p.feedback);
  if (body) return { title, body };

  log?.warn(
    { template: msg.template },
    "push dispatch: no copy for template — shipping generic fallback (add one to PUSH_TEMPLATE_COPY)",
  );
  return { title, body: "A new update in Nuru Pathway" };
}

/**
 * Real FCM push via the Firebase Admin SDK (§D-M9). Initialised lazily from
 * FCM_SERVICE_ACCOUNT (JSON string or a file path). `data` values must be
 * strings per FCM.
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
    const app =
      getApps().find((a) => a?.name === "nuru-fcm") ??
      initializeApp({ credential: cert(creds) }, "nuru-fcm");
    this.messaging = getMessaging(app);
    return this.messaging;
  }

  async send(msg: DispatchMessage): Promise<void> {
    if (msg.channel !== "push") return this.fallback.send(msg);
    const { title, body } = pushCopy(msg, this.log);
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(msg.payload)) {
      if (v != null) data[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    const messaging = await this.messagingClient();
    // Throws on invalid/expired token → the worker marks the row 'failed' and logs.
    await messaging.send({
      token: msg.to,
      notification: { title, body },
      data,
      android: { priority: "high" },
    });
  }
}

/** No FCM key configured (dev/tests): log what WOULD have been sent, with the
 *  real rendered copy so a dev reading logs sees the actual member-facing
 *  text, not just a template id. */
class LoggingPushDispatchProvider implements DispatchProvider {
  constructor(private readonly log?: Logger) {}
  send(msg: DispatchMessage): Promise<void> {
    const { title, body } = pushCopy(msg, this.log);
    this.log?.info(
      { channel: msg.channel, template: msg.template, to: msg.to, title, body },
      "notification (logged, no push provider)",
    );
    return Promise.resolve();
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/** Integer minor units + ISO currency → a locale-formatted amount string.
 *  Money is NEVER a float in this codebase (CLAUDE.md) — this is presentation
 *  formatting at the very edge of the system, not a stored/compared value. */
function formatMoney(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amountMinor / 100);
  } catch {
    return `${currency.toUpperCase()} ${(amountMinor / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  }
}

/**
 * Template → rendered email for the email channel. One entry per
 * email-channel template (today: only `giving_receipt` — every other
 * notification template schedules on channel:"push"; announcements' email
 * delivery is a separate, already-correct path that calls EmailProvider
 * directly rather than riding this dispatcher, see announcements/service.ts).
 */
const EMAIL_TEMPLATE_COPY: Record<
  string,
  (p: Record<string, unknown>) => { subject: string; text: string; html: string }
> = {
  giving_receipt: (p) => {
    const amount =
      typeof p.amount_minor === "number"
        ? formatMoney(p.amount_minor, str(p.currency) ?? "KES")
        : null;
    const fund = str(p.fund) ?? "General Fund";
    const congregation = str(p.congregation) ?? "Nuru Place Church";
    const member = str(p.member_name);
    const date = str(p.date)
      ? new Date(String(p.date)).toLocaleDateString("en-US", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : new Date().toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
    const ref = str(p.receipt_code);
    const amountLine = amount ? `a gift of ${amount}` : "your gift";

    const subject = `Your gift receipt — ${congregation}`;
    const text = [
      member ? `Dear ${member},` : "Dear friend,",
      "",
      `Thank you for ${amountLine} to ${fund} on ${date}.`,
      ref ? `Receipt reference: ${ref}` : null,
      "",
      "Your generosity makes a real difference in our church family.",
      "",
      "With gratitude,",
      congregation,
    ]
      .filter((l): l is string => l !== null)
      .join("\n");

    const html = `
      <p>${member ? `Dear ${escapeHtml(member)},` : "Dear friend,"}</p>
      <p>Thank you for ${amount ? `a gift of <strong>${escapeHtml(amount)}</strong>` : "your gift"} to <strong>${escapeHtml(fund)}</strong> on ${escapeHtml(date)}.</p>
      ${ref ? `<p>Receipt reference: <strong>${escapeHtml(ref)}</strong></p>` : ""}
      <p>Your generosity makes a real difference in our church family.</p>
      <p>With gratitude,<br/>${escapeHtml(congregation)}</p>
    `.trim();

    return { subject, text, html };
  },
};

/** Real SMTP email via the SAME transport as password resets (identity/email.ts
 *  — one mailer, one EMAIL_FROM, one place that knows how to talk to SMTP_*).
 *  Unconfigured SMTP (dev/tests) does NOT fake success: it logs a loud WARN
 *  and throws, so NotificationWorker marks the row 'failed' — the exact
 *  opposite of the bug this closes, where a missing provider quietly
 *  "succeeded" into an INFO log line and every giving receipt vanished. */
class EmailDispatchProvider implements DispatchProvider {
  constructor(
    private readonly emailer: EmailProvider,
    private readonly configured: boolean,
    private readonly log?: Logger,
  ) {}

  async send(msg: DispatchMessage): Promise<void> {
    if (!this.configured) {
      this.log?.warn(
        { channel: msg.channel, template: msg.template, to: msg.to },
        "email not configured — receipt NOT sent",
      );
      throw new Error(`email dispatch: SMTP not configured (template=${msg.template})`);
    }
    const render = EMAIL_TEMPLATE_COPY[msg.template];
    const { subject, text, html } = render
      ? render(msg.payload)
      : (() => {
          // A template scheduled on channel:"email" without a renderer here is
          // exactly this file's original bug shape (silent drop) — never ship
          // it blank; log loudly and send a dignified, honest placeholder.
          this.log?.warn(
            { template: msg.template },
            "email dispatch: no template copy — using generic fallback (add one to EMAIL_TEMPLATE_COPY)",
          );
          return {
            subject: "An update from Nuru Pathway",
            text: "You have a new update in Nuru Pathway. Open the app for details.",
            html: "<p>You have a new update in Nuru Pathway. Open the app for details.</p>",
          };
        })();
    try {
      await this.emailer.send({ to: msg.to, subject, text, html });
    } catch (err) {
      this.log?.error({ err, template: msg.template, to: msg.to }, "email dispatch: send failed");
      throw err;
    }
  }
}

export function buildDispatchProvider(env: Env, log?: Logger): DispatchProvider {
  const pushFallback = new LoggingPushDispatchProvider(log);
  let pushProvider: DispatchProvider = pushFallback;
  if (env.FCM_SERVICE_ACCOUNT) {
    log?.info("notification dispatch: FCM push provider active");
    pushProvider = new FcmDispatchProvider(env.FCM_SERVICE_ACCOUNT, pushFallback, log);
  }

  const smtpConfigured = Boolean(env.SMTP_HOST);
  if (smtpConfigured) log?.info("notification dispatch: SMTP email provider active");
  const emailProvider = new EmailDispatchProvider(
    buildEmailProvider(env, log),
    smtpConfigured,
    log,
  );

  // SMS costs the church per message and reaches a member whether or not they
  // have the app, so an unbound provider must FAIL the row rather than log and
  // move on — the same rule the email path already follows, and for the same
  // reason: a notification marked `sent` that nobody received is worse than one
  // marked `failed`.
  const sms = buildSmsProvider(env, log);
  const smsProvider = new SmsDispatchProvider(sms, log);
  if (sms) log?.info("notification dispatch: Africa's Talking SMS provider active");

  // Routes by channel — the three are fully independent below this line; none
  // ever silently substitutes for another.
  return {
    send: (msg) =>
      msg.channel === "email"
        ? emailProvider.send(msg)
        : msg.channel === "sms"
          ? smsProvider.send(msg)
          : pushProvider.send(msg),
  };
}

/**
 * SMS delivery for the notification channel.
 *
 * Thin on purpose: the copy lives in SMS_TEMPLATE_COPY beside the push and
 * email renderers, and the sending is the same MessageProvider announcements
 * use, so there is one Africa's Talking client in the process rather than two.
 */
export class SmsDispatchProvider implements DispatchProvider {
  constructor(
    private readonly provider: MessageProvider | undefined,
    private readonly log?: Logger | undefined,
  ) {}

  async send(msg: DispatchMessage): Promise<void> {
    if (!this.provider) {
      // THROW, do not log-and-return. The worker marks a throwing row `failed`,
      // which is the truth; swallowing it would mark it `sent` and the member
      // would be recorded as having been told something they never received.
      throw new Error(
        `SMS dispatch: no provider configured (set AFRICASTALKING_API_KEY and ` +
          `AFRICASTALKING_USERNAME) — refusing to report template "${msg.template}" as sent`,
      );
    }
    const body = smsCopy(msg, this.log);
    await this.provider.send({ to: msg.to, title: "", body });
  }
}

/**
 * Template → the text a member actually receives.
 *
 * One entry per template that may be scheduled on the SMS channel. An unknown
 * template is NOT sent: a text costs money and lands on someone's phone, so a
 * generic fallback ("giving receipt") would be worse than nothing. Push can
 * afford a fallback; this cannot.
 */
/**
 * How every receipt signs off — the pastor, not the institution (owner ruling,
 * 2026-08-23). One constant shared with the Claude composer's validator
 * (receipt-ai.ts), so the template and AI paths can never drift apart. The
 * leading hyphen is deliberate: an em dash is not GSM-7 and bills every text
 * as two segments.
 */
export const RECEIPT_SIGNATURE = "- Pst Moses, TGNM";

/**
 * The one and only rendering of the giving-receipt text.
 *
 * Exported because the memberless website receipt used to build its own copy of
 * this message by hand — and that copy still carried the em dash after this one
 * was fixed, so every website receipt kept billing as two segments. A message
 * that exists twice gets fixed once.
 */
export function renderGivingReceiptSms(p: Record<string, unknown>): string {
  const amount = num(p.amount_minor);
  const money = amount === undefined ? "" : `${str(p.currency) ?? "KES"} ${(amount / 100).toFixed(2)}`;
  const fund = str(p.fund);
  const code = str(p.receipt_code);
  const who = firstNameOf(str(p.member_name));
  return (
    `${who ? `${who}, thank` : "Thank"} you for your gift${money ? ` of ${money}` : ""}` +
    `${fund ? ` to ${fund}` : ""}. ${code ? `M-Pesa ref ${code}. ` : ""}` +
    `God bless you. ${RECEIPT_SIGNATURE}`
  );
}

const SMS_TEMPLATE_COPY: Record<string, (p: Record<string, unknown>) => string> = {
  giving_receipt: (p) => {
    // A Claude-composed body may ride in the payload (see receipt-ai.ts). It
    // was validated when composed, but the payload has been through the
    // database since — re-measure before trusting it with the church's
    // airtime, and fall back to the template rather than send a dud.
    const composed = str(p.sms_body);
    if (composed) {
      const septets = gsm7Length(composed);
      if (septets !== null && septets <= 160) return composed;
    }
    return renderGivingReceiptSms(p);
  },
  check_in_welcome: (p) => renderCheckInWelcome(p),
};

/** One segment. The owner asked for 140; GSM-7 allows 160, so this sits inside it. */
export const CHECK_IN_SMS_BUDGET = 140;

/**
 * Welcome someone who has just checked in at a service.
 *
 * Two versions, and which one you get depends on whether the app is already on
 * your phone. Telling someone standing there holding the app to go and download
 * the app reads as a form letter, so it is not mentioned at all in that case;
 * someone who checked in from the web page has not got it, and this is the one
 * moment they have a concrete reason to want it.
 *
 * Length is a ladder, not a truncation. Kenyan names and congregation names are
 * each long enough to blow a 140-character budget — measured, not assumed: a
 * "Nyambura-Wangeci" at a "Nuru Christian Fellowship Church Nairobi" renders at
 * 148 once the download link is on the end. So the copy drops the congregation
 * name, then the greeting name, then the link, each rung still a sentence a
 * person would write. Truncating the overflow instead would text somebody half
 * their own name. The last rung has no variable parts at all, so "it fits" is a
 * property of the ladder rather than a hope about the inputs.
 */
export function renderCheckInWelcome(p: Record<string, unknown>): string {
  const name = firstNameOf(str(p.member_name));
  const church = str(p.congregation)?.trim();
  const hasApp = p.has_app === true;
  const url = str(p.app_url)?.trim();

  const withApp = [
    name && church ? `Karibu ${name}! Great to see you at ${church} today. God bless you.` : "",
    name ? `Karibu ${name}! Great to see you at church today. God bless you.` : "",
    `Karibu! Great to see you at church today. God bless you.`,
  ].filter(Boolean);

  if (hasApp || !url) return fitSms(withApp, CHECK_IN_SMS_BUDGET);

  return fitSms(
    [
      name && church ? `Karibu ${name}! Great to see you at ${church} today. Get the Nuru Pathway app: ${url}` : "",
      name ? `Karibu ${name}! Great to see you today. Get the Nuru Pathway app: ${url}` : "",
      `Karibu! Great to see you today. Get the Nuru Pathway app: ${url}`,
      // Floor: no link at all. Reached only if APP_PUBLIC_URL is long enough to
      // break even the barest invitation, in which case a welcome without a
      // link beats an over-length message billed as two.
      ...withApp,
    ].filter(Boolean),
    CHECK_IN_SMS_BUDGET,
  );
}

function smsCopy(msg: DispatchMessage, log?: Logger): string {
  const render = SMS_TEMPLATE_COPY[msg.template];
  if (!render) {
    log?.error(
      { template: msg.template },
      "sms dispatch: no copy for template — refusing to send rather than texting a placeholder",
    );
    throw new Error(`SMS dispatch: no copy for template "${msg.template}"`);
  }
  return render(msg.payload);
}

// Exported for tests: unit-test copy resolution and email rendering directly
// without needing FCM/SMTP env vars or a running worker.
export { pushCopy, EmailDispatchProvider, PUSH_TEMPLATE_COPY, EMAIL_TEMPLATE_COPY, formatMoney };
