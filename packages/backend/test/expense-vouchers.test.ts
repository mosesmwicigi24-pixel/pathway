// Expenses for departments, and the payment voucher (owner, 2026-10-31):
//   · an expense can be booked to a department and to one of its approved
//     needs; a need implies its department; a pending / rejected need, a need
//     of another department and an archived department are refused;
//   · moving an expense to another department drops the old department's need;
//   · every expense carries a gapless PV-YYYY-NNNNN voucher number, issued when
//     it is recorded, kept when it is voided; the list filters by department,
//     need and voucher number; the CSV carries all three;
//   · GET …/voucher.pdf returns a real PDF for any status (finance:view);
//   · a need's finance row shows what was spent against it (approved only) and
//     what waits for approval; the finance config lists the departments.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import supertest from "supertest";
import type { Express } from "express";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { makeApp, bearer } from "./helpers/app.js";
import { nairobiDate } from "../src/modules/financial/partnerStatementMath.js";
import { amountInWords, numberInWords } from "../src/modules/financial/voucherPdf.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Who { id: string; role: "Instructor" | "SuperAdmin" | "Admin" }
let app: Express;
let cong: string;
let manager: Who; let approver: Who; let viewer: Who;
let worship: string; let youth: string; let archived: string;
let cameras: string; let pendingNeed: string; let youthNeed: string;

const today = (): string => nairobiDate(new Date());
const year = (): number => Number(today().slice(0, 4));
const q = (text: string, params: unknown[] = []) => testPool().query(text, params);
const auth = (who: Who): string => bearer({ sub: who.id, role: who.role, cong });
const post = (who: Who, path: string, body: unknown = {}) => supertest(app).post(`/v1${path}`).set("Authorization", auth(who)).send(body as object);
const patch = (who: Who, path: string, body: unknown = {}) => supertest(app).patch(`/v1${path}`).set("Authorization", auth(who)).send(body as object);
const get = (who: Who, path: string) => supertest(app).get(`/v1${path}`).set("Authorization", auth(who));

async function person(role: Who["role"], name: string, ...perms: string[]): Promise<Who> {
  const u = await createUser({ congregationId: cong, role, fullName: name, email: `${name.toLowerCase().replace(/\W+/g, ".")}@vouchers.test` });
  for (const p of perms) {
    const [m, c] = p.split(":");
    await q(`INSERT INTO rbac_user_permissions (user_id, module_id, capability) VALUES ($1, $2, $3)`, [u.user_id, m, c]);
  }
  return { id: u.user_id, role };
}
const dept = async (name: string, status = "active"): Promise<string> =>
  (await q(`INSERT INTO departments (congregation_id, name, fund_code, status) VALUES ($1, $2, 'general', $3) RETURNING department_id`, [cong, name, status])).rows[0].department_id;
const need = async (departmentId: string, title: string, status: string, target = 6_000_000): Promise<string> =>
  (await q(
    `INSERT INTO department_needs (department_id, submitted_by, title, why, target_minor, currency, status)
     VALUES ($1, $2, $3, 'For the work of the department', $4, 'KES', $5) RETURNING need_id`,
    [departmentId, manager.id, title, target, status],
  )).rows[0].need_id;

const expense = (over: Record<string, unknown> = {}) => ({
  fund: "general", category: "worship-media", payee: "Joe Blessing", description: "Camera stands",
  amount_minor: 2_160_000, currency: "KES", spent_on: today(), channel: "mpesa",
  reference: "UJVJ205LTV Confirmed. Ksh21,000.00 sent to ROBEEZ ELECTRONICS for account 33073 on 31/10/26 at 4:10 PM. Transaction cost, Ksh600.00.",
  ...over,
});

beforeAll(() => { app = makeApp() as unknown as Express; });
afterAll(async () => { await closeTestPool(); });
beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  manager = await person("Instructor", "Mona Manager", "finance:view", "finance:manage");
  approver = await person("Instructor", "Abel Approver", "finance:view", "finance:approve");
  viewer = await person("Instructor", "Vera Viewer", "finance:view");
  worship = await dept("Worship & media");
  youth = await dept("Youth");
  archived = await dept("Old choir", "archived");
  cameras = await need(worship, "Camera kit", "approved");
  pendingNeed = await need(worship, "New mixer", "pending");
  youthNeed = await need(youth, "Camp tents", "approved");
});

describe("amounts in words", () => {
  it("reads figures the way a voucher must", () => {
    expect(numberInWords(21_600)).toBe("twenty-one thousand six hundred");
    expect(numberInWords(1_000_005)).toBe("one million five");
    expect(amountInWords(2_160_000, "KES")).toBe("Twenty-one thousand six hundred Kenya shillings only");
    expect(amountInWords(1_050, "KES")).toBe("Ten Kenya shillings and fifty cents only");
    expect(amountInWords(1_999, "USD")).toBe("Nineteen US dollars and ninety-nine cents only");
  });
});

describe("expenses for departments", () => {
  it("records against a department and an approved need; a need implies its department; the voucher number is issued", async () => {
    const a = await post(manager, "/admin/finance/expenses", expense({ department_id: worship, need_id: cameras }));
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body.voucher_no).toBe(`PV-${year()}-00001`);
    expect(a.body.department).toEqual({ department_id: worship, name: "Worship & media" });
    expect(a.body.need).toMatchObject({ need_id: cameras, title: "Camera kit", status: "approved", target_minor: 6_000_000, currency: "KES" });
    // The whole M-Pesa message fits as the reference.
    expect(a.body.reference).toMatch(/^UJVJ205LTV Confirmed/);

    const b = await post(manager, "/admin/finance/expenses", expense({ need_id: youthNeed, payee: "Tent hire" }));
    expect(b.status).toBe(201);
    expect(b.body.department.department_id).toBe(youth);
    expect(b.body.voucher_no).toBe(`PV-${year()}-00002`);

    const none = await post(manager, "/admin/finance/expenses", expense({ payee: "Kenya Power", category: "utilities" }));
    expect(none.status).toBe(201);
    expect(none.body.department).toBeNull();
    expect(none.body.need).toBeNull();
  });

  it("refuses a pending need, a need of another department, an archived department and unknown ids", async () => {
    const pending = await post(manager, "/admin/finance/expenses", expense({ need_id: pendingNeed }));
    expect(pending.status).toBe(422);
    expect(pending.body.error.message).toMatch(/pending/);
    const crossed = await post(manager, "/admin/finance/expenses", expense({ department_id: youth, need_id: cameras }));
    expect(crossed.status).toBe(422);
    expect(crossed.body.error.message).toMatch(/another department/);
    const old = await post(manager, "/admin/finance/expenses", expense({ department_id: archived }));
    expect(old.status).toBe(422);
    expect(old.body.error.message).toMatch(/archived/);
    const ghost = await post(manager, "/admin/finance/expenses", expense({ department_id: "00000000-0000-4000-8000-000000000000" }));
    expect(ghost.status).toBe(422);
    // A refused record gives its voucher number back: the next one is still 00001.
    const ok = await post(manager, "/admin/finance/expenses", expense());
    expect(ok.body.voucher_no).toBe(`PV-${year()}-00001`);
  });

  it("editing: another department drops the old need; setting a need sets its department; null clears", async () => {
    const e = (await post(manager, "/admin/finance/expenses", expense({ need_id: cameras }))).body;
    const moved = await patch(manager, `/admin/finance/expenses/${e.expense_id}`, { department_id: youth });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.department.department_id).toBe(youth);
    expect(moved.body.need).toBeNull();
    const needed = await patch(manager, `/admin/finance/expenses/${e.expense_id}`, { need_id: youthNeed });
    expect(needed.body.need.need_id).toBe(youthNeed);
    const cleared = await patch(manager, `/admin/finance/expenses/${e.expense_id}`, { department_id: null, need_id: null });
    expect(cleared.body.department).toBeNull();
    expect(cleared.body.need).toBeNull();
    expect(cleared.body.voucher_no).toBe(e.voucher_no);
  });

  it("lists by department, need and voucher number; the CSV carries all three", async () => {
    const a = (await post(manager, "/admin/finance/expenses", expense({ need_id: cameras }))).body;
    await post(manager, "/admin/finance/expenses", expense({ department_id: youth, payee: "Snacks" }));
    await post(manager, "/admin/finance/expenses", expense({ payee: "Kenya Power", category: "utilities" }));
    const byDept = (await get(viewer, `/admin/finance/expenses?department=${worship}`)).body;
    expect(byDept.data.map((x: any) => x.expense_id)).toEqual([a.expense_id]);
    const byNeed = (await get(viewer, `/admin/finance/expenses?need=${cameras}`)).body;
    expect(byNeed.data).toHaveLength(1);
    const byVoucher = (await get(viewer, `/admin/finance/expenses?q=${a.voucher_no}`)).body;
    expect(byVoucher.data.map((x: any) => x.voucher_no)).toEqual([a.voucher_no]);

    await q(`INSERT INTO rbac_user_permissions (user_id, module_id, capability) VALUES ($1, 'finance', 'export')`, [viewer.id]);
    const csv = await get(viewer, "/admin/finance/expenses.csv");
    expect(csv.status).toBe(200);
    const [header, ...rows] = String(csv.text).trim().split(/\r?\n/);
    expect(header!.split(",").slice(-3)).toEqual(["voucher_no", "department", "need"]);
    expect(rows.some((r) => r.includes(a.voucher_no) && r.includes("Worship & media") && r.includes("Camera kit"))).toBe(true);
  });
});

describe("the payment voucher", () => {
  it("is a PDF for a recorded, an approved and a void expense; finance:view may print it", async () => {
    const e = (await post(manager, "/admin/finance/expenses", expense({ need_id: cameras }))).body;
    const pdf = async (): Promise<supertest.Response> =>
      get(viewer, `/admin/finance/expenses/${e.expense_id}/voucher.pdf`).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    const recorded = await pdf();
    expect(recorded.status).toBe(200);
    expect(recorded.headers["content-type"]).toBe("application/pdf");
    expect(recorded.headers["content-disposition"]).toBe(`attachment; filename="${e.voucher_no}.pdf"`);
    expect(recorded.headers["cache-control"]).toBe("private, no-store");
    expect((recorded.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
    expect((recorded.body as Buffer).length).toBeGreaterThan(5_000);

    expect((await post(approver, `/admin/finance/expenses/${e.expense_id}/approve`)).status).toBe(200);
    expect((await pdf()).status).toBe(200);
    expect((await post(manager, `/admin/finance/expenses/${e.expense_id}/void`, { reason: "Entered twice" })).status).toBe(200);
    const voided = await pdf();
    expect(voided.status).toBe(200);
    // A void expense keeps its number.
    expect((await get(viewer, `/admin/finance/expenses/${e.expense_id}`)).body.voucher_no).toBe(e.voucher_no);
  });

  it("is refused without finance:view, and 404s an unknown expense", async () => {
    const nobody = await person("Instructor", "Nora Nobody");
    const e = (await post(manager, "/admin/finance/expenses", expense())).body;
    expect((await get(nobody, `/admin/finance/expenses/${e.expense_id}/voucher.pdf`)).status).toBe(403);
    expect((await get(viewer, "/admin/finance/expenses/00000000-0000-4000-8000-000000000000/voucher.pdf")).status).toBe(404);
  });
});

describe("needs and config", () => {
  it("a need shows what was spent (approved) and what waits; the department filter narrows the list", async () => {
    const a = (await post(manager, "/admin/finance/expenses", expense({ need_id: cameras, amount_minor: 2_000_000 }))).body;
    await post(approver, `/admin/finance/expenses/${a.expense_id}/approve`);
    await post(manager, "/admin/finance/expenses", expense({ need_id: cameras, amount_minor: 500_000 }));
    const voided = (await post(manager, "/admin/finance/expenses", expense({ need_id: cameras, amount_minor: 99_000 }))).body;
    await post(manager, `/admin/finance/expenses/${voided.expense_id}/void`, { reason: "Wrong need" });

    const r = (await get(viewer, `/admin/finance/needs?status=approved&department_id=${worship}`)).body;
    expect(r.data.map((n: any) => n.need_id)).toEqual([cameras]);
    expect(r.data[0]).toMatchObject({ spent_minor: 2_000_000, awaiting_minor: 500_000, expenses_count: 2 });
    expect(r.totals[0]).toMatchObject({ currency: "KES", spent_minor: 2_000_000 });
  });

  it("the finance config lists the active departments with their fund", async () => {
    const c = (await get(viewer, "/admin/finance/config")).body;
    expect(c.departments.map((d: any) => d.name)).toEqual(["Worship & media", "Youth"]);
    expect(c.departments[0]).toEqual({ department_id: worship, name: "Worship & media", fund_code: "general" });
  });
});
