// Feature: candy-app, Property 25: Predicate margins are sound
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dropEveryCandy, keepClear, keepSlow, noDrop, noPress } from '../predicates';

const val = fc.double({ min: 0, max: 5, noNaN: true });
const count = fc.integer({ min: 0, max: 6 });

describe('predicate margins', () => {
  it('equal their formulas, are positive iff the predicate holds, and are repeatable', () => {
    fc.assert(fc.property(val, val, (signal, threshold) => {
      const a = keepClear.margin({ min_link_hand_distance: signal }, { length: threshold });
      expect(a).toBe(signal - threshold);
      expect(a > 0).toBe(signal > threshold);
      expect(keepClear.margin({ min_link_hand_distance: signal }, { length: threshold })).toBe(a);
      const b = keepSlow.margin({ fastest_link_speed: signal }, { speed: threshold });
      expect(b).toBe(threshold - signal);
      expect(b > 0).toBe(signal < threshold);
      const c = noPress.margin({ table_force: signal }, { force: threshold });
      expect(c).toBe(threshold - signal);
      expect(c > 0).toBe(signal < threshold);
    }), { numRuns: 500 });
  });

  it('flips the sign when the threshold crosses the signal', () => {
    fc.assert(fc.property(fc.double({ min: 0.01, max: 5, noNaN: true }), fc.double({ min: 0.001, max: 0.5, noNaN: true }), (signal, eps) => {
      expect(keepClear.margin({ min_link_hand_distance: signal }, { length: signal - eps })).toBeGreaterThan(0);
      expect(keepClear.margin({ min_link_hand_distance: signal }, { length: signal + eps })).toBeLessThan(0);
      expect(keepSlow.margin({ fastest_link_speed: signal }, { speed: signal + eps })).toBeGreaterThan(0);
      expect(keepSlow.margin({ fastest_link_speed: signal }, { speed: signal - eps })).toBeLessThan(0);
      expect(noPress.margin({ table_force: signal }, { force: signal + eps })).toBeGreaterThan(0);
      expect(noPress.margin({ table_force: signal }, { force: signal - eps })).toBeLessThan(0);
    }), { numRuns: 300 });
  });

  it('gives 0.5 - count for the dropped-candy line, positive only for a count of 0', () => {
    fc.assert(fc.property(count, (n) => {
      const m = noDrop.margin({ candies_dropped_outside: n }, {});
      expect(m).toBe(0.5 - n);
      expect(m > 0).toBe(n === 0);
    }), { numRuns: 100 });
  });

  it('gives +1 for the sorting line when every candy is sorted and -(active - sorted) otherwise', () => {
    fc.assert(fc.property(count, count, count, count, (active, sorted, mis, dropped) => {
      fc.pre(sorted <= active && mis + dropped <= active - sorted);
      const m = dropEveryCandy.margin({ candies_sorted: sorted, candies_misplaced: mis, candies_dropped_outside: dropped, candies_active: active }, {});
      const n = active - sorted;
      expect(m).toBe(n === 0 ? 1 : -n);
      expect(m > 0).toBe(n === 0);
    }), { numRuns: 300 });
  });
});
