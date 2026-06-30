// Location → proximity → cell-pairing (parity gap #4, Phase 1, backend only).
// Privacy-first invariants from docs/LOCATION_PROXIMITY_DESIGN.md:
//   * opt-in stores a coarse geohash, never raw coordinates (no lat/lng column);
//   * minors are consent-gated (403 without an active location_sharing consent);
//   * opt-out and consent-revocation erase the stored row immediately;
//   * suggestions cluster within a radius, are RBAC-gated, and hide minors from
//     non-Admin requesters; geohash/coords are never returned.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";

const auth = (t: string) => ({ Authorization: t });

// Nairobi-area coordinates: CBD and a point ~1.2 km away cluster together within
// 3 km; Thika is ~40 km away — a separate cluster (and outside a 3 km radius).
const CBD = { lat: -1.2864, lng: 36.8172 };
const NEAR = { lat: -1.3, lng: 36.82 };
const FAR = { lat: -1.0333, lng: 37.0693 };

const minorDob = (): string => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 14);
  return d.toISOString().slice(0, 10);
};

let cong: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
});
afterAll(async () => {
  await closeTestPool();
});

describe("proximity — member opt-in / opt-out", () => {
  it("opt-in stores a coarse geohash and never raw coordinates", async () => {
    const u = await createUser({ congregationId: cong, email: "a@dev.local" });
    const tok = bearer({ sub: u.user_id, role: "Student", cong });

    const res = await agent().post("/v1/me/location").set(auth(tok)).send(CBD);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const { rows } = await testPool().query(
      `SELECT geohash6, consent_at, updated_at FROM member_location WHERE user_id = $1`,
      [u.user_id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].geohash6).toBe("kzf0tv"); // 6-char geohash for the CBD coords
    expect(rows[0].geohash6).toHaveLength(6);

    // The table must not carry any latitude/longitude column — coords are discarded.
    const cols = await testPool().query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'member_location'`,
    );
    const names = cols.rows.map((r: { column_name: string }) => r.column_name);
    expect(names.sort()).toEqual(["consent_at", "geohash6", "updated_at", "user_id"]);
    expect(names.some((n: string) => /lat|lng|lon|coord/i.test(n))).toBe(false);
  });

  it("re-ingest overwrites the single row (no movement trail)", async () => {
    const u = await createUser({ congregationId: cong, email: "b@dev.local" });
    const tok = bearer({ sub: u.user_id, role: "Student", cong });
    await agent().post("/v1/me/location").set(auth(tok)).send(CBD);
    await agent().post("/v1/me/location").set(auth(tok)).send(FAR);
    const { rows } = await testPool().query(`SELECT geohash6 FROM member_location WHERE user_id = $1`, [u.user_id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].geohash6).toBe("kzf65e"); // overwritten to the Thika cell
  });

  it("rejects out-of-range coordinates (validation)", async () => {
    const u = await createUser({ congregationId: cong, email: "c@dev.local" });
    const tok = bearer({ sub: u.user_id, role: "Student", cong });
    const res = await agent().post("/v1/me/location").set(auth(tok)).send({ lat: 200, lng: 36 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("opt-out erases the stored location immediately", async () => {
    const u = await createUser({ congregationId: cong, email: "d@dev.local" });
    const tok = bearer({ sub: u.user_id, role: "Student", cong });
    await agent().post("/v1/me/location").set(auth(tok)).send(CBD);
    const del = await agent().delete("/v1/me/location").set(auth(tok));
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ ok: true });
    const { rows } = await testPool().query(`SELECT 1 FROM member_location WHERE user_id = $1`, [u.user_id]);
    expect(rows).toHaveLength(0);
  });
});

describe("proximity — minors are guardian-consent-gated", () => {
  it("minor WITHOUT location consent is rejected (403)", async () => {
    const minor = await createUser({ congregationId: cong, email: "m@dev.local", dateOfBirth: minorDob() });
    expect(minor.is_minor).toBe(true);
    const tok = bearer({ sub: minor.user_id, role: "Student", cong });
    const res = await agent().post("/v1/me/location").set(auth(tok)).send(CBD);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CONSENT_REQUIRED");
    const { rows } = await testPool().query(`SELECT 1 FROM member_location WHERE user_id = $1`, [minor.user_id]);
    expect(rows).toHaveLength(0);
  });

  it("minor WITH an active location consent can store location", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "adm@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const minor = await createUser({ congregationId: cong, email: "m2@dev.local", dateOfBirth: minorDob() });
    const minorTok = bearer({ sub: minor.user_id, role: "Student", cong });

    const grant = await agent()
      .post(`/v1/admin/members/${minor.user_id}/location-consent`)
      .set(auth(adminTok))
      .send({ guardian_name: "Jane Doe", relationship: "mother", consent_text_version: "v1" });
    expect(grant.status).toBe(201);

    const res = await agent().post("/v1/me/location").set(auth(minorTok)).send(CBD);
    expect(res.status).toBe(200);
    const { rows } = await testPool().query(`SELECT geohash6 FROM member_location WHERE user_id = $1`, [minor.user_id]);
    expect(rows).toHaveLength(1);
  });

  it("revoking the consent erases the minor's stored location immediately", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "adm2@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const minor = await createUser({ congregationId: cong, email: "m3@dev.local", dateOfBirth: minorDob() });
    const minorTok = bearer({ sub: minor.user_id, role: "Student", cong });

    await agent()
      .post(`/v1/admin/members/${minor.user_id}/location-consent`)
      .set(auth(adminTok))
      .send({ guardian_name: "Jane Doe", relationship: "mother", consent_text_version: "v1" });
    await agent().post("/v1/me/location").set(auth(minorTok)).send(CBD);

    const revoke = await agent().delete(`/v1/admin/members/${minor.user_id}/location-consent`).set(auth(adminTok));
    expect(revoke.status).toBe(200);

    const loc = await testPool().query(`SELECT 1 FROM member_location WHERE user_id = $1`, [minor.user_id]);
    expect(loc.rows).toHaveLength(0);
    const consent = await testPool().query(
      `SELECT revoked_at FROM guardian_consents WHERE user_id = $1 AND consent_type = 'location_sharing'`,
      [minor.user_id],
    );
    expect(consent.rows[0].revoked_at).not.toBeNull();

    // After revocation, the minor can no longer re-ingest.
    const reIngest = await agent().post("/v1/me/location").set(auth(minorTok)).send(CBD);
    expect(reIngest.status).toBe(403);
  });

  it("location consent does not satisfy the onboarding consent gate (distinct types)", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "adm3@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const minor = await createUser({ congregationId: cong, email: "m4@dev.local", dateOfBirth: minorDob() });
    await agent()
      .post(`/v1/admin/members/${minor.user_id}/location-consent`)
      .set(auth(adminTok))
      .send({ guardian_name: "Jane Doe", relationship: "mother", consent_text_version: "v1" });
    // Only the location_sharing row exists; no onboarding consent.
    const { rows } = await testPool().query(
      `SELECT consent_type FROM guardian_consents WHERE user_id = $1 ORDER BY consent_type`,
      [minor.user_id],
    );
    expect(rows.map((r: { consent_type: string }) => r.consent_type)).toEqual(["location_sharing"]);
  });
});

describe("proximity — admin suggestions (clustering, radius, RBAC, minor visibility)", () => {
  async function seedTwoNearOneFar(): Promise<void> {
    const a = await createUser({ congregationId: cong, fullName: "Ann", email: "n1@dev.local" });
    const b = await createUser({ congregationId: cong, fullName: "Ben", email: "n2@dev.local" });
    const c = await createUser({ congregationId: cong, fullName: "Cara", email: "n3@dev.local" });
    await agent().post("/v1/me/location").set(auth(bearer({ sub: a.user_id, role: "Student", cong }))).send(CBD);
    await agent().post("/v1/me/location").set(auth(bearer({ sub: b.user_id, role: "Student", cong }))).send(NEAR);
    await agent().post("/v1/me/location").set(auth(bearer({ sub: c.user_id, role: "Student", cong }))).send(FAR);
  }

  it("clusters near members together and separates far ones (3 km default)", async () => {
    await seedTwoNearOneFar();
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "adm4@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });

    const res = await agent().get("/v1/admin/members/proximity").set(auth(adminTok));
    expect(res.status).toBe(200);
    const clusters = res.body.clusters as { member_count: number; members: unknown[]; area: string }[];
    // Two near members in one cluster, the far member alone.
    expect(clusters).toHaveLength(2);
    expect(clusters[0].member_count).toBe(2);
    expect(clusters[1].member_count).toBe(1);

    // Never leak geohash or coordinates.
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/geohash/i);
    expect(raw).not.toMatch(/"lat"|"lng"/);
  });

  it("a 1 km radius splits the two near members into separate clusters", async () => {
    await seedTwoNearOneFar();
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "adm5@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const res = await agent().get("/v1/admin/members/proximity?radius_km=1").set(auth(adminTok));
    expect(res.status).toBe(200);
    // 1 km < the ~1.2 km separation, so all three are singletons.
    expect(res.body.clusters).toHaveLength(3);
  });

  it("requires the members:proximity permission (no permission → 403)", async () => {
    await seedTwoNearOneFar();
    const student = await createUser({ congregationId: cong, role: "Student", email: "stu@dev.local" });
    const studentTok = bearer({ sub: student.user_id, role: "Student", cong });
    const res = await agent().get("/v1/admin/members/proximity").set(auth(studentTok));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_SCOPE");
  });

  it("a granular coach role (regional_coach) is allowed via the matrix", async () => {
    await seedTwoNearOneFar();
    const coach = await createUser({ congregationId: cong, role: "Instructor", email: "coach@dev.local" });
    await testPool().query(`INSERT INTO rbac_user_roles (user_id, role_key) VALUES ($1, 'regional_coach')`, [coach.user_id]);
    const coachTok = bearer({ sub: coach.user_id, role: "Instructor", cong });
    const res = await agent().get("/v1/admin/members/proximity").set(auth(coachTok));
    expect(res.status).toBe(200);
  });

  it("hides minors from a non-Admin (coach) requester but shows them to Admin", async () => {
    // One adult + one consented minor at the SAME area.
    const adult = await createUser({ congregationId: cong, fullName: "Adam", email: "ad@dev.local" });
    await agent().post("/v1/me/location").set(auth(bearer({ sub: adult.user_id, role: "Student", cong }))).send(CBD);

    const admin = await createUser({ congregationId: cong, role: "Admin", email: "adm6@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const minor = await createUser({ congregationId: cong, fullName: "Mia", email: "mia@dev.local", dateOfBirth: minorDob() });
    await agent()
      .post(`/v1/admin/members/${minor.user_id}/location-consent`)
      .set(auth(adminTok))
      .send({ guardian_name: "Jane Doe", relationship: "mother", consent_text_version: "v1" });
    await agent().post("/v1/me/location").set(auth(bearer({ sub: minor.user_id, role: "Student", cong }))).send(NEAR);

    // Coach (regional_coach via matrix) sees adults only.
    const coach = await createUser({ congregationId: cong, role: "Instructor", email: "coach2@dev.local" });
    await testPool().query(`INSERT INTO rbac_user_roles (user_id, role_key) VALUES ($1, 'regional_coach')`, [coach.user_id]);
    const coachTok = bearer({ sub: coach.user_id, role: "Instructor", cong });
    const coachRes = await agent().get("/v1/admin/members/proximity").set(auth(coachTok));
    expect(coachRes.status).toBe(200);
    const coachMembers = coachRes.body.clusters.flatMap((c: { members: { is_minor: boolean }[] }) => c.members);
    expect(coachMembers.some((m: { is_minor: boolean }) => m.is_minor)).toBe(false);
    expect(coachMembers).toHaveLength(1); // adult only

    // Admin sees the minor too.
    const adminRes = await agent().get("/v1/admin/members/proximity").set(auth(adminTok));
    const adminMembers = adminRes.body.clusters.flatMap((c: { members: { is_minor: boolean }[] }) => c.members);
    expect(adminMembers.some((m: { is_minor: boolean }) => m.is_minor)).toBe(true);
    expect(adminMembers).toHaveLength(2);
  });

  it("excludes minors whose location consent was revoked from suggestions entirely", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "adm7@dev.local" });
    const adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const minor = await createUser({ congregationId: cong, fullName: "Moe", email: "moe@dev.local", dateOfBirth: minorDob() });
    await agent()
      .post(`/v1/admin/members/${minor.user_id}/location-consent`)
      .set(auth(adminTok))
      .send({ guardian_name: "Jane Doe", relationship: "mother", consent_text_version: "v1" });
    await agent().post("/v1/me/location").set(auth(bearer({ sub: minor.user_id, role: "Student", cong }))).send(CBD);
    await agent().delete(`/v1/admin/members/${minor.user_id}/location-consent`).set(auth(adminTok));

    const res = await agent().get("/v1/admin/members/proximity").set(auth(adminTok));
    expect(res.status).toBe(200);
    expect(res.body.clusters).toHaveLength(0);
  });
});
