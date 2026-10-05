// "Ask to be connected" — finding a cell (owner, 2026-10-05; EXPERIENCE.md
// §9.2 #12). 37 of 76 members in production had no cell, and "Find your cell"
// led nowhere. The member says where they live and when they're free; the
// request goes to THEIR pastor in their own pastoral thread — nobody new sees
// the member's area, and no list of cells or homes is shown to members.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, closeTestPool, testPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser } from "./helpers/factories.js";

let cong: string, cell: string;
const memberTok = (sub: string) => bearer({ sub, role: "Student", cong });
const ask = (tok: string, body: Record<string, unknown>) =>
  agent().post("/v1/me/cell-connection").set("Authorization", tok).send(body);
const status = (tok: string) => agent().get("/v1/me/cell-connection").set("Authorization", tok);

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  cell = await createCellGroup(cong);
  // The congregation's fallback pastor (no explicit assignment) receives it.
  await createUser({ congregationId: cong, role: "SuperAdmin", email: "cc-super@dev.local", fullName: "Pastor Fallback" });
});
afterAll(async () => {
  await closeTestPool();
});

describe("ask to be connected to a cell", () => {
  it("goes to the member's own pastor, in their pastoral thread, and the app can say when they asked", async () => {
    const ben = (await createUser({ congregationId: cong, email: "cc-ben@dev.local", fullName: "Ben" })).user_id;
    const tok = memberTok(ben);
    expect((await status(tok)).body).toEqual({ in_cell: false, request: null });

    const res = await ask(tok, { area: "Kasarani", availability: "Wednesday evenings", client_mutation_id: randomUUID() });
    expect(res.status).toBe(201);
    const { rows } = await testPool().query<{ body: string; meta: { kind: string; area: string }; kind: string; type: string }>(
      `SELECT m.body, m.attachment_meta AS meta, c.kind, c.type
         FROM chat_messages m JOIN chat_conversations c ON c.conversation_id = m.conversation_id
        WHERE m.author_user_id = $1`,
      [ben],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toBe("I'd like to join a cell. I live in Kasarani, and I'm free Wednesday evenings.");
    expect(rows[0]!.meta).toMatchObject({ kind: "cell_request", area: "Kasarani" });
    expect(res.body.conversation_id).toBeTruthy();

    const after = (await status(tok)).body;
    expect(after.in_cell).toBe(false);
    expect(after.request.conversation_id).toBe(res.body.conversation_id);
    expect(new Date(after.request.requested_at).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("a replay of the same request is one message, not two", async () => {
    const ben = (await createUser({ congregationId: cong, email: "cc-ben2@dev.local", fullName: "Ben" })).user_id;
    const tok = memberTok(ben);
    const body = { area: "Kasarani", availability: "Sundays after service", client_mutation_id: randomUUID() };
    expect((await ask(tok, body)).status).toBe(201);
    expect((await ask(tok, body)).status).toBe(201);
    const { rows } = await testPool().query(`SELECT 1 FROM chat_messages WHERE author_user_id = $1`, [ben]);
    expect(rows).toHaveLength(1);
  });

  it("a member already in a cell is told so, in words", async () => {
    const ada = (await createUser({ congregationId: cong, cellGroupId: cell, email: "cc-ada@dev.local", fullName: "Ada" })).user_id;
    const res = await ask(memberTok(ada), { area: "Kasarani", availability: "Fridays", client_mutation_id: randomUUID() });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe("You're already in a cell.");
    expect((await status(memberTok(ada))).body).toEqual({ in_cell: true, request: null });
  });

  it("a minor is pointed to a parent or guardian — direct messages stay closed to minors", async () => {
    const kid = (await createUser({ congregationId: cong, email: "cc-kid@dev.local", fullName: "Kid", dateOfBirth: "2015-01-01" })).user_id;
    const res = await ask(memberTok(kid), { area: "Kasarani", availability: "Saturdays", client_mutation_id: randomUUID() });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/parent or guardian/);
    const { rows } = await testPool().query(`SELECT 1 FROM chat_messages WHERE author_user_id = $1`, [kid]);
    expect(rows).toHaveLength(0);
  });

  it("refuses an empty area or time", async () => {
    const ben = (await createUser({ congregationId: cong, email: "cc-ben3@dev.local", fullName: "Ben" })).user_id;
    expect((await ask(memberTok(ben), { area: " ", availability: "Fridays", client_mutation_id: randomUUID() })).status).toBe(400);
  });
});
