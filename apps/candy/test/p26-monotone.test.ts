// Feature: candy-app, Property 26: Margins are monotone in the threshold
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { keepClear, keepSlow, noPress } from '../predicates';

const val = fc.double({ min: 0, max: 10, noNaN: true });

describe('margin monotonicity', () => {
  it('never rises when the threshold of a lower bound rises, and never falls when the threshold of an upper bound rises', () => {
    fc.assert(fc.property(val, val, val, (signal, x, y) => {
      const [a, b] = x <= y ? [x, y] : [y, x];
      // keep every link at least {length}: raising the length demands more
      expect(keepClear.margin({ min_link_hand_distance: signal }, { length: b })).toBeLessThanOrEqual(keepClear.margin({ min_link_hand_distance: signal }, { length: a }));
      // keep its fastest link below {speed}: raising the speed limit allows more
      expect(keepSlow.margin({ fastest_link_speed: signal }, { speed: b })).toBeGreaterThanOrEqual(keepSlow.margin({ fastest_link_speed: signal }, { speed: a }));
      // never press with more than {force}: likewise
      expect(noPress.margin({ table_force: signal }, { force: b })).toBeGreaterThanOrEqual(noPress.margin({ table_force: signal }, { force: a }));
    }), { numRuns: 500 });
  });

  it('never falls when the bounded signal falls for an upper bound, and never rises for a lower bound', () => {
    fc.assert(fc.property(val, val, val, (threshold, x, y) => {
      const [lo, hi] = x <= y ? [x, y] : [y, x];
      expect(keepSlow.margin({ fastest_link_speed: hi }, { speed: threshold })).toBeLessThanOrEqual(keepSlow.margin({ fastest_link_speed: lo }, { speed: threshold }));
      expect(noPress.margin({ table_force: hi }, { force: threshold })).toBeLessThanOrEqual(noPress.margin({ table_force: lo }, { force: threshold }));
      expect(keepClear.margin({ min_link_hand_distance: hi }, { length: threshold })).toBeGreaterThanOrEqual(keepClear.margin({ min_link_hand_distance: lo }, { length: threshold }));
    }), { numRuns: 500 });
  });
});
