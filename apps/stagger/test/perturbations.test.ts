import { describe, expect, it } from 'vitest';
import { gaitPhase } from '../controller/observation';
import { pushForce, pushStartOffset, slopeGravity, validateRatio } from '../perturbations';

describe('perturbation helpers', () => {
  const h = Float64Array.from([0.6, 0.8]);

  it('pushes along the Heading at 0 deg', () => {
    const out = new Float64Array(3);
    pushForce(2.1, 2, 0.2, 100, h, 0, out);
    expect(out[0]).toBeCloseTo(60, 12);
    expect(out[1]).toBeCloseTo(80, 12);
    expect(out[2]).toBe(0);
  });

  it('pushes against the Heading at 180 deg', () => {
    const out = new Float64Array(3);
    pushForce(2.1, 2, 0.2, 100, h, Math.PI, out);
    expect(out[0]).toBeCloseTo(-60, 12);
    expect(out[1]).toBeCloseTo(-80, 12);
  });

  it('applies no force outside the push window', () => {
    const out = Float64Array.from([1, 1, 1]);
    pushForce(1.999, 2, 0.2, 100, h, 0, out);
    expect(Array.from(out)).toEqual([0, 0, 0]);
    out.fill(1);
    pushForce(2.2, 2, 0.2, 100, h, 0, out);
    expect(Array.from(out)).toEqual([0, 0, 0]);
  });

  it('starts the push when the gait phase reaches the requested phase', () => {
    const off = pushStartOffset(0.25, gaitPhase(2));
    expect(off).toBeGreaterThanOrEqual(0);
    expect(off).toBeLessThan(0.8);
    expect(gaitPhase(2 + off)).toBeCloseTo(0.25, 9);
  });

  it('leaves gravity unchanged on a 0 deg slope', () => {
    const out = new Float64Array(3);
    slopeGravity([0, 0, -9.81], 0, out);
    expect(Array.from(out)).toEqual([0, 0, -9.81]);
  });

  it('tilts gravity about the y axis on a 10 deg slope', () => {
    const out = new Float64Array(3);
    const a = (10 * Math.PI) / 180;
    slopeGravity([0, 0, -9.81], a, out);
    expect(out[0]).toBeCloseTo(-9.81 * Math.sin(a), 12);
    expect(out[1]).toBe(0);
    expect(out[2]).toBeCloseTo(-9.81 * Math.cos(a), 12);
  });

  it('rejects a ratio above 100%', () => {
    expect(() => validateRatio(1.3)).toThrow('ratio 130% is outside 0% to 100%');
  });

  it('rejects a ratio below 0%', () => {
    expect(() => validateRatio(-0.1)).toThrow('ratio -10% is outside 0% to 100%');
  });

  it('accepts ratios from 0% to 100%', () => {
    expect(() => { validateRatio(0); validateRatio(0.3); validateRatio(1); }).not.toThrow();
  });
});
