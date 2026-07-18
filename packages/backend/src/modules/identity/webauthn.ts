// Passkey / WebAuthn sign-in (§5.3 strong auth): platform authenticators
// (Touch ID / Face ID / Windows Hello) as a first-class portal credential.
//
// The cryptographic ceremonies are delegated to @simplewebauthn/server behind
// the WebAuthnVerifier interface, with a Fake for tests (repo rule: external
// mechanisms behind interfaces with fakes — a test can't press a fingerprint
// reader). Challenge issue/store/expiry/replay handling stays REAL in
// WebAuthnService either way, so tests exercise everything but the crypto.
import { randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
import type { Pool } from "pg";
import { z } from "zod";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import type { Env } from "../../config/env.js";
import { ApiError } from "../../http/errors.js";
import { many, maybeOne, one, audit } from "../../db/db.js";
import { IdentityService, type SessionTokens } from "./service.js";
import type { AccessClaims } from "./tokens.js";

/** Relying-party identity: rpID from WEBAUTHN_RP_ID (default: APP_PUBLIC_URL's
 *  hostname), expected origin from WEBAUTHN_ORIGIN (default: its origin). */
export interface RpConfig {
  rpId: string;
  rpName: string;
  origin: string;
}

export function rpConfig(env: Env): RpConfig {
  const base = new URL(env.APP_PUBLIC_URL ?? "http://localhost");
  return {
    rpId: env.WEBAUTHN_RP_ID ?? base.hostname,
    origin: env.WEBAUTHN_ORIGIN ?? base.origin,
    rpName: "Nuru Pathway",
  };
}

/** Options objects are passed through to the browser verbatim; the service only
 *  needs the challenge (stored server-side, single-use, 5-minute TTL). */
export type WebAuthnOptionsJSON = Record<string, unknown> & { challenge: string };

export interface CredentialRef {
  id: string; // base64url credential id
  transports: string[];
}

export interface VerifiedCredential {
  credentialId: string;
  publicKey: string; // base64url COSE key
  counter: number;
  transports: string[];
}

export interface WebAuthnVerifier {
  registrationOptions(input: {
    rp: RpConfig;
    userId: string;
    userName: string;
    excludeCredentials: CredentialRef[];
  }): Promise<WebAuthnOptionsJSON>;
  verifyRegistration(input: {
    rp: RpConfig;
    response: RegistrationResponseJSON;
    expectedChallenge: string;
  }): Promise<VerifiedCredential>;
  authenticationOptions(input: {
    rp: RpConfig;
    allowCredentials: CredentialRef[];
  }): Promise<WebAuthnOptionsJSON>;
  verifyAuthentication(input: {
    rp: RpConfig;
    response: AuthenticationResponseJSON;
    expectedChallenge: string;
    credential: VerifiedCredential;
  }): Promise<{ newCounter: number }>;
}

/** Real adapter over @simplewebauthn/server. Pure crypto — no network, no
 *  secrets; the "external" part it abstracts is the platform authenticator. */
export class SimpleWebAuthnVerifier implements WebAuthnVerifier {
  async registrationOptions(input: {
    rp: RpConfig;
    userId: string;
    userName: string;
    excludeCredentials: CredentialRef[];
  }): Promise<WebAuthnOptionsJSON> {
    const options = await generateRegistrationOptions({
      rpName: input.rp.rpName,
      rpID: input.rp.rpId,
      userName: input.userName,
      // User handle = our user_id (§2 identity), so a resident key maps back.
      userID: new TextEncoder().encode(input.userId),
      attestationType: "none",
      excludeCredentials: input.excludeCredentials.map((c) => ({
        id: c.id,
        transports: c.transports as AuthenticatorTransportFuture[],
      })),
      // Platform authenticator + required user verification: the passkey IS the
      // biometric/PIN gate, which is what lets it stand in for password+TOTP.
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "required",
      },
    });
    return options as unknown as WebAuthnOptionsJSON;
  }

  async verifyRegistration(input: {
    rp: RpConfig;
    response: RegistrationResponseJSON;
    expectedChallenge: string;
  }): Promise<VerifiedCredential> {
    const result = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.rp.origin,
      expectedRPID: input.rp.rpId,
      requireUserVerification: true,
    });
    if (!result.verified || !result.registrationInfo) {
      throw new ApiError("AUTH_REQUIRED", "Passkey attestation could not be verified");
    }
    const cred = result.registrationInfo.credential;
    return {
      credentialId: cred.id,
      publicKey: Buffer.from(cred.publicKey).toString("base64url"),
      counter: cred.counter,
      transports: (cred.transports ?? []) as string[],
    };
  }

  async authenticationOptions(input: {
    rp: RpConfig;
    allowCredentials: CredentialRef[];
  }): Promise<WebAuthnOptionsJSON> {
    const options = await generateAuthenticationOptions({
      rpID: input.rp.rpId,
      allowCredentials: input.allowCredentials.map((c) => ({
        id: c.id,
        transports: c.transports as AuthenticatorTransportFuture[],
      })),
      userVerification: "required",
    });
    return options as unknown as WebAuthnOptionsJSON;
  }

  async verifyAuthentication(input: {
    rp: RpConfig;
    response: AuthenticationResponseJSON;
    expectedChallenge: string;
    credential: VerifiedCredential;
  }): Promise<{ newCounter: number }> {
    const result = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.rp.origin,
      expectedRPID: input.rp.rpId,
      credential: {
        id: input.credential.credentialId,
        publicKey: new Uint8Array(Buffer.from(input.credential.publicKey, "base64url")),
        counter: input.credential.counter,
        transports: input.credential.transports as AuthenticatorTransportFuture[],
      },
      requireUserVerification: true,
    });
    if (!result.verified) throw new ApiError("AUTH_REQUIRED", "Passkey could not be verified");
    return { newCounter: result.authenticationInfo.newCounter };
  }
}

/** Deterministic fake for tests. Trusts the wire SHAPE but does no cryptography:
 *  a response with `fail: true` is rejected, anything else verifies. */
export class FakeWebAuthnVerifier implements WebAuthnVerifier {
  registrationOptions(input: {
    rp: RpConfig;
    userId: string;
    userName: string;
    excludeCredentials: CredentialRef[];
  }): Promise<WebAuthnOptionsJSON> {
    return Promise.resolve({
      challenge: randomBytes(32).toString("base64url"),
      rp: { id: input.rp.rpId, name: input.rp.rpName },
      user: { id: Buffer.from(input.userId).toString("base64url"), name: input.userName, displayName: input.userName },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      excludeCredentials: input.excludeCredentials.map((c) => ({ type: "public-key", id: c.id, transports: c.transports })),
      authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" },
      attestation: "none",
      timeout: 60_000,
    });
  }

  verifyRegistration(input: {
    rp: RpConfig;
    response: RegistrationResponseJSON;
    expectedChallenge: string;
  }): Promise<VerifiedCredential> {
    if ((input.response as { fail?: boolean }).fail === true) {
      throw new ApiError("AUTH_REQUIRED", "Passkey attestation could not be verified");
    }
    return Promise.resolve({
      credentialId: input.response.id,
      publicKey: Buffer.from(`fake-cose-${input.response.id}`).toString("base64url"),
      counter: 0,
      transports: ["internal"],
    });
  }

  authenticationOptions(input: {
    rp: RpConfig;
    allowCredentials: CredentialRef[];
  }): Promise<WebAuthnOptionsJSON> {
    return Promise.resolve({
      challenge: randomBytes(32).toString("base64url"),
      rpId: input.rp.rpId,
      allowCredentials: input.allowCredentials.map((c) => ({ type: "public-key", id: c.id, transports: c.transports })),
      userVerification: "required",
      timeout: 60_000,
    });
  }

  verifyAuthentication(input: {
    rp: RpConfig;
    response: AuthenticationResponseJSON;
    expectedChallenge: string;
    credential: VerifiedCredential;
  }): Promise<{ newCounter: number }> {
    if ((input.response as { fail?: boolean }).fail === true) {
      throw new ApiError("AUTH_REQUIRED", "Passkey could not be verified");
    }
    return Promise.resolve({ newCounter: input.credential.counter + 1 });
  }
}

/** Extract the challenge the authenticator actually signed from the response's
 *  clientDataJSON (plain WebAuthn wire format — provider-agnostic). This is how
 *  the stateless server finds its stored challenge row. */
function challengeFromResponse(response: unknown): string | null {
  try {
    const cd = (response as { response?: { clientDataJSON?: unknown } }).response?.clientDataJSON;
    if (typeof cd !== "string") return null;
    const parsed = JSON.parse(Buffer.from(cd, "base64url").toString("utf8")) as { challenge?: unknown };
    return typeof parsed.challenge === "string" && parsed.challenge.length > 0 ? parsed.challenge : null;
  } catch {
    return null;
  }
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes — one ceremony, not a session

interface CredentialLoginRow {
  credential_id: string;
  public_key: string;
  sign_count: string; // BIGINT arrives as text from pg
  transports: string[];
  user_id: string;
  role: AccessClaims["role"];
  congregation_id: string | null;
  account_status: string;
  is_staff: boolean;
}

export class WebAuthnService {
  constructor(
    private readonly pool: Pool,
    private readonly env: Env,
    private readonly verifier: WebAuthnVerifier = new SimpleWebAuthnVerifier(),
    private readonly identity: IdentityService = new IdentityService(pool, env),
  ) {}

  private rp(): RpConfig {
    return rpConfig(this.env);
  }

  /** Store a freshly-issued challenge; opportunistically sweep expired rows. */
  private async putChallenge(challenge: string, kind: "register" | "login", userId: string | null): Promise<void> {
    await this.pool.query(`DELETE FROM webauthn_challenges WHERE expires_at < now()`);
    await this.pool.query(
      `INSERT INTO webauthn_challenges (challenge, user_id, kind, expires_at) VALUES ($1, $2, $3, $4)`,
      [challenge, userId, kind, new Date(Date.now() + CHALLENGE_TTL_MS)],
    );
  }

  /** Burn a challenge (single-use: DELETE … RETURNING). Unknown, replayed or
   *  expired challenges all collapse to null — the caller rejects them alike. */
  private async consumeChallenge(challenge: string, kind: "register" | "login"): Promise<{ user_id: string | null } | null> {
    const row = await maybeOne<{ user_id: string | null; expires_at: Date }>(
      this.pool,
      `DELETE FROM webauthn_challenges WHERE challenge = $1 AND kind = $2 RETURNING user_id, expires_at`,
      [challenge, kind],
    );
    if (!row || row.expires_at.getTime() < Date.now()) return null;
    return { user_id: row.user_id };
  }

  /** Creation options for enrolling a passkey on the CALLER's account. */
  async registrationOptions(userId: string): Promise<WebAuthnOptionsJSON> {
    const user = await one<{ email: string | null }>(
      this.pool,
      `SELECT email FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    const existing = await many<{ credential_id: string; transports: string[] }>(
      this.pool,
      `SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1`,
      [userId],
    );
    const options = await this.verifier.registrationOptions({
      rp: this.rp(),
      userId,
      userName: user.email ?? userId,
      excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports })),
    });
    await this.putChallenge(options.challenge, "register", userId);
    return options;
  }

  static readonly RegisterVerifySchema = z
    .object({
      response: z.object({ id: z.string().min(1).max(1024) }).passthrough(),
      device_label: z.string().trim().min(1).max(120).optional(),
    })
    .strict();

  /** Verify the attestation and store the credential for the caller. */
  async registrationVerify(
    userId: string,
    input: z.infer<typeof WebAuthnService.RegisterVerifySchema>,
  ): Promise<{ credential_id: string; device_label: string | null; created_at: Date }> {
    const challenge = challengeFromResponse(input.response);
    if (!challenge) throw new ApiError("VALIDATION_FAILED", "Malformed WebAuthn response");
    const stored = await this.consumeChallenge(challenge, "register");
    if (!stored || stored.user_id !== userId) {
      throw new ApiError("AUTH_REQUIRED", "This passkey request has expired — try again");
    }
    let cred: VerifiedCredential;
    try {
      cred = await this.verifier.verifyRegistration({
        rp: this.rp(),
        response: input.response as unknown as RegistrationResponseJSON,
        expectedChallenge: challenge,
      });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError("AUTH_REQUIRED", "Passkey attestation could not be verified");
    }
    const inserted = await maybeOne<{ credential_id: string; device_label: string | null; created_at: Date }>(
      this.pool,
      `INSERT INTO webauthn_credentials (credential_id, user_id, public_key, sign_count, transports, device_label)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (credential_id) DO NOTHING
       RETURNING credential_id, device_label, created_at`,
      [cred.credentialId, userId, cred.publicKey, cred.counter, cred.transports, input.device_label ?? null],
    );
    if (!inserted) throw new ApiError("CONFLICT", "This passkey is already registered");
    await audit(this.pool, userId, "user.passkey_added", "users", userId, {
      credential_id: cred.credentialId,
      device_label: input.device_label ?? null,
    });
    return inserted;
  }

  /** The caller's registered passkeys (Profile ▸ Passkeys). */
  async listCredentials(
    userId: string,
  ): Promise<Array<{ credential_id: string; device_label: string | null; created_at: Date; last_used_at: Date | null }>> {
    return many(
      this.pool,
      `SELECT credential_id, device_label, created_at, last_used_at
         FROM webauthn_credentials WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
  }

  /** Revoke one of the CALLER's passkeys. Owner-scoped: someone else's
   *  credential id is indistinguishable from a missing one (404). */
  async deleteCredential(userId: string, credentialId: string): Promise<void> {
    const res = await this.pool.query(
      `DELETE FROM webauthn_credentials WHERE credential_id = $1 AND user_id = $2`,
      [credentialId, userId],
    );
    if (res.rowCount === 0) throw new ApiError("NOT_FOUND", "No such passkey on this account");
    await audit(this.pool, userId, "user.passkey_removed", "users", userId, { credential_id: credentialId });
  }

  static readonly LoginOptionsSchema = z
    .object({
      email: z.string().email().max(254),
      scope: z.enum(["admin"]).optional(),
    })
    .strict();

  /**
   * Request options for a passkey sign-in. Anti-enumeration: an unknown email,
   * a deleted account, or an account without passkeys all get the SAME
   * well-formed options object with empty allowCredentials — never an error —
   * so this endpoint cannot be used to probe which emails exist.
   */
  async loginOptions(input: z.infer<typeof WebAuthnService.LoginOptionsSchema>): Promise<WebAuthnOptionsJSON> {
    const user = await maybeOne<{ user_id: string }>(
      this.pool,
      `SELECT user_id FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [input.email],
    );
    const creds = user
      ? await many<{ credential_id: string; transports: string[] }>(
          this.pool,
          `SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1`,
          [user.user_id],
        )
      : [];
    const options = await this.verifier.authenticationOptions({
      rp: this.rp(),
      allowCredentials: creds.map((c) => ({ id: c.credential_id, transports: c.transports })),
    });
    // The decoy challenge (no account / no passkeys) is stored with user_id NULL;
    // it can never verify because no credential row will match it.
    await this.putChallenge(options.challenge, "login", user && creds.length > 0 ? user.user_id : null);
    return options;
  }

  static readonly LoginVerifySchema = z
    .object({
      response: z.object({ id: z.string().min(1).max(1024) }).passthrough(),
      scope: z.enum(["admin"]).optional(),
    })
    .strict();

  /**
   * Verify a passkey assertion and mint the SAME session as a password login
   * (IdentityService.issueSession — no parallel token logic).
   *
   * Gates mirror loginWithPassword exactly: suspended accounts are refused, and
   * under scope:"admin" a non-staff member is refused with 403 FORBIDDEN_SCOPE
   * (audited as user.login_denied_scope) — the consoles stay staff-only (§5.4).
   *
   * MFA note: a passkey asserted with userVerification=required is already
   * multi-factor — possession of the enrolled device PLUS the on-device
   * biometric/PIN (something you have + something you are/know). Industry
   * standard (NIST 800-63B AAL2 / FIDO2 guidance) treats this as strong auth,
   * so a passkey sign-in does NOT additionally run the TOTP challenge that
   * password logins trigger for MFA-enabled accounts.
   */
  async loginVerify(input: z.infer<typeof WebAuthnService.LoginVerifySchema>): Promise<SessionTokens> {
    const challenge = challengeFromResponse(input.response);
    if (!challenge) throw new ApiError("VALIDATION_FAILED", "Malformed WebAuthn response");
    const stored = await this.consumeChallenge(challenge, "login");
    if (!stored) throw new ApiError("AUTH_REQUIRED", "This sign-in request has expired — try again");

    const cred = await maybeOne<CredentialLoginRow>(
      this.pool,
      `SELECT c.credential_id, c.public_key, c.sign_count::text AS sign_count, c.transports,
              u.user_id, u.role, u.congregation_id, u.account_status, u.is_staff
         FROM webauthn_credentials c
         JOIN users u ON u.user_id = c.user_id AND u.deleted_at IS NULL
        WHERE c.credential_id = $1`,
      [input.response.id],
    );
    if (!cred) throw new ApiError("AUTH_REQUIRED", "Passkey not recognized");
    // If options were issued for a specific account, the presented credential
    // must belong to it (decoy challenges have user_id NULL and never get here).
    if (stored.user_id !== null && stored.user_id !== cred.user_id) {
      throw new ApiError("AUTH_REQUIRED", "Passkey not recognized");
    }
    if (cred.account_status === "suspended") throw new ApiError("FORBIDDEN_SCOPE", "This account is suspended");

    let result: { newCounter: number };
    try {
      result = await this.verifier.verifyAuthentication({
        rp: this.rp(),
        response: input.response as unknown as AuthenticationResponseJSON,
        expectedChallenge: challenge,
        credential: {
          credentialId: cred.credential_id,
          publicKey: cred.public_key,
          counter: Number(cred.sign_count),
          transports: cred.transports,
        },
      });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError("AUTH_REQUIRED", "Passkey could not be verified");
    }
    await this.pool.query(
      `UPDATE webauthn_credentials SET sign_count = $2, last_used_at = now() WHERE credential_id = $1`,
      [cred.credential_id, result.newCounter],
    );

    // Staff-only console gate — the SAME rule and audit event as password login:
    // checked AFTER the assertion verifies so it never reveals which emails are
    // staff, and server-authoritative so no client can bypass it (§1.1, §5.4).
    if (input.scope === "admin" && !IdentityService.STAFF_ROLES.has(cred.role) && !cred.is_staff) {
      await audit(this.pool, cred.user_id, "user.login_denied_scope", "users", cred.user_id, {
        scope: "admin",
        role: cred.role,
        method: "passkey",
      });
      throw new ApiError(
        "FORBIDDEN_SCOPE",
        "This portal is for staff accounts. Members should sign in with the Nuru Pathway app.",
      );
    }

    await audit(this.pool, cred.user_id, "user.login_passkey", "users", cred.user_id, {
      credential_id: cred.credential_id,
    });
    return this.identity.issueSession({
      user_id: cred.user_id,
      role: cred.role,
      congregation_id: cred.congregation_id,
    });
  }
}
