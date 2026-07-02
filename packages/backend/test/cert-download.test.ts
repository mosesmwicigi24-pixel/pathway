// GET /media/certificates/{code} — the download route the /certificates list
// points at. Session required; owner OR Instructor+ only; PDF streamed from the
// object store; 404 envelope when the cert or the rendered object is missing.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { pino } from "pino";
import supertest from "supertest";
import { createApp } from "../src/http/app.js";
import { CertificateService } from "../src/modules/certificates/service.js";
import { InMemoryObjectStore } from "../src/modules/certificates/objectStore.js";
import { testEnv, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";

// One shared store: issuance renders into it and the download route reads from it
// (in production both sides share disk under MEDIA_STORAGE_DIR).
const store = new InMemoryObjectStore();
const app = supertest(
  createApp({
    env: testEnv(),
    db: { primary: testPool(), replica: testPool() },
    log: pino({ level: "silent" }),
    objectStore: store,
  }),
);
const issuer = () => new CertificateService(testPool(), "test-signing-key", store);
const auth = (t: string) => ({ Authorization: t });

// superagent doesn't buffer application/pdf by default — collect the raw bytes.
const pdfParser = (res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void): void => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};

let cong: string, owner: string, ownerTok: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  const o = await createUser({ congregationId: cong, fullName: "Grace M.", email: "owner@dev.local" });
  owner = o.user_id;
  ownerTok = bearer({ sub: owner, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

describe("GET /media/certificates/{code}", () => {
  it("streams the PDF to the owner (attachment, application/pdf)", async () => {
    const { verification_code } = await issuer().issue(owner, 1);
    const res = await app
      .get(`/v1/media/certificates/${verification_code}`)
      .set(auth(ownerTok))
      .buffer(true)
      .parse(pdfParser);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain(verification_code);
    expect((res.body as Buffer).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("requires a session (401 without a token)", async () => {
    const { verification_code } = await issuer().issue(owner, 1);
    const res = await app.get(`/v1/media/certificates/${verification_code}`);
    expect(res.status).toBe(401);
  });

  it("403s another member, but allows Instructor+", async () => {
    const { verification_code } = await issuer().issue(owner, 1);
    const other = await createUser({ congregationId: cong, email: "other@dev.local" });
    const staff = await createUser({ congregationId: cong, role: "Instructor", email: "staff@dev.local" });

    const denied = await app
      .get(`/v1/media/certificates/${verification_code}`)
      .set(auth(bearer({ sub: other.user_id, role: "Student", cong })));
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FORBIDDEN_SCOPE");

    const allowed = await app
      .get(`/v1/media/certificates/${verification_code}`)
      .set(auth(bearer({ sub: staff.user_id, role: "Instructor", cong })));
    expect(allowed.status).toBe(200);
    expect(allowed.headers["content-type"]).toContain("application/pdf");
  });

  it("404s an unknown code with the standard envelope", async () => {
    const res = await app.get("/v1/media/certificates/NO-SUCH-CODE").set(auth(ownerTok));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(typeof res.body.error.request_id).toBe("string");
  });

  it("404s when the certificate exists but the PDF object is missing", async () => {
    // Issue WITHOUT a store — the row exists, the object was never rendered.
    const bare = new CertificateService(testPool(), "test-signing-key");
    const { verification_code } = await bare.issue(owner, 2);
    const res = await app.get(`/v1/media/certificates/${verification_code}`).set(auth(ownerTok));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
