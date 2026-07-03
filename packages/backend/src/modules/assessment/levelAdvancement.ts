// Level advancement — the discipler "usher" gate (§1.9, §5.4). Passing a level
// exam records a PENDING advancement (see exam.ts); a discipler (Instructor+,
// scoped to their assigned cells) reviews the queue here and USHERS the member.
// Ushering is the ONLY thing that flips enrollments.current_level to N+1 — the
// exam-pass is the member's solo effort, the usher is the human-in-the-loop that
// opens the next level. Every usher is scope-checked, audited, and notified.
import type { Pool } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx, recordChange, audit } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { assertCellInScope } from "../../http/auth.js";
import type { Principal } from "../../http/http.js";
import { NotificationService } from "../notifications/service.js";

const MAX_LEVEL = 5;

export class LevelAdvancementService {
  private readonly notifications: NotificationService;

  constructor(
    private readonly pool: Pool,
    notifications?: NotificationService,
  ) {
    this.notifications = notifications ?? new NotificationService(pool);
  }

  static readonly UsherBody = z.object({ note: z.string().max(2000).optional() }).strict();

  /**
   * Pending advancements for members the discipler leads. Admin/SuperAdmin see
   * every congregation; an Instructor/Multiplier sees only members in their
   * assigned cells (§5.4). One item per (member, level) awaiting the usher.
   */
  async listPending(principal: Principal): Promise<unknown[]> {
    const base = `SELECT la.id, la.user_id, u.full_name AS member_name, la.level_number,
                         lea.score_achieved AS exam_score, la.created_at
                    FROM level_advancements la
                    JOIN users u ON u.user_id = la.user_id
                    LEFT JOIN level_exam_attempts lea ON lea.exam_attempt_id = la.exam_attempt_id
                   WHERE la.status = 'pending'`;
    if (principal.role === "SuperAdmin" || principal.role === "Admin") {
      return this.shape(await many(this.pool, `${base} ORDER BY la.created_at`));
    }
    return this.shape(
      await many(
        this.pool,
        `${base}
           AND u.cell_group_id IN (
             SELECT cell_group_id FROM leader_assignments WHERE leader_user_id = $1
           )
         ORDER BY la.created_at`,
        [principal.userId],
      ),
    );
  }

  /** exam_score arrives as NUMERIC (string|null) — coerce to number|null. */
  private shape(rows: Array<Record<string, unknown>>): unknown[] {
    return rows.map((r) => ({
      ...r,
      exam_score: r.exam_score == null ? null : Number(r.exam_score),
    }));
  }

  /**
   * Usher a member into the next level. In one tx: mark the advancement 'ushered'
   * (reviewer, note, timestamp), advance enrollments.current_level to N+1 (guarded
   * on current_level = N so it is idempotent — an already-ushered/advanced member
   * is a no-op), and notify the member. 403 FORBIDDEN_SCOPE if the member is
   * outside the discipler's cells (§5.4).
   */
  async usher(
    principal: Principal,
    advancementId: string,
    note?: string,
  ): Promise<{ id: string; status: string; advanced: boolean; new_level: number | null }> {
    return tx(this.pool, async (c) => {
      const adv = await maybeOne<{
        id: string;
        user_id: string;
        level_number: number;
        status: string;
        cell_group_id: string | null;
      }>(
        c,
        `SELECT la.id, la.user_id, la.level_number, la.status, u.cell_group_id
           FROM level_advancements la JOIN users u ON u.user_id = la.user_id
          WHERE la.id = $1 FOR UPDATE OF la`,
        [advancementId],
      );
      if (!adv) throw new ApiError("NOT_FOUND", "Advancement not found");
      await assertCellInScope(c, principal, adv.cell_group_id ?? "");

      // Idempotent: an already-ushered row does not re-advance or re-notify.
      if (adv.status === "ushered") {
        return { id: adv.id, status: "ushered", advanced: false, new_level: null };
      }

      await c.query(
        `UPDATE level_advancements
            SET status = 'ushered', reviewed_by = $2, note = $3, reviewed_at = now()
          WHERE id = $1`,
        [advancementId, principal.userId, note ?? null],
      );

      // Advance current_level to N+1, guarded so a race can't skip a level. When
      // the member already sits above N (advanced by another path) this is a
      // no-op and advanced stays false — the usher is still recorded.
      const newLevel = adv.level_number + 1;
      const upd = await c.query(
        `UPDATE enrollments SET current_level = $1
          WHERE user_id = $2 AND current_level = $3 AND current_level < $4`,
        [newLevel, adv.user_id, adv.level_number, MAX_LEVEL + 1],
      );
      const advanced = (upd.rowCount ?? 0) > 0;
      if (advanced) {
        await recordChange(c, "enrollments", null, adv.user_id, "upsert");
        try {
          await this.notifications.schedule({
            userId: adv.user_id,
            channel: "push",
            template: "level_ushered",
            payload: {
              level_number: newLevel,
              message: `Your discipler has ushered you into Level ${newLevel}`,
            },
          });
        } catch {
          // best-effort — the advancement is authoritative regardless
        }
      }

      await audit(c, principal.userId, "level.ushered", "level_advancements", advancementId, {
        user_id: adv.user_id,
        level_number: adv.level_number,
        advanced,
      });
      return { id: adv.id, status: "ushered", advanced, new_level: advanced ? newLevel : null };
    });
  }
}
