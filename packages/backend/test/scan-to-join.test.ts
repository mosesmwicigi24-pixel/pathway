// Scan-to-join: a visitor scans the projected code and leaves already a member.
//
// The owner chose this over pending approval having been shown the risk — the
// code is projected in a public room. These tests are the safeguards that make
// the trade survivable, and they exist because a security boundary I have only
// reasoned about is not a boundary.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser, createChurchService } from "./helpers/factories.js";
import { agent } from "./helpers/app.js";
import { serviceScanToken } from "../src/modules/attendance/service.js";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPool();
});

const join = (serviceId: string, token: string, over: Record<string, unknown> = {}) =>
  agent()
    .post(`/v1/join/service/${serviceId}`)
    .send({
      scan_token: token,
      full_name: "Grace Wanjiru",
      phone_number: "0712345678",
      email: "grace@dev.local",
      password: "a-long-enough-password",
      ...over,
    });

describe("a visitor becomes a member from one scan", () => {
  it("creates the account, the pathway and the attendance in one go", async () => {
    const cong = await createCongregation();
    const svc = await createChurchService(cong, {
      checkinOpensAt: new Date(Date.now() - 3_600_000).toISOString(),
      checkinClosesAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    const res = await join(svc.service_id, serviceScanToken(svc.qr_secret, svc.service_id));
    expect(res.status).toBe(201);

    const row = await testPool().query(
      `SELECT u.user_id, u.congregation_id, u.phone_number, u.joined_via_service_id,
              (SELECT count(*)::int FROM enrollments e WHERE e.user_id = u.user_id) AS enrollments,
              (SELECT count(*)::int FROM service_attendance a WHERE a.user_id = u.user_id) AS attendance
         FROM users u WHERE u.email = $1`,
      ["grace@dev.local"],
    );
    expect(row.rowCount).toBe(1);
    const r = row.rows[0];
    expect(r.congregation_id).toBe(cong);
    // Never a member without a pathway — the lesson of migration 193, where 28
    // people held accounts with nothing behind them for up to 42 days.
    expect(r.enrollments).toBe(1);
    expect(r.attendance).toBe(1);
    expect(r.joined_via_service_id).toBe(svc.service_id);
    // Normalised on the way in, like every other entry point (migration 195).
    expect(r.phone_number).toBe("+254712345678");
  });
});

describe("the window is what stops a photographed code", () => {
  it("refuses once check-in has closed", async () => {
    const cong = await createCongregation();
    const svc = await createChurchService(cong, {
      checkinOpensAt: new Date(Date.now() - 7_200_000).toISOString(),
      checkinClosesAt: new Date(Date.now() - 3_600_000).toISOString(), // closed an hour ago
    });

    // This is the safeguard that matters most: it makes the credential
    // perishable instead of permanent. Someone who photographed the screen on
    // Sunday cannot use it on Monday.
    const res = await join(svc.service_id, serviceScanToken(svc.qr_secret, svc.service_id));
    expect(res.status).toBe(422);
    const n = await testPool().query(`SELECT count(*)::int AS n FROM users WHERE email = $1`, ["grace@dev.local"]);
    expect(n.rows[0].n).toBe(0);
  });

  it("refuses before check-in opens", async () => {
    const cong = await createCongregation();
    const svc = await createChurchService(cong, {
      checkinOpensAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const res = await join(svc.service_id, serviceScanToken(svc.qr_secret, svc.service_id));
    expect(res.status).toBe(422);
  });
});

describe("the token has to be real", () => {
  it("refuses a wrong token", async () => {
    const cong = await createCongregation();
    const svc = await createChurchService(cong, {
      checkinClosesAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const res = await join(svc.service_id, "f".repeat(64));
    expect(res.status).toBe(400);
  });

  it("refuses another service's token", async () => {
    const cong = await createCongregation();
    const a = await createChurchService(cong, {
      qrSecret: "secret-a",
      checkinClosesAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    // A different slot: church_services has a uniqueness constraint on the
    // congregation's service slot, which is correct — one 9am Sunday, not two.
    const b = await createChurchService(cong, {
      qrSecret: "secret-b",
      title: "Midweek",
      startsAt: new Date(Date.now() - 86_400_000).toISOString(),
    });
    // The token is HMAC'd over the service id, so B's code cannot open A.
    const res = await join(a.service_id, serviceScanToken(b.qr_secret, b.service_id));
    expect(res.status).toBe(400);
  });

  it("gives the same answer for a bad token and an unknown service", async () => {
    const cong = await createCongregation();
    const svc = await createChurchService(cong, {
      checkinClosesAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const badToken = await join(svc.service_id, "f".repeat(64));
    const noSuchService = await join("00000000-0000-0000-0000-000000000000", "f".repeat(64));
    // Unauthenticated endpoint: it must not tell someone guessing which service
    // ids are real.
    expect(noSuchService.status).toBe(badToken.status);
    expect(noSuchService.body.error?.message).toBe(badToken.body.error?.message);
  });

  it("refuses when QR check-in is switched off for the service", async () => {
    const cong = await createCongregation();
    const svc = await createChurchService(cong, {
      qrEnabled: false,
      checkinClosesAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const res = await join(svc.service_id, serviceScanToken(svc.qr_secret, svc.service_id));
    expect(res.status).toBe(400);
  });
});

describe("it does not create a second identity for someone already here", () => {
  it("refuses an email a live account already holds", async () => {
    const cong = await createCongregation();
    await createUser({ congregationId: cong, role: "Student", email: "grace@dev.local" });
    const svc = await createChurchService(cong, {
      checkinClosesAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    // The 2026-08-13 audit spent a day untangling duplicate people. Better a
    // clear "sign in instead" at the door than a second Grace in the roster.
    const res = await join(svc.service_id, serviceScanToken(svc.qr_secret, svc.service_id));
    expect(res.status).toBe(409);
  });
});

describe("the QR payload works for a phone that has never seen the app", () => {
  it("parses the URL form and the legacy form to the same thing", async () => {
    const { parseServiceQrPayload, serviceQrPayload } = await import("../src/modules/attendance/service.js");
    const id = "11111111-2222-3333-4444-555555555555";
    const url = serviceQrPayload(id, "sekret", "https://pathway.nuruplace.org");
    expect(url.startsWith("https://")).toBe(true);

    const fromUrl = parseServiceQrPayload(url);
    const fromLegacy = parseServiceQrPayload(`nuru-service:${id}:${serviceScanToken("sekret", id)}`);
    // Builds already in members' hands scan the legacy string. Changing the
    // payload must not break the phones people are holding.
    expect(fromUrl).toEqual(fromLegacy);
    expect(fromUrl?.service_id).toBe(id);
  });

  it("returns null for a QR that is not ours", async () => {
    const { parseServiceQrPayload } = await import("../src/modules/attendance/service.js");
    expect(parseServiceQrPayload("https://example.com/j/abc")).toBeNull();
    expect(parseServiceQrPayload("WIFI:S:churchguest;T:WPA;P:hunter2;;")).toBeNull();
    expect(parseServiceQrPayload("")).toBeNull();
  });
});

describe("a burst is refused", () => {
  it("stops runaway joining against one service", async () => {
    const cong = await createCongregation();
    const svc = await createChurchService(cong, {
      checkinClosesAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const token = serviceScanToken(svc.qr_secret, svc.service_id);

    // A real congregation arrives over minutes. Twenty accounts against one
    // service inside a minute is not people walking through a door.
    let refused = 0;
    for (let i = 0; i < 25; i += 1) {
      const res = await join(svc.service_id, token, { email: `burst${i}@dev.local` });
      if (res.status === 429 || res.status === 400) refused += 1;
    }
    expect(refused).toBeGreaterThan(0);

    const n = await testPool().query(
      `SELECT count(*)::int AS n FROM users WHERE joined_via_service_id = $1`,
      [svc.service_id],
    );
    // Whatever the exact cut-off, it must not have let all 25 through.
    expect(n.rows[0].n).toBeLessThan(25);
  });
});
