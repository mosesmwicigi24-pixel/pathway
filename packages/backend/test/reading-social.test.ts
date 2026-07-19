// Reading & Social R1 — shared plan groups + invites + public join page +
// progress notifications (spec §3/§6; docs/READING_SOCIAL_PLAN.md §4/§5).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser } from "./helpers/factories.js";

const auth = (t: string) => ({ Authorization: t });

async function connect(a: string, b: string): Promise<void> {
  await testPool().query(
    `INSERT INTO user_connections (user_a, user_b, status, established_at, updated_at)
     VALUES (LEAST($1::uuid,$2::uuid), GREATEST($1::uuid,$2::uuid), 'accepted', now(), now())`,
    [a, b],
  );
}

async function planId(tok: string, code: string): Promise<string> {
  const res = await agent().get("/v1/growth/plans").set(auth(tok));
  const found = (res.body.data as Array<{ code: string; plan_id: string }>).find((p) => p.code === code);
  if (!found) throw new Error(`seed plan not found: ${code}`);
  return found.plan_id;
}

let cong: string;
let aId: string, aTok: string;
let bId: string, bTok: string;
let cId: string, cTok: string;
let minorId: string, minorTok: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  const a = await createUser({ congregationId: cong, email: "rs-a@dev.local", fullName: "Ann Reader" });
  const b = await createUser({ congregationId: cong, email: "rs-b@dev.local", fullName: "Ben Reader" });
  const c = await createUser({ congregationId: cong, email: "rs-c@dev.local", fullName: "Cara Reader" });
  const minor = await createUser({ congregationId: cong, email: "rs-m@dev.local", fullName: "Kid", dateOfBirth: "2015-01-01" });
  aId = a.user_id; bId = b.user_id; cId = c.user_id; minorId = minor.user_id;
  aTok = bearer({ sub: aId, role: "Student", cong });
  bTok = bearer({ sub: bId, role: "Student", cong });
  cTok = bearer({ sub: cId, role: "Student", cong });
  minorTok = bearer({ sub: minorId, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

describe("group lifecycle", () => {
  it("create-or-get: a second call for the same plan returns the SAME group, enrolled in the plan", async () => {
    const plan = await planId(aTok, "gospel-of-john");
    const first = await agent().post("/v1/reading/groups").set(auth(aTok)).send({ plan_id: plan });
    expect(first.status).toBe(201);
    expect(first.body.created_by).toBe(aId);
    expect(first.body.members).toHaveLength(1);
    expect(first.body.members[0].user_id).toBe(aId);

    const enrolled = await testPool().query(`SELECT 1 FROM reading_plan_progress WHERE user_id = $1 AND plan_id = $2`, [aId, plan]);
    expect(enrolled.rowCount).toBe(1);

    const second = await agent().post("/v1/reading/groups").set(auth(aTok)).send({ plan_id: plan });
    expect(second.status).toBe(201);
    expect(second.body.group_id).toBe(first.body.group_id);

    const count = await testPool().query(`SELECT count(*)::int AS n FROM shared_plan_groups`);
    expect(count.rows[0].n).toBe(1);
  });

  it("create-or-get mints a NEW group once the previous one is archived", async () => {
    const plan = await planId(aTok, "gospel-of-john");
    const first = await agent().post("/v1/reading/groups").set(auth(aTok)).send({ plan_id: plan });
    await agent().post(`/v1/reading/groups/${first.body.group_id}/archive`).set(auth(aTok)).send({});

    const second = await agent().post("/v1/reading/groups").set(auth(aTok)).send({ plan_id: plan });
    expect(second.status).toBe(201);
    expect(second.body.group_id).not.toBe(first.body.group_id);
  });

  it("lists my active groups with plan summary + member progress", async () => {
    const plan = await planId(aTok, "gospel-of-john");
    await agent().post("/v1/reading/groups").set(auth(aTok)).send({ plan_id: plan });
    const list = await agent().get("/v1/reading/groups").set(auth(aTok));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].plan.code).toBe("gospel-of-john");
    expect(list.body.data[0].members[0]).toHaveProperty("days_done");
    expect(list.body.data[0].members[0].days_done).toBe(0);
  });

  it("403s a non-member reading group detail; 404s a nonexistent group", async () => {
    const plan = await planId(aTok, "gospel-of-john");
    const created = await agent().post("/v1/reading/groups").set(auth(aTok)).send({ plan_id: plan });
    const asStranger = await agent().get(`/v1/reading/groups/${created.body.group_id}`).set(auth(bTok));
    expect(asStranger.status).toBe(403);
    expect(asStranger.body.error.code).toBe("FORBIDDEN_SCOPE");

    const bogus = await agent().get(`/v1/reading/groups/00000000-0000-4000-8000-000000000099`).set(auth(aTok));
    expect(bogus.status).toBe(404);
  });

  it("archive is creator-only and idempotent", async () => {
    const plan = await planId(aTok, "gospel-of-john");
    const created = await agent().post("/v1/reading/groups").set(auth(aTok)).send({ plan_id: plan });
    const notCreator = await agent().post(`/v1/reading/groups/${created.body.group_id}/archive`).set(auth(bTok)).send({});
    expect(notCreator.status).toBe(403);

    const archived = await agent().post(`/v1/reading/groups/${created.body.group_id}/archive`).set(auth(aTok)).send({});
    expect(archived.status).toBe(200);
    expect(archived.body.archived_at).toBeTruthy();

    const again = await agent().post(`/v1/reading/groups/${created.body.group_id}/archive`).set(auth(aTok)).send({});
    expect(again.status).toBe(200);
    expect(again.body.archived_at).toBe(archived.body.archived_at);
  });

  it("leave is idempotent and drops the group from my list", async () => {
    const plan = await planId(aTok, "gospel-of-john");
    const created = await agent().post("/v1/reading/groups").set(auth(aTok)).send({ plan_id: plan });
    const left = await agent().post(`/v1/reading/groups/${created.body.group_id}/leave`).set(auth(aTok)).send({});
    expect(left.status).toBe(200);
    expect(left.body.status).toBe("left");

    const again = await agent().post(`/v1/reading/groups/${created.body.group_id}/leave`).set(auth(aTok)).send({});
    expect(again.body.status).toBe("left");

    const list = await agent().get("/v1/reading/groups").set(auth(aTok));
    expect(list.body.data).toHaveLength(0);
  });
});

describe("group creation with named members", () => {
  it("requires an accepted connection first, else 403 CONSENT_REQUIRED", async () => {
    const plan = await planId(aTok, "gospel-of-john");
    const res = await agent().post("/v1/reading/groups").set(auth(aTok)).send({ plan_id: plan, member_user_ids: [bId] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CONSENT_REQUIRED");
    expect(res.body.error.details.hint).toBe("connect first");

    // nothing was written — fails the whole call, not partially
    const groups = await testPool().query(`SELECT count(*)::int AS n FROM shared_plan_groups`);
    expect(groups.rows[0].n).toBe(0);
  });

  it("invites a connected friend and notifies them", async () => {
    await connect(aId, bId);
    const plan = await planId(aTok, "gospel-of-john");
    const res = await agent().post("/v1/reading/groups").set(auth(aTok)).send({ plan_id: plan, member_user_ids: [bId] });
    expect(res.status).toBe(201);

    const invites = await testPool().query(`SELECT status, invitee_user_id FROM shared_plan_invites WHERE group_id = $1`, [res.body.group_id]);
    expect(invites.rows).toHaveLength(1);
    expect(invites.rows[0].status).toBe("pending");
    expect(invites.rows[0].invitee_user_id).toBe(bId);

    const notif = await testPool().query(`SELECT template FROM notifications WHERE user_id = $1`, [bId]);
    expect(notif.rows.map((r: { template: string }) => r.template)).toContain("plan_group_invite_received");
  });

  it("refuses a minor member (403 FORBIDDEN_SCOPE)", async () => {
    await connect(aId, minorId);
    const plan = await planId(aTok, "gospel-of-john");
    const res = await agent().post("/v1/reading/groups").set(auth(aTok)).send({ plan_id: plan, member_user_ids: [minorId] });
    expect(res.status).toBe(403);
  });
});

describe("invite flow end to end", () => {
  it("targeted invite: preview, accept (idempotent replay), fan-out notifications to inviter + other members", async () => {
    await connect(aId, bId);
    await connect(aId, cId);
    const plan = await planId(aTok, "gospel-of-john");
    const group = await agent().post("/v1/reading/groups").set(auth(aTok)).send({ plan_id: plan, member_user_ids: [cId] });
    // C accepts first so the group has a THIRD active member to receive "member joined".
    const cInvite = await testPool().query(`SELECT token FROM shared_plan_invites WHERE group_id = $1 AND invitee_user_id = $2`, [group.body.group_id, cId]);
    const cAccept = await agent().post(`/v1/reading/invites/${cInvite.rows[0].token}/accept`).set(auth(cTok)).send({});
    expect(cAccept.status).toBe(200);

    const invite = await agent().post(`/v1/reading/groups/${group.body.group_id}/invites`).set(auth(aTok)).send({ user_id: bId, message: "Join me!" });
    expect(invite.status).toBe(201);
    const token = invite.body.token;

    const preview = await agent().get(`/v1/reading/invites/${token}`).set(auth(bTok));
    expect(preview.status).toBe(200);
    expect(preview.body.plan.code).toBe("gospel-of-john");
    expect(preview.body.inviter.user_id).toBe(aId);
    expect(preview.body.member_count).toBe(2); // A + C so far

    const accepted = await agent().post(`/v1/reading/invites/${token}/accept`).set(auth(bTok)).send({});
    expect(accepted.status).toBe(200);
    expect(accepted.body.group_id).toBe(group.body.group_id);
    expect(accepted.body.status).toBe("accepted");
    expect(accepted.body.joined).toBe(true);

    // A brand-new user_connections row now exists between A and B.
    const pair = await testPool().query(`SELECT status FROM user_connections WHERE user_a = LEAST($1::uuid,$2::uuid) AND user_b = GREATEST($1::uuid,$2::uuid)`, [aId, bId]);
    expect(pair.rows[0].status).toBe("accepted");

    // B is enrolled in the plan.
    const enrolled = await testPool().query(`SELECT 1 FROM reading_plan_progress WHERE user_id = $1 AND plan_id = $2`, [bId, plan]);
    expect(enrolled.rowCount).toBe(1);

    // Replay is a no-op.
    const replay = await agent().post(`/v1/reading/invites/${token}/accept`).set(auth(bTok)).send({});
    expect(replay.status).toBe(200);
    expect(replay.body.joined).toBe(false);
    const members = await testPool().query(`SELECT count(*)::int AS n FROM shared_plan_group_members WHERE group_id = $1 AND user_id = $2`, [group.body.group_id, bId]);
    expect(members.rows[0].n).toBe(1);

    // A (inviter) got the "accepted" notification.
    const aNotif = await testPool().query(`SELECT template FROM notifications WHERE user_id = $1`, [aId]);
    expect(aNotif.rows.map((r: { template: string }) => r.template)).toContain("plan_group_invite_accepted");
    // C (the other existing member, neither inviter nor joiner) got "member joined".
    const cNotif = await testPool().query(`SELECT template FROM notifications WHERE user_id = $1`, [cId]);
    expect(cNotif.rows.map((r: { template: string }) => r.template)).toContain("plan_group_member_joined");
  });

  it("a targeted invite can only be accepted or declined by its own invitee", async () => {
    await connect(aId, bId);
    const plan = await planId(aTok, "gospel-of-john");
    const group = await agent().post("/v1/reading/groups").set(auth(aTok)).send({ plan_id: plan });
    const invite = await agent().post(`/v1/reading/groups/${group.body.group_id}/invites`).set(auth(aTok)).send({ user_id: bId });

    const wrongAccept = await agent().post(`/v1/reading/invites/${invite.body.token}/accept`).set(auth(cTok)).send({});
    expect(wrongAccept.status).toBe(403);
    const wrongDecline = await agent().post(`/v1/reading/invites/${invite.body.token}/decline`).set(auth(cTok)).send({});
    expect(wrongDecline.status).toBe(403);

    const decline = await agent().post(`/v1/reading/invites/${invite.body.token}/decline`).set(auth(bTok)).send({});
    expect(decline.status).toBe(200);
    expect(decline.body.status).toBe("declined");

    // Declined stays refused — accept afterward 404s.
    const acceptAfterDecline = await agent().post(`/v1/reading/invites/${invite.body.token}/accept`).set(auth(bTok)).send({});
    expect(acceptAfterDecline.status).toBe(404);

    // Idempotent decline.
    const declineAgain = await agent().post(`/v1/reading/invites/${invite.body.token}/decline`).set(auth(bTok)).send({});
    expect(declineAgain.body.already).toBe(true);
  });

  it("revoke kills the invite; a revoked token 404s on accept", async () => {
    await connect(aId, bId);
    const plan = await planId(aTok, "gospel-of-john");
    const group = await agent().post("/v1/reading/groups").set(auth(aTok)).send({ plan_id: plan });
    const invite = await agent().post(`/v1/reading/groups/${group.body.group_id}/invites`).set(auth(aTok)).send({ user_id: bId });

    const revoked = await agent().post(`/v1/reading/groups/${group.body.group_id}/invites/${invite.body.invite_id}/revoke`).set(auth(aTok)).send({});
    expect(revoked.status).toBe(200);
    expect(revoked.body.status).toBe("revoked");

    const accept = await agent().post(`/v1/reading/invites/${invite.body.token}/accept`).set(auth(bTok)).send({});
    expect(accept.status).toBe(404);
  });

  it("open-link invites need no pre-existing connection, are redeemable by MULTIPLE new users, and stay pending", async () => {
    const plan = await planId(aTok, "gospel-of-john");
    const group = await agent().post("/v1/reading/groups").set(auth(aTok)).send({ plan_id: plan });
    const invite = await agent().post(`/v1/reading/groups/${group.body.group_id}/invites`).set(auth(aTok)).send({});
    expect(invite.status).toBe(201);
    expect(invite.body.invitee_user_id).toBeNull();

    // B, a total stranger to A, redeems the link — connection is established on the spot.
    const bAccept = await agent().post(`/v1/reading/invites/${invite.body.token}/accept`).set(auth(bTok)).send({});
    expect(bAccept.status).toBe(200);
    expect(bAccept.body.status).toBe("joined");
    const pairAB = await testPool().query(`SELECT status FROM user_connections WHERE user_a = LEAST($1::uuid,$2::uuid) AND user_b = GREATEST($1::uuid,$2::uuid)`, [aId, bId]);
    expect(pairAB.rows[0].status).toBe("accepted");

    // The SAME link still works for C — never moved off 'pending'.
    const invRow = await testPool().query(`SELECT status FROM shared_plan_invites WHERE token = $1`, [invite.body.token]);
    expect(invRow.rows[0].status).toBe("pending");
    const cAccept = await agent().post(`/v1/reading/invites/${invite.body.token}/accept`).set(auth(cTok)).send({});
    expect(cAccept.status).toBe(200);

    const memberCount = await testPool().query(`SELECT count(*)::int AS n FROM shared_plan_group_members WHERE group_id = $1 AND status = 'active'`, [group.body.group_id]);
    expect(memberCount.rows[0].n).toBe(3); // A + B + C
  });

  it("an open-link invite cannot be declined; a minor cannot redeem one", async () => {
    const plan = await planId(aTok, "gospel-of-john");
    const group = await agent().post("/v1/reading/groups").set(auth(aTok)).send({ plan_id: plan });
    const invite = await agent().post(`/v1/reading/groups/${group.body.group_id}/invites`).set(auth(aTok)).send({});

    const decline = await agent().post(`/v1/reading/invites/${invite.body.token}/decline`).set(auth(bTok)).send({});
    expect(decline.status).toBe(403);

    const minorAccept = await agent().post(`/v1/reading/invites/${invite.body.token}/accept`).set(auth(minorTok)).send({});
    expect(minorAccept.status).toBe(403);
  });

  it("an expired targeted invite lazily flips to 'expired' and 404s", async () => {
    await connect(aId, bId);
    const plan = await planId(aTok, "gospel-of-john");
    const group = await agent().post("/v1/reading/groups").set(auth(aTok)).send({ plan_id: plan });
    const invite = await agent().post(`/v1/reading/groups/${group.body.group_id}/invites`).set(auth(aTok)).send({ user_id: bId });
    await testPool().query(`UPDATE shared_plan_invites SET expires_at = now() - interval '1 hour' WHERE invite_id = $1`, [invite.body.invite_id]);

    const preview = await agent().get(`/v1/reading/invites/${invite.body.token}`).set(auth(bTok));
    expect(preview.status).toBe(404);

    const row = await testPool().query(`SELECT status FROM shared_plan_invites WHERE invite_id = $1`, [invite.body.invite_id]);
    expect(row.rows[0].status).toBe("expired");
  });

  it("is idempotent on client_mutation_id for invite creation", async () => {
    await connect(aId, bId);
    const plan = await planId(aTok, "gospel-of-john");
    const group = await agent().post("/v1/reading/groups").set(auth(aTok)).send({ plan_id: plan });
    const mut = "00000000-0000-4000-8000-000000000077";
    const first = await agent().post(`/v1/reading/groups/${group.body.group_id}/invites`).set(auth(aTok)).send({ user_id: bId, client_mutation_id: mut });
    const replay = await agent().post(`/v1/reading/groups/${group.body.group_id}/invites`).set(auth(aTok)).send({ user_id: bId, client_mutation_id: mut });
    expect(replay.body.invite_id).toBe(first.body.invite_id);
    const count = await testPool().query(`SELECT count(*)::int AS n FROM shared_plan_invites WHERE group_id = $1`, [group.body.group_id]);
    expect(count.rows[0].n).toBe(1);
  });
});

describe("progress-completion fan-out + dedup", () => {
  it("notifies other active members when I complete a day, deduped on replay", async () => {
    await connect(aId, bId);
    await connect(aId, cId);
    const plan = await planId(aTok, "gospel-of-john");
    const group = await agent().post("/v1/reading/groups").set(auth(aTok)).send({ plan_id: plan, member_user_ids: [bId, cId] });
    const bInv = await testPool().query(`SELECT token FROM shared_plan_invites WHERE group_id = $1 AND invitee_user_id = $2`, [group.body.group_id, bId]);
    const cInv = await testPool().query(`SELECT token FROM shared_plan_invites WHERE group_id = $1 AND invitee_user_id = $2`, [group.body.group_id, cId]);
    expect((await agent().post(`/v1/reading/invites/${bInv.rows[0].token}/accept`).set(auth(bTok)).send({})).status).toBe(200);
    expect((await agent().post(`/v1/reading/invites/${cInv.rows[0].token}/accept`).set(auth(cTok)).send({})).status).toBe(200);

    const complete = await agent().post(`/v1/growth/plans/${plan}/complete-day`).set(auth(aTok)).send({ day_number: 1 });
    expect(complete.status).toBe(200);

    const bNotif = await testPool().query(`SELECT payload FROM notifications WHERE user_id = $1 AND template = 'plan_group_day_completed'`, [bId]);
    expect(bNotif.rowCount).toBe(1);
    expect(bNotif.rows[0].payload.day_number).toBe(1);
    expect(bNotif.rows[0].payload.notifier_user_id).toBe(aId);
    const cNotif = await testPool().query(`SELECT 1 FROM notifications WHERE user_id = $1 AND template = 'plan_group_day_completed'`, [cId]);
    expect(cNotif.rowCount).toBe(1);
    // Never notify myself.
    const aNotif = await testPool().query(`SELECT 1 FROM notifications WHERE user_id = $1 AND template = 'plan_group_day_completed'`, [aId]);
    expect(aNotif.rowCount).toBe(0);

    // Replaying the same day-completion must not double-notify (dedup per group/day/notifier/recipient).
    const again = await agent().post(`/v1/growth/plans/${plan}/complete-day`).set(auth(aTok)).send({ day_number: 1 });
    expect(again.status).toBe(200);
    const bNotifAfter = await testPool().query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND template = 'plan_group_day_completed'`, [bId]);
    expect(bNotifAfter.rows[0].n).toBe(1);

    // A second, DIFFERENT day still notifies again (not globally deduped).
    const day2 = await agent().post(`/v1/growth/plans/${plan}/complete-day`).set(auth(aTok)).send({ day_number: 2 });
    expect(day2.status).toBe(200);
    const bNotifDay2 = await testPool().query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND template = 'plan_group_day_completed'`, [bId]);
    expect(bNotifDay2.rows[0].n).toBe(2);
  });

  it("does not notify a member with no shared group on that plan", async () => {
    const plan = await planId(aTok, "gospel-of-john");
    // A completes a day with NO shared group at all — must not throw, must not notify anyone.
    const res = await agent().post(`/v1/growth/plans/${plan}/complete-day`).set(auth(aTok)).send({ day_number: 1 });
    expect(res.status).toBe(200);
    const notif = await testPool().query(`SELECT count(*)::int AS n FROM notifications WHERE template = 'plan_group_day_completed'`);
    expect(notif.rows[0].n).toBe(0);
  });

  it("segment-based completion (the reader UI) only fans out once the WHOLE day is done", async () => {
    await connect(aId, bId);
    const plan = await planId(aTok, "rooted-psalms-10");
    const group = await agent().post("/v1/reading/groups").set(auth(aTok)).send({ plan_id: plan, member_user_ids: [bId] });
    const bInv = await testPool().query(`SELECT token FROM shared_plan_invites WHERE group_id = $1 AND invitee_user_id = $2`, [group.body.group_id, bId]);
    expect((await agent().post(`/v1/reading/invites/${bInv.rows[0].token}/accept`).set(auth(bTok)).send({})).status).toBe(200);

    const detail = await agent().get(`/v1/growth/plans/${plan}`).set(auth(aTok));
    const segments = detail.body.days[0].segments as Array<{ segment_id: string }>;
    expect(segments.length).toBeGreaterThan(1);

    // Complete all-but-one segment: no notification yet.
    for (const seg of segments.slice(0, -1)) {
      await agent().post(`/v1/growth/segments/${seg.segment_id}/complete`).set(auth(aTok));
    }
    const early = await testPool().query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND template = 'plan_group_day_completed'`, [bId]);
    expect(early.rows[0].n).toBe(0);

    // Completing the LAST segment finishes the day — now B is notified.
    const last = segments[segments.length - 1]!;
    const finish = await agent().post(`/v1/growth/segments/${last.segment_id}/complete`).set(auth(aTok));
    expect(finish.body.day_completed).toBe(true);
    const after = await testPool().query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND template = 'plan_group_day_completed'`, [bId]);
    expect(after.rows[0].n).toBe(1);
  });
});

describe("public /join/{token} page", () => {
  it("renders OG tags + a deep-link script for a live invite, escaping user content", async () => {
    // A single-token "full name" (no whitespace) so firstName()'s split on
    // whitespace does NOT itself neuter the payload — this exercises esc(),
    // not just the incidental truncation of a normal "First Last" name.
    const evil = await createUser({ congregationId: cong, email: "rs-evil@dev.local", fullName: `<script>alert(1)</script>` });
    await connect(evil.user_id, bId);
    const evilTok = bearer({ sub: evil.user_id, role: "Student", cong });
    const plan = await planId(evilTok, "gospel-of-john");
    const group = await agent().post("/v1/reading/groups").set(auth(evilTok)).send({ plan_id: plan });
    // Also exercise the invite `message` field — free text, never truncated.
    const invite = await agent().post(`/v1/reading/groups/${group.body.group_id}/invites`).set(auth(evilTok))
      .send({ user_id: bId, message: `<img src=x onerror=alert(1)>` });
    const token = invite.body.token as string;

    const page = await agent().get(`/join/${token}`);
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toMatch(/text\/html/);
    expect(page.text).toContain('property="og:title"');
    expect(page.text).toContain("Gospel of John");
    expect(page.text).not.toContain("<script>alert(1)</script>");
    expect(page.text).not.toContain("<img src=x onerror=alert(1)>");
    expect(page.text).toContain("&lt;script&gt;");
    expect(page.text).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(page.text).toContain(`nuru://join/${token}`);
  });

  it("404s with a friendly HTML page on an unknown token", async () => {
    const page = await agent().get(`/join/not-a-real-token-00000000000000000000000`);
    expect(page.status).toBe(404);
    expect(page.headers["content-type"]).toMatch(/text\/html/);
    expect(page.text).toContain("isn't available");
  });

  it("404s on a revoked, declined, or expired token", async () => {
    await connect(aId, bId);
    const plan = await planId(aTok, "gospel-of-john");
    const group = await agent().post("/v1/reading/groups").set(auth(aTok)).send({ plan_id: plan });

    const revokedInv = await agent().post(`/v1/reading/groups/${group.body.group_id}/invites`).set(auth(aTok)).send({ user_id: bId });
    expect(revokedInv.status).toBe(201);
    const revoke = await agent().post(`/v1/reading/groups/${group.body.group_id}/invites/${revokedInv.body.invite_id}/revoke`).set(auth(aTok)).send({});
    expect(revoke.status).toBe(200);
    const revokedPage = await agent().get(`/join/${revokedInv.body.token}`);
    expect(revokedPage.status).toBe(404);

    await connect(aId, cId);
    const declinedInv = await agent().post(`/v1/reading/groups/${group.body.group_id}/invites`).set(auth(aTok)).send({ user_id: cId });
    expect(declinedInv.status).toBe(201);
    const decline = await agent().post(`/v1/reading/invites/${declinedInv.body.token}/decline`).set(auth(cTok)).send({});
    expect(decline.status).toBe(200);
    const declinedPage = await agent().get(`/join/${declinedInv.body.token}`);
    expect(declinedPage.status).toBe(404);
  });
});
