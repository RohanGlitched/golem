import { describe, expect, it } from 'vitest';
import { SUCTION } from '../constants';
import { sanitizeRatio, suctionForce, vacuumWarning } from '../controller/suction';
import { gcCount } from './helpers/alloc';

const z3 = () => new Float64Array(3);
const mag = (v: ArrayLike<number>) => Math.hypot(v[0]!, v[1]!, v[2]!);

describe('suctionForce', () => {
  it('uses a default holding force of 3 N', () => {
    expect(SUCTION.holdingForce).toBe(3);
    const out = z3();
    suctionForce(out, [1, 0, 0], z3(), [0, 0, 0], z3(), SUCTION.holdingForce);
    expect(mag(out)).toBeCloseTo(3, 12);
  });
  it('caps at 1.5 N for a vacuum ratio of 0.5', () => {
    const out = z3();
    suctionForce(out, [1, 0, 0], z3(), [0, 0, 0], z3(), SUCTION.holdingForce * 0.5);
    expect(mag(out)).toBeCloseTo(1.5, 12);
  });
  it('returns the spring-damper value when it is below the cap', () => {
    const out = z3();
    // 2 mm offset, 0.1 m/s closing speed: 400 * 0.002 + 2 * 0.1 = 1.0 N
    suctionForce(out, [0, 0, 0.002], [0, 0, 0.1], [0, 0, 0], [0, 0, 0], 3);
    expect(out[2]).toBeCloseTo(1.0, 12);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
  });
  it('points from the candy toward the tip', () => {
    const out = z3();
    suctionForce(out, [0.5, 0.2, 0.1], z3(), [0.5, 0.2, 0.1 - 0.004], z3(), 3);
    expect(out[2]).toBeGreaterThan(0);
  });
  it('keeps the direction when it scales the magnitude down', () => {
    const out = z3();
    suctionForce(out, [0.03, 0.04, 0], z3(), [0, 0, 0], z3(), 3);
    expect(out[0]! / out[1]!).toBeCloseTo(0.75, 12);
    expect(mag(out)).toBeCloseTo(3, 12);
  });
  it('gives exactly +0 for a zero force and for a zero cap', () => {
    const out = new Float64Array([9, 9, 9]);
    suctionForce(out, [1, 1, 1], z3(), [1, 1, 1], z3(), 3);
    expect(Object.is(out[0], 0) && Object.is(out[1], 0) && Object.is(out[2], 0)).toBe(true);
    suctionForce(out, [1, -1, 1], z3(), [0, 0, 0], z3(), 0);
    expect(Object.is(out[0], 0) && Object.is(out[1], 0) && Object.is(out[2], 0)).toBe(true);
  });
  it('allocates nothing over 200 000 calls', async () => {
    const out = z3(), tip = new Float64Array([0.01, 0.02, 0.03]), v = z3(), c = z3();
    const n = await gcCount(200_000, (i) => { tip[0] = i * 1e-7; suctionForce(out, tip, v, c, v, 3); });
    expect(n).toBe(0);
  });
});

describe('sanitizeRatio', () => {
  it('maps NaN and the infinities to 0', () => {
    expect(sanitizeRatio(NaN)).toBe(0);
    expect(sanitizeRatio(Infinity)).toBe(0);
    expect(sanitizeRatio(-Infinity)).toBe(0);
  });
  it('clamps into [0, 1] and passes values inside through', () => {
    expect(sanitizeRatio(-0.2)).toBe(0);
    expect(sanitizeRatio(1.7)).toBe(1);
    expect(sanitizeRatio(0.25)).toBe(0.25);
  });
  it('words the warning with the original value and the value used', () => {
    expect(vacuumWarning(1.7)).toBe('Vacuum_Ratio 1.7 is outside [0, 1]; using 1');
    expect(vacuumWarning(NaN)).toBe('Vacuum_Ratio NaN is outside [0, 1]; using 0');
  });
});
