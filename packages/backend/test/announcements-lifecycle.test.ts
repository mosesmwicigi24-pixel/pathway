// EVENTS_ARCHITECTURE §5 — announcements as a first-class lifecycle:
// the three attachment modes (standalone / series / event), duplicate,
// archive/restore, congregation scoping, honest channels (sms → suppressed
// no_provider, email via the injected SMTP provider, banner-only markOpened),
// and the per-congregation featured fix (§8).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser } from "./helpers/factories.js";
import { AnnouncementService } from "../src/modules/announcements/service.js";
import { CalendarService, occurrenceId } from "../src/modules/calendar/service.js";
import type { EmailMessage, EmailProvider } from "../src/modules/identity/email.js";
import type { Principal } from "../src/http/http.js";

class FakeEmailProvider implements EmailProvider {
  readonly sent: EmailMessage[] = [];
  async send(msg: EmailMessage): Promise<void> {
    this.sent.push(msg);
  }
}

const auth = (t: string) => ({ Authorization: t });
const principal = (userId: string, role: Principal["role"], cong: string): Principal => ({ userId, role, congregationId: cong });

let congA: string, congB: string, cellA: string;
let adminA: string, adminATok: string, memberA: string, memberATok: string;
let adminB: string, adminBTok: string, memberB: string, memberBTok: string;

beforeEach(async () => {
  await resetDb();
  congA = await createCongregation("Branch A");
  congB = await createCongregation("Branch B");
  cellA = await createCellGroup(congA, "Cell A");
  adminA = (await createUser({ congregationId: congA, role: "Admin", email: "aa@dev.local" })).user_id;
  memberA = (await createUser({ congregationId: congA, cellGroupId: cellA, email: "ma@dev.local" })).user_id;
  adminB = (await createUser({ congregationId: congB, role: "Admin", email: "ab@dev.local" })).user_id;
  memberB = (await createUser({ congregationId: congB, email: "mb@dev.local" })).user_id;
  adminATok = bearer({ sub: adminA, role: "Admin", cong: congA });
  memberATok = bearer({ sub: memberA, role: "Student", cong: congA });
  adminBTok = bearer({ sub: adminB, role: "Admin", cong: congB });
  memberBTok = bearer({ sub: memberB, role: "Student", cong: congB });
});
afterAll(async () => {
  await closeTestPool();
});

function compose(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Easter service moved",
    body: "**Note:** service starts at 9am.",
    channels: ["banner"],
    audience: { kind: "all" },
    ...over,
  };
}

async function createSeriesA(title = "Attached Series"): Promise<{ series_id: string; firstStart: string }> {
  const svc = new CalendarService(testPool());
  const start = new Date(Date.now() + 7 * 86_400_000);
  const s = (await svc.createSeries(principal(adminA, "Admin", congA), {
    title,
    timezone: "Africa/Nairobi",
    dtstart_local: `${start.toISOString().slice(0, 10)}T18:00:00`,
    duration_min: 60,
    rrule: "FREQ=WEEKLY;COUNT=4",
    visibility: "congregation",
  })) as { series_id: string };
  const projected = ((await svc.projectRange(memberA, new Date().toISOString(), new Date(Date.now() + 30 * 86_400_000).toISOString())) as Array<{ series_id: string; original_start_at: string }>)
    .filter((o) => o.series_id === s.series_id);
  return { series_id: s.series_id, firstStart: projected[0]!.original_start_at };
}

describe("attachment modes (§5)", () => {
  it("standalone, series-attached, and event-attached all round-trip; both at once is rejected", async () => {
    const { series_id, firstStart } = await createSeriesA();
    const occId = occurrenceId(series_id, firstStart);

    const standalone = await agent().post("/v1/admin/announcements").set(auth(adminATok)).send(compose());
    expect(standalone.status).toBe(201);
    expect(standalone.body.series_id).toBeNull();
    expect(standalone.body.event_occurrence_id).toBeNull();
    expect(standalone.body.congregation_id).toBe(congA); // tenant-stamped

    const seriesAttached = await agent()
      .post("/v1/admin/announcements")
      .set(auth(adminATok))
      .send(compose({ title: "Series news", series_id }));
    expect(seriesAttached.status).toBe(201);
    expect(seriesAttached.body.series_id).toBe(series_id);

    const eventAttached = await agent()
      .post("/v1/admin/announcements")
      .set(auth(adminATok))
      .send(compose({ title: "One occurrence", event_occurrence_id: occId }));
    expect(eventAttached.status).toBe(201);
    expect(eventAttached.body.event_occurrence_id).toBe(occId);

    // The command center surfaces both linked announcements on the series.
    const detail = await agent().get(`/v1/admin/events/series/${series_id}`).set(auth(adminATok));
    const linked = detail.body.announcements as Array<{ announcement_id: string; attachment: string }>;
    expect(linked.find((l) => l.announcement_id === seriesAttached.body.announcement_id)?.attachment).toBe("series");
    expect(linked.find((l) => l.announcement_id === eventAttached.body.announcement_id)?.attachment).toBe("event");

    // Both at once → 400.
    const both = await agent()
      .post("/v1/admin/announcements")
      .set(auth(adminATok))
      .send(compose({ series_id, event_occurrence_id: occId }));
    expect(both.status).toBe(400);

    // Cross-congregation attachment → 403.
    const cross = await agent()
      .post("/v1/admin/announcements")
      .set(auth(adminBTok))
      .send(compose({ series_id }));
    expect(cross.status).toBe(403);
  });
});

describe("duplicate + archive/restore (§5)", () => {
  it("duplicate clones a SENT announcement into a fresh draft", async () => {
    const created = await agent().post("/v1/admin/announcements").set(auth(adminATok)).send(compose({ title: "Original news" }));
    const id = created.body.announcement_id as string;
    expect((await agent().post(`/v1/admin/announcements/${id}/send`).set(auth(adminATok))).status).toBe(200);

    const dup = await agent().post(`/v1/admin/announcements/${id}/duplicate`).set(auth(adminATok));
    expect(dup.status).toBe(201);
    expect(dup.body.announcement_id).not.toBe(id);
    expect(dup.body.title).toBe("Original news");
    expect(dup.body.status).toBe("draft");
    expect(dup.body.sent_at).toBeNull();
    // The clone has no deliveries; the original is untouched.
    const rows = await testPool().query(`SELECT count(*)::int AS n FROM announcement_deliveries WHERE announcement_id=$1`, [dup.body.announcement_id]);
    expect(rows.rows[0].n).toBe(0);
    const orig = await agent().get(`/v1/admin/announcements/${id}`).set(auth(adminATok));
    expect(orig.body.status).toBe("sent");
  });

  it("archive hides from the admin default list and the member feed; restore brings it back", async () => {
    const created = await agent().post("/v1/admin/announcements").set(auth(adminATok)).send(compose({ title: "Old news" }));
    const id = created.body.announcement_id as string;
    await agent().post(`/v1/admin/announcements/${id}/send`).set(auth(adminATok));
    expect((await agent().get("/v1/me/announcements").set(auth(memberATok))).body.data).toHaveLength(1);

    const arch = await agent().post(`/v1/admin/announcements/${id}/archive`).set(auth(adminATok));
    expect(arch.status).toBe(200);
    expect(arch.body.archived_at).not.toBeNull();

    const defaultList = await agent().get("/v1/admin/announcements").set(auth(adminATok));
    expect((defaultList.body.data as Array<{ announcement_id: string }>).some((a) => a.announcement_id === id)).toBe(false);
    const archivedList = await agent().get("/v1/admin/announcements?archived=true").set(auth(adminATok));
    expect((archivedList.body.data as Array<{ announcement_id: string }>).some((a) => a.announcement_id === id)).toBe(true);
    // Member feed no longer serves it (archived ≠ deleted, but retired).
    expect((await agent().get("/v1/me/announcements").set(auth(memberATok))).body.data).toHaveLength(0);

    const restored = await agent().post(`/v1/admin/announcements/${id}/restore`).set(auth(adminATok));
    expect(restored.body.archived_at).toBeNull();
    expect((await agent().get("/v1/me/announcements").set(auth(memberATok))).body.data).toHaveLength(1);
  });

  it("a scheduled announcement cannot be archived (cancel first) — 409", async () => {
    const created = await agent()
      .post("/v1/admin/announcements")
      .set(auth(adminATok))
      .send(compose({ scheduled_at: new Date(Date.now() + 3600_000).toISOString() }));
    const res = await agent().post(`/v1/admin/announcements/${created.body.announcement_id}/archive`).set(auth(adminATok));
    expect(res.status).toBe(409);
  });
});

describe("congregation scoping (§5 multi-tenant fix)", () => {
  it("audience 'all' fans out ONLY to the sender's congregation; admin lists are scoped", async () => {
    const created = await agent().post("/v1/admin/announcements").set(auth(adminATok)).send(compose());
    const id = created.body.announcement_id as string;
    const sent = await agent().post(`/v1/admin/announcements/${id}/send`).set(auth(adminATok));
    expect(sent.status).toBe(200);
    expect(sent.body.recipients).toBe(2); // adminA + memberA — never congregation B

    const who = await testPool().query(`SELECT DISTINCT user_id FROM announcement_deliveries WHERE announcement_id=$1`, [id]);
    expect(who.rows.map((r) => r.user_id).sort()).toEqual([adminA, memberA].sort());

    // Congregation B's console never sees A's announcement.
    const listB = await agent().get("/v1/admin/announcements").set(auth(adminBTok));
    expect((listB.body.data as Array<{ announcement_id: string }>).some((a) => a.announcement_id === id)).toBe(false);
    expect((await agent().get(`/v1/admin/announcements/${id}`).set(auth(adminBTok))).status).toBe(404);
    // …and B's members never received it.
    expect((await agent().get("/v1/me/announcements").set(auth(memberBTok))).body.data).toHaveLength(0);
  });

  it("featured announcement is per-congregation (§8)", async () => {
    const mk = async (tok: string, title: string): Promise<string> => {
      const c = await agent().post("/v1/admin/announcements").set(auth(tok)).send(compose({ title }));
      await agent().post(`/v1/admin/announcements/${c.body.announcement_id}/send`).set(auth(tok));
      await agent().post(`/v1/admin/announcements/${c.body.announcement_id}/homepage`).set(auth(tok));
      return c.body.announcement_id as string;
    };
    const idA = await mk(adminATok, "A's pick");
    const idB = await mk(adminBTok, "B's pick");

    // BOTH stay featured — the old global unique flag un-featured A when B featured.
    const flags = await testPool().query(`SELECT announcement_id FROM announcements WHERE is_featured = true`);
    expect(flags.rows.map((r) => r.announcement_id).sort()).toEqual([idA, idB].sort());

    const homeA = await agent().get("/v1/home/featured-announcement").set(auth(memberATok));
    expect(homeA.body.data.announcement_id).toBe(idA);
    const homeB = await agent().get("/v1/home/featured-announcement").set(auth(memberBTok));
    expect(homeB.body.data.announcement_id).toBe(idB);
  });
});

describe("channel honesty (§5)", () => {
  it("sms with no provider records suppressed(no_provider) — never a fake 'delivered'", async () => {
    const created = await agent()
      .post("/v1/admin/announcements")
      .set(auth(adminATok))
      .send(compose({ channels: ["sms", "banner"], audience: { kind: "cells", cell_group_ids: [cellA] } }));
    const id = created.body.announcement_id as string;
    expect((await agent().post(`/v1/admin/announcements/${id}/send`).set(auth(adminATok))).status).toBe(200);

    const sms = await testPool().query(
      `SELECT status, suppress_reason, provider_ref FROM announcement_deliveries WHERE announcement_id=$1 AND channel='sms'`,
      [id],
    );
    expect(sms.rows[0]).toMatchObject({ status: "suppressed", suppress_reason: "no_provider", provider_ref: null });

    const detail = await agent().get(`/v1/admin/announcements/${id}`).set(auth(adminATok));
    const byChannel = Object.fromEntries(
      (detail.body.stats as Array<{ channel: string }>).map((s) => [s.channel, s]),
    ) as Record<string, { delivered: number; suppressed: number; suppressed_reasons: Record<string, number> }>;
    expect(byChannel.sms!.delivered).toBe(0);
    expect(byChannel.sms!.suppressed).toBe(1);
    expect(byChannel.sms!.suppressed_reasons.no_provider).toBe(1);
    expect(byChannel.banner!.delivered).toBe(1); // banner is genuinely delivered in-app
  });

  it("email is sent through the injected provider and marked delivered on acceptance", async () => {
    const fake = new FakeEmailProvider();
    const svc = new AnnouncementService(testPool(), { email: fake });
    const ann = await svc.create(adminA, {
      title: "Email news",
      body: "Real email now.",
      channels: ["email"],
      audience: { kind: "cells", cell_group_ids: [cellA] },
    });
    const result = await svc.send(adminA, ann.announcement_id);
    expect(result.recipients).toBe(1);
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]!.to).toBe("ma@dev.local");
    expect(fake.sent[0]!.subject).toBe("Email news");

    const row = await testPool().query(
      `SELECT status, delivered_at FROM announcement_deliveries WHERE announcement_id=$1 AND channel='email'`,
      [ann.announcement_id],
    );
    expect(row.rows[0].status).toBe("delivered"); // delivered = provider accepted
    expect(row.rows[0].delivered_at).not.toBeNull();
  });

  it("email without a provider (or without an address) is honestly suppressed", async () => {
    const noEmailMember = (await createUser({ congregationId: congA, cellGroupId: cellA, email: null })).user_id;
    const svc = new AnnouncementService(testPool()); // no email provider injected
    const ann = await svc.create(adminA, {
      title: "Silent email",
      body: "Nobody is pretending this went out.",
      channels: ["email"],
      audience: { kind: "cells", cell_group_ids: [cellA] },
    });
    await svc.send(adminA, ann.announcement_id);
    const rows = await testPool().query(
      `SELECT user_id, status, suppress_reason FROM announcement_deliveries WHERE announcement_id=$1 AND channel='email'`,
      [ann.announcement_id],
    );
    expect(rows.rows).toHaveLength(2);
    for (const r of rows.rows) expect(r.status).toBe("suppressed");
    expect(rows.rows.every((r) => r.suppress_reason === "no_provider")).toBe(true);

    // With a provider bound, a recipient WITHOUT an email address suppresses as no_email.
    const fake = new FakeEmailProvider();
    const svc2 = new AnnouncementService(testPool(), { email: fake });
    const ann2 = await svc2.create(adminA, {
      title: "Partial email",
      body: "Only members with addresses get it.",
      channels: ["email"],
      audience: { kind: "cells", cell_group_ids: [cellA] },
    });
    await svc2.send(adminA, ann2.announcement_id);
    const rows2 = await testPool().query(
      `SELECT user_id, status, suppress_reason FROM announcement_deliveries WHERE announcement_id=$1 AND channel='email'`,
      [ann2.announcement_id],
    );
    const byUser = new Map(rows2.rows.map((r) => [r.user_id, r]));
    expect(byUser.get(memberA)).toMatchObject({ status: "delivered", suppress_reason: null });
    expect(byUser.get(noEmailMember)).toMatchObject({ status: "suppressed", suppress_reason: "no_email" });
    expect(fake.sent).toHaveLength(1);
  });

  it("markOpened stamps BANNER rows only (§5 — one tap no longer contaminates every channel)", async () => {
    const created = await agent()
      .post("/v1/admin/announcements")
      .set(auth(adminATok))
      .send(compose({ channels: ["banner", "push"], audience: { kind: "cells", cell_group_ids: [cellA] } }));
    const id = created.body.announcement_id as string;
    await agent().post(`/v1/admin/announcements/${id}/send`).set(auth(adminATok));

    const open = await agent().post(`/v1/announcements/${id}/open`).set(auth(memberATok));
    expect(open.status).toBe(200);
    expect(open.body.opened).toBe(true);

    const rows = await testPool().query(
      `SELECT channel, opened_at FROM announcement_deliveries WHERE announcement_id=$1 AND user_id=$2 ORDER BY channel`,
      [id, memberA],
    );
    const byChannel = new Map(rows.rows.map((r) => [r.channel, r.opened_at]));
    expect(byChannel.get("banner")).not.toBeNull();
    expect(byChannel.get("push")).toBeNull(); // untouched — we cannot measure push opens

    // Idempotent replay still reports already-stamped.
    const again = await agent().post(`/v1/announcements/${id}/open`).set(auth(memberATok));
    expect(again.body.opened).toBe(false);
  });
});
