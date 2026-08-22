// The standing poster (migration 200): one printed QR per congregation, and
// the SERVER decides what it means today. These tests pin the property the
// owner asked for in one sentence — "consistent, but when scanned on one date
// it fills the details of that person on that day" — and the safeguards that
// keep a printed, photographable code from becoming open registration.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser, createChurchService } from "./helpers/factories.js";
import { agent, bearer } from "./helpers/app.js";
import { serviceScanToken } from "../src/modules/attendance/service.js";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPool();
});

async function joinCode(congregationId: string): Promise<string> {
  const { rows } = await testPool().query<{ join_code: string }>(
    `SELECT join_code FROM congregations WHERE congregation_id = $1`,
    [congregationId],
  );
  return rows[0]!.join_code;
}

const hourAgo = () => new Date(Date.now() - 3_600_000).toISOString();
const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();

describe("every congregation carries a code without anyone minting one", () => {
  it("is present, long, and unique from the moment the row exists", async () => {
    const a = await joinCode(await createCongregation("A"));
    const b = await joinCode(await createCongregation("B"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe("the same poster means a different service on a different day", () => {
  it("resolves to the service whose window is open now, not an earlier one", async () => {
    const cong = await createCongregation();
    // Last week's service: window long closed. The poster used to mean this.
    await createChurchService(cong, {
      title: "Last Sunday",
      serviceDate: "2026-08-16",
      startsAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
      checkinOpensAt: new Date(Date.now() - 7 * 86_400_000 - 3_600_000).toISOString(),
      checkinClosesAt: new Date(Date.now() - 7 * 86_400_000 + 3_600_000).toISOString(),
    });
    // Today's service: window open. The poster means this now.
    const today = await createChurchService(cong, {
      title: "This Sunday",
      qrSecret: "todays-secret",
      checkinOpensAt: hourAgo(),
      checkinClosesAt: inAnHour(),
    });

    const res = await agent().get(`/v1/join/congregation/${await joinCode(cong)}`);
    expect(res.status).toBe(200);
    expect(res.body.open).toBe(true);
    expect(res.body.service.service_id).toBe(today.service_id);
    expect(res.body.service.scan_token).toBeTruthy();
  });

  it("the resolved token joins a guest INTO that day's service", async () => {
    const cong = await createCongregation();
    const svc = await createChurchService(cong, {
      checkinOpensAt: hourAgo(),
      checkinClosesAt: inAnHour(),
    });

    const resolved = await agent().get(`/v1/join/congregation/${await joinCode(cong)}`);
    const joined = await agent()
      .post(`/v1/join/service/${resolved.body.service.service_id}`)
      .send({
        scan_token: resolved.body.service.scan_token,
        full_name: "Amina Njeri",
        phone_number: "0733000111",
        email: "amina@dev.local",
        password: "a-long-enough-password",
      });
    expect(joined.status).toBe(201);
    expect(joined.body.service_id).toBe(svc.service_id);

    const { rows } = await testPool().query(
      `SELECT service_id FROM service_attendance a
         JOIN users u USING (user_id) WHERE u.email = 'amina@dev.local'`,
    );
    expect(rows).toEqual([{ service_id: svc.service_id }]);
  });

  it("the resolved token checks an existing member into that day's service", async () => {
    const cong = await createCongregation();
    const svc = await createChurchService(cong, {
      checkinOpensAt: hourAgo(),
      checkinClosesAt: inAnHour(),
    });
    const member = await createUser({ congregationId: cong, fullName: "Returning Member" });

    const resolved = await agent().get(`/v1/join/congregation/${await joinCode(cong)}`);
    const checkin = await agent()
      .post(`/v1/services/${resolved.body.service.service_id}/attendance`)
      .set("Authorization", bearer({ sub: member.user_id, role: "Student", cong }))
      .send({
        client_scan_id: "6b1a2f34-0000-4000-8000-000000000001",
        scan_token: resolved.body.service.scan_token,
      });
    expect(checkin.status).toBe(201);

    const { rows } = await testPool().query(
      `SELECT count(*)::int AS n FROM service_attendance WHERE user_id = $1 AND service_id = $2`,
      [member.user_id, svc.service_id],
    );
    expect(rows[0].n).toBe(1);
  });

  it("prefers the most recently opened window when two overlap", async () => {
    const cong = await createCongregation();
    await createChurchService(cong, {
      title: "Early Service",
      startsAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      checkinOpensAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      checkinClosesAt: inAnHour(),
    });
    const main = await createChurchService(cong, {
      title: "Main Service",
      qrSecret: "main-secret",
      startsAt: hourAgo(),
      checkinOpensAt: hourAgo(),
      checkinClosesAt: inAnHour(),
    });
    const res = await agent().get(`/v1/join/congregation/${await joinCode(cong)}`);
    expect(res.body.service.service_id).toBe(main.service_id);
  });
});

describe("outside a window the poster is inert", () => {
  it("resolves closed, leaks no token, and points at the next service", async () => {
    const cong = await createCongregation();
    await createChurchService(cong, {
      title: "Next Sunday",
      startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      serviceDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
      checkinOpensAt: new Date(Date.now() + 2 * 86_400_000 - 3_600_000).toISOString(),
      checkinClosesAt: new Date(Date.now() + 2 * 86_400_000 + 3_600_000).toISOString(),
    });

    const res = await agent().get(`/v1/join/congregation/${await joinCode(cong)}`);
    expect(res.status).toBe(200);
    expect(res.body.open).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain("scan_token");
    expect(res.body.next.title).toBe("Next Sunday");
  });

  it("a QR-disabled service never answers the poster", async () => {
    const cong = await createCongregation();
    await createChurchService(cong, {
      qrEnabled: false,
      checkinOpensAt: hourAgo(),
      checkinClosesAt: inAnHour(),
    });
    const res = await agent().get(`/v1/join/congregation/${await joinCode(cong)}`);
    expect(res.body.open).toBe(false);
  });
});

describe("a remembered phone: scan → Enter → counted, no password", () => {
  it("joining hands back a continuity token that checks the SAME person into a DIFFERENT day's service", async () => {
    const cong = await createCongregation();
    const sundayOne = await createChurchService(cong, {
      title: "First Sunday",
      checkinOpensAt: hourAgo(),
      checkinClosesAt: inAnHour(),
    });

    // Sunday one: the details step, once, ever.
    const joined = await agent().post(`/v1/join/service/${sundayOne.service_id}`).send({
      scan_token: serviceScanToken(sundayOne.qr_secret, sundayOne.service_id),
      full_name: "Wanjiku Otieno",
      phone_number: "0722000333",
      email: "wanjiku@dev.local",
      password: "a-long-enough-password",
    });
    expect(joined.status).toBe(201);
    expect(joined.body.continuity_token).toBeTruthy();
    expect(joined.body.full_name).toBe("Wanjiku Otieno");

    // Sunday two: a different service, and the poster resolves to it. One tap.
    const sundayTwo = await createChurchService(cong, {
      title: "Second Sunday",
      qrSecret: "second-secret",
      checkinOpensAt: hourAgo(),
      checkinClosesAt: inAnHour(),
    });
    const returned = await agent().post(`/v1/join/service/${sundayTwo.service_id}/return`).send({
      continuity_token: joined.body.continuity_token,
      scan_token: serviceScanToken("second-secret", sundayTwo.service_id),
      client_scan_id: "6b1a2f34-0000-4000-8000-000000000002",
    });
    expect(returned.status).toBe(201);
    expect(returned.body.full_name).toBe("Wanjiku Otieno");
    expect(returned.body.continuity_token).toBeTruthy();

    // Her details — the ones Follow-up needs — landed on the second day's
    // record from her PROFILE, not from a form.
    const { rows } = await testPool().query(
      `SELECT full_name, phone_number, email, attended_at IS NOT NULL AS stamped
         FROM service_attendance WHERE service_id = $1`,
      [sundayTwo.service_id],
    );
    expect(rows).toEqual([
      { full_name: "Wanjiku Otieno", phone_number: "+254722000333", email: "wanjiku@dev.local", stamped: true },
    ]);
  });

  it("a second tap the same morning is a duplicate, not a second row", async () => {
    const cong = await createCongregation();
    const svcRow = await createChurchService(cong, {
      checkinOpensAt: hourAgo(),
      checkinClosesAt: inAnHour(),
    });
    const joined = await agent().post(`/v1/join/service/${svcRow.service_id}`).send({
      scan_token: serviceScanToken(svcRow.qr_secret, svcRow.service_id),
      full_name: "Double Tap",
      phone_number: "0722000444",
      email: "double@dev.local",
      password: "a-long-enough-password",
    });
    const again = await agent().post(`/v1/join/service/${svcRow.service_id}/return`).send({
      continuity_token: joined.body.continuity_token,
      scan_token: serviceScanToken(svcRow.qr_secret, svcRow.service_id),
      client_scan_id: "6b1a2f34-0000-4000-8000-000000000003",
    });
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    const { rows } = await testPool().query(
      `SELECT count(*)::int AS n FROM service_attendance WHERE service_id = $1`,
      [svcRow.service_id],
    );
    expect(rows[0].n).toBe(1);
  });

  it("the token is attendance-only in scope and window-bound in time", async () => {
    const cong = await createCongregation();
    const open = await createChurchService(cong, {
      checkinOpensAt: hourAgo(),
      checkinClosesAt: inAnHour(),
    });
    const joined = await agent().post(`/v1/join/service/${open.service_id}`).send({
      scan_token: serviceScanToken(open.qr_secret, open.service_id),
      full_name: "Scope Check",
      phone_number: "0722000555",
      email: "scope@dev.local",
      password: "a-long-enough-password",
    });
    const token = joined.body.continuity_token as string;

    // Not an access token: the authed surface refuses it outright.
    const asBearer = await agent().get(`/v1/me/attendance`).set("Authorization", `Bearer ${token}`);
    expect(asBearer.status).toBe(401);

    // And it cannot beat the window: a closed service refuses the return scan.
    const closed = await createChurchService(cong, {
      title: "Closed Service",
      qrSecret: "closed-secret",
      checkinOpensAt: new Date(Date.now() - 7_200_000).toISOString(),
      checkinClosesAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    const late = await agent().post(`/v1/join/service/${closed.service_id}/return`).send({
      continuity_token: token,
      scan_token: serviceScanToken("closed-secret", closed.service_id),
      client_scan_id: "6b1a2f34-0000-4000-8000-000000000004",
    });
    expect(late.status).toBe(422);
  });

  it("garbage and forged continuity tokens get one uniform refusal", async () => {
    const cong = await createCongregation();
    const svcRow = await createChurchService(cong, {
      checkinOpensAt: hourAgo(),
      checkinClosesAt: inAnHour(),
    });
    const res = await agent().post(`/v1/join/service/${svcRow.service_id}/return`).send({
      continuity_token: "a".repeat(64),
      scan_token: serviceScanToken(svcRow.qr_secret, svcRow.service_id),
      client_scan_id: "6b1a2f34-0000-4000-8000-000000000005",
    });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("This device needs a fresh sign-in");
  });
});

describe("the code confirms nothing to enumeration", () => {
  it("unknown and malformed codes get the same refusal", async () => {
    const unknown = await agent().get(`/v1/join/congregation/${"0".repeat(64)}`);
    const short = await agent().get(`/v1/join/congregation/nope`);
    expect(unknown.status).toBe(400);
    expect(short.status).toBe(400);
    // The real field this time. The first version of this assertion compared
    // body.message — a field that does not exist — and passed on
    // undefined === undefined. An assertion that cannot fail is not a test.
    expect(unknown.body.error.message).toBe("That code is not valid");
    expect(short.body.error.message).toBe("That code is not valid");
  });
});
