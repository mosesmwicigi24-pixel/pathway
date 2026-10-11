// Paybill (C2B) with the server NOT configured for it. In its own file because
// the financial module's router is module-level: the first app a file builds
// decides the env every later app in that file sees.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { agent, bearer } from "./helpers/app.js";

const SHORTCODE = "4043755";
let adminTok: string;

beforeAll(async () => {
  await resetDb();
  const cong = await createCongregation("Paybill-off Branch");
  const admin = (await createUser({ congregationId: cong, fullName: "The Treasurer", phone: "+254700000001", role: "Admin" })).user_id;
  await testPool().query(`INSERT INTO rbac_user_permissions (user_id, module_id, capability) VALUES ($1, 'finance', 'view'), ($1, 'finance', 'manage')`, [admin]);
  adminTok = bearer({ sub: admin, role: "Admin", cong } as never);
});

afterAll(async () => {
  await closeTestPool();
});

describe("paybill confirmations with no MPESA_C2B_SECRET on the server", () => {
  const app = () => agent({ MPESA_SHORTCODE: SHORTCODE, MPESA_CALLBACK_SECRET: "test-mm-secret" });

  it("every confirmation and validation is a 404, whatever token is tried", async () => {
    const body = JSON.stringify({ TransID: "NOSECRET", BusinessShortCode: SHORTCODE, TransAmount: "100" });
    await app().post("/v1/webhooks/mpesa/c2b/any-token-at-all/confirmation").set("content-type", "application/json").send(body).expect(404);
    await app().post("/v1/webhooks/mpesa/c2b//confirmation").set("content-type", "application/json").send(body).expect(404);
    await app().post("/v1/webhooks/mpesa/c2b/any-token-at-all/validation").set("content-type", "application/json").send(body).expect(404);
    const { rows } = await testPool().query(`SELECT 1 FROM mpesa_c2b_events WHERE trans_id = 'NOSECRET'`);
    expect(rows.length).toBe(0);
  });

  it("the config read says paybill is off", async () => {
    const res = await app().get("/v1/admin/finance/config").set("authorization", adminTok).expect(200);
    expect(res.body.paybill.enabled).toBe(false);
    expect(res.body.paybill.last_registered_at).toBeNull();
  });

  it("registering the URLs is refused until the server has its settings", async () => {
    const res = await app().post("/v1/admin/finance/mpesa/c2b/register").set("authorization", adminTok).expect(422);
    expect(res.body.error.code).toBe("UNPROCESSABLE");
  });
});
