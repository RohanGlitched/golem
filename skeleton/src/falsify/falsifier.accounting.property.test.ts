import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { falsify } from './falsifier.js';
import { arbRunCase, loggingPool, optionsOf } from './falsifier.testkit.js';

describe('falsifier trial accounting', () => {
  // Feature: golem-falsify, Property 17: Trial accounting
  it('sums the phase counts, respects the limits, and bounds the trials by T + reserve + 6', async () => {
    await fc.assert(
      fc.asyncProperty(arbRunCase, async (c) => {
        const { pool, log } = loggingPool(c.synth);
        const r = await falsify({ id: 'R1', space: c.space }, pool, optionsOf(c));
        const p = r.meta.phaseTrials;
        expect(r.verdict.trials).toBe(p.p0 + p.p1 + p.p2 + p.p3);
        expect(r.verdict.trials).toBe(log.length);
        expect(r.verdict.randomTrials).toBe(p.p1);
        expect(r.verdict.guidedTrials).toBe(p.p2);
        if (c.mode === 'random-only') expect(r.verdict.guidedTrials).toBe(0);
        expect(p.p0 + p.p1 + p.p2).toBeLessThanOrEqual(c.maxTrials);
        expect(r.meta.p3Detail.shrink + r.meta.p3Detail.verification).toBe(p.p3);
        expect(r.meta.p3Detail.shrink).toBeLessThanOrEqual(r.meta.shrinkReserve!);
        // golem-falsify-hardening defect 1: 3 verification seeds at the original failure, 3 more at the
        // shrunk point when it differs, so the bound is T + reserve + 6.
        if (r.meta.verification) {
          expect(r.meta.p3Detail.verification).toBe(r.meta.boundaryVerification ? 6 : 3);
        } else {
          expect(r.meta.p3Detail.verification).toBe(0);
        }
        expect(r.verdict.trials).toBeLessThanOrEqual(c.maxTrials + r.meta.shrinkReserve! + 6);
        if (r.verdict.counterexample) {
          expect(r.verdict.counterexample.foundAfter).toBeGreaterThanOrEqual(1);
          expect(r.verdict.counterexample.foundAfter).toBeLessThanOrEqual(p.p0 + p.p1 + p.p2);
        }
      }),
      { numRuns: 200 },
    );
  });
});