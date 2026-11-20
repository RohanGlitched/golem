import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { drawTruncatedNormal, normalCdf, normalQuantile } from './normal.js';

describe('normal properties', () => {
  // Feature: golem-falsify, Property 9: Normal CDF and quantile are consistent, truncated draws are monotone in u
  it('cdf(quantile(p)) equals p and truncated draws are monotone and bounded', () => {
    fc.assert(
      fc.property(fc.double({ min: 1e-12, max: 1 - 1e-12, noNaN: true }), (p) => {
        const back = normalCdf(normalQuantile(p));
        expect(Math.abs(back - p) / p).toBeLessThan(1e-12);
      }),
      { numRuns: 500 },
    );
    fc.assert(
      fc.property(
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.double({ min: 0.01, max: 20, noNaN: true }),
        fc.double({ min: -30, max: 30, noNaN: true }),
        fc.double({ min: 0.001, max: 40, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }),
        fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }),
        (mu, sigma, lo, width, u1, u2) => {
          const hi = lo + width;
          const [a, b] = u1 <= u2 ? [u1, u2] : [u2, u1];
          const xa = drawTruncatedNormal(mu, sigma, lo, hi, a);
          const xb = drawTruncatedNormal(mu, sigma, lo, hi, b);
          expect(xa).toBeGreaterThanOrEqual(lo);
          expect(xb).toBeLessThanOrEqual(hi);
          expect(xb).toBeGreaterThanOrEqual(xa);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('drawTruncatedNormal at the edge of the mass', () => {
  // The CI counterexample (seed 42908426): an upper bound 8 sigma out, u just below 1. The quantile rounds to +Infinity,
  // which must give the upper bound, not mu.
  it('stays monotone when the quantile overflows', () => {
    const xa = drawTruncatedNormal(0, 0.01, 0, 0.08292361075813597, 1.1102230246251568e-16);
    const xb = drawTruncatedNormal(0, 0.01, 0, 0.08292361075813597, 0.9999999999999999);
    expect(xb).toBeGreaterThanOrEqual(xa);
    expect(xb).toBeLessThanOrEqual(0.08292361075813597);
  });
});
