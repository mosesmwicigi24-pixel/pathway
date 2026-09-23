// Departments (docs/PARTNERS_PROGRAMME.md §4): browse with gift fit, ask to
// serve, leader posts, needs that become exact giving targets.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { DepartmentsService } from "../src/modules/departments/service.js";
import { NotificationService } from "../src/modules/notifications/service.js";
import { FinancialService } from "../src/modules/financial/service.js";
import { PartnersService } from "../src/modules/financial/partners.js";
import type { PaymentGateway } from "../src/modules/financial/gateway.js";

class FakeGateway implements PaymentGateway {
  async createIntent(): Promise<{ id: string; client_secret: string }> { return { id: `pi_${Math.random()}`, client_secret: "cs" }; }
  verifyWebhook(): never { throw new Error("not used"); }
}

describe("departments", () => {
  let cong: string; let admin: string; let leader: string; let member: string;
  let svc: DepartmentsService; let financial: FinancialService; let partners: PartnersService;

  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation();
    admin = (await createUser({ congregationId: cong })).user_id;
    leader = (await createUser({ congregationId: cong })).user_id;
    member = (await createUser({ congregationId: cong })).user_id;
    svc = new DepartmentsService(testPool(), new NotificationService(testPool()));
    financial = new FinancialService(testPool(), new FakeGateway());
    partners = new PartnersService(testPool(), financial);
  });
  afterAll(async () => { await closeTestPool(); });

  it("lists departments with gift fit, member counts and my status", async () => {
    const d = await svc.create(admin, cong, { name: "Worship", purpose: "Lead the church in song", leader_user_id: leader, gift_keys: ["music", "leadership"], is_open_to_join: true });
    await svc.create(admin, cong, { name: "Ushering", purpose: "Welcome everyone", gift_keys: ["hospitality"], is_open_to_join: true });
    await testPool().query(`INSERT INTO gift_assessments (user_id, scores, top_gifts) VALUES ($1, '{}', $2)`, [member, ["music", "teaching"]]);
    const list = await svc.list(member);
    expect(list.map((x) => x.name)).toEqual(["Ushering", "Worship"]);
    const worship = list.find((x) => x.department_id === d.department_id)!;
    expect(worship.fit).toBe(true);
    expect(worship.matched_gifts).toEqual(["music"]);
    expect(worship.member_count).toBe(1); // the leader
    expect(worship.my_status).toBeNull();
    expect(list.find((x) => x.name === "Ushering")!.fit).toBe(false);
  });

  it("a member asks to serve, the leader approves, and the member is on the department", async () => {
    const d = await svc.create(admin, cong, { name: "Media", purpose: "Sound and screens", leader_user_id: leader, gift_keys: [], is_open_to_join: true });
    const req = await svc.requestToServe(member, String(d.department_id));
    expect(req.status).toBe("requested");
    await expect(svc.decideServe(member, String(d.department_id), member, "approve")).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    const pending = await svc.serveRequests("requested");
    expect(pending.map((r) => r.user_id)).toEqual([member]);
    const decided = await svc.decideServe(leader, String(d.department_id), member, "approve");
    expect(decided.status).toBe("active");
    const mine = await svc.myDepartments(member);
    expect(mine.map((x) => x.department_id)).toEqual([d.department_id]);
    const notif = await testPool().query(`SELECT template FROM notifications WHERE user_id = $1 ORDER BY scheduled_for`, [member]);
    expect(notif.rows.map((r: { template: string }) => r.template)).toContain("serve_request_approved");
    // a closed department refuses new requests
    await svc.update(admin, String(d.department_id), { is_open_to_join: false });
    const other = (await createUser({ congregationId: cong })).user_id;
    await expect(svc.requestToServe(other, String(d.department_id))).rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });

  it("only the leader (or the office) posts; active members are told", async () => {
    const d = await svc.create(admin, cong, { name: "Children", purpose: "Sunday school", leader_user_id: leader, gift_keys: [], is_open_to_join: true });
    await svc.requestToServe(member, String(d.department_id));
    await svc.decideServe(leader, String(d.department_id), member, "approve");
    await expect(svc.createPost(member, String(d.department_id), { body: "hello" })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    await svc.createPost(leader, String(d.department_id), { body: "Rehearsal moves to 4 pm this Saturday." });
    await svc.createPost(admin, String(d.department_id), { body: "From the office: thank you, team." }, { office: true });
    const detail = await svc.get(member, String(d.department_id));
    expect((detail.posts as unknown[]).length).toBe(2);
    const notif = await testPool().query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND template = 'department_post'`, [member]);
    expect(notif.rows[0].n).toBe(2);
  });

  it("a need is pending until the office approves; then gifts and pledges count toward it exactly", async () => {
    const d = await svc.create(admin, cong, { name: "Building", purpose: "The roof", leader_user_id: leader, gift_keys: [], fund_code: "offering", is_open_to_join: true });
    const need = await svc.submitNeed(leader, String(d.department_id), { title: "Roof sheets", why: "The rains are coming and the hall leaks.", target_minor: 200_000, currency: "KES" });
    expect(need.status).toBe("pending");
    // members cannot give to a pending need
    await expect(financial.createGivingIntent(member, { fund: "offering", amount_minor: 10_000, currency: "KES", method: "card", need_id: String(need.need_id) } as never)).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    // members don't see it yet; the leader does
    expect(((await svc.get(member, String(d.department_id))).needs as unknown[]).length).toBe(0);
    expect(((await svc.get(leader, String(d.department_id))).needs as unknown[]).length).toBe(1);
    await svc.decideNeed(admin, String(need.need_id), "approve");
    // a direct gift and a pledge-attributed gift both count; an unrelated offering does not
    const a = await financial.createGivingIntent(member, { fund: "offering", amount_minor: 50_000, currency: "KES", method: "card", need_id: String(need.need_id) } as never);
    const pledge = await partners.createPledge(member, { shape: "total", target_minor: 100_000, currency: "KES", due_on: "2099-01-01", need_id: String(need.need_id), reminders_enabled: true });
    const b = await financial.createGivingIntent(member, { fund: "offering", amount_minor: 30_000, currency: "KES", method: "card", pledge_id: String(pledge.pledge_id) } as never);
    const c = await financial.createGivingIntent(member, { fund: "offering", amount_minor: 999_000, currency: "KES", method: "card" } as never);
    await testPool().query(`UPDATE transactions SET status = 'succeeded', settled_at = now() WHERE transaction_id = ANY($1::uuid[])`, [[a.transaction_id, b.transaction_id, c.transaction_id]]);
    const detail = await svc.get(member, String(d.department_id));
    const n = (detail.needs as Array<{ raised_minor: number; percent: number; reached: boolean }>)[0]!;
    expect(n.raised_minor).toBe(80_000);
    expect(n.percent).toBe(40);
    expect(n.reached).toBe(false);
    await expect(svc.decideNeed(admin, String(need.need_id), "approve")).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    await svc.decideNeed(admin, String(need.need_id), "close");
    expect((await svc.needs("closed")).length).toBe(1);
  });
});
