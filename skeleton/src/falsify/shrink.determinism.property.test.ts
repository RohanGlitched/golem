import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbFailing, arbShrinkLimits, makeSynthetic, shrinkCase } from './testing.js';
import { isSeverityDimension, severityOf } from './shrink.js';

describe('shrinker determinism', () => {
  // Feature: golem-falsify, Property 14: Shrinker determinism
  it('two runs return the same scenario and the same trial log', async () => {
    await fc.assert(
      fc.asyncProperty(arbFailing, arbShrinkLimits, async (c, limits) => {
        const a = await shrinkCase(c, limits);
        const b = await shrinkCase(c, limits);
        expect(b).toEqual(a);
      }),
      { numRuns: 200 },
    );
  });
});