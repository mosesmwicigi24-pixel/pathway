// The plan promos — ads that know the reader (owner, 2026-08-26: "make it
// intelligent and smart and customized and with memory and with history").
//
// Five slots, and every one has to EARN its place from something true about
// this member. Nothing here is random and nothing is invented: the copy is the
// plan's own, the reason is a fact about their walk.
//
//   continue   — a plan they are already walking. Always first when it exists.
//   next_step  — they FINISHED something; this is the next step in that same
//                stream (their history talking).
//   carrying   — an open, unanswered prayer whose theme matches a plan's
//                category (fear → Courage, rejection → Healing…). The most
//                personal slot, and the most carefully bounded: it names the
//                THEME, never the member's own words.
//   cell       — plans the rest of their cell is reading. Belonging, not
//                algorithm.
//   fresh      — something from the library they have never been offered, so
//                the whole shelf eventually gets seen.
//
// MEMORY (plan_promo_log, migration 210): the selector records what it showed
// and reads it back — a plan promoted in the last 10 days is skipped unless it
// is the continue slot, and among equals the least-shown wins. That is what
// keeps a shelf of 22 plans from collapsing onto the same three.
import type pg from "pg";
import { many, maybeOne } from "../../db/db.js";

export interface PlanPromo {
  plan_id: string;
  slot: "continue" | "next_step" | "carrying" | "cell" | "fresh";
  kicker: string;
  reason: string;
}

/** Prayer/journal language → the plan categories that answer it. */
const THEME_TO_CATEGORIES: ReadonlyArray<{ words: readonly string[]; categories: readonly string[]; theme: string }> = [
  { words: ["fear", "afraid", "anxious", "anxiety", "worry", "worried", "scared", "panic"], categories: ["Courage", "Faith"], theme: "fear" },
  { words: ["reject", "rejected", "rejection", "abandon", "unwanted", "lonely", "alone", "hurt", "wound"], categories: ["Healing", "Love"], theme: "rejection" },
  { words: ["who am i", "identity", "worth", "worthless", "purpose", "belong", "confidence"], categories: ["Identity", "Purpose"], theme: "identity" },
  { words: ["guilt", "shame", "failure", "failed", "mistake", "forgive", "sorry", "sin"], categories: ["Grace", "Healing"], theme: "grace" },
  { words: ["mind", "thoughts", "overthink", "doubt", "confused", "focus", "peace of mind"], categories: ["Mind", "Wisdom"], theme: "the mind" },
  { words: ["marriage", "family", "friend", "relationship", "husband", "wife", "children", "father", "mother"], categories: ["Relationships", "Love"], theme: "the people you love" },
  { words: ["lead", "leader", "team", "work", "business", "job", "career", "vision"], categories: ["Leadership", "Vision", "Wisdom"], theme: "leading well" },
  { words: ["give up", "tired", "weary", "discourage", "quit", "persever", "patience", "waiting"], categories: ["Faithfulness", "Growth"], theme: "staying the course" },
];

interface PlanLite {
  plan_id: string;
  title: string;
  category: string | null;
  sort: number;
}

/**
 * Up to five promos for this member, most personal first. Never promotes a
 * plan twice in one response, and never a plan they have already finished.
 */
export async function planPromos(pool: pg.Pool, userId: string, limit = 5): Promise<PlanPromo[]> {
  const plans = await many<PlanLite>(
    pool,
    `SELECT plan_id, title, category, sort FROM reading_plans WHERE is_active ORDER BY sort`,
  );
  if (plans.length === 0) return [];
  const byId = new Map(plans.map((p) => [p.plan_id, p]));

  const progress = await many<{ plan_id: string; completed_at: string | null; updated_at: string }>(
    pool,
    `SELECT plan_id, completed_at, updated_at FROM reading_plan_progress WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId],
  );
  const finished = progress.filter((p) => p.completed_at != null);
  const touched = new Set(progress.map((p) => p.plan_id));

  // What the selector already put in front of this member, and when.
  const shown = new Map<string, { days_ago: number; times: number }>();
  for (const r of await many<{ plan_id: string; days_ago: number; times_shown: number }>(
    pool,
    `SELECT plan_id, (CURRENT_DATE - last_shown_on)::int AS days_ago, times_shown
       FROM plan_promo_log WHERE user_id = $1`,
    [userId],
  )) {
    shown.set(r.plan_id, { days_ago: r.days_ago, times: r.times_shown });
  }
  const rested = (planId: string): boolean => {
    const s = shown.get(planId);
    return !s || s.days_ago >= 10;
  };
  const timesShown = (planId: string): number => shown.get(planId)?.times ?? 0;

  const out: PlanPromo[] = [];
  const used = new Set<string>();
  const finishedIds = new Set(finished.map((f) => f.plan_id));
  const take = (
    plan: PlanLite | undefined,
    slot: PlanPromo["slot"],
    kicker: string,
    reason: string,
    ignoreRest = false,
  ): void => {
    if (!plan || used.has(plan.plan_id) || finishedIds.has(plan.plan_id) || out.length >= limit) return;
    if (!ignoreRest && !rested(plan.plan_id)) return;
    used.add(plan.plan_id);
    out.push({ plan_id: plan.plan_id, slot, kicker, reason });
  };
  /** Least-promoted first, then library order — so the shelf gets seen. */
  const freshest = (pool_: PlanLite[]): PlanLite | undefined =>
    pool_.filter((p) => !used.has(p.plan_id) && rested(p.plan_id))
      .sort((a, b) => timesShown(a.plan_id) - timesShown(b.plan_id) || a.sort - b.sort)[0];

  // 1 · CONTINUE — the plan they are already walking. Memory never hides this.
  const inProgress = progress.find((p) => p.completed_at == null);
  if (inProgress) {
    take(byId.get(inProgress.plan_id), "continue", "PICK UP WHERE YOU LEFT OFF",
      "You have already begun this one — a few minutes today keeps it moving.", true);
  }

  // 2 · NEXT STEP — history talking: they finished something, so what follows?
  const lastFinished = finished[0] ? byId.get(finished[0].plan_id) : undefined;
  if (lastFinished) {
    const sameStream = plans.filter((p) => p.category === lastFinished.category && !touched.has(p.plan_id));
    const anyNext = plans.filter((p) => p.sort > lastFinished.sort && !touched.has(p.plan_id));
    take(freshest(sameStream) ?? freshest(anyNext), "next_step", "BECAUSE YOU FINISHED",
      `You completed ${lastFinished.title} — this is the next step in that same walk.`);
  }

  // 3 · CARRYING — an open prayer's THEME (never its words) meets a category.
  const prayer = await maybeOne<{ title: string; body: string | null }>(
    pool,
    `SELECT title, body FROM prayer_entries
      WHERE user_id = $1 AND NOT is_answered AND length(btrim(title)) > 0
      ORDER BY updated_at DESC LIMIT 1`,
    [userId],
  );
  if (prayer) {
    const hay = `${prayer.title} ${prayer.body ?? ""}`.toLowerCase();
    const match = THEME_TO_CATEGORIES.find((t) => t.words.some((w) => hay.includes(w)));
    if (match) {
      const candidates = plans.filter((p) => p.category != null && match.categories.includes(p.category) && !touched.has(p.plan_id));
      take(freshest(candidates), "carrying", "FOR WHAT YOU'RE CARRYING",
        `You have been praying about ${match.theme}. These days were written for exactly that.`);
    }
  }

  // 4 · CELL — what the people beside them are reading. Belonging, not maths.
  const cellPick = await maybeOne<{ plan_id: string; readers: number }>(
    pool,
    `SELECT rp.plan_id, count(DISTINCT rp.user_id)::int AS readers
       FROM reading_plan_progress rp
       JOIN users u ON u.user_id = rp.user_id
      WHERE u.cell_group_id = (SELECT cell_group_id FROM users WHERE user_id = $1)
        AND u.user_id <> $1 AND u.deleted_at IS NULL AND rp.completed_at IS NULL
        AND rp.plan_id <> ALL($2::uuid[])
      GROUP BY rp.plan_id ORDER BY readers DESC, rp.plan_id LIMIT 1`,
    [userId, [...touched]],
  );
  if (cellPick) {
    const p = byId.get(cellPick.plan_id);
    take(p, "cell", "YOUR CELL IS READING",
      cellPick.readers === 1
        ? "Someone in your cell is walking this right now — you could walk it together."
        : `${cellPick.readers} people in your cell are walking this — you could join them.`);
  }

  // 5 · FRESH — the least-offered plan they have never touched, so the whole
  // library eventually gets its turn in front of them.
  take(freshest(plans.filter((p) => !touched.has(p.plan_id))), "fresh", "WORTH YOUR WEEK",
    "You haven't opened this one yet — it may be the word for this season.");

  // Still short (a small library, or everything recently shown)? Fill with the
  // least-shown untouched plans rather than returning a thin page.
  while (out.length < limit) {
    const filler = plans
      .filter((p) => !used.has(p.plan_id) && !finishedIds.has(p.plan_id))
      .sort((a, b) => timesShown(a.plan_id) - timesShown(b.plan_id) || a.sort - b.sort)[0];
    if (!filler) break;
    used.add(filler.plan_id);
    out.push({
      plan_id: filler.plan_id,
      slot: "fresh",
      kicker: "FROM THE LIBRARY",
      reason: "A few minutes a day is all it asks.",
    });
  }

  // Remember what we showed — best-effort: a bookkeeping hiccup must never
  // cost the member their page.
  try {
    if (out.length > 0) {
      await pool.query(
        `INSERT INTO plan_promo_log (user_id, plan_id, slot, last_shown_on, times_shown)
         SELECT $1, x.plan_id::uuid, x.slot, CURRENT_DATE, 1
           FROM unnest($2::uuid[], $3::text[]) AS x(plan_id, slot)
         ON CONFLICT (user_id, plan_id) DO UPDATE
           SET slot = EXCLUDED.slot,
               times_shown = plan_promo_log.times_shown + (CASE WHEN plan_promo_log.last_shown_on < CURRENT_DATE THEN 1 ELSE 0 END),
               last_shown_on = CURRENT_DATE`,
        [userId, out.map((o) => o.plan_id), out.map((o) => o.slot)],
      );
    }
  } catch {
    /* the page matters more than the ledger */
  }
  return out;
}
