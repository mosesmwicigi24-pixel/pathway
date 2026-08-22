// Announcements (Contract Matrix B5; EVENTS_ARCHITECTURE §5 — first-class
// lifecycle). Admin composes once; fan-out is per-recipient-per-channel.
// Channel honesty: push rides the notifications infra (quiet hours + caps);
// email rides the real SMTP EmailProvider (same infra as password reset;
// delivered = SMTP accepted); SMS/WhatsApp have NO provider today, so their
// deliveries record suppressed(no_provider) — never a fabricated "delivered";
// 'banner' is in-app, served via GET /me/announcements. Deliveries are UNIQUE
// per (announcement, user, channel), so a re-send after a crash is a no-op.
// Announcements are congregation-scoped (NULL = legacy global) and may attach
// to a series or one occurrence (three modes: standalone / series / event).
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { many, maybeOne, one, tx, audit } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import { NotificationService } from "../notifications/service.js";
import type { EmailProvider } from "../identity/email.js";
import type { MessageProvider } from "./providers.js";

const CHANNELS = ["push", "email", "sms", "whatsapp", "banner"] as const;

/** A short plain-text preview of a Markdown body, for notification detail. */
function notifExcerpt(md: string, max = 160): string {
  const text = (md ?? "")
    .replace(/!\[(.*?)\]\(.*?\)/g, "") // images
    .replace(/\[(.*?)\]\(.*?\)/g, "$1") // links → text
    .replace(/[#>*_`~]+/g, " ") // md marks
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
type Channel = (typeof CHANNELS)[number];

export interface AnnouncementRow {
  announcement_id: string;
  congregation_id: string | null;
  title: string;
  body: string;
  channels: Channel[];
  audience_kind: "all" | "cells" | "level";
  audience_cells: string[] | null;
  audience_level: number | null;
  status: "draft" | "scheduled" | "sent" | "cancelled";
  scheduled_at: string | null;
  sent_at: string | null;
  banner_expires_at: string | null;
  primary_image_url: string | null;
  gallery_image_urls: string[] | null;
  is_featured: boolean;
  series_id: string | null;
  event_occurrence_id: string | null;
  archived_at: string | null;
  created_by: string;
  created_at: string;
}

const SELECT_COLS = `announcement_id, congregation_id, title, body, channels, audience_kind, audience_cells,
  audience_level, status, scheduled_at, sent_at, banner_expires_at,
  primary_image_url, gallery_image_urls, video_url, is_featured,
  series_id, event_occurrence_id, archived_at, created_by, created_at`;

export class AnnouncementService {
  private readonly notifications: NotificationService;
  private readonly providers: Partial<Record<"sms" | "whatsapp", MessageProvider>>;
  private readonly email: EmailProvider | undefined;

  constructor(
    private readonly pool: Pool,
    deps?: {
      notifications?: NotificationService;
      // §5 channel honesty: NO fake default providers. A channel without a bound
      // provider records suppressed(no_provider) instead of pretending to send.
      sms?: MessageProvider;
      whatsapp?: MessageProvider;
      email?: EmailProvider;
    },
  ) {
    this.notifications = deps?.notifications ?? new NotificationService(pool);
    this.providers = {
      ...(deps?.sms ? { sms: deps.sms } : {}),
      ...(deps?.whatsapp ? { whatsapp: deps.whatsapp } : {}),
    };
    this.email = deps?.email;
  }

  static readonly Compose = z
    .object({
      title: z.string().min(3).max(200),
      body: z.string().min(1).max(20_000), // Markdown
      channels: z.array(z.enum(CHANNELS)).min(1),
      audience: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("all") }),
        z.object({ kind: z.literal("cells"), cell_group_ids: z.array(z.string().uuid()).min(1) }),
        z.object({ kind: z.literal("level"), level_number: z.number().int().min(1) }),
      ]),
      scheduled_at: z.string().datetime().optional(), // omit = stays a draft until /send
      banner_expires_at: z.string().datetime().optional(),
      // Optional cover image + a small gallery (up to 5 extra → 6 total) shown as a
      // carousel on the mobile announcement detail.
      primary_image_url: z.string().url().max(2048).nullable().optional(),
      gallery_image_urls: z.array(z.string().url().max(2048)).max(5).optional(),
      // §5 attachment — the three modes: standalone (neither), series-attached,
      // or event-attached (a materialized/synthetic occurrence id). At most one.
      series_id: z.string().uuid().nullable().optional(),
      event_occurrence_id: z.string().min(1).max(100).nullable().optional(),
    })
    .strict()
    .superRefine((v, ctx) => {
      if (v.series_id && v.event_occurrence_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "An announcement attaches to a series OR one occurrence, not both",
          path: ["event_occurrence_id"],
        });
      }
    });

  static readonly List = z.object({
    status: z.enum(["draft", "scheduled", "sent", "cancelled"]).optional(),
    archived: z.preprocess((v) => v === true || v === "true", z.boolean()).default(false),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  });

  /** The creator's congregation — announcements are tenant-scoped to it (§5). */
  private async congregationOf(userId: string): Promise<string | null> {
    const u = await maybeOne<{ congregation_id: string }>(
      this.pool,
      `SELECT congregation_id FROM users WHERE user_id = $1`,
      [userId],
    );
    return u?.congregation_id ?? null;
  }

  /** Validate a series/event attachment exists and belongs to the congregation. */
  private async assertAttachment(
    congregationId: string | null,
    seriesId: string | null | undefined,
    eventOccurrenceId: string | null | undefined,
  ): Promise<void> {
    if (seriesId) {
      const s = await maybeOne<{ congregation_id: string }>(
        this.pool,
        `SELECT congregation_id FROM event_series WHERE series_id = $1 AND deleted_at IS NULL`,
        [seriesId],
      );
      if (!s) throw new ApiError("NOT_FOUND", "Linked series not found");
      if (congregationId && s.congregation_id !== congregationId) {
        throw new ApiError("FORBIDDEN_SCOPE", "Linked series outside your congregation");
      }
    }
    if (eventOccurrenceId) {
      // A synthetic occurrence id carries its series id; a materialized one is a
      // real events row. Validate whichever we can resolve.
      const idx = eventOccurrenceId.indexOf(":");
      const cong =
        idx > 0
          ? (
              await maybeOne<{ congregation_id: string }>(
                this.pool,
                `SELECT congregation_id FROM event_series WHERE series_id = $1 AND deleted_at IS NULL`,
                [eventOccurrenceId.slice(0, idx)],
              )
            )?.congregation_id
          : (
              await maybeOne<{ congregation_id: string }>(
                this.pool,
                `SELECT congregation_id FROM events WHERE event_id = $1`,
                [eventOccurrenceId],
              )
            )?.congregation_id;
      if (!cong) throw new ApiError("NOT_FOUND", "Linked event not found");
      if (congregationId && cong !== congregationId) {
        throw new ApiError("FORBIDDEN_SCOPE", "Linked event outside your congregation");
      }
    }
  }

  async create(
    adminId: string,
    input: z.infer<typeof AnnouncementService.Compose>,
  ): Promise<AnnouncementRow> {
    const a = input.audience;
    const status = input.scheduled_at ? "scheduled" : "draft";
    const congregationId = await this.congregationOf(adminId);
    await this.assertAttachment(congregationId, input.series_id, input.event_occurrence_id);
    const row = await one<AnnouncementRow>(
      this.pool,
      `INSERT INTO announcements
         (congregation_id, title, body, channels, audience_kind, audience_cells, audience_level,
          status, scheduled_at, banner_expires_at, created_by, primary_image_url, gallery_image_urls,
          series_id, event_occurrence_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING ${SELECT_COLS}`,
      [
        congregationId,
        input.title,
        input.body,
        input.channels,
        a.kind,
        a.kind === "cells" ? a.cell_group_ids : null,
        a.kind === "level" ? a.level_number : null,
        status,
        input.scheduled_at ?? null,
        input.banner_expires_at ?? null,
        adminId,
        input.primary_image_url ?? null,
        input.gallery_image_urls ?? [],
        input.series_id ?? null,
        input.event_occurrence_id ?? null,
      ],
    );
    await audit(this.pool, adminId, "announcement.created", "announcements", row.announcement_id, {
      status,
      channels: input.channels,
      audience: a.kind,
      series_id: input.series_id ?? null,
      event_occurrence_id: input.event_occurrence_id ?? null,
    });
    return row;
  }

  async update(
    adminId: string,
    id: string,
    input: z.infer<typeof AnnouncementService.Compose>,
  ): Promise<AnnouncementRow> {
    const a = input.audience;
    const congregationId = await this.congregationOf(adminId);
    await this.assertAttachment(congregationId, input.series_id, input.event_occurrence_id);
    const row = await maybeOne<AnnouncementRow>(
      this.pool,
      `UPDATE announcements
          SET title=$2, body=$3, channels=$4, audience_kind=$5, audience_cells=$6,
              audience_level=$7, scheduled_at=$8, banner_expires_at=$9,
              primary_image_url=$10, gallery_image_urls=$11,
              series_id=$12, event_occurrence_id=$13,
              status = CASE WHEN $8::timestamptz IS NULL THEN 'draft' ELSE 'scheduled' END,
              updated_at = now()
        WHERE announcement_id = $1 AND status IN ('draft','scheduled') AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      [
        id,
        input.title,
        input.body,
        input.channels,
        a.kind,
        a.kind === "cells" ? a.cell_group_ids : null,
        a.kind === "level" ? a.level_number : null,
        input.scheduled_at ?? null,
        input.banner_expires_at ?? null,
        input.primary_image_url ?? null,
        input.gallery_image_urls ?? [],
        input.series_id ?? null,
        input.event_occurrence_id ?? null,
      ],
    );
    if (!row) throw new ApiError("CONFLICT", "Only draft or scheduled announcements can be edited");
    await audit(this.pool, adminId, "announcement.updated", "announcements", id, {});
    return row;
  }

  async cancel(adminId: string, id: string): Promise<AnnouncementRow> {
    const row = await maybeOne<AnnouncementRow>(
      this.pool,
      `UPDATE announcements SET status='cancelled', updated_at=now()
        WHERE announcement_id = $1 AND status IN ('draft','scheduled')
        RETURNING ${SELECT_COLS}`,
      [id],
    );
    if (!row) throw new ApiError("CONFLICT", "Only draft or scheduled announcements can be cancelled");
    await audit(this.pool, adminId, "announcement.cancelled", "announcements", id, {});
    return row;
  }

  /** Soft-delete an announcement (any status). Removes it from admin lists, the
   *  member feed, and the homepage feature. */
  async remove(adminId: string, id: string): Promise<{ deleted: boolean }> {
    const row = await maybeOne<{ announcement_id: string }>(
      this.pool,
      `UPDATE announcements SET deleted_at = now(), is_featured = false, updated_at = now()
        WHERE announcement_id = $1 AND deleted_at IS NULL
        RETURNING announcement_id`,
      [id],
    );
    if (!row) throw new ApiError("NOT_FOUND", "Announcement not found");
    await audit(this.pool, adminId, "announcement.deleted", "announcements", id, {});
    return { deleted: true };
  }

  /** §5: duplicate → a fresh draft clone (also "resend" = duplicate + send, and
   *  "save as / use template" — a duplicate-source picker, no template entity). */
  async duplicate(adminId: string, id: string): Promise<AnnouncementRow> {
    const row = await maybeOne<AnnouncementRow>(
      this.pool,
      `INSERT INTO announcements
         (congregation_id, title, body, channels, audience_kind, audience_cells, audience_level,
          status, scheduled_at, banner_expires_at, created_by, primary_image_url, gallery_image_urls,
          video_url, series_id, event_occurrence_id)
       SELECT congregation_id, title, body, channels, audience_kind, audience_cells, audience_level,
              'draft', NULL, banner_expires_at, $2, primary_image_url, gallery_image_urls,
              video_url, series_id, event_occurrence_id
         FROM announcements WHERE announcement_id = $1 AND deleted_at IS NULL
       RETURNING ${SELECT_COLS}`,
      [id, adminId],
    );
    if (!row) throw new ApiError("NOT_FOUND", "Announcement not found");
    await audit(this.pool, adminId, "announcement.duplicated", "announcements", row.announcement_id, { source: id });
    return row;
  }

  /** §5: archive/restore — housekeeping distinct from delete. Archived
   *  announcements leave the default admin list and the member feed but keep
   *  their history. A *scheduled* announcement must be cancelled first (archive
   *  must never become a hidden pause that would still dispatch). */
  async setArchived(adminId: string, id: string, archived: boolean): Promise<AnnouncementRow> {
    if (archived) {
      const scheduled = await maybeOne(
        this.pool,
        `SELECT 1 FROM announcements WHERE announcement_id = $1 AND status = 'scheduled' AND deleted_at IS NULL`,
        [id],
      );
      if (scheduled) throw new ApiError("CONFLICT", "Cancel the scheduled announcement before archiving it");
    }
    const row = await maybeOne<AnnouncementRow>(
      this.pool,
      `UPDATE announcements
          SET archived_at = CASE WHEN $2 THEN now() ELSE NULL END,
              is_featured = CASE WHEN $2 THEN false ELSE is_featured END,
              updated_at = now()
        WHERE announcement_id = $1 AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      [id, archived],
    );
    if (!row) throw new ApiError("NOT_FOUND", "Announcement not found");
    await audit(this.pool, adminId, archived ? "announcement.archived" : "announcement.restored", "announcements", id, {});
    return row;
  }

  /** Feature one announcement on the mobile homepage. Exactly one may be
   *  featured PER CONGREGATION (§8 — featuring here never un-features another
   *  congregation's pick; partial unique index on congregation_id). */
  async setFeatured(adminId: string, id: string, featured: boolean): Promise<{ is_featured: boolean }> {
    return tx(this.pool, async (c) => {
      const a = await maybeOne<{ announcement_id: string; congregation_id: string | null }>(
        c,
        `SELECT announcement_id, congregation_id FROM announcements WHERE announcement_id = $1 AND deleted_at IS NULL`,
        [id],
      );
      if (!a) throw new ApiError("NOT_FOUND", "Announcement not found");
      if (featured) {
        // Clear this congregation's pick plus any legacy-global (NULL) pick that
        // would otherwise shadow every congregation's featured read.
        await c.query(
          `UPDATE announcements SET is_featured = false
            WHERE is_featured = true AND (congregation_id IS NOT DISTINCT FROM $1 OR congregation_id IS NULL)`,
          [a.congregation_id],
        );
      }
      await c.query(`UPDATE announcements SET is_featured = $2, updated_at = now() WHERE announcement_id = $1`, [id, featured]);
      await audit(c, adminId, "announcement.featured", "announcements", id, { featured });
      return { is_featured: featured };
    });
  }

  /** Attach (or clear, url=null) a video on an announcement. */
  async setVideo(adminId: string, id: string, url: string | null): Promise<unknown> {
    return tx(this.pool, async (c) => {
      const row = await maybeOne(
        c,
        `UPDATE announcements SET video_url = $2, updated_at = now()
          WHERE announcement_id = $1 AND deleted_at IS NULL RETURNING ${SELECT_COLS}`,
        [id, url],
      );
      if (!row) throw new ApiError("NOT_FOUND", "Announcement not found");
      await audit(c, adminId, url ? "announcement.video_set" : "announcement.video_cleared", "announcements", id, {});
      return row;
    });
  }

  /** The homepage-featured announcement for THIS congregation (§8; NULL-cong
   *  legacy rows count as global). Wire shape unchanged. */
  async featured(congregationId?: string | null): Promise<unknown | null> {
    // Callers always pass the member's own scope, so a null here means an
    // UNPLACED member — who sees only the global (congregation-less) rows.
    // The old `$1 IS NULL OR …` arm made null mean "everything", which is
    // the one thing "no congregation" must never mean.
    return (
      (await maybeOne(
        this.pool,
        `SELECT announcement_id, title, body, primary_image_url, gallery_image_urls, video_url, sent_at
           FROM announcements
          WHERE is_featured = true AND deleted_at IS NULL AND archived_at IS NULL AND status = 'sent'
            AND (congregation_id = $1 OR congregation_id IS NULL)
          ORDER BY congregation_id NULLS LAST
          LIMIT 1`,
        [congregationId ?? null],
      )) ?? null
    );
  }

  /** Member-facing detail for one announcement (carousel images + body). Scoped to
   *  members who actually received it (a banner delivery row exists). */
  async memberDetail(userId: string, id: string): Promise<unknown> {
    const row = await maybeOne(
      this.pool,
      `SELECT a.announcement_id, a.title, a.body, a.sent_at, a.banner_expires_at,
              a.primary_image_url, a.gallery_image_urls, a.video_url,
              d.opened_at IS NOT NULL AS opened
         FROM announcement_deliveries d
         JOIN announcements a USING (announcement_id)
        WHERE d.user_id = $1 AND d.channel = 'banner' AND a.status = 'sent' AND a.deleted_at IS NULL
          AND a.archived_at IS NULL
          AND a.announcement_id = $2`,
      [userId, id],
    );
    if (!row) throw new ApiError("NOT_FOUND", "Announcement not found");
    const r = row as { primary_image_url: string | null; gallery_image_urls: string[] | null };
    const images = [r.primary_image_url, ...(r.gallery_image_urls ?? [])].filter((u): u is string => !!u);
    return { ...row, images };
  }

  async list(q: z.infer<typeof AnnouncementService.List>, congregationId?: string): Promise<{ data: unknown[] }> {
    const rows = await many(
      this.pool,
      `SELECT ${SELECT_COLS},
              (SELECT count(*)::int FROM announcement_deliveries d
                WHERE d.announcement_id = a.announcement_id AND d.status IN ('scheduled','delivered')) AS delivered_count,
              (SELECT count(*)::int FROM announcement_deliveries d
                WHERE d.announcement_id = a.announcement_id AND d.opened_at IS NOT NULL) AS opened_count
         FROM announcements a
        WHERE ($1::text IS NULL OR status = $1) AND a.deleted_at IS NULL
          AND (($2 AND a.archived_at IS NOT NULL) OR (NOT $2 AND a.archived_at IS NULL))
          AND ($4::uuid IS NULL OR a.congregation_id = $4 OR a.congregation_id IS NULL)
        ORDER BY created_at DESC
        LIMIT $3`,
      [q.status ?? null, q.archived, q.limit, congregationId ?? null],
    );
    return { data: rows };
  }

  /** Detail + per-channel stats — real numbers only (§5): targeted / delivered /
   *  queued (push handed to the notifications worker) / suppressed(+reasons) /
   *  failed / opened (banner taps only, see markOpened). */
  async get(id: string, congregationId?: string): Promise<unknown> {
    const row = await maybeOne<AnnouncementRow>(
      this.pool,
      `SELECT ${SELECT_COLS} FROM announcements a
        WHERE announcement_id = $1 AND deleted_at IS NULL
          AND ($2::uuid IS NULL OR a.congregation_id = $2 OR a.congregation_id IS NULL)`,
      [id, congregationId ?? null],
    );
    if (!row) throw new ApiError("NOT_FOUND", "Announcement not found");
    const stats = await many(
      this.pool,
      `SELECT channel,
              count(*)::int                                              AS targeted,
              count(*) FILTER (WHERE status IN ('scheduled','delivered'))::int AS delivered,
              count(*) FILTER (WHERE status = 'scheduled')::int          AS queued,
              count(*) FILTER (WHERE status = 'suppressed')::int         AS suppressed,
              count(*) FILTER (WHERE status = 'failed')::int             AS failed,
              count(*) FILTER (WHERE opened_at IS NOT NULL)::int         AS opened
         FROM announcement_deliveries
        WHERE announcement_id = $1
        GROUP BY channel ORDER BY channel`,
      [id],
    );
    const reasons = await many<{ channel: string; suppress_reason: string | null; n: number }>(
      this.pool,
      `SELECT channel, suppress_reason, count(*)::int AS n
         FROM announcement_deliveries
        WHERE announcement_id = $1 AND status = 'suppressed'
        GROUP BY channel, suppress_reason`,
      [id],
    );
    const reasonsByChannel = new Map<string, Record<string, number>>();
    for (const r of reasons) {
      const m = reasonsByChannel.get(r.channel) ?? {};
      m[r.suppress_reason ?? "unknown"] = r.n;
      reasonsByChannel.set(r.channel, m);
    }
    return {
      ...row,
      stats: (stats as Array<{ channel: string }>).map((s) => ({
        ...s,
        suppressed_reasons: reasonsByChannel.get(s.channel) ?? {},
      })),
    };
  }

  /**
   * Send now (or dispatch a due scheduled one). Expands the audience to active
   * members and fans out per channel; the UNIQUE delivery row makes the whole
   * fan-out idempotent — a retried send skips recipients already covered.
   */
  async send(adminId: string, id: string): Promise<{ announcement_id: string; recipients: number; deliveries: number }> {
    const ann = await maybeOne<AnnouncementRow>(
      this.pool,
      `SELECT ${SELECT_COLS} FROM announcements WHERE announcement_id = $1`,
      [id],
    );
    if (!ann) throw new ApiError("NOT_FOUND", "Announcement not found");
    if (ann.status === "cancelled" || ann.status === "sent") {
      throw new ApiError("CONFLICT", `Announcement is already ${ann.status}`);
    }

    const recipients = await this.audienceRecipients(this.pool, ann);
    if (recipients.length === 0) throw new ApiError("UNPROCESSABLE", "Audience matches no active members");

    let deliveries = 0;
    for (const r of recipients) {
      for (const channel of ann.channels) {
        const created = await this.deliverOne(ann, r, channel);
        if (created) deliveries += 1;
      }
    }

    await this.pool.query(
      `UPDATE announcements SET status='sent', sent_at=now(), updated_at=now() WHERE announcement_id=$1`,
      [id],
    );
    await audit(this.pool, adminId, "announcement.sent", "announcements", id, {
      recipients: recipients.length,
      deliveries,
      channels: ann.channels,
    });
    return { announcement_id: id, recipients: recipients.length, deliveries };
  }

  /** Scheduler hook: dispatch every scheduled announcement whose time has come. */
  async dispatchDue(now: Date = new Date()): Promise<number> {
    const due = await many<{ announcement_id: string; created_by: string }>(
      this.pool,
      `SELECT announcement_id, created_by FROM announcements
        WHERE status = 'scheduled' AND scheduled_at <= $1 AND deleted_at IS NULL AND archived_at IS NULL
        ORDER BY scheduled_at`,
      [now.toISOString()],
    );
    for (const d of due) await this.send(d.created_by, d.announcement_id);
    return due.length;
  }

  /** Member-facing: my in-app announcements (banner channel), newest first. */
  async myAnnouncements(userId: string): Promise<{ data: unknown[] }> {
    const rows = await many(
      this.pool,
      `SELECT a.announcement_id, a.title, a.body, a.sent_at, a.banner_expires_at,
              a.primary_image_url, a.gallery_image_urls, a.video_url,
              d.opened_at IS NOT NULL AS opened
         FROM announcement_deliveries d
         JOIN announcements a USING (announcement_id)
        WHERE d.user_id = $1 AND d.channel = 'banner' AND a.status = 'sent' AND a.deleted_at IS NULL
          AND a.archived_at IS NULL
          AND (a.banner_expires_at IS NULL OR a.banner_expires_at > now())
        ORDER BY a.sent_at DESC
        LIMIT 50`,
      [userId],
    );
    return { data: rows };
  }

  /** Open receipt (idempotent). §5: stamps BANNER rows only — one in-app tap
   *  must never contaminate every other channel's opened stat. */
  async markOpened(userId: string, announcementId: string): Promise<{ opened: boolean }> {
    const res = await this.pool.query(
      `UPDATE announcement_deliveries SET opened_at = now()
        WHERE announcement_id = $1 AND user_id = $2 AND channel = 'banner' AND opened_at IS NULL`,
      [announcementId, userId],
    );
    const known = await one<{ n: number }>(
      this.pool,
      `SELECT count(*)::int AS n FROM announcement_deliveries WHERE announcement_id=$1 AND user_id=$2`,
      [announcementId, userId],
    );
    if (known.n === 0) throw new ApiError("NOT_FOUND", "Announcement not found for this member");
    return { opened: (res.rowCount ?? 0) > 0 };
  }

  // ---- internals ----

  /**
   * How many people would this actually reach, per channel, if sent now?
   *
   * The audience size is NOT the answer. A member with no phone number costs
   * nothing and receives nothing, so counting them in the SMS figure would
   * over-state the bill and under-state the surprise when some people are
   * missed. This counts who can genuinely be reached on each channel.
   *
   * Exists because SMS is the first channel here that costs the church real
   * money per message: an announcement sent to "everyone" is a decision worth
   * seeing a number for before you make it, not after.
   */
  async reach(id: string): Promise<{ total: number; sms: number; email: number; sms_unreachable: number }> {
    const ann = await maybeOne<AnnouncementRow>(
      this.pool,
      `SELECT ${SELECT_COLS} FROM announcements WHERE announcement_id = $1`,
      [id],
    );
    if (!ann) throw new ApiError("NOT_FOUND", "Announcement not found");
    const recipients = await this.audienceRecipients(this.pool, ann);
    const sms = recipients.filter((r) => Boolean(r.phone_number)).length;
    return {
      total: recipients.length,
      sms,
      email: recipients.filter((r) => Boolean(r.email)).length,
      // Named rather than left to subtraction: "12 of these people have no
      // number on file" is the sentence an admin needs before pressing send.
      sms_unreachable: recipients.length - sms,
    };
  }

  private async audienceRecipients(
    c: Pool | PoolClient,
    ann: AnnouncementRow,
  ): Promise<Array<{ user_id: string; phone_number: string; email: string | null; timezone: string }>> {
    // §5 multi-tenant fix: every audience query is scoped to the announcement's
    // congregation (NULL = legacy global → unscoped, preserving old rows).
    if (ann.audience_kind === "cells") {
      return many(
        c,
        `SELECT user_id, phone_number, email, timezone FROM users
          WHERE deleted_at IS NULL AND cell_group_id = ANY($1::uuid[])
            AND ($2::uuid IS NULL OR congregation_id = $2)`,
        [ann.audience_cells, ann.congregation_id],
      );
    }
    if (ann.audience_kind === "level") {
      return many(
        c,
        `SELECT u.user_id, u.phone_number, u.email, u.timezone FROM users u
          JOIN enrollments e ON e.user_id = u.user_id
         WHERE u.deleted_at IS NULL AND e.current_level = $1
           AND ($2::uuid IS NULL OR u.congregation_id = $2)`,
        [ann.audience_level, ann.congregation_id],
      );
    }
    return many(
      c,
      `SELECT user_id, phone_number, email, timezone FROM users
        WHERE deleted_at IS NULL AND ($1::uuid IS NULL OR congregation_id = $1)`,
      [ann.congregation_id],
    );
  }

  /** Returns true when a new delivery row was created (false = already done). */
  private async deliverOne(
    ann: AnnouncementRow,
    r: { user_id: string; phone_number: string; email: string | null; timezone: string },
    channel: Channel,
  ): Promise<boolean> {
    return tx(this.pool, async (c) => {
      // Idempotency anchor first: if a row exists, this (recipient, channel)
      // was already handled by a previous (possibly crashed) send.
      const ins = await c.query(
        `INSERT INTO announcement_deliveries (announcement_id, user_id, channel, status)
         VALUES ($1, $2, $3, 'scheduled')
         ON CONFLICT (announcement_id, user_id, channel) DO NOTHING
         RETURNING delivery_id`,
        [ann.announcement_id, r.user_id, channel],
      );
      const deliveryId = (ins.rows[0] as { delivery_id: string } | undefined)?.delivery_id;
      if (!deliveryId) return false;

      const suppress = async (reason: string): Promise<void> => {
        await c.query(
          `UPDATE announcement_deliveries SET status = 'suppressed', suppress_reason = $2 WHERE delivery_id = $1`,
          [deliveryId, reason],
        );
      };

      if (channel === "push") {
        // Quiet hours + daily cap apply exactly as for any nudge (§1.5).
        const n = await this.notifications.schedule({
          userId: r.user_id,
          channel: "push",
          template: "announcement",
          payload: { announcement_id: ann.announcement_id, title: ann.title, body: notifExcerpt(ann.body) },
          timezone: r.timezone,
        });
        await c.query(
          `UPDATE announcement_deliveries
              SET notification_id = $2, status = $3, suppress_reason = $4
            WHERE delivery_id = $1`,
          [
            deliveryId,
            n.notification_id,
            n.status === "suppressed" ? "suppressed" : "scheduled",
            n.status === "suppressed" ? "opted_out" : null,
          ],
        );
      } else if (channel === "email") {
        // §5: email is REAL — the same SMTP EmailProvider as password reset.
        // Delivered = the provider accepted the message. Without a bound
        // provider (or an address, or with email opted out) the delivery is
        // honestly suppressed, never faked.
        if (!this.email) {
          await suppress("no_provider");
        } else if (!r.email) {
          await suppress("no_email");
        } else {
          const prefs = await maybeOne<{ email_enabled: boolean }>(
            c,
            `SELECT email_enabled FROM notification_preferences WHERE user_id = $1`,
            [r.user_id],
          );
          if (prefs && !prefs.email_enabled) {
            await suppress("opted_out");
          } else {
            try {
              await this.email.send({ to: r.email, subject: ann.title, text: ann.body });
              await c.query(
                `UPDATE announcement_deliveries SET status = 'delivered', delivered_at = now() WHERE delivery_id = $1`,
                [deliveryId],
              );
            } catch {
              await c.query(`UPDATE announcement_deliveries SET status = 'failed' WHERE delivery_id = $1`, [deliveryId]);
            }
          }
        }
      } else if (channel === "sms" || channel === "whatsapp") {
        const provider = this.providers[channel];
        if (!provider) {
          // §5 channel honesty: no provider exists for this channel today. Record
          // the suppression truthfully instead of marking a fake send delivered.
          // (The composer greys these channels "awaiting provider".)
          await suppress("no_provider");
        } else {
          try {
            const sent = await provider.send({
              to: r.phone_number,
              title: ann.title,
              body: ann.body,
            });
            await c.query(
              `UPDATE announcement_deliveries
                  SET provider_ref = $2, status = 'delivered', delivered_at = now()
                WHERE delivery_id = $1`,
              [deliveryId, sent.ref],
            );
          } catch {
            await c.query(`UPDATE announcement_deliveries SET status = 'failed' WHERE delivery_id = $1`, [deliveryId]);
          }
        }
      } else {
        // banner: delivered the moment the row exists — members fetch it in-app.
        await c.query(
          `UPDATE announcement_deliveries SET status = 'delivered', delivered_at = now() WHERE delivery_id = $1`,
          [deliveryId],
        );
      }
      return true;
    });
  }
}
