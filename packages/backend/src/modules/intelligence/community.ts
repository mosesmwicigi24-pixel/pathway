// Intelligence Phase 4 — community intelligence: the church knowing its own joys.
//   • Moments: the nightly scan DETECTS real milestones straight from the data
//     (module completed, level certificate, verse mastered, plan finished) and
//     writes one celebration row each — idempotent via UNIQUE(user, kind, ref).
//     No AI in the loop: titles are deterministic; nothing is generated about a
//     person (§5.4 — the feed shows only what the member's congregation could
//     already see them accomplish).
//   • Blessings: one-tap amen/heart/fire, one per member per moment (switching
//     kind updates it). First blessing notifies the celebrated member.
//   • Prayer chains: every ~15 min, new prayer-wall posts invite up to three
//     covenant pray-ers (cell first, then congregation) — recorded in
//     prayer_nudges so the scan is replay-safe and nobody is asked twice.
import type { Pool } from "pg";
import { many, maybeOne } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import type { NotificationService } from "../notifications/service.js";

export type MomentKind = "module_complete" | "level_complete" | "verse_mastered" | "plan_complete";
export type BlessingKind = "amen" | "heart" | "fire";
export const BLESSING_KINDS: BlessingKind[] = ["amen", "heart", "fire"];

export interface MomentRow {
  moment_id: string;
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  kind: MomentKind;
  title: string;
  occurred_at: string;
  amen_count: number;
  heart_count: number;
  fire_count: number;
  my_blessing: BlessingKind | null;
}

export class CommunityService {
  constructor(
    private readonly pool: Pool,
    private readonly notifications: NotificationService,
  ) {}

  // ---- Moments -------------------------------------------------------------

  /** Detect fresh milestones (last `windowHours`) and write celebration rows.
   *  Re-running is free: UNIQUE(user_id, kind, ref_id) absorbs replays. */
  async scanMoments(windowHours = 72): Promise<number> {
    const inserted = await this.pool.query(
      `WITH fresh AS (
         -- Modules completed
         SELECT e.user_id, 'module_complete'::text AS kind, mp.module_id AS ref_id,
                'Finished "' || m.title || '"' AS title, mp.completed_at AS occurred_at
           FROM module_progress mp
           JOIN enrollments e ON e.enrollment_id = mp.enrollment_id
           JOIN modules m ON m.module_id = mp.module_id
          WHERE mp.is_completed AND mp.completed_at > now() - make_interval(hours => $1)
         UNION ALL
         -- Level certificates issued
         SELECT c.user_id, 'level_complete', c.certificate_id,
                'Completed Level ' || c.level_number || ' of the Pathway', c.issued_at
           FROM certificates c
          WHERE c.level_number IS NOT NULL AND c.issued_at > now() - make_interval(hours => $1)
         UNION ALL
         -- Memory verses mastered
         SELECT vp.user_id, 'verse_mastered', vp.memory_verse_id,
                'Hid ' || v.reference || ' in their heart', vp.updated_at
           FROM memory_verse_progress vp
           JOIN memory_verses v ON v.memory_verse_id = vp.memory_verse_id
          WHERE vp.status = 'mastered' AND vp.updated_at > now() - make_interval(hours => $1)
         UNION ALL
         -- Reading plans finished
         SELECT rp.user_id, 'plan_complete', rp.plan_id,
                'Finished the "' || p.title || '" reading plan', rp.completed_at
           FROM reading_plan_progress rp
           JOIN reading_plans p ON p.plan_id = rp.plan_id
          WHERE rp.completed_at IS NOT NULL AND rp.completed_at > now() - make_interval(hours => $1)
       )
       INSERT INTO community_moments (user_id, congregation_id, kind, ref_id, title, occurred_at)
       SELECT f.user_id, u.congregation_id, f.kind, f.ref_id, f.title, f.occurred_at
         FROM fresh f
         JOIN users u ON u.user_id = f.user_id
        WHERE u.congregation_id IS NOT NULL
       ON CONFLICT (user_id, kind, ref_id) DO NOTHING`,
      [windowHours],
    );
    return inserted.rowCount ?? 0;
  }

  /** The congregation's recent celebrations (14 days), newest first. */
  async list(viewerId: string, limit = 30): Promise<MomentRow[]> {
    const viewer = await maybeOne<{ congregation_id: string | null }>(
      this.pool,
      `SELECT congregation_id FROM users WHERE user_id = $1`,
      [viewerId],
    );
    if (!viewer?.congregation_id) return [];
    return many<MomentRow>(
      this.pool,
      `SELECT cm.moment_id, cm.user_id, u.full_name, u.avatar_url, cm.kind, cm.title,
              cm.occurred_at::text AS occurred_at,
              count(*) FILTER (WHERE b.kind = 'amen')::int  AS amen_count,
              count(*) FILTER (WHERE b.kind = 'heart')::int AS heart_count,
              count(*) FILTER (WHERE b.kind = 'fire')::int  AS fire_count,
              min(b2.kind) AS my_blessing
         FROM community_moments cm
         JOIN users u ON u.user_id = cm.user_id
         LEFT JOIN moment_blessings b ON b.moment_id = cm.moment_id
         LEFT JOIN moment_blessings b2 ON b2.moment_id = cm.moment_id AND b2.user_id = $2
        WHERE cm.congregation_id = $1 AND cm.occurred_at > now() - interval '14 days'
        GROUP BY cm.moment_id, u.full_name, u.avatar_url
        ORDER BY cm.occurred_at DESC
        LIMIT $3`,
      [viewer.congregation_id, viewerId, limit],
    );
  }

  /** One-tap blessing — one per member per moment; a second tap switches kind.
   *  The FIRST blessing (not switches, not self) notifies the celebrated member. */
  async bless(viewerId: string, momentId: string, kind: BlessingKind): Promise<{ blessed: true; kind: BlessingKind }> {
    const moment = await maybeOne<{ user_id: string; congregation_id: string | null; title: string }>(
      this.pool,
      `SELECT user_id, congregation_id, title FROM community_moments WHERE moment_id = $1`,
      [momentId],
    );
    if (!moment) throw new ApiError("NOT_FOUND", "Moment not found");
    const viewer = await maybeOne<{ congregation_id: string | null }>(
      this.pool,
      `SELECT congregation_id FROM users WHERE user_id = $1`,
      [viewerId],
    );
    if (!viewer?.congregation_id || viewer.congregation_id !== moment.congregation_id) {
      throw new ApiError("FORBIDDEN_SCOPE", "This celebration is outside your congregation");
    }

    const row = await maybeOne<{ inserted: boolean }>(
      this.pool,
      `INSERT INTO moment_blessings (moment_id, user_id, kind) VALUES ($1, $2, $3)
       ON CONFLICT (moment_id, user_id) DO UPDATE SET kind = $3
       RETURNING (xmax = 0) AS inserted`,
      [momentId, viewerId, kind],
    );
    if (row?.inserted && moment.user_id !== viewerId) {
      try {
        await this.notifications.schedule({
          userId: moment.user_id,
          channel: "push",
          template: "community_blessing",
          payload: {
            moment_id: momentId,
            kind,
            title: "You were celebrated \u{1F389}",
            body: `${kind === "amen" ? "\u{1F64C}" : kind === "heart" ? "\u2764\uFE0F" : "\u{1F525}"} ${moment.title} — your church family sees it.`,
          },
        });
      } catch {
        /* best-effort */
      }
    }
    return { blessed: true, kind };
  }

  // ---- Prayer chains ---------------------------------------------------------

  /** Invite up to `perPost` covenant pray-ers to each new prayer-wall post
   *  (created within `windowMinutes`). Cell-mates first, then congregation.
   *  prayer_nudges makes replays no-ops; the notification day-cap and quiet
   *  hours are handled by NotificationService like every other nudge. */
  async scanPrayerChains(windowMinutes = 30, perPost = 3): Promise<number> {
    const posts = await many<{ post_id: string; author_user_id: string; congregation_id: string; cell_group_id: string | null }>(
      this.pool,
      `SELECT p.post_id, p.author_user_id, p.congregation_id, u.cell_group_id
         FROM prayer_wall_posts p
         JOIN users u ON u.user_id = p.author_user_id
        WHERE p.created_at > now() - make_interval(mins => $1)
          AND NOT p.is_hidden AND p.congregation_id IS NOT NULL`,
      [windowMinutes],
    );
    let nudged = 0;
    for (const post of posts) {
      const picked = await many<{ user_id: string }>(
        this.pool,
        `SELECT u.user_id
           FROM users u
          WHERE u.congregation_id = $1 AND u.user_id <> $2
            AND NOT EXISTS (SELECT 1 FROM prayer_nudges n WHERE n.post_id = $3 AND n.user_id = u.user_id)
          ORDER BY (u.cell_group_id IS NOT DISTINCT FROM $4) DESC, random()
          LIMIT greatest($5 - (SELECT count(*) FROM prayer_nudges n2 WHERE n2.post_id = $3), 0)`,
        [post.congregation_id, post.author_user_id, post.post_id,
         post.cell_group_id, perPost],
      );
      for (const p of picked) {
        const ins = await this.pool.query(
          `INSERT INTO prayer_nudges (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [post.post_id, p.user_id],
        );
        if ((ins.rowCount ?? 0) === 0) continue;
        nudged += 1;
        try {
          await this.notifications.schedule({
            userId: p.user_id,
            channel: "push",
            template: "prayer_chain",
            payload: {
              post_id: post.post_id,
              title: "Stand with a friend in prayer",
              body: "Someone in your family just shared a prayer need. Will you pray with them today?",
            },
          });
        } catch {
          /* best-effort */
        }
      }
    }
    return nudged;
  }
}
