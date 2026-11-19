import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { averageRanks, betaCdf, clopperPearson, fisherExact, iqr, median, quantile, wilcoxonSignedRank } from './stats.js';

/** Reference: enumerate all 2^m sign assignments. */
function bruteForceP(a: number[], b: number[]): number {
  const d = a.map((x, i) => x - b[i]!).filter((x) => x !== 0);
  const m = d.length;
  if (m === 0) return 1;
  const ranks = averageRanks(d.map(Math.abs));
  const obs = d.reduce((s, x, i) => (x > 0 ? s + ranks[i]! : s), 0);
  let le = 0, ge = 0;
  for (let mask = 0; mask < 2 ** m; mask++) {
    let w = 0;
    for (let i = 0; i < m; i++) if (mask & (1 << i)) w += ranks[i]!;
    if (w <= obs + 1e-9) le++;
    if (w >= obs - 1e-9) ge++;
  }
  return Math.min(1, (2 * Math.min(le, ge)) / 2 ** m);
}

describe('wilcoxonSignedRank', () => {
  it('gives 0.125 as the smallest two-sided p for four non-zero differences', () => {
    expect(wilcoxonSignedRank([5, 6, 7, 8], [1, 1, 1, 1]).p).toBeCloseTo(0.125, 12);
  });
  it('gives p = 1 when every difference is zero', () => {
    expect(wilcoxonSignedRank([1, 2], [1, 2])).toMatchObject({ n: 0, p: 1 });
  });
  it('gives 2 / 2^9 when all nine differences are positive', () => {
    const r = wilcoxonSignedRank([1, 2, 3, 4, 5, 6, 7, 8, 9], Array(9).fill(0));
    expect(r).toMatchObject({ n: 9, wPlus: 45, wMinus: 0 });
    expect(r.p).toBeCloseTo(2 / 512, 12);
  });
  it('rejects more than 20 non-zero differences', () => {
    expect(() => wilcoxonSignedRank(Array(21).fill(1), Array(21).fill(0))).toThrow(RangeError);
  });
  it('matches brute-force enumeration, including ties', () => {
    fc.assert(fc.property(
      fc.array(fc.tuple(fc.integer({ min: -4, max: 4 }), fc.integer({ min: -4, max: 4 })), { minLength: 1, maxLength: 12 }),
      (pairs) => {
        const a = pairs.map((p) => p[0]), b = pairs.map((p) => p[1]);
        expect(wilcoxonSignedRank(a, b).p).toBeCloseTo(bruteForceP(a, b), 10);
      },
    ), { numRuns: 200 });
  });
  it('is symmetric in the arms and stays in (0, 1]', () => {
    fc.assert(fc.property(
      fc.array(fc.tuple(fc.integer({ min: 0, max: 97 }), fc.integer({ min: 0, max: 97 })), { minLength: 1, maxLength: 20 }),
      (pairs) => {
        const a = pairs.map((p) => p[0]), b = pairs.map((p) => p[1]);
        const x = wilcoxonSignedRank(a, b), y = wilcoxonSignedRank(b, a);
        expect(x.p).toBeCloseTo(y.p, 12);
        expect(x.p).toBeGreaterThan(0);
        expect(x.p).toBeLessThanOrEqual(1);
        expect(x.wPlus).toBeCloseTo(y.wMinus, 9);
      },
    ), { numRuns: 200 });
  });
});

describe('clopperPearson', () => {
  it('uses the exact boundary values for 0 and n successes', () => {
    expect(clopperPearson(0, 20).lo).toBe(0);
    expect(clopperPearson(20, 20).hi).toBe(1);
    expect(clopperPearson(0, 20).hi).toBeCloseTo(1 - 0.025 ** (1 / 20), 9);
    expect(clopperPearson(20, 20).lo).toBeCloseTo(0.025 ** (1 / 20), 9);
  });
  it('matches published values (7 of 20: 0.1539 to 0.5922)', () => {
    const ci = clopperPearson(7, 20);
    expect(ci.lo).toBeCloseTo(0.1539, 3);
    expect(ci.hi).toBeCloseTo(0.5922, 3);
  });
  it('contains k/n, stays inside [0, 1], and widens with confidence', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 60 }), fc.double({ min: 0, max: 1, noNaN: true }), (n, f) => {
      const k = Math.min(n, Math.floor(f * (n + 1)));
      const a = clopperPearson(k, n, 0.9), b = clopperPearson(k, n, 0.99);
      expect(a.lo).toBeLessThanOrEqual(k / n + 1e-12);
      expect(a.hi).toBeGreaterThanOrEqual(k / n - 1e-12);
      expect(b.lo).toBeLessThanOrEqual(a.lo + 1e-12);
      expect(b.hi).toBeGreaterThanOrEqual(a.hi - 1e-12);
      expect(a.lo).toBeGreaterThanOrEqual(0);
      expect(a.hi).toBeLessThanOrEqual(1);
    }), { numRuns: 100 });
  });
  it('rejects impossible counts', () => {
    expect(() => clopperPearson(3, 2)).toThrow(RangeError);
  });
});

describe('betaCdf', () => {
  it('is the identity for Beta(1, 1)', () => {
    for (const x of [0.1, 0.5, 0.9]) expect(betaCdf(x, 1, 1)).toBeCloseTo(x, 12);
  });
});

describe('quantile, median and iqr', () => {
  it('interpolates linearly (type 7)', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
    expect(iqr([1, 2, 3, 4, 5])).toBe(2);
  });
});

describe('fisherExact', () => {
  it('gives the registered p-values for 6 against 0, 5 against 0 and 4 against 0 of 6', () => {
    expect(fisherExact(6, 0, 0, 6)).toBeCloseTo(0.002165, 5);
    expect(fisherExact(5, 1, 0, 6)).toBeCloseTo(0.015152, 5);
    expect(fisherExact(4, 2, 0, 6)).toBeCloseTo(0.060606, 5);
  });
  it('gives 1 for identical rows', () => {
    expect(fisherExact(3, 3, 3, 3)).toBeCloseTo(1, 9);
  });
});
