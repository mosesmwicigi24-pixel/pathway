import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { testEnv, agent, bearer } from "./helpers/app.js";
import { createCongregation, createCellGroup, createUser } from "./helpers/factories.js";
import { IdentityService } from "../src/modules/identity/service.js";
import type { EmailMessage, EmailProvider } from "../src/modules/identity/email.js";
import {
  issueRefreshToken,
  rotateRefreshToken,
} from "../src/modules/identity/tokens.js";

const env = testEnv();
const svc = () => new IdentityService(testPool(), env);

describe("identity / auth", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("provisions a user on first OAuth login and reuses it on the second", async () => {
    const profile = { provider: "kingschat", sub: "kc-1", fullName: "Ada", email: "ada@example.com" };
    const first = await svc().loginWithOAuth(profile);
    expect(first.access_token).toBeTruthy();
    expect(first.refresh_token).toBeTruthy();

    const { rows: after1 } = await testPool().query("SELECT count(*)::int n FROM users");
    expect(after1[0].n).toBe(1);

    await svc().loginWithOAuth(profile); // same sub
    const { rows: after2 } = await testPool().query("SELECT count(*)::int n FROM users");
    expect(after2[0].n).toBe(1); // no duplicate
  });

  it("rotates refresh tokens and detects reuse by revoking the family (§5.3)", async () => {
    const cong = await createCongregation();
    const user = await createUser({ congregationId: cong });
    const issued = await issueRefreshToken(testPool(), user.user_id, env);

    // First rotation succeeds and yields a new token.
    const r1 = await rotateRefreshToken(testPool(), issued.token, env);
    expect(r1.userId).toBe(user.user_id);
    expect(r1.refresh.token).not.toBe(issued.token);

    // Reusing the ORIGINAL (now revoked) token is theft → throws and revokes family.
    await expect(rotateRefreshToken(testPool(), issued.token, env)).rejects.toThrow();

    // The previously-valid rotated token is now revoked too (family killed).
    await expect(rotateRefreshToken(testPool(), r1.refresh.token, env)).rejects.toThrow();
  });

  it("onboarding sets intake fields, derives congregation from the cell, and enrolls at L1", async () => {
    const cong = await createCongregation();
    const cell = await createCellGroup(cong, "Cell Z");
    // provision a bare SSO user (no cong yet)
    await svc().loginWithOAuth({ provider: "google", sub: "g-1", fullName: "Joon" });
    const { rows } = await testPool().query("SELECT user_id FROM users LIMIT 1");
    const userId = rows[0].user_id as string;

    const result = (await svc().onboard(userId, {
      date_of_birth: "2000-05-01",
      phone_number: "+254711111111",
      cell_group_id: cell,
      is_baptized: true,
    })) as { current_level: number; already_onboarded: boolean };

    expect(result.current_level).toBe(1);
    expect(result.already_onboarded).toBe(false);

    const { rows: u } = await testPool().query(
      "SELECT congregation_id, cell_group_id, is_minor FROM users WHERE user_id=$1",
      [userId],
    );
    expect(u[0].congregation_id).toBe(cong);
    expect(u[0].cell_group_id).toBe(cell);
    expect(u[0].is_minor).toBe(false);

    // Idempotent: a second onboarding returns the existing enrollment.
    const again = (await svc().onboard(userId, {
      date_of_birth: "2000-05-01",
      phone_number: "+254711111111",
      cell_group_id: cell,
      is_baptized: true,
    })) as { already_onboarded: boolean };
    expect(again.already_onboarded).toBe(true);
  });

  it("updateMe enforces optimistic concurrency (row_version)", async () => {
    const cong = await createCongregation();
    const user = await createUser({ congregationId: cong });

    const ok = (await svc().updateMe(user.user_id, {
      phone_number: "+254799999999",
      row_version: 1,
    })) as { row_version: number };
    expect(ok.row_version).toBe(2);

    // Stale version now fails.
    await expect(
      svc().updateMe(user.user_id, { timezone: "Africa/Lagos", row_version: 1 }),
    ).rejects.toMatchObject({ code: "VERSION_STALE" });
  });

  it("updateMe persists the editable identity fields and they round-trip through getMe", async () => {
    const cong = await createCongregation();
    const user = await createUser({ congregationId: cong, fullName: "Old Name" });

    await svc().updateMe(user.user_id, {
      full_name: "Moses Mwicigi",
      phone_number: "+254712345678",
      gender: "male",
      city: "Nairobi",
      country_code: "KE",
      date_of_birth: "1992-04-18",
      row_version: 1,
    });

    const me = (await svc().getMe(user.user_id)) as {
      profile: {
        full_name: string; phone_number: string; gender: string; city: string;
        country_code: string; date_of_birth: unknown; is_minor: boolean;
      };
    };
    expect(me.profile.full_name).toBe("Moses Mwicigi");
    expect(me.profile.phone_number).toBe("+254712345678");
    expect(me.profile.gender).toBe("male");
    expect(me.profile.city).toBe("Nairobi");
    expect(me.profile.country_code).toBe("KE");
    expect(me.profile.date_of_birth).toBeTruthy(); // was null before the update; pg returns a Date
    expect(me.profile.is_minor).toBe(false); // trigger recomputed from the new DOB
  });

  it("GET /me requires a token and returns the profile with a valid one", async () => {
    const cong = await createCongregation();
    const user = await createUser({ congregationId: cong, fullName: "Mara" });

    await agent().get("/v1/me").expect(401);

    const res = await agent()
      .get("/v1/me")
      .set("Authorization", bearer({ sub: user.user_id, role: "Student", cong }))
      .expect(200);
    expect(res.body.profile.full_name).toBe("Mara");
  });

  // ---- Email + password login (POST /auth/login) ----
  async function makePwUser(email: string, password: string, status = "active", role = "Admin") {
    const cong = await createCongregation();
    const u = await createUser({ congregationId: cong, role, email });
    const argon2 = (await import("argon2")).default;
    const ph = await argon2.hash(password, { type: argon2.argon2id });
    await testPool().query("UPDATE users SET password_hash=$2, account_status=$3 WHERE user_id=$1", [u.user_id, ph, status]);
    return u.user_id;
  }

  it("signs in with the correct password and mints a session", async () => {
    await makePwUser("pw@dev.local", "s3cret-pass");
    const res = await agent().post("/v1/auth/login").send({ email: "pw@dev.local", password: "s3cret-pass" });
    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.refresh_token).toBeTruthy();
  });

  it("rejects a wrong password and an unknown email with a generic 401", async () => {
    await makePwUser("pw2@dev.local", "right-pass");
    const wrong = await agent().post("/v1/auth/login").send({ email: "pw2@dev.local", password: "nope" });
    expect(wrong.status).toBe(401);
    const unknown = await agent().post("/v1/auth/login").send({ email: "ghost@dev.local", password: "whatever1" });
    expect(unknown.status).toBe(401);
  });

  it("blocks a suspended account (403)", async () => {
    await makePwUser("susp@dev.local", "right-pass", "suspended");
    const res = await agent().post("/v1/auth/login").send({ email: "susp@dev.local", password: "right-pass" });
    expect(res.status).toBe(403);
  });

  it("locks the account after 5 failed logins; even the correct password is then refused (429)", async () => {
    await makePwUser("lock@dev.local", "correct-horse-8");
    for (let i = 0; i < 5; i++) {
      const r = await agent().post("/v1/auth/login").send({ email: "lock@dev.local", password: "wrong" });
      expect([401, 429]).toContain(r.status); // attempts 1–4 → 401, the 5th trips the lock → 429
    }
    const locked = await agent().post("/v1/auth/login").send({ email: "lock@dev.local", password: "correct-horse-8" });
    expect(locked.status).toBe(429); // correct password rejected while locked
  });

  it("a successful login clears the failed-attempt counter", async () => {
    await makePwUser("recover@dev.local", "right-pass-8");
    await agent().post("/v1/auth/login").send({ email: "recover@dev.local", password: "nope" }); // 1 failure
    const ok = await agent().post("/v1/auth/login").send({ email: "recover@dev.local", password: "right-pass-8" });
    expect(ok.status).toBe(200);
    const { rows } = await testPool().query(
      "SELECT failed_login_count, locked_until FROM users WHERE email=$1",
      ["recover@dev.local"],
    );
    expect(rows[0].failed_login_count).toBe(0);
    expect(rows[0].locked_until).toBeNull();
  });

  // ---- Admin-console scope gate (staff-only login) ----
  it("refuses a member (Student) from the admin console under scope=admin, even with the right password (403)", async () => {
    await makePwUser("member@dev.local", "right-pass-9", "active", "Student");
    const res = await agent()
      .post("/v1/auth/login")
      .send({ email: "member@dev.local", password: "right-pass-9", scope: "admin" });
    expect(res.status).toBe(403);
    expect(res.body.access_token).toBeUndefined();
  });

  it("still lets that same member sign into the member app (no scope) → 200", async () => {
    await makePwUser("member2@dev.local", "right-pass-9", "active", "Student");
    const res = await agent().post("/v1/auth/login").send({ email: "member2@dev.local", password: "right-pass-9" });
    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeTruthy();
  });

  it("refuses staff (Instructor) under scope=admin when they hold NO RBAC permission at all (403, clear message)", async () => {
    // Instructor role alone is not enough post-generalization: no rbac_user_roles
    // row means an empty effective permission set — the console would be empty.
    const userId = await makePwUser("inst-bare@dev.local", "right-pass-9", "active", "Instructor");
    const res = await agent()
      .post("/v1/auth/login")
      .send({ email: "inst-bare@dev.local", password: "right-pass-9", scope: "admin" });
    expect(res.status).toBe(403);
    expect(res.body.access_token).toBeUndefined();
    expect(res.body.error.message).toMatch(/doesn't have portal access/i);
    const { rows } = await testPool().query(
      "SELECT action FROM audit_log WHERE actor_id = $1 ORDER BY audit_id DESC LIMIT 1",
      [userId],
    );
    expect(rows[0].action).toBe("user.login_denied_no_permissions");
  });

  it("refuses a freshly-elevated member (is_staff, no role/grant yet) under scope=admin (403)", async () => {
    const userId = await makePwUser("elevated-bare@dev.local", "right-pass-9", "active", "Student");
    await testPool().query("UPDATE users SET is_staff = TRUE WHERE user_id = $1", [userId]);
    const res = await agent()
      .post("/v1/auth/login")
      .send({ email: "elevated-bare@dev.local", password: "right-pass-9", scope: "admin" });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/doesn't have portal access/i);
  });

  it("lets staff (Instructor and up) sign into the admin console under scope=admin once a role is assigned, and returns exactly that role's permission keys", async () => {
    const userId = await makePwUser("inst@dev.local", "right-pass-9", "active", "Instructor");
    // 'discipler' is a seeded RBAC role (08_rbac.sql) with a known, non-empty
    // permission set: dashboard:view, cms:view, videos:view, cells:contribute
    // (view/create/edit/export), members:contribute (same 4), reflections:view,
    // events:view, certificates:view, badges:view.
    await testPool().query(
      "INSERT INTO rbac_user_roles (user_id, role_key) VALUES ($1, 'discipler')",
      [userId],
    );
    const res = await agent()
      .post("/v1/auth/login")
      .send({ email: "inst@dev.local", password: "right-pass-9", scope: "admin" });
    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.permissions).toEqual(
      expect.arrayContaining(["dashboard:view", "cms:view", "videos:view", "reflections:view", "events:view"]),
    );
    expect(res.body.permissions).not.toContain("finance:view");
    expect(res.body.permissions).not.toContain("users:view");
  });

  it("SuperAdmin sees the full permission grid on scope=admin login, with no RBAC role assignment needed", async () => {
    await makePwUser("super@dev.local", "right-pass-9", "active", "SuperAdmin");
    const res = await agent()
      .post("/v1/auth/login")
      .send({ email: "super@dev.local", password: "right-pass-9", scope: "admin" });
    expect(res.status).toBe(200);
    expect(res.body.permissions).toEqual(
      expect.arrayContaining(["dashboard:view", "finance:approve", "users:delete", "rolesAdmin:edit"]),
    );
  });

  it("GET /me surfaces the caller's effective permissions (additive to the profile)", async () => {
    const cong = await createCongregation();
    const user = await createUser({ congregationId: cong, role: "Instructor" });
    await testPool().query(
      "INSERT INTO rbac_user_roles (user_id, role_key) VALUES ($1, 'finance_officer')",
      [user.user_id],
    );
    const me = (await svc().getMe(user.user_id)) as { profile: { permissions: string[] } };
    expect(me.profile.permissions).toEqual(expect.arrayContaining(["finance:view", "finance:edit"]));
    expect(me.profile.permissions).not.toContain("users:view");
  });

  // ---- Self-service register (POST /auth/register) ----
  it("registers a new Student, mints a session, and the account can then log in", async () => {
    const reg = await agent()
      .post("/v1/auth/register")
      .send({ full_name: "Grace New", email: "grace@dev.local", password: "joinme12" });
    expect(reg.status).toBe(201);
    expect(reg.body.access_token).toBeTruthy();
    expect(reg.body.refresh_token).toBeTruthy();

    const { rows } = await testPool().query("SELECT role FROM users WHERE email=$1", ["grace@dev.local"]);
    expect(rows[0].role).toBe("Student"); // self-signup can only create a Student (§5.8)

    // The brand-new credential works at the login endpoint too.
    const login = await agent().post("/v1/auth/login").send({ email: "grace@dev.local", password: "joinme12" });
    expect(login.status).toBe(200);
  });

  it("rejects a duplicate email with 409 and a too-short password with 400", async () => {
    await agent().post("/v1/auth/register").send({ full_name: "Dup One", email: "dup@dev.local", password: "first123" });
    const dup = await agent()
      .post("/v1/auth/register")
      .send({ full_name: "Dup Two", email: "dup@dev.local", password: "second123" });
    expect(dup.status).toBe(409);

    const short = await agent()
      .post("/v1/auth/register")
      .send({ full_name: "Tiny", email: "tiny@dev.local", password: "12345" });
    expect(short.status).toBe(400);
  });

  // ---- Forgot / reset password ----
  it("forgot→reset rotates the password, burns the token, and revokes old sessions", async () => {
    const uid = await makePwUser("reset@dev.local", "old-pass-1");
    const old = await issueRefreshToken(testPool(), uid, env); // a live session before reset

    const forgot = await svc().requestPasswordReset({ email: "reset@dev.local" });
    expect(forgot.sent).toBe(true);
    const token = forgot.dev_token as string; // non-production exposes the raw token
    expect(token).toBeTruthy();

    await svc().resetPassword({ token, new_password: "brand-new-2" });

    // New password works, old one does not.
    await expect(
      svc().loginWithPassword({ email: "reset@dev.local", password: "brand-new-2" }),
    ).resolves.toMatchObject({ token_type: "Bearer" });
    await expect(
      svc().loginWithPassword({ email: "reset@dev.local", password: "old-pass-1" }),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });

    // Token is single-use, and the pre-reset session was revoked.
    await expect(svc().resetPassword({ token, new_password: "again-333" })).rejects.toMatchObject({
      code: "UNPROCESSABLE",
    });
    await expect(rotateRefreshToken(testPool(), old.token, env)).rejects.toThrow();
  });

  it("forgot for an unknown email still reports sent (no enumeration) and issues no token", async () => {
    const res = await svc().requestPasswordReset({ email: "nobody@dev.local" });
    expect(res.sent).toBe(true);
    expect(res.dev_token).toBeUndefined();
    expect(res.dev_code).toBeUndefined();
  });

  // ---- Code-first reset (short human-typeable code alongside the long token) ----
  it("issues an 8-char grouped code (e.g. K7F4-P2XN) alongside the long token", async () => {
    await makePwUser("code-shape@dev.local", "old-pass-1");
    const forgot = await svc().requestPasswordReset({ email: "code-shape@dev.local" });
    expect(forgot.dev_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // Unambiguous alphabet: no I, O, 0, or 1.
    expect(forgot.dev_code).not.toMatch(/[IO01]/);
  });

  it("resets with the short code alone (no token needed), and the code is single-use", async () => {
    await makePwUser("code-reset@dev.local", "old-pass-1");
    const forgot = await svc().requestPasswordReset({ email: "code-reset@dev.local" });
    const code = forgot.dev_code as string;
    expect(code).toBeTruthy();

    await svc().resetPassword({ token: code, new_password: "brand-new-2" });
    await expect(
      svc().loginWithPassword({ email: "code-reset@dev.local", password: "brand-new-2" }),
    ).resolves.toMatchObject({ token_type: "Bearer" });

    // The code is burned — reusing it fails, and so does the paired long token
    // (same row; either credential dies with the other).
    await expect(svc().resetPassword({ token: code, new_password: "again-333" })).rejects.toMatchObject({
      code: "UNPROCESSABLE",
    });
    await expect(
      svc().resetPassword({ token: forgot.dev_token as string, new_password: "again-333" }),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });

  it("normalizes the code — lowercase, without the dash, and with extra whitespace all redeem it", async () => {
    await makePwUser("code-norm@dev.local", "old-pass-1");
    const forgot = await svc().requestPasswordReset({ email: "code-norm@dev.local" });
    const code = forgot.dev_code as string; // e.g. "K7F4-P2XN"
    const messy = `  ${code.toLowerCase().replace("-", "")}  `; // "k7f4p2xn" with padding

    await svc().resetPassword({ token: messy, new_password: "brand-new-2" });
    await expect(
      svc().loginWithPassword({ email: "code-norm@dev.local", password: "brand-new-2" }),
    ).resolves.toMatchObject({ token_type: "Bearer" });
  });

  it("rejects a wrong code with UNPROCESSABLE, and it still costs a token from the shared /v1/auth rate-limit bucket", async () => {
    await makePwUser("code-wrong@dev.local", "old-pass-1");
    await svc().requestPasswordReset({ email: "code-wrong@dev.local" }); // real code left unused

    const api = agent();
    const first = await api.post("/v1/auth/password/reset").send({ token: "ZZZZ-9999", new_password: "whatever1" });
    expect(first.status).toBe(422);
    const remainingAfterFirst = Number(first.headers["x-ratelimit-remaining"]);

    const second = await api.post("/v1/auth/password/reset").send({ token: "ZZZZ-8888", new_password: "whatever1" });
    expect(second.status).toBe(422);
    const remainingAfterSecond = Number(second.headers["x-ratelimit-remaining"]);

    // Every attempt — right or wrong — consumes the same IP-keyed auth bucket
    // (app.ts mounts it on the /v1/auth prefix ahead of the route handler), so
    // a wrong-code guesser can't dodge the limiter that also guards login.
    expect(remainingAfterSecond).toBeLessThan(remainingAfterFirst);
  });

  it("still accepts a previously-issued long token for its TTL (in-flight compat: old links keep working)", async () => {
    const uid = await makePwUser("compat@dev.local", "old-pass-1");
    const old = await issueRefreshToken(testPool(), uid, env);
    const forgot = await svc().requestPasswordReset({ email: "compat@dev.local" });
    const longToken = forgot.dev_token as string;
    expect(longToken).toHaveLength(64); // sha256-hex-length raw token, unchanged shape

    await svc().resetPassword({ token: longToken, new_password: "brand-new-2" });
    await expect(
      svc().loginWithPassword({ email: "compat@dev.local", password: "brand-new-2" }),
    ).resolves.toMatchObject({ token_type: "Bearer" });
    await expect(rotateRefreshToken(testPool(), old.token, env)).rejects.toThrow();
  });

  it("emails a reset link containing the token to the account address (and nothing for unknown emails)", async () => {
    const cong = await createCongregation();
    const u = await createUser({ congregationId: cong, email: "mailme@dev.local" });
    const argon2 = (await import("argon2")).default;
    await testPool().query("UPDATE users SET password_hash=$2 WHERE user_id=$1", [
      u.user_id,
      await argon2.hash("pw-123456", { type: argon2.argon2id }),
    ]);
    const sent: EmailMessage[] = [];
    const fakeMailer: EmailProvider = { send: (m) => { sent.push(m); return Promise.resolve(); } };
    const s = new IdentityService(testPool(), env, fakeMailer);

    const res = await s.requestPasswordReset({ email: "mailme@dev.local" });
    expect(res.sent).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("mailme@dev.local");
    expect(sent[0]!.text).toContain("/reset-password?token=");
    expect(sent[0]!.text).toContain(res.dev_token as string); // link carries the real token
    expect(sent[0]!.text).toContain(res.dev_code as string); // code is the primary, prominent credential
    expect(sent[0]!.text).toContain(`&code=${encodeURIComponent(res.dev_code as string)}`); // link also carries the code
    expect(sent[0]!.subject).toContain(res.dev_code as string); // subject line surfaces the code for a glance

    await s.requestPasswordReset({ email: "ghost@dev.local" }); // unknown → no email
    expect(sent).toHaveLength(1);
  });
});
