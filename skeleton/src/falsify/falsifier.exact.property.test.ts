import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { clopperPearsonUpper, failureRateUpper95 } from './beta.js';
import { falsify } from './falsifier.js';
import { arbRunCase, loggingPool, optionsOf } from './falsifier.testkit.js';

describe('exact Clopper-Pearson bound on the verdict (golem-falsify-hardening item C)', () => {
  it('reports the exact bound for the Phase 1 counts beside the rule of three, and only when that is set', async () => {
    await fc.assert(
      fc.asyncProperty(arbRunCase, async (c) => {
        const { pool } = loggingPool(c.synth);
        let n = 0;
        let k = 0;
        const r = await falsify({ id: 'R1', space: c.space }, pool, optionsOf(c, {
          onResult: (res, info) => { if (info.phase === 1 && !Number.isNaN(res.robustness)) { n++; if (res.robustness < 0) k++; } },
        }));
        expect(r.verdict.failureRateUpper95).toBe(failureRateUpper95(n, k));
        if (n === 0) {
          expect(r.verdict.failureRateUpper95Exact).toBeUndefined();
          return;
        }
        const exact = r.verdict.failureRateUpper95Exact as number;
        expect(exact).toBe(clopperPearsonUpper(n, k, 0.95));
        if (k === 0) {
          expect(exact).toBeCloseTo(1 - 0.05 ** (1 / n), 12);
          expect(exact).toBeLessThanOrEqual(r.verdict.failureRateUpper95 as number);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('gives 1 - 0.05^(1/20) next to 3/20 for 20 passing random trials', async () => {
    const { pool } = loggingPool({ kind: 'const', value: 1 });
    const r = await falsify({ id: 'R1', space: { dims: [{ name: 'x', kind: 'force', min: 0, max: 1, severity: 'up' }] } }, pool, {
      appId: 'a', budget: { maxTrials: 50 }, searchSeed: 1,
    });
    expect(r.verdict.randomTrials).toBe(20);
    expect(r.verdict.failureRateUpper95).toBeCloseTo(0.15, 12);
    expect(r.verdict.failureRateUpper95Exact).toBeCloseTo(0.139108, 6);
  });
});
