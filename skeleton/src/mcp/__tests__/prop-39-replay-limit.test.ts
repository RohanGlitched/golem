import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { summariseTrace } from '../margins.js';
import { propConfig } from '../../../test/support/prop.js';

describe('Property 39: replay summary respects the sample limit', () => {
  // Feature: golem-kit, Property 39: Replay summary respects the sample limit
  it('has at most 200 samples at 0.1 s spacing, the earliest kept, and truncated exactly when samples were dropped', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 5000 }), fc.constantFrom(10, 20, 50, 100), fc.double({ min: 0, max: 5, noNaN: true }), (n, hz, t0) => {
      const dt = 1 / hz;
      const t = Float64Array.from({ length: n }, (_, i) => t0 + i * dt);
      const v = Float64Array.from({ length: n }, (_, i) => i);
      const s = summariseTrace({ t, signals: { x: v }, events: [] });
      const stride = Math.round(0.1 * hz);
      const wanted = Math.ceil(n / stride);
      expect(s.samples.length).toBe(Math.min(200, wanted));
      expect(s.truncated).toBe(wanted > 200);
      expect(s.intervalS).toBe(0.1);
      s.samples.forEach((row, k) => {
        expect(row['x']).toBe(k * stride);
        if (k > 0) expect(row.t - (s.samples[k - 1] as { t: number }).t).toBeCloseTo(0.1, 6);
      });
    }), propConfig);
  });
});
