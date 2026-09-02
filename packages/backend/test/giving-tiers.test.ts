// Partner giving tiers. These are pure functions, so the tests are cheap — and
// worth writing precisely because the failure mode here is not a crash. It is a
// number that quietly overstates what someone's money does.
import { describe, it, expect } from "vitest";
import {
  COST_PER_DISCIPLE_MINOR,
  disciplesPerYear,
  givingTiers,
} from "../src/modules/financial/tiers.js";

describe("what a gift honestly carries", () => {
  it("uses the owner's costing: KSh 20,000 per disciple, per level", () => {
    expect(COST_PER_DISCIPLE_MINOR).toBe(2_000_000);
  });

  // THE RULE. Rounding up would be a lie told in the flattering direction, and
  // it is exactly the kind that survives review because it feels generous.
  it("always rounds DOWN — never promises a disciple it cannot carry", () => {
    // 1,700/month = 20,400/year. That is one disciple and change, not two.
    expect(disciplesPerYear(170_000)).toBe(1);
    // Just under the line: 1,666/month = 19,992/year, twelve shillings short of
    // a disciple. It carries none, and says none. (1,699 would be 20,388 — over
    // the line, and therefore one; my first draft of this test had that wrong.)
    expect(disciplesPerYear(166_600)).toBe(0);
    expect(disciplesPerYear(166_700)).toBe(1);   // 20,004 — just over
    // 9,999/month = 119,988/year — five, not six.
    expect(disciplesPerYear(999_900)).toBe(5);
  });

  it("is not fooled by zero or nonsense", () => {
    expect(disciplesPerYear(0)).toBe(0);
    expect(disciplesPerYear(-500_000)).toBe(0);
    expect(disciplesPerYear(500_000, 0)).toBe(0);
  });

  it("offers three tiers, each landing on a whole disciple after a year", () => {
    const tiers = givingTiers();
    expect(tiers.map((t) => t.amount_minor)).toEqual([170_000, 500_000, 1_000_000]);
    expect(tiers.map((t) => t.disciples_per_year)).toEqual([1, 3, 6]);
  });

  it("says what the money does, never just what it is", () => {
    const [one, three] = givingTiers();
    expect(one!.meaning).toBe("carries one disciple through a level, every year");
    expect(three!.meaning).toBe("carries 3 disciples through a level, every year");
    // No tier is ever offered as a bare amount.
    for (const t of givingTiers()) expect(t.meaning.length).toBeGreaterThan(0);
  });

  it("never invents a fraction of a disciple", () => {
    const tiny = givingTiers("KES", 100_000_000); // an absurdly costly level
    for (const t of tiny) {
      expect(t.disciples_per_year).toBe(0);
      expect(t.meaning).toBe("carries part of the cost of a disciple's level");
      expect(t.meaning).not.toMatch(/half|0\.|fraction/i);
    }
  });

  it("follows the cost — change the number and every tier moves with it", () => {
    // If a level ever costs half as much, the same gift carries twice as many.
    const cheaper = givingTiers("KES", COST_PER_DISCIPLE_MINOR / 2);
    expect(cheaper.map((t) => t.disciples_per_year)).toEqual([2, 6, 12]);
  });
});
