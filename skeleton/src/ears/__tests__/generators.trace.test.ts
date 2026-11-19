import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbTrace } from './generators.trace';
import { propConfig } from './support';

describe('arbTrace', () => {
  it('produces strictly increasing t with 1 to 1000 samples', () => {
    fc.assert(
      fc.property(arbTrace(), (tr) => {
        expect(tr.t.length).toBeGreaterThanOrEqual(1);
        expect(tr.t.length).toBeLessThanOrEqual(1000);
        for (let i = 1; i < tr.t.length; i++) expect(tr.t[i]!).toBeGreaterThan(tr.t[i - 1]!);
      }),
      propConfig,
    );
  });

  it('produces signals with the same length as t', () => {
    fc.assert(
      fc.property(arbTrace({ signals: ['a', 'b'] }), (tr) => {
        expect(Object.keys(tr.signals)).toEqual(['a', 'b']);
        for (const arr of Object.values(tr.signals)) expect(arr.length).toBe(tr.t.length);
      }),
      propConfig,
    );
  });

  it('places events within the time range of the samples', () => {
    fc.assert(
      fc.property(arbTrace(), (tr) => {
        for (const e of tr.events) {
          expect(e.t).toBeGreaterThanOrEqual(tr.t[0]!);
          expect(e.t).toBeLessThanOrEqual(tr.t[tr.t.length - 1]!);
        }
      }),
      propConfig,
    );
  });

  it('repeats signal values so ties occur in long traces', () => {
    const [tr] = fc.sample(arbTrace({ minSamples: 200, maxSamples: 200 }), { numRuns: 1, seed: 1 });
    expect(new Set(tr!.signals.z!).size).toBeLessThan(tr!.t.length);
  });
});
