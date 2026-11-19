import { describe, expect, it } from 'vitest';
import { blendCircular, drawWrappedNormal, fitCircular, wrapInto } from './cem.js';

const deg = (d: number) => (d * Math.PI) / 180;

describe('circular helpers', () => {
  it('fits elites at 358 and 2 degrees to a mean near 0 degrees, not 180', () => {
    const { dist, R } = fitCircular([deg(358), deg(2)], 0, 2 * Math.PI);
    expect(dist.kind).toBe('wrapped');
    if (dist.kind !== 'wrapped') return;
    const d = Math.min(dist.mu, 2 * Math.PI - dist.mu);
    expect(d).toBeLessThan(deg(1));
    expect(R).toBeGreaterThan(0.99);
  });
  it('maps r === width to min', () => {
    expect(wrapInto(2 * Math.PI, 0, 2 * Math.PI)).toBe(0);
    expect(wrapInto(-1e-18, 0, 2 * Math.PI)).toBeLessThan(2 * Math.PI);
    expect(wrapInto(5, 1, 5)).toBe(1);
  });
  it('gives uniformCircle when the elites cancel (R < 1e-3)', () => {
    const { dist } = fitCircular([0, Math.PI], 0, 2 * Math.PI);
    expect(dist.kind).toBe('uniformCircle');
  });
  it('floors sigma at 1% of width for identical elites', () => {
    const { dist } = fitCircular([1, 1, 1], 0, 10);
    expect(dist.kind === 'wrapped' && dist.sigma).toBeCloseTo(0.1, 12);
  });
  it('draws a wrapped value in [min, max) even for u = 0 and u near 1', () => {
    for (const u of [0, 0.5, 1 - 2 ** -53]) {
      const x = drawWrappedNormal(0, 3, 0, 1, u);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
  it('blends along the shortest arc across the seam', () => {
    const w = 360;
    const m = blendCircular(350, 10, 0.5, 0, w);
    expect(Math.min(m, w - m)).toBeLessThan(1e-9);
    expect(blendCircular(30, 50, 1, 0, w)).toBeCloseTo(50, 9);
    expect(blendCircular(30, 50, 0, 0, w)).toBeCloseTo(30, 9);
  });
});
