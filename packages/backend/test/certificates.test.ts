// Certificates — idempotent issuance + tamper-evident public verification (§5.5).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { CertificateService } from "../src/modules/certificates/service.js";

const svc = () => new CertificateService(testPool(), "test-cert-signing-key");

describe("certificates (§5.5)", () => {
  let user: string;

  beforeEach(async () => {
    await resetDb();
    const cong = await createCongregation();
    user = (await createUser({ congregationId: cong, fullName: "Grace M." })).user_id;
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("issues idempotently (one per user+level)", async () => {
    const a = await svc().issue(user, 1);
    const b = await svc().issue(user, 1);
    expect(b.certificate_id).toBe(a.certificate_id);
    const { rows } = await testPool().query("SELECT count(*)::int n FROM certificates");
    expect(rows[0].n).toBe(1);
  });

  it("verifies a genuine certificate", async () => {
    const { verification_code } = await svc().issue(user, 2);
    const result = (await svc().verify(verification_code)) as {
      valid: boolean;
      recipient_name: string;
      level_number: number;
    };
    expect(result.valid).toBe(true);
    expect(result.recipient_name).toBe("Grace M.");
    expect(result.level_number).toBe(2);
  });

  it("flags a tampered certificate as invalid", async () => {
    const { verification_code } = await svc().issue(user, 1);
    await testPool().query("UPDATE certificates SET signature = 'deadbeef' WHERE verification_code = $1", [
      verification_code,
    ]);
    const result = (await svc().verify(verification_code)) as { valid: boolean };
    expect(result.valid).toBe(false);
  });

  it("404s an unknown code", async () => {
    await expect(svc().verify("NOPE")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists the caller's certificates with a download reference", async () => {
    await svc().issue(user, 1);
    const list = (await svc().listForUser(user)) as Array<{ download_url: string }>;
    expect(list).toHaveLength(1);
    expect(list[0]!.download_url).toContain("/media/certificates/");
  });
});
