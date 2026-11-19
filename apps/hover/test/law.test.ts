import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GRAVITY, MASS } from '../constants';
import { GAINS, attitudeOf, attitudeTorque, desiredAcceleration, desiredForce, makeAttitude, totalThrust } from '../controller/law';

const finite = (min: number, max: number) => fc.double({ min, max, noNaN: true });
const vec3 = (lim: number) => fc.tuple(finite(-lim, lim), finite(-lim, lim), finite(-lim, lim));
const unitQuat = fc.tuple(finite(-1, 1), finite(-1, 1), finite(-1, 1), finite(-1, 1)).filter((q) => Math.hypot(...q) > 0.1).map((q) => { const n = Math.hypot(...q); return q.map((v) => v / n) as [number, number, number, number]; });

describe('position loop', () => {
  it('is zero at the hover point at rest with no integral', () => {
    const a = new Float64Array(3);
    desiredAcceleration(a, [0, 0, 0], [0, 0, 0], [0, 0, 0]);
    expect(Array.from(a)).toEqual([0, 0, 0]);
  });
  it('pulls toward the hover point and brakes against the velocity', () => {
    fc.assert(fc.property(vec3(2), vec3(3), (e, v) => {
      const a = new Float64Array(3), a0 = new Float64Array(3);
      desiredAcceleration(a, e, v, [0, 0, 0]);
      for (let i = 0; i < 3; i++) {
        const g = i < 2 ? GAINS.horizontal : GAINS.vertical;
        expect(a[i]).toBeCloseTo(g.kp * e[i]! - g.kd * v[i]!, 9);
      }
      desiredAcceleration(a0, [0, 0, 0], v, [0, 0, 0]);
      for (let i = 0; i < 3; i++) expect(Math.sign(a0[i]!) * Math.sign(v[i]!)).toBeLessThanOrEqual(0);
    }), { numRuns: 200 });
  });
  it('limits what the integral term adds to integralLimit on each axis', () => {
    fc.assert(fc.property(vec3(1e3), (integral) => {
      const a = new Float64Array(3);
      desiredAcceleration(a, [0, 0, 0], [0, 0, 0], integral);
      for (const v of a) expect(Math.abs(v)).toBeLessThanOrEqual(GAINS.integralLimit + 1e-12);
    }), { numRuns: 200 });
  });
});

describe('desiredForce', () => {
  it('equals m (a + g) when the tilt limit is not reached', () => {
    const f = new Float64Array(3);
    desiredForce(f, [0.5, -0.3, 0.2]);
    expect(f[0]).toBeCloseTo(MASS * 0.5, 12); expect(f[1]).toBeCloseTo(-MASS * 0.3, 12); expect(f[2]).toBeCloseTo(MASS * (GRAVITY + 0.2), 12);
  });
  it('never leans further than the tilt limit, and keeps the direction of the horizontal part', () => {
    fc.assert(fc.property(vec3(100), (a) => {
      const f = new Float64Array(3);
      desiredForce(f, a);
      expect(f[2]).toBeGreaterThan(0);
      const lean = Math.atan2(Math.hypot(f[0]!, f[1]!), f[2]!);
      expect(lean).toBeLessThanOrEqual(GAINS.tiltLimit + 1e-9);
      // same side as the request: the dot product with the requested horizontal acceleration is not negative
      expect(f[0]! * a[0]! + f[1]! * a[1]!).toBeGreaterThanOrEqual(-1e-9);
    }), { numRuns: 300 });
  });
  it('keeps the vertical force positive even for a hard downward request', () => {
    const f = new Float64Array(3);
    desiredForce(f, [0, 0, -1000]);
    expect(f[2]).toBeGreaterThan(0);
  });
});

describe('attitude', () => {
  it('builds a rotation matrix whose body z axis is the third column', () => {
    const a = makeAttitude();
    attitudeOf([Math.SQRT1_2, Math.SQRT1_2, 0, 0], 0, a);      // 90 deg about x: body z points along -y
    expect(a.r02).toBeCloseTo(0, 12); expect(a.r12).toBeCloseTo(-1, 12); expect(a.r22).toBeCloseTo(0, 12);
  });
  it('gives a unit z axis for any unit quaternion', () => {
    fc.assert(fc.property(unitQuat, (q) => {
      const a = makeAttitude();
      attitudeOf(q, 0, a);
      expect(Math.hypot(a.r02, a.r12, a.r22)).toBeCloseTo(1, 9);
      expect(Math.hypot(a.r00, a.r10, a.r20)).toBeCloseTo(1, 9);
    }), { numRuns: 200 });
  });
  it('makes no torque when the body already points along the force and does not turn', () => {
    const a = makeAttitude();
    attitudeOf([1, 0, 0, 0], 0, a);
    const tq = new Float64Array(3);
    attitudeTorque(tq, a, [0, 0, 13], [0, 0, 0]);
    expect(Array.from(tq).map(Math.abs)).toEqual([0, 0, 0]);
  });
  it('turns the body z axis toward the force: the thrust direction error shrinks along the torque', () => {
    fc.assert(fc.property(finite(-0.5, 0.5), finite(-0.5, 0.5), (fx, fy) => {
      const a = makeAttitude();
      attitudeOf([1, 0, 0, 0], 0, a);
      const tq = new Float64Array(3);
      attitudeTorque(tq, a, [fx * 13, fy * 13, 13], [0, 0, 0]);
      // a positive roll torque tilts the body z axis toward -y, a positive pitch torque toward +x
      expect(Math.sign(tq[0]!) * Math.sign(-fy)).toBeGreaterThanOrEqual(0);
      expect(Math.sign(tq[1]!) * Math.sign(fx)).toBeGreaterThanOrEqual(0);
    }), { numRuns: 200 });
  });
  it('damps a body rate: the torque opposes it', () => {
    fc.assert(fc.property(vec3(5), (w) => {
      const a = makeAttitude();
      attitudeOf([1, 0, 0, 0], 0, a);
      const tq = new Float64Array(3);
      attitudeTorque(tq, a, [0, 0, 13], w);
      for (let i = 0; i < 3; i++) expect(tq[i]! * w[i]!).toBeLessThanOrEqual(1e-12);
    }), { numRuns: 200 });
  });
  it('holds yaw at 0: a yawed body gets a torque back', () => {
    const a = makeAttitude();
    attitudeOf([Math.cos(0.2), 0, 0, Math.sin(0.2)], 0, a);    // yaw of +0.4 rad
    const tq = new Float64Array(3);
    attitudeTorque(tq, a, [0, 0, 13], [0, 0, 0]);
    expect(tq[2]).toBeLessThan(0);
  });
});

describe('totalThrust', () => {
  it('is the force projected on the body z axis and is never negative', () => {
    fc.assert(fc.property(unitQuat, vec3(50), (q, f) => {
      const a = makeAttitude();
      attitudeOf(q, 0, a);
      const t = totalThrust(a, f);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeCloseTo(Math.max(0, a.r02 * f[0] + a.r12 * f[1] + a.r22 * f[2]), 9);
    }), { numRuns: 200 });
  });
  it('equals the weight when the drone is level and the force is the weight', () => {
    const a = makeAttitude();
    attitudeOf([1, 0, 0, 0], 0, a);
    expect(totalThrust(a, [0, 0, MASS * GRAVITY])).toBeCloseTo(MASS * GRAVITY, 12);
  });
});
