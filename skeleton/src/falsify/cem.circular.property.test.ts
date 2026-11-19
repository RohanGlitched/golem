import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fitCircular, wrapInto } from './cem.js';

const circDist = (a: number, b: number, w: number) => {
  const d = Math.abs(a - b) % w;
  return Math.min(d, w - d);
};

describe('circular fit properties', () => {
  // Feature: golem-falsify, Property 8: Circular fit respects the seam
  it('fit stays inside the arc, rotates with the data, and falls back to uniform when R is tiny', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -10, max: 10, noNaN: true }),
        fc.double({ min: 0.5, max: 100, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }),
        fc.double({ min: 0.01, max: 0.2, noNaN: true }),
        fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 2, maxLength: 12 }),
        fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }),
        (min, width, cFrac, halfFrac, offs, rotFrac) => {
          const max = min + width;
          const center = min + cFrac * width;
          const half = halfFrac * width;
          const values = offs.map((o) => wrapInto(center + o * half, min, max));
          const { dist, R } = fitCircular(values, min, max);
          expect(R).toBeGreaterThan(0);
          expect(R).toBeLessThanOrEqual(1 + 1e-12);
          expect(dist.kind).toBe('wrapped');
          if (dist.kind !== 'wrapped') return;
          expect(dist.mu).toBeGreaterThanOrEqual(min);
          expect(dist.mu).toBeLessThan(max);
          expect(circDist(dist.mu, center, width)).toBeLessThanOrEqual(half * (1 + 1e-9) + 1e-9 * width);
          expect(dist.sigma).toBeGreaterThanOrEqual(0.01 * width * (1 - 1e-12));
          const rot = rotFrac * width;
          const rotated = fitCircular(values.map((v) => wrapInto(v + rot, min, max)), min, max);
          if (rotated.dist.kind === 'wrapped') {
            const expected = wrapInto(dist.mu + rot, min, max);
            expect(circDist(rotated.dist.mu, expected, width)).toBeLessThan(1e-9 * width);
          }
        },
      ),
      { numRuns: 300 },
    );
    fc.assert(
      fc.property(
        fc.double({ min: -5, max: 5, noNaN: true }), fc.double({ min: 1, max: 50, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }),
        (min, width, f) => {
          const a = min + f * width;
          const b = wrapInto(a + width / 2, min, min + width);
          expect(fitCircular([a, b], min, min + width).dist.kind).toBe('uniformCircle');
        },
      ),
      { numRuns: 200 },
    );
  });
});
