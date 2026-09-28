// Giving — Cycle 9 of 10 (owner request 2026-09-28): intelligence. A total
// pledge says the pace that reaches it on time (and a collector at that pace
// lands exactly on the target, then stops); the office sees how collection is
// going — paid, failed by reason in words, success rate, what only it can fix
// — is told when M-Pesa itself looks unwell before members start calling, and
// sees what the rest of the month should bring in, each gift weighted by its
// own record.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import supertest from "supertest";
import { pino } from "pino";
import type { Pool } from "pg";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { testEnv, bearer } from "./helpers/app.js";
import { createApp } from "../src/http/app.js";
import { FinancialService } from "../src/modules/financial/service.js";
import { PartnersService } from "../src/modules/financial/partners.js";
import { DarajaMpesaProvider, FakeMobileMoneyProvider } from "../src/modules/financial/providers.js";
import type { PaymentGateway, WebhookEvent } from "../src/modules/financial/gateway.js";
import type { Env } from "../src/config/env.js";

class FakeGateway implements PaymentGateway {
  async createIntent(): Promise<{ id: string; client_secret: string }> { return { id: `pi_${Math.random()}`, client_secret: "cs" }; }
  verifyWebhook(rawBody: Buffer | string): WebhookEvent { return JSON.parse(String(rawBody)) as WebhookEvent; }
}
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
class Safaricom {
  readonly results = new Map<string, string>();
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

let cong: string, user: string, officer: string;
let safaricom: Safaricom, svc: FinancialService, partners: PartnersService;
beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  user = (await createUser({ congregationId: cong, phone: "0711222333" })).user_id;
  officer = (await createUser({ congregationId: cong, role: "Instructor", email: "officer@dev.local" })).user_id;
  await q(`INSERT INTO rbac_user_roles (user_id, role_key) VALUES ($1, 'finance_officer') ON CONFLICT DO NOTHING`, [officer]);
  safaricom = new Safaricom();
  const daraja = new DarajaMpesaProvider(
    { consumerKey: "k", consumerSecret: "s", passkey: "p", shortcode: "4043755", env: "sandbox", txType: "CustomerPayBillOnline", callbackUrl: "https://example.org/cb" },
    safaricom.fetch,
  );
  svc = new FinancialService(testPool(), new FakeGateway(), { mpesa: daraja, airtel: new FakeMobileMoneyProvider("airtel") });
  partners = new PartnersService(testPool(), svc);
});
afterAll(async () => { await closeTestPool(); });

type PaceRow = Parameters<typeof PartnersService.pace>[0];
const totalRow = (over: Partial<Record<string, unknown>> = {}) =>
  ({ shape: "total", status: "active", target_minor: "2000000", currency: "KES", due_on: "2026-12-31", ...over }) as unknown as PaceRow;
const progress = (paid: number) => ({ paid_minor: paid, period_paid_minor: null, label: "on_track", next_due: null, overdue_since: null }) as Parameters<typeof PartnersService.pace>[1];

/** Money already on the books for this test's member. */
async function tx(status: "succeeded" | "failed" | "processing", code: string | null, at: string, extra: Record<string, unknown> = {}): Promise<void> {
  await q(
    `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, provider_ref, idempotency_key, failure_code, created_at, schedule_id)
     VALUES ($1, (SELECT fund_id FROM funds WHERE code = 'tithe'), $2, 'KES', $3, 'mpesa', $4, $4, $5, $6, $7)`,
    [user, extra.amount ?? 10_000, status, `h-${Math.random()}`, code, at, extra.schedule_id ?? null],
  );
}

describe("Cycle 9 — the pace that reaches a total pledge", () => {
  it("S1 what's owed over the monthly collections left, rounded up to whole shillings; nothing to pace when paid, past, monthly or not active", () => {
    expect(PartnersService.pace(totalRow(), progress(0), "2026-09-28")).toEqual({ per_month_minor: 500_000, collections_left: 4, by: "2026-12-31" }); // 28 Sep, Oct, Nov, Dec
    expect(PartnersService.pace(totalRow(), progress(299_900), "2026-09-28")).toEqual({ per_month_minor: 425_100, collections_left: 4, by: "2026-12-31" }); // 17,001 ÷ 4 → 4,251 (rounded up)
    expect(PartnersService.pace(totalRow({ due_on: "2026-09-28" }), progress(0), "2026-09-28")?.collections_left).toBe(1); // due today: all of it today
    expect(PartnersService.pace(totalRow({ due_on: "2026-04-30" }), progress(0), "2026-01-31")?.collections_left).toBe(4); // 31 Jan, 28 Feb, 31 Mar, 30 Apr
    expect(PartnersService.pace(totalRow({ currency: "USD", target_minor: "10001" }), progress(0), "2026-09-28")?.per_month_minor).toBe(2501); // cents stay cents
    expect(PartnersService.pace(totalRow(), progress(2_000_000), "2026-09-28")).toBeNull();
    expect(PartnersService.pace(totalRow({ due_on: "2026-09-27" }), progress(0), "2026-09-28")).toBeNull();
    expect(PartnersService.pace(totalRow({ shape: "monthly" }), progress(0), "2026-09-28")).toBeNull();
    expect(PartnersService.pace(totalRow({ status: "paused" }), progress(0), "2026-09-28")).toBeNull();
  });

  it("S2 the member's pledges carry it — a total pledge its pace, a monthly one none", async () => {
    const due = new Date(Date.now() + 100 * 86_400_000).toISOString().slice(0, 10);
    await partners.createPledge(user, { shape: "total", target_minor: 3_000_000, currency: "KES", due_on: due, reminders_enabled: true } as never);
    await partners.createPledge(user, { shape: "monthly", amount_minor: 100_000, currency: "KES", due_day: 5, reminders_enabled: true } as never);
    const list = (await partners.listPledges(user)) as Array<Record<string, unknown>>;
    const total = list.find((p) => p.shape === "total")!;
    const monthly = list.find((p) => p.shape === "monthly")!;
    expect(total.pace).toMatchObject({ by: due, collections_left: expect.any(Number), per_month_minor: expect.any(Number) });
    const pace = total.pace as { per_month_minor: number; collections_left: number };
    expect(pace.per_month_minor * pace.collections_left).toBeGreaterThanOrEqual(3_000_000);
    expect(pace.per_month_minor * (pace.collections_left - 1)).toBeLessThan(3_000_000);
    expect(monthly.pace).toBeNull();
  });

  it("S3 a collector set at the pace lands exactly on the target — the last prompt asks only the rest — then stops", async () => {
    const p = await partners.createPledge(user, { shape: "total", target_minor: 1_000_000, currency: "KES", due_on: "2026-12-31", reminders_enabled: true } as never);
    const pace = PartnersService.pace(totalRow({ target_minor: "1000000" }), progress(0), "2026-10-05")!;
    expect(pace).toMatchObject({ per_month_minor: 333_400, collections_left: 3 }); // 5 Oct, 5 Nov, 5 Dec
    const s = String((await svc.createSchedule(user, { fund: "tithe", amount_minor: pace.per_month_minor, currency: "KES", frequency: "monthly", method: "mpesa", pledge_id: String(p.pledge_id) } as never)).schedule_id);
    await q(`UPDATE giving_schedules SET next_run_at = '2026-10-05T06:00:00Z', anchor_day = 5 WHERE schedule_id = $1`, [s]);
    for (const at of ["2026-10-05T06:01:00Z", "2026-11-05T06:01:00Z", "2026-12-05T06:01:00Z"]) {
      await svc.runDueSchedules(new Date(at));
      const ref = safaricom.pushes.at(-1)!.ref;
      safaricom.results.set(ref, "0");
      await svc.handleMobileMoneyCallback("mpesa", cb(ref, 0), "");
    }
    expect(safaricom.pushes.map((x) => x.amount)).toEqual([3334, 3334, 3332]);
    await svc.runDueSchedules(new Date("2027-01-05T06:01:00Z"));
    expect(safaricom.pushes).toHaveLength(3);
    expect((await q(`SELECT status::text AS status FROM pledges WHERE pledge_id = $1`, [p.pledge_id])).rows[0].status).toBe("fulfilled");
  });
});

describe("Cycle 9 — a partner in two currencies", () => {
  it("S10 the statement never adds dollars to shillings: per-currency figures, shilling headline, disciples from shillings only, a PDF that names both", async () => {
    const now = new Date("2026-09-20T09:00:00Z");
    const kes = await partners.createPledge(user, { shape: "total", target_minor: 3_000_000, currency: "KES", due_on: "2026-11-30", title: "Roof", reminders_enabled: true } as never);
    const usd = await partners.createPledge(user, { shape: "total", target_minor: 50_000, currency: "USD", due_on: "2026-11-30", title: "Mission trip", reminders_enabled: true } as never);
    const pay = (pledge: string, amount: number, currency: string, key: string) =>
      q(`INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, idempotency_key, pledge_id, created_at, settled_at)
         VALUES ($1, (SELECT fund_id FROM funds WHERE code = 'tithe'), $2, $3, 'succeeded', 'manual', $4, $5, '2026-09-10T09:00:00Z', '2026-09-10T09:00:00Z')`,
        [user, amount, currency, key, pledge]);
    await pay(String(kes.pledge_id), 2_500_000, "KES", "two-cur-1");
    await pay(String(usd.pledge_id), 20_000, "USD", "two-cur-2");
    await pay(String(kes.pledge_id), 9_999, "USD", "two-cur-3"); // an older wrong-currency gift toward the KES pledge
    const st = await partners.statements(user, 2026, now);
    expect(st.summary_by_currency).toEqual([
      { currency: "KES", pledged_minor: 3_000_000, paid_minor: 2_500_000, remaining_minor: 500_000 },
      { currency: "USD", pledged_minor: 50_000, paid_minor: 29_999, remaining_minor: 30_000 },
    ]);
    expect(st).toMatchObject({ summary_currency: "KES", pledged_minor: 3_000_000, paid_minor: 2_500_000, remaining_minor: 500_000 });
    expect(st.pledges.find((p) => p.pledge_id === kes.pledge_id)?.paid_minor).toBe(2_500_000); // the USD 99.99 is not the roof's shillings
    expect(st.impact.paid_minor).toBe(2_500_000); // KSh 25,000 → one disciple and KSh 5,000 toward the next
    expect(st.impact.disciples_carried).toBe(1);
    const pdf = (await partners.partnersStatementPdf(user, 2026, now)).pdf.toString("latin1");
    expect(pdf).toContain("KSh 30,000 + USD 500");
    expect(pdf).toContain("KSh 25,000 + USD 299.99");
  });
});

describe("Cycle 9 — how collection is going", () => {
  const NOW = new Date("2026-09-20T09:00:00Z");

  it("S4 prompts, paid, failed by reason in words — whose answer it was — and the success rate", async () => {
    for (let i = 0; i < 6; i += 1) await tx("succeeded", null, "2026-09-10T09:00:00Z");
    for (const c of ["cancelled", "cancelled", "insufficient_funds", "unreachable", "unreachable", "unreachable"]) await tx("failed", c, "2026-09-11T09:00:00Z");
    await tx("processing", null, "2026-09-20T08:59:30Z");
    await tx("succeeded", null, "2026-07-01T09:00:00Z"); // outside the 30 days
    const h = await svc.collectionHealth(30, NOW);
    expect(h).toMatchObject({ window_days: 30, prompts: 13, paid: 6, failed: 6, waiting: 1, success_rate: 0.5 });
    expect(h.by_reason).toEqual([
      expect.objectContaining({ code: "unreachable", count: 3, member_answered: false }),
      expect.objectContaining({ code: "cancelled", count: 2, member_answered: true }),
      expect.objectContaining({ code: "insufficient_funds", count: 1, member_answered: true }),
    ]);
    expect((h.by_reason as Array<{ reason: string }>)[0]!.reason.length).toBeGreaterThan(10);
  });

  it("S5 M-Pesa looks unwell: most of the hour's prompts never reached a phone — not the members' own answers, not too few to tell", async () => {
    const recent = "2026-09-20T08:40:00Z";
    for (let i = 0; i < 8; i += 1) await tx("failed", i % 2 ? "unreachable" : "system", recent);
    for (let i = 0; i < 2; i += 1) await tx("succeeded", null, recent);
    const o = await svc.outageCheck(NOW);
    expect(o).toMatchObject({ suspected: true, resolved: 10, unreached: 8 });
    expect(o.evidence).toBe("8 of the last 10 M-Pesa prompts in the past hour never reached the phone.");
    // Members saying no is not an outage.
    await q(`UPDATE transactions SET failure_code = 'cancelled' WHERE status = 'failed'`);
    expect((await svc.outageCheck(NOW)).suspected).toBe(false);
    // Too few to tell.
    await q(`DELETE FROM transactions`);
    for (let i = 0; i < 4; i += 1) await tx("failed", "unreachable", recent);
    expect((await svc.outageCheck(NOW)).suspected).toBe(false);
  });

  it("S6 prompts we could not even send count too — and the Overview raises it in words", async () => {
    for (let i = 0; i < 3; i += 1) {
      const who = (await createUser({ congregationId: cong, phone: `07220000${i}0` })).user_id;
      const s = await svc.createSchedule(who, { fund: "tithe", amount_minor: 50_000, currency: "KES", frequency: "weekly", method: "mpesa" } as never);
      await q(`UPDATE giving_schedules SET last_error = 'UPSTREAM', last_failure_code = NULL, last_failed_at = now() - interval '10 minutes' WHERE schedule_id = $1`, [s.schedule_id]);
    }
    const o = await svc.outageCheck(new Date());
    expect(o).toMatchObject({ suspected: true, unsent: 3, evidence: "3 scheduled prompts in the past hour could not be sent to M-Pesa at all." });
    const app = createApp({ env: { ...testEnv(), MPESA_CALLBACK_SECRET: "test-mm-secret" } as Env, db: { primary: testPool(), replica: testPool() }, log: pino({ level: "silent" }) });
    const res = await supertest(app).get("/v1/admin/finance/overview").set("Authorization", bearer({ sub: officer, role: "Instructor", cong }));
    expect(res.status).toBe(200);
    expect(res.body.alerts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "collection_outage", count: 1, message: o.evidence })]));
  });

  it("S7 the rest of the month: each gift's remaining prompts, weighted by its own last six answers; next month's gifts left out; per currency", async () => {
    const mk = async (phone: string, amount: number, frequency: "weekly" | "monthly", next: string, history: Array<"succeeded" | "failed">) => {
      const who = (await createUser({ congregationId: cong, phone })).user_id;
      const s = String((await svc.createSchedule(who, { fund: "tithe", amount_minor: amount, currency: "KES", frequency, method: "mpesa" } as never)).schedule_id);
      await q(`UPDATE giving_schedules SET next_run_at = $2 WHERE schedule_id = $1`, [s, next]);
      for (const [i, st] of history.entries()) {
        await q(
          `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, provider_ref, idempotency_key, schedule_id, created_at)
           VALUES ($1, (SELECT fund_id FROM funds WHERE code = 'tithe'), $2, 'KES', $3, 'mpesa', $4, $4, $5, $6)`,
          [who, amount, st, `f-${s}-${i}`, s, `2026-09-0${i + 1}T09:00:00Z`],
        );
      }
    };
    // Weekly from 22 Sep: 22 and 29 Sep before the month ends — reliable half the time.
    await mk("0733000001", 100_000, "weekly", "2026-09-22T06:00:00Z", ["succeeded", "failed", "succeeded", "failed", "succeeded", "failed"]);
    // Monthly on 25 Sep, always paid.
    await mk("0733000002", 500_000, "monthly", "2026-09-25T06:00:00Z", ["succeeded", "succeeded"]);
    // Monthly on 3 Oct — next month, not in this month's figure.
    await mk("0733000003", 900_000, "monthly", "2026-10-03T06:00:00Z", []);
    const h = await svc.collectionHealth(30, NOW);
    expect(h.month_end).toBe("2026-09-30");
    expect(h.forecast).toEqual([{ currency: "KES", gifts: 2, prompts: 3, scheduled_minor: 700_000, expected_minor: 600_000 }]); // 2×100,000×0.5 + 500,000×1
  });

  it("S8 over HTTP: finance:view only, a sane window, and the same numbers", async () => {
    const app = createApp({ env: { ...testEnv(), MPESA_CALLBACK_SECRET: "test-mm-secret" } as Env, db: { primary: testPool(), replica: testPool() }, log: pino({ level: "silent" }) });
    const officerAuth = bearer({ sub: officer, role: "Instructor", cong });
    const ok = await supertest(app).get("/v1/admin/finance/collection-health?days=7").set("Authorization", officerAuth);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ window_days: 7, prompts: 0, success_rate: null, outage: { suspected: false } });
    expect((await supertest(app).get("/v1/admin/finance/collection-health?days=365").set("Authorization", officerAuth)).status).toBe(400);
    expect((await supertest(app).get("/v1/admin/finance/collection-health").set("Authorization", bearer({ sub: user, role: "Student", cong }))).status).toBe(403);
  });

  it("S9 volume: three thousand prompts and three hundred gifts — a fixed number of reads, whatever the size", async () => {
    await q(
      `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, provider_ref, idempotency_key, failure_code, created_at)
       SELECT $1, (SELECT fund_id FROM funds WHERE code = 'tithe'), 10000, 'KES',
              (CASE WHEN i % 3 = 0 THEN 'failed' ELSE 'succeeded' END)::txn_status, 'mpesa', 'vol-' || i, 'vol-' || i,
              CASE WHEN i % 3 = 0 THEN 'cancelled' END, now() - (i || ' minutes')::interval
         FROM generate_series(1, 3000) AS i`,
      [user],
    );
    await q(
      `INSERT INTO users (full_name, phone_number, date_of_birth, congregation_id, role)
       SELECT 'Vol ' || i, '0791' || lpad(i::text, 6, '0'), '1990-01-01', $1, 'Student' FROM generate_series(1, 300) AS i`,
      [cong],
    );
    await q(
      `INSERT INTO giving_schedules (user_id, fund_id, amount_minor, currency, frequency, method, next_run_at, idempotency_key)
       SELECT u.user_id, (SELECT fund_id FROM funds WHERE code = 'tithe'), 50000, 'KES', 'weekly', 'mpesa', now() + interval '1 day', 'vol-s-' || u.user_id
         FROM users u WHERE u.full_name LIKE 'Vol %'`,
    );
    let reads = 0;
    const counted = new Proxy(testPool(), {
      get(target, prop, receiver) {
        if (prop === "query") return (...args: unknown[]) => { reads += 1; return (target.query as (...a: unknown[]) => unknown).apply(target, args); };
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      },
    }) as Pool;
    const measured = new FinancialService(counted, new FakeGateway(), { mpesa: new FakeMobileMoneyProvider("mpesa"), airtel: new FakeMobileMoneyProvider("airtel") });
    const t0 = Date.now();
    const h = await measured.collectionHealth(30);
    expect(reads).toBeLessThanOrEqual(7);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(h.prompts).toBeGreaterThan(2000);
  });
});
