import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { foundCount, needle, NEEDLE_011 } from './needle.testkit.js';

// Search effectiveness (golem-falsify-hardening item A and the defect 2 regression).
// A statistical property: fast-check draws the base of a set of RUNS search seeds; the fast-check seed
// is fixed and logged so CI is deterministic. The flat-needle tolerance (8% of the runs) is about two
// standard deviations of the paired difference between full and random-only on the flat needle.
const FC_SEED = 20261119;
const RUNS = 100;
const seedsFrom = (base: number): number[] => Array.from({ length: RUNS }, (_, i) => (base + i * 7919) >>> 0);
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
        const seeds = seedsFrom(base);
        const random = await foundCount(flat, seeds, 1000, 'random-only');
        const full = await foundCount(flat, seeds, 1000, 'full');
        console.log(`flat 0.11% needle, 1000 trials, base ${base}: full ${full}/${RUNS}, random-only ${random}/${RUNS}`);
        expect(full).toBeGreaterThanOrEqual(random - 0.08 * RUNS);
      }),
      { numRuns: 2, seed: FC_SEED },
    );
  }, 60000);
});
