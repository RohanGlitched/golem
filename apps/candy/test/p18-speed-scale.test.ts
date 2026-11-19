// Feature: candy-app, Property 18: Speed scale range, boundaries, and monotonicity
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { speedScale } from '../controller/ssm';

describe('speed scale', () => {
  it('is in [0, 1], 1 above 0.40 m, 0 at or below 0.15 m and (d - 0.15) / 0.25 between', () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 5, noNaN: true }), (d) => {
      const s = speedScale(d);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
      if (d >= 0.4) expect(s).toBe(1);
      else if (d <= 0.15) expect(s).toBe(0);
      else expect(s).toBeCloseTo((d - 0.15) / 0.25, 12);
    }), { numRuns: 1000 });
  });
  it('never decreases as the distance grows', () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (a, b) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      expect(speedScale(lo)).toBeLessThanOrEqual(speedScale(hi));
    }), { numRuns: 1000 });
  });
  it('hits the boundary values exactly', () => {
    expect(speedScale(0.15)).toBe(0);
    expect(speedScale(0.4)).toBe(1);
    fc.assert(fc.property(fc.double({ min: 0.4, max: 100, noNaN: true }), (d) => { expect(speedScale(d)).toBe(1); }), { numRuns: 100 });
  });
});
