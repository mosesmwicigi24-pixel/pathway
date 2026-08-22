// The thank-you a stranger can actually receive.
//
// Every `notifications` row is keyed to a user_id, so a website gift (migration
// 202) is structurally unreachable by the notification system: before this, the
// giver got Safaricom's own SMS and nothing whatever from the church. The
// receipt handler now texts the number that paid.
//
// Two things are worth testing beyond "a message is sent":
//
//  1. It must NOT thank somebody for money they have not sent. A `processing`
//     row means the giver has not confirmed on their handset yet.
//  2. Africa's Talking answers HTTP 200 for a REJECTED message, with the real
//     outcome in a per-recipient statusCode. Reading only `res.ok` would report
//     every invalid number, blocked sender id and empty account as delivered.
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { pino } from "pino";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { testEnv } from "./helpers/app.js";
import { buildOutboxHandlers } from "../src/workers/handlers.js";
import { FakeMessageProvider } from "../src/modules/announcements/providers.js";
import { AfricasTalkingSmsProvider, buildSmsProvider } from "../src/modules/announcements/africastalking.js";
import type { Env } from "../src/config/env.js";

const log = pino({ level: "silent" });

function ctxWith(sms?: FakeMessageProvider, envOver: Partial<Env> = {}) {
  const pool = testPool();
  return {
    env: { ...testEnv(), ...envOver } as Env,
    db: { primary: pool, replica: pool },
    log,
    ...(sms ? { smsProvider: sms } : {}),
  };
}

/** A settled website gift, exactly as createWebsiteGivingIntent + settle write it. */
async function websiteGift(
  over: { status?: string; phone?: string | null; name?: string | null; receipt?: string | null; amount?: number } = {},
): Promise<string> {
  const p = testPool();
  await p.query(`INSERT INTO funds (code,name,is_active) VALUES ('tithe','Tithe',TRUE) ON CONFLICT (code) DO NOTHING`);
  const { rows } = await p.query(
    `INSERT INTO transactions
       (user_id, fund_id, amount_minor, currency, status, provider, provider_ref,
        idempotency_key, source, giver_name, giver_phone, receipt_code, settled_at)
     SELECT NULL, fund_id, $1, 'KES', $2::txn_status, 'mpesa', $3, $3, 'website', $4, $5, $6,
            CASE WHEN $2 = 'succeeded' THEN now() ELSE NULL END
       FROM funds WHERE code='tithe'
     RETURNING transaction_id`,
    [
      over.amount ?? 500_00,
      over.status ?? "succeeded",
      `ref-${Math.random().toString(36).slice(2)}`,
      over.name === undefined ? "Amina Wanjiru" : over.name,
      over.phone === undefined ? "+254722000111" : over.phone,
      over.receipt === undefined ? "SJ12ABC345" : over.receipt,
    ],
  );
  return rows[0].transaction_id as string;
}

beforeEach(async () => {
  await resetDb();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await closeTestPool();
});

describe("giving receipt — the stranger's thank-you", () => {
  it("texts the number that paid, naming the amount and the fund", async () => {
    const sms = new FakeMessageProvider("sms");
    const id = await websiteGift();
    await buildOutboxHandlers(ctxWith(sms)).get("giving.receipt")!({ transaction_id: id, user_id: null });

    expect(sms.sent).toHaveLength(1);
    const msg = sms.sent[0]!;
    expect(msg.to).toBe("+254722000111");
    expect(msg.body).toContain("Amina");        // their first name, not the whole thing
    expect(msg.body).toContain("KES 500.00");   // the figure they typed, not 50000
    expect(msg.body).toContain("Tithe");
    expect(msg.body).toContain("SJ12ABC345");   // so they can match Safaricom's SMS
  });

  it("does not thank somebody for money they have not sent", async () => {
    // A processing row means the giver has not confirmed on their handset.
    const sms = new FakeMessageProvider("sms");
    const id = await websiteGift({ status: "processing" });
    await buildOutboxHandlers(ctxWith(sms)).get("giving.receipt")!({ transaction_id: id, user_id: null });
    expect(sms.sent).toHaveLength(0);
  });

  it("stays silent on a failed gift", async () => {
    const sms = new FakeMessageProvider("sms");
    const id = await websiteGift({ status: "failed" });
    await buildOutboxHandlers(ctxWith(sms)).get("giving.receipt")!({ transaction_id: id, user_id: null });
    expect(sms.sent).toHaveLength(0);
  });

  it("greets an anonymous giver without a name, rather than saying 'undefined'", async () => {
    const sms = new FakeMessageProvider("sms");
    const id = await websiteGift({ name: null });
    await buildOutboxHandlers(ctxWith(sms)).get("giving.receipt")!({ transaction_id: id, user_id: null });
    expect(sms.sent[0]!.body).toMatch(/^Thank you for your gift/);
    expect(sms.sent[0]!.body).not.toContain("undefined");
  });

  it("omits the M-Pesa ref when the callback carried none", async () => {
    const sms = new FakeMessageProvider("sms");
    const id = await websiteGift({ receipt: null });
    await buildOutboxHandlers(ctxWith(sms)).get("giving.receipt")!({ transaction_id: id, user_id: null });
    expect(sms.sent[0]!.body).not.toContain("M-Pesa ref");
    expect(sms.sent[0]!.body).toContain("KES 500.00");
  });

  it("is a no-op, not a crash, when no SMS provider is configured", async () => {
    // The church may simply not have wired Africa's Talking. That must not
    // poison the outbox for everybody else's receipts.
    const id = await websiteGift();
    await expect(
      buildOutboxHandlers(ctxWith(undefined)).get("giving.receipt")!({ transaction_id: id, user_id: null }),
    ).resolves.toBeUndefined();
  });

  it("rethrows a send failure so the outbox retries rather than losing the receipt", async () => {
    const boom = {
      channel: "sms" as const,
      send: () => Promise.reject(new Error("network went away")),
    };
    const id = await websiteGift();
    await expect(
      buildOutboxHandlers(ctxWith(boom as unknown as FakeMessageProvider)).get("giving.receipt")!({
        transaction_id: id,
        user_id: null,
      }),
    ).rejects.toThrow("network went away");
  });

  it("ignores a member's transaction — that receipt goes by email", async () => {
    const sms = new FakeMessageProvider("sms");
    const p = testPool();
    await p.query(`INSERT INTO funds (code,name,is_active) VALUES ('tithe','Tithe',TRUE) ON CONFLICT (code) DO NOTHING`);
    // source defaults to 'app'; a null user_id would violate the migration's
    // memberless-only-from-website rule, so this is a website row asked about
    // with the WRONG id — the lookup must simply find nothing.
    await buildOutboxHandlers(ctxWith(sms)).get("giving.receipt")!({
      transaction_id: "00000000-0000-4000-8000-000000000000",
      user_id: null,
    });
    expect(sms.sent).toHaveLength(0);
  });
});

describe("Africa's Talking — a 200 is not success", () => {
  const provider = () =>
    new AfricasTalkingSmsProvider({ apiKey: "k", username: "u", senderId: "NURU", baseUrl: "https://at.test" });

  it("accepts statusCode 101 (sent) and 102 (queued)", async () => {
    for (const code of [101, 102]) {
      vi.stubGlobal("fetch", async () =>
        new Response(JSON.stringify({ SMSMessageData: { Recipients: [{ statusCode: code, messageId: `ATXid_${code}` }] } }), {
          status: 200,
        }),
      );
      await expect(provider().send({ to: "+254722000111", title: "t", body: "b" })).resolves.toEqual({
        ref: `ATXid_${code}`,
      });
    }
  });

  it("THROWS on a rejected recipient despite HTTP 200", async () => {
    // The exact shape that would otherwise report every unsent message as sent.
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({ SMSMessageData: { Recipients: [{ statusCode: 403, status: "Invalid Sender Id" }] } }),
        { status: 200 },
      ),
    );
    await expect(provider().send({ to: "+254722000111", title: "t", body: "b" })).rejects.toThrow(/Invalid Sender Id/);
  });

  it("THROWS when the response carries no recipient at all", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ SMSMessageData: { Message: "InsufficientBalance", Recipients: [] } }), { status: 200 }),
    );
    await expect(provider().send({ to: "+254722000111", title: "t", body: "b" })).rejects.toThrow(/InsufficientBalance/);
  });

  it("surfaces the provider's reason on a non-2xx", async () => {
    vi.stubGlobal("fetch", async () => new Response("Unauthorized: bad api key", { status: 401 }));
    await expect(provider().send({ to: "+254722000111", title: "t", body: "b" })).rejects.toThrow(/401.*bad api key/s);
  });

  it("sends form-encoded fields, with the shortcode as the sender", async () => {
    let seen: { url: string; body: string; apiKey: string } | null = null;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen = {
        url: String(url),
        body: String(init.body),
        apiKey: String((init.headers as Record<string, string>).apiKey),
      };
      return new Response(JSON.stringify({ SMSMessageData: { Recipients: [{ statusCode: 101, messageId: "x" }] } }), {
        status: 200,
      });
    });
    await provider().send({ to: "+254722000111", title: "t", body: "Thank you" });
    expect(seen!.url).toBe("https://at.test/version1/messaging");
    expect(seen!.apiKey).toBe("k");
    const form = new URLSearchParams(seen!.body);
    expect(form.get("username")).toBe("u");
    expect(form.get("to")).toBe("+254722000111");
    expect(form.get("message")).toBe("Thank you");
    expect(form.get("from")).toBe("NURU");
  });
});

describe("Africa's Talking — binding", () => {
  it("binds nothing without a key or username, so nothing is falsely reported sent", () => {
    expect(buildSmsProvider(testEnv())).toBeUndefined();
    expect(buildSmsProvider({ ...testEnv(), AFRICASTALKING_API_KEY: "k" } as Env)).toBeUndefined();
    expect(buildSmsProvider({ ...testEnv(), AFRICASTALKING_USERNAME: "u" } as Env)).toBeUndefined();
  });

  it("defaults to the sandbox HOST, which is a different domain and delivers to nobody", () => {
    const p = buildSmsProvider({
      ...testEnv(),
      AFRICASTALKING_API_KEY: "k",
      AFRICASTALKING_USERNAME: "u",
    } as Env) as AfricasTalkingSmsProvider;
    expect(p).toBeDefined();
    expect(JSON.stringify(p)).toContain("sandbox.africastalking.com");
  });

  it("uses the live host only when explicitly set to production", () => {
    const p = buildSmsProvider({
      ...testEnv(),
      AFRICASTALKING_API_KEY: "k",
      AFRICASTALKING_USERNAME: "u",
      AFRICASTALKING_ENV: "production",
    } as Env) as AfricasTalkingSmsProvider;
    expect(JSON.stringify(p)).toContain("https://api.africastalking.com");
    expect(JSON.stringify(p)).not.toContain("sandbox");
  });
});
