// Website enquiries (migration 197): nuruplace.org's connection card, contact
// form and prayer request land where pastors can answer them.
//
// The intake has no session — authenticity is an HMAC over the raw body, the
// same trust model as the Stripe and mobile-money receivers. Most of what is
// worth testing here is therefore about refusing things: an unsigned request, a
// forged one, a replayed one, and a retry that must not become a second message
// a pastor answers twice.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createHmac } from "node:crypto";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { EnquiriesService } from "../src/modules/enquiries/service.js";

const SECRET = "shared-with-nuruplace-org";
const app = () => agent({ WEBSITE_CONTACT_WEBHOOK_SECRET: SECRET });

let cong: string, adminId: string, adminTok: string, memberTok: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  const admin = await createUser({ congregationId: cong, role: "Admin", email: "admin@dev.local" });
  adminId = admin.user_id;
  adminTok = bearer({ sub: adminId, role: "Admin", cong });
  const member = await createUser({ congregationId: cong, email: "member@dev.local" });
  memberTok = bearer({ sub: member.user_id, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

function submission(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "connection-card",
    name: "Amina Wanjiru",
    phone: "+254700000000",
    message: "I would like to visit on Sunday.",
    locale: "en",
    wantsPrayer: false,
    planningVisit: true,
    submittedAt: new Date().toISOString(),
    ...over,
  };
}

/** Sign exactly as the website does. */
function sign(body: string, secret = SECRET, atMs = Date.now()): string {
  const t = Math.floor(atMs / 1000).toString();
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

function post(body: Record<string, unknown>, header?: string) {
  const raw = JSON.stringify(body);
  const req = app()
    .post("/v1/webhooks/website-contact")
    .set("content-type", "application/json");
  if (header !== undefined) req.set("x-nuruplace-signature", header);
  return req.send(raw);
}

describe("website contact intake — signature", () => {
  it("accepts a correctly signed submission", async () => {
    const body = submission();
    const raw = JSON.stringify(body);
    const res = await post(body, sign(raw));
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(res.body.duplicate).toBe(false);
  });

  it("refuses an unsigned submission", async () => {
    const res = await post(submission());
    expect(res.status).toBe(401);
  });

  it("refuses a forged signature", async () => {
    const body = submission();
    const res = await post(body, sign(JSON.stringify(body), "wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("refuses a signature computed over a different body", async () => {
    // The attack this actually blocks: a valid signature lifted from one
    // request and reused on a modified payload.
    const original = JSON.stringify(submission());
    const tampered = submission({ message: "Buy cheap watches" });
    const res = await post(tampered, sign(original));
    expect(res.status).toBe(401);
  });

  it("refuses a replay from outside the time window", async () => {
    const body = submission();
    const stale = sign(JSON.stringify(body), SECRET, Date.now() - 20 * 60 * 1000);
    const res = await post(body, stale);
    expect(res.status).toBe(401);
  });

  it("accepts a signature from within the time window", async () => {
    const body = submission();
    const recent = sign(JSON.stringify(body), SECRET, Date.now() - 60 * 1000);
    expect((await post(body, recent)).status).toBe(200);
  });

  it("refuses a malformed signature header", async () => {
    const body = submission();
    for (const header of ["", "nonsense", "t=abc,v1=def", `v1=${"a".repeat(64)}`]) {
      expect((await post(body, header)).status).toBe(401);
    }
  });

  it("refuses everything when no secret is configured", async () => {
    // Failing closed is the point: an unauthenticated write into the pastoral
    // inbox is worse than a form that tells visitors to telephone.
    const body = submission();
    const res = await agent({ WEBSITE_CONTACT_WEBHOOK_SECRET: undefined })
      .post("/v1/webhooks/website-contact")
      .set("content-type", "application/json")
      .set("x-nuruplace-signature", sign(JSON.stringify(body)))
      .send(JSON.stringify(body));
    expect(res.status).toBe(503);
  });
});

describe("website contact intake — storage", () => {
  it("stores the enquiry with the website's kind mapped to ours", async () => {
    const body = submission({ kind: "prayer", wantsPrayer: true, locale: "sw" });
    await post(body, sign(JSON.stringify(body)));
    const { rows } = await testPool().query("SELECT * FROM website_enquiries");
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("prayer");
    expect(rows[0].locale).toBe("sw");
    expect(rows[0].wants_prayer).toBe(true);
    expect(rows[0].status).toBe("new");
    expect(rows[0].full_name).toBe("Amina Wanjiru");
  });

  it("maps the hyphenated wire kind to the underscored column", async () => {
    const body = submission({ kind: "connection-card" });
    await post(body, sign(JSON.stringify(body)));
    const { rows } = await testPool().query("SELECT kind FROM website_enquiries");
    expect(rows[0].kind).toBe("connection_card");
  });

  it("rejects a submission with neither phone nor email", async () => {
    // The whole point of an enquiry is being able to reply to it.
    const body = submission({ phone: undefined, email: undefined });
    const res = await post(body, sign(JSON.stringify(body)));
    expect(res.status).toBe(400);
    const { rows } = await testPool().query("SELECT count(*)::int AS n FROM website_enquiries");
    expect(rows[0].n).toBe(0);
  });

  it("accepts email-only", async () => {
    const body = submission({ phone: undefined, email: "amina@example.org" });
    expect((await post(body, sign(JSON.stringify(body)))).status).toBe(200);
  });
});

describe("website contact intake — idempotency (§3.6)", () => {
  it("treats a repeat with the same dedupeKey as already received", async () => {
    // The website retries on timeout, and a visitor who sees no confirmation
    // presses send again. Neither may produce a second message.
    const body = submission({ dedupeKey: "abc123" });
    const raw = JSON.stringify(body);
    const first = await post(body, sign(raw));
    const second = await post(body, sign(raw));

    expect(first.body.duplicate).toBe(false);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.enquiry_id).toBe(first.body.enquiry_id);

    const { rows } = await testPool().query("SELECT count(*)::int AS n FROM website_enquiries");
    expect(rows[0].n).toBe(1);
  });

  it("does not merge two genuinely different messages", async () => {
    const a = submission({ dedupeKey: "k-a" });
    const b = submission({ dedupeKey: "k-b", message: "A second, different message" });
    await post(a, sign(JSON.stringify(a)));
    await post(b, sign(JSON.stringify(b)));
    const { rows } = await testPool().query("SELECT count(*)::int AS n FROM website_enquiries");
    expect(rows[0].n).toBe(2);
  });

  it("a replay must not overwrite an enquiry a pastor already acknowledged", async () => {
    const body = submission({ dedupeKey: "k-ack" });
    const raw = JSON.stringify(body);
    const created = await post(body, sign(raw));
    await app()
      .post(`/v1/admin/enquiries/${created.body.enquiry_id}/ack`)
      .set("Authorization", adminTok)
      .send({ status: "acknowledged", note: "Called her, visiting Sunday" });

    await post(body, sign(raw)); // the replay

    const { rows } = await testPool().query("SELECT status, note FROM website_enquiries");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("acknowledged");
    expect(rows[0].note).toBe("Called her, visiting Sunday");
  });
});

describe("enquiry triage", () => {
  it("lists newest first for an Admin", async () => {
    for (const name of ["First", "Second", "Third"]) {
      const body = submission({ name, dedupeKey: name });
      await post(body, sign(JSON.stringify(body)));
    }
    const res = await app().get("/v1/admin/enquiries").set("Authorization", adminTok);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[0].full_name).toBe("Third");
  });

  it("refuses someone without the website permission", async () => {
    // Enquiries carry strangers' phone numbers and prayer requests. A portal
    // account is not enough; you need the website module (migration 198).
    const res = await app().get("/v1/admin/enquiries").set("Authorization", memberTok);
    expect(res.status).toBe(403);
  });

  it("allows the `website` role — the whole point of having one", async () => {
    // A communications volunteer runs the site WITHOUT being an administrator
    // of members, finance and curriculum. If this fails, the only way to let
    // someone edit the website is to make them an Admin of everything.
    const volunteer = await createUser({ congregationId: cong, email: "comms@dev.local" });
    await testPool().query(
      "INSERT INTO rbac_user_roles (user_id, role_key) VALUES ($1, 'website') ON CONFLICT DO NOTHING",
      [volunteer.user_id],
    );
    const tok = bearer({ sub: volunteer.user_id, role: "Student", cong });
    const res = await app().get("/v1/admin/enquiries").set("Authorization", tok);
    expect(res.status).toBe(200);
  });

  it("the seeded website role grants the website module and nothing else", async () => {
    // Reference data, so it lives in seeds/08_rbac.sql and is re-applied after
    // every resetDb() — NOT in a migration, which resetDb truncates away. That
    // is what this assertion is really pinning down: the role survives a reset
    // exactly as the other eleven built-ins do.
    const { rows } = await testPool().query(
      "SELECT module_id, capability FROM rbac_role_permissions WHERE role_key = 'website' ORDER BY capability",
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r: { module_id: string }) => r.module_id))).toEqual(new Set(["website"]));
    expect(rows.map((r: { capability: string }) => r.capability)).toContain("view");
    expect(rows.map((r: { capability: string }) => r.capability)).toContain("edit");
  });

  it("refuses an unauthenticated reader", async () => {
    expect((await app().get("/v1/admin/enquiries")).status).toBe(401);
  });

  it("records who picked it up, so two pastors do not both reply", async () => {
    const body = submission();
    const created = await post(body, sign(JSON.stringify(body)));
    const res = await app()
      .post(`/v1/admin/enquiries/${created.body.enquiry_id}/ack`)
      .set("Authorization", adminTok)
      .send({ status: "acknowledged" });
    expect(res.status).toBe(200);
    expect(res.body.acknowledged_by).toBe(adminId);
    expect(res.body.acknowledged_at).not.toBeNull();
  });

  it("filters by status", async () => {
    const body = submission();
    const created = await post(body, sign(JSON.stringify(body)));
    await app()
      .post(`/v1/admin/enquiries/${created.body.enquiry_id}/ack`)
      .set("Authorization", adminTok)
      .send({ status: "closed" });
    const stillNew = await app().get("/v1/admin/enquiries?status=new").set("Authorization", adminTok);
    expect(stillNew.body).toHaveLength(0);
    const closed = await app().get("/v1/admin/enquiries?status=closed").set("Authorization", adminTok);
    expect(closed.body).toHaveLength(1);
  });

  it("404s an unknown enquiry", async () => {
    const res = await app()
      .post("/v1/admin/enquiries/00000000-0000-0000-0000-000000000000/ack")
      .set("Authorization", adminTok)
      .send({});
    expect(res.status).toBe(404);
  });
});

describe("verifySignature (unit)", () => {
  const raw = '{"hello":"world"}';
  it("accepts what it signs", () => {
    expect(() => EnquiriesService.verifySignature(raw, sign(raw), SECRET)).not.toThrow();
  });
  it("rejects a signature of the right length but wrong value", () => {
    // Guards the constant-time compare: same length, so it cannot short-circuit
    // on length alone.
    expect(() => EnquiriesService.verifySignature(raw, `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}`, SECRET)).toThrow();
  });
});
