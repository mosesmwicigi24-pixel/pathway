// Finance → Transactions: the Succeeded and Failed reports (owner ask,
// 2026-10-13). Both are the register filtered by status; what makes them
// reports is on the page:
//   · totals carry attempted_minor, so a Failed report shows the money that
//     did not arrive (amount_minor stays Σ succeeded — 0 there);
//   · status=failed adds failure_reasons: one row per reason in the member's
//     words (unknown codes read as "declined"), per currency, most frequent first;
//   · every failed row says whether that giver gave again within 7 days —
//     the member by user_id, a gift without a member by phone; same currency only;
//   · the CSV carries the same "gave_again" column.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { agent, bearer } from "./helpers/app.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const q = (text: string, params: unknown[] = []) => testPool().query(text, params);
const eat = (ymd: string, hm = "12:00"): string => new Date(`${ymd}T${hm}:00+03:00`).toISOString();

let adminTok: string;
const ids: Record<string, string> = {};

async function gift(o: {
  user?: string | null; amount: number; currency?: string; status: "succeeded" | "failed" | "processing";
  at: string; failure?: string | null; giverPhone?: string | null; source?: "app" | "website";
}): Promise<string> {
  const fund = (await q(`SELECT fund_id FROM funds WHERE code = 'tithe'`)).rows[0].fund_id;
  const row = await q(
    `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider, provider_ref, idempotency_key,
                               created_at, settled_at, source, giver_name, giver_phone, failure_code)
     VALUES ($1, $2, $3, $4, $5::txn_status, 'mpesa', $6, $7, $8, $9, $10, $11, $12, $13) RETURNING transaction_id`,
    [o.user ?? null, fund, o.amount, o.currency ?? "KES", o.status, `ws_${randomUUID()}`, randomUUID(), o.at,
      o.status === "succeeded" ? o.at : null, o.source ?? (o.user ? "app" : "website"),
      o.user ? null : "Walk-in visitor", o.giverPhone ?? null, o.failure ?? null],
  );
  const id: string = row.rows[0].transaction_id;
  if (o.status === "succeeded") {
    await q(
      `INSERT INTO ledger_entries (transaction_id, account, side, amount_minor, currency, created_at)
       VALUES ($1, 'cash:mpesa', 'debit', $2, $3, $4), ($1, 'fund:tithe', 'credit', $2, $3, $4)`,
      [id, o.amount, o.currency ?? "KES", o.at],
    );
  }
  return id;
}

const get = (path: string) => agent().get(`/v1${path}`).set("Authorization", adminTok);
const OCT = "from=2025-10-01&to=2025-10-31";

beforeAll(async () => {
  await resetDb();
  const cong = await createCongregation();
  const mk = async (name: string, phone: string, role: "Student" | "Admin" = "Student") =>
    (await createUser({ congregationId: cong, fullName: name, phone, role })).user_id;
  const admin = await mk("Office Admin", "+254700000001", "Admin");
  adminTok = bearer({ sub: admin, role: "Admin", cong } as never);
  const amina = await mk("Amina Wanjiru", "+254711000001");
  const baraka = await mk("Baraka Otieno", "+254711000002");
  const chen = await mk("Chen Li", "+254711000003");

  // Amina: cancelled the prompt, then gave the same amount an hour later.
  ids.aminaFail = await gift({ user: amina, amount: 50000, status: "failed", failure: "cancelled", at: eat("2025-10-05", "09:00") });
  ids.aminaOk = await gift({ user: amina, amount: 50000, status: "succeeded", at: eat("2025-10-05", "10:00") });
  // Baraka: not enough in the account, and never gave again.
  ids.barakaFail = await gift({ user: baraka, amount: 200000, status: "failed", failure: "insufficient_funds", at: eat("2025-10-06") });
  // Chen: cancelled, gave again only 9 days later (outside the 7-day window),
  // and an unknown provider code (reads as "declined"), then a USD gift — a
  // different currency is not "gave again" for a KES failure.
  ids.chenFail = await gift({ user: chen, amount: 10000, status: "failed", failure: "cancelled", at: eat("2025-10-07") });
  ids.chenLate = await gift({ user: chen, amount: 10000, status: "succeeded", at: eat("2025-10-16") });
  ids.chenOdd = await gift({ user: chen, amount: 3000, status: "failed", failure: "weird_new_code", at: eat("2025-10-20") });
  ids.chenUsd = await gift({ user: chen, amount: 500, currency: "USD", status: "succeeded", at: eat("2025-10-21") });
  // A website gift without a member: timed out, then the same phone gave.
  ids.webFail = await gift({ amount: 7000, status: "failed", failure: "expired", giverPhone: "+254722000009", at: eat("2025-10-10") });
  ids.webOk = await gift({ amount: 7000, status: "succeeded", giverPhone: "+254722000009", at: eat("2025-10-10", "13:00") });
  // Still in flight: neither report's.
  ids.pending = await gift({ user: baraka, amount: 1000, status: "processing", at: eat("2025-10-25") });
});

afterAll(async () => {
  await closeTestPool();
});

describe("transactions — the Succeeded and Failed reports", () => {
  it("Succeeded: only money received; totals carry the attempted amount too (equal here); no failure_reasons", async () => {
    const r = (await get(`/admin/finance/transactions?${OCT}&status=succeeded&limit=200`)).body;
    expect(r.data.map((x: any) => x.transaction_id).sort()).toEqual([ids.aminaOk, ids.chenLate, ids.chenUsd, ids.webOk].sort());
    expect(r.totals).toEqual([
      { currency: "KES", amount_minor: 67000, attempted_minor: 67000, count: 3 },
      { currency: "USD", amount_minor: 500, attempted_minor: 500, count: 1 },
    ]);
    expect(r.failure_reasons).toBeUndefined();
    expect(r.data.every((x: any) => x.gave_after === null)).toBe(true);
  });

  it("Failed: totals show what did not arrive (attempted), received stays 0", async () => {
    const r = (await get(`/admin/finance/transactions?${OCT}&status=failed&limit=200`)).body;
    expect(r.data.map((x: any) => x.transaction_id).sort()).toEqual([ids.aminaFail, ids.barakaFail, ids.chenFail, ids.chenOdd, ids.webFail].sort());
    expect(r.totals).toEqual([{ currency: "KES", amount_minor: 0, attempted_minor: 270000, count: 5 }]);
  });

  it("Failed: every row says whether that giver gave again within 7 days (member by id, memberless by phone, same currency)", async () => {
    const r = (await get(`/admin/finance/transactions?${OCT}&status=failed&limit=200`)).body;
    const gave = Object.fromEntries(r.data.map((x: any) => [x.transaction_id, x.gave_after]));
    expect(gave[ids.aminaFail]).toBe(true);
    expect(gave[ids.barakaFail]).toBe(false);
    expect(gave[ids.chenFail]).toBe(false); // 9 days later is outside the window
    expect(gave[ids.chenOdd]).toBe(false); // the later gift is USD
    expect(gave[ids.webFail]).toBe(true);
    // Each failed row carries the member's words for why.
    expect(r.data.find((x: any) => x.transaction_id === ids.barakaFail).failure.reason).toMatch(/enough in the M-Pesa account/);
  });

  it("Failed: failure_reasons — member's words, unknown codes fold into declined, most frequent first", async () => {
    const r = (await get(`/admin/finance/transactions?${OCT}&status=failed&limit=200`)).body;
    expect(r.failure_reasons.map((x: any) => [x.code, x.count, x.gave_after])).toEqual([
      ["cancelled", 2, 1],
      ["declined", 1, 0],
      ["expired", 1, 1],
      ["insufficient_funds", 1, 0],
    ]);
    const cancelled = r.failure_reasons[0];
    expect(cancelled.reason).toBe("The M-Pesa prompt was cancelled.");
    expect(cancelled.by_currency).toEqual([{ currency: "KES", amount_minor: 60000, count: 2 }]);
    expect(typeof cancelled.hint).toBe("string");
    expect(cancelled.retryable).toBe(false);
  });

  it("Failed: reasons follow the other filters (a search narrows them)", async () => {
    const r = (await get(`/admin/finance/transactions?${OCT}&status=failed&q=Baraka&limit=200`)).body;
    expect(r.failure_reasons.map((x: any) => x.code)).toEqual(["insufficient_funds"]);
    expect(r.totals).toEqual([{ currency: "KES", amount_minor: 0, attempted_minor: 200000, count: 1 }]);
  });

  it("CSV of the Failed report carries gave_again", async () => {
    const res = await get(`/admin/finance/transactions.csv?${OCT}&status=failed`);
    expect(res.status).toBe(200);
    const lines = String(res.text).trim().split(/\r?\n/);
    const header = lines[0]!.split(",");
    const col = header.indexOf("gave_again");
    expect(col).toBe(header.length - 1);
    const values = lines.slice(1).map((l) => l.split(",").at(-1));
    expect(values.sort()).toEqual(["no", "no", "no", "yes", "yes"]);
  });
});
