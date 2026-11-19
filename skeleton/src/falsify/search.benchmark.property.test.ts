import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { foundCount, needle, NEEDLE_011 } from './needle.testkit.js';

// Search effectiveness (golem-falsify-hardening item A and the defect 2 regression).
// A statistical property: fast-check draws the base of a set of search seeds; the fast-check seed is fixed
// and logged so CI is deterministic. On the flat needle full and random-only share only the Phase 1 prefix,
// so the paired difference of found counts has a standard deviation of about 0.6 * sqrt(runs); with 400
// runs the tolerance (8% of the runs = 32) is about 2.6 standard deviations. 3000-seed check: random-only
// 67.7%, full 67.5% (docs/reviews/falsify-hardening.md).
const FC_SEED = 20261119;
const RUNS = 100;
const FLAT_RUNS = 400;
const seedsFrom = (base: number, n = RUNS): number[] => Array.from({ length: n }, (_, i) => (base + i * 7919) >>> 0);
const { lo, hi, forceMin } = NEEDLE_011;

describe('search effectiveness on needle benchmarks', () => {
  it('finds the graded 0.11% needle at 400 trials in at least as many runs as random-only', async () => {
    const graded = needle(lo, hi, forceMin, false);
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 2 ** 31 }), async (base) => {
        const seeds = seedsFrom(base);
        const random = await foundCount(graded, seeds, 400, 'random-only');
        const full = await foundCount(graded, seeds, 400, 'full');
        console.log(`graded 0.11% needle, 400 trials, base ${base}: full ${full}/${RUNS}, random-only ${random}/${RUNS}`);
        expect(full).toBeGreaterThanOrEqual(random);
      }),
      { numRuns: 2, seed: FC_SEED },
    );
  }, 60000);

  it('never does worse than random-only by more than 8% of the runs on the flat 0.11% needle at 1000 trials', async () => {
    const flat = needle(lo, hi, forceMin, true);
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 2 ** 31 }), async (base) => {
        const seeds = seedsFrom(base, FLAT_RUNS);
        const random = await foundCount(flat, seeds, 1000, 'random-only');
        const full = await foundCount(flat, seeds, 1000, 'full');
        console.log(`flat 0.11% needle, 1000 trials, base ${base}: full ${full}/${FLAT_RUNS}, random-only ${random}/${FLAT_RUNS}`);
        expect(full).toBeGreaterThanOrEqual(random - 0.08 * FLAT_RUNS);
      }),
      { numRuns: 2, seed: FC_SEED },
    );
  }, 60000);
});
