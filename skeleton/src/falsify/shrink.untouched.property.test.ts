import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbFailing, arbShrinkLimits, makeSynthetic, shrinkCase } from './testing.js';
import { isSeverityDimension, severityOf } from './shrink.js';

describe('shrinker untouched dimensions', () => {
  // Feature: golem-falsify, Property 12: Shrinker leaves none and fixed dimensions
  it('keeps severity none and fixed dimensions at their input values, in every candidate trial too', async () => {
    await fc.assert(
      fc.asyncProperty(arbFailing, arbShrinkLimits, async (c, limits) => {
        const seen: Record<string, number>[] = [];
        const out = await shrinkCase(c, limits, seen);
        for (const d of c.space.dims.filter((x) => !isSeverityDimension(x))) {
          expect(out.scenario[d.name]).toBe(c.scenario[d.name]);
          for (const s of seen) expect(s[d.name]).toBe(c.scenario[d.name]);
        }
      }),
      { numRuns: 200 },
    );
  });
});