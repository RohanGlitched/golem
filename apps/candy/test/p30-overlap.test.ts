// Feature: candy-app, Property 30: Candy placement and the overlap rule are deterministic
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CANDY_SPAWN, D_OV, TRAY } from '../constants';
import { resolveOverlaps } from '../geometry';

const spawn = fc.array(
  fc.tuple(fc.double({ min: CANDY_SPAWN.xMin, max: CANDY_SPAWN.xMax, noNaN: true }), fc.double({ min: CANDY_SPAWN.yMin, max: CANDY_SPAWN.yMax, noNaN: true })),
  { minLength: 6, maxLength: 6 },
).map((p) => Float64Array.from(p.flat()));

describe('overlap rule', () => {
  it('is deterministic, leaves every pair 0.036 m apart, moves x upward in 0.01 m steps only, and keeps candies in the tray', () => {
    fc.assert(fc.property(spawn, (xy) => {
      const before = Float64Array.from(xy);
      const a = Float64Array.from(xy), b = Float64Array.from(xy);
      resolveOverlaps(a); resolveOverlaps(b);
      expect(Array.from(a).map((v, k) => Object.is(v, b[k]))).toEqual(Array.from({ length: 12 }, () => true));
      for (let i = 0; i < 6; i++) {
        expect(a[2 * i + 1]).toBe(before[2 * i + 1]);                       // y never changes
        const steps = (a[2 * i]! - before[2 * i]!) / 0.01;
        expect(steps).toBeGreaterThanOrEqual(-1e-9);
        expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);       // whole 0.01 m steps
        expect(a[2 * i]).toBeLessThanOrEqual(TRAY.xMax);
        expect(a[2 * i]).toBeGreaterThanOrEqual(TRAY.xMin);
        for (let j = 0; j < i; j++) {
          expect(Math.hypot(a[2 * i]! - a[2 * j]!, a[2 * i + 1]! - a[2 * j + 1]!)).toBeGreaterThanOrEqual(D_OV - 1e-12);
        }
      }
    }), { numRuns: 500 });
  });

  it('shifts a candy only because of earlier candies: changing a later candy does not move an earlier one', () => {
    fc.assert(fc.property(spawn, fc.integer({ min: 1, max: 5 }), fc.double({ min: CANDY_SPAWN.xMin, max: CANDY_SPAWN.xMax, noNaN: true }), (xy, k, nx) => {
      const a = Float64Array.from(xy), b = Float64Array.from(xy);
      b[2 * k] = nx;
      resolveOverlaps(a); resolveOverlaps(b);
      for (let i = 0; i < k; i++) { expect(a[2 * i]).toBe(b[2 * i]); expect(a[2 * i + 1]).toBe(b[2 * i + 1]); }
    }), { numRuns: 300 });
  });
});
