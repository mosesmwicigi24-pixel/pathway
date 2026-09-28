// Giving — Cycle 8 of 10 (owner request 2026-09-28): giving at scale. The
// member's reads use an index instead of the whole table; the reminder scan,
// the fulfilment pass and one partner's page cost a fixed number of reads
// however many pledges exist; a scheduler run that is still going is never
// joined by a second; and a thousand recurring gifts due at once go out in
// two passes, once each.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import type { Pool } from "pg";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { FinancialService } from "../src/modules/financial/service.js";
import { PartnersService } from "../src/modules/financial/partners.js";
import { DarajaMpesaProvider, FakeMobileMoneyProvider } from "../src/modules/financial/providers.js";
import { NotificationService } from "../src/modules/notifications/service.js";
import { oneAtATime } from "../src/workers/oneAtATime.js";
import type { PaymentGateway, WebhookEvent } from "../src/modules/financial/gateway.js";

class FakeGateway implements PaymentGateway {
  async createIntent(): Promise<{ id: string; client_secret: string }> { return { id: `pi_${Math.random()}`, client_secret: "cs" }; }
  verifyWebhook(rawBody: Buffer | string): WebhookEvent { return JSON.parse(String(rawBody)) as WebhookEvent; }
}
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
class Safaricom {
  readonly pushes: Array<{ phone: string; ref: string; amount: number }> = [];
  private n = 0;
  readonly fetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    if (u.includes("/oauth/v1/generate")) return json(200, { access_token: "tok", expires_in: "3599" });
    if (u.includes("/stkpush/v1/processrequest")) {
      const body = JSON.parse(String(init?.body)) as { PhoneNumber: string; Amount: number };
      this.n += 1;
      const ref = `ws_CO_${this.n}`;
      this.pushes.push({ phone: body.PhoneNumber, ref, amount: body.Amount });
      return json(200, { CheckoutRequestID: ref, ResponseCode: "0" });
    }
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;
}
const q = (sql: string, params: unknown[] = []) => testPool().query(sql, params);

/** The same pool, counting every statement sent through it. */
function counting(pool: Pool): { pool: Pool; count: () => number; reset: () => void } {
  let n = 0;
  const proxy = new Proxy(pool, {
    get(target, prop, receiver) {
      if (prop === "query") return (...args: unknown[]) => { n += 1; return (target.query as (...a: unknown[]) => unknown).apply(target, args); };
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { pool: proxy as Pool, count: () => n, reset: () => { n = 0; } };
}

let cong: string;
let safaricom: Safaricom, svc: FinancialService, notifications: NotificationService;
beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  safaricom = new Safaricom();
  const daraja = new DarajaMpesaProvider(
    { consumerKey: "k", consumerSecret: "s", passkey: "p", shortcode: "4043755", env: "sandbox", txType: "CustomerPayBillOnline", callbackUrl: "https://example.org/cb" },
    safaricom.fetch,
  );
  svc = new FinancialService(testPool(), new FakeGateway(), { mpesa: daraja, airtel: new FakeMobileMoneyProvider("airtel") });
  notifications = new NotificationService(testPool());
});
afterAll(async () => { await closeTestPool(); });

/** `n` members in one statement: phones 0788 000 000 + i. */
async function members(n: number, prefix = "0788"): Promise<string[]> {
  const { rows } = await q(
    `INSERT INTO users (full_name, phone_number, date_of_birth, congregation_id, role)
     SELECT 'Member ' || i, $2 || lpad(i::text, 6, '0'), '1990-01-01', $1, 'Student' FROM generate_series(1, $3) AS i
     RETURNING user_id`,
    [cong, prefix, n],
  );
  return rows.map((r) => r.user_id as string);
}

describe("Cycle 8 — the member's reads use an index", () => {
  it("S1 with fifty thousand gifts on the books, a member's history and the one-prompt check read an index, not the table", async () => {
    const [me] = await members(1);
    const others = await members(200, "0789");
    await q(
      `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, idempotency_key, created_at)
       SELECT ($1::uuid[])[1 + (i % 200)], (SELECT fund_id FROM funds WHERE code = 'tithe'), 10000, 'KES', 'succeeded', 'manual', 'bulk-' || i, now() - (i || ' minutes')::interval
         FROM generate_series(1, 50000) AS i`,
      [others],
    );
    await q(`INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, idempotency_key) VALUES ($1, (SELECT fund_id FROM funds WHERE code = 'tithe'), 10000, 'KES', 'succeeded', 'manual', 'mine-1')`, [me]);
    await q(`ANALYZE transactions`);
    const plan = async (sql: string) => JSON.stringify((await q(`EXPLAIN (FORMAT JSON) ${sql}`, [me])).rows[0]["QUERY PLAN"]);
    expect(await plan(`SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC`)).toContain("idx_transactions_user_created");
    expect(await plan(`SELECT transaction_id FROM transactions WHERE user_id = $1 AND provider IN ('mpesa','airtel') AND status = 'processing' AND created_at > now() - interval '90 seconds'`)).toMatch(/idx_transactions_(user_created|mm_processing)/);
    expect(((await svc.listGiving(me)) as unknown[]).length).toBe(1);
  });
});

describe("Cycle 8 — fixed-cost passes", () => {
  it("S2 the reminder scan over three hundred pledges costs four reads plus one write per reminder sent — and still says the right things", async () => {
    const who = await members(100);
    const now = new Date("2026-10-03T06:00:00Z"); // 09:00 Nairobi
    const partnersSetup = new PartnersService(testPool(), svc);
    let k = 0;
    for (const u of who) {
      for (const dueDay of [5, 1, 20]) {
        k += 1;
        const p = await partnersSetup.createPledge(u, { shape: "monthly", amount_minor: 100_000 + k, currency: "KES", due_day: dueDay, reminders_enabled: true } as never);
        await q(`UPDATE pledges SET created_at = '2026-09-20T09:00:00Z' WHERE pledge_id = $1`, [p.pledge_id]);
      }
    }
    const counted = counting(testPool());
    const partners = new PartnersService(counted.pool, svc);
    const r = await partners.sendDueReminders(notifications, now);
    // Due the 5th → due soon (two days away). Due the 1st → its first follow-up (its day ended 33 h ago). Due the
    // 20th, made on the 20th → its first instalment was that very day (a manual pledge's rule), so a follow-up too.
    expect(r).toEqual({ due_soon: 100, follow_ups: 200 });
    expect(counted.count()).toBeLessThanOrEqual(4 + r.due_soon + r.follow_ups);
    // A second pass sends nothing new, still at a fixed cost.
    counted.reset();
    expect(await partners.sendDueReminders(notifications, now)).toEqual({ due_soon: 0, follow_ups: 0 });
    expect(counted.count()).toBeLessThanOrEqual(4);
  });

  it("S3 the fulfilment pass over two hundred total pledges reads twice, then only writes for the ones it fulfils", async () => {
    const who = await members(200);
    const partnersSetup = new PartnersService(testPool(), svc);
    const reached: string[] = [];
    for (const [i, u] of who.entries()) {
      const p = await partnersSetup.createPledge(u, { shape: "total", target_minor: 50_000, currency: "KES", due_on: "2026-12-31", reminders_enabled: true } as never);
      if (i % 4 === 0) {
        reached.push(String(p.pledge_id));
        await q(`INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, idempotency_key, pledge_id) VALUES ($1, (SELECT fund_id FROM funds WHERE code = 'tithe'), 50000, 'KES', 'succeeded', 'manual', $2, $3)`, [u, `c8-f-${i}`, p.pledge_id]);
      }
    }
    const counted = counting(testPool());
    const partners = new PartnersService(counted.pool, svc);
    expect(await partners.fulfilCompleted(notifications)).toBe(50);
    // rows + payments, then per fulfilled pledge: flip, stop its schedules, audit.
    expect(counted.count()).toBeLessThanOrEqual(2 + 3 * 50);
    expect((await q(`SELECT count(*)::int AS n FROM pledges WHERE status = 'fulfilled' AND pledge_id = ANY($1::uuid[])`, [reached])).rows[0].n).toBe(50);
  });

  it("S4 one partner's page costs the same with a hundred and fifty partners as with five", async () => {
    const partnersSetup = new PartnersService(testPool(), svc);
    const seed = async (who: string[]) => { for (const u of who) await partnersSetup.createPledge(u, { shape: "monthly", amount_minor: 100_000, currency: "KES", due_day: 5, reminders_enabled: true } as never); };
    const few = await members(5);
    await seed(few);
    const counted = counting(testPool());
    const partners = new PartnersService(counted.pool, svc);
    await partners.adminDetail(few[0]!);
    const small = counted.count();
    await seed(await members(145, "0790"));
    counted.reset();
    await partners.adminDetail(few[0]!);
    expect(counted.count()).toBe(small);
  });
});

describe("Cycle 8 — one run at a time", () => {
  it("S5 a tick that finds the last run still going skips it, says so, and the next tick after it ends runs", async () => {
    let active = 0, peak = 0, runs = 0;
    const warnings: unknown[] = [];
    let release!: () => void;
    const tick = oneAtATime("test run", async () => {
      active += 1; runs += 1; peak = Math.max(peak, active);
      await new Promise<void>((r) => { release = r; });
      active -= 1;
    }, { warn: (o) => warnings.push(o), error: () => undefined });
    const first = tick();
    await tick();
    await tick();
    expect(runs).toBe(1);
    expect(warnings).toHaveLength(2);
    release();
    await first;
    const second = tick();
    release();
    await second;
    expect(runs).toBe(2);
    expect(peak).toBe(1);
  });

  it("S6 a failing run is logged and does not wedge the guard", async () => {
    const errors: unknown[] = [];
    let n = 0;
    const tick = oneAtATime("flaky", async () => { n += 1; if (n === 1) throw new Error("boom"); }, { warn: () => undefined, error: (o) => errors.push(o) });
    await tick();
    await tick();
    expect(n).toBe(2);
    expect(errors).toHaveLength(1);
  });
});

describe("Cycle 8 — a thousand gifts due at once", () => {
  it("S7 a thousand recurring gifts due in the same minute go out in two passes of five hundred, once each, then nothing", async () => {
    const who = await members(1000);
    await q(
      `INSERT INTO giving_schedules (user_id, fund_id, amount_minor, currency, frequency, method, next_run_at, idempotency_key, heads_up)
       SELECT u, (SELECT fund_id FROM funds WHERE code = 'tithe'), 50000, 'KES', 'weekly', 'mpesa', now() - interval '1 minute', 'bulk-sched-' || u, false
         FROM unnest($1::uuid[]) AS u`,
      [who],
    );
    const t0 = Date.now();
    const first = await svc.runDueSchedules(new Date());
    const firstMs = Date.now() - t0;
    expect(first).toMatchObject({ run: 500, failed: 0, deferred: 0 });
    const second = await svc.runDueSchedules(new Date());
    expect(second).toMatchObject({ run: 500, failed: 0 });
    expect(await svc.runDueSchedules(new Date())).toMatchObject({ run: 0 });
    expect(safaricom.pushes).toHaveLength(1000);
    expect(new Set(safaricom.pushes.map((p) => p.phone)).size).toBe(1000);
    // Generous: the database work per prompt, with a provider that answers at once.
    expect(firstMs).toBeLessThan(120_000);
  }, 300_000);
});
