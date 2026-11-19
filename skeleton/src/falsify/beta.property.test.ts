import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { failureRateUpper95 } from './beta.js';

describe('failure-rate bound properties', () => {
  // Feature: golem-falsify, Property 21: Failure-rate bound is valid
  it('is at least k/n and at most 1, and is min(1, 3/n) for k = 0', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10000 }).chain((n) => fc.tuple(fc.constant(n), fc.integer({ min: 1, max: n }))), ([n, k]) => {
        const b = failureRateUpper95(n, k) as number;
        expect(b).toBeGreaterThanOrEqual(k / n);
        expect(b).toBeLessThanOrEqual(1);
      }),
      { numRuns: 200 },
    );
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10000 }), (n) => {
        expect(failureRateUpper95(n, 0)).toBe(Math.min(1, 3 / n));
      }),
      { numRuns: 200 },
    );
  });

  // Feature: golem-falsify, Property 22: Failure-rate bound is monotone and matches closed forms
  it('is monotone in k and n and matches closed forms', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5000 }),
        fc.nat(5000), fc.nat(5000),
        (n, a, b) => {
          const k1 = Math.min(a % (n + 1), b % (n + 1));
          const k2 = Math.max(a % (n + 1), b % (n + 1));
          // Requirements 2.6/2.7 conflict for n = 2 and n = 3: the rule of three (3/n, k = 0) exceeds the exact bound for k = 1.\n          // The test documents that exception in beta.test.ts and checks the property everywhere else.\n          fc.pre(!(k1 === 0 && k2 > 0 && n <= 3));\n          expect(failureRateUpper95(n, k2) as number).toBeGreaterThanOrEqual(failureRateUpper95(n, k1) as number);
        },
      ),
      { numRuns: 200 },
    );
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), fc.integer({ min: 1, max: 3000 }), fc.integer({ min: 1, max: 3000 }), (k, d1, d2) => {
        const n1 = k + Math.min(d1, d2);
        const n2 = k + Math.max(d1, d2);
        expect(failureRateUpper95(n2, k) as number).toBeLessThanOrEqual(failureRateUpper95(n1, k) as number);
      }),
      { numRuns: 200 },
    );
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 10000 }), (n) => {
        expect(Math.abs((failureRateUpper95(n, n - 1) as number) - 0.95 ** (1 / n))).toBeLessThan(1e-6);
        expect(failureRateUpper95(n, n)).toBe(1);
        expect(1 - 0.05 ** (1 / n)).toBeLessThanOrEqual(3 / n);
      }),
      { numRuns: 200 },
    );
  });
});
