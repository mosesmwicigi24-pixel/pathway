// Notification sounds (owner request 2026-09-28): "a beep sound / notification
// sound or vibrations on any message that comes in — and a place you can mute
// it; make calls ring and vibrate too". Pushes sound by default; a member can
// mute them (notification_preferences.sound_enabled, migration 223) and they
// still arrive, quietly; a Live guest invite rings like a call.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { NotificationWorker } from "../src/workers/notificationWorker.js";
import { fcmMessage, pushKind, PUSH_CHANNEL, RING_SOUND, RING_TTL_MS, type DispatchMessage, type DispatchProvider } from "../src/workers/dispatch.js";

const copy = { title: "A title", body: "A body" };
const push = (template: string, payload: Record<string, unknown> = {}, sound?: boolean): DispatchMessage =>
  ({ channel: "push", to: "tok", template, payload, ...(sound === undefined ? {} : { sound }) });
// The FCM Message union, read as a plain object for assertions.
const plain = (m: ReturnType<typeof fcmMessage>) => m as unknown as {
  notification?: { title: string; body: string };
  data: Record<string, string>;
  android: { priority: string; ttl?: number; notification?: Record<string, unknown> };
  apns: { headers: Record<string, string>; payload: { aps: Record<string, unknown> } };
};

describe("which way a push sounds", () => {
  it("a Live guest invite rings; chat messages are messages; the rest are updates", () => {
    expect(pushKind("live_guest_invite")).toBe("ring");
    expect(pushKind("live_stream_started")).toBe("update");
    for (const t of ["chat_dm_message", "chat_discipler_message", "chat_pastoral_message", "chat_broadcast"]) expect(pushKind(t)).toBe("message");
    for (const t of ["pledge_due_soon", "giving_gift_failed", "event_reminder_24h", "connection_request_received"]) expect(pushKind(t)).toBe("update");
  });

  it("an update sounds and vibrates: its channel, the default sound on iOS, and the app told what it is", () => {
    const m = plain(fcmMessage(push("pledge_due_soon", { pledge_id: "p1", title: "Kenya trip" }), copy));
    expect(m.notification).toEqual(copy);
    expect(m.android.notification).toEqual({ channelId: PUSH_CHANNEL.update, defaultSound: true, defaultVibrateTimings: true });
    expect(m.apns.payload.aps.sound).toBe("default");
    expect(m.apns.headers["apns-priority"]).toBe("10");
    expect(m.data).toMatchObject({ pledge_id: "p1", title: "Kenya trip", template: "pledge_due_soon", nuru_kind: "update", nuru_sound: "on" });
  });

  it("a chat message goes to the heads-up Messages channel and groups by conversation on iOS", () => {
    const m = plain(fcmMessage(push("chat_dm_message", { conversation_id: "c-1", title: "Ada", body: "Hi" }), copy));
    expect(m.android.notification).toMatchObject({ channelId: PUSH_CHANNEL.message, defaultSound: true });
    expect(m.apns.payload.aps).toMatchObject({ sound: "default", threadId: "c-1" });
    expect(m.data.nuru_kind).toBe("message");
  });

  it("muted, the same push arrives quietly: the quiet channel, no sound key", () => {
    const m = plain(fcmMessage(push("chat_dm_message", { conversation_id: "c-1" }, false), copy));
    expect(m.notification).toEqual(copy);
    expect(m.android.notification).toEqual({ channelId: PUSH_CHANNEL.quiet });
    expect(m.apns.payload.aps).not.toHaveProperty("sound");
    expect(m.data.nuru_sound).toBe("off");
  });

  it("a Live guest invite rings: data-only on Android (the app rings it), an alert with the ring on iOS, stale after a minute", () => {
    const now = Date.parse("2026-09-28T13:00:00Z");
    const m = plain(fcmMessage(push("live_guest_invite", { stream_id: "s-1", title: "Sunday service" }), { title: "Join Live", body: "You're invited" }, now));
    expect(m.notification).toBeUndefined();
    expect(m.android).toEqual({ priority: "high", ttl: RING_TTL_MS });
    expect(m.data).toMatchObject({
      stream_id: "s-1", title: "Sunday service", template: "live_guest_invite", nuru_kind: "ring", nuru_sound: "on",
      alert_title: "Join Live", alert_body: "You're invited", body: "You're invited",
    });
    expect(m.apns.payload.aps).toEqual({ alert: { title: "Join Live", body: "You're invited" }, sound: RING_SOUND });
    expect(m.apns.headers["apns-expiration"]).toBe(String(Math.floor((now + 60_000) / 1000)));
  });

  it("a muted member's invite still arrives, without ringing", () => {
    const m = plain(fcmMessage(push("live_guest_invite", { stream_id: "s-1" }, false), copy));
    expect(m.apns.payload.aps).not.toHaveProperty("sound");
    expect(m.data.nuru_sound).toBe("off");
  });

  it("a payload's own `template` key is kept; nothing null reaches FCM's string-only data", () => {
    const m = plain(fcmMessage(push("nudge", { template: "custom", gone: null, n: 3 }), copy));
    expect(m.data.template).toBe("custom");
    expect(m.data).not.toHaveProperty("gone");
    expect(m.data.n).toBe("3");
  });
});

describe("the worker sends each member's own choice", () => {
  class FakeProvider implements DispatchProvider {
    sends: DispatchMessage[] = [];
    send(msg: DispatchMessage): Promise<void> { this.sends.push(msg); return Promise.resolve(); }
  }
  let cong: string;
  beforeEach(async () => { await resetDb(); cong = await createCongregation(); });
  afterAll(async () => { await closeTestPool(); });

  it("sound on with no preferences row, off for a member who muted it", async () => {
    const loud = (await createUser({ congregationId: cong })).user_id;
    const quiet = (await createUser({ congregationId: cong })).user_id;
    await testPool().query(`INSERT INTO notification_preferences (user_id, sound_enabled) VALUES ($1, FALSE)`, [quiet]);
    for (const [u, tok] of [[loud, "tok-loud"], [quiet, "tok-quiet"]] as const) {
      await testPool().query(`INSERT INTO push_tokens (user_id, platform, token, is_active) VALUES ($1, 'ios', $2, TRUE)`, [u, tok]);
      await testPool().query(
        `INSERT INTO notifications (user_id, channel, template, payload, status, scheduled_for)
         VALUES ($1, 'push', 'chat_dm_message', '{"conversation_id":"c-1"}'::jsonb, 'scheduled', now() - interval '1 minute')`,
        [u],
      );
    }
    const provider = new FakeProvider();
    expect(await new NotificationWorker(testPool(), provider).dispatchDue()).toEqual({ sent: 2, failed: 0 });
    const byToken = Object.fromEntries(provider.sends.map((s) => [s.to, s.sound]));
    expect(byToken).toEqual({ "tok-loud": true, "tok-quiet": false });
  });
});
