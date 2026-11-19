import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { falsify } from './falsifier.js';
import { arbPinnedRows, arbRunCase, loggingPool, optionsOf, pinnedEntries, seedDbOf } from './falsifier.testkit.js';

import { failureRateUpper95 } from './beta.js';

describe('falsifier failure rate', () => {
  // Feature: golem-falsify, Property 23: Failure rate uses Phase 1 only
  it('is a function of the Phase 1 counts only, whatever Phase 0, 2 and 3 did', async () => {
    await fc.assert(
      fc.asyncProperty(arbRunCase, arbPinnedRows, async (c, rows) => {
        const { pool, log } = loggingPool(c.synth);
        const r = await falsify({ id: 'R1', space: c.space }, pool, optionsOf(c, { seedDb: seedDbOf(pinnedEntries(c.space, rows)).db }));
        const n1 = r.meta.phaseTrials.p1;
        const phase1 = log.slice(r.meta.phaseTrials.p0, r.meta.phaseTrials.p0 + n1);
        const k1 = phase1.filter((t) => t.robustness < 0).length;
        expect(r.verdict.failureRateUpper95).toEqual(failureRateUpper95(n1, k1));
        if (n1 === 0) expect(r.verdict.failureRateUpper95).toBeUndefined();
      }),
      { numRuns: 200 },
    );
  });
});