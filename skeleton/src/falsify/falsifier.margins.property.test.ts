import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { falsify } from './falsifier.js';
import { loggingPool } from './falsifier.testkit.js';

describe('falsifier margins', () => {
  // Feature: golem-falsify, Property 20: Soundness and monotonicity of margins
  it('reports broken exactly when signal - threshold is negative, and raising the threshold never helps', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.double({ min: 0, max: 20, noNaN: true }),
        async (signal, threshold, raise) => {
          const space = { dims: [{ name: 'signal', kind: 'length' as const, min: signal, max: signal, severity: 'none' as const }] };
          const run = async (th: number) => {
            const { pool } = loggingPool({ kind: 'halfspace', dim: 'signal', threshold: th, failAbove: false });
            return falsify({ id: 'R1', space }, pool, { appId: 'a', budget: { maxTrials: 10 }, searchSeed: 1 });
          };
          const a = await run(threshold);
          const b = await run(threshold + raise);
          expect(a.verdict.status).toBe(signal - threshold < 0 ? 'broken' : 'held');
          expect(b.verdict.status).toBe(signal - (threshold + raise) < 0 ? 'broken' : 'held');
          expect(a.verdict.closest.robustness).toBe(signal - threshold);
          expect(b.verdict.closest.robustness).toBeLessThanOrEqual(a.verdict.closest.robustness);
          if (a.verdict.status === 'broken') expect(b.verdict.status).toBe('broken');
        },
      ),
      { numRuns: 200 },
    );
  });
});