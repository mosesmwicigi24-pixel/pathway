// The receipt payload behind GET /giving/transactions/:id (owner asked
// 2026-09-25 for a better receipt in the apps): the fund's NAME beside its
// code, the pledge or department need the gift counted toward under the same
// words their cards show, the method's display label, and who gave where.
// The receipt PDF carries the same three enrichments. Every field that was
// there before is still there (additive contract — the apps are rebuilt
// against this in parallel).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { FinancialService, methodLabel } from "../src/modules/financial/service.js";
import { PartnersService } from "../src/modules/financial/partners.js";
import { DepartmentsService } from "../src/modules/departments/service.js";
import { NotificationService } from "../src/modules/notifications/service.js";
import { FakeMobileMoneyProvider } from "../src/modules/financial/providers.js";
import type { PaymentGateway } from "../src/modules/financial/gateway.js";

class FakeGateway implements PaymentGateway {
  async createIntent(): Promise<{ id: string; client_secret: string }> { return { id: `pi_${Math.random()}`, client_secret: "cs" }; }
  verifyWebhook(): never { throw new Error("not used"); }
}

interface Detail {
  transaction_id: string; amount_minor: number; currency: string; status: string;
  fund: string | null; fund_name: string | null;
  method: string; method_label: string;
  provider_ref: string | null; receipt_code: string | null; account_name: string | null;
  schedule_id: string | null; created_at: unknown; settled_at: unknown;
  pledge: { pledge_id: string; title: string } | null;
  need: { need_id: string; title: string } | null;
  member_name: string; congregation: string | null;
  ledger: { side: string; account: string; amount_minor: number; currency: string }[];
}

describe("receipt payload (GET /giving/transactions/:id) and the receipt PDF", () => {
  let cong: string; let user: string; let admin: string; let leader: string;
  let financial: FinancialService; let partners: PartnersService; let departments: DepartmentsService;

  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation("Nairobi Central");
    user = (await createUser({ congregationId: cong, fullName: "Amina Wanjiru", phone: "+254711222333" })).user_id;
    admin = (await createUser({ congregationId: cong, role: "Admin" })).user_id;
    leader = (await createUser({ congregationId: cong })).user_id;
    financial = new FinancialService(testPool(), new FakeGateway(), { mpesa: new FakeMobileMoneyProvider("mpesa"), airtel: new FakeMobileMoneyProvider("airtel") });
    partners = new PartnersService(testPool(), financial);
    departments = new DepartmentsService(testPool(), new NotificationService(testPool()));
  });
  afterAll(async () => { await closeTestPool(); });

  const give = async (input: Record<string, unknown>): Promise<string> => {
    const r = (await financial.createGivingIntent(user, { currency: "KES", ...input } as never)) as { transaction_id: string };
    return r.transaction_id;
  };
  const detail = (id: string, who = user): Promise<Detail> => financial.givingDetail(who, id) as Promise<Detail>;

  it("a plain M-Pesa gift: the fund's name beside its code, 'M-Pesa', who gave where; no pledge, no need", async () => {
    const id = await give({ fund: "general", amount_minor: 5_000, method: "mpesa" });
    const d = await detail(id);
    expect(d.fund).toBe("general");
    expect(d.fund_name).toBe("General Giving");
    expect(d.method).toBe("mpesa");
    expect(d.method_label).toBe("M-Pesa");
    expect(d.pledge).toBeNull();
    expect(d.need).toBeNull();
    expect(d.member_name).toBe("Amina Wanjiru");
    expect(d.congregation).toBe("Nairobi Central");
    // Every field the earlier shape carried is still there (additive contract).
    for (const k of ["transaction_id", "amount_minor", "currency", "status", "fund", "method", "provider_ref", "receipt_code", "account_name", "schedule_id", "created_at", "settled_at", "ledger"]) {
      expect(d, `field ${k} still present`).toHaveProperty(k);
    }
    expect(d.amount_minor).toBe(5_000);
    expect(Array.isArray(d.ledger)).toBe(true);
    // The raw join columns never leak: the apps get the shaped objects only.
    expect(d).not.toHaveProperty("pledge_id");
    expect(d).not.toHaveProperty("need_id");
    expect(d).not.toHaveProperty("need_title");
    expect(d).not.toHaveProperty("provider");
  });

  it("a card (Stripe) gift reads method 'card' and label 'Card'", async () => {
    const id = await give({ fund: "tithe", amount_minor: 7_000, method: "card" });
    const d = await detail(id);
    expect(d.method).toBe("card");
    expect(d.method_label).toBe("Card");
    expect(d.fund_name).toBe("Tithe");
  });

  it("a gift from a pledge's 'Pay now' names the pledge under its effective title — the member's own name, else the derived one", async () => {
    // Named pledge: the member's own words win.
    const named = await partners.createPledge(user, { shape: "total", target_minor: 100_000, currency: "KES", due_on: "2099-12-31", fund: "mission", title: "Roof fund", reminders_enabled: true });
    const a = await give({ fund: "offering", amount_minor: 20_000, method: "card", pledge_id: String(named.pledge_id) });
    const da = await detail(a);
    expect(da.pledge).toEqual({ pledge_id: named.pledge_id, title: "Roof fund" });
    expect(da.pledge!.title).toBe((await partners.getPledge(user, String(named.pledge_id))).title);
    // Server-authoritative fund: the gift landed in the pledge's fund, and the payload names it.
    expect(da.fund).toBe("mission");
    expect(da.fund_name).toBe("Missions");
    expect(da.need).toBeNull();

    // Unnamed pledge on a fund: the derived title is the fund's name.
    const derived = await partners.createPledge(user, { shape: "monthly", amount_minor: 10_000, currency: "KES", due_day: 5, fund: "tithe", reminders_enabled: true });
    const b = await give({ fund: "offering", amount_minor: 10_000, method: "card", pledge_id: String(derived.pledge_id) });
    const db = await detail(b);
    expect(db.pledge).toEqual({ pledge_id: derived.pledge_id, title: "Tithe" });
    expect(db.pledge!.title).toBe((await partners.getPledge(user, String(derived.pledge_id))).title);

    // The receipt PDF says so too, with the fund's NAME rather than its code.
    const pdf = (await financial.receiptPdf(user, a)).toString("latin1");
    expect(pdf).toContain("toward your Roof fund pledge");
    expect(pdf).toContain("Missions");
  });

  it("a gift to an approved department need names the need", async () => {
    const dept = await departments.create(admin, cong, { name: "Building", purpose: "The roof", leader_user_id: leader, gift_keys: [], fund_code: "general", is_open_to_join: true });
    const need = await departments.submitNeed(leader, String(dept.department_id), { title: "Roof sheets", why: "The rains are coming and the hall leaks.", target_minor: 200_000, currency: "KES" });
    await departments.decideNeed(admin, String(need.need_id), "approve");
    const id = await give({ fund: "offering", amount_minor: 50_000, method: "card", need_id: String(need.need_id) });
    const d = await detail(id);
    expect(d.need).toEqual({ need_id: need.need_id, title: "Roof sheets" });
    expect(d.pledge).toBeNull();
    // The gift landed in the department's fund (server-authoritative), named.
    expect(d.fund).toBe("general");
    expect(d.fund_name).toBe("General Giving");

    const pdf = (await financial.receiptPdf(user, id)).toString("latin1");
    expect(pdf).toContain("toward Roof sheets");
    expect(pdf).toContain("General Giving");
  });

  it("another member's transaction is NOT_FOUND, unchanged", async () => {
    const id = await give({ fund: "gift", amount_minor: 1_000, method: "card" });
    const other = (await createUser({ congregationId: cong })).user_id;
    await expect(financial.givingDetail(other, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(financial.receiptPdf(other, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("methodLabel is the one map behind the payload, the receipt and the statement", () => {
    expect(methodLabel("mpesa")).toBe("M-Pesa");
    expect(methodLabel("airtel")).toBe("Airtel Money");
    expect(methodLabel("card")).toBe("Card");
    expect(methodLabel("paypal")).toBe("PayPal");
    expect(methodLabel("manual")).toBe("Manual"); // a pledge claim the office confirmed (partners.ts)
    expect(methodLabel("someday")).toBe("someday"); // an unknown provider never renders blank
  });
});
