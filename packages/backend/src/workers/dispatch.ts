// Notification dispatch provider (spec §1.5). The actual APNs/FCM/email send is
// behind this interface so the scheduling/worker logic is testable and the real
// providers (PUSH_PROVIDER_KEY / SMTP_*) drop in for production. Without either
// configured we use a logging provider — dev flows complete without delivery,
// but (per the incident this file was rewritten to close, PR notes) that must
// NEVER be mistaken for a real send: unconfigured email now fails the row
// loudly instead of quietly "succeeding" into a log line.
import type { Message, Messaging } from "firebase-admin/messaging";
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
  /** Push only: whether it makes a sound and vibrates — the member's
   *  `notification_preferences.sound_enabled` (migration 223). Absent = on. */
  sound?: boolean;
}

/**
 * How a push sounds (owner request 2026-09-28: "a beep sound / notification
 * sound or vibrations on any message that comes in … and make calls ring and
 * vibrate"). A chat message, a Live guest invite that RINGS like a call, or
 * any other update. The member apps create the Android channels below —
 * their ids are part of the contract, and immutable once on a phone.
 */
export type PushKind = "message" | "ring" | "update";
export function pushKind(template: string): PushKind {
  if (template === "live_guest_invite") return "ring";
  if (template.startsWith("chat_")) return "message";
  return "update";
}
export const PUSH_CHANNEL = {
  message: "nuru_messages",
  update: "nuru_updates",
  ring: "nuru_live_invite",
  quiet: "nuru_quiet",
} as const;
/** The ring bundled in the iOS app (≤ 30 s, iOS's limit for a push sound). */
export const RING_SOUND = "nuru_ring.caf";
/** A Live invite is worth ringing for a minute at most — after that it is
 *  stale, and it is dropped rather than delivered late. */
export const RING_TTL_MS = 60_000;

/**
 * The FCM message for one push — pure, so every case is pinned by a test.
 *
 * Every push's `data` carries the notification's own keys, its `template`,
 * `nuru_kind` and `nuru_sound` ("on" | "off"), so an app can choose how to
 * show it in the foreground. Before this, APNs alerts carried no `sound` —
 * iOS delivered every push silently — and Android had one default channel.
 *
 * - message / update: a notification on its channel (`nuru_messages`,
 *   heads-up; `nuru_updates`), `aps.sound` "default"; a chat message's
 *   conversation groups its alerts (`thread-id`).
 * - ring: DATA-ONLY on Android, so the app itself rings — an insistent,
 *   full-screen invite for up to 30 s; an alert with the ring on iOS. Both
 *   expire after a minute. `alert_title` / `alert_body` carry the invite's
 *   words; `title` stays the stream's name.
 * - muted (`sound: false`): the same push, quietly — `nuru_quiet`, no
 *   `aps.sound`. It still arrives.
 */
export function fcmMessage(msg: DispatchMessage, copy: { title: string; body: string }, nowMs: number = Date.now()): Message {
  const kind = pushKind(msg.template);
  const sound = msg.sound !== false;
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(msg.payload)) {
    if (v != null) data[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  data.template ??= msg.template;
  data.nuru_kind = kind;
  data.nuru_sound = sound ? "on" : "off";
  if (kind === "ring") {
    // `title` stays the payload's (the stream's name); the invite's own words
    // ride beside it for the app to show, and `body` for an app that predates
    // ringing (it renders a data-only push from `title` + `body`).
    data.alert_title = copy.title;
    data.alert_body = copy.body;
    data.body ??= copy.body;
    return {
      token: msg.to,
      data,
      android: { priority: "high", ttl: RING_TTL_MS },
      apns: {
        headers: { "apns-priority": "10", "apns-expiration": String(Math.floor((nowMs + RING_TTL_MS) / 1000)) },
        payload: { aps: { alert: { title: copy.title, body: copy.body }, ...(sound ? { sound: RING_SOUND } : {}) } },
      },
    };
  }
  const threadId = str(msg.payload.conversation_id);
  return {
    token: msg.to,
    notification: { title: copy.title, body: copy.body },
    data,
    android: {
      priority: "high",
      notification: sound
        ? { channelId: PUSH_CHANNEL[kind], defaultSound: true, defaultVibrateTimings: true }
        : { channelId: PUSH_CHANNEL.quiet },
    },
    apns: {
      headers: { "apns-priority": "10" },
      payload: { aps: { ...(sound ? { sound: "default" } : {}), ...(threadId ? { threadId } : {}) } },
    },
  };
}

export interface DispatchProvider {
  send(msg: DispatchMessage): Promise<void>;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
/** "KSh 1,000" / "USD 12.50" from a payload's amount_minor + currency —
 *  cents shown when there are any (Giving Cycle 5: USD 12.50 read "USD 13"). */
function money(p: Record<string, unknown>): string {
  const minor = num(p.amount_minor) ?? 0;
  const cur = str(p.currency) ?? "KES";
  const cents = minor % 100 !== 0;
  const text = (minor / 100).toLocaleString("en-KE", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
  return `${cur === "KES" ? "KSh" : cur} ${text}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "5 October" for a payload's YYYY-MM-DD date (as given — no time-zone math). */
function dayWords(ymd: string | undefined): string | undefined {
  const m = ymd ? /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd) : null;
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : ymd;
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
  // Ekklesia (the intercessory watch): the service composes an explicit
  // title/body at the call site; this is the net under it.
  ekklesia_request: (p) => ({
    title: str(p.urgency) === "urgent" ? "Ekklesia · urgent" : "Ekklesia · a need for the watch",
    body: str(p.body) || "A need has been brought to the watch. Will you stand in the gap today?",
  }),
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
  // A recurring gift that didn't go through. Never scolding — the giver's
  // intent is not in question, only the collection.
  // Departments (docs/PARTNERS_PROGRAMME.md §4).
  serve_request_received: (p) => ({ title: `${str(p.name) ?? "Someone"} wants to serve in ${str(p.department) ?? "your department"}`, body: "Open the portal to welcome them in." }),
  serve_request_approved: (p) => ({ title: `Welcome to ${str(p.department) ?? "the department"}`, body: "Your request to serve was approved. Open Departments to see what's next." }),
  serve_request_declined: (p) => ({ title: `About ${str(p.department) ?? "the department"}`, body: "The leader couldn't take you on right now. Other departments would love your hands — open Departments." }),
  department_post: (p) => ({ title: str(p.department) ?? "Your department", body: str(p.preview) ?? "A new post from your department." }),
  department_need_open: (p) => ({ title: `${str(p.title) ?? "A need"} — giving is open`, body: "Your department has a need you can help carry. Open Departments to give." }),
  department_need_approved: (p) => ({ title: "Your need was approved", body: `${str(p.title) ?? "The need"} is open for giving.` }),
  department_need_rejected: (p) => ({ title: "About the need you submitted", body: str(p.note) ?? `${str(p.title) ?? "The need"} was not approved this time.` }),
  department_need_closed: (p) => ({ title: "Need closed", body: `${str(p.title) ?? "The need"} has been closed. Thank you.` }),
  // Partners programme (docs/PARTNERS_PROGRAMME.md §3). Warm, never shaming.
  pledge_due_soon: (p) => {
    const days = num(p.days_away);
    return {
      title: `${str(p.title) ?? "Your pledge"} — ${days === 0 ? "due today" : days === 1 ? "due tomorrow" : `due in ${days} days`}`,
      body: `${money(p)} toward your pledge. Open Partners to give, or to pause it if this month is tight.`,
    };
  },
  pledge_overdue: (p) => ({
    title: `A gentle nudge on ${str(p.title) ?? "your pledge"}`,
    body: `${money(p)} was due on ${dayWords(str(p.due_on)) ?? "the due date"}. No pressure — give when you can, or tell us if you paid another way.`,
  }),
  pledge_reminder_manual: (p) => ({
    title: `From the church office: ${str(p.title) ?? "your pledge"}`,
    body: str(p.message) ?? `A reminder that ${money(p)} toward your pledge is waiting. Thank you for standing with us.`,
  }),
  pledge_fulfilled: (p) => ({
    title: "Pledge fulfilled — thank you",
    body: `You completed your ${str(p.title) ?? "pledge"}. Every shilling carried someone further.${p.schedule_stopped === true ? " Its automatic prompts have stopped." : ""} Open Partners to see it.`,
  }),
  pledge_claim_confirmed: (p) => ({
    title: "Your payment is recorded",
    body: `${money(p)} toward ${str(p.title) ?? "your pledge"} has been confirmed by the office. Thank you.`,
  }),
  pledge_claim_rejected: (p) => ({
    title: "We couldn't match that payment",
    body: `The office could not find ${money(p)} toward ${str(p.title) ?? "your pledge"}. Reply in Community or give again from Partners.`,
  }),
  // Giving Cycle 1: say WHY, and what happens next — a cancelled prompt is
  // not a broken phone, and "we'll try again" is only said when we will.
  giving_schedule_failed: (p) => ({
    title: `Your ${str(p.frequency) === "weekly" ? "weekly" : str(p.frequency) === "monthly" ? "monthly" : "recurring"} gift didn't go through`,
    body: [
      str(p.reason) ?? "We couldn't collect it this time.",
      str(p.retry_at) ? "We'll send the prompt once more later today." : str(p.hint) ?? "Open Give to give now or check your number.",
    ].join(" "),
  }),
  // Giving Cycle 3: a member's own gift that failed where they could not see
  // it (the prompt never reached them, or no answer came before they left).
  giving_gift_failed: (p) => ({
    title: "Your gift didn't go through",
    body: `${str(p.reason) ?? "The payment didn't complete."} ${str(p.hint) ?? "Open Give to try again."}`,
  }),
  // Giving Cycle 4: minutes before a scheduled M-Pesa prompt, so it is
  // expected rather than dismissed as a scam.
  giving_schedule_heads_up: (p) => ({
    title: `Your ${str(p.frequency) === "weekly" ? "weekly" : "monthly"} gift is ready`,
    body: p.partial === true && str(p.pledge_title)
      ? `An M-Pesa prompt for ${money(p)} — the rest of what's due on “${str(p.pledge_title)}” — is coming to your phone in a few minutes. Enter your PIN to give.`
      : `An M-Pesa prompt for ${money(p)} to ${str(p.fund_name) ?? "the church"} is coming to your phone in a few minutes. Enter your PIN to give.`,
  }),
  // Giving Cycle 7: the church office changed a recurring gift at the
  // member's request — they are always told, in words.
  giving_schedule_office_change: (p) => {
    const gift = `${str(p.frequency) === "weekly" ? "weekly" : "monthly"} gift of ${money(p)}${str(p.fund_name) ? ` to ${str(p.fund_name)}` : ""}`;
    const action = str(p.action);
    return {
      title: action === "cancel" ? "Your recurring gift was cancelled" : action === "resume" ? "Your recurring gift is back on" : "Your recurring gift is paused",
      body: action === "cancel"
        ? `The church office cancelled your ${gift}, as you asked. Nothing more will be prompted.`
        : action === "resume"
          ? `The church office resumed your ${gift}, as you asked.`
          : `The church office paused your ${gift}, as you asked${str(p.resume_on) ? ` — it starts again on ${dayWords(str(p.resume_on))}` : ""}.`,
    };
  },
  // Giving Cycle 5: a pledge's collector skips a cycle already paid, and
  // stops with its pledge — each said once, in words.
  giving_schedule_covered: (p) => ({
    title: `Nothing to pay this ${str(p.frequency) === "weekly" ? "week" : "month"}`,
    body: `${str(p.title) ? `“${str(p.title)}”` : "Your pledge"} is already paid${str(p.covered_through) ? ` through ${dayWords(str(p.covered_through))}` : ""}, so no M-Pesa prompt is coming this time. Thank you.`,
  }),
  giving_schedule_stopped: (p) => {
    const pledge = str(p.title) ? `“${str(p.title)}”` : "Your pledge";
    const reason = str(p.reason);
    return {
      title: reason === "pledge_fulfilled" ? "Your pledge is complete" : reason === "pledge_ended" ? "Your pledge has ended" : "Automatic prompts stopped",
      body: reason === "pledge_fulfilled"
        ? `${pledge} is fulfilled, so its automatic M-Pesa prompts have stopped. Thank you for carrying it through.`
        : reason === "pledge_ended"
          ? `${pledge} ended${str(p.until_on) ? ` on ${dayWords(str(p.until_on))}` : ""}, so its automatic prompts have stopped. Open Partners to make a new pledge.`
          : `${pledge} was cancelled, so its recurring gift has stopped too.`,
    };
  },
  giving_schedule_paused: (p) => ({
    title: "Your recurring gift is paused",
    body: `${str(p.reason) ? `${str(p.reason)} ` : ""}We've stopped sending prompts for now. Open Give to resume it whenever you're ready.`,
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
  // An explicit push title is a call site composing its own copy — it sets
  // title AND body (chat, blessings, prayer chains, announcements). A payload
  // with a title but no body is naming the THING the notice is about — a
  // pledge, a department need — and the table's words come first (Giving
  // Cycle 10: a pledge reminder's lock screen read "Kenya trip" instead of
  // "Kenya trip — due in 3 days", a covered month "Kenya trip" instead of
  // "Nothing to pay this month").
  const composed = str(p.title) !== undefined && str(p.body) !== undefined;
  const title = (composed ? str(p.title) : undefined) ?? generated?.title ?? str(p.title) ?? "Nuru Pathway";
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
    const copy = pushCopy(msg, this.log);
    const messaging = await this.messagingClient();
    // Throws on invalid/expired token → the worker marks the row 'failed' and logs.
    await messaging.send(fcmMessage(msg, copy));
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
      { channel: msg.channel, template: msg.template, to: msg.to, title, body, kind: pushKind(msg.template), sound: msg.sound !== false },
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
  // Partners programme — one short segment each (≤ 140 GSM-7).
  pledge_due_soon: (p) => `Nuru Pathway: ${money(p)} toward your pledge is due ${num(p.days_away) === 0 ? "today" : num(p.days_away) === 1 ? "tomorrow" : `in ${num(p.days_away)} days`}. Open the app > Give > Partners. Thank you.`,
  pledge_overdue: (p) => `Nuru Pathway: a gentle reminder — ${money(p)} toward your pledge was due ${str(p.due_on) ?? ""}. Give when you can, or tell us if you paid another way.`,
  pledge_reminder_manual: (p) => (str(p.message) ? `Nuru Pathway: ${str(p.message)}` : `Nuru Pathway: a reminder that ${money(p)} toward your pledge is waiting. Thank you for standing with us.`),
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
