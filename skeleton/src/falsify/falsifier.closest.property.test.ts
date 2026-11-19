import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { falsify } from './falsifier.js';
import { arbRunCase, loggingPool, optionsOf } from './falsifier.testkit.js';

describe('falsifier closest', () => {
  // Feature: golem-falsify, Property 18: Closest is the earliest minimum
  it('is the minimum robustness over all completed trials, earliest on ties', async () => {
    await fc.assert(
      fc.asyncProperty(arbRunCase, async (c) => {
        const { pool, log } = loggingPool(c.synth);
        const r = await falsify({ id: 'R1', space: c.space }, pool, optionsOf(c));
        fc.pre(log.length > 0);
        const min = Math.min(...log.map((t) => t.robustness));
        const first = log.find((t) => t.robustness === min)!;
        expect(r.verdict.closest.robustness).toBe(min);
        expect(r.verdict.closest.seed).toBe(first.spec.seed);
        expect(r.verdict.closest.scenario).toEqual(first.spec.scenario);
      }),
      { numRuns: 200 },
    );
  });
});