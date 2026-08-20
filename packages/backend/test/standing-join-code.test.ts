// The standing poster (migration 200): one printed QR per congregation, and
// the SERVER decides what it means today. These tests pin the property the
// owner asked for in one sentence — "consistent, but when scanned on one date
// it fills the details of that person on that day" — and the safeguards that
// keep a printed, photographable code from becoming open registration.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser, createChurchService } from "./helpers/factories.js";
import { agent, bearer } from "./helpers/app.js";

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

describe("the code confirms nothing to enumeration", () => {
  it("unknown and malformed codes get the same refusal", async () => {
    const unknown = await agent().get(`/v1/join/congregation/${"0".repeat(64)}`);
    const short = await agent().get(`/v1/join/congregation/nope`);
    expect(unknown.status).toBe(400);
    expect(short.status).toBe(400);
    expect(unknown.body.message).toBe(short.body.message);
  });
});
