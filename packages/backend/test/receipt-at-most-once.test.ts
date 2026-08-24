// One gift, one text — whatever fails, however many times anything reruns.
//
// On 2026-08-23 a giver received FIVE receipts for one KES 10 gift. The outbox
// is at-least-once by design, and three separate layers were happy to turn
// redelivery into re-texting:
//   A. enqueue        — guarded already (settle() checks status before enqueue)
//   B. the handler    — inserted a FRESH notification row per run
//   C. the send       — stamped the transaction only AFTER the send, so every
//                       failure between "Africa's Talking has it" and "the
//                       stamp is written" re-sent on retry
// This file pins the fix for B and C: a claim on transactions.receipt_sms_at
// taken BEFORE the send, released only when Africa's Talking positively
// refused (err.definitelyNotSent), and per-transaction dedup on the
// notification inserts.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { pino } from "pino";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { testEnv } from "./helpers/app.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { buildOutboxHandlers } from "../src/workers/handlers.js";
import { NotificationWorker } from "../src/workers/notificationWorker.js";
import type { DispatchProvider } from "../src/workers/dispatch.js";
import type { OutboundMessage, MessageProvider } from "../src/modules/announcements/providers.js";
import type { Env } from "../src/config/env.js";

const log = pino({ level: "silent" });

function ctxWith(sms?: MessageProvider) {
  const pool = testPool();
  return {
    env: testEnv() as Env,
    db: { primary: pool, replica: pool },
    log,
    ...(sms ? { smsProvider: sms } : {}),
  };
}

/** An SMS provider whose next send can be scripted to fail a chosen way. */
class ScriptedSms implements MessageProvider {
  readonly channel = "sms" as const;
  readonly attempts: OutboundMessage[] = [];
  /** Consumed one per send: "ok" | "refused" (definitelyNotSent) | "vanished" (timeout-shaped). */
  script: Array<"ok" | "refused" | "vanished"> = [];
  async send(msg: OutboundMessage): Promise<{ ref: string }> {
    this.attempts.push(msg);
    const verdict = this.script.shift() ?? "ok";
    if (verdict === "refused") {
      throw Object.assign(new Error("Africa's Talking returned 401: auth"), { definitelyNotSent: true });
    }
    if (verdict === "vanished") {
      // The timeout shape: the request died with no answer. Maybe sent.
      throw new Error("fetch failed: operation timed out");
    }
    return { ref: `AT-ref-${this.attempts.length}` };
  }
}

async function websiteGift(): Promise<string> {
  const p = testPool();
  await p.query(`INSERT INTO funds (code,name,is_active) VALUES ('tithe','Tithe',TRUE) ON CONFLICT (code) DO NOTHING`);
  const { rows } = await p.query(
    `INSERT INTO transactions
       (user_id, fund_id, amount_minor, currency, status, provider, provider_ref,
        idempotency_key, source, giver_name, giver_phone, receipt_code, settled_at)
     SELECT NULL, fund_id, 1000, 'KES', 'succeeded', 'mpesa', $1, $1, 'website',
            'Jacob Kuria', '+254722000111', 'SJ12ABC345', now()
       FROM funds WHERE code='tithe' RETURNING transaction_id`,
    [`ref-${Math.random().toString(36).slice(2)}`],
  );
  return rows[0].transaction_id as string;
}

async function stampOf(id: string): Promise<{ at: string | null; ref: string | null }> {
  const { rows } = await testPool().query(
    `SELECT receipt_sms_at::text AS at, receipt_sms_ref AS ref FROM transactions WHERE transaction_id = $1`,
    [id],
  );
  return { at: rows[0].at, ref: rows[0].ref };
}

beforeEach(resetDb);
afterAll(closeTestPool);

describe("website gift — the claim beats every redelivery", () => {
  it("a clean send happens once, and a redelivered job does not send again", async () => {
    const sms = new ScriptedSms();
    const h = buildOutboxHandlers(ctxWith(sms)).get("giving.receipt")!;
    const id = await websiteGift();
    await h({ transaction_id: id, user_id: null });
    await h({ transaction_id: id, user_id: null }); // the outbox redelivering
    expect(sms.attempts).toHaveLength(1);
    const s = await stampOf(id);
    expect(s.at).not.toBeNull();
    expect(s.ref).toBe("AT-ref-1");
  });

  it("an unknown outcome (timeout) keeps the claim: no retry may text the giver twice", async () => {
    const sms = new ScriptedSms();
    sms.script = ["vanished"];
    const h = buildOutboxHandlers(ctxWith(sms)).get("giving.receipt")!;
    const id = await websiteGift();
    // Must NOT throw — a rethrow would ask the outbox to retry a maybe-sent text.
    await h({ transaction_id: id, user_id: null });
    expect(sms.attempts).toHaveLength(1);
    const s = await stampOf(id);
    expect(s.at).not.toBeNull();
    expect(s.ref).toBe("claimed"); // the queryable trace of "sent with unknown fate"
    // The outbox retries anyway (or an admin re-runs it): still exactly one attempt.
    await h({ transaction_id: id, user_id: null });
    expect(sms.attempts).toHaveLength(1);
  });

  it("a positive refusal releases the claim, and the retry that follows CAN send", async () => {
    const sms = new ScriptedSms();
    sms.script = ["refused", "ok"];
    const h = buildOutboxHandlers(ctxWith(sms)).get("giving.receipt")!;
    const id = await websiteGift();
    await expect(h({ transaction_id: id, user_id: null })).rejects.toThrow(/401/); // outbox will retry
    expect((await stampOf(id)).at).toBeNull(); // claim released — nothing was sent
    await h({ transaction_id: id, user_id: null });
    expect(sms.attempts).toHaveLength(2);
    expect((await stampOf(id)).ref).toBe("AT-ref-2");
  });
});

describe("member gift — one job run or five, one row per channel", () => {
  it("rerunning giving.receipt inserts no second sms or email row", async () => {
    const cong = await createCongregation();
    const member = await createUser({ congregationId: cong, email: "kuria@dev.local", fullName: "Jacob Kuria" });
    await testPool().query(
      `INSERT INTO funds (code,name,is_active) VALUES ('tithe','Tithe',TRUE) ON CONFLICT (code) DO NOTHING`,
    );
    const { rows } = await testPool().query(
      `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, provider_ref,
                                 idempotency_key, receipt_code, settled_at)
       SELECT $1, fund_id, 1000, 'KES', 'succeeded', 'mpesa', 'jk-1', 'jk-1', 'SJ12ABC345', now()
         FROM funds WHERE code='tithe' RETURNING transaction_id`,
      [member.user_id],
    );
    const txnId = rows[0].transaction_id as string;
    const h = buildOutboxHandlers(ctxWith(new ScriptedSms())).get("giving.receipt")!;
    await h({ transaction_id: txnId, user_id: member.user_id });
    await h({ transaction_id: txnId, user_id: member.user_id });
    await h({ transaction_id: txnId, user_id: member.user_id });

    const counts = await testPool().query(
      `SELECT channel, count(*)::int AS n FROM notifications
        WHERE user_id = $1 AND template = 'giving_receipt' GROUP BY channel ORDER BY channel`,
      [member.user_id],
    );
    // However many times the job ran: one row per channel, never a stack of five.
    for (const r of counts.rows as { channel: string; n: number }[]) {
      expect(r.n, `channel ${r.channel}`).toBe(1);
    }
    expect((counts.rows as { channel: string }[]).map((r) => r.channel)).toContain("sms");
  });
});

describe("the pump — a receipt row sends at most once per transaction", () => {
  class RecordingDispatch implements DispatchProvider {
    readonly calls: Array<{ channel: string; template: string }> = [];
    fail: unknown = null;
    async send(msg: { channel: "push" | "email" | "sms"; to: string; template: string; payload: Record<string, unknown> }): Promise<void> {
      if (this.fail) throw this.fail;
      this.calls.push({ channel: msg.channel, template: msg.template });
    }
  }

  async function memberWithTxn(): Promise<{ userId: string; txnId: string }> {
    const cong = await createCongregation();
    const member = await createUser({ congregationId: cong, email: "pump@dev.local", fullName: "Jacob Kuria" });
    await testPool().query(`UPDATE users SET phone_number = '+254722000222' WHERE user_id = $1`, [member.user_id]);
    await testPool().query(
      `INSERT INTO funds (code,name,is_active) VALUES ('tithe','Tithe',TRUE) ON CONFLICT (code) DO NOTHING`,
    );
    const { rows } = await testPool().query(
      `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, provider_ref,
                                 idempotency_key, receipt_code, settled_at)
       SELECT $1, fund_id, 1000, 'KES', 'succeeded', 'mpesa', 'pump-1', 'pump-1', 'SJ12ABC345', now()
         FROM funds WHERE code='tithe' RETURNING transaction_id`,
      [member.user_id],
    );
    return { userId: member.user_id, txnId: rows[0].transaction_id as string };
  }

  async function scheduleSmsRow(userId: string, txnId: string): Promise<void> {
    await testPool().query(
      `INSERT INTO notifications (user_id, channel, template, payload, status, scheduled_for)
       VALUES ($1, 'sms', 'giving_receipt', $2, 'scheduled', now())`,
      [userId, JSON.stringify({ transaction_id: txnId, amount_minor: 1000, currency: "KES", fund: "Tithe" })],
    );
  }

  it("sends once, claims the transaction, and a duplicate row is closed WITHOUT a second text", async () => {
    const { userId, txnId } = await memberWithTxn();
    const dispatch = new RecordingDispatch();
    const worker = new NotificationWorker(testPool(), dispatch, log);

    await scheduleSmsRow(userId, txnId);
    await worker.dispatchDue();
    expect(dispatch.calls).toHaveLength(1);
    expect((await stampOf(txnId)).at).not.toBeNull();

    // A duplicate row for the SAME gift — however it got there — must not text.
    await scheduleSmsRow(userId, txnId);
    const out = await worker.dispatchDue();
    expect(dispatch.calls).toHaveLength(1);
    expect(out.sent).toBe(1); // the row is closed as sent, not left to loop
    const open = await testPool().query(
      `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND status = 'scheduled'`,
      [userId],
    );
    expect((open.rows[0] as { n: number }).n).toBe(0);
  });

  it("a refused send releases the claim so the truth stays queryable", async () => {
    const { userId, txnId } = await memberWithTxn();
    const dispatch = new RecordingDispatch();
    dispatch.fail = Object.assign(new Error("Africa's Talking returned 401"), { definitelyNotSent: true });
    const worker = new NotificationWorker(testPool(), dispatch, log);
    await scheduleSmsRow(userId, txnId);
    const out = await worker.dispatchDue();
    expect(out.failed).toBe(1);
    // The text did not go; the transaction must not claim it did.
    expect((await stampOf(txnId)).at).toBeNull();
  });
});
