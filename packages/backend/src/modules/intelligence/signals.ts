// The Shepherd's Pulse (Phase 2) — turns what the platform already sees into
// ATTENTION for humans. Three signal kinds:
//   • drift_risk — deterministic rules against the member's OWN baseline
//     (was steady, has gone quiet). No AI involved; explanations are exact.
//   • emotion    — an AI read (tier fast) of freshly-written, CONSENTED content
//     (module reflections, Talk it Over posts). Stores a coarse tone + one-line
//     summary, never the full text.
//   • crisis     — despair/self-harm language. Keyword pre-filter + AI confirm;
//     fail-safe: if the AI is unavailable, the keyword hit alone escalates.
// Escalation notifies the member's cell leaders + multiplier (§5.4 scoping) —
// leaders already read reflections in the review queue, so this adds no new
// exposure, only urgency. The weekly FLOCK BRIEF composes each leader's people
// into a short pastoral briefing (celebrate / watch / reach out first).
import type { Pool } from "pg";
import { many, maybeOne } from "../../db/db.js";
import { ApiError } from "../../http/errors.js";
import type { Principal } from "../../http/http.js";
import type { AiProvider } from "../assistant/provider.js";
import type { NotificationService } from "../notifications/service.js";
import type { StoryService } from "./story.js";
import { DRAFT_OUTREACH_SYSTEM, EMOTION_SYSTEM, FLOCK_BRIEF_SYSTEM } from "./prompts.js";
import { LettersService } from "./letters.js";

const CRISIS_RX = /suicid|kill myself|end my life|end it all|self.?harm|no reason to live|want to die|take my own life/i;

export interface SignalRow {
  signal_id: string;
  user_id: string;
  member_name?: string;
  kind: "drift_risk" | "emotion" | "crisis";
  severity: "info" | "watch" | "urgent";
  summary: string;
  detail: Record<string, unknown>;
  source: string | null;
  created_at: string;
  acknowledged_at: string | null;
}

export class SignalsService {
  constructor(
    private readonly pool: Pool,
    private readonly provider: AiProvider,
    private readonly story: StoryService,
    private readonly notifications?: NotificationService,
  ) {}

  private async insert(
    userId: string,
    kind: SignalRow["kind"],
    severity: SignalRow["severity"],
    summary: string,
    detail: Record<string, unknown>,
    source: string | null,
  ): Promise<string | null> {
    const row = await maybeOne<{ signal_id: string }>(
      this.pool,
      `INSERT INTO signals (user_id, kind, severity, summary, detail, source)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, kind, day_date) DO NOTHING
       RETURNING signal_id`,
      [userId, kind, severity, summary, JSON.stringify(detail), source],
    );
    return row?.signal_id ?? null;
  }

  /** Deterministic drift rules — the member vs their own recent baseline. */
  async scanDrift(): Promise<{ flagged: number }> {
    const rows = await many<{ user_id: string; full_name: string; recent7: number; prior21: number }>(
      this.pool,
      `SELECT u.user_id, u.full_name,
              count(DISTINCT (ie.occurred_at AT TIME ZONE 'Africa/Nairobi')::date)
                FILTER (WHERE ie.occurred_at >= now() - interval '7 days')::int AS recent7,
              count(DISTINCT (ie.occurred_at AT TIME ZONE 'Africa/Nairobi')::date)
                FILTER (WHERE ie.occurred_at >= now() - interval '28 days'
                          AND ie.occurred_at <  now() - interval '7 days')::int AS prior21
         FROM users u
         JOIN enrollments e ON e.user_id = u.user_id
         LEFT JOIN interaction_events ie
           ON ie.user_id = u.user_id AND ie.occurred_at >= now() - interval '28 days'
        GROUP BY u.user_id, u.full_name`,
    );
    let flagged = 0;
    for (const r of rows) {
      const priorWeekly = r.prior21 / 3;
      if (priorWeekly >= 2 && r.recent7 === 0) {
        const id = await this.insert(
          r.user_id,
          "drift_risk",
          "watch",
          `${r.full_name} has gone quiet — active ~${priorWeekly.toFixed(1)} days/week before, 0 in the last 7.`,
          { recent7: r.recent7, prior_weekly_avg: Number(priorWeekly.toFixed(1)) },
          "rhythm",
        );
        if (id) flagged++;
      } else if (priorWeekly >= 3 && r.recent7 <= 1) {
        const id = await this.insert(
          r.user_id,
          "drift_risk",
          "info",
          `${r.full_name}'s rhythm is slipping — ~${priorWeekly.toFixed(1)} days/week before, ${r.recent7} in the last 7.`,
          { recent7: r.recent7, prior_weekly_avg: Number(priorWeekly.toFixed(1)) },
          "rhythm",
        );
        if (id) flagged++;
      }
    }
    return { flagged };
  }

  /** AI emotion read of the last ~36h of consented written content. */
  async classifyRecent(): Promise<{ read: number; flagged: number; crises: number }> {
    const items = await many<{ user_id: string; full_name: string; source: string; text: string }>(
      this.pool,
      `SELECT r.user_id, u.full_name, 'reflection' AS source, left(r.body, 900) AS text
         FROM module_reflections r
         JOIN users u ON u.user_id = r.user_id
        WHERE r.submitted_at >= now() - interval '36 hours' AND u.ai_opt_out = FALSE
       UNION ALL
       SELECT t.user_id, u.full_name, 'talk' AS source, left(t.body, 900) AS text
         FROM plan_day_talk_posts t
         JOIN users u ON u.user_id = t.user_id
        WHERE t.created_at >= now() - interval '36 hours' AND u.ai_opt_out = FALSE
        LIMIT 200`,
    );
    let read = 0;
    let flagged = 0;
    let crises = 0;
    for (const item of items) {
      read++;
      const keywordCrisis = CRISIS_RX.test(item.text);
      let tone = "neutral";
      let summary = "";
      let aiCrisis = false;
      try {
        const raw = await this.provider.complete({
          system: EMOTION_SYSTEM,
          messages: [{ role: "user", text: item.text }],
          tier: "fast",
          maxTokens: 160,
          feature: "emotion_classifier",
        });
        const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as {
          tone?: string;
          summary?: string;
          crisis?: boolean;
        };
        tone = (parsed.tone ?? "neutral").toLowerCase();
        summary = (parsed.summary ?? "").slice(0, 240);
        aiCrisis = parsed.crisis === true;
      } catch {
        // AI unavailable → fail SAFE: a keyword hit still escalates below.
      }

      const isCrisis = aiCrisis || keywordCrisis;
      if (isCrisis) {
        const id = await this.insert(
          item.user_id,
          "crisis",
          "urgent",
          `${item.full_name} wrote words of deep distress in a ${item.source}. Reach out today.`,
          { tone: tone || "despairing", via: keywordCrisis ? "keyword" : "model" },
          item.source,
        );
        if (id) {
          crises++;
          await this.notifyCarers(item.user_id, id);
        }
        continue;
      }
      if (["weary", "grieving", "anxious", "despairing", "discouraged", "struggling"].includes(tone)) {
        const id = await this.insert(item.user_id, "emotion", "watch", `${item.full_name} sounds ${tone}: ${summary}`, { tone }, item.source);
        if (id) flagged++;
      } else if (["joyful", "thankful", "hopeful", "breakthrough"].includes(tone) && summary) {
        const id = await this.insert(item.user_id, "emotion", "info", `${item.full_name} sounds ${tone}: ${summary}`, { tone }, item.source);
        if (id) flagged++;
      }
    }
    return { read, flagged, crises };
  }

  /** Push a care flag to the member's cell leaders + multiplier (no content in the push). */
  private async notifyCarers(memberId: string, signalId: string): Promise<void> {
    if (!this.notifications) return;
    const carers = await many<{ leader_user_id: string }>(
      this.pool,
      `SELECT la.leader_user_id
         FROM leader_assignments la
         JOIN users m ON m.cell_group_id = la.cell_group_id
        WHERE m.user_id = $1
       UNION
       SELECT rt.multiplier_id FROM relationship_tree rt WHERE rt.disciple_id = $1`,
      [memberId],
    );
    for (const c of carers) {
      try {
        await this.notifications.schedule({
          userId: c.leader_user_id,
          channel: "push",
          template: "member_care_flag",
          payload: { member_user_id: memberId, signal_id: signalId },
        });
      } catch {
        /* best-effort */
      }
    }
  }

  async runNightly(): Promise<{ drift: number; read: number; flagged: number; crises: number }> {
    const d = await this.scanDrift();
    const c = await this.classifyRecent();
    return { drift: d.flagged, ...c };
  }

  /** The member ids a leader shepherds (cells they lead + direct disciples). */
  private async flockOf(leaderId: string): Promise<string[]> {
    const rows = await many<{ user_id: string }>(
      this.pool,
      `SELECT m.user_id
         FROM leader_assignments la
         JOIN users m ON m.cell_group_id = la.cell_group_id
        WHERE la.leader_user_id = $1 AND m.user_id <> $1
       UNION
       SELECT rt.disciple_id FROM relationship_tree rt WHERE rt.multiplier_id = $1`,
      [leaderId],
    );
    return rows.map((r) => r.user_id);
  }

  /** Signals visible to this principal (Admin+ = all; leaders = their flock). */
  async listFor(principal: Principal, sinceDays = 14): Promise<SignalRow[]> {
    const base = `SELECT s.signal_id, s.user_id, u.full_name AS member_name, s.kind, s.severity, s.summary,
                         s.detail, s.source, s.created_at, s.acknowledged_at
                    FROM signals s JOIN users u ON u.user_id = s.user_id
                   WHERE s.created_at >= now() - make_interval(days => $1)`;
    if (principal.role === "Admin" || principal.role === "SuperAdmin") {
      return many<SignalRow>(this.pool, `${base} ORDER BY s.created_at DESC LIMIT 200`, [sinceDays]);
    }
    return many<SignalRow>(
      this.pool,
      `${base} AND s.user_id = ANY($2::uuid[]) ORDER BY s.created_at DESC LIMIT 200`,
      [sinceDays, await this.flockOf(principal.userId)],
    );
  }

  async acknowledge(principal: Principal, signalId: string): Promise<{ signal_id: string; acknowledged_at: string }> {
    const allowed =
      principal.role === "Admin" || principal.role === "SuperAdmin"
        ? null
        : await this.flockOf(principal.userId);
    const row = await maybeOne<{ signal_id: string; acknowledged_at: string }>(
      this.pool,
      `UPDATE signals SET acknowledged_by = $2, acknowledged_at = coalesce(acknowledged_at, now())
        WHERE signal_id = $1 AND ($3::uuid[] IS NULL OR user_id = ANY($3::uuid[]))
        RETURNING signal_id, acknowledged_at`,
      [signalId, principal.userId, allowed],
    );
    if (!row) throw new ApiError("NOT_FOUND", "Signal not found");
    return row;
  }

  /** Draft a check-in message for the person behind ONE signal — on request,
   *  not on a cron. Small, grounded extension of the Shepherd's Pulse: same
   *  RBAC scoping as acknowledge() (leader must own this signal or be
   *  Admin+), same privacy footprint as the Flock Brief (facts + the signal's
   *  own summary, never raw reflection/journal text), same "suggestion only"
   *  contract as the prayer assistant (nothing is sent or persisted here —
   *  the leader edits and sends it themselves). Fails honestly: on any AI
   *  failure this throws (never a fabricated "personal" message). */
  async draftOutreach(principal: Principal, signalId: string): Promise<{ suggestion: string }> {
    const allowed =
      principal.role === "Admin" || principal.role === "SuperAdmin"
        ? null
        : await this.flockOf(principal.userId);
    const signal = await maybeOne<{ user_id: string; full_name: string; summary: string }>(
      this.pool,
      `SELECT s.user_id, u.full_name, s.summary
         FROM signals s JOIN users u ON u.user_id = s.user_id
        WHERE s.signal_id = $1 AND ($2::uuid[] IS NULL OR s.user_id = ANY($2::uuid[]))`,
      [signalId, allowed],
    );
    if (!signal) throw new ApiError("NOT_FOUND", "Signal not found");

    const story = await this.story.get(signal.user_id);
    const facts = story
      ? {
          level: story.facts.level,
          overall: story.facts.scores.overall,
          trend: story.facts.scores.trend_delta,
          active_days_28: story.facts.active_days_28,
        }
      : {};
    const suggestion = await this.provider.complete({
      system: DRAFT_OUTREACH_SYSTEM,
      messages: [
        {
          role: "user",
          text: `Person: ${signal.full_name.split(" ")[0]}\nSignal: ${signal.summary}\nOther facts: ${JSON.stringify(facts)}`,
        },
      ],
      tier: "standard",
      effort: "low", // on-demand, leader is waiting — keep it snappy
      maxTokens: 500,
      feature: "draft_outreach",
    });
    return { suggestion: suggestion.trim().slice(0, 1000) };
  }

  /** Compose this week's Flock Brief for every leader with people. */
  async composeBriefs(now = new Date()): Promise<{ week_of: string; written: number; skipped: number }> {
    const weekOf = LettersService.weekOf(now);
    const leaders = await many<{ leader_user_id: string }>(
      this.pool,
      `SELECT DISTINCT leader_user_id FROM leader_assignments
       UNION SELECT DISTINCT multiplier_id FROM relationship_tree`,
    );
    let written = 0;
    let skipped = 0;
    for (const l of leaders) {
      try {
        const exists = await maybeOne(this.pool, `SELECT 1 FROM flock_briefs WHERE leader_user_id = $1 AND week_of = $2`, [
          l.leader_user_id,
          weekOf,
        ]);
        if (exists) {
          skipped++;
          continue;
        }
        const flock = await this.flockOf(l.leader_user_id);
        if (flock.length === 0) {
          skipped++;
          continue;
        }
        const people: Array<Record<string, unknown>> = [];
        for (const memberId of flock.slice(0, 30)) {
          const story = await this.story.get(memberId);
          const sigs = await many<{ kind: string; severity: string; summary: string }>(
            this.pool,
            `SELECT kind, severity, summary FROM signals
              WHERE user_id = $1 AND created_at >= now() - interval '7 days'
              ORDER BY created_at DESC LIMIT 4`,
            [memberId],
          );
          if (story) {
            people.push({
              name: story.facts.name,
              level: story.facts.level,
              overall: story.facts.scores.overall,
              trend: story.facts.scores.trend_delta,
              active_days_28: story.facts.active_days_28,
              signals: sigs,
            });
          }
        }
        if (people.length === 0) {
          skipped++;
          continue;
        }
        const body = await this.provider.complete({
          system: FLOCK_BRIEF_SYSTEM,
          messages: [{ role: "user", text: `Week of ${weekOf}. Your people:\n${JSON.stringify(people)}` }],
          tier: "deep",
          // 1800, not 700: deep-tier thinking is on by default and shares the
          // max_tokens budget with the visible briefing — leave it headroom.
          maxTokens: 1800,
          feature: "flock_brief",
        });
        const inserted = await maybeOne<{ brief_id: string }>(
          this.pool,
          `INSERT INTO flock_briefs (leader_user_id, week_of, body, detail)
           VALUES ($1, $2, $3, $4) ON CONFLICT (leader_user_id, week_of) DO NOTHING RETURNING brief_id`,
          [l.leader_user_id, weekOf, body.trim(), JSON.stringify({ people })],
        );
        if (inserted) {
          written++;
          try {
            await this.notifications?.schedule({
              userId: l.leader_user_id,
              channel: "push",
              template: "flock_brief",
              payload: { week_of: weekOf },
            });
          } catch {
            /* best-effort */
          }
        } else skipped++;
      } catch {
        skipped++; // one leader must never sink the batch
      }
    }
    return { week_of: weekOf, written, skipped };
  }

  async myBrief(leaderId: string): Promise<{ brief_id: string; week_of: string; body: string; created_at: string } | null> {
    return maybeOne(
      this.pool,
      `SELECT brief_id, week_of::text, body, created_at FROM flock_briefs
        WHERE leader_user_id = $1 ORDER BY week_of DESC LIMIT 1`,
      [leaderId],
    );
  }
}
