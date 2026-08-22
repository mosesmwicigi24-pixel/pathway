// Website giving (migration 202): the Give button on nuruplace.org.
//
// A visitor with no account types an amount and their phone number, and their
// phone asks them to confirm an M-Pesa payment. Almost everything worth
// testing here is about what the endpoint REFUSES, because an endpoint that
// makes a stranger's phone ring on demand is a harassment tool unless it is
// careful, and "careful" is a claim that has to be demonstrated rather than
// asserted in a comment.
//
// Three groups:
//   1. Authenticity  — unsigned, forged, replayed, tampered.
//   2. Rate limiting — the number being rung is the thing being protected.
//   3. The ledger    — a memberless gift settles into the same double entry a
//                      member's gift does, and reconciles by phone.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createHmac } from "node:crypto";
import { agent, makeApp } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import supertest from "supertest";
import { FinancialService } from "../src/modules/financial/service.js";
import { SIGNATURE_TOLERANCE_SECONDS } from "../src/http/websiteSignature.js";

const SECRET = "shared-with-nuruplace-org";
const MM_SECRET = "test-mm-secret";

/** Env that makes both the website intake and the M-Pesa fake available. */
const LIVE_ENV = { WEBSITE_GIVING_WEBHOOK_SECRET: SECRET, MPESA_CALLBACK_SECRET: MM_SECRET };

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPool();
});

let keySeq = 0;
function gift(over: Record<string, unknown> = {}): Record<string, unknown> {
  keySeq += 1;
  return {
    fund: "offering",
    amount_minor: 50_00,
    currency: "KES",
    method: "mpesa",
    phone_number: "+254722000111",
    giver_name: "Amina Wanjiru",
    idempotency_key: `web-gift-${keySeq}-${Math.random().toString(36).slice(2)}`,
    client_ip: "197.232.0.5",
    ...over,
  };
}

/** Sign exactly as the website does. */
function sign(body: string, secret = SECRET, atMs = Date.now()): string {
  const t = Math.floor(atMs / 1000).toString();
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

/**
 * Post a gift. `app` is threaded through because each `makeApp()` builds its
 * OWN in-memory rate-limit store — so the rate-limit tests must reuse one app,
 * and the others must NOT, or a bucket drained in one test would 429 the next.
 */
function post(app: supertest.Agent, body: Record<string, unknown>, header?: string | null) {
  const raw = JSON.stringify(body);
  const req = app.post("/v1/webhooks/website-giving").set("content-type", "application/json");
  if (header !== null) req.set("x-nuruplace-signature", header ?? sign(raw));
  return req.send(raw);
}

const fresh = () => agent(LIVE_ENV);

describe("website giving — authenticity", () => {
  it("accepts a correctly signed gift and sends the STK push", async () => {
    const res = await post(fresh(), gift());
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("processing");
    expect(res.body.provider).toBe("mpesa");
    // provider_ref is the STK push the giver is about to confirm on their phone.
    expect(res.body.provider_ref).toMatch(/^mpesa_co_/);
    expect(res.body.reused).toBe(false);
  });

  it("refuses an unsigned gift", async () => {
    const res = await post(fresh(), gift(), null);
    expect(res.status).toBe(401);
  });

  it("refuses a forged signature", async () => {
    const body = gift();
    const res = await post(fresh(), body, sign(JSON.stringify(body), "wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("refuses a signature computed over a different body", async () => {
    // The real attack: lift a valid signature off one request, change the
    // amount or the phone number, replay it.
    const original = JSON.stringify(gift());
    const tampered = gift({ phone_number: "+254733999888" });
    const res = await post(fresh(), tampered, sign(original));
    expect(res.status).toBe(401);
  });

  it("refuses a replay from outside the timestamp window", async () => {
    const body = gift();
    const stale = Date.now() - (SIGNATURE_TOLERANCE_SECONDS + 60) * 1000;
    const res = await post(fresh(), body, sign(JSON.stringify(body), SECRET, stale));
    expect(res.status).toBe(401);
  });

  it("refuses everything when no secret is configured", async () => {
    // Fails CLOSED. Without this the endpoint is an open door that rings phones.
    const res = await post(agent({ MPESA_CALLBACK_SECRET: MM_SECRET }), gift());
    expect(res.status).toBe(503);
    const { rows } = await testPool().query(`SELECT count(*)::int AS n FROM transactions`);
    expect(rows[0].n).toBe(0);
  });

  it("refuses a malformed signature header", async () => {
    const res = await post(fresh(), gift(), "v1=deadbeef");
    expect(res.status).toBe(401);
  });
});

describe("website giving — what the payload may say", () => {
  it("rejects an amount above the M-Pesa per-transaction limit", async () => {
    const res = await post(fresh(), gift({ amount_minor: FinancialService.WEBSITE_MAX_MINOR + 1 }));
    expect(res.status).toBe(400);
  });

  it("accepts an amount exactly at the limit", async () => {
    const res = await post(fresh(), gift({ amount_minor: FinancialService.WEBSITE_MAX_MINOR }));
    expect(res.status).toBe(201);
  });

  it("rejects a token amount used to probe whether the endpoint rings phones", async () => {
    const res = await post(fresh(), gift({ amount_minor: 1 }));
    expect(res.status).toBe(400);
  });

  it("rejects a currency the church cannot settle from the website", async () => {
    const res = await post(fresh(), gift({ currency: "USD" }));
    expect(res.status).toBe(400);
  });

  it("rejects an unknown fund", async () => {
    const res = await post(fresh(), gift({ fund: "swiss-account" }));
    expect(res.status).toBe(400);
  });

  it("rejects an inactive fund", async () => {
    await testPool().query(`UPDATE funds SET is_active = FALSE WHERE code = 'mission'`);
    const res = await post(fresh(), gift({ fund: "mission" }));
    expect(res.status).toBe(400);
  });

  it("rejects a gift with no phone number — nothing could attribute it", async () => {
    const body = gift();
    delete body.phone_number;
    const res = await post(fresh(), body);
    expect(res.status).toBe(400);
  });

  it("rejects card and PayPal, which have no anonymous flow yet", async () => {
    const res = await post(fresh(), gift({ method: "card" }));
    expect(res.status).toBe(400);
  });
});

describe("website giving — rate limiting", () => {
  it("throttles repeated pushes to the SAME number", async () => {
    // The harassment case: someone types a stranger's number and presses give.
    const app = agent(LIVE_ENV);
    const victim = "+254799123456";
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await post(app, gift({ phone_number: victim, client_ip: `10.0.0.${i}` }));
      codes.push(res.status);
    }
    // Three get through, then the bucket is empty.
    expect(codes.slice(0, 3)).toEqual([201, 201, 201]);
    expect(codes.slice(3)).toEqual([429, 429]);
  });

  it("tells a throttled giver how long to wait", async () => {
    const app = agent(LIVE_ENV);
    const victim = "+254799222333";
    for (let i = 0; i < 3; i++) await post(app, gift({ phone_number: victim }));
    const res = await post(app, gift({ phone_number: victim }));
    expect(res.status).toBe(429);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("counts 0722…, +254722… and 254722… as ONE number", async () => {
    // Without normalising, a harasser has three spellings of the same handset
    // and three times the allowance.
    const app = agent(LIVE_ENV);
    const spellings = ["0733444555", "+254733444555", "254733444555", "733444555"];
    const codes: number[] = [];
    for (const p of spellings) codes.push((await post(app, gift({ phone_number: p }))).status);
    expect(codes).toEqual([201, 201, 201, 429]);
  });

  it("does not let a stranger's number be throttled by FORGED requests", async () => {
    // Otherwise the fix for harassment becomes a denial of service: flood
    // garbage at someone's number and they can never give.
    const app = agent(LIVE_ENV);
    const target = "+254711888999";
    for (let i = 0; i < 6; i++) {
      const body = gift({ phone_number: target });
      const res = await post(app, body, sign(JSON.stringify(body), "not-the-secret"));
      expect(res.status).toBe(401);
    }
    // The real giver's allowance is untouched.
    expect((await post(app, gift({ phone_number: target }))).status).toBe(201);
  });

  it("lets a congregation behind one IP give in the same few minutes", async () => {
    // Church Wi-Fi and Safaricom CGNAT put many real people on one address; an
    // IP bucket sized like the phone bucket would 429 the fourth person to give
    // after an offering is announced.
    const app = agent(LIVE_ENV);
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) {
      codes.push((await post(app, gift({ phone_number: `+2547120000${i}0`, client_ip: "41.90.64.7" }))).status);
    }
    expect(codes.every((c) => c === 201)).toBe(true);
  });
});

describe("website giving — idempotency", () => {
  it("a retry with the same key returns the first transaction, not a second push", async () => {
    // The website retries on timeout, and a visitor who sees no confirmation
    // presses Give again. Neither may become two STK pushes and two debits.
    const app = fresh();
    const body = gift();
    const first = await post(app, body);
    expect(first.status).toBe(201);
    const second = await post(app, body);
    expect(second.status).toBe(201);
    expect(second.body.transaction_id).toBe(first.body.transaction_id);
    expect(second.body.reused).toBe(true);

    const { rows } = await testPool().query(`SELECT count(*)::int AS n FROM transactions`);
    expect(rows[0].n).toBe(1);
  });
});

describe("website giving — the ledger", () => {
  it("writes a memberless row that names the giver", async () => {
    const res = await post(fresh(), gift({ giver_name: "Amina Wanjiru", giver_email: "amina@example.com" }));
    expect(res.status).toBe(201);
    const { rows } = await testPool().query(
      `SELECT user_id, source, giver_name, giver_phone, giver_email, status, amount_minor
         FROM transactions WHERE transaction_id = $1`,
      [res.body.transaction_id],
    );
    expect(rows[0].user_id).toBeNull();
    expect(rows[0].source).toBe("website");
    expect(rows[0].giver_name).toBe("Amina Wanjiru");
    expect(rows[0].giver_phone).toBe("+254722000111");
    expect(rows[0].giver_email).toBe("amina@example.com");
    expect(rows[0].status).toBe("processing");
    expect(Number(rows[0].amount_minor)).toBe(50_00);
  });

  it("an anonymous gift is allowed — a name is optional, a number is not", async () => {
    const body = gift();
    delete body.giver_name;
    const res = await post(fresh(), body);
    expect(res.status).toBe(201);
    const { rows } = await testPool().query(`SELECT giver_name, giver_phone FROM transactions WHERE transaction_id = $1`, [
      res.body.transaction_id,
    ]);
    expect(rows[0].giver_name).toBeNull();
    expect(rows[0].giver_phone).toBe("+254722000111");
  });

  it("settles through the SAME callback and posts the SAME balanced double entry", async () => {
    // This is the point of the whole design: a website gift is a normal line in
    // the ledger, not a parallel system the treasurer reconciles by hand.
    const app = fresh();
    const res = await post(app, gift({ fund: "tithe", amount_minor: 250_00 }));
    expect(res.status).toBe(201);

    const callback = JSON.stringify({
      event_id: "evt-web-1",
      ref: res.body.provider_ref,
      status: "succeeded",
      receipt: "SJ12ABC345",
    });
    const cb = await app
      .post("/v1/webhooks/mobilemoney/mpesa")
      .set("content-type", "application/json")
      .set("x-mm-signature", createHmac("sha256", MM_SECRET).update(callback).digest("hex"))
      .send(callback);
    expect(cb.status).toBe(200);

    const txn = await testPool().query(`SELECT status, settled_at FROM transactions WHERE transaction_id = $1`, [
      res.body.transaction_id,
    ]);
    expect(txn.rows[0].status).toBe("succeeded");
    expect(txn.rows[0].settled_at).not.toBeNull();

    const ledger = await testPool().query(
      `SELECT account, side, amount_minor FROM ledger_entries WHERE transaction_id = $1 ORDER BY side`,
      [res.body.transaction_id],
    );
    expect(ledger.rows).toHaveLength(2);
    const credit = ledger.rows.find((r) => r.side === "credit");
    const debit = ledger.rows.find((r) => r.side === "debit");
    expect(credit.account).toBe("fund:tithe");
    expect(debit.account).toBe("cash:mpesa");
    // Balanced: the whole reason for double entry.
    expect(Number(credit.amount_minor)).toBe(Number(debit.amount_minor));
    expect(Number(credit.amount_minor)).toBe(250_00);
  });

  it("settling a memberless gift does not crash the receipt worker", async () => {
    // `notifications` rows are keyed to a user_id, so a stranger cannot be
    // scheduled one. What must NOT happen is the outbox job throwing and
    // poisoning the queue for everyone else's receipts.
    const app = fresh();
    const res = await post(app, gift());
    const callback = JSON.stringify({ event_id: "evt-web-2", ref: res.body.provider_ref, status: "succeeded" });
    await app
      .post("/v1/webhooks/mobilemoney/mpesa")
      .set("content-type", "application/json")
      .set("x-mm-signature", createHmac("sha256", MM_SECRET).update(callback).digest("hex"))
      .send(callback);

    const outbox = await testPool().query(`SELECT topic, payload FROM outbox WHERE topic = 'giving.receipt'`);
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0].payload.user_id).toBeNull();
  });

  it("records the gift in the audit trail with no actor", async () => {
    const res = await post(fresh(), gift());
    const { rows } = await testPool().query(
      `SELECT actor_id, action, metadata FROM audit_log WHERE entity_id = $1`,
      [res.body.transaction_id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_id).toBeNull(); // nobody signed in did this
    expect(rows[0].action).toBe("giving.website_intent_created");
    expect(rows[0].metadata.giver_phone).toBe("+254722000111");
  });

  it("is reconcilable by the number that paid", async () => {
    // "Someone rang about a gift from 0722…" is the first question a treasurer
    // asks about a website gift, and the only handle they have.
    const app = fresh();
    await post(app, gift({ phone_number: "+254722000111", amount_minor: 100_00 }));
    const { rows } = await testPool().query(
      `SELECT amount_minor FROM transactions WHERE giver_phone = $1`,
      ["+254722000111"],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount_minor)).toBe(100_00);
  });
});

describe("website giving — the public funds list", () => {
  it("is readable with no session at all", async () => {
    const res = await fresh().get("/v1/giving/funds");
    expect(res.status).toBe(200);
    expect(res.body.funds.map((f: { code: string }) => f.code)).toContain("offering");
    expect(res.body.currency).toBe("KES");
  });

  it("hides funds the church has retired", async () => {
    await testPool().query(`UPDATE funds SET is_active = FALSE WHERE code = 'mission'`);
    const res = await fresh().get("/v1/giving/funds");
    expect(res.body.funds.map((f: { code: string }) => f.code)).not.toContain("mission");
  });

  it("says which providers actually work, so the page can be honest", async () => {
    const withMpesa = await agent(LIVE_ENV).get("/v1/giving/funds");
    expect(withMpesa.body.providers.find((p: { key: string }) => p.key === "mpesa").enabled).toBe(true);
    const without = await agent({ WEBSITE_GIVING_WEBHOOK_SECRET: SECRET }).get("/v1/giving/funds");
    expect(without.body.providers.find((p: { key: string }) => p.key === "mpesa").enabled).toBe(false);
  });

  it("carries fund names but nothing about the church's money", async () => {
    const res = await fresh().get("/v1/giving/funds");
    const keys = Object.keys(res.body.funds[0]).sort();
    expect(keys).toEqual(["code", "name"]);
  });
});

describe("website giving — a second app does not inherit the first app's env", () => {
  it("a configured app and an unconfigured one disagree, as they must", async () => {
    // The module-level-singleton bug: registering onto a shared Router means the
    // FIRST app's closures serve every later app, so this test would report a
    // configured 201 from an app built with no secret.
    const configured = makeApp(LIVE_ENV);
    const unconfigured = makeApp({ MPESA_CALLBACK_SECRET: MM_SECRET });
    expect((await post(supertest(configured), gift())).status).toBe(201);
    expect((await post(supertest(unconfigured), gift())).status).toBe(503);
  });
});
