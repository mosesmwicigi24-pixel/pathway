// Payments v2 (Contract Matrix B7): mobile money (M-Pesa/Airtel) behind the
// same intent → verified-callback → balanced-ledger flow as Stripe, plus
// recurring giving_schedules charged by the server-side scheduler. Guardrails
// unchanged: settlement ONLY on a verified callback; deterministic per-cycle
// idempotency keys make re-runs double-charge-proof.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { pino } from "pino";
import supertest from "supertest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { testEnv, bearer } from "./helpers/app.js";
import { createApp } from "../src/http/app.js";
import { FinancialService } from "../src/modules/financial/service.js";
import { FakeMobileMoneyProvider } from "../src/modules/financial/providers.js";
import { ApiError } from "../src/http/errors.js";
import type { PaymentGateway, WebhookEvent } from "../src/modules/financial/gateway.js";

class FakeGateway implements PaymentGateway {
  public lastIntentId = "";
  private n = 0;
  async createIntent(): Promise<{ id: string; client_secret: string }> {
    this.n += 1;
    this.lastIntentId = `pi_${this.n}`;
    return { id: this.lastIntentId, client_secret: `cs_${this.n}` };
  }
  verifyWebhook(rawBody: Buffer | string): WebhookEvent {
    return JSON.parse(typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")) as WebhookEvent;
  }
}

// One app for the HTTP webhook test, built FIRST so the singleton router gets
// providers configured from env (secret matches the fakes' default).
const env = { ...testEnv(), MPESA_CALLBACK_SECRET: "test-mm-secret", AIRTEL_CALLBACK_SECRET: "test-mm-secret" };
const app = createApp({ env, db: { primary: testPool(), replica: testPool() }, log: pino({ level: "silent" }) });

let cong: string, user: string, userTok: string;
let gw: FakeGateway, mpesa: FakeMobileMoneyProvider, airtel: FakeMobileMoneyProvider;
let svc: FinancialService;

const signedBody = (p: FakeMobileMoneyProvider, payload: Record<string, unknown>) => {
  const body = JSON.stringify(payload);
  return { body, signature: p.sign(body) };
};

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  user = (await createUser({ congregationId: cong, phone: "+254711222333" })).user_id;
  userTok = bearer({ sub: user, role: "Student", cong });
  gw = new FakeGateway();
  mpesa = new FakeMobileMoneyProvider("mpesa");
  airtel = new FakeMobileMoneyProvider("airtel");
  svc = new FinancialService(testPool(), gw, { mpesa, airtel });
});
afterAll(async () => {
  await closeTestPool();
});

describe("mobile money (same trust model as Stripe, §5.6)", () => {
  it("initiates an STK push and settles ONLY on the verified callback, ledger balanced on cash:mpesa", async () => {
    const intent = (await svc.createGivingIntent(user, {
      fund: "mission", // new B7 seed
      amount_minor: 20000,
      currency: "KES",
      method: "mpesa",
      idempotency_key: "give-mm-001",
    })) as { transaction_id: string; provider_ref: string; status: string };
    expect(intent.status).toBe("processing");
    expect(mpesa.initiated[0]!.phoneNumber).toBe("+254711222333"); // profile phone by default
    expect(intent).not.toHaveProperty("client_secret");

    // Tampered callback is rejected and settles nothing.
    const evil = signedBody(mpesa, { event_id: "evt_1", ref: intent.provider_ref, status: "succeeded" });
    await expect(svc.handleMobileMoneyCallback("mpesa", evil.body, "deadbeef")).rejects.toThrow(ApiError);

    // Verified callback settles + posts the balanced double-entry.
    const ok = signedBody(mpesa, { event_id: "evt_1", ref: intent.provider_ref, status: "succeeded" });
    const res = await svc.handleMobileMoneyCallback("mpesa", ok.body, ok.signature);
    expect(res.duplicate).toBe(false);

    const txn = await testPool().query(`SELECT status, provider FROM transactions WHERE transaction_id=$1`, [
      intent.transaction_id,
    ]);
    expect(txn.rows[0]).toEqual({ status: "succeeded", provider: "mpesa" });
    const ledger = await testPool().query(
      `SELECT account, side::text, amount_minor::int AS amt FROM ledger_entries WHERE transaction_id=$1 ORDER BY side`,
      [intent.transaction_id],
    );
    expect(ledger.rows).toEqual([
      { account: "fund:mission", side: "credit", amt: 20000 },
      { account: "cash:mpesa", side: "debit", amt: 20000 },
    ]);

    // Replayed callback is an idempotent no-op (no second ledger post).
    const replay = await svc.handleMobileMoneyCallback("mpesa", ok.body, ok.signature);
    expect(replay.duplicate).toBe(true);
    const count = await testPool().query(`SELECT count(*)::int AS n FROM ledger_entries`);
    expect(count.rows[0].n).toBe(2);
  });

  it("captures the M-Pesa receipt code on success, once, and surfaces it in giving history", async () => {
    const intent = (await svc.createGivingIntent(user, {
      fund: "mission",
      amount_minor: 20000,
      currency: "KES",
      method: "mpesa",
      idempotency_key: "give-rcpt-001",
    })) as { transaction_id: string; provider_ref: string };

    const ok = signedBody(mpesa, {
      event_id: "evt_rcpt_1",
      ref: intent.provider_ref,
      status: "succeeded",
      receipt: "UG3J29U3OL",
    });
    await svc.handleMobileMoneyCallback("mpesa", ok.body, ok.signature);

    const stored = await testPool().query(`SELECT receipt_code FROM transactions WHERE transaction_id=$1`, [
      intent.transaction_id,
    ]);
    expect(stored.rows[0].receipt_code).toBe("UG3J29U3OL");

    // A duplicate callback (even one carrying a different receipt) must never
    // overwrite the captured code — the processed_webhooks dedupe short-circuits.
    const dup = signedBody(mpesa, {
      event_id: "evt_rcpt_1",
      ref: intent.provider_ref,
      status: "succeeded",
      receipt: "ZZZZZZZZZZ",
    });
    const replay = await svc.handleMobileMoneyCallback("mpesa", dup.body, dup.signature);
    expect(replay.duplicate).toBe(true);
    const after = await testPool().query(`SELECT receipt_code FROM transactions WHERE transaction_id=$1`, [
      intent.transaction_id,
    ]);
    expect(after.rows[0].receipt_code).toBe("UG3J29U3OL");

    // GET /giving/history carries the receipt_code for the mobile statement.
    const hist = await supertest(app).get("/v1/giving/history").set({ Authorization: userTok });
    expect(hist.status).toBe(200);
    const rec = (hist.body.data as Array<{ transaction_id: string; receipt_code: string | null }>).find(
      (r) => r.transaction_id === intent.transaction_id,
    );
    expect(rec?.receipt_code).toBe("UG3J29U3OL");
  });

  it("a failed callback leaves receipt_code null", async () => {
    const intent = (await svc.createGivingIntent(user, {
      fund: "gift",
      amount_minor: 5000,
      currency: "KES",
      method: "mpesa",
      idempotency_key: "give-rcpt-fail",
    })) as { transaction_id: string; provider_ref: string };
    const cb = signedBody(mpesa, {
      event_id: "evt_rcpt_fail",
      ref: intent.provider_ref,
      status: "failed",
      receipt: "SHOULDNOTLAND",
    });
    await svc.handleMobileMoneyCallback("mpesa", cb.body, cb.signature);
    const row = await testPool().query(`SELECT status, receipt_code FROM transactions WHERE transaction_id=$1`, [
      intent.transaction_id,
    ]);
    expect(row.rows[0].status).toBe("failed");
    expect(row.rows[0].receipt_code).toBeNull();
  });

  it("a failed callback marks the transaction failed without any ledger post", async () => {
    const intent = (await svc.createGivingIntent(user, {
      fund: "gift",
      amount_minor: 5000,
      currency: "KES",
      method: "airtel",
      phone_number: "+254700999888",
      idempotency_key: "give-mm-002",
    })) as { transaction_id: string; provider_ref: string };
    expect(airtel.initiated[0]!.phoneNumber).toBe("+254700999888"); // explicit phone wins

    const cb = signedBody(airtel, { event_id: "evt_2", ref: intent.provider_ref, status: "failed" });
    await svc.handleMobileMoneyCallback("airtel", cb.body, cb.signature);
    const txn = await testPool().query(`SELECT status FROM transactions WHERE transaction_id=$1`, [intent.transaction_id]);
    expect(txn.rows[0].status).toBe("failed");
    expect((await testPool().query(`SELECT count(*)::int AS n FROM ledger_entries`)).rows[0].n).toBe(0);
  });

  it("named giving: an account_name rides the STK push as metadata.reference, persists, and is returned", async () => {
    // Parsed through the schema first (as the router does via parseBody) so
    // the trim transform runs — the raw string has leading/trailing spaces.
    const parsed = FinancialService.GivingIntent.parse({
      fund: "mission",
      amount_minor: 15000,
      currency: "KES",
      method: "mpesa",
      account_name: "  Thanksgiving  ",
      idempotency_key: "give-name-001",
    });
    const intent = (await svc.createGivingIntent(user, parsed)) as { transaction_id: string; provider_ref: string };

    // Plumbed through to the provider so the real Daraja adapter can sanitize +
    // send it as AccountReference (sanitization itself is unit-tested on
    // sanitizeAccountReference in mpesa-daraja.test.ts).
    expect(mpesa.initiated.at(-1)!.metadata.reference).toBe("Thanksgiving");

    const stored = await testPool().query(`SELECT account_name FROM transactions WHERE transaction_id=$1`, [
      intent.transaction_id,
    ]);
    expect(stored.rows[0].account_name).toBe("Thanksgiving");

    const hist = await supertest(app).get("/v1/giving/history").set({ Authorization: userTok });
    const rec = (hist.body.data as Array<{ transaction_id: string; account_name: string | null }>).find(
      (r) => r.transaction_id === intent.transaction_id,
    );
    expect(rec?.account_name).toBe("Thanksgiving");

    const detail = (await svc.givingDetail(user, intent.transaction_id)) as { account_name: string | null };
    expect(detail.account_name).toBe("Thanksgiving");
  });

  it("named giving: absent account_name leaves everything unchanged (no reference key, null column)", async () => {
    const intent = (await svc.createGivingIntent(user, {
      fund: "mission",
      amount_minor: 15000,
      currency: "KES",
      method: "mpesa",
      idempotency_key: "give-name-002",
    })) as { transaction_id: string };

    // No `reference` key set at all — the provider falls back to its own
    // fund/default AccountReference, exactly as before this feature existed.
    expect(mpesa.initiated.at(-1)!.metadata).not.toHaveProperty("reference");

    const stored = await testPool().query(`SELECT account_name FROM transactions WHERE transaction_id=$1`, [
      intent.transaction_id,
    ]);
    expect(stored.rows[0].account_name).toBeNull();
  });

  it("named giving: an empty/whitespace-only account_name is treated as absent", async () => {
    const parsed = FinancialService.GivingIntent.parse({
      fund: "mission",
      amount_minor: 15000,
      currency: "KES",
      method: "mpesa",
      account_name: "   ",
      idempotency_key: "give-name-003",
    });
    expect(parsed.account_name).toBeUndefined(); // schema-level: whitespace-only → absent
    const intent = (await svc.createGivingIntent(user, parsed)) as { transaction_id: string };
    expect(mpesa.initiated.at(-1)!.metadata).not.toHaveProperty("reference");
    const stored = await testPool().query(`SELECT account_name FROM transactions WHERE transaction_id=$1`, [
      intent.transaction_id,
    ]);
    expect(stored.rows[0].account_name).toBeNull();
  });

  it("HTTP callback route verifies the HMAC end-to-end", async () => {
    const created = await supertest(app)
      .post("/v1/giving/intents")
      .set({ Authorization: userTok })
      .send({ fund: "tithe", amount_minor: 1000, currency: "KES", method: "mpesa", idempotency_key: "give-mm-003" });
    expect(created.status).toBe(201);
    const ref = created.body.provider_ref;

    const http = new FakeMobileMoneyProvider("mpesa", "test-mm-secret");
    const ok = signedBody(http, { event_id: "evt_http", ref, status: "succeeded" });

    const bad = await supertest(app)
      .post("/v1/webhooks/mobilemoney/mpesa")
      .set("Content-Type", "application/json")
      .set("x-mm-signature", "deadbeef")
      .send(ok.body);
    expect(bad.status).toBe(400);

    const good = await supertest(app)
      .post("/v1/webhooks/mobilemoney/mpesa")
      .set("Content-Type", "application/json")
      .set("x-mm-signature", ok.signature)
      .send(ok.body);
    expect(good.status).toBe(200);
    const txn = await testPool().query(`SELECT status FROM transactions WHERE provider_ref=$1`, [ref]);
    expect(txn.rows[0].status).toBe("succeeded");
  });
});

describe("recurring giving schedules (server-charged, §1.1)", () => {
  it("charges due schedules with deterministic keys — re-runs never double-charge", async () => {
    const created = (await svc.createSchedule(user, {
      fund: "tithe",
      amount_minor: 10000,
      currency: "KES",
      frequency: "weekly",
      method: "card",
      idempotency_key: "sched-001",
    })) as { schedule_id: string; next_run_at: string };

    // Idempotent create.
    const again = (await svc.createSchedule(user, {
      fund: "tithe",
      amount_minor: 10000,
      currency: "KES",
      frequency: "weekly",
      idempotency_key: "sched-001",
    })) as { schedule_id: string; reused: boolean };
    expect(again.reused).toBe(true);
    expect(again.schedule_id).toBe(created.schedule_id);

    // Not due yet → nothing runs.
    expect((await svc.runDueSchedules(new Date())).run).toBe(0);

    // Backdate the due time → one charge, linked to the schedule, cadence +7d from DUE.
    const due = new Date(Date.now() - 3600_000);
    await testPool().query(`UPDATE giving_schedules SET next_run_at=$2 WHERE schedule_id=$1`, [
      created.schedule_id,
      due.toISOString(),
    ]);
    expect((await svc.runDueSchedules(new Date())).run).toBe(1);

    const txns = await testPool().query(
      `SELECT schedule_id, status, amount_minor::int AS amt FROM transactions WHERE schedule_id=$1`,
      [created.schedule_id],
    );
    expect(txns.rows).toHaveLength(1);
    expect(txns.rows[0].amt).toBe(10000);

    const sched = await testPool().query(`SELECT next_run_at FROM giving_schedules WHERE schedule_id=$1`, [
      created.schedule_id,
    ]);
    const expected = new Date(due);
    expected.setUTCDate(expected.getUTCDate() + 7);
    expect(new Date(sched.rows[0].next_run_at).toISOString()).toBe(expected.toISOString());

    // Crash simulation: rewind next_run_at to the SAME due instant and re-run —
    // the deterministic key makes it a reused no-op, not a second charge.
    await testPool().query(`UPDATE giving_schedules SET next_run_at=$2 WHERE schedule_id=$1`, [
      created.schedule_id,
      due.toISOString(),
    ]);
    expect((await svc.runDueSchedules(new Date())).run).toBe(1); // reused intent, still advances
    const after = await testPool().query(`SELECT count(*)::int AS n FROM transactions WHERE schedule_id=$1`, [
      created.schedule_id,
    ]);
    expect(after.rows[0].n).toBe(1);
  });

  it("cancelled schedules stop charging; cancel is owner-scoped and one-shot", async () => {
    const created = (await svc.createSchedule(user, {
      fund: "gift",
      amount_minor: 2500,
      currency: "KES",
      frequency: "monthly",
      method: "mpesa",
      idempotency_key: "sched-002",
    })) as { schedule_id: string };
    await testPool().query(`UPDATE giving_schedules SET next_run_at=now() - interval '1 hour'`);

    await svc.cancelSchedule(user, created.schedule_id);
    expect((await svc.runDueSchedules(new Date())).run).toBe(0);
    await expect(svc.cancelSchedule(user, created.schedule_id)).rejects.toThrow("Active schedule not found");

    const mine = (await svc.listSchedules(user)) as { data: Array<{ status: string }> };
    expect(mine.data[0]!.status).toBe("cancelled");
  });

  it("provider outages leave the schedule due — the next tick retries", async () => {
    // No mobile-money providers wired at all → initiate throws.
    const lonely = new FinancialService(testPool(), gw);
    await lonely.createSchedule(user, {
      fund: "tithe",
      amount_minor: 700,
      currency: "KES",
      frequency: "weekly",
      method: "mpesa",
      idempotency_key: "sched-003",
    });
    await testPool().query(`UPDATE giving_schedules SET next_run_at=now() - interval '1 hour'`);
    const result = await lonely.runDueSchedules(new Date());
    expect(result).toEqual({ run: 0, failed: 1, skipped: 0 });
    const sched = await testPool().query(`SELECT next_run_at < now() AS still_due FROM giving_schedules`);
    expect(sched.rows[0].still_due).toBe(true); // untouched — will retry
  });

  // A failed collection used to be swallowed by `catch { failed += 1 }`: nothing
  // logged, nothing recorded, nobody told, and a retry every five minutes
  // forever. These pin the fix (owner, 2026-08-28).
  describe("a recurring gift that fails says so", () => {
    const brokenSvc = (): FinancialService => new FinancialService(testPool(), gw); // no mobile-money providers → initiate throws
    async function dueSchedule(key: string): Promise<void> {
      await brokenSvc().createSchedule(user, {
        fund: "tithe", amount_minor: 700, currency: "KES",
        frequency: "monthly", method: "mpesa", idempotency_key: key,
      });
      await testPool().query(`UPDATE giving_schedules SET next_run_at = now() - interval '1 hour'`);
    }
    const scheduleRow = async (): Promise<{
      status: string; consecutive_failures: number; last_error: string | null;
      retry_after: string | null; next_run_at: string; paused_at: string | null;
    }> =>
      (await testPool().query(
        `SELECT status, consecutive_failures, last_error, retry_after, next_run_at, paused_at
           FROM giving_schedules LIMIT 1`,
      )).rows[0];

    it("records the reason, counts the attempt, and backs off instead of hammering", async () => {
      await dueSchedule("sched-f1");
      const before = await scheduleRow();
      await brokenSvc().runDueSchedules(new Date());
      const after = await scheduleRow();
      expect(after.consecutive_failures).toBe(1);
      expect(after.last_error).toBeTruthy();                 // the reason is kept, not swallowed
      expect(after.retry_after).not.toBeNull();              // backed off
      expect(new Date(after.retry_after!).getTime()).toBeGreaterThan(Date.now());
      // THE guarantee: the cycle anchor never moves on failure, so the retry
      // reuses `sched:{id}:{next_run_at}` and can never charge twice.
      expect(new Date(after.next_run_at).getTime()).toBe(new Date(before.next_run_at).getTime());
    });

    it("does not retry until the backoff has passed", async () => {
      await dueSchedule("sched-f2");
      await brokenSvc().runDueSchedules(new Date());
      const second = await brokenSvc().runDueSchedules(new Date());
      expect(second).toEqual({ run: 0, failed: 0, skipped: 0 });         // skipped, not retried
      expect((await scheduleRow()).consecutive_failures).toBe(1);
    });

    it("stops after three attempts, pauses rather than cancels, and tells the giver", async () => {
      await dueSchedule("sched-f3");
      for (let i = 0; i < 3; i++) {
        await testPool().query(`UPDATE giving_schedules SET retry_after = NULL`); // fast-forward the backoff
        await brokenSvc().runDueSchedules(new Date());
      }
      const row = await scheduleRow();
      expect(row.consecutive_failures).toBe(3);
      expect(row.status).toBe("paused");                     // paused — the intent still stands
      expect(row.paused_at).not.toBeNull();
      const notes = await testPool().query<{ template: string }>(
        `SELECT template FROM notifications WHERE user_id = $1 AND template LIKE 'giving_schedule%' ORDER BY template`,
        [user],
      );
      expect(notes.rows.map((r) => r.template)).toEqual(["giving_schedule_failed", "giving_schedule_paused"]);
    });

    it("a paused schedule is not charged again until the giver resumes it", async () => {
      await dueSchedule("sched-f4");
      for (let i = 0; i < 3; i++) {
        await testPool().query(`UPDATE giving_schedules SET retry_after = NULL`);
        await brokenSvc().runDueSchedules(new Date());
      }
      expect(await brokenSvc().runDueSchedules(new Date())).toEqual({ run: 0, failed: 0, skipped: 0 });

      const id = (await testPool().query<{ schedule_id: string }>(`SELECT schedule_id FROM giving_schedules`)).rows[0]!.schedule_id;
      // Through the ROUTE, not the service: mounting is part of the feature,
      // and a service-only test cannot tell you the endpoint exists.
      const res = await supertest(app).post(`/v1/giving/schedules/${id}/resume`).set({ Authorization: userTok });
      expect(res.status).toBe(200);
      const resumed = res.body as { status: string; next_run_at: string };
      expect(resumed.status).toBe("active");
      // Never a surprise charge: resuming re-arms for the NEXT cycle, it does
      // not collect the month that was missed.
      expect(new Date(resumed.next_run_at).getTime()).toBeGreaterThan(Date.now());
      const row = await scheduleRow();
      expect(row.consecutive_failures).toBe(0);
      expect(row.last_error).toBeNull();
    });

    it("a successful cycle clears the failure state", async () => {
      await dueSchedule("sched-f5");
      await brokenSvc().runDueSchedules(new Date());
      expect((await scheduleRow()).consecutive_failures).toBe(1);
      await testPool().query(`UPDATE giving_schedules SET retry_after = NULL`);
      await svc.runDueSchedules(new Date());                 // svc HAS a working fake provider
      const row = await scheduleRow();
      expect(row.consecutive_failures).toBe(0);
      expect(row.last_error).toBeNull();
      expect(row.retry_after).toBeNull();
    });

    it("the church can finally see a failing partner", async () => {
      await dueSchedule("sched-f6");
      await brokenSvc().runDueSchedules(new Date());
      const admin = (await brokenSvc().listSchedulesAdmin({})) as {
        data: Array<{ needs_attention: boolean; consecutive_failures: number; full_name: string }>;
      };
      expect(admin.data).toHaveLength(1);
      expect(admin.data[0]!.needs_attention).toBe(true);
      expect(admin.data[0]!.consecutive_failures).toBe(1);
      expect(admin.data[0]!.full_name).toBeTruthy();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Partners (Phase 1). A partner is not a new record — it is an active or paused
// giving_schedule, read a different way. These tests exist mostly to pin the two
// honesty rules, because both are easy to "improve" into a lie later.
describe("a partner's standing tells the truth", () => {
  const partnership = async (): Promise<Record<string, never> & {
    is_partner: boolean; ever_partnered: boolean; status?: string; kept?: number;
    schedule_id?: string;
    given_minor?: number; rhythm?: { frequency: string; next_run_at: string | null };
    trouble?: { paused: boolean; consecutive_failures: number } | null;
    since_you_began?: { levels_completed: number; plans_finished: number } | null;
  }> => {
    const res = await supertest(app).get("/v1/giving/partnership").set({ Authorization: userTok });
    expect(res.status).toBe(200);
    return res.body;
  };

  it("a member who has never given is not a partner, and is not called a lapsed one", async () => {
    const p = await partnership();
    expect(p.is_partner).toBe(false);
    expect(p.ever_partnered).toBe(false);
    expect(p.since_you_began).toBeNull();
  });

  it("someone who partnered and stopped is remembered as having partnered", async () => {
    const s = await svc.createSchedule(user, {
      fund: "tithe", amount_minor: 500, currency: "KES",
      frequency: "monthly", method: "mpesa", idempotency_key: "p-lapsed",
    }) as { schedule_id: string };
    await svc.cancelSchedule(user, s.schedule_id);
    const p = await partnership();
    expect(p.is_partner).toBe(false);
    expect(p.ever_partnered).toBe(true);
  });

  it("an active partner shows their rhythm and their next collection", async () => {
    await svc.createSchedule(user, {
      fund: "tithe", amount_minor: 500, currency: "KES",
      frequency: "monthly", method: "mpesa", idempotency_key: "p-active",
    });
    const p = await partnership();
    expect(p.is_partner).toBe(true);
    expect(p.status).toBe("active");
    // The resume control needs something real to act on. Without this the
    // client has to guess, and guessing meant a cache that was never populated.
    expect(p.schedule_id).toBeTruthy();
    expect(p.rhythm?.frequency).toBe("monthly");
    expect(p.rhythm?.next_run_at).not.toBeNull();
    // Healthy giving shows no trouble block at all — a partner collecting
    // cleanly should never be shown a warning shaped like one.
    expect(p.trouble).toBeNull();
  });

  // THE RULE THAT MATTERS. Scheduling a cycle is not keeping it.
  it("counts cycles actually COLLECTED, never cycles merely scheduled", async () => {
    const s = await svc.createSchedule(user, {
      fund: "tithe", amount_minor: 500, currency: "KES",
      frequency: "monthly", method: "mpesa", idempotency_key: "p-kept",
    }) as { schedule_id: string };

    // Three cycles reached the provider; only two were ever collected.
    for (const [ref, status] of [["r1", "succeeded"], ["r2", "succeeded"], ["r3", "failed"]] as const) {
      await testPool().query(
        `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status,
                                   idempotency_key, schedule_id)
         SELECT $1, fund_id, 500, 'KES', $2::txn_status, $3, $4 FROM funds WHERE code = 'tithe'`,
        [user, status, `sched:${s.schedule_id}:${ref}`, s.schedule_id],
      );
    }
    const p = await partnership();
    expect(p.kept).toBe(2);              // not 3
    expect(p.given_minor).toBe(1000);    // and the money agrees
  });

  it("a paused partner is told plainly, without the provider's error text", async () => {
    await svc.createSchedule(user, {
      fund: "tithe", amount_minor: 500, currency: "KES",
      frequency: "monthly", method: "mpesa", idempotency_key: "p-paused",
    });
    await testPool().query(
      `UPDATE giving_schedules SET status = 'paused', paused_at = now(),
              consecutive_failures = 3, last_error = 'MPESA 2001: wrong PIN'`,
    );
    const p = await partnership();
    expect(p.is_partner).toBe(true);     // still a partner — the intent stands
    expect(p.status).toBe("paused");
    expect(p.trouble?.paused).toBe(true);
    expect(p.trouble?.consecutive_failures).toBe(3);
    expect(p.rhythm?.next_run_at).toBeNull();   // nothing is coming while paused
    expect(JSON.stringify(p)).not.toContain("wrong PIN");  // never the raw reason
  });

  it("what the church did is counted from the day they began, and is never called theirs", async () => {
    await svc.createSchedule(user, {
      fund: "tithe", amount_minor: 500, currency: "KES",
      frequency: "monthly", method: "mpesa", idempotency_key: "p-impact",
    });
    // One plan finished before they began, one after. Only the later one counts.
    const other = (await createUser({ congregationId: cong, phone: "+254799000111" })).user_id;
    const plan = (await testPool().query(
      `SELECT plan_id FROM reading_plans WHERE is_active LIMIT 1`,
    )).rows[0]?.plan_id;
    if (plan) {
      await testPool().query(
        `INSERT INTO reading_plan_progress (user_id, plan_id, completed_at)
         VALUES ($1, $2, now() - interval '400 days'), ($3, $2, now())
         ON CONFLICT DO NOTHING`,
        [other, plan, user],
      );
      const p = await partnership();
      expect(p.since_you_began?.plans_finished).toBe(1);
    }
    const p2 = await partnership();
    // The shape says whose it is: a season, not an attribution.
    expect(p2.since_you_began).toHaveProperty("from");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The backlog guard. Found in production on 2026-09-02: six real M-Pesa
// schedules created in June had never collected once, because the provider was
// never configured on that server. Each was ~10 weeks overdue. Configuring
// M-Pesa would have charged six real people ten times in quick succession —
// and the double-charge guard would not have stopped it, because each stale
// cycle carries its own idempotency key.
describe("a schedule that fell far behind does not collect the backlog", () => {
  const weeksAgo = (n: number): string =>
    new Date(Date.now() - n * 7 * 86_400_000).toISOString();

  it("rolls a badly overdue schedule forward instead of charging every missed cycle", async () => {
    await svc.createSchedule(user, {
      fund: "tithe", amount_minor: 100_000, currency: "KES",
      frequency: "weekly", method: "mpesa", idempotency_key: "backlog-1",
    });
    // Ten weeks behind — the exact production shape.
    await testPool().query(`UPDATE giving_schedules SET next_run_at = $1`, [weeksAgo(10)]);

    const first = await svc.runDueSchedules(new Date());
    expect(first.skipped).toBe(1);
    expect(first.run).toBe(0);          // nothing collected
    expect(first.failed).toBe(0);       // and it is not a failure either

    // Not one charge was created for the backlog.
    const txns = await testPool().query(`SELECT count(*)::int AS n FROM transactions`);
    expect(txns.rows[0].n).toBe(0);

    // And it is now armed for a FUTURE date, so the rhythm resumes normally.
    const row = await testPool().query<{ next_run_at: string }>(
      `SELECT next_run_at FROM giving_schedules LIMIT 1`);
    expect(new Date(row.rows[0]!.next_run_at).getTime()).toBeGreaterThan(Date.now());

    // A second pass does nothing at all — it is no longer due.
    expect(await svc.runDueSchedules(new Date())).toEqual({ run: 0, failed: 0, skipped: 0 });
  });

  it("still charges a schedule that is merely due, not behind", async () => {
    await svc.createSchedule(user, {
      fund: "tithe", amount_minor: 100_000, currency: "KES",
      frequency: "weekly", method: "mpesa", idempotency_key: "backlog-2",
    });
    // Due an hour ago: within this cycle, so it collects as normal. The guard
    // must not swallow ordinary work.
    await testPool().query(
      `UPDATE giving_schedules SET next_run_at = now() - interval '1 hour'`);
    const res = await svc.runDueSchedules(new Date());
    expect(res.run).toBe(1);
    expect(res.skipped).toBe(0);
  });

  it("keeps the cadence's phase when it rolls forward", () => {
    // A Tuesday 09:00 weekly gift, ten weeks stale, must land on a future
    // Tuesday 09:00 — not "ten weeks from whenever the worker happened to run".
    const due = new Date("2026-06-23T09:00:00.000Z");        // a Tuesday
    const now = new Date("2026-09-02T12:00:00.000Z");
    const rolled = FinancialService.rollForward(due, "weekly", now);
    expect(rolled.getTime()).toBeGreaterThan(now.getTime());
    expect(rolled.getUTCDay()).toBe(due.getUTCDay());
    expect(rolled.getUTCHours()).toBe(due.getUTCHours());
    // And it is the FIRST such Tuesday, not one further out.
    expect(rolled.getTime() - now.getTime()).toBeLessThanOrEqual(7 * 86_400_000);
  });
});
