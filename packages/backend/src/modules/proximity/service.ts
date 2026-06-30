// Location → proximity → cell-pairing (parity gap #4, Phase 1 — backend only).
// Privacy-first per docs/LOCATION_PROXIMITY_DESIGN.md (§8, signed 2026-06-30):
//
//   * Ingest takes APPROXIMATE lat/lng, derives a 6-char geohash (~1.2 km) server
//     side, stores ONLY the geohash, and DISCARDS the coordinates. There is no
//     lat/lng column anywhere.
//   * Minors (users.is_minor) may only have location collected while an ACTIVE
//     `location_sharing` guardian consent exists — otherwise ingest 403s. Revoking
//     that consent (or the member opting out) immediately deletes member_location.
//   * The suggestions endpoint returns only coarse cluster labels, approximate
//     distances, and member lists — never a geohash or any coordinate. Minors are
//     filtered out entirely unless the requester holds the coarse Admin role.
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, tx, audit, type Queryable } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { encodeGeohash, geohashCenter, haversineKm } from "./geo.js";

export interface ProximityMember {
  user_id: string;
  full_name: string;
  is_minor: boolean;
  cell_group_id: string | null;
}

export interface ProximityCluster {
  area: string; // coarse label, e.g. "≈ -1.286, 36.817" cell center (rounded)
  member_count: number;
  approx_radius_km: number;
  members: ProximityMember[];
}

interface LocationRow {
  user_id: string;
  geohash6: string;
  full_name: string;
  is_minor: boolean;
  cell_group_id: string | null;
}

export class ProximityService {
  constructor(private readonly pool: Pool) {}

  // Approximate coordinates from the device. Validated to plausible ranges; the
  // value is used only to derive a coarse geohash and is then discarded.
  static readonly LocationIngest = z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .strict();

  // Guardian location-sharing consent for a minor (audited). Mirrors the existing
  // guardian-consent shape; this is a DISTINCT, separately revocable consent type.
  static readonly LocationConsent = z
    .object({
      guardian_name: z.string().min(1).max(255),
      relationship: z.string().min(1).max(60),
      consent_text_version: z.string().min(1).max(20),
    })
    .strict();

  private async isMinor(c: Queryable, userId: string): Promise<boolean> {
    const u = await maybeOne<{ is_minor: boolean }>(c, `SELECT is_minor FROM users WHERE user_id = $1`, [userId]);
    if (!u) throw new ApiError("NOT_FOUND", "Member not found");
    return u.is_minor;
  }

  private async hasActiveLocationConsent(c: Queryable, userId: string): Promise<boolean> {
    const row = await maybeOne(
      c,
      `SELECT 1 FROM guardian_consents
        WHERE user_id = $1 AND consent_type = 'location_sharing' AND revoked_at IS NULL
        LIMIT 1`,
      [userId],
    );
    return row !== null;
  }

  /**
   * Member opt-in / refresh. Computes geohash6 from approximate coordinates and
   * upserts the single coarse row, then DISCARDS lat/lng. Minors without an active
   * location_sharing guardian consent are rejected (403 CONSENT_REQUIRED).
   */
  async ingest(userId: string, input: z.infer<typeof ProximityService.LocationIngest>): Promise<{ ok: true }> {
    const geohash6 = encodeGeohash(input.lat, input.lng, 6);
    // input.lat / input.lng go out of scope here — never persisted.
    return tx(this.pool, async (c) => {
      if (await this.isMinor(c, userId)) {
        if (!(await this.hasActiveLocationConsent(c, userId))) {
          throw new ApiError(
            "CONSENT_REQUIRED",
            "Guardian location-sharing consent is required before a minor can share location",
            { code: "LOCATION_CONSENT_REQUIRED" },
          );
        }
      }
      await c.query(
        `INSERT INTO member_location (user_id, geohash6, consent_at, updated_at)
           VALUES ($1, $2, now(), now())
         ON CONFLICT (user_id) DO UPDATE
           SET geohash6 = EXCLUDED.geohash6, updated_at = now()`,
        [userId, geohash6],
      );
      return { ok: true as const };
    });
  }

  /** Member opt-out — erase the stored coarse location immediately. */
  async optOut(userId: string): Promise<{ ok: true }> {
    await this.pool.query(`DELETE FROM member_location WHERE user_id = $1`, [userId]);
    return { ok: true };
  }

  /**
   * Guardian grants location_sharing consent for a minor (audited). One active
   * consent per member; the existing onboarding consent is untouched.
   */
  async grantLocationConsent(
    minorUserId: string,
    recordedBy: string,
    input: z.infer<typeof ProximityService.LocationConsent>,
  ): Promise<{ ok: true }> {
    return tx(this.pool, async (c) => {
      if (!(await this.isMinor(c, minorUserId))) {
        throw new ApiError("UNPROCESSABLE", "Location-sharing guardian consent only applies to minors");
      }
      const existing = await maybeOne(
        c,
        `SELECT 1 FROM guardian_consents WHERE user_id = $1 AND consent_type = 'location_sharing' AND revoked_at IS NULL`,
        [minorUserId],
      );
      if (existing) throw new ApiError("CONFLICT", "Location consent already on file; revoke before recording a new one");
      // guardian_contact is NOT NULL on the table but unused for location consent;
      // store an empty marker (no PII collected for this consent type).
      await c.query(
        `INSERT INTO guardian_consents (user_id, guardian_name, guardian_contact, relationship, consent_text_version, recorded_by, consent_type)
           VALUES ($1,$2,'',$3,$4,$5,'location_sharing')`,
        [minorUserId, input.guardian_name, input.relationship, input.consent_text_version, recordedBy],
      );
      await audit(c, recordedBy, "proximity.location_consent_granted", "users", minorUserId, {
        version: input.consent_text_version,
      });
      return { ok: true as const };
    });
  }

  /**
   * Guardian revokes location_sharing consent for a minor. Marks the consent
   * revoked AND immediately deletes the minor's stored coarse location (audited).
   */
  async revokeLocationConsent(minorUserId: string, recordedBy: string): Promise<{ ok: true }> {
    return tx(this.pool, async (c) => {
      const active = await maybeOne<{ consent_id: string }>(
        c,
        `SELECT consent_id FROM guardian_consents
          WHERE user_id = $1 AND consent_type = 'location_sharing' AND revoked_at IS NULL`,
        [minorUserId],
      );
      if (!active) throw new ApiError("NOT_FOUND", "No active location-sharing consent to revoke");
      await c.query(`UPDATE guardian_consents SET revoked_at = now() WHERE consent_id = $1`, [active.consent_id]);
      // Revocation halts processing immediately — erase the stored location.
      await c.query(`DELETE FROM member_location WHERE user_id = $1`, [minorUserId]);
      await audit(c, recordedBy, "proximity.location_consent_revoked", "users", minorUserId, {});
      return { ok: true as const };
    });
  }

  /**
   * Coarse proximity suggestions. Eligible = opted-in members where adults are
   * always included and minors only with an active location_sharing consent.
   * Greedy single-linkage clustering by haversine distance between geohash
   * centers within `radiusKm`. Minors are filtered out of the response entirely
   * unless `includeMinors` (the requester holds the coarse Admin role).
   *
   * NEVER returns geohash6 or coordinates.
   */
  async suggestions(opts: { radiusKm: number; includeMinors: boolean }): Promise<{ clusters: ProximityCluster[] }> {
    const radiusKm = opts.radiusKm;
    const rows = await many<LocationRow>(
      this.pool,
      `SELECT ml.user_id, ml.geohash6, u.full_name, u.is_minor, u.cell_group_id
         FROM member_location ml
         JOIN users u ON u.user_id = ml.user_id AND u.deleted_at IS NULL
        WHERE u.is_minor = false
           OR EXISTS (
             SELECT 1 FROM guardian_consents gc
              WHERE gc.user_id = ml.user_id
                AND gc.consent_type = 'location_sharing'
                AND gc.revoked_at IS NULL
           )`,
    );

    // Filter minors out for non-Admin requesters BEFORE clustering, so coach-tier
    // never sees minor presence in any form.
    const eligible = opts.includeMinors ? rows : rows.filter((r) => !r.is_minor);

    // Greedy single-linkage clustering: seed a cluster per ungrouped member,
    // absorb any member whose geohash center is within radius of the seed center.
    const centers = new Map<string, { lat: number; lng: number }>();
    const centerOf = (hash: string): { lat: number; lng: number } => {
      let c = centers.get(hash);
      if (!c) {
        c = geohashCenter(hash);
        centers.set(hash, c);
      }
      return c;
    };

    const used = new Set<number>();
    const clusters: ProximityCluster[] = [];
    for (let i = 0; i < eligible.length; i += 1) {
      if (used.has(i)) continue;
      const seed = eligible[i]!;
      const seedCenter = centerOf(seed.geohash6);
      const group: LocationRow[] = [seed];
      used.add(i);
      let maxFromSeed = 0;
      for (let j = i + 1; j < eligible.length; j += 1) {
        if (used.has(j)) continue;
        const cand = eligible[j]!;
        const d = haversineKm(seedCenter, centerOf(cand.geohash6));
        if (d <= radiusKm) {
          group.push(cand);
          used.add(j);
          if (d > maxFromSeed) maxFromSeed = d;
        }
      }
      clusters.push({
        area: `≈ ${seedCenter.lat.toFixed(2)}, ${seedCenter.lng.toFixed(2)}`,
        member_count: group.length,
        approx_radius_km: Math.round(maxFromSeed * 10) / 10,
        members: group.map((m) => ({
          user_id: m.user_id,
          full_name: m.full_name,
          is_minor: m.is_minor,
          cell_group_id: m.cell_group_id,
        })),
      });
    }
    // Most-populated clusters first — the actionable pairing opportunities.
    clusters.sort((a, b) => b.member_count - a.member_count);
    return { clusters };
  }
}
