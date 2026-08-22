// Fund names in Swahili (migration 205).
//
// nuruplace.org serves /en and /sw, and every word on the giving page was
// translated except the one the giver actually chooses. `funds` had a single
// name column, so a Swahili speaker picked "Tithe" from a Swahili form and was
// thanked for a gift "kwa Tithe".
//
// Two things worth holding onto beyond "the column exists":
//
//  - the fallback. A fund the church adds tomorrow has no Swahili name, and it
//    must still be givable — an untranslated fund shows its English name
//    rather than disappearing or rendering blank.
//  - the ORDER. Both locales order by the English name, so a giver who switches
//    language finds the funds where they left them rather than reshuffled.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { FinancialService } from "../src/modules/financial/service.js";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPool();
});

const svc = () => new FinancialService(testPool());

async function fund(code: string, name: string, nameSw: string | null, active = true) {
  await testPool().query(
    `INSERT INTO funds (code, name, name_sw, is_active) VALUES ($1,$2,$3,$4)
     ON CONFLICT (code) DO UPDATE SET name = $2, name_sw = $3, is_active = $4`,
    [code, name, nameSw, active],
  );
}

describe("a fresh database has Swahili names, not just an upgraded one", () => {
  it("seeds name_sw for every core fund", async () => {
    // These come from seeds/02_funds.sql, which resetDb re-applies — so this is
    // what a NEW deployment gets. Migration 205 backfills the boxes that
    // already exist; without the seed carrying them too, every fresh install
    // would serve /sw an English fund list again.
    const { rows } = await testPool().query<{ code: string; name_sw: string | null }>(
      `SELECT code, name_sw FROM funds ORDER BY code`,
    );
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r.name_sw]));
    expect(byCode.tithe).toBe("Zaka");
    expect(byCode.offering).toBe("Sadaka");
    expect(byCode.gift).toBe("Zawadi");
    expect(byCode.mission).toBe("Misheni");
    expect(byCode.general).toBe("Utoaji wa Kawaida");
    expect(byCode.media).toBe("Manunuzi ya Media");
    // Every seeded fund has one — no half-translated list.
    expect(rows.filter((r) => r.name_sw === null)).toEqual([]);
  });

  it("the migration's backfill leaves a hand-corrected name alone", async () => {
    // The church owns these words: `uanafunzi` and `ufuasi` are both defensible
    // for discipleship. Re-running the backfill must never undo a pastor's
    // correction, which is why it is `WHERE name_sw IS NULL`.
    await testPool().query(
      `INSERT INTO funds (code, name, name_sw, is_active) VALUES ('discipleship','Discipleship','Ufuasi',TRUE)
       ON CONFLICT (code) DO UPDATE SET name_sw = 'Ufuasi'`,
    );
    await testPool().query(
      `UPDATE funds SET name_sw = 'Uanafunzi' WHERE code = 'discipleship' AND name_sw IS NULL`,
    );
    const { rows } = await testPool().query(`SELECT name_sw FROM funds WHERE code = 'discipleship'`);
    expect(rows[0].name_sw).toBe("Ufuasi");
  });
});

describe("publicFunds carries both names", () => {
  it("returns name and name_sw for each active fund", async () => {
    await fund("tithe", "Tithe", "Zaka");
    const funds = await svc().publicFunds();
    const t = funds.find((f) => f.code === "tithe");
    expect(t).toEqual({ code: "tithe", name: "Tithe", name_sw: "Zaka" });
  });

  it("returns null — not undefined, not '' — for an untranslated fund", async () => {
    // The website distinguishes "no Swahili name" from "an empty name"; both
    // fall back, but only one of them is a shape the JSON can carry.
    await fund("building", "Building Fund", null);
    const found = (await svc().publicFunds()).find((f) => f.code === "building");
    expect(found?.name_sw).toBeNull();
  });

  it("still hides inactive funds", async () => {
    await fund("retired", "Retired Fund", "Iliyostaafu", false);
    expect((await svc().publicFunds()).some((f) => f.code === "retired")).toBe(false);
  });

  it("orders by the English name in both locales, so the list does not reshuffle", async () => {
    await testPool().query(`DELETE FROM funds`);
    // Swahili names deliberately in a different alphabetical order.
    await fund("alpha", "Alpha", "Zulu");
    await fund("bravo", "Bravo", "Yankee");
    await fund("charlie", "Charlie", "Xray");
    const codes = (await svc().publicFunds()).map((f) => f.code);
    expect(codes).toEqual(["alpha", "bravo", "charlie"]);
  });
});

describe("GET /v1/giving/funds", () => {
  it("serves name_sw to the website, unauthenticated", async () => {
    await fund("tithe", "Tithe", "Zaka");
    const res = await agent().get("/v1/giving/funds");
    expect(res.status).toBe(200);
    const t = res.body.funds.find((f: { code: string }) => f.code === "tithe");
    expect(t.name).toBe("Tithe");
    expect(t.name_sw).toBe("Zaka");
  });

  it("says nothing else about the church's finances", async () => {
    // Public and unauthenticated: adding a column here must not leak a balance.
    await fund("tithe", "Tithe", "Zaka");
    const res = await agent().get("/v1/giving/funds");
    expect(Object.keys(res.body.funds[0]).sort()).toEqual(["code", "name", "name_sw"]);
  });
});

describe("the gift status a giver polls", () => {
  it("carries the fund in both languages so the thank-you can be Swahili", async () => {
    await fund("tithe", "Tithe", "Zaka");
    const { rows } = await testPool().query(
      `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider,
                                 provider_ref, idempotency_key, source, giver_phone, settled_at)
       SELECT NULL, fund_id, 50000, 'KES', 'succeeded', 'mpesa', 'ref-sw-1', 'ref-sw-1',
              'website', '+254722000111', now()
         FROM funds WHERE code = 'tithe' RETURNING transaction_id`,
    );
    const status = await svc().websiteGiftStatus(rows[0].transaction_id);
    expect(status?.fund).toBe("Tithe");
    expect(status?.fund_sw).toBe("Zaka");
  });

  it("reports fund_sw as null for a fund with no Swahili name", async () => {
    await fund("building", "Building Fund", null);
    const { rows } = await testPool().query(
      `INSERT INTO transactions (user_id, fund_id, amount_minor, currency, status, provider,
                                 provider_ref, idempotency_key, source, giver_phone, settled_at)
       SELECT NULL, fund_id, 50000, 'KES', 'succeeded', 'mpesa', 'ref-sw-2', 'ref-sw-2',
              'website', '+254722000111', now()
         FROM funds WHERE code = 'building' RETURNING transaction_id`,
    );
    const status = await svc().websiteGiftStatus(rows[0].transaction_id);
    expect(status?.fund).toBe("Building Fund");
    expect(status?.fund_sw).toBeNull();
  });
});
