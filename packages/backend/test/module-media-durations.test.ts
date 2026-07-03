// Module media durations + admin-controlled audio (purely additive over the
// content_pages split). Admin sets audio_url + real video/audio durations; the
// member getModule returns them with the media URLs BROKERED to signed, expiring
// URLs (raw storage refs never leak, §4.5) exactly like a hosted video. Unset
// media stays null. Gating/scoring/pagination are untouched. Wire names are the
// FIXED contract the iOS build consumes: video_url (signed), video_duration_sec,
// audio_url (signed|null), audio_duration_sec.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser, createEnrollment, createModule } from "./helpers/factories.js";
import { CurriculumService, brokerMediaUrl } from "../src/modules/curriculum/service.js";
import { AdminCurriculumService } from "../src/modules/curriculum/admin.js";
import { MediaService } from "../src/modules/media/service.js";

// A configured signer so member reads exercise the real brokering path (the app
// wires MediaService(CLOUDINARY_URL); test env has none, so inject one here).
const signer = new MediaService("cloudinary://key:secret@democloud");
const member = () => new CurriculumService(testPool(), undefined, signer);
const admin = () => new AdminCurriculumService(testPool());

interface ModuleView {
  video_url: string | null;
  video_duration_sec: number | null;
  audio_url: string | null;
  audio_duration_sec: number | null;
}

describe("module media durations + admin-controlled audio", () => {
  let userId: string;
  let editorId: string;
  let l1m1: string; // universal entry point — always unlocked, no gating setup

  beforeEach(async () => {
    await resetDb();
    const cong = await createCongregation();
    userId = (await createUser({ congregationId: cong, email: "s@dev.local" })).user_id;
    editorId = (await createUser({ congregationId: cong, role: "Admin", email: "a@dev.local" })).user_id;
    await createEnrollment(userId, 1);
    l1m1 = await createModule(1, 1, { published: true });
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("unset media reads back as null everywhere (member + admin)", async () => {
    const m = (await member().getModule(userId, l1m1)) as ModuleView;
    expect(m.video_url).toBeNull();
    expect(m.video_duration_sec).toBeNull();
    expect(m.audio_url).toBeNull();
    expect(m.audio_duration_sec).toBeNull();

    const a = (await admin().getModule(l1m1)) as ModuleView;
    expect(a.audio_url).toBeNull();
    expect(a.audio_duration_sec).toBeNull();
    expect(a.video_duration_sec).toBeNull();
  });

  it("admin sets audio_url + durations; ADMIN getModule returns them RAW", async () => {
    await admin().updateModule(l1m1, editorId, {
      audio_url: "https://cdn.example.com/lessons/intro-audio.mp3",
      audio_duration_sec: 480,
      video_duration_sec: 900,
    });
    const a = (await admin().getModule(l1m1)) as ModuleView;
    expect(a.audio_url).toBe("https://cdn.example.com/lessons/intro-audio.mp3"); // raw for admins
    expect(a.audio_duration_sec).toBe(480);
    expect(a.video_duration_sec).toBe(900);
  });

  it("member getModule returns the durations and BROKERS a hosted audio_url (signed, not raw)", async () => {
    // A hosted object key (not an absolute URL) → must be signed for members.
    await admin().updateModule(l1m1, editorId, {
      audio_duration_sec: 480,
      video_duration_sec: 900,
    });
    // Store an object-key style ref directly (bypasses the .url() schema on purpose)
    // to prove the broker signs hosted refs rather than leaking them raw.
    await testPool().query(`UPDATE modules SET audio_url = $1, video_url = $2 WHERE module_id = $3`, [
      "lessons/intro-audio.mp3",
      "lessons/intro-video.mp4",
      l1m1,
    ]);

    const m = (await member().getModule(userId, l1m1)) as ModuleView;
    // durations pass through as whole seconds
    expect(m.audio_duration_sec).toBe(480);
    expect(m.video_duration_sec).toBe(900);
    // brokered: never the raw key; a signed, expiring Cloudinary URL instead
    expect(m.audio_url).not.toBe("lessons/intro-audio.mp3");
    expect(m.audio_url).toContain("res.cloudinary.com");
    expect(m.audio_url).toMatch(/sig=[0-9a-f]{32}/);
    expect(m.audio_url).toMatch(/expires=\d+/);
    expect(m.video_url).toContain("res.cloudinary.com"); // video brokered the same way
    expect(m.video_url).not.toBe("lessons/intro-video.mp4");
  });

  it("member getModule passes an external http(s) audio_url through unchanged (shareable link)", async () => {
    await admin().updateModule(l1m1, editorId, {
      audio_url: "https://cdn.example.com/lessons/intro-audio.mp3",
    });
    const m = (await member().getModule(userId, l1m1)) as ModuleView;
    expect(m.audio_url).toBe("https://cdn.example.com/lessons/intro-audio.mp3"); // external → no signing
  });

  it("brokerMediaUrl: null/no-signer/external pass through; hosted keys sign", () => {
    expect(brokerMediaUrl(null, signer)).toBeNull();
    expect(brokerMediaUrl("lessons/x.mp3", undefined)).toBe("lessons/x.mp3"); // no signer → raw
    expect(brokerMediaUrl("https://x/y.mp3", signer)).toBe("https://x/y.mp3"); // external → raw
    expect(brokerMediaUrl("lessons/x.mp3", signer)).toContain("res.cloudinary.com"); // hosted → signed
  });

  it("the admin update schema accepts the new media fields (wire contract, fixed for iOS)", () => {
    const ok = AdminCurriculumService.UpdateModule.safeParse({
      audio_url: "https://cdn.example.com/a.mp3",
      audio_duration_sec: 300,
      video_duration_sec: 600,
    });
    expect(ok.success).toBe(true);
    // nullable to clear, ints must be non-negative
    expect(AdminCurriculumService.UpdateModule.safeParse({ audio_url: null, audio_duration_sec: null }).success).toBe(true);
    expect(AdminCurriculumService.UpdateModule.safeParse({ audio_duration_sec: -1 }).success).toBe(false);
    expect(AdminCurriculumService.UpdateModule.safeParse({ audio_url: "not-a-url" }).success).toBe(false);
  });
});
