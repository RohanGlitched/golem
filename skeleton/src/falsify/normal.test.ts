import { describe, expect, it } from 'vitest';
import { drawTruncatedNormal, erfc, normalCdf, normalQuantile } from './normal.js';

describe('normal helpers', () => {
  it('normalCdf(0) is exactly 0.5', () => {
    expect(normalCdf(0)).toBe(0.5);
  });
  it('matches reference CDF values', () => {
    expect(normalCdf(-1)).toBeCloseTo(0.15865525393145707, 14);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021048517795, 14);
    expect(erfc(0.5)).toBeCloseTo(0.4795001221869535, 14);
    expect(erfc(3)).toBeCloseTo(2.209049699858544e-5, 18);
  });
  it('keeps relative precision in the lower tail near 1e-12', () => {
    const v = normalCdf(-7);
    expect(Math.abs(v - 1.279812543885835e-12) / 1.279812543885835e-12).toBeLessThan(1e-9);
  });
  it('quantile at 0.975 is 1.959963984540054', () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959963984540054, 12);
    expect(normalQuantile(0.5)).toBeCloseTo(0, 15);
  });
  it('quantile handles 0, 1 and out of range', () => {
    expect(normalQuantile(0)).toBe(-Infinity);
    expect(normalQuantile(1)).toBe(Infinity);
    expect(normalQuantile(1.5)).toBeNaN();
  });
  it('quantile inverts the CDF in the far tail', () => {
    const z = normalQuantile(1e-12);
    expect(Math.abs(normalCdf(z) - 1e-12) / 1e-12).toBeLessThan(1e-9);
  });
  it('truncated draw stays inside the interval and is the mode when the mean is 8 sigma outside', () => {
    for (const u of [0, 0.3, 0.999999]) {
      const x = drawTruncatedNormal(0, 1, 2, 3, u);
      expect(x).toBeGreaterThanOrEqual(2);
      expect(x).toBeLessThanOrEqual(3);
    }
    expect(drawTruncatedNormal(-8, 1, 0, 1, 0.7)).toBe(0);
    expect(drawTruncatedNormal(9, 1, 0, 1, 0.7)).toBe(1);
  });
  it('truncated draw at u=0 and u near 1 reaches the interval ends for a wide sigma', () => {
    expect(drawTruncatedNormal(0.5, 100, 0, 1, 0)).toBeCloseTo(0, 6);
    expect(drawTruncatedNormal(0.5, 100, 0, 1, 1 - 1e-12)).toBeCloseTo(1, 6);
  });
});
