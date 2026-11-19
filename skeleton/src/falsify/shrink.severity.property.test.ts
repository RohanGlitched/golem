import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbFailing, arbShrinkLimits, makeSynthetic, shrinkCase } from './testing.js';
import { isSeverityDimension, severityOf } from './shrink.js';

describe('shrinker severity', () => {
  // Feature: golem-falsify, Property 11: Shrinker never increases severity
  it('no severity dimension is more severe in the output than in the input', async () => {
    await fc.assert(
      fc.asyncProperty(arbFailing, arbShrinkLimits, async (c, limits) => {
        const out = await shrinkCase(c, limits);
        for (const d of c.space.dims.filter(isSeverityDimension)) {
          expect(severityOf(d, out.scenario[d.name] as number)).toBeLessThanOrEqual(severityOf(d, c.scenario[d.name] as number));
          expect(severityOf(d, out.scenario[d.name] as number)).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 200 },
    );
  });
});