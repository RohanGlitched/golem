// createSaturationMeter (golem-sim-hardening improvement 4).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createSaturationMeter } from './helpers.js';
import { pureConfig } from './test-support.js';

const arbActuators = fc.array(
  fc.record({
    lo: fc.double({ min: -100, max: 99, noNaN: true }),
    width: fc.double({ min: 0.01, max: 100, noNaN: true }),
    limited: fc.boolean(),
    ctrl: fc.double({ min: -300, max: 300, noNaN: true }),
  }),
  { minLength: 0, maxLength: 8 },
);

function fakeModel(acts: Array<{ lo: number; width: number; limited: boolean }>) {
  return {
    nu: acts.length,
    actuator_ctrlrange: Float64Array.from(acts.flatMap((a) => [a.lo, a.lo + a.width])),
    actuator_ctrllimited: Uint8Array.from(acts.map((a) => (a.limited ? 1 : 0))),
  };
}

describe('createSaturationMeter', () => {
  it('is the largest normalised distance from the range middle over ctrl-limited actuators, and >= 1 exactly when a command is at or past a limit', () => {
    fc.assert(fc.property(arbActuators, (acts) => {
      const meter = createSaturationMeter(fakeModel(acts));
      const ctrl = Float64Array.from(acts.map((a) => a.ctrl));
      const s = meter(ctrl);
      let ref = 0;
      let past = false;
      let nearEdge = false;
      for (const a of acts) {
        if (!a.limited) continue;
        const hi = a.lo + a.width;
        ref = Math.max(ref, Math.abs(2 * a.ctrl - (a.lo + hi)) / (hi - a.lo));
        if (a.ctrl <= a.lo || a.ctrl >= hi) past = true;
        if (Math.min(Math.abs(a.ctrl - a.lo), Math.abs(a.ctrl - hi)) < 1e-9 * a.width) nearEdge = true;
      }
      if (Math.abs(s - ref) > 1e-12 * Math.max(1, ref)) return false;
      return nearEdge || (s >= 1) === past;
    }), pureConfig);
  });

  it('reads the ranges once, so later model edits do not change an existing meter', () => {
    const m = fakeModel([{ lo: -1, width: 2, limited: true }]);
    const meter = createSaturationMeter(m);
    m.actuator_ctrlrange[1] = 100;
    expect(meter([1])).toBe(1);
    expect(meter([0])).toBe(0);
    expect(meter([-3])).toBe(3);
  });

  it('gives 0 with no limited actuator and NaN for a NaN command on a limited one', () => {
    expect(createSaturationMeter(fakeModel([{ lo: -1, width: 2, limited: false }]))([50])).toBe(0);
    expect(createSaturationMeter(fakeModel([]))([])).toBe(0);
    expect(createSaturationMeter(fakeModel([{ lo: -1, width: 2, limited: true }]))([NaN])).toBeNaN();
  });
});
