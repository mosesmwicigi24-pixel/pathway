// Dev-only: seed a realistic giving history for the demo member (student1@dev.local)
// so the mobile Give screen shows "repeat last gift", recent giving, a populated
// Statement + tappable Receipts (with a balanced ledger trail). Mirrors
// FinancialService.settle() exactly for succeeded gifts: debit cash:{provider},
// credit fund:{code}. Idempotent on idempotency_key (re-run safe). NOT for prod.
//   DATABASE_URL=postgres://nuru@localhost:5432/nuru node scripts/seed-giving-demo.mjs
import "dotenv/config";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required"); process.exit(1); }
const pool = new pg.Pool({ connectionString: url });

const EMAIL = process.env.SEED_MEMBER_EMAIL || "student1@dev.local";

// One row per gift. amount is KSh (major); stored ×100 as minor units.
// provider 'stripe' surfaces as method "card" on the client.
const GIFTS = [
  { key: "seed-give-01", date: "2026-06-24", fund: "tithe",        provider: "mpesa",  ksh: 2000, status: "succeeded", ref: "RKL5F8Q2P1" },
  { key: "seed-give-02", date: "2026-06-08", fund: "offering",     provider: "mpesa",  ksh: 500,  status: "succeeded", ref: "RJH2A9X0M4" },
  { key: "seed-give-03", date: "2026-05-19", fund: "mission",      provider: "stripe", ksh: 5000, status: "succeeded", ref: "pi_seed_mission5k" },
  { key: "seed-give-04", date: "2026-05-04", fund: "tithe",        provider: "airtel", ksh: 2000, status: "succeeded", ref: "ART7729KDX" },
  { key: "seed-give-05", date: "2026-04-14", fund: "discipleship", provider: "mpesa",  ksh: 1000, status: "succeeded", ref: "RGP1180QWE" },
  { key: "seed-give-06", date: "2026-03-30", fund: "gift",         provider: "mpesa",  ksh: 3000, status: "succeeded", ref: "RDD9931LMN" },
  { key: "seed-give-07", date: "2026-06-29", fund: "offering",     provider: "mpesa",  ksh: 1000, status: "processing", ref: null },
];

const client = await pool.connect();
try {
  const { rows: users } = await client.query(
    "SELECT user_id, full_name FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL LIMIT 1",
    [EMAIL],
  );
  if (!users[0]) { console.error(`Member ${EMAIL} not found — run a member seed first.`); process.exit(1); }
  const userId = users[0].user_id;

  const { rows: fundRows } = await client.query("SELECT fund_id, code FROM funds WHERE is_active");
  const fundByCode = new Map(fundRows.map((f) => [f.code, f.fund_id]));

  await client.query("BEGIN");

  // Idempotent reset: drop any prior seeded gifts (+ their ledger) so re-runs are clean.
  const keys = GIFTS.map((g) => g.key);
  await client.query(
    `DELETE FROM ledger_entries WHERE transaction_id IN
       (SELECT transaction_id FROM transactions WHERE idempotency_key = ANY($1))`,
    [keys],
  );
  await client.query("DELETE FROM transactions WHERE idempotency_key = ANY($1)", [keys]);

  let seeded = 0;
  for (const g of GIFTS) {
    const fundId = fundByCode.get(g.fund);
    if (!fundId) { console.warn(`  skip ${g.key}: fund '${g.fund}' not found`); continue; }
    const minor = g.ksh * 100;
    const succeeded = g.status === "succeeded";
    const when = `${g.date}T09:30:00Z`;
    const isCard = g.provider === "stripe";

    const { rows: txnRows } = await client.query(
      `INSERT INTO transactions
         (user_id, fund_id, amount_minor, currency, status, provider, provider_ref, stripe_payment_intent, idempotency_key, created_at, settled_at)
       VALUES ($1, $2, $3, 'KES', $4, $5, $6, $7, $8, $9, $10)
       RETURNING transaction_id`,
      [
        userId, fundId, minor, g.status, g.provider,
        isCard ? null : g.ref,          // provider_ref for mobile money
        isCard ? g.ref : null,          // stripe_payment_intent for card
        g.key, when, succeeded ? when : null,
      ],
    );
    const txnId = txnRows[0].transaction_id;

    if (succeeded) {
      // Balanced double-entry, identical to settle(): debit cash:{provider}, credit fund:{code}.
      await client.query(
        `INSERT INTO ledger_entries (transaction_id, account, side, amount_minor, currency)
         VALUES ($1, $2, 'debit', $3, 'KES'), ($1, $4, 'credit', $3, 'KES')`,
        [txnId, `cash:${g.provider}`, minor, `fund:${g.fund}`],
      );
    }
    seeded++;
  }

  await client.query("COMMIT");
  const total = GIFTS.filter((g) => g.status === "succeeded").reduce((s, g) => s + g.ksh, 0);
  console.log(`Seeded ${seeded} gifts for ${users[0].full_name} (${EMAIL}) — KSh ${total.toLocaleString()} settled.`);
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  client.release();
  await pool.end();
}
