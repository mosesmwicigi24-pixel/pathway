// SMS announcements, and the guard in front of them.
//
// This is the first channel that costs the church real money per message, and
// the composer has been showing SMS as "awaiting provider" since it was
// written. Two things had to change together: bind the provider, and stop the
// portal from lying about whether it is bound.
//
// The guard exists because "send to everyone" is a decision worth seeing a
// number for BEFORE you make it. The number that matters is not the audience
// size — a member with no phone costs nothing and receives nothing — so `reach`
// counts who can genuinely be reached on each channel.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";

const AT_ENV = {
  AFRICASTALKING_API_KEY: "k",
  AFRICASTALKING_USERNAME: "u",
  AFRICASTALKING_SENDER_ID: "NURU",
};

let cong: string;
let adminTok: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  const admin = await createUser({ congregationId: cong, role: "Admin", email: "admin@dev.local" });
  adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
});
afterAll(async () => {
  await closeTestPool();
});

/** A member in the announcement's congregation, optionally without a phone. */
async function memberWith(phone: string | null, email: string) {
  const u = await createUser({ congregationId: cong, email });
  await testPool().query(`UPDATE users SET phone_number = $2 WHERE user_id = $1`, [u.user_id, phone]);
  return u.user_id as string;
}

async function announcement(app: ReturnType<typeof agent>, channels: string[]) {
  const res = await app
    .post("/v1/admin/announcements")
    .set("authorization", adminTok)
    .send({ title: "Sunday service", body: "Join us at 9.", channels, audience: { kind: "all" } });
  expect(res.status).toBeLessThan(300);
  return res.body.announcement_id as string;
}

describe("does the portal know whether SMS can send?", () => {
  it("reports SMS unavailable when no provider is bound", async () => {
    const res = await agent().get("/v1/admin/announcements/channels").set("authorization", adminTok);
    expect(res.status).toBe(200);
    const sms = res.body.channels.find((c: { key: string }) => c.key === "sms");
    expect(sms.available).toBe(false);
    expect(sms.note).toMatch(/awaiting provider/);
  });

  it("reports SMS available once Africa's Talking is configured", async () => {
    // The hardcoded `available: false` would have stayed on screen forever.
    const res = await agent(AT_ENV).get("/v1/admin/announcements/channels").set("authorization", adminTok);
    const sms = res.body.channels.find((c: { key: string }) => c.key === "sms");
    expect(sms.available).toBe(true);
    // And says the thing an admin needs to know before choosing it.
    expect(sms.note).toMatch(/costs the church/);
  });

  it("still tells the truth about WhatsApp, which has no provider", async () => {
    const res = await agent(AT_ENV).get("/v1/admin/announcements/channels").set("authorization", adminTok);
    const wa = res.body.channels.find((c: { key: string }) => c.key === "whatsapp");
    expect(wa.available).toBe(false);
  });
});

describe("how many people would this actually text?", () => {
  it("counts who can be reached per channel, not the audience size", async () => {
    // Three members: two with phones, one without. The SMS figure must be 2.
    await memberWith("+254722000111", "a@dev.local");
    await memberWith("+254733000222", "b@dev.local");
    await memberWith(null, "c@dev.local");

    const app = agent(AT_ENV);
    const id = await announcement(app, ["sms"]);
    const res = await app.get(`/v1/admin/announcements/${id}/reach`).set("authorization", adminTok);

    expect(res.status).toBe(200);
    // 3 members + the admin fixture, all in this congregation.
    expect(res.body.total).toBe(4);
    // 3, not 2: createUser gives every fixture a default phone number, so the
    // admin counts too. The one member whose number was explicitly nulled is
    // the only unreachable one. (My first expectation here was wrong and the
    // code was right — worth recording, since the whole point of this figure
    // is that it must match reality rather than the audience size.)
    expect(res.body.sms).toBe(3);
    // Named rather than left to subtraction — "1 of these has no number on
    // file" is the sentence an admin needs before pressing send.
    expect(res.body.sms_unreachable).toBe(1);
  });

  it("is read-only — asking the cost must never send anything", async () => {
    await memberWith("+254722000111", "a@dev.local");
    const app = agent(AT_ENV);
    const id = await announcement(app, ["sms"]);
    await app.get(`/v1/admin/announcements/${id}/reach`).set("authorization", adminTok);
    await app.get(`/v1/admin/announcements/${id}/reach`).set("authorization", adminTok);

    const { rows } = await testPool().query(
      `SELECT count(*)::int AS n FROM announcement_deliveries WHERE announcement_id = $1`,
      [id],
    );
    expect(rows[0].n).toBe(0);
    const ann = await testPool().query(`SELECT status FROM announcements WHERE announcement_id = $1`, [id]);
    expect(ann.rows[0].status).not.toBe("sent");
  });

  it("404s an announcement that does not exist", async () => {
    const res = await agent(AT_ENV)
      .get("/v1/admin/announcements/00000000-0000-4000-8000-000000000000/reach")
      .set("authorization", adminTok);
    expect(res.status).toBe(404);
  });

  it("needs admin — a member cannot ask how big the roster is", async () => {
    const m = await createUser({ congregationId: cong, email: "nosy@dev.local" });
    const tok = bearer({ sub: m.user_id, role: "Student", cong });
    const app = agent(AT_ENV);
    const id = await announcement(app, ["sms"]);
    const res = await app.get(`/v1/admin/announcements/${id}/reach`).set("authorization", tok);
    expect(res.status).toBe(403);
  });
});

describe("sending on the SMS channel", () => {
  it("records suppressed(no_provider) when nothing is bound, rather than a fake delivery", async () => {
    await memberWith("+254722000111", "a@dev.local");
    const app = agent(); // no Africa's Talking
    const id = await announcement(app, ["sms"]);
    const res = await app.post(`/v1/admin/announcements/${id}/send`).set("authorization", adminTok);
    expect(res.status).toBeLessThan(300);

    const { rows } = await testPool().query(
      `SELECT status, suppress_reason FROM announcement_deliveries
        WHERE announcement_id = $1 AND channel = 'sms'`,
      [id],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === "suppressed")).toBe(true);
    expect(rows[0].suppress_reason).toBe("no_provider");
  });
});
