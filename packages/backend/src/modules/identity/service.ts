// Identity service (spec §1.5, §3.3, §5.3). Provisioning from OAuth, profile
// read/update with optimistic concurrency, and the onboarding intake that
// instantiates the enrollment at Level 1 · Module 1.
import type { Pool } from "pg";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import type { UserRole } from "@nuru/shared";
import type { Env } from "../../config/env.js";
import { ApiError } from "../../http/errors.js";
import { effectivePermissions, permissionKeys } from "../../http/auth.js";
import { many, maybeOne, one, tx, recordChange, audit } from "../../db/db.js";
import { background } from "../../db/background.js";
import {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeFamily,
  signMfaChallenge,
  verifyMfaChallenge,
  generateResetCode,
  normalizeResetCode,
  type AccessClaims,
} from "./tokens.js";
import type { OAuthProfile } from "./oauth.js";
import { generateTotpSecret, otpauthUri, verifyTotp } from "./totp.js";
import { hashPassword, verifyPassword, passwordNeedsRehash } from "./passwords.js";
import { renderPasswordReset } from "./email-templates.js";
import { sealSecret, openSecret } from "./secretbox.js";
import { buildEmailProvider, type EmailProvider } from "./email.js";

export interface SessionTokens {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  /** Present only for a scope="admin" login/passkey-verify: the caller's
   *  granted permission keys ("module:capability"), or the full set for
   *  SuperAdmin/Admin. The member app never sends scope, so this is absent
   *  there. Also mirrored on GET /me so it's available after MFA completion
   *  or a session restore, without re-deriving it client-side. */
  permissions?: string[];
}

/** Returned by password login when the account has 2FA on: the caller must
 *  exchange this short-lived token + a TOTP/recovery code for a real session. */
export interface MfaChallenge {
  mfa_required: true;
  mfa_token: string;
}

export type LoginResult = SessionTokens | MfaChallenge;

const RECOVERY_CODE_COUNT = 10;
// Crockford-ish base32 minus ambiguous chars (no i/l/o/0/1), shown as xxxxx-xxxxx.
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function generateRecoveryCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i += 1) {
    const bytes = randomBytes(10);
    let s = "";
    for (let j = 0; j < 10; j += 1) s += RECOVERY_ALPHABET[bytes[j]! % RECOVERY_ALPHABET.length];
    codes.push(`${s.slice(0, 5)}-${s.slice(5)}`);
  }
  return codes;
}

function normalizeRecovery(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hashRecovery(code: string): string {
  return createHash("sha256").update(normalizeRecovery(code)).digest("hex");
}

interface UserAuthRow {
  user_id: string;
  role: AccessClaims["role"];
  congregation_id: string | null;
}

export class IdentityService {
  constructor(
    private readonly pool: Pool,
    private readonly env: Env,
    private readonly emailer: EmailProvider = buildEmailProvider(env),
  ) {}

  /** Mint a session (access + refresh). The single issuance path shared by every
   *  login flavor — OAuth, password, MFA completion, dev login, and passkey
   *  (WebAuthnService) — so there is never parallel token logic. */
  async issueSession(user: UserAuthRow, deviceId?: string | null): Promise<SessionTokens> {
    // True login telemetry (leadership analytics): every minted session is a
    // front-door entry. Fire-and-forget — a logging hiccup never blocks login —
    // but tracked, so shutdown and the test harness can drain it (background.ts).
    background(this.pool.query(`INSERT INTO auth_events (user_id, kind) VALUES ($1, 'login')`, [user.user_id]));
    const access = signAccessToken(this.env, {
      sub: user.user_id,
      role: user.role,
      cong: user.congregation_id ?? "",
    });
    const refresh = await issueRefreshToken(
      this.pool,
      user.user_id,
      this.env,
      deviceId == null ? {} : { deviceId },
    );
    return {
      access_token: access,
      refresh_token: refresh.token,
      token_type: "Bearer",
      expires_in: this.env.JWT_ACCESS_TTL,
    };
  }

  /** Find-or-create a user from a verified IdP profile, then mint a session. */
  async loginWithOAuth(profile: OAuthProfile): Promise<SessionTokens> {
    const user = await tx(this.pool, async (c) => {
      const existing = await maybeOne<UserAuthRow>(
        c,
        `SELECT u.user_id, u.role, u.congregation_id
           FROM oauth_identities oi JOIN users u ON u.user_id = oi.user_id
          WHERE oi.provider = $1 AND oi.provider_sub = $2 AND u.deleted_at IS NULL`,
        [profile.provider, profile.sub],
      );
      if (existing) return existing;

      // First login: provision a minimal user (intake completes at onboarding).
      const created = await one<UserAuthRow>(
        c,
        `INSERT INTO users (full_name, email, role)
         VALUES ($1, $2, 'Student')
         RETURNING user_id, role, congregation_id`,
        [profile.fullName ?? "New Member", profile.email ?? null],
      );
      await c.query(
        `INSERT INTO oauth_identities (user_id, provider, provider_sub) VALUES ($1,$2,$3)`,
        [created.user_id, profile.provider, profile.sub],
      );
      await audit(c, created.user_id, "user.provisioned", "users", created.user_id, {
        provider: profile.provider,
      });
      return created;
    });
    return this.issueSession(user);
  }

  async refresh(rawToken: string): Promise<SessionTokens> {
    const { userId, refresh } = await rotateRefreshToken(this.pool, rawToken, this.env);
    const user = await one<UserAuthRow>(
      this.pool,
      `SELECT user_id, role, congregation_id FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    const access = signAccessToken(this.env, {
      sub: user.user_id,
      role: user.role,
      cong: user.congregation_id ?? "",
    });
    return {
      access_token: access,
      refresh_token: refresh.token,
      token_type: "Bearer",
      expires_in: this.env.JWT_ACCESS_TTL,
    };
  }

  async logout(rawToken: string): Promise<void> {
    await revokeFamily(this.pool, rawToken);
  }

  /**
   * DEV ONLY. Mint a real session for an already-seeded user, bypassing OAuth so
   * the portal can authenticate locally. Uses the SAME token path as production
   * (issueSession → signAccessToken + issueRefreshToken) — no parallel logic. The
   * route is hard-gated to NODE_ENV !== 'production' and never mounted there.
   */
  // Roles allowed to sign into the admin consoles (web portal + iPad). A self-
  // registered member is always "Student" (see register()/loginWithOAuth), so
  // excluding it keeps members out of the consoles while the member app is open
  // to them. Instructors need the console for the Discipleship Hub.
  static readonly STAFF_ROLES: ReadonlySet<string> = new Set(["Instructor", "Admin", "SuperAdmin"]);

  static readonly LoginSchema = z
    .object({
      email: z.string().email(),
      password: z.string().min(1).max(200),
      // Admin consoles (web portal + iPad) send scope:"admin". Under that scope a
      // self-registered member (Student) is refused — the consoles are staff-only.
      // The member app omits scope and is unaffected (§5.4).
      scope: z.enum(["admin"]).optional(),
    })
    .strict();

  /**
   * Email + password sign-in (argon2id verify, §5.5). Errors are intentionally
   * generic to avoid user enumeration; suspended accounts are blocked. SSO-only
   * accounts (no stored secret) cannot password-login. Mints a normal session.
   */
  // Brute-force lockout (§5.3): lock an account after this many consecutive
  // failed password attempts, for this long. A successful login resets the count.
  static readonly MAX_FAILED_LOGINS = 5;
  static readonly LOCKOUT_MINUTES = 15;

  static readonly ConfirmPassword = z.object({ password: z.string().min(1).max(200) });

  /**
   * Step-up: prove you are the account owner, right now (§5.3).
   *
   * Re-mints the caller's OWN access token with pwd_at = now; requirePasswordStepUp
   * then admits it for a short window. Nothing else about the token changes — same
   * subject, same role, same congregation, and any existing MFA stamp is carried
   * across so confirming a password never quietly downgrades a stronger session.
   *
   * A valid session is not the same claim as "the owner is holding the phone".
   * This is what stands between an unlocked, logged-in handset on a desk and
   * sixty members' private answers to a broadcast.
   *
   * Failures count toward the SAME lockout as login — otherwise this endpoint
   * would be a soft place to guess a password that the front door refuses.
   */
  async confirmPassword(
    userId: string,
    input: z.infer<typeof IdentityService.ConfirmPassword>,
    /** The MFA stamp on the token being replaced — carried across verbatim so
     *  confirming a password never quietly downgrades a stronger session. */
    carry?: { mfa?: boolean; mfaAt?: number },
  ): Promise<{ access_token: string; expires_in: number; confirmed_at: number }> {
    const row = await maybeOne<{
      user_id: string; role: UserRole; congregation_id: string | null;
      password_hash: string | null; account_status: string;
      failed_login_count: number; locked_until: Date | null;
    }>(
      this.pool,
      `SELECT user_id, role, congregation_id, password_hash, account_status, failed_login_count, locked_until
         FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    if (!row || !row.password_hash) throw new ApiError("AUTH_REQUIRED", "Password confirmation unavailable");
    if (row.account_status === "suspended") throw new ApiError("FORBIDDEN_SCOPE", "This account is suspended");
    if (row.locked_until && row.locked_until.getTime() > Date.now()) {
      throw new ApiError("RATE_LIMITED", "Too many failed attempts. Try again later.");
    }
    if (!(await verifyPassword(row.password_hash, input.password))) {
      const next = (row.failed_login_count ?? 0) + 1;
      const lock = next >= IdentityService.MAX_FAILED_LOGINS;
      await this.pool.query(
        `UPDATE users SET failed_login_count = $2, locked_until = $3 WHERE user_id = $1`,
        [row.user_id, lock ? 0 : next, lock ? new Date(Date.now() + IdentityService.LOCKOUT_MINUTES * 60_000) : null],
      );
      throw new ApiError("AUTH_REQUIRED", "That password is not right");
    }
    await this.pool.query(`UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE user_id = $1`, [row.user_id]);
    const confirmedAt = Math.floor(Date.now() / 1000);
    const access = signAccessToken(this.env, {
      sub: row.user_id,
      role: row.role,
      cong: row.congregation_id ?? "",
      pwd_at: confirmedAt,
      ...(carry?.mfa === true ? { mfa: true } : {}),
      ...(typeof carry?.mfaAt === "number" ? { mfa_at: carry.mfaAt } : {}),
    });
    return { access_token: access, expires_in: this.env.JWT_ACCESS_TTL, confirmed_at: confirmedAt };
  }

  async loginWithPassword(input: z.infer<typeof IdentityService.LoginSchema>): Promise<LoginResult> {
    const row = await maybeOne<
      UserAuthRow & {
        password_hash: string | null;
        account_status: string;
        failed_login_count: number;
        locked_until: Date | null;
        mfa_enabled: boolean;
        is_staff: boolean;
      }
    >(
      this.pool,
      `SELECT user_id, role, congregation_id, password_hash, account_status, failed_login_count, locked_until, mfa_enabled, is_staff
         FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [input.email],
    );
    if (!row || !row.password_hash) throw new ApiError("AUTH_REQUIRED", "Invalid email or password");
    if (row.account_status === "suspended") throw new ApiError("FORBIDDEN_SCOPE", "This account is suspended");
    // Account currently locked from prior failures.
    if (row.locked_until && row.locked_until.getTime() > Date.now()) {
      throw new ApiError("RATE_LIMITED", "Too many failed attempts. Try again later or reset your password.");
    }

    if (!(await verifyPassword(row.password_hash, input.password))) {
      const next = (row.failed_login_count ?? 0) + 1;
      const lock = next >= IdentityService.MAX_FAILED_LOGINS;
      // On lock: reset the counter and stamp a cooldown; otherwise just increment.
      await this.pool.query(
        `UPDATE users SET failed_login_count = $2, locked_until = $3 WHERE user_id = $1`,
        [row.user_id, lock ? 0 : next, lock ? new Date(Date.now() + IdentityService.LOCKOUT_MINUTES * 60_000) : null],
      );
      if (lock) {
        await audit(this.pool, row.user_id, "user.login_locked", "users", row.user_id, {});
        throw new ApiError("RATE_LIMITED", "Too many failed attempts. Try again later or reset your password.");
      }
      throw new ApiError("AUTH_REQUIRED", "Invalid email or password");
    }

    // Success: clear any prior failure state.
    if (row.failed_login_count > 0 || row.locked_until) {
      await this.pool.query(
        `UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE user_id = $1`,
        [row.user_id],
      );
    }
    // Transparently migrate legacy/heavier hashes to the current Argon2 profile
    // now that we have the plaintext. Best-effort: never block a valid login.
    if (passwordNeedsRehash(row.password_hash)) {
      try {
        const rehashed = await hashPassword(input.password);
        await this.pool.query(`UPDATE users SET password_hash = $2 WHERE user_id = $1`, [row.user_id, rehashed]);
      } catch {
        /* keep the existing hash; the user is still authenticated */
      }
    }
    // Admin-console scope gate: the web portal / iPad send scope:"admin". Only
    // staff (Instructor and up) OR a member elevated to portal access
    // (users.is_staff) may sign in there; an ordinary self-registered member
    // (Student, not elevated) is refused AFTER the password check, so this never
    // reveals which emails are staff. The member app omits scope, so members still
    // sign into the app normally. Server-authoritative — a client can't bypass it
    // (§1.1, §5.4).
    let grantedPermissions: string[] | undefined;
    if (input.scope === "admin") {
      if (!IdentityService.STAFF_ROLES.has(row.role) && !row.is_staff) {
        await audit(this.pool, row.user_id, "user.login_denied_scope", "users", row.user_id, {
          scope: "admin",
          role: row.role,
        });
        throw new ApiError(
          "FORBIDDEN_SCOPE",
          "This portal is for staff accounts. Members should sign in with the Nuru Pathway app.",
        );
      }
      // Generalized gate: staff role or elevation alone isn't enough — an
      // Instructor with no RBAC role assigned, or a freshly-elevated member
      // (is_staff=TRUE, not yet granted a role or a direct permission), has an
      // EMPTY effective permission set and would land in a console with every
      // sidebar item hidden and every request 403ing. Refuse at the front door
      // instead, with a message that points at the actual fix.
      const perms = await effectivePermissions(this.pool, row.user_id, row.role);
      if (perms.length === 0) {
        await audit(this.pool, row.user_id, "user.login_denied_no_permissions", "users", row.user_id, {
          scope: "admin",
          role: row.role,
        });
        throw new ApiError(
          "FORBIDDEN_SCOPE",
          "This account doesn't have portal access. Ask your administrator.",
        );
      }
      grantedPermissions = permissionKeys(perms);
    }

    // 2FA gate: with a second factor enrolled, the password alone is not enough.
    // Hand back a short-lived challenge instead of a session; the client must
    // complete it via loginCompleteMfa with a TOTP or recovery code (§5.3).
    if (row.mfa_enabled) {
      await audit(this.pool, row.user_id, "user.login_mfa_challenge", "users", row.user_id, {});
      return { mfa_required: true, mfa_token: signMfaChallenge(this.env, row.user_id) };
    }

    const session = await this.issueSession({ user_id: row.user_id, role: row.role, congregation_id: row.congregation_id });
    return grantedPermissions ? { ...session, permissions: grantedPermissions } : session;
  }

  /**
   * Second step of a 2FA login: exchange the challenge token + a TOTP (or
   * one-time recovery) code for a real session. The challenge proves the
   * password step already succeeded; the code proves possession of the factor.
   */
  async loginCompleteMfa(mfaToken: string, code: string): Promise<SessionTokens> {
    const userId = verifyMfaChallenge(this.env, mfaToken);
    const row = await maybeOne<UserAuthRow & { mfa_enabled: boolean; account_status: string }>(
      this.pool,
      `SELECT user_id, role, congregation_id, mfa_enabled, account_status
         FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    if (!row || !row.mfa_enabled) throw new ApiError("AUTH_REQUIRED", "Invalid or expired MFA challenge");
    if (row.account_status === "suspended") throw new ApiError("FORBIDDEN_SCOPE", "This account is suspended");
    if (!(await this.verifySecondFactor(userId, code))) throw new ApiError("AUTH_REQUIRED", "Invalid code");
    return this.issueSession({ user_id: row.user_id, role: row.role, congregation_id: row.congregation_id });
  }

  /**
   * Verify a presented second factor against the stored secret: a live TOTP
   * code, or a one-time recovery code (which is then consumed). Shared by the
   * login-completion and disable flows.
   */
  private async verifySecondFactor(userId: string, code: string): Promise<boolean> {
    const row = await maybeOne<{ mfa_secret: string | null; mfa_recovery_codes: string[] | null }>(
      this.pool,
      `SELECT mfa_secret, mfa_recovery_codes FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    if (!row?.mfa_secret) return false;
    const trimmed = code.trim();
    const secret = openSecret(row.mfa_secret, this.env.JWT_SIGNING_KEY);
    if (/^\d{6,10}$/.test(trimmed) && verifyTotp(secret, trimmed)) return true;
    // Recovery-code path: hash-compare, then consume the used code.
    const target = hashRecovery(trimmed);
    if ((row.mfa_recovery_codes ?? []).includes(target)) {
      await this.pool.query(
        `UPDATE users SET mfa_recovery_codes = array_remove(mfa_recovery_codes, $2) WHERE user_id = $1`,
        [userId, target],
      );
      await audit(this.pool, userId, "mfa.recovery_used", "users", userId, {});
      return true;
    }
    return false;
  }

  /**
   * Turn 2FA off. Requires a fresh TOTP or recovery code (proving the person
   * disabling it still controls the factor), then clears the secret, the
   * enabled flag and any remaining recovery codes. Idempotent when already off.
   */
  async disableMfa(userId: string, code: string): Promise<{ mfa_enabled: false }> {
    const row = await one<{ mfa_enabled: boolean }>(
      this.pool,
      `SELECT mfa_enabled FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    if (!row.mfa_enabled) return { mfa_enabled: false };
    if (!(await this.verifySecondFactor(userId, code))) throw new ApiError("AUTH_REQUIRED", "Invalid code");
    await this.pool.query(
      `UPDATE users SET mfa_enabled = FALSE, mfa_secret = NULL, mfa_enrolled_at = NULL, mfa_recovery_codes = '{}'
         WHERE user_id = $1`,
      [userId],
    );
    await audit(this.pool, userId, "mfa.disabled", "users", userId, {});
    return { mfa_enabled: false };
  }

  static readonly RegisterSchema = z
    .object({
      full_name: z.string().trim().min(1).max(255),
      email: z.string().email().max(254),
      password: z.string().min(8).max(200),
    })
    .strict();

  /**
   * Self-service sign-up (Figma "Create account"). Provisions a Student with a
   * stored argon2id secret and mints a normal session (auto sign-in). Onboarding
   * (cell, DOB, enrollment at L1·M1) is completed later via /me/onboarding. Email
   * is CITEXT UNIQUE — a duplicate is rejected with 409 (constraint also enforces
   * it under a race). Self-signup can only ever create a Student (§5.4, §5.8).
   */
  async register(input: z.infer<typeof IdentityService.RegisterSchema>): Promise<SessionTokens> {
    const hash = await hashPassword(input.password);
    const user = await tx(this.pool, async (c) => {
      const existing = await maybeOne<{ user_id: string }>(
        c,
        `SELECT user_id FROM users WHERE email = $1 AND deleted_at IS NULL`,
        [input.email],
      );
      if (existing) throw new ApiError("CONFLICT", "An account with this email already exists");
      let created: UserAuthRow;
      try {
        created = await one<UserAuthRow>(
          c,
          `INSERT INTO users (full_name, email, password_hash, role)
           VALUES ($1, $2, $3, 'Student')
           RETURNING user_id, role, congregation_id`,
          [input.full_name, input.email, hash],
        );
      } catch (e) {
        // Unique-violation under a concurrent insert collapses to the same 409.
        if ((e as { code?: string }).code === "23505") {
          throw new ApiError("CONFLICT", "An account with this email already exists");
        }
        throw e;
      }
      await c.query(
        `INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [created.user_id],
      );
      // Registering IS joining the pathway. Until 2026-08-14 it was not: the
      // only code that created an enrollment was POST /v1/me/onboarding, and
      // `SELECT count(*) FROM audit_log WHERE action='user.onboarded'` returned
      // 0 in production — no client has ever called it. Every enrollment that
      // exists was minted by a human in the portal via enrollment.start_set.
      //
      // So a member who downloaded the app and signed up got an account and no
      // pathway, silently, and waited for an admin who was never told they were
      // waiting. Twenty-eight of them, the longest for 42 days (migration 193
      // is the backfill). An account with no enrollment is not a state this
      // product has any meaning for, so it must not be reachable.
      //
      // Level 1 / active is the ordinary entry point; a leader can still set a
      // different start level afterwards through the portal, which writes
      // start_level / start_module_sequence and moves current_level with it.
      // Same transaction as the user row: either a member exists with a pathway,
      // or they do not exist.
      const enrollment = await one<{ enrollment_id: string }>(
        c,
        `INSERT INTO enrollments (user_id, current_level, state) VALUES ($1, 1, 'active')
         RETURNING enrollment_id`,
        [created.user_id],
      );
      await recordChange(c, "enrollments", enrollment.enrollment_id, created.user_id, "upsert");
      await audit(c, created.user_id, "user.registered", "users", created.user_id, { self_signup: true });
      return created;
    });
    return this.issueSession(user);
  }

  static readonly ForgotPasswordSchema = z.object({ email: z.string().email().max(254) }).strict();

  /**
   * Request a password-reset link (Figma "Reset password"). Always reports success
   * to avoid account enumeration; only accounts that actually have a password get a
   * token. We persist the SHA-256 of a single-use 30-minute token (never the raw
   * value) — plus the SHA-256 of a short human-typeable CODE (e.g. "K7F4-P2XN")
   * redeeming the same row, so a member on a phone can key eight characters
   * into the app instead of pasting a 64-char hex string. With no email
   * provider wired, non-production returns both raw credentials so the flow is
   * testable end-to-end; production would deliver them by email instead.
   */
  async requestPasswordReset(
    input: z.infer<typeof IdentityService.ForgotPasswordSchema>,
  ): Promise<{ sent: true; dev_token?: string; dev_code?: string }> {
    const row = await maybeOne<{ user_id: string; password_hash: string | null; full_name: string | null; role: string; is_staff: boolean }>(
      this.pool,
      `SELECT user_id, password_hash, full_name, role, is_staff FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [input.email],
    );
    if (!row || !row.password_hash) return { sent: true };
    // Staff (portal users) reset on the web, so they get the reset LINK; members
    // never sign in to the portal, so they get a code-only email (no link to a
    // backend they can't use) and enter the code in the Nuru Place app.
    const isStaff = IdentityService.STAFF_ROLES.has(row.role) || row.is_staff;
    const raw = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(raw).digest("hex");
    const code = generateResetCode();
    const codeHash = createHash("sha256").update(normalizeResetCode(code) as string).digest("hex");
    const expires = new Date(Date.now() + 30 * 60 * 1000);
    await this.pool.query(
      `INSERT INTO password_resets (user_id, token_hash, code_hash, expires_at) VALUES ($1, $2, $3, $4)`,
      [row.user_id, tokenHash, codeHash, expires],
    );
    await audit(this.pool, row.user_id, "user.password_reset_requested", "users", row.user_id, {});

    // Email the code (primary) + link to the account address. The link carries
    // the code too (query string) so the reset page can show it big and
    // copyable for pasting into the mobile app. Best-effort: a delivery
    // failure must not change the (no-enumeration) response, so we never
    // surface it.
    const firstName = row.full_name?.trim().split(/\s+/)[0];
    const email = renderPasswordReset({
      code,
      // Link only for staff; members get a code-only email.
      ...(isStaff ? { link: `${this.env.APP_PUBLIC_URL}/reset-password?token=${raw}&code=${encodeURIComponent(code)}` } : {}),
      minutes: 30,
      ...(firstName ? { name: firstName } : {}),
    });
    try {
      await this.emailer.send({ to: input.email, ...email });
    } catch {
      /* best-effort delivery */
    }
    return this.env.NODE_ENV === "production" ? { sent: true } : { sent: true, dev_token: raw, dev_code: code };
  }

  // `token` doubles as the credential field for BOTH the long link token and
  // the short code (kept as one field so the mobile apps' existing "paste the
  // token from your email" input works unchanged with either). min(6) admits
  // the shortest code shape (8 chars, no dash); resetPassword tells them apart
  // by trying both hashes.
  static readonly ResetPasswordSchema = z
    .object({ token: z.string().min(6).max(200), new_password: z.string().min(8).max(200) })
    .strict();

  /**
   * Consume a reset token OR reset code and set a new password. Whichever
   * credential was presented must be unused and unexpired; it is burned on
   * use (both the token and the code on that row die together, so a member
   * can't reuse the other form of the same request either). All
   * refresh-token families are revoked so any session opened with the old
   * (possibly compromised) credential dies.
   */
  async resetPassword(
    input: z.infer<typeof IdentityService.ResetPasswordSchema>,
  ): Promise<{ reset: true }> {
    const tokenHash = createHash("sha256").update(input.token).digest("hex");
    const normalizedCode = normalizeResetCode(input.token);
    const codeHash = normalizedCode ? createHash("sha256").update(normalizedCode).digest("hex") : null;
    const newHash = await hashPassword(input.new_password);
    await tx(this.pool, async (c) => {
      const reset = await maybeOne<{ reset_id: string; user_id: string }>(
        c,
        `SELECT reset_id, user_id FROM password_resets
          WHERE (token_hash = $1 OR (code_hash IS NOT NULL AND code_hash = $2))
            AND used_at IS NULL AND expires_at > now()
          FOR UPDATE`,
        [tokenHash, codeHash],
      );
      if (!reset) throw new ApiError("UNPROCESSABLE", "This reset code or link is invalid or has expired");
      await c.query(
        `UPDATE users SET password_hash = $2, failed_login_count = 0, locked_until = NULL, updated_at = now() WHERE user_id = $1`,
        [reset.user_id, newHash],
      );
      await c.query(`UPDATE password_resets SET used_at = now() WHERE reset_id = $1`, [reset.reset_id]);
      await c.query(
        `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
        [reset.user_id],
      );
      await audit(c, reset.user_id, "user.password_reset", "users", reset.user_id, {});
    });
    return { reset: true };
  }

  async devLogin(input: { email?: string | undefined; user_id?: string | undefined }): Promise<SessionTokens> {
    const byId = Boolean(input.user_id);
    const key = input.user_id ?? input.email;
    if (!key) throw new ApiError("VALIDATION_FAILED", "email or user_id is required");
    const user = await maybeOne<UserAuthRow>(
      this.pool,
      `SELECT user_id, role, congregation_id FROM users
        WHERE ${byId ? "user_id = $1" : "email = $1"} AND deleted_at IS NULL`,
      [key],
    );
    if (!user) throw new ApiError("NOT_FOUND", "No such user");
    return this.issueSession(user);
  }

  /**
   * Begin TOTP enrollment (§5.3): generate a secret, seal it at rest, and return
   * the otpauth:// URI for the authenticator app. The factor is not yet enabled —
   * it activates only when the first code is verified (verifyMfa), so a dropped
   * enrollment can never lock the user out of step-up.
   */
  async enrollMfa(userId: string): Promise<{ otpauth_uri: string; secret: string }> {
    const user = await one<{ email: string | null }>(
      this.pool,
      `SELECT email FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    const secret = generateTotpSecret();
    await this.pool.query(
      `UPDATE users SET mfa_secret = $1, mfa_enabled = FALSE, mfa_enrolled_at = NULL WHERE user_id = $2`,
      [sealSecret(secret, this.env.JWT_SIGNING_KEY), userId],
    );
    await audit(this.pool, userId, "mfa.enroll_started", "users", userId, {});
    return { otpauth_uri: otpauthUri(secret, user.email ?? userId), secret };
  }

  /**
   * Verify a TOTP code and return an MFA-elevated access token (carries the
   * mfa/mfa_at claim the requireStepUp guard checks). Confirms enrollment on the
   * first valid code. The refresh token is unchanged — this elevates the session,
   * it does not replace it; elevation expires with the short access token.
   */
  async verifyMfa(
    userId: string,
    code: string,
  ): Promise<{
    access_token: string;
    token_type: "Bearer";
    expires_in: number;
    mfa_enabled: boolean;
    recovery_codes?: string[];
  }> {
    const row = await one<{
      role: AccessClaims["role"];
      congregation_id: string | null;
      mfa_secret: string | null;
      mfa_enabled: boolean;
    }>(
      this.pool,
      `SELECT role, congregation_id, mfa_secret, mfa_enabled
         FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    if (!row.mfa_secret) throw new ApiError("VALIDATION_FAILED", "MFA is not enrolled");
    const secret = openSecret(row.mfa_secret, this.env.JWT_SIGNING_KEY);
    if (!verifyTotp(secret, code)) throw new ApiError("AUTH_REQUIRED", "Invalid MFA code");

    // First successful verify activates the factor and mints one-time recovery
    // codes — returned ONCE here (only their hashes are stored) so the member can
    // save them before they vanish. Re-verifying an already-enabled factor (admin
    // step-up) issues no new codes.
    let recoveryCodes: string[] | undefined;
    if (!row.mfa_enabled) {
      recoveryCodes = generateRecoveryCodes();
      await this.pool.query(
        `UPDATE users SET mfa_enabled = TRUE, mfa_enrolled_at = now(), mfa_recovery_codes = $2 WHERE user_id = $1`,
        [userId, recoveryCodes.map(hashRecovery)],
      );
      await audit(this.pool, userId, "mfa.enabled", "users", userId, {});
    }

    const access = signAccessToken(this.env, {
      sub: userId,
      role: row.role,
      cong: row.congregation_id ?? "",
      mfa: true,
      mfa_at: Math.floor(Date.now() / 1000),
    });
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: this.env.JWT_ACCESS_TTL,
      mfa_enabled: true,
      ...(recoveryCodes ? { recovery_codes: recoveryCodes } : {}),
    };
  }

  async getMe(userId: string): Promise<unknown> {
    const profile = await one<{ user_id: string; role: string } & Record<string, unknown>>(
      this.pool,
      `SELECT u.user_id, u.email, u.full_name, u.phone_number, u.date_of_birth, u.year_of_salvation,
              u.is_baptized, u.cell_group_id, u.congregation_id, u.role, u.timezone, u.locale, u.is_minor,
              u.gender, u.city, u.country_code, u.socials, u.avatar_url, u.row_version, u.created_at, u.account_status, u.require_2fa, u.mfa_enabled,
              COALESCE(array_agg(ur.role_key) FILTER (WHERE ur.role_key IS NOT NULL), '{}') AS role_keys
         FROM users u
         LEFT JOIN rbac_user_roles ur ON ur.user_id = u.user_id
        WHERE u.user_id = $1 AND u.deleted_at IS NULL
        GROUP BY u.user_id`,
      [userId],
    );
    const enrollment = await maybeOne(
      this.pool,
      `SELECT enrollment_id, current_level, state, started_at FROM enrollments WHERE user_id = $1`,
      [userId],
    );
    // Additive: the caller's granted permission keys ("module:capability"), or
    // the full set for SuperAdmin/Admin. Present for every profile (member app
    // included) — a Student not elevated to the console simply gets an empty
    // array, since effectivePermissions() returns nothing for a role with no
    // RBAC assignment. Lets the web/iPad shells show only the sidebar items a
    // user can actually use, even after a session restore or MFA completion
    // that skipped the login response.
    const perms = await effectivePermissions(this.pool, profile.user_id, profile.role);
    return { profile: { ...profile, permissions: permissionKeys(perms) }, enrollment };
  }

  /** The caller's own recent portal actions (Profile ▸ My Activity), from the audit log. */
  async myActivity(userId: string): Promise<unknown[]> {
    return many(
      this.pool,
      `SELECT audit_id, action, entity, entity_id, occurred_at
         FROM audit_log WHERE actor_id = $1
        ORDER BY audit_id DESC LIMIT 20`,
      [userId],
    );
  }

  // ---- Notification preferences (member Settings; iOS contract — do not rename) ----

  static readonly NotificationPreferencesSchema = z
    .object({
      push_enabled: z.boolean(),
      email_enabled: z.boolean(),
      sms_enabled: z.boolean(),
    })
    .strict();

  /** Channel toggles; table defaults (push/email on, sms off) when no row exists. */
  async getNotificationPreferences(userId: string): Promise<{ push_enabled: boolean; email_enabled: boolean; sms_enabled: boolean }> {
    const row = await maybeOne<{ push_enabled: boolean; email_enabled: boolean; sms_enabled: boolean }>(
      this.pool,
      `SELECT push_enabled, email_enabled, sms_enabled FROM notification_preferences WHERE user_id = $1`,
      [userId],
    );
    return row ?? { push_enabled: true, email_enabled: true, sms_enabled: false };
  }

  /** Upsert the three channel toggles; quiet hours / caps keep their values. */
  async putNotificationPreferences(
    userId: string,
    input: z.infer<typeof IdentityService.NotificationPreferencesSchema>,
  ): Promise<{ push_enabled: boolean; email_enabled: boolean; sms_enabled: boolean }> {
    return one<{ push_enabled: boolean; email_enabled: boolean; sms_enabled: boolean }>(
      this.pool,
      `INSERT INTO notification_preferences (user_id, push_enabled, email_enabled, sms_enabled)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET
         push_enabled = EXCLUDED.push_enabled,
         email_enabled = EXCLUDED.email_enabled,
         sms_enabled = EXCLUDED.sms_enabled
       RETURNING push_enabled, email_enabled, sms_enabled`,
      [userId, input.push_enabled, input.email_enabled, input.sms_enabled],
    );
  }

  static readonly UpdateMeSchema = z
    .object({
      full_name: z.string().min(1).max(255).optional(),
      phone_number: z.string().min(3).max(32).optional(),
      cell_group_id: z.string().uuid().nullable().optional(),
      timezone: z.string().max(64).optional(),
      locale: z.string().max(12).optional(),
      gender: z.enum(["male", "female", "prefer_not_to_say"]).nullable().optional(),
      city: z.string().max(120).nullable().optional(),
      country_code: z.string().length(2).nullable().optional(),
      date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      socials: z.record(z.string().max(200)).optional(), // {instagram, x, facebook, ...}
      avatar_url: z.string().url().max(500).nullable().optional(), // profile photo (set via POST /me/avatar)
      row_version: z.number().int().positive(),
    })
    .strict(); // mass-assignment guard (§5.8): role/congregation_id are not writable
    // email is intentionally not writable here — it is the login identity (§5.8).

  /** Update mutable profile fields with an optimistic-concurrency version check. */
  async updateMe(userId: string, input: z.infer<typeof IdentityService.UpdateMeSchema>): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      for (const field of ["full_name", "phone_number", "cell_group_id", "timezone", "locale", "gender", "city", "country_code", "date_of_birth", "socials", "avatar_url"] as const) {
        if (field in input && input[field] !== undefined) {
          sets.push(`${field} = $${i++}`);
          params.push(field === "socials" ? JSON.stringify(input[field]) : input[field]);
        }
      }
      sets.push(`row_version = row_version + 1`, `updated_at = now()`);
      params.push(userId, input.row_version);
      const updated = await maybeOne<{ user_id: string; row_version: number }>(
        c,
        `UPDATE users SET ${sets.join(", ")}
           WHERE user_id = $${i++} AND row_version = $${i} AND deleted_at IS NULL
         RETURNING user_id, row_version`,
        params,
      );
      if (!updated) {
        const current = await maybeOne<{ row_version: number }>(
          c,
          `SELECT row_version FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
          [userId],
        );
        if (!current) throw new ApiError("NOT_FOUND", "User not found");
        throw new ApiError("VERSION_STALE", "Profile was modified; re-merge and retry", {
          current_row_version: current.row_version,
        });
      }
      await recordChange(c, "users", userId, userId, "upsert");
      return updated;
    });
  }

  static readonly ChangePasswordSchema = z
    .object({
      current_password: z.string().min(1).max(200),
      new_password: z.string().min(8).max(200),
    })
    .strict();

  /**
   * Change the account password (B6 Profile). Requires the current password
   * (argon2id verify, §5.5); SSO-only accounts have no stored secret and are
   * directed to their provider instead. All refresh-token families are revoked
   * so stolen sessions die with the old credential.
   */
  async changePassword(
    userId: string,
    input: z.infer<typeof IdentityService.ChangePasswordSchema>,
  ): Promise<{ changed: boolean }> {
    const row = await maybeOne<{ password_hash: string | null }>(
      this.pool,
      `SELECT password_hash FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    if (!row) throw new ApiError("NOT_FOUND", "User not found");
    if (!row.password_hash) {
      throw new ApiError("UNPROCESSABLE", "This account signs in with a provider and has no password");
    }
    if (!(await verifyPassword(row.password_hash, input.current_password))) {
      throw new ApiError("FORBIDDEN_SCOPE", "Current password is incorrect");
    }
    const newHash = await hashPassword(input.new_password);
    await this.pool.query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE user_id = $1`, [
      userId,
      newHash,
    ]);
    // Old sessions die with the old credential: revoke every refresh chain.
    await this.pool.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    await audit(this.pool, userId, "user.password_changed", "users", userId, {});
    return { changed: true };
  }

  static readonly OnboardingSchema = z
    .object({
      date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      phone_number: z.string().min(3).max(32),
      cell_group_id: z.string().uuid(),
      year_of_salvation: z.number().int().min(1900).max(2100).optional(),
      is_baptized: z.boolean().default(false),
      timezone: z.string().max(64).optional(),
    })
    .strict();

  /**
   * Baseline intake (§3.3). Sets the required profile fields, derives the
   * congregation from the chosen cell, and instantiates the enrollment at L1·M1.
   * Idempotent: a member who already has an enrollment is returned as-is.
   */
  async onboard(userId: string, input: z.infer<typeof IdentityService.OnboardingSchema>): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const cell = await maybeOne<{ congregation_id: string }>(
        c,
        `SELECT congregation_id FROM cell_groups WHERE cell_group_id = $1`,
        [input.cell_group_id],
      );
      if (!cell) throw new ApiError("VALIDATION_FAILED", "Unknown cell_group_id");

      await c.query(
        `UPDATE users SET date_of_birth = $1, phone_number = $2, cell_group_id = $3,
                          congregation_id = $4, year_of_salvation = $5, is_baptized = $6,
                          timezone = COALESCE($7, timezone), row_version = row_version + 1
           WHERE user_id = $8 AND deleted_at IS NULL`,
        [
          input.date_of_birth,
          input.phone_number,
          input.cell_group_id,
          cell.congregation_id,
          input.year_of_salvation ?? null,
          input.is_baptized,
          input.timezone ?? null,
          userId,
        ],
      );

      const existing = await maybeOne<{ enrollment_id: string }>(
        c,
        `SELECT enrollment_id FROM enrollments WHERE user_id = $1`,
        [userId],
      );
      if (existing) return { enrollment_id: existing.enrollment_id, already_onboarded: true };

      const enrollment = await one<{ enrollment_id: string }>(
        c,
        `INSERT INTO enrollments (user_id, current_level, state) VALUES ($1, 1, 'active')
         RETURNING enrollment_id`,
        [userId],
      );
      // Notification prefs default row so the nudge cadence has somewhere to read.
      await c.query(
        `INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [userId],
      );
      await recordChange(c, "enrollments", enrollment.enrollment_id, userId, "upsert");
      await audit(c, userId, "user.onboarded", "enrollments", enrollment.enrollment_id, {});
      return { enrollment_id: enrollment.enrollment_id, current_level: 1, already_onboarded: false };
    });
  }

  async registerDevice(
    userId: string,
    input: {
      platform: string;
      app_version?: string | undefined;
      model?: string | undefined;
      push_token?: string | undefined;
      network?: string | undefined;
    },
  ): Promise<{ device_id: string }> {
    return tx(this.pool, async (c) => {
      // One row per (user, platform, model): clients register on every launch,
      // so this must refresh, not accumulate — the census reads app_version
      // and last_seen_at from the single live row.
      const device = await one<{ device_id: string }>(
        c,
        `INSERT INTO client_devices (user_id, platform, app_version, model, network, last_seen_at)
         VALUES ($1,$2,$3,$4,$5, now())
         ON CONFLICT (user_id, platform, COALESCE(model, ''))
         DO UPDATE SET app_version = EXCLUDED.app_version,
                       network = COALESCE(EXCLUDED.network, client_devices.network),
                       last_seen_at = now()
         RETURNING device_id`,
        [userId, input.platform, input.app_version ?? null, input.model ?? null, input.network ?? null],
      );
      if (input.push_token) {
        await c.query(
          `INSERT INTO push_tokens (user_id, platform, token) VALUES ($1,$2,$3)
           ON CONFLICT (token) DO UPDATE SET is_active = TRUE, updated_at = now()`,
          [userId, input.platform, input.push_token],
        );
      }
      return device;
    });
  }
}
