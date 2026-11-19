import fc from 'fast-check';
import { buildContext } from 'golem-spec';
import { afterAll, describe, expect, it } from 'vitest';
import { HOVER_NAMES, THRUST_MAX } from '../constants';
import { mixerFromModel } from '../controller';
import { makeMixer, mix } from '../controller/mixer';
import { compileRobot } from './helpers/mujoco';

// the X2: motors 1 to 4 at (x, y) with a yaw reaction g per newton
const X = [-0.14, -0.14, 0.14, 0.14], Y = [-0.18, 0.18, 0.18, -0.18], G = [-0.0201, 0.0201, -0.0201, 0.0201];
const mixer = makeMixer(X, Y, G);

/** The wrench that four motor thrusts make: thrust, roll, pitch, yaw. */
const wrench = (f: ArrayLike<number>): number[] => [
  f[0]! + f[1]! + f[2]! + f[3]!,
  [0, 1, 2, 3].reduce((s, i) => s + Y[i]! * f[i]!, 0),
  [0, 1, 2, 3].reduce((s, i) => s - X[i]! * f[i]!, 0),
  [0, 1, 2, 3].reduce((s, i) => s + G[i]! * f[i]!, 0),
];

describe('mixer', () => {
  it('reproduces any wrench that the motors can make, when no motor saturates', () => {
    fc.assert(fc.property(
      fc.double({ min: 4, max: 40, noNaN: true }), fc.double({ min: -0.3, max: 0.3, noNaN: true }),
      fc.double({ min: -0.3, max: 0.3, noNaN: true }), fc.double({ min: -0.02, max: 0.02, noNaN: true }),
      (t, r, p, y) => {
        const out = new Float64Array(4);
        mix(mixer, t, r, p, y, out);
        if (out.some((f) => f <= 0 || f >= THRUST_MAX)) return;      // a saturated motor changes the wrench by design
        const w = wrench(out);
        expect(w[0]).toBeCloseTo(t, 9); expect(w[1]).toBeCloseTo(r, 9); expect(w[2]).toBeCloseTo(p, 9); expect(w[3]).toBeCloseTo(y, 9);
      },
    ), { numRuns: 300 });
  });
  it('splits a pure thrust evenly', () => {
    const out = new Float64Array(4);
    mix(mixer, 13, 0, 0, 0, out);
    for (const f of out) expect(f).toBeCloseTo(3.25, 12);
  });
  it('makes a positive roll torque with the motors at +y, a positive pitch torque with the motors at -x, and a positive yaw with the +g motors', () => {
    const out = new Float64Array(4);
    mix(mixer, 13, 0.2, 0, 0, out);
    expect(out[1]! + out[2]!).toBeGreaterThan(out[0]! + out[3]!);
    mix(mixer, 13, 0, 0.2, 0, out);
    expect(out[0]! + out[1]!).toBeGreaterThan(out[2]! + out[3]!);
    mix(mixer, 13, 0, 0, 0.02, out);
    expect(out[1]! + out[3]!).toBeGreaterThan(out[0]! + out[2]!);
  });
  it('limits every motor to [0, THRUST_MAX], for any input including non-finite-free extremes', () => {
    fc.assert(fc.property(
      fc.double({ min: -1e4, max: 1e4, noNaN: true }), fc.double({ min: -1e3, max: 1e3, noNaN: true }),
      fc.double({ min: -1e3, max: 1e3, noNaN: true }), fc.double({ min: -1e3, max: 1e3, noNaN: true }),
      (t, r, p, y) => {
        const out = new Float64Array(4);
        mix(mixer, t, r, p, y, out);
        for (const f of out) { expect(f).toBeGreaterThanOrEqual(0); expect(f).toBeLessThanOrEqual(THRUST_MAX); }
      },
    ), { numRuns: 200 });
  });
  it('refuses geometry whose columns are not orthogonal, because the closed form would be wrong', () => {
    expect(() => makeMixer([-0.14, -0.14, 0.14, 0.14], [-0.18, 0.18, 0.18, -0.18], [-0.02, 0.02, 0.02, 0.02])).toThrow(/orthogonal/);
    expect(() => makeMixer([1, 2], [1, 2, 3], [1, 2])).toThrow(/one entry per motor/);
  });
});

const { mj, model } = await compileRobot();
afterAll(() => { model.delete(); });

describe('mixerFromModel', () => {
  it('reads the motor positions and yaw gears of the X2 model', () => {
    const data = new mj.MjData(model);
    try {
      const ctx = buildContext(mj, model, data, HOVER_NAMES as never);
      const fromModel = mixerFromModel(ctx);
      expect(Array.from(fromModel.rows)).toEqual(Array.from(mixer.rows));
    } finally { data.delete(); }
  });
});
