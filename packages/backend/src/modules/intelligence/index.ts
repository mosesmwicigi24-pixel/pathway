// Module: intelligence — Phase 1 of the AI layer ("one brain, many hands").
// Member-facing: the Sunday Letter + the AI-personalization consent switch.
// Admin-facing (Admin+): manual triggers for reindex / story rebuild / letter
// run so a SuperAdmin can fire the pipeline without waiting for the crons.
// The AI provider stays server-side (§5.10); AI never gates, scores, advances,
// or touches money (§1.1, §1.9) — it only ever writes words.
import { mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { background } from "../../db/background.js";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { buildAiProvider, type AiProvider } from "../assistant/provider.js";
import { AiUsageService } from "../assistant/usage.js";
import { NotificationService } from "../notifications/service.js";
import { ContentIndexService } from "./content.js";
import { StoryService } from "./story.js";
import { LettersService } from "./letters.js";
import { SignalsService } from "./signals.js";
import { LearningService, EXPLAIN_STYLES, type ExplainStyle } from "./learning.js";
import { LiturgyService } from "./liturgy.js";
import { LiturgyRecordingService } from "./liturgyRecordings.js";
import { CommunityService, type BlessingKind } from "./community.js";
import { EchoesService } from "./echoes.js";
import { WalkService } from "./walk.js";
import { PrayerAiService } from "./prayer.js";
import { ApiError } from "../../http/errors.js";

export const intelligenceRouter: Router = Router();

export function registerIntelligence(ctx: AppContext, providerOverride?: AiProvider): Router {
  const usage = new AiUsageService(ctx.db.primary);
  const provider = providerOverride ?? buildAiProvider(ctx.env, usage.recorder());
  const content = new ContentIndexService(ctx.db.primary);
  const story = new StoryService(ctx.db.primary, provider);
  const notifications = new NotificationService(ctx.db.primary);
  const letters = new LettersService(ctx.db.primary, provider, story, content, notifications);
  const signals = new SignalsService(ctx.db.primary, provider, story, notifications);
  const learning = new LearningService(ctx.db.primary, provider);
  const liturgy = new LiturgyService(ctx.db.primary, provider);
  const liturgyRecordings = new LiturgyRecordingService(ctx.db.primary);
  const community = new CommunityService(ctx.db.primary, notifications);
  const echoes = new EchoesService(ctx.db.primary);
  const prayerAi = new PrayerAiService(ctx.db.primary, provider);
  const auth = authenticate(ctx.env);
  const r = intelligenceRouter;

  // --- Sunday Letters (member) ---
  r.get("/me/letters", auth, handler(async (req, res) => {
    res.json({ data: await letters.list(requirePrincipal(req).userId) });
  }));

  r.get("/me/letters/latest", auth, handler(async (req, res) => {
    res.json({ letter: await letters.latest(requirePrincipal(req).userId) });
  }));

  r.post("/me/letters/:id/read", auth, handler(async (req, res) => {
    res.json(await letters.markRead(requirePrincipal(req).userId, String(req.params.id ?? "")));
  }));

  // --- AI Prayer Points (Prayer Room tab 4) — consent-gated (§1.1) ---
  r.post("/me/prayer/assist", auth, handler(async (req, res) => {
    const input = parseBody(PrayerAiService.Assist, req.body ?? {});
    res.json(await prayerAi.assist(requirePrincipal(req).userId, input));
  }));

  r.post("/me/prayer/points", auth, handler(async (req, res) => {
    res.json(await prayerAi.points(requirePrincipal(req).userId));
  }));

  // --- AI personalization consent (the covenant switch) ---
  r.get("/me/ai", auth, handler(async (req, res) => {
    const row = await ctx.db.primary.query(`SELECT ai_opt_out FROM users WHERE user_id = $1`, [
      requirePrincipal(req).userId,
    ]);
    res.json({ opt_out: row.rows[0]?.ai_opt_out === true });
  }));

  r.post("/me/ai/consent", auth, handler(async (req, res) => {
    const input = parseBody(z.object({ opt_out: z.boolean() }), req.body ?? {});
    const userId = requirePrincipal(req).userId;
    await ctx.db.primary.query(`UPDATE users SET ai_opt_out = $2, updated_at = now() WHERE user_id = $1`, [
      userId,
      input.opt_out,
    ]);
    // Opting out withdraws the written-content grounding immediately: drop the
    // story (a future rebuild recreates facts-only, narrative empty).
    if (input.opt_out) await ctx.db.primary.query(`DELETE FROM member_story WHERE user_id = $1`, [userId]);
    res.json({ opt_out: input.opt_out });
  }));

  // --- Admin triggers (Admin+; the crons call the same services) ---
  r.post("/admin/intelligence/reindex", auth, requireRole("Admin"), handler(async (_req, res) => {
    res.json(await content.reindexAll());
  }));

  r.post("/admin/intelligence/stories/rebuild", auth, requireRole("Admin"), handler(async (req, res) => {
    const input = parseBody(z.object({ user_id: z.string().uuid().optional() }), req.body ?? {});
    if (input.user_id) {
      const row = await story.rebuildFor(input.user_id);
      res.json({ rebuilt: row ? 1 : 0 });
      return;
    }
    res.json(await story.rebuildAll());
  }));

  r.post("/admin/intelligence/letters/run", auth, requireRole("Admin"), handler(async (req, res) => {
    const input = parseBody(z.object({ user_id: z.string().uuid().optional() }), req.body ?? {});
    res.json(await letters.runWeekly(input.user_id ? { userIds: [input.user_id] } : {}));
  }));

  // --- AI cost/usage observability (Admin+): what is the AI layer doing and
  // spending, aggregated by feature/tier/model — see assistant/usage.ts. ---
  r.get("/admin/intelligence/ai-usage", auth, requireRole("Admin"), handler(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.since_days ?? 30) || 30, 1), 365);
    res.json(await usage.summary(days));
  }));

  // --- Shepherd's Pulse (Phase 2): leader-scoped signals + the Flock Brief ---
  r.get("/admin/intelligence/signals", auth, requireRole("Instructor"), handler(async (req, res) => {
    const since = Math.min(Math.max(Number(req.query.since_days ?? 14) || 14, 1), 60);
    res.json({ data: await signals.listFor(requirePrincipal(req), since) });
  }));

  r.post("/admin/intelligence/signals/:id/ack", auth, requireRole("Instructor"), handler(async (req, res) => {
    res.json(await signals.acknowledge(requirePrincipal(req), String(req.params.id ?? "")));
  }));

  // AI capability: draft a check-in for the person behind one signal — a
  // suggestion only, the leader edits and sends it themselves (§1.1: AI
  // never originates outreach, it only ever writes words for a human to use).
  r.post("/admin/intelligence/signals/:id/draft-outreach", auth, requireRole("Instructor"), handler(async (req, res) => {
    res.json(await signals.draftOutreach(requirePrincipal(req), String(req.params.id ?? "")));
  }));

  r.get("/admin/intelligence/flock-brief", auth, requireRole("Instructor"), handler(async (req, res) => {
    res.json({ brief: await signals.myBrief(requirePrincipal(req).userId) });
  }));

  r.post("/admin/intelligence/signals/scan", auth, requireRole("Admin"), handler(async (_req, res) => {
    res.json(await signals.runNightly());
  }));

  r.post("/admin/intelligence/flock-brief/run", auth, requireRole("Admin"), handler(async (_req, res) => {
    res.json(await signals.composeBriefs());
  }));

  // --- Living curriculum (Phase 3) ---
  r.get("/modules/:id/explain", auth, handler(async (req, res) => {
    const style = String(req.query.style ?? "simple") as ExplainStyle;
    if (!EXPLAIN_STYLES.includes(style)) throw new ApiError("VALIDATION_FAILED", "style must be simple | swahili | story");
    res.json(await learning.explain(requirePrincipal(req).userId, String(req.params.id ?? ""), style));
  }));

  r.post("/modules/:id/quiz/remediation", auth, handler(async (req, res) => {
    res.json(await learning.remediate(requirePrincipal(req).userId, String(req.params.id ?? "")));
  }));

  r.get("/growth/memory-verses/due", auth, handler(async (req, res) => {
    res.json({ data: await learning.dueVerses(requirePrincipal(req).userId) });
  }));

  // --- The liturgy Home + community intelligence (Phase 4) ---
  r.get("/home/echo", auth, handler(async (req, res) => {
    res.json({ echo: await echoes.today(requirePrincipal(req).userId) });
  }));

  r.get("/home/liturgy", auth, handler(async (req, res) => {
    const me = await ctx.db.primary.query(`SELECT congregation_id FROM users WHERE user_id = $1`, [
      requirePrincipal(req).userId,
    ]);
    res.json(await liturgy.current(me.rows[0]?.congregation_id ?? null));
  }));

  // --- The pastor's own voice on the liturgy (owner request, 2026-08-12) ---
  // Admin-only (never a member capability — a member must never be able to
  // write here). Bytes land on the same /media disk everything else in this
  // app uses (§ media module precedent: /me/media/audio, /admin/media/audio/
  // upload). One recording per (congregation, band); re-recording REPLACES
  // it (upsert) — see LiturgyRecordingService / migration 189 for why this is
  // keyed by band alone, not by day.
  const storageDir = ctx.env.MEDIA_STORAGE_DIR ?? "/tmp/nuru-media";
  try { mkdirSync(storageDir, { recursive: true }); } catch { /* best-effort; route fails loudly if unwritable */ }
  const publicBase = (ctx.env.MEDIA_PUBLIC_BASE_URL ?? "http://localhost:8080/media").replace(/\/+$/, "");
  const LITURGY_AUDIO_MAX = 20 * 1024 * 1024; // generous for several minutes of AAC/MP3 — a spoken band, not a sermon
  const LITURGY_AUDIO_EXTS = new Set([".mp3", ".wav", ".m4a", ".aac", ".alac"]);
  const LITURGY_AUDIO_MIMES = new Set([
    "audio/mpeg", "audio/mp3",
    "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave",
    "audio/aac", "audio/aacp", "audio/x-aac",
    "audio/mp4", "audio/x-m4a", "audio/m4a",
    "audio/alac",
  ]);
  const liturgyAudioUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, storageDir),
      filename: (_req, file, cb) => {
        const ext = (extname(file.originalname) || ".m4a").toLowerCase().replace(/[^.a-z0-9]/g, "") || ".m4a";
        cb(null, `liturgy_${randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: LITURGY_AUDIO_MAX, files: 1 },
    fileFilter: (_req, file, cb) => {
      const ext = (extname(file.originalname) || "").toLowerCase();
      if (LITURGY_AUDIO_MIMES.has(file.mimetype ?? "") || LITURGY_AUDIO_EXTS.has(ext)) cb(null, true);
      else cb(new ApiError("VALIDATION_FAILED", "Only MP3, WAV, AAC or ALAC (.m4a) audio can be uploaded"));
    },
  });
  const uploadLiturgyAudio = (req: Request, res: Response, next: NextFunction): void =>
    liturgyAudioUpload.single("file")(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        return next(
          new ApiError(
            "VALIDATION_FAILED",
            err.code === "LIMIT_FILE_SIZE" ? "Recording exceeds the 20 MB upload limit" : err.message,
          ),
        );
      }
      return next(err);
    });
  // Map a stored recording URL back to its on-disk filename (for cleanup on replace/delete).
  const liturgyRecordingFile = (url: string | null): string | null =>
    url && url.startsWith(publicBase + "/") ? url.slice(publicBase.length + 1) : null;

  const LiturgyBandParam = z.object({
    band: z.enum(["sunrise", "morning", "midday", "afternoon", "evening", "night", "midnight"]),
  });
  const LiturgyRecordingBody = z.object({ duration_sec: z.coerce.number().int().min(1).max(900) });

  // Admin recorder UI: which of the seven bands already have the pastor's own
  // voice, and which are still synthesised. Never a completion meter — mixed
  // coverage is the permanent, normal state (see migration 189).
  r.get("/admin/liturgy/recordings", auth, requireRole("Admin"), handler(async (req, res) => {
    res.json({ data: await liturgyRecordings.list(requirePrincipal(req).congregationId) });
  }));

  // Record (or re-record) the pastor's own voice for one band. Replaces
  // whatever was there (upsert) — the old file is best-effort unlinked.
  r.post(
    "/admin/liturgy/recordings/:band",
    auth, requireRole("Admin"), uploadLiturgyAudio,
    handler(async (req, res) => {
      const file = req.file;
      if (!file) throw new ApiError("VALIDATION_FAILED", "No audio was uploaded (field 'file')");
      const { band } = parseBody(LiturgyBandParam, req.params);
      const { duration_sec } = parseBody(LiturgyRecordingBody, req.body ?? {});
      const p = requirePrincipal(req);
      const { previousAudioUrl } = await liturgyRecordings.upsert(p.congregationId, band, {
        audioUrl: `${publicBase}/${file.filename}`,
        durationSec: duration_sec,
        recordedBy: p.userId,
      });
      // Removing the superseded take must not delay the pastor's upload
      // response — but `unlink(..., () => undefined)` made it invisible as well
      // as non-blocking, and those are different things. A failed unlink was
      // discarded in total, so an old recording that could not be removed leaked
      // onto the VPS disk with nothing anywhere recording that it had happened.
      //
      // background() (added in #418 for exactly this shape) keeps it off the
      // response path while leaving it observable: drainBackgroundWork() can
      // wait for it, and a failure is now logged instead of vanishing. CI caught
      // the race — the test asserted the old file was gone while the unlink was
      // still in flight, which passed locally on a fast disk and failed on a
      // slower runner.
      const oldFile = liturgyRecordingFile(previousAudioUrl);
      if (oldFile) {
        background(
          unlink(join(storageDir, oldFile)).catch((e: unknown) => {
            ctx.log.warn(
              { err: e, file: oldFile, band },
              "could not remove the superseded liturgy recording; it is now orphaned on disk",
            );
          }),
        );
      }
      res.status(201).json({ band, audio_url: `${publicBase}/${file.filename}`, duration_sec });
    }),
  );

  // Delete a band's recording — that band falls back to synthesis
  // immediately; no other band is affected.
  r.delete("/admin/liturgy/recordings/:band", auth, requireRole("Admin"), handler(async (req, res) => {
    const { band } = parseBody(LiturgyBandParam, req.params);
    const { audio_url } = await liturgyRecordings.remove(requirePrincipal(req).congregationId, band);
    const oldFile = liturgyRecordingFile(audio_url);
    // Same treatment as the replace path above — one failure is a class, and
    // this is the sibling occurrence.
    if (oldFile) {
      background(
        unlink(join(storageDir, oldFile)).catch((e: unknown) => {
          ctx.log.warn(
            { err: e, file: oldFile, band },
            "could not remove the deleted liturgy recording; it is now orphaned on disk",
          );
        }),
      );
    }
    res.json({ deleted: true });
  }));

  r.get("/community/moments", auth, handler(async (req, res) => {
    res.json({ data: await community.list(requirePrincipal(req).userId) });
  }));

  r.post("/community/moments/:id/bless", auth, handler(async (req, res) => {
    const input = parseBody(z.object({ kind: z.enum(["amen", "heart", "fire"]) }), req.body ?? {});
    res.json(await community.bless(requirePrincipal(req).userId, String(req.params.id ?? ""), input.kind as BlessingKind));
  }));

  // --- Footprints + Your Walk (Wave 3): counted, not guessed ---
  const walk = new WalkService(ctx.db.replica);

  r.get("/modules/:id/footprints", auth, handler(async (req, res) => {
    res.json(await walk.footprints(requirePrincipal(req).userId, String(req.params.id ?? "")));
  }));

  r.get("/me/walk", auth, handler(async (req, res) => {
    res.json({ data: await walk.yourWalk(requirePrincipal(req).userId) });
  }));

  // --- Discipler voice notes on modules (Wave 2) ---
  // One per module per congregation; the leader re-records over their own.
  r.post("/modules/:id/voice-note", auth, requireRole("Instructor"), handler(async (req, res) => {
    const input = parseBody(
      z.object({
        audio_url: z.string().url().max(1024),
        duration_sec: z.number().int().min(1).max(300),
        waveform: z.array(z.number().int().min(0).max(100)).max(80).optional(),
      }),
      req.body ?? {},
    );
    const userId = requirePrincipal(req).userId;
    const me = await ctx.db.primary.query(`SELECT congregation_id FROM users WHERE user_id = $1`, [userId]);
    const cong = me.rows[0]?.congregation_id;
    if (!cong) throw new ApiError("VALIDATION_FAILED", "You need a congregation to leave a voice note");
    const row = await ctx.db.primary.query(
      `INSERT INTO module_voice_notes (module_id, congregation_id, author_user_id, audio_url, duration_sec, waveform)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (module_id, congregation_id)
       DO UPDATE SET author_user_id = $3, audio_url = $4, duration_sec = $5, waveform = $6, created_at = now()
       RETURNING note_id`,
      [String(req.params.id ?? ""), cong, userId, input.audio_url, input.duration_sec,
       input.waveform ? JSON.stringify(input.waveform) : null],
    );
    res.status(201).json({ note_id: row.rows[0].note_id });
  }));

  r.delete("/modules/:id/voice-note", auth, requireRole("Instructor"), handler(async (req, res) => {
    const userId = requirePrincipal(req).userId;
    const me = await ctx.db.primary.query(`SELECT congregation_id, role FROM users WHERE user_id = $1`, [userId]);
    await ctx.db.primary.query(
      `DELETE FROM module_voice_notes
        WHERE module_id = $1 AND congregation_id = $2
          AND (author_user_id = $3 OR $4 IN ('Admin', 'SuperAdmin'))`,
      [String(req.params.id ?? ""), me.rows[0]?.congregation_id, userId, me.rows[0]?.role],
    );
    res.json({ ok: true });
  }));

  // --- Cell reading presence (Wave 2): studying together, apart ---
  r.get("/community/presence", auth, handler(async (req, res) => {
    const userId = requirePrincipal(req).userId;
    const rows = await ctx.db.primary.query(
      `WITH me AS (SELECT cell_group_id, congregation_id FROM users WHERE user_id = $1)
       SELECT split_part(u.full_name, ' ', 1) AS first_name
         FROM users u, me
        WHERE u.user_id <> $1 AND u.deleted_at IS NULL
          AND ((me.cell_group_id IS NOT NULL AND u.cell_group_id = me.cell_group_id)
               OR (me.cell_group_id IS NULL AND u.congregation_id = me.congregation_id))
          AND EXISTS (
            SELECT 1 FROM module_engagement e
             WHERE e.user_id = u.user_id AND e.updated_at > now() - interval '7 days'
          )
        ORDER BY random()
        LIMIT 12`,
      [userId],
    );
    const me = await ctx.db.primary.query(`SELECT cell_group_id FROM users WHERE user_id = $1`, [userId]);
    res.json({
      count: rows.rowCount ?? 0,
      names: rows.rows.slice(0, 3).map((r: { first_name: string }) => r.first_name),
      scope: me.rows[0]?.cell_group_id ? "cell" : "congregation",
    });
  }));

  r.post("/admin/intelligence/liturgy/run", auth, requireRole("Admin"), handler(async (_req, res) => {
    res.json({ composed: await liturgy.composeAll() });
  }));

  r.post("/admin/intelligence/moments/scan", auth, requireRole("Admin"), handler(async (_req, res) => {
    res.json({ inserted: await community.scanMoments() });
  }));

  return r;
}
