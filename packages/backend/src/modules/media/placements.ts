// Media placements (docs/CURRICULUM_ARCHITECTURE.md §2.2). One asset, many
// module placements; the level is always inferred from the module — never asked
// for twice, never stored. Placements are AUTHORITATIVE; modules.media_asset_id
// is kept as a derived mirror of each module's lowest-position placement so
// every existing member read stays byte-identical (§1.9 compat).
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx, recordChange, audit, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "23505";
}

export class MediaPlacementService {
  constructor(private readonly pool: Pool) {}

  static readonly Create = z
    .object({
      module_id: z.string().uuid(),
      position: z.number().int().min(-10_000).max(10_000).optional(),
      required: z.boolean().optional(),
    })
    .strict();

  /** Placements of a module, position-ordered, with the asset's library fields. */
  async listForModule(moduleId: string): Promise<unknown[]> {
    const module = await maybeOne(this.pool, `SELECT 1 FROM modules WHERE module_id = $1`, [moduleId]);
    if (!module) throw new ApiError("NOT_FOUND", "Module not found");
    return many(
      this.pool,
      `SELECT p.placement_id, p.media_asset_id, p.position, p.required,
              ma.title, ma.caption, ma.duration_sec, ma.status, ma.thumbnail_url,
              ma.video_source, ma.external_url
         FROM media_placements p
         JOIN media_assets ma ON ma.media_asset_id = p.media_asset_id
        WHERE p.module_id = $1
        ORDER BY p.position, p.created_at, p.placement_id`,
      [moduleId],
    );
  }

  /** Place an asset in a module. 404 unknown asset/module; 409 duplicate pair. */
  async place(
    adminId: string,
    mediaAssetId: string,
    input: z.infer<typeof MediaPlacementService.Create>,
  ): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const asset = await maybeOne(
        c,
        `SELECT 1 FROM media_assets WHERE media_asset_id = $1 AND deleted_at IS NULL`,
        [mediaAssetId],
      );
      if (!asset) throw new ApiError("NOT_FOUND", "Media asset not found");
      const module = await maybeOne<{ level_number: number }>(
        c,
        `SELECT level_number FROM modules WHERE module_id = $1`,
        [input.module_id],
      );
      if (!module) throw new ApiError("NOT_FOUND", "Module not found");

      let row: { placement_id: string; media_asset_id: string; module_id: string; position: number; required: boolean };
      try {
        row = await one(
          c,
          `INSERT INTO media_placements (media_asset_id, module_id, position, required)
           VALUES ($1, $2, COALESCE($3, 0), COALESCE($4, TRUE))
           RETURNING placement_id, media_asset_id, module_id, position, required`,
          [mediaAssetId, input.module_id, input.position ?? null, input.required ?? null],
        );
      } catch (e) {
        if (isUniqueViolation(e)) {
          throw new ApiError("CONFLICT", "Asset is already placed in this module");
        }
        throw e;
      }
      await this.syncMirror(c, input.module_id, adminId);
      await audit(c, adminId, "media.placed", "media_placements", row.placement_id, {
        media_asset_id: mediaAssetId,
        module_id: input.module_id,
        level_number: module.level_number, // inferred, never asked for
      });
      return row;
    });
  }

  /** Remove one placement (never the asset). The mirror column follows. */
  async remove(adminId: string, placementId: string): Promise<{ deleted: boolean }> {
    return tx(this.pool, async (c) => {
      const row = await maybeOne<{ media_asset_id: string; module_id: string }>(
        c,
        `DELETE FROM media_placements WHERE placement_id = $1 RETURNING media_asset_id, module_id`,
        [placementId],
      );
      if (!row) throw new ApiError("NOT_FOUND", "Placement not found");
      await this.syncMirror(c, row.module_id, adminId);
      await audit(c, adminId, "media.unplaced", "media_placements", placementId, {
        media_asset_id: row.media_asset_id,
        module_id: row.module_id,
      });
      return { deleted: true };
    });
  }

  /**
   * MIRROR INVARIANT: after any placement change, modules.media_asset_id is the
   * module's lowest-position placement's asset — NULL when none remain. Guarded
   * with IS DISTINCT FROM so untouched modules don't churn row_version.
   */
  private async syncMirror(c: Queryable, moduleId: string, adminId: string): Promise<void> {
    const res = await c.query(
      `UPDATE modules m
          SET media_asset_id = sub.primary_asset
         FROM (
           SELECT (SELECT p.media_asset_id
                     FROM media_placements p
                    WHERE p.module_id = $1
                    ORDER BY p.position, p.created_at, p.placement_id
                    LIMIT 1) AS primary_asset
         ) sub
        WHERE m.module_id = $1
          AND m.media_asset_id IS DISTINCT FROM sub.primary_asset`,
      [moduleId],
    );
    if ((res.rowCount ?? 0) > 0) await recordChange(c, "modules", moduleId, adminId, "upsert");
  }
}
