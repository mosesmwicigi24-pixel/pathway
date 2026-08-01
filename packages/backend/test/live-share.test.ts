// Nuru Live — "Share a broadcast" (docs/LIVE_SHARE.md). Root cause + fix
// summarized in the doc: the old feature sent a bare, permanently-public
// file URL; this replaces it with a lazily-minted, revocable share_token
// resolved through a proper server-rendered /w/{token} page, plus a signed
// media hand-off that closes the public /live-recordings/ door. These tests
// exercise: mint idempotency, revoke, the privacy fix (cell broadcasts never
// get a public video URL), scoping on mint, signature validation, 404s, and
// HTML-escaping of untrusted titles.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser, createCellGroup } from "./helpers/factories.js";
import { LiveService } from "../src/modules/live/service.js";

const auth = (t: string) => ({ Authorization: t });

let cong: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
});
afterAll(async () => {
  await closeTestPool();
});

async function endedStreamWithRecording(
  ownerId: string,
  opts: { scope?: "church" | "cell"; cellId?: string | null; title?: string } = {},
): Promise<string> {
  const scope = opts.scope ?? "church";
  const { rows } = await testPool().query<{ stream_id: string }>(
    `INSERT INTO live_streams (scope, cell_id, started_by, title, kind, stream_key_hash, status, started_at, ended_at, recording_url)
     VALUES ($1, $2, $3, $4, 'video', 'deadbeef', 'ended', now() - interval '1 hour', now(), '/live-recordings/x/seg.mp4')
     RETURNING stream_id`,
    [scope, opts.cellId ?? null, ownerId, opts.title ?? "Sunday Service"],
  );
  return rows[0]!.stream_id;
}

function extractMediaUrl(html: string): string {
  const m = /name="twitter:player:stream" content="([^"]+)"/.exec(html);
  expect(m).not.toBeNull();
  return m![1]!.replace(/&amp;/g, "&");
}

describe("Live share — POST/DELETE /v1/live/replays/:id/share (mint + revoke)", () => {
  it("mints a share url; a repeat mint is idempotent (same token/url)", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "mint1@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await endedStreamWithRecording(admin.user_id);

    const first = await agent().post(`/v1/live/replays/${streamId}/share`).set(auth(tok));
    expect(first.status).toBe(200);
    expect(first.body.url).toMatch(/\/w\/[A-Za-z0-9_-]{20,}$/);
    expect(first.body.title).toBe("Sunday Service");
    expect(first.body.expires_at).toBeNull();

    const second = await agent().post(`/v1/live/replays/${streamId}/share`).set(auth(tok));
    expect(second.status).toBe(200);
    expect(second.body.url).toBe(first.body.url);

    const row = await testPool().query(`SELECT action FROM audit_log WHERE entity_id = $1 AND action = 'live.recording_shared'`, [streamId]);
    expect(row.rows).toHaveLength(1); // second mint did not re-mint
  });

  it("404s when the broadcast has no recording yet", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "mint2@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const created = await agent().post("/v1/live/streams").set(auth(tok)).send({ scope: "church", title: "Live now", kind: "video" });

    const res = await agent().post(`/v1/live/replays/${created.body.stream_id}/share`).set(auth(tok));
    expect(res.status).toBe(404);
  });

  it("a member outside a cell cannot mint a share for it (403 FORBIDDEN_SCOPE)", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "mint3@dev.local" });
    const cell = await createCellGroup(cong, "Cell A");
    const streamId = await endedStreamWithRecording(admin.user_id, { scope: "cell", cellId: cell, title: "Cell replay" });

    const outsider = await createUser({ congregationId: cong, email: "mint4@dev.local" });
    const outsiderTok = bearer({ sub: outsider.user_id, role: "Student", cong });
    const res = await agent().post(`/v1/live/replays/${streamId}/share`).set(auth(outsiderTok));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_SCOPE");
  });

  it("a cell member CAN mint a share for their own cell's broadcast", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "mint5@dev.local" });
    const cell = await createCellGroup(cong, "Cell A");
    const streamId = await endedStreamWithRecording(admin.user_id, { scope: "cell", cellId: cell, title: "Cell replay" });

    const member = await createUser({ congregationId: cong, cellGroupId: cell, email: "mint6@dev.local" });
    const memberTok = bearer({ sub: member.user_id, role: "Student", cong });
    const res = await agent().post(`/v1/live/replays/${streamId}/share`).set(auth(memberTok));
    expect(res.status).toBe(200);
  });

  it("404s an unknown stream_id", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "mint7@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const res = await agent().post(`/v1/live/replays/00000000-0000-0000-0000-000000000000/share`).set(auth(tok));
    expect(res.status).toBe(404);
  });

  it("DELETE revoke is idempotent (204 even with nothing to revoke)", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "rev1@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await endedStreamWithRecording(admin.user_id);

    const neverShared = await agent().delete(`/v1/live/replays/${streamId}/share`).set(auth(tok));
    expect(neverShared.status).toBe(204);

    await agent().post(`/v1/live/replays/${streamId}/share`).set(auth(tok));
    const first = await agent().delete(`/v1/live/replays/${streamId}/share`).set(auth(tok));
    expect(first.status).toBe(204);
    const second = await agent().delete(`/v1/live/replays/${streamId}/share`).set(auth(tok));
    expect(second.status).toBe(204);
  });
});

describe("Live share — GET /w/:token (public page)", () => {
  it("unknown token 404s with a branded page, never the JSON error envelope", async () => {
    const res = await agent().get("/w/does-not-exist-at-all");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.body).toEqual({});
  });

  it("church broadcast: 200 with an inline video, OG/Twitter player meta, and a working deep link", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "page1@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await endedStreamWithRecording(admin.user_id, { title: "Sunday Word" });
    const minted = await agent().post(`/v1/live/replays/${streamId}/share`).set(auth(tok));
    const token = minted.body.url.split("/w/")[1];

    const page = await agent().get(`/w/${token}`);
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toMatch(/text\/html/);
    expect(page.text).toContain("Sunday Word");
    expect(page.text).toContain('property="og:video"');
    expect(page.text).toContain('name="twitter:card" content="player"');
    expect(page.text).toContain(`nuru://live/replay/${streamId}`);
    const mediaUrl = extractMediaUrl(page.text);
    expect(mediaUrl).toContain(`/v1/live/replays/${streamId}/media?t=`);
  });

  it("cell broadcast: renders the 'for members' notice with NO video and NO media URL anywhere in the HTML (the privacy fix)", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "page2@dev.local" });
    const cell = await createCellGroup(cong, "Grace Cell");
    const member = await createUser({ congregationId: cong, cellGroupId: cell, email: "page3@dev.local" });
    const memberTok = bearer({ sub: member.user_id, role: "Student", cong });
    const streamId = await endedStreamWithRecording(admin.user_id, { scope: "cell", cellId: cell, title: "Cell devotion" });
    const minted = await agent().post(`/v1/live/replays/${streamId}/share`).set(auth(memberTok));
    const token = minted.body.url.split("/w/")[1];

    const page = await agent().get(`/w/${token}`); // unauthenticated — this is the public page
    expect(page.status).toBe(200);
    expect(page.text).toContain("Grace Cell");
    expect(page.text).not.toContain("<video");
    expect(page.text).not.toContain("og:video");
    expect(page.text).not.toContain("/media?t=");
    expect(page.text).not.toContain("/live-recordings/");
    expect(page.text).toContain(`nuru://live/replay/${streamId}`);
  });

  it("revocation kills the page — 200 before, 404 after", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "page4@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await endedStreamWithRecording(admin.user_id);
    const minted = await agent().post(`/v1/live/replays/${streamId}/share`).set(auth(tok));
    const token = minted.body.url.split("/w/")[1];

    const before = await agent().get(`/w/${token}`);
    expect(before.status).toBe(200);

    const revoke = await agent().delete(`/v1/live/replays/${streamId}/share`).set(auth(tok));
    expect(revoke.status).toBe(204);

    const after = await agent().get(`/w/${token}`);
    expect(after.status).toBe(404);
  });

  it("a deleted recording 404s the share page even with a still-valid token", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "page5@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await endedStreamWithRecording(admin.user_id);
    const minted = await agent().post(`/v1/live/replays/${streamId}/share`).set(auth(tok));
    const token = minted.body.url.split("/w/")[1];

    const del = await agent().delete(`/v1/live/recordings/${streamId}`).set(auth(tok));
    expect(del.status).toBe(204);

    const page = await agent().get(`/w/${token}`);
    expect(page.status).toBe(404);
  });

  it("HTML-escapes a title containing <script> — no raw tag reaches the response", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "page6@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await endedStreamWithRecording(admin.user_id, { title: `<script>alert(1)</script>` });
    const minted = await agent().post(`/v1/live/replays/${streamId}/share`).set(auth(tok));
    const token = minted.body.url.split("/w/")[1];

    const page = await agent().get(`/w/${token}`);
    expect(page.status).toBe(200);
    expect(page.text).not.toContain("<script>alert(1)</script>");
    expect(page.text).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("Live share — GET /v1/live/replays/:id/media (signed hand-off)", () => {
  it("valid signature: 200 with X-Accel-Redirect set to the internal path, no body proxied by Node", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "media1@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await endedStreamWithRecording(admin.user_id);
    const minted = await agent().post(`/v1/live/replays/${streamId}/share`).set(auth(tok));
    const token = minted.body.url.split("/w/")[1];
    const page = await agent().get(`/w/${token}`);
    const mediaUrl = new URL(extractMediaUrl(page.text));

    const res = await agent().get(mediaUrl.pathname + mediaUrl.search);
    expect(res.status).toBe(200);
    expect(res.headers["x-accel-redirect"]).toBe(`/internal-live-recordings/x/seg.mp4`);
    expect(res.headers["content-type"]).toContain("video/mp4");
  });

  it("rejects an expired signature", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "media2@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await endedStreamWithRecording(admin.user_id);
    const minted = await agent().post(`/v1/live/replays/${streamId}/share`).set(auth(tok));
    const token = minted.body.url.split("/w/")[1];
    const page = await agent().get(`/w/${token}`);
    const mediaUrl = new URL(extractMediaUrl(page.text));

    mediaUrl.searchParams.set("e", String(Math.floor(Date.now() / 1000) - 60)); // 1 minute in the past
    const res = await agent().get(mediaUrl.pathname + mediaUrl.search);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_SCOPE");
  });

  it("rejects a tampered signature (expiry changed, same t)", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "media3@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await endedStreamWithRecording(admin.user_id);
    const minted = await agent().post(`/v1/live/replays/${streamId}/share`).set(auth(tok));
    const token = minted.body.url.split("/w/")[1];
    const page = await agent().get(`/w/${token}`);
    const mediaUrl = new URL(extractMediaUrl(page.text));

    const originalExpiry = Number(mediaUrl.searchParams.get("e"));
    mediaUrl.searchParams.set("e", String(originalExpiry + 3600)); // extend expiry, signature no longer matches
    const res = await agent().get(mediaUrl.pathname + mediaUrl.search);
    expect(res.status).toBe(403);
  });

  it("rejects a request with a bogus t for a real, unexpired e", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "media4@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await endedStreamWithRecording(admin.user_id);
    const e = Math.floor(Date.now() / 1000) + 3600;
    const res = await agent().get(`/v1/live/replays/${streamId}/media?t=not-a-real-signature&e=${e}`);
    expect(res.status).toBe(403);
  });

  it("404s when the recording has been deleted since the URL was signed", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "media5@dev.local" });
    const tok = bearer({ sub: admin.user_id, role: "Admin", cong });
    const streamId = await endedStreamWithRecording(admin.user_id);
    const minted = await agent().post(`/v1/live/replays/${streamId}/share`).set(auth(tok));
    const token = minted.body.url.split("/w/")[1];
    const page = await agent().get(`/w/${token}`);
    const mediaUrl = new URL(extractMediaUrl(page.text));

    await agent().delete(`/v1/live/recordings/${streamId}`).set(auth(tok));
    const res = await agent().get(mediaUrl.pathname + mediaUrl.search);
    expect(res.status).toBe(404);
  });

  it("refuses a cell-scope recording even with a GENUINELY valid signature for it (defense in depth — no public flow ever mints one, but the endpoint doesn't trust that alone)", async () => {
    const admin = await createUser({ congregationId: cong, role: "Admin", email: "media6@dev.local" });
    const cell = await createCellGroup(cong, "Cell A");
    const streamId = await endedStreamWithRecording(admin.user_id, { scope: "cell", cellId: cell, title: "Cell replay" });

    // Mint a real, correctly-signed URL using the exact same construction the
    // app itself uses (testEnv() has no LIVE_SHARE_SECRET, so the app signs
    // with JWT_SIGNING_KEY — "test-signing-key", mirrored here) — proving
    // this isn't just "the signature happens to be invalid" but a deliberate
    // scope check that survives even a technically-valid signature.
    const svc = new LiveService(
      testPool(), undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      "https://pathway.nuruplace.org", "test-signing-key",
    );
    const signed = new URL((svc as unknown as { mediaUrl(id: string): string }).mediaUrl(streamId));

    const res = await agent().get(signed.pathname + signed.search);
    expect(res.status).toBe(404); // signature checks out; the scope==='church' guard is what refuses it
  });
});

describe("Live share — GET /live/poster-default.svg (static fallback asset)", () => {
  it("serves the branded SVG poster", async () => {
    const res = await agent().get("/live/poster-default.svg");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/image\/svg\+xml/);
    // superagent doesn't have a built-in text parser for image/svg+xml, so it
    // buffers the raw bytes into res.body instead of populating res.text.
    const body = Buffer.isBuffer(res.body) ? res.body.toString("utf8") : String(res.text ?? res.body);
    expect(body).toContain("<svg");
    expect(body).toContain("Nuru Place");
  });
});
