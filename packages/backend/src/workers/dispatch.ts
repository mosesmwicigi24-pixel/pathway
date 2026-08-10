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

export interface DispatchMessage {
  channel: "push" | "email";
  to: string; // device token or email address
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

  // Routes by channel — push and email are fully independent providers below
  // this line; neither ever silently substitutes for the other.
  return {
    send: (msg) => (msg.channel === "email" ? emailProvider.send(msg) : pushProvider.send(msg)),
  };
}

// Exported for tests: unit-test copy resolution and email rendering directly
// without needing FCM/SMTP env vars or a running worker.
export { pushCopy, EmailDispatchProvider, PUSH_TEMPLATE_COPY, EMAIL_TEMPLATE_COPY, formatMoney };
