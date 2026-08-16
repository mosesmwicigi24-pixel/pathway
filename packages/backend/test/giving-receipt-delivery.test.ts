// Giving receipts, end to end (§1.5/§3): the outbox's `giving.receipt` handler
// enriches {transaction_id, user_id} into a real, renderable payload (amount
// formatted from integer minor units + ISO currency, fund, congregation), and
// the email actually reaches the mailer — closing the bug where
// buildDispatchProvider() had no email provider at all, so every receipt was
// written to a log line and discarded while the giver received nothing.
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { testEnv } from "./helpers/app.js";
import type { AppContext } from "../src/http/context.js";
import { buildOutboxHandlers } from "../src/workers/handlers.js";
import { NotificationWorker } from "../src/workers/notificationWorker.js";
import { EmailDispatchProvider } from "../src/workers/dispatch.js";
import type { EmailMessage, EmailProvider } from "../src/modules/identity/email.js";

class FakeEmailProvider implements EmailProvider {
  readonly sent: EmailMessage[] = [];
  async send(msg: EmailMessage): Promise<void> {
    this.sent.push(msg);
  }
}

const ctx = (): AppContext =>
  ({ env: testEnv(), db: { primary: testPool(), replica: testPool() } }) as AppContext;

async function createSettledGift(
  userId: string,
  opts: { amountMinor?: number; currency?: string; fundCode?: string } = {},
): Promise<string> {
  const fund = await testPool().query<{ fund_id: string }>(
    `SELECT fund_id FROM funds WHERE code = $1`,
    [opts.fundCode ?? "tithe"],
  );
  const { rows } = await testPool().query<{ transaction_id: string }>(
    `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, idempotency_key, settled_at, receipt_code)
     VALUES ($1,$2,$3,$4,'succeeded',$5, now(), $6)
     RETURNING transaction_id`,
    [
      userId,
      fund.rows[0]!.fund_id,
      opts.amountMinor ?? 150000,
      opts.currency ?? "KES",
      randomUUID(),
      "UG3J29U3OL",
    ],
  );
  return rows[0]!.transaction_id;
}

/** Force the (quiet-hours-adjusted) scheduled_for into the past so
 *  dispatchDue() picks the row up regardless of what time-of-day the suite
 *  happens to run — the quiet-hours behaviour itself is covered elsewhere
 *  (notification-prefs.test.ts); these tests are about the delivery pipeline. */
async function forceDueNow(userId: string): Promise<void> {
  await testPool().query(
    `UPDATE notifications SET scheduled_for = now() - interval '1 minute' WHERE user_id = $1`,
    [userId],
  );
}

describe("giving receipt delivery (bug: receipts were silently discarded, never sent)", () => {
  let cong: string;

  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation("Nuru Place Test Branch");
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("the giving.receipt handler enriches the outbox payload into a schedulable, renderable email notification", async () => {
    const user = (
      await createUser({ congregationId: cong, email: "ada@example.com", fullName: "Ada Achieng" })
    ).user_id;
    const txId = await createSettledGift(user, { amountMinor: 150000, currency: "KES" });

    const handler = buildOutboxHandlers(ctx()).get("giving.receipt")!;
    await handler({ transaction_id: txId, user_id: user });

    const { rows } = await testPool().query(
      `SELECT channel, template, payload FROM notifications WHERE user_id = $1`,
      [user],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe("email");
    expect(rows[0].template).toBe("giving_receipt");
    expect(rows[0].payload).toMatchObject({
      amount_minor: 150000, // integer minor units — never a float
      currency: "KES",
      fund: "Tithe",
      member_name: "Ada Achieng",
      congregation: "Nuru Place Test Branch",
      receipt_code: "UG3J29U3OL",
    });
  });

  it("end-to-end: a receipt scheduled on the email channel actually reaches the mailer, amount formatted correctly", async () => {
    const user = (
      await createUser({ congregationId: cong, email: "ada@example.com", fullName: "Ada Achieng" })
    ).user_id;
    const txId = await createSettledGift(user, { amountMinor: 250000, currency: "KES" });

    await buildOutboxHandlers(ctx()).get("giving.receipt")!({
      transaction_id: txId,
      user_id: user,
    });
    await forceDueNow(user);

    const fake = new FakeEmailProvider();
    const worker = new NotificationWorker(testPool(), new EmailDispatchProvider(fake, true));
    const res = await worker.dispatchDue();

    expect(res.sent).toBe(1);
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]!.to).toBe("ada@example.com");
    expect(fake.sent[0]!.text).toContain("2,500.00"); // 250000 minor units → KSh 2,500.00
    expect(fake.sent[0]!.text).toContain("Tithe");

    const row = await testPool().query(`SELECT status FROM notifications WHERE user_id=$1`, [user]);
    expect(row.rows[0]!.status).toBe("sent");
  });

  it("end-to-end: an unconfigured mailer marks the receipt FAILED — it can never again look like success", async () => {
    const user = (await createUser({ congregationId: cong, email: "ada@example.com" })).user_id;
    const txId = await createSettledGift(user);

    await buildOutboxHandlers(ctx()).get("giving.receipt")!({
      transaction_id: txId,
      user_id: user,
    });
    await forceDueNow(user);

    const fake = new FakeEmailProvider();
    const worker = new NotificationWorker(testPool(), new EmailDispatchProvider(fake, false)); // SMTP_HOST unset
    const res = await worker.dispatchDue();

    expect(res.failed).toBe(1);
    expect(res.sent).toBe(0);
    expect(fake.sent).toHaveLength(0); // never even attempted

    const row = await testPool().query(`SELECT status FROM notifications WHERE user_id=$1`, [user]);
    expect(row.rows[0]!.status).toBe("failed");
  });

  it("a vanished transaction (e.g. deleted between enqueue and drain) is an idempotent no-op, not a crash", async () => {
    const user = (await createUser({ congregationId: cong })).user_id;
    const handler = buildOutboxHandlers(ctx()).get("giving.receipt")!;

    await expect(handler({ transaction_id: randomUUID(), user_id: user })).resolves.toBeUndefined();

    const { rows } = await testPool().query(
      `SELECT count(*)::int n FROM notifications WHERE user_id=$1`,
      [user],
    );
    expect(rows[0]!.n).toBe(0);
  });
});
