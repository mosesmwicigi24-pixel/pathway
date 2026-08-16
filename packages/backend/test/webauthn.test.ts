// Passkey / WebAuthn sign-in (§5.3). Runs the REAL routes + service against the
// embedded Postgres with the FakeWebAuthnVerifier injected (no authenticator
// hardware in CI): challenge issue/store/expiry/replay, credential storage,
// the staff-only console gate, anti-enumeration and owner-scoped revocation.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { pino } from "pino";
import supertest from "supertest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { testEnv, bearer } from "./helpers/app.js";
import { createApp } from "../src/http/app.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { FakeWebAuthnVerifier } from "../src/modules/identity/webauthn.js";

const env = testEnv();

function app() {
  const pool = testPool();
  return supertest(
    createApp({
      env,
      db: { primary: pool, replica: pool },
      log: pino({ level: "silent" }),
      webauthnVerifier: new FakeWebAuthnVerifier(),
    }),
  );
}

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

/** A wire-shaped WebAuthn response whose clientDataJSON carries the challenge —
 *  exactly what the service parses; the fake verifier skips the cryptography. */
function fakeCeremonyResponse(credId: string, challenge: string, type: "webauthn.create" | "webauthn.get") {
  return {
    id: credId,
    rawId: credId,
    type: "public-key",
    response: { clientDataJSON: b64url(JSON.stringify({ type, challenge, origin: "http://localhost" })) },
  };
}

async function makeUser(role: "Student" | "Instructor" | "Admin" = "Admin", email = "wa@dev.local") {
  const cong = await createCongregation();
  const u = await createUser({ congregationId: cong, role, email });
  return { userId: u.user_id, cong, email, token: bearer({ sub: u.user_id, role, cong }) };
}

/** Enroll a passkey end-to-end over HTTP; returns the credential id. */
async function enroll(a: ReturnType<typeof app>, token: string, credId: string): Promise<string> {
  const opt = await a.post("/v1/auth/webauthn/register/options").set("Authorization", token).expect(200);
  await a
    .post("/v1/auth/webauthn/register/verify")
    .set("Authorization", token)
    .send({ response: fakeCeremonyResponse(credId, opt.body.challenge, "webauthn.create"), device_label: "Mac · Chrome" })
    .expect(201);
  return credId;
}

describe("identity / passkeys (WebAuthn)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("register/options issues creation options and stores a single-use challenge", async () => {
    const { token, userId } = await makeUser();
    const res = await app().post("/v1/auth/webauthn/register/options").set("Authorization", token).expect(200);
    expect(res.body.challenge).toBeTruthy();
    expect(res.body.authenticatorSelection).toMatchObject({ userVerification: "required" });

    const { rows } = await testPool().query(
      "SELECT user_id, kind, expires_at FROM webauthn_challenges WHERE challenge = $1",
      [res.body.challenge],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(userId);
    expect(rows[0].kind).toBe("register");
    expect(new Date(rows[0].expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("register/verify stores the credential (with label) and burns the challenge", async () => {
    const { token, userId } = await makeUser();
    const a = app();
    const opt = await a.post("/v1/auth/webauthn/register/options").set("Authorization", token).expect(200);
    const res = await a
      .post("/v1/auth/webauthn/register/verify")
      .set("Authorization", token)
      .send({ response: fakeCeremonyResponse("cred-abc", opt.body.challenge, "webauthn.create"), device_label: "Mac · Chrome" })
      .expect(201);
    expect(res.body.credential_id).toBe("cred-abc");

    const { rows } = await testPool().query("SELECT * FROM webauthn_credentials WHERE credential_id = 'cred-abc'");
    expect(rows[0]).toMatchObject({ user_id: userId, device_label: "Mac · Chrome", transports: ["internal"] });

    // Challenge is single-use: replaying the same attestation is refused.
    await a
      .post("/v1/auth/webauthn/register/verify")
      .set("Authorization", token)
      .send({ response: fakeCeremonyResponse("cred-abc", opt.body.challenge, "webauthn.create") })
      .expect(401);

    // And the list endpoint shows it.
    const list = await a.get("/v1/auth/webauthn/credentials").set("Authorization", token).expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ credential_id: "cred-abc", device_label: "Mac · Chrome" });
  });

  it("passkey login mints a session for staff under scope=admin, updates sign_count/last_used_at, and audits", async () => {
    const { token, userId } = await makeUser("Admin", "staff@dev.local");
    const a = app();
    await enroll(a, token, "cred-staff");

    const opt = await a.post("/v1/auth/webauthn/login/options").send({ email: "staff@dev.local", scope: "admin" }).expect(200);
    expect(opt.body.allowCredentials).toHaveLength(1);
    expect(opt.body.allowCredentials[0].id).toBe("cred-staff");

    const res = await a
      .post("/v1/auth/webauthn/login/verify")
      .send({ response: fakeCeremonyResponse("cred-staff", opt.body.challenge, "webauthn.get"), scope: "admin" })
      .expect(200);
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.refresh_token).toBeTruthy();

    const { rows } = await testPool().query(
      "SELECT sign_count::int AS sign_count, last_used_at FROM webauthn_credentials WHERE credential_id = 'cred-staff'",
    );
    expect(rows[0].sign_count).toBe(1); // fake bumps the counter by one
    expect(rows[0].last_used_at).not.toBeNull();

    const { rows: audits } = await testPool().query(
      "SELECT 1 FROM audit_log WHERE actor_id = $1 AND action = 'user.login_passkey'",
      [userId],
    );
    expect(audits).toHaveLength(1);
  });

  it("refuses a Student's passkey under scope=admin with 403 FORBIDDEN_SCOPE (audited), but admits them without scope", async () => {
    const { token, userId } = await makeUser("Student", "member@dev.local");
    const a = app();
    await enroll(a, token, "cred-member");

    // Staff-only console gate — same rule as password login (§5.4).
    const opt1 = await a.post("/v1/auth/webauthn/login/options").send({ email: "member@dev.local", scope: "admin" }).expect(200);
    const denied = await a
      .post("/v1/auth/webauthn/login/verify")
      .send({ response: fakeCeremonyResponse("cred-member", opt1.body.challenge, "webauthn.get"), scope: "admin" })
      .expect(403);
    expect(denied.body.error.code).toBe("FORBIDDEN_SCOPE");
    expect(denied.body.access_token).toBeUndefined();
    const { rows: audits } = await testPool().query(
      "SELECT 1 FROM audit_log WHERE actor_id = $1 AND action = 'user.login_denied_scope'",
      [userId],
    );
    expect(audits).toHaveLength(1);

    // The member app (no scope) still signs the same member in.
    const opt2 = await a.post("/v1/auth/webauthn/login/options").send({ email: "member@dev.local" }).expect(200);
    const ok = await a
      .post("/v1/auth/webauthn/login/verify")
      .send({ response: fakeCeremonyResponse("cred-member", opt2.body.challenge, "webauthn.get") })
      .expect(200);
    expect(ok.body.access_token).toBeTruthy();
  });

  it("passkey login bypasses the TOTP step for an MFA-enabled account (userVerification=required is strong auth)", async () => {
    const { token, userId } = await makeUser("Admin", "mfa@dev.local");
    const a = app();
    await enroll(a, token, "cred-mfa");
    await testPool().query("UPDATE users SET mfa_enabled = TRUE WHERE user_id = $1", [userId]);

    const opt = await a.post("/v1/auth/webauthn/login/options").send({ email: "mfa@dev.local", scope: "admin" }).expect(200);
    const res = await a
      .post("/v1/auth/webauthn/login/verify")
      .send({ response: fakeCeremonyResponse("cred-mfa", opt.body.challenge, "webauthn.get"), scope: "admin" })
      .expect(200);
    expect(res.body.access_token).toBeTruthy(); // a real session, not { mfa_required }
    expect(res.body.mfa_required).toBeUndefined();
  });

  it("login/options for an unknown email returns well-formed options with EMPTY allowCredentials (no enumeration)", async () => {
    const res = await app().post("/v1/auth/webauthn/login/options").send({ email: "ghost@dev.local", scope: "admin" }).expect(200);
    expect(res.body.challenge).toBeTruthy();
    expect(res.body.allowCredentials).toEqual([]);

    // Same for a real account with no passkeys — indistinguishable on the wire.
    await makeUser("Admin", "nopasskeys@dev.local");
    const res2 = await app().post("/v1/auth/webauthn/login/options").send({ email: "nopasskeys@dev.local" }).expect(200);
    expect(res2.body.challenge).toBeTruthy();
    expect(res2.body.allowCredentials).toEqual([]);
  });

  it("a replayed or expired login challenge is rejected", async () => {
    const { token } = await makeUser("Admin", "replay@dev.local");
    const a = app();
    await enroll(a, token, "cred-replay");

    // Replay: the first verify consumes the challenge; the second is refused.
    const opt = await a.post("/v1/auth/webauthn/login/options").send({ email: "replay@dev.local" }).expect(200);
    const body = { response: fakeCeremonyResponse("cred-replay", opt.body.challenge, "webauthn.get") };
    await a.post("/v1/auth/webauthn/login/verify").send(body).expect(200);
    await a.post("/v1/auth/webauthn/login/verify").send(body).expect(401);

    // Expired: a challenge past its 5-minute TTL is refused even though stored.
    await testPool().query(
      `INSERT INTO webauthn_challenges (challenge, user_id, kind, expires_at)
       VALUES ('stale-challenge', NULL, 'login', now() - interval '1 minute')`,
    );
    await a
      .post("/v1/auth/webauthn/login/verify")
      .send({ response: fakeCeremonyResponse("cred-replay", "stale-challenge", "webauthn.get") })
      .expect(401);
  });

  it("credential delete is owner-scoped: someone else's passkey 404s, your own is removed", async () => {
    const a = app();
    const owner = await makeUser("Admin", "owner@dev.local");
    await enroll(a, owner.token, "cred-owned");
    const other = await createUser({ congregationId: owner.cong, role: "Admin", email: "other@dev.local" });
    const otherToken = bearer({ sub: other.user_id, role: "Admin", cong: owner.cong });

    // Another signed-in admin cannot revoke it…
    await a.delete("/v1/auth/webauthn/credentials/cred-owned").set("Authorization", otherToken).expect(404);
    const { rows: still } = await testPool().query("SELECT 1 FROM webauthn_credentials WHERE credential_id = 'cred-owned'");
    expect(still).toHaveLength(1);

    // …the owner can.
    await a.delete("/v1/auth/webauthn/credentials/cred-owned").set("Authorization", owner.token).expect(204);
    const { rows: gone } = await testPool().query("SELECT 1 FROM webauthn_credentials WHERE credential_id = 'cred-owned'");
    expect(gone).toHaveLength(0);
  });
});
