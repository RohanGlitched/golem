import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbFailing, arbShrinkLimits, makeSynthetic, shrinkCase } from './testing.js';
import { isSeverityDimension, severityOf } from './shrink.js';

describe('shrinker limits', () => {
  // Feature: golem-falsify, Property 13: Shrinker limits, flag and no-op
  it('respects the trial limit, sets shrunk iff the scenario changed, and is a no-op at the milder ends', async () => {
    await fc.assert(
      fc.asyncProperty(arbFailing, arbShrinkLimits, async (c, limits) => {
        const out = await shrinkCase(c, limits);
        expect(out.trials.length).toBeLessThanOrEqual(limits.maxTrials);
        const differs = c.space.dims.some((d) => out.scenario[d.name] !== c.scenario[d.name]);
        expect(out.shrunk).toBe(differs);
        // move every severity dimension to its milder end: nothing left to do
        const mild = { ...c.scenario };
        for (const d of c.space.dims.filter(isSeverityDimension)) {
          mild[d.name] = d.severity === 'down' && d.wrap !== true ? d.max : d.min;
        }
        const noop = await shrinkCase({ ...c, scenario: mild }, limits);
        expect(noop.trials).toHaveLength(0);
        expect(noop.scenario).toEqual(mild);
        expect(noop.shrunk).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});