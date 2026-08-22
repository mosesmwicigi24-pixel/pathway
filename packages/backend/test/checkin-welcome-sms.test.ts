// "Karibu" — the text somebody gets when they check in at a service.
//
// The owner asked for two things that pull against each other: the message must
// know whether the person already has the app (and not pitch it to them if they
// do), and it must fit in 140 characters. Kenyan names and Kenyan congregation
// names are both long, so the second requirement is not free — it has to be
// MEASURED against real names, including a long one, which is exactly what the
// eye-balled version of this would have got wrong.
//
// Underneath both sits a billing detail nothing in the codebase knew about: an
// SMS is charged per SEGMENT, and one character outside the GSM-7 alphabet
// demotes the whole message to UCS-2, where a segment is 70 characters rather
// than 160. Nothing errors. The message arrives. Only the invoice knows. So the
// tests here assert the alphabet as well as the length — and the em dash that
// was already shipping in the giving receipt is the reason to.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { pino } from "pino";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { testEnv, agent } from "./helpers/app.js";
import { createCongregation, createUser, createChurchService } from "./helpers/factories.js";
import { buildOutboxHandlers } from "../src/workers/handlers.js";
import { renderCheckInWelcome, CHECK_IN_SMS_BUDGET, SmsDispatchProvider } from "../src/workers/dispatch.js";
import { FakeMessageProvider } from "../src/modules/announcements/providers.js";
import { isGsm7, gsm7Length, smsSegments, nonGsm7Characters, fitSms } from "../src/lib/sms-text.js";
import { ChurchAttendanceService, serviceScanToken } from "../src/modules/attendance/service.js";
import type { Env } from "../src/config/env.js";
import type { Principal } from "../src/http/http.js";

const log = pino({ level: "silent" });

function ctxWith(sms?: FakeMessageProvider, envOver: Partial<Env> = {}) {
  const pool = testPool();
  return {
    env: { ...testEnv(), ...envOver } as Env,
    db: { primary: pool, replica: pool },
    log,
    ...(sms ? { smsProvider: sms } : {}),
  };
}

const APP_URL = "https://pathway.nuruplace.org";

let cong: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation("Nuru Place Church");
});
afterAll(async () => {
  await closeTestPool();
});

/* ------------------------------------------------------------------ */
/* The measuring stick itself — prove it can fail before trusting it   */
/* ------------------------------------------------------------------ */

describe("what a text actually costs", () => {
  it("counts an em dash as NOT GSM-7 — the check has to be able to fail", () => {
    // If this passed for everything, every assertion below would be theatre.
    expect(isGsm7("God bless you. - The Good News Mission")).toBe(true);
    expect(isGsm7("God bless you. — The Good News Mission")).toBe(false);
    expect(nonGsm7Characters("we’re here")).toEqual(["’"]); // curly apostrophe
    expect(nonGsm7Characters("wait…")).toEqual(["…"]);
    expect(gsm7Length("—")).toBeNull();
  });

  it("charges extension-table characters double, as the carrier does", () => {
    expect(gsm7Length("abc")).toBe(3);
    expect(gsm7Length("[]")).toBe(4); // ESC + char, each
    expect(gsm7Length("€")).toBe(2);
  });

  it("one non-GSM character turns a one-segment message into two", () => {
    const ascii = "x".repeat(120);
    expect(smsSegments(ascii)).toBe(1);
    // Same visible length, one character swapped.
    expect(smsSegments(ascii.slice(0, 119) + "—")).toBe(2);
  });

  it("knows the segment boundaries in both alphabets", () => {
    expect(smsSegments("a".repeat(160))).toBe(1);
    expect(smsSegments("a".repeat(161))).toBe(2);
    expect(smsSegments("a".repeat(306))).toBe(2); // 153 × 2
    expect(smsSegments("a".repeat(307))).toBe(3);
    expect(smsSegments("é".repeat(70) + "—")).toBe(2); // UCS-2: 70 is the single-segment cap
  });

  it("fitSms picks the first variant inside the budget, not the shortest", () => {
    expect(fitSms(["aaaa", "aa", "a"], 10)).toBe("aaaa");
    expect(fitSms(["aaaa", "aa", "a"], 3)).toBe("aa");
    // A variant that is not GSM-7 is skipped rather than measured wrong.
    expect(fitSms(["—", "ok"], 10)).toBe("ok");
  });
});

/* ------------------------------------------------------------------ */
/* The copy                                                            */
/* ------------------------------------------------------------------ */

/** Real names, long ones deliberately included — this is the whole test. */
const NAMES = [
  "Joy Otieno",
  "Amina Wanjiru",
  "Peter Mwangi Kamau",
  "Chepkemboi Jerotich",
  "Nyambura-Wangeci Kariuki-Njoroge",
  "Abdirahman Mohamednur Sheikhdon",
];
const CHURCHES = [
  "Nuru Place",
  "Nuru Place Church",
  "The Good News Mission",
  "Nuru Christian Fellowship Church Nairobi",
  "Nuru Place Church - Kahawa Wendani Branch",
];

describe("the welcome message fits in 140 characters", () => {
  it("holds for every combination of a real name and a real congregation, on both branches", () => {
    let checked = 0;
    for (const member_name of NAMES) {
      for (const congregation of CHURCHES) {
        for (const has_app of [true, false]) {
          const body = renderCheckInWelcome({ member_name, congregation, has_app, app_url: APP_URL });
          expect(gsm7Length(body), `not GSM-7: ${body}`).not.toBeNull();
          expect(gsm7Length(body), `over budget (${body.length}): ${body}`).toBeLessThanOrEqual(
            CHECK_IN_SMS_BUDGET,
          );
          expect(smsSegments(body)).toBe(1);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(NAMES.length * CHURCHES.length * 2);
  });

  it("the long case really does overflow the full template — the ladder is load-bearing", () => {
    // Without this, the test above could be passing because nothing was ever
    // close to the limit, and the degradation path would be dead code.
    const name = "Nyambura-Wangeci";
    const church = "Nuru Christian Fellowship Church Nairobi";
    const naive = `Karibu ${name}! Great to see you at ${church} today. Get the Nuru Pathway app: ${APP_URL}`;
    expect(naive.length).toBeGreaterThan(CHECK_IN_SMS_BUDGET);

    const body = renderCheckInWelcome({
      member_name: "Nyambura-Wangeci Kariuki",
      congregation: church,
      has_app: false,
      app_url: APP_URL,
    });
    expect(gsm7Length(body)!).toBeLessThanOrEqual(CHECK_IN_SMS_BUDGET);
    // It dropped the congregation name, and kept the person's name whole.
    expect(body).toContain("Nyambura-Wangeci");
    expect(body).not.toContain(church);
    expect(body).toContain(APP_URL);
  });

  it("never truncates a name mid-word", () => {
    for (const member_name of NAMES) {
      for (const has_app of [true, false]) {
        const body = renderCheckInWelcome({
          member_name,
          congregation: CHURCHES[CHURCHES.length - 1],
          has_app,
          app_url: APP_URL,
        });
        const first = member_name.split(" ")[0]!;
        // Either the whole first name is there, or the greeting dropped it
        // entirely — never a fragment of it.
        if (body.includes("Karibu ")) {
          const greeted = body.slice(7, body.indexOf("!"));
          expect(greeted === first || greeted === "").toBe(true);
        }
      }
    }
  });

  it("stays inside budget even with a comically long app URL, by dropping the link", () => {
    const body = renderCheckInWelcome({
      member_name: "Amina Wanjiru",
      congregation: "Nuru Place Church",
      has_app: false,
      app_url: `https://${"a".repeat(200)}.example.org/download`,
    });
    expect(gsm7Length(body)!).toBeLessThanOrEqual(CHECK_IN_SMS_BUDGET);
    expect(body).not.toContain("aaaa");
  });
});

describe("mentioning the app, or not", () => {
  const base = { member_name: "Amina Wanjiru", congregation: "Nuru Place Church", app_url: APP_URL };

  it("does NOT mention the app to somebody who is holding it", () => {
    const body = renderCheckInWelcome({ ...base, has_app: true });
    expect(body).not.toMatch(/app/i);
    expect(body).not.toContain("Nuru Pathway");
    expect(body).not.toContain(APP_URL);
    expect(body).toContain("Amina");
  });

  it("invites somebody who has not got it, by name and with a link", () => {
    const body = renderCheckInWelcome({ ...base, has_app: false });
    expect(body).toContain("Nuru Pathway app");
    expect(body).toContain(APP_URL);
    expect(body).toContain("Amina");
  });

  it("welcomes without the pitch when there is no link configured", () => {
    const body = renderCheckInWelcome({ ...base, has_app: false, app_url: "" });
    expect(body).not.toMatch(/app/i);
    expect(body).toContain("Amina");
  });

  it("greets a person with no name on file without a hole in the sentence", () => {
    const body = renderCheckInWelcome({ member_name: null, congregation: null, has_app: true, app_url: APP_URL });
    expect(body).toBe("Karibu! Great to see you at church today. God bless you.");
    expect(gsm7Length(body)!).toBeLessThanOrEqual(CHECK_IN_SMS_BUDGET);
  });
});

describe("the giving receipt's alphabet, which was already costing double", () => {
  it("renders as one segment now that the em dash is a hyphen", async () => {
    const fake = new FakeMessageProvider("sms");
    await new SmsDispatchProvider(fake, log).send({
      channel: "sms",
      to: "+254722000111",
      template: "giving_receipt",
      payload: {
        amount_minor: 50_000,
        currency: "KES",
        fund: "Tithe",
        receipt_code: "SJ12ABC345",
        member_name: "Amina Wanjiru",
      },
    });
    const body = fake.sent[0]!.body;
    expect(isGsm7(body)).toBe(true);
    expect(smsSegments(body)).toBe(1);
    // Proof the old copy was the expensive one, not a hypothetical.
    expect(smsSegments(body.replace(" - The Good News", " — The Good News"))).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* End to end: checking in produces exactly one text                   */
/* ------------------------------------------------------------------ */

async function member(over: { name?: string; phone?: string | null; app?: boolean } = {}) {
  const u = await createUser({
    congregationId: cong,
    email: `m${Math.random().toString(36).slice(2)}@dev.local`,
    fullName: over.name ?? "Amina Wanjiru",
  });
  await testPool().query(`UPDATE users SET phone_number = $2, full_name = $3 WHERE user_id = $1`, [
    u.user_id,
    over.phone === undefined ? "+254722000111" : over.phone,
    over.name ?? "Amina Wanjiru",
  ]);
  if (over.app) {
    await testPool().query(
      `INSERT INTO push_tokens (user_id, platform, token, is_active) VALUES ($1,'android',$2,TRUE)`,
      [u.user_id, `tok-${Math.random().toString(36).slice(2)}`],
    );
  }
  return u.user_id as string;
}

function principal(userId: string): Principal {
  return { userId, role: "Student", congregationId: cong };
}

async function checkIn(userId: string, svc: { service_id: string; qr_secret: string }): Promise<void> {
  await new ChurchAttendanceService(testPool()).checkIn(principal(userId), svc.service_id, {
    client_scan_id: crypto.randomUUID(),
    scan_token: serviceScanToken(svc.qr_secret, svc.service_id),
  });
}

/** Run every queued attendance.welcome through the handler. */
async function drainWelcomes(sms?: FakeMessageProvider): Promise<number> {
  const { rows } = await testPool().query(`SELECT payload FROM outbox WHERE topic = 'attendance.welcome'`);
  const handler = buildOutboxHandlers(ctxWith(sms)).get("attendance.welcome")!;
  for (const r of rows) await handler(r.payload);
  return rows.length;
}

async function welcomeRows(userId: string) {
  const { rows } = await testPool().query(
    `SELECT payload, status FROM notifications
      WHERE user_id = $1 AND channel = 'sms' AND template = 'check_in_welcome'`,
    [userId],
  );
  return rows;
}

describe("checking in at a service", () => {
  it("queues one welcome, and a second scan of the same code queues none", async () => {
    const svc = await createChurchService(cong);
    const id = await member();

    await checkIn(id, svc);
    let { rows } = await testPool().query(`SELECT payload FROM outbox WHERE topic = 'attendance.welcome'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.user_id).toBe(id);

    // A member who scans twice sees "you're already in" — and is not charged for.
    await checkIn(id, svc);
    ({ rows } = await testPool().query(`SELECT payload FROM outbox WHERE topic = 'attendance.welcome'`));
    expect(rows).toHaveLength(1);
  });

  it("texts a member WITHOUT the app an invitation", async () => {
    const svc = await createChurchService(cong);
    const id = await member({ app: false });
    await checkIn(id, svc);
    const sms = new FakeMessageProvider("sms");
    expect(await drainWelcomes(sms)).toBe(1);

    const rows = await welcomeRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.has_app).toBe(false);
    const body = renderCheckInWelcome(rows[0].payload);
    expect(body).toContain("Nuru Pathway app");
    expect(gsm7Length(body)!).toBeLessThanOrEqual(CHECK_IN_SMS_BUDGET);
  });

  it("texts a member WITH the app a welcome that never mentions it", async () => {
    const svc = await createChurchService(cong);
    const id = await member({ app: true });
    await checkIn(id, svc);
    await drainWelcomes(new FakeMessageProvider("sms"));

    const rows = await welcomeRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.has_app).toBe(true);
    expect(renderCheckInWelcome(rows[0].payload)).not.toMatch(/app/i);
  });

  it("an inactive push token does not count as having the app", async () => {
    // Signing out or uninstalling deactivates the token; the person is back to
    // needing the invitation.
    const svc = await createChurchService(cong);
    const id = await member({ app: true });
    await testPool().query(`UPDATE push_tokens SET is_active = FALSE WHERE user_id = $1`, [id]);
    await checkIn(id, svc);
    await drainWelcomes(new FakeMessageProvider("sms"));
    expect((await welcomeRows(id))[0].payload.has_app).toBe(false);
  });

  it("writes nothing for a member with no phone number by the time it runs", async () => {
    // A QR check-in cannot happen without a number — resolveContact refuses
    // before any of this — so this is not reachable through the door. It is
    // reachable through the gap: the outbox row is written at the door and read
    // by the worker later, and in between somebody can clear their number (a
    // profile edit, an erasure request). Guarding in the handler is what keeps
    // that from becoming a row that fails at dispatch and reads like an outage.
    const svc = await createChurchService(cong);
    const id = await member();
    await checkIn(id, svc);
    await testPool().query(`UPDATE users SET phone_number = NULL WHERE user_id = $1`, [id]);

    await drainWelcomes(new FakeMessageProvider("sms"));
    expect(await welcomeRows(id)).toHaveLength(0);
  });

  it("writes nothing for a member deleted between the door and the worker", async () => {
    const svc = await createChurchService(cong);
    const id = await member();
    await checkIn(id, svc);
    await testPool().query(`UPDATE users SET deleted_at = now() WHERE user_id = $1`, [id]);

    await drainWelcomes(new FakeMessageProvider("sms"));
    expect(await welcomeRows(id)).toHaveLength(0);
  });

  it("writes nothing when no SMS provider is bound", async () => {
    const svc = await createChurchService(cong);
    const id = await member();
    await checkIn(id, svc);
    await drainWelcomes(); // no provider
    expect(await welcomeRows(id)).toHaveLength(0);
  });

  it("welcomes once a day — an 8am and an 11am service is not two texts", async () => {
    const first = await createChurchService(cong, { title: "8am" });
    const second = await createChurchService(cong, { title: "11am", qrSecret: "second-secret" });
    const id = await member();
    await checkIn(id, first);
    await checkIn(id, second);

    // Two genuine check-ins, two outbox rows — the guard is in the handler, not
    // in the door.
    const { rows: queued } = await testPool().query(
      `SELECT 1 FROM outbox WHERE topic = 'attendance.welcome'`,
    );
    expect(queued).toHaveLength(2);

    await drainWelcomes(new FakeMessageProvider("sms"));
    expect(await welcomeRows(id)).toHaveLength(1);
  });

  it("survives an at-least-once redelivery of the same outbox row", async () => {
    const svc = await createChurchService(cong);
    const id = await member();
    await checkIn(id, svc);
    const sms = new FakeMessageProvider("sms");
    await drainWelcomes(sms);
    await drainWelcomes(sms); // the outbox is at-least-once
    expect(await welcomeRows(id)).toHaveLength(1);
  });

  it("a visitor who joined by scanning gets the invitation, not the members' copy", async () => {
    // The path the invitation half of the copy exists for. Somebody who joined
    // by pointing a phone camera at the projected code did it in a browser and
    // has no app — nothing has ever registered a push token for them.
    const svc = await createChurchService(cong, {
      checkinOpensAt: new Date(Date.now() - 3_600_000).toISOString(),
      checkinClosesAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const res = await agent()
      .post(`/v1/join/service/${svc.service_id}`)
      .send({
        scan_token: serviceScanToken(svc.qr_secret, svc.service_id),
        full_name: "Grace Wanjiru",
        phone_number: "0712345678",
        email: "grace@dev.local",
        password: "a-long-enough-password",
      });
    expect(res.status).toBe(201);

    await drainWelcomes(new FakeMessageProvider("sms"));
    const { rows } = await testPool().query(
      `SELECT n.payload FROM notifications n JOIN users u ON u.user_id = n.user_id
        WHERE u.email = 'grace@dev.local' AND n.template = 'check_in_welcome'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.has_app).toBe(false);
    const body = renderCheckInWelcome(rows[0].payload);
    expect(body).toContain("Nuru Pathway app");
    expect(body).toContain("Grace");
    expect(gsm7Length(body)!).toBeLessThanOrEqual(CHECK_IN_SMS_BUDGET);
  });

  it("the row it writes is one the dispatcher can actually send", async () => {
    // The payload has to carry everything the copy needs; a row that renders to
    // an exception is worse than no row, because it looks like a delivery fault.
    const svc = await createChurchService(cong);
    const id = await member({ name: "Nyambura-Wangeci Kariuki-Njoroge" });
    await checkIn(id, svc);
    await drainWelcomes(new FakeMessageProvider("sms"));

    const fake = new FakeMessageProvider("sms");
    const rows = await welcomeRows(id);
    await new SmsDispatchProvider(fake, log).send({
      channel: "sms",
      to: "+254722000111",
      template: "check_in_welcome",
      payload: rows[0].payload,
    });
    expect(fake.sent).toHaveLength(1);
    const body = fake.sent[0]!.body;
    expect(body).toContain("Nyambura-Wangeci");
    expect(smsSegments(body)).toBe(1);
    expect(gsm7Length(body)!).toBeLessThanOrEqual(CHECK_IN_SMS_BUDGET);
  });
});
