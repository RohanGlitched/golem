import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { selectElites, type Observed } from './cem.js';

describe('elite selection properties', () => {
  // Feature: golem-falsify, Property 6: Elite selection is a total order with lower-index tie-break
  it('selects the first ceil(rho * m) by (robustness, index) regardless of list order', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -3, max: 3 }), { minLength: 1, maxLength: 40 }),
        fc.double({ min: 0.01, max: 0.99, noNaN: true }),
        fc.integer({ min: 0, max: 1000 }),
        (rs, rho, shuffleSeed) => {
          const obs: Observed[] = rs.map((r, i) => ({ scenario: {}, robustness: r, index: i }));
          const expected = [...obs]
            .sort((a, b) => a.robustness - b.robustness || a.index - b.index)
            .slice(0, Math.ceil(rho * obs.length))
            .map((o) => o.index);
          expect(selectElites(obs, rho).map((o) => o.index)).toEqual(expected);
          const shuffled = [...obs].sort((a, b) => ((a.index * 7919 + shuffleSeed) % 31) - ((b.index * 7919 + shuffleSeed) % 31));
          expect(selectElites(shuffled, rho).map((o) => o.index)).toEqual(expected);
          // among equal robustness inside the elite set the lower index comes first
          const sel = selectElites(obs, rho);
          for (let i = 1; i < sel.length; i++) {
            const a = sel[i - 1] as Observed; const b = sel[i] as Observed;
            if (a.robustness === b.robustness) expect(a.index).toBeLessThan(b.index);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
