// The Sunday Letter — once a week, the strongest model writes each active,
// consenting member a short pastoral letter woven from their ACTUAL week
// (member_story facts + narrative, plus a relevant excerpt of the church's own
// teaching). Cached in pastoral_letters (UNIQUE user_id+week_of ⇒ the weekly
// job is idempotent and replay-safe), delivered via the notifications pipeline.
//
// v2 (feat/sunday-letter-v2): widened from {body, scripture_ref} to a fully
// composed personal letter — title (also the push text), salutation with the
// member's real first name, a theme from a fixed vocabulary the clients map
// to a bundled illustration, and `highlights` (true 2-3 observations from the
// week + a deterministic, server-computed next step + a shareable line).
// Everything the model contributes is parsed defensively (parseLetter below)
// so a malformed response degrades to honest, generic copy — it never throws
// and it never fabricates a specific it wasn't given.
import type { Pool } from "pg";
import { many, maybeOne } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import type { AiProvider } from "../assistant/provider.js";
import type { NotificationService } from "../notifications/service.js";
import type { ContentIndexService } from "./content.js";
import type { StoryService } from "./story.js";
import { LETTER_SYSTEM, LETTER_THEMES, type LetterTheme } from "./prompts.js";

export const DEFAULT_LETTER_TITLE = "Your Sunday Letter";
export const DEFAULT_LETTER_SALUTATION = "Dear friend,";
export const DEFAULT_LETTER_THEME: LetterTheme = "light";

/** A single, deterministic next step drawn from where the member actually is
 *  (not AI-invented — computed server-side from real enrollment/progress data,
 *  the same "next unfinished module" logic Home's next-action uses), stored
 *  frozen on the letter so the archive stays a true snapshot of that week.
 *  `route`/`params` mirror the Home next-action deep-link vocabulary the
 *  clients already route on. */
export interface LetterNextStep {
  label: string;
  route: string;
  params?: { moduleId?: string };
}

export interface LetterRow {
  letter_id: string;
  week_of: string;
  title: string;
  salutation: string;
  theme: LetterTheme;
  /** Which bundled illustration the client renders. Always the theme itself
   *  today; kept as its own column so a future per-theme variant rotation
   *  doesn't need another migration. Never a third-party URL. */
  image_key: string;
  body: string;
  scripture_ref: string | null;
  /** 2-3 true, concrete observations from the member's real week. */
  highlights: string[];
  next_step: LetterNextStep | null;
  /** One shareable line drawn from the letter's own words. */
  share_line: string | null;
  created_at: string;
  read_at: string | null;
}

export interface ParsedLetter {
  title: string;
  salutation: string;
  theme: LetterTheme;
  scriptureRef: string | null;
  body: string;
  highlights: string[];
  shareLine: string | null;
}

interface StoredHighlights {
  moments?: unknown;
  next_step?: unknown;
  share_line?: unknown;
}

/** Raw DB row shape (columns as selected below) before rowFromDb() applies
 *  null-safe defaults for pre-v2 letters and destructures `highlights`. */
interface RawLetterRow {
  letter_id: string;
  week_of: string;
  title: string | null;
  salutation: string | null;
  theme: string | null;
  image_key: string | null;
  body: string;
  scripture_ref: string | null;
  highlights: unknown;
  created_at: string;
  read_at: string | null;
}

function isLetterTheme(v: unknown): v is LetterTheme {
  return typeof v === "string" && (LETTER_THEMES as readonly string[]).includes(v);
}

/** Deterministic "next theme in the fixed rotation" — used only as a fallback
 *  (invalid/missing model output) so even a degraded letter still varies week
 *  to week instead of defaulting to the same theme every time. */
function nextThemeAfter(prev: string | null): LetterTheme {
  if (!prev) return LETTER_THEMES[0];
  const i = (LETTER_THEMES as readonly string[]).indexOf(prev);
  return LETTER_THEMES[(i + 1 + LETTER_THEMES.length) % LETTER_THEMES.length]!;
}

function firstSentence(text: string): string | null {
  const m = text.match(/^[^.!?]{1,180}[.!?]/);
  return m ? m[0].trim() : null;
}

/**
 * Parse the model's STRICT-JSON letter contract (deliberately forgiving, the
 * same idiom as the rest of the intelligence layer — see signals.ts's emotion
 * classifier and liturgy.ts). A malformed response, a legacy plain-text
 * "Scripture: X\n\nbody" letter, or a total failure all degrade to honest,
 * generic copy: it never throws, and it never invents a highlight, a name, or
 * an arc reference that wasn't actually in the model's output.
 *
 * `expectedFirstName` guards the one field where correctness matters more
 * than model creativity: if the model's salutation doesn't actually contain
 * the member's real first name, we override it deterministically rather than
 * risk a misspelled or wrong name in the most personal line of the letter.
 */
export function parseLetter(raw: string, expectedFirstName: string | null, lastTheme: string | null): ParsedLetter | null {
  const fallbackSalutation = expectedFirstName ? `Dear ${expectedFirstName},` : DEFAULT_LETTER_SALUTATION;
  const fallbackTheme = nextThemeAfter(lastTheme);

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
      const body = typeof obj.body === "string" ? obj.body.trim() : "";
      if (body) {
        const highlights = Array.isArray(obj.highlights)
          ? obj.highlights
              .filter((h): h is string => typeof h === "string" && h.trim().length > 0)
              .slice(0, 3)
              .map((h) => h.trim().slice(0, 160))
          : [];

        let salutation = typeof obj.salutation === "string" ? obj.salutation.trim() : "";
        if (!salutation || (expectedFirstName && !salutation.toLowerCase().includes(expectedFirstName.toLowerCase()))) {
          salutation = fallbackSalutation;
        }

        const title =
          typeof obj.title === "string" && obj.title.trim() ? obj.title.trim().slice(0, 120) : DEFAULT_LETTER_TITLE;
        const theme = isLetterTheme(obj.theme) ? obj.theme : fallbackTheme;
        const scriptureRef =
          typeof obj.scripture_ref === "string" && obj.scripture_ref.trim()
            ? obj.scripture_ref.trim().slice(0, 120)
            : null;
        const shareLine =
          typeof obj.share_line === "string" && obj.share_line.trim()
            ? obj.share_line.trim().slice(0, 200)
            : firstSentence(body);

        return { title, salutation, theme, scriptureRef, body, highlights, shareLine };
      }
    } catch {
      // The model returned JSON we could not parse — almost always a TRUNCATED
      // response (max_tokens covers thinking + output on these models, so a
      // long letter can be cut mid-write). The old behaviour fell through and
      // used the RAW STRING as the body, which put a `{"title":"...` blob in
      // front of a member as though it were their pastoral letter. Never
      // present broken output as if a person wrote it: if it smells like JSON,
      // refuse it and let the caller skip this letter rather than ship that.
      if (raw.trimStart().startsWith("{")) {
        return null;
      }

      /* fall through to legacy/total-failure parsing below */
    }
  }

  // Legacy plain-text "Scripture: X\n\nbody" contract — a reasonable degrade
  // both for letters stored before v2 and for a model that ignored the JSON ask.
  const m = raw.match(/^\s*Scripture:\s*(.+?)\s*\n+([\s\S]+)$/i);
  if (m?.[1] && m[2]) {
    const body = m[2].trim();
    return {
      title: DEFAULT_LETTER_TITLE,
      salutation: fallbackSalutation,
      theme: fallbackTheme,
      scriptureRef: m[1].trim().slice(0, 120),
      body,
      highlights: [],
      shareLine: firstSentence(body),
    };
  }

  // Total failure: never invent specifics, never present this as if a person
  // wrote it — just an honest, generic word of grace.
  const body =
    raw.trim() ||
    "This week's letter didn't come together the way it should have. Grace holds true for you all the same — come back soon.";
  return {
    title: DEFAULT_LETTER_TITLE,
    salutation: fallbackSalutation,
    theme: fallbackTheme,
    scriptureRef: null,
    body,
    highlights: [],
    shareLine: null,
  };
}

export class LettersService {
  constructor(
    private readonly pool: Pool,
    private readonly provider: AiProvider,
    private readonly story: StoryService,
    private readonly content: ContentIndexService,
    private readonly notifications?: NotificationService,
    // index.ts has been PASSING ctx.log here all along while the constructor
    // silently dropped it — so every diagnostic this service tried to emit went
    // nowhere. Accepting it is the difference between a skipped letter being
    // visible and it being invisible.
    private readonly log?: { warn: (o: unknown, m: string) => void },
  ) {}

  /** The Sunday (EAT) of the week containing `now`, as YYYY-MM-DD. */
  static weekOf(now: Date = new Date()): string {
    const eat = new Date(now.getTime() + 3 * 3600_000); // EAT = UTC+3, no DST
    const sunday = new Date(Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate() - eat.getUTCDay()));
    return sunday.toISOString().slice(0, 10);
  }

  private static readonly SELECT_COLUMNS =
    "letter_id, week_of::text, title, salutation, theme, image_key, body, scripture_ref, highlights, created_at, read_at";

  /** Null-safe projection from the DB row to the API shape — the ONE place
   *  that defaults pre-v2 columns (title/salutation/theme/image_key/highlights
   *  all NULL on letters written before this migration) so every client path
   *  renders old letters exactly like it renders new ones. */
  private static rowFromDb(r: RawLetterRow): LetterRow {
    const stored = (r.highlights ?? {}) as StoredHighlights;
    const moments = Array.isArray(stored.moments)
      ? stored.moments.filter((m): m is string => typeof m === "string")
      : [];
    const nextStep =
      stored.next_step && typeof stored.next_step === "object" ? (stored.next_step as LetterNextStep) : null;
    const shareLine = typeof stored.share_line === "string" ? stored.share_line : null;
    const theme = isLetterTheme(r.theme) ? r.theme : DEFAULT_LETTER_THEME;

    return {
      letter_id: r.letter_id,
      week_of: r.week_of,
      title: r.title ?? DEFAULT_LETTER_TITLE,
      salutation: r.salutation ?? DEFAULT_LETTER_SALUTATION,
      theme,
      image_key: r.image_key ?? theme,
      body: r.body,
      scripture_ref: r.scripture_ref,
      highlights: moments,
      next_step: nextStep,
      share_line: shareLine,
      created_at: r.created_at,
      read_at: r.read_at,
    };
  }

  /** The single most valuable next step for this member right now, in the
   *  same shape Home's next-action already hands the client (route/params) —
   *  computed here, NOT by the model, so the letter can never link to a
   *  module that doesn't exist. Frozen onto the letter at compose time: the
   *  archive is a snapshot of that week, not a live "what's next" widget. */
  private async computeNextStep(userId: string, level: number): Promise<LetterNextStep | null> {
    const nextModule = await maybeOne<{ module_id: string; title: string }>(
      this.pool,
      `SELECT m.module_id, m.title
         FROM modules m
        WHERE m.level_number = $2 AND m.status = 'published'
          AND m.evaluation_kind <> 'exit_exam'
          AND NOT EXISTS (
            SELECT 1 FROM module_progress mp
              JOIN enrollments e ON e.enrollment_id = mp.enrollment_id
             WHERE e.user_id = $1 AND mp.module_id = m.module_id AND mp.is_completed)
        ORDER BY m.module_sequence_number
        LIMIT 1`,
      [userId, level],
    );
    if (nextModule) {
      return { label: `${nextModule.title} is waiting`, route: "module", params: { moduleId: nextModule.module_id } };
    }
    return { label: "Continue your journey", route: "pathway" };
  }

  /** Compose + store one member's letter for the week. No-op if it exists. */
  async composeFor(userId: string, weekOf: string): Promise<LetterRow | null> {
    const existing = await maybeOne<RawLetterRow>(
      this.pool,
      `SELECT ${LettersService.SELECT_COLUMNS} FROM pastoral_letters WHERE user_id = $1 AND week_of = $2`,
      [userId, weekOf],
    );
    if (existing) return LettersService.rowFromDb(existing);

    const row = await this.story.get(userId);
    const built = row ?? (await this.story.rebuildFor(userId));
    if (!built) return null;

    // Their own previous letters — TRUE material for continuity ("three weeks
    // ago you started Level 2...") and for theme variety. Never fabricated:
    // only ever the exact highlights/theme we already stored for them.
    const prior = await many<{ week_of: string; theme: string | null; highlights: unknown }>(
      this.pool,
      `SELECT week_of::text, theme, highlights FROM pastoral_letters
        WHERE user_id = $1 AND week_of < $2 ORDER BY week_of DESC LIMIT 2`,
      [userId, weekOf],
    );
    const lastTheme = prior[0]?.theme ?? null;
    const priorContext = prior.map((p) => ({
      week_of: p.week_of,
      theme: p.theme,
      moments: Array.isArray((p.highlights as StoredHighlights | null)?.moments)
        ? (p.highlights as StoredHighlights).moments
        : [],
    }));

    // A touch of the church's own teaching, keyed off the member's season.
    let teaching = "";
    try {
      const seed =
        built.facts.reflections_recent[0]?.excerpt ??
        built.facts.last_module_completed?.title ??
        "grace faithfulness walking with God";
      const chunks = await this.content.search(seed, 2);
      if (chunks.length > 0) {
        teaching =
          `\n\nExcerpts from Nuru Place's own teaching (echo one phrase only if it truly fits):\n` +
          chunks.map((c) => `[${c.ref ?? c.title}] ${c.body.slice(0, 500)}`).join("\n");
      }
    } catch {
      /* teaching garnish is optional */
    }

    const firstName = built.facts.name?.split(" ")[0]?.trim() || null;

    const raw = await this.provider.complete({
      system: LETTER_SYSTEM,
      messages: [
        {
          role: "user",
          text:
            `Member first name: ${firstName ?? "friend"}\n\n` +
            `Member story JSON:\n${JSON.stringify(built.facts)}\n\n` +
            (built.narrative ? `Pastoral dossier: ${built.narrative}\n` : "") +
            (priorContext.length > 0
              ? `Their own previous letters (TRUE — reference the arc only if it genuinely fits; last week's theme was "${lastTheme}", vary it if the content allows):\n${JSON.stringify(priorContext)}\n`
              : "") +
            teaching +
            `\n\nWrite this member's Sunday Letter for the week of ${weekOf}.`,
        },
      ],
      tier: "deep",
      // 2000, not 600: the deep-tier model thinks by default and max_tokens
      // caps thinking + the visible letter together — a tight budget here
      // risks truncating the actual JSON letter to nothing.
      maxTokens: 8000,
      feature: "sunday_letter",
    });
    const parsed = parseLetter(raw, firstName, lastTheme);
    // parseLetter returns null when the response was unusable — in practice a
    // TRUNCATED JSON reply. Skipping the week is the honest outcome: a member
    // seeing no letter is recoverable, a member reading a `{"title":"...` blob
    // presented as their pastoral letter is not. The weekly job counts skips,
    // and the ops health summary surfaces them, so this cannot fail silently
    // the way the old fallback did.
    if (!parsed) {
      this.log?.warn({ userId, weekOf }, "sunday letter: unusable model response, skipping this week");
      return null;
    }
    const nextStep = await this.computeNextStep(userId, built.facts.level);
    const highlightsJson = JSON.stringify({
      moments: parsed.highlights,
      next_step: nextStep,
      share_line: parsed.shareLine,
    });

    const inserted = await maybeOne<RawLetterRow>(
      this.pool,
      `INSERT INTO pastoral_letters (user_id, week_of, title, salutation, theme, image_key, body, scripture_ref, highlights)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT (user_id, week_of) DO NOTHING
       RETURNING ${LettersService.SELECT_COLUMNS}`,
      [userId, weekOf, parsed.title, parsed.salutation, parsed.theme, parsed.theme, parsed.body, parsed.scriptureRef, highlightsJson],
    );
    if (inserted && this.notifications) {
      try {
        // payload.title flows straight through dispatch.ts's pushCopy(), which
        // always prefers an explicit payload.title over the generic
        // PUSH_TEMPLATE_COPY fallback — so the actual letter title becomes the
        // push text, exactly what makes it worth tapping.
        await this.notifications.schedule({
          userId,
          channel: "push",
          template: "sunday_letter",
          payload: { letter_id: inserted.letter_id, week_of: weekOf, title: parsed.title },
        });
      } catch {
        /* the letter exists even if the knock fails */
      }
    }
    return inserted ? LettersService.rowFromDb(inserted) : this.composeFor(userId, weekOf); // lost a race → return the winner
  }

  /** Weekly batch: every consenting member active in the last 28 days. */
  async runWeekly(opts: { userIds?: string[]; now?: Date } = {}): Promise<{ week_of: string; written: number; skipped: number }> {
    const weekOf = LettersService.weekOf(opts.now);
    const candidates =
      opts.userIds ??
      (
        await many<{ user_id: string }>(
          this.pool,
          `SELECT u.user_id FROM users u
            WHERE u.ai_opt_out = FALSE
              AND EXISTS (SELECT 1 FROM interaction_events ie
                           WHERE ie.user_id = u.user_id AND ie.occurred_at >= now() - interval '28 days')
              AND EXISTS (SELECT 1 FROM enrollments e WHERE e.user_id = u.user_id)`,
        )
      ).map((r) => r.user_id);

    let written = 0;
    let skipped = 0;
    for (const userId of candidates) {
      try {
        const before = await maybeOne(
          this.pool,
          `SELECT 1 FROM pastoral_letters WHERE user_id = $1 AND week_of = $2`,
          [userId, weekOf],
        );
        if (before) {
          skipped++;
          continue;
        }
        const letter = await this.composeFor(userId, weekOf);
        if (letter) written++;
        else skipped++;
      } catch {
        skipped++; // one member must never sink the batch
      }
    }
    return { week_of: weekOf, written, skipped };
  }

  /** Newest first — the member's own keepable archive of past letters. */
  async list(userId: string, limit = 20): Promise<LetterRow[]> {
    const rows = await many<RawLetterRow>(
      this.pool,
      `SELECT ${LettersService.SELECT_COLUMNS} FROM pastoral_letters WHERE user_id = $1 ORDER BY week_of DESC LIMIT $2`,
      [userId, Math.min(Math.max(limit, 1), 50)],
    );
    return rows.map((r) => LettersService.rowFromDb(r));
  }

  async latest(userId: string): Promise<LetterRow | null> {
    const r = await maybeOne<RawLetterRow>(
      this.pool,
      `SELECT ${LettersService.SELECT_COLUMNS} FROM pastoral_letters WHERE user_id = $1 ORDER BY week_of DESC LIMIT 1`,
      [userId],
    );
    return r ? LettersService.rowFromDb(r) : null;
  }

  async markRead(userId: string, letterId: string): Promise<{ letter_id: string; read_at: string }> {
    const row = await maybeOne<{ letter_id: string; read_at: string }>(
      this.pool,
      `UPDATE pastoral_letters SET read_at = coalesce(read_at, now())
        WHERE letter_id = $1 AND user_id = $2
        RETURNING letter_id, read_at`,
      [letterId, userId],
    );
    if (!row) throw new ApiError("NOT_FOUND", "Letter not found");
    return row;
  }
}
