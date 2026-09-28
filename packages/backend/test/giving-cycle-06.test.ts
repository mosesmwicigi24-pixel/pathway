// Giving — Cycle 6 of 10 (owner request 2026-09-28): safe to give. One
// member's request can never ring a phone twice or lose a row after the phone
// rang; the app is not a way to ring a stranger's phone; the server's own keys
// stay the server's; private documents stay private; and a failed PayPal gift
// says why.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import supertest from "supertest";
import { pino } from "pino";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { testEnv, bearer } from "./helpers/app.js";
import { createApp } from "../src/http/app.js";
import { FinancialService } from "../src/modules/financial/service.js";
import { DarajaMpesaProvider, FakeMobileMoneyProvider } from "../src/modules/financial/providers.js";
import { InMemoryRateLimitStore } from "../src/http/rateLimit.js";
import type { PaymentGateway, WebhookEvent } from "../src/modules/financial/gateway.js";
import type { PayPalGateway } from "../src/modules/financial/paypal.js";
import type { Env } from "../src/config/env.js";

class FakeGateway implements PaymentGateway {
  async createIntent(): Promise<{ id: string; client_secret: string }> { return { id: `pi_${Math.random()}`, client_secret: "cs" }; }
  verifyWebhook(rawBody: Buffer | string): WebhookEvent { return JSON.parse(String(rawBody)) as WebhookEvent; }
}
class FakePayPal implements PayPalGateway {
  capture: "completed" | "pending" | "failed" = "failed";
  private n = 0;
  delayMs = 0;
  async createOrder(): Promise<{ orderId: string; approveUrl: string }> {
    this.n += 1;
    const id = `PP-${this.n}`;
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    return { orderId: id, approveUrl: "https://paypal.example/approve" };
  }
  async captureOrder(): Promise<{ status: "completed" | "pending" | "failed" }> { return { status: this.capture }; }
}
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
class Safaricom {
  readonly results = new Map<string, string>();
  readonly pushes: Array<{ phone: string; ref: string; amount: number }> = [];
  down = false;
  delayMs = 0;
  private n = 0;
  readonly fetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    if (u.includes("/oauth/v1/generate")) return json(200, { access_token: "tok", expires_in: "3599" });
    if (u.includes("/stkpush/v1/processrequest")) {
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
      if (this.down) return json(503, { errorMessage: "down" });
      const body = JSON.parse(String(init?.body)) as { PhoneNumber: string; Amount: number };
      this.n += 1;
      const ref = `ws_CO_${this.n}`;
      this.pushes.push({ phone: body.PhoneNumber, ref, amount: body.Amount });
      return json(200, { CheckoutRequestID: ref, ResponseCode: "0" });
    }
    if (u.includes("/stkpushquery/v1/query")) {
      const body = JSON.parse(String(init?.body)) as { CheckoutRequestID: string };
      const code = this.results.get(body.CheckoutRequestID);
      if (code === undefined) return json(500, { errorCode: "500.001.1001", errorMessage: "processing" });
      return json(200, { ResponseCode: "0", ResultCode: code, ResultDesc: "x" });
    }
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;
}
const cb = (ref: string, code: number) => JSON.stringify({ Body: { stkCallback: { CheckoutRequestID: ref, ResultCode: code, ResultDesc: "x" } } });
const q = (sql: string, params: unknown[] = []) => testPool().query(sql, params);

let cong: string, user: string;
let safaricom: Safaricom, svc: FinancialService, limiter: InMemoryRateLimitStore, paypal: FakePayPal;
beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  user = (await createUser({ congregationId: cong, phone: "0711222333" })).user_id;
  safaricom = new Safaricom();
  limiter = new InMemoryRateLimitStore();
  paypal = new FakePayPal();
  const daraja = new DarajaMpesaProvider(
    { consumerKey: "k", consumerSecret: "s", passkey: "p", shortcode: "4043755", env: "sandbox", txType: "CustomerPayBillOnline", callbackUrl: "https://example.org/cb" },
    safaricom.fetch,
  );
  svc = new FinancialService(testPool(), new FakeGateway(), { mpesa: daraja, airtel: new FakeMobileMoneyProvider("airtel") }, paypal, { promptLimiter: limiter });
});
afterAll(async () => { await closeTestPool(); });

const gift = (over: Record<string, unknown> = {}, who = user) =>
  svc.createGivingIntent(who, { fund: "tithe", amount_minor: 10_000, currency: "KES", method: "mpesa", idempotency_key: `c6-${Math.random()}`, ...over } as never) as Promise<Record<string, unknown>>;
const rows = async () => (await q(`SELECT count(*)::int AS n FROM transactions`)).rows[0].n as number;
/** The member declines the last prompt, so the next one isn't "in progress". */
const decline = async () => {
  const ref = safaricom.pushes.at(-1)!.ref;
  safaricom.results.set(ref, "1032");
  await svc.handleMobileMoneyCallback("mpesa", cb(ref, 1032), "");
};

describe("Cycle 6 — one request, one ring, one row", () => {
  it("S1 the same request twice at once (a client resending) rings once and books one row", async () => {
    safaricom.delayMs = 150;
    const body = { idempotency_key: "c6-same-key-0001" };
    const [a, b] = await Promise.all([gift(body), gift(body)]);
    expect(a.transaction_id).toBe(b.transaction_id);
    expect([a.reused, b.reused].sort()).toEqual([false, true]);
    expect(safaricom.pushes).toHaveLength(1);
    expect(await rows()).toBe(1);
  });

  it("S2 two taps at once with fresh keys: one prompt, the other told it is in progress", async () => {
    safaricom.delayMs = 150;
    const results = await Promise.allSettled([gift(), gift()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ code: "GIFT_IN_PROGRESS" });
    expect(safaricom.pushes).toHaveLength(1);
    expect(await rows()).toBe(1);
  });

  it("S3 a resend while the first is still ringing gets the same gift, and the ref once it is known", async () => {
    safaricom.delayMs = 300;
    const first = gift({ idempotency_key: "c6-resend-0001" });
    await new Promise((r) => setTimeout(r, 60));
    const second = await gift({ idempotency_key: "c6-resend-0001" });
    const done = await first;
    expect(second).toMatchObject({ transaction_id: done.transaction_id, reused: true });
    expect(safaricom.pushes).toHaveLength(1);
    const later = await gift({ idempotency_key: "c6-resend-0001" });
    expect(later.provider_ref).toBe(safaricom.pushes[0]!.ref);
  });

  it("S4 a prompt that never left (Safaricom down) leaves no row; after recovery the same key gives normally", async () => {
    safaricom.down = true;
    await expect(gift({ idempotency_key: "c6-down-0001" })).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(await rows()).toBe(0);
    safaricom.down = false;
    const ok = await gift({ idempotency_key: "c6-down-0001" });
    expect(ok).toMatchObject({ reused: false, status: "processing" });
    expect(await rows()).toBe(1);
  });

  it("S5 a row claimed for a prompt that never went out (the process stopped) is closed with the reason after five minutes", async () => {
    const fund = (await q(`SELECT fund_id FROM funds WHERE code = 'tithe'`)).rows[0].fund_id;
    const insert = (key: string, ago: string) => q(
      `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, provider_ref, idempotency_key, created_at)
       VALUES ($1, $2, 10000, 'KES', 'processing', 'mpesa', NULL, $3, now() - $4::interval) RETURNING transaction_id`, [user, fund, key, ago]);
    const old = (await insert("c6-orphan-0001", "10 minutes")).rows[0].transaction_id;
    const fresh = (await insert("c6-orphan-0002", "1 minute")).rows[0].transaction_id;
    await svc.reconcileMobileMoney(new Date());
    const st = async (id: string) => (await q(`SELECT status::text AS status, failure_code, failure_detail FROM transactions WHERE transaction_id = $1`, [id])).rows[0];
    expect(await st(old)).toMatchObject({ status: "failed", failure_code: "system", failure_detail: "the prompt was never sent" });
    expect((await st(fresh)).status).toBe("processing");
  });
});

describe("Cycle 6 — not a way to ring a stranger's phone", () => {
  it("S6 another number: three prompts, then refused with how long to wait — the member's own number is never held back", async () => {
    for (let i = 0; i < 3; i += 1) {
      await gift({ phone_number: "0722000111" });
      await decline();
    }
    await expect(gift({ phone_number: "0722000111" })).rejects.toMatchObject({ code: "RATE_LIMITED", details: { retry_after_sec: expect.any(Number) } });
    expect(safaricom.pushes).toHaveLength(3);
    await gift(); // own number
    await decline();
    await gift({ phone_number: "0711 222 333" }); // own number, typed
    expect(safaricom.pushes).toHaveLength(5);
  });

  it("S7 the number's bucket is the website's: prompts the donate button already sent count", async () => {
    for (let i = 0; i < 3; i += 1) await limiter.consume("webgive:phone:254722000222", 3, 1 / 600);
    await expect(gift({ phone_number: "0722000222" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(safaricom.pushes).toHaveLength(0);
  });

  it("S8 one account can't work through a list of strangers: five numbers, then refused", async () => {
    for (let i = 0; i < 5; i += 1) {
      await gift({ phone_number: `07330001${String(i).padStart(2, "0")}` });
      await decline();
    }
    await expect(gift({ phone_number: "0733000199" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(safaricom.pushes).toHaveLength(5);
  });

  it("S9 a recurring gift to another number: the scheduler's own prompts are not held back; a give-now prompt the member starts is", async () => {
    for (let i = 0; i < 3; i += 1) await limiter.consume("webgive:phone:254744000111", 3, 1 / 600);
    const s = await svc.createSchedule(user, { fund: "tithe", amount_minor: 50_000, currency: "KES", frequency: "weekly", method: "mpesa", phone_number: "0744000111", first_charge: "now" } as never);
    expect(s.first_charge).toBeNull();
    expect(String(s.first_charge_error)).toContain("several prompts");
    await q(`UPDATE giving_schedules SET next_run_at = now() - interval '1 minute' WHERE schedule_id = $1`, [s.schedule_id]);
    await svc.runDueSchedules(new Date());
    expect(safaricom.pushes.map((p) => p.phone)).toEqual(["254744000111"]);
  });
});

describe("Cycle 6 — the server's keys are the server's", () => {
  it("S10 a member key shaped like a schedule cycle's or a claim's is refused; one another giver holds is a 409, never a 500 — and nothing rings", async () => {
    await expect(gift({ idempotency_key: "sched:00000000-0000-0000-0000-000000000000:first" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(gift({ idempotency_key: "claim:00000000-0000-0000-0000-000000000000" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const other = (await createUser({ congregationId: cong, phone: "0755000111" })).user_id;
    await gift({ idempotency_key: "shared-key-00001" }, other);
    await expect(gift({ idempotency_key: "shared-key-00001" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(gift({ idempotency_key: "shared-key-00001", method: "paypal", currency: "USD", amount_minor: 1_000 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(safaricom.pushes).toHaveLength(1);
    // Over HTTP it is a 409 with a message, not an INTERNAL.
    const app = createApp({ env: { ...testEnv(), MPESA_CALLBACK_SECRET: "test-mm-secret" } as Env, db: { primary: testPool(), replica: testPool() }, log: pino({ level: "silent" }) });
    const res = await supertest(app).post("/v1/giving/intents").set("Authorization", bearer({ sub: user, role: "Student", cong }))
      .send({ fund: "tithe", amount_minor: 10_000, currency: "KES", method: "mpesa", idempotency_key: "shared-key-00001" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });
});

describe("Cycle 6 — private documents stay private", () => {
  it("S11 receipts and statements are never cached or referred; the old ?token= link still opens", async () => {
    const app = createApp({ env: { ...testEnv(), MPESA_CALLBACK_SECRET: "test-mm-secret" } as Env, db: { primary: testPool(), replica: testPool() }, log: pino({ level: "silent" }) });
    const auth = bearer({ sub: user, role: "Student", cong });
    const fund = (await q(`SELECT fund_id FROM funds WHERE code = 'tithe'`)).rows[0].fund_id;
    const t = (await q(`INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, idempotency_key, settled_at) VALUES ($1, $2, 10000, 'KES', 'succeeded', 'manual', 'c6-pdf-0001', now()) RETURNING transaction_id`, [user, fund])).rows[0].transaction_id;
    for (const path of [`/v1/giving/transactions/${t}/receipt.pdf`, "/v1/giving/statement.pdf"]) {
      const res = await supertest(app).get(path).set("Authorization", auth);
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("private, no-store");
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
    }
    const legacy = await supertest(app).get(`/v1/giving/statement.pdf?token=${encodeURIComponent(auth.slice(7))}`);
    expect(legacy.status).toBe(200);
    // Someone else's receipt is still a 404.
    const other = bearer({ sub: (await createUser({ congregationId: cong, phone: "0766000111" })).user_id, role: "Student", cong });
    expect((await supertest(app).get(`/v1/giving/transactions/${t}/receipt.pdf`).set("Authorization", other)).status).toBe(404);
  });
});

describe("Cycle 6 — every failure says why", () => {
  it("S12 a PayPal payment that did not complete is failed with its reason", async () => {
    const g = await gift({ method: "paypal", currency: "USD", amount_minor: 2_500, idempotency_key: "c6-paypal-0001" });
    paypal.capture = "failed";
    expect(await svc.capturePayPal(user, String(g.provider_ref))).toEqual({ status: "failed" });
    const t = (await q(`SELECT status::text AS status, failure_code, failure_detail FROM transactions WHERE transaction_id = $1`, [g.transaction_id])).rows[0];
    expect(t).toEqual({ status: "failed", failure_code: "declined", failure_detail: "PayPal did not complete the payment" });
  });
});

describe("Cycle 6 — a PayPal request racing itself", () => {
  it("S15 the same PayPal request twice at once books one row and answers both — never a 500", async () => {
    paypal.delayMs = 80;
    const body = { method: "paypal", currency: "USD", amount_minor: 2_500, idempotency_key: "c6-pp-race-0001" };
    const [a, b] = await Promise.all([gift(body), gift(body)]);
    expect(a.transaction_id).toBe(b.transaction_id);
    expect([a.reused, b.reused].sort()).toEqual([false, true]);
    expect(await rows()).toBe(1);
  });
});

describe("Cycle 6 — the website's donate button", () => {
  it("S13 the same website request twice at once rings once and books one row", async () => {
    safaricom.delayMs = 150;
    const body = { fund: "tithe", amount_minor: 50_000, currency: "KES", method: "mpesa", phone_number: "254788000111", giver_name: "Wanjiku", idempotency_key: "web-same-0001" };
    const [a, b] = await Promise.all([svc.createWebsiteGivingIntent(body as never), svc.createWebsiteGivingIntent(body as never)]);
    expect(a.transaction_id).toBe(b.transaction_id);
    expect(safaricom.pushes).toHaveLength(1);
    expect(await rows()).toBe(1);
  });
});

describe("Cycle 6 — volume", () => {
  it("S14 forty members each sending their gift twice at once: forty prompts, forty rows, nothing lost, nothing doubled", async () => {
    safaricom.delayMs = 40;
    const members: string[] = [];
    for (let i = 0; i < 40; i += 1) members.push((await createUser({ congregationId: cong, phone: `0701${String(i).padStart(6, "0")}` })).user_id);
    const sends = members.flatMap((m, i) => {
      const body = { idempotency_key: `c6-vol-${String(i).padStart(4, "0")}` };
      return [gift(body, m), gift(body, m)];
    });
    const out = await Promise.all(sends);
    expect(new Set(out.map((o) => o.transaction_id)).size).toBe(40);
    expect(out.filter((o) => o.reused === false)).toHaveLength(40);
    expect(safaricom.pushes).toHaveLength(40);
    expect(await rows()).toBe(40);
    expect((await q(`SELECT count(*)::int AS n FROM transactions WHERE provider_ref IS NULL`)).rows[0].n).toBe(0);
  });
});
