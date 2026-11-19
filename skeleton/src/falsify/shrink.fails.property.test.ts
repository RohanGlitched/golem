import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbFailing, arbShrinkLimits, makeSynthetic, shrinkCase } from './testing.js';
import { isSeverityDimension, severityOf } from './shrink.js';

describe('shrinker output', () => {
  // Feature: golem-falsify, Property 10: Shrinker output still fails
  it('shrunk scenario still fails under the original seed', async () => {
    await fc.assert(
      fc.asyncProperty(arbFailing, arbShrinkLimits, async (c, limits) => {
        const out = await shrinkCase(c, limits);
        expect(makeSynthetic(c.spec)(out.scenario, c.seed)).toBeLessThan(0);
        expect(out.robustness).toBe(makeSynthetic(c.spec)(out.scenario, c.seed));
      }),
      { numRuns: 200 },
    );
  });
});