// Media placements (docs/CURRICULUM_ARCHITECTURE.md §2.2): one asset, many
// modules. CRUD + duplicate 409 + the modules.media_asset_id MIRROR invariant
// (the derived cache that keeps member reads byte-identical) + the §1.9
// any-placement manifest gate + the library placements[] round-trip.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { agent, bearer } from "./helpers/app.js";
import { createCongregation, createUser, createEnrollment, createModule } from "./helpers/factories.js";
import { MediaService } from "../src/modules/media/service.js";
import { VideoService } from "../src/modules/media/video.js";
import { CloudinaryProvider } from "../src/modules/media/pipeline.js";

const media = new MediaService("cloudinary://key:secret@democloud");
const newVideo = () => new VideoService(testPool(), media, new CloudinaryProvider());

let cong: string, adminId: string, studentId: string, adminTok: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  adminId = (await createUser({ congregationId: cong, role: "Admin", email: "a@dev.local" })).user_id;
  studentId = (await createUser({ congregationId: cong, role: "Student", email: "s@dev.local" })).user_id;
  await createEnrollment(studentId, 1);
  adminTok = bearer({ sub: adminId, role: "Admin", cong });
});
afterAll(async () => {
  await closeTestPool();
});

async function makeAsset(): Promise<string> {
  const session = await newVideo().createUploadSession(adminId, {});
  return session.media_asset_id;
}

/** Upload + transcode so the asset is 'ready' and manifest-servable. */
async function makeReadyAsset(): Promise<string> {
  const v = newVideo();
  const session = await v.createUploadSession(adminId, {});
  await v.completeUpload(adminId, session.upload_id, {});
  await v.transcodeAsset({ media_asset_id: session.media_asset_id, content_hash: "z".repeat(64) });
  return session.media_asset_id;
}

const mirrorOf = async (moduleId: string): Promise<string | null> =>
  (await testPool().query("SELECT media_asset_id FROM modules WHERE module_id=$1", [moduleId])).rows[0]
    .media_asset_id;

const place = (assetId: string, body: Record<string, unknown>) =>
  agent().post(`/v1/admin/media/${assetId}/placements`).set("Authorization", adminTok).send(body);

describe("placement CRUD (§2.2)", () => {
  it("places an asset; 404 unknown asset/module; 409 on the duplicate pair", async () => {
    const asset = await makeAsset();
    const mod = await createModule(1, 1, { published: false });

    const created = await place(asset, { module_id: mod, position: 0, required: true });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ media_asset_id: asset, module_id: mod, position: 0, required: true });
    expect(created.body.placement_id).toBeTruthy();

    // Duplicate (asset, module) pair → 409.
    const dup = await place(asset, { module_id: mod });
    expect(dup.status).toBe(409);

    // Unknown asset / unknown module → 404.
    const ghost = "00000000-0000-4000-8000-00000000dead";
    expect((await place(ghost, { module_id: mod })).status).toBe(404);
    expect((await place(asset, { module_id: ghost })).status).toBe(404);
  });

  it("a placed asset round-trips through GET /admin/modules/:id/media and GET /admin/media", async () => {
    const asset = await makeAsset();
    const mod = await createModule(1, 1, { published: false, title: "Walking in Grace" });
    await place(asset, { module_id: mod, position: 3, required: false });

    // Module side: the placement with the asset's library fields.
    const modMedia = await agent().get(`/v1/admin/modules/${mod}/media`).set("Authorization", adminTok);
    expect(modMedia.status).toBe(200);
    expect(modMedia.body.data).toHaveLength(1);
    const p = modMedia.body.data[0];
    expect(p).toMatchObject({ media_asset_id: asset, position: 3, required: false });
    expect(p).toHaveProperty("title");
    expect(p).toHaveProperty("duration_sec");
    expect(p).toHaveProperty("status");
    expect(p).toHaveProperty("thumbnail_url");

    // Library side: the asset row carries placements[] (level inferred from the
    // module) alongside the legacy attached_module_* mirror fields.
    const lib = await agent().get("/v1/admin/media").set("Authorization", adminTok);
    expect(lib.status).toBe(200);
    const row = lib.body.data.find((r: { media_asset_id: string }) => r.media_asset_id === asset);
    expect(row.placements).toEqual([{ module_id: mod, module_title: "Walking in Grace", level_number: 1 }]);
    expect(row.attached_module_id).toBe(mod); // mirror kept for old clients
  });

  it("404 on GET module media for an unknown module and on deleting an unknown placement", async () => {
    const ghost = "00000000-0000-4000-8000-00000000dead";
    expect((await agent().get(`/v1/admin/modules/${ghost}/media`).set("Authorization", adminTok)).status).toBe(404);
    expect(
      (await agent().delete(`/v1/admin/media/placements/${ghost}`).set("Authorization", adminTok)).status,
    ).toBe(404);
  });
});

describe("mirror invariant — modules.media_asset_id follows the lowest-position placement", () => {
  it("place two, reorder, delete primary → the mirror follows; empty → NULL", async () => {
    const assetA = await makeAsset();
    const assetB = await makeAsset();
    const mod = await createModule(1, 1, { published: false });

    // Place A at position 0 → primary.
    const pa = await place(assetA, { module_id: mod, position: 0 });
    expect(await mirrorOf(mod)).toBe(assetA);

    // Place B behind A → mirror unchanged.
    const pb = await place(assetB, { module_id: mod, position: 1 });
    expect(await mirrorOf(mod)).toBe(assetA);

    // Reorder: move A behind B (re-place at a higher position) → B is primary.
    await agent().delete(`/v1/admin/media/placements/${pa.body.placement_id}`).set("Authorization", adminTok);
    await place(assetA, { module_id: mod, position: 5 });
    expect(await mirrorOf(mod)).toBe(assetB);

    // Delete the primary (B) → the mirror falls back to A.
    const del = await agent()
      .delete(`/v1/admin/media/placements/${pb.body.placement_id}`)
      .set("Authorization", adminTok);
    expect(del.status).toBe(200);
    expect(await mirrorOf(mod)).toBe(assetA);

    // Delete the last placement → mirror NULL.
    const rest = await agent().get(`/v1/admin/modules/${mod}/media`).set("Authorization", adminTok);
    await agent()
      .delete(`/v1/admin/media/placements/${rest.body.data[0].placement_id}`)
      .set("Authorization", adminTok);
    expect(await mirrorOf(mod)).toBeNull();
  });
});

describe("manifest any-placement gating (§1.9 hard-lock)", () => {
  it("only-locked placement → 409 GATE_LOCKED; adding an unlocked placement makes it available", async () => {
    const v = newVideo();
    const asset = await makeReadyAsset();

    // L1·M1 (universal entry point — always open) + L1·M2 (locked until M1 done).
    const m1 = await createModule(1, 1, { published: true });
    const m2 = await createModule(1, 2, { published: true });

    // Placed ONLY in the locked module → 409 for a fresh member.
    const locked = await place(asset, { module_id: m2 });
    expect(locked.status).toBe(201);
    await expect(v.manifest(studentId, asset)).rejects.toMatchObject({ code: "GATE_LOCKED" });

    // Also placed in the unlocked module (shared asset) → available: ANY
    // unlocked placement grants access through the shared predicate.
    await place(asset, { module_id: m1 });
    const out = await v.manifest(studentId, asset);
    expect(out.url).toContain("res.cloudinary.com");
  });

  it("assets with no placements keep the legacy mirror-column behavior", async () => {
    const v = newVideo();
    const asset = await makeReadyAsset();
    await createModule(1, 1, { published: true });
    const m2 = await createModule(1, 2, { published: true });
    // Attach via the legacy single-FK mirror only (no placement rows).
    await testPool().query("UPDATE modules SET media_asset_id=$1 WHERE module_id=$2", [asset, m2]);
    await expect(v.manifest(studentId, asset)).rejects.toMatchObject({ code: "GATE_LOCKED" });
  });
});

describe("media library title has one owner (the asset)", () => {
  it("register + edit store the title on the asset — the reverse-write into modules.title is gone", async () => {
    const mod = await createModule(1, 1, { published: false, title: "Original Module Title" });

    const reg = await agent()
      .post("/v1/admin/media/external")
      .set("Authorization", adminTok)
      .send({ video_source: "youtube", url: "https://youtu.be/dQw4w9WgXcQ", title: "Asset Title" });
    expect(reg.status).toBe(201);
    expect(reg.body.title).toBe("Asset Title");
    const asset = reg.body.media_asset_id as string;

    // Attach it to the module, then retitle the ASSET — the module keeps its own title.
    await place(asset, { module_id: mod });
    const upd = await agent()
      .patch(`/v1/admin/media/${asset}`)
      .set("Authorization", adminTok)
      .send({ title: "Retitled Asset" });
    expect(upd.status).toBe(200);
    expect(upd.body.title).toBe("Retitled Asset");

    const t = await testPool().query("SELECT title FROM modules WHERE module_id=$1", [mod]);
    expect(t.rows[0].title).toBe("Original Module Title"); // no reverse-write
  });
});
