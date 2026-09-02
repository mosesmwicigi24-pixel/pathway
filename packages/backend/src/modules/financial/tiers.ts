// Partner giving tiers — amounts that mean something.
//
// "KSh 500" is a price list. "KSh 500 · carries one disciple through a level"
// is an invitation. Every tier's copy here is derived from ONE number that the
// owner gave on 2026-09-02, and that number is the only thing in this file that
// must not be guessed:
//
//                 KSh 20,000 carries one disciple through one level.
//
// WHY THIS LIVES IN CODE AND NOT IN A TABLE
// Tiers are copy. Copy in a database is copy nobody reviews — it drifts, it
// escapes code review, and nothing ties it back to the number it was derived
// from. Here, changing the cost changes every tier at once and the diff is
// visible.
//
// THE ROUNDING RULE, which matters more than the arithmetic:
// disciples-per-year is always rounded DOWN. A partner giving KSh 5,000 a month
// contributes 60,000 a year — exactly three. One giving 1,700 contributes
// 20,400 — one, and change. We say "one", never "one and a bit", and never two.
// Overstating what a gift does is the precise failure this whole design exists
// to avoid; the honest direction is always down.

/** The owner's costing. Change this and every tier below follows. */
export const COST_PER_DISCIPLE_MINOR = 2_000_000; // KSh 20,000 in cents

export interface GivingTier {
  amount_minor: number;
  currency: string;
  /** What a year of this actually carries. Rounded DOWN, always. */
  disciples_per_year: number;
  /** The invitation line. Never an amount on its own. */
  meaning: string;
}

/** Whole disciples a year of this monthly gift carries. Never rounds up. */
export function disciplesPerYear(monthlyMinor: number, costPerDiscipleMinor = COST_PER_DISCIPLE_MINOR): number {
  if (monthlyMinor <= 0 || costPerDiscipleMinor <= 0) return 0;
  return Math.floor((monthlyMinor * 12) / costPerDiscipleMinor);
}

/**
 * The three monthly tiers offered in the invitation.
 *
 * The amounts are chosen so each one lands cleanly on a whole disciple after a
 * year — 1,700 → 20,400 (one), 5,000 → 60,000 (three), 10,000 → 120,000 (six).
 * They are not round marketing numbers, and that is the point: they are round
 * in the unit that matters.
 */
export function givingTiers(currency = "KES", costPerDiscipleMinor = COST_PER_DISCIPLE_MINOR): GivingTier[] {
  const monthly = [170_000, 500_000, 1_000_000]; // KSh 1,700 / 5,000 / 10,000
  return monthly.map((amount_minor) => {
    const n = disciplesPerYear(amount_minor, costPerDiscipleMinor);
    return {
      amount_minor,
      currency,
      disciples_per_year: n,
      meaning: meaningFor(n),
    };
  });
}

/**
 * The line beside the amount. When a year of giving does not yet reach a whole
 * disciple we do NOT invent a fraction — "half a disciple" is both absurd and
 * untrue. We say what is honestly true instead: it carries part of the cost.
 */
function meaningFor(disciples: number): string {
  if (disciples <= 0) return "carries part of the cost of a disciple's level";
  if (disciples === 1) return "carries one disciple through a level, every year";
  return `carries ${disciples} disciples through a level, every year`;
}
