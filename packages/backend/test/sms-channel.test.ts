// SMS as a channel members can actually be reached on (migration 204).
//
// `notification_preferences.sms_enabled` has existed since migration 90 and the
// app has shown a toggle for it the whole time — wired to nothing, because
// `notif_channel` was ENUM('push','email') and no code could schedule on it.
//
// The failures worth testing here are all silent ones:
//
//  - a preference that is declared but not SELECTed reads as undefined, so the
//    toggle appears dead for every member who has a preferences row;
//  - an unbound provider that logs instead of throwing marks a notification
//    `sent` that nobody received;
//  - an unknown template that falls back to generic copy sends a real text,
//    at real cost, saying something nobody wrote.
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { pino } from "pino";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { testEnv } from "./helpers/app.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { NotificationService } from "../src/modules/notifications/service.js";
import { SmsDispatchProvider, buildDispatchProvider } from "../src/workers/dispatch.js";
import { FakeMessageProvider } from "../src/modules/announcements/providers.js";
import type { Env } from "../src/config/env.js";

const log = pino({ level: "silent" });
let cong: string;

beforeEach(async () => {
  await resetDb();
  vi.restoreAllMocks();
  cong = await createCongregation();
});
afterAll(async () => {
  await closeTestPool();
});

const svc = () => new NotificationService(testPool());

async function member(over: { email?: string; phone?: string | null } = {}) {
  const u = await createUser({
    congregationId: cong,
    email: over.email ?? `m${Math.random().toString(36).slice(2)}@dev.local`,
  });
  if (over.phone !== undefined) {
    await testPool().query(`UPDATE users SET phone_number = $2 WHERE user_id = $1`, [u.user_id, over.phone]);
  }
  return u.user_id as string;
}

describe("the sms channel exists at all", () => {
  it("a notification can be scheduled on channel 'sms' (migration 204's whole point)", async () => {
    const id = await member({ phone: "+254722000111" });
    await testPool().query(
      `INSERT INTO notification_preferences (user_id, sms_enabled) VALUES ($1, TRUE)
       ON CONFLICT (user_id) DO UPDATE SET sms_enabled = TRUE`,
      [id],
    );
    const row = await svc().schedule({ userId: id, channel: "sms", template: "giving_receipt" });
    expect(row.status).toBe("scheduled");
  });

  it("still refuses a channel that does not exist", async () => {
    const id = await member();
    await expect(
      testPool().query(
        `INSERT INTO notifications (user_id, channel, template, payload, status, scheduled_for)
         VALUES ($1, 'carrier-pigeon', 'x', '{}', 'scheduled', now())`,
        [id],
      ),
    ).rejects.toThrow(/invalid input value for enum/);
  });
});

describe("the toggle the app already shows", () => {
  it("OFF by default — nobody is opted into paid messages by inaction", async () => {
    // A member with no preferences row at all.
    const id = await member({ phone: "+254722000111" });
    const row = await svc().schedule({ userId: id, channel: "sms", template: "giving_receipt" });
    expect(row.status).toBe("suppressed");
  });

  it("ON when the member turns it on — the bug where the toggle read as undefined", async () => {
    // This is the one that would have shipped: sms_enabled declared on the type
    // but missing from the SELECT reads as undefined for anyone WITH a row, so
    // their SMS is suppressed however they set the switch.
    const id = await member({ phone: "+254722000111" });
    await testPool().query(
      `INSERT INTO notification_preferences (user_id, push_enabled, email_enabled, sms_enabled)
       VALUES ($1, TRUE, TRUE, TRUE)`,
      [id],
    );
    const row = await svc().schedule({ userId: id, channel: "sms", template: "giving_receipt" });
    expect(row.status).toBe("scheduled");
  });

  it("a member who has a row and turned SMS off stays off", async () => {
    const id = await member({ phone: "+254722000111" });
    await testPool().query(
      `INSERT INTO notification_preferences (user_id, sms_enabled) VALUES ($1, FALSE)`,
      [id],
    );
    const row = await svc().schedule({ userId: id, channel: "sms", template: "giving_receipt" });
    expect(row.status).toBe("suppressed");
  });

  it("the SMS toggle does not govern push or email", async () => {
    // The old ternary lumped every non-push channel in with email; with three
    // channels that would have made SMS obey the EMAIL switch.
    const id = await member({ phone: "+254722000111" });
    await testPool().query(
      `INSERT INTO notification_preferences (user_id, push_enabled, email_enabled, sms_enabled)
       VALUES ($1, TRUE, FALSE, TRUE)`,
      [id],
    );
    expect((await svc().schedule({ userId: id, channel: "sms", template: "giving_receipt" })).status).toBe("scheduled");
    expect((await svc().schedule({ userId: id, channel: "email", template: "giving_receipt" })).status).toBe(
      "suppressed",
    );
    expect((await svc().schedule({ userId: id, channel: "push", template: "level_completed" })).status).toBe(
      "scheduled",
    );
  });
});

describe("sms delivery refuses to lie", () => {
  it("THROWS when no provider is bound, so the row is marked failed and not sent", async () => {
    const p = new SmsDispatchProvider(undefined, log);
    await expect(
      p.send({ channel: "sms", to: "+254722000111", template: "giving_receipt", payload: {} }),
    ).rejects.toThrow(/no provider configured/);
  });

  it("THROWS on a template it has no copy for, rather than texting a placeholder", async () => {
    // A push can afford a generic fallback. A text costs money and lands on
    // someone's phone saying something nobody wrote.
    const p = new SmsDispatchProvider(new FakeMessageProvider("sms"), log);
    await expect(
      p.send({ channel: "sms", to: "+254722000111", template: "level_completed", payload: {} }),
    ).rejects.toThrow(/no copy for template/);
  });

  it("renders a receipt a person can read, in the units they gave", async () => {
    const fake = new FakeMessageProvider("sms");
    await new SmsDispatchProvider(fake, log).send({
      channel: "sms",
      to: "+254722000111",
      template: "giving_receipt",
      payload: {
        amount_minor: 50_000,
        currency: "KES",
        fund: "Tithe",
        receipt_code: "SJ12ABC345",
        member_name: "Amina Wanjiru",
      },
    });
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]!.to).toBe("+254722000111");
    expect(fake.sent[0]!.body).toContain("Amina");
    expect(fake.sent[0]!.body).toContain("KES 500.00");
    expect(fake.sent[0]!.body).toContain("Tithe");
    expect(fake.sent[0]!.body).toContain("SJ12ABC345");
  });

  it("buildDispatchProvider routes sms independently of push and email", async () => {
    // None of the three may silently substitute for another.
    const provider = buildDispatchProvider(testEnv() as Env, log);
    await expect(
      provider.send({ channel: "sms", to: "+254722000111", template: "giving_receipt", payload: {} }),
    ).rejects.toThrow(/SMS dispatch/);
  });
});
