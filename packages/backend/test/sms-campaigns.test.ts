// The SMS center: compose → audience → send → what ACTUALLY happened.
//
// Everything here guards one premise, bought at full price on 2026-08-22:
// accepted != sent != delivered. The submit response is a claim; the
// delivery-report webhook is the verdict; and the report must never promote
// one into the other. The rest is money-safety around a button that texts an
// entire congregation: an atomic send flip, named suppressions, bounded
// reasoned retries, and a webhook that can write exactly two facts onto rows
// we created and nothing else.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser, createEvent } from "./helpers/factories.js";
import { SmsCampaignService, isRetryableReason, type SmsBulkSender } from "../src/modules/sms/service.js";
import { drainBackgroundWork } from "../src/db/background.js";

let cong: string;
let adminId: string;
let adminTok: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  const admin = await createUser({ congregationId: cong, role: "Admin", email: "admin@dev.local" });
  adminId = admin.user_id;
  adminTok = bearer({ sub: adminId, role: "Admin", cong });
});
afterAll(async () => {
  await closeTestPool();
});

/** A member with a phone and (by default) SMS opted IN — campaigns are the
 *  broadcast traffic the toggle governs, so tests opt people in explicitly. */
async function member(name: string, phone: string | null, optIn = true): Promise<string> {
  const u = await createUser({
    congregationId: cong,
    fullName: name,
    email: `${name.replace(/\s+/g, ".").toLowerCase()}@dev.local`,
  });
  await testPool().query(`UPDATE users SET phone_number = $2, full_name = $3 WHERE user_id = $1`, [
    u.user_id,
    phone,
    name,
  ]);
  await testPool().query(
    `INSERT INTO notification_preferences (user_id, sms_enabled) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET sms_enabled = $2`,
    [u.user_id, optIn],
  );
  return u.user_id;
}

/** A scriptable Africa's Talking: per-number verdicts, calls recorded. */
class FakeBulk implements SmsBulkSender {
  readonly batches: Array<{ numbers: string[]; body: string }> = [];
  verdict: (n: string) => { statusCode: number; status: string } = () => ({ statusCode: 101, status: "Success" });
  balanceValue: string | null = "KES 1234.50";
  private seq = 0;
  async sendBatch(numbers: string[], body: string) {
    this.batches.push({ numbers, body });
    return numbers.map((n) => {
      const v = this.verdict(n);
      this.seq += 1;
      return {
        number: n,
        statusCode: v.statusCode,
        status: v.status,
        messageId: v.statusCode < 400 ? `ATXid_${this.seq}` : null,
        cost: v.statusCode < 400 ? "KES 0.8000" : null,
      };
    });
  }
  async balance() {
    return this.balanceValue;
  }
}

const svc = (bulk?: SmsBulkSender) => new SmsCampaignService(testPool(), bulk);

async function draft(s: SmsCampaignService, body = "Karibu service tomorrow at 9am. - TGNM") {
  const { campaign_id } = await s.createDraft(cong, adminId, {
    title: "Sunday reminder",
    body,
    audience: { kind: "all" },
  });
  return campaign_id;
}

async function recipientsOf(id: string) {
  const { rows } = await testPool().query(
    `SELECT full_name, phone, status, suppress_reason, failure_reason, at_message_id, attempts
       FROM sms_campaign_recipients WHERE campaign_id = $1 ORDER BY full_name`,
    [id],
  );
  return rows;
}

describe("preview — the truth before the money", () => {
  it("counts sendable and names every suppression", async () => {
    await member("Amina Wanjiru", "+254722000111");
    await member("Brian Otieno", "+254722000222", false); // opted out
    await member("Cynthia Njeri", null); // no phone
    await member("Duplicate Dan", "+254722000111"); // same number as Amina

    const p = await svc(new FakeBulk()).preview(cong, { kind: "all" }, "Hello church");
    expect(p.total).toBe(5); // + the admin fixture (default phone, no opt-in row)
    expect(p.sendable).toBe(1); // Amina alone: admin has no prefs row -> opted out
    expect(p.suppressed.opted_out).toBe(2); // Brian + the admin
    expect(p.suppressed.no_phone).toBe(1);
    expect(p.suppressed.duplicate_phone).toBe(1);
    expect(p.balance).toBe("KES 1234.50");
  });

  it("prices in segments, not vibes", async () => {
    await member("Amina Wanjiru", "+254722000111");
    const s = svc(new FakeBulk());
    const one = await s.preview(cong, { kind: "all" }, "short");
    expect(one.segments).toBe(1);
    const three = await s.preview(cong, { kind: "all" }, "x".repeat(400));
    expect(three.segments).toBe(3);
    expect(three.message_units).toBe(3); // 1 sendable person x 3 segments
  });

  it("refuses to measure a non-GSM-7 body as GSM-7", async () => {
    const p = await svc(new FakeBulk()).preview(cong, { kind: "all" }, "hello — world");
    expect(p.septets).toBeNull();
    expect(p.segments).toBeGreaterThan(0); // UCS-2 segments still counted honestly
  });
});

describe("audiences", () => {
  it("a named group reaches exactly its members", async () => {
    const a = await member("Amina Wanjiru", "+254722000111");
    await member("Brian Otieno", "+254722000222");
    const s = svc(new FakeBulk());
    const { group_id } = await s.createGroup(cong, adminId, "Ushering team");
    await s.addGroupMembers(cong, group_id, [a]);
    const p = await s.preview(cong, { kind: "group", group_id }, "hi");
    expect(p.total).toBe(1);
  });

  it("a group cannot smuggle in another congregation's member", async () => {
    const other = await createCongregation("Other Branch");
    const outsider = await createUser({ congregationId: other, email: "out@dev.local" });
    const s = svc(new FakeBulk());
    const { group_id } = await s.createGroup(cong, adminId, "Ushering team");
    const res = await s.addGroupMembers(cong, group_id, [outsider.user_id]);
    expect(res.added).toBe(0);
  });

  it("event_rsvps reaches those GOING, not the maybes", async () => {
    const going = await member("Amina Wanjiru", "+254722000111");
    const maybe = await member("Brian Otieno", "+254722000222");
    const ev = await createEvent(cong);
    await testPool().query(
      `INSERT INTO event_rsvps (event_id, user_id, status) VALUES ($1, $2, 'going'), ($1, $3, 'maybe')`,
      [ev.event_id, going, maybe],
    );
    const p = await svc(new FakeBulk()).preview(cong, { kind: "event_rsvps", event_id: ev.event_id }, "hi");
    expect(p.total).toBe(1);
  });

  it("duplicate group names 409 instead of silently forking", async () => {
    const s = svc(new FakeBulk());
    await s.createGroup(cong, adminId, "Choir");
    await expect(s.createGroup(cong, adminId, "Choir")).rejects.toThrow(/already exists/);
  });
});

describe("send — one click, one blast", () => {
  it("freezes the audience with suppressions named, and queues the submit", async () => {
    await member("Amina Wanjiru", "+254722000111");
    await member("Brian Otieno", "+254722000222", false);
    const s = svc(new FakeBulk());
    const id = await draft(s);
    const out = await s.send(cong, adminId, id);
    expect(out.queued).toBe(1);
    // Brian (opted out) and the admin fixture (no prefs row -> opted out by
    // default). My first expectation said 3; the code was right. Recorded, as
    // with the reach test — this figure exists to match reality, not my count.
    expect(out.suppressed).toBe(2);

    const rows = await recipientsOf(id);
    const brian = rows.find((r) => r.full_name === "Brian Otieno");
    expect(brian.status).toBe("suppressed");
    expect(brian.suppress_reason).toBe("opted_out");

    const { rows: ob } = await testPool().query(`SELECT 1 FROM outbox WHERE topic = 'sms.campaign_submit'`);
    expect(ob).toHaveLength(1);
  });

  it("a double-click is a 409, never a second blast", async () => {
    await member("Amina Wanjiru", "+254722000111");
    const s = svc(new FakeBulk());
    const id = await draft(s);
    await s.send(cong, adminId, id);
    await expect(s.send(cong, adminId, id)).rejects.toThrow(/already been sent/);
  });

  it("refuses outright when SMS is not configured", async () => {
    await member("Amina Wanjiru", "+254722000111");
    const s = svc(undefined);
    const id = await draft(s);
    await expect(s.send(cong, adminId, id)).rejects.toThrow(/not configured/);
  });

  it("another congregation's admin gets NOT_FOUND, not a blast", async () => {
    await member("Amina Wanjiru", "+254722000111");
    const s = svc(new FakeBulk());
    const id = await draft(s);
    const other = await createCongregation("Other Branch");
    await expect(s.send(other, adminId, id)).rejects.toThrow(/not found/i);
  });
});

describe("submit — Africa's Talking's per-recipient verdict, recorded", () => {
  it("accepted numbers become 'submitted' with their message id; refused ones fail with the reason", async () => {
    await member("Amina Wanjiru", "+254722000111");
    await member("Brian Otieno", "+254722000333");
    const bulk = new FakeBulk();
    bulk.verdict = (n) =>
      n.endsWith("333") ? { statusCode: 406, status: "UserInBlacklist" } : { statusCode: 101, status: "Success" };
    const s = svc(bulk);
    const id = await draft(s);
    await s.send(cong, adminId, id);
    const out = await s.submit(id);
    expect(out).toEqual({ submitted: 1, failed: 1 });

    const rows = await recipientsOf(id);
    const amina = rows.find((r) => r.full_name === "Amina Wanjiru");
    expect(amina.status).toBe("submitted"); // NOT delivered — the webhook decides that
    expect(amina.at_message_id).toMatch(/^ATXid_/);
    const brian = rows.find((r) => r.full_name === "Brian Otieno");
    expect(brian.status).toBe("failed");
    expect(brian.failure_reason).toMatch(/UserInBlacklist/);

    const { rows: camp } = await testPool().query(`SELECT status, sent_at FROM sms_campaigns WHERE campaign_id = $1`, [id]);
    expect(camp[0].status).toBe("sent");
    expect(camp[0].sent_at).not.toBeNull();
  });

  it("re-running submit is a resume, not a repeat", async () => {
    await member("Amina Wanjiru", "+254722000111");
    const bulk = new FakeBulk();
    const s = svc(bulk);
    const id = await draft(s);
    await s.send(cong, adminId, id);
    await s.submit(id);
    await s.submit(id); // the outbox is at-least-once
    expect(bulk.batches.flatMap((b) => b.numbers)).toHaveLength(1);
  });

  it("a vanished provider marks rows failed(no_provider) rather than queued-forever", async () => {
    await member("Amina Wanjiru", "+254722000111");
    const s1 = svc(new FakeBulk());
    const id = await draft(s1);
    await s1.send(cong, adminId, id);
    await svc(undefined).submit(id); // redeployed without keys between send and submit
    const rows = await recipientsOf(id);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].failure_reason).toBe("no_provider");
  });
});

describe("the delivery report is the only source of 'delivered'", () => {
  async function submittedRecipient(): Promise<{ campaignId: string; atId: string }> {
    await member("Amina Wanjiru", "+254722000111");
    const bulk = new FakeBulk();
    const s = svc(bulk);
    const id = await draft(s);
    await s.send(cong, adminId, id);
    await s.submit(id);
    const rows = await recipientsOf(id);
    return { campaignId: id, atId: rows.find((r) => r.status === "submitted").at_message_id };
  }

  it("Success promotes submitted → delivered, once, idempotently", async () => {
    const { campaignId, atId } = await submittedRecipient();
    const app = agent();
    for (let i = 0; i < 2; i++) {
      const res = await app.post("/v1/webhooks/at/delivery").type("form").send({ id: atId, status: "Success" });
      expect(res.status).toBe(200);
      expect(res.body.matched).toBe(true);
    }
    const rows = await recipientsOf(campaignId);
    expect(rows.find((r) => r.at_message_id === atId).status).toBe("delivered");
  });

  it("Failed carries their reason verbatim — 'credit ran out' is answerable", async () => {
    const { campaignId, atId } = await submittedRecipient();
    await agent()
      .post("/v1/webhooks/at/delivery")
      .type("form")
      .send({ id: atId, status: "Failed", failureReason: "InsufficientCredit" });
    const row = (await recipientsOf(campaignId)).find((r) => r.at_message_id === atId);
    expect(row.status).toBe("failed");
    expect(row.failure_reason).toBe("InsufficientCredit");
  });

  it("a late Failed can never demote a delivered row", async () => {
    const { campaignId, atId } = await submittedRecipient();
    const app = agent();
    await app.post("/v1/webhooks/at/delivery").type("form").send({ id: atId, status: "Success" });
    await app.post("/v1/webhooks/at/delivery").type("form").send({ id: atId, status: "Failed", failureReason: "AbsentSubscriber" });
    const row = (await recipientsOf(campaignId)).find((r) => r.at_message_id === atId);
    expect(row.status).toBe("delivered");
  });

  it("an unknown id answers 200 matched:false — their retrier must stop, our rows must not move", async () => {
    const { campaignId } = await submittedRecipient();
    const res = await agent().post("/v1/webhooks/at/delivery").type("form").send({ id: "ATXid_never_ours", status: "Success" });
    expect(res.status).toBe(200);
    expect(res.body.matched).toBe(false);
    const rows = await recipientsOf(campaignId);
    expect(rows.every((r) => r.status !== "delivered")).toBe(true);
  });

  it("a report with no id is a 400, not a guess", async () => {
    const res = await agent().post("/v1/webhooks/at/delivery").type("form").send({ status: "Success" });
    expect(res.status).toBe(400);
  });

  it("intermediate states (Buffered) leave the row awaiting the final word", async () => {
    const { campaignId, atId } = await submittedRecipient();
    await agent().post("/v1/webhooks/at/delivery").type("form").send({ id: atId, status: "Buffered" });
    const row = (await recipientsOf(campaignId)).find((r) => r.at_message_id === atId);
    expect(row.status).toBe("submitted");
  });
});

describe("retry — bounded and reasoned", () => {
  it("requeues a credit failure, skips a blacklist, and says so", async () => {
    await member("Amina Wanjiru", "+254722000111");
    await member("Brian Otieno", "+254722000333");
    const bulk = new FakeBulk();
    const s = svc(bulk);
    const id = await draft(s);
    await s.send(cong, adminId, id);
    await s.submit(id);
    // Fail them both via delivery reports: one retryable, one terminal.
    const rows = await recipientsOf(id);
    await s.recordDeliveryReport(rows.find((r) => r.full_name === "Amina Wanjiru").at_message_id, "Failed", "InsufficientCredit");
    await s.recordDeliveryReport(rows.find((r) => r.full_name === "Brian Otieno").at_message_id, "Failed", "UserInBlacklist");

    const out = await s.retry(cong, adminId, id);
    expect(out).toEqual({ retried: 1, skipped_terminal: 1, skipped_attempts: 0 });

    await s.submit(id); // the requeued row goes out again
    const after = await recipientsOf(id);
    expect(after.find((r) => r.full_name === "Amina Wanjiru").status).toBe("submitted");
    expect(after.find((r) => r.full_name === "Amina Wanjiru").attempts).toBe(2);
    expect(after.find((r) => r.full_name === "Brian Otieno").status).toBe("failed");
  });

  it("the attempt cap holds — three strikes and it waits for a human", async () => {
    await member("Amina Wanjiru", "+254722000111");
    const s = svc(new FakeBulk());
    const id = await draft(s);
    await s.send(cong, adminId, id);
    for (let i = 0; i < 3; i++) {
      await s.submit(id);
      const row = (await recipientsOf(id))[0];
      if (row.at_message_id) await s.recordDeliveryReport(row.at_message_id, "Failed", "AbsentSubscriber");
      await testPool().query(`UPDATE sms_campaign_recipients SET at_message_id = NULL WHERE campaign_id = $1`, [id]);
      if (i < 2) await s.retry(cong, adminId, id);
    }
    const out = await s.retry(cong, adminId, id);
    expect(out.retried).toBe(0);
    expect(out.skipped_attempts).toBe(1);
  });

  it("the reason table can say no", () => {
    expect(isRetryableReason("InsufficientCredit")).toBe(true);
    expect(isRetryableReason("AbsentSubscriber")).toBe(true);
    expect(isRetryableReason(null)).toBe(true);
    expect(isRetryableReason("UserInBlacklist")).toBe(false);
    expect(isRetryableReason("InvalidPhoneNumber")).toBe(false);
  });
});

describe("the routes hold the door", () => {
  it("a member cannot list campaigns, preview, or send", async () => {
    const m = await member("Nosy Person", "+254722000999");
    const tok = bearer({ sub: m, role: "Student", cong });
    const app = agent();
    expect((await app.get("/v1/admin/sms/campaigns").set("authorization", tok)).status).toBe(403);
    expect(
      (await app.post("/v1/admin/sms/preview").set("authorization", tok).send({ audience: { kind: "all" }, body: "x" }))
        .status,
    ).toBe(403);
  });

  it("end to end through HTTP: draft → send → the worker outbox row exists", async () => {
    await member("Amina Wanjiru", "+254722000111");
    const app = agent({
      AFRICASTALKING_API_KEY: "k",
      AFRICASTALKING_USERNAME: "u",
      AFRICASTALKING_SENDER_ID: "THEGOODNEWS",
    });
    const created = await app
      .post("/v1/admin/sms/campaigns")
      .set("authorization", adminTok)
      .send({ title: "Hello", body: "Karibu Sunday service.", audience: { kind: "all" } });
    expect(created.status).toBe(201);
    const sent = await app
      .post(`/v1/admin/sms/campaigns/${created.body.campaign_id}/send`)
      .set("authorization", adminTok);
    expect(sent.status).toBe(200);
    expect(sent.body.queued).toBe(1);
    await drainBackgroundWork();
    const report = await app
      .get(`/v1/admin/sms/campaigns/${created.body.campaign_id}`)
      .set("authorization", adminTok);
    expect(report.status).toBe(200);
    expect(report.body.recipients.length).toBeGreaterThan(0);
  });
});
