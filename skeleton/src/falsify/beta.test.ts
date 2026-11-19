import { describe, expect, it } from 'vitest';
import { clopperPearsonUpper, failureRateUpper95, lnGamma, regularizedIncBeta } from './beta.js';

/** Independent check: P(X <= k) for X ~ Bin(n, p), by summing log-pmf terms. */
function binomCdf(n: number, k: number, p: number): number {
  let s = 0;
  for (let i = 0; i <= k; i++) {
    const lp = lnGamma(n + 1) - lnGamma(i + 1) - lnGamma(n - i + 1) + i * Math.log(p) + (n - i) * Math.log1p(-p);
    s += Math.exp(lp);
  }
  return s;
}

describe('failure-rate bound', () => {
  it('lnGamma matches factorials', () => {
    expect(Math.exp(lnGamma(5))).toBeCloseTo(24, 10);
    expect(lnGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 12);
  });
  it('regularizedIncBeta matches closed forms', () => {
    expect(regularizedIncBeta(0.3, 1, 1)).toBeCloseTo(0.3, 12);
    expect(regularizedIncBeta(0.5, 2, 2)).toBeCloseTo(0.5, 12);
    expect(regularizedIncBeta(0.4, 3, 1)).toBeCloseTo(0.4 ** 3, 12);
  });
  it('matches published 90% two-sided Clopper-Pearson upper limits within 1e-4', () => {
    expect(failureRateUpper95(10, 1)).toBeCloseTo(0.3942, 4);
    expect(failureRateUpper95(10, 2)).toBeCloseTo(0.5069, 4);
    expect(failureRateUpper95(10, 5)).toBeCloseTo(0.7776, 4);
  });
  it('is the root of the binomial tail within 1e-6 (qbeta(0.95, k+1, n-k) reference)', () => {
    for (const [n, k] of [[1, 0], [10, 1], [50, 3], [200, 20], [1000, 1], [10000, 5], [10000, 9999 - 5000]] as const) {
      if (k === 0) continue;
      const p = failureRateUpper95(n, k) as number;
      expect(binomCdf(n, k, p)).toBeCloseTo(0.05, 6);
    }
  });
  it('handles n = 1, k = n - 1 and k = n', () => {
    expect(failureRateUpper95(1, 0)).toBe(1);
    expect(failureRateUpper95(1, 1)).toBe(1);
    expect(failureRateUpper95(20, 19)).toBeCloseTo(0.95 ** (1 / 20), 6);
    expect(failureRateUpper95(10000, 9999)).toBeCloseTo(0.95 ** (1 / 10000), 6);
  });
  it('uses the rule of three for k = 0 and undefined for n = 0', () => {
    expect(failureRateUpper95(30, 0)).toBeCloseTo(0.1, 12);
    expect(failureRateUpper95(2, 0)).toBe(1);
    expect(failureRateUpper95(0, 0)).toBeUndefined();
  });
  it('documents the small-n exception: 3/n for k = 0 exceeds the exact bound for k = 1 only for n = 2 and n = 3', () => {
    for (const n of [2, 3]) {
      expect(failureRateUpper95(n, 0) as number).toBeGreaterThan(failureRateUpper95(n, 1) as number);
    }
    for (const n of [1, 4, 5, 6, 7, 20, 1000]) {
      expect(failureRateUpper95(n, 0) as number).toBeLessThanOrEqual(failureRateUpper95(n, 1) as number);
    }
  });
  it('clopperPearsonUpper for k = 0 is the exact closed form', () => {
    expect(clopperPearsonUpper(59, 0)).toBeCloseTo(1 - 0.05 ** (1 / 59), 12);
  });
});
