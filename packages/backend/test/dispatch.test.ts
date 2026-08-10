// Notification dispatch rendering (§1.5). Two bugs, one file:
//  1. Giving receipts scheduled on channel:"email" were silently discarded —
//     buildDispatchProvider() never had an email provider wired up, only a
//     logging no-op that "succeeded". EmailDispatchProvider closes that.
//  2. Push notifications fell back to the raw template name ("badge awarded")
//     whenever a call site didn't set payload.title/body. pushCopy() now
//     resolves real copy from a per-template table for every known template.
import { describe, it, expect, vi } from "vitest";
import type { Logger } from "pino";
import {
  pushCopy,
  KNOWN_PUSH_TEMPLATES,
  EmailDispatchProvider,
  formatMoney,
  type DispatchMessage,
} from "../src/workers/dispatch.js";
import type { EmailMessage, EmailProvider } from "../src/modules/identity/email.js";

function fakeLogger(): Logger & {
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
} {
  return { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as unknown as Logger & {
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
  };
}

class FakeEmailProvider implements EmailProvider {
  readonly sent: EmailMessage[] = [];
  async send(msg: EmailMessage): Promise<void> {
    this.sent.push(msg);
  }
}

class ThrowingEmailProvider implements EmailProvider {
  async send(): Promise<void> {
    throw new Error("SMTP connection refused");
  }
}

const push = (template: string, payload: Record<string, unknown> = {}): DispatchMessage => ({
  channel: "push",
  to: "device-token",
  template,
  payload,
});

describe("pushCopy — every push template resolves to real copy (bug: raw template names shipped to members)", () => {
  it("every known template renders a title/body that is not the raw identifier, with an empty payload", () => {
    expect(KNOWN_PUSH_TEMPLATES.length).toBeGreaterThan(20); // guards against the registry being gutted
    for (const template of KNOWN_PUSH_TEMPLATES) {
      const { title, body } = pushCopy(push(template));
      const raw = template.replace(/_/g, " ");
      expect(body.length).toBeGreaterThan(0);
      expect(title.length).toBeGreaterThan(0);
      expect(body.toLowerCase()).not.toBe(raw.toLowerCase());
      expect(body.toLowerCase()).not.toBe(template.toLowerCase());
    }
  });

  // The four the bug report confirmed by hand.
  it.each([
    ["badge_awarded", {}, /badge/i],
    ["event_cancelled", { title: "Cell Leaders Retreat" }, /cell leaders retreat/i],
    ["level_completed", { level_number: 3 }, /level 3/i],
    ["member_care_flag", {}, /care/i],
  ] as const)("%s renders specific, human copy", (template, payload, expected) => {
    const { title, body } = pushCopy(push(template, payload));
    expect(`${title} ${body}`).toMatch(expected);
  });

  it("uses payload specifics when present (badge name, level number, event title)", () => {
    expect(
      pushCopy(push("badge_awarded", { code: "faithful_7", name: "Faithfulness" })).body,
    ).toContain("Faithfulness");
    expect(pushCopy(push("level_completed", { level_number: 5 })).body).toContain("Level 5");
    expect(
      pushCopy(push("event_low_rsvp", { title: "Youth Night", going: 2, threshold: 10 })).body,
    ).toContain("2 of 10");
    expect(
      pushCopy(
        push("level_ushered", {
          level_number: 4,
          message: "Your discipler has ushered you into Level 4",
        }),
      ).body,
    ).toBe("Your discipler has ushered you into Level 4");
  });

  it("an explicit payload.title + payload.body always wins over the template table", () => {
    const { title, body } = pushCopy(
      push("badge_awarded", { title: "Custom title", body: "Custom body set by the call site" }),
    );
    expect(title).toBe("Custom title");
    expect(body).toBe("Custom body set by the call site");
  });

  it("member_care_flag never leaks the flagged member's identity into the push, even if a caller mistakenly put it in the payload", () => {
    // signals.ts deliberately schedules this with NO member content in the
    // payload ("no content in the push") — this locks that contract: even a
    // future regression that adds identifying fields to the payload must not
    // leak them, because the copy table for this template ignores payload
    // content entirely.
    const { title, body } = pushCopy(
      push("member_care_flag", {
        member_user_id: "11111111-1111-1111-1111-111111111111",
        member_name: "Jane Wanjiru",
        signal_summary: "disclosed self-harm ideation in a private journal entry",
      }),
    );
    const rendered = `${title} ${body}`;
    expect(rendered).not.toContain("Jane Wanjiru");
    expect(rendered).not.toContain("self-harm");
    expect(rendered.length).toBeGreaterThan(0);
  });

  it("an unknown/future template with no copy falls back to a dignified generic message and logs a WARN (visible, not silent)", () => {
    const log = fakeLogger();
    const { title, body } = pushCopy(push("some_brand_new_template_nobody_added_copy_for"), log);
    expect(body).toBe("A new update in Nuru Pathway");
    expect(body).not.toContain("_");
    expect(title.length).toBeGreaterThan(0);
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn.mock.calls[0]![1]).toMatch(/no copy for template/i);
  });
});

describe("EmailDispatchProvider — giving receipts must actually reach the mailer (bug: silently dropped)", () => {
  const receiptPayload = {
    transaction_id: "tx-1",
    amount_minor: 150000, // KSh 1,500.00 — integer minor units, never a float
    currency: "KES",
    fund: "Tithe",
    member_name: "Ada Achieng",
    congregation: "Nuru Place Church",
    date: "2026-08-01T10:00:00.000Z",
    receipt_code: "UG3J29U3OL",
  };

  it("formats integer minor units + ISO currency correctly", () => {
    expect(formatMoney(150000, "KES")).toContain("1,500.00");
    expect(formatMoney(150000, "KES")).toContain("KES");
    expect(formatMoney(999, "USD")).toContain("9.99");
  });

  it("a configured mailer receives the rendered receipt with the correct formatted amount", async () => {
    const fake = new FakeEmailProvider();
    const provider = new EmailDispatchProvider(fake, true);

    await provider.send({
      channel: "email",
      to: "ada@example.com",
      template: "giving_receipt",
      payload: receiptPayload,
    });

    expect(fake.sent).toHaveLength(1);
    const msg = fake.sent[0]!;
    expect(msg.to).toBe("ada@example.com");
    expect(msg.subject).toMatch(/receipt/i);
    expect(msg.subject).toContain("Nuru Place Church");
    expect(msg.text).toContain("1,500.00");
    expect(msg.text).toContain("Tithe");
    expect(msg.text).toContain("Ada Achieng");
    expect(msg.text).toContain("UG3J29U3OL");
    expect(msg.html).toBeDefined();
    expect(msg.html).toContain("1,500.00");
  });

  it("an unconfigured mailer (no SMTP_HOST) NEVER reports success — it warns loudly and throws so the row is marked failed", async () => {
    const log = fakeLogger();
    const fake = new FakeEmailProvider();
    const provider = new EmailDispatchProvider(fake, false, log);

    await expect(
      provider.send({
        channel: "email",
        to: "ada@example.com",
        template: "giving_receipt",
        payload: receiptPayload,
      }),
    ).rejects.toThrow();

    expect(fake.sent).toHaveLength(0); // never even attempted
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn.mock.calls[0]![1]).toMatch(/email not configured.*not sent/i);
  });

  it("a real send failure marks failure, not silent success — logs an error and rethrows", async () => {
    const log = fakeLogger();
    const provider = new EmailDispatchProvider(new ThrowingEmailProvider(), true, log);

    await expect(
      provider.send({
        channel: "email",
        to: "ada@example.com",
        template: "giving_receipt",
        payload: receiptPayload,
      }),
    ).rejects.toThrow(/SMTP connection refused/);

    expect(log.error).toHaveBeenCalledOnce();
  });

  it("an email-channel template with no renderer still sends a dignified, honest message — never blank — and warns", async () => {
    const log = fakeLogger();
    const fake = new FakeEmailProvider();
    const provider = new EmailDispatchProvider(fake, true, log);

    await provider.send({
      channel: "email",
      to: "ada@example.com",
      template: "some_future_email_template",
      payload: {},
    });

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]!.subject.length).toBeGreaterThan(0);
    expect(fake.sent[0]!.text.length).toBeGreaterThan(0);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("missing amount/member gracefully degrades instead of rendering 'undefined'", async () => {
    const fake = new FakeEmailProvider();
    const provider = new EmailDispatchProvider(fake, true);

    await provider.send({
      channel: "email",
      to: "ada@example.com",
      template: "giving_receipt",
      payload: { congregation: "Nuru Place Church" },
    });

    const msg = fake.sent[0]!;
    expect(msg.text).not.toContain("undefined");
    expect(msg.text).not.toContain("null");
    expect(msg.text).toContain("your gift");
  });
});
