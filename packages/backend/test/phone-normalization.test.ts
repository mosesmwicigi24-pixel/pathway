// One phone format, applied at the door (migration 195 + lib/phone.ts).
import { describe, it, expect } from "vitest";
import { normalizePhone, isE164 } from "../src/lib/phone.js";
import { beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";
import { agent, bearer } from "./helpers/app.js";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await closeTestPool(); });

describe("Kenyan numbers reach one canonical form", () => {
  it("treats every spelling of the same number as the same number", () => {
    // This is the whole point: migration 192 compared raw strings and so read
    // 0700529451 and +254700529451 as two different people.
    const spellings = ["0700529451", "+254700529451", "254700529451", "700529451", "0700 529 451", "+254 700-529.451"];
    const normalized = new Set(spellings.map(normalizePhone));
    expect([...normalized]).toEqual(["+254700529451"]);
  });

  it("handles the 01… range, not just 07…", () => {
    expect(normalizePhone("0115688290")).toBe("+254115688290");
    expect(normalizePhone("+254111969971")).toBe("+254111969971");
  });

  it("fixes the bare-254 row that dialled nowhere", () => {
    expect(normalizePhone("254798501690")).toBe("+254798501690");
  });
});

describe("numbers that are not Kenyan are left alone", () => {
  it("preserves an Omani mobile rather than forcing it to +254", () => {
    // Judith Naisenya. A Kenyan working in the Gulf is not an edge case, and a
    // number rewritten to +254 would reach nobody.
    expect(normalizePhone("+96875035055")).toBe("+96875035055");
  });

  it("preserves any other declared country code", () => {
    expect(normalizePhone("+15551234567")).toBe("+15551234567");
    expect(normalizePhone("+447700900123")).toBe("+447700900123");
  });
});

describe("it degrades honestly", () => {
  it("returns null for empty and missing input", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
  });

  it("hands back something unrecognised stripped, not mangled into a wrong number", () => {
    // Better a visibly odd value a human can correct than a plausible-looking
    // number that silently reaches the wrong person.
    expect(normalizePhone("12345")).toBe("12345");
    expect(normalizePhone("not a phone")).toBe("notaphone");
  });

  it("recognises well-formed E.164", () => {
    expect(isE164("+254700529451")).toBe(true);
    expect(isE164("0700529451")).toBe(false);
    expect(isE164(null)).toBe(false);
  });
});

describe("it is applied at the door, not just backfilled once", () => {
  it("normalises what a member types into their own profile", async () => {
    const cong = await createCongregation();
    const u = await createUser({ congregationId: cong, role: "Student", email: "typer@dev.local" });

    // A member typing the number the way Kenyans actually write it.
    const rv = await testPool().query(`SELECT row_version FROM users WHERE user_id = $1`, [u.user_id]);
    const res = await agent()
      .patch("/v1/me")
      .set("Authorization", bearer({ sub: u.user_id, role: "Student", cong }))
      .send({ phone_number: "0700 529 451", row_version: rv.rows[0].row_version });
    expect(res.status).toBeLessThan(300);

    const row = await testPool().query(`SELECT phone_number FROM users WHERE user_id = $1`, [u.user_id]);
    // Migration 195 is a one-off. Without this, tomorrow's edit reintroduces
    // the second format and the dedup problem comes straight back.
    expect(row.rows[0].phone_number).toBe("+254700529451");
  });

  it("does not rewrite a member's foreign number when they edit their profile", async () => {
    const cong = await createCongregation();
    const u = await createUser({ congregationId: cong, role: "Student", email: "gulf@dev.local" });

    const rv2 = await testPool().query(`SELECT row_version FROM users WHERE user_id = $1`, [u.user_id]);
    const res2 = await agent()
      .patch("/v1/me")
      .set("Authorization", bearer({ sub: u.user_id, role: "Student", cong }))
      .send({ phone_number: "+968 7503 5055", row_version: rv2.rows[0].row_version });
    expect(res2.status).toBeLessThan(300);

    const row = await testPool().query(`SELECT phone_number FROM users WHERE user_id = $1`, [u.user_id]);
    expect(row.rows[0].phone_number).toBe("+96875035055");
  });
});
